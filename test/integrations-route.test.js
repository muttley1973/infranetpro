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
let unassignedIps = 0;          // indirizzi dichiarati in NetBox e agganciati a niente
let ignoreAssignedFilter = false;   // simula la versione che non conosce il filtro
const deviceQueries = [];           // i `site_id` chiesti a ogni fetch di apparati
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
  // I CIRCUITI: la linea WAN del sito 40, più una che è di un altro sito. Il
  // mock ignora i filtri come fa NetBox con un parametro che non conosce, quindi
  // la seconda è anche la prova che la cintura d'ambito morde davvero.
  '/api/circuits/circuits/': [
    {
      id: 900, cid: 'FTTH-1', provider: { id: 1, name: 'Fastweb' }, type: { id: 1, name: 'FTTH', slug: 'ftth' },
      status: { value: 'active', label: 'Active' }, commit_rate: 30000,
      termination_a: null,
      termination_z: { termination_type: 'dcim.site', termination_id: 40, termination: { id: 40, name: 'HQ' } },
    },
    {
      id: 901, cid: 'DI-UN-ALTRO', provider: { id: 2, name: 'TIM' }, type: { id: 2, name: 'MPLS', slug: 'mpls' },
      status: { value: 'active', label: 'Active' }, commit_rate: null,
      termination_a: null,
      termination_z: { termination_type: 'dcim.site', termination_id: 41, termination: { id: 41, name: 'Filiale' } },
    },
  ],
  '/api/circuits/circuit-terminations/': [
    {
      id: 950, circuit: { id: 900 }, term_side: 'Z',
      termination_type: 'dcim.site', termination_id: 40, termination: { id: 40, name: 'HQ' },
      // ⚠️ La banda che la rotta deve consegnare è quella della PORTA, e sta QUI
      // sulla terminazione — non il `commit_rate` del circuito, che sopra dice
      // 30000 apposta: i due numeri sono diversi, e si vede quale dei due passa.
      port_speed: 100000,
      cable: { id: 1 }, cable_end: 'A', link_peers_type: 'dcim.interface',
      link_peers: [{ id: 1000, name: 'Gi1/0/1', device: { id: 100, name: 'SW-CORE-01' } }],
    },
  ],
  // I SERVIZI L2 e i TUNNEL: quello che LEGA due sedi, e che nei `circuits` non
  // c'è. Un VPLS (natura vera, il vocabolario di NetBox è chiuso) e un IPsec con
  // i ruoli hub/spoke e gli indirizzi esterni ai due capi.
  '/api/vpn/l2vpns/': [
    { id: 800, name: 'VPLS-HQ-BR', slug: 'vpls-hq-br', type: { value: 'vpls', label: 'VPLS' },
      status: { value: 'active', label: 'Active' }, identifier: 1001 },
  ],
  '/api/vpn/l2vpn-terminations/': [
    { id: 810, l2vpn: { id: 800 }, assigned_object_type: 'dcim.interface',
      assigned_object: { id: 1001, name: 'Gi1/0/2', device: { id: 100, name: 'SW-CORE-01' } } },
    { id: 811, l2vpn: { id: 800 }, assigned_object_type: 'dcim.interface',
      assigned_object: { id: 1200, name: 'Gi0/1', device: { id: 102, name: 'BR-RTR-01' } } },
  ],
  '/api/vpn/tunnels/': [
    { id: 820, name: 'IPSEC-HQ-BR', status: { value: 'active', label: 'Active' },
      encapsulation: { value: 'ipsec-tunnel', label: 'IPsec - Tunnel' }, tunnel_id: 7 },
  ],
  '/api/vpn/tunnel-terminations/': [
    { id: 830, tunnel: { id: 820 }, role: { value: 'hub', label: 'Hub' }, termination_type: 'dcim.interface',
      termination: { id: 1000, name: 'Gi1/0/1', device: { id: 100, name: 'SW-CORE-01' } },
      outside_ip: { address: '203.0.113.1/32' } },
    { id: 831, tunnel: { id: 820 }, role: { value: 'spoke', label: 'Spoke' }, termination_type: 'dcim.interface',
      termination: { id: 1200, name: 'Gi0/1', device: { id: 102, name: 'BR-RTR-01' } },
      outside_ip: { address: '198.51.100.9/32' } },
  ],
};

