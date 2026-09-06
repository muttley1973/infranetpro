// undo/redo ripristinano uno stato DIVERSO da quello salvato: devono accendere
// «Salva» (markDirty) come qualunque altra modifica. Smoke 06/09: dopo Ctrl+S e
// Ctrl+Z il bottone restava pulito, l'autosave non partiva e al reload tornava
// la versione modificata dal server. Guardia statica sul sorgente del modulo
// (src/ è ESM per il browser: qui si legge il testo, come bridge-ratchet).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-history.js'), 'utf8');

function bodyOf(name) {
  const m = new RegExp('export function ' + name + '\\(\\) \\{([\\s\\S]*?)\\n\\}', 'm').exec(src);
  assert.ok(m, 'funzione ' + name + ' trovata in src/app-history.js');
  return m[1];
}

test('undo e redo chiamano markDirty()', () => {
  assert.match(bodyOf('undo'), /\bmarkDirty\(\)/, 'undo accende «Salva»');
  assert.match(bodyOf('redo'), /\bmarkDirty\(\)/, 'redo accende «Salva»');
});

test('pushHistory NON chiama markDirty (è chi modifica a farlo, non lo snapshot)', () => {
  assert.doesNotMatch(bodyOf('pushHistory'), /\bmarkDirty\(\)/);
});
