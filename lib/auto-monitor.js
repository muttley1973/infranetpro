// ============================================================
// lib/auto-monitor.js — config PURA del «Monitoraggio automatico» unificato
// ============================================================
// UN solo scheduler, DUE profondità (mai insieme: si sceglie quella per tick):
//   'light' → solo refresh SNMP (pollAllSNMP dataOnly) — nessuno storico
//   'full'  → Verifica completa (runDriftCheck silent) — include lo stato live
//             SNMP + confronto con la realtà + timeline/snapshot
// La Verifica INGLOBA già il polling SNMP, quindi tenere due timer separati era
// ridondante (e a tick coincidenti lanciava due sweep SNMP). Qui vive SOLO la
// logica PURA (niente DOM, niente timer): normalizzazione della config, migrazione
// morbida dai campi legacy (auto-poll + Verifica automatica separati), set di
// intervalli per profondità e clamp. La usano UI (renderAutomationMenu), scheduler
// (app-drift) e i test — una sola fonte di verità.
//
// Schema NUOVO su state.autoPoll: { enabled, interval, depth:'light'|'full' }.
// Legacy (pre-unificazione): auto-poll { enabled, interval } · Verifica automatica
// { autoVerify, verifyEvery }. effAutoConfig migra i vecchi al volo, senza mutarli
// (nessun dirty al load); la scrittura del nuovo schema avviene solo su azione utente.
//
// UMD-lite: bundlato ESM in src (import) e require() nei test. NON muta l'input.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Intervalli offerti per profondità (minuti). light = refresh vivo frequente,
  // minimo 5m (standard di fatto del polling SNMP: LibreNMS/Observium; sotto, su reti
  // grandi il ciclo di poll non finisce in tempo). full = audit periodico, da orario
  // a giornaliero (60=1h · 360=6h · 720=12h · 1440=24h; divisori di 24 → allineati
  // all'orologio). setInterval regge 24h (limite ~24,8 giorni).
  const MONITOR_INTERVALS = { light: [5, 10, 15, 30], full: [60, 360, 720, 1440] };
  const DEFAULT_INTERVAL = { light: 5, full: 60 };

  function _int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
  function _depth(d) { return d === 'light' ? 'light' : 'full'; }

  // Etichetta breve di un intervallo in minuti: <60 → "Nm"; multiplo di 60 → "Nh"
  // (60→"1h", 360→"6h", 1440→"24h"). Usata dai bottoni del popover Automazioni.
  function fmtMonitorInterval(m) {
    const n = _int(m);
    return (n >= 60 && n % 60 === 0) ? (n / 60) + 'h' : n + 'm';
  }

  // Intervallo valido per la profondità: se non è nel suo set → default della
  // profondità. Usato al cambio profondità (l'intervallo dell'una può non esistere
  // nell'altra) e in effAutoConfig per difendersi da valori sporchi.
  function clampMonitorInterval(depth, interval) {
    const d = _depth(depth);
    const iv = _int(interval);
    return MONITOR_INTERVALS[d].includes(iv) ? iv : DEFAULT_INTERVAL[d];
  }

  // Config EFFETTIVA { enabled, interval, depth } dallo schema NUOVO, o MIGRATA dai
  // legacy quando `depth` è assente: Verifica automatica (autoVerify/verifyEvery)
  // → 'full'; vecchio auto-poll (enabled/interval) → 'light'. Se entrambi i legacy
  // erano attivi vince 'full' (ingloba il light). PURA: non tocca `ap`.
  function effAutoConfig(ap) {
    ap = ap || {};
    if (ap.depth === 'light' || ap.depth === 'full') {
      return { enabled: !!ap.enabled, depth: ap.depth, interval: clampMonitorInterval(ap.depth, ap.interval) };
    }
    if (ap.autoVerify) {
      return { enabled: true, depth: 'full', interval: clampMonitorInterval('full', ap.verifyEvery || DEFAULT_INTERVAL.full) };
    }
    if (ap.enabled) {   // vecchio auto-poll SNMP
      return { enabled: true, depth: 'light', interval: clampMonitorInterval('light', ap.interval || DEFAULT_INTERVAL.light) };
    }
    return { enabled: false, depth: 'full', interval: DEFAULT_INTERVAL.full };   // niente attivo
  }

  return { effAutoConfig, clampMonitorInterval, fmtMonitorInterval, MONITOR_INTERVALS, DEFAULT_MONITOR_INTERVAL: DEFAULT_INTERVAL };
});
