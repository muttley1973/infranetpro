'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../lib/device-catalog');

const entries = [
  { slug: 'cisco-c9200-24t', brand: 'Cisco', brandSlug: 'cisco', model: 'C9200-24T', ports: 24 },
  { slug: 'hpe-5130-48g', brand: 'HPE', brandSlug: 'hpe', model: '5130-48G', ports: 48 },
];

test('catalog resolver: source slug is the primary match', () => {
  const result = catalog.resolveCatalogEntry({
    sourceSlug: 'cisco-c9200-24t',
    brand: 'Other vendor',
    model: 'Other model',
  }, catalog.buildIndexes(entries));
  assert.equal(result.strategy, 'source-slug');
  assert.equal(result.entry.model, 'C9200-24T');
});

test('catalog resolver: normalized name is a controlled fallback', () => {
  const result = catalog.resolveCatalogEntry({ brand: 'HPE', model: '5130_48G' }, catalog.buildIndexes(entries));
  assert.equal(result.strategy, 'normalized-name');
  assert.equal(result.entry.slug, 'hpe-5130-48g');
});

test('catalog resolver: aliases resolve only to an existing source slug', () => {
  const result = catalog.resolveCatalogEntry({ brand: 'Hewlett-Packard', model: '5130-48G' }, catalog.buildIndexes(entries), {
    'hewlett-packard-5130-48g': 'hpe-5130-48g',
  });
  assert.equal(result.strategy, 'alias');
  assert.equal(result.alias, 'hpe-5130-48g');
});

test('catalog resolver: unknown model remains unmatched', () => {
  const result = catalog.resolveCatalogEntry({ sourceSlug: 'unknown-device', brand: 'Unknown', model: 'X' }, catalog.buildIndexes(entries));
  assert.equal(result.strategy, 'unmatched');
  assert.equal(result.entry, null);
});

test('catalog resolver: duplicate normalized names stay ambiguous', () => {
  const indexes = catalog.buildIndexes([
    { slug: 'vendor-a-model-x', brand: 'Vendor', model: 'Model X', ports: 8 },
    { slug: 'vendor-b-model-x', brand: 'Vendor', model: 'Model X', ports: 16 },
  ]);
  const result = catalog.resolveCatalogEntry({ brand: 'Vendor', model: 'Model X' }, indexes);
  assert.equal(result.strategy, 'ambiguous');
  assert.equal(result.entry, null);
  assert.equal(indexes.duplicates.length, 1);
});
