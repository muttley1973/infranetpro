'use strict';
// ============================================================
//  server/ai-config.js — configurazione dell'Assistente AI (server-side).
//
//  Persiste { enabled, endpoint, model, key } in data/ai-config.json (gitignored:
//  contiene la chiave BYO). Paletto SICUREZZA #1:
//    • la CHIAVE non torna MAI al browser: getConfig() restituisce solo `keySet`
//      (booleano). Il valore in chiaro lo usa solo il provider, lato server.
//    • override via env INFRANET_AI_KEY (ha precedenza sul valore su disco) →
//      i deployment possono NON scrivere la chiave su disco.
//    • il file su disco è ristretto a 0o600 (solo owner r/w) così la chiave BYO
//      non è leggibile da altri utenti del sistema (POSIX; best-effort altrove).
//  «OFF di default»: enabled=false finché un admin non lo attiva.
//
//  Modulo CommonJS puro-di-IO: helper di merge/mask testabili a tavolino
//  (file path iniettabile via INFRANET_AI_CONFIG_FILE, come projects-store).
// ============================================================
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = process.env.INFRANET_AI_CONFIG_FILE ||
  path.join(__dirname, '..', 'data', 'ai-config.json');

// Default: assistente SPENTO, endpoint locale (Ollama) per privacy, nessun modello/chiave.
const DEFAULTS = Object.freeze({
  enabled: false,
  endpoint: 'http://localhost:11434/v1',
  model: '',
  key: '',
});

// Interruttori AMBITO DATI (cosa esce verso il modello) e CAPACITÀ (cosa fa
// l'assistente). Tutti ON di default → l'admin sfoltisce per privacy/costo.
const SCOPE_KEYS = ['devices', 'ports', 'snmpHealth', 'topology', 'drift'];
const FEATURE_KEYS = ['qa', 'diagnostics', 'gaps', 'suggestions', 'ansible'];

// Normalizza un set di flag su un'allowlist di chiavi: default ON, solo un
// esplicito `false` spegne (difende da chiavi sconosciute in un file/body).
function _normFlags(raw, keys) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  for (const k of keys) out[k] = src[k] === false ? false : true;
  return out;
}

// Fonde i flag correnti con un patch parziale (solo booleani sulle chiavi note).
function _mergeFlags(cur, patch, keys) {
  const out = _normFlags(cur, keys);
  if (patch && typeof patch === 'object') {
    for (const k of keys) if (typeof patch[k] === 'boolean') out[k] = patch[k];
  }
  return out;
}

// Normalizza un oggetto config arbitrario sui soli campi noti (allowlist) e tipi
// attesi. Difende sia da un file su disco corrotto sia da un body PUT malevolo.
function _normalize(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    enabled: r.enabled === true,
    endpoint: typeof r.endpoint === 'string' && r.endpoint.trim() ? r.endpoint.trim() : DEFAULTS.endpoint,
    model: typeof r.model === 'string' ? r.model.trim() : '',
    key: typeof r.key === 'string' ? r.key : '',
    scope: _normFlags(r.scope, SCOPE_KEYS),
    features: _normFlags(r.features, FEATURE_KEYS),
  };
}

// Legge il file su disco (sola fonte di verità persistita); assente/corrotto → default.
function _readFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return _normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (_) { /* file illeggibile → default sicuri */ }
  return _normalize({});
}

// Chiave EFFETTIVA usata dal provider: env INFRANET_AI_KEY ha la precedenza
// (deployment senza chiave su disco), altrimenti quella salvata. Server-side only.
function _effectiveKey(cfg) {
  const env = process.env.INFRANET_AI_KEY;
  if (typeof env === 'string' && env.trim()) return env.trim();
  return cfg.key || '';
}

// Forma MASCHERATA per il browser: mai la chiave, solo `keySet` (+ `keyFromEnv`
// così la UI sa che è gestita via ambiente e non si può cambiare da qui).
function _mask(cfg) {
  const envKey = typeof process.env.INFRANET_AI_KEY === 'string' && process.env.INFRANET_AI_KEY.trim();
  return {
    enabled: cfg.enabled,
    endpoint: cfg.endpoint,
    model: cfg.model,
    keySet: !!_effectiveKey(cfg),
    keyFromEnv: !!envKey,
    // l'inferenza locale (es. Ollama) non richiede chiave: la UI mostra 🔒 Locale
    local: _isLocalEndpoint(cfg.endpoint),
    scope: _normFlags(cfg.scope, SCOPE_KEYS),
    features: _normFlags(cfg.features, FEATURE_KEYS),
  };
}

