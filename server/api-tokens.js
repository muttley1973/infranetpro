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
const { cleanUserText } = require('../lib/user-text.js');  // la stessa forma del nome progetto

const TOKENS_FILE = process.env.INFRANET_API_TOKENS_FILE || path.join(__dirname, '..', 'api-tokens.json');

const TOKEN_PREFIX = 'inp_';                 // "InfraNet Pro" — riconoscibile nei log/grep
const PREFIX_SHOWN = 12;                      // primi N char mostrati nella lista (inp_ + 8)
const LASTUSED_THROTTLE_MS = 60 * 1000;       // aggiorna lastUsedAt al più 1/min (limita I/O)

const MAX_EXPIRY_DAYS = 3650;                 // ~10 anni: il tetto di una durata «lunga», non l'eternità

function _sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// ⚠️ `timestamp()` scrive l'ora UTC nella forma "YYYY-MM-DD HH:mm:ss", SENZA fuso.
// Rimessa in `Date.parse` con una 'T' e basta, viene letta come ora LOCALE: su una
// macchina a UTC+2 ogni istante scritto da noi risulta due ore nel FUTURO. Qui
// contava per il throttle di `lastUsedAt` (che quindi non si aggiornava più dopo la
// prima volta) e conterebbe per la scadenza, cioè per una decisione di sicurezza:
// si legge una volta sola, e come UTC.
function _parseTs(s) {
  if (!s) return 0;
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
}

// La scadenza è OPZIONALE e si dichiara alla creazione: un token senza `expiresAt`
// resta valido finché non lo revochi — è il comportamento di sempre, e i token già
// mintati non cambiano significato. Ma un token che non scade MAI, se sfugge (un
// file di CI, un playbook committato), vale per sempre e nessuno se ne accorge:
// chi lo sa può dargli una durata, e il segreto smette di valere da sé.
function _isExpired(rec, now) {
  const exp = _parseTs(rec && rec.expiresAt);
  return exp > 0 && (now == null ? Date.now() : now) >= exp;
}

/** `expiresInDays` → istante di scadenza nella forma di `timestamp()`, o null. */
function _expiryFromDays(days, fromMs) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;                       // assente/0/non numero = nessuna scadenza
  const giorni = Math.min(Math.ceil(n), MAX_EXPIRY_DAYS);
  const t = (fromMs == null ? Date.now() : fromMs) + giorni * 86400000;
  return new Date(t).toISOString().replace('T', ' ').substring(0, 19);
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
  return {
    id: t.id, label: t.label, prefix: t.prefix, createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt || null,
    // `null` = non scade (non «scade oggi»): chi lo mostra deve poter distinguere.
    expiresAt: t.expiresAt || null,
    expired: _isExpired(t),
  };
}

// Crea un token. Ritorna { token, record }: `token` è il segreto in chiaro,
// disponibile SOLO ORA (non più recuperabile). `record` è la vista pubblica.
// `opts.expiresInDays` (opzionale) dà al token una scadenza; senza, non scade.
function createToken(label, opts) {
  const tokens = loadTokens();
  const secret = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const now = timestamp();
  const expiresAt = _expiryFromDays(opts && opts.expiresInDays);
  const rec = {
    id: nextTokenId(tokens),
    // Stessa forma del nome di un progetto: l'etichetta la sceglie l'admin, ma
    // finisce in un elenco, in un log e in un file su disco (misurato: 2 MB ci
    // entravano, `\r\n` e NUL pure).
    label: cleanUserText(label) || 'token',
    hash: _sha256(secret),
    prefix: secret.slice(0, PREFIX_SHOWN),
    createdAt: now,
    lastUsedAt: null,
    expiresAt,
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
  // Scaduto = come non esistesse. Non si tocca il file: cancellare un token qui
  // farebbe sparire dalla lista dell'admin la riga che gli spiega perché lo script
  // ha smesso di funzionare — e la revoca resta una sua decisione.
  if (_isExpired(match)) return null;

  const now = timestamp();
  const last = _parseTs(match.lastUsedAt);
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
  TOKEN_PREFIX, TOKENS_FILE, MAX_EXPIRY_DAYS,
  createToken, listTokens, verifyToken, revokeToken,
  // esportati per i test
  loadTokens, saveTokens, _sha256, _parseTs, _isExpired, _expiryFromDays,
};
