'use strict';
// Test del capitolo PURO "Alimentazione / PDU" (lib/pdu-report.js): dai nodi PDU
// alle righe delle due tabelle del report. Nessun DOM: la composizione vive nel
// server proprio per essere verificabile qui a tavolino.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPduReport, pduSummaryRow, pduOutletRows, outletLabel, connectionSource } = require('../lib/pdu-report.js');

const _pduB = () => ({
  id: 'pdu-b', name: 'PDU-B', rackName: 'R105', rackU: 1, brand: 'APC', model: 'AP8853',
  ip: '10.0.0.9',
  spec: { pduType: 'switched', pduPhase: 'single', pduCurrentA: 16, pduMgmtMode: 'ethernet-serial', pduOutletCount: 4 },
  powerOutlets: [
    { name: 'Outlet 1', status: 'enabled', connectedTo: { deviceName: 'Server-01', name: 'PSU-1' } },
    { name: 'Outlet 2', status: 'enabled', connectionOvr: { deviceId: 'sw1', deviceName: 'Switch-A' } },
    { name: 'Outlet 3', status: 'Faulty' },
    { name: 'Outlet 4', statusOvr: 'inactive' },
  ],
});

test('riepilogo PDU: conteggi e campi dichiarati', () => {
  const s = pduSummaryRow(_pduB());
  assert.equal(s.name, 'PDU-B');
  assert.equal(s.rackName, 'R105');
  assert.equal(s.pduType, 'switched');
  assert.equal(s.currentA, 16);
  assert.equal(s.mgmtMode, 'ethernet-serial');
  assert.equal(s.outletsTotal, 4);
  assert.equal(s.outletsActive, 2, 'due prese attive (una importata, una forzata a mano)');
  assert.equal(s.outletsFault, 1);
  assert.equal(s.outletsPowered, 2, 'due prese alimentano davvero un apparato');
  assert.equal(s.outletsFree, 2, 'guasta + inattiva senza carico = libere');
  assert.equal(s.outletsDetailed, true);
});

// I campi PDU vivono in node.spec[...]: chi legge deve usare il getter spec-aware.
// Un progetto vecchio li ha al livello nodo — devono valere entrambi, o metà dei
// progetti stamperebbe una riga di trattini.
test('riepilogo PDU: legge i campi sia da spec sia dal livello nodo (progetti vecchi)', () => {
  const viaSpec = pduSummaryRow({ id: 'p', spec: { pduType: 'metered', pduCurrentA: 32 } });
  const viaNode = pduSummaryRow({ id: 'p', pduType: 'metered', pduCurrentA: 32 });
  assert.equal(viaSpec.pduType, 'metered');
  assert.equal(viaNode.pduType, 'metered', 'campo al livello nodo (progetto pre-spec) NON deve sparire');
  assert.equal(viaNode.currentA, 32);
});

// ⚠️ Paletto no-invenzioni: un dato assente è '-' a stampa, mai uno zero. Uno zero
// afferma «misurato zero» — qui sarebbe un'affermazione inventata.
test('onestà: i campi non dichiarati restano null, mai zero', () => {
  const s = pduSummaryRow({ id: 'x', name: 'PDU-X' });
  assert.equal(s.currentA, null);
  assert.equal(s.phase, null);
  assert.equal(s.pduType, null);
  assert.equal(s.rackName, null);
  assert.equal(s.ip, null);
});

test('onestà: un PDU che dichiara le prese ma non le elenca non è «zero prese libere»', () => {
  const s = pduSummaryRow({ id: 'a', name: 'PDU-A', spec: { pduOutletCount: 8 } });
  assert.equal(s.outletsTotal, 8, 'il numero dichiarato si stampa comunque');
  assert.equal(s.outletsFree, null, 'quante siano libere NON lo sappiamo');
  assert.equal(s.outletsDetailed, false, 'il report deve poterlo dire al lettore');
});

