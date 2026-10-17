'use strict';
// ============================================================
// Modulo AI — i valori che ENTRANO (config, chat, fatti) e quelli che ESCONO (errori del provider)
// ============================================================
// Verifica dei parametri dell'assistente, uno per uno:
//  · l'endpoint e' un URL http(s) senza credenziali dentro, e si accoda `/chat/completions` al
//    PERCORSO (non dopo la query: Azure OpenAI vuole `?api-version=`);
//  · la chiave e' un'intestazione HTTP: ASCII visibile, senza spazi ne' a-capo, e un errore del
//    provider che la rimanda indietro non la porta fino al browser;
//  · l'endpoint (un dato di rete, spesso un host interno) lo vede solo l'admin;
//  · la chat inoltra al provider — con la chiave dell'admin, pagando — una conversazione LIMITATA;
//  · i liveFacts del browser hanno un tetto per stringa e per elenco.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-aihard-'));
process.env.INFRANET_AI_CONFIG_FILE = path.join(TMP, 'ai-config.json');
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
fs.mkdirSync(process.env.INFRANET_PROJECTS_DIR, { recursive: true });
delete process.env.INFRANET_AI_KEY;
delete process.env.INFRANET_AI_ENDPOINT;

const express = require('express');
const provider = require('../server/ai/provider.js');
const aiConfig = require('../server/ai-config.js');
const aiRouter = require('../server/routes/ai.js');
const { saveProject, nextId } = require('../server/projects-store.js');
const { _sanitizeFacts, MAX_FACT_STR, MAX_FACT_LIST } = require('../server/ai/context.js');

// ── un "provider" di loopback che registra cosa riceve e risponde come vogliamo ───────────────
let llm, llmUrl, llmReceived, llmReply;
before(async () => {
  llm = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      llmReceived.push({ url: req.url, auth: req.headers.authorization || '', body });
      const r = llmReply(req);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    });
  });
  await new Promise((r) => llm.listen(0, '127.0.0.1', r));
  llmUrl = `http://127.0.0.1:${llm.address().port}`;
});
after(() => { if (llm) llm.close(); });
const resetLlm = (reply) => { llmReceived = []; llmReply = reply || (() => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } })); };

// ── il router montato con un ruolo scelto dal test ─────────────────────────────────────────────
let server, base, role = 'admin';
before(async () => {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.session = { user: { id: 1, username: 'u', role } }; next(); });
  app.use(aiRouter);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
const j = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ───────────────────────────── provider ─────────────────────────────

test('_joinUrl: `/chat/completions` va nel PERCORSO, la query resta alla fine (Azure OpenAI)', () => {
  assert.equal(provider._joinUrl('https://h/openai/deployments/x?api-version=2024-02-01', '/chat/completions'),
    'https://h/openai/deployments/x/chat/completions?api-version=2024-02-01');
  assert.equal(provider._joinUrl('http://h/v1/', 'chat/completions'), 'http://h/v1/chat/completions');
  assert.equal(provider._joinUrl('http://h', '/chat/completions'), 'http://h/chat/completions');
  assert.equal(provider._joinUrl('https://h/v1#frag', '/x'), 'https://h/v1/x', 'il frammento non viaggia');
  assert.equal(provider._joinUrl('non un url/', '/x'), 'non un url/x', 'ripiego storico per cio\' che non si legge');
});

test('_briefError: la chiave, un Bearer e un token tipo sk-… non escono, nemmeno a cavallo del taglio', () => {
  const key = 'KEY-' + 'x9'.repeat(12);
  const b = provider._briefError(`Incorrect API key: ${key}. Authorization: Bearer abcdefgh12345678 and sk-proj-AAAAAAAAAAAAAAAA`, key);
  assert.ok(!b.includes(key));
  assert.ok(!/abcdefgh12345678/.test(b));
  assert.ok(!/sk-proj-A/.test(b));
  // la chiave comincia al carattere 190: un taglio PRIMA di redigere ne lascerebbe 10 in chiaro
  const lungo = 'a'.repeat(190) + key + ' fine';
  const bl = provider._briefError(lungo, key);
  assert.ok(!bl.includes(key.slice(0, 8)), 'nemmeno un pezzo: ' + bl.slice(180));
  assert.ok(bl.length <= 200);
  assert.equal(provider._briefError('', key), '');
});

