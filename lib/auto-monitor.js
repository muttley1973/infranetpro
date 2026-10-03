// ============================================================
// lib/auto-monitor.js — config PURA del «Monitoraggio automatico» unificato
// ============================================================
// UN solo scheduler, DUE profondità (mai insieme: si sceglie quella per tick):
//   'light' → solo refresh SNMP (pollAllSNMP dataOnly) — nessuno storico
//   'full'  → Verifica completa (runDriftCheck silent) — include lo stato live
//             SNMP + confronto con la realtà + timeline/snapshot
// La Verifica INGLOBA già il polling SNMP, quindi tenere due timer separati era
// ridondante (e a tick coincidenti lanciava due sweep SNMP). Qui vive la logica senza
// DOM: normalizzazione della config, migrazione morbida dai campi legacy (auto-poll +
// Verifica automatica separati), set di intervalli per profondità e clamp, e la
// MACCHINA dello scheduler (createMonitorScheduler: timer e orologio INIETTATI, così si
// prova con un orologio finto). La usano UI (renderAutomationMenu), app-drift (che
// ci attacca il giro vero) e i test — una sola fonte di verità.
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

  // Scheduler del monitoraggio: la cadenza (un timer) e la MEMORIA di «un giro è dovuto».
  // ⚠️ Prima il giro che non poteva partire (scheda nascosta, Sync/Verifica in corso)
  // usciva in silenzio PRIMA di riprogrammare: il badge «Auto Nm» arrivava a 0s e ci
  // restava fino alla scadenza SUCCESSIVA (con la Verifica completa, un'ora), senza che
  // nessuno recuperasse il giro — né quando la scheda tornava visibile. Qui sono due cose
  // distinte: la scadenza fissa SEMPRE il prossimo appuntamento (parta il giro o no) e
  // segna il giro come DOVUTO; il giro dovuto parte appena nulla lo blocca (a ogni
  // controllo del badge, o su resume()).
  //   d.getConfig()   → { enabled, interval (min), depth }   (effAutoConfig)
  //   d.isBlocked()   → true se un'altra operazione tiene il campo (Sync/Verifica)
  //   d.run(cfg)      → Promise: il giro vero (alla profondità della config)
  //   d.onChange()    → il prossimo giro / lo stato sono cambiati (il badge si ridisegna)
  //   d.onError(e)    → il giro è fallito (riproverà alla prossima scadenza)
  //   d.now / d.setInterval / d.clearInterval / d.watchMs → iniettabili (test)
  function createMonitorScheduler(d) {
    const _now = d.now || Date.now;
    const _setI = d.setInterval || ((fn, ms) => setInterval(fn, ms));
    const _clearI = d.clearInterval || (h => clearInterval(h));
    let timer = null, watch = null, running = false, due = false, nextAt = 0;
    const _changed = () => { if (d.onChange) d.onChange(); };

    async function resume() {
      if (!due || running) return;
      const cfg = d.getConfig();
      if (!cfg.enabled) { due = false; return; }
      if (d.isBlocked && d.isBlocked()) return;   // resta dovuto: riparte appena si può
      due = false; running = true; _changed();
      try { await d.run(cfg); }
      catch (e) { if (d.onError) d.onError(e); }
      finally { running = false; _changed(); }
    }
    // Scade l'intervallo: il PROSSIMO appuntamento è un intervallo da QUI, parta o no il giro.
    function _fire() {
      const cfg = d.getConfig();
      if (!cfg.enabled) return undefined;
      nextAt = _now() + cfg.interval * 60000;
      // Scade mentre il NOSTRO giro è ancora in corso (rete lenta, giro più lungo
      // dell'intervallo): non si accoda un secondo giro dietro al primo, il prossimo
      // appuntamento è già fissato. Si recupera solo ciò che ha bloccato un ALTRO.
      if (running) { _changed(); return undefined; }
      due = true; _changed();
      return resume();
    }
    function stop() {
      if (timer) { _clearI(timer); timer = null; }
      if (watch) { _clearI(watch); watch = null; }
      nextAt = 0; due = false; _changed();
    }
    function start() {
      stop();
      const cfg = d.getConfig();
      if (!cfg.enabled || !(cfg.interval > 0)) return;
      nextAt = _now() + cfg.interval * 60000;
      timer = _setI(_fire, cfg.interval * 60000);
      watch = _setI(() => { _changed(); resume(); }, d.watchMs || 30000);   // badge vivo + recupero del giro dovuto
      _changed();
    }
    return { start, stop, resume, nextAt: () => nextAt, isDue: () => due, isRunning: () => running };
  }

  return { effAutoConfig, clampMonitorInterval, fmtMonitorInterval, createMonitorScheduler, MONITOR_INTERVALS, DEFAULT_MONITOR_INTERVAL: DEFAULT_INTERVAL };
});
