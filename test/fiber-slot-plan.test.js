'use strict';
// ============================================================
//  IL PIANO DI UNO SLOT: CONNETTORE + «UNA PORTA E'…» → quante celle cliccabili, che fori, quante fibre
// ============================================================
// Uno slot e' un modulo con N LC (duplex: 2, quad: 4). Chi documenta puo' contare le PORTE in due modi: un duplex
// (un cordone, 2 fibre: il modello di InfraNet) o un singolo LC (1 fibra). Il modulo si divide in `cells` celle
// impilate, una per porta, e ogni cella porta i fori della sua porta. Lo sceglie l'utente nelle Proprieta'.
// La geometria dello slot standard (192,31 x 290,6, i due casi del disegno dell'utente) e' in fiber-slot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const slot = require('../lib/fiber-slot.js');

const piano = (c, u) => slot.fiberSlotPlan(c, u);
const proiezione = (p) => ({ kind: p.kind, cells: p.cells, fibres: p.fibres });

test('piano: ogni connettore, con la porta duplex (il modello di InfraNet) e con la porta = singolo LC', () => {
  assert.deepEqual(proiezione(piano('lc-simplex', 'duplex')), { kind: 'lc1', cells: 1, fibres: 1 }, 'un LC simplex e\' una fibra, qualunque sia l\'unita\'');
  assert.deepEqual(proiezione(piano('lc-simplex', 'single')), { kind: 'lc1', cells: 1, fibres: 1 });
  assert.deepEqual(proiezione(piano('lc-duplex', 'duplex')), { kind: 'lc2', cells: 1, fibres: 2 }, 'uno slot, una porta, due fori, due fibre');
  assert.deepEqual(proiezione(piano('lc-duplex', 'single')), { kind: 'lc1', cells: 2, fibres: 1 }, 'lo stesso slot, due porte da un LC');
  assert.deepEqual(proiezione(piano('lc-quad', 'duplex')), { kind: 'lc2', cells: 2, fibres: 2 }, 'quattro LC = due duplex = due porte');
  assert.deepEqual(proiezione(piano('lc-quad', 'single')), { kind: 'lc1', cells: 4, fibres: 1 }, 'quattro LC = quattro porte');
  for (const c of ['sc', 'st', 'fc']) assert.deepEqual(proiezione(piano(c, 'single')), { kind: 'big', cells: 1, fibres: 1 }, `${c}: la porta e' il connettore`);
  assert.deepEqual(proiezione(piano('mpo-12')), { kind: 'mpo', cells: 1, fibres: 12 });
  assert.deepEqual(proiezione(piano('mpo-24')), { kind: 'mpo', cells: 1, fibres: 24 });
});

test('piano: l\'unita\' non dichiarata o ignota e\' il duplex; un connettore non dichiarato non ha fibre note', () => {
  for (const u of [undefined, null, '', 'x', 'DUPLEX', 'constructor']) {
    assert.deepEqual(proiezione(piano('lc-quad', u)), { kind: 'lc2', cells: 2, fibres: 2 }, `unita' «${String(u)}»`);
  }
  for (const c of ['', undefined, null, 'e2000', 'constructor', '__proto__']) {
    assert.deepEqual(proiezione(piano(c, 'single')), { kind: 'blank', cells: 1, fibres: 0 }, `connettore «${String(c)}»`);
  }
  assert.equal(piano('lc-quad', 'single').declared, true);
  assert.equal(piano('', 'single').declared, false);
});

test('lc-quad e\' un connettore dell\'elenco: il disegno di default e\' quello della porta duplex', () => {
  assert.equal(slot.fiberSlotKind('lc-quad'), 'lc2');
});

