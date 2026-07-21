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

test('docSnap: nodi CON IP ma SENZA MAC → ipOnly (con hasSnmp); senza IP → ignorati; passivi esclusi', () => {
  const m = {
    nodes: [
      { id: 'kvm', ip: '10.10.30.10', integration: { driver: 'snmp-v2c' } },   // SNMP, no MAC → ipOnly hasSnmp:true
      { id: 'pc6', ip: '10.10.30.100' },                                        // no MAC, no SNMP → ipOnly hasSnmp:false
      { id: 'sw',  mac: 'AA:AA:AA:00:00:01', ip: '10.0.0.2' },                  // con MAC → macs, NON ipOnly
      { id: 'noip' },                                                            // né MAC né IP → ignorato ovunque
      { id: 'wall', ip: '10.0.0.9', type: 'wallport' },                          // passivo senza IP proprio → escluso
    ],
    links: [], ports: {}, normMac: lower,
    isPassiveNoIp: n => n.type === 'wallport',
  };
  const d = buildDocSnapshot(m);
  assert.deepEqual(d.ipOnly.map(x => x.nodeId).sort(), ['kvm', 'pc6'], 'solo i no-MAC con IP e non-passivi');
  assert.equal(d.ipOnly.find(x => x.nodeId === 'kvm').hasSnmp, true);
  assert.equal(d.ipOnly.find(x => x.nodeId === 'pc6').hasSnmp, false);
  assert.equal(d.ipOnly.find(x => x.nodeId === 'kvm').ip, '10.10.30.10');
  assert.ok(!d.macs.some(x => x.nodeId === 'kvm'), 'un no-MAC non finisce anche in macs');
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

test('snmpSnap: trustAbsentNodeIds SOLO da reach[ip].absent===true (assenza affidabile per-nodeId)', () => {
  const m = {
    nodes: [
      { id: 'loc-off', ip: '192.168.1.140' },                              // locale, assente PROVATO (ARP-miss)
      { id: 'loc-fw',  ip: '192.168.1.10' },                               // locale, vivo via ARP-during-ping
      { id: 'remote',  ip: '10.20.0.5' },                                  // remoto muto (mai "assente")
      { id: 'host',    ip: '10.0.0.9', integration: { host: '10.0.0.9' } },// presente via ping
    ],
    reachable: {
      '192.168.1.140': { alive: false, via: '', mac: '', absent: true },
      '192.168.1.10':  { alive: true, via: 'arp', mac: 'AA:BB:CC:00:00:10', absent: false },
      '10.20.0.5':     { alive: false, via: '', mac: '', absent: false },
      '10.0.0.9':      { alive: true, via: 'ping', mac: '', absent: false },
    },
  };
  const s = buildSnmpSnapshot(m);
  assert.deepEqual(Object.keys(s.trustAbsentNodeIds).sort(), ['loc-off'], 'solo l\'assente-provato on-segment');
  assert.ok(!s.trustAbsentNodeIds.remote, 'un remoto muto NON è assenza affidabile');
  assert.ok(!s.trustAbsentNodeIds['loc-fw'], 'un host vivo via ARP-during-ping NON è assente');
  assert.equal(s.presentNodeIds['loc-fw'], true, 'ARP-during-ping → presente (alive dallo sweep)');
  assert.equal(s.presentNodeIds.host, true);
});

test('snmpSnap: senza sweep (reach null) trustAbsentNodeIds è vuoto (Sync mai rosso)', () => {
  const s = buildSnmpSnapshot({ nodes: [{ id: 'x', ip: '192.168.1.5', snmpStatus: 'fail' }] });
  assert.deepEqual(s.trustAbsentNodeIds, {}, 'nessuna sweep → nessuna prova di assenza → mai rosso');
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

// ── Fase 2: ARP dei router/switch L3 (snmpArp) come presenza VIVA cross-subnet ──
test('snmpSnap: snmpArp → macAtIp/observedMacs/observedSubnets (presenza cross-subnet)', () => {
  const s = buildSnmpSnapshot({
    nodes: [],
    snmpArp: { 'aa:aa:aa:00:00:01': '10.20.30.5', 'bb:bb:bb:00:00:02': '172.16.9.9' },
  });
  assert.equal(s.macAtIp['aa:aa:aa:00:00:01'], '10.20.30.5', 'MAC→IP dal router');
  assert.deepEqual(s.macAtIps['aa:aa:aa:00:00:01'], ['10.20.30.5']);
  assert.ok(s.observedMacs.includes('aa:aa:aa:00:00:01'), 'il MAC è "visto in rete" → presente');
  assert.deepEqual(s.observedSubnets.sort(), ['10.20.30', '172.16.9'], 'le VLAN dietro il router sono osservate');
  assert.notEqual(s.reachabilityChecked, true, 'l\'ARP router NON è una probe attiva → non marca reachabilityChecked');
});

test('snmpSnap: sweep ARP vivo ha priorità sul router ARP per lo slot legacy (gap-fill)', () => {
  const s = buildSnmpSnapshot({
    nodes: [],
    arpTable: { '10.20.30.5': 'AA:AA:AA:00:00:01' },   // sweep: MAC vivo a .5 (fresco)
    snmpArp: { 'aa:aa:aa:00:00:01': '10.20.30.9' },     // router: stesso MAC visto a .9 (più vecchio)
  });
  assert.equal(s.macAtIp['aa:aa:aa:00:00:01'], '10.20.30.5', 'lo sweep vivo tiene lo slot legacy');
  assert.deepEqual(s.macAtIps['aa:aa:aa:00:00:01'].sort(), ['10.20.30.5', '10.20.30.9'], 'entrambi gli IP nel multihoming');
});

test('round-trip Fase 2: device cross-subnet visto SOLO dall\'ARP del router → VERDE (non unverified né assente)', () => {
  const nodes = [
    { id: 'core', name: 'CORE', type: 'router', mac: 'aa:aa:aa:00:00:01', ip: '10.0.0.1', snmpStatus: 'ok', integration: { host: '10.0.0.1' } },
    { id: 'cam',  name: 'CAM-VLAN20', type: 'ipcam', mac: 'cc:cc:cc:00:00:03', ip: '10.20.0.50' },  // dietro il router, mai pingata né in FDB
  ];
  const model = { nodes, links: [], ports: {}, portLabel: p => p, nodeLabel: n => n.name || n.id, cableLabel: l => l.id, normMac: lower, isPassiveNoIp: () => false };
  const doc = buildDocSnapshot(model);
  const snmp = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb: { core: { 'aa:aa:aa:00:00:01': 'Gi0/0' } }, vlanCache: {},  // osservabilità presente (uno switch)
    reachable: null, arpTable: null, leases: [], knownSigs: [], rejectedAutoLinks: [], normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: () => false, countMacsPerPort: () => ({}),
    snmpArp: { 'cc:cc:cc:00:00:03': '10.20.0.50' },   // la cam è vista SOLO dall'ARP del router
  });
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'la cam vista dal router NON è assente');
  assert.equal(r.counts.unverified, 0, 'e NON è "non-verificabile": il router prova che è viva');
  assert.equal(r.counts.ipChanged, 0, 'IP del router == documentato → nessun cambio IP');
});

test('round-trip Fase 2: router ARP con IP DIVERSO dal documentato → ipChanged (cross-subnet)', () => {
  const nodes = [
    { id: 'sw',  name: 'SW', type: 'switch', mac: 'aa:aa:aa:00:00:01', ip: '10.0.0.1', snmpStatus: 'ok', integration: { host: '10.0.0.1' } },
    { id: 'srv', name: 'SRV', type: 'server', mac: 'dd:dd:dd:00:00:04', ip: '10.20.0.50' },   // doc a .50
  ];
  const model = { nodes, links: [], ports: {}, portLabel: p => p, nodeLabel: n => n.name || n.id, cableLabel: l => l.id, normMac: lower, isPassiveNoIp: () => false };
  const doc = buildDocSnapshot(model);
  const snmp = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb: { sw: { 'aa:aa:aa:00:00:01': 'Gi0/0' } }, vlanCache: {},
    reachable: null, arpTable: null, leases: [], knownSigs: [], rejectedAutoLinks: [], normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: () => false, countMacsPerPort: () => ({}),
    snmpArp: { 'dd:dd:dd:00:00:04': '10.20.0.77' },   // il router lo vede a .77 (≠ documentato)
  });
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'non assente: il router prova che è vivo');
  assert.equal(r.counts.ipChanged, 1, 'IP del router ≠ documentato → cambio IP');
  assert.equal(r.ipChanged[0].newIp, '10.20.0.77');
});

