'use strict';
// ============================================================
//  «DEVICE» NELLA BARRA = APPARATI, NON ELEMENTI DOCUMENTATI
// ============================================================
// Il progetto 24 diceva «36 Device» con 33 apparati: gli altri tre erano due prese a
// muro e un patch panel, elementi di cablaggio che non hanno un indirizzo, e che nessuno
// chiamerebbe «device». Il numero era corretto per il suo tooltip («36 elementi
// documentati, di cui 3 passivi») e sbagliato per la sua etichetta.
//
// Un device e' un APPARATO che ha, o puo' avere, un indirizzo IP: la stessa definizione
// («indirizzabile») che la «Documentazione %» e la Panoramica usano gia' come
// denominatore. Si contano i NODI, mai i MAC: un apparato con piu' schede di rete ha
// piu' MAC e resta uno.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

/** { value, tip } della voce «Device» della barra, per un insieme di nodi e di porte. */
function barra(nodi, porte) {
  const r = JSON.parse(run(APP.ctx, `(() => { try {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    state.nodes.length = 0; state.links.length = 0; state.ports = ${JSON.stringify(porte || {})};
    for (const n of ${JSON.stringify(nodi)}) state.nodes.push(Object.assign({ x: 10, y: 10 }, n));
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    renderSubbar();
    const bar = document.getElementById('modern-subbar');
    const walk = (el, out) => { for (const c of (el.children || [])) { out.push(c); walk(c, out); } return out; };
    // Il browser finto non svuota i figli con innerHTML = '': ogni disegno si accumula, e vale l'ULTIMO.
    const stat = walk(bar, []).filter((e) => /\\bmsb-stat\\b/.test(e.className || '')
      && (e.children || []).some((c) => /msb-stat-l/.test(c.className || '') && c.textContent === 'Device')).pop();
    if (!stat) return JSON.stringify({ ok: false, err: 'la voce Device non e\\' nella barra' });
    const b = (stat.children || []).find((c) => c.tagName === 'B');
    return JSON.stringify({ ok: true, value: b && b.textContent, tip: stat.title });
  } catch (e) { return JSON.stringify({ ok: false, err: String(e && e.message || e) }); } })()`));
  assert.ok(r.ok, r.err);
  return r;
}

const NODI = [
  { id: 'sw1', type: 'switch', name: 'SW-1', ip: '10.0.0.1', ports: 8 },
  { id: 'pc1', type: 'pc', name: 'PC-1', ip: '10.0.0.50' },
  { id: 'ups1', type: 'ups', name: 'UPS-1', ip: '10.0.0.9' },          // passivo di tipo, ma ha un IP: e' un apparato
  { id: 'sw2', type: 'switch', name: 'NetGear' },                      // attivo, senza IP documentato: resta un apparato
  { id: 'wp1', type: 'wallport', name: 'P1' }, { id: 'wp2', type: 'wallport', name: 'P2' },
  { id: 'pp1', type: 'patchpanel', name: 'PP-1' },
  { id: 'room1', type: 'room', name: 'Stanza' },
];

test('la barra conta gli apparati: prese a muro, patch panel e stanze non sono device', () => {
  const b = barra(NODI);
  assert.equal(b.value, '4', 'switch, PC, UPS con IP e lo switch senza IP: 4 — non 7 elementi documentati');
});

test('il suggerimento dice cosa si conta, e non parla piu\' di «elementi documentati, di cui N passivi»', () => {
  const b = barra(NODI);
  assert.match(b.tip, /^4 apparat/i, 'dice quanti (4, lo stesso numero della barra) e che sono apparati: ' + b.tip);
  assert.ok(!/passiv/i.test(b.tip), 'il vecchio testo «di cui N passivi» non serve piu\': i passivi non sono nel numero: ' + b.tip);
  assert.match(b.tip, /una volta sola|once/i, 'e dice che una scheda di rete in piu\' non fa un apparato in piu\'');
});

test('un apparato con piu\' schede di rete ha piu\' MAC e resta UN device', () => {
  const porte = {};
  // lo switch ha tre MAC sulle sue porte, il PC due: i MAC rilevati (5) superano gli apparati (4)
  for (let i = 1; i <= 3; i++) porte['sw1-' + i] = { mac: 'aa:bb:cc:00:01:0' + i };
  for (let i = 1; i <= 2; i++) porte['pc1-' + i] = { mac: 'aa:bb:cc:00:02:0' + i };
  assert.equal(barra(NODI, porte).value, '4', 'i MAC non fanno i device');
});

test('senza passivi il numero e\' lo stesso di prima (nessun cambio dove non serviva)', () => {
  assert.equal(barra(NODI.filter((n) => !['wallport', 'patchpanel', 'room'].includes(n.type))).value, '4');
});

test('un progetto fatto di soli elementi passivi non dice «0» come se fosse un dato sugli apparati', () => {
  const b = barra(NODI.filter((n) => ['wallport', 'patchpanel'].includes(n.type)));
  assert.equal(b.value, '0', 'nessun apparato: zero, e il suggerimento lo spiega');
  assert.match(b.tip, /apparat/i);
});
