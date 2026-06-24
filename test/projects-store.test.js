// Test per la scrittura atomica/durabile dello store progetti
// (server/projects-store.js → atomicWriteFile). Verifica che:
//  - il contenuto venga scritto correttamente (round-trip);
//  - la versione precedente venga conservata come .bak prima di sovrascrivere;
//  - non resti alcun file temporaneo dopo una scrittura riuscita;
//  - una scrittura su file inesistente NON crei un .bak.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const { atomicWriteFile, extractBgAsset, reattachBgAsset, removeBgAsset } = require('../server/projects-store.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-store-'));
}

// 1x1 PNG valido come data-URL (per i test di estrazione bgImage).
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('atomicWriteFile: scrive il contenuto (round-trip)', () => {
  const dir  = tmpDir();
  const file = path.join(dir, '1.json');
  atomicWriteFile(file, JSON.stringify({ hello: 'world' }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { hello: 'world' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('atomicWriteFile: conserva la versione precedente in .bak', () => {
  const dir  = tmpDir();
  const file = path.join(dir, '1.json');
  atomicWriteFile(file, JSON.stringify({ v: 1 }));
  atomicWriteFile(file, JSON.stringify({ v: 2 }));
  // file finale = ultima versione; .bak = versione precedente
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')), { v: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('atomicWriteFile: nessun file temporaneo residuo dopo il successo', () => {
  const dir  = tmpDir();
  const file = path.join(dir, '7.json');
  atomicWriteFile(file, JSON.stringify({ ok: true }));
  const leftovers = fs.readdirSync(dir).filter(f => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'non devono restare file .tmp');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('atomicWriteFile: prima scrittura non crea .bak', () => {
  const dir  = tmpDir();
  const file = path.join(dir, '3.json');
  atomicWriteFile(file, JSON.stringify({ first: true }));
  assert.equal(fs.existsSync(file + '.bak'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- bgImage: estrazione su asset --------------------------------------------

test('extractBgAsset: data-URL → asset su file + stato senza base64 (non muta l\'originale)', () => {
  const dir = tmpDir();
  const state = { foo: 1, bgImage: PNG_1x1, bgImageScale: 1 };
  const out = extractBgAsset(5, state, dir, null);
  // stato salvato: niente base64, solo il riferimento
  assert.equal(out.bgImage, null);
  assert.equal(out.bgImageAsset, '5.png');
  assert.equal(typeof out.bgImageHash, 'string');
  assert.ok(out.bgImageHash.length > 0);
  // asset scritto coi byte decodificati
  const asset = fs.readFileSync(path.join(dir, '5.png'));
  assert.deepEqual(asset, Buffer.from(PNG_1x1.split(',')[1], 'base64'));
  // l'originale NON è stato mutato (il client tiene il suo data-URL)
  assert.equal(state.bgImage, PNG_1x1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reattachBgAsset: dal riferimento ricostruisce il data-URL e ripulisce i campi storage', () => {
  const dir = tmpDir();
  const stored = extractBgAsset(5, { bgImage: PNG_1x1 }, dir, null);
  const proj = reattachBgAsset({ id: 5, state: Object.assign({}, stored) }, dir);
  assert.ok(proj.state.bgImage.startsWith('data:image/png;base64,'));
  // round-trip byte-identico
  assert.deepEqual(
    Buffer.from(proj.state.bgImage.split(',')[1], 'base64'),
    Buffer.from(PNG_1x1.split(',')[1], 'base64'));
  assert.equal(proj.state.bgImageAsset, undefined);
  assert.equal(proj.state.bgImageHash, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extractBgAsset: immagine invariata (stesso hash) → NON riscrive l\'asset', () => {
  const dir = tmpDir();
  const first = extractBgAsset(5, { bgImage: PNG_1x1 }, dir, null);
  // sporco il file: se venisse riscritto, il sentinel sparirebbe
  fs.writeFileSync(path.join(dir, '5.png'), 'SENTINEL');
  extractBgAsset(5, { bgImage: PNG_1x1 }, dir, first);   // prevMeta = stesso hash
  assert.equal(fs.readFileSync(path.join(dir, '5.png'), 'utf8'), 'SENTINEL');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extractBgAsset: nessuna immagine + asset precedente → rimuove l\'asset e i riferimenti', () => {
  const dir = tmpDir();
  const prev = extractBgAsset(5, { bgImage: PNG_1x1 }, dir, null);
  assert.ok(fs.existsSync(path.join(dir, '5.png')));
  const out = extractBgAsset(5, { bgImage: null }, dir, prev);
  assert.equal(fs.existsSync(path.join(dir, '5.png')), false);
  assert.equal(out.bgImage, null);
  assert.equal(out.bgImageAsset, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('removeBgAsset: elimina l\'asset del progetto (usato dalla delete)', () => {
  const dir = tmpDir();
  extractBgAsset(9, { bgImage: PNG_1x1 }, dir, null);
  assert.ok(fs.existsSync(path.join(dir, '9.png')));
  removeBgAsset(9, dir);
  assert.equal(fs.existsSync(path.join(dir, '9.png')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
