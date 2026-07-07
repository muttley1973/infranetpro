'use strict';
// Test del costruttore PURO degli snapshot Drift (lib/drift-snapshot.js).
// Prima questa logica viveva solo nel glue DOM-coupled (src/app-drift.js) e non
// era testabile a tavolino: ora lo è. Include un round-trip in buildDriftReport.
const test = require('node:test');
const assert = require('node:assert');
const { buildDocSnapshot, buildSnmpSnapshot } = require('../lib/drift-snapshot.js');
const { buildDriftReport } = require('../lib/drift-report.js');

const lower = x => String(x == null ? '' : x).toLowerCase();

// ── buildDocSnapshot ────────────────────────────────────────────────
test('docSnap: porte solo dagli estremi dei link, con precedenza override (?? semantica)', () => {
  const m = {
    links: [{ id: 'c1', src: 'sw-1', dst: 'pc-1' }],
    ports: {
      'sw-1': { status: 'active', statusOvr: 'inactive', speed: 1000, speedOvr: 0, vlan: 10, vlanOvr: 20 },
      'pc-1': { status: 'active', speed: 100, vlan: 30 },
      'sw-9': { status: 'active', vlan: 99 },   // NON estremo di link → escluso
    },
    normMac: lower,
  };
  const d = buildDocSnapshot(m);
  assert.deepEqual(Object.keys(d.ports).sort(), ['pc-1', 'sw-1']);
  // override vince; 0 e '' restano (≠ null) come con ??
  assert.equal(d.ports['sw-1'].status, 'inactive');
  assert.equal(d.ports['sw-1'].speed, 0);
  assert.equal(d.ports['sw-1'].vlan, 20);
  // senza override → valore base
  assert.equal(d.ports['pc-1'].vlan, 30);
});

test('docSnap: passivo senza IP fuori da macs ma in deviceSigs; VM solo in deviceSigs; IP da integration.host', () => {
  const m = {
    nodes: [
      { id: 'sw', mac: 'AA:AA:AA:00:00:01', ip: '10.0.0.2' },
      { id: 'wall', mac: 'AA:AA:AA:00:00:02', type: 'wallport' },   // passivo senza IP
      { id: 'host', mac: 'AA:AA:AA:00:00:03', ip: '10.0.0.5', integration: { host: '10.0.0.9' }, vms: [{ mac: 'BB:BB:BB:00:00:01' }] },
      { id: 'nomac' },   // senza MAC → ignorato
    ],
    links: [],
    ports: {},
    normMac: lower,
    isPassiveNoIp: n => n.type === 'wallport',
  };
  const d = buildDocSnapshot(m);
  const labels = d.macs.map(x => x.nodeId).sort();
  assert.deepEqual(labels, ['host', 'sw'], 'il passivo-senza-IP NON entra nell\'audit presenza');
  // ma il suo MAC è "noto" (deviceSigs) → non risulterà non-documentato
  assert.ok(d.deviceSigs.includes(lower('AA:AA:AA:00:00:02')));
  // la VM è SOLO in deviceSigs, mai in macs (fuori dall'audit presenza)
  assert.ok(d.deviceSigs.includes(lower('BB:BB:BB:00:00:01')));
  assert.ok(!d.macs.some(x => lower(x.mac) === lower('BB:BB:BB:00:00:01')));
  // IP: integration.host ha priorità su n.ip
  assert.equal(d.macs.find(x => x.nodeId === 'host').ip, '10.0.0.9');
});

test('docSnap: MAC stampati sulle porte entrano in deviceSigs; cavi con etichetta iniettata', () => {
  const m = {
    nodes: [],
    links: [{ id: 'c1', src: 'sw-1', dst: 'sw-2' }],
    ports: { 'sw-1': { mac: 'CC:CC:CC:00:00:01' } },
    normMac: lower,
    cableLabel: l => 'LBL-' + l.id,
  };
  const d = buildDocSnapshot(m);
  assert.ok(d.deviceSigs.includes(lower('CC:CC:CC:00:00:01')));
  assert.equal(d.cables[0].label, 'LBL-c1');
});

// ── buildSnmpSnapshot ───────────────────────────────────────────────
test('snmpSnap: responded + presenza multi-segnale (SNMP o sweep)', () => {
  const m = {
    nodes: [
      { id: 'sw', snmpStatus: 'ok', ip: '10.0.0.2' },
      { id: 'pc', snmpStatus: 'fail', ip: '10.0.0.50' },   // vivo solo via sweep
      { id: 'off', snmpStatus: 'fail', ip: '10.0.0.99' },
    ],
    reachable: { '10.0.0.50': { alive: true }, '10.0.0.99': { alive: false } },
  };
  const s = buildSnmpSnapshot(m);
  assert.equal(s.responded.sw, true);
  assert.ok(!s.responded.pc);
  assert.equal(s.presentNodeIds.sw, true);
  assert.equal(s.presentNodeIds.pc, true, 'vivo via sweep → presente anche senza SNMP');
  assert.ok(!s.presentNodeIds.off);
  assert.equal(s.reachabilityChecked, true);
});

