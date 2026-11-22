'use strict';
// La versione sotto il logo della testata, col link alla storia delle modifiche su GitHub.
//   · `versionLabel` (lib/app-version.js): «v2.13.1», oppure '' per tutto cio' che non e' x.y.z;
//   · il markup di netmapper.html: l'indirizzo e' lo STESSO di CHANGELOG_URL, il link si apre in una
//     scheda nuova senza dare la finestra madre (`noopener`), parte nascosto, il suggerimento e' tradotto;
//   · il server dice la versione in /api/auth/me (test/auth-api.test.js, accanto al resto di quella rotta);
//   · il client la mette: `initAuth` scrive l'etichetta e la mostra, e con un server piu' vecchio
//     (nessun campo) o con un valore che non e' una versione la lascia NASCOSTA.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { versionLabel, CHANGELOG_URL } = require('../lib/app-version.js');
const i18n = require('../lib/i18n.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');

test('versionLabel: una versione x.y.z diventa «vx.y.z», il resto diventa vuoto', () => {
  assert.equal(versionLabel('2.13.1'), 'v2.13.1');
  assert.equal(versionLabel('10.0.123'), 'v10.0.123');
  // Tutto cio' che non e' un numero di versione NON arriva nella testata.
  for (const x of [undefined, null, '', 'undefined', '2.13', '2.13.1.4', 'v2.13.1', '2.13.1-beta', ' 2.13.1', '2.13.1\n',
    '<img src=x>', 213, { v: '2.13.1' }, ['2.13.1']]) {
    assert.equal(versionLabel(x), '', 'non e\' una versione: ' + JSON.stringify(x));
  }
});

test('il link porta al CHANGELOG su GitHub, ed e\' https', () => {
  assert.match(CHANGELOG_URL, /^https:\/\/github\.com\/muttley1973\/infranetpro\/blob\/main\/CHANGELOG\.md$/);
});

test('netmapper.html: l\'etichetta sta nel blocco del logo, col suo indirizzo, nascosta e sicura', () => {
  const tag = /<a\b[^>]*\bid="app-version"[^>]*>/.exec(html);
  assert.ok(tag, 'manca <a id="app-version"> nella testata');
  const a = tag[0];
  const attr = (n) => { const m = new RegExp('\\b' + n + '="([^"]*)"').exec(a); return m && m[1]; };
  assert.equal(attr('href'), CHANGELOG_URL, 'l\'href della pagina e CHANGELOG_URL (lib/app-version.js) devono essere lo stesso indirizzo');
  assert.equal(attr('target'), '_blank');
  assert.match(attr('rel') || '', /\bnoopener\b/, 'target=_blank senza noopener da\' alla pagina aperta la finestra madre');
  assert.match(a, /\shidden(\s|>|=)/, 'parte NASCOSTA: finche\' il server non dice la versione non ci sono parole da mostrare');
  assert.equal(attr('data-i18n-tip'), 'hdr.versionTip');
  assert.equal(attr('data-i18n-aria'), 'hdr.versionTip', 'un link che dice solo «v2.13.1» ha bisogno di un nome per chi usa uno screen reader');
  // Il logo: riquadro, poi il blocco di testo con il NOME e, dopo, la VERSIONE. Tutto dentro `.header-title`,
  // che il fitter della testata misura per classe (e che a larghezze strette nasconde il nome ma non la versione).
  const titolo = /<div class="header-title">([\s\S]*?)<div class="header-sep">/.exec(html);
  assert.ok(titolo, 'manca <div class="header-title"> prima del separatore');
  const testo = /<div class="header-brand-text">([\s\S]*?)<\/a><\/div><\/div>/.exec(titolo[1]);
  assert.ok(testo, 'manca <div class="header-brand-text"> dentro il titolo');
  assert.ok(testo[1].indexOf('class="header-name"') >= 0 && testo[1].indexOf('class="header-name"') < testo[1].indexOf('id="app-version"'),
    'il nome del logo viene PRIMA della versione (la versione sta sotto)');
  assert.ok(!/<span[^>]*id="app-version"/.test(titolo[1]), 'la versione e\' un <a>, non uno <span>: `.header-title span` nasconde i span sotto i 1738px');
  assert.ok(titolo[1].indexOf('<i class="fas fa-network-wired">') < titolo[1].indexOf('class="header-brand-text"'), 'il riquadro del logo sta a sinistra del testo');
});

test('il suggerimento e\' tradotto in italiano e in inglese', () => {
  assert.ok(i18n._i18nDict.it['hdr.versionTip'], 'manca hdr.versionTip in italiano');
  assert.ok(i18n._i18nDict.en['hdr.versionTip'], 'manca hdr.versionTip in inglese');
  assert.notEqual(i18n._i18nDict.it['hdr.versionTip'], i18n._i18nDict.en['hdr.versionTip']);
});

// ── il client ────────────────────────────────────────────────────────────────
let APP;
test('carico l\'app (versione sotto il logo)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Una volta per scenario: l'etichetta parte nascosta e vuota, `fetch` risponde come /api/auth/me.
async function giro(meBody) {
  const ctx = APP.ctx;
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(meBody) });
  const el = ctx.document.getElementById('app-version');
  el.hidden = true; el.textContent = '';
  await ctx.initAuth();
  return { text: el.textContent, hidden: el.hidden };
}

const UTENTE = { id: 1, username: 'prova', role: 'admin' };

test('initAuth: con la versione dal server l\'etichetta si scrive e si mostra', async () => {
  const r = await giro({ ok: true, user: UTENTE, version: '2.13.1' });
  assert.deepEqual(r, { text: 'v2.13.1', hidden: false });
});

test('initAuth: server piu\' vecchio della pagina (nessun campo) o valore che non e\' una versione → resta nascosta', async () => {
  for (const version of [undefined, null, '', 'undefined', '2.13', '<b>x</b>', 213]) {
    const r = await giro(version === undefined ? { ok: true, user: UTENTE } : { ok: true, user: UTENTE, version });
    assert.deepEqual(r, { text: '', hidden: true }, 'con version=' + JSON.stringify(version));
  }
});
