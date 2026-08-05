'use strict';
// ============================================================
// CABLE RECONCILE — test del miscablaggio per-porta (lib/cable-reconcile.js).
// Invarianti d'onestà: silenzio ≠ contraddizione · vicino ignoto → skip · capo
// PASSIVO (patch panel) → skip (LLDP transita) · match → nessun flag · vicino noto
// DIVERSO → flag · simmetrico sui due capi · wireless escluso.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { detectMiscabling } = require('../lib/cable-reconcile.js');

// Scenario base: SW-A (attivo), SW-B (attivo), SW-C (attivo), PP (passivo, NON attivo).
const ACTIVE = new Set(['swA', 'swB', 'swC']);   // PP (patch panel) non c'è → passivo
const owner = { 'swA-1': 'swA', 'swB-1': 'swB', 'swC-1': 'swC', 'pp-1': 'pp' };

test('match: la porta vede il vicino DICHIARATO → nessun flag', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1' }];
  const observed = { 'swA-1': 'swB', 'swB-1': 'swA' };   // entrambi confermano
  assert.deepEqual(detectMiscabling(links, observed, owner, ACTIVE), {});
});

test('mismatch: la porta vede un nodo NOTO diverso → flag con dettaglio', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1' }];   // dichiarato A↔B
  const observed = { 'swA-1': 'swC' };                        // ma A vede C
  const r = detectMiscabling(links, observed, owner, ACTIVE);
  assert.deepEqual(r.l1, { end: 'swA-1', observed: 'swC', declared: 'swB' });
});

test('silenzio: nessun vicino osservato → nessun flag (silenzio ≠ contraddizione)', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1' }];
  assert.deepEqual(detectMiscabling(links, {}, owner, ACTIVE), {});
});

test('capo PASSIVO (patch panel): l\'LLDP transita → nessun flag', () => {
  // Cavo dichiarato SW-A ↔ Patch Panel; A vede SW-C a valle (oltre il PP passivo).
  const links = [{ id: 'l1', src: 'swA-1', dst: 'pp-1' }];
  const observed = { 'swA-1': 'swC' };                        // vede il device a valle
  // declDst = 'pp' NON è attivo → non si confronta → nessun falso positivo.
  assert.deepEqual(detectMiscabling(links, observed, owner, ACTIVE), {});
});

test('simmetrico: il mismatch visto dal capo dst', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1' }];   // dichiarato A↔B
  const observed = { 'swB-1': 'swC' };                        // ma B vede C (non A)
  const r = detectMiscabling(links, observed, owner, ACTIVE);
  assert.deepEqual(r.l1, { end: 'swB-1', observed: 'swC', declared: 'swA' });
});

test('vicino risolve al DICHIARATO su un capo, diverso sull\'altro → flag (uno basta)', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1' }];
  const observed = { 'swA-1': 'swB', 'swB-1': 'swC' };   // A ok, ma B vede C
  const r = detectMiscabling(links, observed, owner, ACTIVE);
  // src combacia (A→B ok) → passa al ramo dst: B vede C ≠ A → flag su dst.
  assert.deepEqual(r.l1, { end: 'swB-1', observed: 'swC', declared: 'swA' });
});

test('wireless: escluso (non ha vicino LLDP di cavo)', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1', wireless: true }];
  const observed = { 'swA-1': 'swC' };
  assert.deepEqual(detectMiscabling(links, observed, owner, ACTIVE), {});
});

test('link senza id o senza capi → ignorato', () => {
  const links = [
    { src: 'swA-1', dst: 'swB-1' },          // niente id
    { id: 'l2', src: 'swA-1' },              // niente dst
    null,
  ];
  const observed = { 'swA-1': 'swC' };
  assert.deepEqual(detectMiscabling(links, observed, owner, ACTIVE), {});
});

test('activeNodes come oggetto piatto (non solo Set)', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1' }];
  const observed = { 'swA-1': 'swC' };
  const r = detectMiscabling(links, observed, owner, { swA: 1, swB: 1, swC: 1 });
  assert.equal(r.l1.observed, 'swC');
});

test('più cavi: solo quelli contraddetti finiscono nella mappa', () => {
  const links = [
    { id: 'ok', src: 'swA-1', dst: 'swB-1' },     // A vede B → ok
    { id: 'bad', src: 'swC-1', dst: 'swB-1' },    // C dichiarato↔B ma C vede A → flag
  ];
  const owner2 = Object.assign({}, owner, { 'swC-1': 'swC' });
  const observed = { 'swA-1': 'swB', 'swC-1': 'swA' };
  const r = detectMiscabling(links, observed, owner2, ACTIVE);
  assert.equal(r.ok, undefined);
  assert.deepEqual(r.bad, { end: 'swC-1', observed: 'swA', declared: 'swB' });
});
