'use strict';
// ============================================================
//  IL FRONTALE DI UN CASSETTO COMPOSTO: UN MODULO PER SLOT, NEL RACK
// ============================================================
// Il cassetto uniforme e' provato in fiberdrawer-front.test.js; qui c'e' quello con `spec.fdSlots`: ogni slot ha il SUO
// modulo (fori, celle, altezza) e la lastra cieca e' uno slot senza porte. Le porte vengono dai moduli (di seguito,
// dall'alto): `ports` del nodo e' la somma, come lo scrive il compositore.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function frontale(extra, ports) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState();
    _propsExplicit = true;
    const node = Object.assign({ id: 'fd1', type: 'fiberdrawer', name: 'ODF', rackId: state.currentRack, rackU: 1, sizeU: 1, ports: ${ports} }, ${JSON.stringify(extra || {})});
    state.nodes.push(node);
    state.ports = Object.assign(state.ports || {}, ${JSON.stringify((extra && extra.__ports) || {})});
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    renderAll();
    const rack = document.getElementById('rack-chassis');
    const device = (rack.children || []).find(item => item.dataset && item.dataset.id === node.id);
    return device ? device.innerHTML : '';
  })()`);
}
const conta = (html, re) => (html.match(re) || []).length;
const comp = (slots, extra) => Object.assign({ spec: Object.assign({ ppFiberConnector: 'lc-duplex', fdSlots: slots }, (extra && extra.spec) || {}) }, extra && { frontPanel: extra.frontPanel, sizeU: extra.sizeU, __ports: extra.__ports });
// I «pid» disegnati, nell'ordine
const pidDi = (html) => (html.match(/data-pid="fd1-(\d+)"/g) || []).map((s) => Number(/-(\d+)"/.exec(s)[1]));

test('un modulo diverso per slot: ognuno ha i suoi fori e le sue porte', () => {
  // LC duplex · SC · MTP/MPO-12 · lastra · SC duplex
  const html = frontale(comp(['lc-duplex', 'sc', 'mpo-12', 'blank', 'sc-duplex']), 4);
  assert.equal(conta(html, /<div class="port-led fo-slot fo-lc2[^"]*" data-pid="fd1-1"/g), 1, 'slot 1: LC duplex');
  assert.equal(conta(html, /<div class="port-led fo-slot fo-big[^"]*" data-pid="fd1-2"/g), 1, 'slot 2: SC');
  assert.equal(conta(html, /<div class="port-led fo-slot fo-mpo[^"]*" data-pid="fd1-3"/g), 1, 'slot 3: MPO');
  assert.equal(conta(html, /<div class="port-led fo-slot fo-big2[^"]*" data-pid="fd1-4"/g), 1, 'slot 5: SC duplex (la lastra non ha porta: e\' la 4)');
  assert.deepEqual(pidDi(html), [1, 2, 3, 4], 'le porte si numerano di seguito, saltando la lastra');
  assert.equal(conta(html, /class="rack-ports[ "]/g), 1, 'una fila sola');
});

test('la lastra cieca e\' uno slot senza porta: niente pid, niente numero, niente fori', () => {
  const html = frontale(comp(['sc', 'blank', 'sc']), 2);
  assert.equal(conta(html, /fo-plate/g), 1);
  const lastra = /<div class="rack-port-unit fo-module fo-k0 fo-plate[^"]*">([\s\S]*?)<\/div><\/div>/.exec(html);
  assert.ok(lastra, 'la lastra c\'e\'');
  assert.doesNotMatch(lastra[0], /data-pid|port-num|<circle|<rect/);
  assert.equal(conta(html, /<span class="port-num"/g), 2, 'un numero per ogni porta, nessuno per la lastra');
  // sta fra i due SC: l'ordine degli slot e' quello dell'elenco
  assert.ok(html.indexOf('fd1-1') < html.indexOf('fo-plate') && html.indexOf('fo-plate') < html.indexOf('fd1-2'));
});

test('un modulo a piu\' celle (quad) accanto a uno semplice: celle col loro pid, numero = la prima porta, il tratto nel titolo', () => {
  const html = frontale(comp(['sc', 'lc-quad', 'sc']), 4);
  assert.equal(conta(html, /fo-module fo-k2/g), 1, 'il quad col porta duplex ha 2 celle');
  assert.deepEqual(pidDi(html), [1, 2, 3, 4]);
  assert.match(html, /<span class="port-num" title="2-3">2<\/span>/, 'il modulo dice la prima porta e il tratto');
  assert.equal(conta(html, /fo-cell fo-lc2/g), 2, 'due celle da due fori');
  assert.equal(conta(html, /<circle /g), 1 + 4 + 1, 'SC 1 foro · quad 2 celle da 2 fori · SC 1 foro');
});

test('l\'altezza e\' UNA per tutti: con un quad nel cassetto anche gli slot semplici sono alti e i loro fori stanno al centro', () => {
  const html = frontale(comp(['lc-duplex', 'lc-quad', 'mpo-12']), 4);
  for (const kind of ['lc2', 'mpo']) assert.match(html, new RegExp(`<div class="port-led fo-slot fo-${kind} fo-tall`), `${kind}: scatola alta`);
  assert.match(html, /viewBox="0 0 192\.31 396\.63"[^>]*><circle cx="96\.15" cy="129\.08" r="32"\/><circle cx="96\.15" cy="267\.54" r="32"\/>/, 'i due fori dell\'LC duplex stanno intorno al centro della scatola alta (198,3)');
  // senza il quad restano bassi
  const basso = frontale(comp(['lc-duplex', 'mpo-12']), 2);
  assert.equal(conta(basso, /fo-tall/g), 0);
  assert.match(basso, /viewBox="0 0 192\.31 290\.6"/);
});

