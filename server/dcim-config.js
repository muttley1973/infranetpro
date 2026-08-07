'use strict';
// ============================================================
//  server/dcim-config.js — configurazione della Sincronizzazione DCIM/IPAM.
//
//  Persiste { url, token, verifyTls, adapter } in data/dcim-config.json
//  (gitignored: contiene il TOKEN dell'istanza DCIM esterna, es. NetBox).
//  Stessa filosofia di server/ai-config.js:
//    • il TOKEN non torna MAI al browser: getConfig() espone solo `tokenSet`
//      (booleano). Il valore in chiaro lo usa solo il client HTTP, lato server.
//    • override via env INFRANET_DCIM_URL / INFRANET_DCIM_TOKEN (precedenza sul
//      disco) → i deployment possono NON scrivere il token su disco.
//    • il file su disco è ristretto a 0o600 (solo owner r/w).
//  «adapter» = quale target DCIM (oggi solo `netbox`); campo tenuto per aprire
//  ad altri target in futuro senza cambiare la forma di config.
//
//  Modulo CommonJS puro-di-IO: helper di merge/mask testabili a tavolino
//  (file path iniettabile via INFRANET_DCIM_CONFIG_FILE, come ai-config/projects).
// ============================================================
const fs = require('fs');
const path = require('path');
const { atomicWriteFile } = require('./projects-store');   // scrittura atomica (+ mode)

const CONFIG_FILE = process.env.INFRANET_DCIM_CONFIG_FILE ||
  path.join(__dirname, '..', 'data', 'dcim-config.json');

// Adapter (target DCIM) supportati. Oggi uno solo; l'allowlist evita che un file
// corrotto o un PUT malevolo dirotti l'integrazione verso un adapter inesistente.
const ADAPTERS = ['netbox'];

// Default: nessuna istanza configurata, verifica TLS ATTIVA (sicuro di default).
const DEFAULTS = Object.freeze({
  url: '',
  token: '',
  verifyTls: true,
  adapter: 'netbox',
});

// URL base canonico: trim + via le slash finali (il client le rimette al join).
// Una sola forma su disco/UI → confronti e log puliti.
function _normUrl(s) {
  return (typeof s === 'string' ? s.trim() : '').replace(/\/+$/, '');
}

// Normalizza un oggetto config arbitrario sui soli campi noti (allowlist) e tipi
// attesi. Difende sia da un file su disco corrotto sia da un body PUT malevolo.
function _normalize(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    url: _normUrl(r.url),
    token: typeof r.token === 'string' ? r.token : '',
    // default TRUE: solo un esplicito `false` disattiva la verifica del certificato.
    verifyTls: r.verifyTls === false ? false : true,
    adapter: (typeof r.adapter === 'string' && ADAPTERS.includes(r.adapter)) ? r.adapter : DEFAULTS.adapter,
  };
}

// Legge il file su disco (sola fonte di verità persistita); assente/corrotto → default.
function _readFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return _normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (_) { /* file illeggibile → default sicuri */ }
  return _normalize({});
}

// URL/TOKEN EFFETTIVI: l'ambiente ha la precedenza (deployment senza segreti su
// disco), altrimenti il valore salvato. Server-side only.
function _effectiveUrl(cfg) {
  const env = process.env.INFRANET_DCIM_URL;
  if (typeof env === 'string' && env.trim()) return _normUrl(env);
  return cfg.url || '';
}
function _effectiveToken(cfg) {
  const env = process.env.INFRANET_DCIM_TOKEN;
  if (typeof env === 'string' && env.trim()) return env.trim();
  return cfg.token || '';
}

// Forma MASCHERATA per il browser: mai il token, solo `tokenSet` (+ `tokenFromEnv`
// così la UI sa che è gestito via ambiente e non si cambia da qui). L'URL NON è un
// segreto → si restituisce (aiuta a confermare verso quale istanza si punta).
function _mask(cfg) {
  const envUrl = typeof process.env.INFRANET_DCIM_URL === 'string' && process.env.INFRANET_DCIM_URL.trim();
  const envTok = typeof process.env.INFRANET_DCIM_TOKEN === 'string' && process.env.INFRANET_DCIM_TOKEN.trim();
  return {
    url: _effectiveUrl(cfg),
    urlSet: !!_effectiveUrl(cfg),
    urlFromEnv: !!envUrl,
    tokenSet: !!_effectiveToken(cfg),
    tokenFromEnv: !!envTok,
    verifyTls: cfg.verifyTls,
    adapter: cfg.adapter,
  };
}

// Permessi del file di config: 0o600 (solo owner r/w) — il token non dev'essere
// leggibile da altri utenti. `writeFileSync({mode})` applica i permessi solo alla
// CREAZIONE; un chmod esplicito garantisce 0o600 anche in sovrascrittura.
// Best-effort: su filesystem senza permessi POSIX (Windows/FAT) è un no-op.
function _hardenPerms(file) {
  try { fs.chmodSync(file, 0o600); } catch (_) { /* best-effort (Windows/FAT) */ }
}

// API pubblica del modulo --------------------------------------------------

// Config mascherata (per GET /api/integrations/dcim/config e per la UI). MAI il token.
function getConfig() {
  return _mask(_readFile());
}

// Config completa CON url+token effettivi (env > disco). SOLO server-side (client HTTP).
function getConfigWithToken() {
  const cfg = _readFile();
  return {
    url: _effectiveUrl(cfg),
    token: _effectiveToken(cfg),
    verifyTls: cfg.verifyTls,
    adapter: cfg.adapter,
  };
}

// Aggiorna i campi forniti (PUT admin) e persiste. `token`:
//   • undefined  → invariato (non si tocca il segreto se il PUT non lo manda)
//   • ''         → cancella il token salvato
//   • stringa    → imposta il nuovo token
// Ritorna la forma MASCHERATA (il token non torna mai indietro).
function setConfig(patch) {
  const cur = _readFile();
  const p = (patch && typeof patch === 'object') ? patch : {};
  const next = {
    url: typeof p.url === 'string' ? _normUrl(p.url) : cur.url,
    token: (p.token === undefined) ? cur.token : (typeof p.token === 'string' ? p.token : cur.token),
    verifyTls: typeof p.verifyTls === 'boolean' ? p.verifyTls : cur.verifyTls,
    adapter: (typeof p.adapter === 'string' && ADAPTERS.includes(p.adapter)) ? p.adapter : cur.adapter,
  };
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Scrittura ATOMICA con permessi 0o600 dal principio; _hardenPerms come cintura+bretelle.
  atomicWriteFile(CONFIG_FILE, JSON.stringify(next, null, 2), 0o600);
  _hardenPerms(CONFIG_FILE);
  return _mask(next);
}

// Retro-fix: un file di produzione già su disco può essere stato scritto coi
// permessi di default (lassi) → token leggibile da altri utenti. Al caricamento
// del modulo lo irrigidiamo a 0o600 (SOLO il file di produzione, mai un path
// iniettato dai test via INFRANET_DCIM_CONFIG_FILE). Idempotente, best-effort.
if (!process.env.INFRANET_DCIM_CONFIG_FILE) {
  try { if (fs.existsSync(CONFIG_FILE)) _hardenPerms(CONFIG_FILE); } catch (_) { /* best-effort */ }
}

module.exports = {
  getConfig,
  getConfigWithToken,
  setConfig,
  CONFIG_FILE,
  // esportati per i test puri
  _normalize, _mask, _effectiveUrl, _effectiveToken, _hardenPerms,
  DEFAULTS, ADAPTERS,
};
