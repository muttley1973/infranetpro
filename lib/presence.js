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

  // lib/device-status.js — lo stato operativo DICHIARATO. Si risolve al MOMENTO
  // DELLA CHIAMATA, non al caricamento: sotto bundle e sotto Node arriva da
  // `require`, come tag <script> arriverebbe dal globale, e l'ordine dei tag non è
  // garantito (è la trappola già pagata con radio.js). Se non si risolve, ci si
  // ASTIENE: si torna al comportamento storico, mai a un verdetto inventato.
  // ⚠️ Niente `root` qui: la factory di questo wrapper non lo riceve (è parametro
  // dell'IIFE esterna, non della funzione che stiamo scrivendo). Si passa da
  // `globalThis`, che è l'unico globale visibile da dentro.
  function _statusApi() {
    if (typeof require === 'function') return require('./device-status');
    return (typeof globalThis !== 'undefined' && typeof globalThis.alarmsOnAbsence === 'function') ? globalThis : null;
  }

  // Le due letture che lo stato dichiarato cambia. NON toccano `node.proof`: la
  // misura resta quella che è (docs/adr/measured-not-declared.md), cambia solo
  // come la si dipinge.
  //   • assenza SPIEGATA  — dichiarato pianificato/a magazzino/spento e infatti tace:
  //     non è un guasto, e un rosso qui insegna a ignorare i rossi.
  //   • CONTRADDIZIONE    — dichiarato fuori servizio e invece risponde: è l'allarme
  //     vero, ed è simmetrico al silenziamento qui sopra. Senza, questo campo
  //     sarebbe solo un interruttore per far sparire i problemi.
  function _absenceIsExpected(node) {
    const api = _statusApi();
    return !!(api && typeof api.alarmsOnAbsence === 'function' && api.alarmsOnAbsence(node.status) === false);
  }
  function _isAliveButNotInService(node) {
    const api = _statusApi();
    if (!api || typeof api.expectsPresence !== 'function') return false;
    if (api.expectsPresence(node.status) !== false) return false;
    return _respondedRecently(node) || !!(node.proof && node.proof.status === 'proven');
  }

  function nodePresenceClass(node, report) {
    if (!node) return '';
    // Prima di tutto il resto: la contraddizione non deve cadere nell'uscita
    // anticipata di «ha risposto da poco», che è proprio il caso in cui accade.
    if (_isAliveButNotInService(node)) return ' node-status-conflict';
    if (_respondedRecently(node)) return '';
    const expected = _absenceIsExpected(node);
    if (report && typeof report === 'object') {
      if (_ids(report, 'macOrphan').has(node.id)) return expected ? ' node-absent-expected' : ' node-absent';
      if (_ids(report, 'unverified').has(node.id)) return ' node-unverified';
      return '';
    }
    if (node.proof && node.proof.status === 'absent') return expected ? ' node-absent-expected' : ' node-absent';
    if (node.proof && node.proof.status === 'unverified') return ' node-unverified';
    return '';
  }

  return { nodePresenceClass };
});
