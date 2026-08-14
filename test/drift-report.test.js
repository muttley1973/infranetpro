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
test('driftBannerKind: audit CIECO (osservabilità assente) su progetto POPOLATO → "blind", non "aligned"', () => {
  // Il bug misurato (audit 2026-07-23): Sync fallito su tutto (fdbObserved:false,
  // niente sweep) → il blocco presenza è saltato in blocco, i device documentati
  // non finiscono in `unverified` → i soli counts dicono {consistent:0,unverified:0}
  // e il banner diceva "Documentazione allineata" su 487 device MAI valutati.
  // Il report porta evaluated:false + docCount>0 → ora è "blind".
  const counts = { consistent: 0, unverified: 0, stateDrift: 0, macOrphan: 0, undocumented: 0, ipChanged: 0, ghostCable: 0 };
  assert.equal(driftBannerKind(counts, { evaluated: false, docCount: 487 }), 'blind', 'audit cieco su rete popolata ≠ allineata');
  assert.equal(driftBannerKind(counts, { evaluated: false, docCount: 0 }), 'aligned', 'progetto GENUINAMENTE vuoto → resta allineata');
  assert.equal(driftBannerKind(counts, { evaluated: true, docCount: 487 }), 'aligned', 'osservabilità presente, 0 anomalie, 0 non-verif. → davvero allineato');
  // Retro-compatibile: senza report (1 solo argomento) la via (b) resta silente.
  assert.equal(driftBannerKind(counts), 'aligned');
});
test('buildDriftReport espone evaluated/docCount: il caso cieco NON è più indistinguibile dal vuoto', () => {
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:01', label: 'sw1', nodeId: 'sw1' },
    { mac: 'AA:BB:CC:00:00:02', label: 'sw2', nodeId: 'sw2' },
  ], ipOnly: [{ nodeId: 'kvm', label: 'kvm', ip: '10.0.0.9' }] };
  // Snapshot cieco: nessun FDB, nessuna sweep (== Sync fallito su tutto).
  const blind = buildDriftReport({ observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: false }, doc, [], {});
  assert.equal(blind.evaluated, false, 'nessuna osservabilità');
  assert.equal(blind.docCount, 3, '2 MAC + 1 ipOnly documentati, che sarebbero dovuti essere valutati');
  assert.equal(blind.counts.unverified, 0, 'il blocco presenza è saltato: 0 in unverified (ecco perché servono i due segnali)');
  assert.equal(driftBannerKind(blind.counts, blind), 'blind', 'end-to-end: report cieco → banner cieco');
  // Progetto vuoto: docCount 0 → aligned (niente da allarmare).
  const empty = buildDriftReport({ fdbObserved: false }, {}, [], {});
  assert.equal(empty.docCount, 0);
  assert.equal(driftBannerKind(empty.counts, empty), 'aligned');
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

test('MAC visto in rete → presente; mai visto SENZA prova di assenza → grigio (non rosso)', () => {
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:01', label: 'srv1', nodeId: 'srv1' },
    { mac: 'AA:BB:CC:00:00:02', label: 'srv2', nodeId: 'srv2' },
  ] };
  const snmp = { observedMacs: ['aa:bb:cc:00:00:02'] };  // solo srv2 visto (case-insensitive)
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'un MAC mai visto NON è "assente" senza prova affidabile');
  assert.equal(r.counts.unverified, 1);
  assert.equal(r.unverified[0].label, 'srv1', 'srv1 non visto → non-verificabile (grigio)');
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

test('fdbObserved=true, MAC non visto, nodo muto CON prova di assenza (trustAbsent) → macOrphan', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:09', label: 'old', nodeId: 'old' }] };
  const snmp = { observedMacs: ['aa:bb:cc:00:00:77'], fdbObserved: true, responded: {}, trustAbsentNodeIds: { old: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'FDB popolato + device muto + assenza PROVATA → davvero assente');
});

test('fdbObserved=true, MAC non visto, nodo muto SENZA prova → unverified (grigio, non rosso)', () => {
  // FDB-miss da solo NON è morte: la MAC-table invecchia (~300s), un host acceso
  // ma silenzioso ne esce. Senza prova affidabile → grigio, non rosso.
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:09', label: 'old', nodeId: 'old' }] };
  const snmp = { observedMacs: ['aa:bb:cc:00:00:77'], fdbObserved: true, responded: {} };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'FDB-miss senza prova → mai rosso');
  assert.equal(r.counts.unverified, 1);
});

