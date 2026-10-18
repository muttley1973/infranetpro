'use strict';
// ============================================================
// IL DOSSIER DI CONSEGNA STA DENTRO «ESPORTA PDF».
//
// Prima il menù Esporta aveva due voci per lo stesso file: «Esporta PDF» (un
// dialogo di caselle, tutte accese) e «Dossier di consegna» (un preset che
// accendeva tutto e in più metteva copertina e storia modifiche). Ora la voce è
// una sola e le parti stanno cosi':
//   ① il dossier (copertina in testa, storia modifiche in coda) è la CORNICE di
//      ogni PDF: nel dialogo è una riga accesa e BLOCCATA, e `exportPDF` lo
//      rimette comunque sopra a qualunque cosa riceva;
//   ② le SEZIONI partono tutte spente (il vecchio dossier = «Seleziona tutto»);
//   ③ nel menù non c'è più la voce, né un handler o una frase che la serva.
// Le prove sono sul sorgente (la forma) e sulla rotta (il fatto: una cornice
// da sola è un PDF valido). Il flusso nel browser vero sta in
// test/e2e/critical-flows.test.js.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const leggi = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = leggi('netmapper.html');
const EXPORT = leggi('export.js');
const { _i18nDict: I18N } = require('../lib/i18n.js');

// Il menù Esporta: dal suo contenitore fino al primo elemento dopo di lui.
const MENU = HTML.slice(HTML.indexOf('id="impexp-dropdown"'), HTML.indexOf('id="btn-undo"'));
// Il dialogo delle opzioni PDF: dal suo overlay a quello delle etichette.
const DIALOGO = HTML.slice(HTML.indexOf('id="pdf-export-overlay"'), HTML.indexOf('id="label-export-overlay"'));

/** Un oggetto letterale `const NOME = {...};` di export.js, valutato. */
const costante = (nome) => {
  const m = new RegExp('const ' + nome + ' = (\\{[\\s\\S]*?\\n\\});').exec(EXPORT);
  assert.ok(m, `export.js deve dichiarare ${nome}`);
  return new Function('return ' + m[1])();
};

/** Le caselle del dialogo, con i loro attributi: id → { checked, disabled }. */
const caselle = () => {
  const out = {};
  for (const m of DIALOGO.matchAll(/<input\b[^>]*\bid="(pdfopt-[a-z]+)"[^>]*>/g)) {
    out[m[1]] = { checked: /\schecked\b/.test(m[0]), disabled: /\sdisabled\b/.test(m[0]) };
  }
  return out;
};

// ── ③ Il menù ───────────────────────────────────────────────────────────────
test('③ il menù Esporta non ha più la voce «Dossier di consegna»', () => {
  assert.ok(MENU.length > 200 && /header-menu-item/.test(MENU), 'il menù è stato trovato');
  assert.doesNotMatch(MENU, /exportDossier/, 'nessun handler del vecchio preset');
  assert.doesNotMatch(MENU, /impexp\.dossier/, 'nessuna etichetta o tooltip del vecchio preset');
  assert.doesNotMatch(MENU, /fa-folder-open/, 'nessuna icona rimasta senza voce');
  assert.match(MENU, /openPdfExportOptions\(\)/, 'la voce «Esporta PDF» c\'è, ed è l\'unica del PDF');
});