// ⚠️ Un apparato che sta in un ALTRO sito. Esiste SOLO per la risoluzione «capo
// del tunnel → sede», che NetBox serve chiedendo gli apparati per id: se entrasse
// nella lista generale, l'import di HQ se lo porterebbe dentro e i conteggi delle
// prove qui sopra cambierebbero — un dato di prova non deve spostarne un altro.
const DEVICE_ALTRO_SITO = {
  id: 102, name: 'BR-RTR-01', site: { id: 41, name: 'Branch' },
  device_type: { id: 10 }, role: { id: 20 },
};

before(async () => {
  nb = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    // Che cosa e' stato CHIESTO davvero: serve a provare che il confronto si
    // restringe da solo alla fetta da cui nasce il progetto, invece di rileggere
    // tutto NetBox. Il mock ignora i filtri, quindi l'unico modo di verificarlo
    // e' guardare la query.
    if (p === '/api/dcim/devices/') deviceQueries.push(url.searchParams.getAll('site_id').join(','));
    if (rejectSiteIpamFilters && /^\/api\/ipam\/(vlans|prefixes)\/$/.test(p) && url.searchParams.has('site_id')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: 'Invalid filter: site_id' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (p === '/api/status/') return res.end(JSON.stringify({ 'netbox-version': '4.1.3' }));
    // Indirizzi NON agganciati a un apparato: in NetBox sono la norma e non
    // tornano dalla fetch per `device_id`. Il censimento li conta con una
    // seconda chiamata filtrata, e qui il finto NetBox la onora — cosi` il giro
    // server→mapper si prova per davvero, non solo la funzione pura.
    if (p === '/api/ipam/ip-addresses/') {
      if (!ignoreAssignedFilter && url.searchParams.get('assigned_to_interface') === 'false') {
        // Qualche riga vera: il censimento le usa come ESEMPI nella decisione.
        const rows = unassignedIps ? [{ id: 900, address: '10.9.9.7/24' }, { id: 901, address: '172.16.2.1/24' }] : [];
        return res.end(JSON.stringify({ count: unassignedIps, next: null, results: rows }));
      }
      const rows = NB[p];
      return res.end(JSON.stringify({ count: rows.length + unassignedIps, next: null, results: rows }));
    }
    // Gli apparati chiesti PER ID: è così che si risolve la sede di un capo di
    // tunnel, e solo lì compare quello dell'altro sito (vedi DEVICE_ALTRO_SITO).
    if (p === '/api/dcim/devices/' && url.searchParams.has('id')) {
      const rows = [...NB[p], DEVICE_ALTRO_SITO];
      return res.end(JSON.stringify({ count: rows.length, next: null, results: rows }));
    }
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

// Su un NetBox vero: 180 indirizzi dichiarati, 180 senza apparato, 0 importati.
// Il conteggio era esatto, il silenzio no — «Indirizzi IP 0» accanto a
// «Prefissi 90» si legge come un guasto invece che come un confine del modello.
test('POST /import dry-run → gli IP senza apparato sono DETTI, non taciuti', async () => {
  unassignedIps = 180;
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: true }),   // il bundle e` in cache dai test prima: qui serve rileggerlo
  });
  unassignedIps = 0;
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.counts.ips, 1, 'entra solo quello agganciato a un\'interfaccia');
  const iss = j.issues.find(i => i.code === 'ip.unassigned');
  assert.ok(iss, 'e gli altri 180 hanno una riga che li dichiara');
  assert.equal(iss.n, 180);
  assert.equal(iss.imported, 1);
  // Gli esempi arrivano dal server fino alla riga: un numero da solo non si giudica.
  assert.deepEqual(iss.sample, ['10.9.9.7/24', '172.16.2.1/24']);
});

