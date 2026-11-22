'use strict';
// La password GENERATA al primo avvio: il server la scrive nel suo log, e finche' resta quella la pagina deve dirlo.
//
//   · `ensureDefaultAdmin` marca l'admin che crea (`passwordGenerated: true`) — e nessun altro account;
//   · /api/auth/me lo riporta, FUORI da `user`, leggendo il file a ogni richiesta;
//   · il flag sparisce quando la password cambia per MANO di qualcuno: il cambio proprio (la rotta che il
//     dialogo ora usa) o il reset di un admin; NON sparisce per un tentativo fallito (password attuale errata,
//     nuova troppo corta) ne' per un cambio di ruolo;
//   · un `users.json` di prima del flag non dice niente: non si sa se quella password sia stata cambiata.
//   · e' un AVVISO: nessuna rotta si ferma finche' il flag c'e'.
// File ISOLATO (store utenti in una cartella temporanea, env impostato PRIMA del require).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-pwdgen-'));
const UF  = path.join(TMP, 'users.json');
process.env.INFRANET_USERS_FILE   = UF;
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');
process.env.SESSION_SECRET        = 'fixed-test-secret';
delete process.env.INFRANET_DEV_NO_AUTH;
delete process.env.INFRANET_TRUST_PROXY;
fs.mkdirSync(process.env.INFRANET_PROJECTS_DIR, { recursive: true });

const express = require('express');
const auth = require('../auth.js');

const H = pw => bcrypt.hashSync(pw, 4);
const readFile = () => JSON.parse(fs.readFileSync(UF, 'utf8'));
const byName = (n) => readFile().find(u => u.username === n);

// ── ensureDefaultAdmin (senza server) ───────────────────────────────────────────
function vuoto() { for (const f of [UF, UF + '.bak']) { try { fs.unlinkSync(f); } catch (_) { /* assente */ } } }

test('ensureDefaultAdmin: l\'admin creato al primo avvio porta il flag; la password stampata e\' la sua, e nel file c\'e\' solo l\'hash', () => {
  vuoto();                                                   // primo avvio vero: nessun file
  const righe = [];
  const log = console.log; console.log = (...a) => righe.push(a.join(' '));   // la scatola con la password
  try { auth.ensureDefaultAdmin(); } finally { console.log = log; }
  const u = readFile();
  assert.equal(u.length, 1);
  assert.equal(u[0].username, 'admin');
  assert.equal(u[0].passwordGenerated, true);
  assert.ok(/^\$2[aby]\$/.test(u[0].passwordHash), 'bcrypt, mai in chiaro');
  const stampata = (/Password:\s+(\S+)/.exec(righe.join('\n')) || [])[1];
  assert.ok(stampata, 'la password esce nel log, una volta');
  assert.ok(bcrypt.compareSync(stampata, u[0].passwordHash), 'quella stampata e\' proprio la password dell\'account marcato');
  assert.ok(!fs.readFileSync(UF, 'utf8').includes(stampata), 'nel file non c\'e\' in chiaro');
});

test('ensureDefaultAdmin: con uno store gia\' inizializzato non tocca il flag di nessuno', () => {
  vuoto();
  fs.writeFileSync(UF, JSON.stringify([{ id: 1, username: 'esistente', passwordHash: H('x'), role: 'admin' }]));
  auth.ensureDefaultAdmin();
  assert.equal(readFile()[0].passwordGenerated, undefined, 'un admin che c\'era gia\' non viene marcato a posteriori');
  assert.equal(readFile().length, 1);
});

// ── via HTTP ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
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
const me = (cookie) => request('GET', '/api/auth/me', { cookie });

// Stato di partenza: un admin con la password GENERATA, un admin con una password scelta, un amministratore
// «vecchio» (file di prima del flag) e un visualizzatore.
function seed() {
  fs.writeFileSync(UF, JSON.stringify([
    { id: 1, username: 'admin',   passwordHash: H('generata-1'), role: 'admin',  createdAt: '2026-01-01 00:00:00', passwordGenerated: true },
    { id: 2, username: 'scelta',  passwordHash: H('scelta-pw1'), role: 'admin',  createdAt: '2026-01-01 00:00:00' },
    { id: 3, username: 'vecchio', passwordHash: H('vecchio-p1'), role: 'viewer', createdAt: '2026-01-01 00:00:00' },
    { id: 4, username: 'gen2',    passwordHash: H('generata-2'), role: 'viewer', createdAt: '2026-01-01 00:00:00', passwordGenerated: true },
    // un file scritto a mano: il flag e' il booleano `true` e basta (come lo legge anche la pagina)
    { id: 5, username: 'stringa', passwordHash: H('stringa-pw1'), role: 'viewer', createdAt: '2026-01-01 00:00:00', passwordGenerated: 'true' },
  ]));
}

