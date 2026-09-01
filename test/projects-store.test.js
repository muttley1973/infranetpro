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

// ── Il nome del temporaneo identifica la SCRITTURA, non il processo ─────────
// Era `<file>.<pid>.tmp`: dentro un processo, tutte le scritture dello stesso
// file condividevano quel nome. Con l'I/O sincrona non fa danno; il giorno che
// diventa asincrona, due salvataggi si sovrascriverebbero il temporaneo a
// vicenda PRIMA del rename — che resterebbe atomico, e consegnerebbe un JSON
// valido col contenuto di due scritture mescolate, senza un errore da nessuna
// parte. Queste prove tengono il nome unico prima che serva.
const { _tmpPath } = require('../server/projects-store.js');

test('⚠️ due scritture dello STESSO file non condividono il temporaneo', () => {
  const f = path.join(os.tmpdir(), 'x', '1.json');
  const a = _tmpPath(f), b = _tmpPath(f), c = _tmpPath(f);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.equal(new Set([a, b, c]).size, 3, 'ogni scrittura ha il suo nome');
  // ⚠️ E non deve essere tornato alla forma vecchia: quella si riconosce perché
  // finisce col pid subito prima di `.tmp`.
  assert.equal(new RegExp('\\.' + process.pid + '\\.tmp$').test(a), false,
    'il nome non può essere <file>.<pid>.tmp: e\' esattamente quello che collideva');
});

test('il pid resta nel nome: due PROCESSI non devono collidere fra loro', () => {
  // Il progressivo separa le scritture dentro un processo, il pid separa i
  // processi. Togliere il pid sposterebbe la collisione un piano più su.
  const n = _tmpPath(path.join(os.tmpdir(), 'x', '1.json'));
  assert.ok(n.includes('.' + process.pid + '.'), 'nome: ' + n);
  assert.ok(n.endsWith('.tmp'));
});

test('⚠️ una scrittura FALLITA non lascia il temporaneo dietro di sé', () => {
  // Col nome fisso, un temporaneo rimasto indietro veniva riusato dalla
  // scrittura successiva. Con un nome nuovo ogni volta, ogni fallimento
  // lascerebbe un orfano che nessuno raccoglie: il nome unico OBBLIGA a pulire,
  // e questa è la prova che l'obbligo è rispettato.
  const dir  = tmpDir();
  const file = path.join(dir, '1.json');
  assert.throws(() => atomicWriteFile(file, 12345), 'un dato non scrivibile deve fallire');
  assert.deepEqual(fs.readdirSync(dir), [], 'né il file né il suo temporaneo');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('e dopo una scrittura RIUSCITA non ne resta comunque nessuno', () => {
  const dir  = tmpDir();
  const file = path.join(dir, '1.json');
  atomicWriteFile(file, '{"a":1}');
  atomicWriteFile(file, '{"a":2}');
  atomicWriteFile(file, '{"a":3}');
  const restati = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(restati, [], 'tre scritture, tre nomi diversi, zero avanzi');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 3 });
  fs.rmSync(dir, { recursive: true, force: true });
});
