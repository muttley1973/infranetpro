'use strict';
// ============================================================
// LA MAPPA CON LE STRADE — il modello dei segni (`lib/inter-site-geo-map.js`).
//
// La vista geografica del pannello è una mappa vera (Leaflet, tessere di
// OpenStreetMap). Leaflet sa disegnare; NON sa cosa disegnare. Questo modulo puro
// decide cosa va sulla mappa, e le sue prove sono quelle che in un browser non si
// vedono a occhio:
//   ① un cerchio per ogni sede CON un punto, dove il punto dice — e nessuno per una
//      sede senza: non si piazza «dove capita»;
//   ② una linea per ogni collegamento fra due sedi piazzate, e i collegamenti che ne
//      toccano una che non lo è si DICONO con il motivo;
//   ③ due collegamenti fra le stesse sedi non si sovrappongono: si aprono a ventaglio,
//      simmetrici, e il ventaglio non dipende dall'ordine in cui sono scritti;
//   ④ l'inquadratura contiene tutte le sedi; con una sola si dà un centro e uno zoom;
//   ⑤ deterministico, e senza NaN: sedi sullo stesso punto non rompono niente.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildGeoMapModel } = require('../lib/inter-site-geo-map.js');

const site = (id, name, lat, lng, role) => ({ id, name, role: role || 'standalone', subnets: [], geo: lat == null ? null : { lat, lng, source: 'manual' } });
const link = (id, a, b, kind) => ({ id, aSiteId: a, bSiteId: b, kind: kind || 'ipsec' });
const org = (sites, links) => ({ id: 'o', name: 'O', sites, uplinks: [], links: links || [] });

const TV = site('tv', 'Treviso', 45.6669, 12.2431, 'hub');
const CN = site('cn', 'Conegliano', 45.8885, 12.2977);
const VR = site('vr', 'Verona', 45.4384, 10.9916);
const NA = site('na', 'Napoli', 40.8518, 14.2681);

test('① un cerchio per ogni sede con un punto, dove il punto dice; nessuno per le altre', () => {
  const m = buildGeoMapModel(org([TV, CN, site('x', 'Senza punto')]));
  assert.deepEqual(m.markers.map(k => [k.siteId, k.name, k.lat, k.lng, k.role]), [
    ['tv', 'Treviso', 45.6669, 12.2431, 'hub'],
    ['cn', 'Conegliano', 45.8885, 12.2977, 'standalone'],
  ]);
  assert.deepEqual(m.unplaced, [{ siteId: 'x', name: 'Senza punto' }]);
});

test('① nessuna sede con un punto: niente mappa, e l\'elenco di chi manca', () => {
  const m = buildGeoMapModel(org([site('a', 'A'), site('b', 'B')]));
  assert.deepEqual([m.markers.length, m.lines.length, m.fit], [0, 0, null]);
  assert.deepEqual(m.unplaced.map(s => s.siteId), ['a', 'b']);
});

test('nessuna sede: un modello vuoto, non un errore', () => {
  const m = buildGeoMapModel(org([]));
  assert.deepEqual([m.markers, m.lines, m.unplaced, m.cut, m.fit], [[], [], [], [], null]);
});

test('② un collegamento fra due sedi piazzate è una linea da un punto all\'altro', () => {
  const m = buildGeoMapModel(org([TV, CN], [link('l1', 'tv', 'cn')]));
  assert.equal(m.lines.length, 1);
  const l = m.lines[0];
  assert.deepEqual([l.linkId, l.aSiteId, l.bSiteId], ['l1', 'tv', 'cn']);
  assert.deepEqual(l.coords[0], [45.6669, 12.2431]);
  assert.deepEqual(l.coords[l.coords.length - 1], [45.8885, 12.2977]);
  assert.equal(l.coords.length, 2, 'uno solo: una retta');
});

