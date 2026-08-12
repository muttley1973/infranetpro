'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROJECT_STATE_SCHEMA_VERSION,
  PORTABLE_EXPORT_FORMAT,
  createPortableProjectExport,
  unwrapProjectState,
  isProjectState,
  pruneProjectStateCaches,
  dropObsoleteFields,
  stripDerivedVlan,
} = require('../lib/project-format.js');

test('portable export redige credenziali e conserva il modello del progetto', () => {
  const state = {
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    racks: [{ id: 'r1' }],
    nodes: [{
      id: 'sw1',
      integration: { host: '192.0.2.1', community: 'secret', v3authPass: 'auth', v3privPass: 'priv' },
      backup: { ref: 'https://user:pass@example.test/config' },
      vms: [{ integration: { community: 'vm-secret' }, snmp: { v3privPass: 'vm-priv' } }],
    }],
    links: [],
  };
  const exported = createPortableProjectExport(state, { projectId: 7, projectName: 'Lab' });
  assert.equal(exported.format, PORTABLE_EXPORT_FORMAT);
  assert.equal(exported.schemaVersion, PROJECT_STATE_SCHEMA_VERSION);
  assert.equal(exported.projectId, '7');
  assert.equal(exported.projectName, 'Lab');
  assert.equal(exported.state.nodes[0].integration.community, '');
  assert.equal(exported.state.nodes[0].integration.v3authPass, '');
  assert.equal(exported.state.nodes[0].backup.ref, 'https://example.test/config');
  assert.equal(exported.state.nodes[0].vms[0].integration.community, '');
  assert.equal(exported.state.nodes[0].vms[0].snmp.v3privPass, '');
  assert.equal(state.nodes[0].integration.community, 'secret');
});

test('⚠️ l\'export porta il documento, non le misure: la presenza resta a casa', () => {
  const state = {
    racks: [], links: [],
    nodes: [{ id: 'pc7', name: 'PC contabilità', proof: { status: 'absent', absentEvidence: true } }],
  };
  state.discoveryHistory = { observations: [{ mac: 'aa:bb', ip: '10.0.0.1', count: 4 }] };
  const exported = createPortableProjectExport(state, {});
  assert.equal('proof' in exported.state.nodes[0], false, 'chi apre altrove non eredita i nostri rossi');
  assert.equal('discoveryHistory' in exported.state, false, 'né gli avvistamenti della nostra rete');
  assert.equal(exported.state.nodes[0].name, 'PC contabilità', 'il dichiarato parte tutto');
  // Si lavora su un clone: lo stato vivo non deve perdere le sue misure.
  assert.equal(state.nodes[0].proof.status, 'absent');
  assert.equal(state.discoveryHistory.observations.length, 1);
});

test('unwrapProjectState accetta sia export portatile sia stato legacy', () => {
  const state = { nodes: [], racks: [], links: [] };
  assert.deepEqual(unwrapProjectState({ format: PORTABLE_EXPORT_FORMAT, state }), state);
  assert.equal(unwrapProjectState(state), state);
  assert.equal(isProjectState(state), true);
  assert.equal(isProjectState({ nodes: [] }), false);
});

test('pruneProjectStateCaches rimuove solo cache topologia orfane', () => {
  const state = {
    nodes: [{ id: 'sw1' }],
    topoCache: { sw1: { ts: 1 }, removed: { ts: 2 } },
    discoveryHistory: { observations: [{ switchId: 'removed' }] },
  };
  pruneProjectStateCaches(state);
  assert.deepEqual(Object.keys(state.topoCache), ['sw1']);
  assert.equal(state.discoveryHistory.observations.length, 1);
});

