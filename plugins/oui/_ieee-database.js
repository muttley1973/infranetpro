'use strict';

/**
 * Catch-all OUI plugin backed by the official IEEE registry snapshot.
 *
 * The dataset is shipped as `data/oui-db.json` and refreshed via
 * `npm run update-oui` (script in `scripts/update-oui-db.js`). The plugin runs
 * at priority 0 so that vendor-specific plugins (Cisco, Apple, VMware, etc.)
 * always win when their prefixes overlap.
 *
 * Returned record is intentionally minimal: vendor + registry tag. Device-type
 * intelligence is delegated to the per-vendor plugins, which carry richer
 * `deviceType` / `tags` / `infranet` metadata.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'oui-db.json');

const priority = 0;

let _cache = null;

function _loadDb() {
  if (_cache !== null) return _cache;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = parsed && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    _cache = {
      version: parsed?.version || '',
      entries,
      prefixes: Object.keys(entries),
    };
  } catch (error) {
    _cache = { version: '', entries: {}, prefixes: [], error: error.message };
  }
  return _cache;
}

function _ouiPrefixes() {
  return _loadDb().prefixes;
}

function match() {
  // The engine has already established a prefix match against ouiPrefixes; this
  // plugin trusts any MAC that fell into one of our IEEE entries.
  return true;
}

function enrich(mac) {
  const db = _loadDb();
  const hex = String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  // Try longest-first to be deterministic even if the engine ever changes.
  for (const len of [9, 7, 6]) {
    const prefix = hex.slice(0, len);
    const entry = db.entries[prefix];
    if (entry && entry.vendor) {
      return {
        vendor: entry.vendor,
        family: `${entry.vendor} (${entry.registry || 'IEEE'})`,
        confidence: 50,
        tags: ['ieee-oui', entry.registry || 'IEEE'],
        infranet: { sourcePriority: 'mac-oui' },
      };
    }
  }
  return null;
}

module.exports = {
  ouiPrefixes: _ouiPrefixes(),
  priority,
  match,
  enrich,
};
