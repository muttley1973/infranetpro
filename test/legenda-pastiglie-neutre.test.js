'use strict';
// ============================================================================
// La legenda dice che cosa un cavo È, non che cosa gli manca
// ============================================================================
// C'era una voce sola, «senza colore VLAN», che copriva tutti i cavi neutri.
// Era un'etichetta definita per ASSENZA — e in un modello dove un cavo che
// commuta un colore ce l'ha sempre, l'assenza non è più una categoria: restano
// due stati, e sono due affermazioni precise.
//
//   trunk       porta più VLAN e nessuna prevale → neutro, le mostra tutte
//   instradato  non sta in nessuna VLAN, nemmeno nella 1
//
// ⚠️ Ognuna compare SOLO se almeno un cavo ci cade davvero: una voce di legenda
// che spiega un colore assente dalla mappa è rumore. Ed è il tipo di regola che
// si rompe in silenzio — nessuno guarda una legenda finché non è sbagliata.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (legenda-neutri)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Ritorna le etichette delle pastiglie NEUTRE, nell'ordine in cui la legenda le rende.
function pastiglieNeutre(setup) {
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.nodes.push({ id:'a', type:'switch', name:'A', ports:4, integration:{ vlans:[1,10,20] } });
    state.nodes.push({ id:'b', type:'switch', name:'B', ports:4, integration:{ vlans:[1,10,20] } });
    ${setup}
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    _renderTopoLegend();
    const el = document.getElementById('topo-legend');
    return { html: el ? (el.innerHTML || '') : '', esiti: state.links.map(l => _linkPaintVlan(l).kind) };
  })()`);
  const out2 = [];
  const re = /class="topo-leg-novlan"[\s\S]*?<\/span>([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(out.html))) out2.push(m[1].trim());
  // ⚠️ `out.esiti` arriva dal realm della VM dello stub: e' un Array con un altro
  // prototipo, e `deepEqual` strict lo rifiuta pur avendo lo stesso contenuto
  // («same structure but not reference-equal»). Si ricopia in questo realm.
  return { pastiglie: out2, esiti: Array.from(out.esiti || []) };
}

test('un trunk multi-VLAN mette in legenda «trunk», e nient’altro', () => {
  const r = pastiglieNeutre(`state.links.push({ id:'l1', src:'a-1', dst:'b-1', mode:'trunk', trunkVlans:'10,20' });`);
  assert.deepEqual(r.esiti, ['trunk']);
  assert.deepEqual(r.pastiglie, ['trunk']);
});

test('un collegamento instradato mette «instradato», e nient’altro', () => {
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1' });
    state.ports['a-1'] = { ownsIp:true };`);
  assert.deepEqual(r.esiti, ['routed']);
  assert.deepEqual(r.pastiglie, ['instradato']);
});

test('se ci sono tutti e due, la legenda li elenca tutti e due', () => {
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1', mode:'trunk', trunkVlans:'10,20' });
    state.links.push({ id:'l2', src:'a-2', dst:'b-2' });
    state.ports['a-2'] = { ownsIp:true };`);
  assert.deepEqual(r.esiti, ['trunk', 'routed']);
  assert.deepEqual(r.pastiglie, ['trunk', 'instradato']);
});

test('se ogni cavo ha la sua VLAN, di pastiglie neutre non ce n’è nessuna', () => {
  // La riprova del riconoscitore: se le pastiglie comparissero sempre, i tre
  // test sopra passerebbero lo stesso e non proverebbero niente.
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1' });
    state.ports['a-1'] = { vlan:10 };`);
  assert.deepEqual(r.esiti, ['vlan']);
  assert.deepEqual(r.pastiglie, []);
});
