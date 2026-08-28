'use strict';
// ============================================================
// LAYOUT INTER-SEDE — le coordinate della mappa (Fase 1).
//
// Le invarianti che questo modulo deve difendere:
//   ① DETERMINISMO: stesso input → stesse coordinate. Una mappa che si assesta
//      diversamente a ogni apertura non si può confrontare né stampare due volte;
//   ② la forma la decide il RUOLO DICHIARATO, e i casi ambigui (zero hub, due
//      hub) cadono sull'anello invece di scegliere al posto dell'utente;
//   ③ ciò che non è disegnabile si DICE (`undrawable`), non sparisce;
//   ⑤ due collegamenti fra le stesse due sedi non si sovrappongono;
//   · nessuna sede si tocca, per quante siano;
//   · tutto sta dentro il viewBox dichiarato.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildInterSiteLayout, interSiteEdgePath, INTER_SITE_LAYOUT_DEFAULTS } = require('../lib/inter-site-layout.js');

const site = (id, name, role) => ({ id, name, role: role || 'standalone', subnets: [] });
const link = (id, a, b, kind) => ({ id, aSiteId: a, bSiteId: b, kind: kind || 'ipsec' });
const uplink = (id, siteId) => ({ id, siteId, provider: 'ISP' });

/** Un'organizzazione a `n` sedi, tutte `standalone`, senza collegamenti. */
const ring = (n) => ({
  id: 'o', name: 'O',
  sites: Array.from({ length: n }, (_, i) => site('s' + i, 'Sede ' + i)),
  uplinks: [], links: [],
});

const byId = (L, id) => L.nodes.find(n => n.siteId === id);

// ── ① Determinismo ─────────────────────────────────────────────────────────
test('① stesso input, stesse coordinate — due volte di fila', () => {
  const org = {
    id: 'acme', name: 'Acme',
    sites: [site('mi', 'Milano', 'hub'), site('rm', 'Roma', 'spoke'), site('na', 'Napoli', 'spoke')],
    uplinks: [uplink('u1', 'mi'), uplink('u2', 'mi')],
    links: [link('l1', 'mi', 'rm'), link('l2', 'mi', 'na', 'mpls')],
  };
  assert.deepEqual(buildInterSiteLayout(org), buildInterSiteLayout(org));
});

test('① l\'ordine sull\'anello è quello DICHIARATO, non uno riordinato', () => {
  // Le sedi si susseguono in senso orario nell'ordine in cui sono scritte: se il
  // layout le riordinasse (per nome, per id), spostare una riga nel form
  // cambierebbe la mappa senza che nessuno l'abbia chiesto.
  const L = buildInterSiteLayout(ring(4));
  const angles = L.nodes.map(n => n.angle);
  assert.deepEqual(L.nodes.map(n => n.siteId), ['s0', 's1', 's2', 's3']);
  for (let i = 1; i < angles.length; i++) assert.ok(angles[i] > angles[i - 1], 'angoli crescenti');
});

// ── Casi degeneri ─────────────────────────────────────────────────────────
test('nessuna sede: una mappa vuota, non un errore e non un disegno finto', () => {
  const L = buildInterSiteLayout({ sites: [], uplinks: [], links: [] });
  assert.equal(L.layout, 'empty');
  assert.deepEqual(L.nodes, []);
  assert.ok(L.width > 0 && L.height > 0, 'il viewBox esiste comunque: chi disegna non deve difendersi');
});

test('un\'organizzazione assurda non esplode: cade sul vuoto', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    assert.equal(buildInterSiteLayout(bad).layout, 'empty');
  }
});

test('una sede sola sta al centro, non su un anello di raggio uno', () => {
  const L = buildInterSiteLayout(ring(1));
  assert.equal(L.layout, 'single');
  assert.equal(L.nodes.length, 1);
  assert.equal(L.nodes[0].center, true);
  assert.equal(L.nodes[0].angle, null);
});

// ── ② La forma la decide il ruolo dichiarato ──────────────────────────────
test('② UN hub dichiarato → hub al centro, il resto in cerchio', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano', 'hub'), site('rm', 'Roma', 'spoke'), site('na', 'Napoli', 'spoke')],
    uplinks: [], links: [],
  });
  assert.equal(L.layout, 'hub');
  assert.equal(L.hubSiteId, 'mi');
  assert.equal(byId(L, 'mi').center, true);
  assert.equal(byId(L, 'rm').center, false);
  assert.equal(byId(L, 'na').center, false);
});

test('② DUE hub → anello, e nessuno al centro: sceglierne uno sarebbe inventare', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano', 'hub'), site('rm', 'Roma', 'hub'), site('na', 'Napoli', 'spoke')],
    uplinks: [], links: [],
  });
  assert.equal(L.layout, 'ring');
  assert.equal(L.hubSiteId, null);
  assert.equal(L.nodes.filter(n => n.center).length, 0);
});

