#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildTemplate, roleOf, parseDeviceType } = require('../tools/import-device-types');
const { deriveOutletGroups } = require('../lib/power-groups');

const DEFAULT_SOURCE = 'https://github.com/netbox-community/devicetype-library.git';
const ROOT = path.resolve(__dirname, '..');
const MAX_FILES = 25000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DEPTH = 12;
const DOWNLOAD_TIMEOUT_MS = 120000;

function flag(name) { return process.argv.includes(name); }
function option(name, fallback) {
  const prefix = '--' + name + '=';
  const arg = process.argv.find(value => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}
function log(message) { if (!flag('--quiet')) console.log(message); }
function fail(message) { console.error('Device-type updater: ' + message); process.exitCode = 1; }

function jsonWriteAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(file, { force: true }); } catch (_) { /* best effort */ }
    fs.renameSync(temp, file);
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitHead(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return 'local';
  }
}

function githubRepo(source) {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const repo = parts[1].replace(/\.git$/i, '');
    if (!parts[0] || !repo) return null;
    return { owner: parts[0], repo };
  } catch (_) {
    return null;
  }
}

function gitClone(url, ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-device-types-'));
  const sparse = !!githubRepo(url);
  try {
    const cloneArgs = sparse
      ? ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--no-checkout', url, dir]
      : ['clone', '--depth', '1', url, dir];
    execFileSync('git', cloneArgs, {
      stdio: 'pipe',
      timeout: DOWNLOAD_TIMEOUT_MS,
      windowsHide: true,
    });
    if (sparse) {
      execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', '--no-cone', 'device-types/**/*.yaml', 'device-types/**/*.yml', 'LICENSE.txt', 'README.md'], {
        stdio: 'pipe',
        timeout: DOWNLOAD_TIMEOUT_MS,
        windowsHide: true,
      });
    }
    const checkoutArgs = ['-C', dir, 'checkout', '--detach'];
    if (ref) checkoutArgs.push(ref);
    execFileSync('git', checkoutArgs, { stdio: 'pipe', timeout: DOWNLOAD_TIMEOUT_MS, windowsHide: true });
    return { dir, remove: true, sourceRef: gitHead(dir), transport: sparse ? 'git-sparse' : 'git' };
  } catch (error) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    throw new Error('impossibile acquisire la sorgente CC0: ' + String(error.message || error).trim(), { cause: error });
  }
}

async function acquireSource(source, ref) {
  return gitClone(source, ref);
}

function sourceFiles(inputDir, limits) {
  const maxFiles = limits && limits.maxFiles || MAX_FILES;
  const maxBytes = limits && limits.maxBytes || MAX_FILE_BYTES;
  const maxDepth = limits && limits.maxDepth || MAX_DEPTH;
  const root = path.resolve(inputDir);
  const out = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth) throw new Error('profondità massima della sorgente superata');
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error('symlink non consentito nella sorgente: ' + item.name);
      if (item.isDirectory()) { visit(file, depth + 1); continue; }
      if (!item.isFile() || !/\.ya?ml$/i.test(item.name)) continue;
      const stat = fs.statSync(file);
      if (stat.size > maxBytes) throw new Error('file YAML oltre il limite consentito: ' + path.relative(root, file));
      out.push(file);
      if (out.length > maxFiles) throw new Error('numero massimo di file della sorgente superato');
    }
  };
  visit(root, 0);
  return out.sort((a, b) => a.localeCompare(b));
}

function manufacturerSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function bool(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function readJson(file, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value == null ? fallback : value;
  } catch (_) { return fallback; }
}

function controlMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
  return value;
}

function controlFor(map, sourceSlug) {
  return map[sourceSlug] || map[manufacturerSlug(sourceSlug)] || null;
}

function exclusionSet(value) {
  if (Array.isArray(value)) return new Set(value.map(String));
  if (value && typeof value === 'object') return new Set(Object.keys(value).filter(k => value[k] !== false));
  return new Set();
}

function shallowMerge(base, patch) {
  const out = Object.assign({}, base);
  for (const key of ['ports', 'rackU', 'isFullDepth']) {
    if (patch && patch[key] != null) out[key] = patch[key];
  }
  if (patch && patch.counts && typeof patch.counts === 'object') out.counts = Object.assign({}, out.counts || {}, patch.counts);
  if (patch && patch.frontPanel && typeof patch.frontPanel === 'object') out.frontPanel = Object.assign({}, out.frontPanel || {}, patch.frontPanel);
  return out;
}

