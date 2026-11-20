'use strict';
// ============================================================
//  IL COMPOSITORE DEL CASSETTO OTTICO — la parte PURA: un modulo per slot, porte che vengono dai moduli
// ============================================================
// Un cassetto a slot accetta un modulo diverso per ogni slot (LC quad/duplex, SC duplex, MPO...) o una lastra cieca.
// La composizione e' `spec.fdSlots` (una chiave per slot); senza, il cassetto e' uniforme come prima. Le porte vengono
// dai moduli e si numerano di seguito: cambiare un modulo con piu' o meno porte RINUMERA le seguenti, e i cavi restano
// attaccati ai numeri. Qui si provano il piano per slot, le file, i conti, le parole e l'impatto sulla numerazione.
const test = require('node:test');
const assert = require('node:assert/strict');
const slot = require('../lib/fiber-slot.js');

const nodo = (conn, slots, unit) => ({ spec: Object.assign({ ppFiberConnector: conn }, slots ? { fdSlots: slots } : {}, unit ? { ppFiberPortUnit: unit } : {}) });
const chiavi = (lay) => lay.slots.map((s) => s.key);
const porte = (lay) => lay.slots.map((s) => s.ports.join(','));

// ── I moduli ────────────────────────────────────────────────────────────────────────────────────────────────────
test('i moduli del compositore sono le voci del cassetto piu\' la lastra cieca: LC simplex non e\' un modulo', () => {
  assert.deepEqual([...slot.FIBER_MODULES], ['lc-duplex', 'lc-quad', 'sc', 'sc-duplex', 'st', 'fc', 'mpo-12', 'mpo-24', 'blank']);
  for (const k of slot.FIBER_MODULES) assert.ok(slot.fiberModulePlan(k, 'duplex').kind, k);
  assert.ok(!slot.FIBER_MODULES.includes('lc-simplex'));
});

test('la lastra cieca: nessuna porta, nessuna fibra, nessun foro, ma e\' una cosa DICHIARATA (non e\' «non dichiarato»)', () => {
  const p = slot.fiberModulePlan('blank', 'duplex');
  assert.deepEqual({ declared: p.declared, empty: p.empty, kind: p.kind, cells: p.cells, fibres: p.fibres }, { declared: true, empty: true, kind: 'empty', cells: 0, fibres: 0 });
  assert.equal(slot.fiberCellSvg(p), '', 'niente da disegnare dentro');
  assert.equal(slot.fiberCellHoles(p).length, 0);
  assert.notEqual(p.kind, slot.fiberSlotPlan('').kind, 'diversa dallo slot liscio di un cassetto senza connettore');
});

test('i moduli sono quelli di sempre: la chiave di un modulo da' + ' lo stesso piano del connettore', () => {
  for (const c of ['lc-duplex', 'lc-quad', 'sc', 'sc-duplex', 'st', 'fc', 'mpo-12', 'mpo-24']) {
    for (const u of ['duplex', 'single']) assert.deepEqual(slot.fiberModulePlan(c, u), slot.fiberSlotPlan(c, u), `${c}/${u}`);
  }
});

test('l\'altezza dello slot e\' UNA per tutti: in una scatola alta anche un LC duplex e\' alto, e i suoi fori stanno al CENTRO', () => {
  const basso = slot.fiberSlotPlan('lc-duplex', 'duplex');
  const alto = slot.fiberSlotPlan('lc-duplex', 'duplex', true);
  assert.equal(basso.tall, false);
  assert.equal(alto.tall, true);
  assert.ok(alto.slotH > basso.slotH);
  assert.equal(alto.cells, 1, 'cambia la scatola, non il modulo');
  // un modulo con piu' celle ridistribuisce le celle nella scatola alta
  const duePorte = slot.fiberSlotPlan('lc-duplex', 'single', true);
  assert.equal(duePorte.cells, 2);
  assert.ok(duePorte.cellH > slot.fiberSlotPlan('lc-duplex', 'single').cellH);
  // la lastra e lo slot liscio seguono la scatola
  assert.equal(slot.fiberModulePlan('blank', 'duplex', true).slotH, alto.slotH);
  assert.equal(slot.fiberSlotPlan('', 'duplex', true).slotH, alto.slotH);
  // i fori di un tile standard in una scatola alta: stessa distanza, centrati
  for (const c of ['lc-simplex', 'lc-duplex', 'sc', 'mpo-12']) {
    const std = slot.fiberCellHoles(slot.fiberSlotPlan(c, 'duplex'));
    const alt = slot.fiberCellHoles(slot.fiberSlotPlan(c, 'duplex', true));
    assert.equal(alt.length, std.length, c);
    const y = (h) => (h.t === 'c' ? h.cy : h.y + h.h / 2);
    const centro = (hs) => hs.reduce((a, h) => a + y(h), 0) / hs.length;
    assert.ok(Math.abs(centro(alt) - alto.slotH / 2) < 0.1, `${c}: centrato nella scatola alta`);
    if (std.length > 1) assert.ok(Math.abs((y(alt[1]) - y(alt[0])) - (y(std[1]) - y(std[0]))) < 0.1, `${c}: stessa distanza fra i fori`);
  }
});

