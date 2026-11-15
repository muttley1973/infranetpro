'use strict';
// ============================================================
// server/geocoder.js — «Trova»: dall'indirizzo di una sede a un punto proposto.
// ============================================================
// È l'UNICA uscita verso Internet dell'organizzazione multi-sede, ed esce solo
// quando l'utente preme «Trova» su una sede. Il browser non parla con nessuno
// (`connect-src 'self'`, fissato da test): chiede QUI, e qui si chiede al servizio.
//
//  ① **Il servizio è un ospite, e si sceglie.** Di base è Nominatim di
//     OpenStreetMap; `INFRANET_GEOCODER_URL` ne indica un altro (un Nominatim in
//     casa) oppure lo SPEGNE (`off`): spento non parte nessuna richiesta, mai. Il
//     servizio pubblico vuole al massimo UNA richiesta al secondo, un User-Agent
//     che dica l'applicazione, e che le risposte si tengano: tutto qui sotto.
//  ② **Niente di chi usa il prodotto va nella richiesta.** L'User-Agent è
//     `InfraNetPro/<versione>`: né un'e-mail, né un nome, né un progetto. Nella
//     richiesta c'è solo l'indirizzo che l'utente ha chiesto di cercare.
//  ③ **Una redirezione non si segue.** L'indirizzo del servizio è quello scelto
//     da chi amministra, non quello che il servizio ci suggerisce di usare.
//  ④ **Il guasto ha un nome.** `unreachable` (la rete non c'è o scade), `upstream`
//     (il servizio risponde male), `upstream-busy` (dice «troppo presto»),
//     `bad-response` (non è un elenco, o è enorme), `too-fast` (siamo NOI a
//     frenare, e diciamo fra quanto riprovare), `disabled`, `bad-query`.
//     Un guasto non si tiene in memoria: la prossima volta si riprova.
//
// ⚠️ Zero dipendenze: `node:https`/`node:http` (engines >=16, senza `fetch`), come
// `server/dcim/client.js`.
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { cleanGeocodeQuery, parseGeocodeResults, GEOCODE_MAX_RESULTS } = require('../lib/geocode.js');

const DEFAULT_URL = 'https://nominatim.openstreetmap.org/search';
const OFF = new Set(['off', 'none', '0', 'false', 'no']);
/** Il servizio pubblico: una richiesta al secondo. */
const MIN_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 24 * 3600 * 1000;
const CACHE_MAX = 200;
const TIMEOUT_MS = 8000;
/** Una risposta di cinque indirizzi pesa qualche KB: oltre questo non è la risposta. */
const MAX_BYTES = 256 * 1024;

/**
 * La configurazione, dall'ambiente. `enabled:false` dice anche PERCHÉ.
 * @param {Record<string,string|undefined>} [env]
 * @returns {{enabled:boolean, reason?:'off'|'bad-url', url?:string, host?:string}}
 */
