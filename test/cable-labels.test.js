// Test per il builder puro delle righe etichetta cavo (lib/cable-labels.js).
const test   = require('node:test');
const assert = require('node:assert/strict');

const { buildCableLabelRows } = require('../lib/cable-labels.js');

// Helper di comodo: costruisce un model con nodi indicizzati per id-porta.
function mkModel(links, nodes = {}, opts = {}) {
  return {
    links,
    helpers: {
      nodeByPortId: pid => {
        // pid "sw1-24" → nodo "sw1"
        const nid = String(pid).split('-')[0];
        return nodes[nid];
      },
      cableAutoLabel: l => `AUTO(${l.src}->${l.dst})`,
      linkVlan: l => l.vlan || 0,
      vlanNames: opts.vlanNames || {},
    },
  };
}

test('una riga per link', () => {
  const rows = buildCableLabelRows(mkModel([
    { id: 'a', src: 'sw1-1', dst: 'pp1-1' },
    { id: 'b', src: 'sw1-2', dst: 'pp1-2' },
  ]));
  assert.equal(rows.length, 2);
});

test('label: usa l.label se presente, altrimenti cableAutoLabel', () => {
  const rows = buildCableLabelRows(mkModel([
    { id: 'a', src: 'sw1-1', dst: 'pp1-1', label: 'RUN-A12' },
    { id: 'b', src: 'sw1-2', dst: 'pp1-2' },
  ]));
  assert.equal(rows[0].label, 'RUN-A12');
  assert.equal(rows[1].label, 'AUTO(sw1-2->pp1-2)');
  // customLabel: SOLO l'etichetta a mano (vuota se assente) → nel CSV non duplica da/a
  assert.equal(rows[0].customLabel, 'RUN-A12');
  assert.equal(rows[1].customLabel, '');
});

test('from/to: nome nodo + numero porta, "?" se nodo mancante', () => {
  const nodes = { sw1: { name: 'Core-01' }, pp1: { name: 'Patch-A' } };
  const rows = buildCableLabelRows(mkModel(
    [{ id: 'a', src: 'sw1-24', dst: 'pp1-12' }], nodes));
  assert.equal(rows[0].from, 'Core-01 P24');
  assert.equal(rows[0].to,   'Patch-A P12');

  const orphan = buildCableLabelRows(mkModel(
    [{ id: 'b', src: 'ghost-3', dst: 'pp1-1' }], { pp1: { name: 'Patch-A' } }));
  assert.equal(orphan[0].from, '? P3');
});

test('porta multi-segmento nel pid (mgmt/sfp): suffisso completo', () => {
  const rows = buildCableLabelRows(mkModel(
    [{ id: 'a', src: 'sw1-mgmt-1', dst: 'sw2-sfp-2' }],
    { sw1: { name: 'A' }, sw2: { name: 'B' } }));
  assert.equal(rows[0].from, 'A Pmgmt-1');
  assert.equal(rows[0].to,   'B Psfp-2');
});

test('lengthM: numerico da lengthM, fallback su length, null se assente/NaN', () => {
  const rows = buildCableLabelRows(mkModel([
    { id: 'a', src: 'x-1', dst: 'y-1', lengthM: 12.5 },
    { id: 'b', src: 'x-2', dst: 'y-2', length: 25 },     // legacy
    { id: 'c', src: 'x-3', dst: 'y-3' },                  // assente
    { id: 'd', src: 'x-4', dst: 'y-4', lengthM: 'abc' },  // non numerico
  ]));
  assert.equal(rows[0].lengthM, 12.5);
  assert.equal(rows[1].lengthM, 25);
  assert.equal(rows[2].lengthM, null);
  assert.equal(rows[3].lengthM, null);
});

test('vlan: >1 popolata con nome, 1/0/assente → null', () => {
  const rows = buildCableLabelRows(mkModel([
    { id: 'a', src: 'x-1', dst: 'y-1', vlan: 10 },
    { id: 'b', src: 'x-2', dst: 'y-2', vlan: 1 },
    { id: 'c', src: 'x-3', dst: 'y-3' },
  ], {}, { vlanNames: { 10: 'Voce' } }));
  assert.equal(rows[0].vlan, 10);
  assert.equal(rows[0].vlanName, 'Voce');
  assert.equal(rows[1].vlan, null);
  assert.equal(rows[2].vlan, null);
  assert.equal(rows[2].vlanName, '');
});

test('color: l.color ha priorita, fallback colorOvr', () => {
  const rows = buildCableLabelRows(mkModel([
    { id: 'a', src: 'x-1', dst: 'y-1', color: '#0066cc' },
    { id: 'b', src: 'x-2', dst: 'y-2', colorOvr: '#ff0000' },
    { id: 'c', src: 'x-3', dst: 'y-3' },
  ]));
  assert.equal(rows[0].color, '#0066cc');
  assert.equal(rows[1].color, '#ff0000');
  assert.equal(rows[2].color, '');
});

test('campi cabling: cableType (fallback categoria), isPermanent, installedAt/By, notes', () => {
  const rows = buildCableLabelRows(mkModel([
    { id: 'a', src: 'x-1', dst: 'y-1', cableType: 'cat6a-ftp', isPermanent: true,
      installedAt: '2024-03-15', installedBy: 'Mario', notes: 'dorsale' },
    { id: 'b', src: 'x-2', dst: 'y-2', cableCategory: 'om4' },
  ]));
  assert.equal(rows[0].cableType, 'cat6a-ftp');
  assert.equal(rows[0].isPermanent, true);
  assert.equal(rows[0].installedAt, '2024-03-15');
  assert.equal(rows[0].installedBy, 'Mario');
  assert.equal(rows[0].notes, 'dorsale');
  assert.equal(rows[1].cableType, 'om4');     // fallback su cableCategory
  assert.equal(rows[1].isPermanent, false);
});

test('puro: non muta il model ne i link', () => {
  const links = [{ id: 'a', src: 'x-1', dst: 'y-1', label: 'L' }];
  const snapshot = JSON.stringify(links);
  buildCableLabelRows(mkModel(links));
  assert.equal(JSON.stringify(links), snapshot);
});

test('robusto: model vuoto / helper assenti → []', () => {
  assert.deepEqual(buildCableLabelRows(undefined), []);
  assert.deepEqual(buildCableLabelRows({}), []);
  assert.deepEqual(buildCableLabelRows({ links: [] }), []);
  // senza helpers: label cade su '' e from/to su "? Pn"
  const rows = buildCableLabelRows({ links: [{ id: 'a', src: 'x-1', dst: 'y-2' }] });
  assert.equal(rows[0].label, '');
  assert.equal(rows[0].from, '? P1');
});