test('device che HA RISPOSTO al sync NON è assente; il muto con prova di assenza → macOrphan', () => {
  // sw1: ha risposto (responded), MAC NON osservato in FDB → NON deve essere "assente"
  // sw2: NON ha risposto E c'è una prova di assenza affidabile (trustAbsent) → assente
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:01', label: 'sw1', nodeId: 'sw1' },
    { mac: 'AA:BB:CC:00:00:02', label: 'sw2', nodeId: 'sw2' },
  ] };
  const snmp = { observedMacs: [], responded: { sw1: true }, trustAbsentNodeIds: { sw2: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'sw1 ha risposto → presente; sw2 muto + assenza provata → assente');
  assert.equal(r.macOrphan[0].label, 'sw2');
});

test('presence-aware: device RAGGIUNGIBILE (ping/ARP/TCP) NON è assente; l\'assente-provato sì', () => {
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:10', label: 'pc-vivo', nodeId: 'pc1' },
    { mac: 'AA:BB:CC:00:00:11', label: 'pc-morto', nodeId: 'pc2' },
  ] };
  // FDB vuoto, nessuna risposta SNMP, sweep girata: pc1 vivo, pc2 assente PROVATO (ARP-miss locale)
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true,
                 presentNodeIds: { pc1: true }, trustAbsentNodeIds: { pc2: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'solo pc2 (assenza provata) è assente; pc1 è presente via ping');
  assert.equal(r.macOrphan[0].label, 'pc-morto');
});

test('osservabilità: sweep + prova di assenza → macOrphan; sweep SENZA prova → grigio', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:20', label: 'x', nodeId: 'x' }] };
  // né sweep né FDB → nessuna osservabilità → 0 (non si valuta)
  assert.equal(buildDriftReport({ observedMacs: [], fdbObserved: false }, doc, [], {}).counts.macOrphan, 0);
  // sweep eseguita ma NESSUNA prova di assenza per x → grigio, NON rosso
  const grey = { observedMacs: [], fdbObserved: false, reachabilityChecked: true, presentNodeIds: {} };
  assert.equal(buildDriftReport(grey, doc, [], {}).counts.macOrphan, 0, '"non risponde" non è "morto"');
  assert.equal(buildDriftReport(grey, doc, [], {}).counts.unverified, 1);
  // sweep + prova di assenza affidabile (ARP-miss locale) → assente
  const red = { observedMacs: [], fdbObserved: false, reachabilityChecked: true, presentNodeIds: {}, trustAbsentNodeIds: { x: true } };
  assert.equal(buildDriftReport(red, doc, [], {}).counts.macOrphan, 1);
});

test('cross-subnet: solo il device con prova di assenza è rosso; il cross-subnet muto → grigio', () => {
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:40', label: 'cam-altra-vlan', nodeId: 'cam1', ip: '10.20.0.5' },
    { mac: 'AA:BB:CC:00:00:41', label: 'pc-stessa-subnet', nodeId: 'pc1', ip: '192.168.1.30' },
  ] };
  // pc1 on-segment e assente-provato (ARP-miss locale); cam1 su subnet remota non raggiunta.
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true,
                 presentNodeIds: {}, observedSubnets: ['192.168.1'], trustAbsentNodeIds: { pc1: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'solo il device con assenza PROVATA è rosso');
  assert.equal(r.macOrphan[0].label, 'pc-stessa-subnet');
  assert.equal(r.counts.unverified, 1, 'il cross-subnet non provato assente è non-verificabile');
  assert.equal(r.unverified[0].label, 'cam-altra-vlan');
  assert.equal(r.unverified[0].ip, '10.20.0.5');
  // Esposti per l'accorpamento in "Reti del progetto" (annota presenza per /24).
  assert.equal(r.sweepRan, true, 'sweepRan esposto nell\'output');
  assert.deepEqual(r.observedSubnets, ['192.168.1'], 'observedSubnets esposto nell\'output');
});

test('presenza onesta: FDB popolato ma MAC non visto e nessuna prova → grigio (mai rosso da solo)', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:42', label: 'x', nodeId: 'x', ip: '10.20.0.9' }] };
  // fdbObserved=true (osservabilità) ma il MAC non c'è e nessuna prova di assenza → grigio
  const snmp = { observedMacs: [], responded: {}, fdbObserved: true, reachabilityChecked: true,
                 presentNodeIds: {}, observedSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'FDB-miss senza prova di assenza NON è rosso');
  assert.equal(r.counts.unverified, 1);
});

