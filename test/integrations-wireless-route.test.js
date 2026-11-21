'use strict';
// ============================================================
// La route DCIM legge anche i WIRELESS LINK (server/routes/integrations.js): fino alla 2.13.0 scaricava le WLAN e basta,
// quindi i ponti radio e le associazioni AP-stazione scritti in NetBox non arrivavano nemmeno al mapper. Qui un finto NetBox
// con un AP, una stazione e un link: il giro server → mapper si prova per davvero, e si prova anche che un NetBox SENZA il
// modulo wireless (404 sugli endpoint) non blocca l'import.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-dcimwifi-'));
process.env.INFRANET_DCIM_CONFIG_FILE = path.join(TMP, 'dcim-config.json');
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_DEVICE_TYPES = path.join(TMP, 'no-catalog.json');
delete process.env.INFRANET_DCIM_URL;
delete process.env.INFRANET_DCIM_TOKEN;

const express = require('express');

let withWireless = true;          // false = un NetBox senza il modulo wireless: gli endpoint rispondono 404
const asked = [];                 // i percorsi chiesti davvero
let nb, nbBase, server, base;

const R = (id, device, name, role, extra) => Object.assign({ id, device: { id: device }, name, type: { value: 'ieee802.11ax' },
  rf_role: { value: role }, rf_channel: { value: '5g-36-5180-20' }, wireless_lans: [] }, extra || {});
const NB = {
  '/api/dcim/sites/': [{ id: 40, name: 'HQ', device_count: 2 }],
  '/api/dcim/racks/': [{ id: 30, name: 'Rack A', u_height: 42, site: { name: 'HQ' }, device_count: 2 }],
  '/api/dcim/device-roles/': [{ id: 20, name: 'Access Point', slug: 'access-point', device_count: 2 }],
  '/api/dcim/devices/': [
    { id: 100, name: 'AP-1', site: { id: 40, name: 'HQ' }, device_type: { id: 10 }, role: { id: 20 }, rack: { id: 30 }, position: 40 },
    { id: 101, name: 'AP-2', site: { id: 40, name: 'HQ' }, device_type: { id: 10 }, role: { id: 20 }, rack: { id: 30 }, position: 38 },
  ],
  '/api/dcim/device-types/': [{ id: 10, manufacturer: { id: 1, name: 'Ubiquiti' }, model: 'U6-Pro', u_height: 1 }],
  '/api/dcim/interfaces/': [
    R(1000, 100, 'wlan0', 'ap', { wireless_lans: [{ id: 70 }] }),
    R(1100, 101, 'wlan0', 'station'),
  ],
  '/api/wireless/wireless-lans/': [{ id: 70, ssid: 'Corp', status: { value: 'active' }, auth_type: { value: 'wpa-personal' }, auth_cipher: { value: 'aes' }, vlan: { id: 5, vid: 20 } }],
  '/api/wireless/wireless-links/': [{ id: 7, interface_a: { id: 1100 }, interface_b: { id: 1000 }, ssid: 'Corp', status: { value: 'connected' } }],
};

before(async () => {
  nb = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    asked.push(p);
    if (p === '/api/status/') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ 'netbox-version': '4.1.3' })); }
    if (/^\/api\/wireless\//.test(p) && !withWireless) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"detail":"Not found."}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const rows = NB[p] || [];
    res.end(JSON.stringify({ count: rows.length, next: null, results: rows }));
  });
  await new Promise((r) => nb.listen(0, '127.0.0.1', r));
  nbBase = `http://127.0.0.1:${nb.address().port}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { role: 'admin' } }; next(); });
  app.use(require('../server/routes/integrations'));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const put = await fetch(`${base}/api/integrations/dcim/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${nbBase}/`, token: 'SEG-RE-TO', verifyTls: false }) });
  assert.equal(put.status, 200);
});

after(() => {
  if (server) server.close();
  if (nb) nb.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
});

const importa = async () => {
  asked.length = 0;
  // `refresh: true` = «rileggi da NetBox» (la lettura sta in una cache in memoria per dieci minuti): senza, la seconda
  // chiamata di un test userebbe i dati della prima.
  const r = await fetch(`${base}/api/integrations/dcim/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"refresh":true}' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  return j;
};

test('la route chiede anche i wireless link, e il link arriva fino al conteggio dell\'anteprima', async () => {
  withWireless = true;
  const j = await importa();
  assert.ok(asked.includes('/api/wireless/wireless-links/'), 'chiesti: ' + [...new Set(asked)].join(', '));
  assert.ok(asked.includes('/api/wireless/wireless-lans/'), 'e le WLAN, come prima');
  assert.equal(j.counts.radios, 2);
  assert.equal(j.counts.ssids, 1);
  assert.equal(j.counts.wirelessLinks, 1, 'un collegamento radio fra le due radio');
});

test('un NetBox senza il modulo wireless (404): nessun link, nessuna WLAN, e le radio entrano lo stesso', async () => {
  withWireless = false;
  const j = await importa();
  assert.equal(j.counts.radios, 2, 'le radio entrano con banda e canale');
  assert.equal(j.counts.ssids, 0);
  assert.equal(j.counts.wirelessLinks, 0);
});
