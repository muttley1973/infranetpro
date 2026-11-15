'use strict';
// ============================================================
// LA CARTA SU CARTA — la vista geografica, in SVG vettoriale (per il PDF).
//
// Le invarianti che questo modulo deve difendere (come la mappa a schema):
//   ① il fondo è un rettangolo bianco DICHIARATO, non un'assenza;
//   ② vettoriale: nessun `<image>`, mai;
//   ③ le coordinate sono quelle del layout — il puntino sta dove il layout dice —
//      e gli archi hanno lo stesso `d` dello schema;
//   ④ ogni parola è già scritta e passa dall'escape XML (un `&` nel nome di una
//      sede non rompe il file);
//   ⑤ niente glifi fuori CP1252: nel PDF verrebbero disegnati SBAGLIATI;
//   ⑥ una carta che non c'è (nessun punto, layout dello schema) è la stringa VUOTA,
//      così chi stampa scrive lo stato vuoto a parole.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildInterSiteGeoLayout } = require('../lib/inter-site-geo.js');
const { buildInterSiteLayout, interSiteEdgePath } = require('../lib/inter-site-layout.js');
const { buildInterSiteGeoMapSvg, buildInterSiteMapSvg } = require('../lib/inter-site-svg.js');

const site = (id, name, lat, lng, role) => ({ id, name, role: role || 'standalone', subnets: [], geo: lat == null ? null : { lat, lng, source: 'manual' } });
const link = (id, a, b, kind) => ({ id, aSiteId: a, bSiteId: b, kind: kind || 'ipsec' });
const ORG = {
  id: 'o', name: 'O',
  sites: [site('tv', 'Treviso', 45.6669, 12.2431, 'hub'), site('cn', 'Conegliano', 45.8885, 12.2977), site('vr', 'Verona', 45.4384, 10.9916), site('x', 'Senza punto')],
  uplinks: [], links: [link('l1', 'tv', 'cn'), link('l2', 'tv', 'vr', 'mpls')],
};
const CONTENUTO = { edgeLabels: { l1: 'IPsec' }, edgeTone: { l1: 'up', l2: 'down' }, labelW: { l1: 30 } };
const carta = (org, content, lay) => buildInterSiteGeoMapSvg(buildInterSiteGeoLayout(org || ORG, lay), content || CONTENUTO);

test('① un SVG completo con il fondo bianco dichiarato come primo disegno', () => {
  const L = buildInterSiteGeoLayout(ORG);
  const svg = buildInterSiteGeoMapSvg(L, CONTENUTO);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+"/);
  assert.ok(svg.includes(`viewBox="0 0 ${L.width} ${L.height}"`));
  assert.match(svg, /^<svg[^>]*><rect x="0" y="0"[^>]*fill="#ffffff"\/>/);
  assert.ok(svg.endsWith('</svg>'));
});

test('② vettoriale: niente immagini', () => {
  assert.ok(!/<image/i.test(carta()));
});

test('③ un puntino per ogni sede con un punto, dove il layout dice; la sede senza punto non c\'è', () => {
  const L = buildInterSiteGeoLayout(ORG);
  const svg = buildInterSiteGeoMapSvg(L, CONTENUTO);
  const cerchi = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map(m => m.slice(1, 4).map(Number));
  assert.equal(cerchi.length, 3);
  for (const n of L.nodes) {
    assert.ok(cerchi.some(c => c[0] === n.px && c[1] === n.py && c[2] === n.dotR), n.siteId);
  }
  assert.ok(!svg.includes('Senza punto'));
});

test('③ ogni arco ha lo stesso `d` dello schema: una geometria sola', () => {
  const L = buildInterSiteGeoLayout(ORG);
  const svg = buildInterSiteGeoMapSvg(L, CONTENUTO);
  for (const e of L.edges) assert.ok(svg.includes(`d="${interSiteEdgePath(e)}"`), e.linkId);
});

