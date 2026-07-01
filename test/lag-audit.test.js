// Test puri per lib/lag-audit.js — coerenza membri LAG (velocità + VLAN).
const test = require('node:test');
const assert = require('node:assert/strict');

const { checkLagMembers } = require('../lib/lag-audit.js');

test('membri omogenei (stessa velocità + VLAN) → nessun mismatch', () => {
  const c = checkLagMembers([
    { num: 1, speed: 10000, vlan: 1 },
    { num: 2, speed: 10000, vlan: 1 },
  ]);
  assert.equal(c.speedMismatch, false);
  assert.equal(c.vlanMismatch, false);
  assert.deepEqual(c.speeds, [10000]);
  assert.deepEqual(c.vlans, [1]);
});

test('velocità miste (1G + 10G) → speedMismatch con entrambe ordinate', () => {
  const c = checkLagMembers([
    { num: 1, speed: 1000, vlan: 1 },
    { num: 2, speed: 10000, vlan: 1 },
  ]);
  assert.equal(c.speedMismatch, true);
  assert.deepEqual(c.speeds, [1000, 10000]);
  assert.equal(c.vlanMismatch, false);
});

test('VLAN/nativa diverse fra i membri → vlanMismatch', () => {
  const c = checkLagMembers([
    { num: 1, speed: 1000, vlan: 10 },
    { num: 2, speed: 1000, vlan: 20 },
  ]);
  assert.equal(c.vlanMismatch, true);
  assert.deepEqual(c.vlans, [10, 20]);
  assert.equal(c.speedMismatch, false);
});

test('velocità ignota (null) non conta come mismatch', () => {
  const c = checkLagMembers([
    { num: 1, speed: 10000, vlan: 1 },
    { num: 2, speed: null, vlan: 1 },
    { num: 3, vlan: 1 },
  ]);
  assert.equal(c.speedMismatch, false);
  assert.deepEqual(c.speeds, [10000]);
});

test('mismatch su entrambi gli assi', () => {
  const c = checkLagMembers([
    { num: 1, speed: 1000, vlan: 10 },
    { num: 2, speed: 10000, vlan: 20 },
  ]);
  assert.equal(c.speedMismatch, true);
  assert.equal(c.vlanMismatch, true);
});

test('valori duplicati deduplicati; ordinamento crescente', () => {
  const c = checkLagMembers([
    { num: 1, speed: 10000, vlan: 20 },
    { num: 2, speed: 1000, vlan: 10 },
    { num: 3, speed: 10000, vlan: 20 },
  ]);
  assert.deepEqual(c.speeds, [1000, 10000]);
  assert.deepEqual(c.vlans, [10, 20]);
});

test('input vuoto o non-array → nessun mismatch, liste vuote', () => {
  assert.deepEqual(checkLagMembers([]), { speedMismatch: false, vlanMismatch: false, speeds: [], vlans: [] });
  assert.deepEqual(checkLagMembers(null), { speedMismatch: false, vlanMismatch: false, speeds: [], vlans: [] });
});
