'use strict';
// Test degli helper puri di classificazione MAC (lib/mac-class.js).
const test = require('node:test');
const assert = require('node:assert');
const { isVirtualMac, isRandomizedMac, countMacsPerPort, sharedMacsInBatch } = require('../lib/mac-class.js');

test('isVirtualMac: riconosce NIC virtuali note (Docker/VMware/Hyper-V/KVM/VBox)', () => {
  assert.equal(isVirtualMac('02:42:ac:11:00:02'), true);  // Docker
  assert.equal(isVirtualMac('00:50:56:aa:bb:cc'), true);  // VMware
  assert.equal(isVirtualMac('00:15:5d:01:02:03'), true);  // Hyper-V
  assert.equal(isVirtualMac('52:54:00:12:34:56'), true);  // KVM/QEMU
  assert.equal(isVirtualMac('08:00:27:ab:cd:ef'), true);  // VirtualBox
});

test('sharedMacsInBatch: il MAC del gateway (stesso MAC su piu\' IP remoti) e\' condiviso, i MAC unici no', () => {
  // Scenario reale: scoperta di una subnet routed. L'ARP restituisce il MAC del
  // next-hop (gateway) per ogni IP remoto -> 3 righe diverse, STESSO MAC.
  const batch = [
    { ip: '10.2.0.5', mac: 'AA:BB:CC:00:00:01' },   // gateway MAC (next-hop)
    { ip: '10.2.0.6', mac: 'AA:BB:CC:00:00:01' },   // stesso MAC, altro IP
    { ip: '10.2.0.7', mac: 'AA:BB:CC:00:00:01' },   // idem
    { ip: '10.0.0.9', mac: 'DE:AD:BE:EF:00:09' },   // endpoint reale: MAC unico
  ];
  // Default normalizer = _hex (minuscolo, senza separatori): 'aabbcc000001'.
  const shared = sharedMacsInBatch(batch);
  assert.equal(shared.has('aabbcc000001'), true, 'il MAC su 3 IP e\' condiviso');
  assert.equal(shared.has('deadbeef0009'), false, 'il MAC su 1 solo IP NON e\' condiviso');
  assert.equal(shared.size, 1);
});

test('sharedMacsInBatch: rispetta il normalizzatore passato + robusto a input monchi', () => {
  const norm = (m) => String(m || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  const shared = sharedMacsInBatch([
    { ip: '1.1.1.1', mac: 'aa-bb-cc-00-00-01' },
    { ip: '1.1.1.2', mac: 'AA:BB:CC:00:00:01' },   // stesso MAC, formato diverso
    { ip: '1.1.1.1', mac: 'aa-bb-cc-00-00-01' },   // IP DUPLICATO -> non conta come 2° IP
    { mac: 'no-ip' }, { ip: '1.1.1.9' }, null,      // input monchi ignorati
  ], norm);
  assert.equal(shared.has('AABBCC000001'), true, 'stesso MAC su 2 IP distinti (normalizzati) = condiviso');
  assert.deepEqual([...sharedMacsInBatch(undefined)], [], 'input assurdo -> set vuoto, mai throw');
});

test('isVirtualMac: false su MAC fisici reali', () => {
  assert.equal(isVirtualMac('a4:bb:6d:11:22:33'), false);
  assert.equal(isVirtualMac('00:1b:21:00:00:01'), false);
});

test('isVirtualMac: robusto a separatori e maiuscole', () => {
  assert.equal(isVirtualMac('0242.AC11.0002'), true);
  assert.equal(isVirtualMac('005056AABBCC'), true);
  assert.equal(isVirtualMac(''), false);
  assert.equal(isVirtualMac(null), false);
});

test('isRandomizedMac: bit locally-administered (0x02) => true', () => {
  // primo ottetto con bit 0x02: x2/x6/xA/xE
  assert.equal(isRandomizedMac('a2:bb:cc:dd:ee:ff'), true);  // 0xa2 & 0x02
  assert.equal(isRandomizedMac('06:11:22:33:44:55'), true);  // 0x06 & 0x02
  assert.equal(isRandomizedMac('fe:00:00:00:00:01'), true);  // 0xfe & 0x02
});

test('isRandomizedMac: bit non settato (MAC vendor universale) => false', () => {
  assert.equal(isRandomizedMac('a4:bb:6d:11:22:33'), false); // 0xa4 & 0x02 = 0
  assert.equal(isRandomizedMac('00:50:56:aa:bb:cc'), false); // 0x00
  assert.equal(isRandomizedMac('f0:18:98:00:00:01'), false); // 0xf0
});

test('isRandomizedMac: input degeneri => false (no crash)', () => {
  assert.equal(isRandomizedMac(''), false);
  assert.equal(isRandomizedMac('z'), false);
  assert.equal(isRandomizedMac(undefined), false);
});

test('countMacsPerPort: conta i MAC per ifName', () => {
  const fdb = {
    'aa:00:00:00:00:01': 'Gi1/0/1',
    'aa:00:00:00:00:02': 'Gi1/0/1',
    'aa:00:00:00:00:03': 'Gi1/0/1',
    'bb:00:00:00:00:01': 'Gi1/0/2',
  };
  const c = countMacsPerPort(fdb);
  assert.equal(c['Gi1/0/1'], 3);
  assert.equal(c['Gi1/0/2'], 1);
});

test('countMacsPerPort: input vuoto/non valido => oggetto vuoto', () => {
  assert.deepEqual(countMacsPerPort({}), {});
  assert.deepEqual(countMacsPerPort(null), {});
  assert.deepEqual(countMacsPerPort(undefined), {});
});
