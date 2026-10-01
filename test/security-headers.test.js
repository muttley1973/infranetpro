'use strict';
// ============================================================
// test/security-headers.test.js — le intestazioni di sicurezza che ARCHITECTURE §8
// dichiara su OGNI risposta, e che fino al 01/10 nessun test guardava.
//
// Il caso che le ha messe sotto guardia: la CSP portava `'unsafe-eval'` con la
// motivazione «per librerie che compilano a runtime». Misurato: nessuna libreria lo
// faceva — il frontend non ha dipendenze — e l'unico `new Function(code)` era in
// `src/app-props-tabs.js`, per rieseguire il testo di un `onchange="…"` che nessuna
// select ha più (sono tutte migrate a `data-change`). Un permesso concesso per una
// ragione che non esiste più resta lì, e vale per CHIUNQUE inietti codice.
//
// La guardia ha DUE metà, perché la proprietà ne ha due:
//   · qui, a RUNTIME: la politica che il server manda davvero non lo concede;
//   · in `eslint.config.js`, sul SORGENTE: `no-eval` / `no-new-func` /
//     `no-implied-eval` su src/, lib/ ed export.js — senza, qualcuno riaggiunge
//     un `new Function` e il primo segno è la CSP che lo blocca nel browser.
//
// ⚠️ Resta `'unsafe-inline'` in `script-src`, e questa prova NON lo nasconde: ne
// restano ancora handler `on*=` statici nell'HTML (v. il ratchet ASSE B). Una prova
// che pretendesse di più sarebbe rossa oggi; una che pretendesse meno tacerebbe.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-sec-headers-'));
const dir = (n) => { const p = path.join(TMP, n); fs.mkdirSync(p, { recursive: true }); return p; };
process.env.INFRANET_PROJECTS_DIR = dir('projects');
process.env.INFRANET_SKINS_DIR = dir('skins');
process.env.INFRANET_ORG_FILE = path.join(TMP, 'organization.json');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_AI_CONFIG_FILE = path.join(TMP, 'ai.json');
process.env.INFRANET_DCIM_CONFIG_FILE = path.join(TMP, 'dcim.json');
process.env.INFRANET_SESSION_SECRET_FILE = path.join(TMP, '.session-secret');
process.env.SESSION_SECRET = 'test';
delete process.env.INFRANET_DEV_NO_AUTH;

const { app } = require('../server.js');
let server, base;
before(async () => {
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  try { server.close(); } catch (_) { /* già chiuso */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* pazienza */ }
});

// `directive → [sorgenti]`. Una direttiva ripetuta conta la PRIMA (così la legge il browser).
function parseCsp(policy) {
  const out = {};
  for (const part of String(policy || '').split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const name = toks[0].toLowerCase();
    if (!(name in out)) out[name] = toks.slice(1);
  }
  return out;
}
// Le sorgenti che valgono per gli SCRIPT: `script-src`, e solo se manca ricade su `default-src`.
const scriptSources = (csp) => csp['script-src'] || csp['default-src'] || [];

// ── La sonda deve saper vedere un rosso, prima di fidarsi del suo verde ─────
test('la sonda: una politica CON unsafe-eval viene riconosciuta come tale', () => {
  assert.ok(scriptSources(parseCsp("default-src 'self'; script-src 'self' 'unsafe-eval'")).includes("'unsafe-eval'"));
  // …anche quando `script-src` manca e vale il ripiego su default-src.
  assert.ok(scriptSources(parseCsp("default-src 'self' 'unsafe-eval'")).includes("'unsafe-eval'"));
  assert.ok(!scriptSources(parseCsp("default-src 'self'; script-src 'self'")).includes("'unsafe-eval'"));
});

// Pagine di natura diversa: l'app, un'API che risponde 401, un 404 JSON, un asset.
const PERCORSI = ['/', '/api/projects', '/api/non-esiste', '/styles/non-esiste.css', '/lib/non-esiste.js'];

async function chiedi(p) {
  const r = await fetch(base + p, { redirect: 'manual' });
  await r.arrayBuffer();           // si consuma il corpo: niente socket lasciati aperti
  return r;
}

test('la CSP NON concede unsafe-eval, su nessuna risposta', async () => {
  for (const p of PERCORSI) {
    const r = await chiedi(p);
    const csp = parseCsp(r.headers.get('content-security-policy'));
    assert.ok(Object.keys(csp).length > 0, `${p} (${r.status}): manca la Content-Security-Policy`);
    assert.ok(!scriptSources(csp).includes("'unsafe-eval'"),
      `${p} (${r.status}): script-src concede 'unsafe-eval' — nessun codice del frontend lo usa`);
  }
});

test('la CSP tiene le chiusure che ARCHITECTURE §8 dichiara', async () => {
  const r = await chiedi('/');
  const csp = parseCsp(r.headers.get('content-security-policy'));
  assert.deepEqual(csp['default-src'], ["'self'"], 'default-src solo da se stessi');
  assert.deepEqual(csp['object-src'], ["'none'"], 'niente plugin');
  assert.deepEqual(csp['base-uri'], ["'self'"], 'un <base> iniettato non dirotta gli URL relativi');
  assert.deepEqual(csp['frame-ancestors'], ["'none'"], 'nessuno può incorniciare l\'app');
  assert.deepEqual(csp['form-action'], ["'self'"], 'i form non partono verso altri siti');
  assert.deepEqual(csp['connect-src'], ["'self'"], 'le chiamate LLM sono lato server: il browser parla solo con noi');
});

test('le altre intestazioni di base sono su OGNI risposta', async () => {
  for (const p of PERCORSI) {
    const r = await chiedi(p);
    const ctx = `${p} (${r.status})`;
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', ctx);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', ctx);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', ctx);
  }
});
