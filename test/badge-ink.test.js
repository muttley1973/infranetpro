'use strict';
// ============================================================
// CONTRASTO — e l'invariante che ha preso il posto della copertura
// ============================================================
// Questo file nasce il 2026-08-31 su un difetto misurato: i badge del cavo erano
// pastiglie a FONDO PIENO che scrivevano `color:#fff` fisso, e quattro dei fondi
// non reggevano la soglia AA col bianco sopra. Il peggiore era il piu' grave nel
// merito: `#f5a623`, «Inferito · da verificare», a 2,03:1 — cioe' il badge che
// avverte «non fidarti di questo cavo» era il meno leggibile di tutti.
//
// ⭐ LA CURA E' CAMBIATA DUE VOLTE, e la seconda ha tolto il problema invece di
//    misurarlo meglio. Prima `badgeInk()` sceglieva l'inchiostro confrontando i
//    due contrasti (il fondo restava scelto a mano). Poi e' arrivata la notazione
//    unica: un grado definisce UN inchiostro preso dai token, e tinta, bordo e
//    pallino si ricavano da `currentColor` con `color-mix`. Non esiste piu' un
//    fondo pieno scelto a mano, quindi non esiste piu' la domanda «cosa ci scrivo
//    sopra» — e il 04/09, con l'ultima tabella (`_CABLE_PROOF_BADGE`), se n'e'
//    andato anche `badgeInk`, che serviva solo a quello.
//
// ⚠️ Quando una copertura perde il suo soggetto NON si cancella: si converte in
//    un invariante che vieta al soggetto di tornare. Le due prove sui contrasti
//    dei fondi pieni sono diventate l'ultimo test di questo file. Se domani serve
//    davvero un badge a fondo pieno, `badgeInk` e le sue prove stanno nella storia
//    di git e vanno rimessi INSIEME — non uno senza l'altra.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AA = 4.5;   // WCAG 2.1 AA, testo normale

