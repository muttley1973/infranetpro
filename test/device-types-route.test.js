// Test d'integrazione HTTP per il router catalogo (server/routes/device-types.js).
// Verifica la cache in-memory (M4): il catalogo (~1.4 MB) NON va riletto/parsato a
// ogni richiesta. File ISOLATO: INFRANET_DEVICE_TYPES su file temp PRIMA del require.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-devtypes-'));
const CATALOG = path.join(TMP, 'device-types.json');
process.env.INFRANET_DEVICE_TYPES = CATALOG;

const express = require('express');
const router  = require('../server/routes/device-types.js');

const app = express();
app.use(router);
let server, base;

function get() {
  return new Promise((resolve, reject) => {
    http.get(`${base}/api/device-types`, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, ctype: res.headers['content-type'] || '', body: b }));
    }).on('error', reject);
  });
}

before(async () => {
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('catalogo assente → [] (nessun crash)', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.match(r.ctype, /application\/json/);
  assert.deepEqual(JSON.parse(r.body), []);
});

test('catalogo valido → servito come array', async () => {
  fs.writeFileSync(CATALOG, JSON.stringify([{ brand: 'Acme', model: 'X1', ports: 8, rackU: 1 }]));
  const r = await get();
  const arr = JSON.parse(r.body);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].brand, 'Acme');
});

test('catalogo aggiornato → cache invalidata (mtime+size)', async () => {
  fs.writeFileSync(CATALOG, JSON.stringify([
    { brand: 'Acme', model: 'X1', ports: 8, rackU: 1 },
    { brand: 'Acme', model: 'X2', ports: 24, rackU: 1 },
  ]));
  const r = await get();
  assert.equal(JSON.parse(r.body).length, 2, 'la modifica del file deve invalidare la cache');
});

test('catalogo malformato → serve l\'ultima versione valida, mai un 500/stack', async () => {
  fs.writeFileSync(CATALOG, '{questo non e json valido');
  const r = await get();
  assert.equal(r.status, 200);
  assert.match(r.ctype, /application\/json/);
  const arr = JSON.parse(r.body);           // deve restare JSON valido (array)
  assert.ok(Array.isArray(arr));
  assert.equal(arr.length, 2, 'ripiego sull\'ultima cache valida');
});
