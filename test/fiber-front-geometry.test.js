'use strict';
// ============================================================
// FIBER-FRONT-GEOMETRY — il frontale del cassetto ottico FUORI dal DOM (lib/fiber-slot.js).
// Il rack dal vivo si dispone col CSS; il PDF e draw.io no: ricevono i numeri (dov'e' ogni slot, cella e foro) da
// `fiberFrontGeometry`, che usa le stesse costanti dello slot. Qui si prova la geometria; i due gemelli che la
// dipingono hanno i loro test (export.test.js, drawio-export.test.js).
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/fiber-slot.js');

const node = (conn, extra) => ({ type: 'fiberdrawer', spec: Object.assign({ ppFiberConnector: conn }, extra || {}) });
const rowsOf = (n, ports, sizeU, baseLayout) => F.fiberDrawerRows(n, ports, baseLayout || 'auto', sizeU || 1);
const geo = (n, ports, box, sizeU, hidden) => F.fiberFrontGeometry(rowsOf(n, ports, sizeU), box, { hidden });
const PDF_1U = { x: 58, y: 47, w: 218, h: 14 };      // lo spazio che il PDF da' a un cassetto da 1U
const DRAWIO_1U = { x: 12, y: 1, w: 192, h: 18 };    // quello di draw.io (1U = 20, 12 a sinistra, 56 a destra per il nome)
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const allSlots = (g) => g.rows.flat();
const inside = (inner, outer, eps) => inner.x >= outer.x - eps && inner.y >= outer.y - eps
  && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;

test('24 LC duplex a 1U nello spazio del PDF: una fila di 24 slot uguali, nelle proporzioni del disegno', () => {
  const g = geo(node('lc-duplex'), 24, PDF_1U);
  assert.equal(g.rows.length, 1);
  assert.equal(g.rows[0].length, 24);
  for (const s of allSlots(g)) {
    near(s.w / s.h, F.FIBER_SLOT.w / F.FIBER_SLOT.h, 0.01, 'proporzioni 192,31 × 290,6');
    assert.equal(s.w, g.slotW);
    assert.ok(!s.plate);
    assert.equal(s.cells.length, 1);
    assert.equal(s.cells[0].holes.length, 2, 'LC duplex = due fori');
    assert.ok(s.cells[0].holes.every((h) => h.t === 'c'));
  }
});

test('tutto resta dentro la scatola, e il blocco e centrato', () => {
  for (const box of [PDF_1U, DRAWIO_1U, { x: 0, y: 0, w: 100, h: 30 }, { x: 5, y: 5, w: 400, h: 60 }]) {
    const g = geo(node('lc-duplex'), 24, box);
    const slots = allSlots(g);
    for (const s of slots) assert.ok(inside(s, box, 0.011), `slot dentro ${JSON.stringify(box)}: ${JSON.stringify(s)}`);
    const left = slots[0].x - box.x, right = box.x + box.w - (slots[slots.length - 1].x + slots[slots.length - 1].w);
    near(left, right, 0.02, 'margini laterali uguali');
  }
});

test('il blocco e centrato anche in verticale: aria uguale sopra e sotto (col numero, se c\'e)', () => {
  const tight = geo(node('lc-duplex'), 24, PDF_1U);
  const s = tight.rows[0][0];
  near(s.y - PDF_1U.y, PDF_1U.y + PDF_1U.h - (s.y + s.h), 0.02, 'sopra = sotto');
  const roomy = geo(node('lc-duplex'), 24, DRAWIO_1U);
  const r = roomy.rows[0][0];
  near(r.y - DRAWIO_1U.y, DRAWIO_1U.y + DRAWIO_1U.h - (r.num.y + r.num.h), 0.02, 'sopra lo slot = sotto la striscia del numero');
  // due file: ciascuna centrata nella sua meta
  const two = geo(node('lc-duplex'), 48, { x: 0, y: 0, w: 218, h: 40 }, 2);
  const [a, b] = [two.rows[0][0], two.rows[1][0]];
  const bottom = (s) => (s.num ? s.num.y + s.num.h : s.y + s.h);
  near(a.y - 0, 20 - bottom(a), 0.05, 'fila 1 centrata nei suoi 20');
  near(b.y - 20, 40 - bottom(b), 0.05, 'fila 2 centrata nei suoi 20');
});

