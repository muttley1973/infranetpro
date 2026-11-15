'use strict';
// ============================================================
// GUARDIA — il colore del cavo (`link.color`, un DATO) non è il colore della linea (`link.colorOvr`).
//
// Un'importazione dal DCIM scrive `link.color` dal cavo NetBox. Finché il modello copiava `color`
// in `colorOvr`, quel colore dipingeva la linea al posto di quello della VLAN e il pannello lo
// mostrava come «Override colore» con il bordo arancione — una scelta che nessuno aveva fatto
// (visto il 15/11 sul progetto 29). Oggi sono due campi con due significati, e il selettore del
// pannello, il tasto ↺ e l'impostazione a mano toccano SOLO `colorOvr`.
//
// I tre punti del modello che decidono il colore da DIPINGERE hanno una prova ciascuno:
//   · `lib/link-model.js`  — nessuna copia (test/link-model.test.js)
//   · `lib/topo-lines.js`  — la mappa a linee (test/topo-lines.test.js)
//   · `lib/drawio-export.js` — l'export (test/drawio-export.test.js)
// Questa guardia copre gli SCRITTORI nei moduli del browser, che i test non possono eseguire:
// leggono il sorgente di due funzioni e chiedono che non scrivano `color`.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const leggi = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Il corpo di una funzione, dall'intestazione alla prima `}` a inizio riga. */
function corpo(src, intestazione) {
  const i = src.indexOf(intestazione);
  assert.ok(i >= 0, `non trovo «${intestazione}»: la guardia non sta guardando niente`);
  const fine = src.indexOf('\n}\n', i);
  assert.ok(fine > i, `non trovo la fine di «${intestazione}»`);
  return src.slice(i, fine);
}
// Un commento non scrive niente.
const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*\/\//.test(r)).join('\n');

test('setLinkColor (selettore e ↺) tocca solo colorOvr, mai il colore del cavo', () => {
  const f = senzaCommenti(corpo(leggi('src/app-vlan-autopoll.js'), 'export function setLinkColor('));
  assert.match(f, /l\.colorOvr\s*=\s*color/, 'il selettore scrive colorOvr: se non lo trovo, la guardia è cieca');
  assert.match(f, /delete l\.colorOvr/, '↺ cancella colorOvr: se non lo trovo, la guardia è cieca');
  assert.doesNotMatch(f, /\bl\.color\b/, 'setLinkColor scrive o cancella `l.color`: è il dato del DCIM, non un colore di linea');
});

test('setLinkProp non specchia colorOvr in color', () => {
  const f = senzaCommenti(corpo(leggi('src/app-cables.js'), 'function setLinkProp('));
  assert.match(f, /key==='length'/, 'riconosco ancora lo specchio della lunghezza: se no, la guardia è cieca');
  assert.doesNotMatch(f, /key==='colorOvr'/, 'setLinkProp tratta ancora colorOvr come un alias di color');
  assert.doesNotMatch(f, /\bl\.color\b/);
});

test('il pannello del cavo mostra il colore del cavo come DATO, e il selettore come scelta', () => {
  const src = leggi('src/app-properties-link.js');
  // Il dato: una riga di sola lettura, con un campione solo se il valore è un esadecimale.
  assert.match(src, /t\('cable\.colorOwn'\)/, 'manca la riga «colore del cavo» (dato, sola lettura)');
  assert.match(src, /t\('cable\.colorOwnNote'\)/, 'manca la frase che dice che il dato non colora la linea');
  assert.match(src, /t\('cable\.colorOverride'\)/, 'il selettore resta');
  // Il dato non ha un campo da compilare: è di sola lettura.
  const i = src.indexOf("t('cable.colorOwn')");
  const riga = src.slice(i, src.indexOf("t('cable.colorOwnNote')"));
  assert.doesNotMatch(riga, /<input|<select|data-change/, 'il colore del cavo è un dato: niente campo da modificare');
});
