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
  redo() { const r = H.redo(this.points, this.idx, this.snap()); if (!r) return false; this.points = r.points; this.idx = r.idx; this.v = Number(r.restore.slice(4)); this.pending = false; return true; }
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
  for (const t of ['text', 'number', 'search', 'password', 'email', 'url', 'tel']) {
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
  assert.equal(H.isTextEditingTarget(el('INPUT', { type: 'DATE' })), false, 'il tipo si legge senza badare alle maiuscole');
  assert.equal(H.isTextEditingTarget(el('DIV', {})), false);
  assert.equal(H.isTextEditingTarget(el('INPUT', { type: 'text', readOnly: true })), false, 'sola lettura: niente da annullare');
  assert.equal(H.isTextEditingTarget(el('INPUT', { type: 'text', disabled: true })), false);
  assert.equal(H.isTextEditingTarget(null), false);
  assert.equal(H.isTextEditingTarget(undefined), false);
});

test('i campi data/ora non sono testo: li\' il Ctrl+Z e\' del progetto (garanzia, fine vita...)', () => {
  const el = (type, extra) => Object.assign({ tagName: 'INPUT', type }, extra);
  for (const t of ['date', 'time', 'month', 'week', 'datetime-local']) {
    assert.equal(H.isTextEditingTarget(el(t)), false, 'input ' + t + ': il browser non ha una storia di testo da annullare');
  }
  // …e quelli in cui si SCRIVE restano del campo
  for (const t of ['text', 'number', 'search', 'email', 'tel', 'url', 'password']) {
    assert.equal(H.isTextEditingTarget(el(t)), true, 'input ' + t + ' resta testo');
  }
});

// ── La FOTO non contiene la vista ───────────────────────────────────────────────

// Uno stato che somiglia a quello vero: il documento (n, racks) piu' le chiavi che la foto lascia fuori.
const stato = () => ({
  n: 0, racks: [{ id: 'r1' }, { id: 'r2' }],
  currentRack: 'r1', floorView: { x: 0, y: 0, zoom: 1 }, rackView: { zoom: 1 },
  bgImage: 'data:image/png;base64,AAAA', auditLog: [{ action: 'x' }],
});

test('la foto non cambia per un pan, uno zoom o un cambio di scheda del rack (non sono operazioni)', () => {
  const s = stato();
  const p0 = H.photo(s);
  s.floorView.x = 250; s.floorView.zoom = 2;
  assert.equal(H.photo(s), p0, 'pan e zoom della planimetria');
  s.rackView.zoom = 1.5;
  assert.equal(H.photo(s), p0, 'zoom del rack');
  s.currentRack = 'r2';
  assert.equal(H.photo(s), p0, 'scheda del rack');
  s.bgImage = null; s.auditLog = undefined;
  assert.equal(H.photo(s), p0, 'sfondo e giornale restano fuori, come prima');
  s.n = 1;
  assert.notEqual(H.photo(s), p0, 'il DOCUMENTO invece si vede');
  for (const k of H.OUTSIDE_PHOTO) assert.equal(H.photo(stato()).includes('"' + k + '"'), false, k + ' non e\' nella foto');
});

test('photo non muta lo stato e tiene l\'ordine delle chiavi (due foto dello stesso documento sono la stessa stringa)', () => {
  const s = stato();
  const copia = JSON.stringify(s);
  H.photo(s);
  assert.equal(JSON.stringify(s), copia, 'lo stato e\' intatto');
  const a = { n: 1, racks: [], zz: 1 }, b = JSON.parse(JSON.stringify(a));
  assert.equal(H.photo(a), H.photo(b));
});

// Un «progetto» minimo con la storia, come lo guida app-history.js: foto PRIMA di ogni operazione, il pan non registra.
class Prog {
  constructor(snapFn) { this.s = stato(); this.points = []; this.idx = -1; this.snapFn = snapFn || H.photo; }
  snap() { return this.snapFn(this.s); }
  op() { const r = H.record(this.points, this.idx, this.snap()); this.points = r.points; this.idx = r.idx; this.s.n++; }
  pan() { this.s.floorView.x += 40; }      // markDirty() e basta: la vista non e' una foto
  undo() { const r = H.undo(this.points, this.idx, this.snap()); if (!r) return false; this.points = r.points; this.idx = r.idx; this.s = H.rebuild(r.restore, this.s); return true; }
  redo() { const r = H.redo(this.points, this.idx, this.snap()); if (!r) return false; this.points = r.points; this.idx = r.idx; this.s = H.rebuild(r.restore, this.s); return true; }
}
const naive = (s) => { const c = Object.assign({}, s); delete c.bgImage; delete c.auditLog; return JSON.stringify(c); };   // la foto di prima: con la vista dentro

