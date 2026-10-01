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

// Estrae il testo mostrato da un PDF pdfkit: taglia ogni stream con la LUNGHEZZA
// ESATTA del dizionario (/Length N) — NON indovinando il confine "endstream", che
// sui byte binari FlateDecode puo' comparire per caso e troncare l'estrazione — poi
// decomprime e concatena i letterali "(..)" + le esadecimali <..> degli array TJ
// (ignorando i numeri di kerning). Prova che il testo (tradotto) ESCE nel PDF.
const zlib = require('node:zlib');
function pdfText(fn) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  fn(doc);
  return new Promise(res => {
    doc.on('end', () => {
      const raw = Buffer.concat(chunks);
      const s = raw.toString('latin1');   // latin1 = 1 byte/char -> indice stringa == offset byte
      let words = '';
      const re = /\/Length (\d+)\b[^>]*>>\s*stream\r?\n/g; let m;
      while ((m = re.exec(s))) {
        const start = m.index + m[0].length;
        let body = raw.subarray(start, start + parseInt(m[1], 10));
        try { body = zlib.inflateSync(body); } catch (_) { /* non compresso: uso i byte grezzi */ }
        const txt = body.toString('latin1');
        const tok = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]*)>/g; let t;
        while ((t = tok.exec(txt))) {
          if (t[1] != null) words += t[1].replace(/\\([()\\])/g, '$1');
          else if (t[2] != null) { const h = t[2].replace(/\s+/g, ''); if (h.length && h.length % 2 === 0) words += Buffer.from(h, 'hex').toString('latin1'); }
        }
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

// La nota scritta a mano NON ha piu' un capitolo suo: esce sulla riga del suo
// apparato dentro il Registro asset. Un capitolo separato costringeva a reincrociare
// i nomi per capire di chi parlasse.
test('note: escono nel Registro asset, sulla riga del loro device', { skip: !has }, async () => {
  assert.equal(typeof R._addNotesPages, 'undefined', 'niente piu\' capitolo Note separato');
  const assets = [
    { id: 'sw1', name: 'CORE-SW', type: 'switch', brand: 'Cisco', model: 'C9300', serial: 'FCW1', ip: '10.0.0.1', mac: 'AA:BB', vlan: 10, rack: null, notes: 'spegnere di notte' },
    { id: 'ap1', name: 'AP-Lobby', type: 'ap', brand: null, model: null, serial: null, ip: null, mac: null, vlan: null, rack: null },
  ];
  const it = await pdfText(doc => R._addAssetRegisterPages(doc, assets, 'Net', '11/08/2026', null, 'it'));
  assert.ok(it.includes('spegnere di notte'), 'il testo della nota esce: ' + it.slice(0, 200));
  assert.ok(/1 con nota/.test(it), 'il sottotitolo conta solo i device che una nota ce l\'hanno');
  const en = await pdfText(doc => R._addAssetRegisterPages(doc, assets, 'Net', '11/08/2026', null, 'en'));
  assert.ok(en.includes('with a note') && en.includes('spegnere di notte'), 'EN tradotto');
  // Nessuna nota -> nessuna riga in piu' e nessun contatore inventato.
  const senza = await pdfText(doc => R._addAssetRegisterPages(doc, [assets[1]], 'Net', '11/08/2026', null, 'it'));
  assert.ok(!/con nota/.test(senza), 'senza note il sottotitolo tace');
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

// ── N11/N14: assente ≠ zero, anche sulla carta ─────────────────────────────
test('copertina: un contatore MAI fornito stampa un trattino, non uno zero a 22pt', { skip: !has }, async () => {
  // «0 Macchine virtuali» su un dato che nessuno ha passato è un'affermazione
  // inventata — e in copertina, a corpo 22, è la prima cosa che il cliente legge.
  const txt = await pdfText(doc => R._addCoverPage(doc, {
    title: 'Dossier', project: 'Rete X', date: '30/07/2026', user: 'mario',
    deviceCount: 4,   // fornito
    // cableCount / vlanCount / vmCount: NON forniti
  }));
  assert.ok(/4/.test(txt), 'il contatore fornito si vede');
  assert.ok(/-/.test(txt), 'i contatori assenti escono come trattino');
});

test('porte libere: «nessuna fibra dichiarata» non si scrive «0 SFP»', { skip: !has }, async () => {
  const senzaFibra = { totals: { devices: 1, ports: 24, used: 4, free: 20, freeAccess: 20, freeSfp: 0, sfp: 0, suspect: 0 },
    racks: [{ name: 'R-A', devices: [{ name: 'SW-A', free: 20, freeAccess: 20, freeSfp: 0, sfp: 0, suspect: 0, used: 4, total: 24 }] }], unracked: [] };
  const t1 = await pdfText(doc => R._addSparePages(doc, senzaFibra, 'P', '30/07/2026', 'it'));
  assert.ok(/nessuna porta in fibra dichiarata/.test(t1), 'lo dice a parole: ' + t1.slice(0, 200));
  assert.ok(!/0 SFP/.test(t1), 'e non finge un conteggio');

  const conFibra = { totals: { devices: 1, ports: 26, used: 4, free: 22, freeAccess: 20, freeSfp: 2, sfp: 2, suspect: 0 },
    racks: [{ name: 'R-A', devices: [{ name: 'SW-A', free: 22, freeAccess: 20, freeSfp: 2, sfp: 2, suspect: 0, used: 4, total: 26 }] }], unracked: [] };
  const t2 = await pdfText(doc => R._addSparePages(doc, conFibra, 'P', '30/07/2026', 'it'));
  assert.ok(/2 libere su 2 SFP\/uplink/.test(t2), 'con fibra dichiarata torna il rapporto: ' + t2.slice(0, 200));
});

// ⭐ Il tenant nel Registro asset. Il dato arriva dall'import NetBox e vive in
// `node.source.tenant`: NON e' nel DTO nodeToDevice, che e' contratto della REST API
// v1, e aggiungerlo la' cambierebbe cosa esce dall'installazione — una decisione, non
// un fix. Quindi viaggia come il fallback MAC e le note: un arricchimento che vive
// SOLO nel registro (`applyDeviceTenant`).
test('⭐ registro asset: il tenant esce in colonna, e SOLO se qualcuno ce l\'ha', { skip: !has }, async () => {
  const con = [
    { id: 'sw1', name: 'CORE-SW', type: 'switch', brand: 'Cisco', model: 'C9300', serial: 'FCW1', ip: '10.0.0.1', mac: 'AA:BB', vlan: 10, rack: null, tenant: 'Amministrazione' },
    { id: 'ap1', name: 'AP-Lobby', type: 'ap', brand: null, model: null, serial: null, ip: null, mac: null, vlan: null, rack: null },
  ];
  const it = await pdfText(doc => R._addAssetRegisterPages(doc, con, 'Net', '11/08/2026', null, 'it'));
  assert.ok(it.includes('Tenant'), 'la colonna c\'e\': ' + it.slice(0, 200));
  assert.ok(it.includes('Amministrazione'), 'e il valore esce');
  const en = await pdfText(doc => R._addAssetRegisterPages(doc, con, 'Net', '11/08/2026', null, 'en'));
  assert.ok(en.includes('Tenant') && en.includes('Amministrazione'), 'in EN la parola e\' la stessa');

  // ⚠️ Senza nessun tenant la colonna NON compare: su un'installazione che non ha
  // importato da NetBox sarebbe 55pt di pagina spesi per una colonna di «-».
  // Stessa regola della riga Cavi nella Panoramica: in coda e solo se ce n'e'.
  const senza = await pdfText(doc => R._addAssetRegisterPages(doc, [con[1]], 'Net', '11/08/2026', null, 'it'));
  assert.ok(!/Tenant/.test(senza), 'senza tenant la colonna tace');
});

// ⭐⭐ La trappola del ribilanciamento, trasformata in cancello. Il file porta SEI
// commenti `// 539` accanto ad altrettante tabelle: una somma scritta a mano accanto
// a dei numeri e' una frase che nessun cancello verifica, e qui la colonna nuova la
// rimetteva in discussione. Ora le colonne del registro le DERIVA una funzione, e
// questa prova le misura in tutt'e due i rami.
test('⭐ registro asset: le colonne sommano alla larghezza utile, e nessuna intestazione si tronca', { skip: !has }, async () => {
  const doc = new PDFDocument({ autoFirstPage: false });
  for (const lang of ['it', 'en']) {
    for (const conTenant of [false, true]) {
      const cols = R._assetRegisterCols(lang, conTenant);
      const tot = cols.reduce((s, c) => s + c.w, 0);
      assert.equal(tot, 539,
        'colonne ' + lang + (conTenant ? ' con' : ' senza') + ' tenant: somma ' + tot
        + ', la larghezza utile della pagina e\' 539 (595 - 28*2)');
      assert.equal(cols.length, conTenant ? 11 : 10);
      // L'intestazione e' disegnata in Helvetica-Bold 7 e fittata a w-6: se non
      // entra, `_fit` la TRONCA in silenzio — che e' il modo in cui un
      // ribilanciamento sbaglia senza che niente arrossisca.
      doc.font('Helvetica-Bold').fontSize(7);
      for (const c of cols) {
        const w = doc.widthOfString(String(c.label));
        assert.ok(w <= c.w - 6,
          'l\'intestazione «' + c.label + '» misura ' + w.toFixed(1) + 'pt e la colonna ne ha '
          + (c.w - 6) + ': verrebbe troncata (' + lang + (conTenant ? ', con' : ', senza') + ' tenant)');
      }
    }
  }
});
