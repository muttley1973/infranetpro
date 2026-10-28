'use strict';
// ============================================================
// GUARDIA — «che chiave ha questo MAC» deve restare UNA domanda sola
// ============================================================
// lib/mac-class.js dichiara di essere l'unica definizione (`macKey` per confrontare,
// `macFormat` per mostrare). Era già stata unificata ad agosto — cinque normalizzatori
// che divergevano — e nel frattempo è RICRESCIUTA: quattro copie di «minuscolo e
// tieni solo gli esadecimali», una per lato della mappa IPv6 per MAC (il server la
// produceva, il client la leggeva, ciascuno con la sua) e due per la Panoramica; e la
// versione povera di lib/ai-grounding.js (minuscolo + trattini), che non conosceva la
// forma Cisco e faceva segnalare come INVENTATO un MAC documentato.
//
// Questa guardia non prova un comportamento: prova che la REGOLA non si sia
// duplicata. Chi vuole la chiave di un MAC chiama `macKey`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Chi può togliere i non-esadecimali da una stringa, e perché NON è una chiave MAC.
// Ogni voce deve ancora contenere la forma, o la voce va tolta (sennò l'elenco marcisce).
const AMMESSI = {
  'lib/mac-class.js':        'il proprietario: _hex è la base di macKey / macFormat',
  'lib/neighbor-type.js':    'legge i byte di un chassis-id (esadecimale → byte), non confronta MAC',
  'src/app-util.js':         'normalizeMacAddress: normalizza l\'INPUT dell\'utente senza cancellargli ciò che ha scritto (eccezione dichiarata in mac-class)',
  'engine/fusion-scorer.js': 'formatta anche un PREFISSO di MAC (3 ottetti) per le regole OUI del classificatore: macFormat lo rifiuterebbe',
  'engine/oui-engine.js':    'chiave di ricerca per PREFISSO OUI (tronca a 12 cifre), non l\'identità di un apparato',
};

/** I sorgenti che compongono l'app (no dist/, no node_modules, no test). */
function sorgenti() {
  const out = [];
  const giro = (rel) => {
    for (const nome of fs.readdirSync(path.join(ROOT, rel))) {
      const r = rel + '/' + nome;
      const st = fs.statSync(path.join(ROOT, r));
      if (st.isDirectory()) giro(r);
      else if (nome.endsWith('.js')) out.push(r);
    }
  };
  for (const d of ['src', 'lib', 'server', 'drivers', 'engine']) giro(d);
  out.push('export.js');
  return out;
}

// «.replace(/[^0-9a-f]/g, '')» in qualunque ordine e maiuscola della classe.
const FORMA = /\.replace\(\s*\/\[\^(?:0-9a-fA-F|0-9A-Fa-f|a-fA-F0-9|A-Fa-f0-9|0-9a-f|a-f0-9|0-9A-F|A-F0-9)\]\/g?i?/;

test('chiave MAC: nessuno riscrive «tieni solo gli esadecimali» per conto suo', () => {
  const files = sorgenti();
  assert.ok(files.length > 150, `corpus troppo piccolo (${files.length} file): la guardia sarebbe vacua`);
  // Controprova del riconoscitore, su tutte le grafie che il difetto ha avuto.
  for (const spia of [
    "const h = String(v || '').toLowerCase().replace(/[^0-9a-f]/g, '');",
    "const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();",
    "String(raw || '').toUpperCase().replace(/[^0-9A-F]/g, '')",
    "const _macHex = m => String(m || '').toLowerCase().replace(/[^a-f0-9]/gi, '');",
  ]) assert.ok(FORMA.test(spia), 'il riconoscitore non vede più: ' + spia);

  const colpevoli = [];
  const viste = new Set();
  for (const rel of files) {
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((riga, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(riga)) return;          // commenti: parlano, non eseguono
      if (!FORMA.test(riga)) return;
      if (AMMESSI[rel]) { viste.add(rel); return; }
      colpevoli.push(`${rel}:${i + 1}  ${riga.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(colpevoli, [],
    'La chiave di un MAC la dà lib/mac-class.js (`macKey`; `macFormat` per mostrarlo). Una copia diverge: ' +
    'quella di ai-grounding non conosceva la forma Cisco, e la mappa IPv6 per MAC aveva una chiave per lato.\n' + colpevoli.join('\n'));
  // L'elenco degli ammessi non deve marcire: una voce che non ha più la forma si toglie.
  const stantie = Object.keys(AMMESSI).filter((f) => !viste.has(f));
  assert.deepEqual(stantie, [], 'Voci di AMMESSI senza più la forma (toglile): ' + stantie.join(', '));
});

test('chiave MAC: la mappa IPv6 per MAC ha la STESSA chiave sul server e sul client', () => {
  // Il server la produce (server/routes/discovery.js, evento 'nd'), il client la legge
  // (src/app-discovery.js, _discApplyNd6). Se una delle due sponde cambia chiave, la
  // mappa non aggancia più niente e non c'è un errore da nessuna parte.
  const srv = fs.readFileSync(path.join(ROOT, 'server/routes/discovery.js'), 'utf8');
  const cli = fs.readFileSync(path.join(ROOT, 'src/app-discovery.js'), 'utf8');
  assert.match(srv, /require\('\.\.\/\.\.\/lib\/mac-class\.js'\)/, 'il server deve prendere macKey da lib/mac-class.js');
  assert.match(cli, /from '\.\.\/lib\/mac-class\.js'/, 'il client deve prendere macKey da lib/mac-class.js');
  const blocco = srv.slice(srv.indexOf('const nd6 = {}'), srv.indexOf("send({ type: 'nd'"));
  assert.ok(/macKey\(c\.mac\)/.test(blocco) && /if \(!mh\) continue/.test(blocco),
    'la mappa nd6 va chiavata con macKey e un vicino senza MAC leggibile non deve entrarci');
  const fn = cli.slice(cli.indexOf('function _discApplyNd6'), cli.indexOf('// Badge "porta di accesso"'));
  assert.ok(/macKey\(d\.mac\)/.test(fn), '_discApplyNd6 deve cercare per macKey');
});