// La guardia, dal vivo: alcune versioni di NetBox IGNORANO un filtro che non
// conoscono e rispondono col totale. Qui il finto NetBox fa proprio questo.
test('POST /import dry-run → un conteggio impossibile non si stampa', async () => {
  ignoreAssignedFilter = true;    // il filtro cade nel vuoto: risponde col totale
  unassignedIps = 180;
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: true }),
  });
  ignoreAssignedFilter = false;
  unassignedIps = 0;
  const j = await r.json();
  assert.equal(j.issues.some(i => i.code === 'ip.unassigned'), false,
    '181 non agganciati con 1 agganciato e` una contraddizione: meglio tacere');
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

// ── Ri-lettura: l'ambito lo detta il PROGETTO ───────────────────────────────
// Un progetto nato da un sito, confrontato con TUTTO NetBox, produce centinaia di
// «novita'» vere e inutili — misurato su un NetBox reale: 181. Dalla 2.9.2 il
// documento registra da dove viene e il confronto rilegge esattamente quella
// fetta: la prova e' nella QUERY, non nel risultato.
test('POST /compare: l\'ambito viene dal progetto, non dal mago', async () => {
  const saved = { id: 900, name: 'Sede HQ', state: {
    nodes: [{ id: 'nb-dev-100', name: 'SW-CORE-01', type: 'switch', source: { deviceId: 100 } }],
    racks: [], ipam: { prefixes: [] }, vlanNames: {},
    source: { dcim: { system: 'netbox', sites: [{ id: '40', name: 'HQ' }] } },
  } };
  fs.writeFileSync(path.join(PROJECTS, '900.json'), JSON.stringify(saved));
  deviceQueries.length = 0;
  const r = await fetch(`${base}${P}/compare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Il mago dice «tutto»: il progetto lo smentisce, ed e' il progetto ad avere ragione.
    body: JSON.stringify({ projectId: 900, refresh: true, selection: { scope: { siteIds: [], roleSlugs: [], tags: [] } } }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.scope.fromProject, true);
  assert.deepEqual(j.scope.sites, [{ id: '40', name: 'HQ' }]);
  assert.ok(deviceQueries.some(q => q === '40'), 'la lettura di NetBox e\' stata ristretta al sito del progetto');
});

// ⚠️ Un progetto importato PRIMA della 2.9.2 non registra l'origine: si ricade
// sull'ambito scelto a mano e lo si DICE, invece di far finta di saperlo.
test('POST /compare: progetto senza origine → si ricade sul mago, e si dichiara', async () => {
  const old = { id: 901, name: 'Vecchio', state: { nodes: [], racks: [], ipam: { prefixes: [] }, vlanNames: {} } };
  fs.writeFileSync(path.join(PROJECTS, '901.json'), JSON.stringify(old));
  const r = await fetch(`${base}${P}/compare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 901, refresh: true, selection: {} }),
  });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.scope.fromProject, false);
  assert.deepEqual(j.scope.sites, []);
});

test('POST /compare: il confronto NON tocca il progetto su disco', async () => {
  const before = fs.readFileSync(path.join(PROJECTS, '900.json'), 'utf8');
  await fetch(`${base}${P}/compare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 900, selection: {} }),
  });
  assert.equal(fs.readFileSync(path.join(PROJECTS, '900.json'), 'utf8'), before);
});

test('POST /compare: progetto inesistente → 404, e senza progetto → 400', async () => {
  const a = await fetch(`${base}${P}/compare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 99999, selection: {} }),
  });
  assert.equal(a.status, 404);
  const b = await fetch(`${base}${P}/compare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(b.status, 400);
});

test('POST /compare come non-admin → 403', async () => {
  role = 'viewer';
  const r = await fetch(`${base}${P}/compare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 403);
  role = 'admin';
});

