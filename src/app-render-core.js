// ============================================================
// RENDER CORE — renderAll/renderNow coalescing, renderScope dispatcher,
// renderFloor mirato, getPortHTML, cable path bezier, shouldRenderLink.
//                                              [modulo ESM, ex lib/app-render-core.js]
// _renderPending/_floorPending restano module-local (solo questo modulo li usa).
// Tutto lo stato condiviso (selId, _topo*, _filterVlan, _propsTabHold, _rightTab,
// _rackCollapsed, _spareActive, ...) vive su window → win.*.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, hexToRgba, normalizeStatus } from './app-util.js';
import { nodeById, getNodeByPortId, getPortNodeId, renderCables } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { propagateVlans, _linkIsTrunk } from './app-vlan-autopoll.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderTopoOverlay } from './app-topology-overlay.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// Altezza in px di una unità rack (1U). UNICO punto di verità: la CSS var
// `--ru-h` (style.css :root), letta qui dal render JS che dimensiona chassis,
// griglia e righello. Scelta in scala reale (19" : 1.75" ≈ 10.86:1) così le skin
// del pannello entrano con proporzioni corrette. Fallback 24 se la var non c'è
// (es. ambiente di test senza CSS).
function rackUPx(){
    try {
        const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ru-h'), 10);
        return v > 0 ? v : 24;
    } catch(_){ return 24; }
}

// ============================================================
// RENDER
// ============================================================
// Coalescing: i ~70 call-site continuano a chiamare renderAll(), ma N chiamate
// ravvicinate (stesso frame) collassano in UN solo rebuild del DOM. Sicuro perché
// renderAll non viene mai letto in modo sincrono subito dopo (focusNode usa solo
// il container, e i win.renderCables ridondanti vengono comunque ricorretti dal flush).
// renderNow() forza il render immediato per i rari casi che lo richiedono.
let _renderPending = false;
export function renderAll(){
    if(_renderPending) return;
    _renderPending = true;
    // Guard sul flag: se nel frattempo e' passato un renderNow() (che azzera
    // _renderPending e renderizza subito), questo callback in coda e' stantio
    // e NON deve ri-renderizzare — un re-render postumo rieseguirebbe anche
    // win.renderProps→_activatePropsTab, annullando es. uno switch a tab Rack.
    requestAnimationFrame(()=>{ if(!_renderPending) return; _renderPending = false; _renderAllNow(); });
}
function renderNow(){ _renderPending = false; _renderAllNow(); }

