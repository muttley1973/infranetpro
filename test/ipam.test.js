'use strict';
// Test dell'occupazione IPAM pura (lib/ipam.js) + del predicato staleness
// condiviso (lib/dhcp-lease.js isLeaseStale). Usa il VERO lib/cidr.js iniettato,
// così si verifica anche la matematica reale di capacità/appartenenza.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _parseCidrInfo, _ipInCidr } = require('../lib/cidr.js');
const { computeIpamUsage, _hostCapacity } = require('../lib/ipam.js');
const { isLeaseStale } = require('../lib/dhcp-lease.js');

const usage = (subnet, opts = {}) =>
  computeIpamUsage({ subnet, parseCidr: _parseCidrInfo, ipInCidr: _ipInCidr, ...opts });
const cap = (cidr) => _hostCapacity(_parseCidrInfo(cidr));

// ---------- capacità host per prefisso ----------
test('_hostCapacity: host assegnabili per prefisso (con casi limite)', () => {
  assert.equal(cap('192.168.10.0/24'), 254);
  assert.equal(cap('192.168.10.0/26'), 62);
  assert.equal(cap('10.0.0.0/30'), 2);
  assert.equal(cap('10.0.0.0/31'), 2);   // RFC 3021 punto-punto: 2 usabili
  assert.equal(cap('10.0.0.1/32'), 1);   // host singolo
  assert.equal(cap('10.0.0.0/16'), 65534);
  assert.equal(_hostCapacity(null), 0);
});

// ---------- opzione A: documentati + solo-DHCP = realtà sul filo ----------
test('computeIpamUsage: conteggio opzione A con gateway, dedup e fuori-subnet', () => {
  const u = usage('192.168.20.0/24', {
    gateway: '192.168.20.1',
    documentedIps: ['192.168.20.10', '192.168.20.11', '10.0.0.5'], // l'ultimo è fuori CIDR
    leaseIps: ['192.168.20.11', '192.168.20.45', '192.168.20.46', '172.16.0.9'], // .11 = già documentato, ultimo fuori
  });
  assert.equal(u.capacity, 254);
  assert.equal(u.documentedCount, 3);   // .1 (gateway) + .10 + .11
  assert.equal(u.dhcpOnlyCount, 2);     // .45 + .46 (il .11 conta come documentato, non solo-DHCP)
  assert.deepEqual(u.dhcpOnly.sort(), ['192.168.20.45', '192.168.20.46']);
  assert.equal(u.usedCount, 5);
  assert.equal(u.freeCount, 249);
  assert.equal(u.pct, 2);               // round(5/254*100)
  assert.equal(u.leaseInCidr, 3);       // .11 + .45 + .46
  assert.equal(u.gatewayOk, true);
});

test('computeIpamUsage: senza lease conta i soli documentati (manual-first)', () => {
  const u = usage('192.168.30.0/24', {
    gateway: '192.168.30.1',
    documentedIps: ['192.168.30.10', '192.168.30.20'],
    leaseIps: [],
  });
  assert.equal(u.documentedCount, 3);   // gateway + 2 nodi
  assert.equal(u.dhcpOnlyCount, 0);
  assert.equal(u.leaseInCidr, 0);       // → la UI non mostra la fonte "DHCP"
  assert.equal(u.usedCount, 3);
  assert.equal(u.freeCount, 251);
});

test('computeIpamUsage: un lease pari al gateway non è "solo DHCP"', () => {
  const u = usage('192.168.40.0/24', {
    gateway: '192.168.40.1',
    documentedIps: [],
    leaseIps: ['192.168.40.1'],
  });
  assert.equal(u.documentedCount, 1);   // il gateway
  assert.equal(u.dhcpOnlyCount, 0);     // il lease coincide col gateway dichiarato
  assert.equal(u.leaseInCidr, 1);
  assert.equal(u.usedCount, 1);
});

test('computeIpamUsage: gateway fuori subnet → gatewayOk false e non occupa', () => {
  const u = usage('192.168.50.0/24', {
    gateway: '10.0.0.1',
    documentedIps: ['192.168.50.10'],
    leaseIps: [],
  });
  assert.equal(u.gatewayOk, false);
  assert.equal(u.documentedCount, 1);   // solo il nodo; il gateway fuori non entra nel conteggio
});

test('computeIpamUsage: lease duplicati contati una volta', () => {
  const u = usage('192.168.60.0/24', {
    documentedIps: [],
    leaseIps: ['192.168.60.45', '192.168.60.45', '192.168.60.45'],
  });
  assert.equal(u.dhcpOnlyCount, 1);
  assert.equal(u.leaseInCidr, 1);
  assert.equal(u.usedCount, 1);
});

test('computeIpamUsage: /31 punto-punto pieno → 100% e 0 liberi', () => {
  const u = usage('10.0.0.0/31', {
    documentedIps: [],
    leaseIps: ['10.0.0.0', '10.0.0.1'],
  });
  assert.equal(u.capacity, 2);
  assert.equal(u.usedCount, 2);
  assert.equal(u.freeCount, 0);
  assert.equal(u.pct, 100);
});

test('computeIpamUsage: subnet assente o CIDR non valido → tutto a zero', () => {
  for (const bad of ['', '   ', 'non-un-cidr', '999.1.1.0/24']) {
    const u = usage(bad, { documentedIps: ['1.2.3.4'], leaseIps: ['1.2.3.5'] });
    assert.equal(u.cidr, null, `cidr null per "${bad}"`);
    assert.equal(u.capacity, 0);
    assert.equal(u.usedCount, 0);
    assert.equal(u.freeCount, 0);
    assert.equal(u.pct, 0);
    assert.equal(u.gatewayOk, true);    // nessun CIDR ⇒ nessun vincolo gateway
  }
});

test('computeIpamUsage: robusto a input mancanti', () => {
  assert.doesNotThrow(() => computeIpamUsage());
  const u = computeIpamUsage({ subnet: '192.168.0.0/24' }); // niente parseCidr iniettato
  assert.equal(u.capacity, 0);   // senza parseCidr → cidr null
  assert.equal(u.usedCount, 0);
});

// ---------- predicato staleness condiviso (G2) ----------
test('isLeaseStale: stati terminali e expiry passata', () => {
  const NOW = Date.parse('2026-06-28T12:00:00Z');
  assert.equal(isLeaseStale(null), false);
  assert.equal(isLeaseStale({ state: 'active' }), false);
  for (const st of ['expired', 'released', 'declined', 'free']) {
    assert.equal(isLeaseStale({ state: st }), true, `stato ${st} = stale`);
  }
  assert.equal(isLeaseStale({ expiry: '2026-06-28T11:59:00Z' }, NOW), true);   // passata
  assert.equal(isLeaseStale({ expiry: '2026-06-28T12:01:00Z' }, NOW), false);  // futura
  assert.equal(isLeaseStale({ expiry: 'non-una-data' }, NOW), false);          // non parsabile → non stale
  assert.equal(isLeaseStale({ state: 'active', expiry: '2026-06-28T12:01:00Z' }, NOW), false);
});
