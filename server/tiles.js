'use strict';
// ============================================================
// server/tiles.js — lo sfondo della mappa: le tessere di OpenStreetMap, servite
// dal NOSTRO server.
// ============================================================
// La vista geografica del pannello multi-sede disegna le sedi su una mappa vera.
// Il browser però non parla con nessuno: la CSP dice `img-src 'self'` e
// `connect-src 'self'` (fissate da test), e il README promette «nessun cloud».
// Quindi le tessere non le chiede il browser a un terzo: le chiede QUESTO modulo,
// le tiene su disco e le serve da `/api/tiles/{z}/{x}/{y}.png`. Al servizio
// esterno arriva l'IP del server e quale tessera serve — non chi guarda.
//
//  ① **Il servizio è un ospite.** La politica d'uso di `tile.openstreetmap.org`
//     chiede: un User-Agent che dica l'applicazione, al più due richieste
//     insieme, una cache (sette giorni), niente raffiche. Tutto qui sotto: due
//     richieste insieme (le altre in coda), la stessa tessera chiesta due volte
//     insieme è UNA richiesta, una tessera si tiene sette giorni, un guasto non si
//     ripete per un minuto. L'User-Agent è `InfraNetPro/<versione>`: né un'e-mail,
//     né un nome, né un progetto.
//  ② **Ciò che entra è un numero.** z/x/y sono interi (z da 0 a 19, x e y nel
//     loro intervallo) scritti in cifre, senza zeri davanti: l'indirizzo e il
//     percorso su disco si compongono SOLO da lì, quindi non c'è modo di far
//     leggere o scrivere un percorso diverso, né di far chiedere al server un
//     indirizzo diverso da quello scelto da chi amministra.
//  ③ **Ciò che arriva da fuori non si crede.** Si accetta solo un 200 con tipo
//     `image/png` E con la firma di un PNG vero: una pagina d'errore con un tipo
//     sbagliato non entra in cache e non si serve. Redirezioni non seguite, tetto
//     sul corpo, scadenza.
//  ④ **Lo sfondo è un comfort.** Se il servizio non risponde ma una tessera
//     vecchia c'è, si serve quella; se non c'è, «non disponibile» e la mappa
//     resta senza sfondo. Una scrittura su disco che fallisce non fa fallire la
//     risposta.
//  ⑤ **La cache ha un tetto** (300 MB): oltre, si tolgono le tessere più vecchie.
//  ⑥ **Si sceglie e si spegne.** `INFRANET_TILES_URL` è un modello con `{z}` `{x}`
//     `{y}` (di base OpenStreetMap); `off` non fa partire nessuna richiesta, mai.
//     L'attribuzione di un servizio diverso la scrive chi lo sceglie
//     (`INFRANET_TILES_ATTRIBUTION`): dire «OpenStreetMap» di un altro sarebbe falso.
//
// ⚠️ Zero dipendenze: `node:https`/`node:http` (engines >=16, senza `fetch`).
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';
const OFF = new Set(['off', 'none', '0', 'false', 'no']);
const MAX_ZOOM = 19;
const TTL_MS = 7 * 24 * 3600 * 1000;
const FAIL_MS = 60 * 1000;
const MAX_PARALLEL = 2;
const TIMEOUT_MS = 8000;
/** Una tessera pesa decine di KB; oltre un megabyte non è una tessera. */
const MAX_BYTES = 1024 * 1024;
const CACHE_MAX_BYTES = 300 * 1024 * 1024;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * La configurazione, dall'ambiente.
 * @param {Record<string,string|undefined>} [env]
 * @returns {{enabled:boolean, reason?:'off'|'bad-url', template?:string, host?:string,
 *            attribution?:string, maxZoom?:number, dir:string}}
 */