function canonicalModel(dt, file, inputDir, template) {
  const relative = path.relative(inputDir, file).replace(/\\/g, '/');
  const raw = {
    slug: dt.slug || '',
    manufacturer: dt.manufacturer || '',
    model: dt.model || '',
    part_number: dt.part_number || '',
    u_height: dt.u_height || '',
    is_full_depth: dt.is_full_depth || '',
    interfaces: Array.isArray(dt.interfaces) ? dt.interfaces : [],
    module_bays: Array.isArray(dt['module-bays']) ? dt['module-bays'] : [],
    power_outlets: Array.isArray(dt['power-outlets']) ? dt['power-outlets'] : [],
    console_server_ports: Array.isArray(dt['console-server-ports']) ? dt['console-server-ports'] : [],
  };
  return {
    sourceSlug: dt.slug || path.basename(file).replace(/\.ya?ml$/i, '').toLowerCase(),
    manufacturer: { name: dt.manufacturer || '', slug: manufacturerSlug(dt.manufacturer) },
    model: dt.model || '',
    partNumber: dt.part_number || '',
    uHeight: template.rackU,
    isFullDepth: bool(dt.is_full_depth),
    interfaces: raw.interfaces,
    moduleBays: raw.module_bays,
    powerOutlets: raw.power_outlets,
    consoleServerPorts: raw.console_server_ports,
    capabilities: template.counts,
    provenance: {
      sourceFile: relative,
      sourceHash: sha256(JSON.stringify(raw)),
    },
    raw,
  };
}

// Le PRESE nel catalogo a runtime. Fin qui il catalogo ridotto teneva solo le
// porte di rete: un UPS ci arrivava con zero prese, e «Applica modello» su un
// gruppo di continuita' non gli dava nulla — mentre il canonico le descrive una
// per una. Si travasano, con un tetto di 48 (lo stesso dell'import DCIM), e il
// GRUPPO si legge dal nome quando il costruttore ce l'ha scritto: «Group 2 -
// Output 1» dice gruppo 2, «Outlet 5» non dice niente e resta senza.
function runtimePowerOutlets(dt) {
  const raw = Array.isArray(dt['power-outlets']) ? dt['power-outlets'] : [];
  const outlets = raw.slice(0, 48).map(o => {
    const out = { name: String((o && o.name) || '').trim() };
    const type = String((o && o.type) || '').trim();
    if (type) out.type = type;
    return out;
  }).filter(o => o.name);
  if (!outlets.length) return null;
  const derived = deriveOutletGroups(outlets);
  derived.assign.forEach((id, i) => { if (id && outlets[i]) outlets[i].group = id; });
  return { powerOutlets: outlets, powerGroups: derived.groups };
}

function runtimeModel(dt, template) {
  const power = runtimePowerOutlets(dt);
  return {
    slug: dt.slug || '',
    sourceSlug: dt.slug || '',
    brand: dt.manufacturer || '',
    brandSlug: manufacturerSlug(dt.manufacturer),
    model: dt.model || '',
    partNumber: dt.part_number || '',
    ports: template.ports,
    rackU: template.rackU,
    isFullDepth: bool(dt.is_full_depth),
    frontPanel: template.frontPanel,
    counts: template.counts,
    // Assenti quando non ce ne sono: il catalogo non porta chiavi vuote in giro
    // per 5296 modelli.
    ...(power ? { powerOutlets: power.powerOutlets } : {}),
    ...(power && power.powerGroups.length ? { powerGroups: power.powerGroups } : {}),
  };
}

function build(inputDir, useRoles, options) {
  options = options || {};
  const files = sourceFiles(inputDir, options.limits);
  const canonical = [];
  const runtime = [];
  const dropped = [];
  const fileDigests = [];
  const seenSlugs = new Set();
  const overrides = controlMap(options.overrides);
  const exclusions = exclusionSet(options.exclusions);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const dt = parseDeviceType(text);
    const sourceSlug = String(dt.slug || path.basename(file).replace(/\.ya?ml$/i, '').toLowerCase()).trim();
    if (!sourceSlug || !String(dt.manufacturer || '').trim() || !String(dt.model || '').trim()) {
      throw new Error('device-type YAML incompleto: ' + path.relative(inputDir, file));
    }
    if (seenSlugs.has(sourceSlug)) throw new Error('source slug duplicato: ' + sourceSlug);
    seenSlugs.add(sourceSlug);
    const template = buildTemplate(dt);
    fileDigests.push({ file: path.relative(inputDir, file).replace(/\\/g, '/'), sha256: sha256(text) });
    const role = roleOf(dt, template.counts);
    canonical.push(canonicalModel(dt, file, inputDir, template));
    if (exclusions.has(sourceSlug)) {
      dropped.push({ slug: sourceSlug, model: dt.model || '', role: role.role, reason: 'manual-exclusion' });
      continue;
    }
    if (useRoles && !role.keep) {
      dropped.push({ slug: sourceSlug, model: dt.model || '', role: role.role, reason: 'role-filter' });
      continue;
    }
    runtime.push(shallowMerge(runtimeModel(dt, template), controlFor(overrides, sourceSlug)));
  }
  runtime.sort((a, b) => (a.brand + a.model).localeCompare(b.brand + b.model));
  canonical.sort((a, b) => a.sourceSlug.localeCompare(b.sourceSlug));
  return { files, canonical, runtime, dropped, fileDigests, duplicates: [] };
}

