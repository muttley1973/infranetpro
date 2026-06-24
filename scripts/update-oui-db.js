#!/usr/bin/env node
'use strict';

/**
 * Update OUI database from IEEE official sources.
 *
 * Downloads three IEEE registries (MA-L 24-bit, MA-M 28-bit, MA-S 36-bit) and
 * the legacy IAB registry, deduplicates by prefix, normalizes vendor strings
 * and writes the result to `data/oui-db.json`.
 *
 * Zero external dependencies: only Node built-ins (https, fs, path, process).
 *
 * Usage:
 *   node scripts/update-oui-db.js           # download + write data/oui-db.json
 *   node scripts/update-oui-db.js --dry     # show stats, do not write file
 *   node scripts/update-oui-db.js --quiet   # no progress logs
 *
 * Output schema (data/oui-db.json):
 *   {
 *     "version": "2026-06-07",
 *     "generatedAt": "2026-06-07T10:11:12.345Z",
 *     "sources": [{ "url": "...", "registry": "MA-L", "entries": 38123 }, ...],
 *     "entries": {
 *       "005056": { "vendor": "VMware, Inc.", "registry": "MA-L" },
 *       "001A2B3":{ "vendor": "...",          "registry": "MA-M" },
 *       ...
 *     }
 *   }
 *
 * The entry key is the prefix in uppercase hex without separators. Length:
 *   - 6 chars for MA-L (24-bit)
 *   - 7 chars for MA-M (28-bit, nibble granularity)
 *   - 9 chars for MA-S (36-bit)
 * Longer prefixes always win during lookup (handled by the OUI engine).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SOURCES = [
  { url: 'https://standards-oui.ieee.org/oui/oui.csv',     registry: 'MA-L', mask: 24 },
  { url: 'https://standards-oui.ieee.org/oui28/mam.csv',   registry: 'MA-M', mask: 28 },
  { url: 'https://standards-oui.ieee.org/oui36/oui36.csv', registry: 'MA-S', mask: 36 },
  { url: 'https://standards-oui.ieee.org/iab/iab.csv',     registry: 'IAB',  mask: 36 },
];

const OUTPUT = path.resolve(__dirname, '..', 'data', 'oui-db.json');
const TIMEOUT_MS = 60_000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry');
const QUIET   = args.has('--quiet');

function log(msg)  { if (!QUIET) console.log(msg); }
function warn(msg) { console.error(msg); }

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'InfraNet-Pro-OUI-Updater/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve(download(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout ${TIMEOUT_MS}ms for ${url}`)));
    req.on('error',   reject);
  });
}

/** Parse a CSV row supporting double-quoted fields (RFC 4180 subset). */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Normalize the IEEE assignment field (e.g. "00-50-56", "00:50:56" or "005056")
 *  to canonical uppercase hex without separators. */
function normalizePrefix(raw) {
  const hex = String(raw || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  // IEEE assignment lengths: 6 (MA-L), 7 (MA-M), 9 (MA-S / IAB)
  if (hex.length === 6 || hex.length === 7 || hex.length === 9) return hex;
  return '';
}

function cleanVendor(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '');
}

function parseCsv(csv, registry) {
  const lines = csv.split(/\r?\n/);
  const entries = [];
  // Expected IEEE header: Registry,Assignment,Organization Name,Organization Address
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;
    const prefix = normalizePrefix(cols[1]);
    const vendor = cleanVendor(cols[2]);
    if (!prefix || !vendor) continue;
    entries.push({ prefix, vendor, registry });
  }
  return entries;
}

async function fetchSource(source) {
  log(`  ↳ GET ${source.url}`);
  const csv = await download(source.url);
  const entries = parseCsv(csv, source.registry);
  log(`     ${entries.length.toLocaleString()} entries (${source.registry}, ${source.mask}-bit)`);
  return { source, entries };
}

async function main() {
  log('InfraNet OUI database updater');
  log('Sources:');
  SOURCES.forEach(s => log(`  · ${s.registry} ${s.mask}-bit → ${s.url}`));
  log('');

  const fetched = [];
  const failures = [];
  for (const source of SOURCES) {
    try {
      fetched.push(await fetchSource(source));
    } catch (error) {
      warn(`! Failed ${source.registry}: ${error.message}`);
      failures.push({ ...source, error: error.message });
    }
  }

  if (!fetched.length) {
    warn('No sources downloaded — aborting.');
    process.exit(2);
  }

  // Merge with longest-prefix preference: longer keys override shorter ones
  // when the same MAC range is covered.
  const dedupe = new Map();
  // Process from shortest to longest so the longer ones overwrite during lookup
  // refinement. We keep both in the JSON; the engine picks longest-prefix-wins.
  for (const { source, entries } of fetched) {
    for (const e of entries) {
      const existing = dedupe.get(e.prefix);
      if (!existing) { dedupe.set(e.prefix, e); continue; }
      // If same prefix listed in multiple registries, keep the most specific one
      // (longer prefix already implies longer key; for equal length keep first).
      if (existing.registry !== e.registry && existing.registry === 'IAB' && e.registry !== 'IAB') {
        dedupe.set(e.prefix, e);
      }
    }
  }

  const sources = fetched.map(({ source, entries }) => ({
    url:      source.url,
    registry: source.registry,
    mask:     source.mask,
    entries:  entries.length,
  }));

  const now = new Date();
  const version = now.toISOString().slice(0, 10);
  const out = {
    version,
    generatedAt: now.toISOString(),
    sources,
    failures: failures.length ? failures : undefined,
    counts: {
      total:        dedupe.size,
      byRegistry:   fetched.reduce((acc, { source, entries }) => { acc[source.registry] = entries.length; return acc; }, {}),
    },
    entries: Object.fromEntries(
      Array.from(dedupe.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([prefix, e]) => [prefix, { vendor: e.vendor, registry: e.registry }])
    ),
  };

  log('');
  log(`Total deduplicated entries: ${dedupe.size.toLocaleString()}`);
  if (failures.length) log(`(failed sources: ${failures.length})`);

  if (DRY_RUN) {
    log('Dry run — file not written.');
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const json = JSON.stringify(out, null, 0);
  fs.writeFileSync(OUTPUT, json + '\n', 'utf8');
  const sizeKb = Math.round(fs.statSync(OUTPUT).size / 1024);
  log(`✔ Wrote ${OUTPUT} (${sizeKb.toLocaleString()} KB)`);
}

main().catch(err => {
  warn(`Fatal: ${err && err.stack || err}`);
  process.exit(1);
});
