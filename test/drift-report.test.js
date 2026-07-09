'use strict';
// Test del diff engine puro del Drift Report (lib/drift-report.js).
const test = require('node:test');
const assert = require('node:assert');
const { buildDriftReport, driftBannerKind } = require('../lib/drift-report.js');

// ── Banner della Verifica (3 vie): allineata vs cieca vs anomalie ───────────
test('driftBannerKind: anomalie azionabili → "discrepancies"', () => {
  assert.equal(driftBannerKind({ consistent: 50, stateDrift: 1, unverified: 0 }), 'discrepancies');
  assert.equal(driftBannerKind({ macOrphan: 2 }), 'discrepancies');
  assert.equal(driftBannerKind({ ipChanged: 1, consistent: 100 }), 'discrepancies');
});
test('driftBannerKind: ZERO anomalie ma niente verificato (tutto unverified) → "blind" (NON allineata)', () => {
  // Il caso del progetto da 500 device su reti non raggiunte: 0 anomalie, 0
  // confermati presenti, 487 non verificabili → NON è "tutto a posto".
  assert.equal(driftBannerKind({ consistent: 0, unverified: 487, stateDrift: 0, macOrphan: 0, undocumented: 0, ipChanged: 0, ghostCable: 0 }), 'blind');
});
test('driftBannerKind: nessuna anomalia con copertura reale → "aligned"', () => {
  assert.equal(driftBannerKind({ consistent: 200, unverified: 0 }), 'aligned');
  assert.equal(driftBannerKind({ consistent: 200, unverified: 7 }), 'aligned', 'qualcosa verificato + alcuni non verificabili = comunque allineata (con nota)');
  assert.equal(driftBannerKind({ consistent: 0, unverified: 0 }), 'aligned', 'progetto vuoto → niente da allarmare');
});
test('driftBannerKind: input mancante → "aligned" (mai throw)', () => {
  assert.equal(driftBannerKind(), 'aligned');
  assert.equal(driftBannerKind(null), 'aligned');
});

test('porta coerente → categoria consistent, nessun drift', () => {
  const doc = { ports: { 'sw1-1': { label: 'SW1 / P1', status: 'active', speed: 1000, vlan: 10 } } };
  const snmp = { responded: { 'sw1': true }, ports: { 'sw1-1': { status: 'active', speed: 1000, vlan: 10 } } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.consistent, 1);
  assert.equal(r.counts.stateDrift, 0);
});

test('stato divergente → stateDrift con diffs e patch alla realta', () => {
  const doc = { ports: { 'sw1-1': { label: 'SW1 / P1', status: 'active', speed: 1000, vlan: 10 } } };
  const snmp = { responded: { 'sw1': true }, ports: { 'sw1-1': { status: 'inactive', speed: 100, vlan: 20 } } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.stateDrift, 1);
  const row = r.stateDrift[0];
  const fields = row.diffs.map(d => d.field).sort();
  assert.deepEqual(fields, ['speed', 'status', 'vlan']);
  assert.equal(row.patch.status, 'inactive');
  assert.equal(row.patch.vlan, 20);
});

test('device muto (non risponde) → porta non valutata', () => {
  const doc = { ports: { 'sw1-1': { status: 'active', vlan: 10 } } };
  const snmp = { responded: {}, ports: {} };  // sw1 non ha risposto
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.consistent, 0);
  assert.equal(r.counts.stateDrift, 0);
});

test('MAC documentato mai visto → macOrphan; MAC visto → niente', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:01', label: 'srv1' }, { mac: 'AA:BB:CC:00:00:02', label: 'srv2' }] };
  const snmp = { observedMacs: ['aa:bb:cc:00:00:02'] };  // solo srv2 visto (case-insensitive)
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1);
  assert.equal(r.macOrphan[0].label, 'srv1');
});

test('fdbObserved=false (nessuna osservabilità) → ZERO macOrphan, anche con MAC documentati non visti', () => {
  // Caso reale: Sync fallisce su (quasi) tutti i device → FDB vuoto. Senza una
  // MAC-table non possiamo dichiarare nessuno "assente in rete".
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:01', label: 'sw1', nodeId: 'sw1' },
    { mac: 'AA:BB:CC:00:00:02', label: 'sw2', nodeId: 'sw2' },
  ] };
  const snmp = { observedMacs: [], fdbObserved: false };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'FDB vuoto → nessuna affermazione di assenza');
});

test('fdbObserved=true ma MAC non visto + nodo muto → macOrphan (osservabilità presente)', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:09', label: 'old', nodeId: 'old' }] };
  const snmp = { observedMacs: ['aa:bb:cc:00:00:77'], fdbObserved: true, responded: {} };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'con FDB popolato e device muto non visto → davvero assente');
});

