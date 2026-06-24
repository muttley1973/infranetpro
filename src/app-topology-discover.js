import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { nodeById, markDirty, getPortNodeId, pushHistory, renderCables, _showToast } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderTopoOverlay } from './app-topology-overlay.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { showAlert } from './app-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// ============================================================
// TOPOLOGIA — discovery e grafo (glue estratto da app.js, R7)
// ============================================================
// Sessione topologia per-progetto, pulsante header, discoverTopology (fetch
// neighbors LLDP/CDP), costruzione grafo, creazione cavi dai pair suggeriti,
// highlight e applyTopologyToProject. Condivide lo scope globale con app.js.
// Il rendering dell'overlay vive in lib/app-topology-overlay.js (R4);
// il crawl multi-hop in lib/app-topology-crawl.js.
// ---- Pulsante header --------------------------------------------------------

// Sessione topologia del progetto corrente (manual-first):
// - la cache neighbors LLDP/CDP viaggia COL PROGETTO (store.state.topoCache): qui
//   viene ri-agganciata alla variabile di sessione come STESSO oggetto, cosi'
//   i Sync successivi aggiornano automaticamente anche la copia salvata e alla
//   riapertura la topologia e' subito disponibile (eta' dichiarata nel toast).
// - grafo e visibilita' vengono azzerati: appartenevano al progetto precedente.
// Chiamata dopo ogni assegnazione di `state` (load/new/duplicate/import).
function _restoreTopoSession(){
    if(!store.state.topoCache || typeof store.state.topoCache !== 'object' || Array.isArray(store.state.topoCache)) store.state.topoCache = {};
    store._topoNeighborsCache = store.state.topoCache;
    store._topoData = null;
    if(store._topoVisible){
        store._topoVisible = false;
        store._viewMode = 'map';
        if(typeof win._applyViewMode === 'function') win._applyViewMode();
    }
    if(typeof _refreshTopoBtnState === 'function') _refreshTopoBtnState();
}

function toggleTopology(){
    if(store._topoVisible){
        store._topoVisible=false;
        store._viewMode='map';
        _setTopoBtn('off');
        win._applyViewMode();
        return;
    }
    if(store._topoData){
        store._topoVisible=true;
        store._viewMode='topology';
        _setTopoBtn('on');
        win._applyViewMode();
        return;
    }
    discoverTopology(false);
}

function _setTopoBtn(st, meta){
    const btn=document.getElementById('btn-topology'); if(!btn) return;
    // Manual-first: 'stale' e' solo un hint visivo (dati SNMP vecchi/assenti),
    // il bottone resta cliccabile — la topologia si apre sempre dal cablaggio
    // documentato. Disabilitato solo durante il discovering.
    btn.disabled=(st==='discovering');
    // Pallino di stato = freschezza dei dati SNMP che alimentano la topologia
    // (verde fresco / giallo invecchiando / rosso vecchio / grigio assenti),
    // con l'eta' SEMPRE nel tooltip. Coerente col chip "Sync Xm fa" in toolbar.
    const ts = (meta && meta.ts) || (typeof win._lastSnmpSyncTs === 'function' ? win._lastSnmpSyncTs() : 0);
    const f = (typeof win._snmpFreshness === 'function') ? win._snmpFreshness(ts) : { txt:'', color:'#8b949e', level:'none' };
    const dot = `<span class="topo-fresh-dot" style="background:${f.color}"></span>`;
    // La gestione visible/mode-interactive della legenda e' delegata a
    // win._renderTopoLegend (chiamato da _renderAllNow). Qui forziamo un re-render
    // quando lo stato del bottone cambia, cosi' titolo/interattivita' si allineano.
    // Label/titoli via i18n: _setTopoBtn riscrive innerHTML (cancella il
    // data-i18n statico), quindi qui DEVE usare t() per restare bilingue.
    const _lbl = (typeof t==='function') ? t('topology.label') : ' Topologia';
    const _T = (k,v) => (typeof t==='function') ? t(k,v) : k;
    if(st==='on'){
        btn.className='toolbar-btn primary';
        btn.innerHTML=`<i class="fas fa-project-diagram"></i>${_lbl} <i class="fas fa-eye" style="font-size:0.7rem;margin-left:3px;opacity:.85"></i>`;
        btn.setAttribute('data-tip', _T('topology.titleOn',{f:f.txt}));
    } else if(st==='discovering'){
        btn.className='toolbar-btn';
        btn.innerHTML=`<i class="fas fa-spinner fa-spin"></i>${_lbl}…`;
        btn.setAttribute('data-tip', _T('topology.titleDiscovering'));
    } else if(st==='stale'){
        btn.className='toolbar-btn';
        btn.innerHTML=`<i class="fas fa-project-diagram"></i>${_lbl} ${dot}`;
        const _d = f.level==='none' ? _T('topology.dataAbsent') : _T('topology.dataOf',{f:f.txt});
        btn.setAttribute('data-tip', _T('topology.titleStale',{d:_d}));
    } else {
        btn.className='toolbar-btn';
        btn.innerHTML=`<i class="fas fa-project-diagram"></i>${_lbl} ${dot}`;
        btn.setAttribute('data-tip', _T('topology.titleDefault',{f:f.txt}));
    }
    if(typeof win._renderTopoLegend === 'function') win._renderTopoLegend();
}

