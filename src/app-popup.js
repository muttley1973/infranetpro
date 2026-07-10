// ============================================================
// POPUP / TOPOTIP FRONTEND            [modulo ESM, ex lib/app-popup.js]
// Popup porte/cavi, tooltip topologia, selezione link, fan-out rack→floor.
// POSSIEDE lo stato topo condiviso (_topoData/_topoVisible/_viewMode/_filterVlan/
// _topoFdb*/...): vive su window (win.*) perché lo leggono bundle + legacy + export.js.
// _FLOOR_COLOR/_floorNodeColor/_SVG_DEV restano qui (li usa l'export SVG/PDF, classico).
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeStatus } from './app-util.js';
import { nodeById, getNodeByPortId, getPortNodeId, renderCables, _showToast, switchRightTab, _linksForPort } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderTopoOverlay } from './app-topology-overlay.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato

function _findProjectLinkByPorts(a,b){
    if(!a||!b) return null;
    return store.state.links.find(l=>_linkHasPair(l, a, b))||null;
}

function _selectProjectLink(linkId, opts={}){
    const l=store.state.links.find(x=>x.id===linkId);
    if(!l) return;
    closePop(); _hideTopoTip(); store.highPath.clear();
    win._physicalTraceActive=false;
    if(opts.trace !== false) store.highPath.add(linkId);
    if(opts.showProps){
        store.selType='link'; store.selId=linkId;
    } else {
        store.selType=null; store.selId=null;
    }
    const sn=getNodeByPortId(l.src), dn=getNodeByPortId(l.dst);
    const rackId=TYPES[sn?.type]?.isRack?sn.rackId:(TYPES[dn?.type]?.isRack?dn.rackId:null);
    if(rackId&&rackId!==store.state.currentRack){
        store.state.currentRack=rackId;
        win.renderRackTabs();
    }
    renderAll();
    renderCables();
    if(opts.showProps) renderProps();
    renderTopoOverlay();
}

function _showPhysicalCablePath(linkId){
    const l=store.state.links.find(x=>x.id===linkId);
    if(!l) return;
    closePop(); _hideTopoTip(); store.highPath.clear();
    const physicalView = (typeof win._getLinkPhysicalView === 'function') ? win._getLinkPhysicalView(l) : null;
    if(Array.isArray(physicalView?.segments) && physicalView.segments.length){
        physicalView.segments.forEach(segment=>{
            if(segment?.linkId) store.highPath.add(segment.linkId);
        });
    } else {
        store.highPath.add(linkId);
    }
    win._physicalTraceActive=true;
    // Seleziona il cavo e apri le Proprietà: il percorso resta evidenziato
    // (store.highPath vince in shouldRenderLink) E l'utente ha la fisarmonica
    // "Percorso fisico" con l'elenco dei segmenti CLICCABILI — target affidabile
    // per selezionare il tratto da editare (i cavi lato rack non sono cliccabili
    // sulla planimetria perche' i device rack non hanno porte sul floor).
    store.selType='link'; store.selId=linkId;

    const sn=getNodeByPortId(l.src), dn=getNodeByPortId(l.dst);
    const rackId=TYPES[sn?.type]?.isRack?sn.rackId:(TYPES[dn?.type]?.isRack?dn.rackId:null);
    if(rackId&&rackId!==store.state.currentRack){
        store.state.currentRack=rackId;
        win.renderRackTabs();
    }
    document.body.classList.add('physical-trace-active');
    // Apri la fisarmonica "Percorso fisico" PRIMA, poi switchRightTab('props')
    // (tab + toolbar + render). UN SOLO renderAll finale per floor/rack/cables/
    // topo: niente render extra (era la causa del "doppio" sul cavo).
    if(typeof win.setPropsSectionState==='function') win.setPropsSectionState('link-physical-path', true);
    if(typeof switchRightTab==='function') switchRightTab('props');
    renderAll();
    _showToast(t('msg.ui.physicalPathHighlighted'), 'ok', 3500);
}

// Selezione di un segmento dalla fisarmonica "Percorso fisico" (pannello cavo):
// seleziona il link del segmento MANTENENDO l'evidenziazione del percorso
// (non azzera store.highPath/win._physicalTraceActive). Cosi' l'utente naviga i tratti
// dal pannello mentre il percorso resta illuminato su rack+floor.
function selectPathSegment(linkId){
    const l=store.state.links.find(x=>x.id===linkId); if(!l) return;
    store.selType='link'; store.selId=linkId;
    // Se il segmento tocca una porta rack, porta in vista quel rack PRIMA del
    // render (la chassis mostra il rack giusto).
    const _rackPid = win.isRackPort(l.src) ? l.src : (win.isRackPort(l.dst) ? l.dst : null);
    if(_rackPid){
        const _rn = getNodeByPortId(_rackPid);
        if(_rn && typeof win.ensureNodeRackVisible === 'function') win.ensureNodeRackVisible(_rn);
        // Arma l'hold SULLA SELEZIONE: finche' questo link resta selezionato,
        // _activatePropsTab (richiamato da OGNI renderProps) non ri-forza la tab
        // 'props' — altrimenti la tab Rack si richiuderebbe al primo re-render.
        // L'hold a tempo non bastava: un render oltre la finestra riflippava.
        win._propsTabHold = linkId;
    }
    // Render SINCRONO: include renderProps, che via _activatePropsTab forza la
    // tab 'props'. Per questo lo switch a 'rack' va fatto DOPO, come ULTIMA azione
    // (con renderAll coalescato il renderProps girerebbe nel rAF dopo lo switch
    // e lo annullerebbe — era il bug "apre Proprietà invece del Rack").
    win.renderNow();
    if(_rackPid && typeof switchRightTab === 'function'){
        if(win._rightTab !== 'rack') switchRightTab('rack');
        // switchRightTab azzera l'hold (decadimento su cambio tab esplicito):
        // qui il cambio e' NOSTRO, quindi ri-armiamo. Decade quando l'utente
        // cambia selezione o clicca lui una tab.
        win._propsTabHold = linkId;
    }
}

