'use strict';
// ============================================================
// NEIGHBOR SIDECAR — `history/<id>/neighbors.json`: lo store a file e le due route, sul server REALE
// ============================================================
// I vicini LLDP/CDP stanno FUORI dal documento, dietro l'interfaccia `historyStore`: qui si prova che lo store li tiene, che la PUT
// fonde invece di sostituire, non si fida del corpo e non conta due volte la stessa lettura, e che il documento non li vede mai.
// Il server e' quello vero (helper e2e, dir temporanea, porta effimera). Le letture sono SINTETICHE.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFsHistoryStore } = require('../server/history-store-fs.js');
const { startServer } = require('./e2e/helpers/server.js');
const N = require('../lib/neighbor-store.js');

const HOUR = 3600 * 1000;
const T0 = Date.now() - 6 * HOUR;   // orari vicini a ora: l'invecchiamento a 90 giorni usa l'orologio vero
const nb = (localPort, remote, o) => Object.assign({ localPort, remoteDevice: remote, remotePort: 'Gi0/1', remoteMac: '', remoteIP: '', protocol: 'LLDP' }, o || {});

// ── Lo store ─────────────────────────────────────────────────────────────────
function tmpStore() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-nb-'));
  return { baseDir, store: createFsHistoryStore({ baseDir }) };
}
test('store: vicini mai letti → null, non un errore', () => {
  const { baseDir, store } = tmpStore();
  try { assert.equal(store.readNeighbors(7), null); } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});