// ── Multi-fabric (presenza onesta): la LAN reale mischiata al lab ─────────────
// Uno switch del lab (10.10.x) vede in FDB solo i propri MAC; il PC della LAN reale
// (192.168.x, dietro un router) non è visto da nessuno. Dopo Fase 1 non serve più la
// copertura FDB per-subnet (il vecchio `fdbSubnets`, ora rimosso): chi non ha alcun
// segnale positivo né una prova di assenza resta "non verificabile", mai assente.
test('multi-fabric: device di una LAN mai osservata → unverified (non assente)', () => {
  const doc = { macs: [
    { mac: 'AA:AA:AA:00:00:01', label: 'sw-lab',  nodeId: 'sw', ip: '10.10.99.1' },
    { mac: 'CC:CC:CC:00:00:03', label: 'pc-lan-reale', nodeId: 'pc', ip: '192.168.1.101' },
  ] };
  // sw è visto in FDB (presente); il PC reale non è visto da nessuno.
  const snmp = { observedMacs: ['aa:aa:aa:00:00:01'], responded: {}, fdbObserved: true,
                 presentNodeIds: {}, observedSubnets: [] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'lo switch del lab è visto in FDB; il PC reale non è dichiarabile assente');
  assert.equal(r.counts.unverified, 1, 'il PC della LAN reale (mai visto) è non-verificabile, non assente');
  assert.equal(r.unverified[0].label, 'pc-lan-reale');
  assert.equal(r.unverified[0].ip, '192.168.1.101');
});

test('multi-fabric: device su subnet coperta dalla FDB, assenza PROVATA → macOrphan', () => {
  // Anche sulla L2 osservata, un FDB-miss da solo NON basta (la MAC-table invecchia):
  // serve una prova affidabile (trustAbsent, es. ARP-miss locale sul suo IP).
  const doc = { macs: [{ mac: 'DD:DD:DD:00:00:04', label: 'pc-lab-spento', nodeId: 'x', ip: '10.10.99.50' }] };
  const snmp = { observedMacs: ['aa:aa:aa:00:00:01'], responded: {}, fdbObserved: true,
                 presentNodeIds: {}, observedSubnets: [], fdbSubnets: ['10.10.99'], trustAbsentNodeIds: { x: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'MAC assente dalla sua L2 + assenza PROVATA → davvero assente');
  assert.equal(r.counts.unverified, 0);
});

// ── Documentati CON IP ma SENZA MAC (doc.ipOnly): infra/endpoint mai sincronizzati ──
// L'audit per-MAC non li vede; presenza per-nodeId (SNMP responded / sweep). È il
// caso degli switch/kvm/pc lab con mac vuoto che restavano a colori pieni.
test('ipOnly: SNMP device senza MAC, muto, subnet NON osservabile → unverified (grigio)', () => {
  const doc = { ipOnly: [{ nodeId: 'kvm', label: 'kvm', ip: '10.10.30.10', hasSnmp: true }] };
  const snmp = { observedMacs: [], responded: {}, presentNodeIds: {}, fdbObserved: true,
                 observedSubnets: [], fdbSubnets: ['192.168.1'] };   // 10.10.30 fuori copertura
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.unverified, 1, 'device SNMP senza MAC su subnet non coperta → non verificabile');
  assert.equal(r.unverified[0].nodeId, 'kvm');
  assert.equal(r.unverified[0].mac, '', 'entry senza MAC');
  assert.equal(r.counts.macOrphan, 0);
});

test('ipOnly: device SNMP muto su subnet osservabile SENZA prova → grigio (SNMP-muto ≠ morte)', () => {
  // SNMP che non risponde può essere filtrato/riavviato/credenziali cambiate: non
  // è una prova di morte. Senza trustAbsent → grigio, non rosso.
  const doc = { ipOnly: [{ nodeId: 'sw', label: 'sw-casa', ip: '192.168.1.9', hasSnmp: true }] };
  const snmp = { observedMacs: [], responded: {}, presentNodeIds: {}, fdbObserved: true,
                 observedSubnets: [], fdbSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'SNMP muto da solo NON è rosso');
  assert.equal(r.counts.unverified, 1);
  assert.equal(r.unverified[0].nodeId, 'sw');
});

test('ipOnly: device muto CON prova di assenza (trustAbsent) → macOrphan', () => {
  const doc = { ipOnly: [{ nodeId: 'sw', label: 'sw-casa', ip: '192.168.1.9', hasSnmp: true }] };
  const snmp = { observedMacs: [], responded: {}, presentNodeIds: {}, fdbObserved: true,
                 reachabilityChecked: true, trustAbsentNodeIds: { sw: true } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'ARP-miss locale sul suo IP → davvero assente');
  assert.equal(r.macOrphan[0].nodeId, 'sw');
  assert.equal(r.counts.unverified, 0);
});

