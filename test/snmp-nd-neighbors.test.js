'use strict';
// extractNeighbors — parsing della IP-MIB ipNetToPhysicalTable (RFC 4293), il
// successore address-family-aware dell'ARP legacy. Verifica:
//  - riga IPv4 fisica → CONFLUISCE in arpTable solo come gap-fill (non sovrascrive);
//  - riga IPv6 → ndTable { mac -> [ip6…] } con indirizzo canonicalizzato;
//  - entry con Type=invalid(2) scartata;
//  - NON-REGRESSIONE: senza righe fisiche, arpTable è identica al solo ARP legacy.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractNeighbors, N_OID } = require('../drivers/snmp.js')._internals;

const IFX = 5;
const mac1 = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]); // '00:11:22:33:44:55'
const mac2 = Buffer.from([0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x02]); // 'aa:bb:cc:00:00:02'
const mac3 = Buffer.from([0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x03]); // 'aa:bb:cc:00:00:03'
const mac4 = Buffer.from([0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x04]); // 'aa:bb:cc:00:00:04' (invalid)

// ipNetToMedia legacy (IPv4): mac1 → 10.0.0.5. Indice = ifIdx + 4 ottetti.
function legacyArp() {
  return {
    [`${N_OID.arpIp}.${IFX}.10.0.0.5`]:   Buffer.from([10, 0, 0, 5]),
    [`${N_OID.arpPhys}.${IFX}.10.0.0.5`]: mac1,
    [`${N_OID.arpType}.${IFX}.10.0.0.5`]: 3, // dynamic
  };
}

// Byte di 2001:db8::1 e 2001:db8::dead (16 ottetti, come nell'indice OID).
const V6_A = [32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
const V6_B = [32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 222, 173];

test('extractNeighbors: ipNetToPhysical popola ndTable (IPv6) e gap-fill arpTable (IPv4)', () => {
  const vbs = {
    ...legacyArp(),
    // IPv4 fisica, MAC NUOVO → gap-fill in arpTable
    [`${N_OID.physPhys}.${IFX}.1.4.192.168.1.9`]: mac2,
    // IPv4 fisica su mac1 (già in ARP) con IP diverso → NON deve sovrascrivere
    [`${N_OID.physPhys}.${IFX}.1.4.10.0.0.99`]:    mac1,
    // IPv6 → ndTable
    [`${N_OID.physPhys}.${IFX}.2.16.${V6_A.join('.')}`]: mac3,
    // IPv6 con Type=invalid(2) → scartata
    [`${N_OID.physPhys}.${IFX}.2.16.${V6_B.join('.')}`]: mac4,
    [`${N_OID.physType}.${IFX}.2.16.${V6_B.join('.')}`]: 2,
  };
  const r = extractNeighbors(vbs);
  assert.equal(r.arpTable['00:11:22:33:44:55'], '10.0.0.5', 'ARP legacy preservato, NON sovrascritto dal fisico');
  assert.equal(r.arpTable['aa:bb:cc:00:00:02'], '192.168.1.9', 'IPv4 fisica: gap-fill del MAC nuovo');
  assert.deepEqual(r.ndTable['aa:bb:cc:00:00:03'], ['2001:db8::1'], 'IPv6 → ndTable, indirizzo canonico');
  assert.ok(!('aa:bb:cc:00:00:04' in r.ndTable), 'entry Type=invalid(2) scartata');
});

test('extractNeighbors: NON-REGRESSIONE — senza righe fisiche arpTable è identica e ndTable è vuota', () => {
  const r = extractNeighbors(legacyArp());
  assert.deepEqual(r.arpTable, { '00:11:22:33:44:55': '10.0.0.5' }, 'arpTable byte-identica al solo ARP legacy');
  assert.deepEqual(r.ndTable, {}, 'nessuna riga ipNetToPhysical → ndTable vuota');
});
