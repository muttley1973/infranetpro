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
//  (paletto sicurezza #1). Testabile contro un server http di loopback.
// ============================================================
const https = require('https');
const http = require('http');
const { URL } = require('url');

function _joinUrl(base, suffix) {
  const b = String(base || '').replace(/\/+$/, '');
  const s = String(suffix || '');
  return b + (s.startsWith('/') ? s : '/' + s);
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

// Messaggio d'errore breve dal body del provider (troncato), MAI con la chiave
// (la chiave non è nel body, sta nell'header). Difesa: tronca a 200 char.
function _briefError(body) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : '';
}

// Chiama il modello. Ritorna Promise<{content}>. `deps.timeoutMs` opzionale.
function chatCompletion(opts, deps) {
  const o = opts || {};
  const d = deps || {};
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(_joinUrl(o.endpoint, '/chat/completions')); }
    catch (_e) { return reject(new Error('Endpoint AI non valido')); }

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
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Provider AI: HTTP ' + res.statusCode +
            (_briefError(body) ? ' — ' + _briefError(body) : '')));
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

module.exports = { chatCompletion, _joinUrl, _parseContent, _briefError, _compact };
