'use strict';
// M9 — a11y dei tool-modal + regressione del ramo Escape.
//
// ① I modali devono restare accessibili: role=dialog + aria-modal + un
//    aria-labelledby che RISOLVE davvero. Se qualcuno aggiunge un 12° modale
//    senza ARIA, questo test lo becca.
// ② Nessun `id` duplicato nello stesso tag: durante l'aggiunta degli ARIA un
//    `<h3 id="vm-title">` ha rischiato di diventare `id="…" id="vm-title"` →
//    il browser tiene il PRIMO e `getElementById('vm-title')` (usato da
//    app-vlan-autopoll.js) sarebbe tornato null, rompendo il titolo del modale.
// ③ Regressione Escape: `clearSearch` DEVE essere esportata e importata da
//    app.js. Era module-local e la chiamata bare lanciava ReferenceError sulla
//    PRIMA riga del ramo Escape → tutto il resto (uscita instradamento cavo,
//    cancelLag, _cancelLink, deselezione) era codice morto.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const SEARCH = fs.readFileSync(path.join(ROOT, 'src', 'app-search-zoom-rack.js'), 'utf8');

const ids = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

test('M9: ogni tool-modal ha role=dialog + aria-modal', () => {
  const overlays = [...HTML.matchAll(/<div id="([\w-]+)-overlay"[^>]*\bclass="tool-modal-overlay"/g)];
  assert.ok(overlays.length >= 11, `attesi >=11 tool-modal, trovati ${overlays.length}`);
  const dialogs = [...HTML.matchAll(/role="dialog"/g)];
  assert.equal(dialogs.length, overlays.length,
    'ogni overlay deve avere il suo [role="dialog"] (aggiunto un modale senza ARIA?)');
  assert.equal([...HTML.matchAll(/aria-modal="true"/g)].length, overlays.length,
    'ogni dialog deve avere aria-modal="true"');
});

test('M9: ogni aria-labelledby risolve a un id esistente', () => {
  const refs = [...HTML.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 11, 'attesi almeno 11 aria-labelledby');
  const orphans = refs.filter(r => !ids.has(r));
  assert.deepEqual(orphans, [], `aria-labelledby orfani: ${orphans.join(', ')}`);
});

test('M9: nessun tag con `id` duplicato (romperebbe getElementById)', () => {
  const dup = [...HTML.matchAll(/<[a-z][^>]*\bid="[^"]*"[^>]*\bid="[^"]*"[^>]*>/gi)].map(m => m[0].slice(0, 80));
  assert.deepEqual(dup, [], `tag con id duplicato: ${dup.join(' | ')}`);
});

test('M9: il titolo del modale VLAN resta raggiungibile come vm-title', () => {
  // app-vlan-autopoll.js fa getElementById('vm-title').textContent = …
  assert.ok(ids.has('vm-title'), 'id vm-title deve esistere in netmapper.html');
});

test('Escape: clearSearch è esportata e importata da app.js (no bare ReferenceError)', () => {
  assert.match(SEARCH, /export function clearSearch\s*\(/,
    'app-search-zoom-rack.js deve ESPORTARE clearSearch');
  assert.match(APP, /import\s*\{[^}]*\bclearSearch\b[^}]*\}\s*from\s*'\.\/app-search-zoom-rack\.js'/,
    'app.js deve IMPORTARE clearSearch (era una chiamata bare → ReferenceError)');
});

test('Escape: un tool-modal aperto ha la priorità (closeTopToolModal prima del resto)', () => {
  const esc = APP.slice(APP.indexOf("if (e.key==='Escape')"));
  const iClose = esc.indexOf('closeTopToolModal');
  const iSearch = esc.indexOf('clearSearch()');
  assert.ok(iClose > -1, 'il ramo Escape deve chiamare closeTopToolModal()');
  assert.ok(iClose < iSearch, 'closeTopToolModal() deve venire PRIMA del resto del ramo');
});
