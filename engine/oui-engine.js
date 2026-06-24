'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_EXTENSIONS = new Set(['.js', '.cjs']);
const REQUIRED_EXPORTS = ['enrich', 'match', 'ouiPrefixes'];

const VIRTUAL_HINTS = new Set([
  'vmware', 'hyper-v', 'hyperv', 'xen', 'kvm', 'qemu', 'docker', 'virtualbox',
  'parallels', 'bhyve', 'lxc', 'wsl', 'wireguard', 'tap', 'tun', 'veth', 'virtual',
]);

// ---------------------------------------------------------------------------
// PrefixTrie: compact lookup structure built once at refresh time.
// Each node is keyed by a single uppercase hex character (16 possible children).
// Lookup walks at most 12 levels and early-exits when the path runs out, which
// matches the longest-prefix-wins semantics with O(prefix-length) cost instead
// of O(plugins * prefix-lengths) Map.get() probes.
// ---------------------------------------------------------------------------

class _TrieNode {
  constructor() {
    this.children = new Map();
    // Array of { plugin } sorted by plugin.priority desc. null when no plugin
    // claims this exact prefix.
    this.entries = null;
  }
}

class _PrefixTrie {
  constructor() {
    this.root = new _TrieNode();
  }

  add(prefix, plugin) {
    let node = this.root;
    for (let i = 0; i < prefix.length; i++) {
      const ch = prefix.charCodeAt(i);
      let next = node.children.get(ch);
      if (!next) { next = new _TrieNode(); node.children.set(ch, next); }
      node = next;
    }
    if (!node.entries) node.entries = [];
    // Insert at the first position where the existing entry has lower priority
    // so the array stays ordered priority-desc without a sort pass.
    const prio = plugin.priority || 0;
    let inserted = false;
    for (let i = 0; i < node.entries.length; i++) {
      const ePrio = node.entries[i].plugin.priority || 0;
      if (ePrio < prio) { node.entries.splice(i, 0, { plugin }); inserted = true; break; }
    }
    if (!inserted) node.entries.push({ plugin });
  }

  /**
   * Walk the hex string; collect every node that carries entries along the
   * path. Returned array is ordered longest-prefix-first. Empty when no
   * prefix in the trie matches.
   */
  matchPath(hex) {
    const result = [];
    let node = this.root;
    for (let i = 0; i < hex.length; i++) {
      const ch = hex.charCodeAt(i);
      const next = node.children.get(ch);
      if (!next) break;
      node = next;
      if (node.entries) {
        // Lazy-built prefix: only materialize when actually used downstream.
        result.push({ prefixEnd: i + 1, entries: node.entries });
      }
    }
    if (result.length > 1) result.reverse(); // longest-first
    return result;
  }
}

/**
 * @typedef {Object} OuiContext
 * Optional discovery evidences a plugin may use to refine its enrichment.
 * @property {string=} descr
 * @property {string=} hostname
 * @property {string=} vendor
 * @property {string=} httpTitle
 * @property {string=} httpsTitle
 * @property {string=} netbiosName
 * @property {string=} netbiosGroup
 * @property {Array<Object|string>=} services
 * @property {string=} source
 */

/**
 * @typedef {Object} OuiRecord
 * @property {'found'} status
 * @property {string} mac
 * @property {string} normalizedMac
 * @property {string} prefix
 * @property {number} prefixLength
 * @property {string} vendor
 * @property {string=} family
 * @property {string=} deviceType
 * @property {string[]=} tags
 * @property {boolean=} isVirtual
 * @property {boolean=} isLocallyAdministered
 * @property {boolean=} isMulticast
 * @property {number=} confidence
 * @property {Object=} infranet
 * @property {{ plugin:string, prefix:string, priority:number }} source
 */

/**
 * @typedef {Object} OuiNotFound
 * @property {'not_found'} status
 * @property {string} mac
 * @property {string=} normalizedMac
 * @property {string} reason
 */

/**
 * @typedef {Object} OuiPlugin
 * @property {string|string[]} ouiPrefixes  one or more MAC prefixes (24/28/36-bit hex)
 * @property {number=} priority             higher = wins over lower; default 100
 * @property {(mac:string, context:OuiContext) => boolean} match
 * @property {(mac:string, context:OuiContext) => (Partial<OuiRecord>|null)} enrich
 */