test('un cassetto composto di sole lastre ha 0 porte e si disegna lo stesso (cassetto vuoto)', () => {
  const html = frontale(comp(['blank', 'blank', 'blank']), 0);
  assert.equal(conta(html, /fo-plate/g), 3);
  assert.equal(conta(html, /data-pid/g), 0);
});

test('lo stato della porta colora la sua cella anche nel cassetto composto', () => {
  const html = frontale(comp(['sc', 'lc-quad'], { __ports: { 'fd1-2': { statusOvr: 'active' }, 'fd1-3': { statusOvr: 'fault' } } }), 3);
  assert.match(html, /<div class="port-led fo-cell fo-lc2 active[^"]*" data-pid="fd1-2"/);
  assert.match(html, /<div class="port-led fo-cell fo-lc2 fault[^"]*" data-pid="fd1-3"/);
});

test('la porta = singolo connettore cambia le celle dei moduli: il quad ne ha 4', () => {
  const html = frontale(comp(['lc-quad', 'sc', 'blank', 'lc-duplex'], { spec: { ppFiberPortUnit: 'single' } }), 4 + 1 + 0 + 2);
  assert.equal(conta(html, /fo-module fo-k4/g), 1);
  assert.equal(conta(html, /fo-module fo-k2/g), 1, 'anche l\'LC duplex diventa 2 celle');
  assert.deepEqual(pidDi(html), [1, 2, 3, 4, 5, 6, 7]);
});

test('file: 24 slot a fila e una per U; oltre le U vale il frontale generico di sempre', () => {
  const trenta = new Array(30).fill('sc');
  assert.equal(conta(frontale(comp(trenta), 30), /fo-slot/g), 0, '30 slot in 1U: non entrano, LED generici');
  assert.equal(conta(frontale(comp(trenta), 30), /data-pid="fd1-\d+"/g), 30, 'le porte ci sono tutte');
  const due = frontale(comp(trenta, { sizeU: 2 }), 30);
  assert.equal(conta(due, /fo-slot/g), 30, 'a 2U ci stanno: due file');
  assert.equal(conta(due, /class="rack-ports-row"/g), 2);
  assert.equal(conta(due, /rack-ports-2row/g), 1);
  const lineare = frontale(comp(trenta, { frontPanel: { baseLayout: 'linear' } }), 30);
  assert.equal(conta(lineare, /fo-slot/g), 30, 'lineare: una fila anche se larga');
  assert.equal(conta(lineare, /rack-ports-2row/g), 0);
});

test('chi sceglie le due righe di LED a mano le ottiene anche con un cassetto composto', () => {
  const html = frontale(comp(['sc', 'blank', 'sc'], { frontPanel: { baseLayout: 'alternating' } }), 2);
  assert.equal(conta(html, /fo-slot|fo-plate/g), 0);
  assert.equal(conta(html, /data-pid="fd1-\d+"/g), 2);
});

