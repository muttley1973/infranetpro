'use strict';
// Test delle validazioni Wi-Fi documentazione-grade (lib/wifi-spec.js).
const test = require('node:test');
const assert = require('node:assert');
const { channelsForBand, validateWifi, WIFI_BANDS, WIFI_SECURITY, WIFI_STANDARDS, standardSupportsBand } = require('../lib/wifi-spec.js');

test('channelsForBand: range coerenti per banda', () => {
  assert.deepEqual(channelsForBand('2.4')[0], 1);
  assert.equal(channelsForBand('2.4').includes(13), true);
  assert.equal(channelsForBand('2.4').includes(36), false);
  assert.equal(channelsForBand('5').includes(36), true);
  assert.equal(channelsForBand('5').includes(165), true);
  assert.equal(channelsForBand('6').includes(1), true);
  assert.equal(channelsForBand('6').includes(233), true);
  assert.deepEqual(channelsForBand('boh'), []);
});

test('canale fuori banda → errore channel-band', () => {
  const r = validateWifi({ band: '2.4', channel: 36 });
  assert.equal(r.some(i => i.code === 'channel-band' && i.level === 'error'), true);
});

test('canale valido per banda → nessun errore channel-band', () => {
  const r = validateWifi({ band: '5', channel: 36 });
  assert.equal(r.some(i => i.code === 'channel-band'), false);
});

test('6 GHz + WPA2 → errore band6-security', () => {
  const r = validateWifi({ band: '6', channel: 37, security: 'wpa2-psk' });
  assert.equal(r.some(i => i.code === 'band6-security' && i.level === 'error'), true);
});

test('6 GHz + WPA3 → ok (nessun errore sicurezza)', () => {
  const r = validateWifi({ band: '6', channel: 37, security: 'wpa3-personal' });
  assert.equal(r.some(i => i.code === 'band6-security'), false);
});

test('rete aperta → warning open-network', () => {
  const r = validateWifi({ band: '2.4', channel: 6, security: 'open' });
  assert.equal(r.some(i => i.code === 'open-network' && i.level === 'warn'), true);
});

test('config coerente → nessun problema', () => {
  assert.deepEqual(validateWifi({ band: '5', channel: 44, security: 'wpa3-personal' }), []);
});

test('input vuoto → nessun crash, nessun problema', () => {
  assert.deepEqual(validateWifi({}), []);
  assert.deepEqual(validateWifi(), []);
});

test('cataloghi esposti', () => {
  assert.equal(WIFI_BANDS.includes('5'), true);
  assert.equal(WIFI_SECURITY.includes('wpa3-personal'), true);
});

test('canale Auto (o vuoto) → niente check canale↔banda', () => {
  assert.deepEqual(validateWifi({ band: '2.4', channel: 'auto' }), []);
  assert.deepEqual(validateWifi({ band: '5', channel: '' }), []);
});

test('standardSupportsBand: Wi-Fi 5 solo 5; Wi-Fi 6E solo 6; Wi-Fi 7 tri-banda', () => {
  assert.equal(standardSupportsBand('wifi5', '5'), true);
  assert.equal(standardSupportsBand('wifi5', '2.4'), false);
  assert.equal(standardSupportsBand('wifi6e', '6'), true);
  assert.equal(standardSupportsBand('wifi6e', '2.4'), false);   // 6E = radio 6 GHz
  assert.equal(standardSupportsBand('wifi7', '2.4'), true);     // Wi-Fi 7 = tri-banda (MLO)
});

test('6E @ 2.4 → warning standard-band (combinazione segnalata)', () => {
  const r = validateWifi({ standard: 'wifi6e', band: '2.4' });
  assert.equal(r.some(i => i.code === 'standard-band'), true);
});

test('standard↔banda incoerente → warning standard-band', () => {
  const r = validateWifi({ standard: 'wifi5', band: '2.4' });
  assert.equal(r.some(i => i.code === 'standard-band' && i.level === 'warn'), true);
});

test('WIFI_STANDARDS arriva fino a Wi-Fi 7 (Wi-Fi 8 ancora non incluso)', () => {
  assert.equal(WIFI_STANDARDS.some(s => s.id === 'wifi7'), true);
  assert.equal(WIFI_STANDARDS.some(s => s.id === 'wifi8'), false);
});

test('channelGroupsForBand: sotto-bande UNII + DFS, somma = lista piatta', () => {
  const { channelGroupsForBand } = require('../lib/wifi-spec.js');
  const g5 = channelGroupsForBand('5');
  assert.equal(g5.length, 4);
  assert.deepEqual(g5[0], { label: 'UNII-1', channels: [36, 40, 44, 48] });
  assert.equal(g5.some(g => g.dfs), true);                 // 2A/2C marcati DFS
  // la concatenazione dei gruppi coincide con channelsForBand (sorgente unica)
  const flat = g5.flatMap(g => g.channels);
  assert.deepEqual(flat, channelsForBand('5'));
  // 6 GHz: 59 canali totali su 4 sotto-bande
  assert.equal(channelsForBand('6').length, 59);
  assert.equal(channelGroupsForBand('6').length, 4);
});
