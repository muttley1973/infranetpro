// Test d'integrazione HTTP della route DCIM/IPAM (server/routes/integrations.js).
// App Express usa-e-getta con config file ISOLATO (env prima dei require) e una
// sessione iniettata per pilotare il gate admin. La prova connessione batte un
// mock NetBox di loopback. Verifica: gate admin (403), maschera del token,
// capabilities, prova connessione.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-dcimroute-'));
process.env.INFRANET_DCIM_CONFIG_FILE = path.join(TMP, 'dcim-config.json');
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;                       // import-commit ISOLATO (mai i progetti veri)
process.env.INFRANET_DEVICE_TYPES = path.join(TMP, 'no-catalog.json'); // assente → nessuna riconciliazione catalogo
delete process.env.INFRANET_DCIM_URL;
delete process.env.INFRANET_DCIM_TOKEN;

const express = require('express');

let role = 'admin';
let rejectSiteIpamFilters = false;
let app, server, base;
let nb, nbBase;

// Dati del mock NetBox (il handler ignora i filtri di query e restituisce l'intero
// set per endpoint: la mappatura/dedup lato route/lib fanno il resto).
const NB = {
  '/api/dcim/sites/': [{ id: 40, name: 'HQ', device_count: 2 }],
  '/api/dcim/racks/': [{ id: 30, name: 'Rack A', u_height: 42, site: { name: 'HQ' }, device_count: 2 }],
  '/api/dcim/device-roles/': [{ id: 20, name: 'Access Switch', slug: 'access-switch', device_count: 2 }],
  '/api/extras/tags/': [{ id: 1, name: 'prod', slug: 'prod', tagged_items: 5 }],
  '/api/dcim/devices/': [
    { id: 100, name: 'SW-CORE-01', site: { id: 40, name: 'HQ' }, device_type: { id: 10 }, role: { id: 20 }, rack: { id: 30 }, position: 40, serial: 'ABC123', primary_ip4: { address: '10.0.0.2/24' } },
    { id: 101, name: 'SW-ACC-03', site: { id: 40, name: 'HQ' }, device_type: { id: 11 }, role: { id: 20 }, rack: { id: 30 }, position: 38, primary_ip4: { address: '10.0.0.3/24' } },
  ],
  '/api/dcim/device-types/': [
    { id: 10, manufacturer: { id: 1, name: 'Cisco' }, model: 'C9200-24T', u_height: 1 },
    { id: 11, manufacturer: { id: 2, name: 'Aruba' }, model: '6300M', u_height: 1 },
  ],
  '/api/dcim/interfaces/': [
    { id: 1000, device: { id: 100 }, name: 'Gi1/0/1', mode: { value: 'access' }, untagged_vlan: { vid: 10 } },
    { id: 1001, device: { id: 100 }, name: 'Gi1/0/2' },
    { id: 1100, device: { id: 101 }, name: 'Gi1/0/1' },
  ],
  '/api/dcim/cables/': [
    { id: 500, a_terminations: [{ object_type: 'dcim.interface', object_id: 1001 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 1100 }], type: { value: 'cat6' }, length: 3, length_unit: { value: 'm' } },
  ],
  '/api/ipam/vlans/': [{ id: 60, vid: 10, name: 'Mgmt' }],
  '/api/ipam/prefixes/': [{ id: 70, prefix: '10.0.0.0/24', vlan: { vid: 10 } }],
  '/api/ipam/ip-addresses/': [{ id: 80, address: '10.0.0.2/24', assigned_object: { id: 1000, device: { id: 100 } } }],
};

before(async () => {
  nb = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (rejectSiteIpamFilters && /^\/api\/ipam\/(vlans|prefixes)\/$/.test(p) && url.searchParams.has('site_id')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: 'Invalid filter: site_id' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (p === '/api/status/') return res.end(JSON.stringify({ 'netbox-version': '4.1.3' }));
    if (NB[p]) return res.end(JSON.stringify({ count: NB[p].length, next: null, results: NB[p] }));
    res.end(JSON.stringify({ count: 0, next: null, results: [] }));
  });
  await new Promise(r => nb.listen(0, '127.0.0.1', r));
  nbBase = `http://127.0.0.1:${nb.address().port}`;

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { role } }; next(); });
  app.use(require('../server/routes/integrations'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  if (nb) nb.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
});

const P = '/api/integrations/dcim';

test('GET /config → mascherato, niente token', async () => {
  const r = await fetch(`${base}${P}/config`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.tokenSet, false);
  assert.equal(j.adapter, 'netbox');
  assert.equal('token' in j, false);
});

