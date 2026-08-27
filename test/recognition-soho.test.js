'use strict';

// SOHO long-tail safety — the alt-core must not collapse a short model number
// into a cross-vendor false EXACT. Found live: a TP-Link 'TL-SG1008D' matched
// 'D-Link DES-1008D' because both reduce to '1008d' once the vendor prefix is
// stripped. The rule under test: the alt core carries an EXACT only when it
// stays STRUCTURED (keeps a separator, e.g. '2960-24TC-L'); a collapsed single
// token like '1008d' may only feed the family step (which needs >=2 variants).
// Vendor-neutral: a rule on the SHAPE of the core, never on the brand.

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../lib/device-catalog');

const CAT = [
  { slug: 'dlink-des-1008d',              brand: 'D-Link',  brandSlug: 'dlink',   model: 'DES-1008D',            ports: 8 },
  { slug: 'tp-link-tl-sg108e',            brand: 'TP-Link', brandSlug: 'tp-link', model: 'TL-SG108E',            partNumber: 'TL-SG108E', ports: 8 },
  { slug: 'cisco-catalyst-2960-24tc-l',   brand: 'Cisco',   brandSlug: 'cisco',   model: 'Catalyst 2960-24TC-L', partNumber: 'WS-C2960-24TC-L', ports: 24 },
];
const IDX = catalog.buildIndexes(CAT);
const FUZZY = { fuzzy: true };
const slugOf = (r) => (r && r.entry ? (r.entry.slug || r.entry.sourceSlug || null) : null);

test('SOHO: a short cross-vendor number does NOT become a false exact', () => {
  // TL-SG1008D -> core 'sg1008d', alt collapses to '1008d' == DES-1008D's core.
  const r = catalog.resolveCatalogEntry({ brand: '', model: 'TL-SG1008D' }, IDX, null, FUZZY);
  assert.notEqual(r.confidence, 'exact', 'a collapsed short alt must never assert an exact');
  assert.notEqual(slugOf(r), 'dlink-des-1008d', 'must not cross-match D-Link DES-1008D');
  assert.equal(r.strategy, 'unmatched');
});

test('SOHO: the structured alt is still trusted (WS-C2960-24TC-L -> Catalyst)', () => {
  // '2960-24TC-L' keeps its separators, so the Cisco order-code path survives.
  const r = catalog.resolveCatalogEntry({ brand: '', model: 'WS-C2960-24TC-L' }, IDX, null, FUZZY);
  assert.equal(slugOf(r), 'cisco-catalyst-2960-24tc-l');
});

test('SOHO: an exact part number still resolves (the reliable path)', () => {
  const r = catalog.resolveCatalogEntry({ brand: '', model: 'TL-SG108E' }, IDX, null, FUZZY);
  assert.equal(r.strategy, 'part-number');
  assert.equal(r.confidence, 'exact');
  assert.equal(slugOf(r), 'tp-link-tl-sg108e');
});

test('SOHO: a device declining to be matched stays unmatched, not invented', () => {
  const r = catalog.resolveCatalogEntry({ brand: '', model: '300Mbps Wireless N Router WR841N' }, IDX, null, FUZZY);
  assert.equal(r.strategy, 'unmatched');
  assert.equal(r.entry, null);
});
