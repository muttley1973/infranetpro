// Test del client HTTP DCIM (server/dcim/client.js) contro un mock NetBox di
// loopback. Verifica: probe legge netbox-version, token in `Authorization: Token`,
// paginazione segue `next`, cap → truncated, errore senza token, tetto sul body,
// retry su 429 (Retry-After).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DcimClient } = require('../server/dcim/client');

let server, base;
let lastAuth = '';
let hits429 = 0;

before(async () => {
  server = http.createServer((req, res) => {
    lastAuth = req.headers.authorization || '';
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (p === '/api/status/') return json(200, { 'netbox-version': '4.1.3', 'python-version': '3.11' });
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
