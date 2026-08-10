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

  // Appartenenza O(1) senza riallocare per ogni porta: Set e oggetto (mappa
  // nodeId->x, es. l'indice nodeById) sono già indicizzati per chiave; l'array è
  // il caso raro (lib/test) e paga un indexOf. Chi chiama in loop caldi passa un
  // Set/oggetto (vedi buildPortIndex in lib/correlate.js, getPortNodeId in
  // src/app-index.js) → costo per-porta costante.
  function _has(value, id) {
    if (value instanceof Set) return value.has(id);
    if (Array.isArray(value)) return value.indexOf(id) !== -1;
    if (value && typeof value === 'object') return Object.prototype.hasOwnProperty.call(value, id);
    return false;
  }

  // nodeId di una porta "nodeId-suffix".
  // FAST-PATH O(1): lo split sull'ULTIMO '-' è SEMPRE il prefisso-nodo più lungo
  // possibile (nessun nodeId più lungo può essere prefisso: dovrebbe avere un '-'
  // oltre l'ultimo). Quindi se lo split ingenuo è un nodeId NOTO, è già la risposta
  // corretta — copre gli id canonici (sw1-24) e gran parte di quelli con trattini
  // (nb-dev-100-1, nb-dev-100-logical-123). Solo quando lo split ingenuo NON è un
  // nodeId noto (suffisso multi-trattino su un nodeId più corto) serve la scansione
  // longest-prefix sui nodeId noti — caso raro.
  function nodeIdOfPort(pid, knownNodeIds) {
    const raw = String(pid == null ? '' : pid);
    if (!raw) return '';
    const cut = raw.lastIndexOf('-');
    const naive = cut > 0 ? raw.slice(0, cut) : raw;
    if (knownNodeIds == null) return naive;   // nessuna lista: comportamento legacy O(1)
    if (_has(knownNodeIds, naive)) return naive;
    let best = '';
    for (const id of _nodeIds(knownNodeIds)) {
      if (id && raw.startsWith(id) && raw[id.length] === '-' && id.length > best.length) best = id;
    }
    return best || naive;
  }

  function portSuffix(pid, knownNodeIds) {
    const raw = String(pid == null ? '' : pid);
    const nodeId = nodeIdOfPort(raw, knownNodeIds);
    if (!nodeId || raw === nodeId || raw.slice(nodeId.length, nodeId.length + 1) !== '-') return '';
    return raw.slice(nodeId.length + 1);
  }

  return { nodeIdOfPort, portSuffix };
});
