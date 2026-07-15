'use strict';
// ============================================================
// AUTH — store utenti + inizializzazione admin (test unit, F16).
// Il modulo più sensibile del repo era a copertura ZERO. Qui: round-trip
// load/save, i tre esiti di _readUsersFile (assente / valido / corrotto),
// recupero dal .bak, e la guardia CARDINE di ensureDefaultAdmin (file corrotto
// → NON rigenera l'admin, per non cancellare in silenzio tutti gli account).
// File ISOLATO: INFRANET_USERS_FILE su dir temp PRIMA del require (node --test
// esegue ogni file in un processo dedicato).
const { test, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-auth-'));
const UF  = path.join(TMP, 'users.json');
process.env.INFRANET_USERS_FILE = UF;
process.env.SESSION_SECRET = 'test';          // evita di scrivere .session-secret sul repo
delete process.env.INFRANET_DEV_NO_AUTH;

const auth = require('../auth.js');

function clean() { for (const f of [UF, UF + '.bak']) { try { fs.unlinkSync(f); } catch (_) { /* assente */ } } }
afterEach(clean);
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('_readUsersFile: file assente → { ok:false, absent:true } (primo avvio)', () => {
  clean();
  const r = auth._readUsersFile();
  assert.equal(r.ok, false);
  assert.equal(r.absent, true);
});

test('saveUsers/loadUsers: round-trip', () => {
  auth.saveUsers([{ id: 1, username: 'alice', role: 'admin' }]);
  assert.deepEqual(auth.loadUsers().map(u => u.username), ['alice']);
});

test('_readUsersFile: file corrotto (non-array) → { ok:false, absent:false }', () => {
  fs.writeFileSync(UF, '{ questo non e un array');
  const r = auth._readUsersFile();
  assert.equal(r.ok, false);
  assert.equal(r.absent, false, 'presente ma corrotto ≠ assente');
});

test('_readUsersFile: recupero dal .bak quando il main è corrotto', () => {
  fs.writeFileSync(UF + '.bak', JSON.stringify([{ id: 9, username: 'frombak', role: 'admin' }]));
  fs.writeFileSync(UF, 'SPAZZATURA');
  const r = auth._readUsersFile();
  assert.equal(r.ok, true);
  assert.equal(r.users[0].username, 'frombak');
});

test('ensureDefaultAdmin: file assente → crea admin con password bcrypt', () => {
  clean();
  auth.ensureDefaultAdmin();
  const u = auth.loadUsers();
  assert.equal(u.length, 1);
  assert.equal(u[0].username, 'admin');
  assert.equal(u[0].role, 'admin');
  assert.ok(/^\$2[aby]\$/.test(u[0].passwordHash || ''), 'password hashata con bcrypt, mai in chiaro');
});

test('ensureDefaultAdmin: store già inizializzato → NON sovrascrive', () => {
  auth.saveUsers([{ id: 1, username: 'existing', passwordHash: '$2a$04$abcabcabcabcabcabcabcuKq', role: 'admin' }]);
  auth.ensureDefaultAdmin();
  assert.equal(auth.loadUsers()[0].username, 'existing', 'admin esistente non rigenerato');
});

test('ensureDefaultAdmin: file CORROTTO → throw, NON rigenera (no perdita account) [F1]', () => {
  fs.writeFileSync(UF, 'CORROTTO{');
  assert.throws(() => auth.ensureDefaultAdmin(), /corrupt|refusing/i);
  // il file resta com'era: NON sovrascritto con un admin fresco
  assert.equal(fs.readFileSync(UF, 'utf8'), 'CORROTTO{');
});
