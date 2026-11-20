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

test('cassetto composto: i moduli a parole al posto della tendina del connettore, la classe di fibra resta', () => {
  const s = sezione(pannello(composto));
  assert.match(s, /<div class="fd-modules"[^>]*>1–2 LC duplex · 3–4 LC quad · 5–6 vuoti · 7 MTP\/MPO-12 · 8 SC duplex<\/div>/);
  assert.doesNotMatch(s, /data-nfield="ppFiberConnector"/, 'non c\'e\' UN connettore: la tendina non c\'e\'');
  assert.match(s, /data-nfield="ppFiberMode"/, 'la classe di fibra e\' del cassetto');
});

test('cassetto composto: niente tendina «una porta e\'» (la sceglie il compositore) e il conto dice anche le lastre', () => {
  const s = sezione(pannello(composto));
  assert.doesNotMatch(s, /data-nfield="ppFiberPortUnit"/);
  // 1+1+2+2+0+0+1+1 = 8 porte; fibre 2+2+4+4+12+2 = 26
  assert.match(s, /8 porte · 8 slot \(2 vuoti\) · 26 fibre/);
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

test('senza un connettore dichiarato non c\'e\' da dove partire: niente pulsante (non si indovina)', () => {
  assert.doesNotMatch(sezione(pannello({})), /fd-compose/);
  assert.doesNotMatch(sezione(pannello({ spec: { ppFiberConnector: 'lc-simplex' } })), /fd-compose/, 'LC simplex non e\' un modulo');
});

test('un patch panel non ha il compositore, anche se ha una composizione nei dati', () => {
  const html = pannello({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'lc-duplex', fdSlots: ['sc', 'mpo-12'] } });
  assert.doesNotMatch(html, /fd-compose|fd-modules|fd-ports-derived/);
  assert.doesNotMatch(CAMPO_PORTE.exec(html)[0], /disabled/);
});

test('una composizione di sole lastre: 0 porte, e i moduli a parole lo dicono', () => {
  const html = pannello({ ports: 0, spec: { ppFiberConnector: 'sc', fdSlots: ['blank', 'blank', 'blank'] } });
  const s = sezione(html);
  assert.match(s, />1–3 vuoti</);
  assert.match(s, /0 porte · 3 slot \(3 vuoti\) · 0 fibre/);
  assert.match(s, COMPONI);
});

test('i moduli a parole non portano markup che arrivi dai dati: una voce ignota torna al connettore dichiarato, e tutto e\' escapato', () => {
  const s = sezione(pannello({ ports: 2, spec: { ppFiberConnector: '<img src=x onerror=alert(1)>', fdSlots: ['<b>x</b>', 'sc'] } }));
  assert.doesNotMatch(s, /<img src=x|<b>x<\/b>/, 'niente markup dai dati');
  assert.match(s, /class="fd-modules"/);
});

test('un solo slot composto e\' «1», non «1–1»', () => {
  assert.match(sezione(pannello({ ports: 2, spec: { ppFiberConnector: 'sc', fdSlots: ['sc', 'mpo-12'] } })), />1 SC · 2 MTP\/MPO-12</);
});
