'use strict';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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

// ---------------------------------------------------------------------------
// model-core: the fuzzy stage (Phase 1). OPT-IN via opts.fuzzy so the DCIM
// import path (exact-only) is untouched; only the scan/discovery path asks
// for it. The DISTINCTIVE part of a model is the digit-bearing designation,
// NOT the brand / OS / marketing words that precede it ("Cisco IOS Software,
// Catalyst 2960" -> "2960"). Conservative on purpose: a wrong 'exact' is worse
// than an honest 'unmatched', so version strings, part numbers and OS banners
// must never produce a core.
// ---------------------------------------------------------------------------
function _isVersionToken(t) {
  // 15.2 / 5.4.0 / 15.24e7 -> a version, never a hardware model core.
  return /[0-9]\.[0-9]/.test(t);
}

function _isModelToken(t) {
  return t.length >= 2 && /[0-9]/.test(t) && !_isVersionToken(t);
}

// Raw core: the token run from the first model-token onward, with leading
// pure-alpha tokens (brand / OS / marketing) dropped. '' when there is no
// model-token to anchor on (pure text, a version, a bare word).
function modelCore(value) {
  const s = slug(value);
  if (!s) return '';
  const tokens = s.split('-').filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[a-z]+$/.test(tokens[i])) i++;
  if (i >= tokens.length) return '';
  if (!_isModelToken(tokens[i])) return '';
  return tokens.slice(i).join('-');
}

// Alt core (INPUT ONLY): strip a short leading alpha CODE glued to the first
// digit-token — the Cisco 'WS-C2960-24TC-L' vs catalog 'Catalyst 2960-24TC-L'
// case. The catalog is indexed by the RAW core only, so this variant can only
// match when the catalog core genuinely carries no such prefix: no loss of
// specificity, no cross-vendor collision (a 'GS1900-24E' catalog core stays
// 'gs1900-24e', so a stripped '1900-24e' finds nothing).
function modelCoreAlt(core) {
  if (!core) return '';
  const tokens = core.split('-');
  const head = tokens[0];
  const stripped = head.replace(/^[a-z]{1,3}(?=[0-9])/, '');
  if (stripped === head || !/[0-9]/.test(stripped)) return '';
  return [stripped].concat(tokens.slice(1)).join('-');
}

