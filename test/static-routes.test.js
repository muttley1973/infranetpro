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

// ⚠️ L'icona della scheda è IN LINEA (data-URI), non un file servito: le rotte
// statiche sono una lista bianca e la pagina di login la vede chi non ha ancora
// una sessione. Senza dichiarazione il browser chiede /favicon.ico su OGNI
// apertura e prende un 404 — errore rosso in console e scheda senza icona.
// Le due pagine devono portare la STESSA icona: sono la stessa applicazione.
test('app e login dichiarano l\'icona della scheda, e non serve una rotta per averla', async () => {
  const viste = [];
  for (const [nome, url] of [['app', '/'], ['login', '/login']]) {
    const res = await fetch(srv.baseURL + url);
    assert.equal(res.status, 200, `${nome} risponde`);
    const html = await res.text();
    const m = html.match(/<link[^>]+rel="icon"[^>]+href="([^"]+)"/);
    assert.ok(m, `${nome}: manca <link rel="icon">`);
    assert.match(m[1], /^data:image\/png;base64,/, `${nome}: l'icona deve essere in linea, non una rotta`);
    viste.push(m[1]);
  }
  assert.equal(viste[0], viste[1], 'app e login devono mostrare la stessa icona');
  // E /favicon.ico resta senza rotta: è giusto così, nessuno lo chiede più.
  const fav = await fetch(srv.baseURL + '/favicon.ico');
  assert.equal(fav.status, 404);
});
