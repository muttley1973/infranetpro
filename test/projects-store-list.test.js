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

// ── Quanto c'è dentro un progetto, visto da fuori ───────────────────────────
// Il riquadro-sede della mappa inter-sede mostra questi numeri PRIMA di entrare
// nel progetto. Sono l'anteprima del gradino sotto: se mentono, mentono su una
// sede intera.

test('listProjects: conta gli apparati escludendo le stanze, e i rack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-cnt-'));
  const prev = process.env.INFRANET_PROJECTS_DIR;
  process.env.INFRANET_PROJECTS_DIR = dir;
  // Il modulo legge PROJECTS_DIR al require: per puntare a un'altra dir serve
  // ricaricarlo, non basta cambiare l'env.
  delete require.cache[require.resolve('../server/projects-store.js')];
  const store = require('../server/projects-store.js');
  try {
    fs.writeFileSync(path.join(dir, '7.json'), JSON.stringify({
      id: 7, name: 'Sede', updated_at: '2026-08-01 10:00:00',
      state: {
        nodes: [
          { id: 'n1', type: 'switch' }, { id: 'n2', type: 'pc' },
          { id: 'n3', type: 'room' },                 // stanza: layout, non un apparato
          { id: 'n4', type: 'wallport' },             // presa a muro: c'è, ed È un apparato qui
        ],
        racks: [{ id: 'r1' }, { id: 'r2' }],
      },
    }));
    const p = store.listProjects()[0];
    // 4 nodi meno la stanza. La presa a muro NON si toglie: è esclusa dal
    // Registro asset (isStructuralCabling), non dal conteggio dei device — che
    // segue `isStructural`, la stessa regola della sotto-header.
    assert.equal(p.devices, 3);
    assert.equal(p.racks, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    process.env.INFRANET_PROJECTS_DIR = prev;
  }
});

test('listProjects: senza `state` i conteggi sono null, MAI zero', () => {
  // ⚠️ È la differenza fra «non lo so» e «è vuoto». Il riquadro-sede tace sul
  // primo e mostrerebbe «0 apparati» sul secondo — di una sede che ne ha trenta.
  fs.writeFileSync(path.join(TMP, '9.json'), JSON.stringify({
    id: 9, name: 'Senza stato', updated_at: '2026-08-02 10:00:00',   // niente `state`
  }));
  const p = listProjects().find(x => x.id === 9);
  assert.ok(p, 'il progetto deve comunque comparire nella lista');
  assert.equal(p.devices, null, 'progetto senza state → devices null');
  assert.equal(p.racks, null, 'progetto senza state → racks null');
});

test('listProjects: a parità di secondo l\'ordine è DETERMINISTICO (spareggio per id)', () => {
  // `timestamp()` tronca ai secondi: due salvataggi nello stesso secondo davano
  // stringhe uguali, e l'ordine dei pari lo decideva `readdirSync` — lessicografico
  // sui NOMI DI FILE, quindi `10.json` prima di `2.json`. All'avvio l'app carica
  // `list[0]`: quale progetto si apre poteva cambiare fra due riavvii con gli
  // stessi identici dati. Trovato come e2e instabile, non come bug segnalato.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-tie-'));
  const prev = process.env.INFRANET_PROJECTS_DIR;
  process.env.INFRANET_PROJECTS_DIR = dir;
  delete require.cache[require.resolve('../server/projects-store.js')];
  const store = require('../server/projects-store.js');
  try {
    const STESSO = '2026-08-28 15:04:05';
    for (const id of [2, 10, 3]) {
      fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ id, name: 'P' + id, updated_at: STESSO }));
    }
    // Id decrescente, NON l'ordine di readdir (che darebbe 10, 2, 3).
    assert.deepEqual(store.listProjects().map(p => p.id), [10, 3, 2]);
    // Ripetibile: due letture consecutive danno lo stesso ordine.
    assert.deepEqual(store.listProjects().map(p => p.id), store.listProjects().map(p => p.id));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    process.env.INFRANET_PROJECTS_DIR = prev;
  }
});

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