// showCrossRackPop RIMOSSO (2026-06-18): il popup "Collegamento Cross-Rack"
// duplicava il pannello Proprietà. Ora il click su un cavo cross-rack seleziona
// il link e mostra le Proprietà, come per i cavi intra-rack/floor (vedi app.js,
// handler xrHit.onclick).

function _clearLagFocus(){
    if(win._focusedLagGroup||store._focusedLagPorts.size){
        win._focusedLagGroup=null;
        store._focusedLagPorts=new Set();
        renderAll();
    }
}
function closePop(){
    document.getElementById('popup').style.display='none';
    store._lastPopPid = null;
    _clearLagFocus(); // pulisce highlight LAG e fa renderAll solo se necessario
}

/**
 * Per una porta attiva membro LAG senza link diretto, cerca un link "rappresentante"
 * su un'altra porta dello stesso gruppo LAG, così il popup può mostrare la connessione logica.
 */
function _lagRepresentativeConnection(pid){
    const pi = store.state.ports[pid] || {};
    const nodeId = getPortNodeId(pid);
    const gid = String(pi.lagGroup || '').trim();
    const lagId = parseInt(pi.lagId || 0, 10);
    const lagGid = gid || (lagId > 0 ? `snmp-lag-${nodeId}-${lagId}` : '');
    const lagName = lagGid && store.state.lagGroups ? String(store.state.lagGroups[lagGid] || '').trim() : '';
    const lagRefKey = lagGid ? `${nodeId}::${lagGid}` : '';
    if(!lagGid && !lagName) return null;

    let best = null;
    for(const l of store.state.links){
        if(!l) continue;
        let localPid = null, remotePid = null;
        if(getPortNodeId(l.src) === nodeId){ localPid = l.src; remotePid = l.dst; }
        else if(getPortNodeId(l.dst) === nodeId){ localPid = l.dst; remotePid = l.src; }
        else continue;

        const lpi = store.state.ports[localPid] || {};
        const localNodeId = getPortNodeId(localPid);
        const lgid = String(lpi.lagGroup || '').trim();
        const llid = parseInt(lpi.lagId || 0, 10);
        const localLagGid = lgid || (llid > 0 ? `snmp-lag-${localNodeId}-${llid}` : '');
        const lname = localLagGid && store.state.lagGroups ? String(store.state.lagGroups[localLagGid] || '').trim() : '';
        const sameGroup = !!lagGid && !!localLagGid && lagGid === localLagGid;
        const sameLagId = lagId > 0 && llid > 0 && lagId === llid;
        const sameLagName = !!lagName && !!lname && lagName === lname;
        const viaLogical = !!(l.lagLogicalKey && lagRefKey && l.lagLogicalKey.includes(`L:${lagRefKey}`));
        if(!(sameGroup || sameLagId || sameLagName || viaLogical)) continue;

        const score = (l.lagLogicalKey ? 4 : 0)
            + (Array.isArray(l.lagMembers) && l.lagMembers.length ? 1 : 0)
            + (l.autoLinked ? 0.4 : 0.8)
            + (l.confidence || 0)
            + (localPid === pid ? 0.2 : 0);
        if(!best || score > best.score){
            best = { link:l, localPid, remotePid, score };
        }
    }
    return best;
}