test('3 operazioni, Ctrl+Z, un pan, Ctrl+Z: il secondo Ctrl+Z toglie un\'OPERAZIONE e il ripeti arriva alla terza', () => {
  const p = new Prog();
  p.op(); p.op(); p.op();                  // n = 3
  assert.ok(p.undo());                     // n = 2
  assert.equal(p.s.n, 2);
  p.pan();                                 // la vista si muove: nessuno registra niente
  assert.ok(p.undo());
  assert.equal(p.s.n, 1, 'il secondo Ctrl+Z toglie la seconda operazione (non il pan)');
  assert.equal(p.s.floorView.x, 40, 'e la vista resta dov\'e\': non torna indietro con l\'operazione');
  assert.ok(p.redo()); assert.equal(p.s.n, 2);
  assert.ok(p.redo()); assert.equal(p.s.n, 3, 'Ctrl+Y torna alla TERZA operazione (prima il pan aveva buttato il ripeti)');
  assert.equal(p.redo(), false);
  assert.equal(p.s.floorView.x, 40);
});

test('la prova del guasto: con la vista nella foto, lo stesso gesto butta il ripeti', () => {
  const p = new Prog(naive);               // la foto di prima
  p.op(); p.op(); p.op(); p.undo(); p.pan(); p.undo();
  assert.equal(p.s.n, 2, 'il secondo Ctrl+Z ha annullato solo il pan');
  p.redo();
  assert.equal(p.s.n, 2, 'e il ripeti non arriva piu\' alla terza operazione');
});

test('rebuild riaggancia sfondo, giornale e vista dallo stato CORRENTE, e non muta niente', () => {
  const prima = stato(); prima.n = 7;
  const snap = H.photo(prima);
  const adesso = stato(); adesso.n = 9;
  adesso.bgImage = 'BG-ADESSO'; adesso.auditLog = [{ action: 'a' }, { action: 'b' }];
  adesso.floorView = { x: 300, y: -20, zoom: 2 }; adesso.rackView = { zoom: 3 }; adesso.currentRack = 'r2';
  const copia = JSON.stringify(adesso);
  const s = H.rebuild(snap, adesso);
  assert.equal(s.n, 7, 'il documento e\' quello della foto');
  assert.equal(s.bgImage, 'BG-ADESSO');
  assert.equal(s.auditLog, adesso.auditLog, 'il giornale e\' lo stesso (append-only)');
  assert.deepEqual(s.floorView, { x: 300, y: -20, zoom: 2 });
  assert.deepEqual(s.rackView, { zoom: 3 });
  assert.equal(s.currentRack, 'r2');
  assert.equal(JSON.stringify(adesso), copia, 'lo stato corrente non e\' toccato');
  s.floorView.x = 1;
  assert.equal(adesso.floorView.x, 300, 'la vista ripristinata e\' una copia: muoverla non sposta quella di prima');
});

test('rebuild: il rack mostrato deve esistere nel progetto ripristinato (annullare «aggiungi rack»), altrimenti il primo', () => {
  const unRack = stato(); unRack.racks = [{ id: 'r1' }];
  const snap = H.photo(unRack);
  const adesso = stato(); adesso.currentRack = 'r2';          // la scheda del rack appena aggiunto
  assert.equal(H.rebuild(snap, adesso).currentRack, 'r1', 'quello di prima dell\'aggiunta: il primo che c\'e\'');
  const nessuno = stato(); nessuno.racks = [];
  assert.equal(H.rebuild(H.photo(nessuno), adesso).currentRack, null, 'nessun rack: nessuna scheda');
  adesso.currentRack = 'r1';
  assert.equal(H.rebuild(H.photo(stato()), adesso).currentRack, 'r1', 'se esiste, resta');
});

test('rebuild tiene l\'ORDINE delle chiavi dello stato vivo: annullare non rimescola il file che si salva dopo', () => {
  const vivo = stato(); vivo.n = 9;
  const ordine = Object.keys(vivo);
  const s = H.rebuild(H.photo(stato()), vivo);
  assert.deepEqual(Object.keys(s), ordine);
  assert.equal(JSON.stringify(Object.assign({}, s, { bgImage: null, auditLog: undefined })), JSON.stringify(Object.assign({}, stato(), { bgImage: null, auditLog: undefined })),
    'stesso progetto, stessa stringa (anche con la vista dentro)');
  // con le cinque chiavi in mezzo, non in fondo
  const misto = { a: 1, floorView: { x: 1, y: 2, zoom: 1 }, b: 2, bgImage: 'B', racks: [{ id: 'r1' }], currentRack: 'r1', rackView: { zoom: 1 }, auditLog: [] };
  assert.deepEqual(Object.keys(H.rebuild(H.photo(misto), misto)), Object.keys(misto));
});

