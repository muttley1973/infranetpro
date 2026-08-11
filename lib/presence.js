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

  // «Ha risposto allo SNMP» azzera l'overlay di presenza — ma SOLO se ha risposto
  // di RECENTE. `snmpStatus` sopravvive al salvataggio: un progetto riaperto dopo
  // mesi si porta dietro un 'ok' vecchissimo che zittiva il rosso anche quando la
  // Verifica appena fatta aveva la PROVA dell'assenza (e anche il proof persistito
  // dopo il reload). Il LED del rack applicava già la soglia (`_snmpIsStale`), qui
  // no: stesso concetto con due regole diverse. Soglia UNICA `SNMP_STALE_HOURS`
  // (lib/subbar-stats.js, globale nel browser; fallback 6h sotto Node/test) —
  // stesso idioma di `_snmpIsStale` in src/app-snmp.js.
  function _respondedRecently(node) {
    if (!node || node.snmpStatus !== 'ok') return false;
    const shared = (typeof globalThis !== 'undefined') ? globalThis.SNMP_STALE_HOURS : undefined;
    const hrs = (typeof shared === 'number') ? shared : 6;
    const at = Date.parse(String(node.snmpLastOk || ''));
    // Data assente o illeggibile = non databile → non vale come "vivo adesso"
    // (stessa scelta conservativa di _snmpIsStale): decide la misura più fresca.
    return Number.isFinite(at) && (Date.now() - at) <= hrs * 3600000;
  }

  function nodePresenceClass(node, report) {
    if (!node || _respondedRecently(node)) return '';
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
