'use strict';
// Test della validazione PURA del puntatore backup (lib/backup-ref.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBackupRef, BACKUP_REF_MAX_LEN } = require('../lib/backup-ref.js');

test('accetta path/URL/repo leciti (con trim)', () => {
  for (const ref of [
    '\\\\nas\\configs\\sw-core',
    'smb://backupsrv/net/configs/',
    '/var/backups/network/',
    'git@github.com:org/net-configs.git',           // user@ SENZA password → lecito
    'https://oxidized.local/node/SW-CORE',
    'rancid:configs/core',
  ]) {
    const r = validateBackupRef('  ' + ref + '  ');
    assert.equal(r.ok, true, ref);
    assert.equal(r.value, ref);
  }
});

test('vuoto è lecito (cancella il campo)', () => {
  assert.deepEqual(validateBackupRef(''), { ok: true, reason: '', value: '' });
  assert.deepEqual(validateBackupRef('   '), { ok: true, reason: '', value: '' });
  assert.deepEqual(validateBackupRef(null), { ok: true, reason: '', value: '' });
});

test('🔒 RIFIUTA credenziali embedded nell\'URL, e NON restituisce il segreto', () => {
  for (const bad of [
    'ftp://admin:s3cr3t@10.0.0.9/configs',
    'https://user:pass@backup.local/net',
    'scp://root:toor@host/path',
  ]) {
    const r = validateBackupRef(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, 'credentials', bad);
    assert.equal(r.value, '', 'il valore con credenziali NON deve essere persistito');
  }
});

test('🔒 rifiuta caratteri di controllo/newline (anti YAML-injection), ripulendo il valore', () => {
  const withNl = 'smb://host/path' + String.fromCharCode(10) + 'malicious: true';
  const r = validateBackupRef(withNl);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'charset');
  assert.ok(r.value.indexOf(String.fromCharCode(10)) < 0, 'il newline è stato tolto dal valore ripulito');
});

test('cap di lunghezza', () => {
  const long = 'x'.repeat(BACKUP_REF_MAX_LEN + 50);
  const r = validateBackupRef(long);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'tooLong');
  assert.equal(r.value.length, BACKUP_REF_MAX_LEN);
});
