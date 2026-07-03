'use strict';
// Regressione: il "cavo fantasma" (porta down da N sync) NON deve scattare su una
// porta cablata A MANO senza ifName. Quelle porte non sono verificabili per-porta
// (manual-first, come lo skip in applyPollResult): il loro `status` puo' essere
// stantio o mis-mappato da un vecchio sync posizionale -> falso allarme.
// Usa la DOM-stub harness (come snmp-portmap.test.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

let APP;
test('load app (drift-streak-manual)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('cavo fantasma: porta manuale (no ifName) NON conta; porta ifName inactive SI', () => {
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes.push(
      { id:'sw1', type:'switch', name:'SW1', ports:8, ip:'10.0.0.1', snmpStatus:'ok' },
      { id:'sw2', type:'switch', name:'SW2', ports:8, ip:'10.0.0.2', snmpStatus:'ok' },
      { id:'pcM', type:'pc', name:'PCM', ports:1, ip:'10.0.0.50' },
      { id:'pcI', type:'pc', name:'PCI', ports:1, ip:'10.0.0.51' }
    );
    // porta MANUALE senza ifName, status inactive stantio + streak gia' alto
    state.ports['sw1-1'] = { status:'inactive', downStreak:5 };
    state.ports['pcM-1'] = { status:'active' };
    // porta SNMP-mappata (ifName), status inactive (davvero down) + streak alto
    state.ports['sw2-1'] = { status:'inactive', ifName:'GigabitEthernet0/0', downStreak:5 };
    state.ports['pcI-1'] = { status:'active' };
    state.links.push(
      { id:'cM', src:'pcM-1', dst:'sw1-1' },   // cavo sulla porta manuale
      { id:'cI', src:'pcI-1', dst:'sw2-1' }    // cavo sulla porta ifName
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const docSnap = _driftBuildDocSnapshot();
    const report = _driftComputeFromDoc(docSnap, {});
    return JSON.stringify({
      ghosts: (report.ghostCable||[]).map(g=>g.id).sort(),
      streakManual: state.ports['sw1-1'].downStreak,
      streakIfName: state.ports['sw2-1'].downStreak,
    });
  })()`);
  const r = JSON.parse(out);
  assert.deepEqual(r.ghosts, ['cI'], 'solo il cavo sulla porta con ifName e fantasma; quello manuale no');
  assert.equal(r.streakManual, 0, 'la porta manuale (no ifName) ha lo streak azzerato');
  assert.ok(r.streakIfName >= 3, 'la porta ifName inactive continua ad accumulare streak');
});
