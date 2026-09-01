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

// ── La riga d'elenco si paga una volta per SCRITTURA, non una per lettura ───
// Misurato prima di scrivere la cache (40 giri sincroni): sullo store reale
// 9,9 ms p50, su dodici progetti da 1000 nodi (5,79 MB) **67,9 p50 e 84,0 p95**.
// È tutto sincrono nel processo unico del server: per quella durata nessun'altra
// richiesta viene servita, di nessun utente.
//
// ⚠️ Queste prove guardano il COMPORTAMENTO, non la mappa: che la cache non possa
// crescere non si prova qui, ed è giusto così — è vero per COSTRUZIONE (la mappa
// viene rifatta a ogni giro con i soli file presenti), e una prova che facesse
// finta di dimostrarlo direbbe meno del codice.

// Uno store su una dir tutta sua, con la cache VUOTA: il modulo legge
// PROJECTS_DIR al require, quindi per cambiare dir va ricaricato.
function storeIsolato(nome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), nome));
  const prev = process.env.INFRANET_PROJECTS_DIR;
  process.env.INFRANET_PROJECTS_DIR = dir;
  delete require.cache[require.resolve('../server/projects-store.js')];
  const store = require('../server/projects-store.js');
  return { dir, store, chiudi() {
    fs.rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.INFRANET_PROJECTS_DIR;
    else process.env.INFRANET_PROJECTS_DIR = prev;
  } };
}

// Quante volte si è APERTO un file di progetto. La sonda si prova da sola: se
// non fosse agganciata al giusto `fs` conterebbe zero, e la prima asserzione di
// ogni test che la usa pretende un numero maggiore di zero.
function lettureDiProgetto(fn) {
  const vero = fs.readFileSync;
  let n = 0;
  fs.readFileSync = function (p, ...resto) {
    if (typeof p === 'string' && /\d+\.json(\.bak)?$/.test(p)) n++;
    return vero.call(fs, p, ...resto);
  };
  try { fn(); } finally { fs.readFileSync = vero; }
  return n;
}

// Sposta la data di scrittura in modo VERIFICABILE. Riscrivere e sperare che il
// millesimo cambi è la prova che a volte passa: due scritture nello stesso
// millesimo con la stessa dimensione hanno la stessa firma, ed è precisamente il
// caso che la cache non distinguerebbe.
function invecchia(file, secondi) {
  const t = new Date(Date.now() + secondi * 1000);
  fs.utimesSync(file, t, t);
}

const PROG = (id, name) => JSON.stringify({
  id, name, created_at: '2026-01-01 00:00:00', updated_at: '2026-08-0' + id + ' 10:00:00',
  state: { nodes: [{ id: 'n1', type: 'switch' }], racks: [{ id: 'r1' }] },
});

test('listProjects: il secondo giro non riapre nessun file', () => {
  const { dir, store, chiudi } = storeIsolato('infranet-cache-');
  try {
    for (const id of [1, 2, 3]) fs.writeFileSync(path.join(dir, id + '.json'), PROG(id, 'P' + id));
    const primo = lettureDiProgetto(() => store.listProjects());
    assert.ok(primo >= 3, 'la sonda deve vedere le letture del primo giro (ne ha viste ' + primo + ')');
    assert.equal(lettureDiProgetto(() => store.listProjects()), 0, 'niente è cambiato: non si riapre niente');
    // E il risultato è lo stesso, non solo più veloce.
    assert.deepEqual(store.listProjects().map(p => p.name), ['P3', 'P2', 'P1']);
  } finally { chiudi(); }
});

test('listProjects: un salvataggio dallo store si vede anche a firma IDENTICA', () => {
  // ⚠️ Il caso che la sola firma su disco non copre: due scritture con la stessa
  // dimensione e lo stesso millesimo hanno la stessa firma, e nessun confronto
  // può accorgersene. Qui il millesimo si pianta a mano su un valore fisso dopo
  // ogni salvataggio, perché sperare che due scritture ci cadano dentro da sole
  // è una prova che passa A VOLTE — e infatti la prima versione di questo test
  // restava verde togliendo l'invalidazione da `saveProject`: a salvarla era la
  // firma, cioè proprio la via che doveva escludere.
  const QUANDO = new Date('2026-08-01T10:00:00.000Z');
  const { dir, store, chiudi } = storeIsolato('infranet-save-');
  try {
    const f = path.join(dir, '4.json');
    const stato = { nodes: [{ id: 'n1', type: 'switch' }], racks: [] };

    store.saveProject(4, 'AAAA', stato, '2026-01-01 00:00:00', '2026-08-01 10:00:00');
    fs.utimesSync(f, QUANDO, QUANDO);
    const prima = fs.statSync(f);
    assert.equal(store.listProjects()[0].name, 'AAAA');

    store.saveProject(4, 'BBBB', stato, '2026-01-01 00:00:00', '2026-08-01 10:00:00');
    fs.utimesSync(f, QUANDO, QUANDO);
    const dopo = fs.statSync(f);
    // ⚠️ Le due condizioni si DICHIARANO invece di darle per scontate: se un
    // giorno le due scritture non pesassero più uguale, questa prova tornerebbe
    // verde senza più controllare niente.
    assert.equal(dopo.size, prima.size, 'stessa dimensione: se no la firma le distingue e la prova non prova niente');
    assert.equal(dopo.mtimeMs, prima.mtimeMs, 'stesso millesimo: idem');

    assert.equal(store.listProjects()[0].name, 'BBBB', 'chi ha scritto LO SA: qui nessuna firma può accorgersene');
  } finally { chiudi(); }
});

