// ============================================================
// ESLint flat config — InfraNet Pro
//
// Obiettivo PRIMARIO: `no-undef` come rete di sicurezza contro riferimenti a
// funzioni/variabili inesistenti (typo, rinomini, dead-ref). Il valore è massimo
// dove il sistema di moduli è ESPLICITO:
//   • Node CommonJS  → server/ tools/ scripts/ drivers/ engine/ plugins/ test/…
//   • lib/ (UMD puri) → factory che ritorna un oggetto, niente soup di globali
// Su src/ (bundle ESM) il pattern "ponte window + sloppy mode" fa risolvere i
// nomi bare a `window` tra moduli: lì `no-undef` non è ancora praticabile senza
// l'allowlist completa dei globali esposti, quindi è SPENTO per ora (si riaccende
// quando l'epic "ritiro ponte window → import/export" sarà fatto).
// Tutte le altre regole restano attive ovunque.
//
// Repo CommonJS di default (package.json senza "type") → questo file è CJS.
// ============================================================
const js = require('@eslint/js');
const globals = require('globals');

// 'globals' espone chiavi con spazi di troppo in alcune versioni: normalizzo.
const trim = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.trim(), v]));
const browser = trim(globals.browser);
const node = trim(globals.node);

module.exports = [
  // ----- 1) Cosa NON guardare ----------------------------------------------
  {
    ignores: [
      'node_modules/**', 'dist/**', 'projects/**', 'data/**',
      'backup_reset/**', 'vendor/**', 'docs/**', 'skins/**', 'coverage/**',
      'tools/snmp-sim/**', // regola di progetto: mai toccare
      '**/*.min.js',
    ],
  },

  // ----- 2) Regole raccomandate ovunque ------------------------------------
  js.configs.recommended,

  // ----- 3) Default di parsing: Node CommonJS ------------------------------
  // Rete di sicurezza: ogni .js non coperto da un blocco più specifico viene
  // letto come CommonJS (il default del repo), così niente flood da sourceType
  // sbagliato. I blocchi successivi sovrascrivono per le aree speciali.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...node },
    },
  },

  // ----- 4) lib/ — UMD puri (browser + module/self) ------------------------
  {
    files: ['lib/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...browser,
        module: 'writable',
        exports: 'writable',
        define: 'readonly',
        globalThis: 'readonly',
        t: 'readonly', // i18n: alcuni lib risolvono t() globale a call-time (guardato da typeof), fallback in Node
      },
    },
  },

  // ----- 5) export.js — client classic che legge i globali del bundle ------
  // Usa decine di funzioni di app.js via window: no-undef qui sarebbe rumore.
  {
    files: ['export.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...browser } },
    rules: { 'no-undef': 'off' },
  },

  // ----- 6) src/ — bundle ESM (ponte window/sloppy) ------------------------
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...browser } },
    rules: { 'no-undef': 'off' }, // riaccendere dopo il ritiro del ponte window
  },

  // ----- 6b) test/e2e — mix Node (Playwright) + browser (page.evaluate) ----
  // I corpi passati a page.evaluate() girano NEL BROWSER e leggono i globali
  // vivi della pagina (state, nodeById, …) che ESLint-lato-Node non può
  // conoscere: no-undef qui è solo rumore. Le altre regole restano attive.
  {
    files: ['test/e2e/**/*.test.js'],
    languageOptions: { globals: { ...node, ...browser } },
    rules: { 'no-undef': 'off' },
  },

  // ----- 7) Affinamenti di rumore (tutti i file) ---------------------------
  {
    rules: {
      // Il codebase usa intenzionalmente try{}catch(_){} e variabili _-prefissate.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // Regole cosmetiche/opinionate di "recommended": utili ma non bloccanti al
      // primo giro. Tenute a WARN per burn-down incrementale, non come gate rosso.
      // (no-useless-escape: escape ridondanti ma corretti — ESLint lo dà come
      //  suggestion, non autofix, perché togliere \- in [..] può creare un range.)
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      'no-useless-escape': 'warn',
    },
  },
];