class OuiEngine {
  constructor(options = {}) {
    if (!options.pluginDir) throw new Error('OuiEngine requires pluginDir');

    this.pluginDir = path.resolve(options.pluginDir);
    this.logger = options.logger || console;
    this.watchEnabled = options.watch !== false;
    this.watchDebounceMs = Math.max(20, parseInt(options.watchDebounceMs || 75, 10));
    // Storage seam reserved for future SQLite-backed overrides/history. The
    // engine never reads from it today; it is wired in so that adding a
    // persistence layer later does not change any call site.
    this.storage = options.storage || null;

    this._pluginsByFile = new Map();
    /** @type {Array<{ id:string, file:string, priority:number, prefixIndex:Map<string,Object>, match:Function, enrich:Function, loadedAt:string }>} */
    this._registry = [];
    /** Sorted unique prefix lengths (retained for diagnostics; lookup uses the trie). */
    this._prefixLengths = [];
    /** Compact prefix trie rebuilt at every refresh(). */
    this._trie = new _PrefixTrie();
    this._watcher = null;
    this._refreshTimer = null;
    this._pluginSignature = '';
    this._closed = false;
    // Rate-limit the on-lookup signature check. Default 0 preserves the legacy
    // semantics expected by the hot-reload tests. Production hot paths (e.g.
    // discovery routes hitting thousands of MACs per crawl) should pass a
    // non-zero value to throttle, or 0 + watch:false to disable entirely.
    this._lastSignatureCheck = 0;
    this.signatureCheckIntervalMs = Number.isFinite(options.signatureCheckIntervalMs)
      ? options.signatureCheckIntervalMs
      : 0;

    this.refresh();
    if (this.watchEnabled) this._startWatcher();
  }

  /** Normalize a MAC string to canonical uppercase hex with no separators.
   *  Accepts `aa:bb:cc:dd:ee:ff`, `AA-BB-CC-DD-EE-FF`, `AABB.CCDD.EEFF` etc.
   *  Returns '' when the input cannot be reduced to 12 hex chars. */
  normalize(mac) {
    return normalizeMac(mac);
  }

  /** Returns the canonical MAC in colon-separated lower case form, or ''. */
  format(mac) {
    const hex = normalizeMac(mac);
    if (hex.length !== 12) return '';
    return hex.toLowerCase().match(/.{2}/g).join(':');
  }

  /**
   * @param {string} mac
   * @param {OuiContext=} context
   * @returns {OuiRecord|OuiNotFound}
   */
  lookup(mac, context = {}) {
    this._refreshIfPluginDirChanged();
    const hex = normalizeMac(mac);
    if (hex.length !== 12) return notFound(String(mac || ''), 'invalid_mac');

    const flags = macFlags(hex);
    const ctx = Object.freeze({ ...context });

    // Trie walk: O(prefix-length) instead of O(plugins * prefix-lengths).
    // matchPath returns nodes longest-first; within each node entries are
    // already ordered priority-desc, so the first one that passes match()
    // wins. Falls back through shorter prefixes when no longer prefix has a
    // plugin that accepts the MAC.
    const matches = this._trie.matchPath(hex);
    for (const { prefixEnd, entries } of matches) {
      for (const { plugin } of entries) {
        if (!this._safeMatch(plugin, hex, ctx)) continue;
        try {
          const enriched = plugin.enrich(hex, ctx);
          if (!enriched) return null;
          const matchedPrefix = hex.slice(0, prefixEnd);
          return normalizeRecord(enriched, plugin, hex, matchedPrefix, flags);
        } catch (error) {
          this._logError(`Plugin enrich failed: ${plugin.id}`, error);
          return null;
        }
      }
    }

    // No plugin matched: still return structural info (locally-administered etc.)
    return {
      status: 'not_found',
      mac: String(mac || ''),
      normalizedMac: hex,
      reason: 'no_matching_plugin',
      ...flags,
    };
  }

  /** Convenience: returns true when the MAC belongs to a plugin tagged virtual,
   *  or matches a strong virtual prefix even without metadata. */
  isVirtual(mac, context = {}) {
    const record = this.lookup(mac, context);
    if (!record || record.status !== 'found') return false;
    if (record.isVirtual) return true;
    const tags = Array.isArray(record.tags) ? record.tags : [];
    if (tags.some(tag => VIRTUAL_HINTS.has(String(tag).toLowerCase()))) return true;
    const family = String(record.family || '').toLowerCase();
    const vendor = String(record.vendor || '').toLowerCase();
    return /virtual|hypervisor|docker|veth|tun|tap/.test(`${family} ${vendor}`);
  }

