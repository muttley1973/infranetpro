'use strict';
// ============================================================
// PROVENANCE — test dell'envelope di provenienza (lib/provenance.ts).
//
// Le invarianti d'onestà, che sono il motivo per cui il modulo esiste:
//   * un valore NUDO non è un fatto — non viene promosso a 'declared' per
//     comodità (un ripiego del genere sarebbe un'AFFERMAZIONE);
//   * una misura con data illeggibile NON prende `Date.now()`: resta 'undated'
//     e lo dice (paletto ② no-invenzioni);
//   * il DICHIARATO non invecchia — una decisione non scade col tempo;
//   * `at` esiste solo sul misurato, `from` solo sul derivato (union discriminata);
//   * la scala d'età è OBBLIGATORIA: nessun default silenzioso.
//
// ⭐ CRICCHETTO: `AGE_SCALES.proof` ripete le soglie di `lib/proof.js`. La
//    ripetizione è voluta (provenance è zero-dip: è la fondazione e non può
//    dipendere da chi la usa), ma in questo progetto una definizione in due posti
//    è il bug-classe più caro — quindi la guardia qui sotto diventa ROSSA se
//    divergono. Stesso pattern delle 3 copie dell'hex del colore cavo.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const PROV = require('../lib/provenance.ts');
const PROOF = require('../lib/proof.js');

const {
  factDeclared, factMeasured, factDerived,
  isFact, factOrigin, factValue, factAt, factIsMeasured,
  factAgeMs, factStaleness, AGE_SCALES,
} = PROV;

const HOUR = 3600e3;
const DAY = 864e5;
const NOW = Date.UTC(2026, 7, 28); // orologio fisso
const ago = (ms) => new Date(NOW - ms).toISOString();

// ── Il cricchetto: le soglie non possono divergere da proof.js ──────────────
test('CRICCHETTO — AGE_SCALES.proof combacia con le soglie di lib/proof.js', () => {
  assert.strictEqual(AGE_SCALES.proof.freshMs, PROOF.FRESH_H * HOUR,
    'freshMs deve essere FRESH_H di proof.js: se una delle due cambia, cambiale entrambe');
  assert.strictEqual(AGE_SCALES.proof.staleMs, PROOF.STALE_D * DAY,
    'staleMs deve essere STALE_D di proof.js');
  assert.strictEqual(AGE_SCALES.proof.expireMs, PROOF.EXPIRE_D * DAY,
    'expireMs deve essere EXPIRE_D di proof.js');
});

test('le scale sono un vocabolario CHIUSO (nessuna scala inventata senza consumatore)', () => {
  // temporal-confidence (30g/60g) misura un'ALTRA domanda e non è qui: entra con
  // il Cambio 2B, quando ci sarà un consumatore. Vedi l'intestazione del modulo.
  assert.deepStrictEqual(Object.keys(AGE_SCALES), ['proof']);
});

// ── Costruttori & union discriminata ───────────────────────────────────────
test('i tre costruttori producono le tre forme, e SOLO quelle', () => {
  assert.deepStrictEqual(factDeclared('10.0.0.1'), { origin: 'declared', value: '10.0.0.1' });
  assert.deepStrictEqual(factDerived(42, 'lldp'), { origin: 'derived', value: 42, from: 'lldp' });

  const m = factMeasured('up', '2026-08-28T00:00:00.000Z');
  assert.deepStrictEqual(m, { origin: 'measured', value: 'up', at: '2026-08-28T00:00:00.000Z' });

  // `at` solo sul misurato, `from` solo sul derivato.
  assert.ok(!('at' in factDeclared(1)) && !('from' in factDeclared(1)));
  assert.ok(!('at' in factDerived(1, 'x')));
  assert.ok(!('from' in m));
});

test('factMeasured normalizza a ISO da stringa, numero e Date', () => {
  const iso = '2026-08-28T00:00:00.000Z';
  assert.strictEqual(factMeasured(1, iso).at, iso);
  assert.strictEqual(factMeasured(1, NOW).at, iso);
  assert.strictEqual(factMeasured(1, new Date(NOW)).at, iso);
});

test('② una data illeggibile NON diventa `adesso`: resta non datata', () => {
  for (const bad of ['', null, undefined, 'ieri', NaN, {}]) {
    const f = factMeasured('up', bad);
    assert.strictEqual(f.origin, 'measured', 'la lettura è avvenuta: resta una misura');
    assert.strictEqual(f.at, '', `at doveva essere vuoto per ${JSON.stringify(String(bad))}`);
    assert.strictEqual(factAt(f), null);
    assert.strictEqual(factAgeMs(f, NOW), null, 'una misura non datata non ha età');
    assert.strictEqual(factStaleness(f, AGE_SCALES.proof, NOW).tier, 'undated');
  }
});

