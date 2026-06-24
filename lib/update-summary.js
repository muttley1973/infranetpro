// ============================================================
// UPDATE-SUMMARY — riassunto PURO del Drift per il chip "cosa è cambiato"
// (opzione A: dopo il Sync, far emergere il delta — bottoni invariati).
//
// Dopo un Sync il Drift completo (lib/drift-report.js) ha 5 bucket. Il chip
// compatto non li mostra tutti allo stesso livello: deve rendere EVIDENTE ciò
// che conta (nuovi device + cambi di stato) SENZA il rumore. In particolare
// `macOrphan` ("assenti in rete") va tenuto SECONDARIO: i MAC documentati sono
// quasi tutta infrastruttura, e il MAC di management di uno switch non compare
// quasi mai in un FDB → sarebbe un falso allarme se messo come headline (errore
// già pagato col badge revertato, vedi handoff).
//
//   summarizeDriftReport(report) -> {
//     newCount, newInfra, newEndpoint,   // "nuovi" (undocumented: infra+endpoint)
//     changedCount,                      // stateDrift
//     absentCount, ghostCount,           // SECONDARI (macOrphan + ghostCable)
//     primaryCount,                      // headline = newCount + changedCount
//     secondaryCount,                    // absentCount + ghostCount
//     hasChanges, allClear
//   }
//
// Funzione PURA: input = output di buildDriftReport (o un {counts} minimale).
// Condivisa browser + test (UMD-lite). Zero dipendenze, niente DOM.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _n(x) { return Number.isFinite(x) ? x : 0; }

  function summarizeDriftReport(report) {
    const c = (report && report.counts) || {};
    const newInfra = _n(c.undocumented);            // undocumented infra (azionabile)
    const newEndpoint = _n(c.undocumentedEndpoint);  // undocumented endpoint
    const newCount = newInfra + newEndpoint;
    const changedCount = _n(c.stateDrift);
    const absentCount = _n(c.macOrphan);             // SECONDARIO (rumore infra)
    const ghostCount = _n(c.ghostCable);             // SECONDARIO
    const primaryCount = newCount + changedCount;
    const secondaryCount = absentCount + ghostCount;
    return {
      newCount, newInfra, newEndpoint,
      changedCount,
      absentCount, ghostCount,
      primaryCount, secondaryCount,
      hasChanges: (primaryCount + secondaryCount) > 0,
      allClear: (primaryCount + secondaryCount) === 0,
    };
  }

  return { summarizeDriftReport };
});
