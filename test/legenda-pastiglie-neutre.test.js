'use strict';
// ============================================================================
// La legenda delle VLAN contiene VLAN — e una sola voce che non lo è
// ============================================================================
// C'era una voce, «senza colore VLAN», che copriva tutti i cavi neutri: un
// etichetta definita per ASSENZA, in un modello dove ormai un cavo che commuta
// un colore ce l'ha sempre. È stata tolta.
//
// Resta **una** voce non-VLAN: il collegamento **INSTRADATO**, perché è l'unico
// neutro che non ha altro modo di farsi scoprire. Il trunk ce l'ha — il suo
// bottone in topologia lo evidenzia meglio di una pastiglia, e il colore si
// cambia comunque dalle Proprietà del cavo — quindi in legenda non ci va: quella
// è la legenda delle VLAN, e un trunk non è una VLAN.
//
// ⚠️ La voce compare SOLO se almeno un cavo ci cade davvero: una voce che spiega
// un colore assente dalla mappa è rumore. Ed è il tipo di regola che si rompe in
// silenzio — nessuno guarda una legenda finché non è sbagliata.
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

test('un collegamento instradato mette in legenda «instradato»', () => {
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1' });
    state.ports['a-1'] = { ownsIp:true };`);
  assert.deepEqual(r.esiti, ['routed']);
  assert.deepEqual(r.pastiglie, ['instradato']);
});

test('un trunk NON mette niente in legenda: ha il suo bottone', () => {
  const r = pastiglieNeutre(`state.links.push({ id:'l1', src:'a-1', dst:'b-1', mode:'trunk', trunkVlans:'10,20' });`);
  assert.deepEqual(r.esiti, ['trunk'], 'il cavo è neutro come prima…');
  assert.deepEqual(r.pastiglie, [], '…ma la legenda delle VLAN non lo elenca');
});

test('con trunk E instradato insieme, resta la sola voce «instradato»', () => {
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1', mode:'trunk', trunkVlans:'10,20' });
    state.links.push({ id:'l2', src:'a-2', dst:'b-2' });
    state.ports['a-2'] = { ownsIp:true };`);
  assert.deepEqual(r.esiti, ['trunk', 'routed']);
  assert.deepEqual(r.pastiglie, ['instradato']);
});

test('se ogni cavo ha la sua VLAN, di pastiglie neutre non ce n’è nessuna', () => {
  // La riprova del riconoscitore: se la voce comparisse sempre, il primo test
  // passerebbe lo stesso e non proverebbe niente.
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1' });
    state.ports['a-1'] = { vlan:10 };`);
  assert.deepEqual(r.esiti, ['vlan']);
  assert.deepEqual(r.pastiglie, []);
});