function buildIndexes(entries) {
  const bySourceSlug = Object.create(null);
  const byManufacturerSlug = Object.create(null);
  const byName = Object.create(null);
  const byPartNumber = Object.create(null);
  const byModelCore = Object.create(null);
  const ambiguous = {
    sourceSlug: Object.create(null),
    manufacturerSlug: Object.create(null),
    name: Object.create(null),
    partNumber: Object.create(null),
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
    const partNumber = text(entry.partNumber || entry.part_number);
    if (partNumber) add(byPartNumber, slug(partNumber), entry, 'partNumber');
    const core = modelCore(model);
    if (core) (byModelCore[core] = byModelCore[core] || []).push(entry);
  }
  return { bySourceSlug, byManufacturerSlug, byName, byPartNumber, byModelCore, ambiguous, duplicates };
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

// The core is the shared token-root of >=2 catalog variants ("2960" ->
// 2960-24tc-l + 2960-48tc-l). Prefix at a TOKEN boundary only, so "300" never
// collides with "3005-x". Returns the source-slugs of the variants.
function _familyCandidates(root, byModelCore) {
  const out = [];
  if (!root) return out;
  const prefix = root + '-';
  for (const key of Object.keys(byModelCore)) {
    if (key === root || key.startsWith(prefix)) {
      for (const e of byModelCore[key]) {
        const s = sourceSlugOf(e);
        if (s) out.push(s);
      }
    }
  }
  return out;
}

function _resolveModelCore(model, idx) {
  const byCore = idx.byModelCore;
  if (!byCore) return null;
  const core = modelCore(model);
  if (!core) return null;
  const alt = modelCoreAlt(core);

  // 1) Exact: the core (or its alt) lands on catalog cores. A single hit is
  //    'exact'; several entries under the same core are a FAMILY, never a coin
  //    toss — and a family carries NO entry, so ports/rackU can't auto-fill.
  //    A BARE pure-numeric core ("9000", "220") is never a reliable exact — the
  //    brand word got dropped and the number collides across vendors ("Nexus
  //    9000" vs "ION 9000") — so it is barred from exact and left to the family
  //    step, which resolves it to >=2 variants or to unmatched.
  for (const key of [core, alt]) {
    if (!key || /^[0-9]+$/.test(key)) continue;
    const hits = byCore[key];
    if (hits && hits.length === 1) {
      return { entry: hits[0], strategy: 'model-core', confidence: 'exact', sourceSlug: sourceSlugOf(hits[0]) };
    }
    if (hits && hits.length > 1) {
      return { entry: null, strategy: 'model-core', confidence: 'family', sourceSlug: null,
               candidates: hits.map(sourceSlugOf).filter(Boolean).sort() };
    }
  }

  // 2) Family by token-prefix: the core is the shared root of >=2 variants.
  const cands = _familyCandidates(core, byCore);
  const altCands = alt ? _familyCandidates(alt, byCore) : [];
  const merged = altCands.length > cands.length ? altCands : cands;
  if (merged.length >= 2) {
    return { entry: null, strategy: 'model-core', confidence: 'family', sourceSlug: null, candidates: merged.slice().sort() };
  }
  return null;
}

function resolveCatalogEntry(input, indexes, aliases, opts) {
  const value = input || {};
  const idx = indexes || {};
  const fuzzy = !!(opts && opts.fuzzy);
  const sourceSlug = text(value.sourceSlug || value.deviceTypeSlug || value.slug);
  const brand = text(value.brand || value.manufacturerName || (value.manufacturer && value.manufacturer.name));
  const manufacturerSlug = text(value.brandSlug || value.manufacturerSlug || (value.manufacturer && value.manufacturer.slug));
  const model = text(value.model);

  const sourceKey = sourceSlug && slug(sourceSlug);
  let ambiguousReason = sourceKey && idx.ambiguous && idx.ambiguous.sourceSlug[sourceKey] ? 'source-slug' : '';
  let entry = sourceKey && idx.bySourceSlug && idx.bySourceSlug[sourceKey];
  if (entry) return { entry, strategy: 'source-slug', confidence: 'exact', sourceSlug: sourceSlugOf(entry) };

  const manufacturerKey = sourceSlug && manufacturerSlug && slug(manufacturerSlug) + ':' + slug(sourceSlug);
  if (!ambiguousReason && manufacturerKey && idx.ambiguous && idx.ambiguous.manufacturerSlug[manufacturerKey]) ambiguousReason = 'manufacturer-slug';
  entry = manufacturerKey && idx.byManufacturerSlug && idx.byManufacturerSlug[manufacturerKey];
  if (entry) return { entry, strategy: 'manufacturer-slug', confidence: 'exact', sourceSlug: sourceSlugOf(entry) };

  const modelKey = brand && model && nameKey(brand, model);
  if (!ambiguousReason && modelKey && idx.ambiguous && idx.ambiguous.name[modelKey]) ambiguousReason = 'normalized-name';
  if (!ambiguousReason) entry = modelKey && idx.byName && idx.byName[modelKey];
  if (entry) return { entry, strategy: 'normalized-name', confidence: 'exact', sourceSlug: sourceSlugOf(entry) };

  const target = aliasTarget(aliases, brand, model, sourceSlug);
  entry = target && idx.bySourceSlug && idx.bySourceSlug[slug(target)];
  if (entry) return { entry, strategy: 'alias', confidence: 'exact', sourceSlug: sourceSlugOf(entry), alias: target };

  // ---- fuzzy stage (scan path only) ---------------------------------------
  // The virtual verdict is CONSUMED, never re-derived: the classifier already
  // flagged a VM, and a rack template must never land on it. This short-circuits
  // BEFORE model-core so a version string can't produce a near-miss.
  if (fuzzy) {
    if (value.virtual) return { entry: null, strategy: 'virtual', confidence: null, sourceSlug: null };
    // Part number: many devices report their ORDER CODE as entPhysicalModelName
    // ("WS-C2960-24TC-L", "J9776A", "ISR4331/K9", "N9K-C93180YC-EX"). That code
    // is the catalog partNumber verbatim — an EXACT key, no collisions — so it
    // beats the fuzzy core. Vendor-neutral: any entry's partNumber, no per-brand
    // rule. Never invents: only a verbatim key hit resolves.
    const pn = idx.byPartNumber;
    if (pn) {
      const pnValue = text(value.partNumber || value.part_number);
      for (const key of [pnValue && slug(pnValue), model && slug(model)]) {
        const hit = key && pn[key];
        if (hit) return { entry: hit, strategy: 'part-number', confidence: 'exact', sourceSlug: sourceSlugOf(hit) };
      }
    }
    const mc = _resolveModelCore(model, idx);
    if (mc) return mc;
  }

  return ambiguousReason
    ? { entry: null, strategy: 'ambiguous', confidence: null, reason: ambiguousReason, sourceSlug: sourceSlug || null }
    : { entry: null, strategy: 'unmatched', confidence: null, sourceSlug: sourceSlug || null };
}

module.exports = {
  normalize,
  slug,
  nameKey,
  modelCore,
  modelCoreAlt,
  buildIndexes,
  resolveCatalogEntry,
};
