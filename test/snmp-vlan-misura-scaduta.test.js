'use strict';
// ============================================================
// Una misura di VLAN non sopravvive alla prova che la reggeva.
//
// `p.vlan` È la misura SNMP (quella scritta a mano vive in `p.vlanOvr`). La glue
// però, quando il poll non riportava VLAN per una porta, TENEVA il valore
// precedente — e così l'«1» che il driver inventava prima della 2.10.1 diventava
// immortale: nessun ri-poll riusciva più a toglierlo, e continuava a scavalcare
// la VLAN dichiarata a valle.
//
// Misurato dal vivo sul banco il 2026-08-21: interrogando SW-ACC2 (Cisco vIOS)
// il driver dichiarava correttamente `vlan: (assente)` sulle porte access — ma
// nel documento restavano «VLAN 1», e i cavi verso il WLC e verso SRV-LINUX
// continuavano a uscire grigi.
//
// Le due metà della regola, che vanno tenute INSIEME:
//   • misura assente su una porta che la walk HA coperto ⇒ si dimentica;
//   • una lettura di «VLAN 1» NON scalza una VLAN > 1 già nota (certe immagini
//     rispondono 1 per default) — quello resta il comportamento manual-first.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

let APP;
test('load app (vlan-misura-scaduta)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

/** Poll di uno switch a due porte: la 1 dichiara `vlan`, la 2 tace. */
const poll = (vlan1) => `{ ok:true, lags:[], vlans:[],
  interfaces:[
    { index:1, name:'Gi1/0', operStatus:1, speed:1000${vlan1 == null ? '' : ', vlan:' + vlan1} },
    { index:2, name:'Gi1/1', operStatus:1, speed:1000 }
  ] }`;

function scenario(pre, vlan1, post) {
  return `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'sw1', type:'switch', name:'SW', ports:2, ip:'10.0.0.1' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    // Prima passata: mette il documento nello stato di partenza voluto.
    ${pre}
    applyPollResult('sw1', ${poll(vlan1)}, { noHistory:true });
    ${post}
  })()`;
}

test('misura ASSENTE su porta coperta dalla walk: la VLAN vecchia si dimentica', () => {
  const out = run(APP.ctx, scenario(
    // il documento porta un «1» scritto da un poll precedente (l'invenzione)
    `state.ports['sw1-2'] = { ifName:'Gi1/1', vlan:1 };`,
    null,
    `return { vlan: state.ports['sw1-2'].vlan === undefined ? 'assente' : state.ports['sw1-2'].vlan };`));
  assert.strictEqual(out.vlan, 'assente',
    'il device non dichiara piu\' la VLAN: tenerla sarebbe un\'affermazione senza prova');
});

test('anche una misura ALTA scaduta si dimentica: e\' una misura, non una dichiarazione', () => {
  const out = run(APP.ctx, scenario(
    `state.ports['sw1-2'] = { ifName:'Gi1/1', vlan:30 };`,
    null,
    `return { vlan: state.ports['sw1-2'].vlan === undefined ? 'assente' : state.ports['sw1-2'].vlan };`));
  assert.strictEqual(out.vlan, 'assente',
    'per fissare un valore che il device non dice c\'e\' vlanOvr (manuale), non p.vlan');
});

test('l\'override MANUALE non viene toccato: p.vlanOvr non passa di qui', () => {
  const out = run(APP.ctx, scenario(
    `state.ports['sw1-2'] = { ifName:'Gi1/1', vlan:1, vlanOvr:99 };`,
    null,
    `return { ovr: state.ports['sw1-2'].vlanOvr, vlan: state.ports['sw1-2'].vlan === undefined ? 'assente' : state.ports['sw1-2'].vlan };`));
  assert.strictEqual(out.ovr, 99, 'manual-first: la VLAN scritta a mano resta');
  assert.strictEqual(out.vlan, 'assente');
});

test('una lettura di «VLAN 1» NON scalza una VLAN > 1 gia\' nota (regola invariata)', () => {
  const out = run(APP.ctx, scenario(
    `state.ports['sw1-1'] = { ifName:'Gi1/0', vlan:30 };`,
    1,
    `return { vlan: state.ports['sw1-1'].vlan };`));
  assert.strictEqual(out.vlan, 30,
    'certe immagini rispondono 1 per default: non deve cancellare una VLAN reale');
});

test('una VLAN MISURATA > 1 vince e aggiorna il documento (regola invariata)', () => {
  const out = run(APP.ctx, scenario(
    `state.ports['sw1-1'] = { ifName:'Gi1/0', vlan:1 };`,
    30,
    `return { vlan: state.ports['sw1-1'].vlan };`));
  assert.strictEqual(out.vlan, 30);
});

