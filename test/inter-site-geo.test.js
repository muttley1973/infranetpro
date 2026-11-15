'use strict';
// ============================================================
// IL PUNTO DI UNA SEDE — `Site.geo` (Fase 1 della mappa reale, strato 1: il DATO).
//
// Le invarianti che questa fetta deve difendere:
//   ① il punto lo DICHIARA l'utente (a mano, con «Trova» confermato, o con un
//      clic sulla carta): `source` dice come è arrivato, non lo inventa nessuno;
//   ② un punto è DUE numeri o niente: una latitudine sola non diventa «lat, 0»;
//   ③ un valore fuori dal globo non si corregge e non si porta a metà: cade;
//   ④ `Number(null)` e `Number('')` valgono ZERO — un campo vuoto non è l'Atlantico;
//   ⑤ un `source` fuori vocabolario non rifiuta il punto (che è un fatto dell'utente),
//      ma non si inventa: resta `null`;
//   ⑥ la forma è IDEMPOTENTE: rileggere un documento già normalizzato non lo tocca.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const IS = require('../lib/inter-site.js');
const { GEO_SOURCES, parseCoordinate, normalizeGeo, normalizeSite, normalizeOrganization } = IS;

const S = (over) => Object.assign({ id: 'tv', name: 'Treviso' }, over || {});

test('i modi in cui un punto può nascere sono quattro, chiusi, e «a mano» è il primo', () => {
  assert.deepEqual(GEO_SOURCES, ['manual', 'geocoded', 'map', 'dcim']);
});

// ── ② ④ Una coordinata ─────────────────────────────────────────────────────
test('④ una coordinata vuota NON è zero', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(parseCoordinate(v, 'lat'), null, JSON.stringify(v));
    assert.equal(parseCoordinate(v, 'lng'), null, JSON.stringify(v));
  }
});

test('una coordinata è un numero, o un testo che lo scrive con punto o con virgola', () => {
  assert.equal(parseCoordinate(45.6667, 'lat'), 45.6667);
  assert.equal(parseCoordinate('45.6667', 'lat'), 45.6667);
  assert.equal(parseCoordinate(' 45,6667 ', 'lat'), 45.6667, 'la virgola decimale italiana');
  assert.equal(parseCoordinate('-12.5', 'lng'), -12.5);
  assert.equal(parseCoordinate('+12.5', 'lng'), 12.5);
  assert.equal(parseCoordinate(0, 'lat'), 0, 'zero è un valore vero: l\'equatore');
});

test('③ fuori dal globo cade: 90 e 180 sono i bordi, e restano dentro', () => {
  assert.equal(parseCoordinate(90, 'lat'), 90);
  assert.equal(parseCoordinate(-90, 'lat'), -90);
  assert.equal(parseCoordinate(90.0001, 'lat'), null);
  assert.equal(parseCoordinate(180, 'lng'), 180);
  assert.equal(parseCoordinate(-180, 'lng'), -180);
  assert.equal(parseCoordinate(180.5, 'lng'), null);
  // La stessa cifra vale per un asse e non per l'altro.
  assert.equal(parseCoordinate(120, 'lat'), null);
  assert.equal(parseCoordinate(120, 'lng'), 120);
});

test('③ ciò che non è un numero scritto semplice cade, non si indovina', () => {
  for (const v of ['45.6.6', '45,6,6', '1,234.5', '45°40′N', '45.6 N', 'abc', NaN, Infinity, {}, [], true, '0x10', '1e2']) {
    assert.equal(parseCoordinate(v, 'lat'), null, String(v));
  }
});

test('un asse sconosciuto non passa: la funzione non ha un\'opinione di riserva', () => {
  assert.equal(parseCoordinate(10, 'alt'), null);
  assert.equal(parseCoordinate(10), null);
});

test('si tengono sei decimali: ~11 cm, e nessuna coda di virgola mobile', () => {
  assert.equal(parseCoordinate(45.12345678, 'lat'), 45.123457);
  assert.equal(parseCoordinate('12.1234564', 'lng'), 12.123456);
});

// ── ② Un punto: due numeri o niente ────────────────────────────────────────
test('② un punto sono lat e lng, e la sorgente dice come è arrivato', () => {
  assert.deepEqual(normalizeGeo({ lat: 45.6667, lng: 12.25, source: 'geocoded' }),
    { lat: 45.6667, lng: 12.25, source: 'geocoded' });
  assert.deepEqual(normalizeGeo({ lat: '45,6667', lng: '12.25', source: 'manual' }),
    { lat: 45.6667, lng: 12.25, source: 'manual' });
});

test('② una coordinata sola non fa un punto: non diventa «lat, 0»', () => {
  assert.equal(normalizeGeo({ lat: 45.6, lng: null }), null);
  assert.equal(normalizeGeo({ lat: 45.6 }), null);
  assert.equal(normalizeGeo({ lng: 12.2 }), null);
  assert.equal(normalizeGeo({ lat: '', lng: '' }), null);
});

test('③ se UNA delle due è fuori dal globo, cade tutto il punto', () => {
  assert.equal(normalizeGeo({ lat: 95, lng: 12 }), null);
  assert.equal(normalizeGeo({ lat: 45, lng: 200 }), null);
});

test('⑤ una sorgente fuori vocabolario non toglie il punto, e non se ne inventa una', () => {
  assert.deepEqual(normalizeGeo({ lat: 45, lng: 12, source: 'google' }), { lat: 45, lng: 12, source: null });
  assert.deepEqual(normalizeGeo({ lat: 45, lng: 12 }), { lat: 45, lng: 12, source: null });
});

test('niente che non sia un oggetto diventa un punto', () => {
  for (const v of [null, undefined, '45,12', 5, [], [45, 12], true]) {
    assert.equal(normalizeGeo(v), null, JSON.stringify(v));
  }
});

test('un punto non porta altro che le sue tre cose: l\'indirizzo non entra dal retro', () => {
  const g = normalizeGeo({ lat: 45, lng: 12, source: 'map', address: 'via Roma 1', label: 'x' });
  assert.deepEqual(Object.keys(g).sort(), ['lat', 'lng', 'source']);
});

// ── Dentro la sede e dentro l'organizzazione ───────────────────────────────
test('una sede senza punto lo dice: `geo` è null, non assente', () => {
  assert.equal(normalizeSite(S()).geo, null);
});

test('una sede con un punto lo tiene, accanto all\'indirizzo che non cambia', () => {
  const s = normalizeSite(S({ address: 'Viale Brigata Treviso 1', geo: { lat: '45,66', lng: '12,24', source: 'map' } }));
  assert.equal(s.address, 'Viale Brigata Treviso 1');
  assert.deepEqual(s.geo, { lat: 45.66, lng: 12.24, source: 'map' });
});

test('⑥ idempotente: rileggere ciò che si è già normalizzato non lo cambia', () => {
  const una = normalizeSite(S({ geo: { lat: 45.123456789, lng: '12,5', source: 'geocoded' } }));
  assert.deepEqual(normalizeSite(una), una);
});

test('il punto attraversa la normalizzazione dell\'organizzazione', () => {
  const org = normalizeOrganization({
    id: 'o', name: 'O',
    sites: [S({ geo: { lat: 45.6, lng: 12.2, source: 'manual' } }), { id: 'rm', name: 'Roma' }],
    uplinks: [], links: [],
  });
  assert.deepEqual(org.sites[0].geo, { lat: 45.6, lng: 12.2, source: 'manual' });
  assert.equal(org.sites[1].geo, null);
});
