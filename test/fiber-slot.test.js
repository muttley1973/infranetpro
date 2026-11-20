'use strict';
// ============================================================
//  LO SLOT DI UN CASSETTO OTTICO: UN RETTANGOLO VERTICALE CON I FORI DEI CONNETTORI
// ============================================================
// Un cassetto ottico da 19" a 1U ha una fila di slot VERTICALI, tutti della stessa misura (l'ingombro di un
// adattatore SC simplex). Quello che cambia e' cio' che c'e' dentro: un adattatore LC duplex ha DUE fori
// piccoli uno sopra l'altro (due ferruli da 1,25 mm), un adattatore SC, ST o FC ne ha UNO grande (un ferrulo
// da 2,5 mm). Il disegno dell'utente (connettori ottici.svg, 20/11/2026) mostra proprio questi due casi nello
// STESSO rettangolo 192,31 x 290,6: da li' vengono le misure di `lib/fiber-slot.js`.
//
// Qui si prova la GEOMETRIA e la scelta del disegno per connettore. Il frontale nel rack, che la usa, e'
// provato in `test/fiberdrawer-front.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const slot = require('../lib/fiber-slot.js');

const buchi = (kind) => slot.fiberSlotHoles(kind);

test('lo slot ha le proporzioni del disegno: piu\' alto che largo, 192,31 x 290,6', () => {
  assert.equal(slot.FIBER_SLOT.w, 192.31);
  assert.equal(slot.FIBER_SLOT.h, 290.6);
  assert.ok(slot.FIBER_SLOT.h > slot.FIBER_SLOT.w, 'e\' un rettangolo VERTICALE');
});

test('ogni connettore dell\'elenco ha il suo disegno; LC simplex e duplex, SC/ST/FC, MPO', () => {
  assert.equal(slot.fiberSlotKind('lc-duplex'), 'lc2');
  assert.equal(slot.fiberSlotKind('lc-simplex'), 'lc1');
  assert.equal(slot.fiberSlotKind('sc'), 'big');
  assert.equal(slot.fiberSlotKind('st'), 'big');
  assert.equal(slot.fiberSlotKind('fc'), 'big');
  assert.equal(slot.fiberSlotKind('mpo-12'), 'mpo');
  assert.equal(slot.fiberSlotKind('mpo-24'), 'mpo');
});

test('non dichiarato o sconosciuto = slot neutro, senza fori: non si indovina un connettore', () => {
  for (const v of ['', undefined, null, 'e2000', 'LC-DUPLEX', 'constructor', '__proto__', 'toString']) {
    assert.equal(slot.fiberSlotKind(v), 'blank', `«${String(v)}» non e' un connettore dichiarato`);
  }
  assert.deepEqual(buchi('blank'), []);
  assert.equal(slot.fiberSlotSvg('blank'), '', 'nessun disegno da aggiungere');
});

test('LC duplex: due fori PICCOLI impilati in verticale, centrati, uguali (come nel disegno)', () => {
  const b = buchi('lc2');
  assert.equal(b.length, 2);
  assert.ok(b.every((h) => h.t === 'c'), 'sono tondi');
  assert.equal(b[0].r, 39.32);
  assert.equal(b[1].r, 39.32);
  assert.equal(b[0].cx, b[1].cx, 'stessa colonna');
  assert.ok(Math.abs(b[0].cx - slot.FIBER_SLOT.w / 2) < 0.5, 'centrati in larghezza');
  assert.ok(b[0].cy < b[1].cy, 'uno sopra l\'altro');
  assert.equal(b[0].cy, 70.09);
  assert.equal(b[1].cy, 208.55);
});

test('SC/ST/FC: UN foro grande (il ferrulo da 2,5 mm), piu\' largo di quelli dell\'LC', () => {
  const b = buchi('big');
  assert.equal(b.length, 1);
  assert.equal(b[0].t, 'c');
  assert.equal(b[0].r, 64.96);
  assert.ok(b[0].r > buchi('lc2')[0].r, 'il 2,5 mm e\' piu\' grande dell\'1,25 mm');
  assert.ok(Math.abs(b[0].r / buchi('lc2')[0].r - 64.96 / 39.32) < 1e-9, 'il rapporto e\' quello del disegno');
});

test('LC simplex: UN foro piccolo; MPO: un\'apertura rettangolare, piu\' larga che alta', () => {
  const l = buchi('lc1');
  assert.equal(l.length, 1);
  assert.equal(l[0].r, buchi('lc2')[0].r, 'lo stesso foro dell\'LC duplex');
  const m = buchi('mpo');
  assert.equal(m.length, 1);
  assert.equal(m[0].t, 'r');
  assert.ok(m[0].w > m[0].h, 'una ferrula MT e\' una fila di fibre: l\'apertura e\' orizzontale');
});

test('nessun foro esce dallo slot e i due dell\'LC duplex non si toccano', () => {
  const { w, h } = slot.FIBER_SLOT;
  for (const kind of ['lc1', 'lc2', 'big', 'mpo']) {
    for (const f of buchi(kind)) {
      const [x0, x1, y0, y1] = f.t === 'c' ? [f.cx - f.r, f.cx + f.r, f.cy - f.r, f.cy + f.r] : [f.x, f.x + f.w, f.y, f.y + f.h];
      assert.ok(x0 > 0 && x1 < w && y0 > 0 && y1 < h, `${kind}: il foro sta dentro lo slot`);
    }
  }
  const [a, b] = buchi('lc2');
  assert.ok(b.cy - a.cy > a.r + b.r, 'i due fori dell\'LC duplex sono separati');
});

test('il disegno da inserire e\' un SVG con un elemento per foro e SOLO numeri (nessun testo che arrivi da fuori)', () => {
  const svg = slot.fiberSlotSvg('lc2');
  assert.match(svg, /^<svg class="fo-svg" viewBox="0 0 192\.31 290\.6" aria-hidden="true" focusable="false">/);
  assert.equal((svg.match(/<circle /g) || []).length, 2);
  assert.equal((slot.fiberSlotSvg('big').match(/<circle /g) || []).length, 1);
  assert.equal((slot.fiberSlotSvg('lc1').match(/<circle /g) || []).length, 1);
  assert.equal((slot.fiberSlotSvg('mpo').match(/<rect /g) || []).length, 1);
  for (const kind of ['lc1', 'lc2', 'big', 'mpo']) {
    const s = slot.fiberSlotSvg(kind);
    // ogni valore di attributo dopo i tre attributi fissi dell'<svg> e' un numero
    const valori = [...s.replace(/^<svg[^>]*>/, '').matchAll(/(cx|cy|r|x|y|width|height|rx)="([^"]*)"/g)].map((m) => m[2]);
    assert.ok(valori.length > 0);
    assert.ok(valori.every((v) => /^\d+(\.\d+)?$/.test(v)), `${kind}: attributi non numerici: ${valori.join(',')}`);
  }
});

test('il disegno e\' una funzione del solo tipo di slot: stesso ingresso, stessa uscita', () => {
  assert.equal(slot.fiberSlotSvg('lc2'), slot.fiberSlotSvg('lc2'));
  assert.notEqual(slot.fiberSlotSvg('lc2'), slot.fiberSlotSvg('big'));
  assert.notEqual(slot.fiberSlotSvg('lc1'), slot.fiberSlotSvg('lc2'));
});
