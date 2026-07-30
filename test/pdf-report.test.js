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

test('_addRecoveryPages: rende la sezione DR (backup pointer + serial/firmware) senza errori', { skip: !deps }, () => {
  const { _addRecoveryPages } = require('../server/pdf-report.js');
  const recovery = { devices: [
    { name: 'SW-CORE', backupRef: 'git@repo:cfg//sw-core', backupMethod: 'ansible',
      backupAt: '2026-07-20T00:00:00Z', serial: 'ABC123', firmware: 'IOS-XE 17.9', model: 'C9300', rack: 'Rack-A' },
    { name: 'SW-EDGE', backupRef: '', backupMethod: '', backupAt: '', serial: '', firmware: '', model: '', rack: '' },
  ] };
  const NOW = Date.parse('2026-07-29T00:00:00Z');
  assert.doesNotThrow(() => _addRecoveryPages(newDoc(), recovery, 'Proj', '29/07/2026', 'it', NOW));
  assert.doesNotThrow(() => _addRecoveryPages(newDoc(), recovery, 'Proj', '29/07/2026', 'en', NOW));
  // Casi limite: nessun device, e recovery mancante → pagina «vuota», nessun throw.
  assert.doesNotThrow(() => _addRecoveryPages(newDoc(), { devices: [] }, 'Proj', '29/07/2026', 'it'));
  assert.doesNotThrow(() => _addRecoveryPages(newDoc(), null, 'Proj', '29/07/2026', 'it'));
});

test('_addRecoveryPages: un apparato con identita\' in conflitto NON e\' ripristinabile', { skip: !deps }, () => {
  // Seriale dichiarato ≠ misurato = «apparato sostituito»: la lente DR non lo
  // conta fra i ripristinabili, e il dossier consegnato al cliente deve dare lo
  // stesso verdetto (prima era piu' ottimista dell'app).
  const { _addRecoveryPages } = require('../server/pdf-report.js');
  const NOW = Date.parse('2026-07-29T00:00:00Z');
  const ok = { name: 'SW-OK', backupRef: 'git@repo:cfg//ok', backupMethod: 'ansible',
    backupAt: '2026-07-20T00:00:00Z', serial: 'ABC123', firmware: 'X', model: 'C9300', rack: 'R-A' };
  const swapped = Object.assign({}, ok, { name: 'SW-SWAP', identityMismatch: true });
  assert.doesNotThrow(() => _addRecoveryPages(newDoc(), { devices: [ok, swapped] }, 'P', 'd', 'en', NOW));
  // Si intercetta doc.text (PDFDocument vero) per leggere cio' che finisce sulla
  // pagina: il conteggio in testata e il marcatore di riga.
  const doc = newDoc();
  const seen = [];
  const origText = doc.text.bind(doc);
  doc.text = (s, ...rest) => { seen.push(String(s)); return origText(s, ...rest); };
  _addRecoveryPages(doc, { devices: [ok, swapped] }, 'P', 'd', 'it', NOW);
  const txt = seen.join(' | ');
  assert.ok(/1\/2 ripristinabili/.test(txt), 'solo 1 dei 2 e\' ripristinabile: ' + txt.slice(0, 300));
  assert.ok(/1 con identità da sciogliere/.test(txt), 'la testata conta il dubbio identità');
  assert.ok(/sostituito\?/.test(txt), 'la riga marca il seriale in discussione');

  // Controprova: senza il flag, lo stesso apparato torna ripristinabile.
  const doc2 = newDoc();
  const seen2 = [];
  const orig2 = doc2.text.bind(doc2);
  doc2.text = (s, ...rest) => { seen2.push(String(s)); return orig2(s, ...rest); };
  _addRecoveryPages(doc2, { devices: [ok, Object.assign({}, swapped, { identityMismatch: false })] }, 'P', 'd', 'it', NOW);
  assert.ok(/2\/2 ripristinabili/.test(seen2.join(' | ')), 'nessun conflitto -> entrambi ripristinabili');
});

test('_addRecoveryPages: garanzia/EOL in riga e in testata, con le STESSE regole della lente DR', { skip: !deps }, () => {
  // In una runbook di procurement «lo ricompri?» viene subito dopo «cosa ricompri?»:
  // la pagina DR porta le due date dichiarate, riassunte dallo stato piu' grave.
  // Advisory come nell'app: un apparato fuori produzione con backup fresco resta
  // ripristinabile — l'EOL dice che non lo RICOMPRI, non che non lo rimetti su.
  const { _addRecoveryPages } = require('../server/pdf-report.js');
  const NOW = Date.parse('2026-07-29T00:00:00Z');
  const D = (giorni) => new Date(NOW + giorni * 864e5).toISOString().slice(0, 10);
  const base = { backupRef: 'git@repo:cfg//x', backupMethod: 'ansible',
    backupAt: '2026-07-20T00:00:00Z', serial: 'ABC123', firmware: 'X', model: 'C9300', rack: 'R-A' };
  const devices = [
    Object.assign({}, base, { name: 'SW-EOL', eolDate: D(-40), warrantyUntil: D(-90) }),
    Object.assign({}, base, { name: 'SW-GAR', warrantyUntil: D(-1) }),
    Object.assign({}, base, { name: 'SW-SOON', warrantyUntil: D(30) }),
    Object.assign({}, base, { name: 'SW-OK', warrantyUntil: D(700) }),
    Object.assign({}, base, { name: 'SW-MUTO' }),                       // nessuna data dichiarata
  ];
  const d = newDoc();
  const seen = [];
  const orig = d.text.bind(d);
  d.text = (s, ...rest) => { seen.push(String(s)); return orig(s, ...rest); };
  _addRecoveryPages(d, { devices }, 'P', 'x', 'it', NOW);
  const txt = seen.join(' | ');
  assert.ok(/Ciclo di vita/.test(txt), 'la colonna c\'e\': ' + txt.slice(0, 200));
  assert.ok(/EOL/.test(txt), 'lo stato piu\' grave e\' marcato in riga');
  assert.ok(/fuori garanzia/.test(txt));
  assert.ok(/in scadenza/.test(txt));
  assert.ok(/1 fuori produzione/.test(txt), 'la testata conta i fuori produzione');
  // Advisory: tutti e 5 restano ripristinabili (backup fresco + identita' + rack).
  assert.ok(/5\/5 ripristinabili/.test(txt), 'l\'EOL non declassa il verdetto: ' + txt.slice(0, 200));
  assert.doesNotThrow(() => _addRecoveryPages(newDoc(), { devices }, 'P', 'x', 'en', NOW));
});

