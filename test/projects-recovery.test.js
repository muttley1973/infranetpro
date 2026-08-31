'use strict';
// ============================================================
// Il ripiego sull'ultima copia valida non è più muto
// ============================================================
// Il difetto misurato il 31/08: quando il file di un progetto non si poteva
// leggere, lo store serviva l'ultimo `.bak` — un contenuto PIÙ VECCHIO — e non lo
// diceva a nessuno. Nello stesso istante `projectEtag` risponde `null` («non lo
// so», che per disegno lascia passare il salvataggio): chi apriva, modificava e
// salvava riscriveva il principale con lo stato recuperato, e da lì in poi la
// versione più vecchia ERA il progetto. Le due scelte sono giuste una per una; è
// il loro incrocio che perdeva lavoro.
//
// Qui si prova il contratto, non l'implementazione:
//   ① una lettura normale non dice niente (nessuna intestazione, nessun rumore);
//   ② un file principale ILLEGGIBILE serve il backup e lo DICHIARA;
//   ③ un file principale ASSENTE lo dichiara con l'altro motivo — sono due fatti
//      diversi e chi legge deve poterli distinguere;
//   ④ e ciò che si riceve è davvero il contenuto vecchio: è la ragione
//      dell'avviso, e senza questa prova le tre sopra direbbero solo che
//      un'intestazione viaggia.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-recovery-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');

const express = require('express');
const { readProjectFile } = require('../server/projects-store.js');

let server, base;
const url = (p) => `${base}${p}`;
const nodi = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: 'pc', name: `PC${i}` }));
const fileDi = (id) => path.join(PROJECTS, `${id}.json`);

before(async () => {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use((req, _res, next) => { req.session = { user: { id: 0, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/projects'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

/** Un progetto con un `.bak` VERO: il backup nasce alla seconda scrittura, non
 *  alla prima, quindi si crea e poi si salva una volta. Il `.bak` resta con i
 *  nodi della creazione, il principale con quelli del salvataggio: due contenuti
 *  diversi, che è ciò che rende visibile un ripiego. */
async function progettoConBackup(nome) {
  const c = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, state: { nodes: nodi(2), links: [], racks: [] } }),
  });
  assert.equal(c.status, 201);
  const id = (await c.json()).id;
  const p = await fetch(url(`/api/projects/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { nodes: nodi(5), links: [], racks: [] } }),
  });
  assert.equal(p.status, 200);
  assert.ok(fs.existsSync(`${fileDi(id)}.bak`), 'il banco ha bisogno di un .bak vero');
  return id;
}

test('① una lettura normale non dice niente', async () => {
  const id = await progettoConBackup('Sana');
  const r = await fetch(url(`/api/projects/${id}`));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-infranet-recovered'), null,
    'un progetto letto dal suo file non deve far comparire nessun avviso');
  assert.equal((await r.json()).state.nodes.length, 5);
});

test('⭐ ② il file principale ILLEGGIBILE: si serve il backup, e lo si dichiara', async () => {
  const id = await progettoConBackup('Troncata');
  // Un JSON troncato è il caso classico; su Windows lo stesso esito lo dà un
  // lock momentaneo di un antivirus, e lì il principale era perfino SANO.
  fs.writeFileSync(fileDi(id), '{"format":"infranet-project","state":{"nod', 'utf8');
  const r = await fetch(url(`/api/projects/${id}`));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-infranet-recovered'), 'unreadable');
  // ⭐ E il contenuto è quello VECCHIO: è la ragione per cui l'avviso esiste.
  assert.equal((await r.json()).state.nodes.length, 2,
    'chi apre sta guardando la versione precedente, e sta per salvarci sopra');
});

test('③ il file principale ASSENTE è un fatto DIVERSO, e si dichiara diverso', async () => {
  const id = await progettoConBackup('Sparita');
  fs.unlinkSync(fileDi(id));
  const r = await fetch(url(`/api/projects/${id}`));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-infranet-recovered'), 'missing',
    '«non c\'è» e «non si apre» non sono la stessa cosa per chi deve decidere');
});

test('④ né il principale né il backup: 404, non un progetto vuoto', async () => {
  const id = await progettoConBackup('Perduta');
  fs.unlinkSync(fileDi(id));
  fs.unlinkSync(`${fileDi(id)}.bak`);
  const r = await fetch(url(`/api/projects/${id}`));
  assert.equal(r.status, 404);
});

test('readProjectFile dice sempre DA DOVE, anche quando non trova niente', async () => {
  const id = await progettoConBackup('Diretta');
  assert.deepEqual(
    (({ source, reason }) => ({ source, reason }))(readProjectFile(id)),
    { source: 'main', reason: null });

  fs.unlinkSync(fileDi(id));
  assert.deepEqual(
    (({ source, reason }) => ({ source, reason }))(readProjectFile(id)),
    { source: 'backup', reason: 'missing' });

  fs.unlinkSync(`${fileDi(id)}.bak`);
  const perduto = readProjectFile(id);
  assert.equal(perduto.project, null);
  assert.equal(perduto.source, null);
  assert.equal(perduto.reason, 'missing');
});

test('⚠️ un backup a sua volta illeggibile non diventa un progetto vuoto', async () => {
  // `null` = «non ho un progetto», che la rotta traduce in 404. Restituire un
  // oggetto a metà sarebbe un ripiego che a valle nessuno distingue da un dato.
  const id = await progettoConBackup('Doppia');
  fs.writeFileSync(fileDi(id), 'non-json', 'utf8');
  fs.writeFileSync(`${fileDi(id)}.bak`, 'nemmeno-questo', 'utf8');
  const letto = readProjectFile(id);
  assert.equal(letto.project, null);
  assert.equal(letto.reason, 'unreadable');
  const r = await fetch(url(`/api/projects/${id}`));
  assert.equal(r.status, 404);
});

test('⭐ un progetto illeggibile resta NELLA LISTA, ricostruito dalla sua copia', async () => {
  // Trovato provando dal vivo, non a tavolino: senza questo, il file troncato
  // faceva cadere la riga, il progetto spariva dalla tendina, l'avviso non
  // scattava mai (nessuno chiedeva quell'id) e — se era l'unico — l'avvio ne
  // creava uno nuovo e vuoto. Il lavoro era tutto lì, nel `.bak` accanto.
  const id = await progettoConBackup('Elencata');
  fs.writeFileSync(fileDi(id), '{"format":"infranet-proj', 'utf8');
  const lista = await (await fetch(url('/api/projects'))).json();
  const riga = lista.find(p => p.id === id);
  assert.ok(riga, 'il progetto è sparito dalla lista: non lo si può nemmeno riaprire');
  assert.equal(riga.name, 'Elencata', 'e porta il suo nome, non un segnaposto');
  // Il .bak è la versione PRECEDENTE: i conteggi sono i suoi, e sono una misura
  // di quel contenuto — non del contenuto che non si è potuto leggere.
  assert.equal(riga.devices, 2);
});

test('senza nemmeno la copia il record cade davvero: meglio assente che inventato', async () => {
  const id = await progettoConBackup('Irrecuperabile');
  fs.writeFileSync(fileDi(id), 'niente', 'utf8');
  fs.unlinkSync(`${fileDi(id)}.bak`);
  const lista = await (await fetch(url('/api/projects'))).json();
  assert.equal(lista.find(p => p.id === id), undefined);
});
