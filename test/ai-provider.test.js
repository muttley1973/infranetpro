'use strict';
// ============================================================
//  test/ai-provider.test.js — server/ai/provider.js (client OpenAI-compatibile).
//  Verifica forma della richiesta (URL, Bearer, body), parsing della risposta e
//  gestione errori, contro un server HTTP di loopback (niente rete esterna).
//  ⭐ La CHIAVE non deve comparire nei messaggi d'errore.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { chatCompletion, _joinUrl } = require('../server/ai/provider.js');

function mockServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const portOf = (srv) => srv.address().port;

test('_joinUrl normalizza gli slash', () => {
  assert.equal(_joinUrl('http://h/v1', '/chat/completions'), 'http://h/v1/chat/completions');
  assert.equal(_joinUrl('http://h/v1/', 'chat/completions'), 'http://h/v1/chat/completions');
});

test('chatCompletion: POST /chat/completions con {model,messages} + Bearer; parsa choices', async () => {
  let cap = null;
  const srv = await mockServer((req, res, body) => {
    cap = { method: req.method, url: req.url, auth: req.headers.authorization, ctype: req.headers['content-type'], body: JSON.parse(body || '{}') };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'CIAO-MOCK' } }] }));
  });
  try {
    const out = await chatCompletion({ endpoint: `http://127.0.0.1:${portOf(srv)}/v1`, model: 'm1', key: 'sk-test', messages: [{ role: 'user', content: 'ciao' }] });
    assert.equal(out.content, 'CIAO-MOCK');
    assert.equal(cap.method, 'POST');
    assert.equal(cap.url, '/v1/chat/completions');
    assert.equal(cap.auth, 'Bearer sk-test');
    assert.match(cap.ctype, /application\/json/);
    assert.equal(cap.body.model, 'm1');
    assert.deepEqual(cap.body.messages, [{ role: 'user', content: 'ciao' }]);
  } finally { srv.close(); }
});

test('chatCompletion: senza key → nessun header Authorization (uso locale)', async () => {
  let auth = 'MISSING';
  const srv = await mockServer((req, res) => {
    auth = req.headers.authorization || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'x' } }] }));
  });
  try {
    await chatCompletion({ endpoint: `http://127.0.0.1:${portOf(srv)}/v1`, model: 'm', messages: [{ role: 'user', content: 'a' }] });
    assert.equal(auth, null, 'niente Authorization quando manca la key');
  } finally { srv.close(); }
});

test('chatCompletion: HTTP 401 → errore, ma la CHIAVE non compare nel messaggio', async () => {
  const srv = await mockServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  });
  try {
    await assert.rejects(
      chatCompletion({ endpoint: `http://127.0.0.1:${portOf(srv)}/v1`, model: 'm', key: 'sk-SUPERSECRET', messages: [{ role: 'user', content: 'a' }] }),
      (e) => /HTTP 401/.test(e.message) && !/sk-SUPERSECRET/.test(e.message),
    );
  } finally { srv.close(); }
});

test('chatCompletion: endpoint non valido → reject pulito', async () => {
  await assert.rejects(chatCompletion({ endpoint: 'not a url', messages: [] }), /Endpoint AI non valido/);
});
