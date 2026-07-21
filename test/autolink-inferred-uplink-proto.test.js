'use strict';
// ============================================================
// L2L3-M4 (audit 2026-07-21): un'adiacenza switch↔switch DEDOTTA (protocol non
// dichiarato da LLDP/CDP) non deve promuovere il cavo a LAG "confermato": resta
// "Inferito · da verificare". _isInferredUplinkProto sopprime lagLogicalKey per i
// protocolli inferiti. Prima copriva solo MAC-UPLINK; ora anche FDB-DCT e INFERRED.
// Coerente con lib/linkstate.js: SOLO LLDP/CDP sono fidati (dichiarano il vicino),
// ogni correlazione FDB/MAC — anche a score alto — e' un'inferenza dell'app.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (autolink-inferred-uplink-proto)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function isInferred(proto) {
  return run(APP.ctx, `_isInferredUplinkProto(${JSON.stringify(proto)})`);
}

test('inferiti → true (nessuna promozione a LAG confermato)', () => {
  assert.equal(isInferred('MAC-UPLINK'), true, 'FDB verso switch cieco (gia\' escluso, task #114)');
  assert.equal(isInferred('FDB-DCT'), true, 'correlazione FDB diretta switch↔switch (il fix M4)');
  assert.equal(isInferred('INFERRED'), true, 'intermediario/porta remota materializzata (il fix M4)');
});

test('trusted (LLDP/CDP) → false: un bundle dichiarato resta LAG', () => {
  assert.equal(isInferred('LLDP'), false);
  assert.equal(isInferred('CDP'), false);
});

test('case-insensitive + input vuoto/nullo robusto', () => {
  assert.equal(isInferred('fdb-dct'), true);
  assert.equal(isInferred('Mac-Uplink'), true);
  assert.equal(isInferred(''), false);
  assert.equal(isInferred(null), false);
  assert.equal(isInferred(undefined), false);
});
