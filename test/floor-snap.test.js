const test = require('node:test');
const assert = require('node:assert/strict');
const { FLOOR_SNAP_STEP, snapFloor, snapFloorPoint } = require('../lib/floor-snap.js');

test('griglia visibile: aggancia al passo', () => {
  assert.equal(FLOOR_SNAP_STEP, 20);
  assert.equal(snapFloor(0, false), 0);
  assert.equal(snapFloor(9, false), 0);
  assert.equal(snapFloor(11, false), 20);
  assert.equal(snapFloor(207, false), 200);
  assert.equal(snapFloor(-11, false), -20);
});

test('griglia nascosta: libero al pixel', () => {
  // La promessa del manuale: nascondere la griglia libera il posizionamento.
  assert.equal(snapFloor(207, true), 207);
  assert.equal(snapFloor(9, true), 9);
  assert.equal(snapFloor(-11, true), -11);
  assert.equal(snapFloor(207.4, true), 207);   // resta intero: le coordinate del documento lo sono
});

test('lo stesso punto cambia esito col solo interruttore', () => {
  // Invariante che il difetto violava: nessun chiamante puo' agganciare
  // quando la griglia e' spenta.
  const v = 207;
  assert.notEqual(snapFloor(v, false), snapFloor(v, true));
  assert.equal(snapFloor(v, false) % FLOOR_SNAP_STEP, 0);
});

test('gridHidden undefined = griglia visibile (progetti senza il campo)', () => {
  // gridHidden non e' scritto finche' non lo tocchi: l'assenza vale "visibile".
  assert.equal(snapFloor(207, undefined), 200);
  assert.equal(snapFloor(207, null), 200);
});

test('valori non finiti non entrano nel documento', () => {
  assert.equal(snapFloor(NaN, false), 0);
  assert.equal(snapFloor(Infinity, true), 0);
  assert.equal(snapFloor(undefined, false), 0);
});

test('snapFloorPoint aggancia le due coordinate con la stessa regola', () => {
  assert.deepEqual(snapFloorPoint(207, 91, false), { x: 200, y: 100 });
  assert.deepEqual(snapFloorPoint(207, 91, true), { x: 207, y: 91 });
});
