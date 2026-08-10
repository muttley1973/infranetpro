// PRESENCE PRESENTATION — stato visuale derivato da report corrente o proof persistente.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _ids(report, key) {
    return new Set((report && Array.isArray(report[key]) ? report[key] : [])
      .map(row => row && row.nodeId).filter(Boolean));
  }

  function nodePresenceClass(node, report) {
    if (!node || node.snmpStatus === 'ok') return '';
    if (report && typeof report === 'object') {
      if (_ids(report, 'macOrphan').has(node.id)) return ' node-absent';
      if (_ids(report, 'unverified').has(node.id)) return ' node-unverified';
      return '';
    }
    if (node.proof && node.proof.status === 'absent') return ' node-absent';
    if (node.proof && node.proof.status === 'unverified') return ' node-unverified';
    return '';
  }

  return { nodePresenceClass };
});
