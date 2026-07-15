'use strict';
// ============================================================
// AUTH — superficie HTTP (test d'integrazione, F16). Il flusso di login reale
// non era MAI esercitato: l'e2e gira con INFRANET_DEV_NO_AUTH=1 (login bypassato).
// Qui montiamo auth.register() su un'app Express usa-e-getta (auth NON bypassata)
// e battiamo gli endpoint via http: login (ok/ko), sessione+cookie, RBAC
// admin/viewer, guardie self (ruolo/eliminazione), protezione ultimo-admin,
// invalidazione sessione su cambio password, e il rate-limiter del login.
// File ISOLATO: env impostato PRIMA del require; utenti seed con hash noti.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-authapi-'));
const UF  = path.join(TMP, 'users.json');
process.env.INFRANET_USERS_FILE   = UF;
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');
process.env.SESSION_SECRET        = 'fixed-test-secret';
delete process.env.INFRANET_DEV_NO_AUTH;
delete process.env.INFRANET_TRUST_PROXY;
fs.mkdirSync(process.env.INFRANET_PROJECTS_DIR, { recursive: true });

// Seed PRIMA di require+register (così ensureDefaultAdmin trova utenti → no-op).
// Hash a costo basso = login veloci nei test; loginApi rileva il costo dall'hash.
const H = pw => bcrypt.hashSync(pw, 4);
fs.writeFileSync(UF, JSON.stringify([
  { id: 1, username: 'admin',  passwordHash: H('adminpw'),  role: 'admin',  createdAt: '2026-01-01 00:00:00' },
  { id: 2, username: 'viewer', passwordHash: H('viewerpw'), role: 'viewer', createdAt: '2026-01-01 00:00:00' },
]));

const express = require('express');
const auth = require('../auth.js');

const app = express();
app.use(express.json());
auth.register(app);

let server, port;

function request(method, p, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const data = opts.body != null ? JSON.stringify(opts.body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.cookie) headers.Cookie = opts.cookie;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(b); } catch (_) { /* non-json */ }
        const sc = res.headers['set-cookie'];
        resolve({ status: res.statusCode, json, cookie: sc ? sc.map(c => c.split(';')[0]).join('; ') : null });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const login = (username, password) => request('POST', '/api/auth/login', { body: { username, password } });

before(async () => { await new Promise(r => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; r(); }); }); });
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('login: credenziali valide → 200 + cookie di sessione', async () => {
  const r = await login('admin', 'adminpw');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.user.role, 'admin');
  assert.ok(r.cookie && /infranet\.sid=/.test(r.cookie), 'imposta il cookie di sessione');
});

test('login: password errata → 401', async () => {
  const r = await login('admin', 'SBAGLIATA');
  assert.equal(r.status, 401);
  assert.equal(r.json.ok, false);
});

test('login: campi mancanti → 400', async () => {
  const r = await request('POST', '/api/auth/login', { body: { username: 'admin' } });
  assert.equal(r.status, 400);
});

test('/api/auth/me: 401 senza cookie, utente con cookie', async () => {
  const anon = await request('GET', '/api/auth/me');
  assert.equal(anon.status, 401);
  const lr = await login('admin', 'adminpw');
  const me = await request('GET', '/api/auth/me', { cookie: lr.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, 'admin');
});

test('RBAC: viewer NON accede alla gestione utenti (403); admin sì (200) senza hash', async () => {
  const v = await login('viewer', 'viewerpw');
  const denied = await request('GET', '/api/auth/users', { cookie: v.cookie });
  assert.equal(denied.status, 403);

  const a = await login('admin', 'adminpw');
  const ok = await request('GET', '/api/auth/users', { cookie: a.cookie });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.json));
  assert.ok(ok.json.every(u => !('passwordHash' in u)), 'la lista non espone gli hash');
});

test('createUser: duplicato → 409, ruolo invalido → 400, valido → 201 (+ login funziona)', async () => {
  const a = await login('admin', 'adminpw');
  const dup = await request('POST', '/api/auth/users', { cookie: a.cookie, body: { username: 'viewer', password: 'x', role: 'viewer' } });
  assert.equal(dup.status, 409);
  const badRole = await request('POST', '/api/auth/users', { cookie: a.cookie, body: { username: 'zed', password: 'x', role: 'root' } });
  assert.equal(badRole.status, 400);
  const created = await request('POST', '/api/auth/users', { cookie: a.cookie, body: { username: 'tempuser', password: 'temppw', role: 'viewer' } });
  assert.equal(created.status, 201);
  // la password è stata hashata e memorizzata correttamente → il login riesce
  const tl = await login('tempuser', 'temppw');
  assert.equal(tl.status, 200);
});

test('guardia self: admin non può cambiare il PROPRIO ruolo né eliminarsi', async () => {
  const a = await login('admin', 'adminpw');
  const role = await request('PUT', '/api/auth/users/1', { cookie: a.cookie, body: { role: 'viewer' } });
  assert.equal(role.status, 400);
  assert.match(role.json.error, /tuo ruolo/i);
  const del = await request('DELETE', '/api/auth/users/1', { cookie: a.cookie });
  assert.equal(del.status, 400);
  assert.match(del.json.error, /te stesso/i);
});

test('ultimo admin protetto: il 2° admin è eliminabile, il solo admin no', async () => {
  const a = await login('admin', 'adminpw');
  const c = await request('POST', '/api/auth/users', { cookie: a.cookie, body: { username: 'admin2', password: 'a2pw', role: 'admin' } });
  assert.equal(c.status, 201);
  const id2 = c.json.user.id;
  // eliminare il 2° admin è consentito (restano ≥1 admin)
  const d = await request('DELETE', '/api/auth/users/' + id2, { cookie: a.cookie });
  assert.equal(d.status, 200);
  // ora l'unico admin (self) resta protetto → il sistema conserva sempre ≥1 admin
  const dSelf = await request('DELETE', '/api/auth/users/1', { cookie: a.cookie });
  assert.equal(dSelf.status, 400);
});

test('invalidazione sessione: cambio password → il cookie vecchio del viewer scade', async () => {
  const v = await login('viewer', 'viewerpw');
  const before = await request('GET', '/api/auth/me', { cookie: v.cookie });
  assert.equal(before.status, 200, 'il cookie del viewer funziona prima');

  const a = await login('admin', 'adminpw');
  const upd = await request('PUT', '/api/auth/users/2', { cookie: a.cookie, body: { password: 'nuovapw' } });
  assert.equal(upd.status, 200);

  // il vecchio cookie del viewer è ora invalidato (_invalidatedUsers)
  const after = await request('GET', '/api/auth/me', { cookie: v.cookie });
  assert.equal(after.status, 401);
  assert.match(after.json.error, /scadut|login/i);
});

// DEVE restare l'ULTIMO: una volta scattato, il limiter blocca anche i login validi.
test('rate-limit login: troppi tentativi falliti → 429', async () => {
  let first401 = false, got429 = false;
  for (let i = 0; i < 15; i++) {
    const r = await login('ghost', 'x');   // utente inesistente → 401 rapido (niente bcrypt)
    if (i === 0) first401 = (r.status === 401);
    if (r.status === 429) { got429 = true; assert.match(r.json.error, /tropp|riprova/i); break; }
  }
  assert.ok(first401, 'i primi tentativi rispondono 401, non subito limitati');
  assert.ok(got429, 'dopo N tentativi falliti scatta il 429');
});
