'use strict';
// ============================================================
//  server/api-tokens.js — store dei token della REST API v1.
//
//  I token autenticano i CONSUMER ESTERNI (Ansible, script, dashboard) che non
//  hanno la sessione-cookie del browser. Mintati dall'admin, mostrati IN CHIARO
//  UNA SOLA VOLTA alla creazione; a riposo si conserva solo lo SHA-256 (i token
//  sono ad alta entropia → l'hash veloce è adeguato, niente bcrypt lento).
//
//  File `api-tokens.json` (gitignored). Override via INFRANET_API_TOKENS_FILE →
//  store isolato per i test, senza toccare i dati reali (come INFRANET_USERS_FILE).
// ============================================================
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { timestamp } = require('../utils');
const { atomicWriteFile } = require('./projects-store');   // scrittura atomica + .bak

const TOKENS_FILE = process.env.INFRANET_API_TOKENS_FILE || path.join(__dirname, '..', 'api-tokens.json');

const TOKEN_PREFIX = 'inp_';                 // "InfraNet Pro" — riconoscibile nei log/grep
const PREFIX_SHOWN = 12;                      // primi N char mostrati nella lista (inp_ + 8)
const LASTUSED_THROTTLE_MS = 60 * 1000;       // aggiorna lastUsedAt al più 1/min (limita I/O)

function _sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function loadTokens() {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return [];
    const arr = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function saveTokens(tokens) {
  // Scrittura ATOMICA (tmp+fsync+rename) con `.bak`: `verifyToken` riscrive questo
  // file ~1/min per aggiornare lastUsedAt, quindi un crash a meta' scrittura era
  // molto piu' probabile qui che altrove. Con la write raw un file troncato ->
  // loadTokens degradava a [] -> TUTTI i token API invalidati in silenzio (nessun
  // .bak da cui recuperare). Ora e' durevole come lo store progetti/utenti.
  atomicWriteFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function nextTokenId(tokens) {
  return tokens.reduce((max, t) => (t.id > max ? t.id : max), 0) + 1;
}

// Vista pubblica di un record: MAI lo hash. `prefix` aiuta a riconoscere quale
// token è quale senza rivelarlo (es. "inp_a1b2c3d4…").
function _publicView(t) {
  return { id: t.id, label: t.label, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt || null };
}

// Crea un token. Ritorna { token, record }: `token` è il segreto in chiaro,
// disponibile SOLO ORA (non più recuperabile). `record` è la vista pubblica.
function createToken(label) {
  const tokens = loadTokens();
  const secret = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const now = timestamp();
  const rec = {
    id: nextTokenId(tokens),
    label: String(label || '').trim() || 'token',
    hash: _sha256(secret),
    prefix: secret.slice(0, PREFIX_SHOWN),
    createdAt: now,
    lastUsedAt: null,
  };
  tokens.push(rec);
  saveTokens(tokens);
  return { token: secret, record: _publicView(rec) };
}

function listTokens() {
  return loadTokens().map(_publicView);
}

// Verifica un token presentato. Ritorna la vista pubblica del record se valido,
// altrimenti null. Confronto degli hash in tempo costante (timingSafeEqual).
// Aggiorna lastUsedAt (throttle 1/min) per dare visibilità su token attivi/morti.
function verifyToken(presented) {
  const p = String(presented || '');
  if (!p.startsWith(TOKEN_PREFIX)) return null;
  const hash = Buffer.from(_sha256(p), 'hex');
  const tokens = loadTokens();
  let match = null;
  for (const t of tokens) {
    let stored;
    try { stored = Buffer.from(String(t.hash || ''), 'hex'); } catch (_) { continue; }
    if (stored.length === hash.length && crypto.timingSafeEqual(stored, hash)) { match = t; break; }
  }
  if (!match) return null;

  const now = timestamp();
  const last = match.lastUsedAt ? Date.parse(match.lastUsedAt.replace(' ', 'T')) : 0;
  if (!last || (Date.now() - last) > LASTUSED_THROTTLE_MS) {
    match.lastUsedAt = now;
    try { saveTokens(tokens); } catch (_) { /* best-effort: la verifica non deve fallire per I/O */ }
  }
  return _publicView(match);
}

function revokeToken(id) {
  const tokens = loadTokens();
  const next = tokens.filter(t => t.id !== Number(id));
  if (next.length === tokens.length) return false;
  saveTokens(next);
  return true;
}

module.exports = {
  TOKEN_PREFIX, TOKENS_FILE,
  createToken, listTokens, verifyToken, revokeToken,
  // esportati per i test
  loadTokens, saveTokens, _sha256,
};