function showPop(e,pid){
    if(store.linkStart) win._cancelLink();
    const tempFloor = document.getElementById('temp-link');
    const tempRack = document.getElementById('temp-link-rack');
    if(tempFloor) tempFloor.setAttribute('d','');
    if(tempRack) tempRack.setAttribute('d','');
    store._lastPopPid=pid; store._lastPopX=e.clientX; store._lastPopY=e.clientY;
    const pi=store.state.ports[pid]||{};
    // Evidenzia tutte le porte fisiche del LAG locale/remoto.
    win._focusedLagGroup = null;
    store._focusedLagPorts = new Set();
    win._focusLagForPort(pid);
    const node=getNodeByPortId(pid);
    const isActiveNode = node && !!TYPES[node.type]?.isActive;
    const portNum=pid.split('-').slice(1).join('-');
    const connSet=new Set();
    store.state.links.forEach(l=>_linkAdjacentPorts(l, pid).forEach(other=>connSet.add(other)));
    const conn=[...connSet];
    const lagRepConn = (!conn.length && isActiveNode && (pi.lagGroup || (pi.lagId > 0))) ? _lagRepresentativeConnection(pid) : null;
    const lagBadgeName = (() => {
        const g = String(pi.lagGroup || '').trim();
        if(g && store.state.lagGroups && store.state.lagGroups[g]) return store.state.lagGroups[g];
        const lid = parseInt(pi.lagId || 0, 10);
        const autoGid = (lid > 0 && node?.id) ? `snmp-lag-${node.id}-${lid}` : '';
        if(autoGid && store.state.lagGroups && store.state.lagGroups[autoGid]) return store.state.lagGroups[autoGid];
        return 'LAG';
    })();
    const fmtConnPid = p => {
        const pn=getNodeByPortId(p);
        const rk=win.getRackById(pn?.rackId);
        const base=pn?`${escapeHTML(pn.name)} / P${escapeHTML(p.split('-').slice(1).join('-'))}`:escapeHTML(p);
        const xr=pn&&pn.rackId&&pn.rackId!==store.state.currentRack?` <span style="color:var(--accent)">→ ${escapeHTML(rk?.name||'?')}</span>`:'';
        return base+xr;
    };
    const connText = conn.length
        ? conn.map(fmtConnPid).join(', ')
        : (lagRepConn
            ? `${fmtConnPid(lagRepConn.remotePid)} <span style="color:var(--text-muted);font-size:0.75rem">(${t('pnl.misc.viaMember',{lag:escapeHTML(lagBadgeName),port:escapeHTML(String(lagRepConn.localPid).split('-').slice(1).join('-'))})})</span>`
            : t('pnl.misc.none'));

    // Valori effettivi (override > SNMP > default)
    const effStatus = pi.statusOvr ?? normalizeStatus(pi.status) ?? 'inactive';
    const effVlan   = win._effPortVlan(pid);
    const effSpeed  = pi.speedOvr  ?? pi.speed  ?? null;
    const effDesc   = pi.desc      ?? '';

    // SNMP info bar
    const snmpParts=[];
    if(pi.ifName) snmpParts.push(pi.ifName);
    if(pi.alias&&pi.alias!==pi.ifName) snmpParts.push(pi.alias);
    if(pi.speed){ snmpParts.push(pi.speed>=1000?`${(pi.speed/1000).toFixed(pi.speed%1000?1:0)}G`:`${pi.speed}M`); }
    if(pi.vlan&&pi.vlan>1) snmpParts.push(`VLAN ${pi.vlan}`);
    if(pi.lagId&&pi.lagId>0) snmpParts.push(`LAG ${pi.lagId}`);
    const snmpBar=snmpParts.length?`<div class="snmp-bar"><span class="sb">SNMP</span>${escapeHTML(snmpParts.join(' · '))}</div>`:'';

    // Velocità display
    const spdDisplay=effSpeed!=null?(effSpeed>=1000?`${(effSpeed/1000).toFixed(effSpeed%1000?1:0)}G`:`${effSpeed}M`):'';
    const spdPlaceholder=pi.speed!=null?(pi.speed>=1000?`${(pi.speed/1000).toFixed(pi.speed%1000?1:0)}G`:`${pi.speed}M`):'es. 1G';

    const rst=(f,lbl)=>pi[f]!==undefined&&pi[f]!==null?`<button class="prst" data-tip="${t('pnl.misc.restore',{label:lbl})}" onclick="clearPortField('${pid}','${f}')">↺</button>`:'<span></span>';

    const pop=document.getElementById('popup');
    pop.innerHTML=`
<h4>${escapeHTML(node?node.name:'?')} — ${t('pnl.misc.port')} ${escapeHTML(portNum)}
  <button class="pop-close" onclick="closePop()">✕</button>
</h4>
${snmpBar}
<div class="port-row">
  <label>${t('pnl.misc.status')}</label>
  <select class="${pi.statusOvr?'ovr':''}" onchange="setPortField('${pid}','statusOvr',this.value)">
    <option value="active"   ${effStatus==='active'  ?'selected':''}>ACTIVE</option>
    <option value="idle"     ${effStatus==='idle'    ?'selected':''}>IDLE</option>
    <option value="inactive" ${effStatus==='inactive'?'selected':''}>INACTIVE</option>
    <option value="fault"    ${effStatus==='fault'   ?'selected':''}>FAULT</option>
  </select>
  ${rst('statusOvr',t('pnl.misc.fieldStatus'))}
</div>
<div class="port-row">
  <label>${t('pnl.misc.description')}</label>
  <input value="${escapeHTML(effDesc)}"
         placeholder="${escapeHTML(pi.alias||pi.ifName||t('pnl.misc.descriptionPh'))}"
         onchange="setPortField('${pid}','desc',this.value)">
  <span></span>
</div>
<div class="port-row">
  <label>${t('pnl.misc.speed')}</label>
  <input value="${escapeHTML(spdDisplay)}"
         placeholder="${escapeHTML(spdPlaceholder)}"
         class="${pi.speedOvr!=null?'ovr':''}"
         onchange="setPortSpeed('${pid}',this.value)"
         data-tip="${t('pnl.misc.speedFormat')}">
  ${rst('speedOvr',t('pnl.misc.fieldSpeed'))}
</div>
${(()=>{
    // Cerca il cavo trunk collegato a questa porta per ottenere la lista VLAN
    const tLink = store.state.links.find(l=>_linkTouchesPort(l, pid) && l.mode==='trunk');
    const isTrunk = pi.isTrunk || !!tLink;
    if(isTrunk){
        const vlanStr = tLink?.trunkVlans || (pi.trunkVlans&&pi.trunkVlans.length?win._vlansToRangeStr(pi.trunkVlans):'');
        const vlanNativaRow = isActiveNode
            ? `<div class="port-row">
  <label>${t('pnl.misc.nativeVlan')}</label>
  <input type="number" min="1" max="4094"
         value="${effVlan}"
         class="${pi.vlanOvr!=null?'ovr':''}"
         onchange="setPortField('${pid}','vlanOvr',+this.value||1)"
         data-tip="${t('pnl.misc.nativeVlanTip')}">
  ${rst('vlanOvr','VLAN')}
</div>`
            : `<div class="port-row">
  <label>${t('pnl.misc.nativeVlan')}</label>
  <span style="display:inline-flex;align-items:center;gap:5px;font-weight:600;color:var(--text-main)">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${store.state.vlanColors[effVlan]||'#aaa'};flex-shrink:0"></span>
    VLAN ${effVlan}${store.state.vlanNames[effVlan]?' — '+escapeHTML(store.state.vlanNames[effVlan]):''}
  </span>
  <span></span>
</div>`;
        return `<div class="port-row">
  <label>${t('pnl.misc.mode')}</label>
  <span style="background:#0e2233;border:1px solid #2d6a9f;border-radius:4px;padding:1px 8px;font-size:0.75rem;font-weight:700;color:#5ba3f5">TRUNK</span>
  <span></span>
</div>
${vlanNativaRow}
<div class="port-row">
  <label>${t('pnl.misc.trunkVlan')}</label>
  <span style="font-family:monospace;font-size:0.82rem;color:var(--text-main)">${vlanStr||`<span style="color:var(--text-muted);font-style:italic">${t('pnl.misc.seeCable')}</span>`}</span>
  <span></span>
</div>`;
    } else {
        if(isActiveNode){
            return `<div class="port-row">
  <label>VLAN</label>
  <input type="number" min="1" max="4094"
         value="${effVlan}"
         class="${pi.vlanOvr!=null?'ovr':''}"
         onchange="setPortField('${pid}','vlanOvr',+this.value||1)">
  ${rst('vlanOvr','VLAN')}
</div>`;
        } else {
            return `<div class="port-row">
  <label>VLAN</label>
  <span style="display:inline-flex;align-items:center;gap:5px;font-weight:600;color:var(--text-main)">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${store.state.vlanColors[effVlan]||'#aaa'};flex-shrink:0"></span>
    VLAN ${effVlan}${store.state.vlanNames[effVlan]?' — '+escapeHTML(store.state.vlanNames[effVlan]):''}
  </span>
  <span></span>
</div>`;
        }
    }
})()}
<div class="pop-conn">${t('pnl.misc.connectedTo')} ${connText}</div>
${win._sharedSegmentHtml(pid,'popup')}
${(()=>{
    const portNode=getNodeByPortId(pid);
    const isActive=portNode&&TYPES[portNode.type]?.isActive;
    const gid=(store.state.ports[pid]||{}).lagGroup;
    if(isActive){
        if(gid){
            const gname=escapeHTML(store.state.lagGroups&&store.state.lagGroups[gid]?store.state.lagGroups[gid]:'LAG');
            return `<div style="border-top:1px solid #30363d;margin-top:6px;padding-top:6px;display:flex;align-items:center;gap:6px">
              <span style="color:#00d4ff;font-size:0.76rem;font-weight:600">⛓ ${gname}</span>
              <button class="toolbar-btn danger" style="padding:2px 7px;font-size:0.72rem;margin:0" onclick="removePortFromLag('${pid}');closePop()">${t('pnl.misc.remove')}</button>
            </div>`;
        } else {
            return `<div style="border-top:1px solid #30363d;margin-top:6px;padding-top:6px">
              <button class="toolbar-btn" style="width:100%;font-size:0.75rem;padding:4px 8px" onclick="startLagMode('${pid}')">⛓ ${t('pnl.misc.addToLag')}</button>
            </div>`;
        }
    } else {
        // dispositivo passivo — mostra info se il cavo trasporta un LAG
        const info=win.getPassivePortLagInfo(pid);
        if(info){
            return `<div style="border-top:1px solid #30363d;margin-top:6px;padding-top:6px;display:flex;align-items:center;gap:6px;font-size:0.72rem;color:#8b949e">
              <span style="color:#00d4ff">🔗</span>
              <span>${t('pnl.misc.pathVia',{path:`<strong style="color:#00d4ff">${escapeHTML(info.gname)}</strong>`,node:escapeHTML(info.nodeName)})}</span>
            </div>`;
        }
        return '';
    }
})()}`;

    pop.style.display='block';
    pop.style.left=Math.min(e.clientX+16,window.innerWidth-345)+'px';
    // Calcola altezza reale dopo il render, poi riposiziona se serve
    pop.style.top=(e.clientY+16)+'px';
    const ph=pop.offsetHeight||320;
    pop.style.top=Math.min(e.clientY+16, window.innerHeight-ph-8)+'px';
}



