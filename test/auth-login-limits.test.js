'use strict';
// ============================================================
// AUTH — il login non ferma il server, e un indirizzo ha un tetto di tentativi
// (rilievi del 16/10, verificati sul codice).
//
//  1) bcrypt a costo 12 e' ~340 ms di CPU. Con `compareSync` il server intero restava
//     fermo per quel tempo a OGNI tentativo — anche per un username inesistente, perche'
//     il confronto si fa sempre (anti-enumerazione). Ora e' asincrono: il confronto cede
//     il controllo ogni <=100 ms e le altre richieste vengono servite nel frattempo.
//  2) Il limite IP+username non limita niente a chi cambia username a ogni tentativo.
//     Un secondo limite, per IP SOLO, a soglia larga, mette un tetto ai tentativi
//     falliti totali di un indirizzo. Qui la soglia e' abbassata (INFRANET_LOGIN_IP_MAX).
//  3) Il cambio password e' asincrono ma la sezione che legge e riscrive users.json NO:
//     due cambi insieme non si sovrascrivono in silenzio.
//
// File ISOLATO (processo suo): env impostato PRIMA del require, e il limiter e' per
// processo — un test che lo fa scattare non puo' toccare gli altri file.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-authlimits-'));
const UF  = path.join(TMP, 'users.json');
// Il budget per-IP deve bastare anche quando la prova di «login ASINCRONO» usa i suoi tre tentativi (3) e
// il cambio password ne brucia altri due: con 5 il limiter scattava prima dell'ultimo test e bloccava i login validi.
const IP_MAX = 8;
process.env.INFRANET_USERS_FILE   = UF;
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');
process.env.SESSION_SECRET        = 'fixed-test-secret';
process.env.INFRANET_LOGIN_IP_MAX = String(IP_MAX);
delete process.env.INFRANET_DEV_NO_AUTH;
delete process.env.INFRANET_TRUST_PROXY;
fs.mkdirSync(process.env.INFRANET_PROJECTS_DIR, { recursive: true });

const H = pw => bcrypt.hashSync(pw, 4);   // costo basso: i login VERI dei test restano veloci
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

// I fallimenti dell'IP si contano QUI, in ordine: il limiter e' di processo e i test girano in serie.
let failures = 0;

test('login ASINCRONO: il confronto bcrypt cede il controllo (era: server fermo per tutto il confronto)', async () => {
  // Username inesistente = confronto contro l'hash fittizio a costo 12, quello lento (~330 ms).
  // Si misura il BUCO PIU' LUNGO fra due tick di un timer da 10 ms: con compareSync coincide con
  // l'intera durata del confronto; asincrono, bcryptjs cede il controllo ogni ~100 ms. Il confronto
  // e' RELATIVO alla durata (non una soglia in millisecondi): su una macchina lenta il confronto dura
  // di piu', ma il rapporto non cambia. NB: non e' parallelismo — bcryptjs e' JS puro, il CPU e'
  // lo stesso —, e' che nessuno resta fermo per piu' di una fetta.
  //
  // ⚠️ Fino a TRE tentativi, e passa il primo che rispetta il rapporto. La CI l'ha visto cadere a caso
  // (22/10, due giri: «buco massimo 222 ms su 317 ms»): una fetta di ~100 ms di CPU puo' durare molto di
  // piu' in tempo di muro se la macchina condivisa la sospende, e UN solo stallo basta a sforare il
  // rapporto — senza che il confronto abbia smesso di cedere il controllo. Il difetto che la prova deve
  // vedere (`compareSync`) NON e' uno stallo: il buco coincide con TUTTO il confronto, a ogni tentativo.
  // Chi stalla una volta non stalla tre volte di fila; chi blocca il server le fallisce tutte e tre.
  const MAX_PROVE = 3;
  const prove = [];
  for (let k = 0; k < MAX_PROVE; k++) {
    let last = Date.now(), maxGap = 0;
    const timer = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 10);
    const t0 = Date.now();
    const r = await login('nessuno-' + t0 + '-' + k, 'qualunque');
    await new Promise(res => setTimeout(res, 30));   // lascia scattare il tick in coda, se il loop era bloccato
    const ms = Date.now() - t0;
    clearInterval(timer);
    failures++;                                       // ogni tentativo e' un fallimento dell'IP: conta nel budget
    assert.equal(r.status, 401);
    assert.ok(ms > 100, 'sanity: il confronto a costo 12 non è istantaneo (' + ms + ' ms)');
    prove.push({ maxGap, ms });
    if (maxGap < ms * 0.6) break;
  }
  const ok = prove.some(p => p.maxGap < p.ms * 0.6);
  assert.ok(ok,
    'il loop non deve restare fermo per quasi tutto il confronto, in nessuno dei ' + prove.length + ' tentativi: ' +
    prove.map(p => 'buco massimo ' + p.maxGap + ' ms su ' + p.ms + ' ms').join(' · '));
});