test('② un collegamento che tocca una sede senza punto, o inesistente, non si disegna e lo dice', () => {
  const m = buildGeoMapModel(org([TV, CN, site('x', 'Senza punto')], [link('l1', 'tv', 'cn'), link('l2', 'tv', 'x'), link('l3', 'tv', 'fantasma')]));
  assert.deepEqual(m.lines.map(l => l.linkId), ['l1']);
  assert.deepEqual(m.cut, [
    { linkId: 'l2', reason: 'unplaced', missing: ['x'] },
    { linkId: 'l3', reason: 'unplaced', missing: ['fantasma'] },
  ]);
});

test('② due sedi sullo stesso punto: il collegamento non ha una linea da disegnare, e lo dice', () => {
  const m = buildGeoMapModel(org([site('a', 'A', 45, 12), site('b', 'B', 45, 12)], [link('l', 'a', 'b')]));
  assert.deepEqual(m.lines, []);
  assert.deepEqual(m.cut, [{ linkId: 'l', reason: 'same-point', missing: [] }]);
  for (const k of m.markers) assert.ok(Number.isFinite(k.lat) && Number.isFinite(k.lng));
});

test('③ due collegamenti fra le stesse sedi si aprono a ventaglio, simmetrici rispetto alla corda', () => {
  const m = buildGeoMapModel(org([TV, VR], [link('l1', 'tv', 'vr'), link('l2', 'tv', 'vr', 'mpls')]));
  assert.equal(m.lines.length, 2);
  const [a, b] = m.lines;
  assert.ok(a.coords.length > 2 && b.coords.length > 2, 'curve, non rette');
  // Stessi capi, curve diverse, e speculari: la media dei punti di mezzo cade sulla corda.
  const mid = (l) => l.coords[Math.floor(l.coords.length / 2)];
  assert.notDeepEqual(mid(a), mid(b));
  const cordaMid = [(TV.geo.lat + VR.geo.lat) / 2, (TV.geo.lng + VR.geo.lng) / 2];
  assert.ok(Math.abs((mid(a)[0] + mid(b)[0]) / 2 - cordaMid[0]) < 2e-6);
  assert.ok(Math.abs((mid(a)[1] + mid(b)[1]) / 2 - cordaMid[1]) < 2e-6);
  for (const l of m.lines) {
    assert.deepEqual(l.coords[0], [TV.geo.lat, TV.geo.lng]);
    assert.deepEqual(l.coords[l.coords.length - 1], [VR.geo.lat, VR.geo.lng]);
  }
});

test('③ il ventaglio non dipende dal verso in cui è scritto il collegamento', () => {
  const dritto = buildGeoMapModel(org([TV, VR], [link('l1', 'tv', 'vr'), link('l2', 'tv', 'vr')]));
  const inverso = buildGeoMapModel(org([TV, VR], [link('l1', 'vr', 'tv'), link('l2', 'vr', 'tv')]));
  // Gli stessi due archi, nello stesso posto sulla mappa (una linea non ha verso): si confrontano i punti di mezzo.
  const mids = (m) => m.lines.map(l => l.coords[Math.floor(l.coords.length / 2)].map(v => Math.round(v * 1e6) / 1e6)).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(mids(dritto), mids(inverso));
});

test('③ più collegamenti in una coppia: il ventaglio è simmetrico anche con tre', () => {
  const m = buildGeoMapModel(org([TV, NA], [link('a', 'tv', 'na'), link('b', 'tv', 'na'), link('c', 'tv', 'na')]));
  const mid = (l) => l.coords[Math.floor(l.coords.length / 2)];
  const cordaMid = [(TV.geo.lat + NA.geo.lat) / 2, (TV.geo.lng + NA.geo.lng) / 2];
  assert.ok(Math.abs(mid(m.lines[1])[0] - cordaMid[0]) < 2e-6 && Math.abs(mid(m.lines[1])[1] - cordaMid[1]) < 2e-6, 'quello di mezzo sta sulla corda');
  assert.ok(Math.abs((mid(m.lines[0])[0] + mid(m.lines[2])[0]) / 2 - cordaMid[0]) < 2e-6);
});

