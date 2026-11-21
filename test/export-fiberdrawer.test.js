'use strict';
// ============================================================
// EXPORT — il cassetto ottico nel rack del dossier (PDF) e nell'helper del draw.io.
// Il rack dal vivo disegna ogni porta come uno SLOT verticale coi fori del connettore (lib/fiber-slot.js). Il PDF era
// un gemello che non lo sapeva: dava al cassetto i LED quadrati di ogni pannello. Ora la geometria (dove sta ogni
// slot, cella e foro) la decide la lib e il PDF dipinge soltanto: qui si prova cosa esce nell'SVG, dentro il DOM-stub,
// con lo stato dell'app vero (come test/export.test.js). La geometria in se' e' provata in fiber-front-geometry.test.js.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const APP = loadApp(path.join(__dirname, '..'));

// Un rack con UN cassetto (così i conteggi dell'SVG sono i suoi) e lo stato delle porte che serve al test.
function svgOf({ node, ports, extra }) {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState();
      if (typeof _migrateState === 'function') _migrateState(state);
      state.nodes.length = 0; state.links.length = 0; state.ports = {};
      const rid = state.currentRack;
      state.nodes.push(Object.assign({ id:'fd1', type:'fiberdrawer', name:'FD-1', rackId:rid, rackU:1, sizeU:1, ports:24,
        spec:{ ppFiberConnector:'lc-duplex' } }, ${JSON.stringify(node || {})}));
      ${extra || ''}
      Object.assign(state.ports, ${JSON.stringify(ports || {})});
      if (typeof _invalidateIdx === 'function') _invalidateIdx();
      return JSON.stringify({ ok:true, svg: (_exportInternals._buildRackSVG(rid, { pdfMode:true }) || {}).svg || '' });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'il builder lancia: ' + r.err);
  return r.svg;
}
const count = (svg, re) => (svg.match(re) || []).length;
const slots = (svg) => count(svg, /<title>[\w-]+ - VLAN /g);   // un titolo per porta disegnata
const circles = (svg) => count(svg, /<circle /g);
const LED = /rx="1\.2"/g;                                    // il LED quadrato del frontale generico

test('24 LC duplex a 1U: 24 slot coi due fori ciascuno, niente LED quadrati', () => {
  const svg = svgOf({});
  assert.equal(slots(svg), 24);
  assert.equal(circles(svg), 48, 'LC duplex = due fori per porta');
  assert.equal(count(svg, LED), 0, 'nessun LED del frontale generico');
});

test('il foro dipende dal connettore dichiarato: SC uno, LC quad due per porta, MPO una bocca rettangolare', () => {
  const sc = svgOf({ node: { spec: { ppFiberConnector: 'sc' } } });
  assert.equal(slots(sc), 24);
  assert.equal(circles(sc), 24, 'SC = un foro grande');
  const quad = svgOf({ node: { ports: 48, spec: { ppFiberConnector: 'lc-quad' } } });
  assert.equal(slots(quad), 48, 'ogni porta e una cella cliccabile');
  assert.equal(circles(quad), 96);
  const mpo = svgOf({ node: { spec: { ppFiberConnector: 'mpo-12' } } });
  assert.equal(slots(mpo), 24);
  assert.equal(circles(mpo), 0, 'l\'MPO non ha fori tondi');
  assert.equal(count(mpo, /fill="#4b5563"/g), 24, 'la ferrula MT dentro la bocca');
});

test('connettore non dichiarato: slot senza fori (non si indovina cosa e\' montato), ma sempre slot', () => {
  const svg = svgOf({ node: { spec: {} } });
  assert.equal(slots(svg), 24);
  assert.equal(circles(svg), 0);
  assert.equal(count(svg, LED), 0);
});

test('il colore dello slot e quello di ogni porta: stato dichiarato e LAG ciano', () => {
  const svg = svgOf({ ports: { 'fd1-1': { status: 'active' }, 'fd1-2': { status: 'fault' }, 'fd1-3': { lagGroup: 'g1' } } });
  assert.equal(count(svg, /fill="#39d353"/g), 1, 'attiva');
  assert.equal(count(svg, /fill="#f85149"/g), 1, 'guasta');
  assert.equal(count(svg, /fill="#00d4ff"/g), 1, 'membro di un LAG');
});

test('una porta nascosta non si disegna e gli altri slot si stringono', () => {
  const svg = svgOf({ ports: { 'fd1-4': { hidden: true }, 'fd1-5': { hidden: true } } });
  assert.equal(slots(svg), 22);
  assert.equal(circles(svg), 44);
});

