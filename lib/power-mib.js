// ============================================================
// POWER MIB — parsing valori live UPS / ATS (puro)
// ============================================================
// Normalizza i valori SNMP grezzi di UPS (UPS-MIB, RFC 1628 — vendor-neutral) e
// ATS (APC PowerNet-MIB, vendor-specific) in oggetti "live" leggibili dalla UI.
// Funzione PURA: input mappa {oidKey: valoreGrezzo} → output normalizzato.
// Nessun DOM/SNMP/state. Il driver server fa i GET e passa i grezzi qui.
//
// NB sugli OID: quelli UPS sono lo standard RFC 1628 (affidabili su APC/Eaton/
// Riello/CyberPower); quelli ATS sono APC PowerNet (vanno verificati su hardware).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // OID scalari (per il GET aggiungere già '.0'/indice). Chiave → OID.
  const POWER_OIDS = {
    ups: {
      mfr:           '1.3.6.1.2.1.33.1.1.1.0',
      model:         '1.3.6.1.2.1.33.1.1.2.0',
      batteryStatus: '1.3.6.1.2.1.33.1.2.1.0',   // 1 unknown 2 normal 3 low 4 depleted
      runtimeMin:    '1.3.6.1.2.1.33.1.2.3.0',    // upsEstimatedMinutesRemaining
      batteryPct:    '1.3.6.1.2.1.33.1.2.4.0',    // upsEstimatedChargeRemaining
      batteryV:      '1.3.6.1.2.1.33.1.2.5.0',    // 0.1 V DC
      batteryTempC:  '1.3.6.1.2.1.33.1.2.7.0',    // °C
      outputSource:  '1.3.6.1.2.1.33.1.4.1.0',    // 3 normal 4 bypass 5 battery 6 booster 7 reducer
      inputV:        '1.3.6.1.2.1.33.1.3.3.1.3.1',// upsInputVoltage fase 1 (RMS V)
      outputV:       '1.3.6.1.2.1.33.1.4.4.1.2.1',// upsOutputVoltage linea 1
      loadPct:       '1.3.6.1.2.1.33.1.4.4.1.5.1',// upsOutputPercentLoad linea 1
    },
    ats: {
      selectedSource:  '1.3.6.1.4.1.318.1.1.8.5.1.2.0', // 1 sourceA 2 sourceB
      redundancyState: '1.3.6.1.4.1.318.1.1.8.5.1.3.0', // 1 lost 2 redundant
      overCurrent:     '1.3.6.1.4.1.318.1.1.8.5.1.4.0', // 1 ok 2 over
    },
  };

  const _BATTERY_STATUS = { 1: 'unknown', 2: 'normal', 3: 'low', 4: 'depleted' };
  const _OUTPUT_SOURCE  = { 1: 'other', 2: 'none', 3: 'normal', 4: 'bypass', 5: 'battery', 6: 'booster', 7: 'reducer' };

  function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  // raw = { batteryPct: 87, runtimeMin: 42, outputSource: 5, ... } (valori grezzi)
  function parseUps(raw) {
    raw = raw || {};
    const bs = _num(raw.batteryStatus);
    const os = _num(raw.outputSource);
    const bv = _num(raw.batteryV);
    const out = {
      mfr:          raw.mfr ? String(raw.mfr).trim() : '',
      model:        raw.model ? String(raw.model).trim() : '',
      batteryPct:   _num(raw.batteryPct),
      runtimeMin:   _num(raw.runtimeMin),
      batteryStatus: bs != null ? (_BATTERY_STATUS[bs] || 'unknown') : null,
      outputSource:  os != null ? (_OUTPUT_SOURCE[os] || 'other') : null,
      onBattery:     os === 5,
      loadPct:      _num(raw.loadPct),
      inputV:       _num(raw.inputV),
      outputV:      _num(raw.outputV),
      batteryV:     bv != null ? bv / 10 : null,   // 0.1 V DC → V
      batteryTempC: _num(raw.batteryTempC),
    };
    return out;
  }

  function parseAts(raw) {
    raw = raw || {};
    const sel = _num(raw.selectedSource);
    const red = _num(raw.redundancyState);
    const oc  = _num(raw.overCurrent);
    return {
      selectedSource:  sel === 1 ? 'A' : sel === 2 ? 'B' : null,
      redundant:       red != null ? red === 2 : null,
      overCurrent:     oc != null ? oc === 2 : null,
    };
  }

  // Soglia "autonomia critica" (default 10 min) — per il warning UI.
  function upsRuntimeCritical(live, thresholdMin) {
    const t = Number.isFinite(thresholdMin) ? thresholdMin : 10;
    return !!(live && live.runtimeMin != null && live.runtimeMin < t);
  }

  return { POWER_OIDS, parseUps, parseAts, upsRuntimeCritical };
});
