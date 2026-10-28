'use strict';
// ============================================================
// GUARDIA — «questo apparato si interroga con SNMP?» deve restare UNA domanda sola
// ============================================================
// La classe di bug più ricorrente del progetto: lo stesso concetto definito in più
// punti che poi divergono. Questa domanda era scritta a mano in 17 punti di 13 file —
// e due copie, in lib/overview.js e lib/subbar-stats.js, dicevano «una definizione
// sola» nel commento sopra due funzioni identiche. Un commento non è una guardia.
//
// Questa guardia non prova un comportamento (lo fa test/snmp-target.test.js): prova
// che la REGOLA non si sia duplicata. Fuori da lib/snmp-target.js nessuno deve
// chiedere «il driver comincia per snmp?» o ricomporre a mano «host oppure IP».
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// L'unico modulo autorizzato a rispondere.
const PROPRIETARIO = 'lib/snmp-target.js';

/** I sorgenti che compongono l'app (no dist/, no node_modules, no test). */
function sorgenti() {
  const out = [];
  const giro = (rel) => {
    for (const nome of fs.readdirSync(path.join(ROOT, rel))) {
      const r = rel + '/' + nome;
      const st = fs.statSync(path.join(ROOT, r));
      if (st.isDirectory()) giro(r);
      else if (nome.endsWith('.js')) out.push(r);
    }
  };
  for (const d of ['src', 'lib', 'server', 'drivers', 'engine']) giro(d);
  out.push('export.js');
  return out;
}

// Le forme con cui la domanda veniva riscritta. Ognuna ha la sua controprova.
const FORME = [
  { nome: 'startsWith(\'snmp\')',    re: /startsWith\(\s*['"]snmp['"]\s*\)/,                       spia: "if(!(cfg.driver || '').startsWith('snmp')) return false;" },
  { nome: 'indexOf(\'snmp\') === 0', re: /indexOf\(\s*['"]snmp['"]\s*\)\s*(?:===?|!==?)\s*0/,      spia: "return _str(integ.driver).indexOf('snmp') === 0 && !!host;" },
  { nome: '/^snmp/',                 re: /\/\^snmp\//,                                              spia: "const isSnmp = /^snmp/i.test(driver);" },
  // «a quale host interrogo» ricomposto a mano da chi ha l'integrazione in `cfg`. (Altri file
  // ricompongono «integration.host oppure ip» per ALTRE domande — l'indirizzo di un nodo nella
  // Verifica, per esempio — e non sono questa: la forma qui sotto è quella del poller.)
  { nome: 'cfg.host || n.ip',       re: /\bcfg\.host\s*\|\|\s*\w+\.ip\b/,                            spia: "const host = (cfg.host || n.ip || '').trim();" },
];

test('SNMP target: nessuno riscrive «il driver è SNMP» o «a quale host»: lo chiede a lib/snmp-target.js', () => {
  const files = sorgenti();
  // Il cricchetto non deve poter passare a vuoto.
  assert.ok(files.length > 150, `corpus troppo piccolo (${files.length} file): la guardia sarebbe vacua`);
  assert.ok(files.includes(PROPRIETARIO) && files.includes('export.js') && files.some((f) => f.startsWith('src/')),
    'la scansione deve coprire almeno il proprietario, export.js e src/');
  // Controprova del riconoscitore: la riga che il difetto produrrebbe DEVE essere
  // riconosciuta (altrimenti la guardia è verde perché non sa cosa cercare).
  for (const f of FORME) assert.ok(f.re.test(f.spia), `il riconoscitore «${f.nome}» non vede più la forma del difetto`);

  const colpevoli = [];
  for (const rel of files) {
    if (rel === PROPRIETARIO) continue;
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((riga, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(riga)) return;          // commenti: parlano, non eseguono
      for (const f of FORME) if (f.re.test(riga)) colpevoli.push(`${rel}:${i + 1}  [${f.nome}]  ${riga.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(colpevoli, [],
    'La domanda «si interroga con SNMP?» si chiede a lib/snmp-target.js (isSnmpDriver, hasSnmpDriver, hasSnmpTarget, snmpTargetHost). ' +
    'Riscritta a mano diverge: è già successo, e il conteggio dell\'app e l\'API dicevano numeri diversi.\n' + colpevoli.join('\n'));
});

test('SNMP target: il proprietario è caricato PRIMA di chi lo legge come globale (netmapper.html)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
  const pos = (lib) => html.indexOf(`<script src="/lib/${lib}"></script>`);
  const mio = pos('snmp-target.js');
  assert.ok(mio > 0, 'lib/snmp-target.js non è caricata da netmapper.html');
  // Le lib che il browser carica come <script> e che la usano a call-time.
  for (const lib of ['topology-plan.js', 'project-networks.js', 'snmp-silence.js', 'drift-snapshot.js', 'subbar-stats.js']) {
    const p = pos(lib);
    assert.ok(p > 0, `${lib} non è più un <script> di netmapper.html: aggiorna questa prova`);
    assert.ok(mio < p, `lib/snmp-target.js deve stare PRIMA di ${lib} in netmapper.html`);
  }
});
