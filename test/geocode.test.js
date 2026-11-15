'use strict';
// ============================================================
// «TROVA» — dall'indirizzo di una sede a un punto PROPOSTO (strato 1 della mappa reale).
//
// Le invarianti che questa fetta deve difendere:
//   ① una geocodifica PROPONE: restituisce candidati, non scrive niente (②);
//   ② la query è ciò che l'utente ha scritto, ripulita — mai un indirizzo
//      diverso, e mai niente di personale nelle intestazioni (privacy);
//   ③ il servizio pubblico è un OSPITE: una richiesta al secondo al massimo, le
//      risposte si tengono, e l'indirizzo del servizio è CONFIGURABILE;
//   ④ ciò che arriva da fuori non si crede: coordinate fuori dal globo, forme
//      strane e risposte enormi cadono;
//   ⑤ ogni guasto ha il suo NOME (irraggiungibile ≠ troppo presto ≠ risposta storta).
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const G = require('../lib/geocode.js');
const geocoder = require('../server/geocoder.js');

// ── La parte pura ──────────────────────────────────────────────────────────
test('② la query si ripulisce e basta: spazi, a capo, controlli', () => {
  assert.equal(G.cleanGeocodeQuery('  Viale  Brigata\nTreviso   1 \t'), 'Viale Brigata Treviso 1');
  assert.equal(G.cleanGeocodeQuery('via\u0000 Roma\u0007 3'), 'via Roma 3');
});

test('② una query troppo corta, troppo lunga o non testo non parte', () => {
  for (const v of [null, undefined, 5, {}, [], '', '  ', 'ab', '  a  ']) assert.equal(G.cleanGeocodeQuery(v), null, JSON.stringify(v));
  assert.equal(G.cleanGeocodeQuery('x'.repeat(G.GEOCODE_MAX_QUERY + 1)), null);
  assert.equal(G.cleanGeocodeQuery('x'.repeat(G.GEOCODE_MAX_QUERY)).length, G.GEOCODE_MAX_QUERY);
});

const NOMINATIM = [
  { place_id: 1, lat: '45.6669', lon: '12.2431', display_name: 'Treviso, Veneto, Italia', type: 'city' },
  { place_id: 2, lat: '45.6', lon: '12.1', display_name: 'Treviso Bresciano, Lombardia, Italia' },
];

test('④ la risposta di un servizio compatibile Nominatim diventa candidati con numeri veri', () => {
  const c = G.parseGeocodeResults(NOMINATIM);
  assert.deepEqual(c, [
    { lat: 45.6669, lng: 12.2431, label: 'Treviso, Veneto, Italia' },
    { lat: 45.6, lng: 12.1, label: 'Treviso Bresciano, Lombardia, Italia' },
  ]);
});

test('④ i candidati sono al massimo cinque, nell\'ordine in cui il servizio li ha dati', () => {
  const tanti = Array.from({ length: 12 }, (_, i) => ({ lat: String(40 + i), lon: '10', display_name: 'P' + i }));
  const c = G.parseGeocodeResults(tanti);
  assert.equal(c.length, G.GEOCODE_MAX_RESULTS);
  assert.deepEqual(c.map(x => x.label), ['P0', 'P1', 'P2', 'P3', 'P4']);
});

test('④ un candidato con coordinate fuori dal globo, mute o storte cade', () => {
  const c = G.parseGeocodeResults([
    { lat: '99', lon: '12', display_name: 'fuori latitudine' },
    { lat: '45', lon: '200', display_name: 'fuori longitudine' },
    { lat: 'abc', lon: '12', display_name: 'testo' },
    { lat: '45', display_name: 'manca lon' },
    { lat: null, lon: null, display_name: 'nulli' },
    null, 7, 'x',
    { lat: '45.5', lon: '12.5', display_name: 'buono' },
  ]);
  assert.deepEqual(c.map(x => x.label), ['buono']);
});