test('piano: solo il modulo a 4 LC ha lo slot ALTO; le celle riempiono lo slot (con 1 px fra l\'una e l\'altra)', () => {
  assert.equal(piano('lc-duplex', 'single').slotH, slot.FIBER_SLOT.h);
  assert.equal(piano('sc').slotH, slot.FIBER_SLOT.h);
  assert.ok(piano('lc-quad', 'duplex').slotH > slot.FIBER_SLOT.h, 'il quad e\' piu\' alto');
  assert.equal(piano('lc-quad', 'single').slotH, piano('lc-quad', 'duplex').slotH, 'stesso modulo, stessa altezza');
  for (const [c, u] of [['lc-duplex', 'single'], ['lc-quad', 'duplex'], ['lc-quad', 'single'], ['lc-duplex', 'duplex'], ['sc', 'duplex']]) {
    const p = piano(c, u);
    assert.ok(Math.abs(p.cells * p.cellH + (p.cells - 1) * slot.FIBER_GAP - p.slotH) < 0.05, `${c}/${u}: le celle riempiono lo slot`);
  }
});

test('celle: i fori stanno DENTRO la cella, centrati in verticale, e non si toccano', () => {
  for (const [c, u] of [['lc-duplex', 'single'], ['lc-quad', 'duplex'], ['lc-quad', 'single'], ['lc-duplex', 'duplex'], ['lc-simplex'], ['sc'], ['mpo-12']]) {
    const p = piano(c, u);
    const fori = slot.fiberCellHoles(p);
    assert.ok(fori.length >= 1, `${c}/${u}: ha dei fori`);
    let top = Infinity, bot = Infinity;
    for (const f of fori) {
      const [x0, x1, y0, y1] = f.t === 'c' ? [f.cx - f.r, f.cx + f.r, f.cy - f.r, f.cy + f.r] : [f.x, f.x + f.w, f.y, f.y + f.h];
      assert.ok(x0 > 0 && x1 < slot.FIBER_SLOT.w && y0 > 0 && y1 < p.cellH, `${c}/${u}: il foro sta nella cella`);
      top = Math.min(top, y0); bot = Math.min(bot, p.cellH - y1);
    }
    if (p.cells > 1) assert.ok(Math.abs(top - bot) < 1, `${c}/${u}: margini sopra e sotto uguali (${top.toFixed(1)} / ${bot.toFixed(1)})`);
    assert.ok(top >= p.cellH * 0.1 && bot >= p.cellH * 0.1, `${c}/${u}: il foro non sfiora il bordo (margini ${top.toFixed(1)} / ${bot.toFixed(1)} su ${p.cellH.toFixed(1)})`);
    if (fori.length === 2) assert.ok(fori[1].cy - fori[0].cy > fori[0].r + fori[1].r, `${c}/${u}: i due fori non si toccano`);
  }
});

test('una cella sola E\' lo slot del disegno: stessi fori, stesse misure dell\'utente (70,09 e 208,55; r 39,32 e 64,96)', () => {
  const cy = (c) => slot.fiberCellHoles(piano(c, 'duplex')).map((h) => h.cy);
  assert.deepEqual(cy('lc-duplex'), [70.09, 208.55], 'LC duplex del disegno');
  assert.deepEqual(slot.fiberCellHoles(piano('lc-duplex', 'duplex')), slot.fiberSlotHoles('lc2'));
  assert.deepEqual(slot.fiberCellHoles(piano('sc', 'duplex')), slot.fiberSlotHoles('big'));
  assert.deepEqual(slot.fiberCellHoles(piano('mpo-12', 'duplex')), slot.fiberSlotHoles('mpo'));
  assert.deepEqual(slot.fiberCellHoles(piano('lc-simplex', 'duplex')), slot.fiberSlotHoles('lc1'));
  assert.match(slot.fiberSlotSvg('lc2'), /cy="70\.09" r="39\.32"[\s\S]*cy="208\.55" r="39\.32"/);
  assert.match(slot.fiberSlotSvg('big'), /cy="135\.89" r="64\.96"/);
});

test('celle: i fori dell\'LC non superano mai quello del disegno e il simplex in cella e\' centrato', () => {
  for (const [c, u] of [['lc-duplex', 'single'], ['lc-quad', 'single'], ['lc-quad', 'duplex']]) {
    const p = piano(c, u);
    for (const f of slot.fiberCellHoles(p)) assert.ok(f.r <= 39.32 + 1e-9, `${c}/${u}`);
  }
  const p = piano('lc-quad', 'single');
  assert.ok(Math.abs(slot.fiberCellHoles(p)[0].cy - p.cellH / 2) < 0.01, 'un solo foro: al centro della cella');
});