test('lo spanning-tree in blocco: una diagonale sullo slot, come sul rack dal vivo', () => {
  assert.equal(count(svgOf({}), /stroke="#11161c"/g), 0);
  assert.equal(count(svgOf({ ports: { 'fd1-2': { stpBlocked: 'blocking' } } }), /stroke="#11161c"/g), 1);
  // la cella di un quad: la diagonale e sulla CELLA, non su tutto lo slot
  const quad = svgOf({ node: { ports: 48, spec: { ppFiberConnector: 'lc-quad' } }, ports: { 'fd1-3': { stpBlocked: 'broken' } } });
  assert.equal(count(quad, /stroke="#11161c"/g), 1);
});

test('i numeri sotto gli slot: dove c\'e posto (2U), non nel 1U stretto del PDF', () => {
  assert.equal(count(svgOf({}), /fill="#d0d0d0"/g), 0, '1U: il numero non entra senza rimpicciolire gli slot');
  const two = svgOf({ node: { ports: 48, sizeU: 2, spec: { ppFiberConnector: 'sc' } } });
  assert.equal(slots(two), 48, '48 slot a 2U = due file');
  assert.equal(count(two, /fill="#d0d0d0"/g), 48, 'il numero di ogni slot');
});

test('cassetto composto: la lastra cieca e una scatola scura senza porta, il quad ha le sue due celle', () => {
  const svg = svgOf({ node: { ports: 4, spec: { ppFiberConnector: 'lc-duplex', fdSlots: ['lc-duplex', 'blank', 'lc-quad', 'mpo-12'] } } });
  assert.equal(slots(svg), 4, 'le porte: 1 + 2 + 1 (la lastra non ne ha)');
  assert.equal(count(svg, /fill-opacity="0\.55"/g), 1, 'una lastra');
  assert.equal(circles(svg), 2 + 2 * 2, 'duplex 2 fori, quad 2 celle da 2');
});

test('troppi slot per le U (25 a 1U): vale il frontale generico di sempre, come sul rack dal vivo', () => {
  const svg = svgOf({ node: { ports: 25 } });
  assert.equal(circles(svg), 0);
  assert.equal(count(svg, LED), 25, 'LED quadrati');
  // anche due piani di LED chiesti dall'utente
  const seq = svgOf({ node: { frontPanel: { baseLayout: 'sequential' } } });
  assert.equal(circles(seq), 0);
  assert.equal(count(seq, LED), 24);
});

test('un patch panel non cambia: LED quadrati', () => {
  const svg = svgOf({ node: { type: 'patchpanel', sizeU: 2, spec: { ppFiberConnector: 'lc-duplex' } } });
  assert.equal(circles(svg), 0);
  assert.equal(count(svg, LED), 24);
});

test('l\'SVG del cassetto e ben formato: coordinate finite, niente NaN', () => {
  for (const node of [{}, { ports: 48, spec: { ppFiberConnector: 'lc-quad' } }, { ports: 4, spec: { ppFiberConnector: 'lc-duplex', fdSlots: ['blank', 'blank'] } }]) {
    const svg = svgOf({ node });
    assert.ok(!/NaN|undefined|Infinity/.test(svg), 'valori non numerici nell\'SVG');
  }
});

test('slot e fori stanno dove devono: dentro la faccia del device, e il foro e piu piccolo dello slot', () => {
  for (const node of [{}, { ports: 48, spec: { ppFiberConnector: 'lc-quad' } }, { ports: 48, sizeU: 2, spec: { ppFiberConnector: 'sc' } }]) {
    const svg = svgOf({ node });
    const fr = /<title>FD-1 - U1[^<]*<\/title><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="2"/.exec(svg);
    assert.ok(fr, 'la faccia del device');
    const frame = { x: +fr[1], y: +fr[2], w: +fr[3], h: +fr[4] };
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="0\.6" fill="#[0-9a-f]{6}" stroke="#334155"/g)]
      .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
    assert.ok(rects.length >= 24, 'gli slot');
    for (const r of rects) {
      assert.ok(r.x >= frame.x && r.y >= frame.y && r.x + r.w <= frame.x + frame.w && r.y + r.h <= frame.y + frame.h, `slot dentro la faccia: ${JSON.stringify(r)} / ${JSON.stringify(frame)}`);
      assert.ok(r.h > r.w * 0.9, 'uno slot in piedi');
    }
    // la targhetta del nome sta a destra: gli slot non ci vanno sopra (portRight = labelX - 8)
    assert.ok(Math.max(...rects.map((r) => r.x + r.w)) <= frame.x + frame.w - 62 - 8 - 8 + 0.01, 'gli slot non invadono la targhetta');
    const r0 = rects[0];
    // i fori sono scuri (come .fo-svg sul rack), quindi si vedono sul colore dello slot
    assert.equal(count(svg, /<circle [^>]*fill="#0b0f14"/g), circles(svg), 'ogni foro tondo e scuro');
    const rad = [...svg.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => +m[1]);
    if (rad.length) assert.ok(Math.max(...rad) < r0.w / 2 && Math.min(...rad) > r0.w * 0.1, `foro piu piccolo dello slot: r=${Math.max(...rad)} su larghezza ${r0.w}`);
  }
});

