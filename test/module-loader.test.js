'use strict';
// Test del seam plugin-moduli generico (server/module-registry.js): registro
// voci di menu, hook di cancellazione progetto, autoloader. Nessun riferimento
// a un modulo specifico: e' infrastruttura feature-agnostica del core pubblico.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const reg = require('../server/module-registry');

test('module-registry: registerNav sanifica le voci e getNav restituisce copie', () => {
  reg.__resetForTests();
  reg.registerNav({ label: 'Alpha', path: '/alpha', icon: 'fa-a' });
  reg.registerNav({ path: '/beta' });                 // niente label/icon -> default
  reg.registerNav({ label: 'X' });                    // niente path -> ignorata
  reg.registerNav(null);                               // spazzatura -> ignorata
  const nav = reg.getNav();
  assert.strictEqual(nav.length, 2, 'solo le voci valide (con path) vengono tenute');
  assert.deepStrictEqual(nav[0], { label: 'Alpha', path: '/alpha', icon: 'fa-a' });
  assert.strictEqual(nav[1].label, 'Module', 'label mancante -> default');
  assert.strictEqual(nav[1].icon, '', 'icon mancante -> stringa vuota');
  nav[0].label = 'MUTATED';
  assert.strictEqual(reg.getNav()[0].label, 'Alpha', 'lo stato interno e immutabile da fuori');
});

test('module-registry: gli hook di delete girano tutti e un hook che lancia e isolato', () => {
  reg.__resetForTests();
  const calls = [];
  reg.registerProjectDeleteHook((id) => calls.push(`a:${id}`));
  reg.registerProjectDeleteHook(() => { throw new Error('boom'); }); // non deve fermare la catena
  reg.registerProjectDeleteHook((id) => calls.push(`b:${id}`));
  reg.registerProjectDeleteHook('non-una-funzione');   // ignorata, nessun throw
  assert.doesNotThrow(() => reg.runProjectDeleteHooks(7));
  assert.deepStrictEqual(calls, ['a:7', 'b:7'], 'i due hook validi girano nonostante quello difettoso');
});

test('loadModules: monta un modulo presente e passa un ctx funzionante', () => {
  reg.__resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-mod-'));
  try {
    const modServer = path.join(dir, 'demo', 'server');
    fs.mkdirSync(modServer, { recursive: true });
    fs.writeFileSync(path.join(modServer, 'index.js'),
      "module.exports = function(app, ctx){\n" +
      "  ctx.registerNav({ label: 'Demo', path: '/demo', icon: 'fa-d' });\n" +
      "  ctx.onProjectDelete(function(id){ app.__deleted = id; });\n" +
      "  app.use('/demo', function(){});\n" +
      "};\n");
    fs.mkdirSync(path.join(dir, 'empty'), { recursive: true }); // dir senza server/index.js -> skip
    const used = [];
    const app = { use: (p) => used.push(p), get: () => {} };
    const ctx = { auth: {}, registerNav: reg.registerNav, onProjectDelete: reg.registerProjectDeleteHook };
    const loaded = reg.loadModules(app, ctx, dir);
    assert.deepStrictEqual(loaded, ['demo'], 'caricato solo il modulo con server/index.js');
    assert.ok(used.includes('/demo'), 'il modulo ha montato la sua route sull app condivisa');
    assert.deepStrictEqual(reg.getNav(), [{ label: 'Demo', path: '/demo', icon: 'fa-d' }]);
    reg.runProjectDeleteHooks(42);
    assert.strictEqual(app.__deleted, 42, 'hook di delete del modulo scattato alla cancellazione');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadModules: cartella assente = no-op (nessun throw, lista vuota)', () => {
  reg.__resetForTests();
  const missing = path.join(os.tmpdir(), 'inp-non-esiste-' + process.pid);
  let loaded;
  assert.doesNotThrow(() => { loaded = reg.loadModules({ use() {}, get() {} }, {}, missing); });
  assert.deepStrictEqual(loaded, []);
});
