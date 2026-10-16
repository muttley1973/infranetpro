'use strict';
// ============================================================
// AUTH — i login in volo sono LIMITATI: la CPU di bcrypt non si somma all'infinito
// ============================================================
// Un confronto bcrypt a costo 12 vale ~340 ms di CPU, il processo e' uno solo, e `compare`
// asincrono cede il controllo fra una fetta e l'altra ma NON riduce il lavoro: cento login
// nello stesso istante sono ~34 s di CPU prima di rispondere a chiunque. Il limite per IP
// conta il budget di un indirizzo, non quanti arrivano insieme. Il cancello
// (lib/concurrency-gate.js) tiene INFRANET_LOGIN_CONCURRENCY alla volta, INFRANET_LOGIN_QUEUE
// in coda e oltre risponde 503 SUBITO.
//
// File ISOLATO (processo suo): env impostato PRIMA del require; qui il cancello e' stretto
// (1 alla volta, 2 in coda) per dimostrarlo con poche richieste.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-authgate-'));
const UF  = path.join(TMP, 'users.json');
process.env.INFRANET_USERS_FILE   = UF;
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');
process.env.SESSION_SECRET        = 'fixed-test-secret';
process.env.INFRANET_LOGIN_IP_MAX = '10000';          // il limite per IP non e' l'oggetto di questo file
process.env.INFRANET_LOGIN_CONCURRENCY = '1';
process.env.INFRANET_LOGIN_QUEUE = '2';
delete process.env.INFRANET_DEV_NO_AUTH;
delete process.env.INFRANET_TRUST_PROXY;
fs.mkdirSync(process.env.INFRANET_PROJECTS_DIR, { recursive: true });

fs.writeFileSync(UF, JSON.stringify([
  { id: 1, username: 'admin', passwordHash: bcrypt.hashSync('adminpw', 4), role: 'admin', createdAt: '2026-01-01 00:00:00' },
]));

const express = require('express');
const auth = require('../auth.js');
const app = express();
app.use(express.json());
auth.register(app);

let server, port;
function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json' }, agent: false }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (_) { /* non-json */ } resolve({ status: res.statusCode, json, headers: res.headers }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const login = (username, password) => request('POST', '/api/auth/login', { username, password });

before(async () => { await new Promise(r => { server = app.listen(0, '127.0.0.1', () => { port = server.address().port; r(); }); }); });
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('una raffica di login: mai piu\' di 1 in lavoro e 2 in coda, gli altri ricevono 503 SUBITO', async () => {
  // Username inesistenti = confronto contro l'hash fittizio a costo 12: il lento, quello che costa.
  const t1 = Date.now();
  const solo = await login('nessuno-solo', 'x');
  const T1 = Date.now() - t1;
  assert.equal(solo.status, 401);
  assert.ok(T1 > 80, 'sanity: un confronto a costo 12 non e\' istantaneo (' + T1 + ' ms)');

  // L'INVARIANTE si misura dal cancello, non dagli esiti: le richieste arrivano scaglionate (il
  // processo e' occupato a fare bcrypt, accetta le connessioni fra una fetta e l'altra), quindi
  // quante passino in tutto dipende dalla velocita' della macchina — ma in nessun istante
  // possono essere piu' di `max` in lavoro e `queue` in attesa.
  let maxActive = 0, maxWaiting = 0;
  const probe = setInterval(() => {
    const st = auth._bcryptGate.stats();
    maxActive = Math.max(maxActive, st.active); maxWaiting = Math.max(maxWaiting, st.waiting);
  }, 2);
  const N = 20;
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => login('nessuno-' + i, 'x')));
  const elapsed = Date.now() - t0;
  clearInterval(probe);

  const by = {};
  for (const r of rs) by[r.status] = (by[r.status] || 0) + 1;
  assert.ok(maxActive <= 1, 'mai piu\' di 1 confronto in lavoro: ' + maxActive);
  assert.ok(maxWaiting <= 2, 'mai piu\' di 2 in coda: ' + maxWaiting);
  assert.ok(maxActive >= 1, 'sanity: il cancello e\' stato usato davvero');
  assert.ok((by[503] || 0) >= N / 3, 'una parte consistente e\' rifiutata: ' + JSON.stringify(by));
  assert.equal((by[401] || 0) + (by[503] || 0), N, 'ogni richiesta ha avuto una risposta netta: ' + JSON.stringify(by));
  assert.equal(auth._bcryptGate.stats().rejected, by[503], 'i 503 sono i rifiuti del cancello, non altro');
  const busy = rs.find(r => r.status === 503);
  assert.equal(busy.headers['retry-after'], '3', 'il client sa quando riprovare');
  assert.equal(busy.json.ok, false);
  // Il lavoro e' LIMITATO a quello ammesso: senza cancello sarebbero ~N confronti in fila.
  const ammessi = by[401] || 0;
  assert.ok(elapsed < T1 * (ammessi + 6), 'tempo totale ' + elapsed + ' ms per ' + ammessi + ' confronti da ' + T1 + ' ms: nessun lavoro in piu\'');
});

test('finita la raffica il cancello e\' libero: un login vero passa', async () => {
  const r = await login('admin', 'adminpw');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('sotto la soglia nessuno viene rifiutato: 3 insieme (1 + 2 in coda) rispondono tutti 401/200, mai 503', async () => {
  const rs = await Promise.all([login('nessuno-a', 'x'), login('admin', 'sbagliata'), login('admin', 'adminpw')]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 401, 401]);
});

test('il 503 non rivela chi esiste: stesso rifiuto per utente vero e inventato', async () => {
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => login(i % 2 ? 'admin' : 'nessuno-' + i, 'x')));
  const busy = rs.filter(r => r.status === 503);
  assert.ok(busy.length > 0);
  assert.equal(new Set(busy.map(r => JSON.stringify(r.json))).size, 1, 'un solo messaggio di rifiuto');
});