test('④ ciò che non è un elenco non è un risultato', () => {
  for (const v of [null, undefined, {}, 'x', 5, { error: 'rate limited' }]) assert.deepEqual(G.parseGeocodeResults(v), [], JSON.stringify(v));
});

test('④ l\'etichetta è testo semplice e corto: niente controlli, niente tag crudi lunghi', () => {
  const c = G.parseGeocodeResults([{ lat: '45', lon: '12', display_name: 'A\u0000B\nC ' + 'x'.repeat(400) }]);
  assert.ok([...c[0].label].every(ch => ch.charCodeAt(0) > 31), 'nessun carattere di controllo');
  assert.ok(c[0].label.length <= G.GEOCODE_MAX_LABEL);
  assert.ok(c[0].label.startsWith('A B C'));
});

test('un candidato senza etichetta si legge dalle sue coordinate, non sparisce', () => {
  const c = G.parseGeocodeResults([{ lat: '45.5', lon: '12.5' }]);
  assert.equal(c[0].label, '45.5, 12.5');
});

// ── La configurazione: il servizio è un ospite, e si sceglie ───────────────
test('③ senza configurazione il servizio è OpenStreetMap Nominatim', () => {
  const c = geocoder.geocoderConfig({});
  assert.equal(c.enabled, true);
  assert.equal(c.host, 'nominatim.openstreetmap.org');
  assert.match(c.url, /^https:\/\/nominatim\.openstreetmap\.org\//);
});

test('③ si spegne del tutto con off / none / 0 / false: nessuna richiesta, mai', () => {
  for (const v of ['off', 'OFF', 'none', '0', 'false', 'no']) {
    const c = geocoder.geocoderConfig({ INFRANET_GEOCODER_URL: v });
    assert.equal(c.enabled, false, v);
    assert.equal(c.reason, 'off', v);
  }
});

test('③ un altro servizio (Nominatim in casa) si indica con un indirizzo', () => {
  const c = geocoder.geocoderConfig({ INFRANET_GEOCODER_URL: 'http://geo.lan:8080/search' });
  assert.equal(c.enabled, true);
  assert.equal(c.host, 'geo.lan:8080');
  assert.equal(c.url, 'http://geo.lan:8080/search');
});

test('③ un indirizzo storto o con credenziali dentro spegne il servizio e lo dice', () => {
  for (const v of ['ftp://x/y', 'non un url', 'https://u:p@geo.lan/search', 'javascript:alert(1)']) {
    const c = geocoder.geocoderConfig({ INFRANET_GEOCODER_URL: v });
    assert.equal(c.enabled, false, v);
    assert.equal(c.reason, 'bad-url', v);
  }
});

// ── La ricerca, con un trasporto finto ─────────────────────────────────────
/** Un trasporto che registra le richieste e risponde con ciò che gli si dà. */
function finto(risposte) {
  const visti = [];
  const f = async (req) => {
    visti.push(req);
    const r = typeof risposte === 'function' ? risposte(req, visti.length) : risposte;
    if (r instanceof Error) throw r;
    return r;
  };
  f.visti = visti;
  return f;
}
const OK = { status: 200, body: JSON.stringify(NOMINATIM) };
let t0;
const orologio = (start) => { let n = start; const f = () => n; f.avanza = (ms) => { n += ms; }; return f; };
const fresco = (over) => geocoder.createGeocoder(Object.assign({ env: {}, version: '9.9.9' }, over || {}));

test('① cerca e RESTITUISCE candidati: non scrive niente e non conosce nessuna sede', async () => {
  const tr = finto(OK);
  const g = fresco({ transport: tr, now: orologio(1_000_000) });
  const r = await g.search('Treviso');
  assert.equal(r.ok, true);
  assert.equal(r.candidates.length, 2);
  assert.deepEqual(Object.keys(r).sort(), ['cached', 'candidates', 'host', 'ok']);
});

test('② la richiesta porta la query, il formato e un User-Agent che dice SOLO il prodotto', async () => {
  const tr = finto(OK);
  const g = fresco({ transport: tr, now: orologio(1_000_000) });
  await g.search('Viale Brigata Treviso 1, Treviso');
  const q = tr.visti[0];
  const u = new URL(q.url);
  assert.equal(u.searchParams.get('q'), 'Viale Brigata Treviso 1, Treviso');
  assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(u.searchParams.get('limit'), String(G.GEOCODE_MAX_RESULTS));
  assert.equal(q.headers['User-Agent'], 'InfraNetPro/9.9.9');
  // Niente di chi usa il prodotto: né un'e-mail, né un nome, né un progetto.
  const tutto = JSON.stringify(q.headers);
  assert.ok(!/@/.test(tutto), 'nessun indirizzo e-mail nelle intestazioni');
  assert.deepEqual(Object.keys(q.headers).sort(), ['Accept', 'User-Agent']);
});

test('③ la stessa domanda due volte = UNA richiesta: la seconda viene dalla memoria', async () => {
  const tr = finto(OK);
  const ora = orologio(1_000_000);
  const g = fresco({ transport: tr, now: ora });
  await g.search('Treviso');
  const r = await g.search('  treviso ');         // maiuscole e spazi non fanno un'altra domanda
  assert.equal(tr.visti.length, 1);
  assert.equal(r.cached, true);
  assert.equal(r.ok, true);
});

test('③ una richiesta al secondo al massimo: la seconda, diversa e subito, ASPETTA ed è detto', async () => {
  const tr = finto(OK);
  const ora = orologio(1_000_000);
  const g = fresco({ transport: tr, now: ora });
  await g.search('Treviso');
  ora.avanza(300);
  const r = await g.search('Conegliano');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'too-fast');
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 1000, String(r.retryAfterMs));
  assert.equal(tr.visti.length, 1, 'la richiesta presa a vuoto non è partita');
  ora.avanza(1000);
  assert.equal((await g.search('Conegliano')).ok, true);
  assert.equal(tr.visti.length, 2);
});

