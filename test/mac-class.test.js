'use strict';
// Test degli helper puri di classificazione MAC (lib/mac-class.js).
const test = require('node:test');
const assert = require('node:assert');
const { isVirtualMac, isRandomizedMac, countMacsPerPort } = require('../lib/mac-class.js');

test('isVirtualMac: riconosce NIC virtuali note (Docker/VMware/Hyper-V/KVM/VBox)', () => {
  assert.equal(isVirtualMac('02:42:ac:11:00:02'), true);  // Docker
  assert.equal(isVirtualMac('00:50:56:aa:bb:cc'), true);  // VMware
  assert.equal(isVirtualMac('00:15:5d:01:02:03'), true);  // Hyper-V
  assert.equal(isVirtualMac('52:54:00:12:34:56'), true);  // KVM/QEMU
  assert.equal(isVirtualMac('08:00:27:ab:cd:ef'), true);  // VirtualBox
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
