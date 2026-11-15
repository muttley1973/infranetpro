'use strict';
// ============================================================
// LE TESSERE DELLA MAPPA — il proxy del server (`server/tiles.js`).
//
// La vista geografica del pannello multi-sede ha uno sfondo di OpenStreetMap. Il
// browser però non parla con nessuno (`connect-src 'self'`, `img-src 'self'`,
// fissati da test): le tessere le scarica il SERVER e le serve da sé. Le
// invarianti che questo proxy deve difendere:
//   ① il servizio è un OSPITE: al più due richieste insieme, un User-Agent che
//      dice solo il prodotto, una tessera già presa si tiene (sette giorni) e
//      non si richiede, un guasto non si ripete a raffica;
//   ② ciò che entra è NUMERICO: z/x/y sono interi nel loro intervallo — non c'è
//      modo di far scrivere o leggere un percorso diverso, né di far chiedere al
//      server un indirizzo diverso da quello scelto da chi amministra;
//   ③ ciò che arriva da fuori non si crede: una risposta che non è un PNG vero (una
//      pagina d'errore con un tipo sbagliato) non entra in cache e non si serve;
//   ④ lo sfondo è un COMFORT: se il servizio non risponde, si serve la tessera
//      vecchia che c'è; se non c'è, si dice «non disponibile» e la mappa resta
//      una mappa senza sfondo;
//   ⑤ la cache ha un TETTO, e quando lo supera toglie le più vecchie;
//   ⑥ è configurabile (`INFRANET_TILES_URL`) e si spegne del tutto (`off`).
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const T = require('../server/tiles.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-tiles-'));

