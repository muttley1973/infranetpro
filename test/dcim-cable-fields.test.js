'use strict';
// ============================================================
// DCIM — i campi di un cavo che arriva da NetBox: lunghezza, etichetta, stato, mezzo.
// Fino alla 2.13.0 l'import convertiva in metri solo il PIEDE (50 cm diventava 50 m, 1 km 1 m), non leggeva
// l'etichetta ne' lo stato del cavo, e non scriveva il mezzo (rame, fibra, DAC): un DAC su un cassetto ottico passava
// inosservato. Le categorie sono in test/cable-category.test.js.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const dcim = require('../lib/dcim-map.js');
const { validateCable } = require('../lib/cable-validate.js');

// ── la lunghezza ────────────────────────────────────────────────────────────────────────────────────────────────
test('lunghezza: le SEI unita\' di NetBox (km, m, cm, mi, ft, in) diventano metri', () => {
  const att = [[1, 'km', 1000], [3, 'm', 3], [50, 'cm', 0.5], [1, 'mi', 1609.34], [10, 'ft', 3.05], [100, 'in', 2.54]];
  for (const [n, u, m] of att) assert.equal(dcim._lengthM(n, u), m, `${n} ${u}`);
  for (const [n, u, m] of att) assert.equal(dcim._lengthM(n, { value: u, label: u }), m, `${n} {value:${u}}`);
  for (const [n, u, m] of att) assert.equal(dcim._lengthM(String(n), u.toUpperCase()), m, `${n} ${u.toUpperCase()} (testo, maiuscole)`);
});

test('lunghezza: un cavo di permuta in centimetri non diventa lungo come un cavo di dorsale', () => {
  assert.ok(dcim._lengthM(50, 'cm') < 1, '50 cm sono mezzo metro, non 50 m');
  assert.ok(dcim._lengthM(100, 'in') < 3, '100 pollici sono due metri e mezzo, non 100 m');
  assert.equal(dcim._lengthM(2.5, 'm'), 2.5);
});

test('lunghezza: senza unita\' valgono i metri (com\'e\' sempre stato), con un\'unita\' che non si conosce NON si scrive niente', () => {
  assert.equal(dcim._lengthM(2, undefined), 2);
  assert.equal(dcim._lengthM(2, null), 2);
  assert.equal(dcim._lengthM(2, ''), 2);
  assert.equal(dcim._lengthM(2, 'yd'), null, 'iarde: non e\' fra le sei, non si indovina');
  assert.equal(dcim._lengthM(2, 'metri'), null);
  assert.equal(dcim._lengthM(2, { value: 'furlong' }), null);
});

test('lunghezza: niente lunghezza, niente campo (zero, negativa, non numerica, o cosi\' piccola da arrotondare a zero)', () => {
  for (const n of [0, -3, NaN, '', null, undefined, 'abc', 0.0001]) assert.equal(dcim._lengthM(n, 'm'), null, String(n));
  assert.equal(dcim._lengthM(0.1, 'cm'), null, '1 mm: due decimali di metro non lo reggono');
});

// ── il cavo intero, dall'oggetto NetBox al link ─────────────────────────────────────────────────────────────────────
function importa(cavo) {
  const nb = {
    deviceRoles: [{ id: 31, slug: 'switch', name: 'Switch' }], racks: [{ id: 31, name: 'R1', u_height: 42 }],
    devices: [{ id: 302, name: 'A', role: { id: 31 }, rack: { id: 31 }, position: 5 }, { id: 303, name: 'B', role: { id: 31 }, rack: { id: 31 }, position: 9 }],
    interfaces: [{ id: 900, name: 'Gi0/1', type: { value: '1000base-t' }, device: { id: 302 } }, { id: 901, name: 'Gi0/1', type: { value: '1000base-t' }, device: { id: 303 } }],
    cables: [Object.assign({ id: 1, a_terminations: [{ object_type: 'dcim.interface', object_id: 900 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 901 }] }, cavo)],
  };
  const r = dcim.netboxToState(nb);
  assert.equal(r.state.links.length, 1, 'il cavo entra');
  return r.state.links[0];
}

test('cavo importato: la lunghezza in centimetri, pollici e chilometri arriva in metri', () => {
  assert.equal(importa({ type: 'cat6', length: 50, length_unit: { value: 'cm' } }).lengthM, 0.5);
  assert.equal(importa({ type: 'cat6', length: 100, length_unit: { value: 'in' } }).lengthM, 2.54);
  assert.equal(importa({ type: 'smf-os2', length: 2, length_unit: 'km' }).lengthM, 2000);
  assert.equal(importa({ type: 'cat6', length: 3, length_unit: { value: 'm' } }).lengthM, 3);
  assert.equal(importa({ type: 'cat6', length: 10, length_unit: { value: 'ft' } }).lengthM, 3.05);
  assert.ok(!('lengthM' in importa({ type: 'cat6' })), 'senza lunghezza nessun campo');
  assert.ok(!('lengthM' in importa({ type: 'cat6', length: 5, length_unit: { value: 'yd' } })), 'unita\' ignota: nessun campo');
});

