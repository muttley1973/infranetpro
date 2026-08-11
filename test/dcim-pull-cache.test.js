'use strict';
// Cache in memoria della lettura NetBox (server/dcim/pull-cache.js).
// L'invariante che conta: la chiave dipende da COSA SI LEGGE, mai dalle scelte
// dell'utente — altrimenti ogni decisione fa ripartire un pull da due minuti.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPullCache } = require('../server/dcim/pull-cache');

const BASE = { instance: 'http://nb:8010', userId: 7, scope: { siteIds: [1, 2] }, entities: { devices: true, cabling: true } };

test('la chiave e\' stabile: ordine delle chiavi e degli id non conta', () => {
  const c = createPullCache();
  assert.equal(
    c.keyFor(BASE),
    c.keyFor({ entities: { cabling: true, devices: true }, scope: { siteIds: [2, 1] }, userId: 7, instance: 'http://nb:8010' }),
  );
});

test('⚠️ decisioni, mappature ed esclusioni NON entrano nella chiave', () => {
  const c = createPullCache();
  // Cambiano la MAPPATURA, non cosa si scarica: devono colpire la stessa voce.
  const withChoices = Object.assign({}, BASE, {
    decisions: { 'ports.overTemplate': 'genericPanel' },
    mapping: { 12: { type: 'switch' } },
    exclude: ['device:3'],
  });
  assert.equal(c.keyFor(BASE), c.keyFor(withChoices));
});

test('cambiano istanza, utente, scope o entita\' → chiave diversa', () => {
  const c = createPullCache();
  const k = c.keyFor(BASE);
  assert.notEqual(k, c.keyFor(Object.assign({}, BASE, { instance: 'http://altro:8010' })));
  assert.notEqual(k, c.keyFor(Object.assign({}, BASE, { userId: 8 })), 'token e permessi sono per utente');
  assert.notEqual(k, c.keyFor(Object.assign({}, BASE, { scope: { siteIds: [1] } })));
  assert.notEqual(k, c.keyFor(Object.assign({}, BASE, { entities: { devices: true, cabling: false } })));
});

test('hit entro il TTL, miss oltre', () => {
  let t = 1000;
  const c = createPullCache({ ttlMs: 500, now: () => t });
  const k = c.keyFor(BASE);
  assert.equal(c.get(k), null, 'a freddo non inventa niente');
  c.set(k, { devices: [1, 2, 3] });
  const hit = c.get(k);
  assert.deepEqual(hit.value, { devices: [1, 2, 3] });
  assert.equal(hit.at, 1000, 'l\'eta\' del dato viaggia col dato: l\'anteprima deve poterla dire');
  t = 1400; assert.ok(c.get(k), 'dentro il TTL resta valida');
  t = 1600; assert.equal(c.get(k), null, 'scaduta');
  assert.equal(c.size(), 0, 'la voce scaduta non resta a occupare memoria');
});

test('un bundle e\' grande: si tengono poche voci, si butta la meno usata', () => {
  const c = createPullCache({ maxEntries: 2 });
  const a = c.keyFor(Object.assign({}, BASE, { userId: 1 }));
  const b = c.keyFor(Object.assign({}, BASE, { userId: 2 }));
  const d = c.keyFor(Object.assign({}, BASE, { userId: 3 }));
  c.set(a, 'A'); c.set(b, 'B');
  c.get(a);                       // A torna in cima
  c.set(d, 'D');                  // sfratta B, non A
  assert.equal(c.get(a).value, 'A');
  assert.equal(c.get(b), null);
  assert.equal(c.get(d).value, 'D');
  assert.equal(c.size(), 2);
});

test('invalidate mirato e clear totale', () => {
  const c = createPullCache();
  const k = c.keyFor(BASE);
  c.set(k, 'X');
  assert.equal(c.invalidate(k), true);
  assert.equal(c.get(k), null);
  c.set(k, 'Y'); c.clear();
  assert.equal(c.size(), 0, 'cambiando configurazione DCIM non deve sopravvivere niente');
});

test('difensivo: parti mancanti non rompono la chiave', () => {
  const c = createPullCache();
  assert.equal(typeof c.keyFor(), 'string');
  assert.equal(c.keyFor(), c.keyFor({ scope: {}, entities: {} }));
});

// ── Aggancio nella route e nel wizard ────────────────────────────────────────
// Stile dei test di questa route (vedi dcim-import-progress.test.js): si legge il
// sorgente. Serve a bloccare gli invarianti che un refactor romperebbe in silenzio.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const ROUTE = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'integrations.js'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'src', 'app-integrations.js'), 'utf8');
const I18N = fs.readFileSync(path.join(ROOT, 'lib', 'i18n.js'), 'utf8');

test('⚠️ la cache resta FUORI dal progetto salvato', () => {
  // Nel progetto va lo stato mappato e basta: il bundle grezzo NetBox non compare
  // in nessuna scrittura su disco.
  assert.match(ROUTE, /saveProject\(id, name, state, now, now\)/);
  assert.equal(/saveProject\([^)]*\bnb\b/.test(ROUTE), false, 'il bundle grezzo non deve finire in saveProject');
  const cacheSrc = fs.readFileSync(path.join(ROOT, 'server', 'dcim', 'pull-cache.js'), 'utf8');
  for (const forbidden of ['require(\'fs\')', 'writeFile', 'saveProject', 'JSON.stringify(entries']) {
    assert.equal(cacheSrc.includes(forbidden), false, `la cache non deve toccare ${forbidden}`);
  }
});

test('la route riusa la lettura, la rilegge su richiesta e la butta quando serve', () => {
  assert.match(ROUTE, /const hit = body\.refresh \? null : pullCache\.get\(cacheKey\)/);
  assert.match(ROUTE, /fetchedAt = pullCache\.set\(cacheKey, nb\)\.at/);
  assert.match(ROUTE, /pullCache\.invalidate\(cacheKey\)/, 'dopo il commit la sessione di import e\' chiusa');
  assert.match(ROUTE, /pullCache\.clear\(\)/, 'cambiare configurazione DCIM invalida tutto');
});

test('l\'anteprima dichiara l\'eta\' del dato, e il wizard sa richiederlo fresco', () => {
  assert.match(ROUTE, /fetchedAt: fetchedAt != null \? new Date\(fetchedAt\)\.toISOString\(\) : null/);
  assert.match(CLIENT, /if \(refresh\) body\.refresh = true/);
  assert.match(CLIENT, /'dcim-reread': \(\) => _runPreview\(true\)/);
  assert.match(CLIENT, /dcim\.dec\.fetchedAt/);
  for (const key of ['dcim.dec.fetchedAt', 'dcim.dec.reread']) {
    assert.equal((I18N.match(new RegExp(`'${key.replace(/\./g, '\\.')}'`, 'g')) || []).length, 2, `${key} in italiano e inglese`);
  }
});
