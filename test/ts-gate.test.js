'use strict';
// ============================================================
// GUARDIA — nessun sorgente TypeScript sotto lib/, e nessun file fantasma nel tsconfig.
//
// ⚠️ Questa guardia è nata il 28/08/2026 con la premessa SBAGLIATA. Diceva: «ogni
// `lib/*.ts` dev'essere nel tsconfig, altrimenti non lo controlla nessun cancello».
// Vero, ma minore. Il problema vero, scoperto poche ore dopo, è che **un sorgente
// `.ts` non può proprio esistere qui**:
//
//   · `package.json` dichiara `engines: { node: ">=16.0.0" }` — è un prodotto
//     self-hosted, gira su macchine altrui;
//   · la CI gira su **Node 18.x e 20.x** (`.github/workflows/ci.yml`);
//   · il type-stripping nativo di Node esiste solo da **22.18**;
//   · e il loader CommonJS conosce SOLO `.js`, `.json`, `.node`: un'estensione
//     ignota finisce al gestore `.js`, quindi un `.ts` viene letto come JavaScript
//     e i tipi sono un **SyntaxError**.
//
// Cioè: `require('../lib/provenance.ts')` girava sul Node 24 locale e si sarebbe
// spaccato in CI. Avere verificato lo strumento (funziona!) senza verificare
// *dove deve girare* è esattamente l'errore che questa guardia adesso impedisce.
//
// I tipi non si perdono: vivono come `@typedef` JSDoc e `tsc -p tsconfig.json`
// li controlla identici via `checkJs` (i moduli sono nella lista `include`). In
// più un `.js` è coperto anche da ESLint e da `npm run check`, che un `.ts` non
// erano. Non si è rinunciato a niente se non all'estensione.
//
// `lib/types.d.ts` è l'eccezione legittima: una dichiarazione ambient, nessun
// runtime, nessuno la `require()`.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Il tsconfig ha una chiave "//" di commento: è JSON valido, si legge com'è.
const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'));
const included = new Set((tsconfig.include || []).map(p => p.replace(/\\/g, '/')));

const libFiles = fs.readdirSync(path.join(ROOT, 'lib'));

test('⭐ nessun sorgente .ts sotto lib/ — il prodotto gira anche su Node 16/18/20', () => {
  const ts = libFiles.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort();
  assert.deepStrictEqual(ts, [],
    'questi sono sorgenti TypeScript, e Node < 22.18 li legge come JavaScript (SyntaxError):\n  '
    + ts.join('\n  ')
    + '\nConvertili in .js con tipi @typedef JSDoc: tsc li controlla lo stesso, e in più'
    + '\nli coprono ESLint e `npm run check`.');
});

test('la premessa della guardia è ancora vera: engines dichiara un Node < 22.18', () => {
  // Se un giorno il prodotto alzasse il minimo a >=22.18 (o superiore), il divieto
  // qui sopra si potrebbe togliere — ma sarebbe una DECISIONE di prodotto, non un
  // effetto collaterale. Questo test è il posto dove verrebbe a bussare.
  const min = String((pkg.engines && pkg.engines.node) || '');
  const m = min.match(/(\d+)/);
  assert.ok(m, `package.json engines.node illeggibile: «${min}»`);
  assert.ok(Number(m[1]) < 22,
    `engines.node è «${min}»: se il minimo è ormai ≥ 22.18, rivedi questa guardia con intenzione.`);
});

test('il tsconfig non elenca file che non esistono più', () => {
  const fantasmi = [...included].filter(p => !fs.existsSync(path.join(ROOT, p)));
  assert.deepStrictEqual(fantasmi, [],
    'voci di "include" senza file sul disco (rinominato o cancellato?):\n  ' + fantasmi.join('\n  '));
});

test('i moduli nuovi sono type-checkati: stanno nella lista include del tsconfig', () => {
  // Il valore dei tipi non dipende dall'estensione, ma dal fatto che `tsc` li guardi.
  for (const f of ['lib/provenance.js', 'lib/inter-site.js', 'lib/inter-site-audit.js',
    'lib/project-schema.js', 'lib/types.d.ts']) {
    assert.ok(included.has(f), `${f} non è nel tsconfig: i suoi @typedef non li controlla nessuno`);
  }
});

test('ogni lib/*.js è JavaScript valido letto senza type-stripping', () => {
  // È ciò che fa `npm run check` (`node -c` su ogni .js) — ripetuto qui perché è
  // la condizione ESATTA che la CI su Node 18/20 impone, ed è il motivo del divieto
  // qui sopra: se un file avesse sintassi TS, questo test lo trova subito.
  const { execFileSync } = require('node:child_process');
  const rotti = [];
  for (const f of libFiles.filter(f => f.endsWith('.js'))) {
    try { execFileSync(process.execPath, ['--check', path.join(ROOT, 'lib', f)], { stdio: 'pipe' }); }
    catch (_) { rotti.push(f); }
  }
  assert.deepStrictEqual(rotti, [], 'file che non parsano come JavaScript puro:\n  ' + rotti.join('\n  '));
});
