// ============================================================
// HANDOFF DOSSIER — assemblaggio sezioni "Dossier di consegna" (N4)
// ============================================================
// Logica PURA che prepara le sezioni AGGIUNTIVE del PDF di consegna
// (copertina, note, changelog) a partire da un modello normalizzato.
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
//   devices:  [ { name, typeLabel, notes, structural } ]  // già normalizzati
//   cableCount: number
//   vlanCount:  number
//   vmCount:    number                  // VM censite sugli host (contatore a se')
//   auditLog:   [ {ts,user,action,target,summary} ]
//   changelogLimit: number              // default 50
// }
// ── OUTPUT ───────────────────────────────────────────────────────────
// { cover:{title,project,date,user,deviceCount,cableCount,vlanCount,vmCount},
//   notes:[ {label,text} ], changelog:[ entries newest-first, max limit ] }
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
      cableCount: Number.isFinite(input.cableCount) ? input.cableCount : 0,
      vlanCount: Number.isFinite(input.vlanCount) ? input.vlanCount : 0,
      // Contatore SEPARATO, mai sommato a deviceCount: un host con 10 VM resta
      // UN apparato installato (convenzione DCIM, vedi copertina in pdf-report).
      vmCount: Number.isFinite(input.vmCount) ? input.vmCount : 0,
    };

    // Note: solo i device con testo non vuoto, ordinati per nome.
    const notes = real
      .filter(d => _s(d.notes).trim())
      .map(d => ({ label: _s(d.name) || _s(d.typeLabel) || '—', text: _s(d.notes).trim() }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Changelog: ultime N voci, dalla più recente.
    const limit = Number.isFinite(input.changelogLimit) && input.changelogLimit > 0 ? input.changelogLimit : 50;
    const log = Array.isArray(input.auditLog) ? input.auditLog : [];
    const changelog = log.slice(-limit).reverse();

    return { cover, notes, changelog };
  }

  return { buildHandoffSections };
});
