'use strict';
// ============================================================
// Due voci minori rimaste aperte (STATO_PIANO gruppo F), chiuse insieme perché
// hanno la stessa forma: una cosa che il codice DECIDE tardi, e si vede.
//
//   ① La griglia della planimetria LAMPEGGIAVA al caricamento: il CSS la
//      disegnava subito, e `paintFloorGrid` la spegneva solo dopo che il
//      progetto era arrivato. Un progetto salvato con la griglia spenta la
//      mostrava per tutta la fetch e poi la faceva sparire.
//   ② Le stringhe italiane in `export.js` non seguivano la lingua scelta. Erano
//      rimaste indietro «per rischio golden» — misurato: NESSUNA di loro finisce
//      in un file esportato. Le intestazioni del CSV sono le CHIAVI, non queste
//      etichette (v. `_csvColumnsFor`).
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const leggi = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { _i18nDict: I18N } = require('../lib/i18n.js');

// ── ① La griglia ────────────────────────────────────────────────────────────
test('① il motivo della griglia lo accende una CLASSE, non il CSS di default', () => {
  const css = leggi('styles/04-floor-rack.css');
  const regola = /#floorplan-grid \{[^}]*\}/.exec(css);
  assert.ok(regola, 'la regola base c\'è');
  assert.doesNotMatch(regola[0], /background-image/,
    'la regola base NON disegna: se disegnasse, la griglia esisterebbe prima che lo stato sia noto');
  assert.match(css, /body\.grid-on #floorplan-grid \{[^}]*background-image/,
    'il motivo arriva con la classe sul body');
  // Il riquadro resta comunque (posizione e misura non dipendono dallo stato):
  // sparisce il DISEGNO, non l'elemento — o si perderebbero le misure che il
  // banco e2e fa su di lui.
  assert.match(regola[0], /position:absolute;\s*inset:0/);
});

test('① chi accende resta UNO, e non scrive più style.display', () => {
  const src = leggi('src/app-search-zoom-rack.js');
  const f = /export function paintFloorGrid\(\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(f, 'corpo trovato');
  assert.match(f[0], /classList\.toggle\('grid-on', !store\.state\.gridHidden\)/);
  // ⚠️ Si guarda il CODICE, non i commenti: la prima stesura di questa riga
  // andava rossa sulla prosa che SPIEGA il fix («non uno style.display scritto
  // qui»). Una guardia che legge i commenti accusa il codice giusto.
  const codice = f[0].split('\n').filter((r) => !/^\s*\/\//.test(r)).join('\n');
  assert.doesNotMatch(codice, /style\.display/, 'la visibilità la dichiara il CSS, non uno stile inline');
  // Una sola funzione decide: se ne comparisse una seconda, i due lati
  // divergerebbero al primo cambio (è il difetto più caro di questo repo).
  assert.equal((src.match(/classList\.toggle\('grid-on'/g) || []).length, 1);
});

// ── ② Le stringhe di export.js ──────────────────────────────────────────────
const EXPORT = leggi('export.js');

test('② nessuna frase italiana resta cablata nel sorgente', () => {
  // Le parole cercate sono quelle che c'erano davvero: se domani ne rientra una,
  // questa riga la trova. (Il glossario — VLAN, PDF, CSV — non è italiano.)
  const spie = /(Seleziona|Nessun cavo|Errore server|Esportazione|fallita|Etichetta \(ID\)|Lunghezza|Permanente\/bretella|Installato (il|da)|Stanza)/;
  const righe = EXPORT.split('\n')
    .map((s, i) => [i + 1, s])
    .filter(([, s]) => spie.test(s) && !/^\s*(\/\/|\*)/.test(s));
  assert.deepEqual(righe, [], 'stringhe italiane ancora nel codice: ' + JSON.stringify(righe));
});

test('② ogni chiave usata da export.js esiste in TUTT\'E DUE le lingue', () => {
  // Derivata dal file, non riscritta a mano: se qualcuno aggiunge una `_t(...)`
  // con un refuso, la prova lo dice invece di lasciarlo comparire a schermo come
  // «impexp.qualcosa» (t() ritorna la chiave quando non la trova).
  const usate = [...EXPORT.matchAll(/_t\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(usate.length >= 20, 'le chiavi si contano dal file: ' + usate.length);
  for (const k of new Set(usate)) {
    assert.ok(I18N.it[k], `manca in it: ${k}`);
    assert.ok(I18N.en[k], `manca in en: ${k}`);
    assert.notEqual(I18N.it[k], I18N.en[k], `${k}: tradotta, non copiata`);
  }
});

test('② una guardia sola, e il ripiego è una FRASE (mai il vuoto)', () => {
  assert.equal((EXPORT.match(/typeof t ?=== ?'function'/g) || []).length, 1,
    'la guardia su `t` sta in un posto solo: era sparsa in due punti con due forme');
  // Ogni `_t` porta il suo ripiego: export.js è uno <script> classic, e se
  // qualcuno lo caricasse senza i18n la frase deve restare una frase.
  const senzaRipiego = [...EXPORT.matchAll(/_t\('[^']+'\s*\)/g)];
  assert.deepEqual(senzaRipiego.map((m) => m[0]), [], 'ogni _t() dichiara il suo ripiego');
});

test('② le etichette dei campi si rileggono a ogni chiamata (la lingua cambia a runtime)', () => {
  assert.match(EXPORT, /const LABEL_FIELDS = \(\) => \[/,
    'è una funzione, non una costante: una costante avrebbe congelato la lingua del primo caricamento');
  assert.equal((EXPORT.match(/LABEL_FIELDS\(\)/g) || []).length, 2, 'e i due chiamanti la invocano');
});

test('② ciò che esce nel CSV NON sono queste etichette (perciò nessun golden si muove)', () => {
  // È la misura che ha sbloccato il lavoro: la nota diceva «rischia il golden».
  // Le intestazioni del CSV vengono da `_csvColumnsFor`, che usa le CHIAVI.
  const f = /function _csvColumnsFor[\s\S]*?\n\}/.exec(EXPORT);
  assert.ok(f, 'corpo trovato');
  assert.doesNotMatch(f[0], /LABEL_FIELDS/, 'le colonne non passano dalle etichette a schermo');
  assert.match(f[0], /add\('installato_il'/, 'ma dalle chiavi, che restano invariate');
});
