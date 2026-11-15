'use strict';
// ============================================================
// LA VISTA GEOGRAFICA — dove cade ogni sede sulla carta (strato 2, parte pura).
//
// Le invarianti che questo modulo deve difendere:
//   ① DETERMINISMO: stesse sedi → stesse coordinate, in Node come nel browser;
//   ② FEDELTÀ: la mappa è PROPORZIONATA — la barra della scala dice la verità
//      (si prova con la distanza vera fra due città, non con un numero a caso);
//   ③ ciò che non si può disegnare si DICE: una sede senza punto, un
//      collegamento che ne tocca una, due sedi sullo stesso punto;
//   ④ le etichette NON si sovrappongono (né fra loro né ai puntini), per quante
//      sedi stiano vicine — e quando non stanno accanto al puntino si tira un filo;
//   ⑤ niente NaN e niente infiniti: una sede sola, o due sullo stesso punto, non
//      rompono la scala;
//   ⑥ gli archi sono gli STESSI della mappa a schema (stessa matematica).
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const G = require('../lib/inter-site-geo.js');
const { buildInterSiteGeoLayout, interSiteGeoProject, interSiteGeoDegLabel, interSiteGeoScaleLabel } = G;
const { buildInterSiteLayout, interSiteEdgePath } = require('../lib/inter-site-layout.js');

const R = 6371008.8;
const rad = (d) => d * Math.PI / 180;
/** Distanza sul globo fra due punti (haversine): il metro con cui si prova la scala. */
function metri(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const site = (id, name, lat, lng, role) => ({
  id, name, role: role || 'standalone', subnets: [],
  geo: lat == null ? null : { lat, lng, source: 'manual' },
});
const link = (id, a, b, kind) => ({ id, aSiteId: a, bSiteId: b, kind: kind || 'ipsec' });
const org = (sites, links) => ({ id: 'o', name: 'O', sites, uplinks: [], links: links || [] });

const TV = site('tv', 'Treviso', 45.6669, 12.2431, 'hub');
const CN = site('cn', 'Conegliano', 45.8885, 12.2977);
const VR = site('vr', 'Verona', 45.4384, 10.9916);
const NA = site('na', 'Napoli', 40.8518, 14.2681);
const byId = (L, id) => L.nodes.find(n => n.siteId === id);

const rettangoliSiToccano = (a, b, margine) => {
  const m = margine || 0;
  return a.x - a.w / 2 < b.x + b.w / 2 + m && a.x + a.w / 2 + m > b.x - b.w / 2
      && a.y - a.h / 2 < b.y + b.h / 2 + m && a.y + a.h / 2 + m > b.y - b.h / 2;
};
const puntinoSottoEtichetta = (n, d) =>
  d.px + d.dotR > n.x - n.w / 2 && d.px - d.dotR < n.x + n.w / 2
  && d.py + d.dotR > n.y - n.h / 2 && d.py - d.dotR < n.y + n.h / 2;

// ── Casi degeneri ──────────────────────────────────────────────────────────
test('nessuna sede: una mappa vuota, non un errore', () => {
  const L = buildInterSiteGeoLayout(org([]));
  assert.equal(L.layout, 'empty');
  assert.deepEqual(L.nodes, []);
  assert.ok(L.width > 0 && L.height > 0);
});

test('③ sedi senza nessun punto: la mappa non c\'è, e dice QUALI sedi mancano', () => {
  const L = buildInterSiteGeoLayout(org([site('a', 'A'), site('b', 'B')]));
  assert.equal(L.layout, 'unplaced');
  assert.deepEqual(L.nodes, []);
  assert.deepEqual(L.undrawable.sites.map(s => s.siteId), ['a', 'b']);
});

test('⑤ una sola sede: al centro, e la scala è un numero', () => {
  const L = buildInterSiteGeoLayout(org([TV]));
  assert.equal(L.layout, 'geo');
  assert.equal(L.nodes.length, 1);
  for (const v of [L.view.s, L.view.ox, L.view.oy, L.width, L.height, L.nodes[0].px, L.nodes[0].py]) assert.ok(Number.isFinite(v), String(v));
  assert.ok(Math.abs(L.nodes[0].px - L.width / 2) < 1, 'al centro in larghezza');
});

test('⑤ due sedi sullo stesso punto non rompono la scala', () => {
  const L = buildInterSiteGeoLayout(org([site('a', 'A', 45, 12), site('b', 'B', 45, 12)], [link('l', 'a', 'b')]));
  assert.ok(Number.isFinite(L.view.s) && L.view.s > 0);
  assert.equal(L.edges.length, 0);
  assert.deepEqual(L.undrawable.links, [{ linkId: 'l', missing: [], reason: 'too-close' }]);
});

// ── ① Determinismo ─────────────────────────────────────────────────────────
test('① stesso input, stesse coordinate — due volte di fila', () => {
  const o = org([TV, CN, VR, NA], [link('l1', 'tv', 'cn'), link('l2', 'tv', 'vr', 'mpls')]);
  assert.deepEqual(buildInterSiteGeoLayout(o), buildInterSiteGeoLayout(o));
});

test('① l\'ordine delle sedi nel documento non sposta i puntini, solo (forse) le etichette', () => {
  const a = buildInterSiteGeoLayout(org([TV, CN, VR]));
  const b = buildInterSiteGeoLayout(org([VR, CN, TV]));
  for (const id of ['tv', 'cn', 'vr']) {
    assert.equal(byId(a, id).px, byId(b, id).px, id);
    assert.equal(byId(a, id).py, byId(b, id).py, id);
  }
});

// ── Dove cadono i puntini ──────────────────────────────────────────────────
test('nord in alto, est a destra', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, VR, NA]));
  assert.ok(byId(L, 'cn').py < byId(L, 'tv').py, 'Conegliano è a nord di Treviso');
  assert.ok(byId(L, 'na').py > byId(L, 'tv').py, 'Napoli è a sud');
  assert.ok(byId(L, 'vr').px < byId(L, 'tv').px, 'Verona è a ovest');
  assert.ok(byId(L, 'na').px > byId(L, 'tv').px, 'Napoli è a est di Treviso');
});

