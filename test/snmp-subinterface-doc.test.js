'use strict';
// ============================================================
// La sottointerfaccia dot1Q entra nel DOCUMENTO come porta logica.
//
// Caso dal banco (2026-08-20): un Cisco CSR1000v appeso in trunk a SW-ACC2
// annuncia `GigabitEthernet1.99` — ifType 135, VLAN 99 dichiarata, appoggiata su
// `GigabitEthernet1`, e con sopra l'indirizzo 10.10.99.41 da cui lo interroghiamo.
// Finiva scartata dal driver, e con lei sparivano VLAN e indirizzo.
//
// Due invarianti che questi test tengono ferme:
//   • una porta logica NON è cablabile (`logical: true`, come le interfacce
//     logiche dell'import NetBox: una forma sola, non due che divergono);
//   • la porta FISICA sotto trasporta quella VLAN — non per deduzione nostra, ma
//     perché l'apparato dichiara entrambe le cose: «sono la 99» e «vivo su Gi1».
// Usa la DOM-stub harness (carica tutta l'app, come snmp-portmap.test.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// Il poll del CSR, ridotto: una fisica cablata e la sua sottointerfaccia.
const POLL = `{ ok:true,
  interfaces:[ { index:1, name:'GigabitEthernet1', operStatus:1, speed:1000 } ],
  subInterfaces:[ { index:7, name:'GigabitEthernet1.99', operStatus:1, adminStatus:1, parentIndex:1, vlan:99 } ],
  lags:[], vlans:[99] }`;

let APP;
test('load app (subinterface-doc)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function scenario(extra) {
  return `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'rt1', type:'router', name:'CSR', ports:4, ip:'10.10.99.41' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('rt1', ${POLL}, { noHistory:true });
    ${extra}
  })()`;
}

test('la sottointerfaccia diventa una porta LOGICA con la VLAN dichiarata', () => {
  const out = run(APP.ctx, scenario(`
    const p = state.ports['rt1-logical-7'] || {};
    return { logical: !!p.logical, ifName: p.ifName, vlan: p.vlan, parent: p.parentPid };
  `));
  assert.strictEqual(out.logical, true, 'porta logica: non è cablabile');
  assert.strictEqual(out.ifName, 'GigabitEthernet1.99');
  assert.strictEqual(out.vlan, 99, 'la VLAN dichiarata dall\'apparato');
  assert.strictEqual(out.parent, 'rt1-1', 'dichiara la porta fisica su cui vive');
});

test('la porta FISICA sotto risulta trasportare quella VLAN', () => {
  const out = run(APP.ctx, scenario(`
    const p = state.ports['rt1-1'] || {};
    return { isTrunk: !!p.isTrunk, carried: (p.trunkVlans || []).join(',') };
  `));
  assert.strictEqual(out.isTrunk, true, 'una porta con sottointerfacce dot1Q porta traffico taggato');
  assert.strictEqual(out.carried, '99', 'e la VLAN che trasporta è quella dichiarata');
});

test('la porta logica NON occupa uno slot fisico', () => {
  const out = run(APP.ctx, scenario(`
    return { fisiche: Object.keys(state.ports).filter(k => /^rt1-\\d+$/.test(k)).sort().join(','),
             logiche: Object.keys(state.ports).filter(k => k.indexOf('-logical-') > 0).join(',') };
  `));
  assert.strictEqual(out.fisiche, 'rt1-1', 'le porte posizionali restano quelle misurate');
  assert.strictEqual(out.logiche, 'rt1-logical-7');
});

test('ri-sync con ifIndex diverso ma stesso nome: la porta resta UNA', () => {
  // Senza `snmp-server ifindex persist` gli indici si rimescolano al riavvio.
  // Se l'identità fosse l'ifIndex, ogni Verifica sdoppierebbe la porta logica.
  const out = run(APP.ctx, scenario(`
    applyPollResult('rt1', { ok:true,
      interfaces:[ { index:1, name:'GigabitEthernet1', operStatus:1, speed:1000 } ],
      subInterfaces:[ { index:42, name:'GigabitEthernet1.99', operStatus:1, parentIndex:1, vlan:99 } ],
      lags:[], vlans:[99] }, { noHistory:true });
    return { logiche: Object.keys(state.ports).filter(k => k.indexOf('-logical-') > 0).join(','),
             vlan: (state.ports['rt1-logical-7']||{}).vlan };
  `));
  assert.strictEqual(out.logiche, 'rt1-logical-7', 'una sola porta logica, non due');
  assert.strictEqual(out.vlan, 99);
});

test('sottointerfaccia senza VLAN dichiarata: la porta c\'è, la VLAN no', () => {
  // È il caso di un apparato che espone l'interfaccia ma non la tabella che ne
  // dichiara la VLAN. Il 99 nel nome non è una misura e non va letto da lì.
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'rt2', type:'router', name:'R2', ports:4 });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('rt2', { ok:true,
      interfaces:[ { index:1, name:'Gi1', operStatus:1 } ],
      subInterfaces:[ { index:7, name:'Gi1.99', operStatus:1, parentIndex:1 } ],
      lags:[], vlans:[] }, { noHistory:true });
    const p = state.ports['rt2-logical-7'] || {};
    const parent = state.ports['rt2-1'] || {};
    return { esiste: !!p.logical, vlan: p.vlan === undefined ? 'assente' : p.vlan,
             parentTrunk: !!parent.isTrunk };
  })()`);
  assert.strictEqual(out.esiste, true, 'l\'interfaccia resta nel documento');
  assert.strictEqual(out.vlan, 'assente', 'la VLAN non si inventa dal nome');
  assert.strictEqual(out.parentTrunk, false,
    'senza VLAN dichiarata non si afferma nemmeno che il genitore la trasporti');
});