test('una voce che non e\' un modulo non diventa un connettore inventato: torna a quello del cassetto', () => {
  const html = frontale(comp(['sc', 'e2000', 'lc-simplex']), 3);
  assert.equal(conta(html, /fo-lc2/g) > 0, true, 'e2000 e LC simplex tornano LC duplex, il connettore dichiarato');
  assert.equal(conta(html, /fo-big/g), 1);
});

test('un cassetto composto in un patch panel non cambia niente: la composizione e\' del cassetto', () => {
  const html = frontale({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'lc-duplex', fdSlots: ['sc', 'mpo-12'] } }, 24);
  assert.equal(conta(html, /fo-slot|fo-plate|<circle /g), 0);
  assert.equal(conta(html, /data-pid="fd1-\d+"/g), 24);
});

test('senza composizione il cassetto e\' quello di prima: lo stesso HTML di una composizione che non c\'e\'', () => {
  const uniforme = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, 48);
  const vuota = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex', fdSlots: [] } }, 48);
  assert.equal(uniforme, vuota, 'un elenco vuoto non e\' una composizione');
  assert.equal(conta(uniforme, /fo-module fo-k2/g), 24);
});

test('un modulo senza la sua porta (porte dichiarate meno dei moduli) e\' una lastra: niente porta fantasma', () => {
  const html = frontale(comp(['sc', 'sc', 'sc']), 2);
  assert.deepEqual(pidDi(html), [1, 2], 'solo le porte che esistono');
  assert.equal(conta(html, /fo-plate/g), 1, 'il terzo slot si disegna come lastra');
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('con un quad nel cassetto anche la lastra cieca e\' alta (altezza unica); senza, resta bassa', () => {
  const alto = frontale(comp(['lc-quad', 'blank']), 2);
  assert.match(alto, /fo-plate fo-tall/, 'la lastra segue la scatola alta');
  const basso = frontale(comp(['lc-duplex', 'blank']), 1);
  assert.doesNotMatch(basso, /fo-plate fo-tall/);
  assert.match(basso, /fo-plate/);
});

// Le righe di NUMERI di porta (le usa il render per la densita' del frontale): una fila per fila di slot, i moduli a piu' celle con
// tutte le loro porte, le lastre senza.
function righe(extra, ports) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState();
    const node = Object.assign({ id: 'fd1', type: 'fiberdrawer', rackId: state.currentRack, rackU: 1, sizeU: 1, ports: ${ports} }, ${JSON.stringify(extra)});
    return JSON.stringify(_frontPanelRows(node, ${ports}));
  })()`);
}
test('righe di porte: i moduli a piu\' celle danno tutte le loro porte, le lastre nessuna, una fila per fila di slot', () => {
  assert.equal(righe(comp(['sc', 'lc-quad', 'blank', 'mpo-12']), 4), '[[1,2,3,4]]');
  assert.equal(righe({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' } }, 48), JSON.stringify([Array.from({ length: 48 }, (_, i) => i + 1)]), 'uniforme: come prima');
  const trenta = new Array(30).fill('sc');
  assert.equal(JSON.parse(righe(comp(trenta, { sizeU: 2 }), 30)).map((r) => r.length).join(), '24,6');
  assert.equal(righe(comp(['blank', 'blank']), 0), '[[]]', 'solo lastre: una fila senza porte');
});

test('fdSlots e\' un campo spec: nei progetti con l\'elenco sul nodo, caricandoli finisce in spec', () => {
  const r = run(APP.ctx, `(() => {
    const s = _buildDefaultState();
    s.nodes.push({ id: 'fd1', type: 'fiberdrawer', rackId: s.currentRack, rackU: 1, sizeU: 1, ports: 2, fdSlots: ['sc', 'mpo-12'], ppFiberConnector: 'sc' });
    if (typeof _migrateState === 'function') _migrateState(s);
    const n = s.nodes.find((x) => x.id === 'fd1');
    return JSON.stringify({ spec: n.spec && n.spec.fdSlots, top: n.fdSlots });
  })()`);
  assert.deepEqual(JSON.parse(r), { spec: ['sc', 'mpo-12'] });
});
