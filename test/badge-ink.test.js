'use strict';
// ============================================================
// CONTRASTO DEI BADGE A FONDO PIENO
// ============================================================
// I badge che dicono la provenienza di un cavo (linkstate, protocollo) e il suo
// stato-di-prova sono pastiglie a FONDO PIENO. Fino al 2026-08-31 scrivevano
// `color:#fff` fisso, e quattro dei fondi non reggevano la soglia AA col bianco
// sopra. Il peggiore era il piu' grave nel merito: `#f5a623`, «Inferito · da
// verificare», a 2,03:1 — cioe' il badge che avverte «non fidarti di questo
// cavo» era il meno leggibile di tutti.
//
// La cura non ha cambiato un colore: `badgeInk()` (src/app-util.js) sceglie
// l'inchiostro confrontando i due contrasti. Questo test tiene la promessa.
//
// ⚠️ I COLORI NON SONO ELENCATI QUI: si LEGGONO dalle tabelle nel sorgente. Se
// domani si aggiunge un badge con un fondo nuovo, questo test lo prende da solo.
// Elencarli qui vorrebbe dire che il verde non dimostra piu' niente — un lato
// deriva, l'altro enumera, e il buco non si vede.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const AA = 4.5;   // WCAG 2.1 AA, testo normale

/** Tutti i fondi hex delle tabelle di colore dei badge, letti dal sorgente. */
function badgeBackgrounds() {
  const found = new Map();   // hex -> da dove viene
  const sorgenti = [
    // app.js: _CABLE_PROOF_BADGE = { 'derived-strong': { key:…, color:'#1a7f37' }, … }
    ['src/app.js', /_CABLE_PROOF_BADGE\s*=\s*\{[\s\S]*?\n\};/],
    // app-properties-link.js: _lsCol = {…} e _lsProtoCol = … ? '#…' : …
    ['src/app-properties-link.js', /const\s+_lsCol\s*=\s*\{[^}]*\};/],
    ['src/app-properties-link.js', /const\s+_lsProtoCol\s*=[^;]*;/],
  ];
  for (const [rel, rx] of sorgenti) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const blocco = src.match(rx);
    assert.ok(blocco, `tabella colori non trovata in ${rel}: la guardia sarebbe cieca`);
    for (const m of blocco[0].matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      if (!found.has(m[0])) found.set(m[0], rel);
    }
  }
  return found;
}

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

test('badge a fondo pieno: ogni colore raggiunge la soglia AA con l\'inchiostro scelto', async () => {
  const { badgeInk } = await import(pathToFileURL(path.join(ROOT, 'src', 'app-util.js')).href);
  const fondi = badgeBackgrounds();
  assert.ok(fondi.size >= 8, `letti solo ${fondi.size} fondi: le tabelle sono cambiate di forma e la guardia non le vede piu'`);

  const bocciati = [];
  for (const [hex, dove] of fondi) {
    const cr = contrast(badgeInk(hex), hex);
    if (cr < AA) bocciati.push(`  ${hex} (${dove}): ${cr.toFixed(2)}:1 con ${badgeInk(hex)}`);
  }

  assert.deepStrictEqual(bocciati, [],
    `${bocciati.length} fondi di badge non arrivano a ${AA}:1 con nessuno dei due inchiostri.\n` +
    `Non basta girare il testo: quel COLORE va scelto piu' scuro o piu' chiaro.\n` + bocciati.join('\n'));
});

test('badgeInk: sceglie l\'inchiostro col contrasto migliore, non una soglia', async () => {
  const { badgeInk } = await import(pathToFileURL(path.join(ROOT, 'src', 'app-util.js')).href);

  // I due estremi: il bianco non puo' che volere inchiostro scuro, e viceversa.
  assert.strictEqual(badgeInk('#ffffff'), '#0d1117');
  assert.strictEqual(badgeInk('#000000'), '#fff');

  // Il caso che aveva smascherato la prima versione a soglia fissa: #bf8700
  // ha luminanza 0,28 — sotto lo 0,45 che avevo scritto, e quindi prendeva il
  // bianco e restava a 3,14:1.
  assert.strictEqual(badgeInk('#bf8700'), '#0d1117');
  assert.ok(contrast(badgeInk('#bf8700'), '#bf8700') > AA);

  // Un valore che non e' un hex non si puo' misurare: si risponde bianco, cioe'
  // quello che il codice faceva prima di questa funzione.
  for (const v of ['var(--accent)', 'rgba(0,0,0,.5)', 'red', '', null, undefined]) {
    assert.strictEqual(badgeInk(v), '#fff');
  }
});