// ─────────────────────────────────────────────────────────────────
// renderScope(scope) — dispatcher di render incrementale (Fase 4 UX)
// ─────────────────────────────────────────────────────────────────
// L'idea: ridurre l'uso di renderAll() (rebuild totale) sostituendolo
// con render mirati quando una mutazione impatta una sola vista.
// Beneficio: niente DOM rebuild non necessari → eventi nativi (es. dblclick)
// non vengono persi, scroll/focus stabili, performance.
//
// Scope supportati:
//   'props'    → renderProps(pannello Proprieta')
//   'cables'   → win.renderCables (cavi SVG)
//   'topology' → renderTopoOverlay(overlay topologia, con coalescing)
//   'floor'    → renderFloor (planimetria: structures + items + icone rack)
//   'rack'     → fallback renderAll() — estrazione rack chassis NON fatta
//                (P4 valutato 8-12h con rischio alto, decisione: skip).
//                Convertibile in futuro se ROI cambia.
//   'all'      → renderAll() esplicito (per compat)
//
// REGOLA D'ORO: se in dubbio sull'impatto della mutazione, usa renderAll()
// o 'all'. Sostituire renderAll() con uno scope mirato e' un'ottimizzazione
// chirurgica: vale la pena solo dove sei sicuro al 100% dell'impatto.
function renderScope(scope){
    switch(scope){
        case 'props':
            if(typeof win.renderProps === 'function') renderProps();
            return;
        case 'cables':
            if(typeof win.renderCables === 'function') renderCables();
            return;
        case 'topology':
            if(typeof win.renderTopoOverlay === 'function') renderTopoOverlay();
            return;
        case 'floor':
            if(typeof renderFloor === 'function') renderFloor();
            return;
        case 'rack':
        case 'all':
        default:
            renderAll();
            return;
    }
}
function _renderAllNow(){
    // Hold tab-Rack (selectPathSegment): decade appena il segmento non e' piu'
    // la selezione corrente. Centralizzato qui perche' i punti di DESELEZIONE
    // sono sparsi (Esc, click su vuoto, delete, undo/redo) ma passano tutti da
    // un render — senza questo, dopo una deselezione l'hold resterebbe stantio
    // e ri-selezionare lo STESSO cavo dalla mappa non aprirebbe le Proprieta'.
    if(typeof win._propsTabHold !== 'undefined' && win._propsTabHold &&
       !(store.selType === 'link' && store.selId === win._propsTabHold)) win._propsTabHold = null;
    propagateVlans();   // propaga VLAN sui link prima di renderizzare
    win._renderModeIndicator();
    if(typeof win._renderV3PendingChip === 'function') win._renderV3PendingChip();
    const fS=document.getElementById('floor-structures'), fI=document.getElementById('floor-items');
    const ch=document.getElementById('rack-chassis'), bg=document.getElementById('floor-bg-img');
    const rs=win.getRackSize();
    win.applyUiColors();
    // Altezza U in scala (var --ru-h via rackUPx). border-top:8 + border-bottom:19 = 27px
    const _U = rackUPx();
    ch.style.height=`${rs*_U+27}px`; ch.style.gridTemplateRows=`repeat(${rs},${_U}px)`;
    const _grid=document.getElementById('floorplan-grid'); if(_grid) _grid.style.display = store.state.gridHidden ? 'none' : '';
    if(store.state.bgImage){ bg.src=store.state.bgImage; bg.style.display='block'; bg.style.transform=`scale(${store.state.bgImageScale||1})`; bg.style.opacity=(store.state.bgImageOpacity ?? 0.4); }
    else { bg.style.display='none'; }

    // ---- Numerazione rack — ogni U ha il suo numero nel profilo sinistro ----
    // Convenzione: rackU interno 1=basso sempre. Se il rack ha uNumberFromTop=true
    // il ruler stampa 1 in alto (etichetta tipo telco/ETSI) ma il dato resta intatto.
    const ruler=document.getElementById('rack-ruler');
    ruler.style.height=`${rs*_U}px`;
    let ruHtml='';
    const fromTop=win.isRackTopNumbered(store.state.currentRack);
    for(let row=rs;row>=1;row--){
        // row: posizione fisica nel ruler (rs in cima, 1 in fondo)
        // u: numero da stampare. Default: u=row (1 in fondo). Da-top: u=rs-row+1.
        const u = fromTop ? (rs - row + 1) : row;
        const cls=u===1?'ru ru1':u%10===0?'ru ru10':u%5===0?'ru ru5':'ru';
        ruHtml+=`<div class="${cls}">${u}</div>`;
    }
    ruler.innerHTML=ruHtml;

    fS.innerHTML=''; fI.innerHTML=''; ch.innerHTML='';

    // L3-lite: insieme dei device che fanno da gateway L3 (badge "L3" sulla
    // rack-label). Calcolato UNA volta per render, non per device.
    const _l3ids = (typeof win._l3GatewayNodeIds === 'function') ? win._l3GatewayNodeIds() : null;

    // Presenza: i device risultati ASSENTI in rete nell'ultima Verifica
    // documentazione (bucket macOrphan del Drift) vengono attenuati ("grigio").
    // Calcolato UNA volta per render. Guardia: chi ha poi risposto allo SNMP
    // (snmpStatus 'ok') NON resta grigio — un device riacceso+sincronizzato torna vivo.
    const _absentIds = new Set(((store._driftReport && store._driftReport.macOrphan) || [])
        .map(r => r.nodeId).filter(Boolean));

    store.state.nodes.forEach(n=>{
        const def=TYPES[n.type]; if(!def) return;
        const _absentCls = (_absentIds.has(n.id) && n.snmpStatus!=='ok') ? ' node-absent' : '';
        // Se SNMP non è attivo per questo nodo, elimina eventuale stato errore
        // residuo per evitare bordi rossi "bloccati" dopo disattivazione driver.
        if(!win._hasSnmpIntegration(n)){
            delete n.snmpStatus;
            delete n.snmpError;
            delete n.snmpLastOk;
            if(n.integration) delete n.integration.lastPoll;
        }
        const fixedRackLabel = win._fixedRackLabel(n.type);
        if(fixedRackLabel && n.name!==fixedRackLabel) n.name=fixedRackLabel;
        if(n.type==='wallport') n.ports=1;

        if(def.isFloor){
            const el=document.createElement('div'); el.dataset.id=n.id;
            if(def.isStructural){
                el.className=`floor-${n.type}${store.selId===n.id?' selected':''}${n.locked?' locked':''}`;
                const _sCol = n.color||def.defaultColor;
                const _sAlpha = n.opacity !== undefined ? n.opacity : 1;
                const _sBg = _sAlpha < 1 ? hexToRgba(_sCol, _sAlpha) : _sCol;
                const _w=n.w||200, _h=n.h||200;
                const _autoFs=Math.max(10, Math.min(Math.min(_w,_h)*0.1, 36));
                const _fontSize=n.fontSize!==undefined ? n.fontSize : _autoFs;
                el.style.cssText=`left:${n.x}px;top:${n.y}px;width:${_w}px;height:${_h}px;background-color:${_sBg}`;
                const _lockIcon=`<i class="fas ${n.locked?'fa-lock':'fa-lock-open'} room-lock-icon"></i>`;
                const _resizeHandle=n.locked?'':`<div class="resize-handle"></div>`;
                el.innerHTML=`<span style="font-size:${_fontSize}px">${escapeHTML(n.name)}</span>${_lockIcon}${_resizeHandle}`;
                fS.appendChild(el);
            } else {
                // Controlla se il nodo ha almeno una porta/cavo nella VLAN filtro
                const _selectedPortOnNode = store.selType==='port' && store.selId && getPortNodeId(store.selId)===n.id;
                const _nodeDim=store._filterVlan&&(()=>{
                    const pc2=n.ports!==undefined?n.ports:def.ports;
                    for(let i=1;i<=pc2;i++){
                        const pid=`${n.id}-${i}`;
                        const eff=win._effPortVlan(pid);
                        if(eff===store._filterVlan) return false;
                        if(win._linksForPort(pid).some(lk=>win._linkMatchesVlanFilter(lk))) return false;
                    }
                    return true;
                })();
                // In modalità topologia: nascondi completamente i nodi non in VLAN
                if(_nodeDim && store._topoVisible) return;
                el.className=`floor-node ${store.selId===n.id?'selected':''}${_selectedPortOnNode?' port-selected':''}${_nodeDim?' vlan-dim':''}${_absentCls}`;
                el.style.cssText=`left:${n.x}px;top:${n.y}px`;
                const pc=n.ports!==undefined?n.ports:def.ports;
                let icon=`<i class="fas ${def.icon} icon"></i>`;
                if(pc===1){
                    const pid=`${n.id}-1`,pi=store.state.ports[pid]||{},st=normalizeStatus(pi.statusOvr??pi.status);
                    const selectedPortCls = (store.selType==='port' && store.selId===pid) ? ' selected' : '';
                    icon=`<i class="fas ${def.icon} icon port ${st}${selectedPortCls}" data-pid="${pid}" title="${escapeHTML(win.portTip(pid))}"></i>`;
                }
                let pts='';
                if(pc>1){pts='<div class="floor-ports">';for(let i=1;i<=pc;i++)pts+=getPortHTML(`${n.id}-${i}`);pts+='</div>';}
                const _snmpOn=win._hasSnmpIntegration(n);
                const _ferr=_snmpOn&&n.snmpStatus==='err'?` style="outline:2px solid #f85149;outline-offset:2px;border-radius:3px"`:'';
                const _v3BadgeF = (typeof win._v3NeedsCreds === 'function' && win._v3NeedsCreds(n))
                    ? `<span class="floor-v3-badge" title="${t('pnl.gen.v3MissingCreds')}"><i class="fas fa-key"></i></span>` : '';
                el.innerHTML=`${icon}${_v3BadgeF}<div class="label" style="display:flex;align-items:center;justify-content:center"${_ferr}>${escapeHTML(n.type==='wallport'?win.getWallPortLabel(n):(typeof win._dispName==='function'?win._dispName(n.name):n.name))}</div>${pts}${_radioPortHtml(n)}`;
                fI.appendChild(el);
            }
        } else if(def.isRack&&n.rackId===store.state.currentRack){
            win.clampRackDevice(n);
            const el=document.createElement('div'); el.dataset.id=n.id;
            const _lldpDisc=store._topoVisible&&store._topoData&&store._topoData.nodes.some(tn=>tn.nodeId===n.id);
            const _snmpOn=win._hasSnmpIntegration(n);
            const _snmpStateCls = !_snmpOn ? ' snmp-na' : (n.snmpStatus==='ok' ? ' snmp-ok' : (n.snmpStatus==='err' ? ' snmp-err snmp-fault' : ' snmp-pending'));
            el.className=`rack-device type-${n.type} ${store.selId===n.id?'selected':''}${_lldpDisc?' lldp-discovered':''}${_snmpStateCls}${_absentCls}`;
            const sU=n.sizeU!==undefined?n.sizeU:def.sizeU;
            const rackBg = win._rackDeviceBg(n.color);
            el.style.gridRow=`${rs-n.rackU-sU+2}/span ${sU}`;
            if(rackBg) el.style.background = rackBg;
            const pc=n.ports!==undefined?n.ports:def.ports;
            let pts='';
            if(pc>0){
                const _fpState=win._frontPanelState(n, pc);
                // Gap unico per numeriche e logiche: stessa distribuzione delle porte
                // in tutti i casi (le etichette logiche piu' lunghe vengono troncate
                // via CSS senza modificare lo spazio fra le porte).
                const breathGap=(count)=> count>16 ? 1 : 2;
                // Densita': switch con >16 porte per riga (es. 48 porte = 24/riga)
                // usano classe dense-xl per font/spaziatura adattati.
                const perRow = Math.max(...(win._frontPanelRows(n, pc).map(r=>r.length))) || pc;
                const densityCls = perRow > 16 ? ' dense-xl' : '';
                const mkPort=(i)=>{
                    const pid=`${n.id}-${i}`;
                    const pi=store.state.ports[pid]||{};
                    if(pi.hidden) return ''; // interfaccia nascosta (virtuale)
                    const st=normalizeStatus(pi.statusOvr??pi.status);
                    const lagSelCls=win.lagSelMode&&store.lagSelPorts.has(pid)?' lag-sel':'';
                    const lagGid=win._portLagGid(pid);
                    const lagMemCls=lagGid?' lag-member':'';
                    const lagFocCls=win._isLagFocusedPort(pid)?' lag-focus':'';
                    const lagDataAttr=lagGid?` data-lag="${escapeHTML(lagGid)}"`:'';
                    const isUplink=win._frontPanelIsUplink(n, i, pc);
                    const uplinkCls=isUplink?' uplink sfp-slot':'';
                    const ledCls=isUplink?' port-led sfp-slot':'port-led';
                    const label=win._frontPanelPortLabel(n, i, pc);
                    // title HTML nativo browser: appare sempre, anche dentro container
                    // con overflow:hidden (a differenza del tooltip CSS [data-tip]).
                    const portTipText = win.portTip(pid);
                    const numHtml=`<span class="port-num" title="${escapeHTML(label)}">${escapeHTML(label)}</span>`;
                    return `<div class="rack-port-unit${uplinkCls}"><div class="${ledCls} ${st}${lagSelCls}${lagMemCls}${lagFocCls}" data-pid="${pid}"${lagDataAttr} title="${escapeHTML(portTipText)}"></div>${numHtml}</div>`;
                };
                // MGMT slot dedicato (1..4 celle, bordo ciano stile cavo console
                // Cisco). Pid `${n.id}-mgmt${i}`. Etichetta base editabile (default
                // 'MGMT'); con count>1 viene suffissato l'indice (MGMT1, MGMT2).
                // Mirror del layout SFP (grid 2 righe), fuori dal range 1..N dati.
                // Struttura cella MGMT mirror esatto di SFP: ogni unit ha
                // [LED + numero sotto] cosi' l'altezza del blocco corrisponde
                // a quella del blocco SFP a parita' di celle. Il numero (1..N)
                // identifica la porta; il colore ciano del numero + del bordo
                // LED rende esplicito che si tratta di MGMT (no ambiguita' con
                // le porte dati main 1..N che sono in un altro blocco).
                const mkMgmt=()=>{
                    const mc = _fpState.mgmtCount || 0;
                    if(mc <= 0) return '';
                    const base = _fpState.mgmtLabel || 'MGMT';
                    let cells='';
                    for(let i=1;i<=mc;i++){
                        const pid=`${n.id}-mgmt${i}`;
                        const pi=store.state.ports[pid]||{};
                        const st=normalizeStatus(pi.statusOvr??pi.status);
                        const selectedCls=(store.selType==='port' && store.selId===pid)?' selected':'';
                        const cellName = mc===1 ? base : `${base}${i}`;
                        const tip=win.portTip(pid) || cellName;
                        cells += `<div class="rack-port-unit mgmt-slot"><div class="port-led mgmt-slot ${st}${selectedCls}" data-pid="${pid}" title="${escapeHTML(tip)}"></div><span class="port-num mgmt-num" title="${escapeHTML(cellName)}">${i}</span></div>`;
                    }
                    return `<div class="rack-mgmt-side"><div class="rack-mgmt-grid">${cells}</div><span class="rack-mgmt-title" title="${escapeHTML(base)}">${escapeHTML(base)}</span></div>`;
                };
                const rows=win._frontPanelRows(n, pc);
                const sideRows=win._frontPanelSfpPorts(n, pc);
                if(sideRows.length || _fpState.mgmtPort){
                    const compactCls=sU===1?' compact-1u':'';
                    const maxRow=Math.max(...rows.map(r=>r.length)) || pc;
                    const g=breathGap(maxRow);
                    let html='';
                    rows.forEach((row)=>{
                        if(!row?.length) return;
                        html+=`<div class="rack-ports-row" style="--port-gap:${g}px">`;
                        row.forEach(i=>{ html+=mkPort(i); });
                        html+='</div>';
                    });
                    // SFP rendering: 1 o 2 .rack-sfp-side affiancati. Il
                    // 2o blocco (se presente) e' posizionato dopo il primo
                    // sullo stesso lato. Ordine sfp1 -> sfp2 (naturale: il
                    // primo blocco e' piu' vicino ai dati).
                    let sideHtml='';
                    if(sideRows.length){
                        const sfpGroups = win._frontPanelSfpGroups(n, pc);
                        sfpGroups.forEach(grp => {
                            sideHtml += '<div class="rack-sfp-side">';
                            grp.ports.forEach(i => { sideHtml += mkPort(i); });
                            sideHtml += '</div>';
                        });
                    }
                    const mgmtHtml=mkMgmt();
                    const sfpRight = _fpState.sfpRight !== false;
                    const mainBlock = `<div class="rack-ports-main">${html}</div>`;
                    // Ordine left-to-right:
                    //   [MGMT-left?] [SFP-left?] [MAIN] [SFP-right?] [MGMT-right?]
                    const leftMgmt  = _fpState.mgmtPort && _fpState.mgmtPosition==='left'  ? mgmtHtml : '';
                    const rightMgmt = _fpState.mgmtPort && _fpState.mgmtPosition==='right' ? mgmtHtml : '';
                    const leftSfp   = sideRows.length && !sfpRight ? sideHtml : '';
                    const rightSfp  = sideRows.length &&  sfpRight ? sideHtml : '';
                    const layoutCls = sideRows.length ? (sfpRight?'sfp-right':'sfp-left') : 'mgmt-only';
                    // Quando MGMT e' sul lato opposto a SFP, il transform su
                    // .rack-ports-main avvicinerebbe il main al blocco MGMT
                    // creando sovrapposizioni: neutralizziamo via has-mgmt-opposite.
                    const mgmtPos = _fpState.mgmtCount > 0 ? _fpState.mgmtPosition : null;
                    const sfpPos  = sideRows.length ? (sfpRight ? 'right' : 'left') : null;
                    const oppositeCls = (mgmtPos && sfpPos && mgmtPos !== sfpPos) ? ' has-mgmt-opposite' : '';
                    pts=`<div class="rack-ports rack-ports-sfp-layout ${layoutCls}${compactCls}${densityCls}${oppositeCls}">${leftMgmt}${leftSfp}${mainBlock}${rightSfp}${rightMgmt}</div>`;
                } else if(rows.length===1){
                    pts=`<div class="rack-ports${densityCls}" style="--port-gap:${breathGap(pc)}px">`;
                    rows[0].forEach(i=>{ pts+=mkPort(i); });
                    pts+='</div>';
                } else {
                    const compactCls=sU===1?' compact-1u':'';
                    const maxRow=Math.max(...rows.map(r=>r.length));
                    const g=breathGap(maxRow);
                    const mainRows=rows;
                    let html='';
                    mainRows.forEach((row)=>{
                        html+=`<div class="rack-ports-row" style="--port-gap:${g}px">`;
                        row.forEach(i=>{ html+=mkPort(i); });
                        html+='</div>';
                    });
                    pts=`<div class="rack-ports rack-ports-2row${compactCls}${densityCls}">${html}</div>`;
                }
            }
            // Hostname mostrato come tooltip nativo del browser al hover sul device.
            // L'hostname/brand non occupa piu' spazio fisso a sinistra -> piu'
            // spazio disponibile per le porte (utile su switch ad alta densita').
            // rack-label: targhetta nera fissa con nome/ID a destra del device.
            const _hoverInfo = [n.hostname, n.name, n.ip].filter(Boolean).join(' · ') || (n.brand||def.brand||'');
            // Stacking visual hint (P7.1): la rack-label cambia colore da
            // nero a ciano accent (stesso colore del highlight LAG) quando il
            // device e' membro di uno stack. Testo nero per contrasto. La
            // distinzione master/membro vive nel pannello Proprieta'.
            const _isStacked = win.isInStack(n);
            // HA visual hint (P8.1): la rack-label cambia colore da nero a
            // arancione (ambra) quando il device e' in HA pair o cluster.
            // Stesso pattern di stacking ma color diverso per non confondere
            // i due concetti. Mutuamente esclusivi nella pratica.
            const _isInHa = typeof win.isInHaGroup === 'function' && win.isInHaGroup(n);
            // Priorita: stack vince se entrambi presenti (raro caso teorico)
            const _stackCls = _isStacked ? ' is-stacked' : (_isInHa ? ' is-ha' : '');
            // Tooltip arricchito: aggiunge sintesi stack o HA.
            const _stackInfo = _isStacked ? win.getStackSummary(store.state.nodes, n) : null;
            const _haInfo = _isInHa && !_isStacked ? win.getHaSummary(store.state.nodes, n) : null;
            const _stackId = _isStacked ? (n.spec?.stackId || n.stackId || '') : '';
            let _fullHoverInfo = _hoverInfo;
            if(_stackInfo){
                _fullHoverInfo = `${_hoverInfo ? _hoverInfo + ' · ' : ''}${_stackInfo}${_stackId ? t('pnl.gen.ofStack',{id:_stackId}) : ''}`;
            } else if(_haInfo){
                _fullHoverInfo = `${_hoverInfo ? _hoverInfo + ' · ' : ''}${_haInfo}`;
            }
            if(_fullHoverInfo) el.title = _fullHoverInfo;
            // Badge "L3": il device fa da gateway per >=1 VLAN (L3-lite).
            const _l3Badge = (_l3ids && _l3ids.has(String(n.id)))
                ? `<span class="rack-l3-badge" title="${t('pnl.gen.l3GatewayBadge')}">L3</span>` : '';
            // Pill "v3 da configurare" (come il badge L3): device SNMPv3 rilevato
            // dalla discovery senza credenziali. Stato derivato (vedi app-snmp).
            const _v3Badge = (typeof win._v3NeedsCreds === 'function' && win._v3NeedsCreds(n))
                ? `<span class="rack-v3-badge" title="${t('pnl.gen.v3MissingCreds')}"><i class="fas fa-key"></i></span>` : '';
            // Skin pannello custom: se presente e valida, sostituisce il layout
            // porte generato. Fallback TOTALE al generato se assente.
            let _hasSkin = false;
            if(typeof win._panelSkinRackHtml==='function'){ const _skin=win._panelSkinRackHtml(n); if(_skin){ pts=_skin; _hasSkin=true; } }
            // Con la skin: niente padding/bordo del device → l'artwork riempie tutto
            // il box (in scala 1U) e la cornice la disegna l'SVG stesso.
            if(_hasSkin) el.classList.add('has-skin');
            if(n.type==='cablemanager'){
                const cmFingers='<div class="cm-fingers"><span class="cm-finger"></span><span class="cm-finger"></span><span class="cm-finger"></span><span class="cm-finger"></span><span class="cm-finger"></span><span class="cm-finger"></span></div>';
                el.innerHTML=`<div class="cm-face"></div>${cmFingers}`;
            } else {
                // Con la skin la targhetta nera (nome/ID) viene OMESSA per liberare
                // tutto il campo all'artwork; il nome resta nell'hover del device
                // (el.title, gia' valorizzato con hostname/nome/IP). Senza skin
                // resta com'era.
                const _labelHtml = _hasSkin ? '' : `<div class="rack-label${_stackCls}">${escapeHTML(n.name)}${_l3Badge}${_v3Badge}</div>`;
                el.innerHTML=`${pts}${_labelHtml}${_radioPortHtml(n)}`;
            }
            ch.appendChild(el);
        }
    });
    // ---- Icone rack sulla planimetria ----------------------------------------
    store.state.racks.forEach(rack=>{
        if(rack.x===undefined||rack.y===undefined) return;
        const el=document.createElement('div');
        el.dataset.rackid=rack.id;
        const isActive=rack.id===store.state.currentRack;
        el.className=`floor-rack${isActive?' rack-active':''}`;
        el.style.cssText=`left:${rack.x}px;top:${rack.y}px`;
        const devs=store.state.nodes.filter(n=>TYPES[n.type]?.isRack&&n.rackId===rack.id);
        const devCount=devs.length;
        const devNames=devs.slice(0,3).map(n=>escapeHTML(n.name||n.hostname||n.type)).join(' · ')+(devs.length>3?' …':'');
        // Badge connessioni verso floor node (visibile solo con overlay topologia attivo)
        const floorLinkCount=store._topoVisible?win._getRackFloorLinks(rack.id).length:0;
        const floorBadge=floorLinkCount>0
            ?`<span class="floor-rack-floor-badge" data-tip="${t('pnl.gen.floorLinksTip',{n:floorLinkCount})}">${floorLinkCount}</span>`:'';
        el.innerHTML=`<div class="floor-rack-icon"><i class="fas fa-server"></i>${devCount>0?`<span class="floor-rack-badge">${devCount}</span>`:''}</div>`
            +`<div class="floor-rack-name">${escapeHTML(rack.name)}${floorBadge}</div>`
            +(devNames?`<div class="floor-rack-devs">${devNames}</div>`:'');
        // Hover per rack non corrente: mostra anteprima connessioni (Proposta C)
        if(!isActive&&store._topoVisible){
            el.addEventListener('mouseenter',()=>{ win._hoverRackId=rack.id; renderTopoOverlay(); });
            el.addEventListener('mouseleave',()=>{ win._hoverRackId=null; renderTopoOverlay(); });
        }
        // Doppio click: apre la vista del rack corrispondente (espande il pannello se nascosto)
        el.addEventListener('dblclick',e=>{
            e.stopPropagation();
            if(store._rackCollapsed) win.toggleRackPanel();
            win.switchRack(rack.id);
        });
        fI.appendChild(el);
    });

    // F6: la resa Proprieta' e' costosa SOLO nel ramo planimetria (nessuna selezione):
    // _renderFloorProps scandisce ogni VLAN con _ipamUsageForVlan/_vlanIpamSummary,
    // ognuna ri-scansiona TUTTI i nodi. Inutile quando il pannello e' NASCOSTO (tab
    // Rack/Assistente) e non c'e' selezione. Con una selezione attiva la resa e'
    // leggera (un solo nodo/porta/cavo) e va tenuta — _activatePropsTab (nei renderer
    // di selezione) garantisce lo switch a 'props' anche dagli entry-point che non lo
    // forzano gia'; il re-render al cambio tab c'e' comunque (renderScope('props')).
    // _rightTab letto bare (var globale su window, vedi app.js) → 0 nuove letture win.*.
    if(_rightTab === 'props' || (store.selType && store.selId)) renderProps();
    win._updateLagBanner();
    win._updateRackFloorBtn();
    // Legenda VLAN: visibile in entrambe le viste (Map=passiva, Topology=interattiva)
    if(typeof win._renderTopoLegend === 'function') win._renderTopoLegend();
    // win.renderTopoOverlay usa offsetWidth/offsetHeight delle icone rack:
    // deve girare dopo che il browser ha fatto il layout dei nuovi div.
    requestAnimationFrame(win.renderTopoOverlay);
    renderCables();
    // Modalita' instradamento cavo (P1.5): ri-applica highlight/dim sulle
    // porte pass-through valide dopo ogni rebuild del DOM (sopravvive al
    // cambio rack durante il picking). No-op se la modalita' e' off.
    if(typeof win._paintRoutingTargets === 'function') win._paintRoutingTargets();
    // Highlight "porte libere" (decoupled): ri-applica le classi spare-free/
    // spare-suspect dopo ogni rebuild del DOM. No-op se il toggle e' off.
    if(typeof win._applySpareHighlight === 'function' && typeof store._spareActive !== 'undefined' && store._spareActive) win._applySpareHighlight();
    // Sotto-header (breadcrumb + suggerimento + statistiche): sempre coerente col
    // progetto/stato correnti. Global bare (typeof-guard) -> nessun win.* nuovo.
    if(typeof renderSubbar === 'function') renderSubbar();
}

