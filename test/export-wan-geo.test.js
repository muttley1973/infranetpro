'use strict';
// ============================================================
// LA CARTA GEOGRAFICA NEL DOSSIER (`POST /api/export-pdf`, capitolo WAN).
//
// Il disegno ha le sue prove (`inter-site-geo-layout`, `inter-site-geo-svg`).
// Qui si prova l'unica cosa che non vedono: che la pagina arrivi in fondo al tubo
// — e soprattutto che NON arrivi quando non c'è niente da mostrare.
//   ① con almeno una sede con un punto, il capitolo ha la sua pagina di carta;
//   ② senza nessun punto la pagina NON c'è: una carta vuota si legge come un
//      guasto dell'export, e il dossier di chi non ha mai scritto una coordinata
//      resta com'era;
//   ③ ciò che la carta non mostra (una sede senza posizione) è SCRITTO sotto;
//   ④ le parole sono quelle della lingua del dossier.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-wangeo-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_ORG_FILE = path.join(TMP, 'organization.json');
fs.writeFileSync(path.join(PROJECTS, '1.json'), JSON.stringify({
  id: 1, name: 'Milano', created_at: '2026-08-28 09:00:00', updated_at: '2026-08-28 09:00:00',
  state: { nodes: [], racks: [], links: [] },
}), 'utf8');

const express = require('express');
let server, base, deps;
try { deps = require('../server/pdf-report.js')._loadPdfDeps(); }
catch { /* pdfkit non installato: si salta sotto */ }

before(async () => {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.session = { user: { id: 1, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/export'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); } catch (_) { /* già chiuso */ } });

/** Il testo finito DAVVERO sulle pagine (stessa lettura di export-wan-route.test.js). */
function pdfText(buf) {
  let raw = '', i = 0;
  for (;;) {
    const s = buf.indexOf('stream', i);
    if (s < 0) break;
    let p = s + 6;
    if (buf[p] === 13) p++;
    if (buf[p] === 10) p++;
    const e = buf.indexOf('endstream', p);
    if (e < 0) break;
    try { raw += zlib.inflateSync(buf.slice(p, e)).toString('latin1'); } catch (_) { /* non compresso */ }
    i = e + 9;
  }
  let out = '';
  for (const m of raw.matchAll(/(?:\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F]+>)\s*Tj)/g)) {
    for (const h of String(m[1] || m[2]).matchAll(/<([0-9a-fA-F]+)>/g)) {
      for (let k = 0; k + 1 < h[1].length; k += 2) out += String.fromCharCode(parseInt(h[1].substr(k, 2), 16));
    }
  }
  return out;
}

const SOLO_WAN = {
  includeWan: true,
  includePlanimetria: false, includeBackground: false, includeInventory: false,
  includeAsBuilt: false, includeRacks: false, includePorts: false, includeVlans: false,
  includeTopology: false, includeVms: false, includePdu: false, includeSpare: false,
  includeAssets: false, includeRecovery: false, includeOverview: false, includeCover: false,
  includeChangelog: false,
};
const org = (sites) => fs.writeFileSync(process.env.INFRANET_ORG_FILE, JSON.stringify({
  id: 'acme', name: 'Acme', sites, uplinks: [],
  links: [{ id: 'mi-rm', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec' }],
}), 'utf8');
const MI = { id: 'mi', name: 'Milano DC', role: 'hub', projectRef: '1', subnets: [], geo: { lat: 45.4642, lng: 9.19, source: 'manual' } };
const RM = { id: 'rm', name: 'Roma Sede', role: 'spoke', projectRef: null, subnets: [], geo: { lat: 41.9028, lng: 12.4964, source: 'geocoded' } };
const esporta = async (lang) => {
  const r = await fetch(`${base}/api/export-pdf`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName: 'Milano', projectId: 1, lang: lang || 'it', reportOptions: SOLO_WAN }),
  });
  assert.equal(r.status, 200);
  return pdfText(Buffer.from(await r.arrayBuffer()));
};

test('① con le sedi sulla carta, il capitolo ha la sua pagina: titolo, nomi, scala', { skip: !deps }, async () => {
  org([MI, RM]);
  const txt = await esporta('it');
  assert.ok(txt.includes('carta geografica'), 'il titolo della pagina');
  assert.ok(txt.includes('Milano DC') && txt.includes('Roma Sede'), 'le sedi');
  assert.match(txt, /\d+ km/, 'la barra della scala dice i chilometri');
  assert.ok(/\d+\xb0[NE]/.test(txt), 'e il reticolo dice i gradi');
});

test('② senza nessun punto la pagina NON c\'è: il dossier resta com\'era', { skip: !deps }, async () => {
  org([Object.assign({}, MI, { geo: null }), Object.assign({}, RM, { geo: null })]);
  const txt = await esporta('it');
  assert.ok(!txt.includes('carta geografica'));
  assert.ok(txt.includes('Milano DC'), 'il resto del capitolo c\'è');
});

test('③ una sede senza posizione non è sulla carta, ed è scritto QUALE', { skip: !deps }, async () => {
  org([MI, Object.assign({}, RM, { geo: null })]);
  const txt = await esporta('it');
  assert.ok(txt.includes('carta geografica'));
  assert.ok(txt.includes('Senza posizione, non disegnate: Roma Sede'));
  assert.ok(txt.includes('1 collegamenti non disegnati'), 'e il collegamento che ne dipende');
});

test('④ in inglese le parole sono inglesi', { skip: !deps }, async () => {
  org([MI, RM]);
  const txt = await esporta('en');
  assert.ok(txt.includes('geographic map'));
  assert.ok(!txt.includes('carta geografica'));
});
