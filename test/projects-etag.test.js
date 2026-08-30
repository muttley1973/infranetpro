'use strict';
// ============================================================
// A2 — Due sessioni non si sovrascrivono più in silenzio
// ============================================================
// Il difetto misurato il 30/08: due PUT concorrenti sullo stesso progetto
// ricevevano ENTRAMBI 200, e lo stato di uno dei due spariva senza che nessuna
// delle due sessioni vedesse un errore. Il documento non portava una versione, e
// senza versione «ha scritto qualcun altro» è indistinguibile da «ho scritto io».
//
// Qui si prova il contratto, non l'implementazione:
//   ① una GET dice CHE VERSIONE stai tenendo in mano (ETag);
//   ② un PUT con la versione giusta passa, e ne restituisce una NUOVA;
//   ③ un PUT con una versione superata è RIFIUTATO (409) e non tocca il file;
//   ④ un PUT senza pretese continua a funzionare come prima — l'import DCIM, gli
//      script e i test non devono imparare un protocollo per restare vivi;
//   ⑤ la versione cambia anche per una RINOMINA, che riscrive il file;
//   ⑥ due salvataggi nello STESSO SECONDO producono versioni diverse: è il caso
//      per cui la guardia esiste, ed è esattamente quello in cui `updated_at`
//      (troncato ai secondi) non sarebbe servito a niente.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-etag-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');

const express = require('express');

let server, base;
const url = (p) => `${base}${p}`;
const nodi = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: 'pc', name: `PC${i}` }));

before(async () => {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  // Sessione admin iniettata a mano: qui si prova la GUARDIA DI VERSIONE, non
  // l'autenticazione — che ha i suoi test (auth-api, security-hardening).
  app.use((req, _res, next) => { req.session = { user: { id: 0, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/projects'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

async function creaProgetto(nome, quantiNodi) {
  const r = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, state: { nodes: nodi(quantiNodi), links: [], racks: [] } }),
  });
  assert.equal(r.status, 201);
  return { id: (await r.json()).id, etag: r.headers.get('etag') };
}

const salva = (id, quantiNodi, etag) => fetch(url(`/api/projects/${id}`), {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
  body: JSON.stringify({ state: { nodes: nodi(quantiNodi), links: [], racks: [] } }),
});

const nodiSuDisco = (id) =>
  JSON.parse(fs.readFileSync(path.join(PROJECTS, `${id}.json`), 'utf8')).state.nodes.length;

test('① la GET dice quale versione hai in mano', async () => {
  const { id } = await creaProgetto('versione', 3);
  const r = await fetch(url(`/api/projects/${id}`));
  assert.equal(r.status, 200);
  const tag = r.headers.get('etag');
  assert.ok(tag, 'la GET del progetto deve portare un ETag');
  assert.match(tag, /^W\/"\d+-\d+"$/, 'forma attesa: W/"<mtime>-<dimensione>"');
});

test('② con la versione giusta il salvataggio passa e ne restituisce una nuova', async () => {
  const { id, etag } = await creaProgetto('giusta', 3);
  const r = await salva(id, 7, etag);
  assert.equal(r.status, 200);
  const nuovo = r.headers.get('etag');
  assert.ok(nuovo, 'anche la PUT deve restituire la versione NUOVA');
  assert.notEqual(nuovo, etag, 'dopo una scrittura la versione non può essere la stessa');
  assert.equal(nodiSuDisco(id), 7);

  // …e con quella nuova si continua a salvare senza litigare con sé stessi.
  assert.equal((await salva(id, 9, nuovo)).status, 200);
  assert.equal(nodiSuDisco(id), 9);
});

test('③ una versione superata è RIFIUTATA, e il documento non si muove', async () => {
  const { id, etag: vecchia } = await creaProgetto('superata', 3);

  // La prima sessione salva: da qui la versione di chi ha ancora `vecchia` è stantia.
  const primo = await salva(id, 50, vecchia);
  assert.equal(primo.status, 200);
  assert.equal(nodiSuDisco(id), 50);

  // La seconda sessione salva credendo di partire dallo stesso punto.
  const secondo = await salva(id, 4, vecchia);
  assert.equal(secondo.status, 409, 'chi ha una versione superata NON riceve 200');
  const corpo = await secondo.json();
  assert.equal(corpo.code, 'stale-project');
  assert.ok(corpo.etag, 'il 409 dice qual è la versione buona, così si può decidere');
  assert.ok(corpo.updated_at, 'e quando è stata scritta');

  // Il punto: il lavoro della prima sessione è ancora lì.
  assert.equal(nodiSuDisco(id), 50, 'un salvataggio rifiutato non deve aver scritto niente');

  // Chi decide di sovrascrivere ripresenta la versione che il 409 gli ha dato.
  assert.equal((await salva(id, 4, corpo.etag)).status, 200);
  assert.equal(nodiSuDisco(id), 4);
});

test('④ chi non manda If-Match continua a funzionare come prima', async () => {
  const { id } = await creaProgetto('senza-pretese', 3);
  await salva(id, 20, null);                       // qualcun altro scrive nel frattempo
  const r = await salva(id, 11, null);             // e questo salva lo stesso
  assert.equal(r.status, 200, 'nessuna pretesa = nessun rifiuto (import, script, test)');
  assert.equal(nodiSuDisco(id), 11);
});

test('⑤ anche la rinomina cambia la versione (riscrive il file)', async () => {
  const { id, etag } = await creaProgetto('nome vecchio', 3);
  const r = await fetch(url(`/api/projects/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify({ name: 'nome nuovo' }),
  });
  assert.equal(r.status, 200);
  assert.notEqual(r.headers.get('etag'), etag);
  // Con la versione di PRIMA della rinomina il salvataggio successivo è rifiutato:
  // è coerente, ed è il motivo per cui il client riprende l'ETag anche lì.
  assert.equal((await salva(id, 5, etag)).status, 409);
  assert.equal((await salva(id, 5, r.headers.get('etag'))).status, 200);
});

test('⑥ due salvataggi nello stesso secondo hanno versioni diverse', async () => {
  const { id, etag } = await creaProgetto('stesso-secondo', 3);
  const uno = await salva(id, 4, etag);
  const due = await salva(id, 5, uno.headers.get('etag'));
  assert.equal(due.status, 200);
  const a = JSON.parse(fs.readFileSync(path.join(PROJECTS, `${id}.json`), 'utf8')).updated_at;
  assert.notEqual(uno.headers.get('etag'), due.headers.get('etag'),
    'la versione deve distinguerli anche quando updated_at (al secondo) non li distingue');
  assert.ok(typeof a === 'string' && a.length > 0);
});
