const test = require('node:test');
const assert = require('node:assert/strict');
const { nodePresenceClass } = require('../lib/presence.js');

test('presenza usa il report corrente quando disponibile', () => {
  const node = { id: 'iot1', proof: { status: 'absent' } };
  assert.equal(nodePresenceClass(node, { macOrphan: [], unverified: [{ nodeId: 'iot1' }] }), ' node-unverified');
});

test('presenza ripristina il proof persistente dopo il reload', () => {
  assert.equal(nodePresenceClass({ id: 'iot1', proof: { status: 'absent' } }, null), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'iot1', proof: { status: 'unverified' } }, null), ' node-unverified');
});
