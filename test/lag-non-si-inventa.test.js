'use strict';
// ============================================================
// Due cavi paralleli non sono un LAG: l'aggregazione si misura, o resta assente.
//
// L'inferenza «≥2 adiacenze LLDP/CDP fra gli stessi due apparati ⇒ LAG» leggeva una
// COINCIDENZA e ne faceva un fatto. Ma due cavi fra gli stessi switch possono essere:
//   · un bundle LACP/EtherChannel (aggregano, banda doppia),
//   · una RIDONDANZA con spanning-tree (uno inoltra, l'altro è bloccato — e il link
//     è su lo stesso: STP non spegne la porta, quindi nessun segnale li distingue),
//   · due link su VLAN o servizi diversi.
// LLDP e CDP non dicono niente sull'aggregazione. Chiamarli LAG è la famiglia della
// VLAN 1 inventata — e qui per giunta si scrivevano TRE campi documentali sulle
// porte: `lagGroup`, `isTrunk` forzato a true e le VLAN trasportate prese
// dall'inventario VLAN del device.
//
// La misura esiste e il driver la legge già (ifStackTable · 802.3ad · AttachedAggID
// → `p.lagId`, gruppo `snmp-lag-…`). Quindi: LAG solo dove un capo lo dichiara — o
// dove l'ha dichiarato una persona (`lg…`). Altrove restano due cavi e la coincidenza
// esce nella diagnosi dell'AutoLink, dove la legge chi conosce la rete.
// ⚠️ Un gruppo `lldp-lag-…` non vale come prova di sé stesso: lo scrive questa
// inferenza, e riconoscerlo come misura sarebbe confermarsi da soli al giro dopo.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const { linkState } = require('../lib/linkstate.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (lag-non-si-inventa)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function mockTopology(ctx, byNode) {
  ctx.fetch = (url, opts) => {
    let src = '';
    try { src = JSON.parse((opts && opts.body) || '{}').srcNodeId || ''; } catch (_) {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      ok: true, neighbors: byNode[src] || [], fdbTable: {}, arpTable: {},
    }) });
  };
}

/** Due adiacenze LLDP sw1↔sw2. `porte` è ciò che le porte locali DICHIARANO. */
function scenario(porte) {
  mockTopology(APP.ctx, { sw1: [
    { protocol:'LLDP', localPort:'Gi1/1', remoteDevice:'SW2', remoteIP:'10.0.0.2', remotePort:'Gi2/1' },
    { protocol:'LLDP', localPort:'Gi1/2', remoteDevice:'SW2', remoteIP:'10.0.0.2', remotePort:'Gi2/2' },
  ]});
  // Il progetto dimostrativo di `_buildDefaultState` porta già un `sw1` e i suoi cavi:
  // qui serve un foglio bianco, o si misurerebbe lui.
  return `
    state = _buildDefaultState();
    state.nodes.length = 0; state.links.length = 0; state.ports = {}; state.racks.length = 0;
    state.lagGroups = {};
    state.nodes.push(
      { id:'sw1', type:'switch', name:'SW1', ports:8, ip:'10.0.0.1', snmpStatus:'ok', integration:{ driver:'snmp-v2c', host:'10.0.0.1' } },
      { id:'sw2', type:'switch', name:'SW2', ports:8, ip:'10.0.0.2', snmpStatus:'ok', integration:{ driver:'snmp-v2c', host:'10.0.0.2' } }
    );
    state.ports['sw1-1'] = Object.assign({ status:'active', ifName:'Gi1/1' }, ${porte});
    state.ports['sw1-2'] = Object.assign({ status:'active', ifName:'Gi1/2' }, ${porte});
    state.ports['sw2-1'] = { status:'active', ifName:'Gi2/1' };
    state.ports['sw2-2'] = { status:'active', ifName:'Gi2/2' };
    if(typeof _invalidateIdx==='function') _invalidateIdx();
  `;
}

