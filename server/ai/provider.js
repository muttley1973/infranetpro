'use strict';
// ============================================================
//  server/ai/provider.js — client minimale OpenAI-compatibile (zero-dep).
//
//  Un solo aggancio: POST {endpoint}/chat/completions con { model, messages }.
//  Provider-agnostico → locale (Ollama) o cloud (OpenAI/Anthropic-compat/…),
//  scelto dall'utente (BYO key). HTTPS o HTTP secondo lo schema dell'endpoint
//  (Ollama locale è http). Usa node:https/node:http → resta dentro D3 (zero dep)
//  e engines>=16, senza fetch.
//
//  La CHIAVE viaggia SOLO nell'header Authorization, MAI nei messaggi d'errore
//  (paletto sicurezza #1): il body d'errore del provider si REDIGE (_redact) prima di
//  citarlo. Testabile contro un server http di loopback.
// ============================================================
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Accoda `suffix` al PERCORSO dell'endpoint, lasciando stare la query: Azure OpenAI e molti proxy
// vogliono `https://host/openai/deployments/x?api-version=2024-02-01`, e accodare per stringa
// dava `...?api-version=2024-02-01/chat/completions` — una richiesta sbagliata che il provider
// rifiutava con un errore che non parlava dell'endpoint. Un endpoint che non si legge come URL
// ricade sull'accodamento storico (e fallira' dove deve, in chatCompletion).
function _joinUrl(base, suffix) {
  const s = String(suffix || '');
  const sfx = s.startsWith('/') ? s : '/' + s;
  const raw = String(base || '').trim();
  let u;
  try { u = new URL(raw); } catch (_e) { return raw.replace(/\/+$/, '') + sfx; }
  u.pathname = u.pathname.replace(/\/+$/, '') + sfx;
  u.hash = '';
  return u.toString();
}

function _compact(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}

// Estrae il testo della risposta (formato OpenAI: choices[0].message.content).
// Niente "raw" nell'output → non rimandiamo al browser più del necessario.
function _parseContent(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  const msg = choice && choice.message;
  const content = (msg && typeof msg.content === 'string') ? msg.content : '';
  return { content };
}

// Toglie da un testo la chiave e ogni cosa che somigli a una credenziale. Il commento di un tempo
// diceva «la chiave non e' nel body, sta nell'header»: vero per OpenAI, che la maschera, non per
// i proxy e i server locali che rimandano indietro l'intestazione Authorization o la chiave
// intera nel messaggio d'errore. Quel body finisce nella risposta al browser (`detail`) e nei
// log: la redazione non puo' dipendere da come si comporta il provider.
function _redact(text, key) {
  let t = String(text == null ? '' : text);
  const k = String(key || '');
  if (k.length >= 6) t = t.split(k).join('***');
  t = t.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***');
  t = t.replace(/\b(?:sk|pk|rk|key|tok|api)[-_][A-Za-z0-9_-]{12,}/gi, '***');   // il formato dei provider piu' diffusi
  return t;
}

// Messaggio d'errore breve dal body del provider. Si REDIGE prima di troncare: una chiave a
// cavallo del taglio rimarrebbe a meta' e non combacerebbe piu' con niente.
function _briefError(body, key) {
  const s = _redact(String(body || ''), key).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : '';
}

// La chiave finisce in un'intestazione HTTP: solo ASCII visibile, niente spazi ne' a-capo. Un
// carattere fuori posto (spesso un a-capo incollato insieme alla chiave) faceva lanciare a Node
// un «Invalid character in header content» che non nomina la chiave.
const KEY_RE = /^[\x21-\x7e]{1,512}$/;

// Chiama il modello. Ritorna Promise<{content}>. `deps.timeoutMs` opzionale.
function chatCompletion(opts, deps) {
  const o = opts || {};
  const d = deps || {};
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(_joinUrl(o.endpoint, '/chat/completions')); }
    catch (_e) { return reject(new Error('Endpoint AI non valido')); }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') return reject(new Error('Endpoint AI non valido (solo http/https)'));
    if (o.key && !KEY_RE.test(String(o.key))) return reject(new Error('Chiave AI non valida (caratteri non ammessi: spazi, a-capo, non ASCII)'));
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const payload = JSON.stringify(_compact({
      model: o.model || undefined,
      messages: Array.isArray(o.messages) ? o.messages : [],
      temperature: (typeof o.temperature === 'number') ? o.temperature : 0.2,
      stream: false,
    }));
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (o.key) headers.Authorization = 'Bearer ' + o.key;

    const req = lib.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers,
      timeout: d.timeoutMs || 60000,
    }, (res) => {
      let body = '';
      let aborted = false;
      const MAX_BODY = 8 * 1024 * 1024;   // 8 MB: le risposte AI reali sono KB; oltre = endpoint ostile/mal-configurato
      res.setEncoding('utf8');
      res.on('data', (c) => {
        if (aborted) return;
        body += c;
        if (body.length > MAX_BODY) {       // tronca invece di gonfiare la memoria del server
          aborted = true;
          req.destroy();
          reject(new Error('Provider AI: risposta troppo grande (>8 MB)'));
        }
      });
      res.on('end', () => {
        if (aborted) return;
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Provider AI: HTTP ' + res.statusCode +
            (_briefError(body, o.key) ? ' — ' + _briefError(body, o.key) : '')));
        }
        let json;
        try { json = JSON.parse(body); }
        catch (_e) { return reject(new Error('Risposta del provider AI non in JSON')); }
        resolve(_parseContent(json));
      });
    });
    req.on('error', (e) => reject(new Error('Provider AI irraggiungibile: ' + e.message)));
    req.on('timeout', () => req.destroy(new Error('Provider AI: timeout')));
    req.write(payload);
    req.end();
  });
}

module.exports = { chatCompletion, _joinUrl, _parseContent, _briefError, _redact, _compact, KEY_RE };
