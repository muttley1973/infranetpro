'use strict';
// Test degli helper puri IPv6 (lib/ipv6.js).
const test = require('node:test');
const assert = require('node:assert');
const { isValidIpv6, canonicalizeIpv6, bytesToIpv6, macFromEui64, ipv6Class, isPrivacyIid, pickBestIp6 } = require('../lib/ipv6.js');

test('pickBestIp6: scarta link-local, preferisce stabile su privacy e global su ULA', () => {
  // link-local scartato; tra ULA-stabile e global-privacy vince lo STABILE (persistente).
  assert.equal(
    pickBestIp6(['fe80::1', 'fd12:3456:789a:0:211:32ff:fe8f:5351', '2001:db8::dead:beef:cafe:1']),
    'fd12:3456:789a:0:211:32ff:fe8f:5351');
  // a parità di stabilità, global batte ULA
  assert.equal(
    pickBestIp6(['fd00::211:22ff:fe33:4455', '2001:db8::211:22ff:fe33:4455']),
    '2001:db8::211:22ff:fe33:4455');
  // solo link-local/multicast → null
  assert.equal(pickBestIp6(['fe80::1', 'ff02::1', '::1']), null);
  assert.equal(pickBestIp6([]), null);
  assert.equal(pickBestIp6(null), null);
  // canonicalizza l'output
  assert.equal(pickBestIp6(['2001:0db8:0000::0001']), '2001:db8::1');
});

test('isValidIpv6: forme valide', () => {
  assert.equal(isValidIpv6('fe80::1'), true);
  assert.equal(isValidIpv6('2001:db8::1'), true);
  assert.equal(isValidIpv6('::1'), true);
  assert.equal(isValidIpv6('::'), true);
  assert.equal(isValidIpv6('2001:0db8:0000:0000:0000:0000:0000:0001'), true); // forma piena
  assert.equal(isValidIpv6('fd00::abcd'), true);                              // ULA
  assert.equal(isValidIpv6('FE80::1'), true);                                 // maiuscole
  assert.equal(isValidIpv6('fe80::1%eth0'), true);                            // zone-id
  assert.equal(isValidIpv6('::ffff:192.168.1.1'), true);                      // IPv4-mapped
});

test('isValidIpv6: forme NON valide (mai throw)', () => {
  assert.equal(isValidIpv6('192.168.1.1'), false);        // IPv4 puro
  assert.equal(isValidIpv6('1::2::3'), false);            // due '::'
  assert.equal(isValidIpv6('12345::'), false);            // hextet > 4 cifre
  assert.equal(isValidIpv6('gg::1'), false);              // hex non valido
  assert.equal(isValidIpv6('1:2:3:4:5:6:7:8:9'), false);  // 9 gruppi
  assert.equal(isValidIpv6('1:2:3:4:5:6:7'), false);      // 7 gruppi senza '::'
  assert.equal(isValidIpv6(''), false);
  assert.equal(isValidIpv6(null), false);
  assert.equal(isValidIpv6(undefined), false);
});

test('canonicalizeIpv6: zeri iniziali via, compressione della sequenza piu\' lunga', () => {
  assert.equal(canonicalizeIpv6('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(canonicalizeIpv6('FE80:0000:0000:0000:0000:0000:0000:0001'), 'fe80::1');
  assert.equal(canonicalizeIpv6('0:0:0:0:0:0:0:0'), '::');
  assert.equal(canonicalizeIpv6('::1'), '::1');
  assert.equal(canonicalizeIpv6('2001:db8::1'), '2001:db8::1'); // idempotente
});

test('canonicalizeIpv6: in parita\' comprime la PRIMA sequenza di zeri', () => {
  // due run di zeri lunghi 2 (idx 2-3 e idx 5-6): vince il primo.
  assert.equal(canonicalizeIpv6('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');
});

test('bytesToIpv6: 16 ottetti -> canonico; lunghezza errata -> null', () => {
  const b = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01];
  assert.equal(bytesToIpv6(b), '2001:db8::1');
  assert.equal(bytesToIpv6(Buffer.from(b)), '2001:db8::1');   // accetta Buffer
  assert.equal(bytesToIpv6([0, 1, 2]), null);
  assert.equal(bytesToIpv6(null), null);
});

test('macFromEui64: round-trip su vettore noto (link-local e global)', () => {
  // MAC 00:11:22:33:44:55 -> IID EUI-64: flip U/L (00->02), inserisci ff:fe.
  assert.equal(macFromEui64('fe80::0211:22ff:fe33:4455'), '00:11:22:33:44:55');
  assert.equal(macFromEui64('2001:db8::0211:22ff:fe33:4455'), '00:11:22:33:44:55');
});

test('macFromEui64: flip del bit U/L (0x02) sul primo ottetto', () => {
  // MAC universale a4:bb:6d:.. -> IID con primo ottetto a6 (a4 ^ 02).
  assert.equal(macFromEui64('fe80::a6bb:6dff:fe11:2233'), 'a4:bb:6d:11:22:33');
});

test('macFromEui64: null quando l\'IID NON e\' EUI-64 (no invenzioni)', () => {
  assert.equal(macFromEui64('2001:db8::dead:beef:cafe:1234'), null); // privacy/random
  assert.equal(macFromEui64('::1'), null);                            // loopback
  assert.equal(macFromEui64('fe80::1'), null);                        // IID basso manuale
  assert.equal(macFromEui64('non-un-ip'), null);
  assert.equal(macFromEui64(null), null);
});

test('ipv6Class: classi principali', () => {
  assert.equal(ipv6Class('::'), 'unspecified');
  assert.equal(ipv6Class('::1'), 'loopback');
  assert.equal(ipv6Class('ff02::1'), 'multicast');
  assert.equal(ipv6Class('fe80::1'), 'link-local');
  assert.equal(ipv6Class('fc00::1'), 'ula');
  assert.equal(ipv6Class('fd12:3456::1'), 'ula');
  assert.equal(ipv6Class('2001:db8::1'), 'global');
  assert.equal(ipv6Class('garbage'), null);
});

test('isPrivacyIid: random-looking global => true; EUI-64/basso/multicast => false', () => {
  assert.equal(isPrivacyIid('2001:db8::dead:beef:cafe:1234'), true);   // IID sparso, non EUI-64
  assert.equal(isPrivacyIid('fe80::a6bb:6dff:fe11:2233'), false);      // EUI-64
  assert.equal(isPrivacyIid('2001:db8::5'), false);                    // manuale basso
  assert.equal(isPrivacyIid('2001:db8::abcd'), false);                 // manuale basso
  assert.equal(isPrivacyIid('::1'), false);                            // loopback
  assert.equal(isPrivacyIid('ff02::1'), false);                        // multicast
  assert.equal(isPrivacyIid('non-valido'), false);
});