// ── ND discovery: Neighbor Discovery IPv6 (snmpNd) come presenza VIVA cross-subnet ──
test('snmpSnap: snmpNd → SOLO observedMacs (presenza); NON macAtIp, NON observedSubnets', () => {
  const s = buildSnmpSnapshot({
    nodes: [],
    snmpNd: { 'aa:aa:aa:00:00:01': '2001:db8:20::5', 'bb:bb:bb:00:00:02': 'fd00:9::9' },
  });
  assert.ok(s.observedMacs.includes('aa:aa:aa:00:00:01'), 'il vicino ND è "visto in rete" → presente');
  assert.ok(s.observedMacs.includes('bb:bb:bb:00:00:02'));
  assert.ok(!s.macAtIp['aa:aa:aa:00:00:01'], 'ND presence-only: NON alimenta macAtIp (no cambio-IP cross-family)');
  assert.deepEqual(s.macAtIps['aa:aa:aa:00:00:01'] || null, null, 'ND NON alimenta macAtIps');
  assert.deepEqual(s.observedSubnets, [], 'un /64 IPv6 non è una /24 → observedSubnets resta inerte');
});

test('round-trip ND: device cross-subnet visto SOLO dal Neighbor Discovery del router → VERDE', () => {
  const nodes = [
    { id: 'core', name: 'CORE', type: 'router', mac: 'aa:aa:aa:00:00:01', ip: '10.0.0.1', snmpStatus: 'ok', integration: { host: '10.0.0.1' } },
    { id: 'srv6', name: 'SRV-V6', type: 'server', mac: 'ee:ee:ee:00:00:05', ip6: '2001:db8:20::50' },  // dietro il router, IPv6, mai in ARP/FDB
  ];
  const model = { nodes, links: [], ports: {}, portLabel: p => p, nodeLabel: n => n.name || n.id, cableLabel: l => l.id, normMac: lower, isPassiveNoIp: () => false };
  const doc = buildDocSnapshot(model);
  const snmp = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb: { core: { 'aa:aa:aa:00:00:01': 'Gi0/0' } }, vlanCache: {},
    reachable: null, arpTable: null, leases: [], knownSigs: [], rejectedAutoLinks: [], normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: () => false, countMacsPerPort: () => ({}),
    snmpNd: { 'ee:ee:ee:00:00:05': '2001:db8:20::50' },   // il server IPv6 è visto SOLO dall'ND del router
  });
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'il vicino ND NON è assente');
  assert.equal(r.counts.unverified, 0, 'e NON è "non-verificabile": l\'ND prova che è vivo');
});

