'use strict';
// macsuck lato client: l'evento SSE 'located' porta { [macLowercase]: edge }.
// _discApplyEdges aggancia l'edge alle righe scoperte (match per MAC normalizzato
// lowercase; le righe hanno il MAC MAIUSCOLO) e _discEdgeBadge lo rende come badge
// "porta di accesso". Inoltre una riga da lease DHCP prende _via:'dhcp'. DOM-stub.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (located-edges)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('_discApplyEdges: aggancia l\'edge per MAC (case-insensitive)', () => {
  run(APP.ctx, `window._discResults = [
    { ip:'192.168.1.220', mac:'E8:06:88:CB:F4:1F' },
    { ip:'192.168.1.234', mac:'2A:50:30:1F:8C:AB' },
    { ip:'192.168.1.9',   mac:'' }
  ];`);
  const out = JSON.parse(run(APP.ctx, `JSON.stringify({
    n: _discApplyEdges({
      'e8:06:88:cb:f4:1f': { switchIp:'10.0.0.1', switchName:'SW-CORE', ifName:'Gi0/5', macCount:1, ambiguous:false }
    }),
    edge: window._discResults[0].edge,
    other: window._discResults[1].edge || null
  })`));
  assert.equal(out.n, 1, 'una riga localizzata');
  assert.equal(out.edge.ifName, 'Gi0/5', 'edge agganciato per MAC (maiuscolo vs chiave minuscola)');
  assert.equal(out.edge.switchName, 'SW-CORE');
  assert.equal(out.other, null, 'le altre righe restano senza edge');
});

test('_discEdgeBadge: rende switch · porta; vuoto senza edge; loc-amb se ambiguo', () => {
  const withEdge = run(APP.ctx, `_discEdgeBadge({ edge:{ switchName:'SW-CORE', ifName:'Gi0/5', ambiguous:false } })`);
  assert.ok(/SW-CORE/.test(withEdge) && /Gi0\/5/.test(withEdge), 'mostra switch e porta');
  assert.ok(/disc-badge loc/.test(withEdge), 'classe badge location');
  assert.ok(!/loc-amb/.test(withEdge), 'non ambiguo → nessuna tinta d\'avviso');

  const none = run(APP.ctx, `_discEdgeBadge({})`);
  assert.equal(none, '', 'nessun edge → nessun badge');

  const amb = run(APP.ctx, `_discEdgeBadge({ edge:{ switchIp:'10.0.0.2', ifName:'Gi0/9', ambiguous:true } })`);
  assert.ok(/loc-amb/.test(amb), 'ambiguo → classe loc-amb');
  assert.ok(/10\.0\.0\.2/.test(amb), 'fallback allo switchIp quando manca il nome');
});