test('senza `boxTall` niente cambia: il piano di un connettore e\' quello di prima', () => {
  assert.equal(slot.fiberSlotPlan('lc-duplex', 'duplex', false).slotH, slot.FIBER_SLOT.h);
  assert.equal(slot.fiberSlotPlan('lc-duplex', 'duplex').tall, false);
  assert.equal(slot.fiberSlotPlan('lc-quad', 'duplex').tall, true);
  assert.equal(slot.fiberSlotPlan('sc-duplex', 'duplex').tall, true);
});

// ── La composizione di un nodo ──────────────────────────────────────────────────────────────────────────────────
test('fiberNodeSlots: senza elenco (o con uno vuoto, o non un elenco) il cassetto e\' uniforme', () => {
  for (const v of [undefined, null, [], 'lc-duplex', {}, 3]) assert.equal(slot.fiberNodeSlots(nodo('lc-duplex', v)), null, JSON.stringify(v));
  assert.equal(slot.fiberNodeSlots({}), null);
  assert.equal(slot.fiberNodeSlots(null), null);
});

test('fiberNodeSlots: l\'elenco sta in spec o, nei progetti vecchi, sul nodo; spec vince; una voce ignota diventa il connettore dichiarato', () => {
  assert.deepEqual(slot.fiberNodeSlots(nodo('lc-duplex', ['sc', 'blank'])), ['sc', 'blank']);
  assert.deepEqual(slot.fiberNodeSlots({ fdSlots: ['sc', 'blank'], spec: {} }), ['sc', 'blank']);
  assert.deepEqual(slot.fiberNodeSlots({ fdSlots: ['st'], spec: { fdSlots: ['sc'] } }), ['sc'], 'spec vince');
  assert.deepEqual(slot.fiberNodeSlots(nodo('lc-duplex', ['sc', 'e2000', '', null, 7, 'constructor', '__proto__', 'lc-simplex'])),
    ['sc', 'lc-duplex', 'lc-duplex', 'lc-duplex', 'lc-duplex', 'lc-duplex', 'lc-duplex', 'lc-duplex'], 'non si indovina: chi non e\' un modulo noto torna al connettore del cassetto (LC simplex non e\' un modulo)');
  assert.deepEqual(slot.fiberNodeSlots(nodo('', ['sc', 'e2000'])), ['sc', ''], 'senza connettore dichiarato: uno slot liscio, non un connettore inventato');
});

test('fiberNodeSlots: un elenco enorme non diventa un frontale enorme', () => {
  const grande = new Array(5000).fill('sc');
  assert.equal(slot.fiberNodeSlots(nodo('sc', grande)).length, slot.FIBER_MAX_SLOTS);
  assert.equal(slot.FIBER_MAX_SLOTS, 288);
});

// ── Il layout: uniforme com'era, composto con le porte dei moduli ────────────────────────────────────────────────
test('uniforme: tanti slot quanti ne servono, e l\'ultimo puo\' avere meno porte (come prima)', () => {
  const a = slot.fiberNodeLayout(nodo('lc-duplex'), 24);
  assert.equal(a.composed, false);
  assert.equal(a.slots.length, 24);
  assert.deepEqual(porte(a).slice(0, 3), ['1', '2', '3']);
  const q = slot.fiberNodeLayout(nodo('lc-quad', null, 'duplex'), 25);
  assert.equal(q.slots.length, 13, '25 porte in moduli da 2');
  assert.deepEqual(q.slots[0].ports, [1, 2]);
  assert.deepEqual(q.slots[12].ports, [25], 'l\'ultimo modulo e\' mezzo vuoto');
  const s = slot.fiberNodeLayout(nodo('lc-quad', null, 'single'), 96);
  assert.equal(s.slots.length, 24);
  assert.deepEqual(s.slots[23].ports, [93, 94, 95, 96]);
  assert.equal(slot.fiberNodeLayout(nodo('lc-duplex'), 0).slots.length, 0);
  assert.equal(slot.fiberNodeLayout(nodo('lc-duplex'), 'boh').slots.length, 0);
});