test('② zero hub → anello', () => {
  assert.equal(buildInterSiteLayout(ring(3)).layout, 'ring');
});

test('② un hub SENZA spoke resta una sede sola al centro', () => {
  const L = buildInterSiteLayout({ sites: [site('mi', 'Milano', 'hub')], uplinks: [], links: [] });
  assert.equal(L.layout, 'single');
  assert.equal(L.nodes[0].center, true);
  assert.equal(L.ringR, 0, 'senza spoke non c\'è anello da disegnare');
});

// ── Nessuna sovrapposizione, per quante siano ─────────────────────────────
test('l\'anello cresce con le sedi: due riquadri vicini non si toccano mai', () => {
  // ⑩ La misura che conta è la LARGHEZZA: i riquadri sono più larghi che alti,
  // quindi è lei a decidere se due vicini si sovrappongono.
  const R = INTER_SITE_LAYOUT_DEFAULTS.nodeW / 2;
  for (const n of [2, 3, 5, 8, 13, 30]) {
    const L = buildInterSiteLayout(ring(n));
    const on = L.nodes.filter(x => !x.center);
    for (let i = 1; i < on.length; i++) {
      const d = Math.hypot(on[i].x - on[i - 1].x, on[i].y - on[i - 1].y);
      assert.ok(d >= 2 * R, `con ${n} sedi due vicine distano ${d.toFixed(1)} < ${2 * R}`);
    }
  }
});

// ── ⑥ La mappa si legge su un foglio largo ────────────────────────────────
test('⑥ un hub e due filiali si dispongono in ORIZZONTALE, non in colonna', () => {
  // È il caso più comune di tutti. Senza il mezzo passo di rotazione le due
  // filiali finivano in cima e in fondo: una striscia verticale in un foglio
  // largo, con l'80% dello spazio sprecato e il disegno rimpicciolito per stare
  // nell'altezza.
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano', 'hub'), site('rm', 'Roma', 'spoke'), site('na', 'Napoli', 'spoke')],
    uplinks: [], links: [],
  });
  assert.ok(L.width > L.height, `la mappa deve essere più larga che alta (${L.width}×${L.height})`);
  const rm = byId(L, 'rm'), na = byId(L, 'na'), mi = byId(L, 'mi');
  assert.ok(Math.abs(rm.y - na.y) < 0.5, 'le due filiali stanno alla stessa altezza');
  assert.ok((rm.x - mi.x) * (na.x - mi.x) < 0, 'una per lato dell\'hub');
});

test('⑥ il mezzo passo NON riordina e NON avvicina: cambia solo l\'orientamento', () => {
  const R = INTER_SITE_LAYOUT_DEFAULTS.nodeW / 2;
  for (const n of [2, 4, 6, 10]) {
    const L = buildInterSiteLayout(ring(n));
    assert.deepEqual(L.nodes.map(x => x.siteId), Array.from({ length: n }, (_, i) => 's' + i), 'ordine dichiarato');
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(L.nodes[i].x - L.nodes[i - 1].x, L.nodes[i].y - L.nodes[i - 1].y);
      assert.ok(d >= 2 * R, `con ${n} sedi due vicine distano ${d.toFixed(1)}`);
    }
  }
});

test('tutto il disegno sta DENTRO il viewBox dichiarato', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano', 'hub'), site('rm', 'Roma'), site('na', 'Napoli'), site('to', 'Torino')],
    uplinks: [uplink('u1', 'mi'), uplink('u2', 'rm'), uplink('u3', 'rm')],
    links: [link('l1', 'mi', 'rm'), link('l2', 'mi', 'rm', 'mpls'), link('l3', 'rm', 'na')],
  });
  const inside = (x, y, what) => {
    assert.ok(x >= 0 && x <= L.width, `${what}: x=${x} fuori da 0..${L.width}`);
    assert.ok(y >= 0 && y <= L.height, `${what}: y=${y} fuori da 0..${L.height}`);
  };
  for (const n of L.nodes) { inside(n.x - n.w / 2, n.y - n.h / 2, 'nodo'); inside(n.x + n.w / 2, n.y + n.h / 2, 'nodo'); }
  for (const e of L.edges) { inside(e.x1, e.y1, 'arco'); inside(e.x2, e.y2, 'arco'); inside(e.mx, e.my, 'apice'); }
});

// ── ③ Ciò che non si può disegnare si DICE ────────────────────────────────
test('③ un collegamento verso una sede inesistente non sparisce: è dichiarato indisegnabile', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')],
    uplinks: [uplink('u9', 'fantasma')],
    links: [link('ok', 'mi', 'rm'), link('ko', 'mi', 'fantasma')],
  });
  assert.deepEqual(L.edges.map(e => e.linkId), ['ok'], 'l\'arco senza un capo non si disegna…');
  assert.deepEqual(L.undrawable.links, [{ linkId: 'ko', missing: ['fantasma'] }], '…ma si dice quale, e cosa manca');
  assert.deepEqual(L.undrawable.uplinks, [{ uplinkId: 'u9', siteId: 'fantasma' }]);
});

