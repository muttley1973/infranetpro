// Test per server/api-tokens.js — store dei token REST API v1.
// Usa un file isolato (INFRANET_API_TOKENS_FILE) impostato PRIMA del require:
// `node --test` esegue ogni file in un processo separato → env-scope sicuro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-tokens-'));
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');

const tokens = require('../server/api-tokens.js');

test('createToken: ritorna il segreto in chiaro UNA volta + vista pubblica senza hash', () => {
  const { token, record } = tokens.createToken('lab pnet');
  assert.ok(token.startsWith('inp_'), 'il token ha il prefisso inp_');
  assert.ok(token.length > 20);
  assert.equal(record.label, 'lab pnet');
  assert.ok(record.prefix.startsWith('inp_'));
  assert.equal(record.hash, undefined, 'la vista pubblica non espone lo hash');
  // a riposo il segreto NON è memorizzato in chiaro, solo lo SHA-256
  const raw = fs.readFileSync(process.env.INFRANET_API_TOKENS_FILE, 'utf8');
  assert.ok(!raw.includes(token), 'il token in chiaro non deve finire su disco');
  assert.ok(raw.includes(tokens._sha256(token)), 'su disco c\'è lo hash');
});

test('verifyToken: valido → record; non valido → null', () => {
  const { token } = tokens.createToken('valido');
  const ok = tokens.verifyToken(token);
  assert.ok(ok, 'token valido riconosciuto');
  assert.equal(ok.label, 'valido');
  assert.equal(tokens.verifyToken('inp_inesistente'), null);
  assert.equal(tokens.verifyToken('senza-prefisso'), null);
  assert.equal(tokens.verifyToken(''), null);
  assert.equal(tokens.verifyToken(null), null);
});

test('verifyToken: aggiorna lastUsedAt', () => {
  const { token, record } = tokens.createToken('uso');
  assert.equal(record.lastUsedAt, null);
  tokens.verifyToken(token);
  const seen = tokens.listTokens().find(t => t.id === record.id);
  assert.ok(seen.lastUsedAt, 'lastUsedAt valorizzato dopo la verifica');
});

test('listTokens: solo viste pubbliche, mai lo hash', () => {
  const list = tokens.listTokens();
  assert.ok(list.length >= 1);
  for (const t of list) {
    assert.equal(t.hash, undefined);
    assert.ok('id' in t && 'label' in t && 'prefix' in t && 'createdAt' in t);
  }
});

test('revokeToken: rimuove e invalida', () => {
  const { token, record } = tokens.createToken('da revocare');
  assert.ok(tokens.verifyToken(token), 'valido prima della revoca');
  assert.equal(tokens.revokeToken(record.id), true);
  assert.equal(tokens.verifyToken(token), null, 'non più valido dopo la revoca');
  assert.equal(tokens.revokeToken(99999), false, 'id inesistente → false');
});

test('id incrementali, due token sono distinti', () => {
  const a = tokens.createToken('a');
  const b = tokens.createToken('b');
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.record.id, b.record.id);
});
