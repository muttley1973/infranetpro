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
// ============================================================
const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: [path.join(__dirname, 'src', 'main.js')],
  bundle: true,
  outfile: path.join(__dirname, 'dist', 'app.bundle.js'),
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
    console.log('[build] dist/app.bundle.js scritto');
  }
})().catch(() => process.exit(1));