function modelFingerprint(model) {
  return JSON.stringify({
    manufacturer: model.manufacturer,
    model: model.model,
    partNumber: model.partNumber,
    uHeight: model.uHeight,
    isFullDepth: model.isFullDepth,
    interfaces: model.interfaces,
    moduleBays: model.moduleBays,
    powerOutlets: model.powerOutlets,
    consoleServerPorts: model.consoleServerPorts,
    capabilities: model.capabilities,
  });
}

function runtimeFingerprint(model) {
  return JSON.stringify({
    brand: model.brand,
    model: model.model,
    partNumber: model.partNumber,
    ports: model.ports,
    rackU: model.rackU,
    isFullDepth: model.isFullDepth,
    frontPanel: model.frontPanel,
    counts: model.counts,
    powerOutlets: model.powerOutlets,
    powerGroups: model.powerGroups,
  });
}

function diffCatalog(previousCanonical, nextCanonical, previousRuntime, nextRuntime) {
  const oldMap = new Map((previousCanonical || []).map(x => [x.sourceSlug, x]));
  const newMap = new Map((nextCanonical || []).map(x => [x.sourceSlug, x]));
  const oldRuntime = new Map((previousRuntime || []).map(x => [x.sourceSlug || x.slug, x]));
  const newRuntime = new Map((nextRuntime || []).map(x => [x.sourceSlug || x.slug, x]));
  const added = [], removed = [], metadataChanged = [], templateChanged = [], excludedRuntime = [];
  for (const [key, model] of newMap) {
    if (!oldMap.has(key)) { added.push(key); continue; }
    if (modelFingerprint(oldMap.get(key)) !== modelFingerprint(model)) metadataChanged.push(key);
    if (oldRuntime.has(key) && newRuntime.has(key) && runtimeFingerprint(oldRuntime.get(key)) !== runtimeFingerprint(newRuntime.get(key))) templateChanged.push(key);
    if (oldRuntime.has(key) !== newRuntime.has(key)) excludedRuntime.push(key);
  }
  for (const key of oldMap.keys()) if (!newMap.has(key)) removed.push(key);
  return {
    added: added.sort(),
    removed: removed.sort(),
    metadataChanged: metadataChanged.sort(),
    templateChanged: templateChanged.sort(),
    excludedRuntime: excludedRuntime.sort(),
    counts: {
      added: added.length,
      removed: removed.length,
      metadataChanged: metadataChanged.length,
      templateChanged: templateChanged.length,
      excludedRuntime: excludedRuntime.length,
      changed: metadataChanged.length + templateChanged.length,
    },
  };
}

function detectLicense(inputDir, source) {
  if (/netbox-community\/devicetype-library/i.test(source)) return 'CC0-1.0';
  for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'README.md']) {
    const file = path.join(inputDir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/CC0(?:-1\.0)?|Creative Commons Zero|public domain/i.test(text)) return 'CC0-1.0';
  }
  return 'unknown';
}