test('③ una mappa sana non dichiara niente di indisegnabile', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')],
    uplinks: [uplink('u1', 'mi')], links: [link('l1', 'mi', 'rm')],
  });
  assert.deepEqual(L.undrawable, { links: [], uplinks: [] });
});

test('un `kind` fuori vocabolario non arriva nemmeno a essere disegnato', () => {
  // Composizione con `normalizeInterSiteLink` (scelta ⑤ di lib/inter-site.js):
  // il layout non ha una seconda opinione sul vocabolario, e non deve averla.
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')],
    uplinks: [], links: [link('l1', 'mi', 'rm', 'wireguard')],
  });
  assert.deepEqual(L.edges, []);
  assert.deepEqual(L.undrawable.links, [], 'non è indisegnabile: non esiste proprio');
});

// ── ⑤ Archi della stessa coppia ───────────────────────────────────────────
test('⑤ due collegamenti fra le stesse sedi si scostano in modo simmetrico', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')],
    uplinks: [],
    links: [link('primario', 'mi', 'rm', 'mpls'), link('backup', 'mi', 'rm', 'ipsec')],
  });
  const [a, b] = L.edges;
  assert.equal(a.bow, -b.bow, 'simmetrici rispetto alla corda');
  assert.notEqual(a.bow, 0);
  assert.notEqual(interSiteEdgePath(a), interSiteEdgePath(b), 'due percorsi diversi, non due rette sovrapposte');
});

test('⑤ un collegamento solo resta una RETTA', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')], uplinks: [], links: [link('l1', 'mi', 'rm')],
  });
  assert.equal(L.edges[0].bow, 0);
  assert.match(interSiteEdgePath(L.edges[0]), /^M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+$/);
});

test('⑤ tre collegamenti: quello di mezzo resta dritto, gli altri due si aprono', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')], uplinks: [],
    links: [link('a', 'mi', 'rm'), link('b', 'mi', 'rm', 'mpls'), link('c', 'mi', 'rm', 'sdwan')],
  });
  assert.deepEqual(L.edges.map(e => e.bow), [-INTER_SITE_LAYOUT_DEFAULTS.bowStep, 0, INTER_SITE_LAYOUT_DEFAULTS.bowStep]);
});

test('lo scostamento non dipende dall\'ordine dei capi (a↔b è la stessa coppia)', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')], uplinks: [],
    links: [link('andata', 'mi', 'rm'), link('ritorno', 'rm', 'mi', 'mpls')],
  });
  assert.equal(L.edges.length, 2);
  assert.ok(L.edges.every(e => e.bow !== 0), 'due archi sulla stessa coppia, scritta nei due versi');
});

test('l\'arco parte dal BORDO del riquadro, non dal centro', () => {
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')], uplinks: [], links: [link('l1', 'mi', 'rm')],
  });
  const e = L.edges[0], A = byId(L, 'mi'), B = byId(L, 'rm');
  // Sul BORDO del rettangolo: una delle due coordinate tocca il lato.
  assert.ok(Math.abs(Math.abs(e.x1 - A.x) - A.w / 2) < 0.05 || Math.abs(Math.abs(e.y1 - A.y) - A.h / 2) < 0.05);
  assert.ok(Math.abs(Math.abs(e.x2 - B.x) - B.w / 2) < 0.05 || Math.abs(Math.abs(e.y2 - B.y) - B.h / 2) < 0.05);
  // e DENTRO il riquadro non ci finisce: il testo non viene attraversato.
  assert.ok(Math.abs(e.x1 - A.x) >= A.w / 2 - 0.05 || Math.abs(e.y1 - A.y) >= A.h / 2 - 0.05);
});

// ── ⑩ Gli uplink stanno DENTRO la sede ────────────────────────────────────
test('⑩ gli uplink appartengono alla SEDE, e viaggiano col suo nodo', () => {
  // Erano monconi che uscivano verso il fuori, e a chi guardava la mappa
  // sembravano staccati dal collegamento. Un uplink è di una sede
  // (`wanUplink.siteId`), e la sede è il capo del collegamento: il nodo se li
  // porta dentro, in ordine dichiarato.
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano', 'hub'), site('rm', 'Roma', 'spoke')],
    uplinks: [uplink('u-fibra', 'mi'), uplink('u-backup', 'mi'), uplink('u-rm', 'rm')],
    links: [],
  });
  assert.deepEqual(byId(L, 'mi').uplinkIds, ['u-fibra', 'u-backup'], 'ordine dichiarato, non riordinato');
  assert.deepEqual(byId(L, 'rm').uplinkIds, ['u-rm']);
  assert.ok(!('uplinks' in L), 'non esistono più monconi da disegnare fuori');
});

