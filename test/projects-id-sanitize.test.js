'use strict';
// ============================================================
// Un id e' un NOME anche quando arriva dalle rotte, non solo dal client
// ============================================================
// Il client ripara gli id strani aprendo un progetto (`_migrateState`), ma un PUT costruito a
// mano, un progetto importato da JSON o uno snapshot non passano dal client. `repairUnsafeIds`
// ha i suoi test a tavolino (id-safety.test.js); qui si prova il CABLAGGIO: ogni rotta che scrive
// uno stato lo chiama — e, come per l'IP, il salvataggio NON si rifiuta (si perderebbe il lavoro
// dell'intero progetto per un campo): si ripara, e i riferimenti vanno con l'id.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-idsan-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');

const express = require('express');
const { isSafeId } = require('../lib/id-safety.js');

let server, base;
const url = (p) => `${base}${p}`;
const HOSTILE = '"><img src=x onerror=alert(1)>';
const stato = () => ({
  racks: [{ id: HOSTILE, name: 'R', sizeU: 42 }], currentRack: HOSTILE,
  nodes: [{ id: 'sw1', type: 'switch', name: 'SW', rackId: HOSTILE, rackU: 1, sizeU: 1, ports: 4 },
          { id: 'pc1', type: 'pc', name: 'PC', x: 10, y: 10, ports: 1 }],
  links: [{ id: HOSTILE + '2', src: 'sw1-1', dst: 'pc1-1' }], ports: {},
});

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
const warn = console.warn;
before(() => { console.warn = () => {}; });
after(() => { console.warn = warn; });

const sudisco = (id) => JSON.parse(fs.readFileSync(path.join(PROJECTS, `${id}.json`), 'utf8')).state;

function verifica(st, dove) {
  assert.equal(isSafeId(st.racks[0].id), true, dove + ': l\'id del rack e\' un nome');
  assert.equal(isSafeId(st.links[0].id), true, dove + ': l\'id del cavo e\' un nome');
  assert.equal(st.currentRack, st.racks[0].id, dove + ': currentRack segue il rack');
  assert.equal(st.nodes[0].rackId, st.racks[0].id, dove + ': il nodo resta nel suo rack');
  assert.equal(st.nodes[0].id, 'sw1', dove + ': gli id dei nodi non si toccano');
  assert.deepEqual([st.links[0].src, st.links[0].dst], ['sw1-1', 'pc1-1'], dove + ': gli estremi del cavo restano');
  assert.ok(!JSON.stringify(st).includes('onerror'), dove + ': nessun markup sopravvive');
}

test('POST /api/projects: un progetto importato con id ostili entra riparato, non rifiutato', async () => {
  const r = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'import', state: stato() }),
  });
  assert.equal(r.status, 201);
  verifica(sudisco((await r.json()).id), 'POST');
});

test('PUT /api/projects/:id: un salvataggio con id ostili viene riparato, non rifiutato', async () => {
  const c = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'put', state: { nodes: [], links: [], racks: [] } }),
  });
  const id = (await c.json()).id;
  const r = await fetch(url(`/api/projects/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: stato() }),
  });
  assert.equal(r.status, 200);
  verifica(sudisco(id), 'PUT');
});

test('PUT /api/projects/:id: rinominare un progetto salvato non tocca lo stato (e non fallisce)', async () => {
  const c = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'rn', state: { nodes: [], links: [], racks: [{ id: 'r1', name: 'R' }] } }),
  });
  const id = (await c.json()).id;
  const r = await fetch(url(`/api/projects/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'nuovo nome' }),
  });
  assert.equal(r.status, 200);
  assert.equal(sudisco(id).racks[0].id, 'r1');
});

test('POST /api/projects/:id/history/snapshots: nemmeno uno snapshot conserva un id ostile', async () => {
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
  verifica(body.state || (body.snapshot && body.snapshot.state), 'snapshot');
});

test('chi salva viene AVVISATO di cio\' che il server ha corretto (intestazione X-InfraNet-Sanitized)', async () => {
  const c = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'avviso', state: { nodes: [], links: [], racks: [] } }),
  });
  assert.equal(c.headers.get('x-infranet-sanitized'), null, 'nessuna correzione → nessuna intestazione');
  const id = (await c.json()).id;

  const st = stato();
  st.nodes[1].ip = HOSTILE;                       // un IP che non e' un indirizzo
  const r = await fetch(url(`/api/projects/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: st }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-infranet-sanitized'), 'ip=1;id=2', 'un IP azzerato, due id (rack e cavo) rinominati');

  const pulito = await fetch(url(`/api/projects/${id}`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { nodes: [], links: [], racks: [{ id: 'r1', name: 'R' }] } }),
  });
  assert.equal(pulito.headers.get('x-infranet-sanitized'), null, 'uno stato pulito non fa rumore');

  const nuovo = await fetch(url('/api/projects'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'avviso2', state: stato() }),
  });
  assert.equal(nuovo.headers.get('x-infranet-sanitized'), 'ip=0;id=2', 'anche l\'import (POST) lo dice');
});
