'use strict';
// Smoke test dei renderer PDF del Dossier di consegna (server/pdf-report.js).
// Conta le pagine aggiunte via l'evento 'pageAdded' (pdfkit non espone il
// conteggio senza bufferPages). Skippa se pdfkit non è installato.
const test = require('node:test');
const assert = require('node:assert');

let PDFDocument, R;
try {
  R = require('../server/pdf-report');
  ({ PDFDocument } = R._loadPdfDeps());
} catch (_) { /* pdfkit assente: i test sotto vengono skippati */ }

const has = !!PDFDocument;

function countPages(fn) {
  const doc = new PDFDocument({ autoFirstPage: false });
  let pages = 0;
  doc.on('pageAdded', () => pages++);
  fn(doc);
  return pages;
}

test('copertina: aggiunge esattamente 1 pagina', { skip: !has }, () => {
  const p = countPages(doc => R._addCoverPage(doc, { title: 'Dossier', project: 'Rete X', date: '12/06/2026', user: 'mario', deviceCount: 2, cableCount: 3, vlanCount: 1 }));
  assert.equal(p, 1);
});

test('note: 0 pagine se vuote, >=1 se presenti', { skip: !has }, () => {
  assert.equal(countPages(doc => R._addNotesPages(doc, [], 'P', 'd')), 0);
  assert.ok(countPages(doc => R._addNotesPages(doc, [{ label: 'Core-01', text: 'spegnere di notte' }], 'P', 'd')) >= 1);
});

test('changelog: 0 pagine se vuoto, >=1 se presente', { skip: !has }, () => {
  assert.equal(countPages(doc => R._addChangelogPages(doc, [], 'P', 'd')), 0);
  const log = [{ ts: '2026-06-12T08:30:00Z', user: 'mario', action: 'device-add', target: 'Core-01', summary: 'switch' }];
  assert.ok(countPages(doc => R._addChangelogPages(doc, log, 'P', 'd')) >= 1);
});

test('porte libere: 0 pagine se vuoto, >=1 se presente', { skip: !has }, () => {
  assert.equal(countPages(doc => R._addSparePages(doc, { totals: {}, racks: [], unracked: [] }, 'P', 'd')), 0);
  const spare = {
    totals: { ports: 50, free: 45, freeAccess: 45, freeSfp: 0, suspect: 2, used: 5, devices: 2 },
    racks: [{ name: 'Armadio 1', totals: { free: 45 }, devices: [
      { name: 'SW-1', total: 48, used: 3, free: 45, freeAccess: 45, freeSfp: 0, suspect: 2 },
    ] }],
    unracked: [],
  };
  assert.ok(countPages(doc => R._addSparePages(doc, spare, 'P', 'd')) >= 1);
});