test('la cella da sola e\' lo slot del disegno: stesso markup di fiberSlotSvg, con la sua altezza nel viewBox', () => {
  for (const [c, kind] of [['lc-duplex', 'lc2'], ['sc', 'big'], ['lc-simplex', 'lc1'], ['mpo-12', 'mpo']]) {
    assert.equal(slot.fiberCellSvg(piano(c, 'duplex')), slot.fiberSlotSvg(kind), c);
  }
  const q = piano('lc-quad', 'single');
  const svg = slot.fiberCellSvg(q);
  assert.match(svg, new RegExp(`^<svg class="fo-svg" viewBox="0 0 192\\.31 ${String(Number(q.cellH.toFixed(2))).replace('.', '\\.')}"`));
  assert.equal((svg.match(/<circle /g) || []).length, 1);
  assert.equal(slot.fiberCellSvg(piano('', 'single')), '', 'slot neutro: niente da disegnare');
  const valori = [...svg.replace(/^<svg[^>]*>/, '').matchAll(/(cx|cy|r)="([^"]*)"/g)].map((m) => m[2]);
  assert.ok(valori.length && valori.every((v) => /^\d+(\.\d+)?$/.test(v)), 'solo numeri');
});

test('conti derivati: slot e fibre dal connettore, dall\'unita\' e dal numero di porte', () => {
  const s = slot.fiberDrawerStats;
  assert.deepEqual(s('lc-duplex', 'duplex', 24), { slots: 24, fibres: 48 }, '24 LC duplex = 48 fibre');
  assert.deepEqual(s('lc-duplex', 'single', 48), { slots: 24, fibres: 48 });
  assert.deepEqual(s('lc-quad', 'duplex', 48), { slots: 24, fibres: 96 }, 'il cassetto da 96 fibre: 48 porte duplex');
  assert.deepEqual(s('lc-quad', 'single', 96), { slots: 24, fibres: 96 }, 'oppure 96 porte da un LC');
  assert.deepEqual(s('sc', 'duplex', 24), { slots: 24, fibres: 24 });
  assert.deepEqual(s('mpo-12', 'duplex', 12), { slots: 12, fibres: 144 });
  assert.deepEqual(s('lc-quad', 'duplex', 25), { slots: 13, fibres: 50 }, 'l\'ultimo modulo e\' mezzo vuoto');
  assert.equal(s('', 'duplex', 24), null, 'senza connettore dichiarato non si dice quante fibre');
  assert.equal(s('lc-duplex', 'duplex', 0).slots, 0);
  assert.equal(s('lc-duplex', 'duplex', NaN), null, 'un numero di porte che non e\' un numero non produce conti');
});

test('il piano di un NODO legge spec, poi il nodo (progetti vecchi); il limite di una fila e\' 24 slot', () => {
  assert.equal(slot.fiberNodePlan({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' } }).cells, 4);
  assert.equal(slot.fiberNodePlan({ ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' }).cells, 4);
  assert.equal(slot.fiberNodePlan({ spec: { ppFiberConnector: 'lc-quad' }, ppFiberPortUnit: 'single' }).cells, 4, 'spec e nodo si completano');
  assert.equal(slot.fiberNodePlan({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' }, ppFiberPortUnit: 'single' }).cells, 2, 'spec vince');
  assert.equal(slot.fiberNodePlan(null).kind, 'blank');
  assert.equal(slot.fiberNodePlan({}).kind, 'blank');
  assert.equal(slot.FIBER_ROW_SLOTS, 24);
  assert.ok(slot.FIBER_GAP > 0);
});

// ── Le FILE: una per ogni U, 24 slot a fila, riempite dall'alto ─────────────────────────────────────────────
const file = (c, u, porte, sizeU, layout) => slot.fiberSlotRows(piano(c, u), porte, sizeU, layout);
const forma = (rows) => rows && rows.map((r) => [r[0], r[r.length - 1], r.length]);

test('file: fino a 24 slot una fila sola, a qualunque altezza; poi una fila in piu\' ogni 24 slot', () => {
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 24, 1)), [[1, 24, 24]]);
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 24, 2)), [[1, 24, 24]], 'a 2U 24 slot restano una fila');
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 48, 2)), [[1, 24, 24], [25, 48, 24]]);
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 30, 2)), [[1, 24, 24], [25, 30, 6]], 'la seconda fila prende il resto');
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 72, 3)), [[1, 24, 24], [25, 48, 24], [49, 72, 24]]);
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 12, 1)), [[1, 12, 12]]);
});

