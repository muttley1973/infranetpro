'use strict';
// ============================================================
//  LO STATO DELLA PORTA E I SEGNI DI PROVENIENZA, A SCHERMO
// ============================================================
// `status` non è una misura: lo scrivono il poll, chi tira un cavo e l'import DCIM (lo diceva già il
// commento di lib/port-state.js). La misura che SCADE è `operUp`/`adminDown`. Quattro cose, qui:
//   1. «questa porta è stata letta?» ha UNA definizione (`portMeasured`), condivisa col motore della Verifica;
//   2. il cavo semina «attiva» ma non scavalca una porta misurata, e se ne va senza portarsi via una misura;
//   3. il segno sulla schermata dice «Misurato» solo per ciò che una lettura ha scritto davvero;
//   4. il pannello della porta e il blocco di rete del nodo mostrano il segno per descrizione, indirizzo,
//      stato e MAC — i campi che registravano la provenienza senza che nessuno la mostrasse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const PS = require('../lib/port-state.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// ── 1. le primitive ──────────────────────────────────────────────────────────

test('portMeasured: letta = operUp o adminDown (le due misure che scadono), mai `status`', () => {
  assert.equal(PS.portMeasured({ operUp: true }), true);
  assert.equal(PS.portMeasured({ operUp: false }), true, 'giù misurata è comunque una lettura');
  assert.equal(PS.portMeasured({ adminDown: true }), true);
  assert.equal(PS.portMeasured({ adminDown: false }), true);
  assert.equal(PS.portMeasured({ status: 'active' }), false, '`status` lo scrive anche il cavo');
  assert.equal(PS.portMeasured({ status: 'active', ifName: 'Gi0/1' }), false, 'nemmeno `ifName` (lo scrive l\'import DCIM)');
  assert.equal(PS.portMeasured({}), false);
  assert.equal(PS.portMeasured(null), false);
  assert.equal(PS.portMeasured(undefined), false);
});

test('portMeasured: dopo forgetPortMeasure (l\'apparato ha taciuto) la porta non risulta più letta', () => {
  const pi = { status: 'active', operUp: true, adminDown: false, operWait: 'dormant', downStreak: 2 };
  assert.equal(PS.portMeasured(pi), true);
  PS.forgetPortMeasure(pi);
  assert.equal(PS.portMeasured(pi), false, 'una misura non sopravvive alla prova che la reggeva');
  assert.equal(pi.status, 'active', '`status` resta: non era una misura');
});

test('la Verifica e il segno usano la STESSA definizione (nessuna copia in lib/drift-snapshot.js)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'drift-snapshot.js'), 'utf8');
  assert.ok(/ps\.portMeasured\(pi\)/.test(src), 'drift-snapshot chiede a port-state');
  assert.ok(!/operUp\s*!=\s*null\s*\|\|\s*pi\.adminDown\s*!=\s*null/.test(src), 'la definizione non e\' ricopiata in drift-snapshot');
});

test('seedPortActive: il cavo semina «attiva» su una porta non letta, ma NON scavalca una misura', () => {
  const nuova = {};
  assert.equal(PS.seedPortActive(nuova), true);
  assert.equal(nuova.status, 'active');
  const manuale = { status: 'inactive' };
  assert.equal(PS.seedPortActive(manuale), true, 'una dichiarazione precedente si sovrascrive, come sempre');
  assert.equal(manuale.status, 'active');
  const giu = { status: 'inactive', operUp: false, ifName: 'Gi0/1' };
  assert.equal(PS.seedPortActive(giu), false, 'lo switch ha detto «giù»: un cavo disegnato non lo contraddice');
  assert.equal(giu.status, 'inactive');
  const spenta = { status: 'inactive', adminDown: true };
  assert.equal(PS.seedPortActive(spenta), false);
  assert.equal(spenta.status, 'inactive');
});

test('seedPortActive(onlyIfEmpty): riempie solo dove manca uno stato', () => {
  const a = {}; assert.equal(PS.seedPortActive(a, true), true); assert.equal(a.status, 'active');
  const b = { status: 'inactive' }; assert.equal(PS.seedPortActive(b, true), false); assert.equal(b.status, 'inactive');
  assert.equal(PS.seedPortActive(null, true), false);
});