test('ipOnly: device senza MAC e senza SNMP, subnet NON osservabile → unverified (grigio)', () => {
  const doc = { ipOnly: [{ nodeId: 'pc6', label: 'pc6', ip: '10.10.30.100', hasSnmp: false }] };
  const snmp = { observedMacs: [], responded: {}, presentNodeIds: {}, fdbObserved: true,
                 observedSubnets: [], fdbSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.unverified, 1, 'endpoint senza MAC/SNMP su subnet non coperta → non verificabile');
  assert.equal(r.unverified[0].nodeId, 'pc6');
});

test('ipOnly: device senza MAC/SNMP, subnet osservabile, nessuna prova → grigio (non-verificato)', () => {
  // Non lo si è sondato attivamente e non c'è prova di assenza → onestamente "non so"
  // (grigio). Prima restava a colori pieni; ora "non verificato" è più onesto.
  const doc = { ipOnly: [{ nodeId: 'prn', label: 'stampante', ip: '192.168.1.50', hasSnmp: false }] };
  const snmp = { observedMacs: [], responded: {}, presentNodeIds: {}, fdbObserved: true,
                 observedSubnets: [], fdbSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'niente rosso: nessuna prova di assenza');
  assert.equal(r.counts.unverified, 1, 'grigio: non verificato');
  assert.equal(r.unverified[0].nodeId, 'prn');
});

test('ipOnly: device senza MAC che HA risposto (responded/present) → presente, nessuna marcatura', () => {
  const doc = { ipOnly: [
    { nodeId: 'a', label: 'snmp-ok', ip: '10.10.30.10', hasSnmp: true },
    { nodeId: 'b', label: 'ping-ok', ip: '10.10.30.11', hasSnmp: false },
  ] };
  const snmp = { observedMacs: [], responded: { a: true }, presentNodeIds: { b: true }, fdbObserved: true,
                 observedSubnets: [], fdbSubnets: ['192.168.1'] };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.unverified, 0, 'entrambi hanno un segnale di presenza');
  assert.equal(r.counts.macOrphan, 0);
});

test('presenza onesta: reachabilityChecked ma nessuna prova di assenza → grigio (non rosso)', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:43', label: 'x', nodeId: 'x', ip: '10.20.0.1' }] };
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true, presentNodeIds: {} };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'sweep senza prova di assenza per x → non-verificabile');
  assert.equal(r.counts.unverified, 1);
});

test('unverified ignorabile: la key unver: rispetta la lista ignores', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:44', label: 'y', nodeId: 'y', ip: '10.30.0.7' }] };
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true,
                 presentNodeIds: {}, observedSubnets: ['192.168.1'] };
  // key = `unver:<nodeId>:<mac>` (il nodeId disambigua i MAC condivisi VRRP/HSRP).
  const r = buildDriftReport(snmp, doc, ['unver:y:aa:bb:cc:00:00:44'], {});
  assert.equal(r.counts.unverified, 0, 'riga unverified soppressa via ignores');
});

test('macOrphan/unverified: chiave con nodeId → due nodi con lo STESSO MAC non collidono', () => {
  // due device documentati che condividono lo stesso MAC (VRRP/HSRP virtuale o errore doc)
  const doc = { macs: [
    { mac: 'AA:BB:CC:00:00:99', label: 'rtr-a', nodeId: 'rtrA', ip: '10.0.0.1' },
    { mac: 'AA:BB:CC:00:00:99', label: 'rtr-b', nodeId: 'rtrB', ip: '10.0.0.2' },
  ] };
  const snmp = { observedMacs: [], responded: {}, fdbObserved: false, reachabilityChecked: true, presentNodeIds: {} };
  const r = buildDriftReport(snmp, doc, [], {});
  const keys = r.unverified.map((x) => x.key);
  assert.equal(r.counts.unverified, 2, 'entrambi i nodi non-verificabili, contati separatamente');
  assert.notEqual(keys[0], keys[1], 'chiavi distinte: ignorarne uno non nasconde l\'altro');
  // ignorandone UNO, l\'altro resta
  const r2 = buildDriftReport(snmp, doc, [keys[0]], {});
  assert.equal(r2.counts.unverified, 1, 'ignorata una riga, l\'altra (stesso MAC, altro nodo) resta visibile');
});

