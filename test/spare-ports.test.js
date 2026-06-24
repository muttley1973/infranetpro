'use strict';
// Test del report capacità libera (lib/spare-ports.js).
const test = require('node:test');
const assert = require('node:assert');
const { buildSpareReport } = require('../lib/spare-ports.js');

// Helper: device con N porte access + M sfp, una mappa di cablate/attive.
function dev(id, rackId, ports) { return { id, name: id, rackId, ports }; }
function p(pid, kind, cabled, activeSnmp) { return { pid, kind, cabled: !!cabled, activeSnmp: !!activeSnmp }; }

test('device singolo: conta libere access/sfp e occupate', () => {
  const r = buildSpareReport([dev('sw1', 'r1', [
    p('sw1-1', 'access', true),   // occupata
    p('sw1-2', 'access', false),  // libera
    p('sw1-3', 'access', false),  // libera
    p('sw1-4', 'sfp', false),     // libera sfp
  ])]);
  const d = r.racks[0].devices[0];
  assert.equal(d.total, 4);
  assert.equal(d.used, 1);
  assert.equal(d.free, 3);
  assert.equal(d.freeAccess, 2);
  assert.equal(d.freeSfp, 1);
  assert.equal(d.suspect, 0);
});

test('cross-check: porta libera ma SNMP attiva → suspect', () => {
  const r = buildSpareReport([dev('sw1', 'r1', [
    p('sw1-1', 'access', false, true),   // libera ma attiva → sospetta
    p('sw1-2', 'access', false, false),  // libera pulita
  ])]);
  const d = r.racks[0].devices[0];
  assert.equal(d.free, 2);
  assert.equal(d.suspect, 1);
  assert.deepEqual(r.suspectPids, ['sw1-1']);
  assert.deepEqual(r.freePids.sort(), ['sw1-1', 'sw1-2']);
});

test('aggregazione per rack + totali', () => {
  const r = buildSpareReport([
    dev('sw1', 'r1', [p('sw1-1','access',false), p('sw1-2','access',true)]),
    dev('sw2', 'r1', [p('sw2-1','access',false), p('sw2-2','sfp',false)]),
    dev('sw3', 'r2', [p('sw3-1','access',true)]),
  ]);
  const r1 = r.racks.find(x => x.rackId === 'r1');
  assert.equal(r1.devices.length, 2);
  assert.equal(r1.totals.free, 3);        // sw1-1 + sw2-1 + sw2-2
  assert.equal(r1.totals.freeSfp, 1);
  assert.equal(r.totals.devices, 3);
  assert.equal(r.totals.ports, 5);
  assert.equal(r.totals.used, 2);         // sw1-2 + sw3-1
  assert.equal(r.totals.free, 3);
});

test('device senza rack → unracked', () => {
  const r = buildSpareReport([dev('floorsw', null, [p('floorsw-1','access',false)])]);
  assert.equal(r.racks.length, 0);
  assert.equal(r.unracked.length, 1);
  assert.equal(r.unracked[0].free, 1);
});

test('device senza porte collegabili → ignorato (non sporca il report)', () => {
  const r = buildSpareReport([dev('patch-only-mgmt', 'r1', [])]);
  assert.equal(r.totals.devices, 0);
  assert.equal(r.racks.length, 0);
});

test('rack e device ordinati per nome; freePids raccoglie tutte le libere', () => {
  const r = buildSpareReport([
    dev('zzz', 'rB', [p('zzz-1','access',false)]),
    dev('aaa', 'rA', [p('aaa-1','access',false), p('aaa-2','access',false)]),
  ]);
  assert.deepEqual(r.racks.map(x => x.rackId), ['rA', 'rB']);
  assert.equal(r.freePids.length, 3);
});

test('input vuoto/nullo → report vuoto senza crash', () => {
  const r = buildSpareReport(null);
  assert.equal(r.totals.devices, 0);
  assert.deepEqual(r.racks, []);
  assert.deepEqual(r.freePids, []);
});
