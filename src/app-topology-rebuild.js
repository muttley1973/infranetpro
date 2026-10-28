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
import { markFilledFromRead } from '../lib/field-provenance.js';   // la regola: un nodo nato da una lettura marca i campi che questa ha scritto
import { buildVmIdentityIndex, findVmForRow } from '../lib/vm-nics.js';   // «e' gia' una VM di un host?»: la stessa funzione di Scopri, crawl, adozione e assorbimento
import { inferNeighborType, usableNeighborIp } from '../lib/neighbor-type.js';   // che COSA è il vicino: dalle capabilities/piattaforma che annuncia, non «sempre uno switch»
import { t, expose } from './_bridge.js';

const _norm = (m) => (typeof _normMacKey === 'function') ? _normMacKey(m) : String(m || '').trim().toLowerCase();

// Mappa MAC normalizzato → { nodeId, type } dai nodi/porte noti del progetto:
// etichetta gli endpoint "dietro" (regola type-aware) e riconosce i vicini noti.
function _macInfoMap() {
  const idx = {};
  for (const n of store.state.nodes) {
    const m = _norm(n.mac);
    if (m && !idx[m]) idx[m] = { nodeId: n.id, type: n.type || null, ip: n.ip || null };
  }
  for (const [pid, pi] of Object.entries(store.state.ports)) {
    const m = _norm(pi.mac);
    if (!m || idx[m]) continue;
    const nid = getPortNodeId(pid);
    const nd = nodeById(nid);
    idx[m] = { nodeId: nid, type: nd ? (nd.type || null) : null, ip: nd ? (nd.ip || null) : null };
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

// Vicino LLDP/CDP annunciato non documentato (es. gateway) → nodo con l'identità
// nota (MAC/IP/hostname). Il TIPO viene dalle prove che il vicino annuncia (capabilities
// e piattaforma: lib/neighbor-type.js); dove non ce ne sono resta «switch», come prima,
// e resta una deduzione (`inferred`) che l'utente conferma. Dove sta lo decide il tipo:
// un apparato da rack va nel rack, un access point o un telefono sul piano — non si
// riempie lo scaffale di cose che in uno scaffale non stanno.
// `k` = quanti nodi da piano sono già nati in questo giro (li distanzia in griglia).
function _createNeighborNode(nn, k) {
  const { type } = inferNeighborType({ protocol: nn.protocol, caps: nn.caps, platform: nn.platform, name: nn.hostname });
  const def = (typeof TYPES !== 'undefined' && TYPES[type]) || {};
  const usedIds = new Set(store.state.nodes.map(n => String(n.id || '')));
  const id = (typeof _nextNodeId === 'function') ? _nextNodeId(type, usedIds) : ((type === 'switch' ? 'sw_' : type + '_') + store.state.nodes.length);
  // L'IP di un vicino è identità solo se plausibile (non 0.x/loopback/link-local/multicast).
  const ip = usableNeighborIp(nn.ip);
  const n = {
    id, type, name: nn.hostname || ip || nn.mac || t('toporebuild.lldpNeighbor'),
    mac: nn.mac || '', ip, hostname: nn.hostname || '',
    inferred: true, identitySource: nn.protocol && /^CDP/i.test(nn.protocol) ? 'cdp' : 'lldp', identityConfidence: 'high',
  };
  if (def.isFloor) {
    // Sul piano: vicino al centro della vista, in griglia per non sovrapporre i nodi nati insieme.
    const base = (typeof _findFreeFloorSpot === 'function') ? _findFreeFloorSpot() : { x: 200, y: 200 };
    const i = k || 0;
    n.x = (base && base.x || 0) + (i % 5) * 120;
    n.y = (base && base.y || 0) + Math.floor(i / 5) * 120;
    n.ports = def.ports || 1;
  } else {
    const sU = def.sizeU || 1;
    const rackId = _ensureRack();
    n.rackId = rackId;
    n.rackU = (typeof _findFreeU === 'function') ? _findFreeU(rackId, sU) : 1;
    n.sizeU = sU;
    n.ports = type === 'switch' ? 24 : (def.ports || 1);
  }
  markFilledFromRead(n, ['mac']);   // nato da un vicino LLDP/CDP: il MAC lo ha scritto la lettura, non una persona
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
 * @returns {{ nodes:number, links:number, pruned:number, made?:Array }}
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

  const portIndex = buildPortIndex(store.state.ports, store.state.lagGroups || {},
    store.state.nodes.map(n => n && n.id).filter(Boolean));
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

  let nodes = 0, links = 0;
  // Intermediario inferito (2-4 endpoint, no LLDP): verità fisica NOTA (dietro c'è un
  // apparato multi-porta) ma TIPO incerto → NON si crea il nodo qui. La porta ha già
  // ≥2 MAC = SEGMENTO L2 CONDIVISO: la si marca con hint + il RUOLO SUGGERITO dai
  // segnali, così l'utente materializza l'apparato dal pannello «Segmento L2»
  // ([Crea Switch/AP/Gateway…] o [Lega a esistente]). Coerente col caso >4 MAC.
  // Niente prune: senza il nodo sostitutivo, i device dietro NON vanno reindirizzati.
  let segments = 0;
  const _ROLE_OF = { switch: 'switch', router: 'gateway', ap: 'ap', hypervisor: 'hypervisor' };
  for (const m of ops.materialize) {
    const pid = m.onUplinkPid; if (!pid) continue;
    const pi = store.state.ports[pid] = store.state.ports[pid] || {};
    pi.sharedSegmentHint = true;
    if (!pi.sharedSegmentMacCount) pi.sharedSegmentMacCount = (m.behindMacs || []).length;
    if (!pi.sharedSegmentRole && !pi.sharedSegmentRoleSuggested) pi.sharedSegmentRoleSuggested = _ROLE_OF[m.inferredType] || 'switch';
    segments++;
  }

  let floorMade = 0;
  const made = [];   // identità dei nodi nati: chi riassume il giro non li conta più fra i «non agganciati»
  // Le VM documentate sotto i loro host: un vicino che annuncia il MAC, il nome o l'indirizzo di una VM E' quella VM, e
  // non un apparato nuovo (prima si controllavano solo i nodi: la VM veniva ricreata come tile a OGNI Sync, anche
  // quello del monitoraggio automatico).
  const vmIdx = buildVmIdentityIndex(store.state.nodes);
  for (const nn of (ops.materializeNeighbors || [])) {
    // Due nodi con lo stesso IP sono due identità in conflitto: se l'apparato esiste già
    // (nato poco fa in questo stesso giro, o non riconosciuto dal confronto per nome) non
    // se ne crea un secondo — il cavo lo disegnerà il prossimo Sync sul nodo che c'è.
    const _ip = usableNeighborIp(nn.ip);
    if (_ip && store.state.nodes.some(x => x && x.ip === _ip)) continue;
    if (vmIdx.size && findVmForRow(vmIdx, { mac: nn.mac, hostname: nn.hostname, ip: _ip })) continue;
    const node = _createNeighborNode(nn, floorMade); nodes++;
    if (node.rackId == null) floorMade++;
    made.push({ nodeId: node.id, mac: node.mac || '', ip: node.ip || '', hostname: node.hostname || '' });
    const p1 = `${node.id}-1`;
    if (!store.state.ports[p1]) store.state.ports[p1] = {};
    if (!store.state.ports[nn.onLocalPid]) store.state.ports[nn.onLocalPid] = {};
    // Il nodo è MATERIALIZZATO (dedotto): il cavo nasce "da confermare", non
    // affidabile. Protocollo INFERRED + conf < 0.90 → linkState() lo classifica
    // 'ambiguous' ("Inferito · da verificare"), NON LLDP: l'annuncio LLDP ci ha
    // dato il vicino, non la conferma della porta/identità dell'apparato creato.
    store.state.links.push(_mkLink(nn.onLocalPid, p1, { autoLinked: true, confidence: 0.82, protocol: 'INFERRED' })); links++;
  }

  if (nodes && typeof _invalidateIdx === 'function') _invalidateIdx();
  return { nodes, links, pruned: 0, segments, made };
}

// Esposto per test e2e (page.evaluate); il Sync la importa via ESM.
expose({ materializeTopologyNodes });
