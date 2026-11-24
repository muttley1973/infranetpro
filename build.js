'use strict';
// ============================================================
// Build del frontend con esbuild — bundle dei moduli glue ESM (src/) in un
// unico artefatto IIFE (dist/app.bundle.js) servito dal server. I moduli puri
// (lib/*.js, UMD-lite) sono importati come CJS da esbuild SENZA modifiche: i
// loro test Node con require() restano identici.
//
// Migrazione "strangler": i file glue ancora-classic restano <script> in
// netmapper.html; man mano che vengono convertiti a ESM entrano in src/ e
// nel bundle (vedi src/main.js). dist/ è un artefatto: non si committa.
//
//   node build.js            build una volta
//   node build.js --watch    ricostruisce a ogni salvataggio (dev)
//
//   INFRANET_BUILD_OUTFILE=<file>   scrive il bundle (e la sua .map) altrove invece che in dist/.
//   Serve a chi vuole UN bundle fresco senza toccare quello che gli altri leggono: esbuild riscrive il
//   file sul posto (lo svuota, poi lo riempie) e un lettore che arriva in mezzo lo vede VUOTO o a metà —
//   `test/bundle-architecture.test.js` lo faceva mentre `node --test` lanciava gli altri file in parallelo,
//   e la CI del 24/11 cadde su «_buildDefaultState is not defined».
// ============================================================
const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');
const outfile = process.env.INFRANET_BUILD_OUTFILE
  ? path.resolve(process.env.INFRANET_BUILD_OUTFILE)
  : path.join(__dirname, 'dist', 'app.bundle.js');

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: [path.join(__dirname, 'src', 'main.js')],
  bundle: true,
  outfile,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('[build] watch su src/ attivo …');
  } else {
    await esbuild.build(opts);
    console.log('[build] ' + (process.env.INFRANET_BUILD_OUTFILE ? outfile : 'dist/app.bundle.js') + ' scritto');
  }
})().catch(() => process.exit(1));
