'use strict';
// L'avviso «password generata» nella pagina (#pwd-notice). Il server lo accende con `passwordGenerated: true` in
// /api/auth/me (test/auth-password-generated.test.js); qui il LATO PAGINA:
//   · il markup di netmapper.html: parte spento, sta fra la testata e il sotto-header (non dentro l'header, il cui
//     budget di larghezza e' tarato al pixel), e le due azioni sono delegate (`data-act`) e REGISTRATE;
//   · `initAuth` lo accende solo con `true` (un server piu' vecchio, che non manda il campo, non lo accende);
//   · le due frasi sono tradotte in italiano e in inglese;
//   · il dialogo «Cambia password» chiama la rotta del PROPRIO cambio, non quella da amministratore.
// Il click delegato e il flusso col dialogo stanno nell'e2e (test/e2e/critical-flows.test.js): il DOM finto non li simula.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../lib/i18n.js');
const { loadApp } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
const authSrc = fs.readFileSync(path.join(ROOT, 'src', 'app-auth.js'), 'utf8');

test('netmapper.html: l\'avviso parte SPENTO e sta fra la testata e il sotto-header, fuori da #export-area', () => {
  const m = /<div id="pwd-notice"([^>]*)>([\s\S]*?)<\/div>\s*\n/.exec(html);
  assert.ok(m, 'manca <div id="pwd-notice">');
  assert.ok(!/\bclass="[^"]*\bshow\b/.test(m[1]), 'non parte acceso: lo accende initAuth, e solo se il server lo dice');
  assert.match(m[1], /role="status"/);
  const iHeaderEnd = html.indexOf('</header>');
  const iNotice = html.indexOf('<div id="pwd-notice"');
  const iSubbar = html.indexOf('<div id="modern-subbar"');
  const iExport = html.indexOf('<div id="export-area"');
  assert.ok(iHeaderEnd > 0 && iHeaderEnd < iNotice, 'dopo </header>: non dentro, il suo budget di larghezza e\' tarato al pixel');
  assert.ok(iNotice < iSubbar, 'prima del sotto-header');
  assert.ok(iNotice < iExport, 'fuori da #export-area: non entra negli export');
});

test('le azioni dell\'avviso sono delegate e REGISTRATE (nessun onclick inline)', () => {
  const m = /<div id="pwd-notice"[^>]*>([\s\S]*?)<\/div>\s*\n/.exec(html);
  assert.ok(m);
  assert.ok(!/onclick=/.test(m[1]), 'niente onclick inline: le funzioni di modulo non stanno su window');
  const acts = [...m[1].matchAll(/data-act="([^"]+)"/g)].map(x => x[1]).sort();
  assert.deepEqual(acts, ['change-password', 'pwd-notice-dismiss']);
  for (const a of acts) {
    assert.ok(authSrc.includes("'" + a + "':"), 'app-auth.js deve registrare l\'azione ' + a);
  }
});

test('la frase e i due tasti sono tradotti: la frase in IT e EN (diverse), i tasti con chiavi che gia\' esistono', () => {
  const it = i18n._i18nDict.it, en = i18n._i18nDict.en;
  assert.ok(it['user.pwdGenerated'] && en['user.pwdGenerated']);
  assert.notEqual(it['user.pwdGenerated'], en['user.pwdGenerated']);
  assert.match(it['user.pwdGenerated'], /password generata/i);
  assert.match(en['user.pwdGenerated'], /generated/i);
  const m = /<div id="pwd-notice"[^>]*>([\s\S]*?)<\/div>\s*\n/.exec(html);
  const chiavi = [...m[1].matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(chiavi.sort(), ['common.close', 'user.changePw', 'user.pwdGenerated']);
  for (const k of chiavi) assert.ok(it[k] && en[k], 'chiave tradotta: ' + k);
});

test('il dialogo «Cambia password» usa la rotta del PROPRIO cambio, non il PUT da amministratore', () => {
  const f = /async function umChangePassword\(\)\{[\s\S]*?\n\}\n/.exec(authSrc);
  assert.ok(f, 'manca umChangePassword');
  const corpo = f[0].replace(/\/\/.*$/gm, '');   // senza i commenti: sono loro a citare la vecchia rotta
  assert.ok(corpo.includes("'/api/auth/password'"), 'chiama POST /api/auth/password');
  assert.ok(corpo.includes('currentPassword') && corpo.includes('newPassword'), 'con la password attuale dentro: la verifica il server');
  assert.ok(!corpo.includes('/api/auth/users'), 'niente PUT /api/auth/users/<io>: e\' da amministratore (un visualizzatore prende 403) e azzera la sessione di chi lo chiama');
  assert.ok(!corpo.includes('/api/auth/login'), 'niente login «di controllo»');
  assert.ok(!/length\s*<\s*6/.test(corpo), 'niente «almeno 6 caratteri» scritto qui: la lunghezza minima e\' quella del server (8)');
});

// ── il client ────────────────────────────────────────────────────────────────
let APP;
test('carico l\'app (avviso password generata)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const UTENTE = { id: 1, username: 'prova', role: 'admin' };
// La `classList` del DOM finto non fa niente: all'avviso se ne da' una vera (un Set), cosi' si legge cosa initAuth ci scrive.
function classListVera(el) {
  const set = new Set();
  el.classList = {
    add: (c) => { set.add(c); }, remove: (c) => { set.delete(c); }, contains: (c) => set.has(c),
    toggle: (c, forza) => { const on = forza === undefined ? !set.has(c) : !!forza; if (on) set.add(c); else set.delete(c); return on; },
  };
  return el;
}
// Una volta per scenario: l'avviso parte spento, `fetch` risponde come /api/auth/me.
async function giro(meBody) {
  const ctx = APP.ctx;
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(meBody) });
  const el = classListVera(ctx.document.getElementById('pwd-notice'));
  await ctx.initAuth();
  return el.classList.contains('show');
}

test('initAuth: l\'avviso si accende SOLO con passwordGenerated === true', async () => {
  assert.equal(await giro({ ok: true, user: UTENTE, passwordGenerated: true }), true);
  // false, assente (server piu' vecchio della pagina) e ogni valore che non sia il booleano `true`: spento
  for (const v of [false, undefined, null, 'true', 1, 0, '', {}, []]) {
    const body = v === undefined ? { ok: true, user: UTENTE } : { ok: true, user: UTENTE, passwordGenerated: v };
    assert.equal(await giro(body), false, 'con passwordGenerated=' + JSON.stringify(v));
  }
});

test('initAuth: dopo una risposta `true` un secondo giro con `false` lo SPEGNE (non resta acceso da prima)', async () => {
  assert.equal(await giro({ ok: true, user: UTENTE, passwordGenerated: true }), true);
  const ctx = APP.ctx;
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, user: UTENTE, passwordGenerated: false }) });
  await ctx.initAuth();
  assert.equal(ctx.document.getElementById('pwd-notice').classList.contains('show'), false);
});
