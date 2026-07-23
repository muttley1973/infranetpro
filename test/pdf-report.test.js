// Test per il fitting del testo nelle tabelle del report PDF (server/pdf-report.js).
// Regressione: le colonne Etichetta/Da/A si sovrapponevano perche' la larghezza era
// STIMATA (fontSize*0.5/char) e sottostimava i nomi in maiuscolo -> testo fuori colonna.
// Ora si misura con doc.widthOfString: questi test lo garantiscono.
const test   = require('node:test');
const assert = require('node:assert/strict');

let deps;
try { deps = require('../server/pdf-report.js')._loadPdfDeps(); }
catch { /* pdfkit non installato: salto sotto */ }

const { _fit, _wrapFit, _addReportPages, _assetDeviceLabel } = require('../server/pdf-report.js');

function newDoc() {
  const doc = new deps.PDFDocument({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  doc.font('Helvetica');
  return doc;
}

test('_fit: tronca cosi che la larghezza REALE stia nella colonna', { skip: !deps }, () => {
  const doc = newDoc();
  const W = 60;
  const out = _fit(doc, 'CORE-SW-2 (MLAG) P1 -> DIST-SW-1 P10 MAIUSCOLE', W, 7);
  doc.fontSize(7);
  assert.ok(doc.widthOfString(out) <= W, 'entra nella colonna, largh=' + doc.widthOfString(out));
  assert.ok(out.endsWith('...'), 'troncato con ellissi');
  assert.equal(_fit(doc, 'P1', W, 7), 'P1');   // corta -> invariata
});

test('_fit: ripristina il fontSize del chiamante', { skip: !deps }, () => {
  const doc = newDoc();
  doc.fontSize(11);
  _fit(doc, 'X'.repeat(80), 40, 6);
  assert.equal(doc._fontSize, 11);
});

test('_wrapFit: ogni riga entra nella larghezza; preferisce gli spazi', { skip: !deps }, () => {
  const doc = newDoc();
  const W = 75;
  const lines = _wrapFit(doc, 'CORE-SW-2 (MLAG) P1', W, 7);
  doc.fontSize(7);
  assert.ok(lines.length >= 1);
  lines.forEach(l => assert.ok(doc.widthOfString(l) <= W, 'riga "' + l + '" largh=' + doc.widthOfString(l)));
});

test('_wrapFit: spezza un token senza spazi piu lungo della colonna', { skip: !deps }, () => {
  const doc = newDoc();
  const W = 40;
  const lines = _wrapFit(doc, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', W, 7);
  doc.fontSize(7);
  assert.ok(lines.length > 1, 'spezzato su piu righe');
  lines.forEach(l => assert.ok(doc.widthOfString(l) <= W));
});

test('report inventario: etichette lunghe -> render senza eccezioni, PDF non vuoto', { skip: !deps }, async () => {
  const doc = newDoc();
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(res => doc.on('end', res));

  const report = {
    cables: [
      { label: 'CORE-SW-1 -> CORE-SW-2 (MLAG) P1', from: 'CORE-SW-1 (MLAG) P1', to: 'CORE-SW-2 (MLAG) P1', vlan: '99', vlanName: 'Native', medium: 'DAC', length: '1m', category: 'Cat6a' },
      { label: 'ACC-SW-1A P5 -> ACC-SW-1C (stack) P1', from: 'ACC-SW-1A P5', to: 'ACC-SW-1C (stack) P1', vlan: '99', vlanName: 'Native', medium: 'UTP', length: '3m', category: 'Cat6' },
      { label: 'FW-01 (HA active) P2 -> CORE-SW-1 (MLAG) P9', from: 'FW-01 (HA active) P2', to: 'CORE-SW-1 (MLAG) P9', vlan: '10', vlanName: 'Management', medium: 'DAC', length: '2m', category: 'Cat6a' },
    ],
  };
  const only = { includeInventory: true, includeAsBuilt: false, includeRacks: false, includePorts: false, includeVlans: false, includeTopology: false };
  _addReportPages(doc, report, 'TestProj', '2026-07-14', deps.SVGtoPDF, only, 'it');
  doc.end();
  await done;
  const buf = Buffer.concat(chunks);
  assert.ok(buf.length > 500, 'PDF prodotto (' + buf.length + ' byte)');
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
});

// ── Colonna «Dispositivo» del registro asset ─────────────────────────
// Quando lo Scopri non trova un hostname mette l'IP in `name`: ripeterlo in una
// colonna che chiede QUALE apparato sia, accanto a una colonna IP, non informa.
// Il DTO NON viene toccato: `name` resta contratto della REST API v1.
test('registro asset: senza nome documentato la colonna Dispositivo dice tipo+marca', () => {
  const d = { name: '192.168.1.101', ip: '192.168.1.101', type: 'iot', brand: 'Eaton' };
  assert.strictEqual(_assetDeviceLabel(d, 'it'), 'IoT-Eaton');
  assert.strictEqual(_assetDeviceLabel(d, 'en'), 'IoT-Eaton');
  assert.strictEqual(d.name, '192.168.1.101', 'il DTO non viene mutato');
});

test('registro asset: un nome vero resta intatto', () => {
  const d = { name: 'SW-CORE', ip: '10.10.30.1', type: 'switch', brand: 'Cisco' };
  assert.strictEqual(_assetDeviceLabel(d, 'it'), 'SW-CORE');
});

test('registro asset: il tipo segue la lingua del dossier', () => {
  const d = { name: '10.0.0.7', ip: '10.0.0.7', type: 'printer', brand: 'HP' };
  assert.strictEqual(_assetDeviceLabel(d, 'it'), 'Stampante-HP');
  assert.strictEqual(_assetDeviceLabel(d, 'en'), 'Printer-HP');
});

test('registro asset: senza tipo ne marca resta l indirizzo, mai vuoto', () => {
  assert.strictEqual(_assetDeviceLabel({ name: '10.0.0.9', ip: '10.0.0.9' }, 'it'), '10.0.0.9');
  assert.strictEqual(_assetDeviceLabel(null, 'it'), '');
});
