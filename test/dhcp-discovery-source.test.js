'use strict';
// DHCP come sorgente Scopri: un lease DHCP (IP<->MAC + hostname) diventa una riga
// candidata anche per host DORMIENTI (mobile/IoT in power-save). Lo scorer aggiunge
// un'evidenza 'dhcp' (binding autorevole su tutte le VLAN), NON pre-selezionata
// (alive:false → il client decide). Vendor dedotto da OUI o dal nome host (BYOD).
const test = require('node:test');
const assert = require('node:assert/strict');
const { _decorateDiscoveryRow, _buildDiscoveryMeta } = require('../server/classify');

test('DHCP source: evidenza dhcp + reason + source presenti', () => {
  const row = _decorateDiscoveryRow(
    { ip: '192.168.1.231', mac: '4c:bc:e9:aa:e5:ca', hostname: 'LG-Smart-Laundry',
      alive: false, pingReachable: false, snmpReachable: false, dhcpLease: true },
    { viaProtocol: 'DHCP', viaFrom: 'Synology · 192.168.1.x' }
  );
  const ev = row.discovery.evidences.find(e => e.type === 'dhcp');
  assert.ok(ev, 'evidenza dhcp presente');
  assert.equal(ev.weight, 14, 'peso lease DHCP');
  assert.ok(row.discovery.reasonCodes.includes('dhcp-lease'), 'reason dhcp-lease');
  assert.ok(row.discovery.sources.some(s => s.id === 'dhcp'), 'sorgente DHCP');
  // Nessuna evidenza 'mac' generica (il lease la subsume, niente doppio conto).
  assert.equal(row.discovery.evidences.some(e => e.type === 'mac'), false, 'niente doppia evidenza mac');
});

test('DHCP source: si attiva anche via viaProtocol senza il flag dhcpLease', () => {
  const meta = _buildDiscoveryMeta(
    { ip: '192.168.1.220', mac: 'e8:06:88:cb:f4:1f', hostname: 'Mac-Pro' },
    { viaProtocol: 'DHCP' }
  );
  assert.ok(meta.reasonCodes.includes('dhcp-lease'), 'reason dhcp-lease via extra.viaProtocol');
});

test('DHCP source: NON e\' pre-selezionabile ma supera la soglia fantasmi (15)', () => {
  const row = _decorateDiscoveryRow(
    { ip: '192.168.1.218', mac: 'f4:bf:80:da:ed:dc', hostname: 'HUAWEI-MediaPad',
      alive: false, pingReachable: false, snmpReachable: false, dhcpLease: true },
    { viaProtocol: 'DHCP' }
  );
  assert.equal(row.alive, false, 'osservato, non vivo → il client non lo pre-seleziona');
  // dhcp(14) + hostname(12) + eventuale vendor → ben sopra 15, ma sotto un host SNMP.
  assert.ok(row.confidence.score >= 15, `score ${row.confidence.score} sopra la soglia fantasmi`);
});

test('DHCP source: vendor BYOD dedotto dal nome host (MAC randomizzato)', () => {
  // Redmi con MAC randomizzato (bit locally-administered 0x02): niente OUI, ma il
  // nome host annunciato rivela il brand.
  const row = _decorateDiscoveryRow(
    { ip: '192.168.1.234', mac: '2a:50:30:1f:8c:ab', hostname: 'Redmi-Note-14',
      alive: false, pingReachable: false, snmpReachable: false, dhcpLease: true },
    { viaProtocol: 'DHCP' }
  );
  assert.equal(row.vendor, 'Xiaomi', 'brand Xiaomi dedotto da "Redmi" nel nome host');
  assert.ok(row.discovery.evidences.some(e => e.type === 'vendor'), 'evidenza vendor presente');
});

test('regressione: una riga NON-DHCP con MAC usa ancora ARP/mac', () => {
  const meta = _buildDiscoveryMeta(
    { ip: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:01', alive: true, pingReachable: true },
    {}
  );
  assert.ok(meta.evidences.some(e => e.type === 'mac'), 'evidenza mac ancora presente');
  assert.ok(meta.reasonCodes.includes('arp-seen'), 'reason arp-seen preservato');
  assert.equal(meta.reasonCodes.includes('dhcp-lease'), false, 'nessun dhcp-lease su riga non-DHCP');
});