test('presenza: doc-IP direttamente VIVO alla sweep (aliveIps) → presente, non assente nonostante la porta-down', () => {
  const doc = {
    macs: [{ mac: 'AA:BB:CC:00:00:77', label: 'srv', nodeId: 'srv', ip: '10.0.0.9' }],
    cables: [{ id: 'c1', src: 'sw-1', dst: 'srv-1' }],
  };
  // porta switch giù da >=N → trustAbsent su srv; MA il suo doc-IP pinga (aliveIps) → presente.
  const snmp = { observedMacs: [], responded: { sw: true }, presentNodeIds: {}, fdbObserved: true,
                 reachabilityChecked: true, portDownStreak: { 'sw-1': 3 }, aliveIps: ['10.0.0.9'], macAtIps: {} };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.macOrphan, 0, 'il doc-IP risponde alla sweep → presente, non assente (DRIFT-M6 simmetrico)');
});

test('cavo-fantasma: downStreakN=0 è clampato a 1 (uno streak 0 non fa maturare TUTTI i cavi)', () => {
  const doc = { cables: [{ id: 'c1', src: 'sw-1', dst: 'sw-2', label: 'A↔B' }], macs: [] };
  const snmp = { responded: {}, portDownStreak: {}, fdbObserved: true, reachabilityChecked: true };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 0 });
  assert.equal(r.counts.ghostCable, 0, 'con N clampato a 1, uno streak 0 NON è cavo fantasma');
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

test('multihoming: MAC vivo su 2 IP di cui uno È il documentato → niente ipChanged (S2.1)', () => {
  // Alias eth0:1 / dual-IP di NAS e stampanti: il primo IP enumerato dall'ARP
  // può essere l'alias — il documentato resta vivo sull'altro. Prima del fix
  // (macAtIp first-wins) usciva un falso "Cambio IP" persistente a ogni Verifica.
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:32', label: 'nas', nodeId: 'nas', ip: '192.168.1.50' }] };
  const snmp = { observedMacs: [], reachabilityChecked: true, fdbObserved: false, presentNodeIds: {},
                 macAtIp: { 'aa:bb:cc:00:00:32': '192.168.1.99' },                       // legacy: primo visto = l'alias
                 macAtIps: { 'aa:bb:cc:00:00:32': ['192.168.1.99', '192.168.1.50'] } };  // ma il doc-IP è vivo anche lui
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.ipChanged, 0, 'doc-IP tra gli IP vivi del MAC → nessun cambio IP');
  assert.equal(r.counts.macOrphan, 0, 'e il device è presente');
});

test('multihoming: MAC vivo su 2 IP, NESSUNO è il documentato → ipChanged col primo vivo (S2.1)', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:33', label: 'srv', nodeId: 'srv', ip: '192.168.1.50' }] };
  const snmp = { observedMacs: [], reachabilityChecked: true, fdbObserved: false, presentNodeIds: {},
                 macAtIps: { 'aa:bb:cc:00:00:33': ['192.168.1.60', '192.168.1.61'] } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.ipChanged, 1);
  assert.equal(r.ipChanged[0].newIp, '192.168.1.60');
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

// ── Fase 3: porta di accesso switch DOWN da >= N sync → rosso AUTORITATIVO ──
test('Fase 3: device cablato a porta switch DOWN da >= N sync → macOrphan (assenza autoritativa)', () => {
  // pc cablato a sw1-1; la porta sw1-1 è down da 3 sync (portDownStreak). pc non ha
  // alcun segnale positivo → assente: lo switch è autorevole sul link della sua porta.
  const doc = {
    macs: [{ mac: 'AA:BB:CC:00:00:50', label: 'pc-cablato', nodeId: 'pc', ip: '192.168.1.60' }],
    cables: [{ id: 'c1', label: 'pc→sw1', src: 'pc-1', dst: 'sw1-1' }],
  };
  const snmp = { observedMacs: [], responded: {}, fdbObserved: true, portDownStreak: { 'sw1-1': 3 } };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.macOrphan, 1, 'porta di accesso down da >= N → device assente');
  assert.equal(r.macOrphan[0].nodeId, 'pc');
  assert.equal(r.counts.unverified, 0);
});

test('Fase 3: porta down SOTTO soglia (streak < N) → NON assente (anti-flap dello streak)', () => {
  const doc = {
    macs: [{ mac: 'AA:BB:CC:00:00:51', label: 'pc', nodeId: 'pc', ip: '192.168.1.61' }],
    cables: [{ id: 'c1', src: 'pc-1', dst: 'sw1-1' }],
  };
  const snmp = { observedMacs: [], responded: {}, fdbObserved: true, portDownStreak: { 'sw1-1': 1 } };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.macOrphan, 0, 'un blip (streak<N) NON è ancora rosso');
  assert.equal(r.counts.unverified, 1, 'resta non-verificabile finché lo streak non matura');
});