test('lo stacco fra due slot sta fra il minimo e il massimo (come il rack dal vivo: al piu\' 2)', () => {
  for (const box of [PDF_1U, DRAWIO_1U, { x: 0, y: 0, w: 1000, h: 40 }]) {
    const g = geo(node('lc-duplex'), 24, box);
    assert.ok(g.gap >= 1.4 - 0.011 && g.gap <= 2 + 0.011, `gap ${g.gap}`);
    const s = g.rows[0];
    near(s[1].x - (s[0].x + s[0].w), g.gap, 0.02, 'lo stacco misurato');
  }
  // un solo slot: nessuno stacco
  assert.equal(geo(node('lc-duplex'), 1, PDF_1U).gap, 0);
});

test('lo slot non supera mai la larghezza del rack dal vivo (8), neanche con tanto spazio', () => {
  const g = geo(node('lc-duplex'), 4, { x: 0, y: 0, w: 600, h: 80 });
  assert.equal(g.slotW, 8);
});

test('i numeri sotto gli slot: ci sono dove c\'e\' posto, mancano nel 1U stretto del PDF', () => {
  const tight = geo(node('lc-duplex'), 24, PDF_1U);
  assert.equal(tight.numbers, false, 'il 1U del PDF non ha posto per il numero senza rimpicciolire gli slot');
  assert.ok(allSlots(tight).every((s) => s.num === null));
  const roomy = geo(node('lc-duplex'), 24, DRAWIO_1U);
  assert.equal(roomy.numbers, true);
  const sl = allSlots(roomy);
  assert.deepEqual(sl.map((s) => s.num.port), Array.from({ length: 24 }, (_, i) => i + 1), 'il numero e quello della PRIMA porta di ogni slot');
  // il numero sta sotto lo slot, dentro la scatola
  for (const s of sl) {
    assert.ok(s.num.y >= s.y + s.h - 0.011, 'sotto lo slot');
    assert.ok(s.num.y + s.num.h <= DRAWIO_1U.y + DRAWIO_1U.h + 0.011, 'dentro la scatola');
  }
  // a meta strada: lo slot entra, ma col numero calerebbe di oltre un quinto → si tiene lo slot grande, senza numero
  const mid = geo(node('lc-duplex'), 24, { x: 0, y: 0, w: 218, h: 15 });
  assert.equal(mid.numbers, false);
  assert.ok(mid.slotW > 7.5, 'lo slot e quello pieno');
  // con un'altezza in piu' il numero torna, e lo slot non e calato di oltre un quinto
  const more = geo(node('lc-duplex'), 24, { x: 0, y: 0, w: 218, h: 18 });
  assert.equal(more.numbers, true);
  assert.ok(more.slotW >= 0.8 * mid.slotW - 0.01);
});

test('LC quad: slot ALTO, due celle impilate con lo stacco di una cella, due fori ciascuna', () => {
  const g = geo(node('lc-quad'), 48, { x: 0, y: 0, w: 218, h: 24 });
  const slots = allSlots(g);
  assert.equal(slots.length, 24);
  for (const s of slots) {
    near(s.h / s.w, F.fiberSlotPlan('lc-quad').slotH / F.FIBER_SLOT.w, 0.01, 'altezza del quad');
    assert.equal(s.cells.length, 2);
    for (const c of s.cells) assert.equal(c.holes.length, 2);
    // le celle riempiono lo slot: 2 celle + 1 stacco
    near(s.cells[0].h + s.cells[1].h + (s.cells[1].y - (s.cells[0].y + s.cells[0].h)), s.h, 0.03, 'celle + stacco = slot');
    near(s.cells[1].y - (s.cells[0].y + s.cells[0].h), F.FIBER_GAP * g.k, 0.03, 'lo stacco e 24,04 unita');
    assert.deepEqual(s.cells.map((c) => c.port), [slots.indexOf(s) * 2 + 1, slots.indexOf(s) * 2 + 2]);
  }
});

test('ogni foro sta dentro la sua cella, per ogni connettore e per ogni unita di porta', () => {
  for (const conn of ['lc-duplex', 'lc-quad', 'sc', 'sc-duplex', 'st', 'fc', 'mpo-12', 'mpo-24']) {
    for (const unit of ['duplex', 'single']) {
      const n = node(conn, { ppFiberPortUnit: unit });
      const cells = F.fiberSlotPlan(conn, unit).cells;
      const g = geo(n, 12 * cells, { x: 0, y: 0, w: 218, h: 30 }, 1);
      assert.ok(g, `${conn}/${unit}`);
      for (const s of allSlots(g)) for (const c of s.cells) {
        assert.ok(c.holes.length > 0, `${conn}/${unit}: ogni cella con porta ha fori`);
        for (const h of c.holes) {
          const box = h.t === 'c' ? { x: h.cx - h.r, y: h.cy - h.r, w: 2 * h.r, h: 2 * h.r } : { x: h.x, y: h.y, w: h.w, h: h.h };
          assert.ok(inside(box, c, 0.02), `${conn}/${unit}: foro dentro la cella ${JSON.stringify(h)} / ${JSON.stringify(c)}`);
        }
      }
    }
  }
});

