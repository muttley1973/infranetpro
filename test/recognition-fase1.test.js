'use strict';

// GOLDEN TRAP-TABLE — model recognition, Phase 1 acceptance gate.
//
// The ORACLE, written test-first (design lives in _local/notes/goldens/
// recognition-fase1.golden.js). It pins input -> outcome for the fuzzy-core
// matcher and the virtual gate. The Phase 1 constants (what counts as a model
// token, the version/part-number guards) are tuned to make THIS pass, never by
// eye.
//
// ONE faithful adaptation vs the design file: the fuzzy stage is OPT-IN via
// { fuzzy: true }. The DCIM/NetBox import path (lib/dcim-map.js) calls the
// resolver WITHOUT the opt and stays exact-only and byte-identical; only the
// scan/discovery path asks for model-core. Every trap assertion below is
// unchanged.
//
// Contract the resolver honours (extends the previous return shape):
//   resolveCatalogEntry(input, indexes, aliases, { fuzzy:true }) -> {
//     entry, strategy, confidence: 'exact' | 'family' | null, candidates? }
//
// Confidence is a SEPARATE field with distinct string values on purpose:
// 'family' is structurally distinct from 'exact' and NEVER carries an entry —
// it knows WHO it is, not HOW MANY ports it has, so ports/rackU can never be
// auto-filled from a family guess.

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../lib/device-catalog');

const FUZZY = { fuzzy: true };

// ---------------------------------------------------------------------------
// Fixture catalogue — small and deterministic, NOT the 5,296-entry file.
// Two Catalyst 2960 variants so a bare "2960" is a FAMILY (24 vs 48 ports),
// never a coin toss; four singletons that resolve with the brand left EMPTY.
// ---------------------------------------------------------------------------
const CATALOG = [
  { slug: 'cisco-catalyst-2960-24tc-l', brand: 'Cisco',   brandSlug: 'cisco',   model: 'Catalyst 2960-24TC-L', uHeight: 1, ports: 24 },
  { slug: 'cisco-catalyst-2960-48tc-l', brand: 'Cisco',   brandSlug: 'cisco',   model: 'Catalyst 2960-48TC-L', uHeight: 1, ports: 48 },
  { slug: 'juniper-srx300',             brand: 'Juniper', brandSlug: 'juniper', model: 'SRX300',               uHeight: 1 },
  { slug: 'zyxel-gs1900-24e',           brand: 'Zyxel',   brandSlug: 'zyxel',   model: 'GS1900-24E',           uHeight: 1, ports: 24 },
  { slug: 'arista-dcs-7050qx-32s',      brand: 'Arista',  brandSlug: 'arista',  model: 'DCS-7050QX-32S',       uHeight: 1, ports: 32 },
];

const INDEXES = catalog.buildIndexes(CATALOG);

const TRAPS = [
  // ── Positive recognition ────────────────────────────────────────────────
  {
    id: 'full core, brand empty -> EXACT (WS-C2960-24TC-L = Catalyst 2960-24TC-L)',
    input: { brand: '', model: 'WS-C2960-24TC-L' },
    expect: { strategy: 'model-core', confidence: 'exact', slug: 'cisco-catalyst-2960-24tc-l' },
  },
  {
    id: 'bare 2960 -> FAMILY, never a specific variant',
    input: { brand: '', model: 'C2960' },
    expect: { strategy: 'model-core', confidence: 'family', slug: null,
              candidates: ['cisco-catalyst-2960-24tc-l', 'cisco-catalyst-2960-48tc-l'] },
  },
  {
    id: 'SRX300, brand empty -> EXACT (brand-optional)',
    input: { brand: '', model: 'SRX300' },
    expect: { strategy: 'model-core', confidence: 'exact', slug: 'juniper-srx300' },
  },
  {
    id: 'GS1900-24E, brand empty -> EXACT',
    input: { brand: '', model: 'GS1900-24E' },
    expect: { strategy: 'model-core', confidence: 'exact', slug: 'zyxel-gs1900-24e' },
  },
  {
    id: 'DCS-7050QX-32S, brand empty -> EXACT',
    input: { brand: '', model: 'DCS-7050QX-32S' },
    expect: { strategy: 'model-core', confidence: 'exact', slug: 'arista-dcs-7050qx-32s' },
  },
  {
    id: 'noisy model string still yields the FAMILY, not junk',
    input: { brand: '', model: 'Cisco IOS Software, Catalyst 2960' },
    expect: { strategy: 'model-core', confidence: 'family', slug: null,
              candidates: ['cisco-catalyst-2960-24tc-l', 'cisco-catalyst-2960-48tc-l'] },
  },

  // ── Virtual gate: CONSUMED, not re-derived ───────────────────────────────
  {
    id: 'virtual verdict short-circuits -> vios is VIRTUAL, not "5220"',
    input: { brand: '', model: 'vios_l2', virtual: true },
    expect: { strategy: 'virtual', confidence: null, slug: null },
  },

  // ── Guards: must NEVER match ──────────────────────────────────────────────
  {
    id: 'a version number is not a model core',
    input: { brand: '', model: 'Version 15.2(4)E7' },
    expect: { strategy: 'unmatched', confidence: null, slug: null },
  },
  {
    id: 'generic OS banner -> unmatched (no "ric3" carved out of "generic")',
    input: { brand: '', model: 'Linux 5.4.0-29-generic #33' },
    expect: { strategy: 'unmatched', confidence: null, slug: null },
  },
  {
    id: 'a part number -> unmatched',
    input: { brand: '', model: 'PN:1N2039' },
    expect: { strategy: 'unmatched', confidence: null, slug: null },
  },

  // ── Existing exact paths keep working AND gain the 'exact' label ──────────
  {
    id: 'source-slug exact still wins, labeled exact',
    input: { sourceSlug: 'cisco-catalyst-2960-24tc-l', brand: 'noise', model: 'noise' },
    expect: { strategy: 'source-slug', confidence: 'exact', slug: 'cisco-catalyst-2960-24tc-l' },
  },
  {
    id: 'normalized-name exact (brand present), labeled exact',
    input: { brand: 'Zyxel', model: 'GS1900_24E' },
    expect: { strategy: 'normalized-name', confidence: 'exact', slug: 'zyxel-gs1900-24e' },
  },
];

const slugOf = (r) => (r && r.entry ? (r.entry.slug || r.entry.sourceSlug || null) : null);

for (const row of TRAPS) {
  test('golden: ' + row.id, () => {
    const r = catalog.resolveCatalogEntry(row.input, INDEXES, null, FUZZY);

    assert.equal(r.strategy, row.expect.strategy, 'strategy');
    assert.equal(r.confidence, row.expect.confidence, 'confidence');
    assert.equal(slugOf(r), row.expect.slug, 'resolved slug');

    if (row.expect.confidence === 'family') {
      assert.equal(r.entry, null, 'family must not carry an entry');
    }
    if (row.expect.candidates) {
      assert.deepEqual(
        (r.candidates || []).slice().sort(),
        row.expect.candidates.slice().sort(),
        'family candidates',
      );
    }
  });
}
