'use strict';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, ' ')
    .replace(/[^a-z0-9 .+/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return normalize(value).replace(/[ /+]+/g, '-').replace(/-+/g, '-');
}

function nameKey(brand, model) {
  return normalize(brand) + ':' + normalize(model);
}

function sourceSlugOf(entry) {
  return text(entry && (entry.sourceSlug || entry.slug));
}

function manufacturerSlugOf(entry) {
  return text(entry && (entry.brandSlug || (entry.manufacturer && entry.manufacturer.slug) || entry.brand));
}

function buildIndexes(entries) {
  const bySourceSlug = Object.create(null);
  const byManufacturerSlug = Object.create(null);
  const byName = Object.create(null);
  const ambiguous = {
    sourceSlug: Object.create(null),
    manufacturerSlug: Object.create(null),
    name: Object.create(null),
  };
  const duplicates = [];
  const add = (index, key, entry, kind) => {
    if (!key) return;
    if (index[key] && index[key] !== entry) {
      ambiguous[kind][key] = true;
      delete index[key];
      duplicates.push({ kind, key });
      return;
    }
    if (!ambiguous[kind][key]) index[key] = entry;
  };
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const sourceSlug = sourceSlugOf(entry);
    const brand = text(entry.brand || (entry.manufacturer && entry.manufacturer.name));
    const model = text(entry.model);
    if (sourceSlug) add(bySourceSlug, slug(sourceSlug), entry, 'sourceSlug');
    const manufacturerSlug = manufacturerSlugOf(entry);
    if (manufacturerSlug && sourceSlug) add(byManufacturerSlug, slug(manufacturerSlug) + ':' + slug(sourceSlug), entry, 'manufacturerSlug');
    if (brand && model) add(byName, nameKey(brand, model), entry, 'name');
  }
  return { bySourceSlug, byManufacturerSlug, byName, ambiguous, duplicates };
}

function aliasTarget(aliases, brand, model, sourceSlug) {
  if (!aliases || typeof aliases !== 'object') return '';
  const candidates = [
    sourceSlug && slug(sourceSlug),
    nameKey(brand, model),
    slug(brand + '-' + model),
  ].filter(Boolean);
  for (const key of candidates) {
    const target = aliases[key];
    if (typeof target === 'string' && target.trim()) return target.trim();
  }
  return '';
}

function resolveCatalogEntry(input, indexes, aliases) {
  const value = input || {};
  const idx = indexes || {};
  const sourceSlug = text(value.sourceSlug || value.deviceTypeSlug || value.slug);
  const brand = text(value.brand || value.manufacturerName || (value.manufacturer && value.manufacturer.name));
  const manufacturerSlug = text(value.brandSlug || value.manufacturerSlug || (value.manufacturer && value.manufacturer.slug));
  const model = text(value.model);

  const sourceKey = sourceSlug && slug(sourceSlug);
  let ambiguousReason = sourceKey && idx.ambiguous && idx.ambiguous.sourceSlug[sourceKey] ? 'source-slug' : '';
  let entry = sourceKey && idx.bySourceSlug && idx.bySourceSlug[sourceKey];
  if (entry) return { entry, strategy: 'source-slug', sourceSlug: sourceSlugOf(entry) };

  const manufacturerKey = sourceSlug && manufacturerSlug && slug(manufacturerSlug) + ':' + slug(sourceSlug);
  if (!ambiguousReason && manufacturerKey && idx.ambiguous && idx.ambiguous.manufacturerSlug[manufacturerKey]) ambiguousReason = 'manufacturer-slug';
  entry = manufacturerKey && idx.byManufacturerSlug && idx.byManufacturerSlug[manufacturerKey];
  if (entry) return { entry, strategy: 'manufacturer-slug', sourceSlug: sourceSlugOf(entry) };

  const modelKey = brand && model && nameKey(brand, model);
  if (!ambiguousReason && modelKey && idx.ambiguous && idx.ambiguous.name[modelKey]) ambiguousReason = 'normalized-name';
  if (!ambiguousReason) entry = modelKey && idx.byName && idx.byName[modelKey];
  if (entry) return { entry, strategy: 'normalized-name', sourceSlug: sourceSlugOf(entry) };

  const target = aliasTarget(aliases, brand, model, sourceSlug);
  entry = target && idx.bySourceSlug && idx.bySourceSlug[slug(target)];
  if (entry) return { entry, strategy: 'alias', sourceSlug: sourceSlugOf(entry), alias: target };

  return ambiguousReason
    ? { entry: null, strategy: 'ambiguous', reason: ambiguousReason, sourceSlug: sourceSlug || null }
    : { entry: null, strategy: 'unmatched', sourceSlug: sourceSlug || null };
}

module.exports = {
  normalize,
  slug,
  nameKey,
  buildIndexes,
  resolveCatalogEntry,
};