test('releasePortActive: l\'ultimo cavo tolto porta via lo stato seminato, non quello misurato', () => {
  const seminata = { status: 'active' };
  assert.equal(PS.releasePortActive(seminata), true);
  assert.ok(!('status' in seminata));
  const letta = { status: 'active', operUp: true };
  assert.equal(PS.releasePortActive(letta), false, 'cancellare una lettura per aver tolto un disegno la perderebbe');
  assert.equal(letta.status, 'active');
  assert.equal(PS.releasePortActive({}), false);
  assert.equal(PS.releasePortActive(null), false);
});

test('portStatusSource: la persona vince; altrimenti è misurato solo se la porta è stata letta', () => {
  assert.equal(PS.portStatusSource({ status: 'active', operUp: true }), 'measured');
  assert.equal(PS.portStatusSource({ status: 'inactive', operUp: false }), 'measured');
  assert.equal(PS.portStatusSource({ status: 'active' }), 'declared', 'seminato dal cavo o dall\'import: non letto');
  assert.equal(PS.portStatusSource({ status: 'active', operUp: true, statusOvr: 'inactive' }), 'declared', 'la dichiarazione della persona vince');
  assert.equal(PS.portStatusSource({ statusOvr: 'fault' }), 'declared');
  assert.equal(PS.portStatusSource({}), null);
  assert.equal(PS.portStatusSource({ operUp: true }), null, 'nessuno stato scritto: niente da attribuire');
  assert.equal(PS.portStatusSource(null), null);
});

// ── 2. a schermo ─────────────────────────────────────────────────────────────

let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });
const J = (code) => JSON.parse(run(APP.ctx, '(() => { try { ' + code + ' } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()'));

function htmlPorta(porta) {
  const r = J(`
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true; state.ports = state.ports || {};
    state.nodes.push({ id:'zs1', type:'switch', name:'ZS-1', ports:4, ip:'10.0.0.1', x:10, y:10 });
    state.ports['zs1-1'] = ${JSON.stringify(porta)};
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='port'; selId='zs1-1'; renderProps();
    return JSON.stringify({ ok:true, html: document.getElementById('props-panel').innerHTML || '' });`);
  assert.ok(r.ok, r.err);
  return r.html;
}
function htmlNodo(nodo) {
  const r = J(`
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true;
    state.nodes.push(Object.assign({ id:'zs2', type:'switch', name:'ZS-2', ports:4, ip:'10.0.0.2', x:10, y:10 }, ${JSON.stringify(nodo)}));
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='zs2'; renderProps();
    return JSON.stringify({ ok:true, html: document.getElementById('props-panel').innerHTML || '' });`);
  assert.ok(r.ok, r.err);
  return r.html;
}
/** Il grado del segno nell'ETICHETTA che precede il controllo `marcatore` (null = nessun segno). */
function segnoPrima(html, marcatore) {
  const i = html.indexOf(marcatore);
  assert.ok(i >= 0, 'il controllo ' + marcatore + ' non e\' nel pannello');
  const prima = html.slice(0, i);
  const lab = prima.slice(prima.lastIndexOf('<label>'));
  const m = lab.match(/class="cty-mark cty-(\w+)"/);
  return m ? m[1] : null;
}

test('porta: la descrizione copiata da una lettura è «Misurato»; quella scritta a mano «Dichiarato»; vuota nessun segno', () => {
  const D = 'data-pfield="desc"';
  assert.equal(segnoPrima(htmlPorta({ desc: 'Uplink verso il core', copiedFromRead: { desc: true } }), D), 'measured');
  assert.equal(segnoPrima(htmlPorta({ desc: 'Sala server' }), D), 'declared');
  assert.equal(segnoPrima(htmlPorta({}), D), null);
  assert.equal(segnoPrima(htmlPorta({ desc: 'x', copiedFromRead: { ip: true } }), D), 'declared', 'la marca e\' per campo');
});

