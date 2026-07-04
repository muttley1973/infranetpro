'use strict';
// ============================================================
// MEMO IPAM PER-FRAME (audit F6). _renderFloorProps chiama _ipamUsageForVlan/
// _vlanIpamSummary per OGNI VLAN, e ognuna ri-scandisce tutti i nodi + lease.
// Il memo (attivo solo tra _ipamMemoBegin/_ipamMemoEnd, sincroni) collassa quelle
// scansioni a UNA sola per resa, SENZA introdurre staleness fuori dalla finestra.
// Testato via la DOM-stub harness (bare global esposti da expose()).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (ipam-memo)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('F6: _collectKnownIps e\' memoizzato tra begin/end, fresco fuori', () => {
  run(APP.ctx, `window.state = { nodes:[{id:'a',ip:'10.0.0.1'},{id:'b',ip:'10.0.0.2'}], ports:{} };`);
  const r = JSON.parse(run(APP.ctx, `(() => {
    _ipamMemoBegin();
    const a = _collectKnownIps();
    const b = _collectKnownIps();
    const sameInMemo = (a === b);          // stessa ISTANZA → calcolato una volta sola
    _ipamMemoEnd();
    const c = _collectKnownIps();
    const freshAfter = (c !== a);          // dopo end → ricalcolo fresco (no staleness)
    return JSON.stringify({ sameInMemo, freshAfter, len:a.length });
  })()`));
  assert.equal(r.sameInMemo, true, 'stessa istanza memoizzata tra begin/end');
  assert.equal(r.freshAfter, true, 'fuori dal memo torna a calcolare fresco');
  assert.equal(r.len, 2);
});

test('F6: senza begin/end il memo e\' inattivo (nessuna staleness di default)', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    const a = _collectKnownIps();
    const b = _collectKnownIps();
    return JSON.stringify({ distinct: (a !== b), len:a.length });
  })()`));
  assert.equal(r.distinct, true, 'senza memo ogni chiamata calcola da zero');
});

test('F6: il memo riflette lo stato al momento del begin (ricostruito ad ogni resa)', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    window.state = { nodes:[{id:'a',ip:'10.0.0.1'}], ports:{} };
    _ipamMemoBegin(); const first = _collectKnownIps().length; _ipamMemoEnd();
    window.state = { nodes:[{id:'a',ip:'10.0.0.1'},{id:'c',ip:'10.0.0.3'}], ports:{} };
    _ipamMemoBegin(); const second = _collectKnownIps().length; _ipamMemoEnd();
    return JSON.stringify({ first, second });
  })()`));
  assert.equal(r.first, 1);
  assert.equal(r.second, 2, 'una nuova finestra memo rilegge lo stato aggiornato');
});