test('Fase 3: device VISTO (segnale positivo) con porta down → resta VERDE (positive-first)', () => {
  const doc = {
    macs: [{ mac: 'AA:BB:CC:00:00:52', label: 'pc', nodeId: 'pc', ip: '192.168.1.62' }],
    cables: [{ id: 'c1', src: 'pc-1', dst: 'sw1-1' }],
  };
  // porta down MA il MAC è visto in FDB (es. altro uplink/LAG) → presente
  const snmp = { observedMacs: ['aa:bb:cc:00:00:52'], responded: {}, fdbObserved: true, portDownStreak: { 'sw1-1': 5 } };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.macOrphan, 0, 'un segnale positivo batte la porta down');
  assert.equal(r.counts.unverified, 0);
});

test('cavo fantasma: cavo DEDOTTO con porta down da >= N sync → ghostCable; sotto soglia → no', () => {
  const doc = {
    cables: [
      { id: 'c1', label: 'A→B', src: 'sw1-1', dst: 'sw2-1', autoLinked: true },   // dedotto, streak 3 → fantasma
      { id: 'c2', label: 'A→C', src: 'sw1-2', dst: 'sw3-1', autoLinked: true },   // dedotto, streak 1 → no
    ],
  };
  const snmp = { portDownStreak: { 'sw1-1': 3, 'sw2-1': 0, 'sw1-2': 1 } };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.ghostCable, 1);
  assert.equal(r.ghostCable[0].id, 'c1');
  assert.equal(r.ghostCable[0].downStreak, 3);
});