// ── La configurazione ──────────────────────────────────────────────────────
test('⑥ senza configurazione lo sfondo è OpenStreetMap, con la sua attribuzione', () => {
  const c = T.tilesConfig({});
  assert.equal(c.enabled, true);
  assert.equal(c.host, 'tile.openstreetmap.org');
  assert.equal(c.template, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(c.attribution, /OpenStreetMap/);
});

test('⑥ si spegne con off / none / 0 / false: nessuna richiesta, mai', () => {
  for (const v of ['off', 'OFF', 'none', '0', 'false', 'no']) {
    const c = T.tilesConfig({ INFRANET_TILES_URL: v });
    assert.deepEqual([c.enabled, c.reason], [false, 'off'], v);
  }
});

test('⑥ un altro servizio si indica con un modello d\'indirizzo; l\'attribuzione la scrive chi lo sceglie', () => {
  const c = T.tilesConfig({ INFRANET_TILES_URL: 'http://tiles.lan:8080/osm/{z}/{x}/{y}.png', INFRANET_TILES_ATTRIBUTION: '© Noi' });
  assert.deepEqual([c.enabled, c.host, c.attribution], [true, 'tiles.lan:8080', '© Noi']);
  // Senza attribuzione scritta non se ne inventa una: dire «OpenStreetMap» di un altro servizio sarebbe falso.
  assert.equal(T.tilesConfig({ INFRANET_TILES_URL: 'http://tiles.lan/{z}/{x}/{y}.png' }).attribution, '');
});

test('⑥ un modello storto spegne il servizio e lo dice: senza {z}{x}{y}, credenziali, schema strano', () => {
  for (const v of ['https://x.org/tile.png', 'https://x.org/{z}/{x}.png', 'ftp://x/{z}/{x}/{y}.png',
    'https://u:p@x.org/{z}/{x}/{y}.png', 'non un url', 'javascript:alert(1)//{z}/{x}/{y}']) {
    const c = T.tilesConfig({ INFRANET_TILES_URL: v });
    assert.deepEqual([c.enabled, c.reason], [false, 'bad-url'], v);
  }
});

// ── ② Cosa entra è un numero ───────────────────────────────────────────────
test('② una tessera è tre interi nel loro intervallo, e nient\'altro', () => {
  assert.deepEqual(T.parseTile('3', '4', '2'), { z: 3, x: 4, y: 2 });
  assert.deepEqual(T.parseTile('0', '0', '0'), { z: 0, x: 0, y: 0 });
  assert.deepEqual(T.parseTile('19', '524287', '524287'), { z: 19, x: 524287, y: 524287 });
  for (const [z, x, y] of [['20', '0', '0'], ['3', '8', '0'], ['3', '0', '8'], ['-1', '0', '0'], ['3', '-1', '0'],
    ['a', '0', '0'], ['3', '1.5', '0'], ['3', '../1', '0'], ['3', '1', '..\\2'], ['', '0', '0'], ['03', '0', '0'],
    ['3', '00001', '0'], ['3', '1e1', '0'], [' 3', '0', '0'], ['3', '0', '0%2e'], ['999999999999', '0', '0']]) {
    assert.equal(T.parseTile(z, x, y), null, [z, x, y].join('/'));
  }
});

// ── Il proxy, con un trasporto finto ───────────────────────────────────────
function proxy(over) {
  const dir = tmp();
  const visti = [];
  const tr = over && over.transport ? over.transport : async (req) => { visti.push(req); return { status: 200, type: 'image/png', body: PNG }; };
  const wrap = async (req) => { if (!(over && over.transport)) return tr(req); visti.push(req); return over.transport(req); };
  const p = T.createTileProxy(Object.assign({ env: { INFRANET_TILES_DIR: dir }, version: '9.9.9', transport: wrap }, over && over.opts));
  return { p, dir, visti };
}

test('① la richiesta ha l\'indirizzo del modello e un User-Agent che dice SOLO il prodotto', async () => {
  const { p, visti } = proxy();
  const r = await p.get(3, 4, 2);
  assert.equal(r.ok, true);
  assert.equal(r.cached, false);
  assert.deepEqual(r.body, PNG);
  assert.equal(visti[0].url, 'https://tile.openstreetmap.org/3/4/2.png');
  assert.equal(visti[0].headers['User-Agent'], 'InfraNetPro/9.9.9');
  assert.ok(!/@/.test(JSON.stringify(visti[0].headers)), 'nessuna e-mail');
  assert.deepEqual(Object.keys(visti[0].headers).sort(), ['Accept', 'User-Agent']);
});

test('① una tessera già presa si tiene su disco e non si richiede', async () => {
  const { p, dir, visti } = proxy();
  await p.get(3, 4, 2);
  const r = await p.get(3, 4, 2);
  assert.equal(visti.length, 1);
  assert.equal(r.cached, true);
  assert.ok(fs.existsSync(path.join(dir, '3', '4', '2.png')));
  // E sopravvive a un riavvio: un proxy NUOVO sulla stessa cartella la ritrova.
  const p2 = T.createTileProxy({ env: { INFRANET_TILES_DIR: dir }, transport: async () => { throw new Error('non doveva chiedere'); } });
  assert.equal((await p2.get(3, 4, 2)).cached, true);
});

test('① dopo sette giorni la tessera si richiede', async () => {
  const { p, dir, visti } = proxy();
  await p.get(3, 4, 2);
  const f = path.join(dir, '3', '4', '2.png');
  const vecchio = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(f, vecchio, vecchio);
  const r = await p.get(3, 4, 2);
  assert.equal(visti.length, 2);
  assert.equal(r.cached, false);
});

test('① non più di due richieste insieme verso il servizio', async () => {
  let inVolo = 0, max = 0;
  const rilascia = [];
  const { p } = proxy({
    transport: () => new Promise((res) => {
      inVolo++; max = Math.max(max, inVolo);
      rilascia.push(() => { inVolo--; res({ status: 200, type: 'image/png', body: PNG }); });
    }),
  });
  const tutte = [0, 1, 2, 3, 4].map(x => p.get(3, x, 0));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(max, 2, 'due partono, le altre aspettano');
  while (rilascia.length) { rilascia.shift()(); await new Promise(r => setTimeout(r, 5)); }
  const esiti = await Promise.all(tutte);
  assert.ok(esiti.every(e => e.ok));
  assert.equal(max, 2);
});

test('① la stessa tessera chiesta due volte insieme è UNA richiesta sola', async () => {
  let n = 0;
  const { p } = proxy({ transport: async () => { n++; await new Promise(r => setTimeout(r, 20)); return { status: 200, type: 'image/png', body: PNG }; } });
  const [a, b] = await Promise.all([p.get(5, 1, 1), p.get(5, 1, 1)]);
  assert.equal(n, 1);
  assert.ok(a.ok && b.ok);
});

test('① un guasto non si ripete a raffica: per un minuto la tessera si dà per non disponibile', async () => {
  let n = 0;
  const ora = { t: 1_000_000 };
  const { p } = proxy({ transport: async () => { n++; return { status: 503, type: 'text/html', body: Buffer.from('giù') }; }, opts: { now: () => ora.t } });
  assert.deepEqual([(await p.get(3, 1, 1)).ok, (await p.get(3, 1, 1)).code], [false, 'unavailable']);
  assert.equal(n, 1, 'la seconda non è partita');
  ora.t += 61_000;
  await p.get(3, 1, 1);
  assert.equal(n, 2, 'dopo un minuto si riprova');
});

test('③ una risposta che non è un PNG vero non entra in cache e non si serve', async () => {
  for (const risposta of [
    { status: 200, type: 'image/png', body: Buffer.from('<html>errore</html>') },
    { status: 200, type: 'text/html', body: PNG },
    { status: 200, type: 'image/png', body: Buffer.alloc(0) },
  ]) {
    const { p, dir } = proxy({ transport: async () => risposta });
    const r = await p.get(3, 1, 1);
    assert.deepEqual([r.ok, r.code], [false, 'unavailable']);
    assert.ok(!fs.existsSync(path.join(dir, '3', '1', '1.png')), 'niente su disco');
  }
});

test('③ una risposta enorme si interrompe e non entra', async () => {
  const { p } = proxy({ transport: async () => { throw Object.assign(new Error('too big'), { code: 'too-big' }); } });
  assert.deepEqual([(await p.get(3, 1, 1)).ok], [false]);
});

test('④ se il servizio non risponde ma una tessera vecchia c\'è, si serve quella', async () => {
  let giu = false;
  const { p, dir } = proxy({ transport: async () => { if (giu) throw new Error('ECONNREFUSED'); return { status: 200, type: 'image/png', body: PNG }; } });
  await p.get(3, 4, 2);
  const f = path.join(dir, '3', '4', '2.png');
  const vecchio = new Date(Date.now() - 9 * 24 * 3600 * 1000);
  fs.utimesSync(f, vecchio, vecchio);
  giu = true;
  const r = await p.get(3, 4, 2);
  assert.deepEqual([r.ok, r.cached, r.stale], [true, true, true]);
  assert.deepEqual(r.body, PNG);
});

test('④ senza tessera e senza servizio: «non disponibile», niente eccezioni', async () => {
  const { p } = proxy({ transport: async () => { throw new Error('ECONNREFUSED'); } });
  const r = await p.get(3, 4, 2);
  assert.deepEqual([r.ok, r.code], [false, 'unavailable']);
});

test('⑥ spento: nessuna richiesta, e il motivo', async () => {
  let n = 0;
  const p = T.createTileProxy({ env: { INFRANET_TILES_URL: 'off', INFRANET_TILES_DIR: tmp() }, transport: async () => { n++; return { status: 200, type: 'image/png', body: PNG }; } });
  const r = await p.get(3, 4, 2);
  assert.deepEqual([r.ok, r.code], [false, 'disabled']);
  assert.equal(n, 0);
});

test('② coordinate fuori intervallo non arrivano né al disco né alla rete', async () => {
  let n = 0;
  const dir = tmp();
  const p = T.createTileProxy({ env: { INFRANET_TILES_DIR: dir }, transport: async () => { n++; return { status: 200, type: 'image/png', body: PNG }; } });
  for (const [z, x, y] of [[20, 0, 0], [3, 8, 0], [3, 0, -1], [3, 1.5, 0], [NaN, 0, 0], [null, 0, 0], [3, undefined, 0]]) {
    assert.deepEqual([(await p.get(z, x, y)).ok, (await p.get(z, x, y)).code], [false, 'bad-tile'], [z, x, y].join('/'));
  }
  assert.equal(n, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('⑤ la cache ha un tetto: quando lo supera toglie le tessere più vecchie', async () => {
  const dir = tmp();
  const { p } = proxy({ opts: { env: { INFRANET_TILES_DIR: dir }, cacheMaxBytes: PNG.length * 3 + 10 } });
  for (let x = 0; x < 5; x++) {
    await p.get(4, x, 0);
    const f = path.join(dir, '4', String(x), '0.png');
    const t = new Date(Date.now() - (10 - x) * 1000);     // x più basso = più vecchio
    fs.utimesSync(f, t, t);
  }
  p.prune();
  const restano = [0, 1, 2, 3, 4].filter(x => fs.existsSync(path.join(dir, '4', String(x), '0.png')));
  assert.ok(restano.length <= 3, 'sotto il tetto: ' + restano);
  assert.ok(restano.includes(4) && !restano.includes(0), 'restano le più recenti: ' + restano);
});

test('un errore di scrittura su disco non fa fallire la risposta', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '3'), 'sono un file, non una cartella');   // /3/... non si può creare
  const p = T.createTileProxy({ env: { INFRANET_TILES_DIR: dir }, transport: async () => ({ status: 200, type: 'image/png', body: PNG }) });
  const r = await p.get(3, 4, 2);
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, PNG);
});

