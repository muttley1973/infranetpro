// ============================================================
// LOOKUP INDEXES + PORT/NODE GETTERS  [modulo ESM, estratto da app.js]
// Split app.js #4. Indici O(1) nodeId->node / portId->Link[] (fuori da state per
// non inquinare gli snapshot undo/redo), ricostruiti lazy dopo _invalidateIdx().
// Quasi self-contained: solo bare globals (state, _getLinkPortIds da lib/link-model.js).
// app.js re-exporta i 6 getter/lookup ESM (nodeById ha 25 consumatori); _rebuildIdx
// resta module-local, solo esposto su window.
// ============================================================
import { expose } from "./_bridge.js";
import { nodeIdOfPort } from '../lib/port-id.js';
// Bare globals (no-undef OFF): state - _getLinkPortIds (lib/link-model.js, <script>).

let _idxDirty      = true;
let _nodeByIdMap   = Object.create(null); // nodeId  → node
let _linksByPortMap = Object.create(null); // portId → Link[]

export function _invalidateIdx() { _idxDirty = true; }

function _rebuildIdx() {
    _nodeByIdMap   = Object.create(null);
    _linksByPortMap = Object.create(null);
    for (const n of state.nodes) _nodeByIdMap[n.id] = n;
    for (const l of state.links) {
        for(const pid of _getLinkPortIds(l)){
            (_linksByPortMap[pid] ??= []).push(l);
        }
    }
    _idxDirty = false;
}

/**
 * Cerca un nodo per ID in O(1).
 * Sostituisce: state.nodes.find(x => x.id === id)
 */
export function nodeById(id) {
    if (_idxDirty) _rebuildIdx();
    return _nodeByIdMap[id] ?? null;
}

/**
 * Restituisce i link che toccano la porta `pid` in O(1).
 * Sostituisce: state.links.filter(l => l.src===pid || l.dst===pid)
 */
export function _linksForPort(pid) {
    if (_idxDirty) _rebuildIdx();
    return _linksByPortMap[pid] ?? [];
}

// ── Getter porta -> nodo (id porta = "<nodeId>-<porta>") ──
// PERF: chiamato in loop caldi per-porta (applyPollResult, _driftUpdateStreaks,
// auto-link, render). Fast-path O(1) tramite l'indice _nodeByIdMap (le sue chiavi
// SONO i node id): lo split ingenuo sull'ultimo '-' è il prefisso-nodo più lungo
// possibile, quindi se è un node id noto è già corretto. Solo i suffissi
// multi-trattino (es. …-logical-<id>) delegano alla scansione di nodeIdOfPort.
export function getPortNodeId(pid, knownNodeIds)          {
    if (knownNodeIds) return nodeIdOfPort(pid, knownNodeIds);
    if (_idxDirty) _rebuildIdx();
    const p = String(pid || '');
    const cut = p.lastIndexOf('-');
    const naive = cut > 0 ? p.slice(0, cut) : p;
    if (naive && (naive in _nodeByIdMap)) return naive;   // O(1): copre id canonici + gran parte dei dashed
    if (!naive) return p;
    return nodeIdOfPort(p, _nodeByIdMap);                 // raro: suffisso multi-trattino → longest-prefix
}
export function isPortOnNode(pid,nodeId)    { return getPortNodeId(pid)===nodeId; }
export function getNodeByPortId(pid)        { return nodeById(getPortNodeId(pid)); }

// Superficie window invariata: i 7 erano nell expose() di app.js.
expose({ _invalidateIdx, _rebuildIdx, nodeById, _linksForPort, getPortNodeId, isPortOnNode, getNodeByPortId });