test('device che HA RISPOSTO al sync NON è macOrphan, anche se il MAC non è in alcun FDB', () => {
  // sw1: ha risposto (responded), MAC NON osservato in FDB → NON deve essere "assente"
  // sw2: NON ha risposto, MAC non osservato → resta macOrphan (forse davvero rimosso)
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:01', label: 'sw1', nodeId: 'sw1' },
    { mac: 'AA:BB:CC:00:00:02', label: 'sw2', nodeId: 'sw2' },
  ] };
  const snmp = { observedMacs: [], responded: { sw1: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'solo sw2 (muto) è assente; sw1 ha risposto → presente');
  assert.equal(r.macOrphan[0].label, 'sw2');
});

test('presence-aware: device RAGGIUNGIBILE ma non-SNMP (ping/ARP/TCP) NON è macOrphan', () => {
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:10', label: 'pc-vivo', nodeId: 'pc1' },
    { mac: 'AA:BB:CC:00:00:11', label: 'pc-morto', nodeId: 'pc2' },
  ] };
  // FDB vuoto, nessuna risposta SNMP, ma la sweep ha girato: pc1 vivo, pc2 no
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true, presentNodeIds: { pc1: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'solo pc2 (non raggiungibile) è assente; pc1 è presente via ping');
  assert.equal(r.macOrphan[0].label, 'pc-morto');
});

test('osservabilità: la sweep eseguita abilita il giudizio di assenza anche con FDB vuoto', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:20', label: 'x', nodeId: 'x' }] };
  // né sweep né FDB → nessuna osservabilità → 0 (non si afferma assenza)
  assert.equal(buildDriftReport({ observedMacs: [], fdbObserved: false }, doc, [], {}).counts.macOrphan, 0);
  // sweep eseguita (qualcuno vivo) e x non presente → assente
  const snmp = { observedMacs: [], fdbObserved: false, reachabilityChecked: true, presentNodeIds: {} };
  assert.equal(buildDriftReport(snmp, doc, [], {}).counts.macOrphan, 1);
});

test('cross-subnet: device su subnet NON raggiunta dalla sweep → unverified, non macOrphan', () => {
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:40', label: 'cam-altra-vlan', nodeId: 'cam1', ip: '10.20.0.5' },
    { mac: 'AA:BB:CC:00:00:41', label: 'pc-stessa-subnet', nodeId: 'pc1', ip: '192.168.1.30' },
  ] };
  // La sweep ha visto solo 192.168.1.x (subnet del server). 10.20.0.x mai raggiunta.
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true,
                 presentNodeIds: {}, observedSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'solo il device nella subnet osservata può dirsi assente');
  assert.equal(r.macOrphan[0].label, 'pc-stessa-subnet');
  assert.equal(r.counts.unverified, 1, 'il device cross-subnet non osservato è non-verificabile');
  assert.equal(r.unverified[0].label, 'cam-altra-vlan');
  assert.equal(r.unverified[0].ip, '10.20.0.5');
  // Esposti per l'accorpamento in "Reti del progetto" (annota presenza per /24).
  assert.equal(r.sweepRan, true, 'sweepRan esposto nell\'output');
  assert.deepEqual(r.observedSubnets, ['192.168.1'], 'observedSubnets esposto nell\'output');
});

test('cross-subnet back-compat: FDB senza dettaglio subnet (fdbSubnets assente) → copre il L2 come prima', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:42', label: 'x', nodeId: 'x', ip: '10.20.0.9' }] };
  // fdbObserved=true SENZA fdbSubnets → comportamento storico (FDB copre tutte le VLAN)
  const snmp = { observedMacs: [], responded: {}, fdbObserved: true, reachabilityChecked: true,
                 presentNodeIds: {}, observedSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.unverified, 0, 'senza fdbSubnets la visibilità L2 resta trasversale (back-compat)');
  assert.equal(r.counts.macOrphan, 1);
});

