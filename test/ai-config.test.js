'use strict';
// ============================================================
//  test/ai-config.test.js — server/ai-config.js (config Assistente AI).
//  Paletto SICUREZZA #1: la CHIAVE non torna MAI al browser (getConfig mascherato).
//  File di config su dir temporanea (INFRANET_AI_CONFIG_FILE) → niente IO reale.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-aicfg-'));
const CFG = path.join(TMP, 'ai-config.json');
process.env.INFRANET_AI_CONFIG_FILE = CFG;
delete process.env.INFRANET_AI_KEY;        // stato di partenza pulito
const ai = require('../server/ai-config.js');

test('default: spento + endpoint locale (Ollama), nessuna chiave', () => {
  const c = ai.getConfig();
  assert.equal(c.enabled, false);
  assert.equal(c.endpoint, 'http://localhost:11434/v1');
  assert.equal(c.keySet, false);
  assert.equal(c.local, true);
  assert.ok(!('key' in c), 'la forma mascherata non contiene mai il campo key');
});

test('setConfig persiste e ritorna mascherato (la chiave non torna indietro)', () => {
  const m = ai.setConfig({ enabled: true, endpoint: 'https://api.example.com/v1', model: 'gpt-4o-mini', key: 'sk-SECRET-1' });
  assert.equal(m.enabled, true);
  assert.equal(m.model, 'gpt-4o-mini');
  assert.equal(m.keySet, true);
  assert.equal(m.local, false);             // endpoint cloud
  assert.ok(!('key' in m), 'setConfig non rimanda mai la chiave');
  // Su disco la chiave c'è (server-side); getConfig continua a non esporla.
  const raw = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  assert.equal(raw.key, 'sk-SECRET-1');
  assert.ok(!('key' in ai.getConfig()));
  assert.equal(ai.getConfig().keySet, true);
});

test('getConfigWithKey espone la chiave SOLO server-side (per il provider)', () => {
  assert.equal(ai.getConfigWithKey().key, 'sk-SECRET-1');
});

test('key undefined = invariata; key "" = cancella', () => {
  ai.setConfig({ model: 'x' });             // niente key nel patch → invariata
  assert.equal(ai.getConfigWithKey().key, 'sk-SECRET-1');
  ai.setConfig({ key: '' });                // stringa vuota → cancella
  assert.equal(ai.getConfigWithKey().key, '');
  assert.equal(ai.getConfig().keySet, false);
});

test('env INFRANET_AI_KEY ha precedenza (deployment senza chiave su disco)', () => {
  process.env.INFRANET_AI_KEY = 'env-key-XYZ';
  const c = ai.getConfig();
  assert.equal(c.keySet, true);
  assert.equal(c.keyFromEnv, true);
  assert.equal(ai.getConfigWithKey().key, 'env-key-XYZ');
  delete process.env.INFRANET_AI_KEY;
});

test('_isLocalEndpoint: loopback/LAN/.local = locale; dominio pubblico = cloud', () => {
  assert.equal(ai._isLocalEndpoint('http://localhost:11434/v1'), true);
  assert.equal(ai._isLocalEndpoint('http://127.0.0.1:11434'), true);
  assert.equal(ai._isLocalEndpoint('http://192.168.1.50:11434'), true);
  assert.equal(ai._isLocalEndpoint('http://10.0.0.9/v1'), true);
  assert.equal(ai._isLocalEndpoint('http://ollama/v1'), true);     // hostname senza punto
  assert.equal(ai._isLocalEndpoint('https://api.openai.com/v1'), false);
});

test('_normalize: scarta campi sconosciuti e tipi errati (difesa input)', () => {
  const n = ai._normalize({ enabled: 'yes', endpoint: 42, model: { x: 1 }, key: 'k', evil: 'DROP' });
  assert.equal(n.enabled, false);                                  // solo true booleano abilita
  assert.equal(n.endpoint, 'http://localhost:11434/v1');           // non-stringa → default
  assert.equal(n.model, '');                                       // non-stringa → vuoto
  assert.equal(n.key, 'k');
  assert.ok(!('evil' in n), 'campi sconosciuti scartati');
});

test('scope + features: forma con tutte le chiavi (default ON)', () => {
  const c = ai.getConfig();
  for (const k of ai.SCOPE_KEYS) assert.equal(typeof c.scope[k], 'boolean', 'scope.' + k);
  for (const k of ai.FEATURE_KEYS) assert.equal(typeof c.features[k], 'boolean', 'features.' + k);
});

test('setConfig: scope/features parziali → merge per-chiave (le altre restano ON)', () => {
  const m = ai.setConfig({ scope: { ports: false }, features: { ansible: false } });
  assert.equal(m.scope.ports, false);
  assert.equal(m.scope.devices, true, 'chiave non toccata resta ON');
  assert.equal(m.features.ansible, false);
  assert.equal(m.features.qa, true);
  // persistito
  assert.equal(ai.getConfig().scope.ports, false);
  assert.equal(ai.getConfig().features.ansible, false);
});

test('_normFlags: default ON, solo false spegne, chiavi ignote scartate', () => {
  const f = ai._normFlags({ ports: false, bogus: true }, ai.SCOPE_KEYS);
  assert.equal(f.ports, false);
  assert.equal(f.devices, true);
  assert.ok(!('bogus' in f), 'chiave sconosciuta scartata');
});

test('getConfigWithKey: include scope/features (server-side)', () => {
  const full = ai.getConfigWithKey();
  assert.equal(typeof full.scope.ports, 'boolean');
  assert.equal(typeof full.features.ansible, 'boolean');
});

test('permessi file: la config e ristretta a 0o600 (chiave non leggibile da altri utenti)', () => {
  ai.setConfig({ enabled: true, key: 'sk-PERM-TEST' });
  assert.ok(fs.existsSync(CFG), 'il file di config esiste dopo setConfig');
  if (process.platform === 'win32') {
    // NTFS non ha permessi POSIX: chmod e un no-op → verifichiamo solo che il write
    // sia andato a buon fine e che _hardenPerms non lanci (best-effort su Windows).
    assert.doesNotThrow(() => ai._hardenPerms(CFG));
  } else {
    const mode = fs.statSync(CFG).mode & 0o777;
    assert.equal(mode, 0o600, 'solo owner r/w (0o600): niente permessi per group/other');
  }
});

test('_hardenPerms: best-effort, non lancia su file inesistente', () => {
  assert.doesNotThrow(() => ai._hardenPerms(path.join(TMP, 'nope-non-esiste.json')));
});
