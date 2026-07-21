'use strict';
// ============================================================
// L2L3-M3 (audit 2026-07-21): le trunkVlans di un link LAG devono venire
// dall'aggregatore della PORTA specifica (il suo Port-channel), non dal primo
// trunk qualsiasi. Uno switch con PIU' Port-channel: un link su Po2 non deve
// ereditare le VLAN di Po1. La porta dichiara il suo aggregatore in `lagId`
// (= ifIndex dell'aggregatore, cfr. drivers/snmp.js: port.lagId === agg.index).
// Puro: _lagTrunkVlansForPortLag(integration, portLagId) → number[].
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (autolink-lag-trunk-vlans)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function resolve(integration, portLagId) {
  const code = `(() => JSON.stringify(_lagTrunkVlansForPortLag(${JSON.stringify(integration)}, ${JSON.stringify(portLagId)})))()`;
  return JSON.parse(run(APP.ctx, code));
}

// Switch con DUE Port-channel trunk (ifIndex 1 e 2) + una VLAN di nodo per il fallback.
const MULTI_PO = {
  lags: [
    { index: 1, name: 'Po1', isTrunk: true, trunkVlans: [10, 20] },
    { index: 2, name: 'Po2', isTrunk: true, trunkVlans: [30, 40] },
  ],
  vlans: [99],
};

test('multi-Po: la porta su Po2 riceve le VLAN di Po2, non di Po1 (il bug)', () => {
  assert.deepEqual(resolve(MULTI_PO, 2), [30, 40]);
});

test('multi-Po: la porta su Po1 riceve le VLAN di Po1', () => {
  assert.deepEqual(resolve(MULTI_PO, 1), [10, 20]);
});

test('Po di accesso: una porta sul Po access NON eredita le VLAN di un altro Po trunk', () => {
  const integ = { lags: [
    { index: 1, name: 'Po1', isTrunk: true, trunkVlans: [10, 20] },
    { index: 5, name: 'Po5', isTrunk: false, trunkVlans: [] },
  ] };
  assert.deepEqual(resolve(integ, 5), []);   // access → niente VLAN, non quelle di Po1
});

test('porta senza lagId: fallback storico = primo trunk-agg', () => {
  assert.deepEqual(resolve(MULTI_PO, 0), [10, 20]);
});

test('lagId senza match in lags[]: fallback storico = primo trunk-agg', () => {
  assert.deepEqual(resolve(MULTI_PO, 99), [10, 20]);
});

test('nessun aggregatore trunk: ripiega sulle VLAN del nodo', () => {
  assert.deepEqual(resolve({ lags: [{ index: 1, isTrunk: false, trunkVlans: [] }], vlans: [7, 8] }, 3), [7, 8]);
});

test('integration senza lags/vlans: array vuoto, non lancia', () => {
  assert.deepEqual(resolve({}, 2), []);
});
