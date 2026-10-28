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
  const m = new RegExp('export function ' + name + '\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}', 'm').exec(src);
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

// ── Il giro SILENZIOSO del monitor non è un'operazione dell'utente ───────────────
// pollAllSNMP() faceva pushHistory() sempre: il monitoraggio automatico (dataOnly, o la Verifica programmata, silent)
// lasciava un punto di annulla per ogni giro — il primo Ctrl+Z annullava un aggiornamento invisibile, e un giro dopo
// un annulla buttava il ripeti. Il giro a richiesta («Sincronizza ora») resta UN passo.
test('pollAllSNMP: il giro silenzioso non registra un punto di annulla, quello a richiesta sì', async () => {
  const { loadApp, run } = require('../tools/smoke-dom-stub.js');
  const { ctx } = loadApp(path.join(__dirname, '..'));
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'nessuna risposta' }), text: () => Promise.resolve('') });
  run(ctx, `state.nodes.length = 0; state.nodes.push({ id: 'sw1', type: 'switch', name: 'SW1', x: 10, y: 10, ports: 4, ip: '10.0.0.1',
    integration: { driver: 'snmp-v2c', host: '10.0.0.1', community: 'public' } }); _history = []; _histIdx = -1;`);
  const punti = () => run(ctx, '_history.length');
  assert.equal(punti(), 0, 'setup: storia vuota');
  await run(ctx, 'pollAllSNMP({ dataOnly: true })');
  assert.equal(punti(), 0, 'monitoraggio automatico «leggero» (dataOnly): nessun punto');
  await run(ctx, 'pollAllSNMP({ silent: true, deferPresence: false })');
  assert.equal(punti(), 0, 'Verifica programmata (silent): nessun punto');
  await run(ctx, 'pollAllSNMP()');
  assert.equal(punti(), 1, 'il giro chiesto dall’utente è UN passo annullabile');
});
