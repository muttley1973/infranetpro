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

// Misure dopo la richiesta dell'utente (20/11 sera): i fori un po' piu' piccoli (circa -20%) e TUTTO centrato sullo slot.
const CENTRO = { x: slot.FIBER_SLOT.w / 2, y: slot.FIBER_SLOT.h / 2 };
const R_PICCOLO = 32, R_GRANDE = 52.9;

test('LC duplex: due fori PICCOLI impilati in verticale, uguali, SIMMETRICI attorno al centro dello slot', () => {
  const b = buchi('lc2');
  assert.equal(b.length, 2);
  assert.ok(b.every((h) => h.t === 'c'), 'sono tondi');
  assert.equal(b[0].r, R_PICCOLO);
  assert.equal(b[1].r, R_PICCOLO);
  assert.equal(b[0].cx, b[1].cx, 'stessa colonna');
  assert.ok(Math.abs(b[0].cx - slot.FIBER_SLOT.w / 2) < 0.5, 'centrati in larghezza');
  assert.ok(b[0].cy < b[1].cy, 'uno sopra l\'altro');
  assert.equal(b[0].cy, 76.07);
  assert.equal(b[1].cy, 214.53);
  assert.ok(Math.abs((b[0].cy + b[1].cy) / 2 - CENTRO.y) < 0.01, 'la coppia e\' centrata in altezza (nel disegno originale stava un po\' in alto)');
  assert.ok(Math.abs(b[0].cy - b[0].r - (slot.FIBER_SLOT.h - b[1].cy - b[1].r)) < 0.01, 'stesso margine sopra e sotto');
  // (la seconda posizione e' qui sopra)
});

test('SC/ST/FC: UN foro grande (il ferrulo da 2,5 mm), piu\' largo di quelli dell\'LC', () => {
  const b = buchi('big');
  assert.equal(b.length, 1);
  assert.equal(b[0].t, 'c');
  assert.equal(b[0].r, R_GRANDE);
  assert.ok(b[0].r > buchi('lc2')[0].r, 'il 2,5 mm e\' piu\' grande dell\'1,25 mm');
  assert.ok(Math.abs(b[0].r / buchi('lc2')[0].r - 1.652) < 0.01, 'il rapporto fra i due fori e\' quello del disegno (1,65)');
  assert.ok(Math.abs(b[0].cy - CENTRO.y) < 0.01 && Math.abs(b[0].cx - CENTRO.x) < 0.5, 'centrato sullo slot');
});

test('LC simplex: UN foro piccolo, al centro dello slot', () => {
  const l = buchi('lc1');
  assert.equal(l.length, 1);
  assert.equal(l[0].r, buchi('lc2')[0].r, 'lo stesso foro dell\'LC duplex');
  assert.ok(Math.abs(l[0].cy - CENTRO.y) < 0.01 && Math.abs(l[0].cx - CENTRO.x) < 0.5, 'centrato');
});

// ── MTP/MPO ────────────────────────────────────────────────────────────────────────────────────────────
// Dal disegno quotato di un adattatore MPO/MTP in «SC footprint» (L-com FOA-993A): taglio nel pannello 9,91 x 13,46 mm,
// corpo 9,4 x 13,0, flangia 14,8; la bocca in cui entra il connettore e' un rettangolo ~8,4 x 12,4 mm — VERTICALE nella
// vista frontale — e dentro c'e' la ferrula MT da 2,5 x 6,4 mm (IEC 61754-7). Lo slot del cassetto e' proprio il taglio
// ruotato: la bocca occupa quasi tutto lo slot. La mia prima versione era un rettangolino ORIZZONTALE, 68% x 25%: sbagliata.
const MM_X = slot.FIBER_SLOT.w / 9.91;   // unita' del disegno per mm, in larghezza (il taglio e' largo 9,91 mm)
const MM_Y = slot.FIBER_SLOT.h / 13.46;  // ... e in altezza (alto 13,46 mm)