// ── isFact: severo di proposito ────────────────────────────────────────────
test('un valore NUDO non è un fatto (nessuna promozione di comodo a `declared`)', () => {
  for (const nude of ['10.0.0.1', 42, true, null, undefined, [], [1, 2], {}, { value: 'x' },
    { origin: 'imported', value: 'x' }, { origin: 'DECLARED', value: 'x' }, { origin: 7 }]) {
    assert.strictEqual(isFact(nude), false, `${JSON.stringify(nude)} non deve essere un fatto`);
    assert.strictEqual(factOrigin(nude), null);
    assert.strictEqual(factValue(nude), undefined);
    assert.strictEqual(factAt(nude), null);
    assert.strictEqual(factIsMeasured(nude), false);
  }
});

test('i tre costruttori producono fatti riconosciuti', () => {
  const fs = [factDeclared('a'), factMeasured('b', NOW), factDerived('c', 'x')];
  for (const f of fs) assert.strictEqual(isFact(f), true);
  assert.deepStrictEqual(fs.map(factOrigin), ['declared', 'measured', 'derived']);
  assert.deepStrictEqual(fs.map(factValue), ['a', 'b', 'c']);
  assert.deepStrictEqual(fs.map(factIsMeasured), [false, true, false]);
});

test('factValue restituisce il valore così com\'è, anche falsy o strutturato', () => {
  for (const v of [0, '', false, null, { a: 1 }, [1, 2]]) {
    assert.deepStrictEqual(factValue(factDeclared(v)), v);
  }
});

// ── Età: il dichiarato NON invecchia ───────────────────────────────────────
test('① il DICHIARATO non invecchia: è una decisione, non una lettura', () => {
  const d = factDeclared('10.0.0.1');
  assert.strictEqual(factAt(d), null);
  assert.strictEqual(factAgeMs(d, NOW), null);
  const s = factStaleness(d, AGE_SCALES.proof, NOW);
  assert.strictEqual(s.tier, 'undated');
  assert.strictEqual(s.dated, false);
  assert.strictEqual(s.ageMs, null);
  assert.strictEqual(s.ageDays, null);
});

test('nemmeno il DERIVATO ha un\'età propria (ce l\'ha la sua sorgente)', () => {
  assert.strictEqual(factStaleness(factDerived('x', 'ifStack'), AGE_SCALES.proof, NOW).tier, 'undated');
});

test('i quattro gradini della scala, ai bordi esatti', () => {
  const tier = (ms) => factStaleness(factMeasured('v', ago(ms)), AGE_SCALES.proof, NOW).tier;
  const S = AGE_SCALES.proof;
  assert.strictEqual(tier(0), 'fresh');
  assert.strictEqual(tier(S.freshMs), 'fresh', 'il bordo appartiene al gradino più fresco');
  assert.strictEqual(tier(S.freshMs + 1), 'aging');
  assert.strictEqual(tier(S.staleMs), 'aging');
  assert.strictEqual(tier(S.staleMs + 1), 'stale');
  assert.strictEqual(tier(S.expireMs), 'stale');
  assert.strictEqual(tier(S.expireMs + 1), 'expired');
});

test('una misura nel FUTURO (clock skew) vale 0, non un\'età negativa', () => {
  const f = factMeasured('v', new Date(NOW + 5 * DAY).toISOString());
  assert.strictEqual(factAgeMs(f, NOW), 0);
  assert.strictEqual(factStaleness(f, AGE_SCALES.proof, NOW).tier, 'fresh');
});

test('ageDays è l\'età in giorni, arrotondata a un decimale', () => {
  const s = factStaleness(factMeasured('v', ago(3 * DAY + 12 * HOUR)), AGE_SCALES.proof, NOW);
  assert.strictEqual(s.ageDays, 3.5);
  assert.strictEqual(s.dated, true);
  assert.strictEqual(s.ageMs, 3 * DAY + 12 * HOUR);
});

test('senza scala non si inventa un default: `undated`', () => {
  const f = factMeasured('v', ago(HOUR));
  assert.strictEqual(factStaleness(f, null, NOW).tier, 'undated');
  assert.strictEqual(factStaleness(f, undefined, NOW).tier, 'undated');
});

test('`now` è iniettabile (puro: non tocca l\'orologio da sé)', () => {
  const f = factMeasured('v', ago(10 * DAY)); // misurato 10 giorni prima di NOW
  assert.strictEqual(factStaleness(f, AGE_SCALES.proof, NOW).tier, 'stale');
  // Stesso fatto, guardato un'ora dopo la lettura: era fresco.
  assert.strictEqual(factStaleness(f, AGE_SCALES.proof, NOW - 10 * DAY + HOUR).tier, 'fresh');
});

// ── Purezza ────────────────────────────────────────────────────────────────
test('i lettori non mutano il fatto', () => {
  const f = factMeasured({ a: 1 }, ago(DAY));
  const before = JSON.stringify(f);
  factValue(f); factAt(f); factOrigin(f); factAgeMs(f, NOW);
  factStaleness(f, AGE_SCALES.proof, NOW); factIsMeasured(f); isFact(f);
  assert.strictEqual(JSON.stringify(f), before);
});

test('un fatto sopravvive al giro JSON (si persiste così com\'è)', () => {
  for (const f of [factDeclared('a'), factMeasured('b', NOW), factDerived('c', 'x')]) {
    const back = JSON.parse(JSON.stringify(f));
    assert.deepStrictEqual(back, f);
    assert.strictEqual(isFact(back), true);
  }
});
