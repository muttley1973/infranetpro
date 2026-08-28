// ============================================================
// LAYOUT_TYPES (server) ↔ TYPES[x].isStructural (frontend) — la stessa cosa,
// scritta in due posti perché DEVE esserlo.
// ------------------------------------------------------------
// `src/app-types.js` è un modulo ESM del browser: il server non può importarlo,
// e `lib/api-shape.js` ne tiene una denylist locale (`LAYOUT_TYPES`) con quel
// motivo scritto in chiaro. È una duplicazione consapevole — ma finora nessuno
// la sorvegliava, ed è esattamente la forma di bug che questo progetto ha già
// incontrato dodici volte: due definizioni della stessa cosa che divergono in
// silenzio, e si scoprono a schermo.
//
// Da quando `listProjects()` conta gli apparati di un progetto con `LAYOUT_TYPES`,
// la divergenza avrebbe un effetto visibile e sbagliato: il riquadro di una sede
// sulla mappa inter-sede direbbe un numero, e la sotto-header DENTRO quella
// stessa sede — che usa `TYPES` — ne direbbe un altro.
//
// Il test legge il SORGENTE del catalogo (non può importarlo) e confronta gli
// insiemi. Se qualcuno aggiunge un tipo strutturale al catalogo, qui diventa
// rosso con scritto cosa aggiungere dall'altra parte.
// ============================================================
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { LAYOUT_TYPES } = require('../lib/api-shape.js');

const SRC = path.join(__dirname, '..', 'src', 'app-types.js');

/** I tipi marcati `isStructural:true` nel catalogo, letti dal sorgente.
 *  Per ogni occorrenza si risale alla chiave di tipo che la precede: regge anche
 *  se una definizione un giorno andrà a capo su più righe. */
function _structuralFromSource(txt) {
  const found = new Set();
  const re = /isStructural\s*:\s*true/g;
  let m, occorrenze = 0;
  while ((m = re.exec(txt))) {
    occorrenze++;
    const prima = txt.slice(0, m.index);
    // L'ULTIMA chiave `nome: {` aperta prima di questo punto è il tipo che la porta.
    const chiavi = prima.match(/([A-Za-z][\w-]*)\s*:\s*\{/g);
    assert.ok(chiavi && chiavi.length, 'isStructural fuori da una definizione di tipo');
    const ultima = chiavi[chiavi.length - 1];
    found.add(ultima.replace(/\s*:\s*\{$/, '').trim());
  }
  // Se due tipi diversi finissero sulla stessa chiave, il Set sarebbe più piccolo
  // del numero di occorrenze: meglio accorgersene qui che credere a un insieme monco.
  assert.equal(found.size, occorrenze, 'ogni isStructural:true deve mappare a un tipo distinto');
  return found;
}

test('LAYOUT_TYPES contiene ESATTAMENTE i tipi strutturali del catalogo', () => {
  const txt = fs.readFileSync(SRC, 'utf8');
  const dalCatalogo = _structuralFromSource(txt);
  assert.ok(dalCatalogo.size > 0, 'il catalogo deve avere almeno un tipo strutturale (oggi: room)');

  const dalServer = new Set(LAYOUT_TYPES);
  const mancanti = [...dalCatalogo].filter(t => !dalServer.has(t));
  const inPiu    = [...dalServer].filter(t => !dalCatalogo.has(t));

  assert.deepEqual(mancanti, [],
    'tipi con isStructural:true assenti da LAYOUT_TYPES in lib/api-shape.js — vanno aggiunti lì, '
    + 'o il server li conterà come apparati: ' + mancanti.join(', '));
  assert.deepEqual(inPiu, [],
    'tipi in LAYOUT_TYPES che il catalogo NON marca strutturali — il server li sta escludendo a torto: '
    + inPiu.join(', '));
});

test('il tipo strutturale noto (room) è nell\'insieme, un device normale no', () => {
  // Liveness: se il parsing del sorgente smettesse di trovare qualsiasi cosa, il
  // test sopra passerebbe a vuoto solo se ANCHE LAYOUT_TYPES fosse vuoto — ma
  // meglio ancorare il caso noto in modo esplicito.
  assert.equal(LAYOUT_TYPES.has('room'), true);
  assert.equal(LAYOUT_TYPES.has('switch'), false);
  assert.equal(LAYOUT_TYPES.has('pc'), false);
});