test('chatCompletion: un provider che rimanda la chiave nell\'errore NON la fa arrivare a chi chiama', async () => {
  const key = 'LIVE-KEY-' + 'q7'.repeat(10);
  resetLlm(() => ({ status: 401, body: `{"error":"invalid key ${key} (header: Bearer ${key})"}` }));
  await assert.rejects(
    provider.chatCompletion({ endpoint: llmUrl, model: 'm', key, messages: [{ role: 'user', content: 'hi' }] }),
    (e) => { assert.ok(!e.message.includes(key), e.message); assert.match(e.message, /HTTP 401/); return true; });
  assert.equal(llmReceived[0].auth, 'Bearer ' + key, 'la chiave viaggia, ma solo nell\'intestazione');
});

test('chatCompletion: chiave con a-capo / spazi / non ASCII → rifiutata PRIMA di connettersi', async () => {
  resetLlm();
  for (const bad of ['sk-abc\n', 'sk abc', 'sk-àbc', 'a'.repeat(513)]) {
    await assert.rejects(provider.chatCompletion({ endpoint: llmUrl, key: bad, messages: [] }), /Chiave AI non valida/, JSON.stringify(bad).slice(0, 20));
  }
  assert.equal(llmReceived.length, 0, 'nessuna richiesta e\' partita');
});

test('chatCompletion: un endpoint che non e\' http(s) non apre nessun socket', async () => {
  for (const ep of ['ftp://127.0.0.1/v1', 'file:///etc/passwd', 'javascript:alert(1)', 'nonunurl']) {
    await assert.rejects(provider.chatCompletion({ endpoint: ep, messages: [] }), /Endpoint AI non valido/, ep);
  }
});

