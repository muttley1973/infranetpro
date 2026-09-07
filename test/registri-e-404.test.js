'use strict';
// ============================================================
// Due rilievi del secondo smoke, tutti e due della stessa famiglia: una cosa che
// arriva da FUORI (un nome di driver nel body, un nome di file nell'URL) e che il
// codice tratta come se l'avessimo scelta noi.
//
//   ① I registri dei driver sono oggetti letterali, quindi `DRIVERS['constructor']`
//      rispondeva con un membro di Object.prototype — TRUTHY, cioè capace di
//      superare ogni `if (!drv)` e di arrivare fino a un TypeError travestito da
//      errore di rete. Prototipo nullo: ciò che non abbiamo messo noi è `undefined`.
//   ② Un 404 su un file statico che NON esiste rispondeva col PATH ASSOLUTO del
//      server dentro il messaggio d'errore (`ENOENT … stat 'C:\…\styles\x.css'`):
//      il messaggio veniva da `err.message` di fs e passava intero sotto il 500.
//
// ⚠️ L'ambiente isolato si imposta PRIMA di require('../server.js'): `node --test`
// dà un processo per file, quindi nessun test vicino ne risente.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-404-'));
const dir = (n) => { const p = path.join(TMP, n); fs.mkdirSync(p, { recursive: true }); return p; };
process.env.INFRANET_PROJECTS_DIR = dir('projects');
process.env.INFRANET_SKINS_DIR = dir('skins');
process.env.INFRANET_ORG_FILE = path.join(TMP, 'organization.json');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_AI_CONFIG_FILE = path.join(TMP, 'ai.json');
process.env.INFRANET_DCIM_CONFIG_FILE = path.join(TMP, 'dcim.json');
process.env.INFRANET_SESSION_SECRET_FILE = path.join(TMP, '.session-secret');

const { DRIVERS } = require('../server/drivers');
const dhcp = require('../server/dhcp-drivers');
const { app } = require('../server.js');

let server, base;
before(async () => {
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); } catch (_) { /* già chiuso */ } });

// ── ① I registri ───────────────────────────────────────────────────────────
test('① i driver SNMP che esistono ci sono ancora (il fix non deve togliere niente)', () => {
  for (const k of ['snmp-v1', 'snmp-v2c', 'snmp-v3', 'auto']) {
    assert.ok(k in DRIVERS, `il driver ${k} deve restare nel registro`);
  }
  assert.deepEqual(Object.keys(DRIVERS).sort(), ['auto', 'snmp-v1', 'snmp-v2c', 'snmp-v3']);
});

test('① un nome che non abbiamo messo noi vale undefined, non un membro di Object', () => {
  // La proprietà da provare non è «constructor non passa»: è che il registro
  // risponda SOLO per le chiavi che contiene. Sono i nomi che un body può portare.
  for (const chiave of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf']) {
    assert.equal(DRIVERS[chiave], undefined, `DRIVERS['${chiave}'] deve essere undefined`);
    assert.equal(dhcp.DRIVERS[chiave], undefined, `DHCP DRIVERS['${chiave}'] deve essere undefined`);
  }
  assert.equal(Object.getPrototypeOf(DRIVERS), null);
  assert.equal(Object.getPrototypeOf(dhcp.DRIVERS), null);
});

test('① fetchLeases con un vendor inventato dice «unknown vendor», non un TypeError', async () => {
  await assert.rejects(() => dhcp.fetchLeases('constructor', { host: 'x' }), /unknown vendor/);
  await assert.rejects(() => dhcp.fetchLeases('__proto__', { host: 'x' }), /unknown vendor/);
});

// ── ② Il 404 dei file statici ──────────────────────────────────────────────
// Le tre rotte hanno una regex sul nome (niente traversal) ma NON controllano che
// il file esista: il nome inventato passa la regex, cade nel sendFile, e l'errore
// arriva all'error-handler. È l'unica strada — il 404 catch-all non vede gli errori.
const RADICE = /[A-Za-z]:\\|\/home\/|\/Users\/|InfranetPro|node_modules/;

for (const rotta of ['/styles/mai-esistito.css', '/dist/mai-esistito.js', '/lib/mai-esistito.js']) {
  test(`② ${rotta} → 404 pulito, senza il path del server nel corpo`, async () => {
    const r = await fetch(base + rotta);
    const corpo = await r.text();
    assert.equal(r.status, 404);
    assert.ok(!RADICE.test(corpo), `il corpo non deve contenere path del server: ${corpo}`);
    assert.ok(!/ENOENT|stat |no such file/i.test(corpo), `nemmeno il codice fs: ${corpo}`);
    assert.deepEqual(JSON.parse(corpo), { error: 'Not found' });
  });
}

test('② un nome che la regex rifiuta resta un 404 vuoto (comportamento invariato)', async () => {
  const r = await fetch(base + '/styles/..%2Fsegreto.css');
  assert.equal(r.status, 404);
  assert.ok(!RADICE.test(await r.text()));
});