test('snmpSnap: macAtIp da ARP (priorità) + subnet osservate; fallback a reach.mac senza ARP', () => {
  const withArp = buildSnmpSnapshot({
    nodes: [],
    arpTable: { '10.0.0.50': 'DD:DD:DD:00:00:01', '192.168.1.5': 'DD:DD:DD:00:00:02' },
  });
  assert.equal(withArp.macAtIp['dd:dd:dd:00:00:01'], '10.0.0.50');
  assert.deepEqual(withArp.observedSubnets.sort(), ['10.0.0', '192.168.1']);

  const noArp = buildSnmpSnapshot({
    nodes: [],
    reachable: { '10.0.0.50': { alive: true, mac: 'EE:EE:EE:00:00:01' } },
  });
  assert.equal(noArp.macAtIp['ee:ee:ee:00:00:01'], '10.0.0.50', 'senza ARP usa il MAC dalla raggiungibilità');
  assert.deepEqual(noArp.observedSubnets, ['10.0.0']);
});

test('snmpSnap: observedDevices esclude noti+virtuali, eredita vlan/portMacCount/consumer iniettati', () => {
  const m = {
    nodes: [],
    docPorts: {},
    fdb: { sw1: { 'AA:AA:AA:00:00:01': 'Gi0/1', 'FF:FF:FF:00:00:09': 'Gi0/2', '02:AA:AA:00:00:07': 'Gi0/3' } },
    vlanCache: { sw1: { 'AA:AA:AA:00:00:01': 30 } },
    knownSigs: [lower('FF:FF:FF:00:00:09')],   // già documentato → escluso
    normMac: lower,
    isVirtualMac: mac => lower(mac).startsWith('02:'),   // il :07 è "virtuale" → escluso
    isRandomizedMac: mac => lower(mac) === lower('AA:AA:AA:00:00:01'),
    countMacsPerPort: () => ({ 'Gi0/1': 7 }),
    fdbSeenLabel: (sw, ifName) => `${sw}/${ifName}`,
  };
  const s = buildSnmpSnapshot(m);
  assert.equal(s.fdbObserved, true);
  const od = s.observedDevices;
  assert.equal(od.length, 1, 'solo il MAC sconosciuto e non-virtuale resta');
  assert.equal(lower(od[0].mac), lower('AA:AA:AA:00:00:01'));
  assert.equal(od[0].vlan, 30);
  assert.equal(od[0].portMacCount, 7);
  assert.equal(od[0].consumer, true);
  assert.equal(od[0].label, 'sw1/Gi0/1');
});

test('snmpSnap: rejectedSigs (split ||) e portDownStreak dalle porte', () => {
  const m = {
    nodes: [],
    docPorts: { 'sw-1': {} },
    ports: { 'sw-1': { downStreak: 4, mac: '11:11:11:00:00:01' }, 'sw-2': { mac: '22:22:22:00:00:02' } },
    rejectedAutoLinks: ['sw-1||sw-2'],
    normMac: lower,
  };
  const s = buildSnmpSnapshot(m);
  assert.equal(s.portDownStreak['sw-1'], 4);
  assert.deepEqual(s.rejectedSigs.sort(), [lower('11:11:11:00:00:01'), lower('22:22:22:00:00:02')]);
});

test('snmpSnap: lease attivo = identità cross-VLAN (G1: NON marca la subnet osservata); lease stale ignorato (G2)', () => {
  const m = {
    nodes: [],
    leases: [
      { mac: 'AB:AB:AB:00:00:01', ip: '172.16.30.40', state: 'active', hostname: 'cam' },   // nuovo, cross-VLAN
      { mac: 'AB:AB:AB:00:00:02', ip: '172.16.30.41', state: 'expired' },                    // stale → ignorato
    ],
    knownSigs: [],
    normMac: lower,
    isLeaseStale: l => l.state === 'expired',
    leaseSeenLabel: (ip, hn) => `lease ${ip} ${hn || ''}`.trim(),
  };
  const s = buildSnmpSnapshot(m);
  assert.equal(s.macAtIp['ab:ab:ab:00:00:01'], '172.16.30.40');
  assert.ok(!s.macAtIp['ab:ab:ab:00:00:02'], 'lease scaduto non occupa nulla');
  assert.ok(s.observedMacs.includes('AB:AB:AB:00:00:01'));
  assert.equal(s.observedDevices.length, 1, 'solo il lease attivo diventa un non-documentato');
  assert.equal(s.reachabilityChecked, true, 'un lease valido conta come osservabilità (per-MAC)');
  assert.deepEqual(s.observedSubnets, [], 'G1: il lease NON marca la subnet come osservata (no falsi assenti)');
});

