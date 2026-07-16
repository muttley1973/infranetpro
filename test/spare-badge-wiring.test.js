'use strict';
// REGRESSIONE: il chip di stato "Porte libere" in header (× = spegni evidenziazione)
// deve restare CABLATO. Il bug: usava onclick="setSpareHighlight(false)" ma la fn è
// module-scoped (NON esposta su window dopo la migrazione ESM/ASSE-B) → ReferenceError,
// badge morto. Fix = data-act="spare-highlight-off" + azione registrata in app-spare.js.
// Questo test lega le DUE metà (HTML ↔ registrazione) così non si può ri-rompere una
// senza l'altra. Statico (legge i sorgenti): la harness DOM non simula il click delegato.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
const SPARE = fs.readFileSync(path.join(ROOT, 'src', 'app-spare.js'), 'utf8');

const ACTION = 'spare-highlight-off';

test('il chip "Porte libere" usa data-act (delegation), NON un onclick inline rotto', () => {
  // Estrae il tag <button ... id="spare-active-badge" ...>
  const m = HTML.match(/<button[^>]*id="spare-active-badge"[^>]*>/);
  assert.ok(m, 'il badge #spare-active-badge esiste in netmapper.html');
  const tag = m[0];
  assert.ok(tag.includes(`data-act="${ACTION}"`),
    `il badge deve portare data-act="${ACTION}" (event delegation)`);
  assert.ok(!/onclick=/.test(tag),
    'il badge NON deve avere un onclick inline (fn module-scoped → ReferenceError)');
});

test('app-spare.js registra l azione del chip in registerClickActions', () => {
  assert.ok(SPARE.includes(`'${ACTION}'`) || SPARE.includes(`"${ACTION}"`),
    `app-spare.js deve registrare l azione "${ACTION}"`);
  // …e deve spegnere l evidenziazione (setSpareHighlight(false)).
  assert.match(SPARE, /setSpareHighlight\(false\)/,
    'l azione del chip deve chiamare setSpareHighlight(false)');
});
