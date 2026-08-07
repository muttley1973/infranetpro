'use strict';
// ============================================================
//  server/dcim/client.js — client HTTP minimale verso un DCIM (adapter NetBox).
//
//  Zero-dep: usa node:https/node:http (dentro D3, engines>=16, senza fetch),
//  come server/ai/provider.js. Il TOKEN viaggia SOLO nell'header
//  `Authorization: Token …`, MAI negli errori (troncati a 200 char).
//
//  Superficie: request (basso livello) · get (lancia su non-2xx) · getPaginated
//  (segue `next` di NetBox fino al cap) · probe (test connessione + versione).
//  Ritenta i 429 rispettando `Retry-After`. `verifyTls:false` → salta la verifica
//  del certificato (NetBox on-prem con CA privata) — scelta esplicita dell'admin.
// ============================================================
const https = require('https');
const http = require('http');
const { URL } = require('url');

function _joinUrl(base, apiPath) {
  const b = String(base || '').replace(/\/+$/, '');
  const s = String(apiPath || '');
  return b + (s.startsWith('/') ? s : '/' + s);
}

// Messaggio d'errore breve dal body (troncato), MAI col token (che sta nell'header).
function _briefError(body) {
  const s = String(body == null ? '' : body).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : '';
}

// Serializza una query in `?a=1&b=2`, saltando vuoti; gli array ripetono la chiave.
function _qs(query) {
  if (!query || typeof query !== 'object') return '';
  const parts = [];
  for (const k of Object.keys(query)) {
    const v = query[k];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { for (const x of v) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(x)); }
    else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return parts.length ? ('?' + parts.join('&')) : '';
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class DcimClient {
  constructor(opts) {
    const o = opts || {};
    this.url = String(o.url || '').replace(/\/+$/, '');
    this.token = o.token || '';
    this.verifyTls = o.verifyTls === false ? false : true;
    this.timeoutMs = o.timeoutMs || 30000;
    this.maxRetries = (typeof o.maxRetries === 'number') ? o.maxRetries : 3;
    // Tetto sul corpo di risposta: le risposte DCIM reali sono KB/MB; oltre =
    // istanza ostile/mal-configurata. Iniettabile per i test.
    this.maxBody = (typeof o.maxBody === 'number') ? o.maxBody : 32 * 1024 * 1024;
  }

  // Basso livello: UNA richiesta HTTP verso un URL assoluto. Ritorna
  // Promise<{status, json, headers, raw}>. Rigetta solo su trasporto/timeout/
  // oversize/JSON-non-parsabile-su-2xx. Gli status HTTP tornano nel risultato.
  _once(method, fullUrl, body) {
    return new Promise((resolve, reject) => {
      let url;
      try { url = new URL(fullUrl); }
      catch (_e) { return reject(new Error('URL DCIM non valido')); }

      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const payload = (body !== undefined && body !== null) ? JSON.stringify(body) : null;
      const headers = { Accept: 'application/json' };
      if (this.token) headers.Authorization = 'Token ' + this.token;
      if (payload !== null) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      const reqOpts = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        headers,
        timeout: this.timeoutMs,
      };
      if (isHttps) reqOpts.rejectUnauthorized = this.verifyTls;

      const req = lib.request(reqOpts, (res) => {
        let b = ''; let aborted = false;
        res.setEncoding('utf8');
        res.on('data', (c) => {
          if (aborted) return;
          b += c;
          if (b.length > this.maxBody) {
            aborted = true; req.destroy();
            reject(new Error('Risposta DCIM troppo grande (> ' + Math.round(this.maxBody / 1048576) + ' MB)'));
          }
        });
        res.on('end', () => {
          if (aborted) return;
          let json = null;
          if (b) {
            try { json = JSON.parse(b); }
            catch (_e) {
              if (res.statusCode >= 200 && res.statusCode < 300) return reject(new Error('Risposta DCIM non in JSON'));
            }
          }
          resolve({ status: res.statusCode, json, headers: res.headers, raw: json ? '' : _briefError(b) });
        });
      });
      req.on('error', (e) => reject(new Error('DCIM irraggiungibile: ' + e.message)));
      req.on('timeout', () => req.destroy(new Error('DCIM: timeout')));
      if (payload !== null) req.write(payload);
      req.end();
    });
  }

  // request con retry su 429 (rispetta `Retry-After`, altrimenti backoff esponenziale).
  async request(method, apiPath, body) {
    const full = _joinUrl(this.url, apiPath);
    let attempt = 0;
    for (;;) {
      const res = await this._once(method, full, body);
      if (res.status === 429 && attempt < this.maxRetries) {
        const ra = parseInt(res.headers['retry-after'], 10);
        const waitMs = Number.isFinite(ra) ? Math.min(ra * 1000, 30000) : Math.min(500 * Math.pow(2, attempt), 4000);
        attempt++;
        await _sleep(waitMs);
        continue;
      }
      return res;
    }
  }

  // GET che LANCIA su non-2xx (messaggio breve, MAI il token). Ritorna il json.
  async get(apiPath, query) {
    const res = await this.request('GET', apiPath + _qs(query));
    if (res.status < 200 || res.status >= 300) {
      const detail = _briefError(res.raw || (res.json && (res.json.detail || res.json.error)) || '');
      throw new Error('DCIM HTTP ' + res.status + (detail ? ' — ' + detail : ''));
    }
    return res.json;
  }

  // GET paginato: segue `next` (URL assoluto di NetBox) fino a esaurire o al cap.
  // Ritorna { results, truncated }. `truncated=true` = superato il cap (dato parziale).
  async getPaginated(apiPath, query, opts) {
    const cap = (opts && opts.cap) || 10000;
    const pageSize = (opts && opts.pageSize) || 250;
    const out = [];
    let truncated = false;
    let page = await this.get(apiPath, Object.assign({ limit: pageSize }, query || {}));
    for (;;) {
      const results = (page && Array.isArray(page.results)) ? page.results : (Array.isArray(page) ? page : []);
      for (const it of results) {
        if (out.length >= cap) { truncated = true; break; }
        out.push(it);
      }
      if (truncated) break;
      const next = page && page.next;
      if (!next) break;
      const res = await this._once('GET', next);   // `next` è assoluto e già include limit/offset
      if (res.status < 200 || res.status >= 300) break;
      page = res.json;
    }
    return { results: out, truncated };
  }

  // Test di connessione + versione. NON lancia: {ok, version} | {ok:false, error}.
  async probe() {
    try {
      const res = await this.request('GET', '/api/status/');
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'Token rifiutato (HTTP ' + res.status + ')' };
      if (res.status < 200 || res.status >= 300) return { ok: false, error: 'HTTP ' + res.status };
      const j = res.json || {};
      const version = j['netbox-version'] || j.version || '';
      return { ok: true, version: String(version || '') };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
}

module.exports = { DcimClient, _joinUrl, _briefError, _qs };
