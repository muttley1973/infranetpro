'use strict';
// ============================================================
//  IL PANNELLO PROPRIETA' DI UN CASSETTO COMPOSTO: I MODULI A PAROLE, IL PULSANTE, LE PORTE DERIVATE
// ============================================================
// Un cassetto uniforme ha UN connettore (tendina) e, se serve, l'unita' di conto. Uno composto ha un modulo per slot:
// al posto delle due tendine ci sono i moduli a parole e il pulsante «Componi slot» (lo stesso pulsante, con un
// connettore dichiarato, e' anche nel cassetto uniforme: da li' si parte). Le porte di un cassetto composto vengono
// dai moduli: il campo «Numero porte» non si scrive a mano.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function pannello(nodo) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    _propsExplicit = true;
    const n = Object.assign({ id: 'fd1', type: 'fiberdrawer', rackId: state.currentRack, rackU: 1, sizeU: 1, ports: 24, name: 'ODF' }, ${JSON.stringify(nodo)});
    state.nodes.push(n);
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    selType = 'node'; selId = 'fd1'; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
}
const sezione = (html) => (/<details[^>]*data-section="device-fiberdrawer"[\s\S]*?<\/details>/.exec(html) || [''])[0];
const COMPONI = /<button[^>]*data-act="fd-compose"[^>]*data-nid="fd1"[^>]*>/;
const CAMPO_PORTE = /<input[^>]*data-nfield="ports"[^>]*>/;

const composto = { ports: 8, spec: { ppFiberConnector: 'lc-duplex', fdSlots: ['lc-duplex', 'lc-duplex', 'lc-quad', 'lc-quad', 'blank', 'blank', 'mpo-12', 'sc-duplex'] } };

