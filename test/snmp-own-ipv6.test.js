'use strict';
// extractData legge l'IPv6 PROPRIO del device dalla ipAddressTable (IP-MIB 4.34):
// l'indirizzo è nell'INDICE OID {addrType, addrLen, byte…}. Deve scartare link-local
// e IPv4, e scegliere il migliore (qui l'unica ULA stabile).
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData } = require('../drivers/snmp.js')._internals;

const BASE = '1.3.6.1.2.1.4.34.1.3'; // ipAddressIfIndex

// helper: OID index per un IPv6 (addrType=2, addrLen=16) dai suoi 16 byte
const v6oid = (bytes) => `${BASE}.2.16.${bytes.join('.')}`;

// fe80::1 (link-local) — deve essere scartato
const LL = [0xfe,0x80, 0,0,0,0,0,0, 0,0,0,0,0,0,0,1];
// fd12:3456:789a:0:211:32ff:fe8f:5351 (ULA EUI-64, stabile) — deve vincere
const ULA = [0xfd,0x12,0x34,0x56,0x78,0x9a,0,0, 0x02,0x11,0x32,0xff,0xfe,0x8f,0x53,0x51];

test('extractData: ip6 = indirizzo PROPRIO del device (ULA), scarta link-local e IPv4', () => {
  const vbs = {
    '1.3.6.1.2.1.1.5.0': Buffer.from('NAS'),                       // sysName (hostname)
    [v6oid(LL)]:  5,                                                // link-local → scartato
    [v6oid(ULA)]: 5,                                                // ULA stabile → scelto
    '1.3.6.1.2.1.4.34.1.3.1.4.192.168.1.120': 5,                   // IPv4 (addrType=1) → ignorato
  };
  const d = extractData(vbs);
  assert.equal(d.ip6, 'fd12:3456:789a:0:211:32ff:fe8f:5351');
});

test('extractData: nessun IPv6 routabile → ip6 null (solo link-local)', () => {
  const d = extractData({ '1.3.6.1.2.1.1.5.0': Buffer.from('SW'), [v6oid(LL)]: 1 });
  assert.equal(d.ip6, null);
});

test('extractData: nessuna ipAddressTable → ip6 null (nessun campo aggiunto rotto)', () => {
  const d = extractData({ '1.3.6.1.2.1.1.5.0': Buffer.from('SW') });
  assert.equal(d.ip6, null);
});