test('round-trip ND: nodo IPv4-documentato con MAC visto SOLO nell\'ND → NIENTE falso ipChanged (cross-family)', () => {
  const nodes = [
    { id: 'core', name: 'CORE', type: 'router', mac: 'aa:aa:aa:00:00:01', ip: '10.0.0.1', snmpStatus: 'ok', integration: { host: '10.0.0.1' } },
    { id: 'nas',  name: 'NAS', type: 'nas', mac: 'ff:ff:ff:00:00:06', ip: '10.20.0.60' },  // documentato con IPv4
  ];
  const model = { nodes, links: [], ports: {}, portLabel: p => p, nodeLabel: n => n.name || n.id, cableLabel: l => l.id, normMac: lower, isPassiveNoIp: () => false };
  const doc = buildDocSnapshot(model);
  const snmp = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb: { core: { 'aa:aa:aa:00:00:01': 'Gi0/0' } }, vlanCache: {},
    reachable: null, arpTable: null, leases: [], knownSigs: [], rejectedAutoLinks: [], normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: () => false, countMacsPerPort: () => ({}),
    snmpNd: { 'ff:ff:ff:00:00:06': '2001:db8:20::60' },   // stesso MAC visto dall'ND a un IPv6 (≠ IPv4 documentato)
  });
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.ipChanged, 0, 'l\'IPv6 di ND NON deve marcare "cambio IP" contro un IPv4 documentato');
  assert.equal(r.counts.macOrphan, 0, 'ed è comunque presente (verde) via observedMacs');
  assert.equal(r.counts.unverified, 0);
});

