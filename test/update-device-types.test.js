'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const updater = require('../scripts/update-device-types');

test('device-type updater: conserva il canonico e proietta il template runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-device-types-test-'));
  const vendor = path.join(root, 'Acme');
  fs.mkdirSync(vendor, { recursive: true });
  fs.writeFileSync(path.join(vendor, 'demo.yaml'), [
    'slug: acme-demo-switch',
    'manufacturer: Acme',
    'model: Demo Switch',
    'part_number: DS-1',
    'u_height: 1',
    'interfaces:',
    '  - name: GigabitEthernet1',
    '    type: 1000base-t',
    '  - name: sfp1',
    '    type: 10gbase-x-sfpp',
  ].join('\n'), 'utf8');
  try {
    const result = updater.build(root, true);
    assert.equal(result.canonical.length, 1);
    assert.equal(result.runtime.length, 1);
    assert.equal(result.canonical[0].interfaces.length, 2);
    assert.equal(result.runtime[0].sourceSlug, 'acme-demo-switch');
    assert.equal(result.runtime[0].ports, 2);
    assert.equal(result.runtime[0].counts.copper, 1);
    assert.equal(result.runtime[0].counts.sfp, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('device-type updater: applica override ed esclusioni senza alterare il canonico', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-device-types-controls-'));
  fs.writeFileSync(path.join(root, 'a.yaml'), [
    'slug: acme-a', 'manufacturer: Acme', 'model: A Switch', 'u_height: 1',
    'interfaces:', '  - name: p1', '    type: 1000base-t', '  - name: p2', '    type: 1000base-t',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'b.yaml'), [
    'slug: acme-b', 'manufacturer: Acme', 'model: B Switch', 'u_height: 1',
    'interfaces:', '  - name: p1', '    type: 1000base-t', '  - name: p2', '    type: 1000base-t',
  ].join('\n'), 'utf8');
  try {
    const result = updater.build(root, true, {
      overrides: { 'acme-a': { ports: 4, frontPanel: {
        mgmtCount: 1,
        sharedMediaSlots: [{ start: 4, count: 1, media: ['copper', 'fiber'] }],
      } } },
      exclusions: ['acme-b'],
    });
    assert.equal(result.canonical.length, 2);
    assert.equal(result.runtime.length, 1);
    assert.equal(result.runtime[0].ports, 4);
    assert.deepEqual(result.runtime[0].frontPanel.sharedMediaSlots, [{ start: 4, count: 1, media: ['copper', 'fiber'] }]);
    assert.equal(result.canonical[0].interfaces.length, 2);
    assert.equal(result.dropped[0].reason, 'manual-exclusion');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Il cancello dell'aggiornamento guardava QUANTI modelli la libreria scarta: a
// ottobre NetBox ha aggiunto seimila telecamere IP, gli esclusi sono passati da
// 747 a 6884 (soglia 500) e l'aggiornamento e' rimasto bloccato con il catalogo in
// uso identico. Ora guarda i modelli GIA' NOTI che cambiano destino.
test('device-type updater: runtimeChurn conta solo i modelli gia\' noti, mai i nuovi', () => {
  const canon = slugs => slugs.map(sourceSlug => ({ sourceSlug }));
  const run = slugs => slugs.map(sourceSlug => ({ sourceSlug }));
  // la sorgente cresce: due modelli nuovi nel catalogo in uso non sono una variazione
  assert.deepEqual(updater.runtimeChurn(canon(['a']), run(['a']), run(['a', 'b', 'c'])), { lost: [], gained: [] });
  // un modello noto e in uso viene scartato dal filtro dei ruoli
  assert.deepEqual(updater.runtimeChurn(canon(['a', 'b']), run(['a', 'b']), run(['a'])), { lost: ['b'], gained: [] });
  // un modello noto, prima scartato, ora rientra (stessa anomalia, verso opposto)
  assert.deepEqual(updater.runtimeChurn(canon(['a', 'b']), run(['a']), run(['a', 'b'])), { lost: [], gained: ['b'] });
  // sparito dalla sorgente mentre era in uso: il catalogo in uso cala
  assert.deepEqual(updater.runtimeChurn(canon(['a', 'b']), run(['a', 'b']), run(['a'])).lost, ['b']);
  // il catalogo precedente senza sourceSlug (formato vecchio) si legge per slug
  assert.deepEqual(updater.runtimeChurn(canon(['a']), [{ slug: 'a' }], run(['a'])), { lost: [], gained: [] });
  // nessuna storia: niente da confrontare
  assert.deepEqual(updater.runtimeChurn(undefined, undefined, run(['a'])), { lost: [], gained: [] });
});

function yamlModel(slug, manufacturer, model, interfaces) {
  const lines = ['slug: ' + slug, 'manufacturer: ' + manufacturer, 'model: ' + model, 'u_height: 1'];
  if (interfaces) {
    lines.push('interfaces:');
    for (let i = 1; i <= interfaces; i++) lines.push('  - name: p' + i, '    type: 1000base-t');
  }
  return lines.join('\n');
}

function runUpdater(source, store, extra) {
  const none = path.join(store, 'assente.json');
  return require('child_process').spawnSync(process.execPath, [
    path.resolve(__dirname, '..', 'scripts', 'update-device-types.js'), '--quiet',
    '--input=' + source,
    '--canonical=' + path.join(store, 'canonical.json'),
    '--catalog=' + path.join(store, 'runtime.json'),
    '--manifest=' + path.join(store, 'manifest.json'),
    '--diff=' + path.join(store, 'diff.json'),
    '--aliases=' + none, '--overrides=' + none, '--exclusions=' + none,
  ].concat(extra || []), { encoding: 'utf8', windowsHide: true });
}

test('device-type updater: la libreria che cresce di telecamere non blocca l\'aggiornamento', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-device-types-growth-'));
  const source = path.join(root, 'src');
  const store = path.join(root, 'store');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  try {
    for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(source, 'sw' + i + '.yaml'), yamlModel('acme-sw-' + i, 'Acme', 'SW ' + i, 2), 'utf8');
    const first = runUpdater(source, store);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8')).catalogModels, 4);
    // seicento apparecchi a una sola porta: la libreria si decuplica, il catalogo in uso no
    for (let i = 1; i <= 600; i++) fs.writeFileSync(path.join(source, 'cam' + i + '.yaml'), yamlModel('optics-x' + i, 'Acme Optics', 'X' + i, 1), 'utf8');
    const second = runUpdater(source, store);
    assert.equal(second.status, 0, second.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'));
    assert.equal(manifest.canonicalModels, 604);
    assert.equal(manifest.catalogModels, 4, 'le telecamere restano fuori dal catalogo in uso');
    assert.equal(manifest.excludedModels, 600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('device-type updater: un classificatore che perde i modelli in uso blocca l\'aggiornamento e non scrive niente', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-device-types-break-'));
  const source = path.join(root, 'src');
  const store = path.join(root, 'store');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  try {
    for (let i = 1; i <= 8; i++) fs.writeFileSync(path.join(source, 'sw' + i + '.yaml'), yamlModel('acme-sw-' + i, 'Acme', 'SW ' + i, 2), 'utf8');
    assert.equal(runUpdater(source, store).status, 0);
    const files = ['canonical.json', 'runtime.json', 'manifest.json', 'diff.json'];
    const before = files.map(f => fs.readFileSync(path.join(store, f), 'utf8'));
    // la sorgente cambia formato: quattro degli otto apparecchi arrivano senza interfacce
    for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(source, 'sw' + i + '.yaml'), yamlModel('acme-sw-' + i, 'Acme', 'SW ' + i, 0), 'utf8');
    const blocked = runUpdater(source, store, ['--max-runtime-change=3']);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /variazione anomala del catalogo in uso: 4 modelli usciti/);
    assert.match(blocked.stderr, /--max-runtime-change=N/);
    assert.deepEqual(files.map(f => fs.readFileSync(path.join(store, f), 'utf8')), before, 'un aggiornamento rifiutato non tocca i file');
    // chi sa cosa sta facendo alza il limite a mano
    const forced = runUpdater(source, store, ['--max-runtime-change=10']);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8')).catalogModels, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('device-type updater: diff distingue aggiunte, rimozioni e template', () => {
  const diff = updater.diffCatalog(
    [{ sourceSlug: 'old', model: 'Old', interfaces: [], capabilities: {} }],
    [{ sourceSlug: 'new', model: 'New', interfaces: [], capabilities: {} }],
    [{ sourceSlug: 'old', ports: 1 }],
    [{ sourceSlug: 'new', ports: 2 }],
  );
  assert.deepEqual(diff.added, ['new']);
  assert.deepEqual(diff.removed, ['old']);
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.counts.removed, 1);
});
