// ============================================================
// CABLING EDITOR — modalità instradamento "highlight" (P1.5, Opzione A)
//                                   [modulo ESM, ex lib/app-cabling-editor.js]
// _routingLinkId su window (lo legge app-pointer); _routingTargetPids module-local.
// Logica pura in lib/cabling.js (canRouteThrough/splitLinkThrough/...) via win.*.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { uid } from './app-util.js';
import { markDirty, getNodeByPortId, getNodeDisplayName, pushHistory, _showToast, _invalidateIdx, switchRightTab } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// Stato modalità (globali condivise con app-pointer.js / app-render-core.js
// via global lexical scope, come tutti gli altri stati dell'app).
win._routingLinkId = null;          // id del cavo da spezzare (null = off · var: letto dal bundle app-pointer via win._routingLinkId)
let _routingTargetPids = new Map(); // pid porta valida → { reuse: estremoGiaCollegato|null }

function _routeNodeLabel(n){
    if(!n) return '?';
    if(n.type === 'wallport') return win.getWallPortLabel(n) || n.name || n.id;
    return getNodeDisplayName(n) || n.name || n.id;
}

// Porta collegata → stato 'active' (LED verde), stesso pattern di
// _tryFinishLink. Solo se la porta non ha gia' uno stato SNMP autorevole
// (un patch panel passivo non ne ha; uno switch attivo si' — non tocchiamo).
function _markPortActive(pid){
    if(!pid) return;
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    store.state.ports[pid].status = 'active';
}
// Porta rimasta senza alcun link → torna 'inactive' (grigio). Usata dopo il
// merge per la tappa liberata. Non tocca le porte attive con altri cavi.
function _refreshPortActiveState(pid){
    if(!pid || !store.state.ports[pid]) return;
    const stillLinked = (store.state.links || []).some(l =>
        l && (String(l.src) === pid || String(l.dst) === pid));
    if(!stillLinked) delete store.state.ports[pid].status;
}

// Una tappa pass-through midPid puo' essere inserita nel segmento A↔B solo
// se rispetta l'ordine gerarchico del cablaggio (TIA-568): la logica pura
// vive in lib/cabling.js (win.canRouteThrough, testata); qui risolviamo i tipi
// dai pid. Sussume la vecchia regola "no presa↔presa" e impedisce di
// allungare un percorso gia' completo con tappe fuori posto.
function _canRouteThroughPid(pidA, midPid, pidB){
    return win.canRouteThrough(
        getNodeByPortId(pidA)?.type,
        getNodeByPortId(midPid)?.type,
        getNodeByPortId(pidB)?.type);
}

// Una porta pass-through è una tappa valida per il cavo A↔B se:
//   - ha >= 2 slot liberi → presa/patch nuova: split standard A↔M + M↔B
//   - ha >= 1 slot libero ED è già collegata a un estremo del cavo (A o B)
//     → caso presa a muro reale (PC già collegato davanti): il segmento
//       esistente viene RIUSATO, si crea solo il tratto mancante.
// In entrambi i casi i segmenti risultanti devono rispettare
// _cablingAdjacencyValid (no presa↔presa).
// Restituisce un Map pid → { reuse: pidEstremoGiaCollegato | null }
function _computeRoutingTargets(excludeLinkId){
    const map = new Map();
    const linksForCount = (store.state.links || []).filter(l => l && l.id !== excludeLinkId);
    const link = (store.state.links || []).find(l => l.id === excludeLinkId);
    const endpoints = link ? [String(link.src), String(link.dst)] : [];
    const [epA, epB] = endpoints;
    for(const n of (store.state.nodes || [])){
        if(TYPES[n.type]?.passThrough !== 'port') continue; // patchpanel, wallport
        const pc = n.ports !== undefined ? n.ports : (TYPES[n.type]?.ports || 0);
        for(let i = 1; i <= pc; i++){
            const pid = `${n.id}-${i}`;
            if(endpoints.includes(pid)) continue;            // già estremo del cavo
            const max = win.getPortMaxConnections(pid);
            const free = max - win.portConnectionCount(linksForCount, pid);
            if(free >= 2){
                // split A↔M + M↔B: la tappa M deve stare gerarchicamente
                // TRA gli estremi del segmento (no allungamenti fuori posto).
                if(_canRouteThroughPid(epA, pid, epB)){
                    map.set(pid, { reuse: null });
                }
                continue;
            }
            if(free >= 1){
                // già collegata a uno degli estremi del cavo? → riuso quel tratto;
                // M va comunque verificata gerarchicamente rispetto al segmento.
                const reuseEnd = endpoints.find(ep =>
                    linksForCount.some(l =>
                        (String(l.src) === pid && String(l.dst) === ep) ||
                        (String(l.dst) === pid && String(l.src) === ep)));
                if(reuseEnd && _canRouteThroughPid(epA, pid, epB)){
                    map.set(pid, { reuse: reuseEnd });
                }
            }
        }
    }
    return map;
}

