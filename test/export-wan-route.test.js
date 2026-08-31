'use strict';
// ============================================================
// IL CAPITOLO WAN ATTRAVERSO LA ROTTA (`POST /api/export-pdf`).
//
// Le due metà del capitolo hanno già le loro prove: i dati in
// `inter-site-report.test.js`, il disegno in `inter-site-svg.test.js`, la
// stampa in `pdf-wan.test.js`. Qui si prova l'unica cosa che nessuna delle tre
// può vedere — che il capitolo arrivi davvero in fondo al tubo:
//   ① una casella spuntata basta, e NON serve `reportData`: l'organizzazione
//      vive nel server (una per installazione), non dentro il progetto;
//   ② il nome dell'apparato a un capo si risolve leggendo il progetto-sede, che
//      è il pezzo che sta fra due file diversi e che nessun test puro tocca;
//   ③ senza la casella il capitolo non esce (o non sarebbe un'opzione).
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-wan-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_ORG_FILE = path.join(TMP, 'organization.json');

// Il progetto-sede di Milano ha l'apparato a cui il collegamento punta: è quello
// che la scheda deve saper NOMINARE invece di stampare un id.
fs.writeFileSync(path.join(PROJECTS, '1.json'), JSON.stringify({
  id: 1, name: 'Milano', created_at: '2026-08-28 09:00:00', updated_at: '2026-08-28 09:00:00',
  state: { nodes: [{ id: 'n-fw', name: 'MI-FW-01', type: 'firewall' }], racks: [], links: [] },
}), 'utf8');
fs.writeFileSync(path.join(PROJECTS, '2.json'), JSON.stringify({
  id: 2, name: 'Roma', created_at: '2026-08-28 09:00:00', updated_at: '2026-08-28 09:00:00',
  state: { nodes: [], racks: [], links: [] },
}), 'utf8');

fs.writeFileSync(process.env.INFRANET_ORG_FILE, JSON.stringify({
  id: 'acme', name: 'Acme',
  sites: [
    { id: 'mi', name: 'Milano DC', role: 'hub', projectRef: '1', subnets: ['10.1.0.0/24'] },
    { id: 'rm', name: 'Roma Sede', role: 'spoke', projectRef: '2', subnets: ['10.2.0.0/24'] },
  ],
  uplinks: [{ id: 'u-mi', siteId: 'mi', provider: 'Acme Fiber', serviceType: 'Fibra', circuitId: 'ACME-77120', cirMbps: 200 }],
  links: [{
    id: 'mi-rm', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec', topology: 'hub-and-spoke',
    reach: { origin: 'declared', value: { a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] } },
    endpointA: { deviceRef: 'n-fw', peerIp: '198.51.100.2' },
    endpointB: { deviceName: 'RM-FW-01', peerIp: '198.51.100.1' },
  }],
}), 'utf8');

const express = require('express');
let server, base, deps;
try { deps = require('../server/pdf-report.js')._loadPdfDeps(); }
catch { /* pdfkit non installato: si salta sotto */ }

before(async () => {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  // La rotta sta dietro `auth.requireAdmin`, che guarda `req.session.user.role`:
  // la sessione la iniettiamo noi, così la prova resta sulla rotta.
  app.use((req, _res, next) => { req.session = { user: { id: 1, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/export'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); } catch (_) { /* già chiuso */ } });

/** Il testo che è finito DAVVERO sulle pagine.
 *  pdfkit scrive ogni riga come un array di stringhe esadecimali con le crenature
 *  in mezzo (`[<48656c6c6f> -20 <21>] TJ`): si sgonfiano i flussi e si rimettono
 *  insieme i pezzi. È l'unico modo di leggere un PDF senza `pdftotext`, che in CI
 *  non c'è. */
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
    try { raw += zlib.inflateSync(buf.slice(p, e)).toString('latin1'); } catch (_) { /* non compresso: si salta */ }
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

const esporta = (reportOptions, extra) => fetch(`${base}/api/export-pdf`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(Object.assign({ projectName: 'Milano', projectId: 1, lang: 'it', reportOptions }, extra || {})),
});

/** Solo il capitolo WAN: tutto il resto spento a mano, perché i default della
 *  rotta sono accesi (retrocompatibilità coi client vecchi). */
const SOLO_WAN = {
  includeWan: true,
  includePlanimetria: false, includeBackground: false, includeInventory: false,
  includeAsBuilt: false, includeRacks: false, includePorts: false, includeVlans: false,
  includeTopology: false, includeVms: false, includePdu: false, includeSpare: false,
  includeAssets: false, includeRecovery: false, includeOverview: false, includeCover: false,
  includeChangelog: false,
};

test('⭐ una casella spuntata basta: il capitolo WAN non chiede `reportData`', { skip: !deps }, async () => {
  const r = await esporta(SOLO_WAN);
  assert.equal(r.status, 200, 'l\'organizzazione vive nel server, non nel payload del client');
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(buf.length > 2000, 'un PDF vero, non una pagina vuota');
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
});

test('⭐ il nome dell\'apparato si risolve leggendo il progetto-sede', { skip: !deps }, async () => {
  const txt = pdfText(Buffer.from(await (await esporta(SOLO_WAN)).arrayBuffer()));
  // È il pezzo che sta FRA due file: l'organizzazione dice `deviceRef`, il nome
  // sta nel progetto della sede. Se il ponte si rompe, sulla carta finisce un id
  // — o niente — e chi ripristina non sa su quale scatola mettere le mani.
  assert.ok(txt.includes('MI-FW-01'), 'il riferimento è diventato un nome');
  assert.ok(txt.includes('RM-FW-01'), 'e il nome scritto a mano resta com\'è');
  // E il resto di ciò che serve per rifare la linea.
  assert.ok(txt.includes('ACME-77120'), 'il codice del circuito');
  assert.ok(txt.includes('200 Mbps'), 'la banda della linea');
  assert.ok(txt.includes('198.51.100.2'), 'l\'indirizzo dell\'altro capo');
  assert.ok(txt.includes('10.1.0.0/24') && txt.includes('10.2.0.0/24'), 'le reti raggiungibili');
  assert.ok(txt.includes('Milano DC') && txt.includes('Roma Sede'), 'e i nomi delle sedi, sulla mappa e in tabella');
});

test('③ senza la casella il capitolo non esce, e la richiesta non passa per altro', { skip: !deps }, async () => {
  const spento = Object.assign({}, SOLO_WAN, { includeWan: false });
  const r = await esporta(spento);
  assert.equal(r.status, 400, 'nessuna sezione selezionata: non si stampa un PDF vuoto');
});

test('un\'installazione senza organizzazione: il capitolo esce lo stesso, e lo dice', { skip: !deps }, async () => {
  const salva = fs.readFileSync(process.env.INFRANET_ORG_FILE, 'utf8');
  fs.unlinkSync(process.env.INFRANET_ORG_FILE);
  try {
    const r = await esporta(SOLO_WAN);
    assert.equal(r.status, 200);
    const txt = pdfText(Buffer.from(await r.arrayBuffer()));
    // Sparire si legge come un errore dell'export: chi ha spuntato la casella
    // merita una risposta esplicita.
    assert.ok(/Nessuna sede dichiarata/.test(txt));
  } finally {
    fs.writeFileSync(process.env.INFRANET_ORG_FILE, salva, 'utf8');
  }
});
