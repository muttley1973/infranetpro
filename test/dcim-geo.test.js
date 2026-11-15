'use strict';
// ============================================================
// LA POSIZIONE DI UNA SEDE, LETTA DAL DCIM — la parte PURA (`lib/dcim-geo.js`).
//
// Il DCIM tiene latitudine e longitudine di ogni sito (NetBox: `latitude`,
// `longitude`, decimali). L'import le propone come punto della sede, ma una
// proposta è onesta solo se:
//   ① si LEGGE soltanto ciò che il DCIM dichiara: due numeri validi, o niente —
//      una coordinata sola non diventa «lat, 0», e un valore fuori dal globo cade;
//   ② «non dichiara una posizione» ≠ «ne dichiara una storta» ≠ «il sito non c'è
//      più»: tre risposte diverse, perché a schermo dicono tre cose diverse;
//   ③ l'AMBITO lo dice chi chiede (gli id dei siti NetBox del progetto-sede):
//      un sito che il DCIM torna senza che nessuno l'abbia chiesto non entra
//      (un filtro ignorato dal server non deve allargare la lettura);
//   ④ ogni coordinata passa dalla STESSA regola del modello (`parseCoordinate`):
//      una definizione sola di «coordinata valida».
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const G = require('../lib/dcim-geo.js');
const { sitesToGeo, GEODCIM_ERRORS } = G;

const MI = { id: 11, name: 'Milano DC', latitude: 45.4642, longitude: 9.19 };
const RM = { id: 12, name: 'Roma Sede', latitude: 41.9028, longitude: 12.4964 };

test('① un sito con due coordinate valide è un punto proposto', () => {
  const r = sitesToGeo([MI], { siteIds: [11] });
  assert.deepEqual(r.found, [{ siteId: '11', name: 'Milano DC', lat: 45.4642, lng: 9.19 }]);
  assert.deepEqual([r.noPosition, r.invalid, r.missing], [[], [], []]);
});

test('① le coordinate possono arrivare come testo: NetBox le scrive a sei decimali', () => {
  const r = sitesToGeo([{ id: 11, name: 'Milano DC', latitude: '45.464200', longitude: '9.190000' }], { siteIds: [11] });
  assert.deepEqual(r.found.map(x => [x.lat, x.lng]), [[45.4642, 9.19]]);
});

test('① zero è una coordinata vera: l\'equatore non è «vuoto»', () => {
  const r = sitesToGeo([{ id: 1, name: 'Equatore', latitude: 0, longitude: 0 }], { siteIds: [1] });
  assert.deepEqual(r.found.map(x => [x.lat, x.lng]), [[0, 0]]);
});

test('② un sito senza coordinate è «nessuna posizione», non un errore', () => {
  for (const s of [{ id: 11, name: 'A' }, { id: 11, name: 'A', latitude: null, longitude: null }, { id: 11, name: 'A', latitude: '', longitude: '' }]) {
    const r = sitesToGeo([s], { siteIds: [11] });
    assert.deepEqual(r.noPosition, [{ siteId: '11', name: 'A' }], JSON.stringify(s));
    assert.deepEqual([r.found, r.invalid], [[], []]);
  }
});

test('② una coordinata sola non fa un punto: è «storta», con il suo motivo', () => {
  const r = sitesToGeo([{ id: 11, name: 'A', latitude: 45.1, longitude: null }, { id: 12, name: 'B', latitude: null, longitude: 9.1 }], { siteIds: [11, 12] });
  assert.deepEqual(r.invalid, [
    { siteId: '11', name: 'A', reason: 'half' },
    { siteId: '12', name: 'B', reason: 'half' },
  ]);
  assert.deepEqual(r.found, []);
});

