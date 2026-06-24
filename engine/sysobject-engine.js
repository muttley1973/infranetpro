'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_EXTENSIONS = new Set(['.js', '.cjs']);
const REQUIRED_EXPORTS = ['enrich', 'match', 'vendorPrefix'];

/**
 * @typedef {Object} SysObjectContext
 * @property {string=} descr
 * @property {string=} hostname
 * @property {number|string=} sysServices
 * @property {string=} vendor
 * @property {string=} mac
 * @property {string=} httpTitle
 * @property {string=} httpsTitle
 * @property {string=} netbiosName
 * @property {string=} netbiosGroup
 * @property {Array<Object|string>=} services
 * @property {Array<Object|string>=} smbShares
 * @property {string=} source
 */

/**
 * @typedef {Object} SysObjectRecord
 * @property {'found'} status
 * @property {string} oid
 * @property {string} vendor
 * @property {string} vendorPrefix
 * @property {string} deviceType
 * @property {string=} family
 * @property {string=} model
 * @property {string[]=} tags
 * @property {Object=} os
 * @property {number=} confidence
 * @property {Object=} infranet
 * @property {{ plugin:string, prefix:string }} source
 */

/**
 * @typedef {Object} SysObjectNotFound
 * @property {'not_found'} status
 * @property {string} oid
 * @property {string} reason
 */

/**
 * @typedef {Object} SysObjectPlugin
 * @property {string} vendorPrefix
 * @property {(oid:string, context:SysObjectContext) => boolean} match
 * @property {(oid:string, context:SysObjectContext) => (Partial<SysObjectRecord>|null)} enrich
 */

class SysObjectEngine {
  constructor(options = {}) {
    if (!options.pluginDir) throw new Error('SysObjectEngine requires pluginDir');

    this.pluginDir = path.resolve(options.pluginDir);
    this.logger = options.logger || console;
    this.watchEnabled = options.watch !== false;
    this.watchDebounceMs = Math.max(20, parseInt(options.watchDebounceMs || 75, 10));
    this.storage = options.storage || null;

    this._pluginsByFile = new Map();
    this._registry = [];
    this._watcher = null;
    this._refreshTimer = null;
    this._pluginSignature = '';
    this._closed = false;
    // Rate-limit the on-resolve signature check. Default 0 keeps the legacy
    // behaviour (scan on every resolve) which test/hot-reload paths rely on.
    // Production hot paths can pass a value (e.g. 2000ms) to coarsen the
    // check, or 0 + watch:false to disable entirely. When watch:true and
    // signatureCheckIntervalMs:0 the scan is skipped — fs.watch is the only
    // refresh trigger.
    this._lastSignatureCheck = 0;
    this.signatureCheckIntervalMs = Number.isFinite(options.signatureCheckIntervalMs)
      ? options.signatureCheckIntervalMs
      : 0;

    this.refresh();
    if (this.watchEnabled) this._startWatcher();
  }

  /**
   * Resolve a sysObjectID using the in-memory plugin registry.
   * The optional storage field is intentionally not used yet: it is the stable
   * future seam for SQLite-backed overrides/history without changing callers.
   *
   * @param {string} oid
   * @param {SysObjectContext=} context
   * @returns {SysObjectRecord|SysObjectNotFound|null}
   */
  resolve(oid, context = {}) {
    this._refreshIfPluginDirChanged();
    const normalizedOid = normalizeOid(oid);
    if (!normalizedOid) return notFound(String(oid || ''), 'invalid_oid');

    return this._resolveOid(normalizedOid, context);
  }

  /**
   * Resolve OS/agent fingerprints that may not have a meaningful sysObjectID.
   * Context-only plugins use vendorPrefix "0" and match on hostname, vendor,
   * sysDescr, service banners, NetBIOS/SMB or similar discovery evidence.
   *
   * @param {SysObjectContext=} context
   * @returns {SysObjectRecord|SysObjectNotFound|null}
   */
  fingerprint(context = {}) {
    this._refreshIfPluginDirChanged();
    const registry = this._registry;
    for (const plugin of registry) {
      if (plugin.vendorPrefix !== '0') continue;
      if (!this._safeMatch(plugin, '0', context)) continue;

      try {
        const enriched = plugin.enrich('0', Object.freeze({ ...context }));
        if (!enriched) return null;
        return normalizeRecord(enriched, plugin, '0');
      } catch (error) {
        this._logError(`Plugin enrich failed: ${plugin.id}`, error);
        return null;
      }
    }

    return notFound('0', 'no_matching_fingerprint_plugin');
  }

