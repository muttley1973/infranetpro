'use strict';
// ============================================================
// CABLE RECONCILE — test del miscablaggio per-porta (lib/cable-reconcile.js).
// Invarianti d'onestà: silenzio ≠ contraddizione · vicino ignoto → skip · capo
// PASSIVO (patch panel) → skip (LLDP transita) · match → nessun flag · vicino noto
// DIVERSO → flag · simmetrico sui due capi · wireless escluso.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { detectMiscabling, detectPortConflicts, miscabledLabels } = require('../lib/cable-reconcile.js');

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

// ============================================================
// PORT CONFLICT — una porta (non passante) non puo' reggere due cavi.
// pass = Set dei nodi PASSANTI (patch panel/presa/voip): il rame CONTINUA, esenti.
// ============================================================

test('due cavi sulla STESSA porta attiva -> conflitto sulla porta', () => {
  const links = [
    { id: 'l1', src: 'swA-1', dst: 'swB-1' },   // swB-1 ...
    { id: 'l2', src: 'swC-1', dst: 'swB-1' },   // ...ha DUE cavi
  ];
  const r = detectPortConflicts(links, { 'swA-1': 'swA', 'swB-1': 'swB', 'swC-1': 'swC' }, new Set());
  assert.deepEqual(r, { 'swB-1': ['l1', 'l2'] });
});

test('porta PASSANTE (patch panel) con due cavi -> nessun conflitto (rame passa)', () => {
  const links = [
    { id: 'l1', src: 'swA-1', dst: 'pp-1' },
    { id: 'l2', src: 'pp-1', dst: 'wp-1' },     // pp-1 su due cavi = la catena
  ];
  const owner = { 'swA-1': 'swA', 'pp-1': 'pp', 'wp-1': 'wp' };
  const r = detectPortConflicts(links, owner, new Set(['pp', 'wp']));   // pp, wp passanti
  assert.deepEqual(r, {});
});

test('wireless non conta come cavo sulla porta', () => {
  const links = [
    { id: 'l1', src: 'swA-1', dst: 'swB-1' },
    { id: 'l2', src: 'swA-1', dst: 'apX-1', wireless: true },   // wireless su swA-1
  ];
  const r = detectPortConflicts(links, { 'swA-1': 'swA', 'swB-1': 'swB', 'apX-1': 'apX' }, new Set());
  assert.deepEqual(r, {});    // swA-1 ha un solo cavo VERO
});

test('un cavo per porta -> nessun conflitto', () => {
  const links = [{ id: 'l1', src: 'swA-1', dst: 'swB-1' }];
  assert.deepEqual(detectPortConflicts(links, { 'swA-1': 'swA', 'swB-1': 'swB' }, new Set()), {});
});

test('scenario reale: R-EDGE:2 con auto(sw1) + manuale(rt2 omonimo) -> conflitto', () => {
  const links = [
    { id: 'auto', src: 'rt5-2', dst: 'sw1-1' },
    { id: 'man', src: 'rt2-1', dst: 'rt5-2' },
  ];
  const owner = { 'rt5-2': 'rt5', 'sw1-1': 'sw1', 'rt2-1': 'rt2' };
  const r = detectPortConflicts(links, owner, new Set());   // rt5 attivo, non passante
  assert.deepEqual(r, { 'rt5-2': ['auto', 'man'] });
});

// ============================================================
// MISCABLED LABELS — disambigua quando i due capi hanno lo STESSO nome (omonimia).
// «annuncia SW-CORE, non SW-CORE» -> «annuncia SW-CORE (10.10.30.1), non SW-CORE (10.10.99.1)».
// ============================================================
const _info = {
  sw1: { name: 'SW-CORE', ip: '10.10.30.1', type: 'switch' },
  rt2: { name: 'SW-CORE', ip: '10.10.99.1', type: 'router' },
  swB: { name: 'SW-B', ip: '10.0.0.2', type: 'switch' },
};
const _infoOf = (id) => _info[id] || null;

test('nomi diversi -> resi tali e quali', () => {
  assert.deepEqual(miscabledLabels('sw1', 'swB', _infoOf), { obs: 'SW-CORE', decl: 'SW-B' });
});

test('nomi UGUALI -> disambigua con l\'IP', () => {
  assert.deepEqual(miscabledLabels('sw1', 'rt2', _infoOf),
    { obs: 'SW-CORE (10.10.30.1)', decl: 'SW-CORE (10.10.99.1)' });
});

test('nomi uguali, IP mancante -> ripiega sul tipo', () => {
  const io = (id) => ({ a: { name: 'X', type: 'switch' }, b: { name: 'X', type: 'router' } }[id] || null);
  assert.deepEqual(miscabledLabels('a', 'b', io), { obs: 'X (switch)', decl: 'X (router)' });
});

test('nomi uguali, niente IP ne tipo -> ripiega sull\'id', () => {
  const io = (id) => ({ a: { name: 'X' }, b: { name: 'X' } }[id] || null);
  assert.deepEqual(miscabledLabels('a', 'b', io), { obs: 'X #a', decl: 'X #b' });
});

test('nodo ignoto -> nome = id (nessun crash)', () => {
  assert.deepEqual(miscabledLabels('zzz', 'swB', _infoOf), { obs: 'zzz', decl: 'SW-B' });
});