test('store: round-trip, sovrascrittura, i progetti non si mescolano, e il file e\' di tuple di scalari', () => {
  const { baseDir, store } = tmpStore();
  try {
    const f1 = N.neighborFold(null, N.neighborSanitizePut({ nodes: { a: { at: T0, neighbors: [nb('Gi1', 'B')] } } }), T0);
    const rec = store.saveNeighbors(7, f1);
    assert.equal(rec.v, 1);
    assert.ok(Date.parse(rec.at) > 0);
    assert.equal(N.neighborDecodeFile(store.readNeighbors(7)).a.rows[0].remoteName, 'B');
    const f2 = N.neighborFold(store.readNeighbors(7), N.neighborSanitizePut({ nodes: { a: { at: T0 + HOUR, neighbors: [] } } }), T0 + HOUR);
    store.saveNeighbors(7, f2);
    assert.equal(N.neighborDecodeFile(store.readNeighbors(7)).a.rows[0].misses, 1);
    assert.equal(store.readNeighbors(8), null);
    const raw = JSON.parse(fs.readFileSync(path.join(baseDir, '7', 'neighbors.json'), 'utf8'));
    for (const tup of raw.nodes.a.r) { assert.ok(Array.isArray(tup)); for (const v of tup) assert.ok(['string', 'number'].includes(typeof v)); }
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});
test('store: un file corrotto si legge come «nessun vicino», e cancellare il progetto porta via anche i suoi vicini', () => {
  const { baseDir, store } = tmpStore();
  try {
    fs.mkdirSync(path.join(baseDir, '5'), { recursive: true });
    fs.writeFileSync(path.join(baseDir, '5', 'neighbors.json'), '{ non json');
    assert.equal(store.readNeighbors(5), null);
    store.saveNeighbors(9, N.neighborFold(null, N.neighborSanitizePut({ nodes: { a: { at: T0, neighbors: [nb('Gi1', 'B')] } } }), T0));
    store.removeProject(9);
    assert.equal(store.readNeighbors(9), null);
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── Le route, sul server reale ───────────────────────────────────────────────
let srv, pid;
before(async () => {
  srv = await startServer();
  const r = await fetch(`${srv.baseURL}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'sidecar-vicini' }) });
  pid = (await r.json()).id;
});
after(async () => { if (srv) await srv.close(); });
const url = () => `${srv.baseURL}/api/projects/${pid}/history/neighbors`;
const put = (body) => fetch(url(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = async () => (await (await fetch(url())).json()).neighbors;
const reading = (k, neighbors, id) => ({ nodes: { [id || 'sw-1']: { at: T0 + k * HOUR, neighbors } } });

test('route: GET su un progetto senza vicini → file vuoto, non 404', async () => {
  assert.deepEqual(await get(), { v: 1, nodes: {} });
});
test('route: PUT poi GET; i mancati crescono SOLO con letture sane e la stessa lettura rimandata non conta due volte', async () => {
  let r = await put(reading(0, [nb('Gi1', 'B'), nb('Gi2', 'C')]));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accepted, 1);
  r = await put(reading(1, [nb('Gi2', 'C')]));
  assert.equal(r.status, 200);
  let rows = N.neighborDecodeFile(await get())['sw-1'].rows;
  assert.equal(rows.find(x => x.remoteName === 'B').misses, 1);
  assert.equal(rows.find(x => x.remoteName === 'C').misses, 0);
  await put(reading(1, [nb('Gi2', 'C')]));    // la stessa lettura due volte
  await put(reading(0, [nb('Gi1', 'B'), nb('Gi2', 'C')]));   // una piu' vecchia (client rimasto indietro)
  rows = N.neighborDecodeFile(await get())['sw-1'].rows;
  assert.equal(rows.find(x => x.remoteName === 'B').misses, 1, 'ne\' la stessa lettura ne\' una vecchia cambiano il conto');
});
test('route: un apparato NON nominato nella PUT (lettura fallita) non prende nessun mancato', async () => {
  await put(reading(0, [nb('Gi1', 'X')], 'sw-a'));
  await put(reading(1, [], 'sw-b'));
  await put(reading(2, [], 'sw-b'));
  assert.equal(N.neighborDecodeFile(await get())['sw-a'].rows[0].misses, 0);
});
test('route: il corpo ostile viene ripulito (id, istanti, protocolli, nomi)', async () => {
  const r = await put({ nodes: {
    '<script>x</script>': { at: T0, neighbors: [nb('Gi1', 'B')] },
    'ok-2': { at: T0, neighbors: [nb('Gi\u0000\u00071', 'B\u0007c'), nb('Gi2', 'C', { protocol: 'FDB' }), { localPort: 'Gi3' }, null, 'x'] },
    'senza-istante': { neighbors: [nb('Gi1', 'B')] },
  } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accepted, 1);
  const f = await get();
  assert.ok(!Object.keys(f.nodes).some(k => k.includes('<')));
  const rows = N.neighborDecodeFile(f)['ok-2'].rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].localIf, 'Gi1');
  assert.equal(rows[0].remoteName, 'Bc');
});
test('route: un corpo che non e\' una lettura → 200 con accepted 0, il file non cambia', async () => {
  const before = JSON.stringify(await get());
  for (const body of [{}, { nodes: 'x' }, { nodes: [] }, []]) {
    const r = await put(body);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).accepted, 0);
  }
  assert.equal(JSON.stringify(await get()), before);
});
test('route: progetto inesistente → 404 su entrambe', async () => {
  const bad = `${srv.baseURL}/api/projects/999999/history/neighbors`;
  assert.equal((await fetch(bad)).status, 404);
  assert.equal((await fetch(bad, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
});
test('route: il DOCUMENTO non vede mai i vicini', async () => {
  const txt = JSON.stringify(await (await fetch(`${srv.baseURL}/api/projects/${pid}`)).json());
  assert.doesNotMatch(txt, /sw-1|"B"|remoteId|neighbors/);
});
test('route: entrambe solo per amministratori, e la PUT passa dal corpo ripulito e dalla fusione, mai dal corpo nudo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'history.js'), 'utf8');
  assert.match(src, /router\.put\('\/api\/projects\/:id\/history\/neighbors', auth\.requireAdmin/);
  assert.match(src, /router\.get\('\/api\/projects\/:id\/history\/neighbors', auth\.requireAdmin/);
  assert.match(src, /neighborSanitizePut\(req\.body\)/);
  assert.match(src, /neighborFold\(store\.readNeighbors\(id\), put\)/);
  assert.doesNotMatch(src, /saveNeighbors\(id, req\.body\)/);
});
