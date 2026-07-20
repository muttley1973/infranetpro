// Test per le primitive pure di correlazione (lib/correlate.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pairSig, createCandidateSet,
  matchNodeByIdent, buildPortIndex, buildMacIndex, collectNodeMacs,
  buildPortMacIndex, findPortByIfName, buildNeighborCandidates, buildFdbCandidates,
} = require('../lib/correlate.js');
const { linkState } = require('../lib/linkstate.js');

test('collectNodeMacs: chassis + MAC interfacce, deduplicati', () => {
  const node = { id: 'sw1', mac: 'AA:BB:CC:00:00:01' };
  const ports = {
    'sw1-1': { mac: 'AA:BB:CC:00:00:02' },
    'sw1-2': { mac: 'AA:BB:CC:00:00:01' },   // dup del chassis → deduplicato
    'sw1-3': { mac: '' },
    'sw9-1': { mac: 'DE:AD:BE:EF:00:00' },   // altro nodo → escluso
  };
  const macs = collectNodeMacs(node, ports, m => String(m || '').toUpperCase()).sort();
  assert.deepEqual(macs, ['AA:BB:CC:00:00:01', 'AA:BB:CC:00:00:02']);
});

test('collectNodeMacs: node.mac vuoto → usa solo i MAC delle porte', () => {
  const node = { id: 'pc1', mac: '' };
  const ports = { 'pc1-1': { mac: '11:22:33:44:55:66' } };
  assert.deepEqual(collectNodeMacs(node, ports, m => m), ['11:22:33:44:55:66']);
});

test('collectNodeMacs: nodo nullo o senza MAC → array vuoto', () => {
  assert.deepEqual(collectNodeMacs(null, {}), []);
  assert.deepEqual(collectNodeMacs({ id: 'x' }, {}), []);
});

test('pairSig: ordine-indipendente', () => {
  assert.equal(pairSig('a-1', 'b-2'), pairSig('b-2', 'a-1'));
  assert.equal(pairSig('sw1-1', 'sw2-3'), 'sw1-1||sw2-3');
});

test('pairSig: normalizza null/undefined a stringa vuota', () => {
  assert.equal(pairSig(null, 'x'), pairSig('x', null));
  assert.equal(pairSig(undefined, undefined), '||');
  assert.equal(pairSig('', 'a'), '||a');
});

test('pairSig: coppie diverse -> firme diverse', () => {
  assert.notEqual(pairSig('a-1', 'b-1'), pairSig('a-1', 'b-2'));
});

test('createCandidateSet: dedup per coppia, tiene la confidenza migliore', () => {
  const cs = createCandidateSet();
  cs.add('a-1', 'b-1', 0.72, 'MAC');
  cs.add('b-1', 'a-1', 0.97, 'LLDP'); // stessa coppia (ordine inverso), conf maggiore -> vince
  cs.add('a-1', 'b-1', 0.50, 'ARP');  // conf minore -> ignorato
  assert.equal(cs.size(), 1);
  const v = cs.values()[0];
  // GAP 1: LLDP (trusted) + MAC/ARP (inferiti) sulla stessa coppia si
  // corroborano -> fusione: conf 0.97+0.02 (cap 0.99), protocol 'LLDP+MAC'.
  assert.equal(v.confidence, 0.99);
  assert.equal(v.protocol, 'LLDP+MAC');
  assert.equal(v.corroborated, true);
});

test('createCandidateSet GAP1: LLDP da solo NON viene fuso', () => {
  const cs = createCandidateSet();
  cs.add('a-1', 'b-1', 0.97, 'LLDP');
  const v = cs.values()[0];
  assert.equal(v.confidence, 0.97);
  assert.equal(v.protocol, 'LLDP');
  assert.equal(v.corroborated, undefined);
});

test('createCandidateSet GAP1: due evidenze inferite NON si fondono (niente boost)', () => {
  const cs = createCandidateSet();
  cs.add('a-1', 'b-1', 0.85, 'MAC');
  cs.add('a-1', 'b-1', 0.84, 'ARP-MAC');
  const v = cs.values()[0];
  assert.equal(v.confidence, 0.85);  // max, nessun +0.02
  assert.equal(v.protocol, 'MAC');
});

test('createCandidateSet GAP1: CDP + ARP-MAC -> CDP+MAC 0.92', () => {
  const cs = createCandidateSet();
  cs.add('a-1', 'b-1', 0.90, 'CDP');
  cs.add('a-1', 'b-1', 0.84, 'ARP-MAC');
  const v = cs.values()[0];
  assert.equal(v.confidence, 0.92);
  assert.equal(v.protocol, 'CDP+MAC');
});

test('createCandidateSet GAP1: fusione idempotente (stessa evidenza N volte non cumula)', () => {
  const cs = createCandidateSet();
  cs.add('a-1', 'b-1', 0.97, 'LLDP');
  cs.add('a-1', 'b-1', 0.85, 'MAC');
  cs.add('a-1', 'b-1', 0.85, 'MAC');
  cs.add('a-1', 'b-1', 0.97, 'LLDP');
  assert.equal(cs.values()[0].confidence, 0.99); // sempre max+0.02, mai 0.97+N*0.02
  assert.equal(cs.values()[0].confidence, 0.99); // values() richiamabile senza side-effect
});

test('createCandidateSet GAP1: label fusa in input (server) resta trusted-family', () => {
  // Il client ri-aggiunge i suggestedLinks del server (gia' fusi come
  // 'LLDP+MAC') nel proprio cset insieme a nuove evidenze MAC: la label
  // fusa appartiene alla famiglia trusted -> nessun doppio boost ne'
  // degradazione a inferito.
  const cs = createCandidateSet();
  cs.add('a-1', 'b-1', 0.99, 'LLDP+MAC');
  cs.add('a-1', 'b-1', 0.85, 'MAC');
  const v = cs.values()[0];
  assert.equal(v.protocol, 'LLDP+MAC');
  assert.equal(v.confidence, 0.99); // cap, non 1.01
});