test('file: contano gli SLOT, non le porte (un modulo quad e\' 2 o 4 porte)', () => {
  assert.deepEqual(forma(file('lc-quad', 'single', 96, 1)), [[1, 96, 96]], '24 slot da 4 porte: una fila di 96 porte');
  assert.deepEqual(forma(file('lc-quad', 'duplex', 48, 1)), [[1, 48, 48]]);
  assert.deepEqual(forma(file('lc-quad', 'duplex', 96, 2)), [[1, 48, 48], [49, 96, 48]], '48 slot da 2 porte: due file da 24 slot');
  assert.deepEqual(forma(file('lc-duplex', 'single', 96, 2)), [[1, 48, 48], [49, 96, 48]]);
  assert.deepEqual(forma(file('lc-quad', 'duplex', 25, 1)), [[1, 25, 25]], '13 slot, l\'ultimo mezzo vuoto');
});

test('file: se le file necessarie sono piu\' delle U, nessun disegno a slot (null = frontale generico)', () => {
  assert.equal(file('lc-duplex', 'duplex', 25, 1), null, '25 slot in 1U');
  assert.equal(file('lc-duplex', 'duplex', 49, 2), null, '49 slot in 2U');
  assert.equal(file('lc-duplex', 'duplex', 96, 2), null);
  assert.equal(file('lc-quad', 'duplex', 50, 1), null);
  assert.notEqual(file('lc-duplex', 'duplex', 48, 2), null);
  assert.equal(file('lc-duplex', 'duplex', 0, 1), null, 'nessuna porta, nessuna fila');
});

test('file: «Lineare» forza UNA fila a qualunque numero di slot; sequenziale e alternata sono due piani di LED', () => {
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 96, 1, 'linear')), [[1, 96, 96]]);
  assert.deepEqual(forma(file('lc-quad', 'duplex', 96, 2, 'linear')), [[1, 96, 96]]);
  assert.equal(file('lc-duplex', 'duplex', 24, 1, 'sequential'), null);
  assert.equal(file('lc-duplex', 'duplex', 24, 2, 'alternating'), null);
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 48, 2, 'auto')), [[1, 24, 24], [25, 48, 24]]);
  assert.deepEqual(forma(file('lc-duplex', 'duplex', 48, 2, undefined)), [[1, 24, 24], [25, 48, 24]]);
});

test('file: un\'altezza non valida vale 1U; un connettore non dichiarato ha slot lisci come gli altri', () => {
  for (const u of [undefined, null, 0, -1, NaN, 'x']) assert.equal(file('lc-duplex', 'duplex', 48, u), null, `altezza «${String(u)}»: 1U, 48 slot non entrano`);
  assert.deepEqual(forma(file('', 'duplex', 48, 2)), [[1, 24, 24], [25, 48, 24]], 'senza connettore: stessi slot, senza fori');
  const tutte = file('lc-quad', 'single', 96, 1)[0];
  assert.deepEqual(tutte, Array.from({ length: 96 }, (_, i) => i + 1), 'le porte sono tutte e in ordine');
});

// ── SC DUPLEX: due SC in un modulo (la famiglia «SC duplex footprint»: 24 slot da 1U = 48 fibre) ──────────
test('SC duplex: con la porta duplex un modulo = una porta da 2 fori grandi; con la porta singola = 2 celle da 1 foro', () => {
  assert.deepEqual(proiezione(piano('sc-duplex', 'duplex')), { kind: 'big2', cells: 1, fibres: 2 });
  assert.deepEqual(proiezione(piano('sc-duplex', 'single')), { kind: 'big', cells: 2, fibres: 1 });
  assert.deepEqual(proiezione(piano('sc-duplex')), { kind: 'big2', cells: 1, fibres: 2 }, 'senza unita\' dichiarata vale il duplex');
  assert.equal(slot.fiberSlotKind('sc-duplex'), 'big2');
  assert.equal(piano('sc-duplex', 'duplex').tall, true, 'l\'adattatore SC duplex ha l\'ingombro alto, come il quad');
  assert.equal(piano('sc-duplex', 'single').tall, true);
  assert.equal(piano('sc', 'duplex').tall, false, 'l\'SC simplex no');
  assert.deepEqual(proiezione(piano('sc', 'single')), { kind: 'big', cells: 1, fibres: 1 }, 'l\'SC simplex non cambia');
});

