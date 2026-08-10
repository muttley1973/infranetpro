// PORT IDENTIFIERS — parsing vendor-neutral dei riferimenti <nodeId>-<suffix>.
// Il nodeId può contenere trattini: il separatore non è quindi l'ultimo '-'.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _nodeIds(value) {
    if (!value) return [];
    if (value instanceof Set) return Array.from(value, String);
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'object') return Object.keys(value);
    return [];
  }

  function nodeIdOfPort(pid, knownNodeIds) {
    const raw = String(pid == null ? '' : pid);
    if (!raw) return '';
    const ids = _nodeIds(knownNodeIds);
    let best = '';
    for (const id of ids) {
      if (raw === id || (raw.startsWith(id) && raw[id.length] === '-')) {
        if (id.length > best.length) best = id;
      }
    }
    if (best) return best;
    const cut = raw.lastIndexOf('-');
    return cut > 0 ? raw.slice(0, cut) : raw;
  }

  function portSuffix(pid, knownNodeIds) {
    const raw = String(pid == null ? '' : pid);
    const nodeId = nodeIdOfPort(raw, knownNodeIds);
    if (!nodeId || raw === nodeId || raw.slice(nodeId.length, nodeId.length + 1) !== '-') return '';
    return raw.slice(nodeId.length + 1);
  }

  return { nodeIdOfPort, portSuffix };
});
