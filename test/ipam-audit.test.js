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

// L'input è `ipam.prefixes[]`, l'autorità: la VLAN è un attributo facoltativo del
// prefisso, non la chiave con cui si confronta.
const P = (cidr, vlan) => ({ cidr, vlan: vlan === undefined ? null : vlan });

test('findSubnetOverlaps: due /24 identiche su VLAN diverse → identical:true', () => {
  const ov = findSubnetOverlaps([P('192.168.1.0/24', 10), P('192.168.1.0/24', 20)], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.vlan, 10);
  assert.equal(ov[0].b.vlan, 20);
  assert.equal(ov[0].identical, true);
});

test('findSubnetOverlaps: containment (/25 dentro /24) → overlap, non identical', () => {
  const ov = findSubnetOverlaps([P('10.0.0.0/24', 10), P('10.0.0.0/25', 20)], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].identical, false);
});

test('findSubnetOverlaps: subnet disgiunte → nessun overlap', () => {
  assert.deepEqual(findSubnetOverlaps([P('10.0.0.0/24', 10), P('10.0.1.0/24', 20)], _parseCidrInfo), []);
});

test('findSubnetOverlaps: CIDR mancante o non valido → prefisso saltato', () => {
  const ov = findSubnetOverlaps([P('10.0.0.0/24', 10), P('non-un-cidr', 20), P('', 30), null], _parseCidrInfo);
  assert.deepEqual(ov, []);
});

test('findSubnetOverlaps: senza parseCidr → array vuoto (nessun crash)', () => {
  assert.deepEqual(findSubnetOverlaps([P('10.0.0.0/24', 10)], null), []);
});

// ---- il 57% che prima era invisibile ----------------------------------------

test('findSubnetOverlaps: due reti SENZA VLAN che si sovrappongono → conflitto, vlan null', () => {
  const ov = findSubnetOverlaps([P('172.16.0.0/16'), P('172.16.5.0/24')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.cidr, '172.16.0.0/16');   // ordine di indirizzo: la più larga prima
  assert.equal(ov[0].b.cidr, '172.16.5.0/24');
  assert.equal(ov[0].a.vlan, null);
  assert.equal(ov[0].b.vlan, null);
  assert.equal(ov[0].identical, false);
});

test('findSubnetOverlaps: una con VLAN e una senza → conflitto (prima era invisibile)', () => {
  const ov = findSubnetOverlaps([P('192.168.1.0/24', 10), P('192.168.1.128/25')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.vlan, 10);
  assert.equal(ov[0].b.vlan, null);
});

test('findSubnetOverlaps: vlan 0 non è vlan null (`+null === 0`)', () => {
  const ov = findSubnetOverlaps([P('192.168.1.0/24', 0), P('192.168.1.0/24')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  const vlans = [ov[0].a.vlan, ov[0].b.vlan];
  assert.ok(vlans.includes(0), 'la VLAN 0 dichiarata resta 0');
  assert.ok(vlans.includes(null), 'la rete senza VLAN resta null');
});

// ---- L2 ≠ L3: la stessa VLAN, due spazi di indirizzi ------------------------

test('findSubnetOverlaps: dual-stack v4+v6 sulla stessa VLAN → NESSUN conflitto', () => {
  const ov = findSubnetOverlaps([P('192.168.20.0/24', 20), P('2001:db8:0:14::/64', 20)], _parseCidrInfo);
  assert.deepEqual(ov, []);
});

test('findSubnetOverlaps: due v4 sulla stessa VLAN che si intersecano → conflitto', () => {
  // Indirizzo secondario sulla stessa SVI: legittimo finché non si sovrappone.
  const ov = findSubnetOverlaps([P('10.10.0.0/24', 20), P('10.10.0.0/25', 20)], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.vlan, 20);
  assert.equal(ov[0].b.vlan, 20);
});

test('findSubnetOverlaps: due v4 disgiunte sulla stessa VLAN → nessun conflitto', () => {
  assert.deepEqual(findSubnetOverlaps([P('10.10.0.0/24', 20), P('10.10.1.0/24', 20)], _parseCidrInfo), []);
});

test('findSubnetOverlaps: due /64 v6 annidate → conflitto anche fra IPv6', () => {
  const ov = findSubnetOverlaps([P('2001:db8::/32'), P('2001:db8:0:14::/64')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.cidr, '2001:db8::/32');
  assert.equal(ov[0].identical, false);
});

test('findSubnetOverlaps: ordinato per indirizzo, non per ordine di dichiarazione', () => {
  const ov = findSubnetOverlaps([
    P('192.168.1.0/24', 30), P('10.0.0.0/8', 10), P('192.168.1.64/26', 40), P('10.1.2.0/24', 20),
  ], _parseCidrInfo);
  assert.deepEqual(ov.map(o => [o.a.cidr, o.b.cidr]), [
    ['10.0.0.0/8', '10.1.2.0/24'],
    ['192.168.1.0/24', '192.168.1.64/26'],
  ]);
});

// ---- buildIpamAudit (integrazione) ------------------------------------------

test('buildIpamAudit: aggrega duplicati + overlap dallo stesso modello', () => {
  const out = buildIpamAudit({
    prefixes: [P('192.168.1.0/24', 10), P('192.168.1.128/25', 20)],
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
    prefixes: [P('10.0.0.0/24', 10), P('10.0.1.0/24', 20)],
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
