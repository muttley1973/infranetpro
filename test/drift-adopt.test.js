'use strict';
// Test del modello "adotta i non documentati" (lib/drift-adopt.js).
const test = require('node:test');
const assert = require('node:assert');
const { buildAdoptCandidates } = require('../lib/drift-adopt.js');

const VENDORS = { 'aa:bb:cc:00:00:01': 'Hewlett Packard', 'de:ad:be:ef:00:01': 'Cisco' };
const vendorOf = mac => VENDORS[String(mac).toLowerCase()] || '';
// guessType finto: vendor → tipo (mima _guessType su vendor-only)
const guessType = vendor => /hewlett|officejet|laserjet/i.test(vendor) ? 'printer'
  : /cisco|switch/i.test(vendor) ? 'switch' : '';

test('mappa i campi base (mac, vlan, seenOn senza prefisso)', () => {
  const out = buildAdoptCandidates([
    { key: 'dev:1', mac: 'AA:BB:CC:00:00:01', label: 'vista su Sw1 · Gi0/3', cls: 'infra', vlan: 10 },
  ], { vendorOf, guessType });
  assert.equal(out.length, 1);
  assert.equal(out[0].mac, 'AA:BB:CC:00:00:01');
  assert.equal(out[0].vlan, 10);
  assert.equal(out[0].seenOn, 'Sw1 · Gi0/3');   // "vista su " rimosso
  assert.equal(out[0].vendor, 'Hewlett Packard');
});

test('typeDefault: vendor noto vince via guessType', () => {
  const out = buildAdoptCandidates([
    { key: 'dev:1', mac: 'AA:BB:CC:00:00:01', label: 'vista su Sw1', cls: 'endpoint', vlan: null },
  ], { vendorOf, guessType });
  assert.equal(out[0].typeDefault, 'printer');   // HP → printer, non 'pc'
});

test('typeDefault: fallback per classe quando guessType non sa', () => {
  const out = buildAdoptCandidates([
    { key: 'a', mac: '11:22:33:44:55:66', label: 'vista su Sw1', cls: 'endpoint', vlan: null },
    { key: 'b', mac: '77:88:99:aa:bb:cc', label: 'vista su Sw2', cls: 'infra', vlan: 1 },
  ], { vendorOf, guessType });
  assert.equal(out[0].typeDefault, 'pc');      // endpoint sconosciuto → pc
  assert.equal(out[1].typeDefault, 'switch');  // infra sconosciuto → switch
});

test('cls normalizzata a infra/endpoint', () => {
  const out = buildAdoptCandidates([
    { key: 'a', mac: 'x', label: '', cls: 'qualsiasi', vlan: null },
    { key: 'b', mac: 'y', label: '', cls: 'endpoint', vlan: null },
  ], { vendorOf, guessType });
  assert.equal(out[0].cls, 'infra');
  assert.equal(out[1].cls, 'endpoint');
});

test('robusto senza helper iniettati e con input vuoto', () => {
  assert.deepEqual(buildAdoptCandidates(null), []);
  const out = buildAdoptCandidates([{ key: 'a', mac: 'z', label: 'vista su X', cls: 'infra', vlan: 5 }]);
  assert.equal(out[0].vendor, '');
  assert.equal(out[0].typeDefault, 'switch');   // nessun guessType → fallback infra
  assert.equal(out[0].seenOn, 'X');
});

test('passthrough ip + hostname per i candidati da lease DHCP', () => {
  const out = buildAdoptCandidates([
    { key: 'dhcp:AA:BB:CC:00:00:45', mac: 'AA:BB:CC:00:00:45', label: 'tv-sala · 192.168.20.45',
      cls: 'endpoint', vlan: 20, ip: '192.168.20.45', hostname: 'tv-sala' },
  ], { vendorOf, guessType });
  assert.equal(out[0].ip, '192.168.20.45');     // → il nodo adottato nasce con l'IP
  assert.equal(out[0].hostname, 'tv-sala');     // → e col nome dal lease
  assert.equal(out[0].cls, 'endpoint');
});

test('ip/hostname assenti (candidati FDB) → stringhe vuote, nessuna regressione', () => {
  const out = buildAdoptCandidates([
    { key: 'dev:1', mac: 'AA:BB:CC:00:00:01', label: 'vista su Sw1', cls: 'infra', vlan: 10 },
  ], { vendorOf, guessType });
  assert.equal(out[0].ip, '');
  assert.equal(out[0].hostname, '');
});
