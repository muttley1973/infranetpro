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
