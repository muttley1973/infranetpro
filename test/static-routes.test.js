'use strict';
// ============================================================
// test/static-routes.test.js — route statiche + 404 catch-all del server REALE.
// Avvia un'istanza isolata via l'helper e2e (spawn di `node server.js`, dir temp,
// porta effimera; NON richiede Chrome) e batte gli endpoint con fetch.
//
// Blocca la regressione della route MORTA `/app.js`: prima faceva sendFile di un
// file inesistente al root -> Express serviva la sua pagina d'errore HTML ENOENT
// con il PATH ASSOLUTO del server nel body (info-disclosure). Ora `/app.js` cade
// nel 404 catch-all JSON pulito, mentre `/export.js` (file reale) resta servito.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./e2e/helpers/server.js');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { if (srv) await srv.close(); });

test('GET /app.js -> 404 JSON pulito (route morta rimossa, nessun path leak)', async () => {
  const r = await fetch(`${srv.baseURL}/app.js`);
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type') || '', /application\/json/);
  const body = await r.json();
  assert.deepEqual(body, { error: 'Not found' });
  // il body non deve esporre alcun path assoluto del filesystem ne stack ENOENT
  assert.doesNotMatch(JSON.stringify(body), /ENOENT|InfranetPro|[A-Za-z]:\\/);
});

test('GET /export.js -> 200 (file reale, ancora servito)', async () => {
  const r = await fetch(`${srv.baseURL}/export.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /javascript/);
  assert.ok((await r.text()).length > 0, 'export.js non vuoto');
});

test('rotta ignota -> 404 JSON catch-all', async () => {
  const r = await fetch(`${srv.baseURL}/nope-xyz-123`);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Not found' });
});