// ── Multi-fabric (fix falso "assente" della LAN reale mischiata col lab) ──────
// La FDB bridge di UN fabric (es. gli switch del lab 10.10.x) NON vede i MAC di un
// altro dominio L2 raggiungibile solo a L3 (es. la LAN reale 192.168.x dietro un
// router). Con `fdbSubnets` la copertura FDB è limitata alle subnet viste a L2.
test('multi-fabric: fdbObserved + fdbSubnets → device su subnet NON coperta a L2 → unverified (non grigio)', () => {
  const doc = { macs: [
    { mac: 'AA:AA:AA:00:00:01', label: 'sw-lab',  nodeId: 'sw', ip: '10.10.99.1' },
    { mac: 'CC:CC:CC:00:00:03', label: 'pc-lan-reale', nodeId: 'pc', ip: '192.168.1.101' },
  ] };
  // FDB copre solo il lab (10.10.99); la LAN reale 192.168.1 NON è tra fdbSubnets.
  const snmp = { observedMacs: ['aa:aa:aa:00:00:01'], responded: {}, fdbObserved: true,
                 presentNodeIds: {}, observedSubnets: [], fdbSubnets: ['10.10.99'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'lo switch del lab è visto in FDB; il PC reale non è dichiarabile assente');
  assert.equal(r.counts.unverified, 1, 'il PC della LAN reale (L2 mai osservata) è non-verificabile, non assente');
  assert.equal(r.unverified[0].label, 'pc-lan-reale');
  assert.equal(r.unverified[0].ip, '192.168.1.101');
});

test('multi-fabric: device ASSENTE su subnet COPERTA dalla FDB → macOrphan (grigio corretto)', () => {
  const doc = { macs: [{ mac: 'DD:DD:DD:00:00:04', label: 'pc-lab-spento', nodeId: 'x', ip: '10.10.99.50' }] };
  const snmp = { observedMacs: ['aa:aa:aa:00:00:01'], responded: {}, fdbObserved: true,
                 presentNodeIds: {}, observedSubnets: [], fdbSubnets: ['10.10.99'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'la sua L2 è osservata (fdbSubnets) ma il MAC non c\'è → davvero assente');
  assert.equal(r.counts.unverified, 0);
});

test('back-compat: reachabilityChecked senza observedSubnets → macOrphan come prima', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:43', label: 'x', nodeId: 'x', ip: '10.20.0.1' }] };
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true, presentNodeIds: {} };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'senza info per-subnet si mantiene il comportamento storico');
  assert.equal(r.counts.unverified, 0);
});

test('unverified ignorabile: la key unver: rispetta la lista ignores', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:44', label: 'y', nodeId: 'y', ip: '10.30.0.7' }] };
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true,
                 presentNodeIds: {}, observedSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, ['unver:aa:bb:cc:00:00:44'], {});
  assert.equal(r.counts.unverified, 0, 'riga unverified soppressa via ignores');
});

test('cambio IP: MAC documentato VIVO a un IP diverso → ipChanged, NON macOrphan', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:30', label: 'srv', nodeId: 'srv', ip: '192.168.1.50' }] };
  const snmp = { observedMacs: [], reachabilityChecked: true, fdbObserved: false, presentNodeIds: {},
                 macAtIp: { 'aa:bb:cc:00:00:30': '192.168.1.60' } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'non assente: il MAC è vivo in rete');
  assert.equal(r.counts.ipChanged, 1, 'segnalato come cambio IP');
  assert.equal(r.ipChanged[0].oldIp, '192.168.1.50');
  assert.equal(r.ipChanged[0].newIp, '192.168.1.60');
});

test('cambio IP: MAC vivo allo STESSO IP documentato → presente, niente ipChanged', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:31', label: 'srv', nodeId: 'srv', ip: '192.168.1.50' }] };
  const snmp = { observedMacs: [], reachabilityChecked: true, fdbObserved: false, presentNodeIds: {},
                 macAtIp: { 'aa:bb:cc:00:00:31': '192.168.1.50' } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0);
  assert.equal(r.counts.ipChanged, 0);
});

test('device ignoto non documentato → undocumented; se in rejectedSigs → escluso', () => {
  const doc = { deviceSigs: ['known-1'] };
  const snmp = {
    observedDevices: [
      { sig: 'ghost-x', mac: '11:22:33:44:55:66', label: 'sconosciuto' },
      { sig: 'rej-y', mac: '77:88:99:aa:bb:cc', label: 'gia-rifiutato' },
      { sig: 'known-1', mac: 'de:ad:be:ef:00:00', label: 'noto' },
    ],
    rejectedSigs: ['rej-y'],
  };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.undocumented, 1);
  assert.equal(r.undocumented[0].sig, 'ghost-x');
});

test('undocumented: default → cls infra, contato in counts.undocumented', () => {
  const snmp = { observedDevices: [{ sig: 'x', mac: '11:22:33:44:55:66', label: 'switch?' }] };
  const r = buildDriftReport(snmp, {}, [], {});
  assert.equal(r.undocumented[0].cls, 'infra');
  assert.equal(r.counts.undocumented, 1);
  assert.equal(r.counts.undocumentedEndpoint, 0);
});