test('la cella di un modulo senza porta (nascosta) e una vetrina scura, non una porta', () => {
  const svg = svgOf({ node: { ports: 48, spec: { ppFiberConnector: 'lc-quad' } }, ports: { 'fd1-2': { hidden: true } } });
  assert.equal(slots(svg), 47);
  assert.equal(count(svg, /fill-opacity="0\.35"/g), 1, 'la cella vuota, piu chiara della lastra');
  assert.equal(count(svg, /fill-opacity="0\.55"/g), 0, 'nessuna lastra');
});

test('il numero sotto lo slot e quello della prima porta del modulo', () => {
  const sc = svgOf({ node: { ports: 48, sizeU: 2, spec: { ppFiberConnector: 'sc' } } });
  const nums = [...sc.matchAll(/fill="#d0d0d0">(\d+)<\/text>/g)].map((m) => +m[1]);
  assert.deepEqual(nums, Array.from({ length: 48 }, (_, i) => i + 1));
  // (a 2U il quad e troppo alto per il numero senza rimpicciolirsi: a 3U due file da 26 ci stanno)
  const quad = svgOf({ node: { ports: 96, sizeU: 3, spec: { ppFiberConnector: 'lc-quad' } } });
  const qn = [...quad.matchAll(/fill="#d0d0d0">(\d+)<\/text>/g)].map((m) => +m[1]);
  assert.deepEqual(qn.slice(0, 4), [1, 3, 5, 7], 'un quad ha due porte per slot: il numero e quello della prima');
  assert.equal(qn.length, 48);
  assert.equal(count(svgOf({ node: { ports: 96, sizeU: 2, spec: { ppFiberConnector: 'lc-quad' } } }), /fill="#d0d0d0"/g), 0, 'a 2U il quad non ha posto per i numeri');
});

test('la glue del draw.io passa il frontale del cassetto: stessa geometria del PDF, null per chi non e un cassetto', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState();
      if (typeof _migrateState === 'function') _migrateState(state);
      state.nodes.length = 0; state.links.length = 0; state.ports = {};
      const rid = state.currentRack;
      state.nodes.push({ id:'fd1', type:'fiberdrawer', name:'FD-1', rackId:rid, rackU:1, sizeU:1, ports:24, spec:{ ppFiberConnector:'lc-duplex' } },
                       { id:'sw', type:'switch', name:'SW', rackId:rid, rackU:3, sizeU:1, ports:24 },
                       { id:'fd2', type:'fiberdrawer', name:'FD-2', rackId:rid, rackU:5, sizeU:2, ports:48, spec:{ ppFiberConnector:'sc' } });
      state.ports['fd1-3'] = { hidden:true };
      if (typeof _invalidateIdx === 'function') _invalidateIdx();
      const cap = {}; const real = buildDrawioXml;
      buildDrawioXml = (m) => { cap.m = m; return '<mxfile/>'; };
      try { exportDrawio(); } catch(e) { cap.err = String(e); } finally { buildDrawioXml = real; }
      const f = cap.m && cap.m.helpers && cap.m.helpers.fiberFront;
      if (!f) return JSON.stringify({ ok:false, err: cap.err || 'helper fiberFront assente' });
      const box = { x:12, y:1, w:192, h:18 };
      const g = f(state.nodes[0], 1, box, p => !!(state.ports['fd1-' + p] || {}).hidden);
      return JSON.stringify({ ok:true,
        slots: g ? g.rows.flat().length : null,
        ports: g ? g.rows.flat().flatMap(s => s.cells.map(c => c.port)).slice(0, 5) : null,
        switchFront: f(state.nodes[1], 1, box, () => false),
        // le U del device arrivano alla lib: 48 slot a 2U sono due file, a 1U non entrano (null)
        rows2U: (() => { const g2 = f(state.nodes[2], 2, { x:12, y:1, w:192, h:38 }, () => false); return g2 ? g2.rows.length : null; })(),
        rows1U: f(state.nodes[2], 1, box, () => false) });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'la glue lancia: ' + r.err);
  assert.equal(r.slots, 23, 'una porta nascosta in meno, come nel PDF');
  assert.deepEqual(r.ports, [1, 2, 4, 5, 6], 'la porta 3 e nascosta: salta');
  assert.equal(r.switchFront, null, 'uno switch non ha frontale a slot');
  assert.equal(r.rows2U, 2, 'le U del device arrivano alla lib: 48 slot a 2U = due file');
  assert.equal(r.rows1U, null, 'a 1U 48 slot non entrano: frontale generico');
});
