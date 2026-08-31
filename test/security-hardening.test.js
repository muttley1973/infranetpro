'use strict';
// ============================================================
// Hardening di sicurezza — audit 2026-07-21 (Medi).
//   SEC-M1: i segreti SNMP non escono verso i lettori non-admin (viewer).
//   SEC-M2: il bypass auth INFRANET_DEV_NO_AUTH è onorato solo su loopback e
//           fuori produzione (fail-closed).
const test = require('node:test');
const assert = require('node:assert');

// ── SEC-M1: redazione segreti SNMP ─────────────────────────────────────────
const { _redactSnmpSecrets } = require('../server/routes/projects');

test('SEC-M1: _redactSnmpSecrets azzera community/v3authPass/v3privPass, tiene il resto', () => {
  const project = { id: 1, name: 'p', state: { nodes: [
    { id: 'sw1', integration: { driver: 'snmp-v2c', host: '10.0.0.1', community: 'secret-ro',
                                v3user: 'admin', v3authPass: 'AUTHPASS', v3privPass: 'PRIVPASS' } },
    { id: 'pc1' },   // nodo senza integration → intatto
  ] } };
  _redactSnmpSecrets(project);
  const ig = project.state.nodes[0].integration;
  assert.equal(ig.community, '', 'community v1/v2c azzerata');
  assert.equal(ig.v3authPass, '', 'passphrase auth v3 azzerata');
  assert.equal(ig.v3privPass, '', 'passphrase priv v3 azzerata');
  assert.equal(ig.host, '10.0.0.1', 'host NON è un segreto → preservato');
  assert.equal(ig.driver, 'snmp-v2c', 'driver preservato');
  assert.equal(ig.v3user, 'admin', 'username v3 (non segreto) preservato');
});

test('SEC-M1: _redactSnmpSecrets copre anche le VM (vm.integration + legacy vm.snmp)', () => {
  const project = { id: 2, name: 'p', state: { nodes: [
    { id: 'hv1', integration: { driver: 'snmp-v2c', community: 'node-secret' }, vms: [
      { id: 'vm1', name: 'web', integration: { driver: 'snmp-v2c', host: '10.0.0.5', community: 'vm-secret',
                                               v3user: 'mon', v3authPass: 'VMAUTH', v3privPass: 'VMPRIV' } },
      { id: 'vm2', name: 'db', snmp: { community: 'legacy-secret' } },   // contenitore legacy
      { id: 'vm3', name: 'bare' },                                       // VM senza integrazione → intatta
    ] },
  ] } };
  _redactSnmpSecrets(project);
  const vms = project.state.nodes[0].vms;
  assert.equal(project.state.nodes[0].integration.community, '', 'community del nodo azzerata');
  assert.equal(vms[0].integration.community, '', 'community della VM azzerata');
  assert.equal(vms[0].integration.v3authPass, '', 'passphrase auth v3 della VM azzerata');
  assert.equal(vms[0].integration.v3privPass, '', 'passphrase priv v3 della VM azzerata');
  assert.equal(vms[0].integration.host, '10.0.0.5', 'host della VM preservato');
  assert.equal(vms[0].integration.v3user, 'mon', 'username v3 della VM preservato');
  assert.equal(vms[1].snmp.community, '', 'community nel contenitore legacy vm.snmp azzerata');
  assert.equal(vms[2].name, 'bare', 'VM senza integrazione intatta');
});

// ── SEC-M1-bis: QUALI siano i segreti lo dice lo schema, non i consumatori ─
// Il difetto che questo test chiude (audit persistenza/segreti, 2026-08-30):
// `node.integration` era dichiarato `secret` PER INTERO in lib/project-schema.js,
// ma i due consumatori — l'export portatile e la redazione verso il lettore
// non-admin — svuotavano tre nomi ELENCATI a mano, in due copie. Un quarto campo
// segreto sarebbe uscito in chiaro **lasciando la suite verde**, perché anche le
// prove qui sotto enumeravano quei tre nomi.
//
// ⚠️ Per questo il banco che segue NON nomina nessun campo: costruisce il
// sacchetto dalla classifica. Il giorno che un quarto segreto entra nello scope
// `integration`, questo test lo copre **senza che nessuno lo tocchi** — ed è
// esattamente ciò che prima non succedeva.
const { fieldsOfClass } = require('../lib/project-schema.js');
const { sanitizePortableState } = require('../lib/project-format.js');

