// Test per le primitive pure di correlazione (lib/correlate.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pairSig, createCandidateSet,
  matchNodeByIdent, buildPortIndex, buildMacIndex, collectNodeMacs,
  buildPortMacIndex, findPortByIfName, buildNeighborCandidates, buildFdbCandidates,
} = require('../lib/correlate.js');

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
