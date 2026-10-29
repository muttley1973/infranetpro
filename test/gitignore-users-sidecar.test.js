'use strict';
// ============================================================
// test/gitignore-users-sidecar.test.js — i file di fianco a users.json restano fuori da git.
//
// Il difetto: `.gitignore` copriva `users.json` ma NON il `users.json.bak` che
// `atomicWriteFile` scrive di fianco a ogni salvataggio. Quel `.bak` e' il file di
// PRIMA: contiene gli hash bcrypt precedenti degli admin, e dopo ogni cambio password
// compare in `git status` come `?? users.json.bak` — un `git add -A` distratto lo
// pubblicava su un repo pubblico. La stessa classe era gia' stata chiusa per i token
// API (`api-tokens.json*`); qui mancava la prova che lo tenesse chiuso.
//
// ⚠️ I NOMI dei file di fianco NON si scrivono qui a mano: si chiedono alla scrittura
// VERA. Se `atomicWriteFile` cambiasse il suffisso del temporaneo (e' gia' cambiato:
// da `<file>.<pid>.tmp` a `<file>.<pid>.<n>.tmp`), una lista ricopiata resterebbe
// verde su un nome che nessuno scrive piu' — l'ELENCO nel test e quello nel codice
// divergerebbero in silenzio. Qui il temporaneo e' quello che il codice produce ORA.
//
// L'ambiente isolato va messo PRIMA del require: `projects-store` crea la cartella dei
// progetti al caricamento, e non deve essere quella vera.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-gitignore-'));
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');

const { atomicWriteFile } = require('../server/projects-store.js');

const ROOT = path.join(__dirname, '..');

// Cosa lascia `atomicWriteFile` di fianco a `users.json`: il `.bak` (dal secondo
// salvataggio in poi) e il temporaneo (visibile solo se la scrittura si interrompe
// prima del rename: se ne intercetta il rename, che e' proprio il caso del crash).
function sidecarNames() {
  const dir = fs.mkdtempSync(path.join(TMP, 'w-'));
  const file = path.join(dir, 'users.json');
  atomicWriteFile(file, '[{"v":1}]');
  atomicWriteFile(file, '[{"v":2}]');   // il secondo salvataggio mette da parte il primo → .bak

  let tmp = null;
  const rename = fs.renameSync;
  fs.renameSync = (from) => { tmp = path.basename(from); throw new Error('crash simulato prima del rename'); };
  try { atomicWriteFile(file, '[{"v":3}]'); } catch (_) { /* atteso */ } finally { fs.renameSync = rename; }

  const bak = fs.readdirSync(dir).filter((n) => n !== 'users.json');
  return { bak, tmp };
}

// Quali di questi nomi `.gitignore` ignora. `--no-index`: conta la regola, non il
// fatto che il file sia (o non sia) tracciato. Exit 1 = nessuno ignorato, non un errore.
function ignorati(nomi) {
  const r = spawnSync('git', ['check-ignore', '--no-index', '--', ...nomi], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, 'git check-ignore e\' fallito: ' + (r.stderr || r.error));
  return new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
}

test('users.json e i file di fianco scritti da atomicWriteFile sono ignorati da git', () => {
  const { bak, tmp } = sidecarNames();

  // ⚠️ Se non trova i file di fianco la prova non controlla piu' nulla: deve arrossire,
  // non passare a vuoto (e' la trappola di ogni guardia che enumera).
  assert.deepEqual(bak, ['users.json.bak'], 'atomicWriteFile non lascia piu\' solo users.json.bak di fianco: ' + bak.join(', '));
  assert.ok(tmp && tmp.startsWith('users.json.') && tmp.endsWith('.tmp'),
    'il temporaneo di atomicWriteFile non ha piu\' la forma users.json.<...>.tmp: ' + tmp);

  const attesi = ['users.json', ...bak, tmp];
  const ok = ignorati(attesi);
  const fuori = attesi.filter((n) => !ok.has(n));
  assert.deepEqual(fuori, [],
    'questi file di fianco a users.json NON sono in .gitignore: ' + fuori.join(', ') + '. '
    + 'Il .bak tiene gli hash bcrypt PRECEDENTI degli admin: un `git add -A` lo pubblicherebbe.');
});

test('il controllo distingue: un file del prodotto non risulta ignorato', () => {
  // Controprova: senza questa, un `git check-ignore` che rispondesse sempre «ignorato»
  // (o una regola `*` per sbaglio) farebbe passare la prova qui sopra.
  const set = ignorati(['package.json', 'auth.js', 'users.json']);
  assert.ok(set.has('users.json'));
  assert.ok(!set.has('package.json') && !set.has('auth.js'), 'check-ignore dice «ignorato» anche per i sorgenti: la prova non distingue piu\'');
});
