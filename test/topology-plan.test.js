// Test per il motore puro del piano topologia (lib/topology-plan.js).
// FASE 1 TOPO-REBUILD: assemblaggio candidati → dedup LAG-aware → reconcile
// manual-first → tier/evidenza/reason → idempotenza. Include il caso reale
// GS1900 (LAG1 ↛ porta 1, router su porta 23) attraverso lib/correlate.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTopologyPlan, inferUnmanagedNodes, assemblePlanInputs, buildApplyOps,
  _logicalPairKey, _tierFromEvidence, _nodeIdOfPort,
} = require('../lib/topology-plan.js');
const {
  buildPortIndex, buildMacIndex, buildPortMacIndex,
  buildNeighborCandidates, buildFdbCandidates, findPortByIfName,
} = require('../lib/correlate.js');

// Helper: portIndex da una mappa ports piatta.
function pIndex(ports, lagGroups) { return buildPortIndex(ports, lagGroups || {}); }

// ============================================================
// Primitive
// ============================================================

test('_nodeIdOfPort: taglio sull\'ultimo trattino (nodeId può avere trattini)', () => {
  assert.equal(_nodeIdOfPort('sw3-1-24'), 'sw3-1');
  assert.equal(_nodeIdOfPort('gs-23'), 'gs');
  assert.equal(_nodeIdOfPort('x'), 'x');
});

test('_tierFromEvidence: la famiglia più forte vince', () => {
  assert.equal(_tierFromEvidence(['LLDP']), 'lldp');
  assert.equal(_tierFromEvidence(['CDP']), 'lldp');
  assert.equal(_tierFromEvidence(['LLDP', 'MAC']), 'lldp');   // corroborato ma tier=dorsale
  assert.equal(_tierFromEvidence(['MAC']), 'fdb');
  assert.equal(_tierFromEvidence(['MAC', 'ARP']), 'fdb');     // MAC+ARP = edge FDB
  assert.equal(_tierFromEvidence(['ARP-MAC']), 'arp');        // ARP-primary = debole
  assert.equal(_tierFromEvidence([]), 'fdb');
});

test('_logicalPairKey: due membri dello stesso LAG → stessa chiave', () => {
  const ports = {
    'a-3': { ifName: 'Gi3', lagId: 1 }, 'a-6': { ifName: 'Gi6', lagId: 1 },
    'b-3': { ifName: 'Gi3', lagId: 2 }, 'b-6': { ifName: 'Gi6', lagId: 2 },
  };
  const pm = {};
  for (const [pid, pi] of Object.entries(ports)) pm[pid] = { lagId: pi.lagId, lagGroup: '' };
  // a-3↔b-3 e a-6↔b-6 sono lo stesso link logico LAG(a)↔LAG(b)
  assert.equal(_logicalPairKey('a-3', 'b-3', pm), _logicalPairKey('a-6', 'b-6', pm));
  // porte non-LAG restano distinte
  assert.notEqual(_logicalPairKey('a-3', 'b-3', {}), _logicalPairKey('a-6', 'b-6', {}));
});

// ============================================================
// buildTopologyPlan — logica base
// ============================================================

test('buildTopologyPlan: input vuoto → piano vuoto, nessun throw', () => {
  const plan = buildTopologyPlan({});
  assert.deepEqual(plan.links, []);
  assert.deepEqual(plan.inferredNodes, []);
  assert.deepEqual(plan.unreachable, []);
  assert.equal(plan.summary.total, 0);
});

test('buildTopologyPlan: tier + corroborazione dai sources', () => {
  const candidates = [
    { src: 'sw1-1', dst: 'sw2-1', confidence: 0.99, protocol: 'LLDP+MAC', sources: ['LLDP', 'MAC'] },
    { src: 'sw1-2', dst: 'pc1-1', confidence: 0.85, protocol: 'MAC', sources: ['MAC'] },
    { src: 'sw1-3', dst: 'pc2-1', confidence: 0.60, protocol: 'ARP-MAC', sources: ['ARP-MAC'] },
  ];
  const plan = buildTopologyPlan({ candidates, portIndex: pIndex({}) });
  const byPair = Object.fromEntries(plan.links.map(l => [`${l.src}|${l.dst}`, l]));
  assert.equal(byPair['sw1-1|sw2-1'].tier, 'lldp');
  assert.equal(byPair['sw1-1|sw2-1'].corroborated, true);
  assert.equal(byPair['sw1-2|pc1-1'].tier, 'fdb');
  assert.equal(byPair['sw1-2|pc1-1'].corroborated, false);
  assert.equal(byPair['sw1-3|pc2-1'].tier, 'arp');
  assert.equal(plan.summary.t1, 1);
  assert.equal(plan.summary.t2, 1);
  assert.equal(plan.summary.t3, 1);
});