// Decide lo stato del pulsante topologia in base alla cache neighbors:
// - 'on': topologia gia' visibile
// - default: cache SNMP fresca (< TTL) per tutti i target raggiungibili
// - 'stale': dati SNMP assenti/vecchi — SOLO hint visivo (icona attenuata),
//   il bottone resta cliccabile: la topologia si apre comunque dal cablaggio
//   documentato (manual-first), il Sync serve ad aggiornare il layer LLDP/CDP.
function _refreshTopoBtnState(){
    if(typeof win._renderSyncFreshness === 'function') win._renderSyncFreshness();  // chip toolbar (#1)
    if(store._topoVisible){ _setTopoBtn('on'); return; }
    const targets = store.state.nodes.filter(n => {
        const cfg = n.integration || {};
        return (cfg.driver||'').startsWith('snmp') && !!((cfg.host||n.ip||'').trim());
    });
    if(!targets.length){ _setTopoBtn('stale'); return; }
    const now = Date.now();
    const cacheableTargets = targets.filter(n => n.snmpStatus !== 'err');
    const tss = cacheableTargets.map(n => store._topoNeighborsCache[n.id]?.ts).filter(Boolean);
    const oldestTs = tss.length ? Math.min(...tss) : 0;
    const cacheValid = cacheableTargets.length > 0 && cacheableTargets.every(n => {
        const c = store._topoNeighborsCache[n.id];
        return c && (now - c.ts) < _TOPO_CACHE_TTL_MS;
    });
    _setTopoBtn(cacheValid ? 'off' : 'stale', { ts: oldestTs });
}

// ---- Discovery --------------------------------------------------------------

// TTL della cache neighbors: oltre questo limite il pulsante Topologia mostra
// l'hint visivo 'stale' (icona attenuata). NON blocca piu' nulla: la vista si
// apre comunque (manual-first), la cache vecchia viene usata con eta' nel toast.
const _TOPO_CACHE_TTL_MS = 60 * 60 * 1000;   // 60 minuti