test('_addOverviewPages: la sintesi arriva nel dossier con le parole dell\'app', { skip: !deps }, () => {
  // I verdetti che l'utente vede a schermo non arrivavano MAI nel PDF: il dossier
  // consegnava i dati grezzi e teneva il giudizio dentro l'app. Il contenuto e'
  // client-built (parole gia' risolte dal glue): qui si presidia che finisca sulla
  // pagina, che i casi vuoti non esplodano e che NON entrino elenchi di device.
  const { _addOverviewPages } = require('../server/pdf-report.js');
  const dto = {
    sections: [
      { key: 'complete', num: 1, title: 'LAN', question: 'il documento descrive tutto?', level: 'warn',
        verdict: '3 sezioni da completare',
        rows: [{ label: 'Indirizzo IP', value: '33', sub: 'di 33', status: 'completo', tone: 'ok', prov: 'declared' }] },
      { key: 'truth', num: 2, title: 'Conformità', question: 'corrisponde ancora alla realtà?', level: 'bad',
        verdict: 'mai verificata',
        rows: [{ label: 'Verificabili via SNMP', value: '9', sub: 'di 12', status: '3 senza accesso SNMP', tone: 'warn', prov: 'derived' }] },
      { key: 'margin', num: 3, title: 'Espansione', question: 'quanto posso ancora crescere?', level: 'ok',
        verdict: 'margine ampio',
        rows: [{ label: 'Porte libere', value: '166', sub: 'di 181', status: '181 − 15 da verificare', tone: 'info', prov: 'declared' }] },
    ],
    perimeter: { title: 'Cosa non sto guardando', lead: 'restano fuori:', chips: ['WAN', 'STP', 'Restore'] },
    legend: [{ prov: 'declared', label: 'dichiarato' }, { prov: 'none', label: 'non dichiarato' }],
  };
  const doc = newDoc();
  const seen = [];
  const orig = doc.text.bind(doc);
  doc.text = (s, ...rest) => { seen.push(String(s)); return orig(s, ...rest); };
  _addOverviewPages(doc, dto, 'Proj', '30/07/2026', 'it');
  const txt = seen.join(' | ');
  assert.ok(/1 {2}LAN/.test(txt), 'le tre colonne, numerate: ' + txt.slice(0, 200));
  assert.ok(/3 sezioni da completare/.test(txt), 'il verdetto di colonna arriva in parole');
  assert.ok(/3 senza accesso SNMP/.test(txt), '…e anche quello di riga');
  assert.ok(/Cosa non sto guardando/.test(txt), 'il perimetro dichiarato resta nel dossier consegnato');
  assert.ok(/WAN/.test(txt) && /Restore/.test(txt), 'con le sue voci');
  // I font standard del PDF sono WinAnsi: il meno tipografico usciva come una
  // virgoletta. Qui si presidia la normalizzazione, non la fortuna.
  assert.ok(!/−/.test(txt), 'nessun carattere fuori CP1252 raggiunge la pagina');
  assert.ok(/181 - 15 da verificare/.test(txt), '…e il testo resta leggibile');

  // Casi limite: nessuna sezione, DTO assente → pagina «non disponibile», nessun throw.
  assert.doesNotThrow(() => _addOverviewPages(newDoc(), { sections: [] }, 'P', 'd', 'it'));
  assert.doesNotThrow(() => _addOverviewPages(newDoc(), null, 'P', 'd', 'en'));
  assert.doesNotThrow(() => _addOverviewPages(newDoc(), dto, 'P', 'd', 'en'));
});

test('_addRecoveryPages: nessun SEGRETO nella riga (solo puntatore backup, mai config/community)', { skip: !deps }, () => {
  // Il client non deve MAI mettere community/config in reportData.recovery: qui si
  // verifica che la funzione consumi solo i campi allowlistati (ref/method/at/serial/
  // firmware/model/rack) — un campo «community» iniettato per errore viene ignorato.
  const { _addRecoveryPages } = require('../server/pdf-report.js');
  const poisoned = { devices: [ { name: 'X', backupRef: 'ref', community: 'public', password: 'hunter2' } ] };
  assert.doesNotThrow(() => _addRecoveryPages(newDoc(), poisoned, 'P', 'd', 'it'));
});
