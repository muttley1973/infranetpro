'use strict';
// ============================================================
// L'IP di un device e' un INDIRIZZO — anche quando arriva dalle rotte, non solo dal client
// ============================================================
// `node.ip` passa al pannello Management (data-tip), all'URL «Apri» e al documento
// CONDIVISO: chi apre il progetto dopo (anche in sola lettura) esegue cio' che c'e' scritto.
// Il client lo valida mentre si digita, ma un PUT costruito a mano, un progetto importato da
// JSON o uno snapshot lo scavalcavano. `_sanitizeNodeAddrs` ha i suoi test a tavolino
// (security-hardening); qui si prova il CABLAGGIO: ogni rotta che scrive uno stato lo chiama.
// Una funzione ottima che nessuno chiama protegge solo se stessa.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-ipsan-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');

const express = require('express');

let server, base;
const url = (p) => `${base}${p}`;
const HOSTILE = '"><img src=x onerror=alert(1)>';
const stato = () => ({ nodes: [
  { id: 'ok',  type: 'switch', name: 'SW', ip: '10.0.0.1', ip6: '2001:db8::1' },
  { id: 'bad', type: 'switch', name: 'SW2', ip: HOSTILE, ipManual: true },
  { id: 'zone', type: 'switch', name: 'SW3', ip: 'fe80::1%' + HOSTILE },
], links: [], racks: [] });

before(async () => {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use((req, _res, next) => { req.session = { user: { id: 0, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/projects'));
  app.use(require('../server/routes/history'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

const sudisco = (id) => JSON.parse(fs.readFileSync(path.join(PROJECTS, `${id}.json`), 'utf8')).state.nodes;
const warn = console.warn;
before(() => { console.warn = () => {}; });
after(() => { console.warn = warn; });

function verifica(nodi, dove) {
  const byId = Object.fromEntries(nodi.map(n => [n.id, n]));
  assert.equal(byId.ok.ip, '10.0.0.1', dove + ': l\'indirizzo vero non si tocca');
  assert.equal(byId.ok.ip6, '2001:db8::1');
  assert.equal(byId.bad.ip, '', dove + ': il markup nell\'IP non arriva al disco');
  assert.equal(byId.bad.ipManual, false, dove + ': un campo vuoto non è «scelto a mano»');
  assert.equal(byId.zone.ip, '', dove + ': nemmeno dietro uno zone-id');
  assert.ok(!JSON.stringify(nodi).includes('onerror'), dove + ': nessun markup sopravvive');
}

test('POST /api/projects: un progetto importato con IP ostili entra ripulito', async () => {
  const r = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'import', state: stato() }),
  });
  assert.equal(r.status, 201, 'il salvataggio NON si rifiuta: si perderebbe il lavoro dell\'intero progetto');
  verifica(sudisco((await r.json()).id), 'POST');
});

test('PUT /api/projects/:id: un salvataggio con IP ostili viene ripulito, non rifiutato', async () => {
  const c = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'put', state: { nodes: [{ id: 'ok', type: 'switch', name: 'SW', ip: '10.0.0.1' }], links: [], racks: [] } }),
  });
  const id = (await c.json()).id;
  const r = await fetch(url(`/api/projects/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: stato() }),
  });
  assert.equal(r.status, 200);
  verifica(sudisco(id), 'PUT');
});

test('POST /api/projects/:id/history/snapshots: nemmeno uno snapshot conserva il markup', async () => {
  const c = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'snap', state: { nodes: [], links: [], racks: [] } }),
  });
  const id = (await c.json()).id;
  const r = await fetch(url(`/api/projects/${id}/history/snapshots`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: stato(), label: 'x' }),
  });
  assert.equal(r.status, 201);
  const snap = (await r.json()).snapshot;
  const g = await fetch(url(`/api/projects/${id}/history/snapshots/${snap.id}`));
  assert.equal(g.status, 200);
  const body = await g.json();
  const nodi = (body.state && body.state.nodes) || (body.snapshot && body.snapshot.state && body.snapshot.state.nodes) || [];
  assert.ok(nodi.length === 3, 'lo snapshot si legge: ' + JSON.stringify(Object.keys(body)));
  verifica(nodi, 'snapshot');
});
