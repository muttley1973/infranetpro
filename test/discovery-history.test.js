'use strict';
// ============================================================
// DISCOVERY-HISTORY — test del cuore puro estratto da src/app-autolink.js.
// pruneDiscoveryHistory (aging + tetto) e normalizeFdbVlan (mappa VLAN-per-MAC).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const {
  pruneDiscoveryHistory, normalizeFdbVlan,
  DISCOVERY_HISTORY_MAX, DISCOVERY_HISTORY_MAX_AGE_DAYS,
} = require('../lib/discovery-history.js');

const DAY = 864e5;
const iso = ms => new Date(ms).toISOString();

test('costanti di default esportate', () => {
  assert.equal(DISCOVERY_HISTORY_MAX, 1000);
  assert.equal(DISCOVERY_HISTORY_MAX_AGE_DAYS, 90);
});

test('pruneDiscoveryHistory: scarta le observation più vecchie del cutoff (lastSeen)', () => {
  const now = Date.UTC(2026, 5, 19);
  const list = [
    { mac: 'old', lastSeen: iso(now - 100 * DAY) },   // oltre 90gg → via
    { mac: 'fresh', lastSeen: iso(now - 10 * DAY) },   // recente → resta
    { mac: 'edge', lastSeen: iso(now - 89 * DAY) },    // appena dentro → resta
  ];
  const out = pruneDiscoveryHistory(list, { now });
  assert.equal(out, list, 'sfoltisce IN PLACE e ritorna lo stesso array');
  assert.deepEqual(list.map(r => r.mac), ['fresh', 'edge']);
});

test('pruneDiscoveryHistory: usa ts come fallback se manca lastSeen', () => {
  const now = Date.UTC(2026, 5, 19);
  const list = [
    { mac: 'a', ts: iso(now - 200 * DAY) },  // vecchio via ts → via
    { mac: 'b', ts: iso(now - 1 * DAY) },    // recente via ts → resta
  ];
  pruneDiscoveryHistory(list, { now });
  assert.deepEqual(list.map(r => r.mac), ['b']);
});

test('pruneDiscoveryHistory: tiene i record senza data valida (legacy)', () => {
  const now = Date.UTC(2026, 5, 19);
  const list = [
    { mac: 'legacy' },                       // nessuna data → tenuto
    { mac: 'old', lastSeen: iso(now - 365 * DAY) }, // vecchio → via
    { mac: 'baddate', lastSeen: 'non-una-data' },   // data invalida → tenuto
  ];
  pruneDiscoveryHistory(list, { now });
  assert.deepEqual(list.map(r => r.mac), ['legacy', 'baddate']);
});

test('pruneDiscoveryHistory: applica il tetto rigido tenendo le più recenti (in coda)', () => {
  const now = Date.now();
  const list = Array.from({ length: 10 }, (_, i) => ({ mac: 'm' + i, lastSeen: iso(now - i * 1000) }));
  pruneDiscoveryHistory(list, { now, max: 4, maxAgeDays: 99999 });
  assert.equal(list.length, 4);
  // splice(0, len-max) rimuove dalla TESTA → restano gli ultimi 4 (m6..m9)
  assert.deepEqual(list.map(r => r.mac), ['m6', 'm7', 'm8', 'm9']);
});

test('pruneDiscoveryHistory: input non-array → ritorna invariato', () => {
  assert.equal(pruneDiscoveryHistory(null), null);
  assert.equal(pruneDiscoveryHistory(undefined), undefined);
});

test('normalizeFdbVlan: parseInt + dedup, prima occorrenza vince', () => {
  const out = normalizeFdbVlan({ 'AA:BB': '10', 'aa:bb': '20', 'CC:DD': 30 });
  // chiave default = lowercase → 'aa:bb' duplicata, vince la prima (10)
  assert.deepEqual(out, { 'aa:bb': 10, 'cc:dd': 30 });
});

test('normalizeFdbVlan: scarta VLAN non numeriche e MAC vuoti', () => {
  const out = normalizeFdbVlan({ 'AA': 'x', '': 5, 'BB': 12 });
  assert.deepEqual(out, { bb: 12 });   // 'AA' scartata (VLAN non numerica), '' scartata (MAC vuoto)
});

test('normalizeFdbVlan: usa il normalizzatore MAC iniettato', () => {
  const stripColon = m => String(m).replace(/[:.-]/g, '').toLowerCase();
  const out = normalizeFdbVlan({ 'AA:BB:CC': 7 }, stripColon);
  assert.deepEqual(out, { aabbcc: 7 });
});

test('normalizeFdbVlan: input non-oggetto → mappa vuota', () => {
  assert.deepEqual(normalizeFdbVlan(null), {});
  assert.deepEqual(normalizeFdbVlan('x'), {});
});