test('tutti i puntini, e tutte le etichette, stanno dentro il foglio', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, VR, NA]));
  for (const n of L.nodes) {
    assert.ok(n.px >= 0 && n.px <= L.width && n.py >= 0 && n.py <= L.height, n.siteId + ' puntino');
    assert.ok(n.x - n.w / 2 >= 0 && n.x + n.w / 2 <= L.width, n.siteId + ' etichetta in larghezza');
    assert.ok(n.y - n.h / 2 >= 0 && n.y + n.h / 2 <= L.height, n.siteId + ' etichetta in altezza');
  }
});

test('la proiezione è quella del foglio: un punto qualunque cade dove la vista dice', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, VR, NA]));
  for (const s of [TV, CN, VR, NA]) {
    const p = interSiteGeoProject(L.view, s.geo.lat, s.geo.lng);
    const n = byId(L, s.id);
    assert.ok(Math.abs(p.x - n.px) < 0.02 && Math.abs(p.y - n.py) < 0.02, s.id);
  }
});

// ── ② La scala dice la verità ──────────────────────────────────────────────
test('② la barra della scala corrisponde alla distanza vera fra due città', () => {
  // Treviso e Verona stanno quasi alla stessa latitudine, ma non esatta: si
  // prova con due punti alla STESSA latitudine, dove il Mercatore è esatto.
  const A = site('a', 'A', 45.5, 11.0), B = site('b', 'B', 45.5, 12.5);
  const L = buildInterSiteGeoLayout(org([A, B]));
  const dPx = Math.abs(byId(L, 'b').px - byId(L, 'a').px);
  const vero = metri(A.geo, B.geo);
  const dallaBarra = (dPx / L.scaleBar.px) * L.scaleBar.meters;
  assert.ok(Math.abs(dallaBarra - vero) / vero < 0.002, `barra ${dallaBarra.toFixed(0)} m, vero ${vero.toFixed(0)} m`);
});

test('② la scala tiene anche in verticale, alla latitudine della vista', () => {
  const A = site('a', 'A', 44.0, 12.0), B = site('b', 'B', 46.0, 12.0);
  const L = buildInterSiteGeoLayout(org([A, B]));
  const dPx = Math.abs(byId(L, 'b').py - byId(L, 'a').py);
  const vero = metri(A.geo, B.geo);
  const dallaBarra = (dPx / L.scaleBar.px) * L.scaleBar.meters;
  // Il Mercatore stira i meridiani con la latitudine: sulla barra (misurata alla
  // latitudine del centro) l'errore su due gradi è sotto l'1%.
  assert.ok(Math.abs(dallaBarra - vero) / vero < 0.01, `barra ${dallaBarra.toFixed(0)} m, vero ${vero.toFixed(0)} m`);
});