test('undocumented: MAC su VLAN guest → cls endpoint, fuori da counts.undocumented', () => {
  const snmp = {
    observedDevices: [
      { sig: 'phone', mac: 'aa:00:00:00:00:01', label: 'iPhone', vlan: 99 },
      { sig: 'sw',    mac: 'bb:00:00:00:00:02', label: 'switch', vlan: 10 },
    ],
  };
  const r = buildDriftReport(snmp, {}, [], { guestVlans: [99] });
  const bySig = Object.fromEntries(r.undocumented.map(d => [d.sig, d.cls]));
  assert.equal(bySig.phone, 'endpoint');
  assert.equal(bySig.sw, 'infra');
  assert.equal(r.counts.undocumented, 1);          // solo lo switch
  assert.equal(r.counts.undocumentedEndpoint, 1);  // il telefono
});

test('undocumented: uplink affollato (portMacCount >= soglia) → cls endpoint', () => {
  const snmp = {
    observedDevices: [
      { sig: 'a', mac: 'aa:00:00:00:00:01', label: 'dietro AP', portMacCount: 27 },
      { sig: 'b', mac: 'bb:00:00:00:00:02', label: 'access',    portMacCount: 1 },
    ],
  };
  const r = buildDriftReport(snmp, {}, [], { endpointPortThreshold: 5 });
  const bySig = Object.fromEntries(r.undocumented.map(d => [d.sig, d.cls]));
  assert.equal(bySig.a, 'endpoint');
  assert.equal(bySig.b, 'infra');
});

test('undocumented: vendor consumer (consumer:true) → cls endpoint', () => {
  const snmp = { observedDevices: [{ sig: 'p', mac: 'aa:00:00:00:00:01', label: 'BYOD', consumer: true }] };
  const r = buildDriftReport(snmp, {}, [], {});
  assert.equal(r.undocumented[0].cls, 'endpoint');
  assert.equal(r.counts.undocumented, 0);
  assert.equal(r.counts.undocumentedEndpoint, 1);
});

test('undocumented: trasparenza — reasons registra QUALI segnali sono scattati', () => {
  const snmp = {
    observedDevices: [
      { sig: 'g', mac: 'aa:00:00:00:00:01', label: 'su guest',  vlan: 99 },                     // solo guest-VLAN
      { sig: 'c', mac: 'bb:00:00:00:00:02', label: 'dietro AP', portMacCount: 12 },             // solo porta affollata
      { sig: 'r', mac: 'cc:00:00:00:00:03', label: 'telefono',  consumer: true },               // solo MAC random
      { sig: 'm', mac: 'dd:00:00:00:00:04', label: 'tutti',     vlan: 99, portMacCount: 12, consumer: true }, // 3 segnali
      { sig: 'i', mac: 'ee:00:00:00:00:05', label: 'switch',    portMacCount: 1 },              // nessun segnale → infra
    ],
  };
  const r = buildDriftReport(snmp, {}, [], { guestVlans: [99], endpointPortThreshold: 5 });
  const by = Object.fromEntries(r.undocumented.map(d => [d.sig, d]));
  assert.deepEqual(by.g.reasons, ['guestVlan']);
  assert.deepEqual(by.c.reasons, ['crowdedPort']);
  assert.equal(by.c.portMacCount, 12);                       // il conteggio viaggia con la riga (per "porta affollata (N)")
  assert.deepEqual(by.r.reasons, ['randomMac']);
  assert.deepEqual(by.m.reasons, ['guestVlan', 'crowdedPort', 'randomMac']);
  assert.equal(by.m.cls, 'endpoint');
  assert.deepEqual(by.i.reasons, []);                        // infra → nessun motivo, si mostra
  assert.equal(by.i.cls, 'infra');
});

