'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// Cosa NON è sorgente del prodotto. Stesse esclusioni di eslint.config.js, e per lo stesso
// motivo: un worktree o una cache non sono codice nostro, e contarli fa OSCILLARE il numero
// stampato in fondo (1392 → 1379 fra una sessione e l'altra, senza che il prodotto cambi di
// una riga) finché non sembra un invariante, che invece non è.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'backup_reset',
  '.worktrees',   // git worktree locali: copie di sorgenti già viste, con un dist proprio
  '_local',       // workspace privato (repo git A PARTE, gitignorato qui): note, banco, marketing
]);

// Percorsi relativi alla radice, non nomi. Qui i worktree li mette Claude Code (455 file .js,
// tutti copie). `.claude/` NON è saltata per intero: se un domani ci finisce uno script nostro,
// il cancello deve vederlo.
const SKIP_PATHS = new Set([path.join('.claude', 'worktrees')]);

function collectJsFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PATHS.has(path.relative(ROOT, path.join(dir, entry.name)))) continue;
      collectJsFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.js')) continue;
    out.push(path.join(dir, entry.name));
  }
  return out;
}

// L'ELENCO dei sorgenti del prodotto, separato dal parse. Serve a due chiamanti:
// questo script (che li passa tutti a `node -c`, ~38 s) e il cancello che tiene
// onesto il numero stampato nel README (test/readme-numeri-misurati.test.js), a
// cui serve solo CONTARLI — una camminata di millisecondi.
// ⚠️ Separati apposta: un cancello che dovesse rifare i 546 spawn costerebbe piu'
// dell'intera suite, e un cancello caro e' un cancello che qualcuno spegne. Ma la
// regola su COSA e' sorgente resta UNA, qui: duplicarla nel test vorrebbe dire che
// il numero sorvegliato e quello stampato possono divergere in silenzio, che e'
// esattamente il difetto da cui nasce questo cancello.
function sourceFiles() {
  return collectJsFiles(ROOT)
    .sort((a, b) => a.localeCompare(b))
    .map(file => path.relative(ROOT, file));
}

if (require.main === module) {
  const files = sourceFiles();
  let failed = false;
  for (const file of files) {
    const res = spawnSync(process.execPath, ['-c', file], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (res.status !== 0) {
      failed = true;
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
    }
  }

  if (failed) process.exit(1);

  console.log(`Syntax OK: ${files.length} file`);
}

module.exports = { collectJsFiles, sourceFiles, ROOT, SKIP_DIRS, SKIP_PATHS };