test('③ ogni handler inline del menù esiste: nessun bottone morto', () => {
  const nomi = new Set([...MENU.matchAll(/onclick="(\w+)\(/g)].map(m => m[1]));
  nomi.delete('closeImpExpMenu');   // del bundle: lo registra il modulo del menù
  assert.ok(nomi.size >= 3, 'le voci di export chiamano export.js');
  for (const n of nomi) {
    assert.match(EXPORT, new RegExp('window\\.' + n + ' = '), `${n}() è esposta da export.js`);
  }
  assert.ok(!nomi.has('exportDossier'), 'e la funzione del preset non è più nel menù');
  assert.doesNotMatch(EXPORT, /function exportDossier|window\.exportDossier/, 'né in export.js: sarebbe un handler morto');
});

test('③ nessuna stringa orfana: le chiavi tolte spariscono da it e en, quelle nuove ci sono', () => {
  for (const lang of ['it', 'en']) {
    for (const k of ['impexp.dossier', 'impexp.dossierTip', 'impexp.pickASection']) {
      assert.equal(Object.prototype.hasOwnProperty.call(I18N[lang], k), false, `${k} (${lang}) non serve più`);
    }
    for (const k of ['pdf.dossier', 'pdf.dossierSub', 'impexp.pickSections']) {
      assert.ok(I18N[lang][k], `${k} (${lang}) esiste: la riga del dossier è tradotta`);
    }
  }
  // Nessuno le legge più: né il codice né la pagina.
  assert.doesNotMatch(EXPORT, /pickASection/);
  assert.doesNotMatch(HTML, /impexp\.dossier|pickASection/);
});

// ── ① Il dossier è sempre dentro ────────────────────────────────────────────
test('① il dialogo ha la riga del dossier: accesa e BLOCCATA', () => {
  const c = caselle();
  assert.ok(c['pdfopt-dossier'], 'la riga del dossier c\'è nel dialogo del PDF');
  assert.equal(c['pdfopt-dossier'].checked, true, 'è accesa');
  assert.equal(c['pdfopt-dossier'].disabled, true, 'e non si può spegnere');
});

test('① la cornice (copertina + storia modifiche) è sempre nelle opzioni di exportPDF', () => {
  assert.deepEqual(costante('PDF_DOSSIER'), { includeCover: true, includeChangelog: true });
  // exportPDF la applica PER ULTIMA: anche chi la chiamasse con `includeCover:false`
  // otterrebbe comunque il dossier. L'ordine dei spread è tutta la garanzia.
  const riga = /\n\s*const options=\{[^\n]*\};/.exec(EXPORT.slice(EXPORT.indexOf('async function exportPDF')));
  assert.ok(riga, 'exportPDF costruisce `options`');
  assert.match(riga[0], /\.\.\.PDF_EXPORT_DEFAULTS, \.\.\.\(opts\|\|\{\}\), \.\.\.PDF_DOSSIER \}/);
  // E il dialogo non ha un'altra strada per spegnerla: non legge una casella dossier.
  const letto = /function _getPdfExportOptionsFromUi\(\)\{[\s\S]*?\n\}/.exec(EXPORT)[0];
  assert.doesNotMatch(letto, /pdfopt-dossier|includeCover|includeChangelog/);
});

// ── ② Le sezioni partono spente ─────────────────────────────────────────────
test('② ogni sezione parte SPENTA: nei default e nelle caselle del dialogo', () => {
  const def = costante('PDF_EXPORT_DEFAULTS');
  assert.ok(Object.keys(def).length >= 15, 'tutte le sezioni sono nei default');
  const accese = Object.entries(def).filter(([, v]) => v !== false).map(([k]) => k);
  assert.deepEqual(accese, [], 'nessuna sezione è accesa di partenza');

  const c = caselle();
  const accesePagina = Object.entries(c).filter(([id, v]) => id !== 'pdfopt-dossier' && v.checked).map(([id]) => id);
  assert.deepEqual(accesePagina, [], 'nessuna casella del dialogo ha `checked` nell\'HTML');
  assert.ok(Object.keys(c).length >= 16, 'le caselle sono quelle vere (15 sezioni + il dossier)');
});

test('② i default, le caselle e le opzioni lette dal dialogo sono lo STESSO elenco', () => {
  // Se il codice enumera, la prova deriva dal codice: una sezione aggiunta in un
  // posto solo (casella senza default, o default senza casella) non passa.
  const chiaviDefault = Object.keys(costante('PDF_EXPORT_DEFAULTS')).sort();
  const letto = /function _getPdfExportOptionsFromUi\(\)\{[\s\S]*?\n\}/.exec(EXPORT)[0];
  const chiaviLette = [...letto.matchAll(/\b(include[A-Za-z]+):/g)].map(m => m[1]).sort();
  assert.deepEqual(chiaviLette, chiaviDefault, 'il dialogo legge esattamente le sezioni dei default');

  const idCaselle = Object.keys(caselle()).filter(id => id !== 'pdfopt-dossier').sort();
  const idLetti = [...letto.matchAll(/getElementById\('(pdfopt-[a-z]+)'\)/g)].map(m => m[1]).sort();
  assert.deepEqual(idLetti, idCaselle, 'ogni casella del dialogo è letta');
  const tutte = /function setPdfExportAll\(val\)\{\s*\[([^\]]+)\]/.exec(EXPORT);
  const idTutte = [...tutte[1].matchAll(/'(pdfopt-[a-z]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(idTutte, idCaselle, '«Seleziona tutto» le accende tutte, e solo quelle');
});

test('② «Deseleziona tutto» può svuotare le sezioni: il PDF non resta vuoto, c\'è il dossier', () => {
  const f = /function setPdfExportAll\(val\)\{[\s\S]*?\n\}/.exec(EXPORT)[0];
  assert.doesNotMatch(f, /pdfopt-plan'\)\.checked=true/, 'non rimette a forza la planimetria');
  const conferma = /function confirmPdfExport\(\)\{[\s\S]*?\n\}/.exec(EXPORT)[0];
  assert.doesNotMatch(conferma, /_showToast/, 'nessun rifiuto «scegli almeno una sezione»: non può più succedere');
});

// ── Sulla rotta: la cornice da sola è un PDF valido ─────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-dossier-'));
process.env.INFRANET_PROJECTS_DIR = path.join(TMP, 'projects');
fs.mkdirSync(process.env.INFRANET_PROJECTS_DIR, { recursive: true });
process.env.INFRANET_ORG_FILE = path.join(TMP, 'organization.json');

const express = require('express');
let server, base, deps;
try { deps = require('../server/pdf-report.js')._loadPdfDeps(); }
catch { /* pdfkit non installato: si salta sotto */ }

before(async () => {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.session = { user: { id: 1, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/export'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); } catch (_) { /* già chiuso */ } });

/** Il testo che è finito DAVVERO sulle pagine (v. test/export-wan-route.test.js). */
function pdfText(buf) {
  let raw = '', i = 0;
  for (;;) {
    const s = buf.indexOf('stream', i);
    if (s < 0) break;
    let p = s + 6;
    if (buf[p] === 13) p++;
    if (buf[p] === 10) p++;
    const e = buf.indexOf('endstream', p);
    if (e < 0) break;
    try { raw += zlib.inflateSync(buf.slice(p, e)).toString('latin1'); } catch (_) { /* non compresso: si salta */ }
    i = e + 9;
  }
  let out = '';
  for (const m of raw.matchAll(/(?:\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F]+>)\s*Tj)/g)) {
    for (const h of String(m[1] || m[2]).matchAll(/<([0-9a-fA-F]+)>/g)) {
      for (let k = 0; k + 1 < h[1].length; k += 2) out += String.fromCharCode(parseInt(h[1].substr(k, 2), 16));
    }
  }
  return out;
}

test('⭐ la sola cornice (tutte le sezioni spente) è un PDF valido con copertina e storia modifiche', { skip: !deps }, async () => {
  const { buildHandoffSections } = require('../lib/handoff.js');
  const handoff = buildHandoffSections({
    title: 'Dossier di consegna', project: 'Rete Prova', date: '18/10/2026', user: 'mario',
    devices: [{ name: 'SW-1', typeLabel: 'Switch', structural: false }],
    cableCount: 2, vlanCount: 1, vmCount: 0,
    auditLog: [{ ts: '2026-10-18T09:00:00Z', user: 'mario', action: 'link.add', target: 'SW-1 -> AP-1', summary: 'VOCE-DI-STORIA-77' }],
  });
  // Esattamente ciò che il dialogo manda quando non si spunta NIENTE: i default
  // (tutte spente) + la cornice che `exportPDF` aggiunge sempre.
  const reportOptions = Object.assign({}, costante('PDF_EXPORT_DEFAULTS'), costante('PDF_DOSSIER'));
  const r = await fetch(`${base}/api/export-pdf`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName: 'Rete Prova', lang: 'it', svg: '<svg viewBox="0 0 10 10"/>', reportData: { handoff }, reportOptions }),
  });
  assert.equal(r.status, 200, 'una cornice da sola non è «nessuna sezione selezionata»');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
  const txt = pdfText(buf);
  assert.ok(txt.includes('Rete Prova'), 'la copertina porta il nome del progetto');
  assert.ok(txt.includes('VOCE-DI-STORIA-77'), 'e in coda c\'è la storia modifiche');
  assert.ok(!/Planimetria/.test(txt), 'la planimetria, spenta, non esce');
});