test('porta: l\'indirizzo dell\'interfaccia copiato da una lettura è «Misurato»; scritto a mano «Dichiarato»', () => {
  const I = 'data-pfield="ip"';
  assert.equal(segnoPrima(htmlPorta({ ip: '10.0.0.2', copiedFromRead: { ip: true } }), I), 'measured');
  assert.equal(segnoPrima(htmlPorta({ ip: '192.168.1.9' }), I), 'declared');
  assert.equal(segnoPrima(htmlPorta({}), I), null);
});

test('porta: lo STATO è «Misurato» solo se la porta è stata letta; seminato dal cavo o scelto dalla persona è «Dichiarato»', () => {
  const S = 'data-pfield="statusOvr"';
  assert.equal(segnoPrima(htmlPorta({ status: 'active', operUp: true }), S), 'measured');
  assert.equal(segnoPrima(htmlPorta({ status: 'inactive', operUp: false }), S), 'measured');
  assert.equal(segnoPrima(htmlPorta({ status: 'active' }), S), 'declared', 'il caso di SW-CORE nel lab: «attiva» senza alcuna misura');
  assert.equal(segnoPrima(htmlPorta({ status: 'active', operUp: true, statusOvr: 'inactive' }), S), 'declared');
  assert.equal(segnoPrima(htmlPorta({}), S), null);
});

test('porta: la legenda compare quando c\'è qualcosa da spiegare, non su una porta vuota', () => {
  assert.ok(/cty-legend/.test(htmlPorta({ desc: 'x', copiedFromRead: { desc: true } })));
  assert.ok(!/cty-legend/.test(htmlPorta({})), 'nessun valore, nessun segno da spiegare');
});

test('nodo: il MAC copiato da una lettura è «Misurato»; scritto a mano «Dichiarato»; vuoto nessun segno', () => {
  const M = 'data-field="mac"';
  assert.equal(segnoPrima(htmlNodo({ mac: 'AA:BB:CC:DD:EE:01', copiedFromRead: { mac: true } }), M), 'measured');
  assert.equal(segnoPrima(htmlNodo({ mac: 'AA:BB:CC:DD:EE:02' }), M), 'declared');
  assert.equal(segnoPrima(htmlNodo({}), M), null);
});

test('nodo: in «Rete & Accesso» c\'è il punto del MAC ma NON una legenda per un solo campo', () => {
  // Un solo segno non vale una riga di legenda su ogni apparato con un MAC: il suggerimento del punto
  // basta, e l'alfabeto si impara nel blocco identità e nel pannello porta, dove i campi sono più d'uno.
  const html = htmlNodo({ mac: 'AA:BB:CC:DD:EE:04', copiedFromRead: { mac: true } });
  const rete = html.slice(html.indexOf('data-section="network-access"'));
  const finoAlMac = rete.slice(0, rete.indexOf('data-field="mac"'));
  assert.ok(!/cty-legend/.test(finoAlMac), 'nessuna legenda prima del MAC nel blocco di rete');
});

test('nodo: la marca del MAC non si confonde con quella delle altre quattro identità', () => {
  const html = htmlNodo({ mac: 'AA:BB:CC:DD:EE:03', model: 'GS1900', copiedFromRead: { model: true } });
  assert.equal(segnoPrima(html, 'data-field="mac"'), 'declared');
  assert.equal(segnoPrima(html, 'data-field="model"'), 'measured', 'il modello e\' marcato e nessun apparato lo smentisce: letto, non digitato');
});

// ── nessuna cancellazione grezza dello stato ─────────────────────────────────

test('nessuna `delete …ports[…].status` in src/: lo stato si rilascia con releasePortActive', () => {
  // La cancellazione e' un modo di SCRIVERE: `_refreshPortActiveState` cancellava anche uno stato misurato
  // quando un cavo spariva. Solo l'helper sa distinguere il seme dalla lettura.
  const dir = path.join(ROOT, 'src');
  const trovate = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((riga, i) => {
      if (/^\s*(\/\/|\*)/.test(riga)) return;
      if (/\bdelete\s+(?:store\.state\.|state\.)?ports\[[^\]]+\]\.status\b/.test(riga)) trovate.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(trovate, [], 'cancellazioni grezze dello stato di una porta: usa releasePortActive (lib/port-state.js)');
});
