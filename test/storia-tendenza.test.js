'use strict';
// ============================================================
//  test/storia-tendenza.test.js — la tendenza arriva alla scheda «Verifiche».
//
//  Il motore ha le sue prove (test/verify-trend.test.js); queste guardano il
//  punto dove si rompe in silenzio: il CABLAGGIO. Un motore corretto che parla
//  per codici e una scheda che non conosce quei codici non danno un errore —
//  danno una riga vuota, e nessuno se ne accorge.
//
//  ⚠️ È la ragione per cui i «perché» sono codici e non frasi: una frase
//  italiana che esce da un motore puro finisce tale e quale in un'interfaccia
//  inglese, e la parità di CHIAVI i18n non la vede (la stringa non nasce da una
//  chiave). Spostato il rischio sulle chiavi, serve qualcuno che le conti.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const DICT = require('../lib/i18n.js')._i18nDict;

// I codici NON si ricopiano: si leggono dal motore. Se domani ne nasce uno e
// nessuno gli dà una stringa, questo cancello lo trova — che è esattamente il
// modo in cui un «perché» diventerebbe una riga vuota nella scheda.
function codiciDelMotore() {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'verify-trend.js'), 'utf8');
  return [...new Set((src.match(/code:\s*'([a-zA-Z]+)'/g) || []).map(s => s.replace(/.*'([a-zA-Z]+)'.*/, '$1')))];
}

test('ogni «perché» del motore ha la sua frase, in tutt\'e due le lingue', () => {
  const codici = codiciDelMotore();
  assert.ok(codici.length >= 5, 'letti dal motore: ' + codici.join(', '));
  for (const c of codici) {
    for (const lang of ['it', 'en']) {
      const k = 'storia.tl.why.' + c;
      assert.ok(DICT[lang] && DICT[lang][k],
        lang + ': il motore può emettere «' + c + '» e non esiste ' + k + ' — nella scheda uscirebbe una riga VUOTA, non un errore');
    }
  }
});

test('i verdetti e le etichette delle serie sono tradotti, non lasciati in italiano', () => {
  const chiavi = ['storia.tl.better', 'storia.tl.worse', 'storia.tl.flat', 'storia.tl.noCompare',
    'storia.tl.modeAuto', 'storia.tl.modeManual', 'storia.tl.samples',
    'storia.tl.presence', 'storia.tl.blind', 'storia.tl.ports', 'storia.tl.queue', 'storia.tl.queueTip',
    'storia.tl.partConfirmed', 'storia.tl.partMeasured', 'storia.tl.partUnseen'];
  for (const k of chiavi) for (const lang of ['it', 'en']) {
    assert.ok(DICT[lang] && DICT[lang][k], lang + ': manca ' + k);
  }
  // ⚠️ E devono essere DAVVERO tradotte: una chiave che porta lo stesso testo in
  // due lingue è una traduzione dimenticata, non una parola internazionale.
  const uguali = chiavi.filter(k => DICT.it[k] === DICT.en[k]);
  assert.deepEqual(uguali, [], 'stessa stringa in it ed en: ' + uguali.join(', '));
});

let APP;
test('load app (tendenza)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('il motore è caricato dalla pagina, e DOPO il report che gli serve', () => {
  // ⚠️ verify-trend chiede driftActionable a drift-report: se il suo <script>
  // stesse PRIMA, la coda uscirebbe null e nessuno lo direbbe.
  assert.equal(run(APP.ctx, 'typeof trendVerifiche'), 'function',
    'lib/verify-trend.js deve stare fra gli script di netmapper.html');
  const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
  assert.ok(html.indexOf('/lib/drift-report.js') < html.indexOf('/lib/verify-trend.js'),
    'verify-trend va caricato DOPO drift-report, o la coda resta muta');
  const t = run(APP.ctx, 'JSON.stringify(trendVerifiche([1,2,3].map(i=>({at:"2026-09-0"+i,verify:"manual",'
    + 'counts:{consistent:90,stateDrift:10,undocumented:9},totals:{nodes:100}}))))');
  assert.match(t, /"coda"/, 'e la coda deve esserci');
  assert.ok(JSON.parse(t).coda.serie[0] > 0, 'con un valore vero: se driftActionable non fosse arrivato sarebbe null');
});

test('la scheda «Verifiche» monta la tendenza in testa all\'elenco', () => {
  // ⚠️ Prova di CABLAGGIO, e lo dice: _renderTimelineTab vive nel modulo e la
  // harness non lo raggiunge senza allargare il ponte, che è a ratchet. Quello
  // che impedisce è la regressione precisa: il blocco che smette di essere
  // montato, e la scheda che torna a essere un elenco senza lettura.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app-audit.js'), 'utf8');
  assert.match(src, /function _tlTrendHtml/, 'il blocco deve esistere');
  assert.match(src, /const testa = _tlTrendHtml\(rows\);[\s\S]{0,120}?box\.innerHTML = testa \+/,
    'e deve finire IN TESTA al corpo della scheda, non essere calcolato e buttato');
  assert.match(src, /typeof trendVerifiche !== 'function'\) return ''/,
    'e se il motore manca la scheda resta quella di prima: una funzione assente non toglie l\'elenco a chi lo guardava');
});

test('«divergenze» nella scheda è la stessa somma del Drift Report', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app-audit.js'), 'utf8');
  const m = src.match(/function _tlPrimary\(c\)\{([\s\S]*?)\n\}/);
  assert.ok(m, '_tlPrimary deve esistere');
  assert.match(m[1], /driftActionable\(c\)/,
    'la scheda contava le divergenze con una somma SUA: ci metteva il rumore endpoint e lasciava fuori '
    + 'gli apparati assenti, i cavi fantasma e i cambi IP — cioè poteva dire «nessuna divergenza» con venti apparati mancanti');
});
