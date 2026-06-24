// Smoke test del renderer PDF etichette (server/label-sheet.js).
// Genera un PDF in buffer e verifica magic %PDF + n. pagine attese.
const test   = require('node:test');
const assert = require('node:assert/strict');

let PDFDocument;
try { PDFDocument = require('pdfkit'); }
catch { /* pdfkit assente: i test sotto si skippano */ }

const { addLabelPages, TEMPLATES, _resolveTemplate, _normFields } = require('../server/label-sheet.js');

function mkRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'l' + i, label: 'RUN-' + i,
    from: 'Core-01 P' + (i + 1), to: 'PP-01 P' + (i + 1),
    color: '#0066cc', lengthM: 12.5, cableType: 'cat6a-ftp',
    vlan: 10, vlanName: 'Voce', isPermanent: true, notes: '',
  }));
}

// Renderizza e ritorna { buffer, pages } in modo asincrono.
function render(rows, opts) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, autoFirstPage: false });
    const chunks = [];
    let pages = 0;
    doc.on('pageAdded', () => { pages++; });
    doc.on('data', c => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages }));
    addLabelPages(doc, rows, opts);
    doc.end();
  });
}

test('_resolveTemplate: default su template ignoto, override generic-grid', () => {
  assert.equal(_resolveTemplate('xyz'), TEMPLATES['avery-l7651']);
  const g = _resolveTemplate('generic-grid', { cols: 2, rows: 5, labelW: 60 });
  assert.equal(g.cols, 2);
  assert.equal(g.rows, 5);
  assert.equal(g.labelW, 60);
  // valori non passati restano dal base
  assert.equal(g.labelH, TEMPLATES['generic-grid'].labelH);
});

test('_resolveTemplate: ignora override non validi', () => {
  const g = _resolveTemplate('generic-grid', { cols: -3, rows: 'abc' });
  assert.equal(g.cols, TEMPLATES['generic-grid'].cols);
  assert.equal(g.rows, TEMPLATES['generic-grid'].rows);
});

test('_normFields: opts.fields ha priorita, filtra ignoti', () => {
  const s = _normFields({ fields: ['label', 'vlan', 'inesistente'] });
  assert.ok(s.has('label') && s.has('vlan'));
  assert.ok(!s.has('inesistente'));
  assert.equal(s.size, 2);
});

test('_normFields: fallback dal preset detail quando fields assente', () => {
  assert.deepEqual([..._normFields({ detail: 'idOnly' })], ['label']);
  const ft = _normFields({ detail: 'idFromTo' });
  assert.ok(ft.has('label') && ft.has('da') && ft.has('a'));
});

test('_normFields: vuoto → almeno "label"', () => {
  assert.deepEqual([..._normFields({ fields: [] })], ['label']);
  assert.deepEqual([..._normFields({})], [...require('../server/label-sheet.js')._normFields({ detail: 'idFromTo' })]);
});

test('PDF con fields espliciti: genera PDF valido', { skip: !PDFDocument }, async () => {
  const r = await render(mkRows(2), { template: 'avery-l7651', fields: ['label', 'vlan', 'lunghezza', 'colore'] });
  assert.equal(r.buffer.subarray(0, 4).toString('latin1'), '%PDF');
  assert.equal(r.pages, 1);
});

test('PDF Avery L7651: 65/foglio → ceil(N/65) pagine', { skip: !PDFDocument }, async () => {
  const r1 = await render(mkRows(10), { template: 'avery-l7651', detail: 'idFromTo' });
  assert.ok(r1.buffer.subarray(0, 4).toString('latin1') === '%PDF', 'magic %PDF');
  assert.equal(r1.pages, 1);

  const r2 = await render(mkRows(70), { template: 'avery-l7651' });
  assert.equal(r2.pages, 2);  // 70 > 65
});

test('PDF Dymo roll: 1 etichetta = 1 pagina', { skip: !PDFDocument }, async () => {
  const r = await render(mkRows(5), { template: 'dymo-99010', detail: 'idOnly' });
  assert.equal(r.pages, 5);
});

test('PDF wrap + full detail: genera comunque un PDF valido', { skip: !PDFDocument }, async () => {
  const r = await render(mkRows(3), { template: 'avery-22806', detail: 'full', wrap: true });
  assert.equal(r.buffer.subarray(0, 4).toString('latin1'), '%PDF');
  assert.equal(r.pages, 1);  // 3 ≤ 12/foglio
});

test('PDF generic-grid con override: rispetta cols/rows nel conteggio pagine', { skip: !PDFDocument }, async () => {
  // 2x2 = 4/pagina, 9 righe → 3 pagine
  const r = await render(mkRows(9), { template: 'generic-grid', grid: { cols: 2, rows: 2 } });
  assert.equal(r.pages, 3);
});
