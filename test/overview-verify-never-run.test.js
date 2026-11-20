'use strict';
// ============================================================
//  LA RIGA «VERIFICA COMPLETA» NON DICE «ALLINEATO» DI UNA VERIFICA MAI FATTA
// ============================================================
// Il 20/11/2026, guardando la Dashboard di un progetto mai verificato (e di uno appena creato), la riga
// «Verifica completa» diceva «allineato · verificato mai», in VERDE.
//
// La causa erano due metà che non si parlavano. Dal 04/09 (`11b84f6`) il motore crea la riga della Verifica mai
// girata con `prov: 'unread'` — «non risulta» —, perché «manca una VERIFICA» non è «manca una tua
// dichiarazione» (`none`). Ma il verdetto, in `src/app-overview.js`, chiedeva ancora `prov === 'none'`: una
// condizione che nessuna riga soddisfaceva più, e il caso cadeva nel ramo «allineato». La riga passa anche da
// `buildOverviewReport()`, quindi la stessa frase finiva nel dossier PDF consegnato al cliente.
//
// Il secondo punto è la COPERTURA. Il dialogo della Verifica dice già «allineata (N non verificabili…)»; la
// riga della Dashboard diceva solo «allineato». Chi vede la riga e non il dialogo leggeva una completezza che
// la Verifica non aveva. Qui nessuna soglia inventata: si dicono i due numeri che la Verifica ha già contato.
//
// Si prova dal percorso vero (`buildOverviewReport`, lo stesso che alimenta lo schermo e il PDF) nel browser
// finto, non leggendo il sorgente: un test che cerca la stringa `'unread'` nel file prova il file, non la riga.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const i18n = require('../lib/i18n.js');

const ROOT = path.join(__dirname, '..');
const IT = i18n._i18nDict.it;
const EN = i18n._i18nDict.en;
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

/** La riga «Verifica completa» del report della Dashboard, per un `lastVerify` dato (`undefined` = mai girata). */
function rigaVerifica(lastVerify) {
  const r = JSON.parse(run(APP.ctx, `(() => { try {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    ${lastVerify === undefined ? 'delete state.lastVerify;' : 'state.lastVerify = ' + JSON.stringify(lastVerify) + ';'}
    const rep = buildOverviewReport();
    for (const s of rep.sections) for (const r of s.rows) {
      if (r.label === ${JSON.stringify(IT['ov.row.verify'])}) return JSON.stringify({ ok: true, status: r.status, tone: r.tone, prov: r.prov });
    }
    return JSON.stringify({ ok: false, err: 'la riga «Verifica completa» non e\\' nel report' });
  } catch (e) { return JSON.stringify({ ok: false, err: String(e && e.message || e) }); } })()`));
  assert.ok(r.ok, r.err);
  return r;
}
const ZERI = { consistent: 0, stateDrift: 0, macOrphan: 0, undocumented: 0, undocumentedEndpoint: 0, ghostCable: 0,
  shutCable: 0, ipChanged: 0, unverified: 0, identityDrift: 0, identityFirmware: 0, portUnverified: 0 };
const verifica = (counts, banner, docCount) => ({ at: Date.now() - 60000, counts: Object.assign({}, ZERI, counts), banner, docCount: docCount || 0 });

test('mai verificato: la riga lo dice («mai eseguita», tono spento) e NON dice «allineato»', () => {
  const r = rigaVerifica(undefined);
  assert.equal(r.prov, 'unread', 'la riga mai girata porta «non risulta», non «non dichiarato»');
  assert.equal(r.status, IT['ov.st.never'], 'dice che non e\' mai girata: ' + r.status);
  assert.notEqual(r.tone, 'ok', 'una Verifica che non c\'e\' non e\' un verde');
  assert.ok(!/allineat/i.test(r.status), 'mai «allineato» di una Verifica mai fatta: ' + r.status);
});

test('verificato e coerente, senza nulla di non verificabile: «allineato» pulito, senza rumore', () => {
  const r = rigaVerifica(verifica({ consistent: 12 }, 'aligned', 12));
  assert.match(r.status, /^allineato · verificato /, r.status);
  assert.equal(r.tone, 'ok');
  assert.ok(!/non verificabil|non lette/.test(r.status), 'nessuna copertura da dire, quindi nessuna nota: ' + r.status);
});

test('allineato con poca copertura: la riga dice QUANTI non si sono potuti verificare', () => {
  // un confermato e novantanove non verificabili: «allineato» e' vero di quell'uno, e la riga lo deve dire
  const r = rigaVerifica(verifica({ consistent: 1, unverified: 99 }, 'aligned', 100));
  assert.match(r.status, /^allineato · verificato /, r.status);
  assert.ok(r.status.includes(IT['ov.verify.unverified'].replace('{n}', '99')), 'dice 99 non verificabili: ' + r.status);
  assert.equal(r.tone, 'ok', 'resta una constatazione, non un allarme: nessuna soglia inventata');
});

test('allineato con porte non lette: lo dice, come il dialogo della Verifica', () => {
  const r = rigaVerifica(verifica({ consistent: 8, portUnverified: 14 }, 'aligned', 8));
  assert.ok(r.status.includes(IT['ov.verify.portsUnread'].replace('{n}', '14')), 'dice 14 porte non lette: ' + r.status);
  assert.ok(!/non verificabil/.test(r.status), 'e non inventa dispositivi non verificabili che non ci sono: ' + r.status);
});

test('i due numeri si dicono insieme, nell\'ordine: dispositivi e poi porte', () => {
  const r = rigaVerifica(verifica({ consistent: 3, unverified: 2, portUnverified: 5 }, 'aligned', 5));
  const a = r.status.indexOf(IT['ov.verify.unverified'].replace('{n}', '2'));
  const b = r.status.indexOf(IT['ov.verify.portsUnread'].replace('{n}', '5'));
  assert.ok(a > 0 && b > a, 'dispositivi prima delle porte: ' + r.status);
});

test('invariati: «cieca» e «da decidere» (la correzione non li tocca)', () => {
  const cieca = rigaVerifica(verifica({ consistent: 0, unverified: 5 }, 'blind', 5));
  assert.match(cieca.status, /^nulla verificabile · verificato /, cieca.status);
  assert.equal(cieca.tone, 'warn');
  const diffs = rigaVerifica(verifica({ stateDrift: 2, consistent: 4 }, 'discrepancies', 6));
  assert.match(diffs.status, /^2 da decidere · verificato /, diffs.status);
  assert.equal(diffs.tone, 'warn');
});

test('le due frasi nuove esistono in tutt\'e due le lingue e portano il numero', () => {
  for (const [lingua, d] of [['it', IT], ['en', EN]]) {
    for (const k of ['ov.verify.unverified', 'ov.verify.portsUnread']) {
      assert.ok(typeof d[k] === 'string' && d[k].length > 0, `${lingua}: manca ${k}`);
      assert.ok(d[k].includes('{n}'), `${lingua}: ${k} deve avere il segnaposto {n}`);
    }
  }
});