// ============================================================
// TOPOLOGIA AUTOMATICA — LLDP / CDP  (layer integrato)
// ============================================================

store._topoData    = null;   // { nodes[], edges[] } — ultimo grafo rilevato  (var: letto/scritto dal bundle src/app-topology-discover.js via win.*)
store._topoVisible = false;  // overlay attivo sulla planimetria              (var: idem)
store._viewMode    = 'map';  // 'map' | 'topology'                           (var: idem)
win._physicalTraceActive = false; // in topologia mostra il cablaggio fisico solo su richiesta  (var: letto dal bundle src/app-topology-overlay.js via win.*)
// Cache FDB (MAC table) degli switch, popolata durante poll/topology.
// { switchNodeId: { "aa:bb:cc:dd:ee:ff": "GigabitEthernet1", ... } }
// Usata da _autoLinkEndpoint per collegare un endpoint senza ri-pollare gli switch.
store._topoFdbCache = {};   // var: letto dal bundle src/app-discovery.js via store._topoFdbCache
// Cache parallela VLAN-per-MAC (stessa chiave _normMacKey di store._topoFdbCache):
// { [nodeId]: { [normMac]: vlanId } }. Riempita dal poll quando lo switch
// restituisce la Q-BRIDGE FDB VLAN-aware. Consumata dal Drift Report per
// classificare i device su VLAN guest (best-effort, degrada se assente).
win._topoFdbVlanCache = {};
// Cache neighbors LLDP/CDP per switch, popolata in _autoDiscoverLinks durante sync.
// { switchNodeId: { ts, deviceHostname, deviceIP, neighbors[] } }
// Usata da discoverTopology per evitare di rifare le chiamate /api/topology
// quando l'utente preme il pulsante Topologia dopo un Sync SNMP recente.
// Invalidazione: tasto destro sul pulsante (force refresh).
store._topoNeighborsCache = {};   // var: letto/scritto dal bundle src/app-topology-discover.js via win.*
win._topoTipTimer= null;   // timer per nascondere il tooltip  (var: letto/scritto dal bundle src/app-topology-overlay.js via win.*)
win._hoverRackId = null;   // rack ID in hover sulla planimetria (proposta C)  (var: letto dal bundle via win.*)
store._filterVlan  = null;   // VLAN ID attivo come filtro visuale (null = nessun filtro)  (var: idem)
store._topoTrunkOnly = false; // toggle legenda: evidenzia i TRUNK (attenua il resto)  (store: ex win.*)
win._topoHideEndpoints = false; // toggle legenda: nasconde le linee verso gli endpoint  (var: idem)
win._topoHideWireless = false;  // toggle legenda: nasconde le connessioni wireless (onde)  (var: idem)

