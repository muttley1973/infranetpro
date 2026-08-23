'use strict';
// ============================================================================
// La legenda delle VLAN contiene VLAN — e una sola voce che non lo è
// ============================================================================
// C'era una voce, «senza colore VLAN», che copriva tutti i cavi neutri: un
// etichetta definita per ASSENZA, in un modello dove ormai un cavo che commuta
// un colore ce l'ha sempre. È stata tolta.
//
// Restano due voci che VLAN non sono, e sono diverse fra loro:
//   • l'**INSTRADATO** è una PILLOLA come le VLAN — stessa classe, stesso stato
//     attivo, stesso clic: «mostra solo questi cavi». Descrive un INSIEME, quindi
//     si può abitare. L'etichetta è corta («L3») perché la banda è piena; la parola
//     per esteso apre il tooltip.
//   • la **CONTESA fra i capi** resta di sola lettura (`topo-leg-novlan`): è un
//     reperto da chiudere, non una vista da abitare.
// Il trunk non è fra queste: il suo bottone in topologia lo evidenzia meglio di una
// pastiglia, e il colore si cambia dalle Proprietà del cavo — quindi in legenda non
// ci va, perché quella è la legenda delle VLAN e un trunk non è una VLAN.
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
  // Le voci NON-VLAN della legenda: la contesa (`topo-leg-novlan`, sola lettura) e
  // l'instradato, che ora è una pillola come le VLAN (`topo-leg-vlan` + data-routed)
  // perché si può FILTRARE. Si leggono tutt'e due, nell'ordine di resa.
  const out2 = [];
  const re = /class="topo-leg-(?:novlan|vlan)[^"]*"(?:(?!<\/span>).)*?data-routed[\s\S]*?<\/span>([^<]*)<\/span>|class="topo-leg-novlan"[\s\S]*?<\/span>([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(out.html))) out2.push((m[1] !== undefined ? m[1] : m[2]).trim());
  // ⚠️ `out.esiti` arriva dal realm della VM dello stub: e' un Array con un altro
  // prototipo, e `deepEqual` strict lo rifiuta pur avendo lo stesso contenuto
  // («same structure but not reference-equal»). Si ricopia in questo realm.
  return { pastiglie: out2, esiti: Array.from(out.esiti || []) };
}

// ⚠️ L'etichetta è CORTA per stare in una banda già piena di pastiglie VLAN («L3»,
// uguale nelle due lingue perché è la sigla che si usa in rete). La parola per esteso
// vive nel tooltip: una sigla senza il suo scioglimento è un indovinello.
test('un collegamento instradato mette in legenda «L3»', () => {
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1' });
    state.ports['a-1'] = { ownsIp:true };`);
  assert.deepEqual(r.esiti, ['routed']);
  assert.deepEqual(r.pastiglie, ['L3']);
});

test('un trunk NON mette niente in legenda: ha il suo bottone', () => {
  const r = pastiglieNeutre(`state.links.push({ id:'l1', src:'a-1', dst:'b-1', mode:'trunk', trunkVlans:'10,20' });`);
  assert.deepEqual(r.esiti, ['trunk'], 'il cavo è neutro come prima…');
  assert.deepEqual(r.pastiglie, [], '…ma la legenda delle VLAN non lo elenca');
});

test('con trunk E instradato insieme, resta la sola voce «L3»', () => {
  const r = pastiglieNeutre(`
    state.links.push({ id:'l1', src:'a-1', dst:'b-1', mode:'trunk', trunkVlans:'10,20' });
    state.links.push({ id:'l2', src:'a-2', dst:'b-2' });
    state.ports['a-2'] = { ownsIp:true };`);
  assert.deepEqual(r.esiti, ['trunk', 'routed']);
  assert.deepEqual(r.pastiglie, ['L3']);
});

test('la sigla si SCIOGLIE nel tooltip, in entrambe le lingue', () => {
  // Una pastiglia larga due caratteri sta nella banda ma non si spiega da sola: chi
  // non sa cosa sia «L3» deve trovarlo passandoci sopra. La parola per esteso non si
  // traduce da sé — «instradato» in una lingua e «routed» nell'altra — quindi si
  // controllano entrambi i dizionari, non solo quello attivo.
  const dict = require('../lib/i18n.js')._i18nDict;
  for (const [lang, parola] of [['it', 'Instradato'], ['en', 'Routed']]) {
    assert.equal(dict[lang]['legend.routedLink'], 'L3', `[${lang}] la pastiglia resta corta`);
    assert.ok(String(dict[lang]['legend.routedLinkTip'] || '').startsWith(parola + ':'),
      `[${lang}] il tooltip deve APRIRE con «${parola}»: una sigla senza scioglimento è un indovinello`);
  }
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

// ── la pillola INSTRADATO filtra come una VLAN ──────────────────────────────
// «Uguale a una pillola VLAN» non è solo l'aspetto: è il gesto. Un clic mostra
// SOLO i cavi instradati, e siccome vive nella stessa variabile del filtro VLAN,
// accenderla spegne la VLAN attiva — sono mutuamente esclusivi per natura.
function filtro(setup, filtro) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.nodes.push({ id:'a', type:'switch', name:'A', ports:4, integration:{ vlans:[1,10,20] } });
    state.nodes.push({ id:'b', type:'switch', name:'B', ports:4, integration:{ vlans:[1,10,20] } });
    ${setup}
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    _filterVlan = ${JSON.stringify(filtro)};
    return { visti: state.links.filter(_linkMatchesVlanFilter).map(l => l.id),
             esiti: state.links.map(l => _linkPaintVlan(l).kind) };
  })()`);
}

// due cavi: uno instradato (una porta possiede un IP), uno in VLAN 10.
const DUE_CAVI = `
  state.links.push({ id:'rt', src:'a-1', dst:'b-1' });
  state.ports['a-1'] = { ownsIp:true };
  state.links.push({ id:'v10', src:'a-2', dst:'b-2' });
  state.ports['a-2'] = { vlan:10 };`;

test('filtro «L3»: resta solo il cavo instradato', () => {
  const r = filtro(DUE_CAVI, 'routed');
  assert.deepEqual(Array.from(r.esiti), ['routed', 'vlan'], 'la scena è quella attesa');
  assert.deepEqual(Array.from(r.visti), ['rt']);
});

test('filtro «VLAN 10»: l\'instradato NON c\'è (non sta in nessuna VLAN, nemmeno in quella)', () => {
  const r = filtro(DUE_CAVI, 10);
  assert.deepEqual(Array.from(r.visti), ['v10']);
});

test('senza filtro si vedono tutti', () => {
  const r = filtro(DUE_CAVI, null);
  assert.deepEqual(Array.from(r.visti), ['rt', 'v10']);
});

test('la pastiglia instradato porta data-routed: è la pillola che il clic riconosce', () => {
  const html = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.nodes.push({ id:'a', type:'switch', name:'A', ports:4, integration:{ vlans:[1,10,20] } });
    state.nodes.push({ id:'b', type:'switch', name:'B', ports:4, integration:{ vlans:[1,10,20] } });
    state.links.push({ id:'l1', src:'a-1', dst:'b-1' });
    state.ports['a-1'] = { ownsIp:true };
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans(); _renderTopoLegend();
    const el = document.getElementById('topo-legend');
    return el ? (el.innerHTML || '') : '';
  })()`);
  assert.ok(/data-routed="1"/.test(html), 'il clic la trova da lì');
  assert.ok(/class="topo-leg-vlan[^"]*"[^>]*data-routed/.test(html),
    'e porta la classe delle VLAN: stessa forma, stesso stato attivo');
});
