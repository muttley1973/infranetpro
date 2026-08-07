// Test del secret-store DCIM (server/dcim-config.js). File di config ISOLATO
// (env impostato PRIMA del require, come ai-config/projects). Verifica: il token
// non torna mai al browser, precedenza env, '' cancella, undefined mantiene,
// normalizzazione difensiva.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-dcimcfg-'));
process.env.INFRANET_DCIM_CONFIG_FILE = path.join(TMP, 'dcim-config.json');
delete process.env.INFRANET_DCIM_URL;
delete process.env.INFRANET_DCIM_TOKEN;

const cfg = require('../server/dcim-config');

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

test('default: niente url/token, verifyTls ON, adapter netbox', () => {
  const m = cfg.getConfig();
  assert.equal(m.urlSet, false);
  assert.equal(m.tokenSet, false);
  assert.equal(m.verifyTls, true);
  assert.equal(m.adapter, 'netbox');
  assert.equal('token' in m, false, 'la forma mascherata non deve contenere il token');
});

test('setConfig persiste url/token/tls e la maschera non espone il token', () => {
  const m = cfg.setConfig({ url: 'https://netbox.local/', token: 'SEG-RE-TO', verifyTls: false });
  assert.equal(m.url, 'https://netbox.local');   // trailing slash tollerato/trim
  assert.equal(m.urlSet, true);
  assert.equal(m.tokenSet, true);
  assert.equal(m.verifyTls, false);
  assert.equal('token' in m, false);
  // il token in chiaro esce SOLO dal getter server-side
  assert.equal(cfg.getConfigWithToken().token, 'SEG-RE-TO');
  // e non deve comparire nel file serializzato mascherato… (il file su disco lo
  // contiene per forza: è la fonte; ma la maschera no — già verificato sopra)
  const onDisk = JSON.parse(fs.readFileSync(cfg.CONFIG_FILE, 'utf8'));
  assert.equal(onDisk.token, 'SEG-RE-TO');
});

test("token undefined mantiene, '' cancella", () => {
  cfg.setConfig({ url: 'https://nb.local', token: 'KEEPME' });
  cfg.setConfig({ url: 'https://nb2.local' });          // niente token nel patch
  assert.equal(cfg.getConfigWithToken().token, 'KEEPME');
  assert.equal(cfg.getConfigWithToken().url, 'https://nb2.local');
  cfg.setConfig({ token: '' });                          // cancella
  assert.equal(cfg.getConfig().tokenSet, false);
  assert.equal(cfg.getConfigWithToken().token, '');
});

test('env INFRANET_DCIM_TOKEN/URL hanno precedenza sul disco', () => {
  cfg.setConfig({ url: 'https://disk.local', token: 'DISK' });
  process.env.INFRANET_DCIM_TOKEN = 'FROMENV';
  process.env.INFRANET_DCIM_URL = 'https://env.local';
  try {
    const m = cfg.getConfig();
    assert.equal(m.tokenFromEnv, true);
    assert.equal(m.tokenSet, true);
    assert.equal(m.urlFromEnv, true);
    assert.equal(m.url, 'https://env.local');
    assert.equal(cfg.getConfigWithToken().token, 'FROMENV');
    assert.equal(cfg.getConfigWithToken().url, 'https://env.local');
  } finally {
    delete process.env.INFRANET_DCIM_TOKEN;
    delete process.env.INFRANET_DCIM_URL;
  }
});

test('_normalize difende da input spazzatura', () => {
  const n = cfg._normalize({ url: 42, token: {}, verifyTls: 'yes', adapter: 'zabbix' });
  assert.equal(n.url, '');
  assert.equal(n.token, '');
  assert.equal(n.verifyTls, true);          // solo un esplicito false disattiva
  assert.equal(n.adapter, 'netbox');        // adapter sconosciuto → default
  assert.equal(cfg._normalize({ verifyTls: false }).verifyTls, false);
});
