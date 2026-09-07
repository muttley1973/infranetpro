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

// ── La scadenza: opzionale, dichiarata, e VERIFICATA ───────────────────────
// Un token che non scade mai, se sfugge (un file di CI, un playbook committato),
// vale per sempre e nessuno se ne accorge. La scadenza è opt-in: senza, il
// comportamento è quello di sempre — i token già mintati non cambiano significato.
test('scadenza: senza expiresInDays il token non scade (comportamento invariato)', () => {
  const { token, record } = tokens.createToken('senza scadenza');
  assert.equal(record.expiresAt, null, 'null = non scade, non «scade oggi»');
  assert.equal(record.expired, false);
  assert.ok(tokens.verifyToken(token));
});

test('scadenza: con expiresInDays il token vale, e la lista dice quando finisce', () => {
  const { token, record } = tokens.createToken('con scadenza', { expiresInDays: 30 });
  assert.ok(record.expiresAt, 'la scadenza si vede nella vista pubblica');
  assert.equal(record.expired, false);
  assert.ok(tokens.verifyToken(token), 'finché non è passata, il token vale');
  const inLista = tokens.listTokens().find(t => t.id === record.id);
  assert.equal(inLista.expiresAt, record.expiresAt);
});

test('scadenza: passata la data il token NON vale più, e il record resta (spiega perché)', () => {
  const { token, record } = tokens.createToken('scaduto');
  // Si riscrive la scadenza NEL PASSATO sullo store: è il solo modo di provare il
  // caso vero senza aspettare, e prova la lettura, non il calcolo della data.
  const tutti = tokens.loadTokens();
  tutti.find(t => t.id === record.id).expiresAt = '2020-01-01 00:00:00';
  tokens.saveTokens(tutti);
  assert.equal(tokens.verifyToken(token), null, 'scaduto = come se non esistesse');
  const inLista = tokens.listTokens().find(t => t.id === record.id);
  assert.ok(inLista, 'ma la riga resta: è ciò che spiega all\'admin perché lo script non entra più');
  assert.equal(inLista.expired, true);
});

test('scadenza: valori assurdi non creano scadenze assurde', () => {
  assert.equal(tokens._expiryFromDays(0), null, '0 = nessuna scadenza');
  assert.equal(tokens._expiryFromDays(-5), null);
  assert.equal(tokens._expiryFromDays('non un numero'), null);
  assert.equal(tokens._expiryFromDays(undefined), null);
  const lontano = tokens._expiryFromDays(999999, Date.UTC(2026, 0, 1));
  const max = tokens._expiryFromDays(tokens.MAX_EXPIRY_DAYS, Date.UTC(2026, 0, 1));
  assert.equal(lontano, max, 'oltre il tetto si ferma al tetto');
});

test('⚠️ gli istanti si leggono come UTC, come li scrive timestamp()', () => {
  // `timestamp()` scrive l'ora UTC senza fuso: riletta come ora LOCALE, su una
  // macchina a UTC+2 ogni nostro istante risulta due ore nel futuro — e una
  // scadenza è una decisione di sicurezza, non un dettaglio di formato.
  assert.equal(tokens._parseTs('2026-01-01 00:00:00'), Date.UTC(2026, 0, 1, 0, 0, 0));
  assert.equal(tokens._parseTs(''), 0);
  assert.equal(tokens._parseTs(null), 0);
  assert.equal(tokens._isExpired({ expiresAt: null }), false, 'nessuna scadenza = mai scaduto');
});
