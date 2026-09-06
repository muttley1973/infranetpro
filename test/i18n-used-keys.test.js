// Ogni chiave i18n USATA nel codice esiste nel dizionario.
//
// La parità it/en (i18n.test.js) vede una chiave che manca in UNA lingua, non
// una chiave che manca in TUTT'E DUE: `t('ov.never')` tornava la chiave stessa
// e la Dashboard mostrava «verificato ov.never» su ogni progetto mai verificato
// (smoke 06/09; stessa sorte per `floor.netDup` nel toast della rete doppia).
// Qui si legge il codice come lo legge il browser: ogni `t('chiave')` COMPLETA
// (seguita da `)` o `,`, non da `+`) e ogni `data-i18n="chiave"` statico devono
// avere una voce in italiano. Le chiavi costruite a pezzi (`t('cty.' + x)`)
// restano fuori per costruzione: non si possono enumerare senza eseguirle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { _i18nDict, t, setLang } = require('../lib/i18n.js');

function* jsFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.worktrees|dist|_local/.test(p)) yield* jsFiles(p); }
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && e.name !== 'i18n.js') yield p;
  }
}

function usedKeys() {
  const used = new Map();
  const add = (k, f) => { if (!used.has(k)) used.set(k, new Set()); used.get(k).add(path.relative(ROOT, f)); };
  const sources = [...jsFiles(path.join(ROOT, 'src')), ...jsFiles(path.join(ROOT, 'lib')), path.join(ROOT, 'export.js')];
  // Un `t('key')` dentro un commento è prosa, non codice (app.js: «usano t('key') inline»).
  const inComment = (src, idx) => {
    const prefix = src.slice(src.lastIndexOf('\n', idx) + 1, idx);
    return /(^|\s)\/\//.test(prefix) || /^\s*\*/.test(prefix);
  };
  for (const f of sources) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([^'\n]+)'\s*[),]/g)) if (!inComment(src, m.index)) add(m[1], f);
    for (const m of src.matchAll(/\bt\(\s*"([^"\n]+)"\s*[),]/g)) if (!inComment(src, m.index)) add(m[1], f);
  }
  const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) add(m[1], path.join(ROOT, 'netmapper.html'));
  return used;
}

function exists(key) {
  const it = _i18nDict && _i18nDict.it;
  if (it && typeof it === 'object') return Object.prototype.hasOwnProperty.call(it, key);
  setLang('it');
  return t(key) !== key;   // fallback: una chiave assente torna se stessa
}

test('i18n: ogni chiave usata letteralmente nel codice ha una voce nel dizionario', () => {
  const used = usedKeys();
  assert.ok(used.size > 1000, 'il corpus è quello vero (chiavi trovate: ' + used.size + ')');
  const mancanti = [...used.keys()].filter(k => !exists(k));
  assert.deepEqual(
    mancanti.map(k => k + '  <- ' + [...used.get(k)].join(', ')),
    [],
    'chiavi usate ma non definite: il browser le mostrerebbe NUDE',
  );
});

test('i18n: le due chiavi dello smoke 06/09 esistono in entrambe le lingue', () => {
  for (const lang of ['it', 'en']) {
    setLang(lang);
    assert.notEqual(t('ov.never'), 'ov.never', lang);
    assert.match(t('floor.netDup', { cidr: '10.0.0.0/24' }), /10\.0\.0\.0\/24/, lang);
  }
  setLang('it');
});