  /** True when bit 1 of the first byte is set (locally administered MAC).
   *  Useful to skip auto-link on randomized client MACs. */
  isLocallyAdministered(mac) {
    const hex = normalizeMac(mac);
    if (hex.length !== 12) return false;
    return (parseInt(hex.slice(0, 2), 16) & 0x02) !== 0;
  }

  /** True when bit 0 of the first byte is set (multicast/broadcast destination). */
  isMulticast(mac) {
    const hex = normalizeMac(mac);
    if (hex.length !== 12) return false;
    return (parseInt(hex.slice(0, 2), 16) & 0x01) !== 0;
  }

  getVendor(mac, context = {}) {
    const r = this.lookup(mac, context);
    return r && r.status === 'found' ? String(r.vendor || '') : '';
  }

  getPluginSummary() {
    return this._registry.map(plugin => ({
      id: plugin.id,
      file: plugin.file,
      priority: plugin.priority,
      prefixes: Array.from(plugin.prefixIndex.keys()),
      loadedAt: plugin.loadedAt,
    }));
  }

  refresh() {
    if (this._closed) return;

    const files = scanPluginFiles(this.pluginDir);
    const signature = pluginDirectorySignature(files);
    const existing = this._pluginsByFile;
    const next = new Map();

    for (const file of files) {
      const previous = existing.get(file);
      const loaded = this._loadPlugin(file);
      if (loaded) {
        next.set(file, loaded);
      } else if (previous) {
        next.set(file, previous);
      }
    }

    this._pluginsByFile = next;
    this._pluginSignature = signature;
    this._registry = Array.from(next.values())
      .sort((left, right) => {
        // Higher priority first, then plugin id for determinism.
        if (right.priority !== left.priority) return right.priority - left.priority;
        return left.id.localeCompare(right.id);
      });

    const lengths = new Set();
    const trie = new _PrefixTrie();
    for (const plugin of this._registry) {
      for (const key of plugin.prefixIndex.keys()) {
        lengths.add(key.length);
        trie.add(key, plugin);
      }
    }
    this._prefixLengths = Array.from(lengths).sort((a, b) => b - a);
    this._trie = trie;
  }

  close() {
    this._closed = true;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = null;
    if (this._watcher) this._watcher.close();
    this._watcher = null;
  }

  _safeMatch(plugin, hex, ctx) {
    try {
      return plugin.match(hex, ctx) === true;
    } catch (error) {
      this._logError(`Plugin match failed: ${plugin.id}`, error);
      return false;
    }
  }

  _loadPlugin(file) {
    try {
      const resolved = require.resolve(file);
      delete require.cache[resolved];
      const plugin = require(resolved);
      validatePlugin(plugin, file);
      const prefixes = Array.isArray(plugin.ouiPrefixes) ? plugin.ouiPrefixes : [plugin.ouiPrefixes];
      const prefixIndex = new Map();
      for (const raw of prefixes) {
        const prefix = normalizePrefixKey(raw);
        if (!prefix) continue;
        if (!prefixIndex.has(prefix)) prefixIndex.set(prefix, { prefix });
      }
      if (!prefixIndex.size) throw new Error('plugin must declare at least one valid ouiPrefix');
      const priority = Number.isFinite(plugin.priority) ? Number(plugin.priority) : 100;
      return {
        id: path.basename(file, path.extname(file)),
        file,
        priority,
        prefixIndex,
        match: plugin.match,
        enrich: plugin.enrich,
        loadedAt: new Date().toISOString(),
      };
    } catch (error) {
      this._logError(`Plugin load skipped: ${file}`, error);
      return null;
    }
  }

  _startWatcher() {
    if (!fs.existsSync(this.pluginDir)) return;

    try {
      this._watcher = fs.watch(this.pluginDir, () => this._scheduleRefresh());
      if (typeof this._watcher.unref === 'function') this._watcher.unref();
    } catch (error) {
      this._logError(`Plugin watcher disabled: ${this.pluginDir}`, error);
    }
  }