test('② fuori dal globo, o non un numero: «storta», e non si corregge', () => {
  const r = sitesToGeo([
    { id: 1, name: 'A', latitude: 95, longitude: 10 },
    { id: 2, name: 'B', latitude: 40, longitude: 200 },
    { id: 3, name: 'C', latitude: 'nord', longitude: 'est' },
  ], { siteIds: [1, 2, 3] });
  assert.deepEqual(r.invalid.map(x => [x.siteId, x.reason]), [['1', 'invalid'], ['2', 'invalid'], ['3', 'invalid']]);
  assert.deepEqual(r.found, []);
});

test('② un sito chiesto che il DCIM non torna è «sparito», con il suo id', () => {
  const r = sitesToGeo([MI], { siteIds: [11, 99] });
  assert.deepEqual(r.missing, ['99']);
  assert.equal(r.found.length, 1);
});

test('③ un sito che nessuno ha chiesto non entra: il filtro ignorato non allarga la lettura', () => {
  const r = sitesToGeo([MI, RM, { id: 13, name: 'Napoli', latitude: 40.85, longitude: 14.26 }], { siteIds: [11] });
  assert.deepEqual(r.found.map(x => x.siteId), ['11']);
  assert.deepEqual([r.noPosition, r.invalid, r.missing], [[], [], []]);
});

test('③ gli id si confrontano come testo: «11» e 11 sono lo stesso sito', () => {
  assert.deepEqual(sitesToGeo([MI], { siteIds: ['11'] }).found.map(x => x.siteId), ['11']);
  assert.deepEqual(sitesToGeo([{ id: '11', name: 'A', latitude: 1, longitude: 2 }], { siteIds: [11] }).found.map(x => x.siteId), ['11']);
});

test('l\'ordine è quello dell\'AMBITO chiesto, non quello in cui il server ha risposto', () => {
  const r = sitesToGeo([RM, MI], { siteIds: [11, 12] });
  assert.deepEqual(r.found.map(x => x.siteId), ['11', '12']);
});

test('un sito ripetuto nella risposta conta una volta sola', () => {
  const r = sitesToGeo([MI, MI], { siteIds: [11] });
  assert.equal(r.found.length, 1);
});

test('④ il nome è testo ripulito (controlli, spazi) e, se manca, resta l\'id', () => {
  const r = sitesToGeo([{ id: 11, name: ' Mila\u0000no\n DC ', latitude: 45, longitude: 9 }, { id: 12, latitude: 41, longitude: 12 }], { siteIds: [11, 12] });
  assert.equal(r.found[0].name, 'Milano DC', 'come ogni altro testo di terzi: passa da cleanUserText');
  assert.equal(r.found[1].name, null);
});

test('niente che non sia un elenco di siti produce un punto, e niente solleva', () => {
  for (const v of [null, undefined, {}, 'x', 5, [null, 7, 'x', [], { name: 'senza id', latitude: 1, longitude: 2 }]]) {
    const r = sitesToGeo(v, { siteIds: [11] });
    assert.deepEqual(r.found, [], JSON.stringify(v));
  }
  assert.deepEqual(sitesToGeo([MI], {}).found, [], 'senza ambito non si legge niente');
  assert.deepEqual(sitesToGeo([MI], { siteIds: [] }).found, []);
  assert.deepEqual(sitesToGeo([MI]).found, []);
});

test('un punto porta solo ciò che serve: né descrizione, né indirizzo, né altro del sito', () => {
  const r = sitesToGeo([{ id: 11, name: 'A', latitude: 1, longitude: 2, description: 'segreto', physical_address: 'via X', tenant: { id: 1 } }], { siteIds: [11] });
  assert.deepEqual(Object.keys(r.found[0]).sort(), ['lat', 'lng', 'name', 'siteId']);
  assert.ok(!JSON.stringify(r).includes('segreto'));
});

test('il vocabolario dei guasti della rotta è uno, e chiuso', () => {
  assert.deepEqual(GEODCIM_ERRORS, ['no-scope', 'not-configured', 'dcim-unreachable']);
});