test('SC duplex: i fori grandi stanno nella cella, a coppia non si toccano, non superano il foro del disegno', () => {
  for (const u of ['duplex', 'single']) {
    const p = piano('sc-duplex', u);
    const fori = slot.fiberCellHoles(p);
    assert.equal(fori.length, u === 'duplex' ? 2 : 1);
    for (const f of fori) {
      assert.equal(f.t, 'c');
      assert.ok(f.r <= 64.96 + 1e-9, `${u}: non piu' grande del foro dell'SC del disegno`);
      if (u === 'single') assert.ok(f.r < 64.96, 'in mezzo slot il foro si rimpicciolisce per starci con margine');
      assert.ok(f.cy - f.r >= p.cellH * 0.1 && p.cellH - (f.cy + f.r) >= p.cellH * 0.1, `${u}: non sfiora il bordo`);
      assert.ok(f.cx - f.r > 0 && f.cx + f.r < slot.FIBER_SLOT.w, `${u}: dentro in larghezza`);
    }
    if (fori.length === 2) assert.ok(fori[1].cy - fori[0].cy > fori[0].r + fori[1].r, 'i due fori non si toccano');
  }
  assert.equal(slot.fiberCellHoles(piano('sc-duplex', 'duplex'))[0].r, 64.96, 'a coppia, nello slot alto, il foro e\' quello del disegno');
  assert.match(slot.fiberCellSvg(piano('sc-duplex', 'duplex')), /^<svg class="fo-svg" viewBox="0 0 192\.31 396\.63"/);
  assert.equal((slot.fiberCellSvg(piano('sc-duplex', 'duplex')).match(/<circle /g) || []).length, 2);
});

test('SC duplex: conti e file come gli altri moduli', () => {
  assert.deepEqual(slot.fiberDrawerStats('sc-duplex', 'duplex', 24), { slots: 24, fibres: 48 }, '24 SC duplex = 48 fibre in 24 slot');
  assert.deepEqual(slot.fiberDrawerStats('sc-duplex', 'single', 48), { slots: 24, fibres: 48 });
  assert.deepEqual(forma(file('sc-duplex', 'duplex', 48, 2)), [[1, 24, 24], [25, 48, 24]]);
  assert.deepEqual(forma(file('sc-duplex', 'single', 48, 1)), [[1, 48, 48]], '24 slot da 2 celle: una fila');
  assert.equal(file('sc-duplex', 'duplex', 25, 1), null);
});

// ── Il connettore non e' un'etichetta libera: l'elenco e' quello dei connettori che il modello conosce ──────
test('l\'elenco dei connettori noti: LC simplex resta per i dati vecchi, ma e\' un caso della porta singola', () => {
  const noti = ['lc-simplex', 'lc-duplex', 'lc-quad', 'sc', 'sc-duplex', 'st', 'fc', 'mpo-12', 'mpo-24'];
  for (const c of noti) assert.equal(piano(c).declared, true, c);
  assert.equal(piano('sc-quad').declared, false);
  // «un LC singolo» si ottiene con LC duplex + porta singola: stesso disegno e stessa fibra per porta
  assert.equal(piano('lc-duplex', 'single').fibres, piano('lc-simplex').fibres);
  assert.equal(piano('lc-duplex', 'single').kind, piano('lc-simplex').kind);
  assert.equal(slot.fiberCellHoles(piano('lc-duplex', 'single'))[0].r, slot.fiberCellHoles(piano('lc-simplex'))[0].r, 'stesso foro piccolo');
});