function enterRoutingMode(linkId){
    const link = (store.state.links || []).find(l => l.id === linkId);
    if(!link){ _showToast(t('msg.rack.cableNotFound'), 'warn'); return; }
    _routingTargetPids = _computeRoutingTargets(linkId);
    if(!_routingTargetPids.size){
        // Messaggio context-aware: dice QUALE tappa serve per QUESTO cavo (gerarchia),
        // così l'utente non cerca a vuoto una presa dove serve un patch panel (o viceversa).
        const an = getNodeByPortId(link.src), bn = getNodeByPortId(link.dst);
        const valid = (typeof win.validMidTypes === 'function') ? win.validMidTypes(an?.type, bn?.type) : [];
        const LBL = { patchpanel: 'patch panel', wallport: t('msg.rack.lblWallport'), voip: t('msg.rack.lblVoip') };
        let msg;
        if(!valid.length){
            msg = t('msg.rack.noHopSameLevel',{a:_routeNodeLabel(an),b:_routeNodeLabel(bn)});
        } else {
            const names = valid.map(ty => LBL[ty] || ty).join(t('msg.rack.orJoin'));
            msg = t('msg.rack.needHopWithSlots',{names:names});
        }
        _showToast(msg, 'warn', 6500);
        return;
    }
    win._routingLinkId = linkId;
    document.body.classList.add('routing-mode');
    // Dove sono le porte valide? La gerarchia TIA-568 (win.canRouteThrough) decide:
    // es. switch↔presa → solo patch panel (rack); PC↔switch → anche prese (floor).
    // Conta floor vs rack per (1) guidare l'utente e (2) aprire il rack SOLO se
    // serve davvero (evita di spostare la vista quando i target sono in planimetria).
    let _nFloor = 0, _nRack = 0;
    _routingTargetPids.forEach((_i, pid) => {
        const _pn = getNodeByPortId(pid);
        if(TYPES[_pn?.type]?.isFloor) _nFloor++; else _nRack++;
    });
    if(_nRack > 0){
        // Patch panel nel chassis (nascosto in tab Proprietà): espandi e passa
        // a tab Rack così l'utente vede subito le porte gialle.
        if(typeof store._rackCollapsed !== 'undefined' && store._rackCollapsed &&
           typeof win.toggleRackPanel === 'function') win.toggleRackPanel();
        if(typeof win._rightTab !== 'undefined' && win._rightTab !== 'rack' &&
           typeof win.switchRightTab === 'function') switchRightTab('rack');
    }
    _renderRoutingHint(link);
    // pittura immediata (poi ri-applicata da _paintRoutingTargets ad ogni render)
    _paintRoutingTargets();
    const an = getNodeByPortId(link.src), bn = getNodeByPortId(link.dst);
    const _where = (_nFloor && _nRack) ? t('msg.rack.whereRackAndFloor')
                 : _nRack ? t('msg.rack.whereRack') : t('msg.rack.whereFloor');
    _showToast(t('msg.rack.routeHint',{a:_routeNodeLabel(an),b:_routeNodeLabel(bn),n:_routingTargetPids.size,where:_where}), 'ok', 4500);
}

function _exitRoutingMode(){
    win._routingLinkId = null;
    _routingTargetPids = new Map();
    document.body.classList.remove('routing-mode');
    document.querySelectorAll('.routing-target').forEach(el => el.classList.remove('routing-target'));
    document.querySelectorAll('.floor-rack.routing-rack').forEach(el => el.classList.remove('routing-rack'));
    const hint = document.getElementById('routing-hint');
    if(hint) hint.style.display = 'none';
}