test('③ la memoria scade: dopo un giorno si richiede', async () => {
  const tr = finto(OK);
  const ora = orologio(1_000_000);
  const g = fresco({ transport: tr, now: ora });
  await g.search('Treviso');
  ora.avanza(24 * 3600 * 1000 + 5);
  await g.search('Treviso');
  assert.equal(tr.visti.length, 2);
});

test('③ la memoria ha un tetto: non cresce con le domande', async () => {
  const ora = orologio(1_000_000);
  const tr = finto(OK);
  const g = fresco({ transport: tr, now: ora, cacheMax: 3 });
  for (const q of ['aaa', 'bbb', 'ccc', 'ddd']) { await g.search(q); ora.avanza(1100); }
  assert.equal(g.cacheSize(), 3);
  await g.search('aaa');                           // la più vecchia è uscita
  assert.equal(tr.visti.length, 5);
});

test('③ spento: nessuna richiesta, e il motivo', async () => {
  const tr = finto(OK);
  const g = fresco({ env: { INFRANET_GEOCODER_URL: 'off' }, transport: tr });
  const r = await g.search('Treviso');
  assert.deepEqual([r.ok, r.code], [false, 'disabled']);
  assert.equal(tr.visti.length, 0);
});

test('② una query inservibile non parte, e non consuma il turno', async () => {
  const tr = finto(OK);
  const ora = orologio(1_000_000);
  const g = fresco({ transport: tr, now: ora });
  const r = await g.search('ab');
  assert.deepEqual([r.ok, r.code], [false, 'bad-query']);
  assert.equal(tr.visti.length, 0);
  ora.avanza(10);
  assert.equal((await g.search('Treviso')).ok, true, 'il turno non è stato bruciato');
});