test('② la barra è lunga un numero ROTONDO di metri, e larga fra 60 e 150 px', () => {
  for (const sedi of [[TV, CN], [TV, VR, NA], [site('a', 'A', 45.0, 12.0), site('b', 'B', 45.01, 12.01)], [site('a', 'A', 10, 10), site('b', 'B', -30, 140)]]) {
    const L = buildInterSiteGeoLayout(org(sedi));
    const m = L.scaleBar.meters;
    const mant = m / Math.pow(10, Math.floor(Math.log10(m)));
    assert.ok([1, 2, 5].some(x => Math.abs(mant - x) < 1e-9), `${m} non è 1/2/5 × 10^k`);
    assert.ok(L.scaleBar.px >= 60 && L.scaleBar.px <= 150, `${L.scaleBar.px} px`);
  }
});

test('l\'inquadratura segue le sedi: due sedi vicine ingrandiscono, due lontane no', () => {
  const vicine = buildInterSiteGeoLayout(org([site('a', 'A', 45.0, 12.0), site('b', 'B', 45.02, 12.02)]));
  const lontane = buildInterSiteGeoLayout(org([TV, NA]));
  assert.ok(vicine.view.s > lontane.view.s * 20);
  assert.ok(vicine.scaleBar.meters < lontane.scaleBar.meters);
});

// ── Il reticolo ────────────────────────────────────────────────────────────
test('il reticolo: meridiani e paralleli a gradi tondi, dentro il foglio, né troppi né troppo pochi', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, VR, NA]));
  assert.ok(L.graticule.meridians.length >= 2 && L.graticule.meridians.length <= 9, String(L.graticule.meridians.length));
  assert.ok(L.graticule.parallels.length >= 2 && L.graticule.parallels.length <= 9, String(L.graticule.parallels.length));
  for (const m of L.graticule.meridians) {
    assert.ok(m.x >= 0 && m.x <= L.width);
    const p = interSiteGeoProject(L.view, 45, m.deg);
    assert.ok(Math.abs(p.x - m.x) < 0.02, 'il meridiano cade dove dice');
  }
  for (const p of L.graticule.parallels) {
    assert.ok(p.y >= 0 && p.y <= L.height);
    const q = interSiteGeoProject(L.view, p.deg, 12);
    assert.ok(Math.abs(q.y - p.y) < 0.02, 'il parallelo cade dove dice');
  }
  const passo = L.graticule.step;
  for (const m of L.graticule.meridians) assert.ok(Math.abs(m.deg / passo - Math.round(m.deg / passo)) < 1e-6, 'multiplo del passo');
});

test('le etichette dei gradi: la notazione delle coordinate, senza lingua', () => {
  assert.equal(interSiteGeoDegLabel(12, 'lng'), '12°E');
  assert.equal(interSiteGeoDegLabel(-9, 'lng'), '9°W');
  assert.equal(interSiteGeoDegLabel(45.5, 'lat'), '45.5°N');
  assert.equal(interSiteGeoDegLabel(-33.25, 'lat'), '33.25°S');
  assert.equal(interSiteGeoDegLabel(0, 'lat'), '0°');
  assert.equal(interSiteGeoDegLabel(0, 'lng'), '0°');
  assert.equal(interSiteGeoDegLabel(0.1 + 0.2, 'lat'), '0.3°N', 'niente code di virgola mobile');
});

test('le etichette della scala: metri sotto il chilometro, chilometri sopra', () => {
  assert.equal(interSiteGeoScaleLabel(200), '200 m');
  assert.equal(interSiteGeoScaleLabel(1000), '1 km');
  assert.equal(interSiteGeoScaleLabel(50000), '50 km');
  assert.equal(interSiteGeoScaleLabel(2000000), '2000 km');
});