// ─────────────────────────────────────────────────────────────────
// F4-P3: renderFloor() — render mirato di sola planimetria
// ─────────────────────────────────────────────────────────────────
// Ridisegna SOLO le parti floor: floor-structures (stanze), floor-items
// (device floor) e le icone rack sulla planimetria. NON tocca il rack
// chassis interno, il pannello props, i cavi.
//
// Conservativo: duplica la logica di _renderAllNow per la parte floor
// invece di estrarre un helper condiviso. Costo: ~2x memory footprint
// del codice. Beneficio: rischio zero di rottura del path renderAll
// esistente. Unificazione (DRY) in un Pezzo successivo se serve.
//
// Coalescing: come renderAll e win.renderTopoOverlay.
let _floorPending = false;
function renderFloor(){
    if(_floorPending) return;
    _floorPending = true;
    requestAnimationFrame(()=>{ _floorPending = false; _renderFloorNow(); });
}
function _renderFloorNow(){
    const fS = document.getElementById('floor-structures');
    const fI = document.getElementById('floor-items');
    if(!fS || !fI) return;
    fS.innerHTML = ''; fI.innerHTML = '';
    store.state.nodes.forEach(n => {
        const def = TYPES[n.type]; if(!def) return;
        if(!def.isFloor) return;
        // Stesse normalizzazioni di _renderAllNow per coerenza
        const fixedRackLabel = win._fixedRackLabel(n.type);
        if(fixedRackLabel && n.name !== fixedRackLabel) n.name = fixedRackLabel;
        if(n.type === 'wallport') n.ports = 1;
        const el = document.createElement('div'); el.dataset.id = n.id;
        if(def.isStructural){
            el.className = `floor-${n.type}${store.selId===n.id?' selected':''}${n.locked?' locked':''}`;
            const _sCol = n.color || def.defaultColor;
            const _sAlpha = n.opacity !== undefined ? n.opacity : 1;
            const _sBg = _sAlpha < 1 ? hexToRgba(_sCol, _sAlpha) : _sCol;
            const _w = n.w || 200, _h = n.h || 200;
            const _autoFs = Math.max(10, Math.min(Math.min(_w, _h) * 0.1, 36));
            const _fontSize = n.fontSize !== undefined ? n.fontSize : _autoFs;
            el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${_w}px;height:${_h}px;background-color:${_sBg}`;
            const _lockIcon = `<i class="fas ${n.locked?'fa-lock':'fa-lock-open'} room-lock-icon"></i>`;
            const _resizeHandle = n.locked ? '' : `<div class="resize-handle"></div>`;
            el.innerHTML = `<span style="font-size:${_fontSize}px">${escapeHTML(n.name)}</span>${_lockIcon}${_resizeHandle}`;
            fS.appendChild(el);
        } else {
            const _selectedPortOnNode = store.selType==='port' && store.selId && getPortNodeId(store.selId)===n.id;
            const _nodeDim = store._filterVlan && (()=>{
                const pc2 = n.ports!==undefined?n.ports:def.ports;
                for(let i=1;i<=pc2;i++){
                    const pid = `${n.id}-${i}`;
                    const eff = win._effPortVlan(pid);
                    if(eff === store._filterVlan) return false;
                    if(win._linksForPort(pid).some(lk=>win._linkMatchesVlanFilter(lk))) return false;
                }
                return true;
            })();
            if(_nodeDim && store._topoVisible) return;
            // Endpoint foglia (non pass-through): marcato per il toggle ENDPOINT
            // della topologia, che li nasconde via CSS (body.topo-hide-endpoints).
            const _epCls = def.passThrough ? '' : ' topo-endpoint';
            el.className = `floor-node ${store.selId===n.id?'selected':''}${_selectedPortOnNode?' port-selected':''}${_nodeDim?' vlan-dim':''}${_epCls}`;
            el.style.cssText = `left:${n.x}px;top:${n.y}px`;
            const pc = n.ports!==undefined?n.ports:def.ports;
            let icon = `<i class="fas ${def.icon} icon"></i>`;
            if(pc===1){
                const pid = `${n.id}-1`, pi = store.state.ports[pid]||{}, st = normalizeStatus(pi.statusOvr??pi.status);
                const selectedPortCls = (store.selType==='port' && store.selId===pid) ? ' selected' : '';
                icon = `<i class="fas ${def.icon} icon port ${st}${selectedPortCls}" data-pid="${pid}" title="${escapeHTML(win.portTip(pid))}"></i>`;
            }
            let pts = '';
            if(pc>1){ pts='<div class="floor-ports">'; for(let i=1;i<=pc;i++) pts += getPortHTML(`${n.id}-${i}`); pts += '</div>'; }
            const _snmpOn = win._hasSnmpIntegration(n);
            const _ferr = _snmpOn && n.snmpStatus==='err' ? ` style="outline:2px solid #f85149;outline-offset:2px;border-radius:3px"` : '';
            el.innerHTML = `${icon}<div class="label" style="display:flex;align-items:center;justify-content:center"${_ferr}>${escapeHTML(n.type==='wallport'?win.getWallPortLabel(n):(typeof win._dispName==='function'?win._dispName(n.name):n.name))}</div>${pts}${_radioPortHtml(n)}`;
            fI.appendChild(el);
        }
    });
    // Icone rack sulla planimetria
    store.state.racks.forEach(rack => {
        if(rack.x===undefined || rack.y===undefined) return;
        const el = document.createElement('div');
        el.dataset.rackid = rack.id;
        const isActive = rack.id === store.state.currentRack;
        el.className = `floor-rack${isActive?' rack-active':''}`;
        el.style.cssText = `left:${rack.x}px;top:${rack.y}px`;
        const devs = store.state.nodes.filter(n => TYPES[n.type]?.isRack && n.rackId===rack.id);
        const devCount = devs.length;
        const devNames = devs.slice(0,3).map(n => escapeHTML(n.name||n.hostname||n.type)).join(' · ') + (devs.length>3?' …':'');
        const floorLinkCount = store._topoVisible ? win._getRackFloorLinks(rack.id).length : 0;
        const floorBadge = floorLinkCount>0
            ? `<span class="floor-rack-floor-badge" data-tip="${t('pnl.gen.floorLinksTip',{n:floorLinkCount})}">${floorLinkCount}</span>` : '';
        el.innerHTML = `<div class="floor-rack-icon"><i class="fas fa-server"></i>${devCount>0?`<span class="floor-rack-badge">${devCount}</span>`:''}</div>`
            + `<div class="floor-rack-name">${escapeHTML(rack.name)}${floorBadge}</div>`
            + (devNames ? `<div class="floor-rack-devs">${devNames}</div>` : '');
        if(!isActive && store._topoVisible){
            el.addEventListener('mouseenter', ()=>{ win._hoverRackId=rack.id; renderTopoOverlay(); });
            el.addEventListener('mouseleave', ()=>{ win._hoverRackId=null; renderTopoOverlay(); });
        }
        el.addEventListener('dblclick', e => {
            e.stopPropagation();
            if(store._rackCollapsed) win.toggleRackPanel();
            win.switchRack(rack.id);
        });
        fI.appendChild(el);
    });
    // Topology overlay deve girare DOPO layout (usa offsetWidth/Height)
    requestAnimationFrame(win.renderTopoOverlay);
    // Modalita' instradamento: ridipingi i target anche dopo un render
    // mirato della sola planimetria (prese a muro evidenziate).
    if(typeof win._paintRoutingTargets === 'function') win._paintRoutingTargets();
    // Highlight "porte libere" (decoupled): ri-applica le classi spare-free/
    // spare-suspect dopo ogni rebuild del DOM. No-op se il toggle e' off.
    if(typeof win._applySpareHighlight === 'function' && typeof store._spareActive !== 'undefined' && store._spareActive) win._applySpareHighlight();
}

function getPortHTML(pid){
    const pi=store.state.ports[pid]||{};
    const st=normalizeStatus(pi.statusOvr??pi.status);
    const isSelected = store.selType==='port' && store.selId===pid;
    // Tooltip HTML nativo (title) per uniformita' con i LED del rack:
    // stesso formato win.portTip e stesso comportamento browser nativo.
    return `<i class="fas fa-ethernet port ${st}${isSelected?' selected':''}" data-pid="${pid}" title="${escapeHTML(win.portTip(pid))}"></i>`;
}

// Porta radio Wi-Fi: target draggabile (data-pid → il pointer la tratta come
// porta) sui device Wi-Fi. Ospita molti client wireless senza porta fisica.
function _radioPortHtml(n){
    const radios = (typeof win._nodeRadios === 'function') ? win._nodeRadios(n) : [];
    if(!radios.length) return '';
    const _t = (typeof t==='function') ? t : (k=>k);
    const isRack = !!(typeof TYPES!=='undefined' && TYPES[n.type] && TYPES[n.type].isRack);
    const _badge = (i, posCls) => {
        const pid = (typeof win.radioPid === 'function') ? win.radioPid(n.id, i) : `${n.id}-radio${i?i+1:''}`;
        const cnt = (typeof win._linksForPort === 'function') ? win._linksForPort(pid).length : 0;
        const isSel = store.selType==='port' && store.selId===pid;
        const r = radios[i] || {};
        const lbl = r.label || (radios.length>1 ? `${_t('radio.iface')} ${i+1}` : _t('radio.single'));
        const _ss = (typeof win.radioSsids==='function'?win.radioSsids(r):(r.ssids||[])).filter(s=>s&&s.ssid);
        const _ssTip = _ss.length ? ` · ${_ss.length} SSID (${_ss.map(s=>s.ssid).join(', ')})` : '';
        const tip = `${escapeHTML(lbl)}${escapeHTML(_ssTip)} — ${_t('radio.tipAssoc')}${cnt?` · ${cnt} ${_t('radio.assocN')}`:''}`;
        return `<div class="radio-port ${posCls}${isSel?' selected':''}" data-pid="${pid}" title="${tip}"><i class="fas fa-wifi"></i></div>`;
    };
    // Device in rack (barra orizzontale): badge in FILA sul lato destro, la
    // nuova radio si aggiunge a destra (il perimetro è solo per i tile floor).
    if(isRack){
        // Solo con SKIN: i badge radio diventano riposizionabili (drag) sul box del
        // device, così l'utente li mette dove gli è comodo sull'artwork. La posizione
        // si salva su radio.bx/by (frazioni 0..1). Senza skin → fila fissa invariata.
        const skinned = (typeof win._resolveNodeSkin === 'function') && !!win._resolveNodeSkin(n);
        if(skinned){
            let out='';
            for(let i=0;i<radios.length;i++){
                const pid = (typeof win.radioPid === 'function') ? win.radioPid(n.id, i) : `${n.id}-radio${i?i+1:''}`;
                const r = radios[i] || {};
                const isSel = store.selType==='port' && store.selId===pid;
                const lbl = r.label || (radios.length>1 ? `${_t('radio.iface')} ${i+1}` : _t('radio.single'));
                const _ss = (typeof win.radioSsids==='function'?win.radioSsids(r):(r.ssids||[])).filter(s=>s&&s.ssid);
                const tip = `${escapeHTML(lbl)}${_ss.length?escapeHTML(` · ${_ss.length} SSID`):''} — ${_t('radio.tipAssoc')} · ${_t('pnl.gen.dragToMove')}`;
                const fx = (r.bx!=null) ? r.bx : 0.9;
                const fy = (r.by!=null) ? r.by : (radios.length>1 ? (i+1)/(radios.length+1) : 0.5);
                out += `<div class="radio-port radio-skin-pos${isSel?' selected':''}" data-pid="${pid}" title="${tip}" style="left:${(fx*100).toFixed(2)}%;top:${(fy*100).toFixed(2)}%;right:auto;bottom:auto" onpointerdown="_onSkinRadioPointerDown(event,'${n.id}',${i},'${pid}')"><i class="fas fa-wifi"></i></div>`;
            }
            return out;
        }
        let inner='';
        for(let i=0;i<radios.length;i++) inner += _badge(i, 'pos-rack');
        return `<div class="rack-radios">${inner}</div>`;
    }
    // Floor: 8 ancore sul perimetro (4 angoli + 4 centri-lato).
    const slots = (typeof win.radioAnchorSlots === 'function')
        ? win.radioAnchorSlots(radios.length)
        : ['tr','tl','br','bl','tc','bc','lc','rc'].slice(0, radios.length);
    let out='';
    for(let i=0;i<radios.length;i++) out += _badge(i, `pos-${slots[i]}`);
    return out;
}

function getCablePath(x1,y1,x2,y2){
    // Innesto COERENTE con la PROVENIENZA: il control point esce SEMPRE verso l'altro
    // capo (segno di dx/dy), non in base alla posizione sullo schermo. Così una
    // connessione che arriva da sinistra si attacca a sinistra, da destra a destra
    // (idem sopra/sotto) → niente cavo che gira intorno al tile. La tangente segue
    // l'asse DOMINANTE (orizzontale se |dx|≥|dy|, verticale altrimenti) per non fare la
    // "virgola" sul nome. Offset = metà del delta dominante → i control point non si
    // scavalcano mai (niente nodo/cappio), anche sui cavi corti.
    const dx=x2-x1, dy=y2-y1;
    if(Math.abs(dx)>=Math.abs(dy)){
        const o=Math.abs(dx)/2, s=dx>=0?1:-1;
        return `M ${x1} ${y1} C ${x1+s*o} ${y1},${x2-s*o} ${y2},${x2} ${y2}`;
    }
    const o=Math.abs(dy)/2, s=dy>=0?1:-1;
    return `M ${x1} ${y1} C ${x1} ${y1+s*o},${x2} ${y2-s*o},${x2} ${y2}`;
}
// Quadratic bezier "cavo che penzola per gravità" per connessioni rack-to-rack.
// Il punto di controllo è sotto il porto più basso: il cavo scende, raggiunge il
// punto più basso e risale verso la porta di destinazione.
// Rimane sempre dentro la larghezza del rack (x vincolato tra x1 e x2).
function getRackCablePath(x1,y1,x2,y2){
    const dist=Math.hypot(x2-x1, y2-y1);
    const sag=Math.min(Math.max(dist*0.38, 16), 52); // sag proporzionale, max 52px
    const botY=Math.max(y1,y2)+sag;                   // sotto il porto più in basso
    const midX=(x1+x2)/2;                              // centro orizzontale
    return `M ${x1} ${y1} Q ${midX} ${botY} ${x2} ${y2}`;
}

function shouldRenderLink(l){
    // Toggle TRUNK (pillola legenda topologia): SOLO in vista topologia i cavi
    // trunk sono SEMPRE visibili — anche nel rack, dove di norma compaiono solo
    // su selezione. Agganciato a _viewMode==='topology': tornando alla mappa la
    // regola decade da sola (niente carryover, che era il bug per cui fu tolta —
    // sulla mappa non c'è la pillola per spegnerlo). Vedi 3eda193.
    if(store._topoTrunkOnly && store._viewMode === 'topology' && _linkIsTrunk(l)) return true;
    // Wireless: la selezione comanda in modo esatto, scavalcando il declutter
    // generale delle porte floor. Radio selezionata → TUTTI i suoi client;
    // interfaccia di un client selezionata → SOLO la sua. (Il percorso fisico
    // store.highPath, se attivo, ha comunque precedenza ed e' gestito sotto.)
    if(l.wireless && !(store.highPath && store.highPath.size>0)){
        if(store.selType==='port' && store.selId) return _linkTouchesPort(l, store.selId);
        // Solo se a essere selezionato e' un NODO FLOOR (il client): mostra la sua
        // onda. Se invece e' selezionato un DEVICE IN RACK (con radio), NON mostrare
        // le onde sul floor — vale la regola standard "rack node → niente cavi"
        // (altrimenti si vedrebbero tutte bunchate sull'icona del rack).
        if(store.selType==='node' && store.selId){
            const _sn = nodeById(store.selId);
            if(_sn && TYPES[_sn.type]?.isFloor) return win.isPortOnNode(l.src,store.selId)||win.isPortOnNode(l.dst,store.selId);
        }
    }
    if(win._rightTab==='props' && store.selType==='port' && store.selId && !isRackPort(store.selId)) return false;
    if(win._rightTab==='props' && store.selType==='node' && store.selId){
        const n=nodeById(store.selId);
        if(n && TYPES[n.type]?.isFloor) return false;
    }
    if(store.highPath.size>0) return store.highPath.has(l.id);
    if(store.selType==='link'&&store.selId===l.id) return true;  // link selezionato: sempre visibile
    if(store.selType==='port'&&store.selId) return _linkTouchesPort(l, store.selId);
    // Nodi rack: cavi visibili solo selezionando la singola porta (non il device)
    if(store.selType==='node'&&store.selId){
        const n=nodeById(store.selId);
        if(TYPES[n?.type]?.isRack) return false;
        return win.isPortOnNode(l.src,store.selId)||win.isPortOnNode(l.dst,store.selId);
    }
    return false;
}

function isRackPort(pid){ return !!TYPES[getNodeByPortId(pid)?.type]?.isRack; }

expose({
    rackUPx, renderAll, renderNow, renderScope, _renderAllNow, renderFloor, _renderFloorNow,
    getCablePath, getRackCablePath, shouldRenderLink, isRackPort,
    getPortHTML, _radioPortHtml,
});