test('⑤ ogni guasto ha il suo nome', async () => {
  const caso = async (risposta) => (await fresco({ transport: finto(risposta), now: orologio(5) }).search('Treviso'));
  assert.equal((await caso(new Error('ECONNREFUSED'))).code, 'unreachable');
  assert.equal((await caso({ status: 503, body: 'down' })).code, 'upstream');
  assert.equal((await caso({ status: 429, body: 'slow down' })).code, 'upstream-busy');
  assert.equal((await caso({ status: 200, body: '<html>' })).code, 'bad-response');
  assert.equal((await caso({ status: 200, body: '{"a":1}' })).code, 'bad-response');
});

test('un elenco vuoto è una RISPOSTA («nessun risultato»), non un guasto', async () => {
  const r = await fresco({ transport: finto({ status: 200, body: '[]' }), now: orologio(5) }).search('Posto Che Non Esiste');
  assert.deepEqual([r.ok, r.candidates.length], [true, 0]);
});

test('⑤ un guasto non si tiene in memoria: la prossima volta si riprova', async () => {
  let n = 0;
  const tr = finto(() => (++n === 1 ? new Error('boom') : OK));
  const ora = orologio(1_000_000);
  const g = fresco({ transport: tr, now: ora });
  assert.equal((await g.search('Treviso')).ok, false);
  ora.avanza(1100);
  assert.equal((await g.search('Treviso')).ok, true);
});

