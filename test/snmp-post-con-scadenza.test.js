'use strict';
// Ogni lettura SNMP dal browser passa da `postSnmpRead` (scadenza lato client): mai un `fetch` nudo su /api/poll.
//
// `postSnmpRead` esiste da quando una risposta che non tornava teneva acceso per sempre `_snmpSyncing` («Salva» spento,
// Verifica muta). Due punti l'avevano saltata e restavano senza tetto: il giro dell'auto-link (src/app-autolink.js) e
// la lettura SNMP di una VM (src/app-hypervisor.js) — un apparato che non risponde li lasciava appesi per sempre.
// Questa guardia non prova un comportamento: prova che la REGOLA («si passa da postSnmpRead») non si sia persa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const file = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// Un `fetch(` con un indirizzo di lettura SNMP scritto per esteso: apice, doppio apice o backtick, anche con altro dopo.
const FETCH_NUDO = /\bfetch\(\s*['"`]\/api\/poll(?:-power)?(?:['"`?/])/;

test('la guardia riconosce la forma del difetto (controprova)', () => {
  for (const spia of [
    "const r = await fetch('/api/poll', { method: 'POST', body });",
    'const r = await fetch("/api/poll-power", { method:"POST" });',
    "await fetch(`/api/poll`, { method: 'POST' });",
    "const r = await fetch('/api/poll?x=1');",
  ]) assert.ok(FETCH_NUDO.test(spia), 'il riconoscitore non vede piu\': ' + spia);
  assert.ok(!FETCH_NUDO.test("const d = await postSnmpRead('/api/poll', body);"), 'postSnmpRead non e\' un fetch nudo');
  assert.ok(!FETCH_NUDO.test("fetch('/api/pollution')"), 'un altro indirizzo non e\' /api/poll');
});

test('nessun sorgente del browser fa `fetch` nudo su /api/poll o /api/poll-power', () => {
  const colpevoli = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).filter((f) => FETCH_NUDO.test(file(f)));
  assert.deepEqual(colpevoli, [], 'passate da postSnmpRead (src/app-snmp.js), che ha la scadenza lato client: ' + colpevoli.join(', '));
});

test('i due punti che lo saltavano la usano, e la importano da app-snmp', () => {
  for (const f of ['app-autolink.js', 'app-hypervisor.js']) {
    const t = file(f);
    assert.match(t, /\bpostSnmpRead\('\/api\/poll'/, f + ' legge con postSnmpRead');
    assert.match(t, /import\s*\{[^}]*\bpostSnmpRead\b[^}]*\}\s*from\s*'\.\/app-snmp\.js'/, f + ' importa postSnmpRead da app-snmp.js');
  }
});
