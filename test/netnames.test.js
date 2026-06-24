// Test per la normalizzazione nomi interfaccia / MAC / FDB (lib/netnames.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { _canonLagToken, _normMacKey, _ifNameMeta, _normIfName, _normalizeFdbTable } = require('../lib/netnames.js');

test('_canonLagToken: id -> token canonico', () => {
  assert.equal(_canonLagToken('1'), 'lag:1');
  assert.equal(_canonLagToken(256), 'lag:256');
  assert.equal(_canonLagToken('0'), 'lag:0');
  assert.equal(_canonLagToken('x'), '');
});

test('_normMacKey: normalizza qualsiasi formato MAC', () => {
  assert.equal(_normMacKey('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(_normMacKey('aabb.ccdd.eeff'), 'aa:bb:cc:dd:ee:ff'); // formato Cisco
  assert.equal(_normMacKey('aa:bb:cc:dd:ee:ff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(_normMacKey('AABBCCDDEEFF'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(_normMacKey('aa:bb:cc'), '');   // incompleto
  assert.equal(_normMacKey(''), '');
});

test('_normIfName: nomi vendor-neutral verso forma normalizzata', () => {
  // Cisco
  assert.equal(_normIfName('GigabitEthernet0/0/1'), '0/0/1');
  assert.equal(_normIfName('Gi0/1'), '0/1');
  assert.equal(_normIfName('TenGigabitEthernet0/0/3'), '0/0/3');
  // Aruba CX / Ethernet
  assert.equal(_normIfName('1/1/1'), '1/1/1');
  assert.equal(_normIfName('Ethernet 1/1/1'), '1/1/1');
  // Juniper unità logica
  assert.equal(_normIfName('ge-0/0/0.0'), '0/0/0');
  // MAC -> stringa vuota (port-id subtype MAC non abbinabile)
  assert.equal(_normIfName('aa:bb:cc:dd:ee:ff'), '');
  assert.equal(_normIfName(''), '');
});

test('_ifNameMeta: riconosce LAG e management', () => {
  assert.equal(_ifNameMeta('Port-channel1').lagToken, 'lag:1');
  assert.equal(_ifNameMeta('ae5').lagToken, 'lag:5');
  assert.equal(_ifNameMeta('Eth-Trunk10').lagToken, 'lag:10');
  assert.equal(_ifNameMeta('lag256').norm, 'lag:256');
  assert.equal(_ifNameMeta('mgmt0').norm, 'mgmt:0');
  assert.equal(_ifNameMeta('aa:bb:cc:dd:ee:ff').isMac, true);
  // una porta fisica NON deve essere vista come LAG
  assert.equal(_ifNameMeta('GigabitEthernet0/1').lagToken, '');
});

test('_ifNameMeta: nomi equivalenti normalizzano allo stesso valore', () => {
  // matching LLDP: "GigabitEthernet0/1" e "Gi0/1" devono coincidere
  assert.equal(_ifNameMeta('GigabitEthernet0/1').norm, _ifNameMeta('Gi0/1').norm);
  assert.equal(_ifNameMeta('TenGigabitEthernet1/0/1').norm, _ifNameMeta('Te1/0/1').norm);
});

test('_normalizeFdbTable: chiavi MAC coerenti, scarta MAC non validi', () => {
  const fdb = {
    'AABB.CCDD.EEFF': 'Gi0/1',
    'aa:bb:cc:dd:ee:00': 'Gi0/2',
    'bad-mac': 'Gi0/3',     // scartato
  };
  const out = _normalizeFdbTable(fdb);
  assert.equal(out['aa:bb:cc:dd:ee:ff'], 'Gi0/1');
  assert.equal(out['aa:bb:cc:dd:ee:00'], 'Gi0/2');
  assert.equal(Object.keys(out).length, 2);
  assert.deepEqual(_normalizeFdbTable(null), {});
});