test('uniforme: il layout coincide con le file di sempre (fiberSlotRows) per ogni connettore, unita\', numero di porte, U e layout', () => {
  const conns = ['', 'lc-duplex', 'lc-quad', 'sc', 'sc-duplex', 'st', 'fc', 'mpo-12', 'mpo-24'];
  for (const c of conns) for (const u of ['duplex', 'single']) for (const n of [1, 7, 24, 25, 48, 49, 96, 97]) for (const sizeU of [1, 2, 3]) for (const bl of [undefined, 'auto', 'linear', 'sequential', 'alternating']) {
    const vecchie = slot.fiberSlotRows(slot.fiberSlotPlan(c, u), n, sizeU, bl);
    const lay = slot.fiberNodeLayout(nodo(c, null, u), n);
    const nuove = slot.fiberLayoutRows(lay, sizeU, bl);
    const msg = `${c || '-'}/${u}/${n}/${sizeU}U/${bl}`;
    if (!vecchie) { assert.equal(nuove, null, msg); continue; }
    assert.deepEqual(nuove.map((r) => r.flatMap((s) => s.ports)), vecchie, msg);
  }
});

test('composto: ogni modulo ha le sue porte, la lastra nessuna, e si numerano di seguito', () => {
  const lay = slot.fiberNodeLayout(nodo('lc-duplex', ['lc-duplex', 'lc-quad', 'blank', 'mpo-12', 'sc-duplex', 'sc']), 6);
  assert.equal(lay.composed, true);
  assert.deepEqual(chiavi(lay), ['lc-duplex', 'lc-quad', 'blank', 'mpo-12', 'sc-duplex', 'sc']);
  assert.deepEqual(porte(lay), ['1', '2,3', '', '4', '5', '6']);
  assert.deepEqual(lay.slots.map((s) => s.plan.cells), [1, 2, 0, 1, 1, 1]);
  // con la porta = singolo connettore i moduli multipli danno una porta per connettore
  const sing = slot.fiberNodeLayout(nodo('lc-duplex', ['lc-duplex', 'lc-quad', 'blank', 'mpo-12'], 'single'), 8);
  assert.deepEqual(porte(sing), ['1,2', '3,4,5,6', '', '7']);
});

test('composto: il numero di porte dichiarato taglia (le porte oltre non esistono) e non ne inventa', () => {
  const lay = slot.fiberNodeLayout(nodo('sc', ['sc', 'sc', 'sc']), 2);
  assert.deepEqual(porte(lay), ['1', '2', ''], 'il terzo slot non ha la sua porta');
  assert.equal(slot.fiberNodeLayout(nodo('sc', ['sc', 'sc']), 99).slots.flatMap((s) => s.ports).length, 2, 'porte in piu\' di quelle dei moduli: non si disegnano');
});

test('composto: la scatola e\' alta per tutti se ALMENO un modulo lo e\'; uniforme alto resta alto', () => {
  assert.equal(slot.fiberNodeLayout(nodo('lc-duplex', ['lc-duplex', 'sc']), 2).tall, false);
  const misto = slot.fiberNodeLayout(nodo('lc-duplex', ['lc-duplex', 'lc-quad', 'sc']), 4);
  assert.equal(misto.tall, true);
  for (const s of misto.slots) assert.equal(s.plan.slotH, slot.fiberSlotPlan('lc-quad', 'duplex').slotH, `${s.key}: tutti alla stessa altezza`);
  assert.equal(slot.fiberNodeLayout(nodo('lc-quad'), 4).tall, true);
  assert.equal(slot.fiberNodeLayout(nodo('lc-duplex', ['blank', 'blank']), 0).tall, false);
  assert.equal(slot.fiberNodeLayout(nodo('lc-duplex', ['blank', 'sc-duplex']), 1).tall, true, 'anche l\'SC duplex e\' alto');
});

