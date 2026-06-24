// Test per l'abbreviazione PURA dei nomi device (lib/name-abbrev.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { abbreviateName } = require('../lib/name-abbrev.js');

test('abbreviateName: sostituisce la parola-tipo iniziale con la sigla', () => {
  assert.equal(abbreviateName('PRINTER-D01'), 'PRN-D01');
  assert.equal(abbreviateName('PROJECTOR-D02'), 'PRJ-D02');
  assert.equal(abbreviateName('BADGEREADER-P01'), 'BDG-P01');
  assert.equal(abbreviateName('VOIP-D05'), 'TEL-D05');
  assert.equal(abbreviateName('ROUTER-CORE'), 'RTR-CORE');
  assert.equal(abbreviateName('Switch01'), 'SW01');           // case-insensitive, senza separatore
});

test('abbreviateName: lascia invariati nomi corti o non-tipo', () => {
  assert.equal(abbreviateName('AP-01'), 'AP-01');             // già corto, non in mappa
  assert.equal(abbreviateName('PC-P01'), 'PC-P01');
  assert.equal(abbreviateName('TV-D01'), 'TV-D01');
  assert.equal(abbreviateName('ACC-SW-P2'), 'ACC-SW-P2');     // ACC non è un tipo
  assert.equal(abbreviateName('Stampante Ufficio'), 'Stampante Ufficio'); // parola libera
});

test('abbreviateName: robusto su input vuoto/nullo', () => {
  assert.equal(abbreviateName(''), '');
  assert.equal(abbreviateName(null), '');
  assert.equal(abbreviateName(undefined), '');
});