test('login riuscito: NON consuma il budget per-IP (contano solo i fallimenti)', async () => {
  for (let i = 0; i < IP_MAX + 3; i++) {
    const r = await login('admin', 'adminpw');
    assert.equal(r.status, 200, 'login valido #' + (i + 1) + ' dopo ' + i + ' riusciti');
  }
});

test('cambio password: due richieste insieme NON si sovrascrivono (una 200, l\'altra 409)', async () => {
  const l = await login('viewer', 'viewerpw');
  assert.equal(l.status, 200);
  const [a, b] = await Promise.all([
    request('POST', '/api/auth/password', { cookie: l.cookie, body: { currentPassword: 'viewerpw', newPassword: 'nuova-password-A1' } }),
    request('POST', '/api/auth/password', { cookie: l.cookie, body: { currentPassword: 'viewerpw', newPassword: 'nuova-password-B2' } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409],
    'una passa; l\'altra ha verificato una password che non è più quella attuale: risponde 409, non sovrascrive');
  // Resta valida UNA sola delle due password nuove, mai entrambe, mai la vecchia.
  const ok = [];
  for (const pw of ['nuova-password-A1', 'nuova-password-B2', 'viewerpw']) ok.push((await login('viewer', pw)).status === 200);
  assert.equal(ok.filter(Boolean).length, 1, 'esattamente una password vale: ' + JSON.stringify(ok));
  assert.equal(ok[2], false, 'la vecchia non vale più');
  failures += ok.filter(x => !x).length;   // i login FALLITI qui sopra contano nel budget per-IP
});

test('cambio password: la password attuale sbagliata resta un 403', async () => {
  const l = await login('admin', 'adminpw');
  const r = await request('POST', '/api/auth/password', { cookie: l.cookie, body: { currentPassword: 'SBAGLIATA', newPassword: 'qualcosa-di-nuovo-1' } });
  assert.equal(r.status, 403);
});

// DEVE restare l'ULTIMO: una volta scattato, il limiter blocca anche i login validi dello stesso IP.
test('limite per IP: cambiando username a ogni tentativo si arriva comunque al 429', async () => {
  const statuses = [];
  // Username SEMPRE diversi: il limite IP+username (10 per coppia) non scatterebbe mai.
  for (let i = 0; i < IP_MAX + 4; i++) {
    const r = await login('sconosciuto-' + i + '-' + Date.now(), 'x');
    statuses.push(r.status);
    if (r.status === 401) failures++;
    if (r.status === 429) { assert.match(r.json.error, /tropp|riprova/i); break; }
  }
  assert.ok(statuses.includes(429), 'dopo ' + IP_MAX + ' fallimenti dello stesso IP scatta il 429, qualunque username: ' + statuses.join(','));
  assert.equal(failures, IP_MAX, 'il 429 arriva esattamente al tentativo successivo al tetto (' + IP_MAX + ')');
  assert.ok(statuses.slice(0, statuses.indexOf(429)).every(s => s === 401), 'prima del 429 solo 401');
});