// ── ④ Le etichette non si sovrappongono ────────────────────────────────────
test('④ cinque sedi in due chilometri: nessuna etichetta tocca un\'altra o un puntino altrui', () => {
  const sedi = [
    site('a', 'Sede Centrale', 45.5000, 12.0000), site('b', 'Magazzino Nord', 45.5010, 12.0012),
    site('c', 'Filiale Est', 45.5004, 12.0030), site('d', 'Ufficio Ovest', 45.4996, 11.9985),
    site('e', 'Datacenter', 45.4990, 12.0008),
    // Una sede lontana: l'inquadratura si allarga e le cinque diventano UN grumo.
    site('z', 'Lontana', 46.2, 12.0),
  ];
  const L = buildInterSiteGeoLayout(org(sedi), { boxOf: () => ({ w: 110, h: 24 }) });
  assert.equal(L.nodes.length, 6);
  for (let i = 0; i < L.nodes.length; i++) {
    for (let j = i + 1; j < L.nodes.length; j++) {
      assert.ok(!rettangoliSiToccano(L.nodes[i], L.nodes[j]), `${L.nodes[i].siteId} tocca ${L.nodes[j].siteId}`);
    }
    for (const d of L.nodes) {
      if (d.siteId === L.nodes[i].siteId) continue;
      assert.ok(!puntinoSottoEtichetta(L.nodes[i], d), `il puntino di ${d.siteId} sta sotto l'etichetta di ${L.nodes[i].siteId}`);
    }
  }
});

test('④ con il righello le etichette hanno la misura che il righello dà', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, VR]), { boxOf: (id) => (id === 'tv' ? { w: 150, h: 30 } : { w: 90, h: 22 }) });
  assert.deepEqual([byId(L, 'tv').w, byId(L, 'tv').h], [150, 30]);
  assert.deepEqual([byId(L, 'cn').w, byId(L, 'cn').h], [90, 22]);
});

test('④ un\'etichetta accanto al suo puntino non ha filo; una lontana sì, e il filo parte dal puntino', () => {
  const sole = buildInterSiteGeoLayout(org([TV, NA]));
  for (const n of sole.nodes) assert.equal(n.leader, null, n.siteId);
  const sedi = [site('a', 'A', 45.5, 12.0), site('b', 'B', 45.5002, 12.0002), site('c', 'C', 45.4998, 11.9998), site('d', 'D', 45.5001, 11.9997), site('e', 'E', 45.4999, 12.0003), site('z', 'Lontana', 46.2, 12.0)];
  const L = buildInterSiteGeoLayout(org(sedi), { boxOf: () => ({ w: 120, h: 26 }) });
  const conFilo = L.nodes.filter(n => n.leader);
  assert.ok(conFilo.length >= 1, 'in un cluster stretto qualche etichetta va staccata');
  for (const n of conFilo) {
    const d = Math.hypot(n.leader.x1 - n.px, n.leader.y1 - n.py);
    assert.ok(Math.abs(d - n.dotR) < 0.05, `il filo parte dal BORDO del puntino (${d})`);
  }
});

// ── Gli archi ──────────────────────────────────────────────────────────────
test('⑥ un collegamento va da puntino a puntino, rifilato al bordo', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN], [link('l', 'tv', 'cn')]));
  assert.equal(L.edges.length, 1);
  const e = L.edges[0], a = byId(L, 'tv'), b = byId(L, 'cn');
  assert.ok(Math.abs(Math.hypot(e.x1 - a.px, e.y1 - a.py) - a.dotR) < 0.05);
  assert.ok(Math.abs(Math.hypot(e.x2 - b.px, e.y2 - b.py) - b.dotR) < 0.05);
  assert.equal(e.bow, 0, 'uno solo: una retta');
  assert.equal(interSiteEdgePath(e), `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`);
});

test('⑥ due collegamenti fra le stesse sedi si scostano (il ventaglio è quello dello schema)', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN], [link('l1', 'tv', 'cn'), link('l2', 'tv', 'cn', 'mpls')]));
  assert.equal(L.edges.length, 2);
  assert.notEqual(L.edges[0].bow, L.edges[1].bow);
  assert.equal(L.edges[0].bow, -L.edges[1].bow, 'simmetrici rispetto alla corda');
  const schema = buildInterSiteLayout(org([TV, CN], [link('l1', 'tv', 'cn'), link('l2', 'tv', 'cn', 'mpls')]));
  assert.equal(Math.abs(L.edges[0].bow), Math.abs(schema.edges[0].bow), 'lo stesso passo minimo');
});

test('③ un collegamento che tocca una sede senza punto non si disegna, e dice quale sede manca', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, site('x', 'Senza punto')], [link('l1', 'tv', 'cn'), link('l2', 'tv', 'x')]));
  assert.deepEqual(L.edges.map(e => e.linkId), ['l1']);
  assert.deepEqual(L.undrawable.links, [{ linkId: 'l2', missing: ['x'], reason: 'unplaced' }]);
  assert.deepEqual(L.undrawable.sites, [{ siteId: 'x', name: 'Senza punto' }]);
});