test('chatCompletion: la query dell\'endpoint arriva al provider, dopo il percorso', async () => {
  resetLlm();
  await provider.chatCompletion({ endpoint: llmUrl + '/openai/deployments/d?api-version=2024-02-01', model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(llmReceived[0].url, '/openai/deployments/d/chat/completions?api-version=2024-02-01');
});

// ───────────────────────────── configurazione ─────────────────────────────

test('validateEndpoint: solo http(s), senza credenziali, con un host', () => {
  const ok = ['http://localhost:11434/v1', 'https://api.openai.com/v1', 'http://[::1]:11434/v1', 'http://srv.lan:8080', 'https://h/v1?api-version=1'];
  for (const e of ok) assert.equal(aiConfig.validateEndpoint(e).ok, true, e);
  const bad = { 'file:///etc/passwd': 'scheme', 'ftp://x/y': 'scheme', 'javascript:alert(1)': 'scheme', 'http://u:p@h/v1': 'credentials',
                'http://u@h/v1': 'credentials', 'non un url': 'unparsable', '': 'empty', '   ': 'empty', ['http://h/' + 'a'.repeat(2100)]: 'too-long' };
  for (const [e, why] of Object.entries(bad)) assert.equal(aiConfig.validateEndpoint(e).reason, why, e.slice(0, 40));
  assert.equal(aiConfig.validateEndpoint(5).ok, false);
  assert.equal(aiConfig.validateEndpoint(null).ok, false);
});

test('setConfig: un endpoint o una chiave non validi si RIFIUTANO e il file non cambia', () => {
  aiConfig.setConfig({ enabled: true, endpoint: 'http://localhost:11434/v1', model: 'm1', key: 'sk-GOOD' });
  const prima = fs.readFileSync(aiConfig.CONFIG_FILE, 'utf8');
  assert.throws(() => aiConfig.setConfig({ endpoint: 'http://u:p@h/v1', model: 'm2' }), (e) => e.code === 'endpoint_invalid' && e.reason === 'credentials');
  assert.throws(() => aiConfig.setConfig({ endpoint: 'file:///etc/passwd' }), (e) => e.code === 'endpoint_invalid');
  assert.throws(() => aiConfig.setConfig({ key: 'con spazio' }), (e) => e.code === 'key_invalid');
  assert.equal(fs.readFileSync(aiConfig.CONFIG_FILE, 'utf8'), prima, 'nessuna scrittura a meta\'');
});

test('setConfig: la chiave incollata con l\'a-capo si pulisce, e la stringa vuota la cancella', () => {
  aiConfig.setConfig({ key: '  sk-PASTED\n' });
  assert.equal(JSON.parse(fs.readFileSync(aiConfig.CONFIG_FILE, 'utf8')).key, 'sk-PASTED');
  aiConfig.setConfig({ key: '' });
  assert.equal(JSON.parse(fs.readFileSync(aiConfig.CONFIG_FILE, 'utf8')).key, '');
  aiConfig.setConfig({ model: 'm'.repeat(500) });
  assert.equal(JSON.parse(fs.readFileSync(aiConfig.CONFIG_FILE, 'utf8')).model.length, 200, 'il nome del modello ha un tetto');
});

test('_isLocalEndpoint: IPv6 tra parentesi e indirizzi di rete locale', () => {
  for (const e of ['http://[::1]:11434/v1', 'http://[fd12:3456::1]:8080', 'http://[fe80::1]/v1', 'http://localhost:11434', 'http://10.0.4.7:11434/v1', 'http://srv:8080', 'http://ollama.local/v1']) {
    assert.equal(aiConfig._isLocalEndpoint(e), true, e);
  }
  for (const e of ['https://api.openai.com/v1', 'https://example.com', 'http://8.8.8.8/v1']) assert.equal(aiConfig._isLocalEndpoint(e), false, e);
});

// ───────────────────────────── rotte ─────────────────────────────

test('GET /api/ai/config: l\'endpoint lo vede l\'admin; un viewer riceve `local` ma non l\'indirizzo', async () => {
  aiConfig.setConfig({ endpoint: 'http://10.0.4.7:11434/v1' });
  role = 'admin';
  const a = await j('GET', '/api/ai/config');
  assert.equal(a.json.endpoint, 'http://10.0.4.7:11434/v1');
  role = 'viewer';
  const v = await j('GET', '/api/ai/config');
  assert.equal(v.status, 200);
  assert.ok(!('endpoint' in v.json), 'l\'host interno non e\' un dato da viewer');
  assert.equal(v.json.local, true, 'ma il chip Locale/Cloud funziona');
  assert.ok(!JSON.stringify(v.json).includes('10.0.4.7'));
  role = 'admin';
});

test('PUT /api/ai/config: endpoint o chiave non validi → 400 col motivo (non un 500 muto)', async () => {
  role = 'admin';
  const e = await j('PUT', '/api/ai/config', { endpoint: 'ftp://x/y' });
  assert.deepEqual([e.status, e.json.error, e.json.reason], [400, 'endpoint_invalid', 'scheme']);
  const c = await j('PUT', '/api/ai/config', { endpoint: 'http://u:p@h/v1' });
  assert.deepEqual([c.status, c.json.error, c.json.reason], [400, 'endpoint_invalid', 'credentials']);
  const k = await j('PUT', '/api/ai/config', { key: 'a b' });
  assert.deepEqual([k.status, k.json.error], [400, 'key_invalid']);
  const ok = await j('PUT', '/api/ai/config', { endpoint: 'http://localhost:11434/v1', model: 'ok' });
  assert.equal(ok.status, 200);
  role = 'viewer';
  const vw = await j('PUT', '/api/ai/config', { model: 'x' });
  assert.equal(vw.status, 403, 'resta solo-admin');
  role = 'admin';
});

test('_safeProjectId: solo interi positivi nella forma canonica', () => {
  const f = aiRouter._safeProjectId;
  for (const [raw, want] of [[5, 5], ['5', 5], [' 12 ', 12], [1000, 1000]]) assert.equal(f(raw), want, String(raw));
  for (const bad of [true, false, [5], ['5'], { valueOf() { return 5; } }, '0x10', '1e3', '5.0', '+5', '05', '-1', 0, 5.5, NaN, Infinity,
                     '../users', '', null, undefined, 2 ** 60, '9'.repeat(30)]) {
    assert.equal(f(bad), null, JSON.stringify(bad) + ' / ' + String(bad));
  }
});

test('_capTurns: ultimi turni, ciascuno troncato, totale limitato — e l\'ultimo non si perde mai', () => {
  const { MAX_TURNS, MAX_TURN_CHARS, MAX_TOTAL_CHARS } = aiRouter.CAPS;
  const many = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const c1 = aiRouter._capTurns(many);
  assert.equal(c1.length, MAX_TURNS);
  assert.equal(c1[c1.length - 1].content, 'm199');
  const big = Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(50000) }));
  const c2 = aiRouter._capTurns(big);
  assert.ok(c2.every((m) => m.content.length <= MAX_TURN_CHARS));
  assert.ok(c2.reduce((n, m) => n + m.content.length, 0) <= MAX_TOTAL_CHARS);
  assert.equal(c2[c2.length - 1].content.length, MAX_TURN_CHARS, 'l\'ultimo turno resta (troncato)');
  assert.equal(aiRouter._capTurns([{ role: 'user', content: 'solo' }]).length, 1);
});

