'use strict';
// Ogni controllo della testata ha un NOME per chi non vede lo schermo.
//
// Sette ne erano senza (misurato sull'albero di accessibilita' a 1420px; l'ottavo, il tasto che cancella la ricerca, si vede solo scrivendo): i quattro tasti del progetto (nuovo, rinomina,
// duplica, elimina), Annulla, Ripeti e il campo di ricerca. Sono icone: il testo che li spiegava stava nel
// suggerimento (`data-tip`), che e' CSS e uno screen reader non legge; il campo di ricerca aveva solo il segnaposto.
// Il nome e' lo stesso del suggerimento, con la stessa chiave i18n (`data-i18n-aria` = `data-i18n-tip`): non nasce un
// secondo testo da tradurre.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../lib/i18n.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'netmapper.html'), 'utf8');
const testata = (() => {
  // L'elemento vero sta su una riga sua (`<header>`); il nome compare anche nei commenti («fuori da <header>»).
  const apre = [...html.matchAll(/^<header>[ \t]*$/gm)];
  assert.equal(apre.length, 1, 'una sola testata <header> su una riga sua');
  const a = apre[0].index, b = html.indexOf('</header>', a);
  assert.ok(b > a, 'la testata <header>…</header> si chiude');
  return html.slice(a, b);
})();

const attr = (tag, n) => { const m = new RegExp('(?:^|\\s)' + n + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
const testoVisibile = (interno) => interno.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();

// I controlli della testata: i bottoni (con il loro contenuto) e i campi di testo/ricerca.
function controlli() {
  const out = [];
  for (const m of testata.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) out.push({ tipo: 'button', tag: m[1], testo: testoVisibile(m[2]) });
  for (const m of testata.matchAll(/<input\b([^>]*)>/g)) {
    const tipo = attr(m[1], 'type') || 'text';
    if (tipo === 'search' || tipo === 'text') out.push({ tipo: 'input', tag: m[1], testo: '' });
  }
  return out;
}

test('ogni bottone e campo della testata ha un nome: aria-label, o un testo che si vede nel markup', () => {
  const lista = controlli();
  assert.ok(lista.length >= 20, 'la testata ha almeno venti controlli (trovati ' + lista.length + '): la prova non e\' vacua');
  // Le pastiglie di stato (`status-chip`: freschezza, SNMPv3 da configurare, polling automatico) nascono VUOTE e si
  // riempiono a runtime col loro testo («16 h», «Auto 4m»): il nome e' quel testo, quando ci sono.
  const aRuntime = (c) => /\bstatus-chip\b/.test(attr(c.tag, 'class') || '');
  const senza = lista.filter((c) => !(attr(c.tag, 'aria-label') || '').trim() && !c.testo && !aRuntime(c))
    .map((c) => c.tipo + ' ' + (attr(c.tag, 'id') || attr(c.tag, 'data-act') || c.tag.trim().slice(0, 60)));
  assert.deepEqual(senza, [], 'controlli della testata senza nome per uno screen reader: ' + senza.join(' | '));
});

test('gli otto controlli che ne erano senza: il nome e\' quello del suggerimento, con la stessa chiave i18n', () => {
  const attesi = [
    ['data-act="project-new"', 'data-i18n-tip'], ['data-act="project-rename"', 'data-i18n-tip'],
    ['data-act="project-duplicate"', 'data-i18n-tip'], ['data-act="project-delete"', 'data-i18n-tip'],
    ['id="btn-undo"', 'data-i18n-tip'], ['id="btn-redo"', 'data-i18n-tip'],
    ['id="global-search"', 'data-i18n-ph'],
    ['id="global-search-clear"', 'data-i18n-tip'],   // l'ottavo: nascosto finche' non si scrive, quindi fuori dalla misura dei sette
  ];
  for (const [ancora, attrChiave] of attesi) {
    const c = controlli().filter((x) => x.tag.includes(ancora));
    assert.equal(c.length, 1, ancora + ': un solo controllo');
    const chiave = attr(c[0].tag, attrChiave);
    assert.ok(chiave, ancora + ' ha la chiave ' + attrChiave);
    assert.equal(attr(c[0].tag, 'data-i18n-aria'), chiave, ancora + ': data-i18n-aria e\' la stessa chiave del suggerimento / segnaposto');
    assert.ok((attr(c[0].tag, 'aria-label') || '').trim(), ancora + ' ha un aria-label statico (vale prima che la lingua si applichi)');
    for (const lang of ['it', 'en']) assert.ok(i18n._i18nDict[lang][chiave], chiave + ' esiste in ' + lang);
  }
});