// Ri-applica le classi highlight sulle porte target. Chiamata dopo ogni
// render (hook in _renderAllNow / _renderFloorNow). No-op se modalità off.
function _paintRoutingTargets(){
    if(!win._routingLinkId) return;
    document.querySelectorAll('.routing-target').forEach(el => el.classList.remove('routing-target'));
    document.querySelectorAll('.floor-rack.routing-rack').forEach(el => el.classList.remove('routing-rack'));
    const _rackIds = new Set();
    _routingTargetPids.forEach((_info, pid) => {
        const el = document.querySelector(`[data-pid="${pid}"]`);
        if(el) el.classList.add('routing-target');
        // Tappa nel rack (patch panel) → ricorda l'armadio: ne evidenziamo
        // l'ICONA sul floor (`.floor-rack`), così l'utente vede DOVE andare
        // senza disegnare i patch panel fuori dal rack (posizione fisica reale).
        const n = getNodeByPortId(pid);
        if(n && n.rackId && !TYPES[n.type]?.isFloor) _rackIds.add(n.rackId);
    });
    _rackIds.forEach(rid => {
        const rk = document.querySelector(`.floor-rack[data-rackid="${rid}"]`);
        if(rk) rk.classList.add('routing-rack');
    });
}

function _renderRoutingHint(link){
    let hint = document.getElementById('routing-hint');
    if(!hint){
        hint = document.createElement('div');
        hint.id = 'routing-hint';
        document.body.appendChild(hint);
    }
    hint.innerHTML = `<i class="fas fa-route"></i>
        <span>${t('pnl.disc.routingHint',{title:'<strong>'+t('pnl.disc.routingTitle')+'</strong>',yellow:'<span style="color:#f5c518">'+t('pnl.disc.routingYellow')+'</span>',esc:'<kbd>Esc</kbd>'})}</span>
        <button onclick="_exitRoutingMode()" data-tip="${t('pnl.disc.cancel')}"><i class="fas fa-times"></i></button>`;
    hint.style.display = 'flex';
}

