'use strict';
// ============================================================
//  lib/health-alerts.js — «InfraNet calcola» i PROBLEMI dalla salute SNMP.
//
//  PURO (zero DOM/IO, ADR D4). Deriva alert DETERMINISTICI (soglie documentate)
//  dai blocchi di salute GIÀ presenti nel contesto AI (server/ai/context.js):
//  host RAM/dischi, supplies della stampante (inchiostro/toner) e UPS
//  (powerLive). L'AI li RACCONTA (paletto #2): qui NIENTE prosa né
//  i18n, solo dati strutturati { severity, kind, value?, label? } → il system-
//  prompt istruisce l'assistente a segnalarli, citando il device per nome.
//
//  Fuori portata (NON raccolti → nessun alert): temperatura di sistema
//  (ENTITY-SENSOR-MIB) e congestione di traffico (utilizzo interfacce live).
//
//  Convenzione UMD-lite: in Node lo si require() (server/test); espone anche su
//  window per un futuro badge UI (oggi lo consuma solo il server).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (server/test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser (futuro badge)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Soglie (percentuali; minuti per l'autonomia UPS). Centralizzate e documentate.
  const T = {
    ramWarn: 90, ramCrit: 98,             // RAM occupata %
    diskWarn: 90, diskCrit: 95,           // volume occupato %
    inkWarn: 15, inkCrit: 5,              // consumabile residuo %
    upsRuntimeWarn: 15, upsRuntimeCrit: 5, // autonomia residua (min)
    upsChargeWarn: 30, upsChargeCrit: 10,  // carica batteria %
    upsLoadWarn: 90,                       // carico in uscita %
  };

  const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  // alert = { severity:'warn'|'crit', kind, value?, label? } (label = dato grezzo:
  // nome volume / colore inchiostro / sotto-metrica UPS — NON tradotto).
  function _a(severity, kind, value, label) {
    const o = { severity, kind };
    if (value != null) o.value = value;
    if (label != null && label !== '') o.label = label;
    return o;
  }
  // «alto = peggio»: crit se ≥critHi, warn se ≥warnHi, altrimenti null.
  function _hi(v, warnHi, critHi) { return v >= critHi ? 'crit' : (v >= warnHi ? 'warn' : null); }
  // «basso = peggio»: crit se ≤critLo, warn se ≤warnLo, altrimenti null.
  function _lo(v, warnLo, critLo) { return v <= critLo ? 'crit' : (v <= warnLo ? 'warn' : null); }

  // device = il DTO del contesto (con .health { host, printer, power, snmpStatus }).
  // Ritorna [alert] (crit prima dei warn) oppure undefined se non c'è nulla da dire.
  function computeHealthAlerts(device) {
    const d = (device && typeof device === 'object') ? device : {};
    const h = (d.health && typeof d.health === 'object') ? d.health : {};
    const out = [];

    // NB: la PRESENZA/raggiungibilità (device giù / non risponde) è di proposito
    // FUORI da qui — è territorio della Verifica/drift, che sa distinguere «guasto»
    // da «non verificabile da questo host» (niente falsi «critico: switch giù»).
    // Qui solo TELEMETRIA reale: RAM/dischi/inchiostro/UPS.

    // Host (server/pc/nas/homelab): RAM piena e dischi pieni.
    const host = (h.host && typeof h.host === 'object') ? h.host : null;
    if (host) {
      const ram = (host.ram && typeof host.ram === 'object') ? _num(host.ram.pct) : null;
      if (ram != null) { const s = _hi(ram, T.ramWarn, T.ramCrit); if (s) out.push(_a(s, 'ram', ram)); }
      for (const v of (Array.isArray(host.volumes) ? host.volumes : [])) {
        const pct = v ? _num(v.pct) : null;
        if (pct == null) continue;
        const s = _hi(pct, T.diskWarn, T.diskCrit);
        if (s) out.push(_a(s, 'disk', pct, v.name || null));
      }
    }

    // Stampante: consumabile (inchiostro/toner) quasi esaurito. Livello ignoto
    // (-1/-2/-3, o assente) → nessun alert (paletto #2: non inventiamo un valore).
    const printer = (h.printer && typeof h.printer === 'object') ? h.printer : null;
    if (printer) {
      for (const sup of (Array.isArray(printer.supplies) ? printer.supplies : [])) {
        if (!sup) continue;
        const type = String(sup.type || '').toLowerCase();
        if (/waste|receptacle/.test(type)) continue;     // contenitori di scarico: non sono consumabili
        if (type && !/ink|toner/.test(type)) continue;   // solo inchiostro/toner consumabile
        const pct = _num(sup.pct);
        if (pct == null || pct < 0) continue;
        const s = _lo(pct, T.inkWarn, T.inkCrit);
        if (s) out.push(_a(s, 'ink', pct, sup.color || sup.type || null));
      }
    }

    // UPS (powerLive normalizzato): sotto batteria, autonomia/carica basse, carico alto.
    const p = (h.power && typeof h.power === 'object') ? h.power : null;
    if (p) {
      if (p.onBattery === true) out.push(_a('warn', 'ups', null, 'onBattery'));
      const rt = _num(p.runtimeMin); if (rt != null) { const s = _lo(rt, T.upsRuntimeWarn, T.upsRuntimeCrit); if (s) out.push(_a(s, 'ups', rt, 'runtime')); }
      const ch = _num(p.batteryPct); if (ch != null) { const s = _lo(ch, T.upsChargeWarn, T.upsChargeCrit); if (s) out.push(_a(s, 'ups', ch, 'charge')); }
      const ld = _num(p.loadPct); if (ld != null && ld >= T.upsLoadWarn) out.push(_a('warn', 'ups', ld, 'load'));
    }

    if (!out.length) return undefined;
    out.sort((a, b) => (a.severity === b.severity) ? 0 : (a.severity === 'crit' ? -1 : 1)); // crit prima
    return out;
  }

  // Riepilogo di flotta: conta warn/crit su una lista di array-alert per device.
  function summarizeAlerts(deviceAlertsList) {
    let warn = 0, crit = 0;
    for (const alerts of (Array.isArray(deviceAlertsList) ? deviceAlertsList : [])) {
      for (const a of (Array.isArray(alerts) ? alerts : [])) {
        if (a && a.severity === 'crit') crit++;
        else if (a && a.severity === 'warn') warn++;
      }
    }
    return (warn || crit) ? { warn, crit } : undefined;
  }

  return { computeHealthAlerts, summarizeAlerts, _ALERT_THRESHOLDS: T };
});