// ── Ricostruzione del solo catalogo RUNTIME dal canonico (--from-canonical) ──
// Il canonico contiene GIA' tutto quello che serve: e' lui la fotografia della
// sorgente. Quando cambia la PROIEZIONE — com'e' successo aggiungendo le prese —
// non c'e' motivo di riscaricare 6000 file YAML per riscrivere un file che si
// ricava da un altro che hai gia' sul disco. Non tocca canonico, manifesto e
// diff: la sorgente non e' cambiata, e dire il contrario sarebbe una bugia
// scritta in un file di provenienza.
function rebuildRuntimeFromCanonical(canonicalPath, options) {
  const doc = readJson(canonicalPath, null);
  const models = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.models) ? doc.models : null);
  if (!models || !models.length) throw new Error('canonico assente o vuoto: ' + canonicalPath);
  const overrides = controlMap(options && options.overrides);
  const exclusions = exclusionSet(options && options.exclusions);
  const useRoles = !(options && options.all);
  const runtime = [];
  const dropped = [];
  for (const m of models) {
    const raw = (m && m.raw) || {};
    // Le chiavi tornano quelle del YAML originale: buildTemplate e roleOf leggono
    // 'interfaces', 'module-bays', 'power-outlets', 'console-server-ports'.
    const dt = {
      slug: m.sourceSlug || raw.slug || '',
      manufacturer: raw.manufacturer || (m.manufacturer && m.manufacturer.name) || '',
      model: raw.model || m.model || '',
      part_number: raw.part_number || m.partNumber || '',
      u_height: raw.u_height,
      is_full_depth: raw.is_full_depth,
      interfaces: raw.interfaces || m.interfaces || [],
      'module-bays': raw.module_bays || m.moduleBays || [],
      'power-outlets': raw.power_outlets || m.powerOutlets || [],
      'console-server-ports': raw.console_server_ports || m.consoleServerPorts || [],
    };
    const sourceSlug = String(dt.slug || '').trim();
    if (!sourceSlug || !String(dt.manufacturer).trim() || !String(dt.model).trim()) continue;
    const template = buildTemplate(dt);
    const role = roleOf(dt, template.counts);
    if (exclusions.has(sourceSlug)) { dropped.push(sourceSlug); continue; }
    if (useRoles && !role.keep) { dropped.push(sourceSlug); continue; }
    runtime.push(shallowMerge(runtimeModel(dt, template), controlFor(overrides, sourceSlug)));
  }
  runtime.sort((a, b) => (a.brand + a.model).localeCompare(b.brand + b.model));
  return { runtime, dropped, models: models.length };
}