test('④ l\'inquadratura contiene tutte le sedi piazzate', () => {
  const m = buildGeoMapModel(org([TV, CN, VR, NA]));
  assert.deepEqual(Object.keys(m.fit).sort(), ['bounds', 'center', 'maxZoom']);
  const b = m.fit.bounds;
  for (const k of m.markers) {
    assert.ok(k.lat >= b.south && k.lat <= b.north && k.lng >= b.west && k.lng <= b.east, k.siteId);
  }
  assert.equal(b.north, 45.8885);
  assert.equal(b.south, 40.8518);
});

test('④ con una sede sola: un centro e uno zoom ragionevole, non un riquadro di zero gradi', () => {
  const m = buildGeoMapModel(org([TV]));
  assert.deepEqual(m.fit.center, [45.6669, 12.2431]);
  assert.equal(m.fit.bounds, null);
  assert.ok(m.fit.maxZoom >= 10 && m.fit.maxZoom <= 16);
});

test('④ due sedi sullo stesso punto equivalgono a una sola, per l\'inquadratura', () => {
  const m = buildGeoMapModel(org([site('a', 'A', 45, 12), site('b', 'B', 45, 12)]));
  assert.equal(m.fit.bounds, null);
  assert.deepEqual(m.fit.center, [45, 12]);
});

test('⑤ stesso input, stesso modello — due volte di fila', () => {
  const o = org([TV, CN, VR, NA], [link('l1', 'tv', 'cn'), link('l2', 'tv', 'vr'), link('l3', 'tv', 'vr', 'mpls')]);
  assert.deepEqual(buildGeoMapModel(o), buildGeoMapModel(o));
});

test('⑤ nessun NaN, mai: nemmeno con linee quasi uguali', () => {
  const m = buildGeoMapModel(org([site('a', 'A', 45, 12), site('b', 'B', 45.0000001, 12.0000001)], [link('l1', 'a', 'b'), link('l2', 'a', 'b')]));
  for (const l of m.lines) for (const [la, lo] of l.coords) assert.ok(Number.isFinite(la) && Number.isFinite(lo));
});

test('i numeri hanno sei decimali: ~11 cm, e nessuna coda di virgola mobile', () => {
  const m = buildGeoMapModel(org([TV, VR], [link('l1', 'tv', 'vr'), link('l2', 'tv', 'vr')]));
  for (const l of m.lines) for (const c of l.coords) for (const v of c) assert.equal(v, Math.round(v * 1e6) / 1e6);
});

test('③ due collegamenti scritti in versi OPPOSTI fra le stesse sedi non si sovrappongono', () => {
  // Il capo «A» di uno è Treviso, dell'altro Verona: senza un verso canonico della coppia
  // le due curve finirebbero dallo stesso lato, una sopra l'altra.
  const m = buildGeoMapModel(org([TV, VR], [link('l1', 'tv', 'vr'), link('l2', 'vr', 'tv')]));
  const mid = (l) => l.coords[Math.floor(l.coords.length / 2)];
  assert.notDeepEqual(mid(m.lines[0]), mid(m.lines[1]), 'curve distinte');
  const cordaMid = [(TV.geo.lat + VR.geo.lat) / 2, (TV.geo.lng + VR.geo.lng) / 2];
  assert.ok(Math.abs((mid(m.lines[0])[0] + mid(m.lines[1])[0]) / 2 - cordaMid[0]) < 2e-6, 'simmetriche rispetto alla corda');
  assert.ok(Math.abs((mid(m.lines[0])[1] + mid(m.lines[1])[1]) / 2 - cordaMid[1]) < 2e-6);
});

// ── Cerchi vicini → un cerchio solo con il numero (come Prospix) ──────────
const { clusterMarkers } = require('../lib/inter-site-geo-map.js');
const it = (id, x, y, lat, lng) => ({ id, x, y, lat: lat == null ? 45 : lat, lng: lng == null ? 12 : lng });

