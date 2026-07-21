'use strict';
// ============================================================
// L2L3-A2 (audit 2026-07-21): la confidence di _resolveEndpointSwitchPort deve essere
// GRADUATA per numero di MAC sulla porta, allineata a correlate.js/_buildFdbCandidates
// (1→0.85, 2→0.80, 3-4→0.68 "sospetto mini-switch", sotto la soglia auto-crea 0.80).
// Prima era 0.92 piatto: una porta con 3-4 MAC veniva auto-collegata ad alta confidenza,
// scavalcando il ramo server più prudente nel candidate-set a max-confidence.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (autolink-endpoint-confidence)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Costruisce lo scenario: switch sw1 con porta access Gi0/3 (non trunk), un endpoint
// PC il cui MAC è appreso su Gi0/3 insieme a `extra` MAC vicini → macsOnPort = 1+extra.
function confFor(extra) {
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes.push(
      { id:'sw1', type:'switch', name:'SW', ports:24 },
      { id:'pc1', type:'pc', name:'PC', ports:1, mac:'aa:bb:cc:00:00:03' }
    );
    state.ports['sw1-3'] = { ifName:'Gi0/3' };   // porta access, nessun isTrunk
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const fdb = {};
    fdb[_normMacKey('aa:bb:cc:00:00:03')] = 'Gi0/3';          // il MAC del PC
    for(let i=0;i<${extra};i++) fdb[_normMacKey('aa:bb:cc:00:10:0'+i)] = 'Gi0/3';  // vicini
    window._topoFdbCache = { sw1: fdb };
    const r = _resolveEndpointSwitchPort(nodeById('pc1'));
    return JSON.stringify({ ok:r.ok, reason:r.reason||'', conf:r.confidence, mac:r.macsOnPort });
  })()`);
  return JSON.parse(out);
}

test('L2L3-A2: 1 MAC sulla porta → confidence 0.85 (porta dedicata)', () => {
  const r = confFor(0);
  assert.equal(r.ok, true);
  assert.equal(r.conf, 0.85);
});

test('L2L3-A2: 2 MAC sulla porta → confidence 0.80 (daisy-chain, ancora auto-crea)', () => {
  const r = confFor(1);
  assert.equal(r.ok, true);
  assert.equal(r.conf, 0.80);
});

test('L2L3-A2: 3 MAC sulla porta → confidence 0.68 (sospetto mini-switch, sotto soglia 0.80)', () => {
  const r = confFor(2);
  assert.equal(r.ok, true);
  assert.equal(r.conf, 0.68, 'una porta con 3 MAC non è più un aggancio ad alta confidenza');
  assert.ok(r.conf < 0.80, 'sotto la soglia auto-crea → il Sync NON crea il cavo da solo');
});

test('L2L3-A2: 4 MAC → 0.68; oltre 4 → port-uplink (nessun aggancio)', () => {
  assert.equal(confFor(3).conf, 0.68);
  const over = confFor(5);   // 6 MAC
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'port-uplink');
});
