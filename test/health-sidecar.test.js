'use strict';
// ============================================================
// HEALTH SIDECAR — `history/<id>/health.json`: lo store a file e le due route, sul server REALE
// ============================================================
// La salute delle interfacce sta FUORI dal documento, dietro l'interfaccia `historyStore` (come presenza e
// osservazioni): qui si prova che lo store la tiene, che la PUT fonde invece di sostituire e non si fida del
// corpo, e che il documento non la vede mai. Il server e' quello vero (helper e2e, dir temporanea, porta
// effimera; non serve Chrome). Le letture sono SINTETICHE: scritte a mano, non catturate da un apparato.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFsHistoryStore } = require('../server/history-store-fs.js');
const { startServer } = require('./e2e/helpers/server.js');
const H = require('../lib/health-store.js');

const HOUR = 3600 * 1000;
// Orari VICINI A ORA: il server fonde con l'orologio vero e una lettura piu' vecchia di 90 giorni e' gia' invecchiata.
const T0 = Date.now() - 3 * HOUR;
const rd = (at, upCs, inErrors) => ({ at, upCs, rows: [{ ifName: 'Gi1/0/1', oper: 1, admin: 1, inErrors, outErrors: 0, inDiscards: 0, outDiscards: 0, fcs: 0, disc: 0 }] });

// ── Lo store ─────────────────────────────────────────────────────────────────
function tmpStore() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-health-'));
  return { baseDir, store: createFsHistoryStore({ baseDir }) };
}

