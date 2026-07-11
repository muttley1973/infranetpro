// ============================================================
// SPARE PORTS — orchestratore + UI (capacità libera / porte disponibili)
//                                              [modulo ESM, ex lib/app-spare.js]
// ============================================================
// Collega lo state al modulo puro lib/spare-ports.js: costruisce la lista
// device→porte "collegabili" (access + SFP, mgmt/hidden escluse), calcola il
// report e lo presenta in DUE modi (decisi con l'utente):
//   - TOGGLE visuale nel rack: evidenzia le porte libere (verde) / sospette
//     (giallo = libere sulla carta ma SNMP le vede attive), attenua le occupate;
//   - REPORT overlay (stile Drift) per rack→device + totali + export CSV.
// Sola lettura, manual-first: non modifica nulla, mostra soltanto.
//
// Dipendenze (tutte dal ponte — buildSpareReport e t sono lib <script>, vedi
// _bridge.js: NON importarli da ../lib o esbuild li ri-bundla):
//   • dal ponte:      buildSpareReport (spare-ports) · t (i18n)
//   • legacy (win.*): state, TYPES, _isLeafEndpoint, _frontPanelSfpGroups,
//                     _linksForPort, getNodeDisplayName, escapeHTML
import { expose, t, buildSpareReport } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { getNodeDisplayName, _linksForPort } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { TYPES, _frontPanelSfpGroups } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _isLeafEndpoint } from './app-autolink.js';   // ritiro ponte: funzioni nucleo/tipi/autolink (ex win.*)

// store._spareActive su window: lo legge BARE (guarded) app-render-core nel hook
// post-render _renderAllNow; module-local resterebbe nascosto nell'IIFE del
// bundle → highlight porte-libere non più riapplicato dopo un renderAll.
store._spareActive = store._spareActive || false;     // toggle highlight nel rack attivo?
let _spareReport = null;      // ultimo report calcolato

// ── Glue: costruisce i device con le porte collegabili ───────────────
function _spareBuildDevices(){
    const out = [];
    const rackName = id => { const r = (store.state.racks||[]).find(x => x.id === id); return r ? (r.name || id) : id; };
    for(const n of (store.state.nodes || [])){
        // Solo infrastruttura con porte (switch/router/firewall/patch panel…),
        // NON gli endpoint (un PC/AP non e' "capacita' libera" per nuovi device).
        if(_isLeafEndpoint(n.type)) continue;
        const pc = (n.ports !== undefined) ? n.ports : (TYPES[n.type]?.ports || 0);
        if(!pc) continue;
        // Indici porta che sono SFP/uplink (il resto e' access). mgmt sta fuori da 1..pc.
        const sfpSet = new Set();
        for(const g of _frontPanelSfpGroups(n, pc)) for(const p of (g.ports||[])) sfpSet.add(p);
        const responded = n.snmpStatus === 'ok';
        const ports = [];
        for(let i = 1; i <= pc; i++){
            const pid = `${n.id}-${i}`;
            const pi = store.state.ports[pid] || {};
            if(pi.hidden) continue;                                   // porte nascoste: non sono "spare"
            const cabled = _linksForPort(pid).length > 0;
            const activeSnmp = responded && (pi.status === 'active');  // cross-check realtà↔doc
            ports.push({ pid, kind: sfpSet.has(i) ? 'sfp' : 'access', cabled, activeSnmp });
        }
        if(ports.length) out.push({ id: n.id, name: getNodeDisplayName(n) || n.name || n.id, rackId: n.rackId || null, rackName: rackName(n.rackId), ports });
    }
    return out;
}

function _spareCompute(){ _spareReport = buildSpareReport(_spareBuildDevices()); return _spareReport; }

// ── Toggle highlight nel rack (decoupled: pass post-render sui data-pid) ──
function _spareClearHighlight(){
    document.querySelectorAll('.port-led.spare-free, .port-led.spare-suspect')
        .forEach(el => el.classList.remove('spare-free', 'spare-suspect'));
    document.body.classList.remove('spare-mode');
}
// Riapplica le classi alle porte libere/sospette. Chiamato dal toggle e dopo
// ogni render (hook in _renderAllNow) finche' store._spareActive.
export function _applySpareHighlight(){
    if(!store._spareActive){ _spareClearHighlight(); return; }
    const rep = _spareCompute();
    const free = new Set(rep.freePids), susp = new Set(rep.suspectPids);
    document.body.classList.add('spare-mode');
    document.querySelectorAll('.port-led[data-pid]').forEach(el => {
        const pid = el.getAttribute('data-pid');
        el.classList.remove('spare-free', 'spare-suspect');
        if(susp.has(pid)) el.classList.add('spare-suspect');
        else if(free.has(pid)) el.classList.add('spare-free');
    });
}
function setSpareHighlight(on){
    store._spareActive = !!on;
    _applySpareHighlight();
    const tgl = document.getElementById('spare-hl-toggle');
    if(tgl) tgl.classList.toggle('active', store._spareActive);
    // Pillola-attiva in toolbar (pattern del filtro VLAN): compare mentre
    // l'evidenziazione e' accesa ed e' la via d'uscita (×), dato che la voce
    // "Porte libere" ora vive nel menu Report e non c'e' piu' un pulsante acceso.
    const pill = document.getElementById('spare-active-badge');
    if(pill) pill.style.display = store._spareActive ? 'inline-flex' : 'none';
}
function toggleSpareHighlight(){ setSpareHighlight(!store._spareActive); }