test('cluster: sedi lontane restano ciascuna per conto suo, nell\'ordine dato', () => {
  const g = clusterMarkers([it('a', 0, 0), it('b', 200, 0), it('c', 0, 200)], 46);
  assert.deepEqual(g.map(x => x.ids), [['a'], ['b'], ['c']]);
});

test('cluster: due sedi a meno della soglia diventano UN gruppo, posto alla media dei loro punti', () => {
  const g = clusterMarkers([it('a', 0, 0, 45.0, 12.0), it('b', 20, 10, 45.2, 12.4), it('c', 300, 0, 40, 10)], 46);
  assert.deepEqual(g.map(x => x.ids), [['a', 'b'], ['c']]);
  assert.deepEqual([g[0].lat, g[0].lng], [45.1, 12.2]);
  assert.deepEqual([g[1].lat, g[1].lng], [40, 10]);
});

test('cluster: la soglia è STRETTA: a distanza esattamente uguale non si raggruppa', () => {
  assert.equal(clusterMarkers([it('a', 0, 0), it('b', 46, 0)], 46).length, 2);
  assert.equal(clusterMarkers([it('a', 0, 0), it('b', 45.99, 0)], 46).length, 1);
});

test('cluster: il gruppo si misura dalla PRIMA sede, senza catene: A-B vicine, B-C vicine, A-C lontane → {A,B} e {C}', () => {
  const g = clusterMarkers([it('a', 0, 0), it('b', 40, 0), it('c', 80, 0)], 46);
  assert.deepEqual(g.map(x => x.ids), [['a', 'b'], ['c']]);
});

test('cluster: sedi sullo stesso punto si raggruppano, e senza soglia nessuno si raggruppa', () => {
  assert.deepEqual(clusterMarkers([it('a', 5, 5), it('b', 5, 5)], 46).map(x => x.ids), [['a', 'b']]);
  assert.deepEqual(clusterMarkers([it('a', 5, 5), it('b', 5, 5)], 0).map(x => x.ids), [['a'], ['b']]);
  assert.deepEqual(clusterMarkers([it('a', 5, 5), it('b', 5, 5)], -3).map(x => x.ids), [['a'], ['b']]);
});

test('cluster: lo ZOOM decide — le stesse sedi, più lontane sullo schermo, si separano', () => {
  const vicine = [it('a', 0, 0), it('b', 30, 0)];
  const ingrandite = [it('a', 0, 0), it('b', 120, 0)];
  assert.equal(clusterMarkers(vicine, 46).length, 1);
  assert.equal(clusterMarkers(ingrandite, 46).length, 2);
});

test('cluster: input storto non solleva e non produce gruppi', () => {
  for (const v of [null, undefined, 'x', 5, {}, [null, 7, 'x']]) assert.deepEqual(clusterMarkers(v, 46), [], JSON.stringify(v));
  assert.deepEqual(clusterMarkers([it('a', NaN, 0), it('b', 0, 0)], 46).map(x => x.ids), [['b']], 'un punto senza posizione sullo schermo non entra');
});

test('cluster: non muta l\'ingresso, ed è deterministico', () => {
  const dati = [it('a', 0, 0), it('b', 20, 0), it('c', 400, 0)];
  const copia = JSON.parse(JSON.stringify(dati));
  assert.deepEqual(clusterMarkers(dati, 46), clusterMarkers(dati, 46));
  assert.deepEqual(dati, copia);
});

test('cluster: i numeri della media hanno sei decimali', () => {
  const g = clusterMarkers([it('a', 0, 0, 45.123456, 12.0), it('b', 5, 0, 45.000001, 12.1), it('c', 9, 0, 45.0, 12.2)], 46);
  for (const v of [g[0].lat, g[0].lng]) assert.equal(v, Math.round(v * 1e6) / 1e6);
});