test('un connettore non dichiarato: slot senza fori (non si indovina cosa c\'e\' montato)', () => {
  const g = geo(node(''), 24, PDF_1U);
  assert.equal(allSlots(g).length, 24);
  assert.ok(allSlots(g).every((s) => s.cells.every((c) => c.holes.length === 0)));
});

test('cassetto composto: la lastra cieca non ha celle, tutti gli slot hanno la stessa altezza', () => {
  const n = node('lc-duplex', { fdSlots: ['lc-duplex', 'blank', 'lc-quad', 'mpo-12'] });
  const ports = F.fiberPortCount(F.fiberNodeSlots(n), 'duplex');
  assert.equal(ports, 4);
  const g = geo(n, ports, PDF_1U);
  const s = allSlots(g);
  assert.equal(s.length, 4);
  assert.equal(s[1].plate, true);
  assert.deepEqual(s[1].cells, []);
  assert.equal(s[1].num, null);
  assert.equal(new Set(s.map((x) => x.h)).size, 1, 'un quad accanto a un duplex: una scatola alta per tutti');
  assert.deepEqual(s.map((x) => x.cells.map((c) => c.port)), [[1], [], [2, 3], [4]]);
});

test('un modulo senza porta (l\'ultimo, mezzo vuoto) e una lastra: come sul rack dal vivo', () => {
  const n = node('lc-duplex', { fdSlots: ['lc-duplex', 'lc-duplex', 'lc-duplex'] });
  const g = geo(n, 2, PDF_1U);
  const s = allSlots(g);
  assert.equal(s.length, 3);
  assert.equal(s[2].plate, true, 'la terza porta non c\'e');
});

test('porta nascosta: lo slot a UNA porta sparisce e gli altri si stringono; la cella di un modulo resta vuota', () => {
  const hid = (p) => p === 2 || p === 5;
  const g = geo(node('lc-duplex'), 24, PDF_1U, 1, hid);
  const s = allSlots(g);
  assert.equal(s.length, 22);
  assert.ok(!s.some((x) => hid(x.cells[0].port)));
  // sempre centrato
  near(s[0].x - PDF_1U.x, PDF_1U.x + PDF_1U.w - (s[s.length - 1].x + s[s.length - 1].w), 0.02);
  // il quad: la porta 2 nascosta lascia la cella, non lo slot
  const q = geo(node('lc-quad'), 48, { x: 0, y: 0, w: 218, h: 24 }, 1, (p) => p === 2);
  const slot0 = allSlots(q)[0];
  assert.equal(allSlots(q).length, 24);
  assert.equal(slot0.cells[0].port, 1);
  assert.equal(slot0.cells[1].port, null);
  assert.deepEqual(slot0.cells[1].holes, [], 'una cella senza porta non ha fori');
  // e se e la PRIMA porta di un modulo a due celle a mancare, lo slot resta (non e uno slot a una porta sola)
  const q1 = geo(node('lc-quad'), 48, { x: 0, y: 0, w: 218, h: 24 }, 1, (p) => p === 1);
  assert.equal(allSlots(q1).length, 24);
  assert.equal(allSlots(q1)[0].cells[0].port, null);
  assert.equal(allSlots(q1)[0].cells[1].port, 2);
});

test('un quad nel 1U stretto del PDF (14 di altezza): lo slot alto si stringe e resta dentro, non sfora', () => {
  const g = geo(node('lc-quad'), 48, PDF_1U);
  for (const s of allSlots(g)) assert.ok(inside(s, PDF_1U, 0.011), `slot dentro: ${JSON.stringify(s)}`);
  const duplex = geo(node('lc-duplex'), 24, PDF_1U);
  assert.ok(g.slotW < duplex.slotW, 'il quad e piu alto, quindi a parita di riga piu stretto');
  // e lo stacco fra le celle e quello del disegno, scalato
  const s0 = allSlots(g)[0];
  near(s0.cells[1].y - (s0.cells[0].y + s0.cells[0].h), F.FIBER_GAP * g.k, 0.03);
});

