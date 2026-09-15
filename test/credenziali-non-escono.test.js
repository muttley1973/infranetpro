'use strict';
// ============================================================
//  LE CREDENZIALI SNMP NON ESCONO DALL'INSTALLAZIONE
// ============================================================
// Chi scarica InfraNet e lo usa mette community e password SNMPv3 nei suoi
// progetti. Le barriere verso fuori esistono già e hanno le loro prove: REST API
// (api-shape, api-v1), contesto AI (ai-context), dossier PDF (pdf-report), export
// portatile (project-format), lettore non-admin (security-hardening).
//
// Qui le due strade che il giro del 15/09 ha trovato SENZA una prova:
//   ① il download «infranet-backup.json» aveva un ripiego che, se la redazione
//     non si fosse caricata, scaricava lo state GREZZO, credenziali comprese;
//   ② il pannello della VM mostrava la community in un campo di testo, in
//     chiaro: uno screenshot allegato a una segnalazione la pubblica.
//
// ⚠️ I nomi delle credenziali NON si ricopiano qui: si chiedono allo schema
// (lib/project-schema.js, scope integration), come fanno i consumatori. Un campo
// segreto nuovo, se un pannello lo mostra, entra in queste prove da solo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const { fieldsOfClass } = require('../lib/project-schema.js');

const ROOT = path.join(__dirname, '..');
const SEGRETI = new Set(fieldsOfClass('integration', 'secret'));
// Un valore riconoscibile ovunque finisca: se compare in un file scaricato, è uscito.
const VALORE = 'Kommun1ty-DA-NON-VEDERE';

const NODI = [
  { id: 'sw2c', type: 'switch', name: 'SW-V2C', ip: '10.0.0.2',
    integration: { driver: 'snmp-v2c', host: '10.0.0.2', community: VALORE } },
  { id: 'sw3', type: 'switch', name: 'SW-V3', ip: '10.0.0.3',
    integration: { driver: 'snmp-v3', host: '10.0.0.3', v3user: 'ops', v3authPass: VALORE, v3privPass: VALORE } },
  { id: 'hv', type: 'hypervisor', name: 'HV', ip: '10.0.0.4',
    vms: [
      { id: 'vm2c', name: 'VM-V2C', integration: { driver: 'snmp-v2c', host: '10.0.0.9', community: VALORE } },
      { id: 'vm3', name: 'VM-V3', integration: { driver: 'snmp-v3', host: '10.0.0.10', v3user: 'ops', v3authPass: VALORE, v3privPass: VALORE } },
    ] },
];

// Prepara lo state con i nodi di prova. Niente backtick qui dentro: il codice
// vive in un template literal.
const PREPARA = `
  state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
  state.nodes.push(...${JSON.stringify(NODI)});
  if (typeof _invalidateIdx === 'function') _invalidateIdx();
`;

function scaricaBackup(senzaRedazione) {
  const APP = loadApp(ROOT);
  return JSON.parse(run(APP.ctx, `(() => {
    ${PREPARA}
    const scaricati = [];
    Blob = class { constructor(parti) { scaricati.push((parti || []).join('')); } };
    const avvisi = [];
    _showToast = (msg, kind) => { avvisi.push(String(kind || '') + ':' + String(msg)); };
    if (${senzaRedazione ? 'true' : 'false'}) delete window.createPortableProjectExport;
    exportJSON();
    return JSON.stringify({ scaricati, avvisi });
  })()`));
}

test('① il backup JSON scaricato non contiene nessuna credenziale', () => {
  const { scaricati } = scaricaBackup(false);
  // La cattura funziona: senza questa riga, «zero credenziali» potrebbe voler
  // dire «zero file» e la prova passerebbe senza aver guardato niente.
  assert.equal(scaricati.length, 1, 'il download non è partito: la prova non ha niente da guardare');
  assert.ok(scaricati[0].includes('SW-V2C'), 'il file scaricato non contiene il progetto');
  assert.ok(!scaricati[0].includes(VALORE), 'una credenziale è finita nel file scaricato');
});

test('① senza la redazione caricata non si scarica niente — e lo si dice', () => {
  const { scaricati, avvisi } = scaricaBackup(true);
  assert.ok(scaricati.every((c) => !c.includes(VALORE)),
    'senza la redazione il ripiego ha scaricato lo state grezzo, credenziali comprese');
  assert.equal(scaricati.length, 0, 'un export senza redazione non deve partire affatto');
  assert.equal(avvisi.length, 1, 'l\'utente deve sapere perché il download non è partito');
});

// Tutti gli <input> del pannello legati a un campo, con il nome del campo e il tag.
function inputLegati(html) {
  const out = [];
  for (const m of String(html).matchAll(/<input\b[^>]*>/g)) {
    const campo = /data-(?:ikey|vm-field)="([^"]+)"/.exec(m[0]);
    if (campo) out.push({ campo: campo[1], tag: m[0] });
  }
  return out;
}

function pannello(selType, selId, selVmId) {
  const APP = loadApp(ROOT);
  return run(APP.ctx, `(() => {
    ${PREPARA}
    _propsExplicit = true;
    selType = ${JSON.stringify(selType)}; selId = ${JSON.stringify(selId)};
    selVmId = ${JSON.stringify(selVmId || null)};
    renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
}

const SCENARI = [
  ['apparato v2c', 'node', 'sw2c'],
  ['apparato v3', 'node', 'sw3'],
  ['VM v2c', 'vm', 'hv', 'vm2c'],
  ['VM v3', 'vm', 'hv', 'vm3'],
];

for (const [nome, selType, selId, selVmId] of SCENARI) {
  test(`② pannello ${nome}: ogni credenziale dichiarata dallo schema è un campo mascherato`, () => {
    const segreti = inputLegati(pannello(selType, selId, selVmId)).filter((i) => SEGRETI.has(i.campo));
    // Anti-vuoto: se il pannello non disegna la sezione, «tutti mascherati» è vero
    // di un insieme vuoto e la prova non direbbe niente.
    assert.ok(segreti.length > 0, `il pannello ${nome} non ha mostrato nessun campo credenziale`);
    for (const { campo, tag } of segreti) {
      assert.match(tag, /\btype="password"/, `${nome}: il campo «${campo}» è in chiaro — ${tag}`);
    }
  });
}

test('② i dialoghi Scopri e Topologia chiedono la community in un campo mascherato', () => {
  const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
  const campi = [...html.matchAll(/<input\b[^>]*\bid="[^"]*community[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.ok(campi.length > 0, 'nessun campo community trovato nei dialoghi: la regex non aggancia più');
  for (const tag of campi) assert.match(tag, /\btype="password"/, `community in chiaro: ${tag}`);
});