// ── Le file ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('file del composto: 24 slot a fila, una per U, le lastre occupano il loro slot e non hanno porte', () => {
  const keys = new Array(30).fill('lc-duplex'); keys[4] = 'blank'; keys[25] = 'mpo-12';
  const lay = slot.fiberNodeLayout(nodo('lc-duplex', keys), slot.fiberPortCount(keys, 'duplex'));
  assert.equal(slot.fiberLayoutRows(lay, 1, undefined), null, '30 slot non entrano in 1U');
  const due = slot.fiberLayoutRows(lay, 2, undefined);
  assert.deepEqual(due.map((r) => r.length), [24, 6]);
  assert.equal(due[0][4].key, 'blank', 'la lastra e\' il quinto slot della prima fila');
  assert.equal(due[1][1].key, 'mpo-12', 'il 26esimo slot e\' il secondo della seconda fila');
  assert.deepEqual(due[0][5].ports, [5], 'dopo la lastra la numerazione prosegue senza buco');
  assert.equal(slot.fiberLayoutRows(lay, 1, 'linear').length, 1, 'lineare: una fila sola');
  assert.equal(slot.fiberLayoutRows(lay, 2, 'sequential'), null);
  assert.equal(slot.fiberLayoutRows(lay, 2, 'alternating'), null);
  assert.equal(slot.fiberLayoutRows({ slots: [] }, 2, undefined), null, 'niente slot, niente file');
});

// ── Conti e parole ──────────────────────────────────────────────────────────────────────────────────────────────
test('conti: porte, fibre, lastre; le fibre di un modulo senza connettore non si sanno (0)', () => {
  const k = ['lc-duplex', 'lc-quad', 'blank', 'mpo-12', 'sc-duplex', 'sc', 'mpo-24'];
  assert.deepEqual(slot.fiberCompositionStats(k, 'duplex'), { slots: 7, empty: 1, ports: 1 + 2 + 0 + 1 + 1 + 1 + 1, fibres: 2 + 4 + 12 + 2 + 1 + 24 });
  assert.deepEqual(slot.fiberCompositionStats(k, 'single'), { slots: 7, empty: 1, ports: 2 + 4 + 0 + 1 + 2 + 1 + 1, fibres: 2 + 4 + 12 + 2 + 1 + 24 }, 'cambia il conto delle porte, non le fibre');
  assert.deepEqual(slot.fiberCompositionStats([], 'duplex'), { slots: 0, empty: 0, ports: 0, fibres: 0 });
  assert.equal(slot.fiberCompositionStats([''], 'duplex').fibres, 0);
  assert.equal(slot.fiberPortCount(k, 'duplex'), 7);
  assert.equal(slot.fiberPortCount(k, 'single'), 11);
});

test('a parole: i tratti consecutivi dello stesso modulo, numerati da 1', () => {
  assert.deepEqual(slot.fiberCompositionRuns(['sc', 'sc', 'sc', 'mpo-12', 'blank', 'blank', 'sc']),
    [{ from: 1, to: 3, key: 'sc' }, { from: 4, to: 4, key: 'mpo-12' }, { from: 5, to: 6, key: 'blank' }, { from: 7, to: 7, key: 'sc' }]);
  assert.deepEqual(slot.fiberCompositionRuns([]), []);
  assert.deepEqual(slot.fiberCompositionRuns(['sc']), [{ from: 1, to: 1, key: 'sc' }]);
});

// ── L'impatto sulla numerazione ─────────────────────────────────────────────────────────────────────────────────
const lay = (keys, unit, ports) => slot.fiberLayoutOfKeys(keys, unit, ports === undefined ? slot.fiberPortCount(keys, unit) : ports);

test('cambiare un modulo con lo STESSO numero di porte sposta solo quella porta', () => {
  const prima = lay(['lc-duplex', 'lc-duplex', 'lc-duplex'], 'duplex');
  assert.deepEqual(slot.fiberLayoutChanges(prima, prima), []);
  assert.deepEqual(slot.fiberLayoutChanges(prima, lay(['lc-duplex', 'mpo-12', 'lc-duplex'], 'duplex')), [2], 'una porta per modulo: cambia solo la 2');
});

test('un modulo che guadagna porte RINUMERA tutte le seguenti', () => {
  const prima = lay(['lc-duplex', 'lc-duplex', 'lc-duplex', 'lc-duplex'], 'duplex');
  const dopo = lay(['lc-duplex', 'lc-quad', 'lc-duplex', 'lc-duplex'], 'duplex');
  assert.deepEqual(slot.fiberLayoutChanges(prima, dopo), [2, 3, 4, 5], 'la 1 resta; dalla 2 in poi cambia tutto; la 5 non esisteva');
});