async function discoverTopology(force=false){
    if(!force && store._topoData){
        // dati già disponibili: semplice toggle visibilità
        store._topoVisible=!store._topoVisible;
        store._viewMode=store._topoVisible?'topology':'map';
        _setTopoBtn(store._topoVisible?'on':'off');
        win._applyViewMode();
        return;
    }

    const targets=store.state.nodes.filter(n=>{
        const cfg=n.integration||{};
        if(!(cfg.driver||'').startsWith('snmp')) return false;
        return !!((cfg.host||n.ip||'').trim());
    });
    if(!store.state.racks.some(r=>r.x!==undefined)){
        _showToast(t('msg.net.placeRack'),'warn',4500);
    }

    // ---- MANUAL-FIRST (principio "manuale ha sempre priorita'"): la vista
    // topologia si apre SEMPRE. I cavi documentati a mano (store.state.links,
    // passate 2-3 del pairMap) bastano a disegnarla; il layer SNMP (LLDP/CDP/
    // MAC) e' un arricchimento: si usa la cache di QUALSIASI device che la
    // possiede (parziale ok, eta' dichiarata nel toast), senza il vecchio
    // vincolo tutto-o-niente che bloccava la vista appena un device era nuovo
    // o senza dati. Il Sync resta il modo per AGGIORNARE, non per VEDERE.
    if(!force){
        const now = Date.now();
        const cached = targets.filter(n => store._topoNeighborsCache[n.id]);
        store._topoData = cached.length
            ? _buildTopoGraph(cached.map(n => ({
                deviceHostname: store._topoNeighborsCache[n.id].deviceHostname,
                deviceIP:       store._topoNeighborsCache[n.id].deviceIP,
                nodeId:         n.id,
                neighbors:      store._topoNeighborsCache[n.id].neighbors || [],
              })))
            : null;   // nessuna cache: si disegna il solo cablaggio documentato
        store._topoVisible = true;
        store._viewMode = 'topology';
        _setTopoBtn('on');
        win._applyViewMode();
        if(!cached.length){
            _showToast(targets.length
                ? t('topo.fromCabling')
                : t('topo.fromCablingNoSNMP'), 'ok', 4500);
            return;
        }
        const ne=store._topoData.edges.length, nn=store._topoData.nodes.length;
        // Freschezza per-device: invece di dichiarare l'eta' del piu' vecchio
        // (basta un device fermo per leggere "28h fa"), mostra l'eta' del dato
        // PIU' RECENTE e NOMINA i ritardatari (oltre il TTL) cosi' sai chi
        // rinfrescare. Soglie/format condivisi col chip toolbar (win._snmpFreshness).
        const ages = cached.map(n => ({ n, ts: store._topoNeighborsCache[n.id].ts }));
        const newestTs = Math.max(...ages.map(a => a.ts));
        const _fresh = (typeof win._snmpFreshness === 'function') ? win._snmpFreshness(newestTs).txt : '';
        const stale = ages.filter(a => (now - a.ts) >= _TOPO_CACHE_TTL_MS).sort((a,b) => a.ts - b.ts);
        const missing = targets.length - cached.length;
        let msg = t('topo.msgBase', {n:nn, e:ne});
        let type = 'ok';
        if(stale.length){
            type = 'warn';
            const names = stale.slice(0,2).map(a => a.n.name || a.n.hostname || a.n.id);
            const worst = (typeof win._snmpFreshness === 'function') ? win._snmpFreshness(stale[0].ts).txt : '';
            const extra = stale.length > 2 ? ` +${stale.length-2}` : '';
            msg += ` · ${t('topo.msgStale', {n:stale.length, age:worst, names:names.join(', '), extra})}`;
        } else {
            msg += ` ${t('topo.msgFresh', {age:_fresh})}`;
        }
        if(missing > 0){ type = 'warn'; msg += ` · ${t('topo.msgMissing', {n:missing})}`; }
        _showToast(msg, type, type === 'warn' ? 6000 : 3000);
        return;
    }

    if(!targets.length){ _showToast(t('msg.net.noSnmpDevicesSync'),'warn'); _setTopoBtn('off'); return; }

    // ---- force=true (tasto destro): refresh esplicito tramite Sync SNMP completo.
    _setTopoBtn('discovering');
    if(typeof win.pollAllSNMP === 'function' && !win._snmpSyncing){
        await win.pollAllSNMP();
    }
    const allResults = targets
        .filter(n => store._topoNeighborsCache[n.id])
        .map(n => ({
            deviceHostname: store._topoNeighborsCache[n.id].deviceHostname,
            deviceIP:       store._topoNeighborsCache[n.id].deviceIP,
            nodeId:         n.id,
            neighbors:      store._topoNeighborsCache[n.id].neighbors || [],
        }));
    const failedCount = targets.length - allResults.length;
    if(!allResults.length){
        _showToast(t('msg.net.noSnmpReachable',{n:targets.length}),'warn',5000);
        _setTopoBtn('off'); return;
    }
    store._topoData=_buildTopoGraph(allResults);
    store._topoVisible=true;
    store._viewMode='topology';
    _setTopoBtn('on');
    win._applyViewMode();
    const ne=store._topoData.edges.length, nn=store._topoData.nodes.length;
    if(failedCount > 0){
        _showToast(t('msg.net.topoSummaryFailed',{nn,ne,failed:failedCount}),'warn',5000);
    } else {
        _showToast(t('msg.net.topoSummary',{nn,ne}),'ok');
    }
}