function geocoderConfig(env) {
  const e = env || process.env;
  const raw = typeof e.INFRANET_GEOCODER_URL === 'string' ? e.INFRANET_GEOCODER_URL.trim() : '';
  if (OFF.has(raw.toLowerCase())) return { enabled: false, reason: 'off' };
  const value = raw || DEFAULT_URL;
  let u;
  try { u = new URL(value); } catch (_) { return { enabled: false, reason: 'bad-url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { enabled: false, reason: 'bad-url' };
  // Le credenziali non vanno scritte in un indirizzo: finirebbero nei log e nelle
  // risposte d'errore di mezza infrastruttura.
  if (u.username || u.password) return { enabled: false, reason: 'bad-url' };
  return { enabled: true, url: u.toString(), host: u.host };
}

/**
 * Il trasporto vero: GET, nessuna redirezione, scadenza TOTALE, risposta con un
 * tetto. Chi lo sostituisce (i test) onora la stessa firma.
 * @param {{url:string, headers:Record<string,string>, timeoutMs:number, maxBytes:number}} req
 * @returns {Promise<{status:number, body:string}>}
 */
function httpTransport(req) {
  return new Promise((resolve, reject) => {
    const u = new URL(req.url);
    const lib = u.protocol === 'https:' ? https : http;
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const r = lib.request(u, { method: 'GET', headers: req.headers }, (res) => {
      const parts = [];
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
        if (n > req.maxBytes) {
          const err = Object.assign(new Error('response too big'), { code: 'too-big' });
          res.destroy();
          finish(reject, err);
          return;
        }
        parts.push(c);
      });
      res.on('end', () => finish(resolve, { status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', (e) => finish(reject, e));
    });
    const timer = setTimeout(() => {
      r.destroy();
      finish(reject, Object.assign(new Error('timeout'), { code: 'timeout' }));
    }, req.timeoutMs);
    r.on('error', (e) => finish(reject, e));
    r.end();
  });
}

/**
 * Un cercatore con la sua memoria e il suo freno. Uno per processo; i test ne
 * fanno quanti vogliono, con trasporto e orologio finti.
 * @param {{env?:Record<string,string|undefined>, transport?:Function, now?:()=>number,
 *          version?:string, timeoutMs?:number, cacheMax?:number}} [opts]
 */
function createGeocoder(opts) {
  const o = opts || {};
  const transport = o.transport || httpTransport;
  const now = o.now || Date.now;
  const version = o.version || require('../package.json').version;
  const timeoutMs = o.timeoutMs || TIMEOUT_MS;
  const cacheMax = o.cacheMax || CACHE_MAX;
  /** @type {Map<string, {at:number, candidates:any[]}>} */
  const cache = new Map();
  let lastOutbound = -Infinity;

  const config = () => geocoderConfig(o.env || process.env);

  /** @param {unknown} query */
  async function search(query) {
    const cfg = config();
    if (!cfg.enabled) return { ok: false, code: 'disabled', reason: cfg.reason };
    const q = cleanGeocodeQuery(query);
    if (!q) return { ok: false, code: 'bad-query' };

    const key = q.toLowerCase();
    const t = now();
    const hit = cache.get(key);
    if (hit && t - hit.at <= CACHE_TTL_MS) return { ok: true, cached: true, host: cfg.host, candidates: hit.candidates };
    if (hit) cache.delete(key);

    // ③ Una richiesta al secondo. Si frena PRIMA di partire, e si dice quanto
    // aspettare: chi preme due volte di fila non deve credere che sia rotto.
    const wait = MIN_INTERVAL_MS - (t - lastOutbound);
    if (wait > 0) return { ok: false, code: 'too-fast', retryAfterMs: Math.ceil(wait) };
    lastOutbound = t;

    const u = new URL(/** @type {string} */ (cfg.url));
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', String(GEOCODE_MAX_RESULTS));

    let res;
    try {
      res = await transport({
        url: u.toString(),
        // ② Due intestazioni, e nessuna dice chi sei.
        headers: { 'User-Agent': 'InfraNetPro/' + version, Accept: 'application/json' },
        timeoutMs, maxBytes: MAX_BYTES,
      });
    } catch (e) {
      const code = e && /** @type {any} */ (e).code === 'too-big' ? 'bad-response' : 'unreachable';
      return { ok: false, code };
    }
    if (res.status === 429) return { ok: false, code: 'upstream-busy' };
    if (res.status !== 200) return { ok: false, code: 'upstream', status: res.status };
    let json;
    try { json = JSON.parse(res.body); } catch (_) { return { ok: false, code: 'bad-response' }; }
    if (!Array.isArray(json)) return { ok: false, code: 'bad-response' };

    const candidates = parseGeocodeResults(json);
    cache.set(key, { at: t, candidates });
    while (cache.size > cacheMax) cache.delete(cache.keys().next().value);
    return { ok: true, cached: false, host: cfg.host, candidates };
  }

  return { search, config, cacheSize: () => cache.size };
}

module.exports = { geocoderConfig, createGeocoder, httpTransport, MIN_INTERVAL_MS, DEFAULT_URL };