// `before` gira prima di TUTTI i test del file, anche dei due qui sopra, che ripartono da uno store vuoto: il
// server si avvia qui (col file seminato, cosi' `register` non crea un admin) e i test HTTP risemina da sé.
before(async () => {
  seed();
  auth.register(app);                                        // ensureDefaultAdmin: store pieno → no-op
  await new Promise(r => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; r(); }); });
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('/api/auth/me: passwordGenerated e\' true SOLO per l\'account col flag, ed e\' un booleano fuori da `user`', async () => {
  seed();                                                    // i due test sopra hanno riscritto il file
  const g = await login('admin', 'generata-1');
  assert.equal(g.status, 200);
  const rg = await me(g.cookie);
  assert.equal(rg.json.passwordGenerated, true);
  assert.equal(rg.json.user.passwordGenerated, undefined, 'dentro `user` non c\'e\': `user` e\' la sessione');

  for (const [u, p] of [['scelta', 'scelta-pw1'], ['vecchio', 'vecchio-p1']]) {
    const l = await login(u, p);
    const r = await me(l.cookie);
    assert.equal(r.json.passwordGenerated, false, u + ': senza flag non si dice niente');
  }
  const s = await login('stringa', 'stringa-pw1');
  assert.equal((await me(s.cookie)).json.passwordGenerated, false, 'un valore che non e\' il booleano true non conta');
});

test('un AVVISO, non un obbligo: con il flag acceso le rotte rispondono come sempre', async () => {
  const g = await login('admin', 'generata-1');
  const users = await request('GET', '/api/auth/users', { cookie: g.cookie });
  assert.equal(users.status, 200);
  assert.ok(Array.isArray(users.json));
  assert.ok(users.json.every(u => !('passwordHash' in u)), 'l\'hash non esce');
  assert.ok(users.json.every(u => !('passwordGenerated' in u)), 'il flag non esce dall\'elenco utenti: lo dice /me, a chi e\' lui');
});

test('tentativi che NON cambiano la password lasciano il flag: attuale errata, nuova troppo corta, cambio di ruolo', async () => {
  const g = await login('gen2', 'generata-2');
  const wrong = await request('POST', '/api/auth/password', { cookie: g.cookie, body: { currentPassword: 'SBAGLIATA', newPassword: 'nuova-pw-12' } });
  assert.equal(wrong.status, 403);
  const short = await request('POST', '/api/auth/password', { cookie: g.cookie, body: { currentPassword: 'generata-2', newPassword: 'corta' } });
  assert.equal(short.status, 400);
  assert.equal(byName('gen2').passwordGenerated, true, 'il file ha ancora il flag');
  assert.equal((await me(g.cookie)).json.passwordGenerated, true);

  const a = await login('admin', 'generata-1');
  const role = await request('PUT', '/api/auth/users/4', { cookie: a.cookie, body: { role: 'admin' } });
  assert.equal(role.status, 200);
  assert.equal(byName('gen2').passwordGenerated, true, 'cambiare il RUOLO non e\' cambiare la password');
  // ripristino il ruolo per i test dopo
  await request('PUT', '/api/auth/users/4', { cookie: a.cookie, body: { role: 'viewer' } });
});

test('il cambio proprio (la rotta del dialogo) spegne il flag, nel file e in /me, e la sessione resta viva', async () => {
  const g = await login('admin', 'generata-1');
  assert.equal((await me(g.cookie)).json.passwordGenerated, true);
  const ok = await request('POST', '/api/auth/password', { cookie: g.cookie, body: { currentPassword: 'generata-1', newPassword: 'la-mia-nuova-1' } });
  assert.equal(ok.status, 200);
  assert.equal(byName('admin').passwordGenerated, undefined, 'tolto dal file, non messo a false');
  const dopo = await me(g.cookie);
  assert.equal(dopo.status, 200, 'chi cambia la propria password non viene buttato fuori');
  assert.equal(dopo.json.passwordGenerated, false);
  // e col nuovo accesso resta spento
  const l = await login('admin', 'la-mia-nuova-1');
  assert.equal(l.status, 200);
  assert.equal((await me(l.cookie)).json.passwordGenerated, false);
});

test('il reset di un amministratore spegne il flag dell\'altro account', async () => {
  const a = await login('scelta', 'scelta-pw1');
  assert.equal(byName('gen2').passwordGenerated, true);
  const rst = await request('PUT', '/api/auth/users/4', { cookie: a.cookie, body: { password: 'impostata-da-admin' } });
  assert.equal(rst.status, 200);
  assert.equal(byName('gen2').passwordGenerated, undefined);
  const l = await login('gen2', 'impostata-da-admin');
  assert.equal((await me(l.cookie)).json.passwordGenerated, false);
});

test('un utente CREATO da un amministratore non e\' «generato»', async () => {
  const a = await login('scelta', 'scelta-pw1');
  const c = await request('POST', '/api/auth/users', { cookie: a.cookie, body: { username: 'nuovo', password: 'scelta-da-me-1', role: 'viewer' } });
  assert.equal(c.status, 201);
  assert.equal(byName('nuovo').passwordGenerated, undefined);
  const l = await login('nuovo', 'scelta-da-me-1');
  assert.equal((await me(l.cookie)).json.passwordGenerated, false);
});