test('store: salute mai letta → null, non un errore', () => {
  const { baseDir, store } = tmpStore();
  try { assert.equal(store.readHealth(7), null); } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

test('store: round-trip, sovrascrittura, e i progetti non si mescolano', () => {
  const { baseDir, store } = tmpStore();
  try {
    const f1 = H.healthFold(null, { nodes: { a: H.healthReading(rd(T0, 1000, 1)) } }, T0);
    const rec = store.saveHealth(7, f1);
    assert.equal(rec.v, 1);
    assert.ok(Date.parse(rec.at) > 0);
    assert.deepEqual(H.healthDecodeFile(store.readHealth(7)).a.cur.rows[0].inErrors, 1);
    const f2 = H.healthFold(store.readHealth(7), { nodes: { a: H.healthReading(rd(T0 + HOUR, 361000, 5)) } }, T0 + HOUR);
    store.saveHealth(7, f2);
    const back = H.healthDecodeFile(store.readHealth(7));
    assert.equal(back.a.cur.rows[0].inErrors, 5);
    assert.equal(back.a.prev.rows[0].inErrors, 1);
    assert.equal(store.readHealth(8), null, 'altro progetto, altra salute');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

test('store: il file e\' scalari e tuple, nessun oggetto annidato oltre le righe (SQL-ready)', () => {
  const { baseDir, store } = tmpStore();
  try {
    store.saveHealth(3, H.healthFold(null, { nodes: { a: H.healthReading(rd(T0, 1000, 1)) } }, T0));
    const raw = JSON.parse(fs.readFileSync(path.join(baseDir, '3', 'health.json'), 'utf8'));
    for (const slot of Object.values(raw.nodes)) {
      for (const which of ['cur', 'prev']) {
        if (!slot[which]) continue;
        for (const tup of slot[which].r) {
          assert.ok(Array.isArray(tup));
          for (const v of tup) assert.ok(v === null || ['string', 'number'].includes(typeof v));
        }
      }
    }
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

test('store: un file corrotto si legge come «niente salute», non rompe', () => {
  const { baseDir, store } = tmpStore();
  try {
    fs.mkdirSync(path.join(baseDir, '5'), { recursive: true });
    fs.writeFileSync(path.join(baseDir, '5', 'health.json'), '{ non json');
    assert.equal(store.readHealth(5), null);
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

test('store: cancellare il progetto porta via anche la sua salute', () => {
  const { baseDir, store } = tmpStore();
  try {
    store.saveHealth(9, H.healthFold(null, { nodes: { a: H.healthReading(rd(T0, 1, 1)) } }, T0));
    assert.ok(store.readHealth(9));
    store.removeProject(9);
    assert.equal(store.readHealth(9), null);
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── Le route, sul server reale ───────────────────────────────────────────────
let srv, pid;
before(async () => {
  srv = await startServer();
  const r = await fetch(`${srv.baseURL}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'sidecar-prova' }) });
  pid = (await r.json()).id;
});
after(async () => { if (srv) await srv.close(); });

const url = () => `${srv.baseURL}/api/projects/${pid}/history/health`;
const put = (body) => fetch(url(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = async () => (await (await fetch(url())).json()).health;

test('route: GET su un progetto senza salute → file vuoto, non 404', async () => {
  const h = await get();
  assert.deepEqual(h, { v: 1, nodes: {} });
});

test('route: PUT poi GET; la seconda lettura fa scorrere la prima; la stessa rimandata non cambia niente', async () => {
  let r = await put({ nodes: { 'sw-1': rd(T0, 1000, 1) } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accepted, 1);
  r = await put({ nodes: { 'sw-1': rd(T0 + HOUR, 361000, 6) } });
  assert.equal(r.status, 200);
  let d = H.healthDecodeFile(await get());
  assert.equal(d['sw-1'].cur.rows[0].inErrors, 6);
  assert.equal(d['sw-1'].prev.rows[0].inErrors, 1);
  // la stessa lettura due volte: la differenza NON sparisce
  await put({ nodes: { 'sw-1': rd(T0 + HOUR, 361000, 6) } });
  d = H.healthDecodeFile(await get());
  assert.equal(d['sw-1'].prev.rows[0].inErrors, 1);
  // e la differenza che ne esce e' quella vera
  const s = H.healthSummarizeIf(d['sw-1'].prev, d['sw-1'].cur);
  assert.equal(s.ports[0].deltas.inErrors, 5);
});

test('route: il corpo ostile viene ripulito (id, numeri, nomi)', async () => {
  const r = await put({ nodes: {
    '<script>x</script>': rd(T0, 1, 1),
    'ok-2': { at: T0, upCs: 5, rows: [{ ifName: 'p\u0000\u0001q', inErrors: -5, outErrors: 1e30, inDiscards: '9', oper: 77 }] },
  } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accepted, 1);
  const raw = await get();
  assert.ok(!Object.keys(raw.nodes).some(k => k.includes('<')));
  const row = H.healthDecodeFile(raw)['ok-2'].cur.rows[0];
  assert.equal(row.ifName, 'pq');
  assert.equal(row.inErrors, null);
  assert.equal(row.outErrors, null);
  assert.equal(row.inDiscards, 9);
  assert.equal(row.oper, null);
});

test('route: un corpo che non e\' una salute → 200 con accepted 0, il file non cambia', async () => {
  const before = JSON.stringify(await get());
  for (const body of [{}, { nodes: 'x' }, { nodes: [] }, []]) {
    const r = await put(body);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).accepted, 0);
  }
  assert.equal(JSON.stringify(await get()), before);
});

test('route: progetto inesistente → 404 su entrambe', async () => {
  const bad = `${srv.baseURL}/api/projects/999999/history/health`;
  assert.equal((await fetch(bad)).status, 404);
  assert.equal((await fetch(bad, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
});

test('route: il DOCUMENTO non vede mai la salute (ne\' nella GET del progetto, ne\' dopo un salvataggio)', async () => {
  const r = await fetch(`${srv.baseURL}/api/projects/${pid}`);
  const txt = JSON.stringify(await r.json());
  assert.doesNotMatch(txt, /sw-1|inErrors|"health|Gi1\/0\/1/);
});

test('route: entrambe sono solo per amministratori (come ogni rotta dello storico)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'history.js'), 'utf8');
  assert.match(src, /router\.put\('\/api\/projects\/:id\/history\/health', auth\.requireAdmin/);
  assert.match(src, /router\.get\('\/api\/projects\/:id\/history\/health', auth\.requireAdmin/);
});

test('route: la PUT fonde con il disco e passa dal corpo ripulito, mai dal corpo nudo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'history.js'), 'utf8');
  assert.match(src, /healthSanitizePut\(req\.body\)/);
  assert.match(src, /healthFold\(store\.readHealth\(id\), put\)/);
  assert.doesNotMatch(src, /saveHealth\(id, req\.body\)/);
});