test('cavo fantasma: un cavo MANUALE su porta down NON è ghostCable (il nodo è down, non il cavo)', () => {
  // Riconciliazione col Proof-State: il dichiarato è legge — cablaggio != liveness.
  // La porta down si riflette sul NODO (presenza), non declassa il cavo manuale.
  const doc = { cables: [{ id: 'c1', label: 'A→B', src: 'sw1-1', dst: 'sw2-1' }] };   // niente autoLinked = manuale
  const snmp = { portDownStreak: { 'sw1-1': 5 } };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.ghostCable, 0, 'il manuale su porta down non è un «cavo fantasma»');
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

// ── IDENTITÀ HARDWARE (serial/model = apparato sostituito; firmware = informativo) ──
test('identità: serial dichiarato ≠ misurato → identityDrift azionabile (apparato sostituito)', () => {
  const doc = { identities: [{ nodeId: 'sw1', label: 'Core SW1', serialNumber: 'ABC123', model: 'C9300-24T' }] };
  const snmp = { responded: { 'sw1': true }, measuredIds: { 'sw1': { serialNumber: 'XYZ999', model: 'C9300-24T' } } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.identityDrift, 1, 'serial diverso = 1 azionabile');
  assert.equal(r.counts.identityFirmware, 0);
  const row = r.identityDrift[0];
  assert.equal(row.identity, true);
  assert.equal(row.nodeId, 'sw1');
  const serial = row.diffs.find(d => d.field === 'serialNumber');
  assert.equal(serial.kind, 'identity');
  assert.equal(serial.doc, 'ABC123');
  assert.equal(serial.real, 'XYZ999');
  assert.equal(row.patch.serialNumber, 'XYZ999', 'il patch adotta il misurato');
  // Entra nel banner come anomalia azionabile.
  assert.equal(driftBannerKind(r.counts, r), 'discrepancies');
});

test('identità: solo firmware diverso → riga informativa, NON azionabile, NON nel banner', () => {
  const doc = { identities: [{ nodeId: 'sw1', label: 'Core SW1', serialNumber: 'ABC123', firmwareVer: '16.12.01' }] };
  const snmp = { responded: { 'sw1': true }, measuredIds: { 'sw1': { serialNumber: 'ABC123', firmwareVer: '17.03.04' } } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.identityDrift, 0, 'nessuna anomalia azionabile');
  assert.equal(r.counts.identityFirmware, 1, 'una riga solo-firmware (informativa)');
  assert.equal(r.identityDrift[0].identity, false);
  assert.equal(r.identityDrift[0].diffs[0].kind, 'firmware');
  assert.equal(driftBannerKind(r.counts, r), 'aligned', 'il solo firmware NON allarma il banner');
});

test('identità: confronto solo se ENTRAMBI i lati non-vuoti + gate su responded', () => {
  // serial dichiarato ma non misurato (ENTITY-MIB muta su quel campo) → niente confronto
  const docNoReal = { identities: [{ nodeId: 'sw1', label: 'SW1', serialNumber: 'ABC123' }] };
  const snmpNoReal = { responded: { 'sw1': true }, measuredIds: { 'sw1': { serialNumber: '' } } };
  assert.equal(buildDriftReport(snmpNoReal, docNoReal, [], {}).counts.identityDrift, 0, 'misurato vuoto → non si smentisce');
  // device MUTO (non risponde): inventory stantìa → non valutato anche se diverso
  const snmpMuted = { responded: {}, measuredIds: { 'sw1': { serialNumber: 'XYZ999' } } };
  assert.equal(buildDriftReport(snmpMuted, docNoReal, [], {}).counts.identityDrift, 0, 'device muto → identità non valutata');
  // serial uguale (case/spazi diversi) → nessun falso positivo
  const docEq = { identities: [{ nodeId: 'sw1', label: 'SW1', serialNumber: ' abc123 ' }] };
  const snmpEq = { responded: { 'sw1': true }, measuredIds: { 'sw1': { serialNumber: 'ABC123' } } };
  assert.equal(buildDriftReport(snmpEq, docEq, [], {}).counts.identityDrift, 0, 'trim+case-insensitive: stesso serial');
});

test('identità: serial + firmware insieme (RMA) → un ROW azionabile con entrambi i diff', () => {
  const doc = { identities: [{ nodeId: 'fw1', label: 'FW1', serialNumber: 'OLD1', firmwareVer: '7.0' }] };
  const snmp = { responded: { 'fw1': true }, measuredIds: { 'fw1': { serialNumber: 'NEW2', firmwareVer: '7.4' } } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.identityDrift, 1, 'un solo device = una riga');
  assert.equal(r.counts.identityFirmware, 0, 'ha un diff identity → non conta come solo-firmware');
  const row = r.identityDrift[0];
  assert.equal(row.identity, true);
  assert.deepEqual(row.diffs.map(d => d.field).sort(), ['firmwareVer', 'serialNumber']);
});

test('identità: la riga ignorata segue la condizione (fingerprint sul valore reale)', () => {
  const doc = { identities: [{ nodeId: 'sw1', label: 'SW1', serialNumber: 'ABC' }] };
  const snmpA = { responded: { 'sw1': true }, measuredIds: { 'sw1': { serialNumber: 'X1' } } };
  const keyA = buildDriftReport(snmpA, doc, [], {}).identityDrift[0].key;
  assert.equal(buildDriftReport(snmpA, doc, [keyA], {}).counts.identityDrift, 0, 'stessa condizione → ignorata');
  const snmpB = { responded: { 'sw1': true }, measuredIds: { 'sw1': { serialNumber: 'X2' } } };
  assert.equal(buildDriftReport(snmpB, doc, [keyA], {}).counts.identityDrift, 1, 'realtà diversa → nuova key → riappare');
});

// ---- AUDIT 2026-08-13: fix F2 (chiave ipchg con nodeId + nuovo-IP) ----------
test('cambio IP: la chiave ipchg porta nodeId E nuovo-IP (no ignore permanente, no collisione VRRP)', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:30', label: 'srv', nodeId: 'srv1', ip: '192.168.1.50' }] };
  const snmp = { observedMacs: [], reachabilityChecked: true, fdbObserved: false, presentNodeIds: {},
                 macAtIp: { 'aa:bb:cc:00:00:30': '192.168.1.60' } };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.ipChanged[0].key, 'ipchg:srv1:192.168.1.60',
    'la chiave include il nodeId (disambigua i MAC VRRP condivisi) e il nuovo-IP (fingerprint della condizione)');
  // Due nodi con lo STESSO MAC (VRRP) e doc-IP stantii → chiavi DIVERSE (no collisione)
  const doc2 = { macs: [
    { mac: 'AA:BB:CC:00:00:99', label: 'a', nodeId: 'rtA', ip: '10.0.0.2' },
    { mac: 'AA:BB:CC:00:00:99', label: 'b', nodeId: 'rtB', ip: '10.0.0.3' },
  ] };
  const snmp2 = { observedMacs: [], reachabilityChecked: true, fdbObserved: false, presentNodeIds: {},
                  macAtIp: { 'aa:bb:cc:00:00:99': '10.0.0.9' } };
  const r2 = buildDriftReport(snmp2, doc2, [], {});
  const keys = new Set(r2.ipChanged.map((x) => x.key));
  assert.equal(keys.size, r2.ipChanged.length, 'chiavi distinte per nodo, anche con MAC condiviso');
});