test('righe presa: stato, apparato alimentato e provenienza', () => {
  const rows = pduOutletRows(_pduB());
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map(r => [r.label, r.status, r.deviceName, r.source]),
    [
      ['Outlet 1', 'active', 'Server-01', 'imported'],
      ['Outlet 2', 'active', 'Switch-A', 'manual'],
      ['Outlet 3', 'fault', null, ''],
      ['Outlet 4', 'inactive', null, ''],
    ],
  );
  assert.equal(rows[0].portName, 'PSU-1');
  assert.equal(rows[0].rawStatus, 'enabled', 'la parola originale della fonte resta leggibile');
});

// Il gruppo e' la meta' che conta di un UPS: dice chi resta acceso quando manca
// la corrente. Sul dossier deve arrivare sia sulla presa (che gruppo e') sia
// nella scheda (che gruppi esistono, e come sono fatti).
test('dossier: il gruppo arriva sulla presa e nella scheda', () => {
  const ups = {
    id: 'ups1', name: 'UPS-Sala', type: 'ups',
    powerGroups: [
      { id: 'g1', name: 'Critici', switching: 'always', backup: 'battery' },
      { id: 'g2', name: 'Sacrificabili', switching: 'switched', backup: 'battery' },
      { id: 'g3', name: 'Stampanti', switching: 'switched', backup: 'surge' },
    ],
    powerOutlets: [
      { name: 'Outlet 1', groupOvr: 'g1' },
      { name: 'Outlet 2', groupOvr: 'g1' },
      { name: 'Outlet 3', groupOvr: 'g2' },
      { name: 'Outlet 4' },
    ],
  };
  const rows = pduOutletRows(ups);
  assert.deepEqual(rows.map(r => r.group), ['Critici', 'Critici', 'Sacrificabili', null],
    'una presa non assegnata dice null, non un gruppo di comodo');

  const s = pduSummaryRow(ups);
  assert.deepEqual(s.groups, [
    { name: 'Critici', switching: 'always', backup: 'battery', outlets: 2 },
    { name: 'Sacrificabili', switching: 'switched', backup: 'battery', outlets: 1 },
    { name: 'Stampanti', switching: 'switched', backup: 'surge', outlets: 0 },
  ], 'un gruppo dichiarato e ancora vuoto resta in elenco: nasconderlo lo farebbe sembrare mai creato');
});

test('dossier: senza gruppi dichiarati non si inventa nulla', () => {
  const rows = pduOutletRows(_pduB());
  assert.deepEqual([...new Set(rows.map(r => r.group))], [null]);
  assert.deepEqual(pduSummaryRow(_pduB()).groups, []);
});

test('etichetta presa: nome dichiarato, altrimenti il progressivo', () => {
  assert.equal(outletLabel({ name: 'C13-3' }, 0), 'C13-3');
  assert.equal(outletLabel({}, 4), '5');
  assert.equal(outletLabel(null, 0), '1');
});

test('provenienza: manuale batte importato, nessuna se la presa non alimenta nulla', () => {
  assert.equal(connectionSource({ manual: true, imported: true }), 'manual');
  assert.equal(connectionSource({ imported: true }), 'imported');
  assert.equal(connectionSource({}), '');
  assert.equal(connectionSource(null), '');
});

test('capitolo completo: ordine di lettura per rack/unità e totali onesti', () => {
  const r = buildPduReport({ pdus: [
    _pduB(),
    { id: 'pdu-a', name: 'PDU-A', rackName: 'R105', rackU: 2, spec: { pduOutletCount: 8 } },
  ] });
  assert.deepEqual(r.summary.map(s => s.name), ['PDU-A', 'PDU-B'], 'dall alto del rack verso il basso');
  assert.equal(r.totals.pdus, 2);
  assert.equal(r.totals.outlets, 4);
  assert.equal(r.totals.active, 2);
  assert.equal(r.totals.fault, 1);
  assert.equal(r.totals.powered, 2);
  // Il PDU senza elenco prese NON contribuisce con uno zero al totale delle libere.
  assert.equal(r.totals.free, 2);
  assert.equal(r.outlets.length, 4, 'le prese seguono l ordine dei PDU del riepilogo');
});