// ---- Build graph ------------------------------------------------------------

function _buildTopoGraph(allResults){
    const nodeMap=new Map(), edges=[], edgeSeen=new Set();
    const projByHost={};
    store.state.nodes.forEach(n=>{
        const h=(n.hostname||n.name||'').toLowerCase().split('.')[0];
        if(h) projByHost[h]=n.id;
    });
    function nKey(label){ return (label||'').toLowerCase().split('.')[0].replace(/[^a-z0-9_-]/g,''); }
    function getOrCreate(label,ip='',nodeId=null){
        const key=nKey(label); if(!key) return null;
        if(!nodeMap.has(key)){
            const inProj=projByHost[key]||null;
            nodeMap.set(key,{id:key,label:label.split('.')[0],ip,nodeId:nodeId||inProj,inProject:!!(nodeId||inProj)});
        }
        const nd=nodeMap.get(key);
        if(ip&&!nd.ip) nd.ip=ip;
        if(nodeId&&!nd.nodeId){nd.nodeId=nodeId;nd.inProject=true;}
        return nd;
    }
    for(const dev of allResults){
        const src=getOrCreate(dev.deviceHostname,dev.deviceIP,dev.nodeId); if(!src) continue;
        for(const nb of dev.neighbors){
            const dst=getOrCreate(nb.remoteDevice,nb.remoteIP||'');
            if(!dst||src===dst) continue;
            const ek=[src.id,dst.id].sort().join('|')+'|'+nb.localPort;
            if(edgeSeen.has(ek)) continue; edgeSeen.add(ek);
            edges.push({src:src.id,dst:dst.id,srcPort:nb.localPort,dstPort:nb.remotePort,protocol:nb.protocol});
        }
    }
    return {nodes:[...nodeMap.values()],edges};
}

// ---- Tooltip ----------------------------------------------------------------


// ---- Crea cavo da tooltip ---------------------------------------------------

// win._canonLagToken, win._ifNameMeta, win._normIfName, _normMacKey, _normalizeFdbTable
// sono ora in /lib/netnames.js (caricato come <script> prima di app.js).

/**
 * Normalizza un nome interfaccia per matching vendor-neutral.
 * Copre famiglie comuni documentate su Cisco, Juniper, Aruba CX, Huawei,
 * Dell OS10, FortiGate e MikroTik.
 *
 * Esempi:
 *   GigabitEthernet0/0/1  → 0/0/1
 *   Gi0/0/1               → 0/0/1
 *   ge-0/0/0.0            → 0/0/0
 *   Ethernet 1/1/1        → 1/1/1
 *   Eth-Trunk1            → lag:1
 *   Port-channel 1        → lag:1
 *   ae1                   → lag:1
 *   lag1                  → lag:1
 */
/**
 * Cerca la porta di un nodo progetto corrispondente al nome interfaccia
 * riportato da LLDP/CDP. Matching a 3 livelli (primo match vince):
 *   1. Exact match (case-insensitive)
 *   2. Normalized match — strip prefisso tipo, normalizza separatori
 *   3. Numeric-only fallback — solo cifre+slash, SOLO se il match è univoco
 *      (evita falsi positivi: porta "1" non può matchare sia Gi0/1 che Te0/1)
 */