test('createCandidateSet: scarta input invalidi (vuoti / self-link)', () => {
  const cs = createCandidateSet();
  cs.add('', 'b-1', 0.9, 'MAC');
  cs.add('a-1', '', 0.9, 'MAC');
  cs.add('a-1', 'a-1', 0.9, 'MAC'); // self-link
  assert.equal(cs.size(), 0);
});

test('createCandidateSet: protocollo di default AUTO; values preserva le coppie', () => {
  const cs = createCandidateSet();
  cs.add('a-1', 'b-1', 0.9);          // proto omesso -> AUTO
  cs.add('c-1', 'd-1', 0.8, 'CDP');
  assert.equal(cs.size(), 2);
  assert.equal(cs.values().find(c => c.src === 'a-1').protocol, 'AUTO');
});

// ============================================================
// C — funzioni pure LLDP/CDP (matchNodeByIdent, findPortByIfName, buildNeighborCandidates)
// ============================================================

// ---- matchNodeByIdent -------------------------------------------------------

test('matchNodeByIdent: priorità P1>P2>P3>P4', () => {
  const nodes = [
    { id:'sw1', hostname:'sw1.example.lan', name:'Core Switch', ip:'10.0.0.1' },
    { id:'sw2', hostname:'',             name:'sw1.example.lan', ip:'10.0.0.2' }, // P2 match su name
    { id:'sw3', hostname:'sw3.example.lan', name:'Switch 3',    ip:'10.0.0.3' },
    { id:'rtr', hostname:'',             name:'Router',       ip:'10.0.0.100' },
  ];
  // P1: exact hostname
  assert.equal(matchNodeByIdent('sw1.example.lan', null, nodes)?.id, 'sw1');
  // P2: exact name (quando hostname non c'è)
  assert.equal(matchNodeByIdent('sw1.example.lan', null, [nodes[1]])?.id, 'sw2');
  // P3: short-name (ignora dominio)
  assert.equal(matchNodeByIdent('sw3', null, nodes)?.id, 'sw3');
  // P4: IP
  assert.equal(matchNodeByIdent('', '10.0.0.100', nodes)?.id, 'rtr');
  // Nessun match
  assert.equal(matchNodeByIdent('unknown', '9.9.9.9', nodes), null);
  // Input vuoti
  assert.equal(matchNodeByIdent('', '', nodes), null);
});

test('matchNodeByIdent: IP in integration.host', () => {
  const nodes = [
    { id:'fw1', hostname:'', name:'Firewall', ip:'', integration:{ host:'192.168.1.254' } },
  ];
  assert.equal(matchNodeByIdent('', '192.168.1.254', nodes)?.id, 'fw1');
});

// ---- buildPortIndex / findPortByIfName --------------------------------------

const SAMPLE_PORTS = {
  'sw1-1': { ifName:'GigabitEthernet0/1', alias:'uplink-core' },
  'sw1-2': { ifName:'GigabitEthernet0/2', alias:'' },
  'sw1-3': { ifName:'Port-channel1',      alias:'' },
  'sw1-4': { ifName:'gi4',                alias:'' },   // short form già normalizzata
};

test('buildPortIndex: struttura base', () => {
  const idx = buildPortIndex(SAMPLE_PORTS);
  assert.ok(Array.isArray(idx.ports['sw1']));
  assert.equal(idx.ports['sw1'].length, 4);
  assert.ok(idx.ports['sw1'].every(e => e.portId && e.ifName !== undefined));
});

test('findPortByIfName: match exact (raw)', () => {
  const idx = buildPortIndex(SAMPLE_PORTS);
  assert.equal(findPortByIfName('sw1', 'GigabitEthernet0/1', idx), 'sw1-1');
});

test('findPortByIfName: match normalized vendor-neutral (Gi0/1 → GigabitEthernet0/1)', () => {
  const idx = buildPortIndex(SAMPLE_PORTS);
  // "Gi0/1" normalizzato → "0/1"; "GigabitEthernet0/1" normalizzato → "0/1" → match
  assert.equal(findPortByIfName('sw1', 'Gi0/1', idx), 'sw1-1');
  assert.equal(findPortByIfName('sw1', 'Te0/2', idx), 'sw1-2'); // TenGig fallback numOnly
});

test('findPortByIfName: match su alias', () => {
  const idx = buildPortIndex(SAMPLE_PORTS);
  assert.equal(findPortByIfName('sw1', 'uplink-core', idx), 'sw1-1');
});

test('findPortByIfName: MAC come ifName -> null (subtype MAC non abbinabile)', () => {
  const idx = buildPortIndex(SAMPLE_PORTS);
  assert.equal(findPortByIfName('sw1', 'aa:bb:cc:dd:ee:ff', idx), null);
});

test('findPortByIfName: nodo senza porte -> null', () => {
  const idx = buildPortIndex(SAMPLE_PORTS);
  assert.equal(findPortByIfName('sw99', 'Gi0/1', idx), null);
});

test('findPortByIfName: LAG logico (Port-channel1 / po1)', () => {
  const idx = buildPortIndex(SAMPLE_PORTS);
  assert.equal(findPortByIfName('sw1', 'Port-channel1', idx), 'sw1-3');
  assert.equal(findPortByIfName('sw1', 'Po1',           idx), 'sw1-3');
});

