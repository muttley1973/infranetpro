'use strict';
// ============================================================
// InfraNet Pro - Export frontend module
// JSON backup, cable-label CSV, floor SVG and PDF report export.
// Loaded after netmapper.html so it can use the shared app state/helpers.
// ============================================================

(function(){
// Nome localizzato del tipo device. export.js è classic: usa il `typeName`
// globale esposto da app-types.js (via expose), con fallback al nome del
// catalogo se assente (es. in contesti di test senza bridge). `typeof` su un
// global non dichiarato non lancia.
const _typeName = (k) => (typeof typeName === 'function')
    ? typeName(k)
    : ((typeof TYPES !== 'undefined' && TYPES[k] && TYPES[k].name) || k);

const PDF_EXPORT_DEFAULTS = {
    includePlanimetria: true,
    includeBackground:  true,
    includeInventory:   true,
    includeAsBuilt:     true,
    includeRacks:       true,
    includePorts:       true,
    includeVlans:       true,
    includeTopology:    true,
    includeSpare:       true,
    includeAssets:      true,   // registro asset per-device (NIS2/ISO): server-side da nodeToDevice
};

function exportJSON() {
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'infranet-backup.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

// Nome della stanza che contiene un node (geometrico: le stanze sono rettangoli
// strutturali sul floor, nessuna assegnazione esplicita). Per i device in rack
// si usa la posizione del rack. '' se il node non e' dentro nessuna stanza.
function _nodeRoomName(node){
    if(!node) return '';
    let px=node.x, py=node.y;
    if((px==null||py==null) && node.rackId && typeof getRackById==='function'){
        const rk=getRackById(node.rackId);
        if(rk){ px=rk.x; py=rk.y; }
    }
    if(px==null||py==null) return '';
    for(const r of state.nodes){
        if(r.type!=='room') continue;
        const rw=r.w||200, rh=r.h||200;
        if(px>=r.x && px<=r.x+rw && py>=r.y && py<=r.y+rh) return r.name||'';
    }
    return '';
}

// Righe etichetta cavo (unica sorgente per CSV + PDF): inietta i global
// dell'app nel builder puro lib/cable-labels.js (buildCableLabelRows).
function _cableLabelRows(){
    return buildCableLabelRows({
        links: state.links,
        helpers: {
            nodeByPortId:   getNodeByPortId,
            cableAutoLabel: _cableAutoLabel,
            linkVlan:       _getLinkVlan,
            vlanNames:      state.vlanNames || {},
            roomName:       _nodeRoomName,
        },
    });
}

// Campi etichetta selezionabili (ordine = ordine colonne CSV / righe etichetta).
// Unica definizione lato client; il server ha la lista equivalente in label-sheet.js.
const LABEL_FIELDS = [
    { k:'label',         t:'Etichetta (ID)' },
    { k:'da',            t:'Da' },
    { k:'a',             t:'A' },
    { k:'lunghezza',     t:'Lunghezza' },
    { k:'tipo_cavo',     t:'Tipo cavo' },
    { k:'vlan',          t:'VLAN' },
    { k:'permanente',    t:'Permanente/bretella' },
    { k:'installato_il', t:'Installato il' },
    { k:'installato_da', t:'Installato da' },
    { k:'stanza',        t:'Stanza' },
];

// True se il progetto ha almeno un nome VLAN definito.
function _hasVlanNames(){
    return Object.values(state.vlanNames||{}).some(v=>v && String(v).trim());
}

// Colonne CSV per i campi scelti. La VLAN aggiunge la colonna `vlan_nome` SOLO
// se nel progetto esistono nomi VLAN (altrimenti sarebbe una colonna vuota che
// sembra un campo duplicato).
function _csvColumnsFor(fields){
    const cols=[]; const add=(h,v)=>cols.push({h,v});
    // etichetta: se NON ci sono anche da+a in export, usa l'etichetta completa
    // (con fallback "da → a", sempre stampabile); se invece esporti gia' da+a,
    // usa solo il codice assegnato a mano per non duplicare le colonne.
    if(fields.has('label')){
        const useFull = !(fields.has('da') && fields.has('a'));
        add('etichetta', r=>((useFull ? r.label : r.customLabel)||'').replace(/→/g,'->'));
    }
    if(fields.has('da'))            add('da',            r=>r.from);
    if(fields.has('a'))             add('a',             r=>r.to);
    if(fields.has('lunghezza'))     add('lunghezza_m',   r=>r.lengthM!=null?String(r.lengthM):'');
    if(fields.has('tipo_cavo'))     add('tipo_cavo',     r=>r.cableType);
    if(fields.has('vlan')){          add('vlan',          r=>r.vlan!=null?String(r.vlan):'');
                                     if(_hasVlanNames()) add('vlan_nome', r=>r.vlanName); }
    if(fields.has('permanente'))    add('permanente',    r=>r.isPermanent?'si':'no');
    if(fields.has('installato_il')) add('installato_il', r=>r.installedAt);
    if(fields.has('installato_da')) add('installato_da', r=>r.installedBy);
    if(fields.has('stanza'))        add('stanza',        r=>r.room);
    return cols;
}

function exportLabelsCSV(fields){
    const set = fields instanceof Set ? fields : new Set(LABEL_FIELDS.map(f=>f.k));
    const cols=_csvColumnsFor(set);
    if(!cols.length) cols.push({h:'etichetta',v:r=>(r.label||'').replace(/→/g,'->')});
    const rows=[cols.map(c=>c.h)];
    _cableLabelRows().forEach(r=>rows.push(cols.map(c=>c.v(r))));
    const csv='﻿'+rows.map(r=>r.map(c=>`"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`${(state.projectName||'infranet').replace(/[^a-z0-9_-]/gi,'_')}_cables.csv`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

// ---- Export etichette: overlay (CSV o PDF Avery/Dymo/generico) -------------

// Dimensioni nominali (mm) per il rapporto d'aspetto dell'anteprima PDF.
const LABEL_TEMPLATE_DIM = {
    'avery-l7651':[38.1,21.2], 'avery-22806':[38.1,38.1],
    'dymo-99010':[89,28], 'dymo-11353':[25,13], 'generic-grid':[48,25],
};
// Campi attivi di default all'apertura: solo l'etichetta (uso tipico = etichetta
// unica da stampare). Gli estremi da/a si aggiungono con le checkbox al bisogno.
const LABEL_DEFAULT_FIELDS = ['label'];

function openLabelExportOptions(){
    const ov=document.getElementById('label-export-overlay');
    if(!ov) return;
    // Genera le checkbox dei campi una sola volta.
    const box=document.getElementById('lblexp-fields');
    if(box && !box.dataset.built){
        box.innerHTML=LABEL_FIELDS.map(f=>
            `<label style="display:flex;align-items:center;gap:6px;font-size:0.95rem">`+
            `<input type="checkbox" class="lblexp-fld" value="${f.k}" `+
            `${LABEL_DEFAULT_FIELDS.includes(f.k)?'checked':''} onchange="syncLabelExportUi()"> ${f.t}</label>`
        ).join('');
        box.dataset.built='1';
    }
    ov.classList.add('open');
    syncLabelExportUi();
}

function closeLabelExportOptions(){
    document.getElementById('label-export-overlay')?.classList.remove('open');
}

function _selectedLabelFields(){
    return new Set([...document.querySelectorAll('.lblexp-fld:checked')].map(c=>c.value));
}

function syncLabelExportUi(){
    const fmt=document.getElementById('lblexp-format')?.value||'csv';
    const isCsv=fmt==='csv';
    const isGeneric=fmt==='generic-grid';
    const wrapRow=document.getElementById('lblexp-wrap-row');
    const grid=document.getElementById('lblexp-grid');
    const hint=document.getElementById('lblexp-hint');
    if(wrapRow) wrapRow.style.display=isCsv?'none':'flex';
    if(grid)    grid.style.display   =isGeneric?'flex':'none';
    if(hint){
        hint.textContent=isCsv
            ? 'CSV: una colonna per campo selezionato. Importalo nel tuo software etichette.'
            : 'Suggerimento: stampa prima una pagina di PROVA su carta normale e appoggiala al foglio etichette per verificare l\'allineamento.';
    }
    _renderLabelPreview();
}

// Righe testo dell'anteprima etichetta (mirror di _cellLines del server).
function _previewLines(r, fields){
    const lines=[];
    if(fields.has('label')) lines.push({t:(r.label||'').replace(/→/g,'->'), cls:'h'});
    const ft=[]; if(fields.has('da')) ft.push(r.from||'?'); if(fields.has('a')) ft.push(r.to||'?');
    if(ft.length) lines.push({t:ft.join(' → '), cls:'s'});
    const chips=[];
    if(fields.has('vlan')&&r.vlan!=null) chips.push('V'+r.vlan+(r.vlanName?' '+r.vlanName:''));
    if(fields.has('tipo_cavo')&&r.cableType) chips.push(r.cableType);
    if(fields.has('lunghezza')&&r.lengthM!=null) chips.push(r.lengthM+'m');
    if(fields.has('permanente')) chips.push(r.isPermanent?'permanente':'bretella');
    if(chips.length) lines.push({t:chips.join('  ·  '), cls:'m'});
    const inst=[]; if(fields.has('installato_il')&&r.installedAt) inst.push(r.installedAt);
    if(fields.has('installato_da')&&r.installedBy) inst.push(r.installedBy);
    if(inst.length) lines.push({t:inst.join(' · '), cls:'m'});
    if(fields.has('stanza')&&r.room) lines.push({t:r.room, cls:'m'});
    return lines;
}

function _renderLabelPreview(){
    const box=document.getElementById('lblexp-preview');
    if(!box) return;
    const fmt=document.getElementById('lblexp-format')?.value||'csv';
    const fields=_selectedLabelFields();
    const rows=_cableLabelRows();
    const count=rows.length;
    const head=`<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px">Anteprima — ${count} etichett${count===1?'a':'e'}</div>`;
    if(!count){ box.innerHTML=head+'<div style="font-size:0.78rem;color:var(--text-muted)">Nessun cavo nel progetto.</div>'; return; }

    if(fmt==='csv'){
        const cols=_csvColumnsFor(fields);
        if(!cols.length){ box.innerHTML=head+'<div style="font-size:0.78rem;color:var(--text-muted)">Seleziona almeno un campo.</div>'; return; }
        const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        const th=cols.map(c=>`<th style="text-align:left;padding:3px 8px;border-bottom:1px solid var(--border);white-space:nowrap">${esc(c.h)}</th>`).join('');
        const trs=rows.slice(0,4).map(r=>'<tr>'+cols.map(c=>`<td style="padding:3px 8px;white-space:nowrap;max-width:210px;overflow:hidden;text-overflow:ellipsis">${esc(c.v(r))}</td>`).join('')+'</tr>').join('');
        box.innerHTML=head+`<div style="overflow:auto;max-height:200px;border:1px solid var(--border);border-radius:6px">`+
            `<table style="border-collapse:collapse;font-size:0.95rem"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`+
            (count>4?`<div style="font-size:0.9rem;color:var(--text-muted);margin-top:4px">…e altre ${count-4} righe</div>`:'');
        return;
    }

    // PDF: mock di UNA etichetta col rapporto d'aspetto del template.
    let dim=LABEL_TEMPLATE_DIM[fmt]||[48,25];
    if(fmt==='generic-grid'){ const g=_genericGridFromUi(); if(g.labelW&&g.labelH) dim=[g.labelW,g.labelH]; }
    const W=240, H=Math.max(46, Math.round(W*dim[1]/dim[0]));
    const wrap=!!document.getElementById('lblexp-wrap')?.checked;
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const r=rows[0];
    let inner;
    if(wrap){
        const lbl=esc((r.label||'').replace(/→/g,'->'));
        // Bandierina: il testo si ripete nelle DUE metà (alto/basso) e OGNI riga è
        // centrata nella propria metà (al quarto dell'altezza, cioè a metà tra il
        // centro dell'etichetta e il bordo), con la piega al centro. Rispecchia il
        // layout del PDF (server/label-sheet.js _drawCell wrap: cy+(halfH-fs)/2).
        const half=`<div style="flex:1;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${lbl}</div>`;
        inner=`<div style="display:flex;flex-direction:column;width:100%;height:100%">${half}<div style="border-top:1px dashed #bbb;width:60%;align-self:center"></div>${half}</div>`;
    }else{
        const lines=_previewLines(r,fields);
        if(!lines.length){ box.innerHTML=head+'<div style="font-size:0.78rem;color:var(--text-muted)">Seleziona almeno un campo.</div>'; return; }
        inner=lines.map((l)=>{
            // h = Etichetta (ID) resta 14px; s/m (tutti gli altri campi) a 13px.
            const fs=l.cls==='h'?14:13;
            const col=l.cls==='h'?'#111':(l.cls==='s'?'#444':'#666');
            const fw=l.cls==='h'?'700':'400';
            return `<div style="font-size:${fs}px;color:${col};font-weight:${fw};line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.t)}</div>`;
        }).join('');
    }
    box.innerHTML=head+
        `<div style="display:inline-flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;`+
        `width:${W}px;height:${H}px;padding:6px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:4px;background:#fff;color:#111;overflow:hidden">`+
        `${inner}</div>`+
        `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">${dim[0]}×${dim[1]} mm</div>`;
}

function _genericGridFromUi(){
    const num=id=>{ const v=Number(document.getElementById(id)?.value); return Number.isFinite(v)?v:undefined; };
    return {
        cols:num('lblg-cols'), rows:num('lblg-rows'),
        labelW:num('lblg-labelW'), labelH:num('lblg-labelH'),
        marginLeft:num('lblg-marginLeft'), marginTop:num('lblg-marginTop'),
        pitchX:num('lblg-pitchX'), pitchY:num('lblg-pitchY'),
    };
}

async function confirmLabelExport(){
    const fmt=document.getElementById('lblexp-format')?.value||'csv';
    const fields=_selectedLabelFields();
    if(!fields.size){ _showToast?.('Seleziona almeno un campo','warn'); return; }

    if(fmt==='csv'){ closeLabelExportOptions(); exportLabelsCSV(fields); return; }

    const rows=_cableLabelRows();
    if(!rows.length){ _showToast?.('Nessun cavo da etichettare','warn'); return; }

    const payload={
        rows,
        template: fmt,
        fields:   [...fields],
        wrap:     !!document.getElementById('lblexp-wrap')?.checked,
    };
    if(fmt==='generic-grid') payload.grid=_genericGridFromUi();

    closeLabelExportOptions();
    try{
        const resp=await fetch('/api/export-labels-pdf',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload),
        });
        if(!resp.ok){
            let msg='Errore server';
            try{ const j=await resp.json(); msg=j.error||msg; }catch(_){}
            throw new Error(msg);
        }
        const blob=await resp.blob();
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;
        a.download=`${(state.projectName||'infranet').replace(/[^a-z0-9_-]/gi,'_')}_etichette.pdf`;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(url),5000);
    }catch(err){
        alert('Esportazione etichette fallita:\n'+err.message);
    }
}

function openPdfExportOptions(){
    document.getElementById('pdf-export-overlay').classList.add('open');
    document.getElementById('pdfopt-plan').checked      = PDF_EXPORT_DEFAULTS.includePlanimetria;
    document.getElementById('pdfopt-bg').checked        = PDF_EXPORT_DEFAULTS.includeBackground;
    document.getElementById('pdfopt-inventory').checked = PDF_EXPORT_DEFAULTS.includeInventory;
    document.getElementById('pdfopt-asbuilt').checked   = PDF_EXPORT_DEFAULTS.includeAsBuilt;
    document.getElementById('pdfopt-racks').checked     = PDF_EXPORT_DEFAULTS.includeRacks;
    document.getElementById('pdfopt-ports').checked     = PDF_EXPORT_DEFAULTS.includePorts;
    document.getElementById('pdfopt-vlans').checked     = PDF_EXPORT_DEFAULTS.includeVlans;
    document.getElementById('pdfopt-topology').checked  = PDF_EXPORT_DEFAULTS.includeTopology;
    { const _s = document.getElementById('pdfopt-spare'); if(_s) _s.checked = PDF_EXPORT_DEFAULTS.includeSpare; }
    { const _a = document.getElementById('pdfopt-assets'); if(_a) _a.checked = PDF_EXPORT_DEFAULTS.includeAssets; }
    syncPdfExportUi();
}

function closePdfExportOptions(){ document.getElementById('pdf-export-overlay').classList.remove('open'); }

function setPdfExportAll(val){
    ['pdfopt-plan','pdfopt-bg','pdfopt-inventory','pdfopt-asbuilt','pdfopt-racks','pdfopt-ports','pdfopt-vlans','pdfopt-topology','pdfopt-spare','pdfopt-assets']
        .forEach(id=>{ const el=document.getElementById(id); if(el) el.checked=!!val; });
    if(!val){
        // Mantieni almeno una sezione attiva per evitare export vuoto.
        document.getElementById('pdfopt-plan').checked=true;
    }
    syncPdfExportUi();
}

function syncPdfExportUi(){
    const plan=document.getElementById('pdfopt-plan');
    const bg=document.getElementById('pdfopt-bg');
    const hint=document.getElementById('pdfopt-hint');
    if(!plan||!bg||!hint) return;
    bg.disabled=!plan.checked;
    bg.parentElement.style.opacity=plan.checked?'0.95':'0.5';
    if(!plan.checked) bg.checked=false;

    const opts=_getPdfExportOptionsFromUi();
    const hasAny=Object.entries(opts).some(([k,v])=>k!=='includeBackground'&&v);
    hint.textContent=hasAny
        ? 'Seleziona le sezioni che vuoi includere nel PDF.'
        : 'Seleziona almeno una sezione.';
}

function _getPdfExportOptionsFromUi(){
    return {
        includePlanimetria: !!document.getElementById('pdfopt-plan')?.checked,
        includeBackground:  !!document.getElementById('pdfopt-bg')?.checked,
        includeInventory:   !!document.getElementById('pdfopt-inventory')?.checked,
        includeAsBuilt:     !!document.getElementById('pdfopt-asbuilt')?.checked,
        includeRacks:       !!document.getElementById('pdfopt-racks')?.checked,
        includePorts:       !!document.getElementById('pdfopt-ports')?.checked,
        includeVlans:       !!document.getElementById('pdfopt-vlans')?.checked,
        includeTopology:    !!document.getElementById('pdfopt-topology')?.checked,
        includeSpare:       !!document.getElementById('pdfopt-spare')?.checked,
        includeAssets:      !!document.getElementById('pdfopt-assets')?.checked,
    };
}

function confirmPdfExport(){
    const opts=_getPdfExportOptionsFromUi();
    const hasAny=Object.entries(opts).some(([k,v])=>k!=='includeBackground'&&v);
    if(!hasAny){ _showToast('Seleziona almeno una sezione da esportare','warn'); return; }
    closePdfExportOptions();
    exportPDF(opts);
}

function _buildFloorSVG(opts){
    opts = opts || {};
    const floorNodes=state.nodes.filter(n=>TYPES[n.type]?.isFloor);

    // --- Dimensioni reali dell'immagine di sfondo dal DOM ---
    const bgEl=document.getElementById('floor-bg-img');
    const bsc=state.bgImageScale||1;
    // naturalWidth è 0 in Chrome per SVG senza width/height espliciti →
    // fallback: leggi viewBox dall'XML del SVG
    const _bgMime=state.bgImage?(state.bgImage.split(';')[0].split(':')[1]||'').toLowerCase():'';
    let _bgNatW = bgEl ? bgEl.naturalWidth  : 0;
    let _bgNatH = bgEl ? bgEl.naturalHeight : 0;
    if(_bgMime==='image/svg+xml' && (!_bgNatW||!_bgNatH)){
        const _d=_parseSvgSize(state.bgImage);
        _bgNatW=_d.w||_bgNatW||800; _bgNatH=_d.h||_bgNatH||600;
    }
    const hasImg=!!state.bgImage && (_bgMime==='image/svg+xml' ? true : _bgNatW>0);
    const imgW=hasImg ? Math.round(_bgNatW * bsc) : 0;
    const imgH=hasImg ? Math.round(_bgNatH * bsc) : 0;

    // --- Bounding box basato sul contenuto reale ---
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    if(hasImg){ x0=0; y0=0; x1=imgW; y1=imgH; }
    floorNodes.forEach(n=>{
        if(TYPES[n.type]?.isStructural){
            x0=Math.min(x0,n.x);            y0=Math.min(y0,n.y);
            x1=Math.max(x1,n.x+(n.w||200)); y1=Math.max(y1,n.y+(n.h||200));
        } else {
            x0=Math.min(x0,n.x-50);  y0=Math.min(y0,n.y-50);
            x1=Math.max(x1,n.x+50);  y1=Math.max(y1,n.y+50);
        }
    });
    // Includi anche le icone rack posizionate sulla planimetria
    state.racks.filter(r=>r.x!==undefined).forEach(r=>{
        x0=Math.min(x0,r.x-50); y0=Math.min(y0,r.y-30);
        x1=Math.max(x1,r.x+50); y1=Math.max(y1,r.y+30);
    });
    if(!isFinite(x0)){x0=0;y0=0;x1=800;y1=600;}
    const pad=hasImg?0:40;
    x0=Math.max(0,x0-pad); y0=Math.max(0,y0-pad); x1+=pad; y1+=pad;
    const W=x1-x0, H=y1-y0;
    const bgCol=state.uiColors?.floorBg||'#0d1117';
    const pdf=!!opts.pdfMode;

    // Palette: screen (dark) vs PDF (light, stampabile)
    const P = pdf ? {
        // Colori
        devFill:    '#f8f9fa', devBorder: '#ced4da', devSep:    '#ced4da',
        devLabel:   '#374151',
        rackFill:   '#f8f9fa', rackStroke:'#868e96',
        rackName:   '#111827', rackCnt:   '#6b7280', rackBadge: '#e5e7eb',
        connLine:   '#6b7280', connBadge: '#e5e7eb', connTxt:   '#111827',
        roomTxt:    'rgba(0,0,0,0.55)',
        connOp:'1', fanOp:'1', cableOp:'1',
        // Spessori linee raddoppiati per visibilità su carta
        connSW: 4,   cableSW: 5,   fanSW: 3,
        devOutSW: 5, devInSW: 2,   devSepSW: 2,
        rackSW: 3,   rackInSW: 1.5,
        // Testo: più grande e bold per leggibilità
        iconSz: 18,  iconW: '900',
        lblSz:  14,  lblW:  '700',
        rackNSz:12,  rackNW:'700',
        rackCSz:10,  rackCW:'400',
        connBadgeR: 12,
    } : {
        // Colori
        devFill:    'url(#dev-bg)', devBorder:'rgba(255,255,255,0.10)', devSep:'rgba(255,255,255,0.07)',
        devLabel:   null,
        rackFill:   '#1c2128',      rackStroke:'#8b949e',
        rackName:   '#c9d1d9',      rackCnt:   '#8b949e', rackBadge:'#30363d',
        connLine:   '#8b949e',      connBadge: '#30363d', connTxt:  '#c9d1d9',
        roomTxt:    'rgba(255,255,255,0.4)',
        connOp:'0.65', fanOp:'0.7', cableOp:'0.85',
        // Spessori originali
        connSW: 2,   cableSW: 2.5, fanSW: 1.5,
        devOutSW:2.5,devInSW: 1,   devSepSW: 1,
        rackSW: 1.5, rackInSW: 1,
        // Testo originale
        iconSz: 17,  iconW: '900',
        lblSz:  9,   lblW:  '700',
        rackNSz:8,   rackNW:'700',
        rackCSz:7,   rackCW:'400',
        connBadgeR: 9,
    };

    // Font Awesome via CDN — funziona quando SVG è aperto in browser
    // In pdfMode inutile (e il @import causa warning nel parser CSS di svg-to-pdfkit)
    const faStyle = pdf ? '' : `@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css');`;

    let s=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
         +` viewBox="${x0} ${y0} ${W} ${H}" width="${W}" height="${H}">`
         +`<defs>${faStyle?`<style>${faStyle}</style>`:''}`
         // Gradiente per box dispositivi: solo in screen mode
         +(pdf?'': `<linearGradient id="dev-bg" x1="0" y1="0" x2="0" y2="1">`
           +`<stop offset="59%" stop-color="#161b22"/><stop offset="59%" stop-color="#0d1117"/>`
           +`</linearGradient>`)
         +`</defs>`
         // In modalità PDF il rect di sfondo scuro viene omesso:
         // l'immagine è già disegnata da pdfkit sotto l'overlay SVG.
         +(pdf ? '' : `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${bgCol}"/>`);

    // --- Background map: dimensioni da naturalWidth/Height × scala ---
    // skipBgImage=true → l'immagine viene gestita esternamente (es. pdfkit doc.image())
    if(hasImg && !opts.skipBgImage){
        s+=`<image href="${state.bgImage}" x="0" y="0" width="${imgW}" height="${imgH}"`
          +` opacity="0.4" preserveAspectRatio="none"/>`;
    }

    // --- Strutture (stanze) ---
    floorNodes.filter(n=>TYPES[n.type]?.isStructural).forEach(n=>{
        const col=n.color||TYPES[n.type].defaultColor;
        const alpha=n.opacity !== undefined ? n.opacity : 1;
        const rw=n.w||200, rh=n.h||200;
        const fontSize=n.fontSize!==undefined ? n.fontSize : Math.max(10,Math.min(Math.min(rw,rh)*0.1,36));
        s+=`<rect x="${n.x}" y="${n.y}" width="${rw}" height="${rh}"`
          +` fill="${col}" fill-opacity="${alpha}" stroke="rgba(120,120,120,0.5)" stroke-width="2" rx="2"/>`;
        if(n.name&&n.type==='room'){
            s+=`<text x="${n.x+rw/2}" y="${n.y+rh/2}"`
              +` text-anchor="middle" dominant-baseline="middle"`
              +` font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="bold"`
              +` fill="${P.roomTxt}">${escapeHTML(n.name)}</text>`;
        }
    });

    // --- Connessioni rack↔rack (da state.links, filtrate per VLAN se attivo) ---
    const _svgRackPairs=new Map();
    for(const l of state.links){
        if(_filterVlan&&!_linkMatchesVlanFilter(l)) continue;
        const snId=getPortNodeId(l.src),dnId=getPortNodeId(l.dst);
        const sn=nodeById(snId),dn=nodeById(dnId);
        if(!sn||!dn||!TYPES[sn.type]?.isRack||!TYPES[dn.type]?.isRack) continue;
        if(sn.rackId===dn.rackId) continue;
        const rA=state.racks.find(r=>r.id===sn.rackId),rB=state.racks.find(r=>r.id===dn.rackId);
        if(!rA||!rB||rA.x===undefined||rB.x===undefined) continue;
        const sorted=[rA,rB].sort((a,b)=>a.id.localeCompare(b.id));
        const key=sorted.map(r=>r.id).join('|');
        if(!_svgRackPairs.has(key)) _svgRackPairs.set(key,{sx:sorted[0].x,sy:sorted[0].y,dx:sorted[1].x,dy:sorted[1].y,count:0});
        _svgRackPairs.get(key).count++;
    }
    for(const [,p] of _svgRackPairs){
        s+=`<line x1="${p.sx}" y1="${p.sy}" x2="${p.dx}" y2="${p.dy}"`
          +` stroke="${P.connLine}" stroke-width="${P.connSW}" stroke-dasharray="7,3" stroke-linecap="round" opacity="${P.connOp}"/>`;
        if(p.count>1){
            const mx=Math.round((p.sx+p.dx)/2),my=Math.round((p.sy+p.dy)/2);
            s+=`<circle cx="${mx}" cy="${my}" r="${P.connBadgeR}" fill="${P.connBadge}" stroke="${P.connLine}" stroke-width="${P.connSW/2}"/>`
              +`<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="middle"`
              +` font-family="system-ui,sans-serif" font-size="${P.rackCSz}" font-weight="${P.rackCW}" fill="${P.connTxt}">${p.count}</text>`;
        }
    }

    // --- Fanout rack→floor node (filtrate per VLAN se attivo) ---
    state.racks.filter(r=>r.x!==undefined).forEach(rack=>{
        const rLinks=_getRackFloorLinks(rack.id);
        for(const {link,floorNode} of rLinks){
            if(_filterVlan&&!_linkMatchesVlanFilter(link)) continue;
            // Colore = VLAN del link (come i cavi), con override manuale rispettato.
            const vl=_getLinkVlan(link);
            const col=link.colorOvr||state.vlanColors[vl]||'#6e7681';
            s+=`<line x1="${rack.x}" y1="${rack.y}" x2="${floorNode.x}" y2="${floorNode.y}"`
              +` stroke="${col}" stroke-width="${P.fanSW}" stroke-dasharray="4,3" stroke-linecap="round" opacity="${P.fanOp}"/>`;
        }
    });

    // --- Cavi floor→floor (con colore VLAN, filtrati se attivo) ---
    function floorPos(nid){
        const n=nodeById(nid); if(!n||!TYPES[n.type]?.isFloor) return null;
        return TYPES[n.type]?.isStructural?{x:n.x+(n.w||200)/2,y:n.y+(n.h||200)/2}:{x:n.x,y:n.y};
    }
    state.links.forEach(l=>{
        if(_filterVlan&&!_linkMatchesVlanFilter(l)) return;
        const sn=getNodeByPortId(l.src),dn=getNodeByPortId(l.dst);
        if(!sn||!dn||!TYPES[sn.type]?.isFloor||!TYPES[dn.type]?.isFloor) return;
        const p=floorPos(sn.id),q=floorPos(dn.id); if(!p||!q) return;
        const vl=_getLinkVlan(l);
        const col=l.colorOvr||state.vlanColors[vl]||'#6e7681';
        const cx=(p.x+q.x)/2;
        s+=`<path d="M${p.x},${p.y} C${cx},${p.y} ${cx},${q.y} ${q.x},${q.y}"`
          +` fill="none" stroke="${col}" stroke-width="${P.cableSW}" stroke-linecap="round" opacity="${P.cableOp}"/>`;
    });

    // --- Dispositivi floor (AP, wallport, webcam — filtrati per VLAN se attivo) ---
    floorNodes.filter(n=>!TYPES[n.type]?.isStructural).forEach(n=>{
        if(_filterVlan&&_floorNodeHiddenByVlan(n.id)) return;
        const def=TYPES[n.type]; if(!def) return;
        const col=_floorNodeColor(n.type);
        const devInfo=_SVG_DEV[n.type]||{ ab:(def.name||n.type).replace(/[^a-zA-Z]/g,'').substring(0,3).toUpperCase(), fa:null };
        const ab=devInfo.ab;
        const label=escapeHTML((typeof _dispName==='function'?_dispName(n.name):n.name)||_typeName(n.type));
        // LED stato porta principale
        const pid=`${n.id}-1`,pi=state.ports[pid]||{};
        const eff=pi.statusOvr??normalizeStatus(pi.status)??'inactive';
        // Colore stato: usato per bordo, icona e abbreviazione (nessun led separato)
        const statCol=eff==='active'?'#39d353':eff==='fault'?'#f85149':eff==='idle'?'#f5a623':'#6e7681';
        const faChar=devInfo.fa ? String.fromCodePoint(devInfo.fa) : null;
        const lblCol = P.devLabel || statCol;
        s+=`<g transform="translate(${n.x},${n.y})">`
          +`<title>${label}</title>`
          // Bordo esterno colore stato
          +`<rect x="-23" y="-28" width="46" height="56" rx="7" fill="none" stroke="${statCol}" stroke-width="${P.devOutSW}"/>`
          // Box interno
          +`<rect x="-22" y="-27" width="44" height="54" rx="6" fill="${P.devFill}" stroke="${P.devBorder}" stroke-width="${P.devInSW}"/>`
          // Separatore
          +`<line x1="-22" y1="5" x2="22" y2="5" stroke="${P.devSep}" stroke-width="${P.devSepSW}"/>`
          // Icona sezione superiore
          // Screen: glifo Font Awesome (se disponibile) o abbreviazione
          // PDF:    abbreviazione bold grande (font Helvetica garantito in PDF)
          +(pdf
            ? `<text x="0" y="-11" text-anchor="middle" dominant-baseline="middle"`
              +` font-family="system-ui,sans-serif" font-size="${P.iconSz}" font-weight="${P.iconW}" fill="${statCol}">${ab}</text>`
            : (faChar
               ? `<text x="0" y="-11" text-anchor="middle" dominant-baseline="middle"`
                 +` font-family="'Font Awesome 6 Free'" font-weight="900" font-size="${P.iconSz}" fill="${statCol}">${faChar}</text>`
               : `<text x="0" y="-11" text-anchor="middle" dominant-baseline="middle"`
                 +` font-family="system-ui,sans-serif" font-size="${P.iconSz}" font-weight="${P.iconW}" fill="${statCol}">${ab}</text>`)
          )
          // Label dispositivo sezione inferiore
          +`<text x="0" y="16" text-anchor="middle" dominant-baseline="middle"`
          +` font-family="system-ui,sans-serif" font-size="${P.lblSz}" font-weight="${P.lblW}" fill="${lblCol}">${label}</text>`
          +`</g>`;
    });

    // --- Icone rack sulla planimetria ---
    state.racks.filter(r=>r.x!==undefined).forEach(rack=>{
        const rName=escapeHTML(rack.name||rack.id);
        const devCount=state.nodes.filter(n=>TYPES[n.type]?.isRack&&n.rackId===rack.id).length;
        const innerBorderStroke = pdf ? '#d1d5db' : 'rgba(139,148,158,0.25)';
        s+=`<g transform="translate(${rack.x},${rack.y})">`
          +`<title>${rName}</title>`
          +`<rect x="-30" y="-22" width="60" height="44" rx="5" fill="${P.rackFill}" stroke="${P.rackStroke}" stroke-width="${P.rackSW}"/>`
          +`<rect x="-29" y="-21" width="58" height="42" rx="4" fill="none" stroke="${innerBorderStroke}" stroke-width="${P.rackInSW}"/>`
          +`<text x="0" y="-6" text-anchor="middle" dominant-baseline="middle"`
          +` font-family="${pdf?'system-ui,sans-serif':"'Font Awesome 6 Free'"}" font-weight="900" font-size="${pdf?P.rackNSz:14}" fill="${P.rackStroke}">${pdf?'RCK':String.fromCodePoint(0xf233)}</text>`
          +`<text x="0" y="9" text-anchor="middle" dominant-baseline="middle"`
          +` font-family="system-ui,sans-serif" font-size="${P.rackNSz}" font-weight="${P.rackNW}" fill="${P.rackName}">${rName}</text>`
          +(devCount>0
            ? `<text x="0" y="20" text-anchor="middle" dominant-baseline="middle"`
              +` font-family="system-ui,sans-serif" font-size="${P.rackCSz}" font-weight="${P.rackCW}" fill="${P.rackCnt}">${devCount} dev</text>`
            : '')
          +`</g>`;
    });

    s+=`</svg>`;
    return s;
}

function exportFloorSVG(){
    const s=_buildFloorSVG();
    const blob=new Blob([s],{type:'image/svg+xml;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='infranetpro-planimetria.svg'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
}

function _buildRackSVG(rackId, opts){
    opts = opts || {};
    const rack = state.racks.find(r=>r.id===rackId);
    if(!rack) return null;

    const rackSize = getRackSize(rackId);
    const U = opts.pdfMode ? 18 : 20;
    // A 42U rack is much taller than it is wide. Use a compact 19-inch-style
    // front proportion so PDF export does not look stretched horizontally.
    const top = 46, left = 42, railW = 14, chassisW = 340;
    const innerX = left + railW, innerW = chassisW - railW * 2;
    const rackH = rackSize * U;
    const W = left + chassisW + 24;
    const H = top + rackH + 30;
    const devs = state.nodes
        .filter(n=>n.rackId===rackId && TYPES[n.type]?.isRack)
        .sort((a,b)=>(b.rackU||0)-(a.rackU||0));
    // Tacca verticale sinistra del device = STATO SNMP (come la vista rack live:
    // .rack-device border-left, vedi app-render-core.js / manuale sez. 11). Prima
    // era colorata per TIPO di device → vecchia classificazione, rimossa.
    const stripeColor = dev => {
        const on = (typeof _hasSnmpIntegration === 'function') && _hasSnmpIntegration(dev);
        if(!on) return '#6e7681';                       // snmp-na  (SNMP non configurato)
        if(dev.snmpStatus === 'ok')  return '#39d353';  // snmp-ok  (ultimo poll riuscito)
        if(dev.snmpStatus === 'err') return '#f85149';  // snmp-err (ultimo poll fallito)
        return '#d29922';                               // snmp-pending (configurato, non confermato)
    };
    // Colori LED identici alla vista rack dell'app (variabili CSS :root)
    const statusColor = st => ({
        active:'#39d353', fault:'#f85149', idle:'#f5a623', inactive:'#6e7681',
    })[normalizeStatus(st)] || '#6e7681';
    const safe = v => escapeHTML(String(v ?? ''));
    const portName = pid => {
        const pi = state.ports[pid] || {};
        return pi.ifName || pi.alias || pi.desc || pid.split('-').slice(1).join('-');
    };
    const portLag = pid => {
        const pi = state.ports[pid] || {};
        if(pi.lagGroup) return pi.lagGroup;
        const lid = parseInt(pi.lagId || 0, 10);
        return lid > 0 ? `snmp-lag-${getPortNodeId(pid)}-${lid}` : '';
    };
    const fitRackLabel = (text, maxChars) => {
        const s = String(text || '');
        return s.length > maxChars ? `${s.substring(0, Math.max(1, maxChars - 3))}...` : s;
    };
    // Disegna un blocco laterale (SFP o MGMT) come grid 2-righe stile rack view.
    // pids: lista di {pid,label}; borderColor: bordo cella (ciano/salmone).
    // Il blocco ha titolo opzionale sotto. Ritorna l'SVG generato.
    const drawSideBlock = (cells, bx, by, bw, bh, borderColor, blockTitle) => {
        if(!cells.length) return '';
        const cols = Math.ceil(cells.length / 2);
        const cellW = 7, cellH = 4.4, colGap = 1.4, rowGap = 1.4;
        const gridW = cols * cellW + (cols - 1) * colGap;
        const titleFs = 4.2;
        const gridH = 2 * cellH + rowGap;
        const totalH = blockTitle ? gridH + 1.4 + titleFs : gridH;
        // Centra il blocco verticalmente nello spazio assegnato
        const gridX = bx + (bw - gridW) / 2;
        const gridY = by + (bh - totalH) / 2;
        let out = '';
        cells.forEach((c, idx) => {
            const col = Math.floor(idx / 2), row = idx % 2;
            const cx = gridX + col * (cellW + colGap);
            const cy = gridY + row * (cellH + rowGap);
            const pi = state.ports[c.pid] || {};
            const fillTone = pi.statusOvr || pi.status ? statusColor(pi.statusOvr ?? pi.status) : 'transparent';
            out += `<g><title>${safe(c.tip)}</title>`
                +`<rect x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" width="${cellW}" height="${cellH}" rx="0.6" fill="${fillTone === 'transparent' ? 'none' : fillTone}" fill-opacity="${fillTone === 'transparent' ? 0 : 0.4}" stroke="${borderColor}" stroke-width="0.7"/>`
                +`</g>`;
        });
        if(blockTitle){
            const titleY = gridY + gridH + 1.4 + titleFs * 0.85;
            out += `<text x="${(gridX + gridW/2).toFixed(2)}" y="${titleY.toFixed(2)}" text-anchor="middle" font-family="monospace" font-size="${titleFs}" font-weight="700" fill="${borderColor}">${safe(blockTitle)}</text>`;
        }
        return out;
    };

    const drawPorts = (dev, x, y, w, h) => {
        const pcTotal = dev.ports !== undefined ? dev.ports : (TYPES[dev.type]?.ports || 0);
        const fp = dev.frontPanel || {};
        const sfpCount = fp.separateSfp ? Math.max(0, Math.min(parseInt(fp.sfpCount,10)||0, pcTotal)) : 0;
        const sfpRight = fp.sfpRight !== false;
        const mgmtEligible = !!(TYPES[dev.type] && TYPES[dev.type].mgmtEligible);
        const mgmtCount = mgmtEligible ? Math.max(0, Math.min(parseInt(fp.mgmtCount,10)||0, 4)) : 0;
        const mgmtPos = fp.mgmtPosition === 'right' ? 'right' : 'left';
        const mgmtLabel = (typeof fp.mgmtLabel === 'string' && fp.mgmtLabel.trim()) ? fp.mgmtLabel.trim() : 'MGMT';
        const pc = Math.max(0, pcTotal - sfpCount); // solo data ports nel grid principale
        // Allocazioni laterali per i blocchi SFP/MGMT (larghezza in user units)
        const sideBlockW = (cells) => cells > 0 ? (Math.ceil(cells/2) * 7 + (Math.ceil(cells/2)-1) * 1.4 + 4) : 0;
        const sfpBlockW = sideBlockW(sfpCount);
        const mgmtBlockW = sideBlockW(mgmtCount);
        let leftAlloc = 0, rightAlloc = 0;
        if(mgmtCount > 0 && mgmtPos === 'left')  leftAlloc  += mgmtBlockW + 2;
        if(mgmtCount > 0 && mgmtPos === 'right') rightAlloc += mgmtBlockW + 2;
        if(sfpCount  > 0 && !sfpRight)           leftAlloc  += sfpBlockW + 2;
        if(sfpCount  > 0 &&  sfpRight)           rightAlloc += sfpBlockW + 2;
        // Genera blocchi laterali (SFP indici N-sfpCount+1..N, MGMT pids -mgmt1..-mgmtN)
        let sideSvg = '';
        const buildSfpCells = () => Array.from({length:sfpCount}, (_, k)=>{
            const i = pcTotal - sfpCount + k + 1;
            return { pid:`${dev.id}-${i}`, tip:`${portName(`${dev.id}-${i}`)} (SFP ${i})`, label:String(i) };
        });
        const buildMgmtCells = () => Array.from({length:mgmtCount}, (_, k)=>{
            const i = k + 1;
            const lbl = mgmtCount === 1 ? mgmtLabel : `${mgmtLabel}${i}`;
            return { pid:`${dev.id}-mgmt${i}`, tip:lbl, label:String(i) };
        });
        // Posizionamento orizzontale: [MGMT-left?] [SFP-left?] [data] [SFP-right?] [MGMT-right?]
        let cursor = x;
        if(mgmtCount > 0 && mgmtPos === 'left'){
            sideSvg += drawSideBlock(buildMgmtCells(), cursor, y, mgmtBlockW, h, '#00d4ff', mgmtLabel);
            cursor += mgmtBlockW + 2;
        }
        if(sfpCount > 0 && !sfpRight){
            sideSvg += drawSideBlock(buildSfpCells(), cursor, y, sfpBlockW, h, '#9aa5b1', null);
            cursor += sfpBlockW + 2;
        }
        // Cursor right side (start from far right going inward)
        let rcursor = x + w;
        if(mgmtCount > 0 && mgmtPos === 'right'){
            rcursor -= mgmtBlockW;
            sideSvg += drawSideBlock(buildMgmtCells(), rcursor, y, mgmtBlockW, h, '#00d4ff', mgmtLabel);
            rcursor -= 2;
        }
        if(sfpCount > 0 && sfpRight){
            rcursor -= sfpBlockW;
            sideSvg += drawSideBlock(buildSfpCells(), rcursor, y, sfpBlockW, h, '#9aa5b1', null);
            rcursor -= 2;
        }
        // Area data ports ridotta
        const dataX = x + leftAlloc;
        const dataW = w - leftAlloc - rightAlloc;
        if(!pc || dataW <= 0) return sideSvg;
        const isVisible = i => !((state.ports[`${dev.id}-${i}`] || {}).hidden);
        let anyVisible = false;
        for(let i=1;i<=pc;i++){ if(isVisible(i)){ anyVisible = true; break; } }
        if(!anyVisible) return sideSvg;
        // Sostituiamo (x, w) con (dataX, dataW) per il loop dei data ports
        x = dataX; w = dataW;

        // Disegna un singolo LED con il numero porta DENTRO il riquadro (centrato).
        // Inserire il numero dentro libera lo spazio verticale che prima serviva
        // sotto al LED, permettendo di ingrandire le porte.
        // LAG: dimensione e bordo IDENTICI alle altre porte — cambia solo il colore.
        const drawUnit = (i, cx, ledCenterY, pSize) => {
            if(!isVisible(i)) return '';
            const pid = `${dev.id}-${i}`;
            const pi = state.ports[pid] || {};
            const st = normalizeStatus(pi.statusOvr ?? pi.status);
            const vlan = _effPortVlan(pid);
            const lag = portLag(pid);
            const ledFill = lag ? '#00d4ff' : statusColor(st);
            const px = cx - pSize / 2, py = ledCenterY - pSize / 2;
            let g = `<g><title>${safe(portName(pid))} - VLAN ${safe(vlan)}${lag ? ' - LAG' : ''}</title>`
                +`<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pSize.toFixed(1)}" height="${pSize.toFixed(1)}" rx="1.2" fill="${ledFill}" stroke="#334155" stroke-width="0.55"/>`;
            // Numero dentro il LED: font proporzionale (più stretto per 2 cifre),
            // colore scuro per contrasto sui LED colorati. Nascosto se il LED è
            // troppo piccolo per contenerlo in modo leggibile.
            const digits = String(i).length;
            const numFs = pSize * (digits >= 2 ? 0.52 : 0.64);
            if(pSize >= 3.6){
                g += `<text x="${cx.toFixed(1)}" y="${(ledCenterY + numFs * 0.36).toFixed(1)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="${numFs.toFixed(1)}" fill="#0d1117">${i}</text>`;
            }
            return g + `</g>`;
        };

        const twoRows = pc > 24;
        let out = '';

        if(twoRows){
            // Stile Cisco/Aruba: una colonna per coppia (dispari sopra, pari sotto),
            // perfettamente ALLINEATE verticalmente (stessa cx per le due righe).
            // LED ingranditi: niente più numero esterno sotto le righe.
            const nCols = Math.ceil(pc / 2);
            // Altezza LED limitata a metà riga così le due file non si toccano.
            let pSize = Math.min(5.4, h * 0.42);
            const gapMin = 0.8, gapBreath = Math.min(3.5, pSize * 0.6);
            // Riduci il LED solo se non entra nemmeno col gap minimo.
            if(nCols * pSize + (nCols - 1) * gapMin > w)
                pSize = Math.max(2.8, (w - (nCols - 1) * gapMin) / nCols);
            // Gap ADATTIVO: distribuisce lo spazio libero tra le porte fino a
            // gapBreath → più respiro quando ci sono poche porte, compatto quando molte.
            const slack = nCols > 1 ? (w - nCols * pSize) / (nCols - 1) : 0;
            const gap = Math.max(gapMin, Math.min(gapBreath, slack));
            const colStep = pSize + gap;
            const total   = nCols * pSize + (nCols - 1) * gap;
            const startX  = x + Math.max(0, (w - total) / 2) + pSize / 2;
            const topLedY = y + h * 0.30;
            const botLedY = y + h * 0.70;
            for(let j=0;j<nCols;j++){
                const cx   = startX + j * colStep;
                const odd  = 2 * j + 1, even = 2 * j + 2;
                out += drawUnit(odd, cx, topLedY, pSize);
                if(even <= pc) out += drawUnit(even, cx, botLedY, pSize);
            }
        } else {
            // Riga singola: porte 1..N in sequenza, centrate. LED ingranditi e
            // centrati verticalmente (il numero è dentro, non serve spazio sotto).
            const visible = [];
            for(let i=1;i<=pc;i++) if(isVisible(i)) visible.push(i);
            const n = visible.length;
            // Non superare l'altezza utile della riga.
            let pSize = Math.min(7.2, h * 0.74);
            const gapMin = 1.4, gapBreath = Math.min(5.5, pSize * 0.7);
            // Riduci il LED solo se non entra nemmeno col gap minimo.
            if(n * pSize + (n - 1) * gapMin > w)
                pSize = Math.max(3.4, (w - (n - 1) * gapMin) / n);
            // Gap ADATTIVO: più respiro quando c'è spazio, compatto quando molte porte.
            const slack = n > 1 ? (w - n * pSize) / (n - 1) : 0;
            const gap = Math.max(gapMin, Math.min(gapBreath, slack));
            const colStep = pSize + gap;
            const total   = visible.length * pSize + (visible.length - 1) * gap;
            const startX  = x + Math.max(0, (w - total) / 2) + pSize / 2;
            const ledY    = y + h * 0.50;
            visible.forEach((i, k)=>{
                const cx = startX + k * colStep;
                out += drawUnit(i, cx, ledY, pSize);
            });
        }
        return sideSvg + out;
    };

    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
        +`<defs>`
        +`<linearGradient id="rack-metal" x1="0" y1="0" x2="0" y2="1">`
        +`<stop offset="0" stop-color="#4a4a4a"/><stop offset="0.54" stop-color="#303030"/><stop offset="1" stop-color="#202020"/>`
        +`</linearGradient>`
        +`<linearGradient id="rack-label-bg" x1="0" y1="0" x2="0" y2="1">`
        +`<stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#05070a"/>`
        +`</linearGradient>`
        +`</defs>`
        +`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`
        +`<text x="${left}" y="24" font-family="Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#0f172a">${safe(rack.name||rack.id)}</text>`
        +`<text x="${left}" y="38" font-family="Helvetica,Arial,sans-serif" font-size="8" fill="#64748b">${rackSize}U - ${devs.length} apparati</text>`
        +`<rect x="${left}" y="${top}" width="${chassisW}" height="${rackH}" rx="4" fill="#969696" stroke="#333333" stroke-width="2"/>`
        +`<rect x="${left}" y="${top}" width="${railW}" height="${rackH}" fill="#2a2a2a"/>`
        +`<rect x="${left+chassisW-railW}" y="${top}" width="${railW}" height="${rackH}" fill="#2a2a2a"/>`;

    // Numerazione coerente con la vista: se il rack ha uNumberFromTop il numero
    // stampato e' invertito (1 in alto) ma la posizione fisica dei device resta.
    const _fromTop = !!rack.uNumberFromTop;
    for(let u=1; u<=rackSize; u++){
        const y = top + (rackSize - u) * U;
        s += `<line x1="${innerX}" y1="${y}" x2="${innerX+innerW}" y2="${y}" stroke="#d1d5db" stroke-width="0.45"/>`;
        const uLabel = _fromTop ? (rackSize - u + 1) : u;
        s += `<text x="${left-6}" y="${y+U*0.68}" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="6" fill="#64748b">${uLabel}</text>`;
    }
    s += `<line x1="${innerX}" y1="${top+rackH}" x2="${innerX+innerW}" y2="${top+rackH}" stroke="#d1d5db" stroke-width="0.45"/>`;

    devs.forEach(dev=>{
        const def = TYPES[dev.type] || {};
        const sU = normalizeNumber(dev.sizeU ?? def.sizeU ?? 1, 1, 1, rackSize);
        const rackU = normalizeNumber(dev.rackU, 1, 1, Math.max(1, rackSize - sU + 1));
        const y = top + (rackSize - rackU - sU + 1) * U + 1;
        const h = Math.max(8, sU * U - 2);
        const fill = 'url(#rack-metal)';
        const stripe = stripeColor(dev);
        const rawLabel = String(dev.name || _typeName(dev.type));
        const brand = safe(dev.hostname || dev.brand || def.brand || '');
        const pc = dev.ports !== undefined ? dev.ports : (def.ports || 0);
        const labelW = 62;
        const labelX = innerX + innerW - labelW - 8;
        const labelH = Math.min(16, Math.max(10, h * 0.5));
        const labelY = y + h * 0.28;
        const showBrand = !!brand && pc > 0 && pc <= 8;
        const label = safe(fitRackLabel(rawLabel, labelW <= 62 ? 13 : 16));
        const portX = innerX + (showBrand ? 66 : 16);
        const portRight = labelX - 8;
        const portW = Math.max(40, portRight - portX);
        s += `<g>`
            +`<title>${label} - U${rackU}${sU>1 ? '-' + (rackU+sU-1) : ''}</title>`
            +`<rect x="${innerX}" y="${y}" width="${innerW}" height="${h}" rx="2" fill="${fill}" stroke="#111827" stroke-width="0.8"/>`
            +`<rect x="${innerX}" y="${y}" width="4" height="${h}" rx="1" fill="${stripe}"/>`;
        if(dev.type === 'cablemanager'){
            const fy = y + h * 0.38;
            // Passacavo orizzontale reso come pettine di anelli a "U" (fingers),
            // come i cable manager reali (foto di riferimento). Simmetrico e
            // INTERAMENTE dentro la cornice: gli arm partono da topY e la curva
            // arrotondata sta a botY (niente più sforo sotto come la vecchia "U").
            const _pad = 14, _mt = 3, _mb = 3, _fW = 14, _r = 3.5;
            const topY = y + _mt, botY = y + Math.max(_mt + 6, h - _mb);
            const fRegL = innerX + _pad;
            const fRegR = labelX - 10;                       // i fingers non invadono la targhetta
            const plateW = Math.max(8, (fRegR + 6) - (innerX + 10));
            // Piastra del pannello (corpo metallico) dietro gli anelli.
            s += `<rect x="${innerX+10}" y="${topY}" width="${plateW.toFixed(1)}" height="${Math.max(4,botY-topY).toFixed(1)}" rx="3" fill="#2b2f36" fill-opacity="0.7" stroke="#6b7280" stroke-opacity="0.4" stroke-width="0.7"/>`;
            const _cmN = 5;                                  // come la foto: 5 anelli
            const _span = Math.max(1, (fRegR - fRegL) - _fW);
            const _cmStep = _cmN > 1 ? _span / (_cmN - 1) : 0;
            for(let i=0;i<_cmN;i++){
                const fx = fRegL + i * _cmStep;
                // Anello a U: gambe verticali + base arrotondata, apertura in alto.
                s += `<path d="M${fx.toFixed(1)},${topY.toFixed(1)} V${(botY-_r).toFixed(1)} Q${fx.toFixed(1)},${botY.toFixed(1)} ${(fx+_r).toFixed(1)},${botY.toFixed(1)} H${(fx+_fW-_r).toFixed(1)} Q${(fx+_fW).toFixed(1)},${botY.toFixed(1)} ${(fx+_fW).toFixed(1)},${(botY-_r).toFixed(1)} V${topY.toFixed(1)}" fill="none" stroke="#0d1117" stroke-width="2.4" stroke-linejoin="round"/>`
                  +`<path d="M${(fx+1).toFixed(1)},${topY.toFixed(1)} V${(botY-_r-1).toFixed(1)}" fill="none" stroke="#9aa3ad" stroke-width="0.5" opacity="0.55"/>`;
            }
            s += `<rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" rx="2" fill="url(#rack-label-bg)" stroke="#333333" stroke-width="0.7"/>`
                +`<text x="${labelX+labelW/2}" y="${fy+2}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica,Arial,sans-serif" font-size="7" font-weight="700" fill="#f8fafc">${label}</text>`;
        } else {
            if(showBrand){
                s += `<text x="${innerX+14}" y="${y+h*0.58}" font-family="Helvetica,Arial,sans-serif" font-size="6" font-weight="700" fill="#d0d0d0">${brand}</text>`;
            }
            s += drawPorts(dev, portX, y + 1, portW, h - 2);
            s += `<rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" rx="2" fill="url(#rack-label-bg)" stroke="#333333" stroke-width="0.7"/>`
                +`<text x="${labelX+labelW/2}" y="${y+h*0.56}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica,Arial,sans-serif" font-size="7" font-weight="700" fill="#f8fafc">${label}</text>`;
        }
        s += `</g>`;
    });

    s += `</svg>`;
    return { rackId: rack.id, rackName: rack.name || rack.id, svg: s };
}

function _buildRackSvgs(){
    return (state.racks || [])
        .map(r=>_buildRackSVG(r.id, { pdfMode:true }))
        .filter(Boolean);
}

function _parseSvgSize(dataUri){
    try {
        const parts   = dataUri.split(',');
        const isB64   = parts[0].includes('base64');
        const raw     = isB64 ? atob(parts.slice(1).join(','))
                               : decodeURIComponent(parts.slice(1).join(','));
        // width / height espliciti (solo valori numerici, non percentuali)
        const wM = raw.match(/<svg[^>]*\swidth="([\d.]+)(?:px)?"/i);
        const hM = raw.match(/<svg[^>]*\sheight="([\d.]+)(?:px)?"/i);
        let w = wM ? parseFloat(wM[1]) : 0;
        let h = hM ? parseFloat(hM[1]) : 0;
        // Fallback a viewBox se width/height mancanti o sono percentuali
        if (!w || !h) {
            const vb = raw.match(/viewBox="([^"]+)"/i);
            if (vb) {
                const p = vb[1].trim().split(/[\s,]+/).map(Number);
                if (!w) w = p[2] || 0;
                if (!h) h = p[3] || 0;
            }
        }
        return { w, h };
    } catch (_) { return { w:0, h:0 }; }
}

async function _imgToPng(srcDataUri, naturalW, naturalH, scale){
    return new Promise(resolve=>{
        try {
            const img=new Image();
            img.onload=()=>{
                const w=Math.round(naturalW*scale);
                const h=Math.round(naturalH*scale);
                const c=document.createElement('canvas');
                c.width=w; c.height=h;
                const ctx=c.getContext('2d');
                // Sfondo bianco trasparente (preserva alpha se presente)
                ctx.clearRect(0,0,w,h);
                ctx.drawImage(img,0,0,w,h);
                resolve({ dataUri: c.toDataURL('image/png'), w, h });
            };
            img.onerror=()=>resolve(null);
            img.src=srcDataUri;
        } catch(_){ resolve(null); }
    });
}

function _buildPdfReportData() {
    // ── Pagina 2: Inventario Cavi ──────────────────────────────────────────
    const cables = state.links.map(l => {
        const sn = getNodeByPortId(l.src), dn = getNodeByPortId(l.dst);
        const sp = l.src.split('-').slice(1).join('-');
        const dp = l.dst.split('-').slice(1).join('-');
        const vl = _getLinkVlan(l);
        return {
            label:    (l.label || _cableAutoLabel(l)).replace(/→/g, '->'),
            from:     `${(typeof _dispName==='function'?_dispName(sn?.name||'?'):(sn?.name||'?'))} P${sp}`,
            to:       `${(typeof _dispName==='function'?_dispName(dn?.name||'?'):(dn?.name||'?'))} P${dp}`,
            vlan:     vl > 1 ? vl : null,
            vlanName: vl > 1 ? (state.vlanNames?.[vl] || '') : '',
            cableType:l.cableType || '',
            medium:   l.medium   || '',
            length:   l.lengthM != null ? String(l.lengthM) : (l.length != null ? String(l.length) : ''),
            category: l.cableCategory || l.category || '',
            color:    l.color || l.colorOvr || '',
            installedAt: l.installedAt || '',
            installedBy: l.installedBy || '',
            isPermanent: !!l.isPermanent,
            notes:    l.notes || '',
        };
    });

    // ── Pagina 3: Tracciato As-Built ──────────────────────────────────────
    const asBuilt = [];
    const usedLinks = new Set();
    state.nodes
        .filter(n => TYPES[n.type]?.isFloor && !TYPES[n.type]?.isStructural)
        .forEach(fn => {
            const pc = fn.ports !== undefined ? fn.ports : (TYPES[fn.type]?.ports || 1);
            for (let i = 1; i <= pc; i++) {
                const startPid = `${fn.id}-${i}`;
                if (!_linksForPort(startPid).length) continue;
                const steps = [`${fn.name || _typeName(fn.type)} P${i}`];
                let cur = startPid;
                const vis = new Set([startPid]);
                for (let h = 0; h < 12; h++) {
                    const lnk = _linksForPort(cur).find(l => !usedLinks.has(l.id));
                    if (!lnk) break;
                    usedLinks.add(lnk.id);
                    const nxt = lnk.src === cur ? lnk.dst : lnk.src;
                    if (vis.has(nxt)) break;
                    vis.add(nxt);
                    const nn = getNodeByPortId(nxt); if (!nn) break;
                    steps.push(`${nn.name || _typeName(nn.type)} P${nxt.split('-').slice(1).join('-')}`);
                    if (TYPES[nn.type]?.isActive) break;
                    cur = nxt;
                }
                if (steps.length > 1) {
                    const vl = _effPortVlan(startPid);
                    asBuilt.push({ steps, vlan: vl > 1 ? _vlanLabel(vl) : '', medium: '' });
                }
            }
        });

    // ── Pagina 4: Assegnazione porte ──────────────────────────────────────
    const portAssignment = [];
    state.racks.forEach(rack => {
        const devs = state.nodes
            .filter(n => n.rackId === rack.id && TYPES[n.type]?.isRack)
            .sort((a, b) => (b.rackU || 0) - (a.rackU || 0));
        devs.forEach(dev => {
            const pc = dev.ports !== undefined ? dev.ports : (TYPES[dev.type]?.ports || 0);
            // Le porte MGMT esistono anche con pc=0: non uscire subito.
            const fp = dev.frontPanel || {};
            const mgmtEligible = !!(TYPES[dev.type] && TYPES[dev.type].mgmtEligible);
            const mgmtCount = mgmtEligible ? Math.max(0, Math.min(parseInt(fp.mgmtCount,10)||0, 4)) : 0;
            const mgmtLabel = (typeof fp.mgmtLabel === 'string' && fp.mgmtLabel.trim()) ? fp.mgmtLabel.trim() : 'MGMT';
            if (!pc && !mgmtCount) return;
            const ports = [];
            const buildRow = (pid, num, alias) => {
                const pi = state.ports[pid] || {};
                if(pi.hidden) return null;
                const lks = _linksForPort(pid);
                const connTo = lks.map(l => {
                    const op = l.src === pid ? l.dst : l.src;
                    const on = getNodeByPortId(op);
                    return `${on?.name || '?'} P${op.split('-').slice(1).join('-')}`;
                }).join(', ') || '—';
                const st = normalizeStatus(pi.statusOvr ?? pi.status);
                const spd = pi.speedOvr ?? pi.speed;
                let spdStr = '';
                if(typeof spd === 'number' && Number.isFinite(spd) && spd > 0){
                    spdStr = spd >= 1000 ? `${(spd / 1000).toFixed(spd % 1000 ? 1 : 0)}G` : `${spd}M`;
                } else if(typeof spd === 'string' && spd.trim()){
                    spdStr = spd.trim();
                }
                const vl = _effPortVlan(pid);
                return { num, alias: alias || pi.desc || pi.alias || pi.ifName || '',
                         status: st, speed: spdStr,
                         vlan: vl > 1 ? _vlanLabel(vl) : '', connectedTo: connTo };
            };
            // Data ports (1..pc)
            for(let i = 1; i <= pc; i++){
                const row = buildRow(`${dev.id}-${i}`, i);
                if(row) ports.push(row);
            }
            // Porte MGMT (-mgmt1..-mgmtN): aggiunte dopo le data, con num=etichetta
            for(let i = 1; i <= mgmtCount; i++){
                const cellName = mgmtCount === 1 ? mgmtLabel : `${mgmtLabel}${i}`;
                const row = buildRow(`${dev.id}-mgmt${i}`, cellName, cellName);
                if(row) ports.push(row);
            }
            if (ports.length) portAssignment.push({
                rack: rack.name || rack.id, device: dev.name || dev.type,
                type: _typeName(dev.type), ports
            });
        });
    });

    // ── Pagina 5: Sommario VLAN ───────────────────────────────────────────
    // Trunk del sommario: usa la membership DERIVATA (_getLinkTrunk), la stessa
    // single-source-of-truth della vista live. I trunk normali sono ancorati allo
    // switchport e setLinkMode CANCELLA l.mode dal cavo (manual-first): leggere il
    // grezzo l.mode mostrerebbe SOLO i vecchi override legacy su run di soli
    // passivi → il sommario PDF restava quasi sempre vuoto. Si limita agli uplink
    // reali (almeno un capo è un device attivo) per non elencare gli hop passivi
    // interni al run (presa↔patch). Precalcolato una volta, non per-VLAN.
    const trunkUplinks = state.links.map(l => {
        const t = (typeof _getLinkTrunk === 'function')
            ? _getLinkTrunk(l)
            : { mode: l.mode, vlans: _parseTrunkVlans(l.trunkVlans || '') };
        if (!t || t.mode !== 'trunk') return null;
        const sn = getNodeByPortId(l.src), dn = getNodeByPortId(l.dst);
        if (!(TYPES[sn?.type]?.isActive || TYPES[dn?.type]?.isActive)) return null;
        return { l, sn, dn, vlans: (t.vlans || []).map(Number) };
    }).filter(Boolean);

    const vlans = Object.keys(state.vlanColors).sort((a, b) => +a - +b).map(vid => {
        const v = +vid;
        const byDevice = {}, trunkLinks = [];

        for (const [pid] of Object.entries(state.ports)) {
            if (_effPortVlan(pid) !== v) continue;
            const n = getNodeByPortId(pid);
            if (!n) continue;
            const def = TYPES[n.type];
            // Escludi dispositivi passivi (patch panel, passacavo, presa a muro, ecc.)
            // e strutturali (stanze): non generano VLAN proprie
            if (def?.isPassive || def?.isStructural) continue;
            const devName = n.name || n.hostname || def?.name || n.type;
            const portNum = parseInt(pid.split('-').pop(), 10) || 0;
            if (!byDevice[devName]) byDevice[devName] = [];
            byDevice[devName].push(portNum);
        }

        // Ordina dispositivi alfabeticamente, porte numericamente
        const accessGroups = Object.entries(byDevice)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([device, ports]) => ({ device, ports: [...ports].sort((a, b) => a - b) }));

        for (const tu of trunkUplinks) {
            if (!tu.vlans.includes(v)) continue;
            const srcPort = parseInt(tu.l.src.split('-').pop(), 10) || 0;
            const dstPort = parseInt(tu.l.dst.split('-').pop(), 10) || 0;
            trunkLinks.push({
                src:      (typeof _dispName==='function'?_dispName(tu.sn?.name||'?'):(tu.sn?.name||'?')),
                srcPort,
                dst:      (typeof _dispName==='function'?_dispName(tu.dn?.name||'?'):(tu.dn?.name||'?')),
                dstPort,
                vlans:    tu.vlans.join(', ')
            });
        }

        // Ordina trunk per device sorgente, poi per numero porta
        trunkLinks.sort((a, b) => a.src.localeCompare(b.src) || a.srcPort - b.srcPort);

        const totalAccess = accessGroups.reduce((s, g) => s + g.ports.length, 0);
        // IPAM (da tabella VLAN): range IP (subnet), gateway di default, DNS.
        const ipam = (state.ipam?.vlans?.[vid] || state.ipam?.vlans?.[v]) || {};
        return { id: v, name: state.vlanNames?.[v] || '', color: state.vlanColors[vid],
                 subnet: String(ipam.subnet || '').trim(),
                 gateway: String(ipam.gateway || '').trim(),
                 dns: String(ipam.dns || '').trim(),
                 accessGroups, totalAccess, trunkLinks };
    });

    // ── Pagina 6: Topologia SVG ───────────────────────────────────────────
    let topoSvg = null;
    if (_topoData) {
        const wasTopo = _topoVisible;
        _topoVisible  = true;
        topoSvg = _buildFloorSVG({ skipBgImage: true, pdfMode: true });
        _topoVisible  = wasTopo;
    }

    const rackSvgs = _buildRackSvgs();

    // ── Dossier di consegna (N4): copertina + note + changelog ────────────
    // Sezioni opzionali assemblate dalla logica pura buildHandoffSections.
    let handoff = null;
    if (typeof buildHandoffSections === 'function') {
        const _vs = new Set();
        for (const pid in state.ports) { const v = state.ports[pid]?.vlan; if (v && v > 1) _vs.add(v); }
        for (const l of state.links) { const v = _getLinkVlan(l); if (v > 1) _vs.add(v); }
        const _lg = (typeof getLang === 'function' ? getLang() : 'it');
        handoff = buildHandoffSections({
            title: (_lg === 'en' ? 'Handover dossier' : 'Dossier di consegna'),
            project: document.getElementById('header-proj-name')?.textContent?.trim() || 'InfraNet Pro',
            date: new Date().toLocaleDateString(_lg === 'en' ? 'en-GB' : 'it-IT'),
            user: (typeof _currentUser === 'object' && _currentUser && _currentUser.username) || '',
            devices: state.nodes.map(n => ({
                name: getNodeDisplayName(n) || n.name || n.id,
                typeLabel: _typeName(n.type),
                notes: n.notes || '',
                structural: !!TYPES[n.type]?.isStructural,
            })),
            cableCount: state.links.length,
            vlanCount: _vs.size,
            auditLog: state.auditLog || [],
            changelogLimit: 50,
        });
    }

    // Porte libere (capacità): report opzionale nel Dossier (pagina A4 server-side).
    let spare = null;
    if (typeof buildSpareReport === 'function' && typeof _spareBuildDevices === 'function') {
        try { spare = buildSpareReport(_spareBuildDevices()); } catch (_) {}
    }

    return { cables, asBuilt, portAssignment, vlans, rackSvgs, topoSvg, handoff, spare };
}

async function exportPDF(opts={}){
    const options={ ...PDF_EXPORT_DEFAULTS, ...(opts||{}) };
    const btn=document.getElementById('btn-export-pdf');
    const origHtml=btn?.innerHTML||'';
    try {
        if(btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>'; }

        const projName=document.getElementById('header-proj-name')?.textContent?.trim()||'InfraNet Pro';

        // Invia il bgImage separatamente: svg-to-pdfkit non gestisce i data URI
        // nei tag <image>; pdfkit aggiunge l'immagine via doc.image() nativo.
        // Convertiamo sempre in PNG perché pdfkit accetta solo JPEG e PNG.
        const bgEl=document.getElementById('floor-bg-img');
        const bsc=state.bgImageScale||1;
        const mime=state.bgImage
            ? (state.bgImage.split(';')[0].split(':')[1]||'').toLowerCase() : '';
        const isSvgBg = mime==='image/svg+xml';

        // naturalWidth è 0 in Chrome per SVG senza width/height espliciti:
        // in quel caso leggiamo le dimensioni direttamente dall'XML del SVG.
        let natW = bgEl ? bgEl.naturalWidth  : 0;
        let natH = bgEl ? bgEl.naturalHeight : 0;
        if(isSvgBg && (!natW||!natH)){
            const parsed=_parseSvgSize(state.bgImage);
            natW = parsed.w || natW || 800;
            natH = parsed.h || natH || 600;
        }
        const hasImg = !!state.bgImage && (isSvgBg ? true : natW>0);

        const payload={
            svg:         _buildFloorSVG({ skipBgImage: true, pdfMode: true }),
            projectName: projName,
            // projectId: il server carica il progetto per costruire il registro asset
            // (riuso nodeToDevice) e leggere project.updated_at ("ultima revisione").
            // currentProjectId e' un globale del ponte (store proxy → window).
            projectId:   (typeof currentProjectId !== 'undefined' ? currentProjectId : null),
            // lang: il server localizza il testo del report (it/en) sulla lingua UI corrente.
            lang:        (typeof getLang === 'function' ? getLang() : 'it'),
            reportData:  _buildPdfReportData(),
            reportOptions: options,
        };
        if(hasImg && options.includeBackground){
            if(isSvgBg){
                // SVG vettoriale: inviato direttamente, il server usa SVGtoPDF
                payload.bgImage     = state.bgImage;
                payload.bgImageW    = Math.round(natW * bsc);
                payload.bgImageH    = Math.round(natH * bsc);
                payload.bgImageType = 'svg';
            } else {
                // Raster (PNG/JPEG/WebP/BMP/…): normalizza in PNG per pdfkit
                const png=await _imgToPng(state.bgImage, natW, natH, bsc);
                if(png){
                    payload.bgImage     = png.dataUri;
                    payload.bgImageW    = png.w;
                    payload.bgImageH    = png.h;
                    payload.bgImageType = 'raster';
                }
            }
        }

        const resp=await fetch('/api/export-pdf',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
        });

        if(!resp.ok){
            let msg='Errore server';
            try{ const j=await resp.json(); msg=j.error||msg; }catch(_){}
            throw new Error(msg);
        }

        const blob=await resp.blob();
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;
        a.download=`${(projName||'infranetpro').replace(/[^a-z0-9_\- ]/gi,'_')}-${options._dossier?'dossier':'report'}.pdf`;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(url),5000);
    } catch(err){
        alert('Esportazione PDF fallita:\n'+err.message);
    } finally {
        if(btn){ btn.disabled=false; btn.innerHTML=origHtml; }
    }
}

// Dossier di consegna (N4): preset "un click" — tutte le sezioni + copertina
// + note + storia modifiche. Riusa interamente exportPDF.
function exportDossier(){
    return exportPDF({
        includePlanimetria:true, includeBackground:true,
        includeInventory:true, includeAsBuilt:true, includeRacks:true,
        includePorts:true, includeVlans:true, includeTopology:true,
        includeCover:true, includeNotes:true, includeChangelog:true,
        includeSpare:true, includeAssets:true,
        _dossier:true,
    });
}

window.exportJSON = exportJSON;
window.exportLabelsCSV = exportLabelsCSV;
window.openLabelExportOptions = openLabelExportOptions;
window.closeLabelExportOptions = closeLabelExportOptions;
window.syncLabelExportUi = syncLabelExportUi;
window.confirmLabelExport = confirmLabelExport;
window.openPdfExportOptions = openPdfExportOptions;
window.closePdfExportOptions = closePdfExportOptions;
window.setPdfExportAll = setPdfExportAll;
window.syncPdfExportUi = syncPdfExportUi;
window.confirmPdfExport = confirmPdfExport;
window.exportFloorSVG = exportFloorSVG;
window.exportPDF = exportPDF;
window.exportDossier = exportDossier;

// Hook di debug/test: espone i builder puri interni all'IIFE (SVG floor/rack e
// dati del report PDF) così che lo smoke E2E possa esercitarli con uno stato
// realistico senza un browser/PDF reale. Stessa convenzione di drivers/snmp.js
// (`_internals`). NON usato dal codice di produzione — solo dai test.
window._exportInternals = {
    _buildFloorSVG, _buildRackSVG, _buildRackSvgs, _buildPdfReportData,
    _cableLabelRows, _nodeRoomName, _csvColumnsFor, _parseSvgSize, _genericGridFromUi,
};
})();