test('undocumented: VLAN di management forza infra + onMgmt (anti-guest), anche con segnali BYOD', () => {
  const snmp = {
    observedDevices: [
      { sig: 'm1', mac: 'aa:00:00:00:00:11', label: 'ignoto su mgmt', vlan: 10 },                                  // mgmt, nessun segnale
      { sig: 'm2', mac: 'bb:00:00:00:00:12', label: 'rogue su mgmt',  vlan: 10, consumer: true, portMacCount: 12 }, // mgmt + segnali BYOD
      { sig: 'g',  mac: 'cc:00:00:00:00:13', label: 'telefono guest', vlan: 99, consumer: true },                  // guest endpoint (controllo)
    ],
  };
  const r = buildDriftReport(snmp, {}, [], { mgmtVlans: [10], guestVlans: [99], endpointPortThreshold: 5 });
  const by = Object.fromEntries(r.undocumented.map(d => [d.sig, d]));
  assert.equal(by.m1.cls, 'infra');
  assert.equal(by.m1.onMgmt, true);
  assert.deepEqual(by.m1.reasons, []);
  assert.equal(by.m2.cls, 'infra');             // i segnali BYOD NON declassano un device sulla VLAN di management
  assert.equal(by.m2.onMgmt, true);
  assert.deepEqual(by.m2.reasons, []);          // azzerati: niente badge "MAC privato/porta affollata"
  assert.equal(by.g.cls, 'endpoint');           // controllo: la guest classifica ancora endpoint
  assert.equal(by.g.onMgmt, false);
  // i device su mgmt sono "non documentati" AZIONABILI (mostrati), non collassati come endpoint
  assert.equal(r.counts.undocumented, 2);
  assert.equal(r.counts.undocumentedEndpoint, 1);  // solo il telefono guest
});

test('ipChanged: flag manual riflette ipManual del device documentato (G3)', () => {
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:01', ip: '10.0.0.10', nodeId: 'n1', ipManual: true },
    { mac: 'AA:BB:CC:00:00:02', ip: '10.0.0.20', nodeId: 'n2', ipManual: false },
  ] };
  const snmp = { reachabilityChecked: true,
    macAtIp: { 'aa:bb:cc:00:00:01': '10.0.0.99', 'aa:bb:cc:00:00:02': '10.0.0.98' } };
  const r = buildDriftReport(snmp, doc, [], {});
  const by = Object.fromEntries(r.ipChanged.map(x => [x.mac, x]));
  assert.equal(r.counts.ipChanged, 2);
  assert.equal(by['AA:BB:CC:00:00:01'].manual, true);   // pin manuale → applicare chiede conferma
  assert.equal(by['AA:BB:CC:00:00:02'].manual, false);
});

test('robustezza: doc.macs con entry nulle/malformate non fa lanciare (R1)', () => {
  const snmp = { reachabilityChecked: true, observedMacs: [], macAtIp: {} };
  const doc = { macs: [null, undefined, {}, { mac: null }, { mac: '' },
    { mac: 'AA:BB:CC:00:00:09', ip: '10.0.0.9', nodeId: 'n', label: 'ok' }] };
  let r;
  assert.doesNotThrow(() => { r = buildDriftReport(snmp, doc, [], {}); });
  assert.ok(r && r.counts, 'ritorna un report valido nonostante le entry malformate');
});

test('cavo fantasma: porta down da >= N sync → ghostCable; sotto soglia → no', () => {
  const doc = {
    cables: [
      { id: 'c1', label: 'A→B', src: 'sw1-1', dst: 'sw2-1' },   // streak 3 → fantasma
      { id: 'c2', label: 'A→C', src: 'sw1-2', dst: 'sw3-1' },   // streak 1 → no
    ],
  };
  const snmp = { portDownStreak: { 'sw1-1': 3, 'sw2-1': 0, 'sw1-2': 1 } };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.ghostCable, 1);
  assert.equal(r.ghostCable[0].id, 'c1');
  assert.equal(r.ghostCable[0].downStreak, 3);
});

test('ignore persiste: la riga con key ignorata non compare', () => {
  const doc = { ports: { 'sw1-1': { status: 'active', vlan: 10 } } };
  const snmp = { responded: { 'sw1': true }, ports: { 'sw1-1': { status: 'inactive', vlan: 10 } } };
  const r1 = buildDriftReport(snmp, doc, [], {});
  assert.equal(r1.counts.stateDrift, 1);
  const key = r1.stateDrift[0].key;
  const r2 = buildDriftReport(snmp, doc, [key], {});       // stessa condizione, ora ignorata
  assert.equal(r2.counts.stateDrift, 0);
});

test('ignore segue la condizione: se la realta cambia, la riga riappare', () => {
  const doc = { ports: { 'sw1-1': { status: 'active', vlan: 10 } } };
  const snmpA = { responded: { 'sw1': true }, ports: { 'sw1-1': { status: 'inactive', vlan: 10 } } };
  const keyA = buildDriftReport(snmpA, doc, [], {}).stateDrift[0].key;
  // realta' cambia: ora vlan diversa → nuova condizione → nuova key
  const snmpB = { responded: { 'sw1': true }, ports: { 'sw1-1': { status: 'inactive', vlan: 99 } } };
  const r = buildDriftReport(snmpB, doc, [keyA], {});      // keyA non copre la nuova condizione
  assert.equal(r.counts.stateDrift, 1);
});
