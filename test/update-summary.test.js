// Test per lib/update-summary.js — riassunto puro del Drift per il chip.
const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeDriftReport } = require('../lib/update-summary.js');

function rep(counts) { return { counts }; }

test('summarizeDriftReport: nuovi = undocumented infra + endpoint', () => {
  const s = summarizeDriftReport(rep({ undocumented: 2, undocumentedEndpoint: 3 }));
  assert.equal(s.newInfra, 2);
  assert.equal(s.newEndpoint, 3);
  assert.equal(s.newCount, 5);
});

test('summarizeDriftReport: primaryCount = nuovi + cambiati (no assenti/ghost)', () => {
  const s = summarizeDriftReport(rep({
    undocumented: 1, undocumentedEndpoint: 1, stateDrift: 2,
    macOrphan: 4, ghostCable: 1,
  }));
  assert.equal(s.changedCount, 2);
  assert.equal(s.primaryCount, 4);            // 2 nuovi + 2 cambiati
  assert.equal(s.secondaryCount, 5);          // 4 assenti + 1 ghost — NON nell'headline
});

test('summarizeDriftReport: macOrphan resta secondario, mai nel primary', () => {
  const s = summarizeDriftReport(rep({ macOrphan: 10 }));
  assert.equal(s.primaryCount, 0);
  assert.equal(s.absentCount, 10);
  assert.equal(s.secondaryCount, 10);
  assert.equal(s.hasChanges, true);           // c'è qualcosa, ma non è headline
});

test('summarizeDriftReport: tutto a zero → allClear', () => {
  const s = summarizeDriftReport(rep({}));
  assert.equal(s.hasChanges, false);
  assert.equal(s.allClear, true);
  assert.equal(s.primaryCount, 0);
  assert.equal(s.secondaryCount, 0);
});

test('summarizeDriftReport: report assente/malformato → zeri sicuri', () => {
  for (const bad of [null, undefined, {}, { counts: null }, { counts: { undocumented: 'x' } }]) {
    const s = summarizeDriftReport(bad);
    assert.equal(s.newCount, 0);
    assert.equal(s.primaryCount, 0);
    assert.equal(s.allClear, true);
  }
});
