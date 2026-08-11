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