test('⑩ una sede senza uplink porta una lista VUOTA, non l\'assenza del campo', () => {
  // Chi disegna non deve difendersi da `undefined`: «nessuna linea» è una
  // risposta, e si vede come lista vuota.
  assert.deepEqual(buildInterSiteLayout(ring(2)).nodes[0].uplinkIds, []);
});

test('⛔ l\'operatore NON viene appoggiato sull\'arco: nessuno ha dichiarato quale linea lo porta', () => {
  // La tentazione era mettere il nome dell'operatore al capo del collegamento,
  // come se quella linea portasse quel tunnel. Con due linee in una sede non lo
  // sa nessuno — l'unico posto dove l'associazione esiste è `underlayUplinkIds`
  // dell'SD-WAN — e disegnarla sarebbe inventare con la faccia di un fatto.
  const L = buildInterSiteLayout({
    sites: [site('mi', 'Milano'), site('rm', 'Roma')],
    uplinks: [uplink('u1', 'mi'), uplink('u2', 'mi')],
    links: [link('l1', 'mi', 'rm')],
  });
  assert.deepEqual(Object.keys(L.edges[0]).filter(k => /uplink/i.test(k)), [],
    'un arco non porta e non può portare un uplink');
});

// ── ④ Il righello si può passare da fuori ─────────────────────────────────
test('④ chi disegna può passare la misura VERA dei riquadri', () => {
  // Il modulo puro non sa quanto è largo un testo; chi disegna sì. Con il
  // righello la geometria si adatta — ed è lo stesso meccanismo che userà
  // l'export PDF, con il suo motore di misura al posto del canvas.
  const org = {
    sites: [site('mi', 'Milano'), site('rm', 'Roma')], uplinks: [],
    links: [link('l1', 'mi', 'rm')],
  };
  const senza = buildInterSiteLayout(org);
  const con = buildInterSiteLayout(org, { boxOf: (id) => (id === 'mi' ? { w: 400, h: 200 } : { w: 120, h: 60 }) });
  assert.equal(byId(con, 'mi').w, 400);
  assert.equal(byId(con, 'mi').h, 200);
  assert.equal(byId(con, 'rm').w, 120);
  assert.ok(con.width > senza.width, 'un riquadro più largo allarga anche l\'anello');
});

test('④ un righello che risponde male non rompe niente: si torna alla misura dichiarata', () => {
  // ⚠️ `null` è il caso insidioso: `Number(null)` è 0, che è FINITO — senza
  // escluderlo prima della conversione, «non lo so» sarebbe diventato «zero», e
  // il riquadro sarebbe uscito largo zero. È la trappola `+null === 0` che
  // questo repo ha già annotato in `lib/ipam-model.js`.
  for (const risposta of [{ w: 'larghissimo', h: null }, null, {}, { w: undefined, h: '' }, 'no']) {
    const L = buildInterSiteLayout(ring(3), { boxOf: () => risposta });
    assert.equal(L.nodes[0].w, INTER_SITE_LAYOUT_DEFAULTS.nodeW, JSON.stringify(risposta));
    assert.equal(L.nodes[0].h, INTER_SITE_LAYOUT_DEFAULTS.nodeH, JSON.stringify(risposta));
  }
});

// ── Geometria parametrica ─────────────────────────────────────────────────
test('le misure sono parametri: chi esporta può disegnare più grande', () => {
  const org = ring(4);
  const piccolo = buildInterSiteLayout(org);
  const grande = buildInterSiteLayout(org, { nodeW: 420, nodeH: 160, minRingR: 500 });
  assert.ok(grande.width > piccolo.width && grande.height > piccolo.height);
  assert.equal(grande.nodes[0].w, 420);
  assert.equal(grande.nodes[0].h, 160);
});

test('un\'opzione assurda non rompe la geometria: si torna al default', () => {
  const L = buildInterSiteLayout(ring(3), { nodeW: 'grande', pad: null });
  assert.equal(L.nodes[0].w, INTER_SITE_LAYOUT_DEFAULTS.nodeW);
  assert.ok(Number.isFinite(L.width) && L.width > 0);
});

test('il numero di subnet della sede viaggia col nodo (l\'etichetta non rilegge l\'org)', () => {
  const L = buildInterSiteLayout({
    sites: [{ id: 'mi', name: 'Milano', role: 'hub', subnets: ['10.1.0.0/24', '10.1.1.0/24'] }],
    uplinks: [], links: [],
  });
  assert.equal(L.nodes[0].subnets, 2);
  assert.equal(L.nodes[0].name, 'Milano');
});