// REGRESSIONE (uplink reale, es. Zyxel GS1900): la FDB impara i MAC sull'aggregato
// "LAG1"; un aggregato NON deve risolversi alla porta FISICA che condivide il numero
// (porta 1) via il fallback numerico. Vendor-neutral: vale per Po/ae/Eth-Trunk/bond…
const PORTS_PHYS_ONLY = {
  'sw3-1': { ifName:'GigabitEthernet1', alias:'' },   // porta FISICA n.1
  'sw3-3': { ifName:'GigabitEthernet3', alias:'' },
  'sw3-6': { ifName:'GigabitEthernet6', alias:'' },
};
test('findPortByIfName: un aggregato (LAG1/Po1/ae1) NON cade sulla porta fisica 1', () => {
  const idx = buildPortIndex(PORTS_PHYS_ONLY);
  // Nessun LAG modellato → non risolto (mai la porta fisica 1, che è down/altro).
  assert.equal(findPortByIfName('sw3', 'LAG1', idx), null);
  assert.equal(findPortByIfName('sw3', 'Po1',  idx), null);
  assert.equal(findPortByIfName('sw3', 'ae1',  idx), null);
  // Controprova: una porta fisica normale continua a risolversi.
  assert.equal(findPortByIfName('sw3', 'Gi3', idx), 'sw3-3');
});

test('findPortByIfName: LAG con porte-membro (lagId) → prima porta membro, non la fisica 1', () => {
  const idx = buildPortIndex({
    'sw3-1': { ifName:'GigabitEthernet1' },              // fisica 1 (trappola)
    'sw3-3': { ifName:'GigabitEthernet3', lagId:1 },     // membro LAG1
    'sw3-6': { ifName:'GigabitEthernet6', lagId:1 },     // membro LAG1
  });
  assert.equal(findPortByIfName('sw3', 'LAG1', idx), 'sw3-3');   // uplink reale, membro più basso
});

// ---- buildMacIndex ----------------------------------------------------------

test('buildMacIndex: nodi e porte', () => {
  const nodes = [
    { id:'sw1', mac:'00:11:22:33:44:55' },
    { id:'sw2', mac:'' },
  ];
  const ports = {
    'sw2-1': { mac:'aa:bb:cc:dd:ee:ff', ifName:'Gi0/1' },
    'sw2-2': { mac:'',                  ifName:'Gi0/2' },
  };
  const idx = buildMacIndex(nodes, ports);
  assert.equal(idx['00:11:22:33:44:55'], 'sw1');
  assert.equal(idx['aa:bb:cc:dd:ee:ff'], 'sw2');
  assert.ok(!idx['']);  // MAC vuoto non indicizzato
});

test('buildPortMacIndex: MAC porta -> nodeId/portId', () => {
  const ports = {
    'sw2-1': { mac:'aa:bb:cc:dd:ee:ff', ifName:'Gi0/1' },
    'sw2-2': { mac:'00:00:00:00:00:00', ifName:'Gi0/2' },
  };
  const idx = buildPortMacIndex(ports);
  assert.deepEqual(idx['aa:bb:cc:dd:ee:ff'], { nodeId:'sw2', portId:'sw2-1' });
  assert.equal(idx['00:00:00:00:00:00'], undefined);
});

// ---- buildNeighborCandidates ------------------------------------------------

test('buildNeighborCandidates: LLDP exact match -> conf 0.97', () => {
  const nodes = [
    { id:'sw1', hostname:'sw1', name:'SW1', ip:'10.0.0.1', ports:24 },
    { id:'sw2', hostname:'sw2', name:'SW2', ip:'10.0.0.2', ports:24 },
  ];
  const ports = {
    'sw1-1': { ifName:'GigabitEthernet0/1' },
    'sw1-2': { ifName:'GigabitEthernet0/2' },
    'sw2-1': { ifName:'GigabitEthernet0/1' },
  };
  const idx = buildPortIndex(ports);
  const neighbors = [
    { protocol:'LLDP', remoteDevice:'sw2', remoteIP:'10.0.0.2',
      localPort:'GigabitEthernet0/1', remotePort:'GigabitEthernet0/1' },
  ];
  const cset = buildNeighborCandidates('sw1', neighbors, nodes, idx);
  assert.equal(cset.size(), 1);
  const c = cset.values()[0];
  assert.equal(c.confidence, 0.97);
  assert.equal(c.protocol, 'LLDP');
  assert.ok(c.src === 'sw1-1' || c.dst === 'sw1-1');
  assert.ok(c.src === 'sw2-1' || c.dst === 'sw2-1');
});

test('buildNeighborCandidates: CDP -> conf 0.90', () => {
  const nodes = [
    { id:'rtr1', hostname:'rtr1', name:'Router1', ip:'10.0.0.1', ports:4 },
    { id:'sw1',  hostname:'sw1',  name:'SW1',     ip:'10.0.0.2', ports:24 },
  ];
  const ports = {
    'rtr1-1': { ifName:'GigabitEthernet0/0' },
    'sw1-2':  { ifName:'GigabitEthernet0/2' },
  };
  const idx = buildPortIndex(ports);
  const neighbors = [
    { protocol:'CDP', remoteDevice:'sw1', remoteIP:'10.0.0.2',
      localPort:'GigabitEthernet0/0', remotePort:'GigabitEthernet0/2' },
  ];
  const cset = buildNeighborCandidates('rtr1', neighbors, nodes, idx);
  assert.equal(cset.size(), 1);
  assert.equal(cset.values()[0].confidence, 0.90);
  assert.equal(cset.values()[0].protocol, 'CDP');
});

test('buildNeighborCandidates: nodo remoto sconosciuto -> saltato', () => {
  const nodes = [{ id:'sw1', hostname:'sw1', name:'SW1', ip:'10.0.0.1', ports:24 }];
  const idx = buildPortIndex({ 'sw1-1': { ifName:'Gi0/1' } });
  const neighbors = [
    { protocol:'LLDP', remoteDevice:'unknown-device', remoteIP:'9.9.9.9',
      localPort:'Gi0/1', remotePort:'Gi0/1' },
  ];
  const cset = buildNeighborCandidates('sw1', neighbors, nodes, idx);
  assert.equal(cset.size(), 0);
});

