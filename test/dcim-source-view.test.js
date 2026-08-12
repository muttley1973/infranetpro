const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE_FIELDS, sourceRows, hasSource, sourceCoverage } = require('../lib/dcim-source-view.js');

test('mostra solo i campi che il DCIM ha davvero dichiarato', () => {
  const n = { source: { tenant: 'Dunder-Mifflin, Inc.', status: 'active' } };
  const rows = sourceRows(n);
  assert.deepEqual(rows.map(r => r.key), ['tenant', 'status']);
  assert.equal(rows[0].value, 'Dunder-Mifflin, Inc.');
});

test('un campo assente NON produce una riga col trattino', () => {
  // L'assenza si mostra tacendo: un vuoto stampato si legge come un dato.
  const rows = sourceRows({ source: { tenant: '', status: null, roleSlug: '   ' } });
  assert.deepEqual(rows, []);
  assert.equal(hasSource({ source: { tenant: '' } }), false);
});

test('gli slug tecnici restano fuori dalla vista', () => {
  // deviceTypeSlug/manufacturerSlug/catalogMatch servono a ri-agganciare il
  // catalogo, non a farsi leggere da una persona.
  const n = { source: { deviceTypeSlug: 'c9300-48p', manufacturerSlug: 'cisco', catalogMatch: 'manual-override' } };
  assert.deepEqual(sourceRows(n), []);
  const keys = SOURCE_FIELDS.map(f => f.key);
  assert.ok(!keys.includes('deviceTypeSlug') && !keys.includes('manufacturerSlug'));
});

test('nodo senza source: nessuna riga, nessun errore', () => {
  assert.deepEqual(sourceRows({}), []);
  assert.deepEqual(sourceRows(null), []);
  assert.deepEqual(sourceRows({ source: 'stringa' }), []);
  assert.equal(hasSource(null), false);
});

test('ordine di lettura umano: di chi è, com è dichiarato, che mestiere fa, che NOS monta', () => {
  const n = { source: { platformName: 'IOS-XE', roleSlug: 'access-switch', status: 'active', tenant: 'Acme' } };
  assert.deepEqual(sourceRows(n).map(r => r.key), ['tenant', 'status', 'roleSlug', 'platformName']);
});

test('copertura: quanti apparati portano una dichiarazione, per campo', () => {
  const nodes = [
    { source: { tenant: 'Acme', status: 'active' } },
    { source: { status: 'planned' } },
    { source: {} },
    null,
  ];
  const c = sourceCoverage(nodes);
  assert.equal(c.total, 3);       // il null non conta
  assert.equal(c.withAny, 2);
  assert.equal(c.tenant, 1);
  assert.equal(c.status, 2);
  assert.equal(c.roleSlug, 0);
});