// Il commit scrive l'origine nel documento: e' il pezzo che rende esatto tutto
// il resto, e senza questo test resterebbe una promessa del mapper.
test('POST /import: il progetto creato registra il sito da cui nasce', async () => {
  const r = await fetch(`${base}${P}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit: true, projectName: 'Origine', selection: { allowUnresolved: true } }),
  });
  const j = await r.json();
  const saved = JSON.parse(fs.readFileSync(path.join(PROJECTS, j.projectId + '.json'), 'utf8'));
  assert.deepEqual(saved.state.source.dcim.sites, [{ id: '40', name: 'HQ' }]);
  assert.equal(saved.state.source.dcim.system, 'netbox');
});

// ── Le linee WAN: i circuiti del sito ───────────────────────────────────────

test('POST /wan → gli uplink del sito, e SOLO quelli', async () => {
  const r = await fetch(`${base}${P}/wan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteIds: [40] }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.uplinks.length, 1, 'il circuito di un altro sito non entra');
  const u = j.uplinks[0];
  assert.equal(u.circuitId, 'FTTH-1');
  assert.equal(u.provider, 'Fastweb');
  assert.equal(u.serviceType, 'FTTH');
  assert.equal(u.cirMbps, 100, 'i 100000 kbps della PORTA sono 100 Mbps — non i 30 del contratto');
  assert.deepEqual(u.wanPort, { deviceName: 'SW-CORE-01', ifaceName: 'Gi1/0/1' });
  // Il mock ignora i filtri, esattamente come NetBox davanti a un parametro che
  // non conosce: la cintura ha dovuto togliere una riga, e lo dice.
  assert.ok(j.notes.some(n => n.code === 'wan.outOfScope' && n.n === 1));
  assert.ok(!/token|SEG-RE-TO/i.test(JSON.stringify(j)), 'nessun segreto nella risposta');
});

test('POST /wan → anche i SERVIZI L2 e i TUNNEL, che nei circuiti non ci sono', async () => {
  const r = await fetch(`${base}${P}/wan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteIds: [40] }),
  });
  const j = await r.json();
  const vpls = j.links.find(l => l.name === 'VPLS-HQ-BR');
  const ipsec = j.links.find(l => l.name === 'IPSEC-HQ-BR');
  assert.ok(vpls && ipsec, 'il VPLS e il tunnel devono arrivare entrambi');

  // Il vocabolario di NetBox qui è CHIUSO: `vpls` e `ipsec-tunnel` si traducono,
  // non si indovinano (a differenza del tipo di un circuito, che è testo libero).
  assert.equal(vpls.transport, 'vpls');
  assert.equal(ipsec.tunnel, 'ipsec');
  assert.deepEqual([vpls.aNetboxSiteName, vpls.bNetboxSiteName].sort(), ['Branch', 'HQ']);
  assert.deepEqual([ipsec.aDeviceName, ipsec.bDeviceName].sort(), ['BR-RTR-01', 'SW-CORE-01']);

  // ㉒ Il ruolo delle terminazioni NON diventa una forma sul collegamento: la
  // forma d'insieme e' una proprieta' dell'INSIEME dei collegamenti di un
  // servizio, non di uno. Gli indirizzi esterni invece si INCROCIANO.
  assert.equal(ipsec.topology, undefined);
  const hq = ipsec.aNetboxSiteName === 'HQ' ? 'a' : 'b';
  assert.equal(ipsec[hq + 'PeerIp'], '198.51.100.9', 'il peer di HQ è l\'indirizzo della filiale');

  // L'identificativo non ha un campo, e lo si dice invece di infilarlo altrove.
  assert.ok(j.notes.some(n => n.code === 'vpn.identifierNoField' && n.id === '1001'));
});

test('POST /wan senza ambito → 400 (non si legge tutto NetBox per sbaglio)', async () => {
  const r = await fetch(`${base}${P}/wan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'no-scope');
});

test('POST /wan come non-admin → 403', async () => {
  role = 'viewer';
  const r = await fetch(`${base}${P}/wan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteIds: [40] }),
  });
  assert.equal(r.status, 403);
  role = 'admin';
});

// ⑱ La regola d'identità non vive solo nel modulo puro: deve arrivare fino
// all'esito che la rotta consegna. Il finto NetBox serve un tipo con slug
// `mpls`, ed è quello che il verbale deve raccontare.
test('POST /wan → il censimento dei tipi, con la natura decisa per identità', async () => {
  const r = await fetch(`${base}${P}/wan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteIds: [40, 41] }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  const mpls = j.types.find(x => x.slug === 'mpls');
  assert.equal(mpls.transport, 'mpls', 'lo slug È la natura: nessuna configurazione di mezzo');
  const ftth = j.types.find(x => x.slug === 'ftth');
  assert.equal(ftth.transport, 'other', 'FTTH non è una nostra natura, e non ci si avvicina');
});