test('buildNeighborCandidates: endpoint a porta singola -> fallback ${id}-1', () => {
  const nodes = [
    { id:'sw1', hostname:'sw1', name:'SW1', ip:'10.0.0.1', ports:24 },
    { id:'pc1', hostname:'pc1', name:'PC1', ip:'10.0.0.50', ports:1 }, // 1 porta
  ];
  const ports = {
    'sw1-3': { ifName:'GigabitEthernet0/3' },
    // pc1 non ha porte nel progetto → fallback pc1-1
  };
  const idx = buildPortIndex(ports);
  const neighbors = [
    { protocol:'LLDP', remoteDevice:'pc1', remoteIP:'10.0.0.50',
      localPort:'GigabitEthernet0/3', remotePort:'Gi0/0' }, // remotePort non risolvibile
  ];
  const cset = buildNeighborCandidates('sw1', neighbors, nodes, idx);
  assert.equal(cset.size(), 1);
  const c = cset.values()[0];
  assert.ok(c.src === 'pc1-1' || c.dst === 'pc1-1', 'fallback porta singola deve usare pc1-1');
});

test('buildNeighborCandidates: gateway MULTI-PORTA con chassis-id MAC -> agganciato ma DEDOTTO (da confermare)', () => {
  // Caso reale: il router/gateway ha 5 porte e l'LLDP lo annuncia col chassis-MAC
  // (porta remota non risolvibile). Prima veniva SCARTATO (fallback solo a 1 porta);
  // ora si aggancia alla prima porta libera del nodo remoto (router-1) MA la porta
  // remota è una NOSTRA inferenza → il link NON è LLDP autorevole: nasce dedotto
  // ('INFERRED', conf < 0.90) così linkState() lo mostra "da confermare".
  const GW_MAC = 'd4:1a:d1:82:11:20';
  const nodes = [
    { id: 'gs', hostname: 'GS1900', name: 'GS1900', ip: '192.168.1.100', ports: 24 },
    { id: 'router', hostname: '', name: '', ip: '', ports: 5, mac: GW_MAC }, // gateway documentato, 5 porte
  ];
  const ports = { 'gs-23': { ifName: 'GigabitEthernet23' } };
  const idx = buildPortIndex(ports);
  const macIndex = buildMacIndex(nodes, {});
  const neighbors = [
    { protocol: 'LLDP', remoteDevice: GW_MAC, remoteMac: GW_MAC, remoteIP: '',
      localPort: 'GigabitEthernet23', remotePort: GW_MAC.toUpperCase() }, // porta remota = MAC → irrisolvibile
  ];
  const cset = buildNeighborCandidates('gs', neighbors, nodes, idx, macIndex);
  assert.equal(cset.size(), 1, 'il gateway multi-porta NON deve più essere scartato');
  const c = cset.values()[0];
  assert.ok((c.src === 'gs-23' && c.dst === 'router-1') || (c.src === 'router-1' && c.dst === 'gs-23'),
    'cavo GS1900 porta 23 ↔ router porta 1');
  assert.equal(c.protocol, 'INFERRED', 'porta remota dedotta → NON etichettato LLDP');
  assert.ok(c.confidence >= 0.80 && c.confidence < 0.90, 'sopra soglia auto (0.80), sotto trusted (0.90)');
  // Il link risultante deve classificarsi "da confermare" (banner giallo).
  assert.equal(linkState({ autoLinked: true, confidence: c.confidence, protocol: c.protocol }).key, 'ambiguous');
});

test('buildNeighborCandidates: due vicini multi-porta sullo stesso nodo -> porte remote distinte (no collisione)', () => {
  const R_MAC = 'aa:bb:cc:00:00:99';
  const nodes = [
    { id: 'sw', hostname: 'SW', name: 'SW', ip: '10.0.0.1', ports: 24 },
    { id: 'rt', hostname: '', name: '', ip: '', ports: 8, mac: R_MAC },
  ];
  const ports = { 'sw-1': { ifName: 'Gi1' }, 'sw-2': { ifName: 'Gi2' } };
  const idx = buildPortIndex(ports);
  const macIndex = buildMacIndex(nodes, {});
  const neighbors = [
    { protocol: 'LLDP', remoteDevice: R_MAC, remoteMac: R_MAC, remoteIP: '', localPort: 'Gi1', remotePort: R_MAC.toUpperCase() },
    { protocol: 'LLDP', remoteDevice: R_MAC, remoteMac: R_MAC, remoteIP: '', localPort: 'Gi2', remotePort: R_MAC.toUpperCase() },
  ];
  const cset = buildNeighborCandidates('sw', neighbors, nodes, idx, macIndex);
  const dsts = cset.values().map(c => (c.src.indexOf('rt-') === 0 ? c.src : c.dst)).sort();
  assert.deepEqual(dsts, ['rt-1', 'rt-2'], 'le due porte remote di fallback sono distinte');
});

test('buildNeighborCandidates: fallback MAC per nodo senza hostname/IP', () => {
  const nodes = [
    { id:'sw1', hostname:'sw1', name:'SW1', ip:'10.0.0.1', ports:24 },
    { id:'sw2', hostname:'',    name:'',    ip:'',          ports:24, mac:'00:aa:bb:cc:dd:ee' },
  ];
  const ports = {
    'sw1-1': { ifName:'Gi0/1' },
    'sw2-1': { ifName:'Gi0/1' },
  };
  const idx    = buildPortIndex(ports);
  const macIdx = buildMacIndex(nodes, ports);
  const neighbors = [
    { protocol:'LLDP', remoteDevice:'00:aa:bb:cc:dd:ee', remoteIP:'',
      remoteMac:'00:aa:bb:cc:dd:ee',
      localPort:'Gi0/1', remotePort:'Gi0/1' },
  ];
  const cset = buildNeighborCandidates('sw1', neighbors, nodes, idx, macIdx);
  assert.equal(cset.size(), 1, 'il fallback MAC deve trovare sw2');
});

