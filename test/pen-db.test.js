'use strict';
// Pipeline PEN (Private Enterprise Numbers): il parser del registro IANA
// (scripts/update-pen-db.js) + il fallback in _vendorByObjectId (server/classify.js).
// E' il gemello SNMP del database OUI IEEE: la tabella curata PEN_VENDOR vince per i
// nomi corti, l'intero registro IANA copre tutti gli altri vendor senza toccare il
// codice. Vendor-neutral (paletto 3): chiude il buco "manca il vendor X".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseIana } = require('../scripts/update-pen-db.js');
const { _vendorByObjectId } = require('../server/classify.js');

// Estratto realistico del file IANA enterprise-numbers (numero a colonna 0, org
// indentata di 2 spazi, poi contatto ed email indentati).
const SAMPLE = [
  'PRIVATE ENTERPRISE NUMBERS',
  '',
  '(last updated 2026-07-04)',
  '',
  'Decimal',
  '|',
  'Organization',
  '|    Contact',
  '|    |    Email',
  '',
  '0',
  '  Reserved',
  '    Internet Assigned Numbers Authority',
  '      iana&iana.org',
  '9',
  '  ciscoSystems',
  '    Cisco Systems',
  '      info&cisco.com',
  '30065',
  "  Arista Networks, Inc. (formerly 'Arastra, Inc.')",
  '    Ken Duda',
  '      support&arista.com',
  '55555',
  '  ---none---',
  '    ',
  '      ',
].join('\n');

test('parseIana: mappa numero->organizzazione, salta legenda e placeholder', () => {
  const e = parseIana(SAMPLE);
  assert.equal(e['0'], 'Reserved');
  assert.equal(e['9'], 'ciscoSystems');
  assert.match(e['30065'], /^Arista Networks, Inc\./);
  assert.equal(e['55555'], undefined, '---none--- (non assegnato) -> saltato');
  assert.equal(e['Organization'], undefined, 'la legenda non e\' una voce');
  // Solo i numeri a colonna 0 sono PEN: contatti/email/indentati non lo sono.
  assert.equal(Object.keys(e).length, 3);
});

test('parseIana: input vuoto/garbage -> oggetto vuoto', () => {
  assert.deepEqual(parseIana(''), {});
  assert.deepEqual(parseIana(null), {});
  assert.deepEqual(parseIana('nessun numero qui\n  solo testo'), {});
});

test('_vendorByObjectId: curato vince, poi fallback al registro IANA completo', () => {
  // Curato (nome corto) — vince sul grezzo IANA "ciscoSystems"/"Arista Networks, Inc.".
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.9.1.516'), 'Cisco');
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.30065.1.3011'), 'Arista');
  // PEN sconosciuto -> vuoto.
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.99999.1'), '');

  // Fallback al DB completo: vendor NON curati che prima uscivano vuoti. Guardato
  // sull'esistenza del file generato (npm run update-pen), presente nel repo.
  const dbPath = path.resolve(__dirname, '..', 'data', 'pen-db.json');
  if (fs.existsSync(dbPath)) {
    assert.match(_vendorByObjectId('1.3.6.1.4.1.11129.1.2'), /Google/, 'Google via registro IANA');
    assert.match(_vendorByObjectId('1.3.6.1.4.1.41263.1'), /Nutanix/, 'Nutanix via registro IANA');
  }
});