// ── Report overlay (stile Drift) ─────────────────────────────────────
function _spareEnsureOverlay(){
    let ov = document.getElementById('spare-overlay');
    if(!ov){
        ov = document.createElement('div');
        ov.id = 'spare-overlay';
        ov.className = 'drift-overlay';   // riusa il guscio modale del Drift
        const _ttl = t('report.spareTitle');
        const _cls = t('common.close');
        ov.innerHTML = `<div class="drift-modal"><div class="drift-head"><span><i class="fas fa-plug-circle-plus"></i> <span id="spare-title">${_ttl}</span></span><button class="toolbar-btn" onclick="_closeSpareReport()" data-tip="${_cls}"><i class="fas fa-times"></i></button></div><div class="drift-body" id="spare-body"></div></div>`;
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeSpareReport(); });
    }
    return ov;
}
function _closeSpareReport(){ const ov = document.getElementById('spare-overlay'); if(ov) ov.style.display = 'none'; }

function _spareCapChip(d){
    const sfp = d.freeSfp ? ` · <b>${d.freeSfp}</b> SFP` : '';
    const susp = d.suspect ? ` <span class="spare-susp-pill" data-tip="${t('spare.suspectTip')}">⚠ ${d.suspect}</span>` : '';
    return `<span class="spare-cap"><b>${d.free}</b>/${d.total} ${t('spare.free')}<span class="spare-cap-sub">(${d.freeAccess} access${sfp})</span>${susp}</span>`;
}
function openSpareReport(){
    const rep = _spareCompute();
    const ov = _spareEnsureOverlay();
    ov.style.display = 'flex';
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const tot = rep.totals;
    const _stt = document.getElementById('spare-title'); if(_stt) _stt.textContent = t('report.spareTitle');
    const header = `<div class="spare-summary">
        <div class="spare-summary-hdr">
            <div class="spare-summary-big">${t('spare.freePortsOf',{free:`<b>${tot.free}</b>`,ports:tot.ports})}</div>
            <label class="spare-hl" id="spare-hl-toggle"><input type="checkbox" ${store._spareActive?'checked':''} onchange="setSpareHighlight(this.checked)"> <i class="fas fa-highlighter"></i> ${t('spare.highlight')}</label>
            <button class="toolbar-btn" onclick="spareExportCsv()" data-tip="${t('spare.csvTip')}"><i class="fas fa-file-csv"></i> CSV</button>
        </div>
        <div class="spare-summary-sub">${tot.freeAccess} access · ${tot.freeSfp} SFP/uplink${tot.suspect?` · <span class="spare-susp-pill">⚠ ${t('spare.maybeInUse',{n:tot.suspect})}</span>`:''}</div>
    </div>`;
    const renderDev = d => `<div class="spare-row">
        <span class="spare-row-name">${esc(d.name)}</span>${_spareCapChip(d)}</div>`;
    const sections = rep.racks.map(r => `<details class="props-collapsible drift-sec" open>
        <summary class="props-collapsible-head"><span><i class="fas fa-server"></i> ${esc(r.name)}</span><span class="drift-count">${t('spare.freeN',{n:r.totals.free})}</span></summary>
        <div class="props-collapsible-body drift-sec-body">${r.devices.map(renderDev).join('')}</div></details>`).join('');
    const unr = rep.unracked.length ? `<details class="props-collapsible drift-sec">
        <summary class="props-collapsible-head"><span><i class="fas fa-diagram-project"></i> ${t('spare.unracked')}</span><span class="drift-count">${t('spare.freeN',{n:rep.unracked.reduce((a,d)=>a+d.free,0)})}</span></summary>
        <div class="props-collapsible-body drift-sec-body">${rep.unracked.map(renderDev).join('')}</div></details>` : '';
    const empty = (!rep.racks.length && !rep.unracked.length)
        ? `<div class="drift-empty">${t('spare.empty')}</div>` : '';
    document.getElementById('spare-body').innerHTML = header + empty + sections + unr;
    // "Si deve vedere": aprire il report accende l'evidenziazione nel rack.
    setSpareHighlight(true);
}

// ── Export CSV ────────────────────────────────────────────────────────
function spareExportCsv(){
    const rep = _spareReport || _spareCompute();
    const rows = [['rack','dispositivo','porta','tipo','stato']];
    const push = (rackName, d) => d.freePorts.forEach(fp => rows.push([
        rackName, d.name, fp.pid, fp.kind === 'sfp' ? 'SFP/uplink' : 'access',
        fp.suspect ? 'libera (SNMP attiva)' : 'libera',
    ]));
    rep.racks.forEach(r => r.devices.forEach(d => push(r.name, d)));
    rep.unracked.forEach(d => push('(fuori rack)', d));
    const esc = v => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `porte-libere-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Bridge legacy: hook di render (_applySpareHighlight da app-render-core) +
// voci menu / handler inline dell'overlay.
expose({ _applySpareHighlight, openSpareReport, setSpareHighlight, toggleSpareHighlight, spareExportCsv, _closeSpareReport });
