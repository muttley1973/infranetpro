'use strict';
// Un nome di host che una persona ha scelto non e' un blob, anche se e' fatto di lettere a-f e cifre.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isJunkHostName } = require('../lib/host-name.js');

test('i nomi veri fatti di sillabe esadecimali restano nomi (era: scartati e sostituiti dall\'IP)', () => {
  for (const nome of ['dc-01', 'db-01', 'ad-02', 'fe-01', 'ac-1a', 'bd-12', 'ca-fe', 'dead-beef', 'cafe-babe', 'ab-cd-ef-12', 'fa-de-ca-fe']) {
    assert.equal(isJunkHostName(nome), false, nome);
  }
});

test('UUID, MAC con i trattini e blob lunghi sono blob', () => {
  for (const blob of ['5f2a9c1e-0b3d-4c8e-9a41-7d6e2b1f3a90', 'aa-bb-cc-dd-ee-ff', 'AA-BB-CC-DD-EE-FF', '00-11-22-33-44-55',
                      'aabbccddeeff', '0123456789abcdef0123', '5f2a9c1e-0b3d-4c8e-9a41-7d6e2b1f3a90.local']) {
    assert.equal(isJunkHostName(blob), true, blob);
  }
});

test('hostname auto-generato dal device (codice + seriale esadecimale) resta scartato', () => {
  for (const blob of ['HPF4390962F234', 'BRW008077123456', 'esp32f4390962f234']) assert.equal(isJunkHostName(blob), true, blob);
});

test('modelli e nomi con parole restano nomi', () => {
  for (const nome of ['GS1900', 'DESKTOP-ABC123', 'sw-core-01', 'Synology.local', 'RLC-810A', 'srv-dc-01', 'nas01']) {
    assert.equal(isJunkHostName(nome), false, nome);
  }
});

test('vuoto, spazi e tipi sbagliati sono «nessun nome»', () => {
  for (const v of ['', '  ', null, undefined, '.local', '.']) assert.equal(isJunkHostName(v), true, JSON.stringify(v));
  assert.doesNotThrow(() => isJunkHostName({}));
  assert.doesNotThrow(() => isJunkHostName(12345));
});
