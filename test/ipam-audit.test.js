// Test puri per lib/ipam-audit.js — igiene IPAM (IP duplicati + overlap subnet).
// Nessun DOM, nessuno stato: input espliciti → output.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildIpamAudit, findDuplicateIps, findSubnetOverlaps } = require('../lib/ipam-audit.js');
const { _parseCidrInfo } = require('../lib/cidr.js');

// ---- findDuplicateIps -------------------------------------------------------

test('findDuplicateIps: stesso IP su due nodi → segnalato con entrambi', () => {
  const dups = findDuplicateIps([
    { id: 'a', name: 'SW1', ip: '192.168.1.10' },
    { id: 'b', name: 'AP2', ip: '192.168.1.10' },
    { id: 'c', name: 'PC3', ip: '192.168.1.11' },
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].ip, '192.168.1.10');
  assert.deepEqual(dups[0].nodes.map(n => n.name).sort(), ['AP2', 'SW1']);
});

test('findDuplicateIps: IP unici → nessun duplicato', () => {
  assert.deepEqual(findDuplicateIps([
    { id: 'a', name: 'SW1', ip: '10.0.0.1' },
    { id: 'b', name: 'SW2', ip: '10.0.0.2' },
  ]), []);
});

test('findDuplicateIps: IP vuoti/mancanti ignorati (non contano come duplicato)', () => {
  assert.deepEqual(findDuplicateIps([
    { id: 'a', name: 'senza-ip-1', ip: '' },
    { id: 'b', name: 'senza-ip-2' },
    { id: 'c', name: 'con-ip', ip: '  10.0.0.5  ' },
  ]), []);
});

test('findDuplicateIps: ordinamento numerico "umano" (.10 dopo .2)', () => {
  const dups = findDuplicateIps([
    { id: '1', name: 'x', ip: '10.0.0.10' }, { id: '2', name: 'y', ip: '10.0.0.10' },
    { id: '3', name: 'p', ip: '10.0.0.2' },  { id: '4', name: 'q', ip: '10.0.0.2' },
  ]);
  assert.deepEqual(dups.map(d => d.ip), ['10.0.0.2', '10.0.0.10']);
});

// ---- findSubnetOverlaps -----------------------------------------------------

const vlans = [{ vid: 10 }, { vid: 20 }, { vid: 30 }];

test('findSubnetOverlaps: due /24 identiche su VLAN diverse → identical:true', () => {
  const ov = findSubnetOverlaps(vlans, {
    '10': { subnet: '192.168.1.0/24' },
    '20': { subnet: '192.168.1.0/24' },
  }, _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].vidA, 10);
  assert.equal(ov[0].vidB, 20);
  assert.equal(ov[0].identical, true);
});

test('findSubnetOverlaps: containment (/25 dentro /24) → overlap, non identical', () => {
  const ov = findSubnetOverlaps(vlans, {
    '10': { subnet: '10.0.0.0/24' },
    '20': { subnet: '10.0.0.0/25' },
  }, _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].identical, false);
});

test('findSubnetOverlaps: subnet disgiunte → nessun overlap', () => {
  const ov = findSubnetOverlaps(vlans, {
    '10': { subnet: '10.0.0.0/24' },
    '20': { subnet: '10.0.1.0/24' },
  }, _parseCidrInfo);
  assert.deepEqual(ov, []);
});

test('findSubnetOverlaps: CIDR mancante o non valido → VLAN saltata', () => {
  const ov = findSubnetOverlaps(vlans, {
    '10': { subnet: '10.0.0.0/24' },
    '20': { subnet: 'non-un-cidr' },
    '30': {},
  }, _parseCidrInfo);
  assert.deepEqual(ov, []);
});

test('findSubnetOverlaps: senza parseCidr → array vuoto (nessun crash)', () => {
  assert.deepEqual(findSubnetOverlaps(vlans, { '10': { subnet: '10.0.0.0/24' } }, null), []);
});

// ---- buildIpamAudit (integrazione) ------------------------------------------

test('buildIpamAudit: aggrega duplicati + overlap dallo stesso modello', () => {
  const out = buildIpamAudit({
    vlans: [{ vid: 10 }, { vid: 20 }],
    ipamByVid: { '10': { subnet: '192.168.1.0/24' }, '20': { subnet: '192.168.1.128/25' } },
    nodes: [
      { id: 'a', name: 'SW1', ip: '192.168.1.1' },
      { id: 'b', name: 'SW2', ip: '192.168.1.1' },
    ],
    parseCidr: _parseCidrInfo,
  });
  assert.equal(out.duplicateIps.length, 1);
  assert.equal(out.duplicateIps[0].ip, '192.168.1.1');
  assert.equal(out.subnetOverlaps.length, 1);
  assert.equal(out.subnetOverlaps[0].identical, false);
});

test('buildIpamAudit: rete pulita → entrambi vuoti', () => {
  const out = buildIpamAudit({
    vlans: [{ vid: 10 }, { vid: 20 }],
    ipamByVid: { '10': { subnet: '10.0.0.0/24' }, '20': { subnet: '10.0.1.0/24' } },
    nodes: [{ id: 'a', name: 'SW1', ip: '10.0.0.1' }, { id: 'b', name: 'SW2', ip: '10.0.1.1' }],
    parseCidr: _parseCidrInfo,
  });
  assert.deepEqual(out.duplicateIps, []);
  assert.deepEqual(out.subnetOverlaps, []);
});

test('buildIpamAudit: modello vuoto → nessun crash', () => {
  const out = buildIpamAudit({});
  assert.deepEqual(out.duplicateIps, []);
  assert.deepEqual(out.subnetOverlaps, []);
});
