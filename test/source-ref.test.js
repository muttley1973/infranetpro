'use strict';
// ============================================================
// RIFERIMENTO ALL'ORIGINE — test di lib/source-ref.js.
// Le invarianti che lo rendono utilizzabile per una scrittura futura:
//   * un riferimento a metà NON si costruisce e NON si scrive (sembrerebbe un
//     aggancio e non lo sarebbe);
//   * il tipo è un vocabolario CHIUSO: un tipo inventato non passa;
//   * due `null` non sono «lo stesso oggetto» — è la trappola che farebbe
//     coincidere tutto ciò che è stato scritto a mano;
//   * ⭐ i NOMI DEI CAMPI li conosce solo la lib: chi legge vede sempre la stessa
//     forma `{objectType, objectId}`, e la forma compatta sul disco resta un
//     dettaglio interno. È ciò che permette di cambiarla senza rincorrere i
//     chiamanti — la ragione per cui esiste questo file invece di un campo a mano.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const {
  OBJECT_TYPES, REF_FIELDS, makeRef, setRef, refOf, refsOf, refOfType, refKey, sameRef, indexByRef,
} = require('../lib/source-ref.js');

test('setRef scrive COMPATTO, refOf rilegge nella forma piena', () => {
  const port = { ifName: 'Gi0/1' };
  assert.strictEqual(setRef(port, OBJECT_TYPES.interface, 1000), true);
  // sul disco: una chiave e un numero, non un oggetto annidato
  assert.strictEqual(port.srcIf, 1000);
  assert.strictEqual(typeof port.srcIf, 'number');
  // in lettura: la forma che vedono tutti i chiamanti
  assert.deepStrictEqual(refOf(port), { objectType: 'dcim.interface', objectId: 1000 });
});

test('il costo su disco è quello per cui si è scelta questa forma', () => {
  const compatto = JSON.stringify({ srcIf: 1000 }).length;          // {"srcIf":1000}
  const pieno = JSON.stringify({ source: { objectType: 'dcim.interface', objectId: 1000 } }).length;
  assert.ok(compatto * 3 < pieno,
    'la forma compatta deve costare meno di un terzo: e\' l\'unica ragione per cui non e\' leggibile a occhio');
});

test('makeRef/setRef rifiutano cio che non punta a niente', () => {
  assert.strictEqual(makeRef(OBJECT_TYPES.interface, null), null);
  assert.strictEqual(makeRef(OBJECT_TYPES.interface, ''), null);
  assert.strictEqual(makeRef(OBJECT_TYPES.interface, 'abc'), null);
  assert.strictEqual(makeRef('dcim.banana', 1), null, 'vocabolario chiuso');
  assert.strictEqual(makeRef('interface', 1), null, 'la forma breve non e\' quella del DCIM');
  // e soprattutto: NON si scrive niente sull'oggetto
  const p = {};
  assert.strictEqual(setRef(p, OBJECT_TYPES.interface, null), false);
  assert.deepStrictEqual(p, {});
  assert.strictEqual(setRef(null, OBJECT_TYPES.interface, 1), false);
});

test('l\'id arriva come stringa da un JSON e si normalizza a numero', () => {
  const r = {};
  setRef(r, OBJECT_TYPES.rack, '30');
  assert.strictEqual(r.srcRack, 30);
  assert.deepStrictEqual(refOf(r), { objectType: 'dcim.rack', objectId: 30 });
});

test('uno slot di patch panel porta DUE riferimenti, e la precedenza e\' il front', () => {
  const slot = {};
  setRef(slot, OBJECT_TYPES.frontPort, 2000);
  setRef(slot, OBJECT_TYPES.rearPort, 3000);
  assert.deepStrictEqual(refOf(slot), { objectType: 'dcim.frontport', objectId: 2000 });
  assert.deepStrictEqual(refsOf(slot), [
    { objectType: 'dcim.frontport', objectId: 2000 },
    { objectType: 'dcim.rearport', objectId: 3000 },
  ]);
  assert.deepStrictEqual(refOfType(slot, OBJECT_TYPES.rearPort), { objectType: 'dcim.rearport', objectId: 3000 });
  assert.strictEqual(refOfType(slot, OBJECT_TYPES.device), null);
});

test('refOf non si fa ingannare da cio che riferimento non e\'', () => {
  assert.strictEqual(refOf({}), null, 'scritto a mano: nessun riferimento');
  assert.strictEqual(refOf(null), null);
  // il vecchio blocco DCIM del nodo NON e' un riferimento
  assert.strictEqual(refOf({ source: { tenant: 'Acme', status: 'active' } }), null);
  assert.strictEqual(refOf({ srcIf: 'non un numero' }), null);
  assert.deepStrictEqual(refsOf({}), []);
});

test('refKey e sameRef: due null NON sono lo stesso oggetto', () => {
  const a = makeRef(OBJECT_TYPES.device, 42);
  const c = makeRef(OBJECT_TYPES.rack, 42);   // stesso numero, altro tipo
  assert.strictEqual(refKey(a), 'dcim.device#42');
  assert.ok(sameRef(a, makeRef(OBJECT_TYPES.device, 42)));
  assert.ok(!sameRef(a, c), 'il tipo fa parte dell\'identita\'');
  assert.ok(!sameRef(null, null), 'e\' la trappola che appaierebbe tutto il lavoro a mano');
  assert.strictEqual(refKey(null), '');
});

test('indexByRef lascia fuori chi non ha un riferimento', () => {
  const idx = indexByRef([
    { id: 'a', srcRack: 1 },
    { id: 'b' },                 // scritto a mano
    { id: 'c', srcRack: 2 },
    null,
  ]);
  assert.strictEqual(idx.size, 2);
  assert.strictEqual(idx.get('dcim.rack#1').id, 'a');
  assert.strictEqual(indexByRef(null).size, 0);
});

test('i nomi dei campi sono elencati una volta sola, per chi deve ispezionare', () => {
  assert.ok(REF_FIELDS.includes('srcIf') && REF_FIELDS.includes('srcRack'));
  assert.strictEqual(new Set(REF_FIELDS).size, REF_FIELDS.length, 'nessun nome ripetuto');
  // ogni tipo del vocabolario ha il suo campo, e viceversa
  assert.strictEqual(Object.keys(OBJECT_TYPES).length, REF_FIELDS.length);
});

test('la lib e PURA su cio che LEGGE (setRef scrive, ed e\' il suo mestiere)', () => {
  const o = { id: 'x', srcIf: 9 };
  const copia = JSON.parse(JSON.stringify(o));
  refOf(o); refsOf(o); refKey(refOf(o)); indexByRef([o]);
  assert.deepStrictEqual(o, copia);
});
