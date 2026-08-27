'use strict';
// ============================================================
// own-ip discovery key (slice 2b): il device autorevole ELENCA i suoi indirizzi
// (ipAddrTable), e uno di quelli e' la NIC rimasta MUTA allo scan -> stesso box.
// Qui: l'estrazione IPv4 pura dalle due tabelle standard, l'export del walk
// leggero `deviceIps`, e il fold end-to-end via foldScanRows con la chiave own-ip.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const snmp = require('../drivers/snmp.js');
const { _ownIp4FromVbs, OID } = snmp._internals;

test('deviceIps: il walk leggero e\' esportato dal driver', () => {
  assert.equal(typeof snmp.deviceIps, 'function');
});

test('_ownIp4FromVbs: IPv4 propri dalle due tabelle; loopback/0.0.0.0/IPv6 esclusi; dedup', () => {
  const vbs = {};
  vbs[OID.ipAdEntIfIndex + '.192.168.1.120'] = 2;      // storica (RFC 1213): indice = IPv4
  vbs[OID.ipAdEntIfIndex + '.192.168.1.121'] = 3;
  vbs[OID.ipAdEntIfIndex + '.127.0.0.1']     = 1;      // loopback -> escluso
  vbs[OID.ipAdEntIfIndex + '.0.0.0.0']       = 4;      // -> escluso
  vbs[OID.ipAddrIfIndex + '.1.4.10.0.0.9']   = 5;      // moderna (IP-MIB): IPv4 = 1.4.a.b.c.d
  vbs[OID.ipAddrIfIndex + '.1.4.192.168.1.120'] = 2;   // duplicato della storica -> dedup
  vbs[OID.ipAddrIfIndex + '.2.16.32.1.13.184.0.0.0.0.0.0.0.0.0.0.1'] = 7; // IPv6 (type 2) -> escluso
  vbs[OID.ipAdEntIfIndex + '.192.168.1.255'] = 9;      // broadcast -> escluso (net-snmp su Linux lo elenca)
  assert.deepEqual(_ownIp4FromVbs(vbs).slice().sort(), ['10.0.0.9', '192.168.1.120', '192.168.1.121']);
});

test('_ipv4FromAddrOid: legge l\'IPv4 dall\'INDICE di entrambe le tabelle (una definizione sola)', () => {
  const { _ipv4FromAddrOid } = snmp._internals;
  assert.equal(_ipv4FromAddrOid(OID.ipAdEntIfIndex + '.192.168.1.178'), '192.168.1.178'); // storica: indice = A.B.C.D
  assert.equal(_ipv4FromAddrOid(OID.ipAddrIfIndex + '.1.4.10.0.0.9'), '10.0.0.9');          // moderna: 1.4.a.b.c.d
  assert.equal(_ipv4FromAddrOid(OID.ipAddrIfIndex + '.2.16.32.1.13.184.0.0.0.0.0.0.0.0.0.0.1'), ''); // IPv6 -> ''
  assert.equal(_ipv4FromAddrOid('1.2.3.4.5.6'), '');   // OID estraneo -> ''
});

test('_isUsableOwnIp4: scarta loopback/link-local/0.0.0.0/broadcast; tiene gli unicast (anche off-subnet)', () => {
  const { _isUsableOwnIp4 } = snmp._internals;
  assert.equal(_isUsableOwnIp4('192.168.1.120'), true);
  assert.equal(_isUsableOwnIp4('172.17.0.1'), true, 'un gateway Docker e\' un IP reale del box');
  assert.equal(_isUsableOwnIp4('192.168.1.255'), false, 'broadcast /24');
  assert.equal(_isUsableOwnIp4('172.17.255.255'), false, 'broadcast /16');
  assert.equal(_isUsableOwnIp4('127.0.0.1'), false);
  assert.equal(_isUsableOwnIp4('169.254.9.9'), false);
  assert.equal(_isUsableOwnIp4('0.0.0.0'), false);
  assert.equal(_isUsableOwnIp4(''), false);
});

test('_ownIp4FromVbs: mappa vuota / null -> lista vuota', () => {
  assert.deepEqual(_ownIp4FromVbs({}), []);
  assert.deepEqual(_ownIp4FromVbs(null), []);
});

test('own-ip fold end-to-end: una NIC MUTA elencata negli ownIps del primario si fonde', () => {
  // Il senso di slice 2b: deviceIps popola row.ownIps sul responder SNMP, e
  // foldScanRows fonde la riga solo-ARP (muta) dentro di esso, con chiave own-ip.
  const { foldScanRows } = require('../lib/host-merge.js');
  const rows = [
    { ip:'192.168.1.120', mac:'aa:bb:cc:00:00:01', snmpReachable:true,  serialNumber:'', engineId:'', usn:'', ownIps:['192.168.1.120','192.168.1.121'] },
    { ip:'192.168.1.121', mac:'aa:bb:cc:00:00:02', snmpReachable:false, serialNumber:'', engineId:'', usn:'', ownIps:[] },
  ];
  const { rows: out, folds } = foldScanRows(rows);
  assert.equal(folds, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].ip, '192.168.1.120');
  assert.equal(out[0]._mergeKey, 'own-ip');
  assert.deepEqual((out[0]._foldedRows || []).map(r => r.ip), ['192.168.1.121']);
});
