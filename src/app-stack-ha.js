// ============================================================
// STACKING + HA PAIR — setter di stato (glue migrato a ESM, esbuild)
// ============================================================
// Setter che mutano `state` per stack (P7) e coppie/cluster HA (P8) + i
// generatori di nomi default. Le primitive PURE vivono in lib/stack.js e
// lib/ha-pair.js (UMD-lite, testate, caricate come <script>): si leggono dal
// ponte (win.*), NON si importano (vedi regola in _bridge.js). Anche i globali
// legacy di app.js (state, selId, nodeById, TYPES, pushHistory, renderAll,
// markDirty, _ensureNodeSpec da app-types.js) passano dal ponte.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { nodeById, markDirty, pushHistory } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, _ensureNodeSpec } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// ============================================================
// STACKING (P7.1 — modello tag-based su node.spec)
// Quando il master e' eliminato, il fallback di `getStackMaster` (ordering
// per memberId, poi per id) promuove automaticamente il prossimo membro al
// rendering successivo: niente mutazione esplicita richiesta su delete.
// ============================================================
function setNodeStack(stackId, memberId){
    const n = nodeById(store.selId); if(!n) return;
    const def = TYPES[n.type];
    if(!def?.stackEligible) return;
    const id = String(stackId || '').trim();
    if(!id) return;
    pushHistory();
    const spec = _ensureNodeSpec(n);
    spec.stackId = id;
    const mid = parseInt(memberId, 10);
    spec.stackMemberId = Number.isFinite(mid) && mid > 0
        ? mid
        : win.getNextMemberId(store.state.nodes, id);
    delete spec.stackRole; // ruolo derivato; esplicito solo se override manuale
    renderAll(); markDirty();
}
function setNodeStackMemberId(newId){
    const n = nodeById(store.selId); if(!n) return;
    if(!win.isInStack(n)) return;
    const stackId = n.spec.stackId;
    const mid = parseInt(newId, 10);
    if(!Number.isFinite(mid) || mid < 1){ return; }
    if(!win.isMemberIdAvailable(store.state.nodes, stackId, mid, n.id)){
        alert(t('msg.ui.slotTaken',{mid}));
        renderAll(); // ripristina input UI
        return;
    }
    pushHistory();
    _ensureNodeSpec(n).stackMemberId = mid;
    renderAll(); markDirty();
}
function removeNodeFromStack(){
    const n = nodeById(store.selId); if(!n) return;
    if(!win.isInStack(n)) return;
    pushHistory();
    if(n.spec){
        delete n.spec.stackId;
        delete n.spec.stackMemberId;
        delete n.spec.stackRole;
    }
    delete n.stackId;
    delete n.stackMemberId;
    delete n.stackRole;
    renderAll(); markDirty();
}
// Helper UI: prossimo memberId libero per uno stack (delega alla lib).
function nextStackMemberId(stackId){
    return win.getNextMemberId(store.state.nodes, stackId);
}
// Stacking auto-detection (P7.3): accetta l'hint impostato da applyPollResult.
// Promuove il nodo a master di uno stack auto-generato (memberId=1) e cancella
// l'hint. L'utente deve poi creare manualmente gli altri membri (UX consapevole:
// noi non creiamo device fantasma).
function acceptStackHint(){
    const n = nodeById(store.selId); if(!n) return;
    const hint = n.stackDetectionHint;
    if(!hint) return;
    if(!TYPES[n.type]?.stackEligible) return;
    pushHistory();
    const stackId = _defaultStackName(n);
    const spec = _ensureNodeSpec(n);
    spec.stackId = stackId;
    spec.stackMemberId = 1;
    delete spec.stackRole;
    delete n.stackDetectionHint;
    renderAll(); markDirty();
}
function dismissStackHint(){
    const n = nodeById(store.selId); if(!n) return;
    if(!n.stackDetectionHint) return;
    pushHistory();
    delete n.stackDetectionHint;
    renderAll(); markDirty();
}

