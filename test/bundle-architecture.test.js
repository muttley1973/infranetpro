'use strict';
// ============================================================
// GUARD ARCHITETTURALE DEL BUNDLE (regola del ponte ESM)
// ============================================================
// Blocca alla radice la classe di bug del 2026-06-16: un lib puro già caricato
// come <script> in netmapper.html (i18n, spare-ports, audit-log, …) NON deve
// finire dentro dist/app.bundle.js. Se ci finisse, la sua UMD ri-eseguirebbe
// Object.assign(window,…) e — col bundle caricato per ULTIMO — sovrascriverebbe
// il global "vivo" con uno snapshot congelato al build (es. dizionario i18n
// stantio → chiavi letterali nei menu). I moduli src/ devono leggere quei lib
// dal ponte (win.* / forward in _bridge.js), non importarli da ../lib.
//
// Il test ricostruisce un bundle fresco (build ~15ms) così è deterministico
// anche in locale senza un `npm run build` precedente.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist', 'app.bundle.js');

execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'ignore' });
const bundle = fs.readFileSync(BUNDLE, 'utf8');

// Marker UNIVOCI dell'implementazione di ciascun lib <script> (non delle glue
// che li consumano): se compaiono nel bundle, il lib è stato ri-bundlato.
const FORBIDDEN = [
  { marker: "'common.save'", lib: 'i18n.js (dizionario)' },
  { marker: 'AUDIT_CAP_DEFAULT', lib: 'audit-log.js' },
  { marker: 'MS_PER_DAY', lib: 'discovery-history.js' },
];

test('bundle: i lib <script> non sono ri-bundlati (regola del ponte)', () => {
  for (const { marker, lib } of FORBIDDEN) {
    assert.ok(
      !bundle.includes(marker),
      `${lib} risulta dentro dist/app.bundle.js (marker ${marker}). ` +
      `Un modulo src/ lo importa da ../lib invece di leggerlo dal ponte: ` +
      `vedi la REGOLA in _bridge.js.`
    );
  }
});

test('bundle: contiene davvero i moduli migrati (build non vuota)', () => {
  // Sanity: se il bundle fosse vuoto/rotto, il guard sopra passerebbe a vuoto.
  assert.ok(bundle.includes('expose'), 'il bundle deve contenere il ponte expose()');
  assert.ok(bundle.length > 5000, `bundle troppo piccolo (${bundle.length}B): build rotta?`);
});

// ── Nessun sorgente è BINARIO per git ────────────────────────────────
// ⚠️ Successo davvero (2.8.2, lib/audit-log.js): un byte NUL scritto per sbaglio
// dentro una stringa — al posto della sua sequenza di escape — rende il file
// binario agli occhi di git. Il codice gira, i test passano, eslint tace: ma
// `git diff` dice «Binary files differ», `grep` salta il file e una revisione
// non può leggerlo. Si prende solo guardando i byte.
test('⚠️ nessun sorgente contiene byte di controllo: git li tratterebbe da binari', () => {
  const files = execFileSync('git', ['ls-files', '*.js', '*.json', '*.css', '*.html', '*.md'],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean);
  const bad = [];
  for (const rel of files) {
    let buf;
    try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch (_) { continue; }
    const at = buf.indexOf(0);
    if (at >= 0) bad.push(`${rel} (byte NUL a offset ${at})`);
  }
  assert.deepEqual(bad, [], 'usa la sequenza di escape, non il carattere:\n' + bad.join('\n'));
});
