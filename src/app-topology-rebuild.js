// ============================================================
// MATERIALIZZAZIONE TOPOLOGIA (integrata nel Sync)
// ============================================================
// Colma l'UNICO gap che il Sync (_autoDiscoverLinks) non copriva già: creare i
// NODI che prima nessuno creava —
//   • il VICINO LLDP/CDP annunciato ma non documentato (es. il gateway visto su
//     una porta solo via chassis-MAC): nodo infra in RACK con l'identità nota;
//   • lo SWITCH/AP NON GESTITO inferito dietro una porta d'accesso con 2-4
//     endpoint distinti e nessun vicino LLDP (verità fisica: 1 porta = 1 cavo).
// Le porte con >4 MAC (segmento condiviso) e il self-heal degli auto-link
// sbagliati sono GIÀ gestiti da _autoDiscoverLinks — qui NON si duplicano.
//
// Riceve i pollResults già raccolti dal Sync (nessun doppio poll) e riusa il
// motore puro lib/topology-plan.js. Idempotente (buildApplyOps salta uplink già
// materializzati / porte già occupate). Le primitive pure sono globali del
// bundle (UMD → window): lette BARE (no-undef off in src/), mai via win.*.
// ============================================================
import { store } from './store.js';
import { nodeById, getPortNodeId, getNodeByPortId, _invalidateIdx, _createLinkRecord, _nextNodeId } from './app.js';
import { _findPortByIfName } from './app-topology-discover.js';
import { uid } from './app-util.js';
import { t, expose } from './_bridge.js';

const _norm = (m) => (typeof _normMacKey === 'function') ? _normMacKey(m) : String(m || '').trim().toLowerCase();

// Mappa MAC normalizzato → { nodeId, type } dai nodi/porte noti del progetto:
// etichetta gli endpoint "dietro" (regola type-aware) e riconosce i vicini noti.
function _macInfoMap() {
  const idx = {};
  for (const n of store.state.nodes) {
    const m = _norm(n.mac);
    if (m && !idx[m]) idx[m] = { nodeId: n.id, type: n.type || null };
  }
  for (const [pid, pi] of Object.entries(store.state.ports)) {
    const m = _norm(pi.mac);
    if (!m || idx[m]) continue;
    const nid = getPortNodeId(pid);
    const nd = nodeById(nid);
    idx[m] = { nodeId: nid, type: nd ? (nd.type || null) : null };
  }
  return idx;
}

// Rack di destinazione per i nodi infra materializzati: quello corrente, o ne crea uno.
function _ensureRack() {
  let rackId = store.state.currentRack;
  if (!rackId || !(store.state.racks || []).find(r => r.id === rackId)) {
    rackId = uid('rack');
    if (!Array.isArray(store.state.racks)) store.state.racks = [];
    store.state.racks.push({ id: rackId, name: t('toporebuild.rackName'), sizeU: 42 });
    store.state.currentRack = rackId;
  }
  return rackId;
}

// Switch/AP non gestito inferito → SWITCH in RACK (infra, non su floor).
function _createInferredSwitch(m) {
  const behind = (m.behindNodeIds || []).length;
  const usedIds = new Set(store.state.nodes.map(n => String(n.id || '')));
  const id = (typeof _nextNodeId === 'function') ? _nextNodeId('switch', usedIds) : ('sw_' + store.state.nodes.length);
  const rackId = _ensureRack();
  const rackU = (typeof _findFreeU === 'function') ? _findFreeU(rackId, 1) : 1;
  const n = {
    id, type: 'switch', name: t('toporebuild.unmanagedSwitch'),
    rackId, rackU, sizeU: 1, ports: Math.max(2, behind + 1),
    inferred: true, identitySource: 'inferred', identityConfidence: 'low',
  };
  store.state.nodes.push(n);
  return n;
}

// Vicino LLDP/CDP annunciato non documentato (es. gateway) → SWITCH in RACK con
// l'identità nota (MAC/IP/hostname). Il tipo esatto (switch/router) lo conferma l'utente.
function _createNeighborNode(nn) {
  const usedIds = new Set(store.state.nodes.map(n => String(n.id || '')));
  const id = (typeof _nextNodeId === 'function') ? _nextNodeId('switch', usedIds) : ('sw_' + store.state.nodes.length);
  const rackId = _ensureRack();
  const rackU = (typeof _findFreeU === 'function') ? _findFreeU(rackId, 1) : 1;
  const n = {
    id, type: 'switch', name: nn.hostname || nn.ip || nn.mac || t('toporebuild.lldpNeighbor'),
    rackId, rackU, sizeU: 1, ports: 24,
    mac: nn.mac || '', ip: nn.ip || '', hostname: nn.hostname || '',
    inferred: true, identitySource: 'lldp', identityConfidence: 'high',
  };
  store.state.nodes.push(n);
  return n;
}

function _mkLink(src, dst, meta) {
  if (typeof _createLinkRecord === 'function') return _createLinkRecord(src, dst, meta);
  return Object.assign({ id: 'l_' + src + '_' + dst, src, dst }, meta);
}

