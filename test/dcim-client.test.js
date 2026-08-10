// Test del client HTTP DCIM (server/dcim/client.js) contro un mock NetBox di
// loopback. Verifica: probe legge netbox-version, token in `Authorization: Token`,
// paginazione segue `next`, cap → truncated, errore senza token, tetto sul body,
// retry su 429 (Retry-After).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DcimClient, normalizeBaseUrl, normalizeToken, authMethodForToken, authorizationHeader } = require('../server/dcim/client');

let server, base;
let lastAuth = '';
let authHistory = [];
let probeStatus = 200;
let hits429 = 0;

before(async () => {
  server = http.createServer((req, res) => {
    lastAuth = req.headers.authorization || '';
    authHistory.push(lastAuth);
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (p === '/api/status/') return json(probeStatus, probeStatus === 200
      ? { 'netbox-version': '4.1.3', 'python-version': '3.11' }
      : { detail: 'token SUPERSECRET rejected' });
    if (p === '/api/echo-auth/') return json(200, { auth: lastAuth });
    if (p === '/api/dcim/sites/') {
      const offset = u.searchParams.get('offset');
      if (offset === '2') return json(200, { count: 3, next: null, results: [{ id: 3, name: 'Torino' }] });
      return json(200, { count: 3, next: base + '/api/dcim/sites/?limit=2&offset=2', results: [{ id: 1, name: 'Milano' }, { id: 2, name: 'Roma' }] });
    }
    if (p === '/api/boom/') return json(500, { detail: 'kaboom' });
    if (p === '/api/big/') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('[' + '0,'.repeat(2000) + '0]'); }
    if (p === '/api/429/') {
      if (hits429++ === 0) { res.writeHead(429, { 'Retry-After': '0', 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ detail: 'slow down' })); }
      return json(200, { ok: true });
    }
    return json(404, { detail: 'not found' });
  });
  await new Promise(r => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { if (server) server.close(); });

test('probe legge la versione da /api/status/', async () => {
  const c = new DcimClient({ url: base, token: 'tok-abc' });
  const r = await c.probe();
  assert.equal(r.ok, true);
  assert.equal(r.version, '4.1.3');
  assert.equal(r.authMethod, 'v1');
});

test('normalizza un URL NetBox incollato con un endpoint API', () => {
  assert.equal(normalizeBaseUrl(base + '/api/dcim/devices/'), base);
  assert.equal(normalizeBaseUrl(base + '/api/status/?limit=1'), base);
  assert.throws(() => normalizeBaseUrl('ftp://netbox.local'), /URL NetBox non valido/);
});

test('accetta token incollati con lo schema Authorization completo', () => {
  assert.deepEqual(normalizeToken('Token legacy-secret'), { value: 'legacy-secret', method: 'v1' });
  assert.deepEqual(normalizeToken('Bearer nbt_key.secret'), { value: 'nbt_key.secret', method: 'v2' });
  assert.equal(authMethodForToken('Bearer nbt_key.secret'), 'v2');
  assert.equal(authorizationHeader('Token legacy-secret'), 'Token legacy-secret');
  assert.equal(authorizationHeader('Bearer nbt_key.secret'), 'Bearer nbt_key.secret');
});

test('il token viaggia in Authorization: Token …', async () => {
  const c = new DcimClient({ url: base, token: 'SEG-RE-TO' });
  const j = await c.get('/api/echo-auth/');
  assert.equal(j.auth, 'Token SEG-RE-TO');
});

test('getPaginated segue `next` fino a esaurire', async () => {
  const c = new DcimClient({ url: base, token: 't' });
  const { results, truncated } = await c.getPaginated('/api/dcim/sites/', {}, { pageSize: 2 });
  assert.equal(results.length, 3);
  assert.deepEqual(results.map(x => x.id), [1, 2, 3]);
  assert.equal(truncated, false);
});

test('getPaginated rispetta il cap → truncated', async () => {
  const c = new DcimClient({ url: base, token: 't' });
  const { results, truncated } = await c.getPaginated('/api/dcim/sites/', {}, { pageSize: 2, cap: 2 });
  assert.equal(results.length, 2);
  assert.equal(truncated, true);
});

test('errore HTTP: messaggio senza token', async () => {
  const c = new DcimClient({ url: base, token: 'SUPERSECRET' });
  await assert.rejects(() => c.get('/api/boom/'), (e) => {
    assert.match(e.message, /500/);
    assert.ok(!/SUPERSECRET/.test(e.message), 'il token non deve comparire nel messaggio');
    return true;
  });
});

test('tetto sul body: risposta troppo grande → reject', async () => {
  const c = new DcimClient({ url: base, token: 't', maxBody: 64 });
  await assert.rejects(() => c.get('/api/big/'), /troppo grande/);
});

test('429 con Retry-After → ritenta e riesce', async () => {
  hits429 = 0;
  const c = new DcimClient({ url: base, token: 't' });
  const res = await c.request('GET', '/api/429/');
  assert.equal(res.status, 200);
  assert.ok(hits429 >= 2, 'deve aver ritentato dopo il 429');
});

test('il token v2 viaggia in Authorization: Bearer', async () => {
  const c = new DcimClient({ url: base, token: 'nbt_key.secret' });
  const j = await c.get('/api/echo-auth/');
  assert.equal(j.auth, 'Bearer nbt_key.secret');
  assert.equal(authHistory.at(-1), 'Bearer nbt_key.secret');
});

test('token vuoto → nessun header Authorization', async () => {
  const c = new DcimClient({ url: base, token: '' });
  const j = await c.get('/api/echo-auth/');
  assert.equal(j.auth, '');
  assert.equal(authHistory.at(-1), '');
});

test('getPaginated mantiene Authorization Bearer su `next` assoluto', async () => {
  authHistory = [];
  const c = new DcimClient({ url: base, token: 'nbt_key.secret' });
  const { results, truncated } = await c.getPaginated('/api/dcim/sites/', {}, { pageSize: 2 });
  assert.equal(results.length, 3);
  assert.equal(truncated, false);
  assert.ok(authHistory.length >= 2 && authHistory.every(value => value === 'Bearer nbt_key.secret'));
});

test('probe 401/403 suggerisce il formato v2 senza esporre il token', async () => {
  const c = new DcimClient({ url: base, token: 'SUPERSECRET' });
  try {
    for (const status of [401, 403]) {
      probeStatus = status;
      const result = await c.probe();
      assert.equal(result.ok, false);
      assert.equal(result.authMethod, 'v1');
      assert.match(result.error, /token|permessi|v2/i);
      assert.ok(!/SUPERSECRET/.test(result.error));
    }
  } finally {
    probeStatus = 200;
  }
});