// ── Lease RILASCIATO (opt-in) come sfumatura DEBOLE — mai rosso, mai da expiry ──
test('snmpSnap: leaseReleasedHint → releasedMacs SOLO per state=released (mai expired), vuoto se opt-in OFF', () => {
  const leases = [
    { mac: 'AA:AA:AA:00:00:01', ip: '10.0.0.5', state: 'released', hostname: 'pc1' },
    { mac: 'BB:BB:BB:00:00:02', ip: '10.0.0.6', state: 'expired' },   // scaduto (timer): MAI sfumatura
    { mac: 'CC:CC:CC:00:00:03', ip: '10.0.0.7', state: 'active' },     // vivo
  ];
  const base = { nodes: [], leases, normMac: lower, isLeaseStale: l => l.state === 'released' || l.state === 'expired', leaseSeenLabel: (ip, hn) => `${ip} ${hn || ''}`.trim() };
  const off = buildSnmpSnapshot(base);
  assert.deepEqual(off.releasedMacs, {}, 'opt-in OFF → nessuna sfumatura');
  const on = buildSnmpSnapshot(Object.assign({}, base, { leaseReleasedHint: true }));
  assert.deepEqual(Object.keys(on.releasedMacs), ['aa:aa:aa:00:00:01'], 'SOLO il lease rilasciato (non lo scaduto né l\'attivo)');
  assert.equal(on.releasedMacs['aa:aa:aa:00:00:01'].ip, '10.0.0.5');
  assert.equal(on.releasedMacs['aa:aa:aa:00:00:01'].hostname, 'pc1');
  assert.ok(!on.macAtIp['aa:aa:aa:00:00:01'], 'il rilasciato NON dà presenza (resta fuori da macAtIp)');
  assert.ok(on.macAtIp['cc:cc:cc:00:00:03'], 'l\'attivo sì');
});

test('round-trip released: device grigio con lease rilasciato → unverified reason=leaseReleased, MAI rosso', () => {
  const nodes = [{ id: 'pc1', name: 'PC1', type: 'pc', mac: 'aa:aa:aa:00:00:01', ip: '10.0.0.5' }];
  const model = { nodes, links: [], ports: {}, portLabel: p => p, nodeLabel: n => n.name || n.id, cableLabel: l => l.id, normMac: lower, isPassiveNoIp: () => false };
  const doc = buildDocSnapshot(model);
  const snmp = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb: { sw: { 'zz:zz:zz:00:00:09': 'Gi0/0' } }, vlanCache: {},  // osservabilità presente
    reachable: null, arpTable: null, normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: l => l.state === 'released', countMacsPerPort: () => ({}),
    leases: [{ mac: 'AA:AA:AA:00:00:01', ip: '10.0.0.5', state: 'released', hostname: 'pc1' }],
    leaseReleasedHint: true, leaseSeenLabel: (ip) => `${ip}`,
  });
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'MAI rosso: il rilascio è un indizio, non una prova');
  assert.equal(r.counts.unverified, 1, 'resta grigio "non verificabile"');
  assert.equal(r.unverified[0].reason, 'leaseReleased', 'con la sfumatura "probabilmente scollegato"');
});

test('round-trip released: un segnale positivo (FDB) VINCE sul lease rilasciato → verde, niente sfumatura', () => {
  const nodes = [{ id: 'pc1', name: 'PC1', type: 'pc', mac: 'aa:aa:aa:00:00:01', ip: '10.0.0.5' }];
  const model = { nodes, links: [], ports: {}, portLabel: p => p, nodeLabel: n => n.name || n.id, cableLabel: l => l.id, normMac: lower, isPassiveNoIp: () => false };
  const doc = buildDocSnapshot(model);
  const snmp = buildSnmpSnapshot({
    nodes, docPorts: {}, ports: {}, fdb: { sw: { 'aa:aa:aa:00:00:01': 'Gi0/1' } }, vlanCache: {},  // il PC è vivo nell'FDB
    reachable: null, arpTable: null, normMac: lower,
    isVirtualMac: () => false, isRandomizedMac: () => false, isLeaseStale: l => l.state === 'released', countMacsPerPort: () => ({}),
    leases: [{ mac: 'AA:AA:AA:00:00:01', ip: '10.0.0.5', state: 'released', hostname: 'pc1' }],
    leaseReleasedHint: true, leaseSeenLabel: (ip) => `${ip}`,
  });
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.unverified, 0, 'visto vivo nell\'FDB → verde, il lease rilasciato è irrilevante');
  assert.equal(r.counts.macOrphan, 0);
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

// ── Multi-fabric (presenza onesta): LAN reale mischiata al lab → i 192.168.x non
// sono dichiarati assenti, restano "non verificabili" (nessun segnale positivo, nessuna
// prova di assenza). Dopo Fase 1 la copertura FDB per-subnet non serve più a decidere
// rosso/grigio (era il vecchio `fdbSubnets`, ora rimosso): un device che nessuno vede
// resta grigio a prescindere.
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
  assert.deepEqual(d, { ports: {}, macs: [], ipOnly: [], deviceSigs: [], cables: [] });
  const s = buildSnmpSnapshot({});
  assert.equal(s.fdbObserved, false);
  assert.deepEqual(s.observedDevices, []);
});
