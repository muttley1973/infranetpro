'use strict';
// ============================================================
// Drift delle VLAN TRASPORTATE: il dichiarato vince, la contraddizione si dice.
//
// Il caso, dal banco (2026-08-21): l'utente cambia `switchport trunk allowed
// vlan` sugli switch, il cavo nel documento porta ancora la lista di prima —
// scritta a mano, quindi manual-first la fa vincere ovunque, colore compreso.
// Nessuno confrontava le due liste: il documento restava indietro in silenzio e
// la fotografia continuava a mostrare l'elenco di ieri come se fosse di oggi.
//
// Le due metà stanno in due posti diversi, ed è il punto:
//   • DICHIARATA  → `link.trunkVlans` (il cavo, manual-first)
//   • MISURATA    → `ports[pid].trunkVlans` (la porta, scritta dal poll SNMP)
// Il confronto è per INSIEME: «20,10» e «10,20» sono lo stesso elenco.
const test = require('node:test');
const assert = require('node:assert');
const { buildDocSnapshot, buildSnmpSnapshot } = require('../lib/drift-snapshot.js');
const { buildDriftReport } = require('../lib/drift-report.js');

/** Scenario minimo: un cavo fra due switch, con le due liste che decidiamo noi. */
function scena({ dichiarate, misurate, mode, isTrunk = true }) {
  const nodes = [
    { id: 'sw1', type: 'switch', name: 'SW-CORE', ip: '10.10.99.1' },
    { id: 'sw2', type: 'switch', name: 'SW-ACC1', ip: '10.10.99.11' },
  ];
  const links = [{ id: 'l1', src: 'sw1-2', dst: 'sw2-2', mode, trunkVlans: dichiarate }];
  const ports = {
    'sw1-2': { ifName: 'Gi0/1', status: 'active', isTrunk, trunkVlans: misurate },
    'sw2-2': { ifName: 'Gi0/1', status: 'active', isTrunk, trunkVlans: misurate },
  };
  const doc = buildDocSnapshot({ nodes, links, ports, portLabel: p => p });
  const snmp = buildSnmpSnapshot({ nodes, docPorts: doc.ports, ports, fdb: {}, vlanCache: {} });
  snmp.responded = { sw1: true, sw2: true };
  return buildDriftReport(snmp, doc, [], {});
}

const trunkDiff = (r) => {
  const row = (r.stateDrift || []).find(x => (x.diffs || []).some(d => d.field === 'trunkVlans'));
  return row ? { row, diff: row.diffs.find(d => d.field === 'trunkVlans') } : null;
};

test('la lista dichiarata contraddetta dalla misura diventa una discrepanza', () => {
  const r = scena({ dichiarate: '10,20,30,99', misurate: [30], mode: 'trunk' });
  const t = trunkDiff(r);
  assert.ok(t, 'nessuna riga di drift sulle VLAN trasportate');
  assert.equal(t.diff.doc, '10,20,30,99');
  assert.equal(t.diff.real, '30');
});

test('ordine e forma di scrittura NON sono differenze', () => {
  // «20,10» dichiarato contro [10,20] misurato: stesso elenco, nessuna anomalia.
  assert.equal(trunkDiff(scena({ dichiarate: '20,10', misurate: [10, 20], mode: 'trunk' })), null);
  // e un range scritto in forma compatta è lo stesso elenco degli id espansi
  assert.equal(trunkDiff(scena({ dichiarate: '10-12', misurate: [10, 11, 12], mode: 'trunk' })), null);
});

test('un lato assente non produce mai una discrepanza', () => {
  // niente dichiarato: il cavo non afferma nulla, non c'è niente da contraddire
  assert.equal(trunkDiff(scena({ dichiarate: '', misurate: [30], mode: 'trunk' })), null);
  // niente misurato: l'apparato tace, e il silenzio non smentisce una dichiarazione
  assert.equal(trunkDiff(scena({ dichiarate: '10,20', misurate: [], mode: 'trunk' })), null);
});

