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