async function main() {
  const input = option('input', process.env.INFRANET_DEVICE_TYPES_SOURCE_DIR || '');
  const source = option('source', process.env.INFRANET_DEVICE_TYPES_SOURCE_URL || DEFAULT_SOURCE);
  const ref = option('ref', process.env.INFRANET_DEVICE_TYPES_SOURCE_REF || '');
  const canonicalPath = path.resolve(ROOT, option('canonical', 'data/device-types-canonical.json'));
  const catalogPath = path.resolve(ROOT, option('catalog', 'data/device-types.json'));
  const manifestPath = path.resolve(ROOT, option('manifest', 'data/device-types-manifest.json'));
  const diffPath = path.resolve(ROOT, option('diff', 'data/device-types-diff.json'));
  const aliasesPath = path.resolve(ROOT, option('aliases', 'data/device-types-aliases.json'));
  const overridesPath = path.resolve(ROOT, option('overrides', 'data/device-types-overrides.json'));
  const exclusionsPath = path.resolve(ROOT, option('exclusions', 'data/device-types-exclusions.json'));
  const reportPath = option('report', '');
  const useRoles = !flag('--all');
  if (flag('--from-canonical')) {
    const controls = {
      overrides: readJson(overridesPath, {}),
      exclusions: readJson(exclusionsPath, []),
    };
    const result = rebuildRuntimeFromCanonical(canonicalPath, { overrides: controls.overrides, exclusions: controls.exclusions, all: !useRoles });
    const previousRuntime = readJson(catalogPath, []);
    fs.writeFileSync(catalogPath, JSON.stringify(result.runtime, null, 2) + '\n');
    const withOutlets = result.runtime.filter(m => Array.isArray(m.powerOutlets) && m.powerOutlets.length).length;
    const withGroups = result.runtime.filter(m => Array.isArray(m.powerGroups) && m.powerGroups.length).length;
    log('Ricostruito dal canonico: ' + result.runtime.length + ' modelli (prima ' +
      (Array.isArray(previousRuntime) ? previousRuntime.length : 0) + '), esclusi ' + result.dropped.length +
      ' | con prese: ' + withOutlets + ' | con gruppi letti dal nome: ' + withGroups);
    log('Manifesto e diff NON toccati: la sorgente non e cambiata, solo la proiezione runtime.');
    return;
  }
  let acquired = null;
  try {
    acquired = input ? { dir: path.resolve(input), remove: false, sourceRef: 'local' } : await acquireSource(source, ref);
    if (!fs.existsSync(acquired.dir)) throw new Error('directory sorgente non trovata: ' + acquired.dir);
    const controls = {
      aliases: readJson(aliasesPath, {}),
      overrides: readJson(overridesPath, {}),
      exclusions: readJson(exclusionsPath, []),
    };
    const result = build(acquired.dir, useRoles, { overrides: controls.overrides, exclusions: controls.exclusions });
    if (!result.files.length || !result.runtime.length) throw new Error('nessun device-type valido prodotto');
    const sourceRef = acquired.sourceRef || gitHead(acquired.dir);
    const sourceDigest = sha256(JSON.stringify(result.fileDigests));
    const previous = readJson(manifestPath, null);
    const previousCanonical = readJson(canonicalPath, { models: [] });
    const previousRuntime = readJson(catalogPath, []);
    const previousModels = Array.isArray(previousCanonical) ? previousCanonical : previousCanonical.models;
    const diff = diffCatalog(previousModels || [], result.canonical, Array.isArray(previousRuntime) ? previousRuntime : [], result.runtime);
    const license = detectLicense(acquired.dir, source);
    if (flag('--strict-license') && license !== 'CC0-1.0') throw new Error('licenza CC0 non verificata nella sorgente');
    const previousExclusions = previous ? Number(previous.excludedModels || 0) : null;
    const maxExclusionDelta = Number(option('max-exclusion-delta', '500'));
    if (previousExclusions != null && Math.abs(result.dropped.length - previousExclusions) > maxExclusionDelta) {
      throw new Error('variazione anomala delle esclusioni: ' + previousExclusions + ' → ' + result.dropped.length);
    }
    const vendors = new Set(result.runtime.map(model => model.brand).filter(Boolean));
    const manifest = {
      schemaVersion: 1,
      sourceRef,
      sourceSha256: sourceDigest,
      source: { name: 'netbox-device-type-library', url: source, ref: sourceRef, license },
      generatedAt: new Date().toISOString(),
      canonicalModels: result.canonical.length,
      catalogModels: result.runtime.length,
      catalogVendors: vendors.size,
      excludedModels: result.dropped.length,
      sourceFiles: result.files.length,
      aliasCount: Object.keys(controls.aliases || {}).length,
      overrideCount: Object.keys(controls.overrides || {}).length,
      exclusionCount: result.dropped.filter(x => x.reason === 'manual-exclusion').length,
      diff: diff.counts,
      previous: previous ? { sourceRef: previous.sourceRef || (previous.source && previous.source.ref), sourceSha256: previous.sourceSha256 } : null,
    };
    const canonicalDocument = { schemaVersion: 1, source: manifest.source, generatedAt: manifest.generatedAt, models: result.canonical };
    const diffDocument = { schemaVersion: 1, generatedAt: manifest.generatedAt, sourceRef, sourceSha256: sourceDigest, ...diff, dropped: result.dropped };
    log(`Sorgente: ${sourceRef} | file: ${result.files.length} | canonici: ${result.canonical.length} | runtime: ${result.runtime.length} | esclusi: ${result.dropped.length}`);
    log(`Diff: +${diff.counts.added} -${diff.counts.removed} metadata ${diff.counts.metadataChanged} template ${diff.counts.templateChanged}`);
    if (flag('--check')) {
      const previousRef = previous && (previous.sourceRef || (previous.source && previous.source.ref));
      const upToDate = !!previous && previousRef === sourceRef && previous.sourceSha256 === sourceDigest && Object.values(diff.counts).every(value => value === 0);
      log(upToDate ? 'Catalogo CC0 aggiornato.' : 'Nuova revisione del catalogo disponibile.');
      if (!upToDate) process.exitCode = 2;
      return;
    }
    if (flag('--dry')) {
      if (reportPath) jsonWriteAtomic(path.resolve(ROOT, reportPath), diffDocument);
      log('Dry run: nessun file scritto.');
      return;
    }
    jsonWriteAtomic(canonicalPath, canonicalDocument);
    jsonWriteAtomic(catalogPath, result.runtime);
    jsonWriteAtomic(manifestPath, manifest);
    jsonWriteAtomic(diffPath, diffDocument);
    if (reportPath) jsonWriteAtomic(path.resolve(ROOT, reportPath), diffDocument);
    log('Catalogo CC0 aggiornato: ' + catalogPath);
  } catch (error) {
    fail(error.message || error);
  } finally {
    if (acquired && acquired.remove) {
      try { fs.rmSync(acquired.dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
  }
}

if (require.main === module) {
  main().catch(error => fail(error.message || error));
}

module.exports = { build, canonicalModel, runtimeModel, sourceFiles, diffCatalog, detectLicense };
