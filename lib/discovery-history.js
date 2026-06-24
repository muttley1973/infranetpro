// ============================================================
// DISCOVERY-HISTORY — sfoltimento PURO della cronologia di discovery + utility FDB.
//
// Estratto dal god-file src/app-autolink.js: la logica di aging/cap della
// cronologia osservazioni (state.discoveryHistory.observations) e la
// normalizzazione della mappa VLAN-per-MAC sono PURE (nessuno stato globale,
// nessun DOM) → vivono qui come lib testabile via require(), e l'app le legge
// dal ponte window (golden-rule lib-script: NON importarle nel bundle).
//
//   pruneDiscoveryHistory(list)         → aging (lastSeen/ts) + tetto rigido, in place
//   normalizeFdbVlan(fv, normMac)       → { macKey: vlanId } deduplicato
//
// Le observation sono OGGI write-only (la "reinforce link nel tempo" è futura),
// quindi si sfoltiscono senza rischi funzionali per non gonfiare il JSON salvato.
// ============================================================
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else Object.assign(root, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Tetto ~1000 record (~200KB nel peggiore dei casi) e scarto delle observation
  // non più viste da oltre 90 giorni (lastSeen). Numeri ritoccabili da qui.
  const DISCOVERY_HISTORY_MAX = 1000;
  const DISCOVERY_HISTORY_MAX_AGE_DAYS = 90;

  const MS_PER_DAY = 864e5;

  // Sfoltisce la cronologia IN PLACE (mantiene il riferimento dell'array, che i
  // chiamanti tengono): 1) aging per lastSeen/ts, 2) tetto rigido sulle più recenti.
  // opts = { max, maxAgeDays, now } per i test; di default usa le costanti + Date.now().
  function pruneDiscoveryHistory(list, opts) {
    if (!Array.isArray(list)) return list;
    opts = opts || {};
    const max = opts.max != null ? opts.max : DISCOVERY_HISTORY_MAX;
    const maxAgeDays = opts.maxAgeDays != null ? opts.maxAgeDays : DISCOVERY_HISTORY_MAX_AGE_DAYS;
    const now = opts.now != null ? opts.now : Date.now();
    const cutoff = now - maxAgeDays * MS_PER_DAY;
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const rec = list[r];
      const ts = Date.parse((rec && (rec.lastSeen || rec.ts)) || '');
      // tieni le recenti e quelle senza data valida (non perdere record legacy)
      if (!Number.isFinite(ts) || ts >= cutoff) list[w++] = rec;
    }
    list.length = w;
    if (list.length > max) list.splice(0, list.length - max);
    return list;
  }

  // Normalizza la mappa VLAN-per-MAC del driver { rawMac: vlanId } usando la
  // STESSA chiave dell'app (normMac, tipicamente win._normMacKey), così i lookup
  // nel Drift Report combaciano con la cache FDB. normMac è iniettato per restare
  // PURI; fallback = lowercase semplice (compatibile col vecchio comportamento).
  function normalizeFdbVlan(fv, normMac) {
    const out = {};
    if (!fv || typeof fv !== 'object') return out;
    const norm = (typeof normMac === 'function') ? normMac : (m => String(m || '').toLowerCase());
    for (const [rawMac, vlan] of Object.entries(fv)) {
      const k = norm(rawMac);
      if (!k) continue;
      const v = parseInt(vlan, 10);
      if (Number.isFinite(v) && out[k] === undefined) out[k] = v;
    }
    return out;
  }

  return {
    pruneDiscoveryHistory, normalizeFdbVlan,
    DISCOVERY_HISTORY_MAX, DISCOVERY_HISTORY_MAX_AGE_DAYS,
  };
});
