const test = require('node:test');
const assert = require('node:assert/strict');
const { nodeIdOfPort, portSuffix } = require('../lib/port-id.js');

test('PID parser usa il prefisso del nodo piu lungo', () => {
  const ids = ['nb-dev-100', 'nb-dev-100-logical'];
  assert.equal(nodeIdOfPort('nb-dev-100-1', ids), 'nb-dev-100');
  assert.equal(nodeIdOfPort('nb-dev-100-logical-123', ids), 'nb-dev-100-logical');
  assert.equal(portSuffix('nb-dev-100-logical-123', ids), '123');
});

test('PID parser mantiene il fallback per progetti legacy', () => {
  assert.equal(nodeIdOfPort('sw1-24'), 'sw1');
  assert.equal(portSuffix('sw1-24'), '24');
});

// PERF/REGRESSIONE (fix stuck-in-scansione): il lookup deve essere O(1) tramite
// membership su Set/oggetto, senza scandire tutti i nodi quando lo split ingenuo
// è già un nodeId noto. Qui verifichiamo che Set e mappa nodeId->x diano gli
// stessi risultati dell'array (fast-path corretto).
test('PID parser: Set e oggetto (mappa nodeById) come knownNodeIds', () => {
  const set = new Set(['nb-dev-100', 'nb-dev-100-logical']);
  const map = { 'nb-dev-100': {}, 'nb-dev-100-logical': {} };
  for (const known of [set, map]) {
    assert.equal(nodeIdOfPort('nb-dev-100-1', known), 'nb-dev-100');
    assert.equal(nodeIdOfPort('nb-dev-100-logical-123', known), 'nb-dev-100-logical');
    assert.equal(nodeIdOfPort('sw1-24', known), 'sw1');   // non noto → fallback split ingenuo
  }
});

// Caso raro che ESIGE la scansione longest-prefix: lo split ingenuo cade su un
// prefisso NON-nodo (suffisso multi-trattino) e va ricondotto al nodo più corto.
test('PID parser: suffisso multi-trattino risale al nodo noto più corto', () => {
  const ids = new Set(['core-a']);
  assert.equal(nodeIdOfPort('core-a-eth-1', ids), 'core-a');   // naive "core-a-eth" non è un nodo
  assert.equal(portSuffix('core-a-eth-1', ids), 'eth-1');
});