function _findPortByIfName(projNodeId, ifName){
    if(!ifName) return null;
    const q = win._ifNameMeta(ifName);
    if(q.isMac) return null; // LLDP port-id subtype MAC → non abbinabile direttamente
    const cand = [];
    for(const [pid, pi] of Object.entries(store.state.ports)){
        if(getPortNodeId(pid) !== projNodeId) continue;
        const ifn = String(pi.ifName || '');
        const als = String(pi.alias  || '');
        const mi = win._ifNameMeta(ifn);
        const ma = win._ifNameMeta(als);
        let score = 0;
        // Livello 1 — exact/compact
        if(mi.raw && mi.raw === q.raw) score = Math.max(score, 120);
        if(ma.raw && ma.raw === q.raw) score = Math.max(score, 110);
        if(mi.compact && mi.compact === q.compact) score = Math.max(score, 108);
        if(ma.compact && ma.compact === q.compact) score = Math.max(score, 98);
        // Livello 2 — normalized vendor-neutral
        if(q.norm && mi.norm === q.norm) score = Math.max(score, q.lagToken ? 96 : 88);
        if(q.norm && ma.norm === q.norm) score = Math.max(score, q.lagToken ? 92 : 78);
        // Livello 3 — numeric-only (fallback debole)
        if(q.numOnly){
            if(mi.numOnly === q.numOnly) score = Math.max(score, 40);
            if(ma.numOnly === q.numOnly) score = Math.max(score, 30);
        }
        if(score > 0) cand.push({ pid, score });
    }
    // Match aggiuntivo: se il vicino annuncia un LAG logico (po1/lag1/ae1/eth-trunk1…)
    // ma nel progetto esistono solo le porte membro, ricondurlo al gruppo SNMP corrispondente.
    if(!cand.length && q.lagToken){
        const lagMatches = [];
        for(const [pid, pi] of Object.entries(store.state.ports)){
            if(getPortNodeId(pid) !== projNodeId) continue;
            const lagId = parseInt(pi.lagId || 0, 10);
            const lagGroup = String(pi.lagGroup || '').trim();
            const autoToken = lagId > 0 ? win._canonLagToken(lagId) : '';
            const labelToken = lagGroup && store.state.lagGroups && store.state.lagGroups[lagGroup]
                ? win._normIfName(store.state.lagGroups[lagGroup])
                : '';
            if((autoToken && autoToken === q.lagToken) || (labelToken && labelToken === q.lagToken)){
                const portNum = parseInt(String(pid).split('-').slice(1).join('-'), 10) || 9999;
                lagMatches.push({ pid, score:85, portNum });
            }
        }
        lagMatches.sort((a,b)=>a.portNum-b.portNum);
        if(lagMatches.length) return lagMatches[0].pid;
    }
    if(!cand.length) return null;
    cand.sort((a,b)=>b.score-a.score);
    const best = cand[0];
    const ties = cand.filter(c=>c.score===best.score);
    // Anti-errore: fallback debole non univoco -> nessun match
    if(best.score <= 40 && ties.length !== 1) return null;
    // Anti-errore: exact/normalized ambiguo tra più porte -> nessun match
    if(best.score > 40 && ties.length > 1) return null;
    return best.pid;
}

function _createTopoLink(pairKey){
    if(!store._topoData) return; win._hideTopoTip();
    const [rAId,rBId]=pairKey.split('|');
    const rANodeIds=store.state.nodes.filter(n=>n.rackId===rAId).map(n=>n.id);
    const rBNodeIds=store.state.nodes.filter(n=>n.rackId===rBId).map(n=>n.id);
    let created=0,skipped=0; pushHistory();
    for(const e of store._topoData.edges){
        const sT=store._topoData.nodes.find(n=>n.id===e.src), dT=store._topoData.nodes.find(n=>n.id===e.dst);
        if(!sT?.nodeId||!dT?.nodeId){skipped++;continue;}
        const inAs=rANodeIds.includes(sT.nodeId),inBd=rBNodeIds.includes(dT.nodeId);
        const inBs=rBNodeIds.includes(sT.nodeId),inAd=rANodeIds.includes(dT.nodeId);
        if(!((inAs&&inBd)||(inBs&&inAd))){skipped++;continue;}
        const sp=_findPortByIfName(sT.nodeId,e.srcPort),dp=_findPortByIfName(dT.nodeId,e.dstPort);
        if(!sp||!dp){skipped++;continue;}
        if(store.state.links.some(l=>win._linkHasPair(l, sp, dp))){skipped++;continue;}
        store.state.links.push(win._createLinkRecord(sp,dp)); created++;
    }
    markDirty(); renderAll(); renderCables(); renderTopoOverlay();
    _showToast(created?t('msg.net.cablesCreated',{n:created}):t('msg.net.noCablesCreated'),created?'ok':'warn');
}

