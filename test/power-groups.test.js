// Test per i gruppi di prese (lib/power-groups.js): due assi — commutazione e
// soccorso — e il legame presa→gruppo, che è DICHIARATO e manual-first.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/power-groups.js');

test('powerGroups: normalizza, scarta i doppioni, applica il tetto', () => {
  const node = { powerGroups: [
    { id: 'G1', name: 'Critici', switching: 'always', backup: 'battery' },
    { id: 'g1', name: 'doppione' },                       // stesso id → scartato
    { id: '', name: 'senza id' },                          // id vuoto → scartato
    { id: 'g2' },                                          // senza nome → nome = id
    { id: 'g3', switching: 'pippo', backup: 'pluto' },     // valori fuori scala → default
  ] };
  const g = G.powerGroups(node);
  assert.deepEqual(g.map(x => x.id), ['g1', 'g2', 'g3']);
  assert.equal(g[0].name, 'Critici');
  assert.equal(g[0].switching, 'always');
  assert.equal(g[1].name, 'g2', 'un gruppo senza nome tiene il suo id');
  assert.deepEqual({ s: g[2].switching, b: g[2].backup }, { s: 'switched', b: 'battery' });

  const troppi = { powerGroups: Array.from({ length: 12 }, (_, i) => ({ id: 'g' + (i + 1) })) };
  assert.equal(G.powerGroups(troppi).length, G.MAX_POWER_GROUPS);
});

test('powerGroups: legge anche da node.spec (campi device nello spec)', () => {
  assert.deepEqual(G.powerGroups({ spec: { powerGroups: [{ id: 'g1' }] } }).map(x => x.id), ['g1']);
  assert.deepEqual(G.powerGroups({}), []);
  assert.deepEqual(G.powerGroups(null), []);
});

test('outletGroupId: la parola dell\'utente batte quella del catalogo', () => {
  assert.deepEqual(G.outletGroupId({ group: 'g2' }), { id: 'g2', manual: false });
  assert.deepEqual(G.outletGroupId({ group: 'g2', groupOvr: 'g1' }), { id: 'g1', manual: true });
  // Override VUOTO = «questa presa non sta in nessun gruppo», e deve vincere
  // sul valore dedotto: altrimenti staccare una presa dal suo gruppo sarebbe
  // impossibile, il catalogo la riattaccherebbe a ogni lettura.
  assert.deepEqual(G.outletGroupId({ group: 'g2', groupOvr: '' }), { id: '', manual: false });
  assert.deepEqual(G.outletGroupId({}), { id: '', manual: false });
  assert.deepEqual(G.outletGroupId(null), { id: '', manual: false });
});

test('groupOfOutlet / outletGroupIndex: risolti sul nodo, 0 se il gruppo non c\'è più', () => {
  const node = { powerGroups: [{ id: 'g1', name: 'Critici' }, { id: 'g2', name: 'Sacrificabili' }] };
  assert.equal(G.groupOfOutlet(node, { groupOvr: 'g2' }).name, 'Sacrificabili');
  assert.equal(G.outletGroupIndex(node, { groupOvr: 'g2' }), 2);
  assert.equal(G.groupOfOutlet(node, { groupOvr: 'g9' }), null, 'gruppo cancellato → nessun gruppo');
  assert.equal(G.outletGroupIndex(node, { groupOvr: 'g9' }), 0, 'niente fascia di colore su un gruppo che non esiste');
  assert.equal(G.outletGroupIndex(node, {}), 0);
});

test('powerGroupView: prese per gruppo, non assegnate e ORFANE contate a parte', () => {
  const node = { powerGroups: [{ id: 'g1', name: 'Critici' }, { id: 'g2', name: 'Resto' }] };
  const outlets = [
    { groupOvr: 'g1' },   // 0
    { groupOvr: 'g1' },   // 1
    { groupOvr: 'g2' },   // 2
    {},                   // 3 — mai assegnata
    { groupOvr: 'g7' },   // 4 — punta a un gruppo sparito
  ];
  const v = G.powerGroupView(node, outlets);
  assert.deepEqual(v.groups.map(g => [g.id, g.outlets]), [['g1', [0, 1]], ['g2', [2]]]);
  assert.deepEqual(v.ungrouped, [3]);
  assert.deepEqual(v.orphan, [{ index: 4, id: 'g7' }], 'una presa che punta al vuoto si dichiara, non si nasconde fra le non assegnate');
});

test('nextGroupId: primo libero, vuoto quando sono tutti presi', () => {
  assert.equal(G.nextGroupId({}), 'g1');
  assert.equal(G.nextGroupId({ powerGroups: [{ id: 'g1' }, { id: 'g3' }] }), 'g2');
  assert.equal(G.nextGroupId({ powerGroups: Array.from({ length: 8 }, (_, i) => ({ id: 'g' + (i + 1) })) }), '');
});

test('normalizeGroupId: chiave breve e sicura (ci puntano le prese)', () => {
  assert.equal(G.normalizeGroupId(' G1 '), 'g1');
  assert.equal(G.normalizeGroupId('gruppo uno!'), 'gruppouno');
  assert.equal(G.normalizeGroupId('<script>'), 'script');
  assert.equal(G.normalizeGroupId('a'.repeat(30)).length, 12);
  assert.equal(G.normalizeGroupId(null), '');
});
