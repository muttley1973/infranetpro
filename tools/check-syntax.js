'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// ⚠️ SORGENTE DEL PRODOTTO = QUELLO CHE GIT TRACCIA. Non è una finezza: fino al
// 12/09 questo script camminava le cartelle e saltava un elenco di nomi, e così
// contava 548 file sulla macchina di chi sviluppa e 520 in CI — perché su disco
// ci sono anche il modulo governance (repo separato), i driver DHCP a pagamento,
// i generatori di reti di prova e il bundle. Il numero non era una proprietà del
// PRODOTTO, era una proprietà del DISCO, e per mesi il README ne ha stampata una
// versione qualsiasi delle due.
// L'ha scoperto il cancello che confronta quel numero col README — in CI, su un
// commit già taggato, che è il posto peggiore. La lezione non è «il cancello era
// sbagliato»: è che un numero misurato va misurato su qualcosa che non cambia da
// una macchina all'altra, e per un progetto pubblico quella cosa è l'elenco dei
// file tracciati.
// ⚠️ Il bundle `dist/app.bundle.js` esce dal conteggio: è un PRODOTTO del build,
// non un sorgente — e lo verifica già esbuild, che su un errore di sintassi non
// scrive niente, più l'e2e che lo carica in un browser vero.
function trackedJsFiles() {
  const out = spawnSync('git', ['ls-files', '-z', '*.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (out.status !== 0 || !out.stdout) return null;   // niente git → si ricade sulla camminata
  return out.stdout.split('\0').filter(Boolean).map((f) => f.split('/').join(path.sep));
}
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
  const tracciati = trackedJsFiles();
  if (tracciati) return tracciati.sort((a, b) => a.localeCompare(b));
  // Ripiego: fuori da un checkout git si cammina, com'era prima. ⚠️ È un RIPIEGO
  // dichiarato, non un secondo modo di dire la stessa cosa: qui il numero torna a
  // dipendere da cosa c'è sul disco, quindi chi lo usa per confrontarlo col README
  // deve sapere che senza git quel confronto non vale.
  return collectJsFiles(ROOT)
    .sort((a, b) => a.localeCompare(b))
    .map((file) => path.relative(ROOT, file));
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