// Auto-link + shared segment estratti in lib/app-autolink.js


// ---- Navigazione ------------------------------------------------------------

function navigateToRack(rackId){
    win._hideTopoTip(); win.switchRack(rackId);
    const rack=store.state.racks.find(r=>r.id===rackId);
    if(rack&&rack.x!==undefined) _centerFloorOn(rack.x,rack.y);
}

function _centerFloorOn(x,y){
    const fp=document.getElementById('floorplan');
    store.state.floorView.x=fp.clientWidth /2-x*store.state.floorView.zoom;
    store.state.floorView.y=fp.clientHeight/2-y*store.state.floorView.zoom;
    win.updateTransforms();
}

// ---- Highlight rack→planimetria ---------------------------------------------

function _highlightTopoLinks(projNodeId){
    const svg=document.getElementById('topo-floor-overlay');
    if(!svg||!store._topoData||!store._topoVisible) return;
    svg.querySelectorAll('.tfl').forEach(el=>el.classList.remove('tfl-hl'));
    const tn=store._topoData.nodes.find(n=>n.nodeId===projNodeId); if(!tn) return;
    const pn=nodeById(projNodeId);
    if(!pn||!TYPES[pn.type]?.isRack) return;
    store._topoData.edges.forEach(e=>{
        if(e.src!==tn.id&&e.dst!==tn.id) return;
        const othId=e.src===tn.id?e.dst:e.src;
        const oth=store._topoData.nodes.find(n=>n.id===othId); if(!oth?.nodeId) return;
        const op=nodeById(oth.nodeId);
        if(!op||!TYPES[op.type]?.isRack) return;
        const pk=[pn.rackId,op.rackId].sort().join('|');
        const line=svg.querySelector(`[data-pair="${pk}"]`);
        if(line){ line.classList.add('tfl-hl'); _centerFloorOn(..._rackCenter(pn.rackId,op.rackId)); }
    });
}

function _rackCenter(rIdA,rIdB){
    const rA=store.state.racks.find(r=>r.id===rIdA), rB=store.state.racks.find(r=>r.id===rIdB);
    if(!rA||!rB||rA.x===undefined) return [0,0];
    return [((rA.x||0)+(rB.x||rA.x||0))/2, ((rA.y||0)+(rB.y||rA.y||0))/2];
}

function _clearTopoHighlight(){
    const svg=document.getElementById('topo-floor-overlay');
    if(svg) svg.querySelectorAll('.tfl-hl').forEach(el=>el.classList.remove('tfl-hl'));
}

// ---- Applica topologia (tutti i link) ---------------------------------------

function applyTopologyToProject(){
    if(!store._topoData) return; win._hideTopoTip();
    const {nodes,edges}=store._topoData;
    let created=0,skipped=0; pushHistory();
    for(const e of edges){
        const sN=nodes.find(x=>x.id===e.src),dN=nodes.find(x=>x.id===e.dst);
        if(!sN?.inProject||!dN?.inProject){skipped++;continue;}
        if(!sN.nodeId||!dN.nodeId){skipped++;continue;}
        const sp=_findPortByIfName(sN.nodeId,e.srcPort),dp=_findPortByIfName(dN.nodeId,e.dstPort);
        if(!sp||!dp){skipped++;continue;}
        if(store.state.links.some(l=>win._linkHasPair(l, sp, dp))){skipped++;continue;}
        store.state.links.push(win._createLinkRecord(sp,dp)); created++;
    }
    markDirty(); renderAll(); renderCables(); renderTopoOverlay();
    showAlert(t('msg.net.topoApplied',{created,skipped}));
}

expose({
    _restoreTopoSession, toggleTopology, _setTopoBtn, _refreshTopoBtnState,
    discoverTopology, _findPortByIfName, _createTopoLink, navigateToRack,
    _highlightTopoLinks, _clearTopoHighlight, applyTopologyToProject,
});
