'use strict';
// Un identificatore e' un NOME, non un pezzo di HTML (lib/id-safety.js).
//
// L'interfaccia interpola gli id come valori di attributo (`data-lid="${l.id}"`,
// `<option value="${r.id}">`): un id come  "><img src=x onerror=…>  eseguiva codice nel
// browser di chiunque aprisse il progetto. Qui si prova la DIFESA D'INGRESSO — il fuzz nel
// browser (test/e2e/xss-fuzz.test.js) prova che davvero niente venga eseguito.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeId, findUnsafeIds, repairUnsafeIds } = require('../lib/id-safety.js');

const HOSTILE = '"><img src=x onerror=alert(1)>';

test('isSafeId: gli id che l\'app genera passano, il markup no', () => {
  for (const ok of ['sw1', 'rack_default', 'rack_mvbgh71zutu', 'l_mvbgh71zpj8', 'lx0', 'nb-lag-12', 'vm:sw1:vm2', 'a.b', 'x@y', 'a+b', '#1', 'rk-1']) {
    assert.equal(isSafeId(ok), true, ok);
  }
  for (const bad of [HOSTILE, 'a b', 'a"b', "a'b", 'a<b', 'a>b', 'a&b', 'a`b', 'a\\b', 'a\nb', '', 'x'.repeat(101), 5, null, undefined, {}, []]) {
    assert.equal(isSafeId(bad), false, JSON.stringify(bad));
  }
});

test('findUnsafeIds: dice QUALI campi, con il percorso, e non si lascia sommergere', () => {
  const st = { racks: [{ id: HOSTILE }, { id: 'ok' }], links: [{ id: 'a b' }],
               nodes: [{ id: 'sw1', vms: [{ id: '<x>' }] }, { id: '"' }] };
  const out = findUnsafeIds(st);
  assert.deepEqual(out.map(o => o.path).sort(), ['links[0].id', 'nodes[1].id', 'nodes[0].vms[0].id', 'racks[0].id'].sort());
  assert.ok(out.every(o => o.value.length <= 60), 'il valore ostile non rientra intero nei messaggi');
  const many = { racks: Array.from({ length: 500 }, () => ({ id: '<' })) };
  assert.equal(findUnsafeIds(many).length, 20, 'tetto di default');
  assert.equal(findUnsafeIds(many, 3).length, 3);
  assert.deepEqual(findUnsafeIds({ racks: [{ id: 'ok' }] }), []);
  assert.deepEqual(findUnsafeIds(null), []);
});

test('repairUnsafeIds: rinomina E riscrive i riferimenti — un id rinominato e basta scollega il progetto', () => {
  const st = {
    racks: [{ id: HOSTILE, name: 'R' }, { id: 'r2', name: 'R2' }],
    currentRack: HOSTILE,
    nodes: [{ id: 'sw1', type: 'switch', rackId: HOSTILE }, { id: 'sw2', type: 'switch', rackId: 'r2' }],
    links: [{ id: 'a b', src: 'sw1-1', dst: 'sw2-1' }],
    byRack: { [HOSTILE]: ['sw1'] },
    refs: { cavi: ['a b', 'zz'] },
  };
  const n = repairUnsafeIds(st);
  assert.equal(n, 2, 'rack e cavo');
  const rackId = st.racks[0].id, linkId = st.links[0].id;
  assert.equal(isSafeId(rackId), true);
  assert.equal(isSafeId(linkId), true);
  assert.equal(st.currentRack, rackId, 'currentRack segue');
  assert.equal(st.nodes[0].rackId, rackId, 'il nodo resta nel suo rack');
  assert.equal(st.nodes[1].rackId, 'r2', 'gli altri non si toccano');
  assert.deepEqual(Object.keys(st.byRack), [rackId], 'anche una CHIAVE uguale al vecchio id');
  assert.deepEqual(st.refs.cavi, [linkId, 'zz'], 'e un elemento di un elenco');
  assert.ok(!JSON.stringify(st).includes('onerror'), 'del payload non resta traccia');
});

test('repairUnsafeIds: gli id dei NODI non si toccano (li rinumera il client, e le porte li portano nel nome)', () => {
  const st = { nodes: [{ id: HOSTILE, type: 'switch' }], ports: { [HOSTILE + '-1']: {} }, links: [] };
  assert.equal(repairUnsafeIds(st), 0);
  assert.equal(st.nodes[0].id, HOSTILE);
  // ...ma le VM DENTRO un nodo si riparano
  const st2 = { nodes: [{ id: 'sw1', vms: [{ id: HOSTILE }] }] };
  assert.equal(repairUnsafeIds(st2), 1);
  assert.equal(isSafeId(st2.nodes[0].vms[0].id), true);
});

test('repairUnsafeIds: idempotente, e due id ostili diversi restano DUE id diversi', () => {
  const st = { racks: [{ id: '"a' }, { id: '"b' }, { id: '"a' }], links: [] };
  assert.equal(repairUnsafeIds(st), 2);
  const ids = st.racks.map(r => r.id);
  assert.equal(ids[0], ids[2], 'lo stesso vecchio id → lo stesso nuovo');
  assert.notEqual(ids[0], ids[1]);
  assert.equal(new Set(ids).size, 2);
  assert.equal(repairUnsafeIds(st), 0, 'la seconda passata non fa niente');
});

test('repairUnsafeIds: il generatore e\' quello del chiamante, e un id gia\' preso non si riusa', () => {
  const st = { racks: [{ id: 'taken' }, { id: '<x>' }] };
  const seq = ['taken', 'taken', 'fresh'];
  const n = repairUnsafeIds(st, () => seq.shift());
  assert.equal(n, 1);
  assert.equal(st.racks[1].id, 'fresh', 'salta i candidati occupati');
  // un generatore che produce id NON validi non puo' reintrodurre markup
  const st2 = { racks: [{ id: '<x>' }] };
  let k = 0;
  repairUnsafeIds(st2, () => (++k < 3 ? '<y>' : 'ok3'));
  assert.equal(st2.racks[0].id, 'ok3');
});

test('repairUnsafeIds: input non-oggetto, annidamento enorme e cicli non fanno danni', () => {
  for (const bad of [null, undefined, 5, 'x', []]) assert.equal(repairUnsafeIds(bad), 0);
  let deep = { id: '<x>' };
  for (let i = 0; i < 100; i++) deep = { child: deep };
  assert.doesNotThrow(() => repairUnsafeIds({ racks: [deep] }));
});
