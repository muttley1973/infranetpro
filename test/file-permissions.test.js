'use strict';
// ============================================================
// I file che portano credenziali sono 0600 — nuovi, vecchi e le loro copie .bak
// ============================================================
// I progetti contengono le credenziali SNMP dei dispositivi (community, utente e password v3),
// `users.json` gli hash delle password, `api-tokens.json` quelli dei token. Con la maschera di
// default (0644) li leggeva ogni utente del sistema: l'API li oscura ai viewer, il file no.
// `.session-secret` e le config AI/DCIM lo erano gia'; questi no.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKIP = process.platform === 'win32' ? 'chmod non ha effetto su Windows' : false;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-perm-'));
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.SESSION_SECRET = 'test';
delete process.env.INFRANET_FILE_MODE;
fs.mkdirSync(process.env.INFRANET_PROJECTS_DIR, { recursive: true });
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ps = require('../server/projects-store.js');
const mode = (f) => fs.statSync(f).mode & 0o777;
const octal = (n) => n.toString(8);

test('_privateMode: 600 di default; si puo\' allargare al gruppo, mai ad "altri"', () => {
  assert.equal(ps.PRIVATE_MODE, 0o600);
  for (const [raw, want] of [['600', 0o600], ['640', 0o640], ['660', 0o660], ['620', 0o620],
                             ['644', 0o600], ['666', 0o600], ['777', 0o600], ['400', 0o600], ['000', 0o600],
                             ['abc', 0o600], ['', 0o600], [undefined, 0o600], ['6000', 0o600], ['60', 0o600], ['0640', 0o600]]) {
    assert.equal(ps._privateMode(raw), want, JSON.stringify(raw));
  }
});

test('un progetto salvato e\' 0600, e lo e\' anche il .bak quando ESISTEVA gia\' con la maschera vecchia', { skip: SKIP }, async () => {
  const id = ps.nextId();
  const file = path.join(ps.PROJECTS_DIR, `${id}.json`);
  // stato di partenza "di prima della regola": progetto e backup 0644
  fs.writeFileSync(file, JSON.stringify({ format: 'infranet-project', id, name: 'v', state: { nodes: [] } }), { mode: 0o644 });
  fs.writeFileSync(file + '.bak', '{"vecchio":true}', { mode: 0o644 });
  fs.chmodSync(file, 0o644); fs.chmodSync(file + '.bak', 0o644);

  await ps.saveProject(id, 'p', { nodes: [{ id: 'sw1', integration: { community: 'SEGRETO' } }], links: [] }, 't', 't');
  assert.equal(octal(mode(file)), '600', 'il progetto');
  assert.equal(octal(mode(file + '.bak')), '600', 'la copia di backup del file di PRIMA');
  // e uno nuovo di zecca
  const id2 = ps.nextId();
  await ps.saveProject(id2, 'q', { nodes: [], links: [] }, 't', 't');
  assert.equal(octal(mode(path.join(ps.PROJECTS_DIR, `${id2}.json`))), '600');
});

test('hardenTree: ristringe i file dei dati in tutta la cartella, non segue i link e non tocca il resto', { skip: SKIP }, () => {
  const dir = path.join(TMP, 'tree');
  fs.mkdirSync(path.join(dir, 'history', '7', 'snaps'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const dati = ['1.json', '1.json.bak', 'history/7/snapshots.jsonl', 'history/7/snaps/a.gz', 'history/7/audit.json'].map((f) => path.join(dir, f));
  const altri = ['assets/planimetria.png', 'leggimi.txt'].map((f) => path.join(dir, f));
  for (const f of [...dati, ...altri]) { fs.writeFileSync(f, 'x'); fs.chmodSync(f, 0o644); }
  // un link verso un file FUORI dalla cartella: non va seguito
  const fuori = path.join(TMP, 'fuori.json');
  fs.writeFileSync(fuori, '{}'); fs.chmodSync(fuori, 0o644);
  fs.symlinkSync(fuori, path.join(dir, 'link.json'));

  assert.equal(ps.hardenTree(dir), dati.length, 'conta i file ristretti');
  for (const f of dati) assert.equal(octal(mode(f)), '600', path.relative(dir, f));
  for (const f of altri) assert.equal(octal(mode(f)), '644', 'non e\' un dato: ' + path.relative(dir, f));
  assert.equal(octal(mode(fuori)), '644', 'il link non e\' stato seguito fuori dalla cartella');
  assert.equal(ps.hardenTree(dir), 0, 'idempotente');
  assert.equal(ps.hardenTree(path.join(TMP, 'non-esiste')), 0, 'una cartella assente non e\' un errore');
});

test('lo storico (snapshot, audit, presenza) nasce 0600', { skip: SKIP }, () => {
  const { createFsHistoryStore } = require('../server/history-store-fs.js');
  const base = path.join(TMP, 'hist');
  const store = createFsHistoryStore({ baseDir: base });
  store.putSnapshot(9, { at: 't', by: 'u', label: 'x', reason: 'r' }, { nodes: [{ id: 'n', integration: { community: 'SEGRETO' } }] });
  store.savePresence(9, { a: 1 });
  store.saveAudit(9, { entries: [{ at: 't', who: 'u', what: 'x' }] });
  store.appendTimeline(9, { at: 't', kind: 'k' });
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
  walk(base);
  assert.ok(files.length >= 4, 'ha scritto snapshot, presenza, audit e timeline: ' + files.length);
  for (const f of files) assert.equal(octal(mode(f)), '600', path.relative(base, f));
});

test('users.json e api-tokens.json (e i .bak) sono 0600', { skip: SKIP }, () => {
  const auth = require('../auth.js');
  const tokens = require('../server/api-tokens.js');
  const uf = auth.USERS_FILE, tf = tokens.TOKENS_FILE;
  assert.equal(uf, process.env.INFRANET_USERS_FILE);
  // partenza "vecchia maschera"
  fs.writeFileSync(uf, '[]'); fs.chmodSync(uf, 0o644);
  fs.writeFileSync(uf + '.bak', '[]'); fs.chmodSync(uf + '.bak', 0o644);
  fs.writeFileSync(tf, '[]'); fs.chmodSync(tf, 0o644);
  fs.writeFileSync(tf + '.bak', '[]'); fs.chmodSync(tf + '.bak', 0o644);

  auth.saveUsers([{ id: 1, username: 'a', passwordHash: 'h', role: 'admin' }]);
  tokens.saveTokens([{ id: 1, name: 't', hash: 'x' }]);
  for (const f of [uf, uf + '.bak', tf, tf + '.bak']) assert.equal(octal(mode(f)), '600', path.basename(f));
});