test('POST /api/ai/chat: al provider arriva una conversazione LIMITATA, anche se il corpo ne porta 20 MB', async () => {
  const id = nextId();
  await saveProject(id, 'p', { nodes: [], links: [], racks: [] }, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
  role = 'admin';
  aiConfig.setConfig({ enabled: true, endpoint: llmUrl, model: 'm', key: 'sk-CHAT' });
  resetLlm();
  const messages = Array.from({ length: 400 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: (i === 399 ? 'ULTIMA ' : 'turno ') + 'y'.repeat(40000) }));
  const r = await j('POST', '/api/ai/chat', { projectId: id, messages });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sent = JSON.parse(llmReceived[0].body).messages;
  const { MAX_TURNS, MAX_TURN_CHARS, MAX_TOTAL_CHARS } = aiRouter.CAPS;
  assert.equal(sent[0].role, 'system');
  const turns = sent.slice(1);
  assert.ok(turns.length <= MAX_TURNS, 'turni inoltrati: ' + turns.length);
  assert.ok(turns.every((m) => m.content.length <= MAX_TURN_CHARS));
  assert.ok(turns.reduce((n, m) => n + m.content.length, 0) <= MAX_TOTAL_CHARS);
  assert.ok(turns[turns.length - 1].content.startsWith('ULTIMA '), 'la domanda a cui si risponde c\'e\'');
});

test('POST /api/ai/chat: un projectId in forma strana e\' un 400, non il progetto di qualcun altro', async () => {
  role = 'admin';
  for (const bad of [true, [1], '0x1', '1e0', '../x']) {
    const r = await j('POST', '/api/ai/chat', { projectId: bad, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test('un errore del provider che cita la chiave arriva alla risposta della chat senza la chiave', async () => {
  const id = nextId();
  await saveProject(id, 'p2', { nodes: [], links: [], racks: [] }, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
  role = 'admin';
  const key = 'sk-ECHOED-' + 'z5'.repeat(10);
  aiConfig.setConfig({ enabled: true, endpoint: llmUrl, model: 'm', key });
  resetLlm(() => ({ status: 401, body: `bad credentials: ${key}` }));
  const r = await j('POST', '/api/ai/chat', { projectId: id, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.json).includes(key), JSON.stringify(r.json));
});

// ───────────────────────────── contesto ─────────────────────────────

test('liveFacts: ogni stringa ha un tetto, ogni elenco una lunghezza massima', () => {
  const huge = 'h'.repeat(100000);
  const facts = _sanitizeFacts({
    drift: {
      absent: Array.from({ length: 5000 }, (_, i) => ({ id: 'n' + i, name: huge })),
      undocumented: [{ ip: '10.0.0.1', hostname: huge }],
      identityChanged: [{ id: 'x', name: huge, changes: Array.from({ length: 100 }, () => huge) }],
    },
    gaps: Array.from({ length: 5000 }, () => ({ kind: huge, vlan: 10 })),
  }, { drift: true });
  assert.equal(facts.drift.absent.length, MAX_FACT_LIST);
  assert.ok(facts.drift.absent.every((e) => e.name.length <= MAX_FACT_STR));
  assert.ok(facts.drift.undocumented[0].hostname.length <= MAX_FACT_STR);
  assert.ok(facts.drift.identityChanged[0].changes.length <= 6);
  assert.ok(JSON.stringify(facts).length < 2_000_000, 'il prompt non cresce con il corpo: ' + JSON.stringify(facts).length);
});