test('una lastra al posto di un modulo: le porte dopo scalano, le ultime spariscono', () => {
  const prima = lay(['sc', 'sc', 'sc', 'sc'], 'duplex');
  assert.deepEqual(slot.fiberLayoutChanges(prima, lay(['sc', 'blank', 'sc', 'sc'], 'duplex')), [2, 3, 4], 'la 2 e\' ora quello che era la 3; la 4 non c\'e\' piu\'');
  assert.deepEqual(slot.fiberLayoutChanges(prima, lay(['sc', 'sc', 'sc', 'blank'], 'duplex')), [4], 'una lastra IN CODA toglie solo l\'ultima');
});

test('cambiare l\'unita\' di conto rinumera i moduli con piu\' connettori', () => {
  const k = ['lc-quad', 'lc-duplex'];
  // duplex: quad = porte 1,2 · duplex = porta 3.   singolo: quad = 1,2,3,4 · duplex = 5,6.
  assert.deepEqual(slot.fiberLayoutChanges(lay(k, 'duplex'), lay(k, 'single')), [3, 4, 5, 6], 'le prime due porte del quad restano dove sono');
  assert.deepEqual(slot.fiberLayoutChanges(lay(['sc', 'st'], 'duplex'), lay(['sc', 'st'], 'single')), [], 'senza moduli multipli l\'unita\' non conta');
});

test('la stessa composizione non cambia niente, qualunque sia', () => {
  for (const k of [['sc'], ['sc', 'blank', 'lc-quad', 'mpo-24', 'sc-duplex'], []]) for (const u of ['duplex', 'single']) {
    assert.deepEqual(slot.fiberLayoutChanges(lay(k, u), lay(k, u)), [], `${k.join()}/${u}`);
  }
});

test('l\'impatto conta i numeri dei layout veri, anche con l\'ultimo modulo mezzo vuoto', () => {
  const prima = slot.fiberNodeLayout(nodo('lc-quad', null, 'duplex'), 3);   // 2 moduli: [1,2] [3]
  const dopo = lay(['lc-quad', 'lc-quad'], 'duplex');                      // [1,2] [3,4]
  assert.deepEqual(slot.fiberLayoutChanges(prima, dopo), [4], 'la 4 compare; la 3 e\' sempre l\'ultimo slot, prima cella');
});

// ── Gli strumenti dell'editor ───────────────────────────────────────────────────────────────────────────────────
test('mettere un modulo in un tratto: estremi inclusi, in qualunque ordine, copia nuova, fuori dall\'elenco niente', () => {
  const k = ['a', 'b', 'c', 'd'];
  const orig = ['sc', 'sc', 'sc', 'sc'];
  assert.deepEqual(slot.fiberComposeSet(orig, 2, 3, 'mpo-12'), ['sc', 'mpo-12', 'mpo-12', 'sc']);
  assert.deepEqual(slot.fiberComposeSet(orig, 3, 2, 'mpo-12'), ['sc', 'mpo-12', 'mpo-12', 'sc'], 'ordine invertito');
  assert.deepEqual(slot.fiberComposeSet(orig, 1, 99, 'blank'), ['blank', 'blank', 'blank', 'blank'], 'oltre la fine si ferma');
  assert.deepEqual(slot.fiberComposeSet(orig, -5, 1, 'st'), ['st', 'sc', 'sc', 'sc'], 'prima dell\'inizio parte da 1');
  assert.deepEqual(slot.fiberComposeSet(orig, 9, 12, 'st'), orig, 'tutto fuori');
  assert.deepEqual(slot.fiberComposeSet(orig, 1, 2, 'e2000'), orig, 'un modulo che non esiste non si mette');
  assert.deepEqual(slot.fiberComposeSet(orig, 1, 2, 'lc-simplex'), orig, 'LC simplex non e\' un modulo');
  assert.deepEqual(slot.fiberComposeSet(orig, 'x', 2, 'st'), orig, 'estremo non numerico');
  assert.deepEqual(orig, ['sc', 'sc', 'sc', 'sc'], 'l\'originale non si tocca');
  assert.notEqual(slot.fiberComposeSet(orig, 5, 6, 'sc'), orig);
  assert.deepEqual(k, ['a', 'b', 'c', 'd']);
});

