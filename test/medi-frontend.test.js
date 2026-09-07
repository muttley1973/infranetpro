// Fix frontend dei rilievi MEDI del secondo smoke (STATO_PIANO gruppo H). I moduli
// src/ sono ESM per il browser (bundle esbuild) e non si caricano in node: si
// verifica il SORGENTE, come group-g-frontend / history-undo-dirty. Ogni asserzione
// riproduce il difetto che il fix chiude — e i due fix qui esistono proprio perché
// una guardia che il consumatore non usa non è una guardia.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const { _i18nDict: I18N } = require('../lib/i18n.js');

// ── L'organizzazione ha un marcatore di versione, e il client lo USA ─────────
test('il pannello multisito ripresenta l\'ETag come If-Match quando salva', () => {
  const src = read('app-inter-site.js');
  assert.match(src, /_captureOrgEtag/, 'la versione si prende dalla risposta');
  assert.match(src, /'If-Match':\s*_orgEtag/, 'e si ripresenta al PUT');
  const cap = /function _captureOrgEtag[\s\S]*?\n\}/.exec(src);
  assert.ok(cap, 'corpo trovato');
  assert.match(cap[0], /if\s*\(!res\s*\|\|\s*!res\.ok\)\s*return/,
    'SOLO dalle risposte riuscite: adottare l\'ETag del 409 disinnescherebbe la guardia');
});

test('il 409 si dice all\'utente e NON sovrascrive', () => {
  const src = read('app-inter-site.js');
  const save = /async function _save\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(save, 'corpo di _save trovato');
  assert.match(save[0], /status === 409/, 'il caso è trattato per nome');
  assert.match(save[0], /org\.saveStale/, 'e viene detto');
  // La riga del 409 sta PRIMA dell'adozione della risposta: dopo sarebbe tardi.
  assert.ok(save[0].indexOf('409') < save[0].indexOf('_adopt(j)'), 'si esce prima di adottare');
});

test('il messaggio del 409 esiste in tutt\'e due le lingue (e non è lo stesso testo)', () => {
  const it = I18N.it['org.saveStale'];
  const en = I18N.en['org.saveStale'];
  assert.ok(it && en, 'chiave presente in it e en');
  assert.notEqual(it, en, 'tradotta, non copiata');
});

// ── La scadenza dei token arriva fino a chi la deve dichiarare ──────────────
test('la creazione del token manda expiresInDays solo se è un numero > 0', () => {
  const src = read('app-auth.js');
  const f = /async function tkCreateToken\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(f, 'corpo trovato');
  assert.match(f[0], /tk-new-days/, 'il campo c\'è');
  assert.match(f[0], /Number\.isFinite\(days\)\s*&&\s*days\s*>\s*0/,
    'vuoto/0/non numero = nessuna scadenza, cioè il comportamento di sempre');
  assert.match(f[0], /body\.expiresInDays\s*=\s*days/);
});

test('la lista dei token distingue «non scade», «scade il…» e «SCADUTO»', () => {
  const src = read('app-auth.js');
  const f = /async function tkLoadTokens\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(f, 'corpo trovato');
  assert.match(f[0], /tk\.expired/, 'lo scaduto si vede: un token morto non deve far cercare il guasto altrove');
  assert.match(f[0], /tk\.expires/, 'e la data si legge');
  assert.match(f[0], /tk\.expired[\s\S]*?tk\.expires/, 'scaduto PRIMA di «scade il…»: chi è già morto non ha una data futura');
});

test('il campo giorni è nel markup, ed è dichiarato opzionale', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'netmapper.html'), 'utf8');
  assert.match(html, /id="tk-new-days"/, 'il campo esiste');
  assert.match(html, /data-i18n-ph="tk\.phDays"/, 'e il segnaposto è tradotto');
  for (const lang of ['it', 'en']) assert.ok(I18N[lang]['tk.phDays'], `tk.phDays in ${lang}`);
  assert.match(I18N.it['tk.phDays'], /vuoto/i, 'il segnaposto DICE che vuoto significa «non scade»');
  assert.match(I18N.en['tk.phDays'], /empty/i);
});