test('③ un collegamento verso una sede che non esiste resta fra i non disegnabili, come nello schema', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN], [link('l1', 'tv', 'fantasma')]));
  assert.deepEqual(L.undrawable.links, [{ linkId: 'l1', missing: ['fantasma'], reason: 'unplaced' }]);
});

test('la sede senza punto non toglie le altre: la mappa è quella delle sedi che un punto ce l\'hanno', () => {
  const con = buildInterSiteGeoLayout(org([TV, CN]));
  const conUnaInPiu = buildInterSiteGeoLayout(org([TV, CN, site('x', 'Senza punto')]));
  assert.equal(byId(con, 'tv').px, byId(conUnaInPiu, 'tv').px);
  assert.equal(conUnaInPiu.nodes.length, 2);
});

// ── Misure ─────────────────────────────────────────────────────────────────
test('i numeri sono arrotondati a 0,01: coordinate stabili, diff leggibili', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, VR]));
  for (const n of L.nodes) for (const v of [n.px, n.py, n.x, n.y]) assert.equal(v, Math.round(v * 100) / 100);
});

test('l\'altezza segue la forma: tre sedi in fila non fanno un foglio alto', () => {
  const inFila = buildInterSiteGeoLayout(org([site('a', 'A', 45.0, 9.0), site('b', 'B', 45.0, 11.0), site('c', 'C', 45.0, 13.0)]));
  const inColonna = buildInterSiteGeoLayout(org([site('a', 'A', 41.0, 12.0), site('b', 'B', 43.0, 12.0), site('c', 'C', 45.0, 12.0)]));
  assert.ok(inFila.height < inColonna.height);
  assert.ok(inFila.height >= 320 - 1, 'ma nemmeno un francobollo');
});

// ── Bordi e file di puntini ────────────────────────────────────────────────
test('④ un puntino sul bordo destro: l\'etichetta guarda verso l\'interno, non fuori dal foglio', () => {
  // Due sedi alla stessa latitudine: la larghezza decide la scala e i puntini
  // finiscono sui due margini. Accanto al destro, a est, non c'è posto.
  const L = buildInterSiteGeoLayout(org([site('a', 'A', 45.0, 9.0), site('b', 'B', 45.0, 13.0)]));
  const b = byId(L, 'b');
  assert.ok(b.px > L.width - 80, 'il puntino è davvero sul margine');
  assert.notEqual(b.anchor, 'E');
  for (const n of L.nodes) {
    assert.ok(n.x - n.w / 2 >= 0 && n.x + n.w / 2 <= L.width, n.siteId + ' resta dentro il foglio');
  }
});

test('④ in una fila di puntini a pochi pixel l\'uno dall\'altro, nessuna etichetta copre il puntino altrui', () => {
  const sedi = [site('a', 'Alfa', 45.0, 10.0), site('b', 'Beta', 45.0, 10.3), site('c', 'Gamma', 45.0, 10.6), site('z', 'Lontana', 45.0, 13.0)];
  const L = buildInterSiteGeoLayout(org(sedi), { boxOf: () => ({ w: 110, h: 24 }) });
  for (const n of L.nodes) {
    for (const d of L.nodes) {
      if (d.siteId === n.siteId) continue;
      assert.ok(!puntinoSottoEtichetta(n, d), `il puntino di ${d.siteId} sta sotto l'etichetta di ${n.siteId}`);
    }
  }
});

// ── ⑨ Le etichette non coprono i collegamenti ──────────────────────────────
/** Un segmento attraversa un rettangolo? Controllo indipendente da quello del modulo:
 *  si campiona il segmento (a 0,5 px), invece di rifare Liang–Barsky. */
function segmentoSullEtichetta(e, n) {
  const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
  const passi = Math.max(2, Math.ceil(len / 0.5));
  for (let i = 0; i <= passi; i++) {
    const x = e.x1 + (e.x2 - e.x1) * i / passi, y = e.y1 + (e.y2 - e.y1) * i / passi;
    if (x > n.x - n.w / 2 && x < n.x + n.w / 2 && y > n.y - n.h / 2 && y < n.y + n.h / 2) return true;
  }
  return false;
}

