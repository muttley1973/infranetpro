'use strict';
// Test del report L3-lite gateway (lib/l3-gateway.js): risoluzione VLAN→device
// (bound/auto/orphan/none), warning e aggregazione device L3.
const test = require('node:test');
const assert = require('node:assert');
const { buildL3Report } = require('../lib/l3-gateway.js');

// CIDR semplificato per i test: /24 su 192.168.<x>.0 → match sul terzo ottetto.
function parseCidr(subnet) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.\d+\/(\d+)$/.exec(String(subnet || '').trim());
  if (!m) return null;
  return { a: +m[1], b: +m[2], c: +m[3], bits: +m[4] };
}
function ipInCidr(ip, cidr) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(String(ip || '').trim());
  if (!m || !cidr) return false;
  return +m[1] === cidr.a && +m[2] === cidr.b && +m[3] === cidr.c;
}

const NODES = [
  { id: 'core', name: 'Core-SW', ip: '192.168.10.1', type: 'switch' },
  { id: 'fw', name: 'FW01', ip: '192.168.20.1', type: 'firewall' },
  { id: 'edge', name: 'Edge', ip: '10.0.0.1', type: 'router' },
];

function run(ipamByVid, vlans) {
  return buildL3Report({
    vlans: vlans || [{ vid: 10, name: 'Server', color: '#f00' }, { vid: 20, name: 'User', color: '#0f0' }],
    ipamByVid,
    nodes: NODES,
    parseCidr, ipInCidr,
  });
}

test('auto: gateway IP combacia con un device → status auto + device agganciato', () => {
  const r = run({ 10: { subnet: '192.168.10.0/24', gateway: '192.168.10.1' } });
  const row = r.rows.find(x => x.vid === 10);
  assert.equal(row.status, 'auto');
  assert.equal(row.nodeId, 'core');
  assert.equal(row.nodeName, 'Core-SW');
  assert.deepEqual(row.warnings, []);
});

test('bound: gatewayNodeId esplicito vince anche senza match IP', () => {
  const r = run({ 10: { subnet: '192.168.10.0/24', gateway: '192.168.10.254', gatewayNodeId: 'core' } });
  const row = r.rows.find(x => x.vid === 10);
  assert.equal(row.status, 'bound');
  assert.equal(row.nodeId, 'core');
  // gateway .254 è in subnet /24 .10 → nessun warning out-of-subnet
  assert.ok(!row.warnings.includes('gatewayOutOfSubnet'));
});

test('orphan: gateway IP scritto ma nessun device → orphanGateway', () => {
  const r = run({ 10: { subnet: '192.168.10.0/24', gateway: '192.168.10.99' } });
  const row = r.rows.find(x => x.vid === 10);
  assert.equal(row.status, 'orphan');
  assert.equal(row.nodeId, null);
  assert.ok(row.warnings.includes('orphanGateway'));
});

test('none + noGateway: subnet senza gateway', () => {
  const r = run({ 10: { subnet: '192.168.10.0/24' } });
  const row = r.rows.find(x => x.vid === 10);
  assert.equal(row.status, 'none');
  assert.ok(row.warnings.includes('noGateway'));
});

test('staleBinding: gatewayNodeId punta a device cancellato', () => {
  const r = run({ 10: { subnet: '192.168.10.0/24', gateway: '192.168.10.1', gatewayNodeId: 'ghost' } });
  const row = r.rows.find(x => x.vid === 10);
  assert.equal(row.status, 'orphan');
  assert.ok(row.warnings.includes('staleBinding'));
  assert.equal(row.nodeId, null);
});

test('gatewayOutOfSubnet: IP fuori dalla subnet dichiarata', () => {
  const r = run({ 10: { subnet: '192.168.10.0/24', gateway: '192.168.99.1' } });
  const row = r.rows.find(x => x.vid === 10);
  assert.ok(row.warnings.includes('gatewayOutOfSubnet'));
});

test('invalidCidr: subnet malformata segnala invalidCidr', () => {
  const r = run({ 10: { subnet: 'non-valido', gateway: '192.168.10.1' } });
  const row = r.rows.find(x => x.vid === 10);
  assert.equal(row.cidrValid, false);
  assert.ok(row.warnings.includes('invalidCidr'));
});

test('aggregazione: device L3 raccoglie tutte le VLAN che instrada', () => {
  const r = run({
    10: { subnet: '192.168.10.0/24', gateway: '192.168.10.1' },          // → core (auto)
    20: { subnet: '192.168.20.0/24', gatewayNodeId: 'core', gateway: '192.168.20.1' }, // → core (bound)
  });
  assert.equal(r.totals.l3Devices, 1);
  const core = r.l3Devices.find(d => d.id === 'core');
  assert.equal(core.vlans.length, 2);
  assert.deepEqual(r.l3NodeIds, ['core']);
  assert.equal(r.totals.withGateway, 2);
});

test('totals: conta orphan/noGateway/outOfSubnet correttamente', () => {
  const r = run({
    10: { subnet: '192.168.10.0/24', gateway: '192.168.10.1' }, // ok
    20: { subnet: '192.168.20.0/24' },                          // noGateway
  });
  assert.equal(r.totals.vlans, 2);
  assert.equal(r.totals.withGateway, 1);
  assert.equal(r.totals.noGateway, 1);
});

test('usageByVid passa attraverso come usedCount', () => {
  const r = run({ 10: { subnet: '192.168.10.0/24', gateway: '192.168.10.1' } });
  // senza usageByVid → 0
  assert.equal(r.rows.find(x => x.vid === 10).usedCount, 0);
  const r2 = buildL3Report({
    vlans: [{ vid: 10 }], ipamByVid: { 10: { gateway: '192.168.10.1' } },
    nodes: NODES, usageByVid: { 10: 7 }, parseCidr, ipInCidr,
  });
  assert.equal(r2.rows[0].usedCount, 7);
});
