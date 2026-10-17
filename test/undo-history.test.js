'use strict';
// ============================================================
// STORIA DI ANNULLA / RIPETI — il modello puro (lib/undo-history.js)
// ============================================================
// Quasi ogni operazione dell'app chiama pushHistory() PRIMA di modificare («sto per fare una cosa:
// ricorda com'e' ora»). Fino a questo giro undo() era scritto per la convenzione opposta (foto DOPO
// l'operazione, con una foto iniziale che il caricamento non faceva): provato con la tastiera vera,
// la prima operazione dopo il caricamento non si annullava mai, il primo Ctrl+Z ne saltava una e il
// Ctrl+Y non tornava all'ultimo stato (che nessuno aveva mai fotografato).
// Qui si prova il modello, con un «documento» di un solo numero: ogni operazione lo cambia dopo aver
// chiamato record(), esattamente come fanno i chiamanti veri.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/undo-history.js');

class Doc {
  constructor() { this.v = 0; this.points = []; this.idx = -1; this.pending = false; }
  snap() { return 'doc:' + this.v; }
  // come un chiamante vero: pushHistory() e POI la modifica
  op(delta) { const r = H.record(this.points, this.idx, this.snap()); this.points = r.points; this.idx = r.idx; this.pending = true; this.v += delta; }
  undo() { const r = H.undo(this.points, this.idx, this.snap()); if (!r) return false; this.points = r.points; this.idx = r.idx; this.v = Number(r.restore.slice(4)); this.pending = false; return true; }
  redo() { const r = H.redo(this.points, this.idx); if (!r) return false; this.idx = r.idx; this.v = Number(r.restore.slice(4)); this.pending = false; return true; }
  canUndo() { return H.canUndo(this.points, this.idx, this.pending); }
  canRedo() { return H.canRedo(this.points, this.idx); }
}

test('UNA sola operazione si annulla (era il caso che non funzionava mai) e si ripete', () => {
  const d = new Doc();
  d.op(+1);
  assert.equal(d.v, 1);
  assert.ok(d.undo(), 'la prima operazione dopo il caricamento si annulla');
  assert.equal(d.v, 0);
  assert.equal(d.undo(), false, 'e non c\'e\' niente prima');
  assert.ok(d.redo());
  assert.equal(d.v, 1, 'il ripeti torna all\'ultimo stato, anche se nessuno lo aveva «fotografato»');
  assert.equal(d.redo(), false);
});

test('una catena: Ctrl+Z torna indietro UN passo alla volta, Ctrl+Y avanti, fino all\'ultimo stato', () => {
  const d = new Doc();
  const stati = [0];
  for (const x of [1, 2, 3, 4, 5]) { d.op(x); stati.push(d.v); }       // 0, 1, 3, 6, 10, 15
  const indietro = [];
  while (d.undo()) indietro.push(d.v);
  assert.deepEqual(indietro, [10, 6, 3, 1, 0], 'ogni annulla toglie UNA operazione (prima il primo ne saltava una)');
  const avanti = [];
  while (d.redo()) avanti.push(d.v);
  assert.deepEqual(avanti, [1, 3, 6, 10, 15], 'e il ripeti arriva all\'ultimo stato');
});

test('una nuova operazione dopo un annulla butta il «futuro»: il ripeti non resuscita lo stato vecchio', () => {
  const d = new Doc();
  d.op(+1); d.op(+10);                    // 1, 11
  d.undo();                               // 1
  d.op(+100);                             // 101
  assert.equal(d.canRedo(), false);
  assert.equal(d.redo(), false);
  d.undo();
  assert.equal(d.v, 1, 'si torna a prima dell\'operazione nuova, non a quella vecchia');
  d.undo();
  assert.equal(d.v, 0);
});

test('due pushHistory di fila senza modifiche in mezzo sono UN punto solo (nessun annulla «a vuoto»)', () => {
  const d = new Doc();
  const r1 = H.record(d.points, d.idx, d.snap()); d.points = r1.points; d.idx = r1.idx;
  const r2 = H.record(d.points, d.idx, d.snap()); d.points = r2.points; d.idx = r2.idx;
  d.pending = true; d.v += 1;
  assert.equal(d.points.length, 1, 'lo stesso stato non si registra due volte');
  assert.ok(d.undo());
  assert.equal(d.v, 0, 'un solo Ctrl+Z basta');
});

test('niente di registrato: annulla e ripeti non fanno niente e non lanciano', () => {
  const d = new Doc();
  assert.equal(d.undo(), false);
  assert.equal(d.redo(), false);
  assert.equal(d.canUndo(), false);
  assert.equal(d.canRedo(), false);
  d.v = 7;   // una modifica che nessuno ha registrato, su una storia vuota
  assert.equal(d.undo(), false, 'non c\'e\' un punto a cui tornare');
  assert.equal(d.v, 7, 'e non si perde niente');
});

test('una modifica NON registrata dopo un annulla si salva prima di tornare indietro: il ripeti la ridà', () => {
  const d = new Doc();
  d.op(+1);                  // 1
  d.undo();                  // 0  (corrente == punto 0, nessuna modifica in sospeso)
  d.v += 5;                  // una modifica che nessuno ha registrato (un campo, un giro di Sync...)
  assert.ok(d.undo(), 'c\'e\' qualcosa da annullare: la modifica non registrata');
  assert.equal(d.v, 0);
  assert.ok(d.redo());
  assert.equal(d.v, 5, 'e il ripeti la ridà');
});

