'use strict';
// macsuck lato client: l'evento SSE 'located' porta { [macLowercase]: edge }.
// _discApplyEdges aggancia l'edge alle righe scoperte (match per MAC normalizzato
// lowercase; le righe hanno il MAC MAIUSCOLO). Inoltre una riga da lease DHCP
// prende _via:'dhcp'. DOM-stub.
// ⚠️ Il badge che RENDEVA quell'edge (📍 «switch · porta») è stato tolto il 04/09
// su richiesta: la riga di Scoperta era affollata. Quindi oggi `d.edge` si calcola
// e non lo legge nessuno — il dato c'è, a mancare è chi lo mostra.
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

// ⚠️ QUI STAVA il test di `_discEdgeBadge` (il badge 📍 «switch · porta»), tolto il
// 04/09 insieme al badge stesso su richiesta: la riga di Scoperta era affollata.
// Il test sopra RESTA ed è quello che conta ancora — `_discApplyEdges` continua ad
// agganciare l'edge alla riga per MAC. Il dato c'è; a non mostrarlo più è la UI.
// Il test sopra prova già che il DATO si aggancia. Qui resta solo la cosa che
// quel test non può dire: il badge non c'è più, e se torna deve tornare con una
// decisione — non perché qualcuno ha ripristinato una riga senza accorgersene.
test('il badge 📍 «switch · porta» è stato tolto, e non rientra per distrazione', () => {
  assert.equal(run(APP.ctx, `typeof _discEdgeBadge`), 'undefined',
    '_discEdgeBadge è tornato: se è voluto, togli questa guardia dicendo perché');
});