// ── Il trasporto vero e la rotta ───────────────────────────────────────────
test('il trasporto vero: parla HTTP, non segue le redirezioni, rifiuta il troppo grande', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/rimanda')) { res.statusCode = 302; res.setHeader('location', 'http://127.0.0.1:1/'); return res.end(); }
    if (req.url.startsWith('/enorme')) { res.setHeader('content-type', 'image/png'); return res.end(Buffer.alloc(3 * 1024 * 1024, 1)); }
    res.setHeader('content-type', 'image/png');
    res.end(PNG);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ok = T.createTileProxy({ env: { INFRANET_TILES_URL: base + '/{z}/{x}/{y}.png', INFRANET_TILES_DIR: tmp() } });
    const r = await ok.get(3, 4, 2);
    assert.equal(r.ok, true);
    assert.deepEqual(r.body, PNG);
    const redir = T.createTileProxy({ env: { INFRANET_TILES_URL: base + '/rimanda/{z}/{x}/{y}.png', INFRANET_TILES_DIR: tmp() } });
    assert.equal((await redir.get(3, 4, 2)).ok, false, 'una redirezione non si segue');
    const grande = T.createTileProxy({ env: { INFRANET_TILES_URL: base + '/enorme/{z}/{x}/{y}.png', INFRANET_TILES_DIR: tmp() } });
    assert.equal((await grande.get(3, 4, 2)).ok, false, 'una tessera da megabyte non è una tessera');
  } finally { srv.close(); }
});

