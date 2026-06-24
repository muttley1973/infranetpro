'use strict';
// ============================================================
// SKINS-STORE — test degli helper PURI dello skin store (slug, id univoco,
// upsert/rimozione su indice). La parte fs (saveSkin/deleteSkin) è esercitata
// a runtime nella verifica end-to-end, qui restiamo sui puri.
const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/skins-store');

test('slug: normalizza, toglie accenti, collassa separatori', () => {
  assert.equal(store.slug('Cisco Catalyst 2960-24'), 'cisco-catalyst-2960-24');
  assert.equal(store.slug('Però è  così!!'), 'pero-e-cosi');
  assert.equal(store.slug(''), 'skin');
  assert.equal(store.slug(null), 'skin');
});

test('makeSkinId: deduplica con suffisso incrementale', () => {
  assert.equal(store.makeSkinId('SW Mini', []), 'sw-mini');
  assert.equal(store.makeSkinId('SW Mini', ['sw-mini']), 'sw-mini-2');
  assert.equal(store.makeSkinId('SW Mini', ['sw-mini', 'sw-mini-2']), 'sw-mini-3');
});

test('addToIndex: upsert per id (sostituisce, non duplica)', () => {
  let arr = [];
  arr = store.addToIndex(arr, { id: 'a', name: 'A' });
  arr = store.addToIndex(arr, { id: 'b', name: 'B' });
  assert.equal(arr.length, 2);
  arr = store.addToIndex(arr, { id: 'a', name: 'A2' });
  assert.equal(arr.length, 2, 'stesso id non duplica');
  assert.equal(arr.find(x => x.id === 'a').name, 'A2', 'sostituito');
});

test('removeFromIndex: toglie per id', () => {
  const arr = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = store.removeFromIndex(arr, 'b');
  assert.deepEqual(out.map(x => x.id), ['a', 'c']);
  assert.equal(store.removeFromIndex(arr, 'zzz').length, 3, 'id assente: invariato');
});
