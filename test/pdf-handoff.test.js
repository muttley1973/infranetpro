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

// Estrae il testo mostrato da un PDF pdfkit: decomprime gli stream FlateDecode e
// concatena i letterali "(..)" + le stringhe esadecimali <..> degli array TJ,
// ignorando i numeri di kerning. Prova che il testo (tradotto) ESCE nel PDF.
const zlib = require('node:zlib');
function pdfText(fn) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  fn(doc);
  return new Promise(res => {
    doc.on('end', () => {
      const raw = Buffer.concat(chunks).toString('latin1');
      let streams = '';
      const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m;
      while ((m = re.exec(raw))) { try { streams += '\n' + zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (_) {} }
      let words = '';
      const tok = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]*)>/g; let t;
      while ((t = tok.exec(streams))) {
        if (t[1] != null) words += t[1].replace(/\\([()\\])/g, '$1');
        else if (t[2] != null) { const h = t[2].replace(/\s+/g, ''); if (h.length && h.length % 2 === 0) words += Buffer.from(h, 'hex').toString('latin1'); }
      }
      res(words);
    });
    doc.end();
  });
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

test('registro asset: >=1 pagina con device, non lancia se vuoto', { skip: !has }, () => {
  // Vuoto: aggiunge comunque la pagina (sezione richiesta esplicitamente) senza lanciare.
  assert.ok(countPages(doc => R._addAssetRegisterPages(doc, [], 'P', 'd', null)) >= 1);
  // Con device (DTO nodeToDevice) + "ultima revisione": almeno una pagina.
  const assets = [
    { id: 'sw1', name: 'CORE-SW', type: 'switch', brand: 'Cisco', model: 'C9300', serial: 'FCW1234', ip: '10.0.0.1', mac: 'AA:BB:CC:00:11:22', vlan: 10, rack: { id: 'r1', name: 'Armadio 1', u: 42 } },
    { id: 'ap1', name: 'AP-Lobby', type: 'ap', brand: null, model: null, serial: null, ip: '10.0.30.5', mac: null, vlan: 30, rack: null },
  ];
  assert.ok(countPages(doc => R._addAssetRegisterPages(doc, assets, 'Rete X', '05/07/2026', '2026-07-05T09:30:00Z')) >= 1);
});

test('copertina: "Ultima revisione" (project.updated_at) mostrata solo se presente', { skip: !has }, () => {
  // Con lastRevised → sempre 1 pagina (la riga meta e' additiva, non cambia il conteggio pagine).
  assert.equal(countPages(doc => R._addCoverPage(doc, { title: 'Dossier', project: 'Rete X', date: '05/07/2026', user: 'mario', lastRevised: '2026-07-05T09:30:00Z', deviceCount: 2, cableCount: 3, vlanCount: 1 })), 1);
  // _fmtRevised: ISO → stringa non vuota; null/'' → '' (nessuna riga).
  assert.ok(R._fmtRevised('2026-07-05T09:30:00Z').length > 0);
  assert.equal(R._fmtRevised(null), '');
  assert.equal(R._fmtRevised(''), '');
});

test('_rt: EN + fallback IT su lingua ignota + chiave sconosciuta', { skip: !has }, () => {
  assert.equal(R._rt('en', 'title.assets'), 'Asset register');
  assert.equal(R._rt('it', 'title.assets'), 'Registro asset');
  assert.equal(R._rt('en', 'title.floorplan'), 'Floor plan');   // header pagina planimetria (route)
  assert.equal(R._rt('it', 'title.floorplan'), 'Planimetria');
  assert.equal(R._rt('xx', 'title.assets'), 'Registro asset');       // lingua ignota → it
  assert.equal(R._rt('en', 'chiave.inesistente'), 'chiave.inesistente'); // key passthrough
});

test('report EN: il testo tradotto ESCE davvero nel PDF (registro + copertina); IT invariato', { skip: !has }, async () => {
  const assets = [{ id: 'sw1', name: 'CORE-SW', type: 'switch', brand: 'Cisco', model: 'C9300', serial: 'FCW1', ip: '10.0.0.1', mac: 'AA:BB', vlan: 10, rack: { id: 'r1', name: 'Rack 1', u: 42 } }];
  const en = await pdfText(doc => R._addAssetRegisterPages(doc, assets, 'Net', '05/07/2026', '2026-07-05T09:30:00Z', 'en'));
  assert.ok(en.includes('Asset register'), 'titolo EN');
  assert.ok(en.includes('Device') && en.includes('Serial') && en.includes('Document last revised'), 'colonne/sottotitolo EN');
  const it = await pdfText(doc => R._addAssetRegisterPages(doc, assets, 'Net', '05/07/2026', '2026-07-05T09:30:00Z', 'it'));
  assert.ok(it.includes('Registro asset') && it.includes('Dispositivo'), 'IT invariato (default)');

  const coverEn = await pdfText(doc => R._addCoverPage(doc, { project: 'Net', date: '05/07/2026', user: 'a', lastRevised: '2026-07-05T09:30:00Z', deviceCount: 1, cableCount: 0, vlanCount: 1 }, 'en'));
  assert.ok(coverEn.includes('Handover dossier') && coverEn.includes('Last revised') && coverEn.includes('Generated with InfraNet Pro'), 'copertina EN');
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