// ============================================================
// HA PAIR / CLUSTER (P8.1 — modello tag-based su node.spec)
// Le primitive pure sono in lib/ha-pair.js. Qui sotto vivono solo i
// setter che mutano `state` + invocano `renderAll`. HA e Stacking sono
// concetti DISTINTI: stack = N unita fondono in 1 logica con UN solo IP;
// HA = 2/N unita restano distinte, sincronizzano solo stato sessione.
// ============================================================
function setNodeHaPair(peerId, role, mode){
    const n = nodeById(store.selId); if(!n) return;
    const def = TYPES[n.type]; if(!def?.haEligible) return;
    const pid = String(peerId || '').trim();
    if(!pid){ return; }
    const peer = nodeById(pid);
    if(!peer){ alert(t('msg.ui.deviceNotFound',{pid})); return; }
    if(!TYPES[peer.type]?.haEligible){
        alert(t('msg.ui.notHaEligible',{name: peer.name || pid}));
        return;
    }
    if(peer.id === n.id){ alert(t('msg.ui.selfPeer')); return; }
    pushHistory();
    const spec = _ensureNodeSpec(n);
    // Pulisce eventuale stato cluster precedente (mutuamente esclusivo)
    delete spec.haGroupId;
    spec.haPeer = peer.id;
    if(role === 'active' || role === 'standby') spec.haRole = role;
    else delete spec.haRole;   // ruolo non dichiarato: resta "non specificato", non forzato ad "active"
    if(mode === 'active-passive' || mode === 'active-active') spec.haMode = mode;
    else spec.haMode = 'active-passive';
    // Propaga simmetria al peer (B.peer = A automaticamente, ruolo complementare)
    win.propagateHaSymmetry(store.state.nodes, n);
    renderAll(); markDirty();
}
function setNodeHaCluster(groupId, role, mode){
    const n = nodeById(store.selId); if(!n) return;
    const def = TYPES[n.type]; if(!def?.haEligible) return;
    const gid = String(groupId || '').trim();
    if(!gid) return;
    pushHistory();
    const spec = _ensureNodeSpec(n);
    // Pulisce eventuale stato pair precedente (mutuamente esclusivo)
    if(spec.haPeer){
        const oldPeer = nodeById(spec.haPeer);
        if(oldPeer?.spec){
            delete oldPeer.spec.haPeer;
            delete oldPeer.spec.haRole;
            delete oldPeer.spec.haMode;
        }
        delete spec.haPeer;
    }
    spec.haGroupId = gid;
    if(role === 'active' || role === 'standby' || role === 'member') spec.haRole = role;
    else delete spec.haRole;   // ruolo non dichiarato: resta "non specificato", non forzato a "member"
    if(mode === 'active-passive' || mode === 'active-active' || mode === 'cluster-N') spec.haMode = mode;
    else spec.haMode = 'cluster-N';
    renderAll(); markDirty();
}
function setNodeHaRole(newRole){
    const n = nodeById(store.selId); if(!n) return;
    if(!win.isInHaGroup(n)) return;
    if(!['active','standby','member'].includes(newRole)) return;
    pushHistory();
    _ensureNodeSpec(n).haRole = newRole;
    // Su pair, propaga ruolo complementare al peer
    if(win.isInHaPair(n)) win.propagateHaSymmetry(store.state.nodes, n);
    renderAll(); markDirty();
}
function setNodeHaMode(newMode){
    const n = nodeById(store.selId); if(!n) return;
    if(!win.isInHaGroup(n)) return;
    if(!['active-passive','active-active','cluster-N'].includes(newMode)) return;
    pushHistory();
    _ensureNodeSpec(n).haMode = newMode;
    if(win.isInHaPair(n)) win.propagateHaSymmetry(store.state.nodes, n);
    renderAll(); markDirty();
}
function setNodeHaSync(newSync){
    const n = nodeById(store.selId); if(!n) return;
    if(!win.isInHaGroup(n)) return;
    if(!['state-full','config-only','failover-only'].includes(newSync)) return;
    pushHistory();
    _ensureNodeSpec(n).haSync = newSync;
    if(win.isInHaPair(n)) win.propagateHaSymmetry(store.state.nodes, n);
    renderAll(); markDirty();
}
function removeNodeFromHa(){
    const n = nodeById(store.selId); if(!n) return;
    if(!win.isInHaGroup(n)) return;
    pushHistory();
    // Se era in pair, pulisce anche il peer (simmetria)
    if(win.isInHaPair(n)){
        const peer = win.getHaPeer(store.state.nodes, n);
        if(peer?.spec){
            delete peer.spec.haPeer;
            delete peer.spec.haRole;
            delete peer.spec.haMode;
            delete peer.spec.haSync;
        }
    }
    if(n.spec){
        delete n.spec.haPeer;
        delete n.spec.haGroupId;
        delete n.spec.haRole;
        delete n.spec.haMode;
        delete n.spec.haSync;
    }
    delete n.haPeer; delete n.haGroupId; delete n.haRole; delete n.haMode; delete n.haSync;
    renderAll(); markDirty();
}
// Helper UI: nome di default per un nuovo cluster HA, derivato dal device.
// Pattern parallelo a _defaultStackName ma con prefisso "ha-".
function _defaultHaGroupName(node){
    if(!node) return 'ha-cluster';
    const raw = String(node.hostname || node.name || node.id || 'cluster').trim();
    let core = raw.split('.')[0];
    core = core.toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    if(!core) core = 'cluster';
    return `ha-${core}`;
}
// Helper UI: nome di default per un nuovo stack, derivato dai campi piu'
// significativi del nodo. Priorita: hostname (senza dominio) > name > id.
// Sanitizza in slug ASCII lowercase con dash (es. "Core Switch" -> "core-switch",
// "core01.lan" -> "core01"). Prefisso "stk-" sempre presente.
export function _defaultStackName(node){
    if(!node) return 'stk-stack';
    const raw = String(node.hostname || node.name || node.id || 'stack').trim();
    // Prendi solo la prima parte prima del primo punto (strip dominio DNS)
    let core = raw.split('.')[0];
    // Slugify: lowercase, sostituisci non-alphanum con dash, dedup dash, trim
    core = core.toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    if(!core) core = 'stack';
    return `stk-${core}`;
}

// Tutte le 14 funzioni erano globali (classic script) e sono chiamate da
// app-properties-node.js / app.js (handler onchange + helper di render).
expose({
    setNodeStack, setNodeStackMemberId, removeNodeFromStack, nextStackMemberId,
    acceptStackHint, dismissStackHint,
    setNodeHaPair, setNodeHaCluster, setNodeHaRole, setNodeHaMode, setNodeHaSync,
    removeNodeFromHa, _defaultHaGroupName, _defaultStackName,
});
