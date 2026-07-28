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