// ── Il trasporto vero, contro un server locale ─────────────────────────────
let srv, base, ultima;
before(async () => {
  srv = http.createServer((req, res) => {
    ultima = { url: req.url, ua: req.headers['user-agent'], host: req.headers.host };
    if (req.url.startsWith('/enorme')) { res.setHeader('content-type', 'application/json'); res.end('[' + '0,'.repeat(400000) + '0]'); return; }
    if (req.url.startsWith('/lento')) { return; }          // non risponde mai
    if (req.url.startsWith('/rimanda')) { res.statusCode = 302; res.setHeader('location', 'http://127.0.0.1:1/'); res.end(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(NOMINATIM));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { try { srv.close(); } catch (_) { /* già chiuso */ } });

test('il trasporto vero: parla HTTP, manda il suo User-Agent e legge i candidati', async () => {
  const g = geocoder.createGeocoder({ env: { INFRANET_GEOCODER_URL: base + '/search' }, version: '1.2.3' });
  const r = await g.search('Treviso');
  assert.equal(r.ok, true);
  assert.equal(r.candidates[0].label, 'Treviso, Veneto, Italia');
  assert.equal(ultima.ua, 'InfraNetPro/1.2.3');
  assert.match(ultima.url, /^\/search\?/);
});

test('④ una risposta enorme si interrompe: non si legge un file di megabyte', async () => {
  const g = geocoder.createGeocoder({ env: { INFRANET_GEOCODER_URL: base + '/enorme' } });
  const r = await g.search('Treviso');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad-response');
});

test('⑤ un servizio che non risponde scade, e si dice «irraggiungibile»', async () => {
  const g = geocoder.createGeocoder({ env: { INFRANET_GEOCODER_URL: base + '/lento' }, timeoutMs: 150 });
  const r = await g.search('Treviso');
  assert.deepEqual([r.ok, r.code], [false, 'unreachable']);
});

test('④ una redirezione NON si segue: l\'indirizzo del servizio è quello scelto, non quello che dice lui', async () => {
  const g = geocoder.createGeocoder({ env: { INFRANET_GEOCODER_URL: base + '/rimanda' } });
  const r = await g.search('Treviso');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'upstream');
});

// ── La rotta ───────────────────────────────────────────────────────────────
const express = require('express');
const { makeRouter } = require('../server/routes/geocode.js');

/** Monta la rotta con un cercatore finto e la sessione di un ruolo; passa `fn(base)`. */
async function conRotta(cercatore, ruolo, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = ruolo ? { user: { id: 1, username: 't', role: ruolo } } : {}; next(); });
  app.use(makeRouter(cercatore));
  const s = http.createServer(app);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}
const post = (base, body) => fetch(base + '/api/geocode', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const CANDIDATI = [{ lat: 45.6, lng: 12.2, label: 'Treviso' }];

test('la rotta: un admin cerca e riceve i candidati, nient\'altro', async () => {
  const visti = [];
  const finta = { config: () => ({ enabled: true, host: 'h' }), search: async (q) => { visti.push(q); return { ok: true, cached: false, host: 'h', candidates: CANDIDATI }; } };
  await conRotta(finta, 'admin', async (base) => {
    const r = await post(base, { q: 'Treviso' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { candidates: CANDIDATI, cached: false, host: 'h' });
    assert.deepEqual(visti, ['Treviso']);
  });
});

test('la rotta: chi non può salvare l\'organizzazione non può far partire una ricerca verso Internet', async () => {
  let chiamata = false;
  const finta = { config: () => ({ enabled: true }), search: async () => { chiamata = true; return { ok: true, candidates: [] }; } };
  for (const ruolo of ['viewer', 'user', null]) {
    await conRotta(finta, ruolo, async (base) => {
      const r = await post(base, { q: 'Treviso' });
      assert.ok(r.status === 401 || r.status === 403, `${ruolo}: ${r.status}`);
    });
  }
  assert.equal(chiamata, false);
});

test('la rotta: ogni guasto ha il suo codice, e «troppo presto» dice fra quanto', async () => {
  const caso = async (esito) => conRotta({ config: () => ({ enabled: true }), search: async () => esito }, 'admin', async (base) => {
    const r = await post(base, { q: 'Treviso' });
    return { status: r.status, retry: r.headers.get('retry-after'), body: await r.json() };
  });
  assert.equal((await caso({ ok: false, code: 'bad-query' })).status, 400);
  assert.equal((await caso({ ok: false, code: 'disabled', reason: 'off' })).status, 409);
  assert.equal((await caso({ ok: false, code: 'unreachable' })).status, 502);
  assert.equal((await caso({ ok: false, code: 'upstream', status: 503 })).status, 502);
  assert.equal((await caso({ ok: false, code: 'bad-response' })).status, 502);
  const presto = await caso({ ok: false, code: 'too-fast', retryAfterMs: 650 });
  assert.equal(presto.status, 429);
  assert.equal(presto.retry, '1');
  assert.equal(presto.body.retryAfterMs, 650);
});

test('la rotta: un corpo che non è { q } non arriva al servizio', async () => {
  let n = 0;
  const finta = { config: () => ({ enabled: true }), search: async (q) => { n++; return { ok: false, code: 'bad-query' }; } };
  await conRotta(finta, 'admin', async (base) => {
    const r = await fetch(base + '/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' });
    assert.equal(r.status, 400);
  });
  assert.equal(n, 0);
});

test('la rotta: lo stato dice se il servizio c\'è e DOVE va l\'indirizzo, senza l\'indirizzo completo', async () => {
  await conRotta({ config: () => ({ enabled: true, host: 'nominatim.openstreetmap.org', url: 'https://nominatim.openstreetmap.org/search?k=segreto' }), search: async () => ({}) }, 'viewer', async (base) => {
    const j = await (await fetch(base + '/api/geocode/status')).json();
    assert.deepEqual(j, { enabled: true, host: 'nominatim.openstreetmap.org', reason: null });
  });
  await conRotta({ config: () => ({ enabled: false, reason: 'off' }), search: async () => ({}) }, 'viewer', async (base) => {
    const j = await (await fetch(base + '/api/geocode/status')).json();
    assert.deepEqual(j, { enabled: false, host: null, reason: 'off' });
  });
});

test('il vocabolario dei guasti è UNO: la rotta ha un codice per ognuno, e nessuno in più', () => {
  const { _STATUS } = require('../server/routes/geocode.js');
  assert.deepEqual(Object.keys(_STATUS).sort(), G.GEOCODE_ERRORS.slice().sort());
});