test('il collegamento giù è tratteggiato (sopravvive alla fotocopia), il su no', () => {
  const svg = carta();
  const paths = [...svg.matchAll(/<path d="[^"]*" fill="none" stroke="(#[0-9a-f]{6})"[^>]*?(stroke-dasharray="[^"]*")?\/>/g)];
  assert.equal(paths.length, 2);
  assert.equal(paths.filter(p => p[2]).length, 1, 'uno solo tratteggiato');
});

test('la pastiglia di un collegamento porta il testo già scritto', () => {
  assert.match(carta(), />IPsec<\/text>/);
});

test('④ un nome con `&`, `<` e virgolette passa dall\'escape: il file resta XML', () => {
  const org = { id: 'o', name: 'O', sites: [site('a', 'A & B <x> "y"', 45, 12), site('b', 'Altra', 46, 13)], uplinks: [], links: [] };
  const svg = carta(org, {});
  assert.ok(svg.includes('A &amp; B &lt;x&gt; &quot;y&quot;') || svg.includes('A &amp; B &lt;x&gt; "y"'), svg.slice(0, 400));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(svg), 'nessuna & nuda');
  assert.ok(!svg.includes('<x>'));
});

test('il nome si può passare già scritto da chi stampa (`nodeLines`)', () => {
  const svg = carta(ORG, Object.assign({}, CONTENUTO, { nodeLines: { tv: [{ text: 'Treviso (sede)' }] } }));
  assert.match(svg, />Treviso \(sede\)<\/text>/);
});

test('la sede «qui» ha il bordo e il puntino evidenziati', () => {
  const con = carta(ORG, Object.assign({}, CONTENUTO, { here: 'tv' }));
  const senza = carta(ORG, Object.assign({}, CONTENUTO, { here: null }));
  assert.ok(con.includes('#1d4ed8'));
  assert.ok(!senza.includes('#1d4ed8'));
});

test('la scala: una barra con il suo numero tondo', () => {
  const L = buildInterSiteGeoLayout(ORG);
  const svg = buildInterSiteGeoMapSvg(L, CONTENUTO);
  const { interSiteGeoScaleLabel } = require('../lib/inter-site-geo.js');
  assert.ok(svg.includes(`>${interSiteGeoScaleLabel(L.scaleBar.meters)}</text>`));
  assert.ok(svg.includes(`x1="${L.scaleBar.x1}" y1="${L.scaleBar.y}" x2="${L.scaleBar.x2}" y2="${L.scaleBar.y}"`));
});

test('il reticolo: una linea per ogni meridiano e parallelo, con i gradi scritti', () => {
  const L = buildInterSiteGeoLayout(ORG);
  const svg = buildInterSiteGeoMapSvg(L, CONTENUTO);
  const { interSiteGeoDegLabel } = require('../lib/inter-site-geo.js');
  for (const m of L.graticule.meridians) {
    assert.ok(svg.includes(`<line x1="${m.x}" y1="0" x2="${m.x}"`), 'meridiano ' + m.deg);
    if (m.label !== false) assert.ok(svg.includes(`>${interSiteGeoDegLabel(m.deg, 'lng')}</text>`));
  }
  for (const p of L.graticule.parallels) {
    assert.ok(svg.includes(`<line x1="0" y1="${p.y}" x2="`), 'parallelo ' + p.deg);
    if (p.label !== false) assert.ok(svg.includes(`>${interSiteGeoDegLabel(p.deg, 'lat')}</text>`));
  }
});

test('il reticolo sta SOTTO: viene prima dei collegamenti e dei puntini', () => {
  const svg = carta();
  assert.ok(svg.indexOf('<line') < svg.indexOf('<path'));
  assert.ok(svg.indexOf('<path') < svg.indexOf('<circle'));
});

test('un\'etichetta staccata ha il suo filo', () => {
  const sedi = [site('a', 'A', 45.5, 12.0), site('b', 'B', 45.5002, 12.0002), site('c', 'C', 45.4998, 11.9998), site('d', 'D', 45.5001, 11.9997), site('z', 'Lontana', 46.2, 12.0)];
  const L = buildInterSiteGeoLayout({ id: 'o', name: 'O', sites: sedi, uplinks: [], links: [] }, { boxOf: () => ({ w: 120, h: 26 }) });
  const svg = buildInterSiteGeoMapSvg(L, {});
  for (const n of L.nodes.filter(x => x.leader)) {
    assert.ok(svg.includes(`<line x1="${n.leader.x1}" y1="${n.leader.y1}" x2="${n.leader.x2}" y2="${n.leader.y2}"`), n.siteId);
  }
  assert.ok(L.nodes.some(x => x.leader));
});

test('⑤ nessun carattere fuori da CP1252: né un meno tipografico, né una stellina', () => {
  const svg = carta(ORG, Object.assign({}, CONTENUTO, { nodeLines: { tv: [{ text: 'Treviso' }] } }));
  // CP1252 è Latin-1 più un pugno di segni; qui basta che nessun carattere superi U+00FF.
  assert.ok([...svg].every(ch => ch.codePointAt(0) <= 0xff), [...svg].find(ch => ch.codePointAt(0) > 0xff));
  assert.ok(svg.includes('°'), 'il grado c\'è, ed è in CP1252');
});

test('⑥ una carta che non c\'è è la stringa vuota', () => {
  assert.equal(buildInterSiteGeoMapSvg(null, {}), '');
  assert.equal(buildInterSiteGeoMapSvg(undefined, {}), '');
  assert.equal(buildInterSiteGeoMapSvg({}, {}), '');
  assert.equal(carta({ id: 'o', name: 'O', sites: [], uplinks: [], links: [] }), '');
  assert.equal(carta({ id: 'o', name: 'O', sites: [site('a', 'A'), site('b', 'B')], uplinks: [], links: [] }), '', 'nessun punto');
});

test('⑥ il layout dello schema non è una carta: non si disegna come tale', () => {
  assert.equal(buildInterSiteGeoMapSvg(buildInterSiteLayout(ORG), CONTENUTO), '');
});

test('l\'SVG dello schema non cambia: lo stesso disegno degli archi', () => {
  const svg = buildInterSiteMapSvg(buildInterSiteLayout(ORG), CONTENUTO);
  assert.ok(svg.includes('stroke-dasharray="7,4"'));
});

test('una linea del reticolo senza numero (contro il bordo) resta una linea, senza testo', () => {
  const L = buildInterSiteGeoLayout(ORG);
  const muta = JSON.parse(JSON.stringify(L));
  muta.graticule.meridians.forEach(m => { m.label = false; });
  muta.graticule.parallels.forEach(p => { p.label = false; });
  const svg = buildInterSiteGeoMapSvg(muta, CONTENUTO);
  const { interSiteGeoDegLabel } = require('../lib/inter-site-geo.js');
  for (const m of muta.graticule.meridians) {
    assert.ok(svg.includes(`<line x1="${m.x}" y1="0"`), 'la linea c\'è');
    assert.ok(!svg.includes(`>${interSiteGeoDegLabel(m.deg, 'lng')}</text>`), 'il numero no');
  }
  for (const p of muta.graticule.parallels) assert.ok(!svg.includes(`>${interSiteGeoDegLabel(p.deg, 'lat')}</text>`));
});