// Toggle "Trunk" della legenda topologia: evidenzia le linee trunk attenuando
// le altre (stesso modello interattivo del filtro VLAN, stato di sessione).
function toggleTopoTrunkFilter(){
    store._topoTrunkOnly = !store._topoTrunkOnly;
    renderTopoOverlay();   // ridisegna linee + legenda (la legenda e' dentro il render)
    renderCables();        // in topologia i cavi trunk compaiono/spariscono anche nel RACK (shouldRenderLink)
}

// Toggle "Endpoint" della legenda topologia: nasconde le linee verso gli
// endpoint (fan-out floor↔rack + coppie floor↔floor) per ridurre la confusione,
// lasciando il backbone rack↔rack. Stato di sessione.
function toggleTopoEndpointFilter(){
    win._topoHideEndpoints = !win._topoHideEndpoints;
    // I nodi endpoint si nascondono via CSS (la regola e' gia' gated su
    // .view-topology, quindi in mappa non ha effetto anche se la classe resta).
    document.body.classList.toggle('topo-hide-endpoints', win._topoHideEndpoints);
    renderTopoOverlay();   // le linee verso gli endpoint le toglie buildTopoLines
}

// Toggle "WLAN" della legenda topologia: nasconde tutte le connessioni wireless
// (le onde) — pairs floor↔floor e fan-out marcati wireless. Stato di sessione.
function toggleTopoWlanFilter(){
    win._topoHideWireless = !win._topoHideWireless;
    renderTopoOverlay();   // le onde le toglie buildTopoLines (filtro hideWireless)
}

function _applyViewMode(){
    document.body.classList.toggle('view-topology', store._viewMode==='topology');
    document.body.classList.toggle('view-map', store._viewMode==='map');
    if(store._viewMode!=='topology') win._physicalTraceActive=false;
    document.body.classList.toggle('physical-trace-active', win._physicalTraceActive);
    win._updateFloorToolbarVisibility();
    renderTopoOverlay();
    renderAll();
}

/** Restituisce "ID – Nome" se la VLAN ha un nome, altrimenti solo "ID". */
function _vlanLabel(id){ const n=store.state.vlanNames?.[id]; return n?`${id} – ${n}`:`${id}`; }

/**
 * Restituisce true se il nodo floor sarebbe nascosto dal filtro VLAN attivo.
 * Usato per nascondere i cavi collegati a nodi non visibili.
 */
/** True se esiste almeno un cavo tra i due rack che appartiene alla VLAN filtro. */
function _rackPairMatchesVlan(rackAId, rackBId){
    if(!store._filterVlan) return true;
    const rANids=new Set(store.state.nodes.filter(n=>n.rackId===rackAId&&TYPES[n.type]?.isRack).map(n=>n.id));
    const rBNids=new Set(store.state.nodes.filter(n=>n.rackId===rackBId&&TYPES[n.type]?.isRack).map(n=>n.id));
    return store.state.links.some(l=>{
        const ls=getPortNodeId(l.src), ld=getPortNodeId(l.dst);
        if(!((rANids.has(ls)&&rBNids.has(ld))||(rBNids.has(ls)&&rANids.has(ld)))) return false;
        return _linkMatchesVlanFilter(l);
    });
}

function _floorNodeHiddenByVlan(nid){
    if(!store._filterVlan) return false;
    const n=nodeById(nid); if(!n) return false;
    const def=TYPES[n.type];
    if(!def?.isFloor||def?.isStructural) return false;
    const pc=n.ports!==undefined?n.ports:def.ports;
    for(let i=1;i<=pc;i++){
        const pid=`${n.id}-${i}`;
        // Porta access: controlla la VLAN effettiva di questa porta (propagata dal BFS)
        const eff=win._effPortVlan(pid);
        if(eff===store._filterVlan) return false;
        // Porta trunk: controlla se questa porta trasporta la VLAN filtro
        if(_linksForPort(pid).some(lk=>
            lk.mode==='trunk'
            &&win._parseTrunkVlans(lk.trunkVlans||'').includes(store._filterVlan))) return false;
    }
    return true; // nessuna porta del nodo è in questa VLAN → nasconde nodo e suoi cavi
}

/**
 * VLAN effettiva di un cavo access.
 * Legge da ENTRAMBE le porte e usa il valore più autorevole:
 *   vlanOvr (override manuale) > vlan (SNMP) > vlanProp (BFS) > 1.
 * Necessario perché il cavo può essere stato disegnato in qualsiasi direzione
 * (es. patch-panel→switch o switch→patch-panel) — la VLAN autorevole
 * sta sempre sullo switch, non sulla porta sorgente del link.
 */
function _getLinkVlan(l){
    const sp=store.state.ports[l.src]||{};
    const dp=store.state.ports[l.dst]||{};
    const sActive=!!TYPES[getNodeByPortId(l.src)?.type]?.isActive;
    const dActive=!!TYPES[getNodeByPortId(l.dst)?.type]?.isActive;
    // Gerarchia di autorevolezza (identica a propagateVlans). Lo switch comanda:
    // l'override/vlan di una porta PASSIVA NON prevale mai sulla propagazione.
    // 1. override manuale su porta ATTIVA (switch/router): autorità massima
    if(sActive&&sp.vlanOvr>0) return sp.vlanOvr;
    if(dActive&&dp.vlanOvr>0) return dp.vlanOvr;
    // 2. vlan SNMP di una porta ATTIVA
    if(sActive&&sp.vlan>0) return sp.vlan;
    if(dActive&&dp.vlan>0) return dp.vlan;
    // 3. vlan propagata dallo switch a monte verso le porte passive
    if(sp.vlanProp>0) return sp.vlanProp;
    if(dp.vlanProp>0) return dp.vlanProp;
    // 4. override manuale su porta passiva (solo catene senza dispositivo attivo)
    if(sp.vlanOvr>0) return sp.vlanOvr;
    if(dp.vlanOvr>0) return dp.vlanOvr;
    // 5. fallback: vlan statica residua su una porta passiva
    if(sp.vlan>0) return sp.vlan;
    if(dp.vlan>0) return dp.vlan;
    // 6. nessuna VLAN documentata → nativa predefinita di sito (default 1)
    return (typeof win._siteNativeVlan==='function') ? win._siteNativeVlan() : 1;
}