// ── F7: la presenza non può dipendere dai separatori del MAC ────────────────
// Documentato e misurato venivano confrontati con un `.toLowerCase()` nudo su
// entrambi i lati: regge finché OGNI fonte emette la forma con i due punti. Il
// giorno in cui una fonte usa altri separatori (incolla ARP di Windows
// `AA-BB-CC-…`, un driver lease, la forma Cisco), il documentato non incontra
// più il misurato → il device risulta ASSENTE pur essendo lì. Qui l'assenza è
// POSSIBILE (trustAbsentNodeIds), quindi il test discrimina davvero.
test('F7: un MAC osservato coi trattini riconosce il documentato coi due punti', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:01', label: 'sw1', nodeId: 'sw1' }] };
  const snmp = {
    observedMacs: ['AA-BB-CC-00-00-01'],            // stessa scheda, altra scrittura
    fdbObserved: true, responded: {}, trustAbsentNodeIds: { sw1: true },
  };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'è presente: nessun falso «assente» per un separatore');
});

test('F7: vale anche per la forma Cisco a punti', () => {
  const doc = { macs: [{ mac: 'aabb.ccdd.eeff', label: 'ap1', nodeId: 'ap1' }] };
  const snmp = {
    observedMacs: ['AA:BB:CC:DD:EE:FF'],
    fdbObserved: true, responded: {}, trustAbsentNodeIds: { ap1: true },
  };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 0, 'documentato in forma Cisco, misurato coi due punti: stesso device');
});

test('F7: un MAC davvero diverso resta assente (il fix non rende tutto uguale)', () => {
  const doc = { macs: [{ mac: 'AA:BB:CC:00:00:01', label: 'sw1', nodeId: 'sw1' }] };
  const snmp = {
    observedMacs: ['DE-AD-BE-EF-00-99'],
    fdbObserved: true, responded: {}, trustAbsentNodeIds: { sw1: true },
  };
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(r.counts.macOrphan, 1, 'assenza reale: sempre segnalata');
});

// ── Cavi su porta SPENTA A MANO (shutCable) ────────────────────────────────
// Il verso opposto del «cavo fantasma»: lì il cavo DEDOTTO perde l'evidenza che lo
// reggeva, qui il cavo c'è davvero (l'hai visto tu) ma qualcuno ha chiuso la porta
// sotto — due DICHIARAZIONI che si contraddicono, la tua e quella scritta
// sull'apparato. Di solito: apparato dismesso, documento che non lo sa ancora.
test('cavo DICHIARATO su porta in shutdown → shutCable', () => {
  const doc = { cables: [{ id: 'c1', label: 'sw1↔srv', src: 'sw1-1', dst: 'srv-1' }] };   // niente autoLinked = manuale
  const snmp = { portAdminDown: { 'sw1-1': true } };
  const r = buildDriftReport(snmp, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.shutCable, 1);
  assert.equal(r.shutCable[0].id, 'c1');
  assert.deepEqual(r.shutCable[0].ports, ['sw1-1'], 'dice QUALE estremo è chiuso');
});

test('il cavo DEDOTTO non entra in shutCable: se la porta è chiusa il link non si forma', () => {
  // Lo copre già ghostCable via lo streak — contarlo due volte sarebbe raccontare
  // lo stesso fatto in due righe che l'utente deve chiudere separatamente.
  const doc = { cables: [{ id: 'c1', src: 'sw1-1', dst: 'srv-1', autoLinked: true }] };
  const r = buildDriftReport({ portAdminDown: { 'sw1-1': true } }, doc, [], { downStreakN: 3 });
  assert.equal(r.counts.shutCable, 0);
});

test('shutCable: senza misura non si inventa niente (assenza ≠ porta accesa)', () => {
  const doc = { cables: [{ id: 'c1', src: 'sw1-1', dst: 'srv-1' }] };
  assert.equal(buildDriftReport({}, doc, [], {}).counts.shutCable, 0);
  assert.equal(buildDriftReport({ portAdminDown: {} }, doc, [], {}).counts.shutCable, 0);
});

test('shutCable è ignorabile come le altre categorie', () => {
  const doc = { cables: [{ id: 'c1', src: 'sw1-1', dst: 'srv-1' }] };
  const snmp = { portAdminDown: { 'sw1-1': true } };
  const r = buildDriftReport(snmp, doc, ['shut:c1'], { downStreakN: 3 });
  assert.equal(r.counts.shutCable, 0, 'la riga ignorata sparisce dal conteggio');
});

test('shutCable vede anche l\'estremo DST, non solo il src', () => {
  const doc = { cables: [{ id: 'c1', src: 'sw1-1', dst: 'sw2-9' }] };
  const r = buildDriftReport({ portAdminDown: { 'sw2-9': true } }, doc, [], {});
  assert.equal(r.counts.shutCable, 1);
  assert.deepEqual(r.shutCable[0].ports, ['sw2-9']);
});