const SEGRETI = fieldsOfClass('integration', 'secret');
const NON_SEGRETI = { driver: 'snmp-v3', host: '10.0.0.9', port: 1161, v3user: 'mon' };
function sacchetto() {
  const b = Object.assign({}, NON_SEGRETI);
  for (const k of SEGRETI) b[k] = 'VALORE-' + k;
  return b;
}
function statoDiProva() {
  return { racks: [], nodes: [{ id: 'sw1', name: 'sw1', integration: sacchetto(), vms: [
    { id: 'vm1', name: 'web', integration: sacchetto() },
    { id: 'vm2', name: 'db', snmp: sacchetto() },       // il contenitore legacy
  ] }] };
}

test('⭐ SEC-M1: i segreti del sacchetto li dichiara lo SCHEMA, e i due consumatori li chiedono', () => {
  assert.ok(SEGRETI.length >= 3, 'se la classifica non dichiarasse niente, questo banco non proverebbe nulla');

  // ① il lettore non-admin (server/routes/projects.js)
  const project = { id: 1, name: 'p', state: statoDiProva() };
  _redactSnmpSecrets(project);
  // ② l'export portatile (lib/project-format.js)
  const exported = sanitizePortableState(statoDiProva());

  for (const [dove, n] of [['viewer', project.state.nodes[0]], ['export', exported.nodes[0]]]) {
    const sacchetti = [
      [dove + ' · node.integration', n.integration],
      [dove + ' · vm.integration', n.vms[0].integration],
      [dove + ' · vm.snmp (legacy)', n.vms[1].snmp],
    ];
    for (const [etichetta, bag] of sacchetti) {
      for (const k of SEGRETI) {
        assert.strictEqual(bag[k], '', `${etichetta}: ${k} è dichiarato secret e deve uscire SVUOTATO`);
        assert.ok(k in bag, `${etichetta}: ${k} si svuota, non si toglie — la forma resta`);
      }
      // e quello che non è un segreto resta: una redazione che porta via la
      // configurazione non protegge niente, rompe soltanto.
      assert.strictEqual(bag.driver, NON_SEGRETI.driver, `${etichetta}: il driver non è un segreto`);
      assert.strictEqual(bag.host, NON_SEGRETI.host, `${etichetta}: l'host non è un segreto`);
      assert.strictEqual(bag.v3user, NON_SEGRETI.v3user, `${etichetta}: l'utente USM identifica, non autentica`);
    }
  }
});

test('SEC-M1: nessuno dei due consumatori tiene una LISTA sua dei nomi delle credenziali', () => {
  // La guardia contro il ritorno del difetto: la duplicazione, non il sintomo.
  // Se un domani qualcuno riscrive un elenco dentro uno dei due file, qui si vede
  // — ed è la classe di bug più frequente di questo progetto (un lato deriva,
  // l'altro enumera, e la copia che enumera si buca in silenzio).
  const fs = require('node:fs');
  const path = require('node:path');
  for (const rel of ['server/routes/projects.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    for (const nome of SEGRETI) {
      assert.ok(!new RegExp("['\"]" + nome + "['\"]").test(src),
        `${rel} nomina «${nome}»: i nomi delle credenziali si dichiarano solo in `
        + 'lib/project-schema.js (scope `integration`), qui si chiedono');
    }
  }
  // `lib/project-format.js` è l'eccezione DICHIARATA: ha il pavimento a mano,
  // perché nel browser la classifica potrebbe non essere caricata. Che il
  // pavimento non diverga lo tiene `test/project-schema.test.js`.
});