/** Restituisce true se il link appartiene alla VLAN filtro attiva. */
function _linkMatchesVlanFilter(l){
    if(!store._filterVlan) return true;
    if(l.mode==='trunk'){
        return win._parseTrunkVlans(l.trunkVlans||'').includes(store._filterVlan);
    }
    // Usa _getLinkVlan — stessa funzione che colora i cavi, già gestisce
    // vlan=0 (salta valori non positivi), gerarchia attivo > propagato > passivo.
    return _getLinkVlan(l)===store._filterVlan;
}

// ---- Colori per tipo floor node (usati SOLO dall'export SVG/PDF planimetria;
// sul canvas i floor node sono a colore uniforme via CSS) -----------------------
const _FLOOR_COLOR = { wallport:'#e8a838', ap:'#5ba3f5', webcam:'#f56565', customfloor:'#a78bfa', doorctrl:'#22c55e', panelboard:'#e3a008' };
function _floorNodeColor(type){ return _FLOOR_COLOR[type]||'#8b949e'; }

// Abbreviazioni e codepoint FA 6 Solid per export SVG.
// NB: la SCELTA del glifo per-tipo è in TYPES[type].icon (app-types.js, fonte
// unica per l'icona DOM). Questa tabella è la controparte UNICODE necessaria a
// rendere lo stesso glifo nel testo SVG/canvas: tenere i codepoint allineati a
// TYPES[].icon (qui sotto sono già riconciliati).
const _SVG_DEV = {
    wallport:    { ab:'WP',  fa:0xF796 }, // fa-ethernet
    ap:          { ab:'AP',  fa:0xF1EB }, // fa-wifi
    webcam:      { ab:'CAM', fa:0xF03D }, // fa-video
    printer:     { ab:'PRT', fa:0xF02F }, // fa-print
    voip:        { ab:'TEL', fa:0xF095 }, // fa-phone
    badgereader: { ab:'BDG', fa:0xF2C2 }, // fa-id-card
    pc:          { ab:'PC',  fa:0xF108 }, // fa-desktop
    iot:         { ab:'IOT', fa:0xF2DB }, // fa-microchip
    projector:   { ab:'PRJ', fa:0xF51B }, // fa-chalkboard
    tv:          { ab:'TV',  fa:0xF26C }, // fa-tv
    customfloor: { ab:'EP',  fa:0xF1B2 }, // fa-cube
    doorctrl:    { ab:'DOR', fa:0xF52B }, // fa-door-open
    panelboard:  { ab:'QEL', fa:0xF0E7 }, // fa-bolt
    switch:   { ab:'SW',  fa:0xF6FF }, // fa-network-wired
    router:   { ab:'RT',  fa:0xF4D7 }, // fa-route
    firewall: { ab:'FW',  fa:0xF3ED }, // fa-shield-halved
    server:   { ab:'SRV', fa:0xF233 }, // fa-server
    nas:      { ab:'NAS', fa:0xF0A0 }, // fa-hdd
    blankpanel:{ ab:'BLK', fa:0xF068 }, // fa-minus
    cablemanager:{ ab:'CM', fa:0xF7A4 }, // fa-grip-lines
    ups:      { ab:'UPS', fa:0xF5DF }, // fa-car-battery
    kvm:        { ab:'KVM', fa:0xF11C }, // fa-keyboard
    pdu:        { ab:'PDU', fa:0xF1E6 }, // fa-plug
    ats:        { ab:'ATS', fa:0xF074 }, // fa-shuffle
    pbx:        { ab:'PBX', fa:0xF2A0 }, // fa-phone-volume
    consolesvr: { ab:'CON', fa:0xF120 }, // fa-terminal
    wlanctrl:   { ab:'WLC', fa:0xF519 }, // fa-tower-broadcast
    mediaconv:  { ab:'MCN', fa:0xF362 }, // fa-right-left
    nvr:        { ab:'NVR', fa:0xF8D9 }, // fa-record-vinyl
    sdwan:      { ab:'SDW', fa:0xF76C }, // fa-cloud-bolt
    vpncon:     { ab:'VPN', fa:0xF505 }, // fa-user-shield
    customrack: { ab:'DEV', fa:0xF1B2 }, // fa-cube
};

// ---- Punto sul bordo rettangolare (ray-AABB) --------------------------------
// cx,cy = centro; hw,hh = semi-dimensioni; vx,vy = direzione (non normalizzata)
function _rectEdge(cx, cy, hw, hh, vx, vy){
    if(!vx && !vy) return [cx, cy];
    const tx = vx ? hw/Math.abs(vx) : Infinity;
    const ty = vy ? hh/Math.abs(vy) : Infinity;
    const t  = Math.min(tx, ty);
    return [cx + vx*t, cy + vy*t];
}

// ---- Link tra un rack e i floor node sulla planimetria ----------------------
function _getRackFloorLinks(rackId){
    const result=[];
    const rackNids=new Set(store.state.nodes.filter(n=>n.rackId===rackId&&TYPES[n.type]?.isRack).map(n=>n.id));
    for(const link of store.state.links){
        const sNid=getPortNodeId(link.src), dNid=getPortNodeId(link.dst);
        const sn=nodeById(sNid), dn=nodeById(dNid);
        if(!sn||!dn) continue;
        let rackNode,floorNode,rPortId,fPortId;
        if(rackNids.has(sNid)&&TYPES[dn.type]?.isFloor&&!TYPES[dn.type]?.isStructural){
            rackNode=sn; floorNode=dn; rPortId=link.src; fPortId=link.dst;
        } else if(rackNids.has(dNid)&&TYPES[sn.type]?.isFloor&&!TYPES[sn.type]?.isStructural){
            rackNode=dn; floorNode=sn; rPortId=link.dst; fPortId=link.src;
        } else continue;
        if(floorNode.x===undefined||floorNode.y===undefined) continue;
        const rPortName=win._portDisplayName(rPortId);
        const fPortName=win._portDisplayName(fPortId)||floorNode.name||typeName(floorNode.type);
        result.push({link,rackNode,floorNode,rPortId,fPortId,rPortName,fPortName});
    }
    return result;
}

