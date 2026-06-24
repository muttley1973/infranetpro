// Test per il modulo CIDR/IPv4 puro estratto da app.js (lib/cidr.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { _parseIpv4Int, _parseCidrInfo, _ipInCidr } = require('../lib/cidr.js');

test('_parseIpv4Int: parsing e validazione ottetti', () => {
  assert.equal(_parseIpv4Int('0.0.0.0'), 0);
  assert.equal(_parseIpv4Int('255.255.255.255'), 0xffffffff);
  assert.equal(_parseIpv4Int('192.168.1.10'), ((192 << 24) >>> 0) + (168 << 16) + (1 << 8) + 10);
  assert.equal(_parseIpv4Int('192.168.1'), null);     // 3 ottetti
  assert.equal(_parseIpv4Int('192.168.1.256'), null); // fuori range
  assert.equal(_parseIpv4Int('a.b.c.d'), null);
  assert.equal(_parseIpv4Int(''), null);
});

test('_parseCidrInfo: rete/mask/broadcast corretti', () => {
  const c = _parseCidrInfo('192.168.10.0/24');
  assert.equal(c.prefix, 24);
  assert.equal(c.mask >>> 0, 0xffffff00);
  assert.equal(c.network, _parseIpv4Int('192.168.10.0'));
  assert.equal(c.broadcast, _parseIpv4Int('192.168.10.255'));

  const c30 = _parseCidrInfo('10.0.0.4 / 30'); // spazi tollerati
  assert.equal(c30.prefix, 30);
  assert.equal(c30.network, _parseIpv4Int('10.0.0.4'));
  assert.equal(c30.broadcast, _parseIpv4Int('10.0.0.7'));

  const c0 = _parseCidrInfo('0.0.0.0/0');
  assert.equal(c0.mask, 0);
  assert.equal(c0.network, 0);

  assert.equal(_parseCidrInfo('192.168.1.0'), null);    // senza prefisso
  assert.equal(_parseCidrInfo('192.168.1.0/33'), null); // prefisso non valido
  assert.equal(_parseCidrInfo(''), null);
});

test('_ipInCidr: appartenenza alla subnet', () => {
  const c = _parseCidrInfo('192.168.10.0/24');
  assert.equal(_ipInCidr('192.168.10.1', c), true);
  assert.equal(_ipInCidr('192.168.10.254', c), true);
  assert.equal(_ipInCidr('192.168.11.1', c), false);
  assert.equal(_ipInCidr('10.0.0.1', c), false);
  assert.equal(_ipInCidr('non-ip', c), false);
  assert.equal(_ipInCidr('192.168.10.1', null), false);

  const c30 = _parseCidrInfo('10.0.0.4/30'); // host validi .5 .6
  assert.equal(_ipInCidr('10.0.0.5', c30), true);
  assert.equal(_ipInCidr('10.0.0.8', c30), false);
});