test('dropObsoleteFields toglie i campi che non legge nessuno e NON tocca il resto', () => {
  const state = {
    nodes: [
      { id: 'sw1', name: 'Core', lastDiscoveryMatch: 'mac', identitySource: 'snmp' },
      { id: 'sw2', name: 'Access' },
    ],
    ports: {
      'sw1-1': { ifName: 'Gi1/0/1', physicalKind: 'copper', mediaOptions: ['copper', 'fiber'] },
      'sw1-2': { ifName: 'Gi1/0/2' },
    },
  };
  const dropped = dropObsoleteFields(state);
  assert.equal(dropped, 2, 'un campo per nodo e uno per porta');
  assert.equal('lastDiscoveryMatch' in state.nodes[0], false);
  assert.equal('physicalKind' in state.ports['sw1-1'], false);
  // Il documento resta intatto: si tolgono i morti, non i vivi.
  assert.equal(state.nodes[0].identitySource, 'snmp');
  assert.equal(state.nodes[0].name, 'Core');
  assert.deepEqual(state.ports['sw1-1'].mediaOptions, ['copper', 'fiber']);
  assert.equal(state.ports['sw1-2'].ifName, 'Gi1/0/2');
  // Idempotente: un progetto gia' ripulito non cambia piu'.
  assert.equal(dropObsoleteFields(state), 0);
});

test('dropObsoleteFields non esplode su stati malformati', () => {
  assert.equal(dropObsoleteFields(null), 0);
  assert.equal(dropObsoleteFields({}), 0);
  assert.equal(dropObsoleteFields({ nodes: [null, 'x'], ports: { a: null, b: 3 } }), 0);
  assert.equal(dropObsoleteFields({ ports: [] }), 0);
});

// ============================================================
// La propagazione VLAN è DERIVATA: nel documento non ci va.
// ============================================================
test('⚠️ stripDerivedVlan toglie i tre campi e SOLO i record che restano vuoti', () => {
  const state = { ports: {
    // Porta vera: perde il derivato, resta tutto il resto.
    'sw1-1': { ifName: 'Gi1/0/1', vlanOvr: 20, vlanProp: 20, isTrunkProp: true, trunkProp: [10, 20] },
    // Record FANTASMA: il render l'ha creato con dentro solo la propagazione.
    'tel4-1': { vlanProp: 20 },
    // Porta dichiarata senza derivati: non si tocca.
    'sw1-2': { ifName: 'Gi1/0/2' },
    // Record già vuoto ma NON creato da noi: si lascia stare.
    'pp1-9': {},
  } };
  assert.equal(stripDerivedVlan(state), 2, 'due record avevano campi derivati');
  assert.deepEqual(state.ports['sw1-1'], { ifName: 'Gi1/0/1', vlanOvr: 20 }, 'il dichiarato resta intatto');
  assert.equal('tel4-1' in state.ports, false, 'il fantasma sparisce del tutto');
  assert.deepEqual(state.ports['sw1-2'], { ifName: 'Gi1/0/2' });
  assert.ok('pp1-9' in state.ports, 'un record vuoto che non abbiamo svuotato noi resta');
  assert.equal(stripDerivedVlan(state), 0, 'idempotente');
});

test('stripDerivedVlan non esplode su stati malformati', () => {
  assert.equal(stripDerivedVlan(null), 0);
  assert.equal(stripDerivedVlan({}), 0);
  assert.equal(stripDerivedVlan({ ports: [] }), 0);
  assert.equal(stripDerivedVlan({ ports: { a: null, b: 3 } }), 0);
});

test('⚠️ il Salva ripulisce i derivati PRIMA di scrivere, e l\'export non li porta', () => {
  const fs = require('node:fs'), path = require('node:path');
  const R = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'projects.js'), 'utf8');
  assert.match(R, /stripDerivedVlan\(state\);/);
  assert.ok(R.indexOf('stripDerivedVlan(state);') < R.indexOf('saveProject(id, name, state, p.created_at, now)'),
    'prima si ripulisce, poi si scrive');
  assert.match(R, /stripDerivedVlan\(src\.state\);/, 'anche la copia');

  const exported = createPortableProjectExport({ racks: [], links: [], nodes: [],
    ports: { 'sw1-1': { ifName: 'Gi1/0/1', vlanProp: 20 }, 'tel4-1': { vlanProp: 20 } } }, {});
  assert.deepEqual(exported.state.ports['sw1-1'], { ifName: 'Gi1/0/1' });
  assert.equal('tel4-1' in exported.state.ports, false);
});
