'use strict';
// ============================================================
// TEMPORAL CONFIDENCE — test dello score "visto N volte" (lib/temporal-confidence.js).
// Verifica la ladder di ripetizione, il bonus persistenza, il decadimento per
// staleness, i tier e l'aggregazione di piu' record dello stesso entity.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const {
  aggregateObservations, temporalConfidence,
  STALE_DAYS, GONE_DAYS, STABLE_SEEN, STABLE_SPAN_DAYS,
} = require('../lib/temporal-confidence.js');

const DAY = 864e5;
const iso = ms => new Date(ms).toISOString();
const NOW = Date.UTC(2026, 6, 28); // orologio fisso per tutti i test

test('costanti di default esportate', () => {
  assert.equal(STALE_DAYS, 30);
  assert.equal(GONE_DAYS, 60);
  assert.equal(STABLE_SEEN, 5);
  assert.equal(STABLE_SPAN_DAYS, 14);
});

// ---- aggregateObservations ------------------------------------------------
test('aggregateObservations: somma i count, min firstSeen, max lastSeen', () => {
  const recs = [
    { count: 3, ts: iso(NOW - 20 * DAY), lastSeen: iso(NOW - 5 * DAY) },
    { count: 2, ts: iso(NOW - 10 * DAY), lastSeen: iso(NOW - 1 * DAY) },
  ];
  const agg = aggregateObservations(recs);
  assert.equal(agg.seen, 5);
  assert.equal(agg.firstSeen, iso(NOW - 20 * DAY));
  assert.equal(agg.lastSeen, iso(NOW - 1 * DAY));
});

test('aggregateObservations: count mancante conta 1, record nulli ignorati', () => {
  const agg = aggregateObservations([{ ts: iso(NOW) }, null, { count: 0, ts: iso(NOW) }]);
  assert.equal(agg.seen, 2); // 1 (count assente) + 1 (count 0 → minimo 1)
});

test('aggregateObservations: lista vuota → seen 0, date vuote', () => {
  assert.deepEqual(aggregateObservations([]), { seen: 0, firstSeen: '', lastSeen: '' });
  assert.deepEqual(aggregateObservations(null), { seen: 0, firstSeen: '', lastSeen: '' });
});

// ---- temporalConfidence: ladder di ripetizione ----------------------------
test('più avvistamenti → score monotòno crescente (a parità di recency)', () => {
  const at = seen => temporalConfidence(
    { seen, firstSeen: iso(NOW - 1 * DAY), lastSeen: iso(NOW) }, NOW).score;
  const s1 = at(1), s2 = at(2), s5 = at(5), s15 = at(15);
  assert.ok(s1 < s2 && s2 < s5 && s5 <= s15, `attesa crescita: ${s1} ${s2} ${s5} ${s15}`);
  assert.ok(s1 <= 0.25, 'una volta sola = tentativo (score basso)');
});

test('visto una volta oggi → tier fresh', () => {
  const r = temporalConfidence({ seen: 1, ts: iso(NOW), lastSeen: iso(NOW) }, NOW);
  assert.equal(r.tier, 'fresh');
  assert.equal(r.ageDays, 0);
});

test('visto 2 volte in 3 giorni → tier recurring', () => {
  const r = temporalConfidence(
    { seen: 2, firstSeen: iso(NOW - 3 * DAY), lastSeen: iso(NOW) }, NOW);
  assert.equal(r.tier, 'recurring');
});

test('visto 3+ volte o arco ≥7gg → tier established', () => {
  const many = temporalConfidence(
    { seen: 4, firstSeen: iso(NOW - 3 * DAY), lastSeen: iso(NOW) }, NOW);
  assert.equal(many.tier, 'established');
  const wide = temporalConfidence(
    { seen: 2, firstSeen: iso(NOW - 8 * DAY), lastSeen: iso(NOW) }, NOW);
  assert.equal(wide.tier, 'established');
});

test('visto ≥5 volte su ≥14gg, recente → tier stable, score alto', () => {
  const r = temporalConfidence(
    { seen: 12, firstSeen: iso(NOW - 30 * DAY), lastSeen: iso(NOW - 2 * DAY) }, NOW);
  assert.equal(r.tier, 'stable');
  assert.ok(r.score >= 0.9, `score alto atteso, ottenuto ${r.score}`);
  assert.equal(r.spanDays, 28);
});

// ---- decadimento / staleness ---------------------------------------------
test('non visto da oltre STALE_DAYS → tier stale, score dimezzato', () => {
  const recent = temporalConfidence(
    { seen: 10, firstSeen: iso(NOW - 40 * DAY), lastSeen: iso(NOW) }, NOW);
  const staleR = temporalConfidence(
    { seen: 10, firstSeen: iso(NOW - 40 * DAY), lastSeen: iso(NOW - 40 * DAY) }, NOW);
  assert.equal(staleR.tier, 'stale');
  assert.ok(staleR.score < recent.score, 'lo stale deve valere meno del recente');
  assert.ok(staleR.stale === true);
});

test('non visto da oltre GONE_DAYS → penalità più forte dello stale semplice', () => {
  const stale = temporalConfidence(
    { seen: 10, firstSeen: iso(NOW - 100 * DAY), lastSeen: iso(NOW - 40 * DAY) }, NOW);
  const gone = temporalConfidence(
    { seen: 10, firstSeen: iso(NOW - 100 * DAY), lastSeen: iso(NOW - 80 * DAY) }, NOW);
  assert.ok(gone.score < stale.score, `gone(${gone.score}) < stale(${stale.score})`);
});