test('buildFdbCandidates: MAC FDB verso porta nota del progetto', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', name:'SW1', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'sw2', type:'switch', hostname:'sw2', name:'SW2', ip:'10.0.0.2', ports:24, isActive:true },
  ];
  const ports = {
    'sw1-1': { ifName:'Gi0/1' },
    'sw2-1': { ifName:'Gi0/1', mac:'00:aa:bb:cc:dd:ee' },
  };
  const idx = buildPortIndex(ports);
  const portMacIdx = buildPortMacIndex(ports);
  const res = buildFdbCandidates('sw1', { '00:aa:bb:cc:dd:ee':'Gi0/1' }, {}, nodes, idx, portMacIdx);
  assert.equal(res.cset.size(), 1);
  const c = res.cset.values()[0];
  assert.equal(c.protocol, 'MAC');
  assert.equal(c.confidence, 0.85);   // GAP 3: 1 solo MAC sulla porta -> 0.85
  assert.ok(c.src === 'sw1-1' || c.dst === 'sw1-1');
  assert.ok(c.src === 'sw2-1' || c.dst === 'sw2-1');
});

test('buildFdbCandidates GAP2: FDB + ifPhysAddress + ARP concordi -> MAC+ARP boost', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'sw2', type:'switch', hostname:'sw2', ip:'10.0.0.2', ports:24, isActive:true },
  ];
  const ports = {
    'sw1-1': { ifName:'Gi0/1' },
    'sw2-1': { ifName:'Gi0/1', mac:'00:aa:bb:cc:dd:ee' },
  };
  const idx = buildPortIndex(ports);
  const portMacIdx = buildPortMacIndex(ports);
  // ARP: il MAC risolve all'IP di sw2 -> terza evidenza concorde
  const res = buildFdbCandidates(
    'sw1',
    { '00:aa:bb:cc:dd:ee':'Gi0/1' },
    { '00:aa:bb:cc:dd:ee':'10.0.0.2' },
    nodes, idx, portMacIdx
  );
  const c = res.cset.values()[0];
  assert.equal(c.protocol, 'MAC+ARP');
  assert.equal(c.confidence, 0.90);   // 0.85 + 0.05
});

test('buildFdbCandidates GAP2: ARP che punta a un ALTRO nodo -> nessun boost', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'sw2', type:'switch', hostname:'sw2', ip:'10.0.0.2', ports:24, isActive:true },
    { id:'sw3', type:'switch', hostname:'sw3', ip:'10.0.0.3', ports:24, isActive:true },
  ];
  const ports = {
    'sw1-1': { ifName:'Gi0/1' },
    'sw2-1': { ifName:'Gi0/1', mac:'00:aa:bb:cc:dd:ee' },
  };
  const idx = buildPortIndex(ports);
  const portMacIdx = buildPortMacIndex(ports);
  const res = buildFdbCandidates(
    'sw1',
    { '00:aa:bb:cc:dd:ee':'Gi0/1' },
    { '00:aa:bb:cc:dd:ee':'10.0.0.3' },  // contraddizione: ip di sw3
    nodes, idx, portMacIdx
  );
  const c = res.cset.values()[0];
  assert.equal(c.protocol, 'MAC');     // niente boost su evidenze discordi
  assert.equal(c.confidence, 0.85);
});

test('buildFdbCandidates GAP3: soglie graduate 2 MAC -> 0.80, 3 MAC -> 0.68', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'sw2', type:'switch', hostname:'sw2', ip:'10.0.0.2', ports:24, isActive:true },
  ];
  const ports = {
    'sw1-1': { ifName:'Gi0/1' },
    'sw2-1': { ifName:'Gi0/1', mac:'00:aa:bb:cc:dd:ee' },
  };
  const idx = buildPortIndex(ports);
  const portMacIdx = buildPortMacIndex(ports);
  // 2 MAC sulla porta
  const r2 = buildFdbCandidates('sw1', {
    '00:aa:bb:cc:dd:ee':'Gi0/1',
    '00:00:00:00:00:99':'Gi0/1',
  }, {}, nodes, idx, portMacIdx);
  assert.equal(r2.cset.values()[0].confidence, 0.80);
  // 3 MAC sulla porta -> sospetto mini-switch, sotto soglia auto-create
  const r3 = buildFdbCandidates('sw1', {
    '00:aa:bb:cc:dd:ee':'Gi0/1',
    '00:00:00:00:00:98':'Gi0/1',
    '00:00:00:00:00:99':'Gi0/1',
  }, {}, nodes, idx, portMacIdx);
  assert.equal(r3.cset.values()[0].confidence, 0.68);
});

