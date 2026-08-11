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
// Semina un indice snapshot + blob (vuoti) "a mano", per testare l'assottigliamento
// con un `now` iniettato (deterministico). specs: [{id, at, label?}].
function seedSnaps(baseDir, pid, specs) {
  const dir = path.join(baseDir, String(pid), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const metas = specs.map(s => ({ id: String(s.id), at: s.at, by: 't', label: s.label || '', reason: '', sizeGz: 1 }));
  metas.forEach(m => fs.writeFileSync(path.join(dir, m.id + '.json.gz'), ''));
  fs.writeFileSync(path.join(baseDir, String(pid), 'snapshots.jsonl'), metas.map(m => JSON.stringify(m)).join('\n') + '\n');
  return metas;
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

test('removeProject elimina timeline, snapshot e indice del progetto', () => {
  const { store, baseDir } = freshStore();
  store.appendTimeline(998, entry('2999-01-01 10:00:00'));
  store.putSnapshot(998, { at: '2999-01-01 10:01:00', by: 'me' }, { nodes: [] });
  assert.equal(fs.existsSync(path.join(baseDir, '998')), true);
  assert.equal(store.removeProject(998), true);
  assert.equal(fs.existsSync(path.join(baseDir, '998')), false);
  assert.equal(store.listTimeline(998).length, 0);
  assert.deepEqual(store.listSnapshots(998), []);
});

test('removeProjectHistory rifiuta base vuota e identificativi non numerici', () => {
  const { removeProjectHistory } = require('../server/history-store-fs.js');
  assert.equal(removeProjectHistory('', 1), false);
  assert.equal(removeProjectHistory(path.join(os.tmpdir(), 'history-test'), '../1'), false);
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

// ── SNAPSHOT completi (Fase 4) ───────────────────────────────────────

test('putSnapshot gzip + getSnapshot round-trip dello stato INTERO', () => {
  const { store } = freshStore();
  const state = { nodes: [{ id: 'n1', name: 'sw', spec: { ports: 24 } }], links: [], filler: 'x'.repeat(6000) };
  const rec = store.putSnapshot(8, { at: '2999-01-01 10:00:00', by: 'me', reason: 'manual' }, state);
  assert.ok(rec.id, 'ritorna un id');
  assert.ok(rec.sizeGz > 0 && rec.sizeGz < 6000, 'il gzip è più piccolo dell\'originale (~6 KB filler)');
  assert.deepEqual(store.getSnapshot(8, rec.id), state, 'lo stato torna byte-identico dopo gunzip');
});

test('getSnapshot di un id inesistente → null (nessun crash)', () => {
  const { store } = freshStore();
  assert.equal(store.getSnapshot(8, 'nope'), null);
});

test('listSnapshots elenca i meta e ignora i record col blob mancante', () => {
  const { store, baseDir } = freshStore();
  const a = store.putSnapshot(9, { at: '2999-01-01 10:00:00', by: 'me' }, { nodes: [] });
  const b = store.putSnapshot(9, { at: '2999-01-01 10:01:00', by: 'me' }, { nodes: [] });
  fs.unlinkSync(path.join(baseDir, '9', 'snapshots', a.id + '.json.gz'));   // blob sparito → fuori lista
  assert.deepEqual(store.listSnapshots(9).map(m => m.id), [b.id]);
});

test('assottigliamento: <48h tutte · 48h-7g una/ora · 7g-30g una/giorno · >30g via', () => {
  const { store, baseDir } = freshStore();
  const now = Date.parse('2026-08-10 00:00:00');
  seedSnaps(baseDir, 3, [
    { id: 'keepA',   at: '2026-08-09 12:00:00' },   // <48h → tenuta
    { id: 'keepB',   at: '2026-08-09 18:00:00' },   // <48h → tenuta
    { id: 'hourOld', at: '2026-08-06 10:00:00' },   // stessa ora di hourNew, più vecchia → via
    { id: 'hourNew', at: '2026-08-06 10:30:00' },   // vince il bucket ora → tenuta
    { id: 'hour2',   at: '2026-08-06 11:00:00' },   // altra ora → tenuta
    { id: 'dayOld',  at: '2026-07-25 09:00:00' },   // stesso giorno di dayNew → via
    { id: 'dayNew',  at: '2026-07-25 20:00:00' },   // vince il bucket giorno → tenuta
    { id: 'ancient', at: '2026-05-01 00:00:00' },   // >30g → via
  ]);
  store.pruneSnapshots(3, { now });
  assert.deepEqual(store.listSnapshots(3).map(m => m.id).sort(),
    ['dayNew', 'hour2', 'hourNew', 'keepA', 'keepB'].sort());
  assert.ok(!fs.existsSync(path.join(baseDir, '3', 'snapshots', 'ancient.json.gz')), 'blob >30g eliminato');
  assert.ok(!fs.existsSync(path.join(baseDir, '3', 'snapshots', 'hourOld.json.gz')), 'blob perdente eliminato');
});

test('cap: oltre il tetto restano le più recenti; le etichettate sono ESENTI', () => {
  const { store, baseDir } = freshStore({ snapshotCap: 3 });
  const now = Date.parse('2026-08-10 00:00:00');
  seedSnaps(baseDir, 4, [
    { id: 'lab', at: '2026-01-01 00:00:00', label: 'milestone' },   // vecchia + etichettata → SEMPRE tenuta
    { id: 'r1',  at: '2026-08-09 10:00:00' },
    { id: 'r2',  at: '2026-08-09 11:00:00' },
    { id: 'r3',  at: '2026-08-09 12:00:00' },
    { id: 'r4',  at: '2026-08-09 13:00:00' },
    { id: 'r5',  at: '2026-08-09 14:00:00' },
  ]);
  store.pruneSnapshots(4, { now });
  // cap 3, 'lab' esente occupa 1 del tetto → allow 2 non-etichettate più recenti = r4, r5
  assert.deepEqual(store.listSnapshots(4).map(m => m.id).sort(), ['lab', 'r4', 'r5'].sort());
});
