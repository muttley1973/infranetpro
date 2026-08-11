'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const updater = require('../scripts/update-device-types');

test('device-type updater: conserva il canonico e proietta il template runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-device-types-test-'));
  const vendor = path.join(root, 'Acme');
  fs.mkdirSync(vendor, { recursive: true });
  fs.writeFileSync(path.join(vendor, 'demo.yaml'), [
    'slug: acme-demo-switch',
    'manufacturer: Acme',
    'model: Demo Switch',
    'part_number: DS-1',
    'u_height: 1',
    'interfaces:',
    '  - name: GigabitEthernet1',
    '    type: 1000base-t',
    '  - name: sfp1',
    '    type: 10gbase-x-sfpp',
  ].join('\n'), 'utf8');
  try {
    const result = updater.build(root, true);
    assert.equal(result.canonical.length, 1);
    assert.equal(result.runtime.length, 1);
    assert.equal(result.canonical[0].interfaces.length, 2);
    assert.equal(result.runtime[0].sourceSlug, 'acme-demo-switch');
    assert.equal(result.runtime[0].ports, 2);
    assert.equal(result.runtime[0].counts.copper, 1);
    assert.equal(result.runtime[0].counts.sfp, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('device-type updater: applica override ed esclusioni senza alterare il canonico', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-device-types-controls-'));
  fs.writeFileSync(path.join(root, 'a.yaml'), [
    'slug: acme-a', 'manufacturer: Acme', 'model: A Switch', 'u_height: 1',
    'interfaces:', '  - name: p1', '    type: 1000base-t', '  - name: p2', '    type: 1000base-t',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'b.yaml'), [
    'slug: acme-b', 'manufacturer: Acme', 'model: B Switch', 'u_height: 1',
    'interfaces:', '  - name: p1', '    type: 1000base-t', '  - name: p2', '    type: 1000base-t',
  ].join('\n'), 'utf8');
  try {
    const result = updater.build(root, true, {
      overrides: { 'acme-a': { ports: 4, frontPanel: {
        mgmtCount: 1,
        sharedMediaSlots: [{ start: 4, count: 1, media: ['copper', 'fiber'] }],
      } } },
      exclusions: ['acme-b'],
    });
    assert.equal(result.canonical.length, 2);
    assert.equal(result.runtime.length, 1);
    assert.equal(result.runtime[0].ports, 4);
    assert.deepEqual(result.runtime[0].frontPanel.sharedMediaSlots, [{ start: 4, count: 1, media: ['copper', 'fiber'] }]);
    assert.equal(result.canonical[0].interfaces.length, 2);
    assert.equal(result.dropped[0].reason, 'manual-exclusion');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('device-type updater: diff distingue aggiunte, rimozioni e template', () => {
  const diff = updater.diffCatalog(
    [{ sourceSlug: 'old', model: 'Old', interfaces: [], capabilities: {} }],
    [{ sourceSlug: 'new', model: 'New', interfaces: [], capabilities: {} }],
    [{ sourceSlug: 'old', ports: 1 }],
    [{ sourceSlug: 'new', ports: 2 }],
  );
  assert.deepEqual(diff.added, ['new']);
  assert.deepEqual(diff.removed, ['old']);
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.counts.removed, 1);
});