test('buildFdbCandidates GAP3: porta shared-segment (>4 MAC) -> ZERO candidati punto-punto', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'sw2', type:'switch', hostname:'sw2', ip:'10.0.0.2', ports:24, isActive:true },
    { id:'pc1', type:'pc', hostname:'pc1', ip:'10.0.0.50', ports:1, isLeafEndpoint:true },
  ];
  const ports = {
    'sw1-10': { ifName:'Gi0/10' },
    'sw2-1':  { ifName:'Gi0/1', mac:'00:aa:bb:cc:dd:ee' },
  };
  const idx = buildPortIndex(ports);
  const portMacIdx = buildPortMacIndex(ports);
  // 6 MAC sulla stessa porta: dietro c'e' uno switch non gestito.
  // Anche se uno dei MAC matcha una porta nota (sw2-1) e un altro risolve
  // via ARP a un endpoint (pc1), NESSUN link punto-punto va inferito:
  // sono tutti DIETRO il segmento, non collegati direttamente.
  const fdb = {
    '00:aa:bb:cc:dd:ee':'Gi0/10',  // matcherebbe sw2-1 via portMacIndex
    '00:11:22:33:44:55':'Gi0/10',  // matcherebbe pc1 via ARP
    '00:00:00:00:00:03':'Gi0/10',
    '00:00:00:00:00:04':'Gi0/10',
    '00:00:00:00:00:05':'Gi0/10',
    '00:00:00:00:00:06':'Gi0/10',
  };
  const res = buildFdbCandidates(
    'sw1', fdb,
    { '00:11:22:33:44:55':'10.0.0.50' },
    nodes, idx, portMacIdx
  );
  assert.equal(res.cset.size(), 0, 'nessun candidato da porta shared-segment');
  assert.equal(res.sharedSegments.length, 1, 'evidenza shared-segment preservata');
  assert.equal(res.sharedSegments[0].portId, 'sw1-10');
});

test('buildFdbCandidates UPLINK: router documentato su porta affollata -> cablato (target uplink, no LLDP)', () => {
  // Caso reale: il router (trovato in scansione, aggiunto come router, MAC noto)
  // ha il suo MAC appreso su una porta con TANTI MAC (l'uplink). Prima: scartato
  // (>4 = shared-segment). Ora: è il device diretto (target dell'uplink).
  const GW = 'd4:1a:d1:82:11:20';
  const nodes = [
    { id:'gs', type:'switch', hostname:'GS1900', ip:'192.168.1.100', ports:24, isActive:true },
    { id:'router', type:'router', hostname:'router', ip:'192.168.1.1', ports:5, mac:GW }, // documentato
  ];
  const ports = { 'gs-23': { ifName:'GigabitEthernet23' } };
  const idx = buildPortIndex(ports);
  const portMacIdx = buildPortMacIndex(ports);
  // 8 MAC sulla porta 23: il router + 7 device OLTRE di lui (transito).
  const fdb = {
    [GW]: 'GigabitEthernet23',
    '40:9f:38:6e:0f:99':'GigabitEthernet23', '4c:bc:e9:aa:e5:ca':'GigabitEthernet23',
    'f0:03:8c:d5:88:14':'GigabitEthernet23', 'f4:39:09:62:f2:46':'GigabitEthernet23',
    'f4:bf:80:da:ed:dc':'GigabitEthernet23', 'f4:f5:e8:50:32:32':'GigabitEthernet23',
    '00:04:4b:b4:b0:d4':'GigabitEthernet23',
  };
  const res = buildFdbCandidates('gs', fdb, {}, nodes, idx, portMacIdx);
  assert.equal(res.cset.size(), 1, 'esattamente 1 candidato: il router (gli altri 7 sono transito)');
  const c = res.cset.values()[0];
  assert.ok((c.src === 'gs-23' && c.dst === 'router-1') || (c.src === 'router-1' && c.dst === 'gs-23'),
    'router cablato alla porta uplink 23');
  assert.equal(c.protocol, 'MAC-UPLINK');
  assert.equal(res.sharedSegments.length, 1, 'la porta resta segnalata come segmento (7 MAC oltre)');
});

test('buildFdbCandidates UPLINK: DUE infra documentati sulla stessa porta -> ambiguo, nessun cavo', () => {
  const A = 'aa:aa:aa:00:00:01', B = 'bb:bb:bb:00:00:02';
  const nodes = [
    { id:'gs', type:'switch', hostname:'GS', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'r1', type:'router', hostname:'r1', ip:'10.0.0.2', ports:5, mac:A },
    { id:'sw2', type:'switch', hostname:'sw2', ip:'10.0.0.3', ports:24, mac:B, isActive:true },
  ];
  const ports = { 'gs-5': { ifName:'Gi5' } };
  const idx = buildPortIndex(ports);
  const fdb = { [A]:'Gi5', [B]:'Gi5', '00:00:00:00:00:03':'Gi5', '00:00:00:00:00:04':'Gi5', '00:00:00:00:00:05':'Gi5' };
  const res = buildFdbCandidates('gs', fdb, {}, nodes, idx, buildPortMacIndex(ports));
  assert.equal(res.cset.size(), 0, 'due infra sulla porta = ambiguo → non si indovina, resta segmento');
});