// ---- Disegna UNA linea fan-out rack → floor node dal descrittore -------------
// Il COSA (quali link, colore, enfasi, interattivita', filtro VLAN) e' deciso
// da buildTopoLines (lib/topo-lines.js, pura/testata); qui solo ancoraggio
// alle dimensioni DOM, SVG ed eventi.
function _drawFanoutLineDesc(d, svg, NS, els){
    const elR=els?.racks.get(d.rackId);
    const hwR=elR?elR.offsetWidth/2+4:50, hhR=elR?elR.offsetHeight/2+4:35;
    const vx=d.fx-d.rx, vy=d.fy-d.ry;
    const [x1,y1]=_rectEdge(d.rx,d.ry,hwR,hhR,vx,vy);
    const elF=els?.nodes.get(d.floorNodeId);
    const hwF=elF?elF.offsetWidth/2+2:30, hhF=elF?elF.offsetHeight/2+2:30;
    let [x2,y2]=_rectEdge(d.fx,d.fy,hwF,hhF,-vx,-vy);
    // Wireless: l'estremo floor parte dall'ANCORA della radio associata (d.fPortId).
    if(d.wireless && elF && typeof win.parseRadioPid==='function'){
        const pr=win.parseRadioPid(d.fPortId);
        const cnt=(typeof win.radioCount==='function')?win.radioCount(nodeById(d.floorNodeId)):0;
        const v=(pr && typeof win.radioAnchorVector==='function')?win.radioAnchorVector(pr.idx,cnt):null;
        if(v){ x2=d.fx+v[0]*hwF; y2=d.fy+v[1]*hhF; }
    }

    // Linea visibile. Toggle TRUNK attivo → le non-trunk si attenuano (trunkDim).
    const baseOp = d.trunkDim ? 0.12 : d.opacity;
    // Wireless: linea "a onda" (path sinusoidale) invece di retta.
    const _wl = d.wireless && typeof win.buildWavePath === 'function';
    const line=document.createElementNS(NS, _wl ? 'path' : 'line');
    if(_wl){ line.setAttribute('d', win.buildWavePath(x1,y1,x2,y2,{ amplitude:4, wavelength:20 })); line.setAttribute('fill','none'); }
    else { line.setAttribute('x1',x1); line.setAttribute('y1',y1); line.setAttribute('x2',x2); line.setAttribute('y2',y2); }
    line.setAttribute('stroke',d.color);
    line.setAttribute('stroke-width',d.width);   // niente ingrossamento su selezione: basta il glow (tfl-hl)
    line.setAttribute('stroke-linecap','round');
    line.setAttribute('opacity',(d.selected && !d.trunkDim)?'1':String(baseOp));
    line.setAttribute('class',`tfl topo-selected-cable${d.ambiguous?' tfl-ambiguous':''}${_wl?' tfl-wireless':''}`);
    line.dataset.linkId=d.linkId;
    line.setAttribute('style',`pointer-events:none;color:${d.color}`);   // color = stroke → glow del colore del cavo (tfl-hl)

    // Linee NON interattive (rack non corrente): solo visive, niente hit →
    // non intercettano il pointerdown e NON bloccano il drag dei rack.
    if(!d.interactive){
        const g0=document.createElementNS(NS,'g');
        g0.appendChild(line);
        svg.appendChild(g0);
        return;
    }
    // Hit area invisibile più larga
    const hit=document.createElementNS(NS,'line');
    hit.setAttribute('x1',x1); hit.setAttribute('y1',y1);
    hit.setAttribute('x2',x2); hit.setAttribute('y2',y2);
    hit.setAttribute('stroke','transparent');
    hit.setAttribute('stroke-width','14');
    hit.setAttribute('style','pointer-events:visibleStroke;cursor:pointer');
    hit.dataset.linkId=d.linkId;
    // Dati tooltip
    const td={
        srcName:d.srcName, dstName:d.dstName,
        srcPort:d.rPortName, dstPort:d.fPortName, color:d.color,
        linkId:d.linkId,
        srcPid:d.rPortId,
        dstPid:d.fPortId,
        nodeType:d.nodeTypeName,
        mode:d.mode,
        vlan:d.vlan,
        trunkVlans:d.trunkVlans
    };
    hit.addEventListener('pointerenter',ev=>{
        clearTimeout(win._topoTipTimer);
        _showFloorLinkTip(ev,td);
        line.setAttribute('opacity','1');
        line.classList.add('tfl-hl');   // glow su hover (niente ingrossamento)
    });
    hit.addEventListener('pointermove',ev=>{
        const tip=document.getElementById('topo-tip');
        if(tip&&tip.style.display!=='none'&&tip.dataset.userPlaced!=='1'){
            tip.style.left=(ev.clientX+14)+'px'; tip.style.top=(ev.clientY-10)+'px';
            requestAnimationFrame(()=>{
                const r=tip.getBoundingClientRect();
                if(r.right>window.innerWidth-8) tip.style.left=(ev.clientX-r.width-14)+'px';
                if(r.bottom>window.innerHeight-8) tip.style.top=(ev.clientY-r.height+10)+'px';
            });
        }
    });
    hit.addEventListener('pointerleave',()=>{
        win._topoTipTimer=setTimeout(_hideTopoTip,300);
        line.setAttribute('opacity',String(baseOp));
        line.classList.remove('tfl-hl');
    });
    hit.addEventListener('pointerdown',ev=>ev.stopPropagation());
    hit.addEventListener('click',ev=>{
        ev.stopPropagation();
        _showFloorLinkTip(ev,td);
    });
    // Doppio click → percorso fisico del cavo (coerente con le linee inter-rack).
    hit.addEventListener('dblclick',ev=>{
        ev.stopPropagation(); ev.preventDefault();
        if(td.linkId && typeof _showPhysicalCablePath==='function') _showPhysicalCablePath(td.linkId);
    });
    const g=document.createElementNS(NS,'g');
    g.appendChild(line); g.appendChild(hit);
    svg.appendChild(g);
}

