// Test d'integrazione HTTP per la REST API v1 (server/routes/api-v1.js).
// Monta il router su un'app Express usa-e-getta con projects dir + tokens file
// ISOLATI (env impostato prima dei require → processo dedicato sotto node --test)
// e batte gli endpoint con fetch. Verifica: token gate, 401 senza token,
// sanitizzazione (niente community), 404, openapi pubblico, Ansible inventory.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-apiv1-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');

// Progetto campione con un segreto SNMP da NON far trapelare.
fs.writeFileSync(path.join(PROJECTS, '1.json'), JSON.stringify({
  id: 1, name: 'Lab', created_at: '2026-06-27 09:00:00', updated_at: '2026-06-27 09:30:00',
  state: {
    vlanNames: { 10: 'Mgmt' },
    ipam: { vlans: { 10: { subnet: '10.0.0.0/24', gateway: '10.0.0.1', dns: '10.0.0.1' } } },
    racks: [{ id: 'rk1', name: 'Rack 1', sizeU: 42 }],
    nodes: [
      { id: 'sw1', type: 'switch', name: 'SW1', brand: 'Cisco', rackId: 'rk1', rackU: 40, sizeU: 1,
        mac: '00:11:22:33:44:55', ip: '10.0.0.2',
        integration: { driver: 'snmp-v2c', host: '10.0.0.2', community: 'TOP-SECRET-COMMUNITY' } },
      { id: 'pc1', type: 'pc', name: 'PC1', ip: '10.0.0.50', mac: 'aa:bb:cc:00:00:01' },
    ],
  },
}), 'utf8');

const express = require('express');
const apiTokens = require('../server/api-tokens');

let server, base, TOKEN;

before(async () => {
  TOKEN = apiTokens.createToken('test-suite').token;
  const app = express();
  app.use(express.json());
  app.use(require('../server/routes/api-v1'));
  await new Promise(resolve => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { if (server) server.close(); });

const auth = () => ({ headers: { Authorization: `Bearer ${TOKEN}` } });

test('openapi.json è PUBBLICO (no token) e valido', async () => {
  const r = await fetch(`${base}/api/v1/openapi.json`);
  assert.equal(r.status, 200);
  const spec = await r.json();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths['/api/v1/projects/{id}/ansible-inventory']);
});

test('senza token → 401 con WWW-Authenticate', async () => {
  const r = await fetch(`${base}/api/v1/projects`);
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') || '', /Bearer/);
});

test('token non valido → 401', async () => {
  const r = await fetch(`${base}/api/v1/projects`, { headers: { Authorization: 'Bearer inp_falso' } });
  assert.equal(r.status, 401);
});

test('GET /api/v1 indice con token', async () => {
  const r = await fetch(`${base}/api/v1`, auth());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.version, 'v1');
  assert.ok(Array.isArray(j.endpoints));
});

test('GET /projects → elenco', async () => {
  const r = await fetch(`${base}/api/v1/projects`, auth());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.projects[0].id, 1);
  assert.equal(j.projects[0].name, 'Lab');
});

test('GET /projects/1 → inventario sanitizzato (NIENTE community)', async () => {
  const r = await fetch(`${base}/api/v1/projects/1`, auth());
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.ok(!/community/i.test(body), 'la chiave community non deve comparire');
  assert.ok(!/TOP-SECRET-COMMUNITY/.test(body), 'il valore community non deve comparire');
  const inv = JSON.parse(body);
  assert.equal(inv.counts.devices, 2);
  const sw = inv.devices.find(d => d.id === 'sw1');
  assert.equal(sw.snmp, true);
  assert.equal(sw.vlan, 10);
  assert.equal(sw.mac, '00:11:22:33:44:55');
});

test('GET /projects/1/devices', async () => {
  const r = await fetch(`${base}/api/v1/projects/1/devices`, auth());
  const j = await r.json();
  assert.equal(j.devices.length, 2);
});

test('GET /projects/1/ansible-inventory', async () => {
  const r = await fetch(`${base}/api/v1/projects/1/ansible-inventory`, auth());
  assert.equal(r.status, 200);
  const inv = await r.json();
  assert.equal(inv._meta.hostvars['SW1'].ansible_host, '10.0.0.2');
  assert.deepEqual(inv.type_switch.hosts, ['SW1']);
  assert.ok(!/community/i.test(JSON.stringify(inv)));
});

test('GET /projects/999 → 404', async () => {
  const r = await fetch(`${base}/api/v1/projects/999`, auth());
  assert.equal(r.status, 404);
});

// ── La superficie ESTERNA risponde alla domanda giusta (08/09) ──────────────
// Misurato con `_local/tools/smoke/sonda-api-v1.js`: con un token VALIDO in mano,
// ogni verbo di scrittura riceveva **401**. Non era un buco — nessuna scrittura
// passava — ma la risposta era una bugia utile a nessuno: a chi ha la chiave
// giusta, «401» dice «la tua chiave non va bene» mentre la verità è «questo verbo
// qui non esiste». Uno script rifà il login all'infinito invece di correggere il
// metodo, e intanto la risposta rivela che dietro c'è un'autenticazione di un
// altro tipo (la sessione, a cui la richiesta scivolava non trovando rotta).
for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`${metodo} su una rotta v1 → 405 con Allow, non 401`, async () => {
    const r = await fetch(`${base}/api/v1/projects/1`, Object.assign({ method: metodo }, auth()));
    assert.equal(r.status, 405);
    assert.match(r.headers.get('allow') || '', /GET/);
    assert.equal((await r.json()).code, 'read-only');
  });
}

test('scrivere senza token resta 401: prima l\'identità, poi il metodo', async () => {
  const r = await fetch(`${base}/api/v1/projects/1`, { method: 'POST' });
  assert.equal(r.status, 401, 'a chi non si è presentato non si spiega la forma dell\'API');
});

test('un percorso v1 che non esiste è 404 — e si ferma dentro l\'API', async () => {
  const r = await fetch(`${base}/api/v1/questa-rotta-non-esiste`, auth());
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'no-route');
});

test('l\'id di progetto passa dalla definizione condivisa (una sola)', async () => {
  // ⚠️ Non cambia cosa risponde oggi — `safeProjectId` usa `Number()` come il `+`
  // di prima, e `01` resta il progetto 1. Cambia DOVE è scritta la regola: qui si
  // prova che la superficie esterna non ha più una definizione sua, così il giorno
  // che si stringe, si stringe per tutti.
  const store = require('../server/projects-store');
  assert.equal(store.safeProjectId('1'), 1);
  assert.equal(store.safeProjectId('abc'), null);
  assert.equal(store.safeProjectId('-1'), null);
  assert.equal(store.safeProjectId('1.5'), null);
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server/routes/api-v1.js'), 'utf8');
  assert.match(src, /safeProjectId\(req\.params\.id\)/, 'la rotta la usa');
  assert.doesNotMatch(src, /loadProject\(\+req\.params\.id\)/, 'e non ha più la sua coercizione');
});
