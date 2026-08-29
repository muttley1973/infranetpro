// La mappa inter-sede STAMPATA (lib/inter-site-svg.js).
//
// Un SVG che a schermo si vede benissimo può uscire dal PDF come un foglio di
// forme nere, o peggio: bianco su bianco, se chi l'ha generato aveva il tema
// scuro. Le prove qui sotto sono quelle che difendono da questo — il fondo
// bianco dichiarato, i colori negli attributi e non in un CSS che nel PDF non
// esiste, e il `d` degli archi preso dal modulo delle coordinate invece di
// riscritto.
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOrganization } = require('../lib/inter-site.js');
const { factDeclared } = require('../lib/provenance.js');
const { buildInterSiteLayout, interSiteEdgePath } = require('../lib/inter-site-layout.js');
const { buildInterSiteMapSvg } = require('../lib/inter-site-svg.js');

const ORG = normalizeOrganization({
  id: 'o', name: 'Prova',
  sites: [
    { id: 'mi', name: 'Milano', role: 'hub', subnets: ['10.10.0.0/16'] },
    { id: 'rm', name: 'Roma', role: 'spoke', subnets: ['10.20.0.0/16'] },
    { id: 'na', name: 'Napoli', role: 'spoke', subnets: [] },
  ],
  uplinks: [],
  links: [
    // ⚠️ DUE collegamenti fra le stesse due sedi — il caso vero (MPLS primario +
    // IPsec di backup): è l'unico che ha archi SCOSTATI, e quindi l'unico che
    // distingue una quadratica da una retta. Con un solo collegamento per coppia
    // ogni arco è dritto, e una guardia sul `d` passerebbe anche a chi lo
    // riscrive sbagliato.
    { id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec', state: factDeclared('up') },
    { id: 'l3', aSiteId: 'mi', bSiteId: 'rm', kind: 'mpls', state: factDeclared('up') },
    { id: 'l2', aSiteId: 'mi', bSiteId: 'na', kind: 'gre', state: factDeclared('down') },
  ],
});

const CONTENUTO = {
  nodeLines: {
    mi: [{ text: 'Milano' }, { text: 'Fastweb · Fibra', muted: true }],
    rm: [{ text: 'Roma' }],
    na: [{ text: 'Napoli' }],
  },
  nodeTag: { mi: 'Hub' },
  edgeLabels: { l1: 'IPsec · 2 reti', l2: 'GRE' },
  edgeTone: { l1: 'up', l2: 'down' },
  labelW: { l1: 60, l2: 20 },
  here: 'mi',
};

const mappa = (org, content) => buildInterSiteMapSvg(buildInterSiteLayout(org || ORG), content || CONTENUTO);

test('⭐ ① il fondo bianco è DICHIARATO, e copre tutto il disegno', () => {
  const svg = mappa();
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(vb, 'il viewBox c\'è');
  // Un SVG «trasparente» stampato si appoggia su qualunque cosa ci sia sotto, e
  // in un PDF chiaro non si nota — finché qualcuno non lo mette su una copertina
  // scura. Il bianco è un rettangolo, non un'assenza.
  const primo = svg.indexOf('<rect');
  assert.ok(svg.slice(primo, primo + 200).includes('fill="#ffffff"'), 'il primo rect è il foglio bianco');
  assert.ok(svg.includes(`<rect x="0" y="0" width="${vb[1]}" height="${vb[2]}" fill="#ffffff"/>`),
    'e misura esattamente il viewBox');
});

test('⭐ ② nessuna classe CSS: nel PDF il foglio di stile non c\'è', () => {
  const svg = mappa();
  // L'SVG del pannello è vestito di classi (`org-node-box`, `org-edge-line`) e i
  // colori stanno nel CSS: passato a svg-to-pdfkit uscirebbe un disegno di forme
  // nere senza bordi. Qui ogni colore è un attributo.
  assert.ok(!/\sclass=/.test(svg), 'nessun attributo class');
  assert.ok(!svg.includes('<style'), 'nessun blocco di stile');
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'con xmlns: senza, il file non si apre da solo');
  assert.ok(/stroke="#[0-9a-f]{6}"/i.test(svg) && /fill="#[0-9a-f]{6}"/i.test(svg), 'i colori sono attributi');
});

