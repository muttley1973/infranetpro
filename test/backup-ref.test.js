'use strict';
// Test della validazione PURA del puntatore backup (lib/backup-ref.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBackupRef, stripRefCreds, BACKUP_REF_MAX_LEN } = require('../lib/backup-ref.js');

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

test('🔒 i due bypass chiusi: forma scp senza schema e password che contiene "/"', () => {
  for (const bad of [
    'user:pw@host:/path/sw1.cfg',              // scp/rsync: nessuno schema da cui partire
    'backupsvc:p/w@nas.local:/vol/cfg',        // scp + '/' nel segreto
    'https://u:pa/ss@git.example.com/r.git',   // URL + '/' nel segreto
    'ftp://anon:@ftp.example.com/x',           // password vuota: resta una credenziale
  ]) {
    const r = validateBackupRef(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, 'credentials', bad);
    assert.equal(r.value, '');
  }
});

test('🔒 e NON scambia per credenziali i puntatori legittimi che contengono ":" e "@"', () => {
  // Ogni riga qui è un falso positivo che una regex più avida produrrebbe: un
  // salvataggio bloccato su un puntatore valido è un bug quanto un segreto passato.
  for (const good of [
    'git@github.com:org/repo.git',        // SSH shorthand: '@' senza ':' prima
    'user@host:/path/sw1.cfg',            // scp SENZA password
    'https://git.example.com:8443/r.git', // ':' = porta
    'smb://server/share@2024/sw1.cfg',    // '@' dentro il percorso
    'file:///C:/backup@2024/sw1.cfg',     // percorso Windows con '@'
    'C:\\backup\\admin@corp\\sw1.cfg',    // cartella che contiene una '@'
  ]) {
    assert.equal(validateBackupRef(good).ok, true, good);
  }
});

test('🔒 stripRefCreds toglie il segreto e TIENE il puntatore (difesa lato server e nei DTO)', () => {
  assert.equal(stripRefCreds('https://u:pass@git.example.com/r.git'), 'https://git.example.com/r.git');
  assert.equal(stripRefCreds('ssh://admin:S3cr3t@10.0.0.1/cfg'), 'ssh://10.0.0.1/cfg');
  assert.equal(stripRefCreds('user:pw@host:/path/sw1.cfg'), 'host:/path/sw1.cfg');
  // Nessuna credenziale = nessuna modifica (nemmeno una normalizzazione «furba»).
  for (const same of ['git@github.com:org/repo.git', '\\\\nas\\configs\\sw-core', '/var/backups/net/']) {
    assert.equal(stripRefCreds(same), same, same);
  }
  assert.equal(stripRefCreds(null), '');
  // E il risultato non contiene MAI il segreto di partenza.
  assert.ok(!stripRefCreds('https://u:S3cr3t@h/x').includes('S3cr3t'));
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

// ── La regola applicata a metà, secondo giro ───────────────────────────────
// `stripRefCreds` faceva UNA passata: la prima credenziale spariva, le altre no.
// Un puntatore con due URL (un PUT costruito a mano, un progetto importato) usciva
// ancora col segreto — e da lì andava su disco, nel DTO REST, nell'inventory
// Ansible e nel dossier PDF. La proprietà da provare non è che sparisca IL caso
// noto: è che dopo lo strip il validatore non veda PIÙ credenziali, qualunque
// cosa sia entrata. Il validatore è l'autorità su cosa è una credenziale, quindi
// è lui il giudice — non un elenco di stringhe scritto qui.
test('🔒 stripRefCreds toglie TUTTE le credenziali, non solo la prima', () => {
  const due = 'https://u:p@a.example/x https://u2:p2@b.example/y';
  const out = stripRefCreds(due);
  assert.equal(out, 'https://a.example/x https://b.example/y');
  assert.ok(!out.includes('p2'), 'anche il secondo segreto se ne va');
  assert.equal(stripRefCreds('https://a:b@c:d@e/x'), 'https://e/x', 'due @ nello stesso host');
});

test('🔒 PROPRIETÀ: dopo lo strip, il validatore non trova più credenziali', () => {
  const casi = [
    'https://u:p@a/x https://u2:p2@b/y',
    'ssh://a:b@c/x ssh://d:e@f/y',
    'https://a:b@c:d@e/x',
    'user:pw@host:/path/sw1.cfg',
    'https://u:p@git.example.com/r.git',
    // e le forme LECITE devono restare intatte: uno strip che rovina i puntatori
    // buoni non è una difesa, è un guasto.
    'git@github.com:org/repo.git',
    'smb://server/share@2024',
    'C:\backup\admin@corp\sw1.cfg',
    '/var/backups/sw1.cfg',
  ];
  for (const c of casi) {
    const out = stripRefCreds(c);
    const v = validateBackupRef(out);
    assert.notEqual(v.reason, 'credentials', `dopo lo strip «${c}» → «${out}» non deve piu' contenere credenziali`);
  }
  // Le forme lecite escono IDENTICHE (a parte il trim).
  for (const c of ['git@github.com:org/repo.git', 'smb://server/share@2024', 'C:\backup\admin@corp\sw1.cfg', '/var/backups/sw1.cfg']) {
    assert.equal(stripRefCreds(c), c, `«${c}» è un puntatore legittimo e non si tocca`);
  }
});