test('capitolo completo: input assente o vuoto non lancia e non inventa righe', () => {
  for (const input of [undefined, {}, { pdus: null }, { pdus: [] }, { pdus: [null] }]) {
    const r = buildPduReport(input);
    assert.deepEqual(r.summary, []);
    assert.deepEqual(r.outlets, []);
    assert.equal(r.totals.pdus, 0);
    assert.equal(r.totals.free, null, 'senza PDU dettagliate la capacità residua è ignota, non zero');
  }
});

// ── Campi di RIPRISTINO: quello che serve per rimettere in servizio una PDU ──
test('scheda di ripristino: identità, posizione, alimentazione in ingresso, backup', () => {
  const s = pduSummaryRow({
    id: 'p1', name: 'PDU-1', rackName: 'R1', rackU: 3, sizeU: 1,
    brand: 'APC', model: 'AP8853', serialNumber: 'SN-123', firmwareVer: '6.8.2',
    assetTag: 'AST-9', warrantyUntil: '2028-01-31', mac: 'AA:BB:CC:00:00:01',
    notes: 'Alimenta il rack A', backup: { ref: 'git://cfg/pdu1', method: 'scp', at: '2026-08-01' },
    integration: { host: '10.0.0.5', driver: 'snmp-v2c' },
    pduPowerPorts: [{ name: 'Input', type: 'iec-60320-c14', connectedTo: { deviceName: 'UPS-1', name: 'Out-3' } }],
    spec: { pduSensorPorts: 1, pduUsbPorts: 2, pduExpansionPorts: 1 },
  });
  assert.equal(s.serial, 'SN-123');
  assert.equal(s.firmware, '6.8.2');
  assert.equal(s.assetTag, 'AST-9');
  assert.equal(s.warrantyUntil, '2028-01-31');
  assert.equal(s.mac, 'AA:BB:CC:00:00:01');
  assert.equal(s.sizeU, 1);
  assert.equal(s.driver, 'snmp-v2c');
  assert.equal(s.backupRef, 'git://cfg/pdu1');
  assert.equal(s.backupMethod, 'scp');
  assert.equal(s.notes, 'Alimenta il rack A');
  assert.equal(s.sensorPorts, 1);
  assert.equal(s.usbPorts, 2);
  assert.equal(s.expansionPorts, 1);
  assert.deepEqual(s.feeds, [{ name: 'Input', type: 'iec-60320-c14', source: 'UPS-1', sourcePort: 'Out-3' }],
    'da DOVE arriva la corrente: la prima cosa che serve per ricollegarla');
});

// Manual-first: la matricola SCRITTA a mano vince sulla misura ENTITY-MIB; la
// misura però copre il buco quando nessuno l'ha scritta.
test('scheda: il dichiarato batte la misura, la misura copre il buco', () => {
  const dich = pduSummaryRow({ id: 'p', serialNumber: 'SCRITTA', integration: { inventory: { serialNumber: 'MISURATA' } } });
  assert.equal(dich.serial, 'SCRITTA');
  const solaMisura = pduSummaryRow({ id: 'p', integration: { inventory: { serialNumber: 'MISURATA', firmwareVer: '1.2' } } });
  assert.equal(solaMisura.serial, 'MISURATA');
  assert.equal(solaMisura.firmware, '1.2');
  assert.equal(pduSummaryRow({ id: 'p' }).serial, null, 'nessuna delle due → resta ignota');
});

test('scheda: nessuna alimentazione in ingresso dichiarata → lista vuota, non inventata', () => {
  assert.deepEqual(pduSummaryRow({ id: 'p' }).feeds, []);
  assert.deepEqual(pduSummaryRow({ id: 'p', pduPowerPorts: 'non-un-array' }).feeds, []);
});

// Il capitolo CHIESTO su un progetto senza PDU non deve sparire in silenzio: il
// builder restituisce comunque una struttura valida e il renderer stampa lo stato
// vuoto. Sparire lascerebbe il lettore a chiedersi se manchi per un errore.
test('capitolo chiesto senza PDU: struttura valida per lo stato vuoto', () => {
  const r = buildPduReport({ pdus: [] });
  assert.ok(Array.isArray(r.summary) && Array.isArray(r.outlets));
  assert.equal(r.totals.pdus, 0);
  assert.equal(r.totals.outlets, 0);
});
