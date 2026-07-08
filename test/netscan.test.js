'use strict';
// Parser ARP + normalizzazione MAC cross-platform.
// Regressione macOS: `arp` BSD stampa gli ottetti SENZA zeri iniziali
// (es. "0:1c:42:8:b:9") → vanno ri-paddati o il MAC (e quindi il vendor) si perde.
const { test } = require('node:test');
const assert = require('node:assert');
const { _parseArpTable, _normMac, DEEP_TCP_PORTS, _castProbe } = require('../server/netscan');

test('DEEP_TCP_PORTS: include le porte Google Cast (8008/8009) per il rilevamento media', () => {
  const ports = DEEP_TCP_PORTS.map(p => p.port);
  assert.ok(ports.includes(8008), '8008 (Cast) presente');
  assert.ok(ports.includes(8009), '8009 (Cast TLS) presente');
  assert.equal(typeof _castProbe, 'function', '_castProbe esportato');
});

test('_normMac: formato Windows con trattini', () => {
  assert.equal(_normMac('AA-BB-CC-DD-EE-FF'), 'AA:BB:CC:DD:EE:FF');
});

test('_normMac: formato colon completo', () => {
  assert.equal(_normMac('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
});

test('_normMac: ottetti macOS/BSD senza zeri iniziali vengono ripadddati', () => {
  assert.equal(_normMac('0:1c:42:8:b:9'), '00:1C:42:08:0B:09');
  assert.equal(_normMac('f4:39:9:0:0:1'), 'F4:39:09:00:00:01');
  assert.equal(_normMac('8:0:9:a:b:c'), '08:00:09:0A:0B:0C');
});

test('_normMac: scarta input non validi', () => {
  assert.equal(_normMac('not-a-mac'), '');
  assert.equal(_normMac(''), '');
  assert.equal(_normMac('1:2:3'), '');
});

test('_parseArpTable: tabella Windows (arp -a)', () => {
  const out = [
    'Interface: 192.168.1.10 --- 0x5',
    '  Internet Address      Physical Address      Type',
    '  192.168.1.1           d4-1a-d1-aa-bb-cc     dynamic',
    '  192.168.1.20          00-0c-29-01-02-03     dynamic',
  ].join('\n');
  const m = _parseArpTable(out);
  assert.equal(m.get('192.168.1.1'), 'D4:1A:D1:AA:BB:CC');
  assert.equal(m.get('192.168.1.20'), '00:0C:29:01:02:03');
});

test('_parseArpTable: macOS arp -an con ottetti senza zeri', () => {
  const out = [
    '? (192.168.1.1) at d4:1a:d1:aa:bb:cc on en0 ifscope [ethernet]',
    '? (192.168.1.20) at 0:c:29:1:2:3 on en0 ifscope [ethernet]',
    '? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]',
  ].join('\n');
  const m = _parseArpTable(out);
  assert.equal(m.get('192.168.1.1'), 'D4:1A:D1:AA:BB:CC');
  assert.equal(m.get('192.168.1.20'), '00:0C:29:01:02:03'); // ripaddato
  assert.equal(m.has('192.168.1.99'), false);               // (incomplete) ignorato
});

test('_parseArpTable: Linux arp -an ([ether])', () => {
  const out = '? (10.0.0.5) at f4:39:09:00:00:01 [ether] on eth0';
  const m = _parseArpTable(out);
  assert.equal(m.get('10.0.0.5'), 'F4:39:09:00:00:01');
});