test('buildFdbCandidates UPLINK: endpoint multi-porta (NAS 2 porte) sul LAG NON crea falsa ambiguità → switch agganciato', () => {
  // Caso reale GS1900/LAG1: sull'interfaccia aggregata LAG1 sono appresi il MAC del
  // GS1200 (switch, infra) + un NAS Synology a 2 porte + una stampante. Il NAS NON
  // deve contare come "infra" (host terminale, anche se multi-porta per NIC teaming):
  // solo lo switch inoltra → nessuna ambiguità, il GS1200 si aggancia come uplink sulla
  // prima porta membro. Prima: isLeafEndpointNode(NAS 2 porte)=false → il NAS contava
  // come infra → set.size=2 → ambiguo → nessun cavo (bug).
  const SW = 'aa:aa:aa:00:00:01', NAS = '00:11:32:8f:53:51', PRN = '18:60:24:78:37:0b';
  const nodes = [
    { id:'gs', type:'switch', hostname:'GS1900', ip:'192.168.1.100', ports:26, isActive:true },
    { id:'gs1200', type:'switch', hostname:'GS1200', ip:'192.168.1.98', ports:8, mac:SW, isActive:true },
    { id:'nas', type:'nas', hostname:'NAS', ip:'192.168.1.120', ports:2, mac:NAS, isActive:true },
    { id:'prn', type:'printer', hostname:'PRN', ip:'192.168.1.178', ports:1, mac:PRN, isLeafEndpoint:true },
  ];
  const ports = { 'gs-3': { ifName:'GigabitEthernet3', lagId:1, lagGroup:'snmp-lag-gs-1' } };
  const idx = buildPortIndex(ports, { 'snmp-lag-gs-1':'LAG1' });
  const fdb = { [SW]:'LAG1', [NAS]:'LAG1', [PRN]:'LAG1' };   // MAC appresi sull'aggregato
  const res = buildFdbCandidates('gs', fdb, {}, nodes, idx, buildPortMacIndex(ports));
  const cands = res.cset.values();
  assert.equal(cands.length, 1, 'un solo candidato: il GS1200 (NAS/stampante = host, non infra)');
  const c = cands[0];
  assert.ok((c.src === 'gs-3' && c.dst === 'gs1200-1') || (c.src === 'gs1200-1' && c.dst === 'gs-3'),
    'GS1200 agganciato alla prima porta membro del LAG (gs-3)');
  assert.equal(c.protocol, 'MAC-UPLINK');
  assert.equal(linkState({ autoLinked:true, confidence:c.confidence, protocol:c.protocol }).key, 'ambiguous', 'link "da confermare"');
});

test('buildFdbCandidates: ARP+FDB verso endpoint a porta singola', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', name:'SW1', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'pc1', type:'pc', hostname:'pc1', name:'PC1', ip:'10.0.0.50', ports:1, isLeafEndpoint:true },
  ];
  const ports = {
    'sw1-3': { ifName:'Gi0/3' },
  };
  const idx = buildPortIndex(ports);
  const res = buildFdbCandidates(
    'sw1',
    { '00:11:22:33:44:55':'Gi0/3' },
    { '00:11:22:33:44:55':'10.0.0.50' },
    nodes,
    idx,
    {}
  );
  assert.equal(res.cset.size(), 1);
  const c = res.cset.values()[0];
  assert.equal(c.protocol, 'ARP-MAC');
  assert.ok(c.src === 'pc1-1' || c.dst === 'pc1-1');
});

test('buildFdbCandidates: shared segment hint su porta con molti MAC', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', name:'SW1', ip:'10.0.0.1', ports:24, isActive:true },
  ];
  const ports = {
    'sw1-10': { ifName:'Gi0/10' },
  };
  const fdb = {
    '00:00:00:00:00:01':'Gi0/10',
    '00:00:00:00:00:02':'Gi0/10',
    '00:00:00:00:00:03':'Gi0/10',
    '00:00:00:00:00:04':'Gi0/10',
    '00:00:00:00:00:05':'Gi0/10',
  };
  const idx = buildPortIndex(ports);
  const res = buildFdbCandidates('sw1', fdb, {}, nodes, idx, {});
  assert.equal(res.sharedSegments.length, 1);
  assert.equal(res.sharedSegments[0].portId, 'sw1-10');
  assert.equal(res.sharedSegments[0].reason, 'shared-segment');
  assert.equal(res.sharedSegments[0].macCount, 5);
});

test('buildFdbCandidates: opts.isVirtualMac salta link per MAC virtuali (VMware/Docker)', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', ip:'10.0.0.1', ports:24, isActive:true },
    { id:'sv1', type:'server', hostname:'esxi1', ip:'10.0.0.50', ports:1, isLeafEndpoint:true },
  ];
  const ports = {
    'sw1-3': { ifName:'Gi0/3' },
  };
  const idx = buildPortIndex(ports);

  // Without the predicate: VMware MAC 00:50:56:* generates an ARP-MAC link
  const baseline = buildFdbCandidates(
    'sw1',
    { '00:50:56:aa:bb:cc':'Gi0/3' },
    { '00:50:56:aa:bb:cc':'10.0.0.50' },
    nodes, idx, {},
  );
  assert.equal(baseline.cset.size(), 1, 'baseline should generate a link');

  // With the predicate: VMware MAC is filtered → no candidate generated
  const filtered = buildFdbCandidates(
    'sw1',
    { '00:50:56:aa:bb:cc':'Gi0/3' },
    { '00:50:56:aa:bb:cc':'10.0.0.50' },
    nodes, idx, {},
    { isVirtualMac: m => /^00:50:56/i.test(m) }
  );
  assert.equal(filtered.cset.size(), 0, 'virtual MAC should not drive any link');
});

test('buildFdbCandidates: virtual MAC non gonfia il counter shared-segment', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', ip:'10.0.0.1', ports:24, isActive:true },
  ];
  const ports = {
    'sw1-10': { ifName:'Gi0/10' },
  };
  // 50 Docker veth MAC + 1 real physical MAC on the same port: without the
  // predicate the shared-segment heuristic fires; with it, physical count
  // drops below threshold and the segment is reported with the breakdown.
  const fdb = {};
  for (let i = 1; i <= 50; i++) {
    const lastByte = i.toString(16).padStart(2, '0');
    fdb[`02:42:ac:11:00:${lastByte}`] = 'Gi0/10';
  }
  fdb['aa:bb:cc:dd:ee:ff'] = 'Gi0/10';
  const idx = buildPortIndex(ports);

  const withVirtual = buildFdbCandidates(
    'sw1', fdb, {}, nodes, idx, {},
    { isVirtualMac: m => /^02:42:/i.test(m) }
  );
  assert.equal(withVirtual.sharedSegments.length, 0,
    'when only 1 physical MAC remains the shared segment should not be raised');
});