test('buildTopologyPlan: dedup per coppia logica LAG-aware (2 membri → 1 link)', () => {
  const ports = {
    'a-3': { ifName: 'Gi3', lagId: 1 }, 'a-6': { ifName: 'Gi6', lagId: 1 },
    'b-3': { ifName: 'Gi3', lagId: 5 }, 'b-6': { ifName: 'Gi6', lagId: 5 },
  };
  const candidates = [
    { src: 'a-3', dst: 'b-3', confidence: 0.90, protocol: 'LLDP', sources: ['LLDP'] },
    { src: 'a-6', dst: 'b-6', confidence: 0.97, protocol: 'LLDP', sources: ['LLDP'] },
  ];
  const plan = buildTopologyPlan({ candidates, portIndex: pIndex(ports) });
  assert.equal(plan.links.length, 1, 'i due membri LAG collassano in un solo link logico');
  assert.equal(plan.links[0].confidence, 0.97, 'tiene la confidenza più alta');
});

test('buildTopologyPlan: dedup unisce evidenza da tier diversi (fusion)', () => {
  const candidates = [
    { src: 'sw1-1', dst: 'sw2-1', confidence: 0.72, protocol: 'MAC', sources: ['MAC'] },
    { src: 'sw1-1', dst: 'sw2-1', confidence: 0.97, protocol: 'LLDP', sources: ['LLDP'] },
  ];
  const plan = buildTopologyPlan({ candidates, portIndex: pIndex({}) });
  assert.equal(plan.links.length, 1);
  assert.equal(plan.links[0].tier, 'lldp');
  assert.equal(plan.links[0].corroborated, true, 'LLDP + MAC concordi → corroborato');
  assert.deepEqual([...plan.links[0].evidence].sort(), ['LLDP', 'MAC']);
});

// ============================================================
// Reconcile manual-first + idempotenza
// ============================================================

