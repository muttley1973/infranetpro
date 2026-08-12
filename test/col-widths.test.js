'use strict';
// Regole delle larghezze di colonna trascinabili (lib/col-widths.js).
const test = require('node:test');
const assert = require('node:assert');
const {
  COL_MIN_PX, COL_MAX_PX,
  clampColWidth, resizedWidth, colVarName, tableMinWidth,
  parseColWidths, serializeColWidths,
} = require('../lib/col-widths.js');

test('clamp: dentro i limiti, arrotondato al pixel', () => {
  assert.equal(clampColWidth(120.4), 120);
  assert.equal(clampColWidth(120.6), 121);
  assert.equal(clampColWidth(5), COL_MIN_PX, 'sotto il minimo → minimo');
  assert.equal(clampColWidth(9999), COL_MAX_PX, 'sopra il massimo → massimo');
  assert.equal(clampColWidth('non-un-numero'), COL_MIN_PX);
  assert.equal(clampColWidth(200, { min: 100, max: 150 }), 150, 'limiti su misura');
});

test('⚠️ trascinare a sinistra oltre il minimo non produce colonne invisibili', () => {
  assert.equal(resizedWidth(120, 40), 160);
  assert.equal(resizedWidth(120, -40), 80);
  assert.equal(resizedWidth(120, -500), COL_MIN_PX, 'il puntatore va oltre, la colonna no');
  assert.equal(resizedWidth(120, 5000), COL_MAX_PX);
});

test('il nome della variabile CSS è deciso in un posto solo', () => {
  assert.equal(colVarName(5, 'disc-col'), '--disc-col-5');
  assert.equal(colVarName('5', 'disc-col'), '--disc-col-5');
  assert.equal(colVarName(2), '--col-2');
});

// La larghezza minima della tabella è ciò che accende lo scorrimento
// orizzontale: se non tenesse conto delle colonne allargate, allargarle
// stringerebbe solo la colonna elastica invece di far scorrere.
test('la larghezza minima somma i valori correnti, non i default', () => {
  const DEF = { 1: 34, 2: 80, 4: 112 };
  assert.equal(tableMinWidth(DEF, {}, 200), 34 + 80 + 112 + 200);
  assert.equal(tableMinWidth(DEF, { 4: 300 }, 200), 34 + 80 + 300 + 200, 'la colonna allargata pesa');
  assert.equal(tableMinWidth(DEF, null, 0), 226);
  assert.equal(tableMinWidth(null, null, 200), 200, 'senza colonne resta il pavimento');
});

test('lettura difensiva: una preferenza illeggibile non blocca la tabella', () => {
  assert.deepEqual(parseColWidths('{ non è json'), {});
  assert.deepEqual(parseColWidths(null), {});
  assert.deepEqual(parseColWidths([1, 2, 3]), {}, 'un array non è una mappa di colonne');
  assert.deepEqual(parseColWidths({ 2: 90, nome: 120, 3: 'larga', 4: null }), { 2: 90 },
    'chiavi e valori non numerici si scartano in silenzio');
  assert.deepEqual(parseColWidths({ 2: 4, 5: 99999 }), { 2: COL_MIN_PX, 5: COL_MAX_PX },
    'anche ciò che arriva dallo storage passa dai limiti');
});

test('round-trip: quello che si scrive si rilegge identico', () => {
  const w = { 2: 90, 5: 180, 6: 140 };
  assert.deepEqual(parseColWidths(serializeColWidths(w)), w);
  assert.equal(serializeColWidths({ 2: 90, spazzatura: 'x' }), '{"2":90}');
});
