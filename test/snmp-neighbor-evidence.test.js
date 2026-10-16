'use strict';
// Le PROVE di tipo del vicino arrivano dal driver: modello (sysDesc / cdpCachePlatform) e
// capabilities, come l'agente le consegna. Il driver le passa, non le interpreta
// (lib/neighbor-type.js). E l'IP annunciato da CDP passa lo stesso filtro di quello LLDP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractNeighbors, N_OID } = require('../drivers/snmp.js')._internals;
const { inferNeighborType } = require('../lib/neighbor-type.js');

const B = s => Buffer.from(s, 'utf8');
const IDX = '0.2.1';          // LLDP: timeFilter.localPortNum.remIdx
const CIDX = '2.1';           // CDP: localIfIndex.remIdx

const base = () => ({ [`${N_OID.sysName}.0`]: B('R-EDGE') });
const first = v => (extractNeighbors(v).neighbors || [])[0] || {};

test('LLDP: sysDesc e SysCapEnabled escono come remotePlatform / remoteCaps (hex)', () => {
  const n = first(Object.assign(base(), {
    [`${N_OID.lldpRemSysName}.${IDX}`]: B('AP-PIANO1'),
    [`${N_OID.lldpRemChassisIdSubtype}.${IDX}`]: 4,
    [`${N_OID.lldpRemChassisId}.${IDX}`]: Buffer.from([0x50, 0x25, 0xc2, 0x00, 0x29, 0x00]),
    [`${N_OID.lldpRemSysDesc}.${IDX}`]: B('Ubiquiti UniFi AP U6-Lite'),
    [`${N_OID.lldpRemSysCapEnabled}.${IDX}`]: Buffer.from([0x30, 0x00]),
  }));
  assert.equal(n.remotePlatform, 'Ubiquiti UniFi AP U6-Lite');
  assert.equal(n.remoteCaps, '3000');
  assert.equal(inferNeighborType({ protocol: n.protocol, caps: n.remoteCaps, platform: n.remotePlatform }).type, 'ap');
});

test('CDP: cdpCachePlatform e cdpCacheCapabilities escono nello stesso modo', () => {
  const n = first(Object.assign(base(), {
    [`${N_OID.cdpDeviceId}.${CIDX}`]: B('SEP001122334455'),
    [`${N_OID.cdpDevicePort}.${CIDX}`]: B('Port 1'),
    [`${N_OID.cdpPlatform}.${CIDX}`]: B('Cisco IP Phone 8841'),
    [`${N_OID.cdpCapabilities}.${CIDX}`]: Buffer.from([0, 0, 0, 0x90]),
    [`${N_OID.cdpAddress}.${CIDX}`]: Buffer.from([10, 0, 20, 7]),
  }));
  assert.equal(n.protocol, 'CDP');
  assert.equal(n.remotePlatform, 'Cisco IP Phone 8841');
  assert.equal(n.remoteCaps, '00000090');
  assert.equal(n.remoteIP, '10.0.20.7');
  assert.equal(inferNeighborType({ protocol: n.protocol, caps: n.remoteCaps, platform: n.remotePlatform }).type, 'voip');
});

test('agente senza le colonne nuove: i campi ci sono, vuoti, e il vicino non cambia', () => {
  const n = first(Object.assign(base(), { [`${N_OID.lldpRemSysName}.${IDX}`]: B('SW-OLD') }));
  assert.equal(n.remoteDevice, 'SW-OLD');
  assert.equal(n.remotePlatform, '');
  assert.equal(n.remoteCaps, '');
});

test('un sysDesc enorme è troncato: il vicino non porta kilobyte nel JSON del poll', () => {
  const n = first(Object.assign(base(), {
    [`${N_OID.lldpRemSysName}.${IDX}`]: B('X'),
    [`${N_OID.lldpRemSysDesc}.${IDX}`]: B('d'.repeat(5000)),
  }));
  assert.ok(n.remotePlatform.length <= 200);
});

test('CDP: un indirizzo inservibile (0.x, loopback, link-local) non diventa l\'IP del vicino', () => {
  for (const bytes of [[0, 0, 0, 0], [127, 0, 0, 1], [169, 254, 3, 4], [224, 0, 0, 1]]) {
    const n = first(Object.assign(base(), {
      [`${N_OID.cdpDeviceId}.${CIDX}`]: B('SW-X'),
      [`${N_OID.cdpAddress}.${CIDX}`]: Buffer.from(bytes),
    }));
    assert.equal(n.remoteDevice, 'SW-X');
    assert.equal(n.remoteIP, '', bytes.join('.'));
  }
});