test('cambiare quanti slot: i nuovi hanno il modulo di partenza, i tolti spariscono dalla coda, da 1 a FIBER_MAX_SLOTS', () => {
  assert.deepEqual(slot.fiberComposeResize(['sc', 'st'], 4, 'fc'), ['sc', 'st', 'fc', 'fc']);
  assert.deepEqual(slot.fiberComposeResize(['sc', 'st', 'fc'], 2, 'x'), ['sc', 'st']);
  assert.deepEqual(slot.fiberComposeResize(['sc'], 0, 'fc'), ['sc'], 'mai zero slot');
  assert.deepEqual(slot.fiberComposeResize(['sc'], 'boh', 'fc'), ['sc']);
  assert.equal(slot.fiberComposeResize(['sc'], 99999, 'fc').length, slot.FIBER_MAX_SLOTS);
  assert.equal(slot.fiberComposeResize(['sc', 'sc'], 2.9, 'fc').length, 2);
});

test('cosa scrivere nel nodo: tutti uguali = cassetto uniforme con quel connettore; la lastra sola no; porte sempre dai moduli', () => {
  assert.deepEqual(slot.fiberComposeResult(['sc', 'sc', 'sc'], 'duplex'), { connector: 'sc', slots: null, ports: 3 });
  assert.deepEqual(slot.fiberComposeResult(['lc-quad', 'lc-quad'], 'duplex'), { connector: 'lc-quad', slots: null, ports: 4 });
  assert.deepEqual(slot.fiberComposeResult(['lc-quad', 'lc-quad'], 'single'), { connector: 'lc-quad', slots: null, ports: 8 });
  assert.deepEqual(slot.fiberComposeResult(['sc', 'mpo-12'], 'duplex'), { connector: null, slots: ['sc', 'mpo-12'], ports: 2 });
  assert.deepEqual(slot.fiberComposeResult(['blank', 'blank'], 'duplex'), { connector: null, slots: ['blank', 'blank'], ports: 0 }, 'tutte lastre: e\' una composizione, non un connettore');
  assert.deepEqual(slot.fiberComposeResult(['sc'], 'duplex'), { connector: 'sc', slots: null, ports: 1 });
  assert.deepEqual(slot.fiberComposeResult([], 'duplex'), { connector: null, slots: [], ports: 0 });
  assert.equal(slot.fiberComposeResult(new Array(500).fill('sc'), 'duplex').ports, slot.FIBER_MAX_SLOTS, 'il tetto vale anche qui');
});

test('i numeri a parole: i consecutivi in un tratto, ordinati, senza doppioni, solo numeri', () => {
  assert.equal(slot.fiberRangesText([2, 3, 4, 5, 8]), '2–5, 8');
  assert.equal(slot.fiberRangesText([8, 2, 5, 4, 3, 3]), '2–5, 8', 'ordina e toglie i doppioni');
  assert.equal(slot.fiberRangesText([7]), '7');
  assert.equal(slot.fiberRangesText([1, 3, 5]), '1, 3, 5');
  assert.equal(slot.fiberRangesText([4, 5]), '4–5');
  assert.equal(slot.fiberRangesText([]), '');
  assert.equal(slot.fiberRangesText(['x', 3, null, NaN, 4]), '3–4', 'cio\' che non e\' un numero non entra');
});

test('come si dividono gli slot in file: 24 a fila, una per U, intervalli [da, a) esatti; lineare una sola; sequenziale/alternato nessuna', () => {
  assert.deepEqual(slot.fiberRowRanges(24, 1), [[0, 24]]);
  assert.deepEqual(slot.fiberRowRanges(30, 2), [[0, 24], [24, 30]], 'l\'ultima fila finisce all\'ultimo slot, non oltre');
  assert.deepEqual(slot.fiberRowRanges(48, 2), [[0, 24], [24, 48]]);
  assert.deepEqual(slot.fiberRowRanges(49, 2), null, 'una fila in piu\' delle U');
  assert.deepEqual(slot.fiberRowRanges(5, 1), [[0, 5]]);
  assert.deepEqual(slot.fiberRowRanges(70, 1, 'linear'), [[0, 70]], 'lineare: UNA fila, qualunque numero');
  assert.deepEqual(slot.fiberRowRanges(7, undefined), [[0, 7]], 'U non dichiarate = 1');
  assert.deepEqual(slot.fiberRowRanges(30, 2.9), [[0, 24], [24, 30]], 'U frazionarie: si arrotonda per difetto');
  for (const bl of ['sequential', 'alternating']) assert.equal(slot.fiberRowRanges(10, 2, bl), null, bl);
  for (const n of [0, -3, NaN, undefined]) assert.equal(slot.fiberRowRanges(n, 2), null, `${n} slot: niente file`);
});