test('rebuild senza sorgente: vista di default, niente che lanci', () => {
  const s = H.rebuild(H.photo(stato()));
  assert.deepEqual(s.floorView, { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(s.rackView, { zoom: 1 });
  assert.equal(s.currentRack, 'r1');
});

test('un\'operazione che sostituisce il progetto (importa JSON): le cose fuori foto di PRIMA tornano con l\'annulla', () => {
  // outsidePhoto le prende PRIMA della sostituzione; rebuild le riattacca anche se lo stato corrente e' un altro
  const prima = stato(); prima.n = 1; prima.bgImage = 'BG-VECCHIO'; prima.auditLog = [{ action: 'vecchia' }];
  prima.floorView = { x: 10, y: 20, zoom: 1.5 };
  const punto = H.photo(prima), fuori = H.outsidePhoto(prima);
  prima.floorView.x = 999;                       // la vista di prima si muove sul posto: la copia non la segue
  const importato = stato(); importato.n = 50; importato.bgImage = 'BG-IMPORTATO'; importato.auditLog = [{ action: 'del-file' }];
  const tornato = H.rebuild(punto, fuori);
  assert.equal(tornato.n, 1);
  assert.equal(tornato.bgImage, 'BG-VECCHIO', 'lo sfondo di prima, non quello del file importato');
  assert.deepEqual(tornato.auditLog, [{ action: 'vecchia' }], 'il giornale di prima');
  assert.deepEqual(tornato.floorView, { x: 10, y: 20, zoom: 1.5 });
  assert.equal(H.rebuild(punto, importato).bgImage, 'BG-IMPORTATO', 'senza, riagganciava quello del file (il difetto)');
});

// ── Ripeti con una modifica non registrata ───────────────────────────────────────

test('ripeti NON sovrascrive una modifica non registrata dopo l\'annulla: la tiene da parte, come fa annulla', () => {
  const d = new Doc();
  d.op(+1); d.op(+10);                    // 0 → 1 → 11
  assert.ok(d.undo());                    // 1   (il ripeti ha 11)
  assert.equal(d.v, 1);
  d.v += 100;                             // 101: un campo del pannello, o un giro silenzioso del monitor
  assert.ok(d.redo());
  assert.equal(d.v, 11, 'il ripeti arriva dove doveva');
  assert.ok(d.undo());
  assert.equal(d.v, 101, 'e Ctrl+Z torna alla modifica che il ripeti aveva scavalcato (prima andava persa)');
  assert.ok(d.undo());
  assert.equal(d.v, 1);
  assert.ok(d.undo());
  assert.equal(d.v, 0);
  assert.equal(d.undo(), false);
});

test('ripeti con la modifica non registrata: nessuno stato si perde, in avanti e indietro', () => {
  const d = new Doc();
  d.op(+1); d.op(+10); d.op(+100);        // 0 → 1 → 11 → 111
  d.undo(); d.undo();                     // 1
  d.v += 1000;                            // 1001
  const avanti = [];
  while (d.redo()) avanti.push(d.v);
  assert.deepEqual(avanti, [11, 111], 'il ripeti percorre gli stati che aveva');
  const indietro = [];
  while (d.undo()) indietro.push(d.v);
  assert.deepEqual(indietro, [11, 1001, 1, 0], 'e tornando indietro passa anche dalla modifica che nessuno aveva registrato');
});

test('ripeti senza modifiche non registrate e\' quello di sempre (stessa storia, un passo avanti)', () => {
  const points = ['a', 'b', 'c'];
  const r = H.redo(points, 0, 'a');
  assert.deepEqual(r, { points, idx: 1, restore: 'b' });
  assert.equal(r.points, points, 'nessuna copia inutile');
  assert.deepEqual(H.redo(points, 0), { points, idx: 1, restore: 'b' }, 'senza `cur` (chiamanti vecchi) idem');
});

test('ripeti con modifica non registrata ma niente da ripetere: null, e la modifica resta dov\'e\'', () => {
  assert.equal(H.redo(['a', 'b'], 1, 'zzz'), null);
  assert.equal(H.redo([], -1, 'zzz'), null);
});

test('ripeti con modifica non registrata: il tetto vale anche per il punto in piu\', e l\'indice resta giusto', () => {
  const d = new Doc();
  for (let i = 0; i < 70; i++) d.op(+1);                  // storia al tetto
  d.undo(); d.undo();                                     // 68 (annulla puo' sforare il tetto di UNO: tiene il corrente)
  const prima = d.points.length;
  d.v += 500;                                             // 568
  assert.ok(d.redo());
  assert.equal(d.v, 69);
  assert.ok(d.points.length <= Math.max(prima, H.CAP), 'il punto in piu\' non fa crescere la storia oltre il tetto: ' + d.points.length + ' (prima ' + prima + ')');
  assert.equal(d.points[d.idx], 'doc:' + d.v, 'l\'indice punta allo stato ripristinato');
  assert.ok(d.undo());
  assert.equal(d.v, 68 + 500, 'e Ctrl+Z torna alla modifica');
});