  _resolveOid(normalizedOid, context = {}) {
    const registry = this._registry;
    for (const plugin of registry) {
      if (!isOidPrefixMatch(normalizedOid, plugin.vendorPrefix)) continue;
      if (!this._safeMatch(plugin, normalizedOid, context)) continue;

      try {
        const enriched = plugin.enrich(normalizedOid, Object.freeze({ ...context }));
        if (!enriched) return null;
        return normalizeRecord(enriched, plugin, normalizedOid);
      } catch (error) {
        this._logError(`Plugin enrich failed: ${plugin.id}`, error);
        return null;
      }
    }

    return notFound(normalizedOid, 'no_matching_plugin');
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
        const byPrefix = oidDepth(right.vendorPrefix) - oidDepth(left.vendorPrefix);
        return byPrefix || left.id.localeCompare(right.id);
      });
  }

  close() {
    this._closed = true;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = null;
    if (this._watcher) this._watcher.close();
    this._watcher = null;
  }

  getPluginSummary() {
    return this._registry.map(plugin => ({
      id: plugin.id,
      file: plugin.file,
      vendorPrefix: plugin.vendorPrefix,
      loadedAt: plugin.loadedAt,
    }));
  }

  _safeMatch(plugin, oid, context) {
    try {
      return plugin.match(oid, Object.freeze({ ...context })) === true;
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
      return {
        id: path.basename(file, path.extname(file)),
        file,
        vendorPrefix: normalizeOid(plugin.vendorPrefix),
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
    //  · 0 (default) = legacy behaviour, scan on every resolve()
    //  · >0          = throttle (skip if called within N ms of the last scan)
    //  · <0          = disabled, rely entirely on fs.watch
    // Production hot paths (discovery topology crawl etc.) should set a
    // positive value (e.g. 2000) or pass -1 alongside watch:true.
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

  const keys = Object.keys(plugin).sort();
  if (keys.length !== REQUIRED_EXPORTS.length || keys.some((key, index) => key !== REQUIRED_EXPORTS[index])) {
    throw new Error(`plugin must export exactly: ${REQUIRED_EXPORTS.join(', ')}`);
  }

  if (!normalizeOid(plugin.vendorPrefix)) throw new Error('vendorPrefix must be a valid numeric OID prefix');
  if (typeof plugin.match !== 'function') throw new Error('match must be a function');
  if (typeof plugin.enrich !== 'function') throw new Error('enrich must be a function');
  if (!path.isAbsolute(file)) throw new Error('plugin file path must be absolute');
}

function normalizeRecord(record, plugin, oid) {
  if (!record || typeof record !== 'object') return null;

  return {
    status: 'found',
    oid,
    vendor: String(record.vendor || '').trim() || 'Unknown',
    vendorPrefix: plugin.vendorPrefix,
    deviceType: String(record.deviceType || record.infranet?.deviceType || 'unknown').trim() || 'unknown',
    family: record.family ? String(record.family) : undefined,
    model: record.model ? String(record.model) : undefined,
    tags: Array.isArray(record.tags) ? record.tags.map(tag => String(tag)).filter(Boolean) : [],
    os: normalizeOs(record.os),
    confidence: Number.isFinite(record.confidence) ? record.confidence : 70,
    infranet: record.infranet && typeof record.infranet === 'object' ? { ...record.infranet } : {},
    source: {
      plugin: plugin.id,
      prefix: plugin.vendorPrefix,
    },
  };
}

function normalizeOs(os) {
  if (!os || typeof os !== 'object') return undefined;
  const family = String(os.family || '').trim();
  const vendor = String(os.vendor || '').trim();
  const name = String(os.name || '').trim();
  const confidence = Number.isFinite(os.confidence) ? os.confidence : undefined;
  const result = {};
  if (family) result.family = family;
  if (vendor) result.vendor = vendor;
  if (name) result.name = name;
  if (confidence !== undefined) result.confidence = confidence;
  if (Array.isArray(os.tags)) result.tags = os.tags.map(tag => String(tag)).filter(Boolean);
  return Object.keys(result).length ? result : undefined;
}

function normalizeOid(value) {
  const oid = String(value || '').trim().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!/^\d+(?:\.\d+)*$/.test(oid)) return '';
  return oid;
}

function isOidPrefixMatch(oid, prefix) {
  return oid === prefix || oid.startsWith(`${prefix}.`);
}

function oidDepth(oid) {
  return oid.split('.').length;
}

function notFound(oid, reason) {
  return { status: 'not_found', oid, reason };
}

module.exports = {
  SysObjectEngine,
  normalizeOid,
  isOidPrefixMatch,
};