test('un cassetto di sole lastre: si disegnano, senza numeri e col massimo possibile; nascondere porte non le toglie', () => {
  const n = node('lc-duplex', { fdSlots: ['blank', 'blank', 'blank'] });
  const g = geo(n, 0, PDF_1U);
  assert.equal(allSlots(g).length, 3);
  assert.ok(allSlots(g).every((s) => s.plate && s.cells.length === 0 && s.num === null));
  assert.equal(g.numbers, false, 'non c\'e niente da numerare');
  const roomy = geo(n, 0, DRAWIO_1U);   // e anche dove il posto per i numeri ci sarebbe
  assert.equal(roomy.numbers, false, 'senza porte nessun numero, nemmeno dove c\'e posto');
  assert.equal(roomy.slotW, 8, 'e gli slot hanno la scala piena: nessuna striscia da riservare');
  const hidAll = F.fiberFrontGeometry(rowsOf(node('lc-duplex', { fdSlots: ['blank', 'lc-duplex'] }), 1, 1), PDF_1U, { hidden: () => true });
  assert.equal(allSlots(hidAll).length, 1, 'la lastra non ha porta da nascondere: resta, e solo lei');
  assert.equal(allSlots(hidAll)[0].plate, true);
});

test('niente da disegnare: null (chi chiama ripiega sul frontale generico)', () => {
  assert.equal(F.fiberFrontGeometry(null, PDF_1U), null);
  assert.equal(F.fiberFrontGeometry([], PDF_1U), null);
  assert.equal(F.fiberFrontGeometry(rowsOf(node('lc-duplex'), 24), null), null);
  assert.equal(F.fiberFrontGeometry(rowsOf(node('lc-duplex'), 24), { x: 0, y: 0, w: 0, h: 10 }), null);
  assert.equal(F.fiberFrontGeometry(rowsOf(node('lc-duplex'), 24), { x: 0, y: 0, w: 100, h: 1.5 }), null, 'senza altezza utile');
  assert.equal(geo(node('lc-duplex'), 24, PDF_1U, 1, () => true), null, 'tutte le porte nascoste');
});

test('fiberFront: le file le decide la lib (una per U, 24 a fila), come il rack dal vivo', () => {
  const opt = (over) => Object.assign({ portCount: 24, baseLayout: 'auto', sizeU: 1, box: PDF_1U }, over);
  assert.equal(F.fiberFront(node('lc-duplex'), opt()).rows.length, 1);
  assert.equal(F.fiberFront(node('lc-duplex'), opt({ portCount: 48, sizeU: 2, box: { x: 0, y: 0, w: 218, h: 34 } })).rows.length, 2, '48 slot a 2U = 2 file');
  assert.equal(F.fiberFront(node('lc-duplex'), opt({ portCount: 25 })), null, '25 slot a 1U non entrano: frontale generico');
  assert.equal(F.fiberFront(node('lc-duplex'), opt({ baseLayout: 'sequential' })), null, 'due piani di LED chiesti: frontale generico');
  assert.equal(F.fiberFront(node('lc-duplex'), opt({ baseLayout: 'alternating' })), null);
  assert.equal(F.fiberFront(node('lc-duplex'), opt({ baseLayout: 'linear', portCount: 30 })).rows.length, 1, '«Lineare» forza UNA fila');
  assert.equal(F.fiberFront({ type: 'patchpanel', spec: { ppFiberConnector: 'lc-duplex' } }, opt()), null, 'solo il cassetto ottico');
  assert.equal(F.fiberFront(null, opt()), null);
});

test('l\'ordine delle porte nel disegno e quello delle file di slot', () => {
  const n = node('lc-quad');
  const rows = rowsOf(n, 48, 1);
  const g = F.fiberFrontGeometry(rows, { x: 0, y: 0, w: 218, h: 24 });
  const fromGeo = g.rows.flat().flatMap((s) => s.cells.map((c) => c.port));
  const fromRows = rows.flat().flatMap((s) => s.ports);
  assert.deepEqual(fromGeo, fromRows);
  assert.deepEqual(fromGeo, Array.from({ length: 48 }, (_, i) => i + 1));
});

test('pura: non cambia le file ne il piano, e da lo stesso risultato due volte', () => {
  const rows = rowsOf(node('lc-quad'), 48, 1);
  const before = JSON.stringify(rows);
  const a = F.fiberFrontGeometry(rows, PDF_1U), b = F.fiberFrontGeometry(rows, PDF_1U);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