// ── round-trip: snapshot puri → buildDriftReport ────────────────────
test('round-trip: doc==realtà → 0 finding; cambio VLAN porta → stateDrift', () => {
  const nodes = [
    { id: 'sw', mac: 'AA:00:00:00:00:01', ip: '10.0.0.2', snmpStatus: 'ok' },
    { id: 'pc', mac: 'AA:00:00:00:00:02', ip: '10.0.0.50', snmpStatus: 'ok' },
  ];
  const links = [{ id: 'c1', src: 'sw-1', dst: 'pc-1' }];
  const ports = { 'sw-1': { status: 'active', speed: 1000, vlan: 10 }, 'pc-1': { status: 'active', speed: 1000, vlan: 10 } };
  const doc = buildDocSnapshot({ nodes, links, ports, normMac: lower });
  // realtà combaciante: FDB vede i MAC, gli switch rispondono, porte uguali
  const fdb = { sw: { 'AA:00:00:00:00:01': 'Gi0/1', 'AA:00:00:00:00:02': 'Gi0/2' } };
  const snmp = buildSnmpSnapshot({ nodes, docPorts: doc.ports, ports, fdb, normMac: lower });
  const r0 = buildDriftReport(snmp, doc, [], {});
  assert.equal(r0.counts.stateDrift + r0.counts.macOrphan + r0.counts.undocumented + r0.counts.ipChanged, 0);

  // perturbazione: una porta cambia VLAN in realtà
  const ports2 = JSON.parse(JSON.stringify(ports)); ports2['sw-1'].vlan = 999;
  const snmp2 = buildSnmpSnapshot({ nodes, docPorts: doc.ports, ports: ports2, fdb, normMac: lower });
  const r1 = buildDriftReport(snmp2, doc, [], {});
  assert.equal(r1.counts.stateDrift, 1);
  assert.equal(r1.stateDrift[0].patch.vlan, 999);
});

// ── fdbSubnets: copertura L2 per subnet (fix falso "assente" multi-fabric) ────
test('fdbSubnets: coperte le subnet del fabric osservato, NON la LAN reale dietro il router', () => {
  const nodes = [
    { id: 'sw', name: 'SW',     type: 'switch', mac: 'aa:aa:aa:00:00:01', ip: '10.10.99.1',  snmpStatus: 'ok', integration: { host: '10.10.99.1' } },
    { id: 'ep', name: 'EP',     type: 'pc',     mac: 'bb:bb:bb:00:00:02', ip: '10.10.30.10' },
    { id: 'pc', name: 'PC-LAN', type: 'pc',     mac: 'cc:cc:cc:00:00:03', ip: '192.168.1.101' },
  ];
  // La FDB dello switch del lab vede sw+ep (10.10.x), NON il PC della LAN reale.
  const fdb = { sw: { 'aa:aa:aa:00:00:01': 'Gi0/0', 'bb:bb:bb:00:00:02': 'Gi0/2' } };
  const s = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb, vlanCache: {}, reachable: null, arpTable: null,
    leases: [], knownSigs: [], rejectedAutoLinks: [], normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: () => false, countMacsPerPort: () => ({}),
  });
  assert.equal(s.fdbObserved, true);
  assert.deepEqual(s.fdbSubnets.sort(), ['10.10.30', '10.10.99'], 'coperte le subnet del lab, non la 192.168.1 reale');
});

test('round-trip Sync: LAN reale mischiata al lab → i 192.168.x restano unverified (non grigi)', () => {
  const nodes = [
    { id: 'sw',  name: 'SW-CORE', type: 'switch', mac: 'aa:aa:aa:00:00:01', ip: '10.10.99.1', snmpStatus: 'ok', integration: { host: '10.10.99.1' } },
    { id: 'pc1', name: '192.168.1.101', type: 'pc', mac: 'cc:cc:cc:00:00:03', ip: '192.168.1.101' },
    { id: 'pc2', name: '192.168.1.128', type: 'pc', mac: 'cc:cc:cc:00:00:04', ip: '192.168.1.128' },
  ];
  const model = {
    nodes, links: [], ports: {}, portLabel: p => p, nodeLabel: n => n.name || n.id,
    cableLabel: l => l.id, normMac: lower, isPassiveNoIp: () => false,
  };
  const doc = buildDocSnapshot(model);
  const snmp = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb: { sw: { 'aa:aa:aa:00:00:01': 'Gi0/0' } }, vlanCache: {},
    reachable: null, arpTable: null, leases: [], knownSigs: [], rejectedAutoLinks: [], normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: () => false, countMacsPerPort: () => ({}),
  });
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'nessun 192.168.x dichiarato assente: quella L2 non è mai stata osservata');
  assert.equal(r.counts.unverified, 2, 'entrambi i PC della LAN reale sono non-verificabili');
  assert.deepEqual(r.unverified.map(x => x.label).sort(), ['192.168.1.101', '192.168.1.128']);
});

// ── default robusti (nessun helper iniettato) ───────────────────────
test('default: senza helper iniettati non lancia e produce strutture vuote sensate', () => {
  assert.doesNotThrow(() => buildDocSnapshot());
  assert.doesNotThrow(() => buildSnmpSnapshot());
  const d = buildDocSnapshot({});
  assert.deepEqual(d, { ports: {}, macs: [], deviceSigs: [], cables: [] });
  const s = buildSnmpSnapshot({});
  assert.equal(s.fdbObserved, false);
  assert.deepEqual(s.observedDevices, []);
  assert.deepEqual(s.fdbSubnets, [], 'nessuna FDB → nessuna subnet coperta');
});
