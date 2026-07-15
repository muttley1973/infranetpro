// Test per listProjects (server/projects-store.js) — robustezza dell'ordinamento.
// File ISOLATO: imposta INFRANET_PROJECTS_DIR su una dir temp PRIMA del require
// (node --test esegue ogni file in un processo dedicato → l'env non contamina gli
// altri test).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-list-'));
process.env.INFRANET_PROJECTS_DIR = TMP;

const { listProjects } = require('../server/projects-store.js');

test('listProjects: un progetto senza updated_at NON fa crashare la lista (finisce in coda)', () => {
  // Prima del fix: b.updated_at.localeCompare su un record senza updated_at ->
  // TypeError -> 500 sull'INTERA lista (utente bloccato su OGNI progetto).
  fs.writeFileSync(path.join(TMP, '1.json'), JSON.stringify({
    id: 1, name: 'A', created_at: '2026-01-01 00:00:00', updated_at: '2026-07-01 10:00:00',
  }));
  fs.writeFileSync(path.join(TMP, '2.json'), JSON.stringify({
    id: 2, name: 'B-senza-updated',   // manca updated_at (import da versione vecchia)
  }));
  fs.writeFileSync(path.join(TMP, '3.json'), JSON.stringify({
    id: 3, name: 'C', created_at: '2026-01-01 00:00:00', updated_at: '2026-07-10 10:00:00',
  }));

  let list;
  assert.doesNotThrow(() => { list = listProjects(); });
  assert.equal(list.length, 3, 'la lista deve contenere tutti i progetti validi');
  // Ordine per updated_at desc; il record senza updated_at ('') finisce ULTIMO.
  assert.deepEqual(list.map(p => p.id), [3, 1, 2]);
});

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
