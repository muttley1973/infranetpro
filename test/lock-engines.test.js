'use strict';
// ============================================================
//  IL LOCKFILE NON PUÒ PORTARE UN PACCHETTO CHE LA CI NON REGGE
// ============================================================
// Il 29/10 la CI della 2.12.0 è caduta in UN secondo sul job Node 18: «Playwright requires Node.js 20 or higher».
// Il giro di manutenzione aveva aggiornato il lockfile dentro i range di package.json (`^1.61.0`), e
// `playwright-core` era passato da 1.61.0 (Node ≥18) a 1.64.1 (Node ≥20). Le prove giravano sul Node del PC
// (24), dove tutto passava; la CI, che prova 18 e 20, lo ha scoperto a push fatto — su un commit di rilascio.
//
// Chi sorveglia questo è il lockfile stesso: ogni pacchetto che installa dichiara `engines.node`, e il più basso
// Node che la CI prova (letto da `.github/workflows/ci.yml`, non ricopiato qui) deve poterlo soddisfare.
// ⚠️ Vale anche per i pacchetti di SVILUPPO: la CI li installa e li esegue (Playwright è un devDependency).
//
// Il valutatore di range è scritto a mano, minimo, e FALLISCE su una forma che non conosce: una guardia che non
// riconosce un range non deve assolverlo (è la trappola di ogni guardia che enumera).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ── Un valutatore di range, quanto basta ─────────────────────────────────────
// Forme che `engines.node` ha davvero: `*`, `>=N`, `>= N.N.N`, `^A || ^B || >=C`, `18`.
function versione(s) {
  const m = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(String(s).trim());
  if (!m) throw new Error('versione non riconosciuta: «' + s + '»');
  const n = (x) => (x === undefined || /^[xX*]$/.test(x) ? null : Number(x));
  const parti = [m[1], m[2], m[3]].filter((x) => x !== undefined && !/^[xX*]$/.test(x)).length;
  return { v: [Number(m[1]), n(m[2]) || 0, n(m[3]) || 0], parti };
}
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

function comparatore(nodo, testo) {
  const c = testo.trim();
  if (c === '' || c === '*' || /^[xX]$/.test(c)) return true;
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(c);
  const op = m[1] || '=';
  const { v, parti } = versione(m[2]);
  switch (op) {
    case '>=': return cmp(nodo, v) >= 0;
    case '>': return cmp(nodo, v) > 0;
    case '<=': return cmp(nodo, v) <= 0;
    case '<': return cmp(nodo, v) < 0;
    case '^': return nodo[0] === v[0] && cmp(nodo, v) >= 0;
    case '~': return nodo[0] === v[0] && (parti < 2 || nodo[1] === v[1]) && cmp(nodo, v) >= 0;
    default: for (let i = 0; i < Math.max(1, parti); i++) if (nodo[i] !== v[i]) return false; return true;   // `18`, `18.2`
  }
}

/** Il Node `nodo` ("18.99.99") soddisfa il range `range` di `engines.node`? Lancia se non lo sa leggere. */
function soddisfa(nodo, range) {
  const n = versione(nodo).v;
  return String(range).split('||').some((clausola) => {
    // «>= 1.2 < 3» → comparatori separati da spazio, con l'operatore attaccato alla versione
    const compatta = clausola.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    if (/\s-\s/.test(compatta)) throw new Error('range con trattino non gestito: «' + range + '»');
    return compatta.split(/\s+/).every((c) => comparatore(n, c));
  });
}

// ── Il Node più basso che la CI prova ────────────────────────────────────────
function nodeMinimoDellaCI() {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const m = /node-version:\s*\[([^\]]+)\]/.exec(ci);
  assert.ok(m, 'la matrice «node-version: [...]» di ci.yml non ha più la forma attesa: aggiorna la regex QUI, non toglierla');
  const maggiori = m[1].split(',').map((x) => parseInt(x.trim().replace(/['"]/g, ''), 10)).filter(Number.isFinite);
  assert.ok(maggiori.length > 0, 'nessuna versione di Node letta dalla matrice di ci.yml: ' + m[1]);
  return Math.min(...maggiori);
}

test('il valutatore: legge le forme vere di engines.node, e rifiuta quelle che non conosce', () => {
  const n18 = '18.99.99', n20 = '20.0.0';
  assert.equal(soddisfa(n18, '>=18'), true);
  assert.equal(soddisfa(n18, '>=20'), false, 'il caso che ha rotto la CI: playwright-core 1.64 vuole Node 20');
  assert.equal(soddisfa(n20, '>=20'), true);
  assert.equal(soddisfa(n18, '*'), true);
  assert.equal(soddisfa(n18, '>= 0.10'), true, 'spazio fra operatore e versione');
  assert.equal(soddisfa(n18, '>=18.18.0'), true);
  assert.equal(soddisfa('18.0.0', '>=18.18.0'), false);
  assert.equal(soddisfa(n18, '^12.22.0 || ^14.17.0 || >=16.0.0'), true, 'più clausole: basta una');
  assert.equal(soddisfa(n18, '^18.18.0 || ^20.9.0 || >=21.1.0'), true);
  assert.equal(soddisfa(n18, '^20.9.0 || >=21.1.0'), false);
  assert.equal(soddisfa(n18, '18'), true);
  assert.equal(soddisfa(n18, '20'), false);
  assert.equal(soddisfa(n18, '>=16 <20'), true, 'comparatori in AND');
  assert.equal(soddisfa(n20, '>=16 <20'), false);
  // una forma sconosciuta FALLISCE, non assolve
  assert.throws(() => soddisfa(n18, '12 - 16'), /trattino/);
  assert.throws(() => soddisfa(n18, '>=abc'), /non riconosciuta/);
});

test('ogni pacchetto del lockfile accetta il Node più basso che la CI prova', () => {
  const minimo = nodeMinimoDellaCI();
  const nodo = minimo + '.99.99';
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const pacchetti = Object.entries(lock.packages || {}).filter(([k]) => k !== '');
  // ⚠️ Se non trova niente da controllare la prova deve ARROSSIRE, non passare a vuoto.
  assert.ok(pacchetti.length > 100, 'il lockfile ha ' + pacchetti.length + ' pacchetti: la guardia non controllerebbe più niente');
  const conEngines = pacchetti.filter(([, v]) => v.engines && v.engines.node);
  assert.ok(conEngines.length > 30, 'pochi pacchetti dichiarano engines.node (' + conEngines.length + '): il formato del lockfile è cambiato?');

  const fuori = conEngines
    .filter(([, v]) => !soddisfa(nodo, v.engines.node))
    .map(([k, v]) => k.replace(/^.*node_modules\//, '') + '@' + v.version + ' vuole Node ' + v.engines.node + (v.dev ? ' (sviluppo)' : ''));
  assert.deepEqual(fuori, [],
    'questi pacchetti del lockfile non girano su Node ' + minimo + ', che la CI prova (.github/workflows/ci.yml): ' + fuori.join('; ')
    + '. Il lockfile è stato aggiornato oltre cio che il progetto supporta: si riporta il pacchetto alla versione precedente'
    + ' (un range `~` in package.json lo tiene fermo) oppure si decide di non provare più quel Node — mai si lascia la CI a scoprirlo.');
});

test('il Node più basso viene dalla CI e non è un numero scritto qui', () => {
  const minimo = nodeMinimoDellaCI();
  assert.ok(Number.isInteger(minimo) && minimo >= 16 && minimo <= 24, 'minimo di Node letto dalla CI: ' + minimo);
});
