'use strict';
// Test della validazione smart cablaggio (lib/cable-validate.js, P1.4).
const test = require('node:test');
const assert = require('node:assert');
const { validateCable } = require('../lib/cable-validate.js');

const codes = r => r.map(x => x.code).sort();
const has = (r, code) => r.some(x => x.code === code);

test('cavo coerente → nessun problema', () => {
  const r = validateCable({ medium:'copper', cableCategory:'Cat6A', connector:'RJ45', maxSpeed:'10G', length:40 });
  assert.deepEqual(r, []);
});

test('mezzo rame + categoria fibra → error medium-cat', () => {
  const r = validateCable({ medium:'copper', cableCategory:'OM4' });
  assert.ok(has(r, 'medium-cat'));
  assert.equal(r.find(x=>x.code==='medium-cat').level, 'error');
});

test('mezzo fibra + categoria rame → error medium-cat', () => {
  assert.ok(has(validateCable({ medium:'fiber', cableCategory:'Cat6' }), 'medium-cat'));
});

test('connettore ottico (LC) su rame → error medium-conn', () => {
  assert.ok(has(validateCable({ medium:'copper', connector:'LC' }), 'medium-conn'));
});

test('RJ45 su fibra → error medium-conn', () => {
  assert.ok(has(validateCable({ medium:'fiber', connector:'RJ45' }), 'medium-conn'));
});

test('10G su Cat5e → warn speed-cat (con consiglio Cat6A)', () => {
  const r = validateCable({ medium:'copper', cableCategory:'Cat5e', maxSpeed:'10G' });
  const w = r.find(x=>x.code==='speed-cat');
  assert.ok(w && w.level==='warn');
  assert.match(w.why, /Cat6A/);
});

test('10G su Cat6 → warn speed-cat (nota 55m)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat6', maxSpeed:'10G' }).find(x=>x.code==='speed-cat');
  assert.ok(w);
  assert.match(w.why, /55m/);
});

test('1G su Cat5e → nessun warn velocità', () => {
  assert.equal(has(validateCable({ medium:'copper', cableCategory:'Cat5e', maxSpeed:'1G' }), 'speed-cat'), false);
});

test('100G su Cat8 → messaggio con reach 30m, MAI "40G a 100m"', () => {
  // Cat8 è specificato a 30m per 25/40GBASE-T, non 100m: il messaggio speed-cat
  // non deve più dire "a 100m" per una categoria a corto raggio.
  const w = validateCable({ medium:'copper', cableCategory:'Cat8', maxSpeed:'100G' }).find(x=>x.code==='speed-cat');
  assert.ok(w);
  assert.match(w.why, /a 30m/);
  assert.doesNotMatch(w.why, /40G a 100m/);
});

test('25G su Cat6 → consiglia Cat8 alla sua reach reale (30m)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat6', maxSpeed:'25G' }).find(x=>x.code==='speed-cat');
  assert.ok(w);
  assert.match(w.why, /a 30m serve Cat8/);
});

test('rame > 100m → warn copper-length (TIA-568)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat6', length:130 }).find(x=>x.code==='copper-length');
  assert.ok(w && w.level==='warn');
  assert.match(w.why, /100m/);
});

test('rame a 90m → nessun warn lunghezza', () => {
  assert.equal(has(validateCable({ medium:'copper', length:90 }), 'copper-length'), false);
});

test('Cat8 40G a 60m → warn cat-reach (limite 30m)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat8', maxSpeed:'40G', length:60 }).find(x=>x.code==='cat-reach');
  assert.ok(w && w.level==='warn');
  assert.match(w.why, /30m/);
});

test('Cat8 a 25m → nessun warn cat-reach (entro il limite)', () => {
  assert.equal(has(validateCable({ medium:'copper', cableCategory:'Cat8', maxSpeed:'40G', length:25 }), 'cat-reach'), false);
});

test('Cat8 a 130m → solo copper-length, non cat-reach (oltre i 100m parla la #4)', () => {
  const r = validateCable({ medium:'copper', cableCategory:'Cat8', length:130 });
  assert.ok(has(r, 'copper-length'));
  assert.equal(has(r, 'cat-reach'), false);
});

test('Cat6A a 80m → nessun cat-reach (reach 100m)', () => {
  assert.equal(has(validateCable({ medium:'copper', cableCategory:'Cat6A', maxSpeed:'10G', length:80 }), 'cat-reach'), false);
});

test('DAC > 10m → warn dac-length', () => {
  assert.ok(has(validateCable({ medium:'dac', length:15 }), 'dac-length'));
});

test('PoE su fibra → error poe-fiber', () => {
  const e = validateCable({ medium:'fiber', poe:'802.3at' }).find(x=>x.code==='poe-fiber');
  assert.ok(e && e.level==='error');
});

test('PoE none su fibra → nessun problema PoE', () => {
  assert.equal(has(validateCable({ medium:'fiber', poe:'none', cableCategory:'OM4' }), 'poe-fiber'), false);
});

test('802.3bt su Cat5e → warn poe-cat', () => {
  assert.ok(has(validateCable({ medium:'copper', cableCategory:'Cat5e', poe:'802.3bt' }), 'poe-cat'));
});

test('cross-check: porta negozia 10G ma cavo dichiarato 1G → warn speed-vs-snmp', () => {
  const w = validateCable({ medium:'copper', maxSpeed:'1G' }, { snmpSpeedMbps:10000 }).find(x=>x.code==='speed-vs-snmp');
  assert.ok(w);
  assert.match(w.why, /10G/);
});

test('cross-check mezzo: SNMP fibra vs doc rame → warn medium-vs-snmp', () => {
  assert.ok(has(validateCable({ medium:'copper' }, { snmpMedium:'fiber' }), 'medium-vs-snmp'));
});

test('lengthM come fallback di length', () => {
  assert.ok(has(validateCable({ medium:'copper', lengthM:120 }), 'copper-length'));
});

test('native VLAN mismatch su trunk fra apparati attivi → error', () => {
  const r = validateCable({}, { isTrunk:true, srcNative:1, dstNative:99 });
  const e = r.find(x => x.code === 'native-mismatch');
  assert.ok(e && e.level === 'error');
  assert.match(e.why, /1 vs 99/);
  // nativa coincidente → nessun problema
  assert.ok(!has(validateCable({}, { isTrunk:true, srcNative:10, dstNative:10 }), 'native-mismatch'));
  // non trunk, o un capo non attivo (native null) → niente check
  assert.ok(!has(validateCable({}, { isTrunk:false, srcNative:1, dstNative:99 }), 'native-mismatch'));
  assert.ok(!has(validateCable({}, { isTrunk:true, srcNative:1, dstNative:null }), 'native-mismatch'));
});

test('campi vuoti / link nullo → nessun crash, nessun problema', () => {
  assert.deepEqual(validateCable(null), []);
  assert.deepEqual(validateCable({}), []);
});