test('⭐ ③ il `d` degli archi è quello del modulo delle coordinate, non una seconda scrittura', () => {
  const L = buildInterSiteLayout(ORG);
  const svg = buildInterSiteMapSvg(L, CONTENUTO);
  // È la difesa contro il difetto che in questo progetto è tornato dodici volte:
  // due posti che disegnano la stessa cosa e divergono al primo ritocco.
  assert.ok(L.edges.some(e => e.bow !== 0), 'il banco ha almeno un arco SCOSTATO, o non si prova niente');
  for (const e of L.edges) {
    assert.ok(svg.includes(`d="${interSiteEdgePath(e)}"`), 'arco ' + e.linkId + ' col path del layout');
  }
});

test('④ un collegamento dichiarato giù si vede anche in fotocopia: è tratteggiato', () => {
  const svg = mappa();
  // Il rosso e il verde in bianco e nero diventano lo stesso grigio. Il
  // tratteggio no.
  const archi = svg.match(/<path [^>]*\/>/g) || [];
  assert.equal(archi.length, 3);
  const giu = archi.filter(a => a.includes('stroke-dasharray'));
  assert.equal(giu.length, 1, 'solo quello dichiarato giù');
  assert.ok(giu[0].includes('#b91c1c'), 'e porta anche il colore');
  assert.ok(archi.some(a => a.includes('#15803d') && !a.includes('dasharray')), 'quello su resta pieno');
});

test('⑤ la sede del progetto stampato ha un bordo suo', () => {
  const svg = mappa();
  assert.ok(svg.includes('stroke="#1d4ed8"'), 'il riquadro di «qui» si distingue');
  const senzaQui = buildInterSiteMapSvg(buildInterSiteLayout(ORG), Object.assign({}, CONTENUTO, { here: null }));
  assert.ok(!senzaQui.includes('#1d4ed8'), 'e senza un progetto in mano non si evidenzia niente');
});

test('⑥ il testo si XML-escapa: un nome con & o < non deve rompere il file', () => {
  const svg = buildInterSiteMapSvg(buildInterSiteLayout(ORG), Object.assign({}, CONTENUTO, {
    nodeLines: { mi: [{ text: 'A & B <Milano>' }], rm: [{ text: 'Roma' }], na: [{ text: 'Napoli' }] },
  }));
  assert.ok(svg.includes('A &amp; B &lt;Milano&gt;'));
  assert.ok(!svg.includes('<Milano>'), 'nessun tag inventato dal nome di una sede');
});

test('⑦ nessuna sede: stringa vuota, così chi stampa scrive lo stato vuoto a parole', () => {
  const vuota = normalizeOrganization({ id: 'o', name: 'x', sites: [], uplinks: [], links: [] });
  assert.equal(buildInterSiteMapSvg(buildInterSiteLayout(vuota), {}), '');
  assert.equal(buildInterSiteMapSvg(null, {}), '');
  // Un rettangolo bianco al posto della mappa si legge come un guasto dell'export.
});

test('⑧ l\'etichetta del ruolo è TESTO: i font standard del PDF non hanno la stellina', () => {
  const svg = mappa();
  assert.ok(svg.includes('>Hub</text>'), 'il marcatore dell\'hub è una parola');
  // ⚠️ Un glifo fuori CP1252 non viene sostituito: viene disegnato SBAGLIATO.
  assert.ok(!svg.includes('★'));
});

test('⑨ la pastiglia di un collegamento si disegna solo se se ne conosce la larghezza', () => {
  const conMisura = mappa();
  assert.ok(/<rect [^>]*rx="10"[^>]*stroke="#15803d"/.test(conMisura), 'misurata: ha il suo riquadro');
  const senza = buildInterSiteMapSvg(buildInterSiteLayout(ORG), Object.assign({}, CONTENUTO, { labelW: {} }));
  // Una pastiglia di larghezza indovinata è un rettangolo che non contiene le
  // parole: peggio del rettangolo che manca.
  assert.ok(senza.includes('IPsec'), 'il testo resta');
  assert.ok(!/<rect [^>]*stroke="#15803d"/.test(senza), 'ma senza riquadro sotto');
});