test('listProjects: un file riscritto FUORI dallo store si rilegge', () => {
  // L'altra popolazione di scrittori: quelli che non passano di qui — una mano
  // sul file, un altro processo, un ripristino da backup. Lì decide la firma.
  const { dir, store, chiudi } = storeIsolato('infranet-fuori-');
  try {
    const f = path.join(dir, '5.json');
    fs.writeFileSync(f, PROG(5, 'Prima'));
    assert.equal(store.listProjects()[0].name, 'Prima');
    fs.writeFileSync(f, PROG(5, 'Dopo'));
    invecchia(f, 5);
    assert.equal(store.listProjects()[0].name, 'Dopo');
  } finally { chiudi(); }
});

test('listProjects: un progetto eliminato esce dall\'elenco', () => {
  const { dir, store, chiudi } = storeIsolato('infranet-canc-');
  try {
    for (const id of [1, 2]) fs.writeFileSync(path.join(dir, id + '.json'), PROG(id, 'P' + id));
    assert.equal(store.listProjects().length, 2);
    fs.unlinkSync(path.join(dir, '2.json'));
    assert.deepEqual(store.listProjects().map(p => p.id), [1], 'la cartella decide chi c\'è, non la cache');
  } finally { chiudi(); }
});

test('listProjects: le righe consegnate sono COPIE', () => {
  // Prima della cache ogni chiamata costruiva righe nuove e il chiamante se le
  // teneva. Consegnare quelle tenute da parte cambierebbe il contratto in
  // silenzio: un chiamante che ne modifica una avvelenerebbe ogni lettura dopo.
  const { dir, store, chiudi } = storeIsolato('infranet-copia-');
  try {
    fs.writeFileSync(path.join(dir, '6.json'), PROG(6, 'Intatto'));
    const a = store.listProjects();
    a[0].name = 'AVVELENATO';
    a[0].devices = 999;
    assert.equal(store.listProjects()[0].name, 'Intatto');
    assert.equal(store.listProjects()[0].devices, 1);
  } finally { chiudi(); }
});

test('listProjects: una riga presa dal .bak non si fossilizza', () => {
  // ⚠️ Il caso che una cache ingenua sbaglia: con il principale illeggibile la
  // riga viene dall'ultima copia valida, e la firma del principale NON cambia
  // più. Senza sorvegliare anche il `.bak`, quella riga resterebbe ferma per
  // sempre — e il progetto in avaria è proprio quello di cui serve sapere.
  const { dir, store, chiudi } = storeIsolato('infranet-bak-');
  try {
    const f = path.join(dir, '8.json');
    fs.writeFileSync(f, '{ questo non e\' JSON');
    fs.writeFileSync(f + '.bak', PROG(8, 'Copia vecchia'));
    assert.equal(store.listProjects()[0].name, 'Copia vecchia');
    fs.writeFileSync(f + '.bak', PROG(8, 'Copia nuova'));
    invecchia(f + '.bak', 5);
    assert.equal(store.listProjects()[0].name, 'Copia nuova');
  } finally { chiudi(); }
});

// ⚠️ Il marcatore di versione e la cache leggono la stessa coppia di fatti, ma
// il marcatore la ARROTONDA perché viaggia in un header e i client ne tengono
// uno in mano: cambiargli forma farebbe fallire il confronto di ogni scheda già
// aperta, cioè un «qualcuno ha modificato il progetto» falso al primo
// salvataggio dopo l'aggiornamento.
test('projectEtag: la forma del marcatore non è cambiata', () => {
  const { dir, store, chiudi } = storeIsolato('infranet-etag-');
  try {
    const f = path.join(dir, '2.json');
    fs.writeFileSync(f, PROG(2, 'X'));
    const st = fs.statSync(f);
    assert.equal(store.projectEtag(2), 'W/"' + Math.round(st.mtimeMs) + '-' + st.size + '"');
    assert.equal(store.projectEtag(999), null, 'file che non c\'è → nessuna pretesa');
  } finally { chiudi(); }
});

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