// ---- Tooltip per link rack → floor node ------------------------------------
function _showFloorLinkTip(ev,td){
    const tip=document.getElementById('topo-tip'); if(!tip) return;
    const modeBadge = td.mode==='trunk'
        ? `<span style="background:#0e2233;border:1px solid #2d6a9f;border-radius:4px;padding:1px 7px;font-size:0.68rem;font-weight:700;color:#5ba3f5">TRUNK</span>`
          + (td.trunkVlans ? `<span style="color:var(--text-muted);font-size:0.7rem;margin-left:6px">VLAN ${escapeHTML(td.trunkVlans)}</span>` : '')
        : `<span style="background:#10241a;border:1px solid #2c6a45;border-radius:4px;padding:1px 7px;font-size:0.68rem;font-weight:700;color:#5fbf83">ACCESS</span>`
          + `<span style="color:var(--text-muted);font-size:0.7rem;margin-left:6px">VLAN ${escapeHTML(td.vlan)}</span>`;
    let h=`<div class="topotip-header">
        <span class="topotip-proto" style="background:${td.color}">${escapeHTML(td.nodeType)}</span>
        <span class="topotip-ok">✓ ${t('pnl.misc.connected')}</span>
    </div>
    <div class="topotip-racks"><b>${escapeHTML(td.srcName)}</b> → <b>${escapeHTML(td.dstName)}</b></div>
    <div class="topotip-link" style="margin-top:4px">${escapeHTML(td.srcPort)} <span>↔</span> ${escapeHTML(td.dstPort)}</div>
    <div style="margin-top:5px">${modeBadge}</div>
    <div class="topotip-hint"><i class="fas fa-route"></i> ${t('pnl.misc.dblClickPhysicalPath')}</div>`;
    tip.innerHTML=h; tip.style.display='block'; tip.dataset.userPlaced='0';
    tip.style.left=(ev.clientX+14)+'px'; tip.style.top=(ev.clientY-10)+'px';
    requestAnimationFrame(()=>{
        const r=tip.getBoundingClientRect();
        if(r.right>window.innerWidth-8) tip.style.left=(ev.clientX-r.width-14)+'px';
        if(r.bottom>window.innerHeight-8) tip.style.top=(ev.clientY-r.height+10)+'px';
    });
}

function _showTopoTip(ev,td){
    const tip=document.getElementById('topo-tip'); if(!tip) return;
    // startsWith: copre anche le label fuse GAP1 ('CDP+MAC' resta arancio)
    const pc=String(td.protocol||'').startsWith('CDP')?'#ff8c00':td.protocol==='Manual'?'#39d353':'#00aaff';
    let h=`<div class="topotip-header"><span class="topotip-proto" style="background:${pc}">${td.protocol}</span>`;
    if(td.confirmed) h+=`<span class="topotip-ok">&#10003; ${t('pnl.misc.inProject')}</span>`;
    h+=`</div><div class="topotip-racks"><b>${escapeHTML(td.srcName)}</b> &harr; <b>${escapeHTML(td.dstName)}</b></div>`;
    td.edges.slice(0,4).forEach(e=>{
        h+=`<div class="topotip-link">${escapeHTML(e.srcPort||'?')} <span>&harr;</span> ${escapeHTML(e.dstPort||'?')}</div>`;
    });
    if(td.edges.length>4) h+=`<div class="topotip-more">${t('pnl.misc.moreN',{n:td.edges.length-4})}</div>`;
    const firstLink=td.edges.find(e=>e.linkId)?.linkId||'';
    if(firstLink) h+=`<div class="topotip-hint"><i class="fas fa-route"></i> ${t('pnl.misc.dblClickPhysicalPath')}</div>`;
    h+=`<div class="topotip-btns">`;
    if(!td.confirmed) h+=`<button class="toolbar-btn" onclick="_createTopoLink('${td.pairKey}')"><i class="fas fa-plug"></i> ${t('pnl.misc.createCable')}</button>`;
    if(td.rackAId) h+=`<button class="toolbar-btn" onclick="navigateToRack('${td.rackAId}')">&rarr; ${escapeHTML(td.srcName)}</button>`;
    if(td.rackBId) h+=`<button class="toolbar-btn" onclick="navigateToRack('${td.rackBId}')">&rarr; ${escapeHTML(td.dstName)}</button>`;
    h+=`</div>`;
    tip.innerHTML=h; tip.style.display='block'; tip.dataset.userPlaced='0';
    tip.style.left=(ev.clientX+14)+'px'; tip.style.top=(ev.clientY-10)+'px';
    requestAnimationFrame(()=>{
        const r=tip.getBoundingClientRect();
        if(r.right >window.innerWidth -8) tip.style.left=(ev.clientX-r.width-14)+'px';
        if(r.bottom>window.innerHeight-8) tip.style.top =(ev.clientY-r.height+10)+'px';
    });
}

function _hideTopoTip(){
    if(win._dragModalState?.panel?.id === 'topo-tip') return;
    const t=document.getElementById('topo-tip');
    if(t) t.style.display='none';
}

expose({
    _findProjectLinkByPorts, _showPhysicalCablePath, selectPathSegment, closePop, showPop,
    toggleTopoTrunkFilter, toggleTopoEndpointFilter, toggleTopoWlanFilter, _applyViewMode,
    _vlanLabel, _rackPairMatchesVlan, _floorNodeHiddenByVlan, _getLinkVlan, _linkMatchesVlanFilter,
    _floorNodeColor, _rectEdge, _getRackFloorLinks, _drawFanoutLineDesc, _showTopoTip, _hideTopoTip,
    _SVG_DEV, _lagRepresentativeConnection,
});