test('i pulsanti: annulla si accende dopo un\'operazione e si spegne a storia esaurita; ripeti dopo un annulla', () => {
  const d = new Doc();
  assert.deepEqual([d.canUndo(), d.canRedo()], [false, false]);
  d.op(+1);
  assert.deepEqual([d.canUndo(), d.canRedo()], [true, false], 'dopo una operazione si puo\' annullare');
  d.undo();
  assert.deepEqual([d.canUndo(), d.canRedo()], [false, true], 'annullata l\'unica operazione: non c\'e\' altro, ma si puo\' ripetere');
  d.redo();
  assert.deepEqual([d.canUndo(), d.canRedo()], [true, false]);
  d.op(+1); d.undo();
  assert.deepEqual([d.canUndo(), d.canRedo()], [true, true], 'in mezzo alla storia si puo\' andare nei due versi');
});

test('il tetto: si tengono gli ultimi passi, e annulla funziona fino in fondo senza sbagliare di uno', () => {
  const d = new Doc();
  for (let i = 0; i < 100; i++) d.op(+1);                 // 100
  assert.ok(d.points.length <= H.CAP + 1, 'la storia ha un tetto: ' + d.points.length);
  let n = 0; while (d.undo()) n++;
  assert.ok(n >= H.CAP - 1 && n <= H.CAP + 1, 'si annullano circa CAP passi: ' + n);
  assert.equal(d.v, 100 - n, 'ogni annulla toglie esattamente una operazione');
});

test('le funzioni non mutano i loro argomenti (la storia si sostituisce, non si modifica sul posto)', () => {
  const points = ['a', 'b'];
  const copia = points.slice();
  H.record(points, 1, 'c'); H.undo(points, 1, 'x'); H.redo(points, 0);
  assert.deepEqual(points, copia);
});

// ── la tastiera ───────────────────────────────────────────────────────────────

test('quale combinazione e\' annulla e quale ripeti — anche con Maiusc o Bloc Maiusc, quando il browser dice «Z»', () => {
  const k = (key, mods) => H.shortcutAction(Object.assign({ key }, mods));
  assert.equal(k('z', { ctrlKey: true }), 'undo');
  assert.equal(k('z', { metaKey: true }), 'undo', 'Cmd+Z su Mac');
  assert.equal(k('Z', { ctrlKey: true }), 'undo', 'Bloc Maiusc acceso: Ctrl+Z arriva come «Z»');
  assert.equal(k('Z', { ctrlKey: true, shiftKey: true }), 'redo', 'Ctrl+Maiusc+Z: con Maiusc il browser dice «Z» maiuscola (non ha mai funzionato)');
  assert.equal(k('z', { ctrlKey: true, shiftKey: true }), 'redo');
  assert.equal(k('Z', { metaKey: true, shiftKey: true }), 'redo', 'Cmd+Maiusc+Z su Mac');
  assert.equal(k('y', { ctrlKey: true }), 'redo');
  assert.equal(k('Y', { ctrlKey: true }), 'redo');
});

test('quello che NON e\' annulla/ripeti resta fuori', () => {
  const k = (key, mods) => H.shortcutAction(Object.assign({ key }, mods));
  assert.equal(k('z', {}), null, 'la lettera da sola non e\' un comando');
  assert.equal(k('z', { shiftKey: true }), null);
  assert.equal(k('s', { ctrlKey: true }), null, 'Ctrl+S e\' un altro comando');
  assert.equal(k('a', { ctrlKey: true }), null);
  assert.equal(k('z', { ctrlKey: true, altKey: true }), null, 'con Alt (AltGr = Ctrl+Alt) si scrivono lettere');
  assert.equal(H.shortcutAction(null), null);
  assert.equal(H.shortcutAction({}), null);
  assert.equal(H.shortcutAction({ ctrlKey: true }), null, 'senza lettera');
});

test('dove si SCRIVE il tasto e\' del campo (annulla il testo), altrove e\' dell\'app', () => {
  const el = (tagName, extra) => Object.assign({ tagName }, extra);
  for (const t of ['text', 'number', 'search', 'password', 'email', 'url', 'tel', 'date']) {
    assert.equal(H.isTextEditingTarget(el('INPUT', { type: t })), true, 'input ' + t);
  }
  assert.equal(H.isTextEditingTarget(el('INPUT', {})), true, 'input senza type = testo');
  assert.equal(H.isTextEditingTarget(el('TEXTAREA', {})), true);
  assert.equal(H.isTextEditingTarget(el('DIV', { isContentEditable: true })), true);
  for (const t of ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file']) {
    assert.equal(H.isTextEditingTarget(el('INPUT', { type: t })), false, 'input ' + t + ' non e\' testo');
  }
  assert.equal(H.isTextEditingTarget(el('SELECT', {})), false);
  assert.equal(H.isTextEditingTarget(el('BUTTON', {})), false);
  assert.equal(H.isTextEditingTarget(el('DIV', {})), false);
  assert.equal(H.isTextEditingTarget(el('INPUT', { type: 'text', readOnly: true })), false, 'sola lettura: niente da annullare');
  assert.equal(H.isTextEditingTarget(el('INPUT', { type: 'text', disabled: true })), false);
  assert.equal(H.isTextEditingTarget(null), false);
  assert.equal(H.isTextEditingTarget(undefined), false);
});