// Click su una porta durante la modalità: se valida → split, altrimenti avvisa.
function _routingPickPort(midPid){
    const info = _routingTargetPids.get(midPid);
    if(!info){
        const n = getNodeByPortId(midPid);
        const link0 = (store.state.links || []).find(l => l.id === win._routingLinkId);
        const epTypes = link0 ? [link0.src, link0.dst].map(p => getNodeByPortId(p)?.type) : [];
        let why;
        if(!n || TYPES[n.type]?.passThrough !== 'port'){
            why = t('msg.rack.whyNotPassThrough');
        } else if(n.type === 'wallport' && epTypes.includes('wallport')){
            why = t('msg.rack.whyWallportToWallport');
        } else if(!_canRouteThroughPid(epTypes[0] && link0.src, midPid, epTypes[1] && link0.dst)){
            why = t('msg.rack.whyOutOfHierarchy');
        } else {
            why = t('msg.rack.whyNoFreeSlots');
        }
        _showToast(t('msg.rack.portInvalid',{why:why}), 'warn', 4000);
        return;
    }
    const linkId = win._routingLinkId;
    const link = (store.state.links || []).find(l => l.id === linkId);
    if(!link){ _exitRoutingMode(); return; }

    // CASO RIUSO (presa a muro già collegata a un estremo): non duplicare il
    // tratto esistente. Es. cavo PC↔switch instradato attraverso wp2 che ha
    // già PC↔wp2 → si crea solo wp2↔switch, il vecchio PC↔switch sparisce e
    // PC↔wp2 resta. La presa passa a 2 facce (work-area + uplink).
    if(info.reuse){
        const otherEnd = String(link.src) === info.reuse ? String(link.dst) : String(link.src);
        // Un LINK vero (src/dst/id): _createLinkSegmentRecord produrrebbe un
        // SEGMENTO {from,to} senza src/dst → _getLinkVlan leggerebbe porte
        // inesistenti → VLAN 1 → cavo grigio + escluso dalla propagazione VLAN.
        const newRec = { id: uid('l'), src: midPid, dst: otherEnd };
        // eredita solo VLAN/mode/colore dal cavo originale. NON eredita lo stato
        // topologia (autoLinked/protocol/confidence): instradare e' manuale → il
        // tratto resta protetto dai sync ("manuale ha sempre priorita'").
        for(const k of ['vlan','mode','trunkVlans','colorOvr','color']){
            if(link[k] !== undefined && link[k] !== null && link[k] !== '') newRec[k] = link[k];
        }
        pushHistory();
        store.state.links = store.state.links.filter(l => l.id !== linkId);
        store.state.links.push(_normalizeLinkMetadata(newRec));
        _markPortActive(midPid); _markPortActive(otherEnd); _markPortActive(info.reuse);
        if(typeof win._invalidateIdx === 'function') _invalidateIdx();
        store.selType = 'link'; store.selId = newRec.id;
        store.highPath.clear();
        const midNode0 = getNodeByPortId(midPid);
        _exitRoutingMode();
        // torna alle Proprietà del cavo per mostrare il percorso aggiornato
        if(typeof win.switchRightTab === 'function') switchRightTab('props');
        markDirty(); renderAll(); renderProps();
        _showToast(t('msg.rack.routedReuse',{name:_routeNodeLabel(midNode0)}), 'ok', 3800);
        return;
    }

    const res = win.splitLinkThrough(link, midPid, {
        uid: uid,
        isPassThrough: win._isLinearPassThroughPort,
        linksForCapacity: store.state.links.filter(l => l.id !== linkId),
        maxConn: win.getPortMaxConnections(midPid),
    });
    if(!res.ok){
        _showToast(t('msg.rack.routingNotPossible',{reason:res.reason}), 'warn', 4000);
        return;
    }

    pushHistory();
    store.state.links = store.state.links.filter(l => l.id !== linkId);
    for(const rec of res.links){
        store.state.links.push(_normalizeLinkMetadata(rec));
        // Porte collegate → stato 'active' (verde), come _tryFinishLink:
        // include la porta pass-through intermedia che diventa "occupata".
        _markPortActive(rec.src); _markPortActive(rec.dst);
    }
    if(typeof win._invalidateIdx === 'function') _invalidateIdx();

    // Seleziona il 1° tratto: l'utente vede il risultato e può re-instradare.
    store.selType = 'link'; store.selId = res.links[0].id;
    store.highPath.clear();

    const midNode = getNodeByPortId(midPid);
    _exitRoutingMode();
    // torna alle Proprietà del cavo per mostrare il percorso aggiornato
    if(typeof win.switchRightTab === 'function') switchRightTab('props');
    markDirty(); renderAll(); renderProps();
    _showToast(t('msg.rack.routed',{name:_routeNodeLabel(midNode)}), 'ok', 3500);
}

// "Togli tappa": fonde i 2 tratti che si incontrano sulla porta pass-through.
function removeRouteHop(midPid){
    const touching = (store.state.links || []).filter(l =>
        l && (String(l.src) === midPid || String(l.dst) === midPid));
    if(touching.length !== 2){
        _showToast(t('msg.rack.hopNotRemovable',{count:touching.length}), 'warn', 4000);
        return;
    }
    const res = win.mergeLinksThrough(touching[0], touching[1], midPid, { uid: uid });
    if(!res.ok){
        _showToast(t('msg.rack.mergeNotPossible',{reason:res.reason}), 'warn', 4000);
        return;
    }

    pushHistory();
    store.state.links = store.state.links.filter(l => l !== touching[0] && l !== touching[1]);
    store.state.links.push(_normalizeLinkMetadata(res.link));
    _markPortActive(res.link.src); _markPortActive(res.link.dst);
    _refreshPortActiveState(midPid);   // tappa liberata → torna grigia
    if(typeof win._invalidateIdx === 'function') _invalidateIdx();

    store.selType = 'link'; store.selId = res.link.id;
    store.highPath.clear();

    markDirty(); renderAll(); renderProps();
    const midNode = getNodeByPortId(midPid);
    _showToast(t('msg.rack.hopRemoved',{name:_routeNodeLabel(midNode)}), 'ok', 3500);
}

// Una tappa intermedia del percorso è rimovibile se la porta è pass-through
// 'port' e ha ESATTAMENTE 2 cavi (quelli che verranno fusi).
function _routeHopRemovable(pid){
    if(win._getPassThroughMode(pid) !== 'port') return false;
    return win.portConnectionCount(store.state.links || [], pid) === 2;
}

expose({
    enterRoutingMode, _exitRoutingMode, _routingPickPort, removeRouteHop,
    _routeHopRemovable, _paintRoutingTargets, _computeRoutingTargets,
});