// ── l'etichetta e lo stato ─────────────────────────────────────────────────────────────────────────────────────────
test('cavo importato: l\'etichetta di NetBox e\' l\'etichetta del cavo (senza spazi ai lati); senza, nessun campo', () => {
  assert.equal(importa({ type: 'cat6', label: '  CBL-0077 ' }).label, 'CBL-0077');
  assert.ok(!('label' in importa({ type: 'cat6' })));
  assert.ok(!('label' in importa({ type: 'cat6', label: '' })));
  assert.ok(!('label' in importa({ type: 'cat6', label: '   ' })));
});

test('cavo importato: connected = attivo, decommissioning = da sostituire, planned = NON dichiarato', () => {
  for (const forma of [(v) => ({ value: v, label: v }), (v) => v]) {
    assert.equal(importa({ type: 'cat6', status: forma('connected') }).cableStatus, 'active');
    assert.equal(importa({ type: 'cat6', status: forma('decommissioning') }).cableStatus, 'to_replace');
    assert.ok(!('cableStatus' in importa({ type: 'cat6', status: forma('planned') })), 'un cavo previsto non e\' un cavo spento');
  }
  assert.ok(!('cableStatus' in importa({ type: 'cat6' })), 'senza stato: nessun campo');
  assert.ok(!('cableStatus' in importa({ type: 'cat6', status: { value: 'boh' } })), 'uno stato che non si conosce non si inventa');
});

// ── il mezzo ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('cavo importato: il mezzo e\' quello che il tipo dichiara (rame, DAC, fibra), e coassiale, alimentazione e USB non ne hanno', () => {
  const att = { cat5e: 'copper', cat6a: 'copper', 'mrj21-trunk': 'copper', 'dac-active': 'dac', 'dac-passive': 'dac',
    'mmf-om4': 'fiber', 'smf-os2': 'fiber', mmf: 'fiber', smf: 'fiber', aoc: 'fiber' };
  for (const [tipo, medium] of Object.entries(att)) assert.equal(importa({ type: tipo }).medium, medium, tipo);
  for (const tipo of ['coaxial', 'rg-6', 'lmr-400', 'power', 'usb']) assert.ok(!('medium' in importa({ type: tipo })), tipo);
});

test('il mezzo e la categoria scritti dall\'import non si contraddicono mai (nessun reperto «mezzo/categoria» o «mezzo/connettore»)', () => {
  const TIPI = ['cat3', 'cat5', 'cat5e', 'cat6', 'cat6a', 'cat7', 'cat7a', 'cat8', 'mrj21-trunk', 'dac-active', 'dac-passive', 'coaxial', 'rg-6', 'rg-8', 'rg-11',
    'rg-59', 'rg-62', 'rg-213', 'lmr-100', 'lmr-200', 'lmr-400', 'mmf', 'mmf-om1', 'mmf-om2', 'mmf-om3', 'mmf-om4', 'mmf-om5', 'smf', 'smf-os1', 'smf-os2', 'aoc', 'power', 'usb'];
  for (const tipo of TIPI) {
    const l = importa({ type: tipo });
    const codici = validateCable(l).map((i) => i.code).filter((c) => /^medium-/.test(c));
    assert.deepEqual(codici, [], `${tipo}: ${JSON.stringify(l)}`);
  }
});

test('un DAC importato su un pannello solo fibra prende l\'errore (prima il mezzo non si scriveva e passava inosservato)', () => {
  const l = importa({ type: 'dac-passive' });
  assert.deepEqual(validateCable(l, { fiberEnds: [{ name: 'ODF-1', mode: '' }] }).map((i) => i.code), ['fiber-panel-medium']);
  assert.deepEqual(validateCable(importa({ type: 'smf-os2' }), { fiberEnds: [{ name: 'ODF-1', mode: 'sm-os2' }] }), [], 'la fibra su un pannello in fibra: niente');
});

// ── le categorie in piu' non inventano soglie ──────────────────────────────────────────────────────────────────────
test('le categorie aggiunte (Cat3, Cat5, Cat7A, OS1, OM1, OM2) non fanno scattare regole di velocita\' o di portata: senza una cifra di norma si tace', () => {
  const regole = (l) => validateCable(l).map((i) => i.code).filter((c) => ['speed-cat', 'cat-reach', 'fiber-reach'].includes(c));
  for (const cat of ['Cat3', 'Cat5', 'Cat7A']) assert.deepEqual(regole({ medium: 'copper', cableCategory: cat, maxSpeed: '40G', length: 90 }), [], cat);
  for (const cat of ['OS1', 'OM1', 'OM2']) assert.deepEqual(regole({ medium: 'fiber', cableCategory: cat, maxSpeed: '100G', length: 5000 }), [], cat);
  // ...mentre le cinque di prima continuano a parlare
  assert.deepEqual(regole({ medium: 'copper', cableCategory: 'Cat5e', maxSpeed: '10G', length: 90 }), ['speed-cat']);
  assert.deepEqual(regole({ medium: 'fiber', cableCategory: 'OM3', maxSpeed: '40G', length: 300 }), ['fiber-reach']);
});