// Heuristica "endpoint locale" (per il chip privacy 🔒Locale/☁Cloud): loopback o
// hostname senza punto (.local, nomi LAN). Non è sicurezza, è solo etichetta UI.
function _isLocalEndpoint(endpoint) {
  const s = String(endpoint || '').trim();
  const m = s.match(/^https?:\/\/([^/:]+)/i);
  const host = m ? m[1].toLowerCase() : '';
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.endsWith('.local') || !host.includes('.')) return true;
  return false;
}

// Permessi del file di config: 0o600 (solo owner r/w) — la chiave BYO non dev'essere
// leggibile da altri utenti. `writeFileSync({mode})` applica i permessi solo alla
// CREAZIONE, quindi in sovrascrittura un file preesistente resta coi permessi vecchi:
// un chmod esplicito garantisce 0o600 comunque. Best-effort: su filesystem senza
// permessi POSIX (Windows/FAT) chmodSync è un no-op o lancia → si ignora.
function _hardenPerms(file) {
  try { fs.chmodSync(file, 0o600); } catch (_) { /* best-effort (Windows/FAT) */ }
}

// API pubblica del modulo --------------------------------------------------

// Config mascherata (per GET /api/ai/config e per la UI). MAI la chiave.
function getConfig() {
  return _mask(_readFile());
}

// Config completa CON chiave effettiva (env > disco). SOLO server-side (provider).
function getConfigWithKey() {
  const cfg = _readFile();
  return {
    enabled: cfg.enabled, endpoint: cfg.endpoint, model: cfg.model, key: _effectiveKey(cfg),
    scope: _normFlags(cfg.scope, SCOPE_KEYS), features: _normFlags(cfg.features, FEATURE_KEYS),
  };
}

// Aggiorna i campi forniti (PUT admin) e persiste. `key`:
//   • undefined  → invariata (non si tocca il segreto se il PUT non la manda)
//   • ''         → cancella la chiave salvata
//   • stringa    → imposta la nuova chiave
// Ritorna la forma MASCHERATA (la chiave non torna mai indietro).
function setConfig(patch) {
  const cur = _readFile();
  const p = (patch && typeof patch === 'object') ? patch : {};
  const next = {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : cur.enabled,
    endpoint: typeof p.endpoint === 'string' && p.endpoint.trim() ? p.endpoint.trim() : cur.endpoint,
    model: typeof p.model === 'string' ? p.model.trim() : cur.model,
    key: (p.key === undefined) ? cur.key : (typeof p.key === 'string' ? p.key : cur.key),
    scope: _mergeFlags(cur.scope, p.scope, SCOPE_KEYS),
    features: _mergeFlags(cur.features, p.features, FEATURE_KEYS),
  };
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  _hardenPerms(CONFIG_FILE);   // garantisce 0o600 anche in sovrascrittura di un file preesistente
  return _mask(next);
}

// Retro-fix del residuo audit: un file di produzione già su disco può essere stato
// scritto coi permessi di default (lassi) → chiave leggibile da altri utenti. Al
// caricamento del modulo lo irrigidiamo a 0o600 (SOLO il file di produzione, mai un
// path iniettato dai test via INFRANET_AI_CONFIG_FILE). Idempotente, best-effort.
if (!process.env.INFRANET_AI_CONFIG_FILE) {
  try { if (fs.existsSync(CONFIG_FILE)) _hardenPerms(CONFIG_FILE); } catch (_) { /* best-effort */ }
}

module.exports = {
  getConfig,
  getConfigWithKey,
  setConfig,
  CONFIG_FILE,
  // esportati per i test puri
  _normalize, _mask, _effectiveKey, _isLocalEndpoint, _normFlags, _mergeFlags, _hardenPerms,
  DEFAULTS, SCOPE_KEYS, FEATURE_KEYS,
};
