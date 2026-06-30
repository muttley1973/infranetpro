'use strict';
// ============================================================
//  test/health-alerts.test.js — lib/health-alerts.js (alert dalla salute SNMP).
//  «InfraNet calcola, l'AI racconta»: soglie deterministiche, dati strutturati,
//  nessun alert quando il dato manca o è ignoto (paletto #2 = niente invenzioni).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { computeHealthAlerts, summarizeAlerts } = require('../lib/health-alerts.js');

test('RAM piena → alert ram con severità per soglia', () => {
  assert.equal(computeHealthAlerts({ health: { host: { ram: { pct: 55 } } } }), undefined, 'sotto soglia → niente');
  const w = computeHealthAlerts({ health: { host: { ram: { pct: 92 } } } });
  assert.deepEqual(w, [{ severity: 'warn', kind: 'ram', value: 92 }]);
  const c = computeHealthAlerts({ health: { host: { ram: { pct: 99 } } } });
  assert.equal(c[0].severity, 'crit');
});

test('dischi pieni → un alert disk per volume con etichetta', () => {
  const a = computeHealthAlerts({ health: { host: { volumes: [
    { name: '/vol1', pct: 90 }, { name: '/', pct: 64 }, { name: '/data', pct: 97 } ] } } });
  const disks = a.filter(x => x.kind === 'disk');
  assert.equal(disks.length, 2, 'solo i due ≥90% (64% escluso)');
  assert.deepEqual(disks.find(x => x.label === '/vol1'), { severity: 'warn', kind: 'disk', value: 90, label: '/vol1' });
  assert.equal(disks.find(x => x.label === '/data').severity, 'crit');
});

test('inchiostro basso → alert ink; livello ignoto/assente → niente', () => {
  const a = computeHealthAlerts({ health: { printer: { supplies: [
    { color: 'black', type: 'ink', pct: 8 },
    { color: 'cyan', type: 'ink', pct: 90 },
    { color: 'magenta', type: 'ink', pct: -3 },   // livello ignoto → niente alert
    { color: 'yellow', type: 'ink' },             // nessun pct → niente alert
    { type: 'wasteToner', pct: 2 } ] } } });       // scarico, non consumabile → ignorato
  const inks = a.filter(x => x.kind === 'ink');
  assert.equal(inks.length, 1, 'solo il nero all\'8%');
  assert.deepEqual(inks[0], { severity: 'warn', kind: 'ink', value: 8, label: 'black' });
});

test('UPS: sotto batteria / autonomia / carica / carico', () => {
  const a = computeHealthAlerts({ health: { power: { onBattery: true, runtimeMin: 4, batteryPct: 25, loadPct: 95 } } });
  assert.ok(a.some(x => x.kind === 'ups' && x.label === 'onBattery'));
  assert.ok(a.some(x => x.kind === 'ups' && x.label === 'runtime' && x.severity === 'crit' && x.value === 4));
  assert.ok(a.some(x => x.kind === 'ups' && x.label === 'charge' && x.value === 25));
  assert.ok(a.some(x => x.kind === 'ups' && x.label === 'load' && x.value === 95));
  // UPS in salute → niente alert.
  assert.equal(computeHealthAlerts({ health: { power: { onBattery: false, runtimeMin: 40, batteryPct: 100, loadPct: 30 } } }), undefined);
});

test('ordine: crit prima dei warn', () => {
  const a = computeHealthAlerts({ health: { host: { ram: { pct: 91 }, volumes: [{ name: 'a', pct: 97 }] } } });
  assert.equal(a[0].severity, 'crit', 'disco crit (97%) prima della RAM warn (91%)');
  assert.equal(a[a.length - 1].severity, 'warn');
});

test('presenza/raggiungibilità NON è un alert (resta alla Verifica/drift)', () => {
  // snmpStatus err non genera alert: device-giù vs non-verificabile lo gestisce il drift.
  assert.equal(computeHealthAlerts({ snmp: true, health: { snmpStatus: 'err' } }), undefined);
});

test('nessun dato salute → undefined (niente da inventare)', () => {
  assert.equal(computeHealthAlerts({}), undefined);
  assert.equal(computeHealthAlerts(null), undefined);
  assert.equal(computeHealthAlerts({ health: { host: { ram: { pct: 10 }, volumes: [] } } }), undefined);
});

test('summarizeAlerts: conta warn/crit di flotta', () => {
  const dev1 = computeHealthAlerts({ health: { host: { volumes: [{ name: 'a', pct: 97 }] } } }); // 1 crit
  const dev2 = computeHealthAlerts({ health: { host: { ram: { pct: 91 } } } });                   // 1 warn
  assert.deepEqual(summarizeAlerts([dev1, dev2]), { warn: 1, crit: 1 });
  assert.equal(summarizeAlerts([undefined, undefined]), undefined);
  assert.equal(summarizeAlerts(null), undefined);
});