test('MPO: la bocca e\' VERTICALE e occupa buona parte dello slot, ma un po\' meno del taglio (l\'utente la voleva meno invadente)', () => {
  const [bocca] = buchi('mpo');
  assert.equal(bocca.t, 'r');
  assert.ok(bocca.h > bocca.w, 'piu\' alta che larga: in uno slot verticale l\'adattatore sta ruotato di 90 gradi');
  const fw = bocca.w / slot.FIBER_SLOT.w, fh = bocca.h / slot.FIBER_SLOT.h;
  assert.ok(fw >= 0.7 && fw <= 0.8, `larghezza ${(fw * 100).toFixed(0)}% dello slot (85% nel disegno quotato, poi rimpicciolita su richiesta)`);
  assert.ok(fh >= 0.78 && fh <= 0.86, `altezza ${(fh * 100).toFixed(0)}% dello slot (92% nel disegno quotato)`);
  assert.ok(bocca.x >= 20 && bocca.y >= 20 && slot.FIBER_SLOT.w - (bocca.x + bocca.w) >= 20, 'un margine visibile attorno alla bocca');
  assert.ok(Math.abs(bocca.x + bocca.w / 2 - slot.FIBER_SLOT.w / 2) < 0.5 && Math.abs(bocca.y + bocca.h / 2 - slot.FIBER_SLOT.h / 2) < 0.5, 'centrata');
});

test('MPO: dentro la bocca c\'e\' la ferrula MT da 2,5 x 6,4 mm, verticale e centrata, disegnata con la sua classe', () => {
  const m = buchi('mpo');
  assert.equal(m.length, 2, 'la bocca e la ferrula');
  const [bocca, fer] = m;
  assert.equal(fer.fer, true);
  assert.ok(!bocca.fer);
  assert.ok(Math.abs(fer.w / MM_X - 2.5) < 0.1 && Math.abs(fer.h / MM_Y - 6.4) < 0.1, `ferrula ${(fer.w / MM_X).toFixed(2)} x ${(fer.h / MM_Y).toFixed(2)} mm`);
  assert.ok(fer.h > fer.w, 'verticale');
  assert.ok(fer.x > bocca.x && fer.x + fer.w < bocca.x + bocca.w && fer.y > bocca.y && fer.y + fer.h < bocca.y + bocca.h, 'sta dentro la bocca');
  assert.ok(Math.abs(fer.x + fer.w / 2 - (bocca.x + bocca.w / 2)) < 0.5 && Math.abs(fer.y + fer.h / 2 - (bocca.y + bocca.h / 2)) < 0.5, 'centrata nella bocca');
  const svg = slot.fiberSlotSvg('mpo');
  assert.equal((svg.match(/class="fo-fer"/g) || []).length, 1, 'solo la ferrula ha la classe');
  assert.equal((svg.match(/<rect /g) || []).length, 2, 'due rettangoli: la bocca e la ferrula');
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
  assert.equal((slot.fiberSlotSvg('mpo').match(/<rect /g) || []).length, 2, 'la bocca e la ferrula MT');
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

test('TUTTO e\' centrato sullo slot: il baricentro dei fori di ogni connettore e\' il centro del tile (richiesta dell\'utente, 20/11)', () => {
  for (const kind of ['lc1', 'lc2', 'big', 'mpo']) {
    const forme = buchi(kind).filter((f) => !f.fer);   // la ferrula MT e' centrata nella bocca: la bocca decide
    const x0 = Math.min(...forme.map((f) => (f.t === 'c' ? f.cx - f.r : f.x)));
    const x1 = Math.max(...forme.map((f) => (f.t === 'c' ? f.cx + f.r : f.x + f.w)));
    const y0 = Math.min(...forme.map((f) => (f.t === 'c' ? f.cy - f.r : f.y)));
    const y1 = Math.max(...forme.map((f) => (f.t === 'c' ? f.cy + f.r : f.y + f.h)));
    assert.ok(Math.abs((x0 + x1) / 2 - CENTRO.x) < 0.5, `${kind}: centrato in larghezza (${((x0 + x1) / 2).toFixed(2)} contro ${CENTRO.x.toFixed(2)})`);
    assert.ok(Math.abs((y0 + y1) / 2 - CENTRO.y) < 0.1, `${kind}: centrato in altezza (${((y0 + y1) / 2).toFixed(2)} contro ${CENTRO.y.toFixed(2)})`);
  }
});

test('i fori sono piu\' piccoli di prima di circa un quinto, e il rapporto fra grande e piccolo non e\' cambiato', () => {
  assert.ok(R_PICCOLO < 39.32 && R_PICCOLO > 39.32 * 0.75, 'LC: circa il 20% in meno del disegno originale (39,32)');
  assert.ok(R_GRANDE < 64.96 && R_GRANDE > 64.96 * 0.75, 'SC: circa il 20% in meno del disegno originale (64,96)');
  assert.ok(Math.abs(R_GRANDE / R_PICCOLO - 64.96 / 39.32) < 0.01, 'stesso rapporto');
});