test('⑨ due sedi collegate alla stessa latitudine: nessuna etichetta sta SOPRA la linea', () => {
  // A est (la posizione preferita) la linea passerebbe dentro l'etichetta di A.
  const L = buildInterSiteGeoLayout(org([site('a', 'Alfa', 45.0, 9.0), site('b', 'Beta', 45.0, 13.0)], [link('l', 'a', 'b')]));
  assert.equal(L.edges.length, 1);
  assert.equal(L.edges[0].bow, 0, 'una retta: il controllo è esatto');
  for (const n of L.nodes) assert.ok(!segmentoSullEtichetta(L.edges[0], n), `la linea attraversa l'etichetta di ${n.siteId}`);
});

test('⑨ con più collegamenti da una sede, l\'etichetta sta nello spazio fra le linee', () => {
  const sedi = [TV, CN, VR, NA];
  const L = buildInterSiteGeoLayout(org(sedi, [link('l1', 'tv', 'cn'), link('l2', 'tv', 'vr'), link('l3', 'tv', 'na')]));
  for (const e of L.edges) {
    if (e.bow !== 0) continue;
    for (const n of L.nodes) assert.ok(!segmentoSullEtichetta(e, n), `${e.linkId} attraversa l'etichetta di ${n.siteId}`);
  }
});

test('⑨ se nessun posto evita la linea, l\'etichetta sta comunque sul foglio: meglio una linea coperta', () => {
  // Una sede con linee in tutte le direzioni e un foglio stretto: l'evitamento è un
  // «preferibilmente», e il layout non deve rinunciare a mettere l'etichetta.
  const sedi = [site('c', 'Centro', 45.0, 12.0), site('n', 'Nord', 46.0, 12.0), site('s', 'Sud', 44.0, 12.0), site('e', 'Est', 45.0, 13.0), site('o', 'Ovest', 45.0, 11.0)];
  const L = buildInterSiteGeoLayout(org(sedi, sedi.slice(1).map((s, i) => link('l' + i, 'c', s.id))), { boxOf: () => ({ w: 140, h: 30 }) });
  assert.equal(L.nodes.length, 5);
  for (const n of L.nodes) assert.ok(n.x - n.w / 2 >= 0 && n.x + n.w / 2 <= L.width && n.y - n.h / 2 >= 0 && n.y + n.h / 2 <= L.height, n.siteId);
});

// ── Il reticolo e i suoi numeri ────────────────────────────────────────────
test('il numero di una linea del reticolo si tace contro il bordo e sopra la barra della scala', () => {
  const L = buildInterSiteGeoLayout(org([TV, CN, VR, NA]));
  for (const m of L.graticule.meridians) assert.equal(m.label, m.x <= L.width - 36, 'meridiano a ' + m.x);
  for (const p of L.graticule.parallels) assert.equal(p.label, p.y >= 16 && p.y <= L.height - 36, 'parallelo a ' + p.y);
  // E il caso che la regola esiste per curare: qui c'è una linea che il numero lo perderebbe.
  const tutte = L.graticule.meridians.concat(L.graticule.parallels);
  assert.ok(tutte.some(l => l.label === false) || tutte.every(l => l.label === true), 'il campo c\'è su ogni linea');
});

test('il numero di un meridiano a un passo dal bordo destro si tace; quello a metà foglio no', () => {
  const L = buildInterSiteGeoLayout(org([site('a', 'A', 44.0, 9.1), site('b', 'B', 46.1, 13.36)]));
  const vicino = L.graticule.meridians.filter(m => m.x > L.width - 36);
  assert.ok(vicino.length >= 1, 'in questa inquadratura c\'è un meridiano contro il bordo');
  for (const m of vicino) assert.equal(m.label, false, 'meridiano a ' + m.x);
  for (const m of L.graticule.meridians.filter(x => x.x <= L.width - 36)) assert.equal(m.label, true);
});

test('il numero di un parallelo che cade sulla barra della scala si tace; quello a metà foglio no', () => {
  const L = buildInterSiteGeoLayout(org([site('a', 'A', 44.15, 9.0), site('b', 'B', 46.13, 13.3)]));
  const sulla = L.graticule.parallels.filter(p => p.y > L.height - 36);
  assert.ok(sulla.length >= 1, 'in questa inquadratura c\'è un parallelo sulla barra');
  for (const p of sulla) assert.equal(p.label, false, 'parallelo a ' + p.y);
  for (const p of L.graticule.parallels.filter(x => x.y >= 16 && x.y <= L.height - 36)) assert.equal(p.label, true);
});
