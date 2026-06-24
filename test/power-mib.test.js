'use strict';
// Test del parsing valori live UPS/ATS (lib/power-mib.js).
const test = require('node:test');
const assert = require('node:assert');
const { POWER_OIDS, parseUps, parseAts, upsRuntimeCritical } = require('../lib/power-mib.js');

test('OID catalog: UPS scalari standard + ATS APC presenti', () => {
  assert.equal(POWER_OIDS.ups.batteryPct, '1.3.6.1.2.1.33.1.2.4.0');
  assert.equal(POWER_OIDS.ups.outputSource, '1.3.6.1.2.1.33.1.4.1.0');
  assert.equal(POWER_OIDS.ats.selectedSource, '1.3.6.1.4.1.318.1.1.8.5.1.2.0');
});

test('parseUps: su batteria, % e autonomia, codici→label', () => {
  const u = parseUps({ batteryPct: 87, runtimeMin: 42, outputSource: 5, batteryStatus: 2,
                       loadPct: 35, inputV: 0, outputV: 230, batteryV: 547, batteryTempC: 28 });
  assert.equal(u.batteryPct, 87);
  assert.equal(u.runtimeMin, 42);
  assert.equal(u.outputSource, 'battery');
  assert.equal(u.onBattery, true);
  assert.equal(u.batteryStatus, 'normal');
  assert.equal(u.loadPct, 35);
  assert.equal(u.outputV, 230);
  assert.equal(u.batteryV, 54.7);   // 0.1V DC → V
});

test('parseUps: alimentazione da rete → onBattery false', () => {
  const u = parseUps({ outputSource: 3 });
  assert.equal(u.outputSource, 'normal');
  assert.equal(u.onBattery, false);
});

test('parseUps: batteria bassa', () => {
  assert.equal(parseUps({ batteryStatus: 3 }).batteryStatus, 'low');
  assert.equal(parseUps({ batteryStatus: 4 }).batteryStatus, 'depleted');
});

test('parseUps: valori mancanti → null, nessun crash', () => {
  const u = parseUps({});
  assert.equal(u.batteryPct, null);
  assert.equal(u.outputSource, null);
  assert.equal(u.onBattery, false);
  assert.deepEqual(parseUps(), parseUps({}));
});

test('parseAts: sorgente e ridondanza', () => {
  const a = parseAts({ selectedSource: 1, redundancyState: 2, overCurrent: 1 });
  assert.equal(a.selectedSource, 'A');
  assert.equal(a.redundant, true);
  assert.equal(a.overCurrent, false);
  const b = parseAts({ selectedSource: 2, redundancyState: 1 });
  assert.equal(b.selectedSource, 'B');
  assert.equal(b.redundant, false);
});

test('upsRuntimeCritical: autonomia sotto soglia', () => {
  assert.equal(upsRuntimeCritical({ runtimeMin: 6 }), true);    // < 10 default
  assert.equal(upsRuntimeCritical({ runtimeMin: 25 }), false);
  assert.equal(upsRuntimeCritical({ runtimeMin: 4 }, 5), true);
  assert.equal(upsRuntimeCritical({}), false);
  assert.equal(upsRuntimeCritical(null), false);
});
