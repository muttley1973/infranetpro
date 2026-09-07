'use strict';
// ============================================================
// test/projects-store-async.test.js — il salvataggio non blocca più la casa,
// e non per questo diventa una corsa.
//
// MISURATO prima di toccare niente (500 apparati, 145 KB, banco isolato): mentre
// un PUT salva, una rotta che non c'entra niente passa da 2,5 a 12,8 ms di p95 —
// cinque volte, con il picco a 16,9. L'I/O era sincrona: il disco fermava l'event
// loop, e ogni altra richiesta aspettava il salvataggio di un altro.
//
// ⚠️ Rendere asincrona la scrittura, da sola, TOGLIE una garanzia: con il gestore
// che arrivava in fondo senza cedere il turno, fra il controllo di versione e il
// rename non poteva infilarsi nessuno. Per questo l'asincrono arriva INSIEME a una
// coda per progetto, e queste prove guardano soprattutto quella — la latenza si
// misura con una sonda, la correttezza si prova qui.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ⚠️ L'ambiente isolato va messo PRIMA del require, non solo sul figlio: lo store
// legge INFRANET_PROJECTS_DIR al caricamento. È l'incidente della sonda API v1
// (tre token coniati nel file vero); qui sotto c'è anche la cintura.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-store-async-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;

const store = require('../server/projects-store.js');
assert.equal(path.resolve(store.PROJECTS_DIR), path.resolve(PROJECTS),
  'lo store deve puntare alla cartella temporanea, non a quella vera');

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* pazienza */ } });

const SORGENTE = fs.readFileSync(path.join(__dirname, '..', 'server', 'projects-store.js'), 'utf8');
const corpo = (nome) => {
  const i = SORGENTE.indexOf(nome);
  assert.ok(i > 0, 'la funzione ' + nome + ' deve esistere');
  const fine = SORGENTE.indexOf('\n}\n', i);
  return SORGENTE.slice(i, fine);
};
const fileDi = (id) => path.join(PROJECTS, id + '.json');
const leggi = (id) => JSON.parse(fs.readFileSync(fileDi(id), 'utf8'));
const temporanei = () => fs.readdirSync(PROJECTS).filter((f) => f.endsWith('.tmp'));

// ── La regola è una sola, scritta due volte: che lo verifichi qualcosa ──────
// Ci sono due scritture atomiche — una sincrona per i file piccoli (config, token,
// organizzazione, skin) e una asincrona per i progetti. Due copie di una regola
// vanno bene finché qualcosa verifica che siano la STESSA regola: se no si
// scoprono diverse il giorno in cui una delle due perde un passo.
test('le due scritture atomiche fanno gli stessi passi, nello stesso ordine', () => {
  const passi = (src) => {
    const out = [];
    for (const m of src.matchAll(/\b(?:fs|fsp|fh)\.(\w+)\(/g)) {
      let nome = m[1].replace(/Sync$/, '');
      // `existsSync` è l'unica differenza VOLUTA: la versione sincrona chiede se
      // il file c'è prima di copiarlo, l'asincrona prova e accetta il fallimento —
      // stesso caso (non c'era), senza la finestra fra la domanda e la risposta.
      if (nome === 'exists') continue;
      if (nome === 'fsync') nome = 'sync';
      if (nome === 'writeFile') nome = 'write';
      // Due chiamate uguali di fila sono i due rami di uno stesso passo, non due
      // passi: la versione sincrona apre con o senza `mode` in un ternario. È il
      // passo che conta, e quale sia il ramo lo decide un argomento.
      if (out[out.length - 1] !== nome) out.push(nome);
    }
    return out;
  };
  const sincrona = passi(corpo('function atomicWriteFile(file, data, mode)'));
  const asincrona = passi(corpo('async function atomicWriteFileAsync(file, data, mode)'));
  assert.deepEqual(asincrona, sincrona, 'i passi devono coincidere: ' + JSON.stringify({ sincrona, asincrona }));
  // E l'ordine è quello che rende la scrittura durevole E atomica: prima si scrive
  // e si forza sul disco, poi si mette da parte la copia, e solo alla fine si
  // rinomina. Un rename prima del fsync consegnerebbe un file che il sistema non
  // ha ancora scritto davvero.
  assert.deepEqual(sincrona, ['open', 'write', 'sync', 'close', 'copyFile', 'rename', 'unlink']);
});

test('saveProject rende una PROMESSA, e il file esiste quando la si è aspettata', async () => {
  const p = store.saveProject(9001, 'promessa', { nodes: [{ id: 'n1', type: 'pc' }] }, 't0', 't0');
  assert.equal(typeof p.then, 'function', 'chi salva deve poter aspettare');
  await p;
  assert.equal(leggi(9001).state.nodes.length, 1);
  assert.deepEqual(temporanei(), [], 'nessun temporaneo rimasto indietro');
});

// ── La coda: due scritture sullo stesso progetto non si sovrappongono ──────
test('due salvataggi dello stesso progetto si mettono in fila, e l ultimo vince', async () => {
  const stato = (n) => ({ nodes: Array.from({ length: n }, (_, i) => ({ id: 'n' + i, type: 'pc' })) });
  await Promise.all([
    store.saveProject(9002, 'primo', stato(3), 't0', 't1'),
    store.saveProject(9002, 'secondo', stato(40), 't0', 't2'),
  ]);
  const p = leggi(9002);
  // Il file è integro e contiene UNA delle due scritture per intero: mai metà
  // dell'una e metà dell'altra, che è il modo in cui questo difetto fa male —
  // il rename resta atomico, quindi il risultato sarebbe un JSON valido e sbagliato.
  assert.equal(p.state.nodes.length, 40, 'l ultimo accodato è l ultimo scritto');
  assert.equal(p.name, 'secondo');
  assert.deepEqual(temporanei(), []);
});

test('la coda è rientrante: chi è già dentro il proprio turno non aspetta sé stesso', async () => {
  // Senza rientranza, un salvataggio dentro un turno già preso sullo stesso
  // progetto aspetterebbe per sempre un turno che non finirà mai — e il sintomo
  // sarebbe una richiesta appesa, non un errore.
  const esito = await store.withProject(9003, async () => {
    await store.saveProject(9003, 'dentro', { nodes: [] }, 't0', 't0');
    return 'arrivato in fondo';
  });
  assert.equal(esito, 'arrivato in fondo');
  assert.equal(leggi(9003).name, 'dentro');
});

test('un turno che fallisce non lascia ferma la coda di quel progetto', async () => {
  // Se la catena si concatenasse sul VALORE invece che sull esito, il primo
  // errore lascerebbe quel progetto non più salvabile fino al riavvio: un guasto
  // passeggero diventerebbe permanente, e in silenzio.
  await assert.rejects(store.withProject(9004, async () => { throw new Error('turno andato male'); }));
  const dopo = await store.withProject(9004, async () => 'il turno dopo gira lo stesso');
  assert.equal(dopo, 'il turno dopo gira lo stesso');
});

test('turni su progetti DIVERSI non si aspettano fra loro', async () => {
  // La coda è per progetto, non una sola per tutti: due sessioni che salvano due
  // documenti diversi non hanno motivo di mettersi in fila.
  let sbloccaA;
  const A = new Promise((r) => { sbloccaA = r; });
  const primo = store.withProject(9005, () => A);
  const secondo = await store.withProject(9006, async () => 'passato avanti');
  assert.equal(secondo, 'passato avanti', 'il progetto 9006 non deve aspettare il 9005');
  sbloccaA();
  await primo;
});