const LETTURA = `JSON.stringify({
  links: state.links.map(l => ({ src:l.src, dst:l.dst, protocol:l.protocol, autoLinked:!!l.autoLinked,
                                 lagLogicalKey: l.lagLogicalKey || null })),
  lagGroups: Object.keys(state.lagGroups || {}),
  porte: ['sw1-1','sw1-2'].map(pid => ({
    lagGroup: state.ports[pid].lagGroup || null,
    isTrunk: state.ports[pid].isTrunk === true,
    trunkVlans: (state.ports[pid].trunkVlans || []).length,
  })),
})`;

const giro = () => run(APP.ctx, `_autoDiscoverLinks(['sw1']).then(r => JSON.stringify({ paralleli: r.diag.parallelNoLag || 0 }))`);

// ── ① Nessuna aggregazione dichiarata: due cavi, e basta ───────────────────

test('due adiacenze LLDP senza aggregato misurato NON diventano un LAG', async () => {
  run(APP.ctx, scenario('{}'));
  await giro();
  const r = JSON.parse(run(APP.ctx, LETTURA));

  assert.equal(r.links.length, 2, 'restano due cavi distinti, uno per adiacenza');
  for (const l of r.links) {
    assert.equal(l.lagLogicalKey, null, 'nessun cavo è membro di un LAG: nessuno l\'ha misurato');
    assert.equal(linkState(l).key, 'discovered', 'identità «scoperto via LLDP», non «LAG»');
  }
  assert.deepEqual(r.lagGroups, [], 'nessun gruppo LAG creato dal solo parallelismo');
});

test('e non scrive campi DOCUMENTALI sulle porte (lagGroup · isTrunk · trunkVlans)', async () => {
  run(APP.ctx, scenario('{}'));
  await giro();
  const { porte } = JSON.parse(run(APP.ctx, LETTURA));

  for (const p of porte) {
    assert.equal(p.lagGroup, null, 'nessun gruppo LAG scritto sulla porta');
    assert.equal(p.isTrunk, false, '«trunk» è una misura o una dichiarazione, mai una deduzione dal parallelismo');
    assert.equal(p.trunkVlans, 0, 'le VLAN trasportate non si inventano dall\'inventario del device');
  }
});

test('la coincidenza però si DICE: esce nella diagnosi dell\'AutoLink', async () => {
  run(APP.ctx, scenario('{}'));
  const out = JSON.parse(await giro());
  assert.equal(out.paralleli, 1,
    'una coppia con due cavi paralleli e nessun LAG misurato: può essere un bundle non dichiarato o una ridondanza STP');
});

// ── ② Aggregato MISURATO dal device: il LAG resta ──────────────────────────

test('con l\'aggregato misurato (lagId) i due cavi sono membri di un LAG', async () => {
  // `lagId` lo scrive il poll dalla cascata ifStack/802.3ad: quella è la misura.
  run(APP.ctx, scenario('{ lagId:1, lagGroup:"snmp-lag-sw1-1" }'));
  await giro();
  const r = JSON.parse(run(APP.ctx, LETTURA));

  assert.equal(r.links.length, 2, 'i membri restano due cavi fisici');
  for (const l of r.links) {
    assert.ok(l.lagLogicalKey, 'con la misura il cavo è membro del LAG');
    assert.equal(linkState(l).key, 'lag', 'e l\'identità del cavo è «LAG»');
  }
  for (const p of r.porte) {
    assert.equal(p.lagGroup, 'snmp-lag-sw1-1', 'il gruppo MISURATO non viene sovrascritto dal dedotto');
  }
});

// ── ③ Progetti vecchi: il gruppo inventato si disfa ────────────────────────

test('un `lldp-lag-` scritto da un giro precedente viene TOLTO se nessuno lo misura', async () => {
  run(APP.ctx, scenario('{ lagGroup:"lldp-lag-sw1||sw2" }'));
  run(APP.ctx, `state.lagGroups['lldp-lag-sw1||sw2'] = 'Po1';`);
  await giro();
  const r = JSON.parse(run(APP.ctx, LETTURA));

  for (const p of r.porte) {
    assert.equal(p.lagGroup, null, 'il gruppo che l\'inferenza aveva scritto se ne va con lei');
  }
  assert.deepEqual(r.lagGroups, [], 'e il gruppo non resta appeso nel documento');
  for (const l of r.links) {
    assert.equal(l.lagLogicalKey, null, 'né il cavo resta un membro di quel LAG');
  }
});