test('stale scavalca stable: molto visto ma non di recente NON è stable', () => {
  const r = temporalConfidence(
    { seen: 20, firstSeen: iso(NOW - 90 * DAY), lastSeen: iso(NOW - 45 * DAY) }, NOW);
  assert.equal(r.tier, 'stale');
});

// ---- robustezza ------------------------------------------------------------
test('seen 0 → score 0, tier fresh, nessun crash', () => {
  const r = temporalConfidence({ seen: 0 }, NOW);
  assert.equal(r.score, 0);
  assert.equal(r.tier, 'fresh');
  assert.equal(r.ageDays, null); // nessuna data valida
});

test('input vuoto/nullo → oggetto sano, non lancia', () => {
  const r = temporalConfidence(null, NOW);
  assert.equal(r.seen, 0);
  assert.equal(r.tier, 'fresh');
  assert.equal(r.stale, false);
});

test('solo lastSeen (niente firstSeen) → spanDays 0, ageDays calcolato', () => {
  const r = temporalConfidence({ seen: 3, lastSeen: iso(NOW - 5 * DAY) }, NOW);
  assert.equal(r.spanDays, 0);
  assert.equal(r.ageDays, 5);
  assert.equal(r.tier, 'established'); // seen>=3
});

test('score sempre in [0,1]', () => {
  for (const seen of [0, 1, 3, 8, 25, 500]) {
    for (const age of [0, 5, 35, 70]) {
      const r = temporalConfidence(
        { seen, firstSeen: iso(NOW - 60 * DAY), lastSeen: iso(NOW - age * DAY) }, NOW);
      assert.ok(r.score >= 0 && r.score <= 1, `score fuori range: ${r.score} (seen ${seen}, age ${age})`);
    }
  }
});

// ── D4: un avvistamento SENZA data non deve valere come uno di stamattina ────
// Il decadimento si applicava solo se c'era una data; senza, la voce non
// invecchiava mai e prendeva lo stesso punteggio di una vista fresca. È
// l'ottimismo sul dato assente: quando non sappiamo, non dobbiamo regalare
// fiducia. Ora l'età ignota pesa come un mese di silenzio — ma NON si afferma
// `stale`, che sarebbe affermare qualcosa che non sappiamo.
test('D4: 8 avvistamenti senza data valgono MENO di 8 visti ieri', () => {
  const now = Date.parse('2026-08-14T00:00:00Z');
  const senzaData = temporalConfidence({ seen: 8 }, now);
  const ieri = temporalConfidence({ seen: 8, lastSeen: '2026-08-13T00:00:00Z' }, now);
  assert.ok(senzaData.score < ieri.score, `senza data ${senzaData.score} deve stare sotto ${ieri.score}`);
  assert.equal(senzaData.tier, 'undated');
  assert.equal(senzaData.ageUnknown, true);
  assert.equal(senzaData.ageDays, null, 'nessuna età inventata');
  assert.equal(senzaData.stale, false, '«non recente» sarebbe un\'affermazione che non possiamo fare');
});

test('D4: l\'età ignota sta FRA il fresco e il dimenticato', () => {
  const now = Date.parse('2026-08-14T00:00:00Z');
  const fresco = temporalConfidence({ seen: 8, lastSeen: '2026-08-13T00:00:00Z' }, now).score;
  const ignota = temporalConfidence({ seen: 8 }, now).score;
  const vecchio = temporalConfidence({ seen: 8, lastSeen: '2025-07-10T00:00:00Z' }, now).score;
  assert.ok(vecchio < ignota && ignota < fresco, `atteso ${vecchio} < ${ignota} < ${fresco}`);
});

test('D4: chi HA la data non cambia di una virgola', () => {
  const now = Date.parse('2026-08-14T00:00:00Z');
  // Le tre fasce datate restano quelle di prima: il ramo nuovo è l'ultimo `else if`.
  assert.equal(temporalConfidence({ seen: 1, lastSeen: '2026-08-13T00:00:00Z' }, now).score, 0.2);
  assert.equal(temporalConfidence({ seen: 8, lastSeen: '2026-08-13T00:00:00Z' }, now).score, 0.8);
  assert.equal(temporalConfidence({ seen: 8, lastSeen: '2026-07-01T00:00:00Z' }, now).tier, 'stale');
});

test('D4: zero avvistamenti resta zero, e senza età ignota', () => {
  const r = temporalConfidence({ seen: 0 }, Date.parse('2026-08-14T00:00:00Z'));
  assert.equal(r.score, 0);
  assert.equal(r.tier, 'fresh');
  assert.equal(r.ageUnknown, false, 'non c\'è nulla da datare: niente da dichiarare ignoto');
});

test('D4: aggregando record senza date, l\'esito è «età ignota»', () => {
  const agg = aggregateObservations([{ count: 3 }, { count: 5 }]);
  assert.equal(agg.lastSeen, '', 'nessuna data inventata in aggregazione');
  const r = temporalConfidence(agg, Date.parse('2026-08-14T00:00:00Z'));
  assert.equal(r.seen, 8);
  assert.equal(r.tier, 'undated');
});