test('buildTopologyPlan: reconcile → link già presente = exists (idempotenza)', () => {
  const candidates = [{ src: 'sw1-1', dst: 'sw2-1', confidence: 0.97, protocol: 'LLDP', sources: ['LLDP'] }];
  const existingLinks = [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1', autoLinked: true }];
  const plan = buildTopologyPlan({ candidates, portIndex: pIndex({}), existingLinks });
  assert.equal(plan.links[0].status, 'exists');
  assert.equal(plan.summary.new, 0);
  assert.equal(plan.summary.exists, 1);
});

test('buildTopologyPlan: conflitto con cavo MANUALE su porta = conflict-manual (non sovrascrive)', () => {
  const candidates = [{ src: 'sw1-1', dst: 'sw2-1', confidence: 0.97, protocol: 'LLDP', sources: ['LLDP'] }];
  // Cavo manuale che usa sw1-1 verso un ALTRO peer.
  const existingLinks = [{ id: 'l1', src: 'sw1-1', dst: 'sw9-1', autoLinked: false }];
  const plan = buildTopologyPlan({ candidates, portIndex: pIndex({}), existingLinks });
  assert.equal(plan.links[0].status, 'conflict-manual');
  assert.equal(plan.summary.conflicts, 1);
});

test('buildTopologyPlan: cavo manuale sulla STESSA coppia = exists, non conflitto', () => {
  const candidates = [{ src: 'sw1-1', dst: 'sw2-1', confidence: 0.97, protocol: 'LLDP', sources: ['LLDP'] }];
  const existingLinks = [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1', autoLinked: false }];
  const plan = buildTopologyPlan({ candidates, portIndex: pIndex({}), existingLinks });
  assert.equal(plan.links[0].status, 'exists');
});

test('buildTopologyPlan: idempotenza — applicare il piano e ri-eseguire = stesso output, 0 new', () => {
  const candidates = [
    { src: 'sw1-1', dst: 'sw2-1', confidence: 0.97, protocol: 'LLDP', sources: ['LLDP'] },
    { src: 'sw1-2', dst: 'pc1-1', confidence: 0.85, protocol: 'MAC', sources: ['MAC'] },
  ];
  const portIndex = pIndex({});
  const first = buildTopologyPlan({ candidates, portIndex });
  assert.equal(first.summary.new, 2);
  // Simula l'apply: i link diventano cavi autoLinked.
  const applied = first.links.map((l, i) => ({ id: `l${i}`, src: l.src, dst: l.dst, autoLinked: true }));
  const second = buildTopologyPlan({ candidates, portIndex, existingLinks: applied });
  assert.equal(second.summary.new, 0);
  assert.equal(second.summary.exists, 2);
  // Output stabile: stesse coppie, stesso ordine.
  assert.deepEqual(second.links.map(l => l.logicalKey), first.links.map(l => l.logicalKey));
});

// ============================================================
// unreachable
// ============================================================

test('buildTopologyPlan: unreachable = infra SNMP con snmpStatus=err (non le foglie)', () => {
  const nodes = [
    { id: 'sw1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' }, snmpStatus: 'err' }, // down → unreachable
    { id: 'sw2', integration: { driver: 'snmp-v2c', host: '10.0.0.2' }, snmpStatus: 'ok' },  // ok
    { id: 'pc1', snmpStatus: 'err' },                                                          // no SNMP → non conta
  ];
  const plan = buildTopologyPlan({ candidates: [], portIndex: pIndex({}), nodes });
  assert.deepEqual(plan.unreachable, ['sw1']);
});

// ============================================================
// Caso reale GS1900 — attraverso lib/correlate.js (catena completa)
// LAG1 non deve risolversi alla porta fisica 1; il router va su porta 23.
// ============================================================

test('GS1900 reale: LAG1 ↛ porta 1, router su porta 23 (catena correlate → plan)', () => {
  const ROUTER_MAC = 'd4:1a:d1:82:11:20';
  // Porte GS1900: Gi1..Gi24, con LAG1 = lagId 1 sui membri 3 e 6 (come il reale).
  const ports = {};
  for (let i = 1; i <= 24; i++) {
    ports[`gs-${i}`] = { ifName: `GigabitEthernet${i}`, alias: '', lagId: (i === 3 || i === 6) ? 1 : 0, lagGroup: '' };
  }
  ports['rt-1'] = { ifName: '', alias: '' };
  const nodes = [
    { id: 'gs', hostname: 'GS1900', ports: 24 },
    { id: 'rt', hostname: 'router', mac: ROUTER_MAC, ports: 1 },
  ];
  const portIndex = buildPortIndex(ports, {});
  const macIndex = buildMacIndex(nodes, ports);
  const portMacIndex = buildPortMacIndex(ports);

  // LLDP: il GS1900 annuncia il router (chassis-id MAC) sulla porta 23.
  const neighbors = [{
    remoteDevice: ROUTER_MAC, remoteIP: '', remoteMac: ROUTER_MAC,
    localPort: 'GigabitEthernet23', remotePort: ROUTER_MAC.toUpperCase(), protocol: 'LLDP',
  }];
  // FDB: 4 MAC dietro LAG1 (segmento cieco) + il MAC del router sull'uplink porta 23.
  const fdbTable = {
    '11:11:11:11:11:11': 'LAG1', '22:22:22:22:22:22': 'LAG1',
    '33:33:33:33:33:33': 'LAG1', '44:44:44:44:44:44': 'LAG1',
    [ROUTER_MAC]: 'GigabitEthernet23',
  };

  const cset = buildNeighborCandidates('gs', neighbors, nodes, portIndex, macIndex);
  const fdbRes = buildFdbCandidates('gs', fdbTable, {}, nodes, portIndex, portMacIndex, {});
  const candidates = cset.values().concat(fdbRes.cset.values());

  const plan = buildTopologyPlan({
    candidates, portIndex, nodes,
    sharedSegments: fdbRes.sharedSegments,
  });

  // Nessun link tocca la porta fisica 1 del GS1900 (il bug storico).
  const touchesP1 = plan.links.some(l => l.src === 'gs-1' || l.dst === 'gs-1');
  assert.equal(touchesP1, false, 'LAG1 NON deve produrre cavi su porta 1');

  // Il router è cablato sulla porta 23 (dorsale LLDP T1).
  const routerLink = plan.links.find(l =>
    (l.src === 'gs-23' && l.dst === 'rt-1') || (l.src === 'rt-1' && l.dst === 'gs-23'));
  assert.ok(routerLink, 'deve esistere il link GS1900 Gi23 ↔ router');
  assert.equal(routerLink.tier, 'lldp');
  assert.ok(routerLink.confidence >= 0.9);
});

// ============================================================
// FASE 2 — inferUnmanagedNodes (switch/AP non gestito inferito)
// ============================================================

test('inferUnmanagedNodes: 2 webcam senza LLDP → 1 switch inferito sull\'uplink', () => {
  const pe = [{
    portId: 'gs-24', ifName: 'GigabitEthernet24', hasLldpNeighbor: false,
    macs: [{ mac: 'ec:71:db:49:58:05', type: 'webcam' }, { mac: 'ec:71:db:4f:bd:51', type: 'webcam' }],
  }];
  const inf = inferUnmanagedNodes(pe);
  assert.equal(inf.length, 1);
  assert.equal(inf[0].kind, 'unmanaged-switch');
  assert.equal(inf[0].onUplinkPid, 'gs-24');
  assert.deepEqual(inf[0].behindMacs, ['ec:71:db:49:58:05', 'ec:71:db:4f:bd:51']);
  assert.equal(inf[0].confidence, 0.82, '2 endpoint non-passthrough: alta, non debole');
});

test('inferUnmanagedNodes: coppia VoIP + PC → NESSUNA inferenza (switch interno del telefono)', () => {
  const pe = [{
    portId: 'sw-5', ifName: 'Gi5', hasLldpNeighbor: false,
    macs: [{ mac: 'aa:aa:aa:00:00:01', type: 'voip' }, { mac: 'bb:bb:bb:00:00:02', type: 'pc' }],
  }];
  assert.equal(inferUnmanagedNodes(pe).length, 0);
});

test('inferUnmanagedNodes: 2 PC (nessun pass-through) → inferisce', () => {
  const pe = [{
    portId: 'sw-5', hasLldpNeighbor: false,
    macs: [{ mac: 'aa:aa:aa:00:00:01', type: 'pc' }, { mac: 'bb:bb:bb:00:00:02', type: 'pc' }],
  }];
  assert.equal(inferUnmanagedNodes(pe).length, 1);
});

test('inferUnmanagedNodes: confidenza sale col numero di endpoint', () => {
  const mk = (n) => ({ portId: 'sw-1', hasLldpNeighbor: false,
    macs: Array.from({ length: n }, (_, i) => ({ mac: `aa:aa:aa:00:00:0${i}`, type: 'pc' })) });
  assert.equal(inferUnmanagedNodes([mk(2)])[0].confidence, 0.82);
  assert.equal(inferUnmanagedNodes([mk(3)])[0].confidence, 0.88);
  assert.equal(inferUnmanagedNodes([mk(6)])[0].confidence, 0.92);
});

test('inferUnmanagedNodes: vicino LLDP presente → NON inferisce (apparato gestito)', () => {
  const pe = [{ portId: 'gs-23', hasLldpNeighbor: true,
    macs: [{ mac: 'aa:aa:aa:00:00:01' }, { mac: 'bb:bb:bb:00:00:02' }, { mac: 'cc:cc:cc:00:00:03' }] }];
  assert.equal(inferUnmanagedNodes(pe).length, 0);
});

test('inferUnmanagedNodes: porta già occupata da un nodo reale → skip', () => {
  const pe = [{ portId: 'gs-24', hasLldpNeighbor: false,
    macs: [{ mac: 'aa:aa:aa:00:00:01', type: 'pc' }, { mac: 'bb:bb:bb:00:00:02', type: 'pc' }] }];
  assert.equal(inferUnmanagedNodes(pe, { occupiedPorts: new Set(['gs-24']) }).length, 0);
});

test('inferUnmanagedNodes: 1 solo MAC → collegamento diretto, niente inferenza', () => {
  const pe = [{ portId: 'gs-8', hasLldpNeighbor: false, macs: [{ mac: 'aa:aa:aa:00:00:01' }] }];
  assert.equal(inferUnmanagedNodes(pe).length, 0);
});

test('inferUnmanagedNodes: MAC duplicati contano una volta; stessa porta due volte → 1 nodo', () => {
  const pe = [
    { portId: 'gs-24', hasLldpNeighbor: false,
      macs: [{ mac: 'aa:aa:aa:00:00:01' }, { mac: 'AA:AA:AA:00:00:01' }] }, // dup → n=1 → no
  ];
  assert.equal(inferUnmanagedNodes(pe).length, 0);
});

test('buildTopologyPlan: integra inferredNodes + summary.t4 dal portEndpoints', () => {
  const portEndpoints = [{
    portId: 'gs-24', ifName: 'GigabitEthernet24', hasLldpNeighbor: false,
    macs: [{ mac: 'ec:71:db:49:58:05', type: 'webcam' }, { mac: 'ec:71:db:4f:bd:51', type: 'webcam' }],
  }];
  const plan = buildTopologyPlan({ candidates: [], portIndex: pIndex({}), portEndpoints });
  assert.equal(plan.inferredNodes.length, 1);
  assert.equal(plan.summary.t4, 1);
});

test('buildTopologyPlan: senza portEndpoints inferredNodes resta [] (retrocompat FASE 1)', () => {
  const plan = buildTopologyPlan({ candidates: [{ src: 'a-1', dst: 'b-1', confidence: 0.9, protocol: 'LLDP', sources: ['LLDP'] }], portIndex: pIndex({}) });
  assert.deepEqual(plan.inferredNodes, []);
  assert.equal(plan.links.length, 1);
});

test('buildTopologyPlan: link diretti verso endpoint DIETRO un nodo inferito vengono soppressi', () => {
  // Due webcam NOTE (nodi progetto cam1/cam2) risulterebbero cablate dirette a gs-24
  // → impossibile (1 porta = 1 cavo). L'inferenza le mette dietro lo switch: i 2
  // cavi diretti spariscono dal piano (li ricostruisce l'apply via lo switch).
  const candidates = [
    { src: 'gs-24', dst: 'cam1-1', confidence: 0.85, protocol: 'MAC', sources: ['MAC'] },
    { src: 'gs-24', dst: 'cam2-1', confidence: 0.85, protocol: 'MAC', sources: ['MAC'] },
  ];
  const portEndpoints = [{
    portId: 'gs-24', ifName: 'GigabitEthernet24', hasLldpNeighbor: false,
    macs: [{ mac: 'ec:71:db:49:58:05', type: 'webcam', nodeId: 'cam1' },
           { mac: 'ec:71:db:4f:bd:51', type: 'webcam', nodeId: 'cam2' }],
  }];
  const plan = buildTopologyPlan({ candidates, portIndex: pIndex({}), portEndpoints });
  assert.equal(plan.inferredNodes.length, 1);
  assert.equal(plan.inferredNodes[0].behindNodes.length, 2);
  const directToP24 = plan.links.filter(l => l.src === 'gs-24' || l.dst === 'gs-24');
  assert.equal(directToP24.length, 0, 'i 2 cavi diretti impossibili sono soppressi');
});

test('porta-24 reale: 2 webcam Reolink su una porta NON diventano 2 cavi diretti impossibili', () => {
  // Sulla porta 24 la FDB vede 2 MAC endpoint (2 camere). Nessuno dei due è un
  // nodo-porta noto del progetto né ha ARP → buildFdbCandidates non inventa
  // cavi punto-punto verso di essi. (La materializzazione dello switch inferito
  // è la FASE 2; qui si verifica solo che NON nascano 2 cavi sulla stessa porta.)
  const ports = {};
  for (let i = 1; i <= 24; i++) ports[`gs-${i}`] = { ifName: `GigabitEthernet${i}`, lagId: 0, lagGroup: '' };
  const nodes = [{ id: 'gs', hostname: 'GS1900', ports: 24 }];
  const portIndex = buildPortIndex(ports, {});
  const portMacIndex = buildPortMacIndex(ports);
  const fdbTable = { 'ec:71:db:49:58:05': 'GigabitEthernet24', 'ec:71:db:4f:bd:51': 'GigabitEthernet24' };

  const fdbRes = buildFdbCandidates('gs', fdbTable, {}, nodes, portIndex, portMacIndex, {});
  const plan = buildTopologyPlan({
    candidates: fdbRes.cset.values(), portIndex, nodes,
    sharedSegments: fdbRes.sharedSegments,
  });
  const onP24 = plan.links.filter(l => l.src === 'gs-24' || l.dst === 'gs-24');
  assert.equal(onP24.length, 0, 'niente cavi diretti fantasma sulla porta 24 (endpoint ignoti)');
});

// ============================================================
// FASE 3 — assemblePlanInputs (poll grezzo → input del piano)
// ============================================================

test('assemblePlanInputs: candidates/shared passthrough + portEndpoints da fdb+neighbors', () => {
  const ports = { 'gs-23': { ifName: 'Gi23' }, 'gs-24': { ifName: 'Gi24' } };
  const portIndex = buildPortIndex(ports, {});
  const pollResults = [{
    nodeId: 'gs',
    fdbTable: { 'aa:aa:aa:00:00:01': 'Gi23', 'bb:bb:bb:00:00:02': 'Gi24', 'cc:cc:cc:00:00:03': 'Gi24' },
    neighbors: [{ localPort: 'Gi23', remoteDevice: 'router', protocol: 'LLDP' }],
    suggestedLinks: [{ src: 'gs-23', dst: 'rt-1', confidence: 0.97, protocol: 'LLDP', sources: ['LLDP'] }],
    suggestedSharedSegments: [{ portId: 'gs-24', ifName: 'Gi24', macCount: 2 }],
  }];
  const ctx = { findPort: (nid, ifn) => findPortByIfName(nid, ifn, portIndex) };
  const inp = assemblePlanInputs(pollResults, ctx);
  assert.equal(inp.candidates.length, 1);
  assert.equal(inp.sharedSegments.length, 1);
  const pe = Object.fromEntries(inp.portEndpoints.map(p => [p.portId, p]));
  assert.equal(pe['gs-23'].hasLldpNeighbor, true, 'Gi23 ha vicino LLDP');
  assert.equal(pe['gs-24'].hasLldpNeighbor, false);
  assert.equal(pe['gs-24'].macs.length, 2);
});

test('assemblePlanInputs: esclude le interfacce LAG dalle porte d\'accesso', () => {
  const ports = { 'gs-3': { ifName: 'Gi3', lagId: 1 } };
  const portIndex = buildPortIndex(ports, {});
  const pollResults = [{ nodeId: 'gs', fdbTable: { 'aa:aa:aa:00:00:01': 'LAG1', 'bb:bb:bb:00:00:02': 'LAG1' }, neighbors: [] }];
  const inp = assemblePlanInputs(pollResults, { findPort: (nid, ifn) => findPortByIfName(nid, ifn, portIndex) });
  assert.equal(inp.portEndpoints.length, 0, 'LAG = uplink di transito, non porta d\'accesso');
});

test('assemblePlanInputs: scarta MAC virtuali (Docker/VM)', () => {
  const ports = { 'gs-5': { ifName: 'Gi5' } };
  const portIndex = buildPortIndex(ports, {});
  const virt = new Set(['02:42:ac:11:00:02']); // veth Docker
  const pollResults = [{ nodeId: 'gs', fdbTable: { '02:42:ac:11:00:02': 'Gi5', 'aa:bb:cc:00:00:01': 'Gi5' }, neighbors: [] }];
  const inp = assemblePlanInputs(pollResults, {
    findPort: (nid, ifn) => findPortByIfName(nid, ifn, portIndex),
    isVirtualMac: (m) => virt.has(String(m).toLowerCase()),
  });
  assert.equal(inp.portEndpoints[0].macs.length, 1, 'il MAC virtuale non conta');
});

test('DATI REALI GS1900: catena poll→assemble→piano — solo porta 24 infersce lo switch', () => {
  // FDB reale catturata dal vivo (192.168.1.100, SNMP v2c public).
  const REAL_FDB = {
    '40:9f:38:6e:0f:99': 'GigabitEthernet23', '4c:bc:e9:aa:e5:ca': 'GigabitEthernet23',
    'd4:1a:d1:82:11:20': 'GigabitEthernet23', 'd6:1a:d1:82:11:22': 'GigabitEthernet23',
    'f0:03:8c:d5:88:14': 'GigabitEthernet23', 'f4:39:09:62:f2:46': 'GigabitEthernet23',
    'f4:bf:80:da:ed:dc': 'GigabitEthernet23', 'f4:f5:e8:50:32:32': 'GigabitEthernet23',
    '00:11:32:8f:53:51': 'LAG1', '02:11:32:29:f2:db': 'LAG1',
    '08:26:97:f9:89:47': 'LAG1', '18:60:24:78:37:0b': 'LAG1',
    'ec:71:db:49:58:05': 'GigabitEthernet24', 'ec:71:db:4f:bd:51': 'GigabitEthernet24', // 2 Reolink
    '00:04:4b:b4:b0:d4': 'GigabitEthernet14',   // Shield
    '00:0c:c1:00:bd:f6': 'GigabitEthernet8',    // Eaton UPS
    '00:d0:4b:94:c1:f0': 'GigabitEthernet21',   // LaCie
    'fc:f1:52:a5:78:7f': 'GigabitEthernet20',   // Sony
  };
  const ports = {};
  for (let i = 1; i <= 24; i++) ports[`gs-${i}`] = { ifName: `GigabitEthernet${i}`, lagId: 0, lagGroup: '' };
  const nodes = [{ id: 'gs', hostname: 'GS1900', ports: 24 }];
  const portIndex = buildPortIndex(ports, {});
  const WEBCAMS = new Set(['ec:71:db:49:58:05', 'ec:71:db:4f:bd:51']);

  const pollResults = [{
    nodeId: 'gs', fdbTable: REAL_FDB,
    neighbors: [{ localPort: 'GigabitEthernet23', remoteDevice: 'd4:1a:d1:82:11:20', protocol: 'LLDP' }],
    suggestedLinks: [], suggestedSharedSegments: [],
  }];
  const ctx = {
    findPort: (nid, ifn) => findPortByIfName(nid, ifn, portIndex),
    macInfo: (m) => WEBCAMS.has(String(m).toLowerCase()) ? { type: 'webcam' } : null,
  };
  const inp = assemblePlanInputs(pollResults, ctx);
  const pe = Object.fromEntries(inp.portEndpoints.map(p => [p.portId, p]));

  // LAG1 escluso; Gi23 con vicino LLDP (8 MAC); Gi24 senza LLDP (2 webcam).
  assert.ok(!inp.portEndpoints.some(p => /LAG/i.test(p.ifName)), 'LAG1 non è porta d\'accesso');
  assert.equal(pe['gs-23'].hasLldpNeighbor, true);
  assert.equal(pe['gs-23'].macs.length, 8);
  assert.equal(pe['gs-24'].hasLldpNeighbor, false);
  assert.equal(pe['gs-24'].macs.length, 2);

  const plan = buildTopologyPlan({ candidates: inp.candidates, portIndex, nodes, sharedSegments: inp.sharedSegments, portEndpoints: inp.portEndpoints });
  // Esattamente 1 switch inferito, sulla porta 24, con le 2 webcam dietro.
  assert.equal(plan.inferredNodes.length, 1, 'solo la porta 24 infersce (Gi23 ha LLDP; le altre 1 MAC)');
  assert.equal(plan.inferredNodes[0].onUplinkPid, 'gs-24');
  assert.deepEqual(plan.inferredNodes[0].behindMacs.sort(), ['ec:71:db:49:58:05', 'ec:71:db:4f:bd:51']);
  assert.equal(plan.summary.t4, 1);
});

// ============================================================
// FASE 5 — buildApplyOps (piano → operazioni di apply)
// ============================================================

test('buildApplyOps: addLinks solo dei tier selezionati, dedup vs esistenti', () => {
  const plan = { links: [
    { src: 'a-1', dst: 'b-1', tier: 'lldp', confidence: 0.97 },
    { src: 'a-2', dst: 'c-1', tier: 'fdb', confidence: 0.85 },
  ] };
  const ops = buildApplyOps(plan, {
    existingLinks: [{ id: 'e1', src: 'a-1', dst: 'b-1', autoLinked: true }], // già presente
    portIndex: pIndex({}), tiers: { lldp: true, fdb: false, arp: false, inferred: false },
  });
  assert.equal(ops.addLinks.length, 0, 'lldp già presente + fdb tier off → niente da aggiungere');
});

test('buildApplyOps: manual-first — non aggiunge se la porta ha un cavo manuale verso altro peer', () => {
  const plan = { links: [{ src: 'sw1-1', dst: 'sw2-1', tier: 'lldp', confidence: 0.97 }] };
  const ops = buildApplyOps(plan, {
    existingLinks: [{ id: 'm1', src: 'sw1-1', dst: 'sw9-1', autoLinked: false }],
    portIndex: pIndex({}),
  });
  assert.equal(ops.addLinks.length, 0, 'conflitto con cavo manuale → non tocca');
});

test('buildApplyOps: materializza il nodo inferito + reroute-prune del cavo diretto', () => {
  const plan = { links: [], inferredNodes: [
    { onUplinkPid: 'gs-24', behindNodes: ['cam1'], behindMacs: ['m1'], confidence: 0.82 },
  ] };
  const ops = buildApplyOps(plan, {
    existingLinks: [{ id: 'L1', src: 'gs-24', dst: 'cam1-1', autoLinked: true }],
    portIndex: pIndex({}),
  });
  assert.equal(ops.materialize.length, 1);
  assert.equal(ops.materialize[0].onUplinkPid, 'gs-24');
  assert.deepEqual(ops.materialize[0].behindNodeIds, ['cam1']);
  assert.ok(ops.pruneLinkIds.includes('L1'), 'il cavo diretto cam1↔gs-24 è superato → prune');
});

test('buildApplyOps: idempotente — uplink già materializzato → non ri-materializza', () => {
  const plan = { inferredNodes: [{ onUplinkPid: 'gs-24', behindNodes: ['cam1'], confidence: 0.82 }] };
  const ops = buildApplyOps(plan, {
    existingLinks: [], portIndex: pIndex({}), materializedUplinks: new Set(['gs-24']),
  });
  assert.equal(ops.materialize.length, 0);
});

test('buildApplyOps: tier inferred OFF → nessuna materializzazione', () => {
  const plan = { inferredNodes: [{ onUplinkPid: 'gs-24', behindNodes: ['cam1'], confidence: 0.82 }] };
  const ops = buildApplyOps(plan, {
    existingLinks: [], portIndex: pIndex({}), tiers: { lldp: true, fdb: true, arp: true, inferred: false },
  });
  assert.equal(ops.materialize.length, 0);
});

test('buildApplyOps: self-heal transit — auto-link il cui MAC risolve a uplink/trunk → prune', () => {
  const ops = buildApplyOps({ links: [], inferredNodes: [] }, {
    existingLinks: [
      { id: 'L2', src: 'sw3-1', dst: 'pcX-1', autoLinked: true },   // pcX ora dietro un uplink
      { id: 'M2', src: 'sw3-2', dst: 'pcY-1', autoLinked: false },  // manuale → mai toccato
    ],
    portIndex: pIndex({}),
    isLeafNode: (nid) => nid === 'pcX' || nid === 'pcY',
    resolveEndpoint: (nid) => nid === 'pcX' ? { ok: false, reason: 'port-uplink' } : { ok: false, reason: 'port-trunk' },
  });
  assert.ok(ops.pruneLinkIds.includes('L2'), 'auto-link transit → prune (self-heal sw3-1)');
  assert.ok(!ops.pruneLinkIds.includes('M2'), 'il cavo MANUALE non viene mai rimosso');
});
