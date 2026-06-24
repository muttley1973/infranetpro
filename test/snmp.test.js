// Test di regressione per le funzioni pure del driver SNMP.
// Esecuzione: `npm test` (usa node --test, nessuna dipendenza esterna).
// Coprono la classe di bug gia' incontrati: decodifica PortList/LAG, MAC, interi SNMP.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bufToStr, bufToInt, decodePortList, isRealMac, macToStr, logicalLagIdFromName, _oidGt,
} = require('../drivers/snmp.js')._internals;

test('_oidGt: confronto OID per archi numerici (guard anti-loop walk)', () => {
  // crescente per arco numerico (non lessicografico): .10 > .9
  assert.equal(_oidGt('1.3.6.1.2.1.2.2.1.2.10', '1.3.6.1.2.1.2.2.1.2.9'), true);
  assert.equal(_oidGt('1.3.6.1.2.1.2.2.1.2.2',  '1.3.6.1.2.1.2.2.1.2.10'), false);
  // prefisso più lungo = maggiore (figlio nel sottoalbero)
  assert.equal(_oidGt('1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.5'), true);
  // uguale → NON strettamente maggiore (è il caso di loop: OID che non avanza)
  assert.equal(_oidGt('1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.5.0'), false);
  // arco alto vince
  assert.equal(_oidGt('1.3.6.1.4.1.9', '1.3.6.1.2.1.99'), true);
});

test('bufToStr: pulisce NUL e trim, gestisce non-buffer', () => {
  assert.equal(bufToStr(Buffer.from('switch01\0\0', 'utf8')), 'switch01');
  assert.equal(bufToStr(Buffer.from('  hub  ', 'utf8')), 'hub');
  assert.equal(bufToStr('  plain  '), 'plain');
  assert.equal(bufToStr(null), '');
});

test('bufToInt: decodifica 1/2/4 byte big-endian e stringhe', () => {
  assert.equal(bufToInt(Buffer.from([5])), 5);
  assert.equal(bufToInt(Buffer.from([0x01, 0x00])), 256);
  assert.equal(bufToInt(Buffer.from([0xff, 0xff, 0xff, 0xff])), 0xffffffff); // unsigned
  assert.equal(bufToInt('42'), 42);
  assert.equal(bufToInt('boh'), 0);
});

test('decodePortList: bitmap IEEE 802.1D, byte0 MSB = bridge port 1', () => {
  assert.deepEqual(decodePortList(Buffer.from([0x80])), [1]);          // 1000 0000
  assert.deepEqual(decodePortList(Buffer.from([0xC0])), [1, 2]);       // 1100 0000
  assert.deepEqual(decodePortList(Buffer.from([0x00, 0x80])), [9]);    // bit7 del 2o byte
  assert.deepEqual(decodePortList(Buffer.from([0x01])), [8]);          // 0000 0001
  assert.deepEqual(decodePortList(Buffer.alloc(0)), []);
  assert.deepEqual(decodePortList('non-buffer'), []);
});

test('isRealMac: 6 byte con almeno un byte non nullo', () => {
  assert.equal(isRealMac(Buffer.from([0xaa, 0, 0, 0, 0, 0])), true);
  assert.equal(isRealMac(Buffer.alloc(6)), false);          // tutti zero (interfaccia virtuale)
  assert.equal(isRealMac(Buffer.from([1, 2, 3])), false);   // lunghezza errata
  assert.equal(isRealMac('aa:bb'), false);
});

test('macToStr: formatta 6 byte in esadecimale con due cifre', () => {
  assert.equal(macToStr(Buffer.from([0xaa, 0xbb, 0xcc, 0x00, 0x11, 0x22])), 'aa:bb:cc:00:11:22');
  assert.equal(macToStr(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])), '01:02:03:04:05:06');
  assert.equal(macToStr(Buffer.from([1, 2, 3])), ''); // lunghezza errata
});

test('logicalLagIdFromName: nome aggregatore multi-vendor -> id logico', () => {
  // Vendor che espongono LAG con nomi diversi (regressione fix lagId logico)
  assert.equal(logicalLagIdFromName('Port-channel1'), 1);        // Cisco IOS
  assert.equal(logicalLagIdFromName('Po10'), 10);                // Cisco abbrev.
  assert.equal(logicalLagIdFromName('lag1'), 1);                 // ArubaCX
  assert.equal(logicalLagIdFromName('lag256'), 256);             // ArubaCX
  assert.equal(logicalLagIdFromName('Eth-Trunk5'), 5);           // Huawei
  assert.equal(logicalLagIdFromName('Bridge-Aggregation12'), 12);// HPE/H3C Comware
  assert.equal(logicalLagIdFromName('ae3'), 3);                  // Juniper
  assert.equal(logicalLagIdFromName('reth1'), 1);                // Juniper redundant
  assert.equal(logicalLagIdFromName('bond4'), 4);                // Linux bonding
  assert.equal(logicalLagIdFromName('trk2'), 2);                 // HP ProCurve
});

test('logicalLagIdFromName: NON-LAG e casi limite -> 0', () => {
  assert.equal(logicalLagIdFromName('GigabitEthernet0/1'), 0);   // porta fisica
  assert.equal(logicalLagIdFromName('1/1/1'), 0);                // porta ArubaCX fisica
  assert.equal(logicalLagIdFromName('lag'), 0);                  // senza numero
  assert.equal(logicalLagIdFromName('bond0'), 0);                // id 0 non valido
  assert.equal(logicalLagIdFromName(''), 0);
  assert.equal(logicalLagIdFromName(null), 0);
});
