'use strict';
// Test del modello link/segmenti PURO (lib/link-model.js), estratto da src/app.js.
const { test } = require('node:test');
const assert = require('node:assert');
const lm = require('../lib/link-model.js');

// ── _normalizeLinkMetadata ──────────────────────────────────────────────────
test('_normalizeLinkMetadata: alias length↔lengthM nei due versi', () => {
  assert.equal(lm._normalizeLinkMetadata({ length: 5 }).lengthM, 5);
  assert.equal(lm._normalizeLinkMetadata({ lengthM: 7 }).length, 7);
});

test('_normalizeLinkMetadata: alias category↔cableCategory e color↔colorOvr', () => {
  const a = lm._normalizeLinkMetadata({ category: 'cat6' });
  assert.equal(a.cableCategory, 'cat6');
  const b = lm._normalizeLinkMetadata({ color: '#f00' });
  assert.equal(b.colorOvr, '#f00');
  const c = lm._normalizeLinkMetadata({ colorOvr: '#0f0' });
  assert.equal(c.color, '#0f0');
});

test('_normalizeLinkMetadata: cableType vuoto viene rimosso, valido viene trimmato', () => {
  assert.ok(!('cableType' in lm._normalizeLinkMetadata({ cableType: '   ' })));
  assert.equal(lm._normalizeLinkMetadata({ cableType: '  utp  ' }).cableType, 'utp');
});

test('_normalizeLinkMetadata: isPermanent coercito a true o eliminato', () => {
  assert.equal(lm._normalizeLinkMetadata({ isPermanent: 'true' }).isPermanent, true);
  assert.equal(lm._normalizeLinkMetadata({ isPermanent: 1 }).isPermanent, true);
  assert.ok(!('isPermanent' in lm._normalizeLinkMetadata({ isPermanent: false })));
});

test('_normalizeLinkMetadata: tollera input non-oggetto', () => {
  assert.equal(lm._normalizeLinkMetadata(null), null);
  assert.equal(lm._normalizeLinkMetadata('x'), 'x');
});

test('_normalizeLinkMetadata: normalizza anche i segmenti annidati', () => {
  const link = lm._normalizeLinkMetadata({ src: 'a-1', dst: 'b-1', segments: [{ from: ' a-1 ', to: ' b-1 ', type: 'utp' }] });
  assert.equal(link.segments[0].from, 'a-1');
  assert.equal(link.segments[0].cableType, 'utp');
});

// ── _normalizeLinkSegment ───────────────────────────────────────────────────
test('_normalizeLinkSegment: alias type↔cableType', () => {
  assert.equal(lm._normalizeLinkSegment({ type: 'fiber' }).cableType, 'fiber');
  assert.equal(lm._normalizeLinkSegment({ cableType: 'utp' }).type, 'utp');
});

test('_normalizeLinkSegment: permanent↔isPermanent coerenti', () => {
  const s = lm._normalizeLinkSegment({ isPermanent: '1' });
  assert.equal(s.isPermanent, true);
  assert.equal(s.permanent, true);
  const s2 = lm._normalizeLinkSegment({ permanent: 0 });
  assert.equal(s2.permanent, false);
});

test('_normalizeLinkSegment: non-oggetto → null', () => {
  assert.equal(lm._normalizeLinkSegment(null), null);
  assert.equal(lm._normalizeLinkSegment(42), null);
});

// ── _normalizeLinkSegments ──────────────────────────────────────────────────
test('_normalizeLinkSegments: scarta i segmenti vuoti, elimina l\'array se resta nulla', () => {
  const link = { segments: [{ from: '', to: '' }, { notes: '   ' }] };
  lm._normalizeLinkSegments(link);
  assert.ok(!('segments' in link));
});

test('_normalizeLinkSegments: mantiene i segmenti significativi', () => {
  const link = { segments: [{ from: 'a-1', to: 'b-1' }] };
  lm._normalizeLinkSegments(link);
  assert.equal(link.segments.length, 1);
});