// ── L3: il puntatore backup non arriva al disco con dentro un segreto ──────
// La barriera viveva SOLO nel client (il campo che l'utente digita). Un PUT
// costruito a mano o un progetto importato da JSON la scavalcava — e da lì il
// segreto sarebbe finito nel DTO REST, nell'inventory Ansible e nel dossier PDF.
const { _sanitizeBackupRefs } = require('../server/routes/projects');

test('L3: _sanitizeBackupRefs toglie le credenziali dal puntatore ma TIENE il puntatore', () => {
  const state = { nodes: [
    { id: 'sw1', backup: { ref: 'https://u:S3cr3t@git.local/cfg.git', method: 'git' } },
    { id: 'sw2', backup: { ref: 'backupsvc:P4ss@nas.local:/vol/cfg' } },   // forma scp, il bypass storico
    { id: 'sw3', backup: { ref: 'git@github.com:org/repo.git' } },         // lecito: nessuna password
    { id: 'sw4', backup: {} },
    { id: 'pc1' },                                                         // nessun backup → intatto
  ] };
  const n = _sanitizeBackupRefs(state);
  assert.equal(n, 2, 'due puntatori ripuliti');
  assert.equal(state.nodes[0].backup.ref, 'https://git.local/cfg.git');
  assert.equal(state.nodes[1].backup.ref, 'nas.local:/vol/cfg');
  assert.equal(state.nodes[2].backup.ref, 'git@github.com:org/repo.git', 'il legittimo non si tocca');
  assert.equal(state.nodes[0].backup.method, 'git', 'il resto del blocco backup resta');
  // Canarino: nessun segreto sopravvive da nessuna parte nello state.
  const dump = JSON.stringify(state);
  assert.ok(!dump.includes('S3cr3t') && !dump.includes('P4ss'), 'nessun segreto nello state salvato');
});

test('L3: _sanitizeBackupRefs non esplode su state malformati', () => {
  assert.equal(_sanitizeBackupRefs(null), 0);
  assert.equal(_sanitizeBackupRefs({}), 0);
  assert.equal(_sanitizeBackupRefs({ nodes: 'nope' }), 0);
  assert.equal(_sanitizeBackupRefs({ nodes: [null, undefined, {}] }), 0);
});

// ── SEC-M2: guardia del bypass auth ────────────────────────────────────────
const { _computeDevNoAuth } = require('../auth');

test('SEC-M2: bypass ammesso solo su loopback e fuori produzione', () => {
  // Abilitato: loopback esplicito
  assert.equal(_computeDevNoAuth({ INFRANET_DEV_NO_AUTH: '1', HOST: '127.0.0.1' }).enabled, true);
  // Abilitato: HOST assente → default loopback
  assert.equal(_computeDevNoAuth({ INFRANET_DEV_NO_AUTH: '1' }).enabled, true);
  assert.equal(_computeDevNoAuth({ INFRANET_DEV_NO_AUTH: '1', HOST: 'localhost' }).enabled, true);

  // Rifiutato: HOST di rete (0.0.0.0) → esporrebbe admin
  const net = _computeDevNoAuth({ INFRANET_DEV_NO_AUTH: '1', HOST: '0.0.0.0' });
  assert.equal(net.enabled, false);
  assert.equal(net.requested, true, 'la richiesta è rilevata (per il warning)');
  // Rifiutato: NODE_ENV=production, anche su loopback
  assert.equal(_computeDevNoAuth({ INFRANET_DEV_NO_AUTH: '1', HOST: '127.0.0.1', NODE_ENV: 'production' }).enabled, false);
  // Rifiutato: HOST IP di rete
  assert.equal(_computeDevNoAuth({ INFRANET_DEV_NO_AUTH: '1', HOST: '192.168.1.10' }).enabled, false);

  // Non richiesto: flag assente → disabilitato, requested=false
  const off = _computeDevNoAuth({ HOST: '127.0.0.1' });
  assert.equal(off.enabled, false);
  assert.equal(off.requested, false);
});