async function conRotta(proxyFinto, ruolo, fn) {
  const { makeRouter } = require('../server/routes/tiles.js');
  const app = express();
  app.use((req, _res, next) => { req.session = ruolo ? { user: { id: 1, username: 't', role: ruolo } } : {}; next(); });
  app.use(makeRouter(proxyFinto));
  const s = http.createServer(app);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}
const finto = (over) => Object.assign({
  config: () => ({ enabled: true, host: 'tile.openstreetmap.org', attribution: '© OpenStreetMap contributors', maxZoom: 19 }),
  get: async () => ({ ok: true, body: PNG, cached: false }),
}, over || {});

test('la rotta: una tessera è un PNG, con intestazioni da cache privata', async () => {
  await conRotta(finto(), 'viewer', async (base) => {
    const r = await fetch(base + '/api/tiles/3/4/2.png');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.match(r.headers.get('cache-control'), /private/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  });
});

test('la rotta: coordinate storte → 400, e non arrivano al proxy', async () => {
  let n = 0;
  await conRotta(finto({ get: async () => { n++; return { ok: true, body: PNG }; } }), 'viewer', async (base) => {
    for (const u of ['/api/tiles/20/0/0.png', '/api/tiles/3/8/0.png', '/api/tiles/a/0/0.png', '/api/tiles/3/1.5/0.png', '/api/tiles/3/0/-1.png']) {
      assert.equal((await fetch(base + u)).status, 400, u);
    }
  });
  assert.equal(n, 0);
});

test('la rotta: spento → 404; non disponibile → 503 senza corpo di pagina', async () => {
  await conRotta(finto({ get: async () => ({ ok: false, code: 'disabled' }) }), 'viewer', async (base) => {
    assert.equal((await fetch(base + '/api/tiles/3/4/2.png')).status, 404);
  });
  await conRotta(finto({ get: async () => ({ ok: false, code: 'unavailable' }) }), 'viewer', async (base) => {
    const r = await fetch(base + '/api/tiles/3/4/2.png');
    assert.equal(r.status, 503);
    assert.ok(!/html/i.test(r.headers.get('content-type') || ''));
  });
});

test('la rotta: lo stato dice se lo sfondo c\'è, l\'attribuzione da mostrare e il tetto dello zoom', async () => {
  await conRotta(finto(), 'viewer', async (base) => {
    const j = await (await fetch(base + '/api/tiles/status')).json();
    assert.deepEqual(j, { enabled: true, host: 'tile.openstreetmap.org', attribution: '© OpenStreetMap contributors', maxZoom: 19, reason: null });
  });
  await conRotta(finto({ config: () => ({ enabled: false, reason: 'off' }) }), 'viewer', async (base) => {
    const j = await (await fetch(base + '/api/tiles/status')).json();
    assert.deepEqual([j.enabled, j.reason, j.host], [false, 'off', null]);
  });
});
