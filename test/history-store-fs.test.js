'use strict';
// ============================================================
// HISTORY STORE (fs) — contratto dell'interfaccia storico (Fase 3).
// Testa il BACKEND a file di historyStore: append/list/retention/filtri.
// È il "contratto" che un domani il backend SQLite (ADR D7) dovrà ripassare
// identico — per questo i test parlano all'interfaccia, non ai file.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFsHistoryStore } = require('../server/history-store-fs.js');

function freshStore(opts = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-hist-'));
  return { store: createFsHistoryStore(Object.assign({ baseDir }, opts)), baseDir };
}
// entry minimale, come la scrive la route (at server-stamped 'YYYY-MM-DD HH:MM:SS').
function entry(at, extra = {}) {
  return Object.assign({ at, by: 'tester', verify: 'manual', counts: { stateDrift: 1 }, totals: { nodes: 3, cables: 2 } }, extra);
}

test('baseDir è obbligatorio (interfaccia esplicita, niente default nascosto)', () => {
  assert.throws(() => createFsHistoryStore({}), /baseDir/);
});

test('append poi list ritorna la riga, e crea la cartella progetto on-demand', () => {
  const { store, baseDir } = freshStore();
  store.appendTimeline(7, entry('2999-01-01 10:00:00'));
  const rows = store.listTimeline(7);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].by, 'tester');
  assert.equal(rows[0].verify, 'manual');
  assert.ok(fs.existsSync(path.join(baseDir, '7', 'timeline.jsonl')), 'timeline.jsonl creato');
});

test('append multipli preservano l\'ordine cronologico (= ordine d\'append)', () => {
  const { store } = freshStore();
  store.appendTimeline(1, entry('2999-01-01 10:00:00', { by: 'a' }));
  store.appendTimeline(1, entry('2999-01-01 10:05:00', { by: 'b' }));
  store.appendTimeline(1, entry('2999-01-01 10:10:00', { by: 'c' }));
  assert.deepEqual(store.listTimeline(1).map(r => r.by), ['a', 'b', 'c']);
});

test('retention per NUMERO: cap tiene solo le ultime N', () => {
  const { store } = freshStore({ timelineCap: 3 });
  for (let i = 0; i < 6; i++) store.appendTimeline(2, entry('2999-01-01 10:0' + i + ':00', { by: 'e' + i }));
  const rows = store.listTimeline(2);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.by), ['e3', 'e4', 'e5'], 'restano le ultime 3');
});

test('retention per ETÀ: una riga più vecchia della soglia viene potata all\'append', () => {
  const { store } = freshStore({ timelineMaxAgeMs: 24 * 3600 * 1000 }); // 1 giorno
  store.appendTimeline(3, entry('2000-01-01 00:00:00'));                 // vecchissima
  assert.equal(store.listTimeline(3).length, 0, 'la riga oltre soglia sparisce');
  store.appendTimeline(3, entry('2999-01-01 00:00:00'));                 // futura → resta
  assert.equal(store.listTimeline(3).length, 1);
});

test('filtri from/to/limit su listTimeline', () => {
  const { store } = freshStore();
  ['2999-01-01 10:00:00', '2999-01-02 10:00:00', '2999-01-03 10:00:00'].forEach((at, i) =>
    store.appendTimeline(4, entry(at, { by: 'd' + i })));
  assert.equal(store.listTimeline(4, { from: '2999-01-02 00:00:00' }).length, 2, 'from esclude la prima');
  assert.equal(store.listTimeline(4, { to: '2999-01-02 23:59:59' }).length, 2, 'to esclude l\'ultima');
  assert.deepEqual(store.listTimeline(4, { limit: 1 }).map(r => r.by), ['d2'], 'limit = ultime N');
});

test('list di un progetto senza storico ritorna [] (nessun file, nessun crash)', () => {
  const { store } = freshStore();
  assert.deepEqual(store.listTimeline(999), []);
});

test('una riga corrotta nel JSONL viene saltata, non rompe la lettura', () => {
  const { store, baseDir } = freshStore();
  const dir = path.join(baseDir, '5');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'timeline.jsonl'),
    JSON.stringify(entry('2999-01-01 10:00:00', { by: 'ok1' })) + '\n' +
    '{ questo non è json }\n' +
    JSON.stringify(entry('2999-01-01 10:01:00', { by: 'ok2' })) + '\n');
  assert.deepEqual(store.listTimeline(5).map(r => r.by), ['ok1', 'ok2']);
});

test('pruneTimeline on-demand applica la stessa politica dell\'append', () => {
  const { store, baseDir } = freshStore({ timelineCap: 2 });
  // scrive 4 righe "a mano" (bypassando l'append) poi pota
  const dir = path.join(baseDir, '6');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'timeline.jsonl'),
    [0, 1, 2, 3].map(i => JSON.stringify(entry('2999-01-01 10:0' + i + ':00', { by: 'p' + i }))).join('\n') + '\n');
  const left = store.pruneTimeline(6);
  assert.equal(left, 2);
  assert.deepEqual(store.listTimeline(6).map(r => r.by), ['p2', 'p3']);
});
