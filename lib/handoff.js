// ============================================================
// HANDOFF DOSSIER — assemblaggio sezioni "Dossier di consegna" (N4)
// ============================================================
// Logica PURA che prepara le sezioni AGGIUNTIVE del PDF di consegna
// (copertina, changelog) a partire da un modello normalizzato.
// Le sezioni esistenti (planimetria, rack, porte, VLAN, inventario,
// topologia) restano gestite dalla pipeline /api/export-pdf esistente.
// Nessun accesso a DOM/state/TYPES: il chiamante normalizza l'input.
// Condiviso browser + test (UMD-lite).
//
// ── INPUT ────────────────────────────────────────────────────────────
// input = {
//   project:  string                    // nome progetto
//   date:     string                    // data leggibile (precalcolata)
//   user:     string                    // chi genera il dossier
//   devices:  [ { name, typeLabel, structural } ]  // già normalizzati
//   cableCount: number
//   vlanCount:  number
//   vmCount:    number                  // VM censite sugli host (contatore a se')
//   auditLog:   [ {ts,user,action,target,summary} ]
//   changelogLimit: number              // default 50
// }
// ── OUTPUT ───────────────────────────────────────────────────────────
// { cover:{title,project,date,user,deviceCount,cableCount,vlanCount,vmCount},
//   changelog:[ entries newest-first, max limit ] }
// Le note per-device NON sono qui: vivono nel Registro asset, sulla riga del loro
// apparato (server/pdf-report.js + lib/api-shape applyDeviceNotes).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _s(x) { return (x == null) ? '' : String(x); }

  function buildHandoffSections(input) {
    input = input || {};
    const devices = Array.isArray(input.devices) ? input.devices : [];
    const real = devices.filter(d => d && !d.structural);

    const cover = {
      title: _s(input.title) || 'Dossier di consegna',
      project: _s(input.project),
      date: _s(input.date),
      user: _s(input.user),
      deviceCount: real.length,
      // Contatore ASSENTE ≠ contatore a zero. Chi non fornisce il dato non sta
      // dicendo «nessuna VLAN»: non lo sta dicendo affatto. Rimane `null` e la
      // copertina stampa un trattino — che è la convenzione del resto del dossier.
      // Uno zero a 22pt è un'affermazione, e qui sarebbe un'affermazione inventata.
      cableCount: Number.isFinite(input.cableCount) ? input.cableCount : null,
      vlanCount: Number.isFinite(input.vlanCount) ? input.vlanCount : null,
      // Contatore SEPARATO, mai sommato a deviceCount: un host con 10 VM resta
      // UN apparato installato (convenzione DCIM, vedi copertina in pdf-report).
      vmCount: Number.isFinite(input.vmCount) ? input.vmCount : null,
    };

    // Le NOTE per-device non stanno piu' qui: sono una riga del Registro asset,
    // accanto all'apparato che descrivono (server/pdf-report + applyDeviceNotes).
    // Tenerne una seconda definizione qui sarebbe la premessa alla divergenza.

    // Changelog: ultime N voci, dalla più recente.
    const limit = Number.isFinite(input.changelogLimit) && input.changelogLimit > 0 ? input.changelogLimit : 50;
    const log = Array.isArray(input.auditLog) ? input.auditLog : [];
    const changelog = log.slice(-limit).reverse();

    return { cover, changelog };
  }

  return { buildHandoffSections };
});