/**
 * Materializza i nodi topologici mancanti dai risultati del poll del Sync.
 * NON crea cavi di dorsale/edge (li fa già _autoDiscoverLinks) né ripete il
 * self-heal: crea SOLO gli apparati (gateway annunciato + switch inferito) e i
 * loro cavi, con reroute-prune degli auto-link diretti superati. Idempotente.
 * Muta store.state; NON fa pushHistory/render (li gestisce il chiamante/Sync).
 *
 * @param {Array} pollResults - [{ nodeId, fdbTable, neighbors, suggestedSharedSegments? }]
 * @returns {{ nodes:number, links:number, pruned:number }}
 */
export function materializeTopologyNodes(pollResults) {
  const EMPTY = { nodes: 0, links: 0, pruned: 0 };
  if (typeof assemblePlanInputs !== 'function' || typeof buildTopologyPlan !== 'function' ||
      typeof buildPortIndex !== 'function' || typeof buildApplyOps !== 'function') return EMPTY;
  if (!Array.isArray(pollResults) || !pollResults.length) return EMPTY;

  const macInfo = _macInfoMap();
  const inputs = assemblePlanInputs(pollResults, {
    findPort: (nid, ifn) => _findPortByIfName(nid, ifn),
    macInfo: (m) => macInfo[_norm(m)] || null,
    // Un vicino è "già nel progetto" se combacia per hostname/IP o per MAC.
    matchNeighbor: (nb) => {
      const byIdent = (typeof matchNodeByIdent === 'function')
        ? matchNodeByIdent(nb.remoteDevice, nb.remoteIP, store.state.nodes) : null;
      if (byIdent) return byIdent.id || true;
      const m = _norm(nb.remoteMac || nb.remoteDevice);
      const hit = m ? macInfo[m] : null;
      return hit ? (hit.nodeId || true) : null;
    },
  });

  const portIndex = buildPortIndex(store.state.ports, store.state.lagGroups || {});
  const plan = buildTopologyPlan({
    candidates: [], portIndex, nodes: store.state.nodes,
    existingLinks: store.state.links,
    portEndpoints: inputs.portEndpoints, neighborNodes: inputs.neighborNodes,
  });

  // Idempotenza: uplink già dotati di uno switch inferito → non ri-materializzare.
  const materializedUplinks = new Set();
  for (const l of store.state.links) {
    for (const end of [l.src, l.dst]) {
      const nd = getNodeByPortId(end);
      if (nd && nd.inferred) materializedUplinks.add(l.src === end ? l.dst : l.src);
    }
  }
  const ops = buildApplyOps(plan, {
    existingLinks: store.state.links, portIndex,
    tiers: { lldp: true, fdb: true, arp: true, inferred: true },
    materializedUplinks,
    // Il self-heal transit lo fa già _autoDiscoverLinks: qui NON si ripete.
  });

  let nodes = 0, links = 0, pruned = 0;
  const pruneSet = new Set(ops.pruneLinkIds);
  if (pruneSet.size) { store.state.links = store.state.links.filter(l => !pruneSet.has(l.id)); pruned = pruneSet.size; }

  for (const m of ops.materialize) {
    const sw = _createInferredSwitch(m); nodes++;
    const upPid = `${sw.id}-1`;
    if (!store.state.ports[upPid]) store.state.ports[upPid] = {};
    if (!store.state.ports[m.onUplinkPid]) store.state.ports[m.onUplinkPid] = {};
    store.state.links.push(_mkLink(m.onUplinkPid, upPid, { autoLinked: true, confidence: m.confidence, protocol: 'INFERRED' })); links++;
    let pn = 2;
    for (const nid of (m.behindNodeIds || [])) {
      const epPid = `${nid}-1`;
      if (store.state.links.some(l => !l.autoLinked && (l.src === epPid || l.dst === epPid))) continue; // manual-first
      const swPid = `${sw.id}-${pn++}`;
      if (!store.state.ports[swPid]) store.state.ports[swPid] = {};
      if (!store.state.ports[epPid]) store.state.ports[epPid] = {};
      store.state.links.push(_mkLink(swPid, epPid, { autoLinked: true, confidence: m.confidence, protocol: 'INFERRED' })); links++;
    }
  }

  for (const nn of (ops.materializeNeighbors || [])) {
    const node = _createNeighborNode(nn); nodes++;
    const p1 = `${node.id}-1`;
    if (!store.state.ports[p1]) store.state.ports[p1] = {};
    if (!store.state.ports[nn.onLocalPid]) store.state.ports[nn.onLocalPid] = {};
    store.state.links.push(_mkLink(nn.onLocalPid, p1, { autoLinked: true, confidence: nn.confidence, protocol: nn.protocol || 'LLDP' })); links++;
  }

  if (nodes && typeof _invalidateIdx === 'function') _invalidateIdx();
  return { nodes, links, pruned };
}

// Esposto per test e2e (page.evaluate); il Sync la importa via ESM.
expose({ materializeTopologyNodes });
