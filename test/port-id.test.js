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