test('buildFdbCandidates: shared-segment expone physicalMacCount/virtualMacCount', () => {
  const nodes = [
    { id:'sw1', type:'switch', hostname:'sw1', ip:'10.0.0.1', ports:24, isActive:true },
  ];
  const ports = {
    'sw1-10': { ifName:'Gi0/10' },
  };
  // 10 Docker MACs + 10 real MACs → real shared segment (10 > 4) + breakdown
  const fdb = {};
  for (let i = 1; i <= 10; i++) {
    const hex = i.toString(16).padStart(2, '0');
    fdb[`02:42:00:00:00:${hex}`] = 'Gi0/10';     // virtual
    fdb[`aa:bb:00:00:00:${hex}`] = 'Gi0/10';     // physical
  }
  const idx = buildPortIndex(ports);
  const res = buildFdbCandidates(
    'sw1', fdb, {}, nodes, idx, {},
    { isVirtualMac: m => /^02:42:/i.test(m) }
  );
  assert.equal(res.sharedSegments.length, 1);
  const seg = res.sharedSegments[0];
  assert.equal(seg.macCount, 20);
  assert.equal(seg.virtualMacCount, 10);
  assert.equal(seg.physicalMacCount, 10);
});

// ── S2.4 (audit 2026-07-20): short-name ambiguo → nessun match ──────────────
test('matchNodeByIdent: short-name ambiguo (2+ nodi) → null, non first-wins', () => {
  const nodes = [
    { id: 'a', name: 'gw.siteA', hostname: 'gw.sitea.lan', ip: '10.1.0.1' },
    { id: 'b', name: 'gw.siteB', hostname: 'gw.siteb.lan', ip: '10.2.0.1' },
  ];
  // Il vicino annuncia solo "gw": due candidati → nessun aggancio a 0.97.
  assert.equal(matchNodeByIdent('gw', '', nodes), null, 'ambiguo → null');
  // Con l'IP l'ambiguità short-name si risolve via P4.
  assert.equal(matchNodeByIdent('gw', '10.2.0.1', nodes).id, 'b', 'IP scioglie il tie');
  // Exact match vince sempre, anche con short-name ambiguo.
  assert.equal(matchNodeByIdent('gw.sitea.lan', '', nodes).id, 'a');
  // Short-name UNICO continua a funzionare.
  assert.equal(matchNodeByIdent('gw', '', [nodes[0]]).id, 'a');
  // Stesso nodo che matcha sia per hostname che per name NON è "ambiguo".
  const one = [{ id: 'x', name: 'core', hostname: 'core.lan', ip: '10.0.0.2' }];
  assert.equal(matchNodeByIdent('core', '', one).id, 'x');
});

// ── S2.6 / A2 (audit 2026-07-20): un'adiacenza = un solo cavo ───────────────
const { suppressInferredDuplicates } = require('../lib/correlate.js');
const _pn = pid => pid.replace(/-\d+$/, '');

test('A2: doppio cavo + porta fantasma — INFERRED soppresso dal trusted sulla stessa porta', () => {
  // Vista di A: (swA-1 ↔ swB-1) INFERRED 0.82 (porta remota inventata).
  // Vista di B: (swB-3 ↔ swA-1) LLDP 0.97 (adiacenza dichiarata).
  // Stessa adiacenza, pair diversi → prima del fix restavano DUE cavi su swA-1.
  const links = [
    { id: 'l1', src: 'swA-1', dst: 'swB-1', autoLinked: true, protocol: 'INFERRED', confidence: 0.82 },
    { id: 'l2', src: 'swB-3', dst: 'swA-1', autoLinked: true, protocol: 'LLDP', confidence: 0.97 },
  ];
  const r = suppressInferredDuplicates(links, _pn);
  assert.deepEqual(r.removed.map(l => l.id), ['l1'], 'l\'inferito duplicato va rimosso');
  assert.deepEqual(r.links.map(l => l.id), ['l2'], 'il trusted resta');
});

test('A2: anche un link MANUALE copre l\'adiacenza (manual-first), e non è mai rimosso', () => {
  const links = [
    { id: 'm1', src: 'swA-1', dst: 'swB-3' },  // manuale (autoLinked falsy)
    { id: 'l1', src: 'swA-1', dst: 'swB-1', autoLinked: true, protocol: 'INFERRED', confidence: 0.82 },
  ];
  const r = suppressInferredDuplicates(links, _pn);
  assert.deepEqual(r.removed.map(l => l.id), ['l1']);
  assert.deepEqual(r.links.map(l => l.id), ['m1']);
});

test('A2: porte DIVERSE verso lo stesso nodo = link paralleli legittimi, nessuna soppressione', () => {
  // Due cavi reali tra gli stessi switch (ridondanza/LAG): porte locali diverse.
  const links = [
    { id: 'l1', src: 'swA-1', dst: 'swB-3', autoLinked: true, protocol: 'LLDP', confidence: 0.97 },
    { id: 'l2', src: 'swA-2', dst: 'swB-4', autoLinked: true, protocol: 'INFERRED', confidence: 0.82 },
  ];
  const r = suppressInferredDuplicates(links, _pn);
  assert.equal(r.removed.length, 0, 'porta diversa → adiacenza distinta, si conserva');
});

test('A2: inferito SENZA copertura trusted resta (unica evidenza dell\'adiacenza)', () => {
  const links = [
    { id: 'l1', src: 'swA-1', dst: 'swB-1', autoLinked: true, protocol: 'INFERRED', confidence: 0.82 },
    { id: 'l2', src: 'swA-2', dst: 'swC-1', autoLinked: true, protocol: 'LLDP', confidence: 0.97 },  // altro nodo
  ];
  const r = suppressInferredDuplicates(links, _pn);
  assert.equal(r.removed.length, 0);
});