// ── _createLinkSegmentRecord ────────────────────────────────────────────────
test('_createLinkSegmentRecord: costruisce da from/to + extra', () => {
  const s = lm._createLinkSegmentRecord('a-1', 'b-2', { type: 'utp' });
  assert.equal(s.from, 'a-1');
  assert.equal(s.to, 'b-2');
  assert.equal(s.cableType, 'utp');
});

// ── _getLinkSegmentPairs ────────────────────────────────────────────────────
test('_getLinkSegmentPairs: usa i segmenti se presenti', () => {
  const pairs = lm._getLinkSegmentPairs({ segments: [{ from: 'a-1', to: 'p-1' }, { from: 'p-2', to: 'b-1' }] });
  assert.deepEqual(pairs, [['a-1', 'p-1'], ['p-2', 'b-1']]);
});

test('_getLinkSegmentPairs: fallback su src/dst e salta i self-loop', () => {
  assert.deepEqual(lm._getLinkSegmentPairs({ src: 'a-1', dst: 'b-1' }), [['a-1', 'b-1']]);
  assert.deepEqual(lm._getLinkSegmentPairs({ src: 'a-1', dst: 'a-1' }), []);
});

// ── _getLinkPortIds ─────────────────────────────────────────────────────────
test('_getLinkPortIds: deduplica src/dst + estremi dei segmenti', () => {
  const ids = lm._getLinkPortIds({ src: 'a-1', dst: 'b-1', segments: [{ from: 'a-1', to: 'p-1' }, { from: 'p-1', to: 'b-1' }] });
  assert.deepEqual(new Set(ids), new Set(['a-1', 'b-1', 'p-1']));
});

// ── _linkTouchesPort ────────────────────────────────────────────────────────
test('_linkTouchesPort: vero per una porta del link, falso altrimenti', () => {
  const link = { src: 'a-1', dst: 'b-1' };
  assert.equal(lm._linkTouchesPort(link, 'a-1'), true);
  assert.equal(lm._linkTouchesPort(link, 'z-9'), false);
  assert.equal(lm._linkTouchesPort(null, 'a-1'), false);
});

// ── _linkAdjacentPorts / _linkOtherPort ─────────────────────────────────────
test('_linkAdjacentPorts: capi opposti lungo le coppie', () => {
  const link = { segments: [{ from: 'a-1', to: 'p-1' }, { from: 'p-1', to: 'b-1' }] };
  assert.deepEqual(new Set(lm._linkAdjacentPorts(link, 'p-1')), new Set(['a-1', 'b-1']));
});

test('_linkOtherPort: l\'altro capo di un link diretto', () => {
  assert.equal(lm._linkOtherPort({ src: 'a-1', dst: 'b-1' }, 'a-1'), 'b-1');
  assert.equal(lm._linkOtherPort({ src: 'a-1', dst: 'b-1' }, 'z-9'), null);
});

// ── _linkHasPair ────────────────────────────────────────────────────────────
test('_linkHasPair: vera in entrambi i versi', () => {
  const link = { src: 'a-1', dst: 'b-1' };
  assert.equal(lm._linkHasPair(link, 'a-1', 'b-1'), true);
  assert.equal(lm._linkHasPair(link, 'b-1', 'a-1'), true);
  assert.equal(lm._linkHasPair(link, 'a-1', 'z-9'), false);
});

// ── _getLinkDrawEndpoints ───────────────────────────────────────────────────
test('_getLinkDrawEndpoints: usa src/dst diretti', () => {
  assert.deepEqual(lm._getLinkDrawEndpoints({ src: 'a-1', dst: 'b-1' }), { src: 'a-1', dst: 'b-1' });
});

test('_getLinkDrawEndpoints: fallback al primo/ultimo segmento se src/dst mancano', () => {
  const ep = lm._getLinkDrawEndpoints({ segments: [{ from: 'a-1', to: 'p-1' }, { from: 'p-1', to: 'b-1' }] });
  assert.deepEqual(ep, { src: 'a-1', dst: 'b-1' });
});