test('la porta che l\'apparato NON dichiara trunk resta fuori dal confronto', () => {
  // Su certi vendor la colonna delle VLAN permesse resta popolata su una access,
  // dove non descrive niente: confrontarla inventerebbe una discrepanza.
  assert.equal(trunkDiff(scena({ dichiarate: '10,20', misurate: [30], mode: 'trunk', isTrunk: false })), null);
});

test('un cavo forzato ad ACCESS a mano non si confronta come trunk', () => {
  assert.equal(trunkDiff(scena({ dichiarate: '10,20', misurate: [30], mode: 'access' })), null);
});

test('la riga porta con sé DOVE si scrive se si adotta la realta\': il cavo', () => {
  const t = trunkDiff(scena({ dichiarate: '10,20,30,99', misurate: [30], mode: 'trunk' }));
  assert.equal(t.row.patch.linkId, 'l1', 'la dichiarazione vive sul cavo, non sulla porta');
  assert.equal(t.row.patch.trunkVlans, '30');
});

test('la chiave segue la CONDIZIONE: se la realta\' cambia, un «ignora» decade', () => {
  const a = trunkDiff(scena({ dichiarate: '10,20,30,99', misurate: [30], mode: 'trunk' })).row.key;
  const b = trunkDiff(scena({ dichiarate: '10,20,30,99', misurate: [40], mode: 'trunk' })).row.key;
  assert.notEqual(a, b, 'due realta\' diverse non possono condividere la stessa soppressione');
});

test('entrambi i capi vengono valutati: un trunk sbagliato da UN lato solo si vede', () => {
  const nodes = [{ id: 'sw1', type: 'switch', name: 'A' }, { id: 'sw2', type: 'switch', name: 'B' }];
  const links = [{ id: 'l1', src: 'sw1-2', dst: 'sw2-2', mode: 'trunk', trunkVlans: '10,20' }];
  const ports = {
    'sw1-2': { ifName: 'Gi0/1', status: 'active', isTrunk: true, trunkVlans: [10, 20] },   // allineato
    'sw2-2': { ifName: 'Gi0/1', status: 'active', isTrunk: true, trunkVlans: [10] },       // manca la 20
  };
  const doc = buildDocSnapshot({ nodes, links, ports, portLabel: p => p });
  const snmp = buildSnmpSnapshot({ nodes, docPorts: doc.ports, ports, fdb: {}, vlanCache: {} });
  snmp.responded = { sw1: true, sw2: true };
  const r = buildDriftReport(snmp, doc, [], {});
  const righe = (r.stateDrift || []).filter(x => (x.diffs || []).some(d => d.field === 'trunkVlans'));
  assert.equal(righe.length, 1, 'una riga sola: il capo allineato non deve comparire');
  assert.equal(righe[0].pid, 'sw2-2');
});

test('un device MUTO non genera la discrepanza (non e\' valutabile)', () => {
  const nodes = [{ id: 'sw1', type: 'switch', name: 'A' }, { id: 'sw2', type: 'switch', name: 'B' }];
  const links = [{ id: 'l1', src: 'sw1-2', dst: 'sw2-2', mode: 'trunk', trunkVlans: '10,20' }];
  const ports = {
    'sw1-2': { ifName: 'Gi0/1', status: 'active', isTrunk: true, trunkVlans: [30] },
    'sw2-2': { ifName: 'Gi0/1', status: 'active', isTrunk: true, trunkVlans: [30] },
  };
  const doc = buildDocSnapshot({ nodes, links, ports, portLabel: p => p });
  const snmp = buildSnmpSnapshot({ nodes, docPorts: doc.ports, ports, fdb: {}, vlanCache: {} });
  snmp.responded = {};   // nessuno ha risposto a questo sync
  const r = buildDriftReport(snmp, doc, [], {});
  assert.equal(trunkDiff(r), null, 'con l\'apparato muto la «realta\'» e\' l\'ultimo ricordo, non una misura');
});