  _scheduleRefresh() {
    if (this._closed) return;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.refresh();
    }, this.watchDebounceMs);
  }

  _refreshIfPluginDirChanged() {
    if (this._closed) return;
    // Throttling control:
    //  · 0 (default) = legacy behaviour, scan on every lookup()
    //  · >0          = throttle (skip if called within N ms of the last scan)
    //  · <0          = disabled, rely entirely on fs.watch
    // Production hot paths must set >0 or pass -1 alongside watch:true.
    if (this.signatureCheckIntervalMs < 0) return;
    if (this.signatureCheckIntervalMs > 0) {
      const now = Date.now();
      if (now - this._lastSignatureCheck < this.signatureCheckIntervalMs) return;
      this._lastSignatureCheck = now;
    }
    const files = scanPluginFiles(this.pluginDir);
    const signature = pluginDirectorySignature(files);
    if (signature !== this._pluginSignature) this.refresh();
  }

  _logError(message, error) {
    if (!this.logger || typeof this.logger.error !== 'function') return;
    this.logger.error(message, error && error.message ? error.message : error);
  }
}

function scanPluginFiles(pluginDir) {
  if (!fs.existsSync(pluginDir)) return [];

  return fs.readdirSync(pluginDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && PLUGIN_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => path.join(pluginDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function pluginDirectorySignature(files) {
  return files.map(file => {
    try {
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    } catch (_) {
      return `${file}:missing`;
    }
  }).join('|');
}

function validatePlugin(plugin, file) {
  if (!plugin || typeof plugin !== 'object') throw new Error('plugin must export an object');

  const keys = Object.keys(plugin).filter(k => REQUIRED_EXPORTS.includes(k));
  if (keys.length !== REQUIRED_EXPORTS.length) {
    throw new Error(`plugin must export: ${REQUIRED_EXPORTS.join(', ')}`);
  }

  if (typeof plugin.match !== 'function') throw new Error('match must be a function');
  if (typeof plugin.enrich !== 'function') throw new Error('enrich must be a function');
  if (!Array.isArray(plugin.ouiPrefixes) && typeof plugin.ouiPrefixes !== 'string') {
    throw new Error('ouiPrefixes must be a string or an array of strings');
  }
  if (!path.isAbsolute(file)) throw new Error('plugin file path must be absolute');
}

function normalizeMac(raw) {
  return String(raw || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
}

function normalizePrefixKey(raw) {
  const hex = String(raw || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  // IEEE-standard lengths are 6 (MA-L), 7 (MA-M nibble) and 9 (MA-S / IAB).
  // We also accept 2-byte and 4-char prefixes for special non-IEEE blocks
  // (e.g. Docker 02:42:.., locally administered OUIs) where the plugin author
  // wants to claim a coarser range than IEEE registry allows. Anything from 2
  // hex chars (1 byte) up to 12 hex chars (full MAC) is allowed; the engine
  // sorts by length so the longest specific match still wins.
  if (hex.length >= 2 && hex.length <= 12) return hex;
  return '';
}

function macFlags(hex) {
  const firstByte = parseInt(hex.slice(0, 2), 16) || 0;
  return {
    isLocallyAdministered: (firstByte & 0x02) !== 0,
    isMulticast:           (firstByte & 0x01) !== 0,
  };
}

function normalizeRecord(record, plugin, hex, matchedPrefix, flags) {
  if (!record || typeof record !== 'object') return null;

  return {
    status: 'found',
    mac: hex.toLowerCase().match(/.{2}/g).join(':'),
    normalizedMac: hex,
    prefix: matchedPrefix,
    prefixLength: matchedPrefix.length,
    vendor: String(record.vendor || '').trim() || 'Unknown',
    family: record.family ? String(record.family) : undefined,
    deviceType: record.deviceType ? String(record.deviceType) : undefined,
    tags: Array.isArray(record.tags) ? record.tags.map(tag => String(tag)).filter(Boolean) : [],
    isVirtual: typeof record.isVirtual === 'boolean' ? record.isVirtual : undefined,
    isLocallyAdministered: flags.isLocallyAdministered,
    isMulticast:           flags.isMulticast,
    confidence: Number.isFinite(record.confidence) ? record.confidence : 70,
    infranet: record.infranet && typeof record.infranet === 'object' ? { ...record.infranet } : {},
    source: {
      plugin: plugin.id,
      prefix: matchedPrefix,
      priority: plugin.priority,
    },
  };
}

function notFound(mac, reason) {
  return { status: 'not_found', mac, reason };
}

module.exports = {
  OuiEngine,
  normalizeMac,
  normalizePrefixKey,
};
