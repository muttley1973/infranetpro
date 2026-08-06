'use strict';
// Unit test della config PURA del «Monitoraggio automatico» unificato
// (lib/auto-monitor.js): schema nuovo, migrazione morbida dai legacy (auto-poll +
// Verifica automatica separati) e clamp dell'intervallo per profondità.
const test = require('node:test');
const assert = require('node:assert');
const { effAutoConfig, clampMonitorInterval, fmtMonitorInterval, MONITOR_INTERVALS } = require('../lib/auto-monitor.js');

test('effAutoConfig: schema nuovo rispettato (enabled/interval/depth)', () => {
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'light', interval: 5 }), { enabled: true, depth: 'light', interval: 5 });
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'full', interval: 60 }), { enabled: true, depth: 'full', interval: 60 });
  // disabilitato ma con profondità scelta: la conserva (spento ≠ perde la scelta)
  assert.deepEqual(effAutoConfig({ enabled: false, depth: 'full', interval: 360 }), { enabled: false, depth: 'full', interval: 360 });
});

test('effAutoConfig: migrazione dai legacy (nessun campo depth)', () => {
  // «Verifica automatica» con intervallo VALIDO nel set full → conservato
  assert.deepEqual(effAutoConfig({ autoVerify: true, verifyEvery: 360 }), { enabled: true, depth: 'full', interval: 360 });
  // vecchi 15/30m (non più nel set full) → clamp al floor sano (60 = 1h)
  assert.deepEqual(effAutoConfig({ autoVerify: true, verifyEvery: 30 }), { enabled: true, depth: 'full', interval: 60 });
  // verifyEvery mancante → default full (60)
  assert.deepEqual(effAutoConfig({ autoVerify: true }), { enabled: true, depth: 'full', interval: 60 });
  // vecchio auto-poll SNMP → profondità light al suo intervallo (10 valido)
  assert.deepEqual(effAutoConfig({ enabled: true, interval: 10 }), { enabled: true, depth: 'light', interval: 10 });
  // vecchio auto-poll a 1m (non più nel set light) → clamp a 5m
  assert.deepEqual(effAutoConfig({ enabled: true, interval: 1 }), { enabled: true, depth: 'light', interval: 5 });
  // entrambi i legacy attivi: vince full (la Verifica ingloba il poll)
  assert.deepEqual(effAutoConfig({ enabled: true, interval: 5, autoVerify: true, verifyEvery: 60 }), { enabled: true, depth: 'full', interval: 60 });
});

test('effAutoConfig: niente attivo → spento, default full/60', () => {
  assert.deepEqual(effAutoConfig({}), { enabled: false, depth: 'full', interval: 60 });
  assert.deepEqual(effAutoConfig(null), { enabled: false, depth: 'full', interval: 60 });
  assert.deepEqual(effAutoConfig({ enabled: false }), { enabled: false, depth: 'full', interval: 60 });
});

test('effAutoConfig: intervallo sporco nello schema nuovo viene clampato al set della profondità', () => {
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'full', interval: 7 }), { enabled: true, depth: 'full', interval: 60 });
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'light', interval: 999 }), { enabled: true, depth: 'light', interval: 5 });
});

test('clampMonitorInterval: fuori dal set → default della profondità', () => {
  assert.equal(clampMonitorInterval('light', 10), 10);    // light valido
  assert.equal(clampMonitorInterval('light', 1), 5);      // 1 non è più light → default light (5)
  assert.equal(clampMonitorInterval('light', 60), 5);     // 60 non è light → default light (5)
  assert.equal(clampMonitorInterval('full', 1440), 1440); // full valido (24h)
  assert.equal(clampMonitorInterval('full', 60), 60);     // full valido (1h)
  assert.equal(clampMonitorInterval('full', 30), 60);     // 30 non è più full → default full (60)
  assert.equal(clampMonitorInterval('full', 5), 60);      // 5 non è full → default full (60)
  assert.equal(clampMonitorInterval('boh', 60), 60);      // depth ignoto → trattato come full
});

test('MONITOR_INTERVALS: set attesi per profondità', () => {
  assert.deepEqual(MONITOR_INTERVALS.light, [5, 10, 15, 30]);
  assert.deepEqual(MONITOR_INTERVALS.full, [60, 360, 720, 1440]);
});

test('fmtMonitorInterval: minuti < 60 → "Nm"; multipli di 60 → "Nh"', () => {
  assert.equal(fmtMonitorInterval(5), '5m');
  assert.equal(fmtMonitorInterval(30), '30m');
  assert.equal(fmtMonitorInterval(60), '1h');
  assert.equal(fmtMonitorInterval(360), '6h');
  assert.equal(fmtMonitorInterval(720), '12h');
  assert.equal(fmtMonitorInterval(1440), '24h');
});

test('effAutoConfig è PURA: non muta l\'input', () => {
  const ap = { autoVerify: true, verifyEvery: 30 };
  const snapshot = JSON.stringify(ap);
  effAutoConfig(ap);
  assert.equal(JSON.stringify(ap), snapshot, 'effAutoConfig non deve toccare l\'oggetto passato');
});
