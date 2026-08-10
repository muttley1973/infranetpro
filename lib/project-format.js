(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const PROJECT_STATE_SCHEMA_VERSION = 1;
  const PORTABLE_EXPORT_FORMAT = 'infranet-project-export';

  function _clone(value) {
    try { return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {})); }
    catch (_) { return {}; }
  }

  function _redactBag(bag) {
    if (!bag || typeof bag !== 'object') return;
    for (const key of ['community', 'v3authPass', 'v3privPass']) {
      if (Object.prototype.hasOwnProperty.call(bag, key)) bag[key] = '';
    }
  }

  function _stripBackupRef(value) {
    if (typeof root.stripRefCreds === 'function') return root.stripRefCreds(value);
    const text = String(value == null ? '' : value).trim();
    return text
      .replace(/(:\/\/)[^/@\s]+:[^@\s]*@/, '$1')
      .replace(/^[A-Za-z0-9._-]+:(?:[^@\s\\/][^@\s\\]*)?@(?=[A-Za-z0-9.-]+[:/])/, '');
  }

  function sanitizePortableState(state) {
    const out = _clone(state);
    if (Array.isArray(out.nodes)) {
      for (const node of out.nodes) {
        if (!node || typeof node !== 'object') continue;
        _redactBag(node.integration);
        if (node.backup && typeof node.backup === 'object' && typeof node.backup.ref === 'string') {
          node.backup.ref = _stripBackupRef(node.backup.ref);
        }
        if (Array.isArray(node.vms)) {
          for (const vm of node.vms) {
            if (!vm || typeof vm !== 'object') continue;
            _redactBag(vm.integration);
            _redactBag(vm.snmp);
          }
        }
      }
    }
    return out;
  }

  function createPortableProjectExport(state, meta) {
    const portableState = sanitizePortableState(state);
    const rawVersion = Number(portableState.schemaVersion);
    const schemaVersion = Number.isInteger(rawVersion) && rawVersion > 0
      ? rawVersion : PROJECT_STATE_SCHEMA_VERSION;
    const out = {
      format: PORTABLE_EXPORT_FORMAT,
      schemaVersion,
      exportedAt: new Date().toISOString(),
      state: portableState,
    };
    if (meta && meta.projectId != null && String(meta.projectId).trim()) out.projectId = String(meta.projectId);
    if (meta && meta.projectName != null && String(meta.projectName).trim()) out.projectName = String(meta.projectName).trim();
    return out;
  }

  function unwrapProjectState(payload) {
    if (payload && typeof payload === 'object' && payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)) {
      return payload.state;
    }
    return payload;
  }

  function isProjectState(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.nodes) && Array.isArray(value.racks));
  }

  function pruneProjectStateCaches(state) {
    if (!state || typeof state !== 'object') return state;
    const nodeIds = new Set(Array.isArray(state.nodes) ? state.nodes.map(node => String(node && node.id || '')) : []);
    if (state.topoCache && typeof state.topoCache === 'object' && !Array.isArray(state.topoCache)) {
      for (const id of Object.keys(state.topoCache)) if (!nodeIds.has(id)) delete state.topoCache[id];
    }
    return state;
  }

  return {
    PROJECT_STATE_SCHEMA_VERSION,
    PORTABLE_EXPORT_FORMAT,
    sanitizePortableState,
    createPortableProjectExport,
    unwrapProjectState,
    isProjectState,
    pruneProjectStateCaches,
  };
});