test('PUT /config come non-admin → 403', async () => {
  role = 'viewer';
  const r = await fetch(`${base}${P}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://x.local', token: 'nope' }),
  });
  assert.equal(r.status, 403);
  role = 'admin';
});

test('PUT /config come admin salva; GET non espone il token', async () => {
  const put = await fetch(`${base}${P}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${nbBase}/`, token: 'SEG-RE-TO', verifyTls: false }),
  });
  assert.equal(put.status, 200);
  const body = await put.text();
  assert.ok(!/SEG-RE-TO/.test(body), 'il token non deve tornare al client');
  const r = await fetch(`${base}${P}/config`);
  const j = await r.json();
  assert.equal(j.tokenSet, true);
  assert.equal(j.verifyTls, false);
});

test('GET /capabilities → import true, export false (build free)', async () => {
  const r = await fetch(`${base}${P}/capabilities`);
  const j = await r.json();
  assert.equal(j.import, true);
  assert.equal(j.export, false);
});

test('GET /catalog → stato del catalogo locale senza segreti', async () => {
  const r = await fetch(`${base}${P}/catalog`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(typeof j.available, 'boolean');
  assert.equal('token' in j, false);
});

test('GET /catalog/diff → differenze locali senza segreti', async () => {
  const r = await fetch(`${base}${P}/catalog/diff`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(j.diff === null || typeof j.diff === 'object');
  assert.ok(!/token|password|secret/i.test(JSON.stringify(j)));
});

test('POST /catalog/check e /catalog/update → solo admin', async () => {
  role = 'viewer';
  const check = await fetch(`${base}${P}/catalog/check`, { method: 'POST' });
  const update = await fetch(`${base}${P}/catalog/update`, { method: 'POST' });
  assert.equal(check.status, 403);
  assert.equal(update.status, 403);
  role = 'admin';
});

test('POST /test → prova connessione riuscita (versione dal mock)', async () => {
  const r = await fetch(`${base}${P}/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: nbBase, token: 't' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.version, '4.1.3');
});

test('POST /test come non-admin → 403', async () => {
  role = 'viewer';
  const r = await fetch(`${base}${P}/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 403);
  role = 'admin';
});

// I test sotto usano la config salvata dal test «PUT /config come admin» (url=mock).
test('GET /import/scopes → siti/rack/ruoli con conteggi', async () => {
  const r = await fetch(`${base}${P}/import/scopes`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.sites[0].name, 'HQ');
  assert.equal(j.sites[0].deviceCount, 2);
  assert.equal(j.racks[0].name, 'Rack A');
  assert.equal(j.roles[0].slug, 'access-switch');
  assert.equal(j.tags[0].slug, 'prod');
});

test('POST /import dry-run → conteggi + nome proposto + campioni', async () => {
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.counts.devices, 2);
  assert.equal(j.counts.cables, 1);
  assert.equal(j.counts.vlans, 1);
  assert.equal(j.counts.prefixes, 1);
  assert.equal(j.counts.ips, 1);
  assert.equal(j.counts.directLinks, 1);
  assert.equal(j.counts.passThroughLinks, 0);
  assert.equal(j.counts.devicesRack, 2);
  assert.equal(j.proposedProjectName, 'HQ');
  assert.equal(j.samples.devices.length, 2);
  assert.equal(j.reconciliation.required, 2);
});

test('POST /import dry-run con selezione: exclude device → conteggio ridotto', async () => {
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection: { exclude: ['device:101'] } }),
  });
  const j = await r.json();
  assert.equal(j.counts.devices, 1);
  assert.equal(j.counts.cables, 0);   // il cavo puntava al device escluso
  assert.deepEqual(j.samples.excluded.devices, [101]);
});

test('POST /import dry-run con mapping manuale → riconciliazione risolta', async () => {
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection: { mapping: {
      '100': { type: 'switch', placement: 'rack' },
      '101': { type: 'switch', placement: 'rack' },
    } } }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.reconciliation.required, 0);
  assert.equal(j.reconciliation.resolved, 4);
});

test('POST /import IPAM con filtro site_id non supportato → fallback senza bloccare', async () => {
  rejectSiteIpamFilters = true;
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection: { scope: { siteIds: [40], roleSlugs: [], tags: [] }, allowUnresolved: true } }),
  });
  rejectSiteIpamFilters = false;
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.warnings.some(w => /site_id/.test(w)));
});

test('POST /import commit senza riconciliazione → 409 e nessun progetto', async () => {
  const count0 = fs.readdirSync(PROJECTS).filter(f => /^\d+\.json$/.test(f)).length;
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit: true, projectName: 'Import bloccato' }),
  });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.equal(j.reconciliation.required, 2);
  assert.equal(j.reconciliationRequired.length, 2);
  const count1 = fs.readdirSync(PROJECTS).filter(f => /^\d+\.json$/.test(f)).length;
  assert.equal(count1, count0);
});

test('POST /import commit → crea un NUOVO progetto isolato', async () => {
  const count0 = fs.readdirSync(PROJECTS).filter(f => /^\d+\.json$/.test(f)).length;
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit: true, projectName: 'Import test', selection: { allowUnresolved: true } }),
  });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(j.projectId);
  const count1 = fs.readdirSync(PROJECTS).filter(f => /^\d+\.json$/.test(f)).length;
  assert.equal(count1, count0 + 1);
  const saved = JSON.parse(fs.readFileSync(path.join(PROJECTS, j.projectId + '.json'), 'utf8'));
  assert.equal(saved.name, 'Import test');
  assert.equal(saved.state.nodes.length, 2);
  assert.ok(!/community/i.test(JSON.stringify(saved)));
});

test('POST /import come non-admin → 403', async () => {
  role = 'viewer';
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 403);
  role = 'admin';
});
