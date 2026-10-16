'use strict';
// ============================================================
// POST /api/discover dice quali strumenti di sistema sono mancati
// ============================================================
// Senza `ping` ogni host sembra morto: lo sweep finiva con «0 host» e nessuna spiegazione,
// uguale a una rete vuota. La risposta porta ora `warnings` (codici stabili, il testo lo
// sceglie il client): vuoto quando tutto c'e', `ping-missing` quando `ping` non si lancia.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-discwarn-'));
const dir = (n) => { const p = path.join(TMP, n); fs.mkdirSync(p, { recursive: true }); return p; };
process.env.INFRANET_PROJECTS_DIR = dir('projects');
process.env.INFRANET_SKINS_DIR = dir('skins');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_SESSION_SECRET_FILE = path.join(TMP, '.session-secret');
process.env.SESSION_SECRET = 'test';

const express = require('express');
let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { id: 0, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/discovery'));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

const scan = async () => {
  const r = await fetch(base + '/api/discover', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Nessuna sonda di rete oltre al ping: la prova e' sul PING, non sulla rete.
    body: JSON.stringify({ subnet: '127.0.0.0/30', detectWeb: false, detectDns: false, detectSnmp: false, mdns: false, deepScan: false }),
  });
  return r.json();
};
const withPath = async (value, fn) => {
  const old = process.env.PATH;
  process.env.PATH = value;
  try { return await fn(); } finally { process.env.PATH = old; }
};
const log = console.log, warn = console.warn;
before(() => { console.log = () => {}; console.warn = () => {}; });
after(() => { console.log = log; console.warn = warn; });

test('senza `ping`: la risposta e\' ok ma porta l\'avviso `ping-missing` (e 0 vivi non e\' piu\' muto)', async () => {
  const j = await withPath('', scan);
  assert.equal(j.ok, true);
  assert.equal(j.found, 0);
  assert.deepEqual(j.warnings, [{ code: 'ping-missing', tool: 'ping' }]);
});

test('con un `ping` che c\'e\' (anche se nessuno risponde) NON c\'e\' avviso, e quello di prima non si trascina',
  { skip: process.platform === 'win32' }, async () => {
  // Un `ping` finto: esiste, non risponde mai (exit 1). Mancare e non rispondere sono due cose.
  const bin = dir('bin');
  const fake = path.join(bin, 'ping');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const prima = await withPath('', scan);
  assert.equal(prima.warnings.length, 1);
  const dopo = await withPath(bin + path.delimiter + (process.env.PATH || ''), scan);
  assert.equal(dopo.ok, true);
  assert.deepEqual(dopo.warnings, [], 'nessuno strumento mancante: ping non risponde, ma c\'e\'');
});
