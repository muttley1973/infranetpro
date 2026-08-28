'use strict';
// ============================================================
// GUARDIA — nessun sorgente fuori da TUTTI i cancelli.
//
// Il repo ha tre cancelli sui sorgenti, e nessuno dei primi due vede un `.ts`:
//   · `npx eslint .`        → aggancia solo `**/*.js` (un `.ts` esce con
//                             «File ignored because no matching configuration»,
//                             cioè in SILENZIO, senza fallire);
//   · `npm run check`       → `tools/check-syntax.js` filtra `.endsWith('.js')`;
//   · `npx tsc -p tsconfig` → vede SOLO i file elencati in `include`.
//
// Quindi un `lib/*.ts` dimenticato fuori da `include` non è controllato da
// NESSUNO: compila, gira, e nessun cancello si accorge di niente. È esattamente
// la forma di guasto che questo progetto paga più cara — un buco che non si
// vede finché non si vede a schermo.
//
// Questa guardia costa una volta e spegne quel costo per sempre. Se un giorno
// arriva `typescript-eslint` (oggi non c'è, e per un modulo puro `tsc` copre già
// `no-undef` e le variabili inutilizzate meglio di ESLint), questa resta valida.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// `include` non è JSON puro (il tsconfig ha una chiave "//" di commento, che è
// JSON valido): si legge com'è, senza dipendenze.
const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'));
const included = new Set((tsconfig.include || []).map(p => p.replace(/\\/g, '/')));

const tsFiles = fs.readdirSync(path.join(ROOT, 'lib'))
  .filter(f => f.endsWith('.ts'))
  .map(f => 'lib/' + f)
  .sort();

test('ogni lib/*.ts è nel tsconfig — altrimenti non lo controlla NESSUN cancello', () => {
  const orfani = tsFiles.filter(f => !included.has(f));
  assert.deepStrictEqual(orfani, [],
    'questi .ts non sono in tsconfig.json → eslint li ignora, check-syntax pure, e tsc non li vede:\n  '
    + orfani.join('\n  ') + '\nAggiungili a "include".');
});

test('il tsconfig non elenca file che non esistono più', () => {
  const fantasmi = [...included].filter(p => !fs.existsSync(path.join(ROOT, p)));
  assert.deepStrictEqual(fantasmi, [],
    'voci di "include" senza file sul disco (rinominato o cancellato?):\n  ' + fantasmi.join('\n  '));
});

test('il primo .ts vero del repo è agganciato (sanity: la guardia guarda qualcosa)', () => {
  // Se un giorno i .ts sparissero tutti, i due test sopra passerebbero a vuoto.
  assert.ok(tsFiles.length >= 2, `attesi almeno 2 file .ts sotto lib/, trovati: ${tsFiles.join(', ')}`);
  assert.ok(tsFiles.includes('lib/provenance.ts'));
});