function relLuminance(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const chan = (i) => {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

function contrast(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── ④ L'ACCENT SOPRA UNA TINTA DI SE STESSO (`.toolbar-btn.soft`) ───────────
// Stessa famiglia dei badge, difetto opposto: qui il colore non e' un fondo
// pieno ma una TINTA translucida del testo stesso, quindi il contrasto dipende
// da cosa c'e' SOTTO. Nel tema scuro reggeva (7,73:1); nel chiaro no — 4,11:1,
// sotto la soglia — e la classe non e' inerte: la usano `#audit-export` e
// un'azione del pannello collegamento.
// ⚠️ Non era ancora un difetto vivo (manca l'interruttore del tema chiaro): e'
// una mina che scoppia il giorno che lo si rimette. Questa e' la guardia che la
// disinnesca prima, e i valori si LEGGONO dai token — se un tema domani cambia
// accent, il test lo segue da solo.

/** I token di un tema, letti dal blocco che li definisce in 01-tokens.css. */
function temaTokens(selettore) {
  const css = fs.readFileSync(path.join(ROOT, 'styles', '01-tokens.css'), 'utf8');
  const i = css.indexOf(selettore);
  assert.ok(i >= 0, 'blocco non trovato: ' + selettore);
  // Fino alla graffa di chiusura del blocco (i blocchi dei token non annidano).
  const blocco = css.slice(i, css.indexOf('\n        }', i));
  const val = (nome) => {
    const m = blocco.match(new RegExp('--' + nome + '\\s*:\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  return val;
}

/** `rgba(r,g,b,a)` steso sopra un hex → l'hex del risultato. Una tinta non e'
 *  un colore: e' una lastra, e finche' non si sa cosa c'e' sotto non si puo'
 *  dire quanto contrasta. */
function componi(rgba, sottoHex) {
  const m = String(rgba).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  assert.ok(m, 'non e\' un rgba: ' + rgba);
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  const sotto = [1, 3, 5].map(i => parseInt(sottoHex.slice(i, i + 2), 16));
  const v = [1, 2, 3].map((k, i) => Math.round(parseInt(m[k], 10) * a + sotto[i] * (1 - a)));
  return '#' + v.map(x => x.toString(16).padStart(2, '0')).join('');
}

for (const [nome, selettore] of [['scuro', ':root {'], ['chiaro', 'html[data-theme="light"] {']]) {
  test(`⚠️ .toolbar-btn.soft resta leggibile nel tema ${nome}`, () => {
    const val = temaTokens(selettore);
    const tinta = val('accent-soft');
    const sotto = val('surface-2');
    let ink = val('accent-on-soft');
    assert.ok(tinta && sotto && ink, `token mancanti nel tema ${nome}: il bottone .soft li usa tutti e tre`);
    // Nel tema scuro il token rimanda all'accent: si segue il rimando invece di
    // duplicare il valore, se no la prova enumera cio' che il codice deriva.
    if (/^var\(/.test(ink)) ink = val(ink.replace(/^var\(\s*--|\s*\)$/g, ''));
    const fondo = componi(tinta, sotto);
    const c = contrast(ink, fondo);
    assert.ok(c >= AA,
      `tema ${nome}: ${ink} su ${fondo} (tinta ${tinta} sopra ${sotto}) = ${c.toFixed(2)}:1, serve ${AA}`);
  });
}

// ⭐ L'INVARIANTE CHE SOSTITUISCE LA COPERTURA RITIRATA — su TUTT'E DUE le
// superfici che parlano della certezza di un cavo.
// La riga «Stato» del pannello montava fino a cinque segni, tre col fondo scritto
// A MANO nel punto in cui si disegnava; la lista «Cavi» della Panoramica montava
// il sesto vocabolario (Forte · Debole · Fantasma · Da rivedere · Porta spenta ·
// Dichiarato) con la sua tabella di colori. Oggi nessuna delle due sceglie un
// colore: usano le pastiglie `.cty-*`, che prendono tinta, bordo e inchiostro
// dallo stesso token via color-mix.
// ⚠️ Le due superfici si ELENCANO qui, e l'elenco e' il punto debole della prova:
//    se ne nasce una terza va aggiunta. Il presidio contro la dimenticanza sta nel
//    caso qui sotto, che vieta il RITORNO della funzione vecchia ovunque — quello
//    invece non si puo' dimenticare, perche' cerca in tutto `src/`.
for (const rel of ['src/app-properties-link.js', 'src/app-overview.js']) {
  test(`⚠️ ${rel} non torna a dipingersi i badge della certezza a mano`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Le tabelle di colore ritirate non devono ricomparire.
    assert.ok(!/const\s+_lsCol\s*=/.test(src), '_lsCol e\' tornata: i colori dei badge sono di nuovo scelti nel renderer');
    assert.ok(!/const\s+_lsProtoCol\s*=/.test(src), '_lsProtoCol e\' tornata: idem');
    // E la superficie deve continuare a montare la pastiglia della notazione unica.
    assert.ok(/cty-pill/.test(src), `${rel}: la pastiglia .cty-pill non c'e' piu', la superficie e' tornata a un alfabeto suo`);
    // ⚠️ Nessun fondo hex scritto a mano dentro un badge di certezza. Restano
    // ammessi i colori del chip TRUNK/ACCESS, che e' l'asse IDENTITA', non la certezza.
    const badgeHex = [...src.matchAll(/class="(?:link-state-badge|cable-proof-badge|cty-pill)[^"]*"[^>]*background:\s*(#[0-9a-fA-F]{3,6})/g)];
    assert.deepStrictEqual(badgeHex.map((m) => m[1]), [],
      `un badge di certezza in ${rel} ha di nuovo un fondo hex scritto a mano`);
  });
}

// ⚠️ E il SESTO VOCABOLARIO non rientra da nessuna porta. Questo caso non elenca
// superfici: cerca in tutto `src/` e in `lib/i18n.js`, quindi non lo si puo'
// aggirare aggiungendo un file nuovo.
test('⚠️ il badge di stato-di-prova (Forte/Debole/Fantasma/…) non torna', () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(path.join(ROOT, 'src'));
  files.push(path.join(ROOT, 'lib', 'i18n.js'));
  assert.ok(files.length > 20, `letti solo ${files.length} file: la guardia sarebbe cieca`);

  const colpevoli = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // Solo il CODICE: i commenti raccontano perche' e' stato tolto, e devono poterlo dire.
    const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (/_CABLE_PROOF_BADGE|_cableProofBadgeHtml|['"]proof\.badge\./.test(senzaCommenti)) {
      colpevoli.push(path.relative(ROOT, f));
    }
  }
  assert.deepStrictEqual(colpevoli, [],
    'il badge di stato-di-prova e\' tornato: e\' un SESTO vocabolario per «quanto mi fido di questo?»,\n' +
    'che lib/certainty.js risponde con sei parole sole. Se il ritorno e\' voluto, togli questa guardia\n' +
    'dicendo perche\' — e rimetti anche badgeInk con le sue prove di contrasto.\n' + colpevoli.join('\n'));
});