function tilesConfig(env) {
  const e = env || process.env;
  const dir = (typeof e.INFRANET_TILES_DIR === 'string' && e.INFRANET_TILES_DIR.trim())
    ? e.INFRANET_TILES_DIR.trim() : path.join(__dirname, '..', 'data', 'tile-cache');
  const raw = typeof e.INFRANET_TILES_URL === 'string' ? e.INFRANET_TILES_URL.trim() : '';
  if (OFF.has(raw.toLowerCase())) return { enabled: false, reason: 'off', dir };
  const template = raw || DEFAULT_TEMPLATE;
  if (!/\{z\}/.test(template) || !/\{x\}/.test(template) || !/\{y\}/.test(template)) return { enabled: false, reason: 'bad-url', dir };
  let u;
  try { u = new URL(template.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0')); } catch (_) { return { enabled: false, reason: 'bad-url', dir }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { enabled: false, reason: 'bad-url', dir };
  if (u.username || u.password) return { enabled: false, reason: 'bad-url', dir };
  const attribution = raw
    ? (typeof e.INFRANET_TILES_ATTRIBUTION === 'string' ? e.INFRANET_TILES_ATTRIBUTION.trim().slice(0, 200) : '')
    : DEFAULT_ATTRIBUTION;
  return { enabled: true, template, host: u.host, attribution, maxZoom: MAX_ZOOM, dir };
}

/**
 * Una tessera, se è tre interi scritti in cifre. ② Accetta anche numeri veri (il
 * proxy li chiama da codice), ma solo interi nel loro intervallo.
 * @param {unknown} z @param {unknown} x @param {unknown} y
 * @returns {{z:number,x:number,y:number}|null}
 */
function parseTile(z, x, y) {
  const num = (v, max) => {
    let n;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && /^(0|[1-9]\d{0,8})$/.test(v)) n = Number(v);
    else return null;
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
  };
  const zz = num(z, MAX_ZOOM);
  if (zz === null) return null;
  const lato = Math.pow(2, zz) - 1;
  const xx = num(x, lato), yy = num(y, lato);
  if (xx === null || yy === null) return null;
  return { z: zz, x: xx, y: yy };
}

/**
 * Il trasporto vero: GET, nessuna redirezione, scadenza TOTALE, risposta col suo tetto.
 * @param {{url:string, headers:Record<string,string>, timeoutMs:number, maxBytes:number}} req
 * @returns {Promise<{status:number, type:string, body:Buffer}>}
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
        if (n > req.maxBytes) { res.destroy(); finish(reject, Object.assign(new Error('response too big'), { code: 'too-big' })); return; }
        parts.push(c);
      });
      res.on('end', () => finish(resolve, {
        status: res.statusCode || 0,
        type: String(res.headers['content-type'] || ''),
        body: Buffer.concat(parts),
      }));
      res.on('error', (e) => finish(reject, e));
    });
    const timer = setTimeout(() => { r.destroy(); finish(reject, Object.assign(new Error('timeout'), { code: 'timeout' })); }, req.timeoutMs);
    r.on('error', (e) => finish(reject, e));
    r.end();
  });
}

/**
 * Un proxy di tessere con la sua cache su disco. Uno per processo; i test ne fanno
 * quanti vogliono, con trasporto e cartella finti.
 * @param {{env?:Record<string,string|undefined>, transport?:Function, now?:()=>number,
 *          version?:string, timeoutMs?:number, cacheMaxBytes?:number}} [opts]
 */
function createTileProxy(opts) {
  const o = opts || {};
  const transport = o.transport || httpTransport;
  const now = o.now || Date.now;
  const version = o.version || require('../package.json').version;
  const timeoutMs = o.timeoutMs || TIMEOUT_MS;
  const cacheMax = o.cacheMaxBytes || CACHE_MAX_BYTES;
  const config = () => tilesConfig(o.env || process.env);

  /** @type {Map<string, Promise<any>>} */
  const inVolo = new Map();
  /** @type {Map<string, number>} */
  const guasti = new Map();
  /** @type {(() => void)[]} */
  const coda = [];
  let attive = 0;
  let scritti = 0;

  const fileOf = (c, t) => path.join(c.dir, String(t.z), String(t.x), t.y + '.png');
  const chiave = (t) => t.z + '/' + t.x + '/' + t.y;

  /** Una richiesta alla volta fino a due: le altre aspettano il loro turno. */
  function turno() {
    return new Promise((resolve) => {
      const parti = () => { attive++; resolve(undefined); };
      if (attive < MAX_PARALLEL) parti(); else coda.push(parti);
    });
  }
  function rilascia() {
    attive--;
    const prossima = coda.shift();
    if (prossima) prossima();
  }

  /** La tessera su disco, e quanto è vecchia. */
  function dalDisco(file) {
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size === 0) return null;
      return { body: fs.readFileSync(file), age: Math.max(0, now() - st.mtimeMs) };
    } catch (_) { return null; }
  }

  async function scarica(c, t) {
    await turno();
    try {
      const url = c.template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
      const res = await transport({
        url,
        // ① Due intestazioni, e nessuna dice chi sei.
        headers: { 'User-Agent': 'InfraNetPro/' + version, Accept: 'image/png' },
        timeoutMs, maxBytes: MAX_BYTES,
      });
      // ③ Un 200, un tipo PNG E la firma di un PNG vero.
      if (!res || res.status !== 200 || !/^image\/png\b/i.test(res.type || '')) return null;
      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body || '');
      if (body.length < PNG_SIG.length || !body.slice(0, PNG_SIG.length).equals(PNG_SIG)) return null;
      return body;
    } catch (_) {
      return null;
    } finally {
      rilascia();
    }
  }

  function scrivi(c, t, body) {
    // ④ Una scrittura che fallisce non fa fallire la risposta.
    try {
      const file = fileOf(c, t);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      scritti += body.length;
      if (scritti > 20 * 1024 * 1024) { scritti = 0; prune(); }
    } catch (_) { /* nessuna cache: si serve lo stesso */ }
  }

  /** ⑤ Sotto il tetto: si tolgono le più vecchie fino al 90%. */
  function prune() {
    const c = config();
    /** @type {{f:string, size:number, m:number}[]} */
    const tutte = [];
    const cammina = (d) => {
      let voci;
      try { voci = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const v of voci) {
        const p = path.join(d, v.name);
        if (v.isDirectory()) cammina(p);
        else if (v.isFile() && v.name.endsWith('.png')) {
          try { const st = fs.statSync(p); tutte.push({ f: p, size: st.size, m: st.mtimeMs }); } catch (_) { /* sparita nel frattempo */ }
        }
      }
    };
    cammina(c.dir);
    let totale = tutte.reduce((s, x) => s + x.size, 0);
    if (totale <= cacheMax) return { removed: 0, bytes: totale };
    tutte.sort((a, b) => a.m - b.m);
    let tolte = 0;
    for (const x of tutte) {
      if (totale <= cacheMax * 0.9) break;
      try { fs.unlinkSync(x.f); totale -= x.size; tolte++; } catch (_) { /* già tolta */ }
    }
    return { removed: tolte, bytes: totale };
  }

  /**
   * La tessera `z/x/y`.
   * @returns {Promise<{ok:true, body:Buffer, cached:boolean, stale?:boolean}|{ok:false, code:'disabled'|'bad-tile'|'unavailable'}>}
   */
  async function get(z, x, y) {
    const c = config();
    if (!c.enabled) return { ok: false, code: 'disabled' };
    const t = parseTile(z, x, y);
    if (!t) return { ok: false, code: 'bad-tile' };

    const file = fileOf(c, t);
    const su = dalDisco(file);
    if (su && su.age <= TTL_MS) return { ok: true, body: su.body, cached: true };

    const k = chiave(t);
    // ① Un guasto recente: non si ripete a raffica (e la tessera vecchia, se c'è, si serve).
    const ultimo = guasti.get(k);
    if (ultimo != null && now() - ultimo < FAIL_MS) {
      return su ? { ok: true, body: su.body, cached: true, stale: true } : { ok: false, code: 'unavailable' };
    }
    // ① La stessa tessera chiesta insieme da due parti: UNA richiesta.
    let p = inVolo.get(k);
    if (!p) {
      p = scarica(c, t).finally(() => { inVolo.delete(k); });
      inVolo.set(k, p);
    }
    const body = await p;
    if (body) {
      guasti.delete(k);
      scrivi(c, t, body);
      return { ok: true, body, cached: false };
    }
    guasti.set(k, now());
    if (guasti.size > 5000) guasti.delete(guasti.keys().next().value);
    // ④ Il servizio non risponde: la tessera vecchia è meglio di niente.
    return su ? { ok: true, body: su.body, cached: true, stale: true } : { ok: false, code: 'unavailable' };
  }

  return { get, config, prune };
}

module.exports = { tilesConfig, parseTile, createTileProxy, httpTransport, TTL_MS, FAIL_MS, MAX_PARALLEL, DEFAULT_TEMPLATE };