// La sezione e' composta su una GABBIA a 12 colonne (design «B, due colonne»): righe `.fd-row` che dividono lo spazio a meta',
// poi le tessere dei moduli (due colonne), poi il pulsante a tutta larghezza. Qui si legge la STRUTTURA, non il dettaglio.
// Le tessere dei moduli: [intervallo, nome] — `.fd-chip` > `.fd-chip-n` + `.fd-chip-sw` (il colore della famiglia) + `.fd-chip-name`.
const TESSERE = (s) => [...s.matchAll(/<div class="fd-chip"[^>]*><span class="fd-chip-n">([^<]*)<\/span><span class="fd-chip-sw[^"]*"[^>]*><\/span><span class="fd-chip-name">([^<]*)<\/span><\/div>/g)].map((m) => [m[1], m[2]]);
// Il riepilogo: tre numeri, ognuno col suo nome — «8 porte · 8 slot · 26 fibre».
const CONTI = (s) => [...s.matchAll(/<div class="fd-stat"><b>(\d+)<\/b> <span>([^<]*)<\/span><\/div>/g)].map((m) => m[1] + ' ' + m[2]).join(' · ');
const RIGA = /<div class="fd-row(?: fd-row-stats)?">/;   // la riga col riepilogo ha una soglia di impilamento sua (`fd-row-stats`)
const righe = (s) => s.split(RIGA).slice(1);

test('cassetto composto: le tessere dei moduli al posto della tendina del connettore, la classe di fibra resta', () => {
  const s = sezione(pannello(composto));
  assert.deepEqual(TESSERE(s), [['1–2', 'LC duplex'], ['3–4', 'LC quad'], ['5–6', 'vuoti'], ['7', 'MTP/MPO-12'], ['8', 'SC duplex']]);
  assert.doesNotMatch(s, /data-nfield="ppFiberConnector"/, 'non c\'e\' UN connettore: la tendina non c\'e\'');
  assert.match(s, /data-nfield="ppFiberMode"/, 'la classe di fibra e\' del cassetto');
});

test('cassetto composto: ogni tessera ha il colore della sua famiglia (lo stesso del compositore) e la lastra e\' tratteggiata', () => {
  const s = sezione(pannello(composto));
  const sw = [...s.matchAll(/class="fd-chip-sw fdc-box fdc-k-([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sw, ['lc-duplex', 'lc-quad', 'blank', 'mpo-12', 'sc-duplex']);
});

test('cassetto composto: niente tendina «una porta e\'» (la sceglie il compositore) e il conto dice le porte, gli slot e le fibre', () => {
  const s = sezione(pannello(composto));
  assert.doesNotMatch(s, /data-nfield="ppFiberPortUnit"/);
  // 1+1+2+2+0+0+1+1 = 8 porte; fibre 2+2+4+4+12+2 = 26
  assert.equal(CONTI(s), '8 porte · 8 slot · 26 fibre');
});

test('cassetto composto: le lastre si contano sopra le tessere, e la frase intera sta nel suggerimento del riepilogo', () => {
  const s = sezione(pannello(composto));
  assert.match(s, /class="fd-modules-empty">2 vuoti</);
  assert.match(s, /class="fd-stats"[^>]*title="8 porte · 8 slot \(2 vuoti\) · 26 fibre"/);
  assert.doesNotMatch(sezione(pannello({ ports: 2, spec: { ppFiberConnector: 'sc', fdSlots: ['sc', 'mpo-12'] } })), /fd-modules-empty/, 'senza lastre non c\'e\' niente da contare');
});

test('cassetto composto: prima riga = classe di fibra e riepilogo (6 + 6), poi le tessere, poi il pulsante a tutta larghezza', () => {
  const s = sezione(pannello(composto));
  const r = righe(s);
  assert.equal(r.length, 1, 'una sola riga a due colonne: classe di fibra | riepilogo');
  assert.ok(r[0].indexOf('data-nfield="ppFiberMode"') > -1 && r[0].indexOf('class="fd-stats"') > r[0].indexOf('data-nfield="ppFiberMode"'), 'la classe di fibra a sinistra, il riepilogo a destra');
  const iRiga = s.search(RIGA), iTessere = s.indexOf('class="fd-modules"'), iBottone = s.search(COMPONI);
  assert.ok(iRiga > -1 && iRiga < iTessere && iTessere < iBottone, 'ordine: riga, tessere, pulsante');
  assert.match(s, /<div class="fd-compose">\s*<button[^>]*data-act="fd-compose"/, 'il pulsante sta nel suo blocco a tutta larghezza');
});

test('cassetto composto: il pulsante «Componi slot» c\'e\' e porta l\'id del nodo', () => {
  const s = sezione(pannello(composto));
  assert.match(s, COMPONI);
  assert.match(s, /Componi slot…/);
});

test('cassetto composto: il numero di porte non si scrive a mano, e dice perche\'', () => {
  const html = pannello(composto);
  assert.match(CAMPO_PORTE.exec(html)[0], /\sdisabled/);
  assert.match(html, /class="fd-ports-derived"[^>]*>.*Le porte vengono dai moduli/);
});

test('cassetto uniforme con un connettore dichiarato: tendina e pulsante, porte scrivibili, niente moduli a parole', () => {
  const html = pannello({ spec: { ppFiberConnector: 'lc-quad' } });
  const s = sezione(html);
  assert.match(s, /data-nfield="ppFiberConnector"/);
  assert.match(s, /data-nfield="ppFiberPortUnit"/, 'il quad ha l\'unita\' di conto');
  assert.match(s, COMPONI);
  assert.doesNotMatch(s, /fd-modules/);
  assert.doesNotMatch(CAMPO_PORTE.exec(html)[0], /disabled/);
  assert.doesNotMatch(html, /fd-ports-derived/);
});

test('cassetto uniforme: connettore | classe sulla prima riga, «una porta e\'» | riepilogo sulla seconda — le stesse due colonne', () => {
  const r = righe(sezione(pannello({ spec: { ppFiberConnector: 'lc-quad' } })));
  assert.equal(r.length, 2);
  assert.ok(r[0].indexOf('data-nfield="ppFiberConnector"') > -1 && r[0].indexOf('data-nfield="ppFiberMode"') > r[0].indexOf('data-nfield="ppFiberConnector"'));
  assert.ok(r[1].indexOf('data-nfield="ppFiberPortUnit"') > -1 && r[1].indexOf('class="fd-stats"') > r[1].indexOf('data-nfield="ppFiberPortUnit"'));
  // 24 porte «duplex» su moduli LC quad (due duplex per modulo): 12 slot, 48 LC
  assert.equal(CONTI(r[1]), '24 porte · 12 slot · 48 fibre');
});

test('cassetto uniforme senza tendina «una porta e\'»: il riepilogo sta da solo sulla seconda riga', () => {
  const s = sezione(pannello({ spec: { ppFiberConnector: 'sc' } }));
  const r = righe(s);
  assert.equal(r.length, 2);
  assert.doesNotMatch(r[1], /<select/);
  assert.equal(CONTI(r[1]), '24 porte · 24 slot · 24 fibre');
});

test('senza un connettore dichiarato la sezione e\' una riga sola (connettore | classe): niente riepilogo, niente da inventare', () => {
  const s = sezione(pannello({}));
  assert.equal(righe(s).length, 1);
  assert.doesNotMatch(s, /fd-stat|fd-chip|fd-over/);
});

test('le righe col riepilogo si chiamano `fd-row-stats` (tre conti in mezza riga si impilano prima di due tendine), le altre no', () => {
  const comp = sezione(pannello(composto));
  assert.match(comp, /<div class="fd-row fd-row-stats">/, 'composto: classe | riepilogo');
  const uni = sezione(pannello({ spec: { ppFiberConnector: 'lc-quad' } }));
  assert.match(uni, /<div class="fd-row"><div class="prop-group"><label>Connettore fibra/, 'uniforme: connettore | classe, riga semplice');
  assert.match(uni, /<div class="fd-row fd-row-stats"><div class="prop-group"><label>Una porta/, 'uniforme: «una porta e\'» | riepilogo');
  assert.doesNotMatch(sezione(pannello({})), /fd-row-stats/, 'senza riepilogo nessuna riga lo ha');
});

test('composto oltre le U: l\'avviso sta fra la riga e le tessere (a 8 px dalla riga, non nel mezzo dei moduli)', () => {
  const s = sezione(pannello({ ports: 30, spec: { ppFiberConnector: 'sc', fdSlots: new Array(30).fill('sc') } }));
  assert.match(s, /class="fd-over"/);
  assert.ok(s.search(RIGA) < s.indexOf('class="fd-over"') && s.indexOf('class="fd-over"') < s.indexOf('class="fd-modules"'), 'riga, avviso, tessere');
  assert.ok(s.indexOf('class="fd-modules"') < s.search(COMPONI), 'e poi il pulsante');
});

test('l\'avviso «oltre N slot» sta sotto il riepilogo, a tutta larghezza, e non sposta le colonne', () => {
  const s = sezione(pannello({ ports: 96, spec: { ppFiberConnector: 'lc-duplex' } }));
  assert.match(s, /<div class="fd-over"><i class="fas fa-triangle-exclamation"><\/i>Oltre 24 slot \(1U × 24\)/);
  assert.ok(s.indexOf('class="fd-over"') > s.indexOf('class="fd-stats"'), 'l\'avviso viene dopo il riepilogo');
  assert.equal(CONTI(s), '96 porte · 96 slot · 192 fibre', '96 porte LC duplex = 96 slot da un duplex = 192 fibre');
});

test('senza un connettore dichiarato non c\'e\' da dove partire: niente pulsante (non si indovina)', () => {
  assert.doesNotMatch(sezione(pannello({})), /fd-compose/);
  assert.doesNotMatch(sezione(pannello({ spec: { ppFiberConnector: 'lc-simplex' } })), /fd-compose/, 'LC simplex non e\' un modulo');
});

test('un patch panel non ha il compositore, anche se ha una composizione nei dati', () => {
  const html = pannello({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'lc-duplex', fdSlots: ['sc', 'mpo-12'] } });
  assert.doesNotMatch(html, /fd-compose|fd-modules|fd-ports-derived/);
  assert.doesNotMatch(CAMPO_PORTE.exec(html)[0], /disabled/);
});

test('il patch panel in fibra non e\' toccato dalla gabbia: le sue due tendine restano affiancate (connettore, poi classe) nella riga di sempre', () => {
  const html = pannello({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'lc-duplex' } });
  const m = /<div class="prop-row2">\s*<div class="prop-group"><label>Connettore fibra<\/label>[\s\S]*?data-nfield="ppFiberConnector"[\s\S]*?<\/div>\s*<div class="prop-group"><label>Modalità fibra<\/label>[\s\S]*?data-nfield="ppFiberMode"/.exec(html);
  assert.ok(m, 'connettore a sinistra, classe a destra, dentro .prop-row2');
  assert.doesNotMatch(html, /fd-panel|fd-row|fd-stat|fd-chip/, 'niente della gabbia del cassetto');
});

test('una composizione di sole lastre: 0 porte, e i moduli a parole lo dicono', () => {
  const html = pannello({ ports: 0, spec: { ppFiberConnector: 'sc', fdSlots: ['blank', 'blank', 'blank'] } });
  const s = sezione(html);
  assert.deepEqual(TESSERE(s), [['1–3', 'vuoti']]);
  assert.equal(CONTI(s), '0 porte · 3 slot · 0 fibre');
  assert.match(s, /class="fd-modules-empty">3 vuoti</);
  assert.match(s, COMPONI);
});

test('le tessere non portano markup che arrivi dai dati: una voce ignota torna al connettore dichiarato, e tutto e\' escapato', () => {
  const s = sezione(pannello({ ports: 2, spec: { ppFiberConnector: '<img src=x onerror=alert(1)>', fdSlots: ['<b>x</b>', 'sc'] } }));
  assert.doesNotMatch(s, /<img src=x|<b>x<\/b>/, 'niente markup dai dati');
  assert.match(s, /class="fd-modules"/);
});

test('un solo slot composto e\' «1», non «1–1»', () => {
  assert.deepEqual(TESSERE(sezione(pannello({ ports: 2, spec: { ppFiberConnector: 'sc', fdSlots: ['sc', 'mpo-12'] } }))), [['1', 'SC'], ['2', 'MTP/MPO-12']]);
});

test('ogni tessera ha il suggerimento «intervallo nome» (il nome puo\' non starci in una colonna stretta)', () => {
  const s = sezione(pannello(composto));
  assert.match(s, /<div class="fd-chip" title="3–4 LC quad">/);
  assert.match(s, /<div class="fd-chip" title="5–6 vuoti">/);
});
