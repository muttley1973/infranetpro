'use strict';
// Rilevamento SNMPv3 "needs-credentials" senza falsi positivi.
// _v3RemoteEngineDiscovered distingue un agente v3 REALE (che fornisce il proprio
// engineID autorevole durante la USM engine-discovery) da un host vivo ma non-SNMP
// (VPCS/PC): quest'ultimo lascia net-snmp col SOLO engine LOCALE. Vendor-neutral:
// nessun PEN/prefisso hardcoded, solo "autorevole presente e != locale".
// Valori engineID reali osservati DAL VIVO sul lab PnetLab:
//   Cisco vIOS      auth=80000009030050... (PEN 9)     local=8000b98380...
//   net-snmp/VyOS   auth=80001f8880...     (PEN 8072)  local=8000b98380...
//   VPCS/PC/dead    auth=<none> oppure = local          local=8000b98380...
const test = require('node:test');
const assert = require('node:assert/strict');
const { _v3RemoteEngineDiscovered } = require('../drivers/snmp.js')._internals;

const buf = h => Buffer.from(h, 'hex');
const sess = (authHex, localHex) => ({
  msgSecurityParameters: authHex === null ? {} : { msgAuthoritativeEngineID: buf(authHex) },
  engine: localHex === null ? null : { engineID: buf(localHex) },
});

test('v3 detect: agente REALE (Cisco) -> engine remoto scoperto', () => {
  assert.equal(_v3RemoteEngineDiscovered(sess('80000009030050b76c002a00', '8000b98380c32444211f')), true);
});

test('v3 detect: agente REALE (net-snmp/VyOS) -> engine remoto scoperto', () => {
  assert.equal(_v3RemoteEngineDiscovered(sess('80001f8880448f5547b063476a', '8000b983808aba157b9b')), true);
});

test('v3 detect: host non-SNMP (VPCS) senza engine autorevole -> NON v3', () => {
  // Caso osservato dal vivo: msgAuthoritativeEngineID assente.
  assert.equal(_v3RemoteEngineDiscovered(sess(null, '8000b9838044a70ebcac')), false);
});

test('v3 detect: engine autorevole == locale (net-snmp riflette il proprio) -> NON v3', () => {
  // Alcune corse lasciano net-snmp col PROPRIO engine locale come "autorevole":
  // uguale al locale -> NON e' un agente remoto.
  const same = '8000b98380deadbeef01';
  assert.equal(_v3RemoteEngineDiscovered(sess(same, same)), false);
});

test('v3 detect: engineID autorevole vuoto -> NON v3', () => {
  assert.equal(_v3RemoteEngineDiscovered({ msgSecurityParameters: { msgAuthoritativeEngineID: Buffer.alloc(0) }, engine: { engineID: buf('8000b98380aa') } }), false);
});

test('v3 detect: sessione assente/malformata -> NON v3 (nessun crash)', () => {
  assert.equal(_v3RemoteEngineDiscovered(null), false);
  assert.equal(_v3RemoteEngineDiscovered(undefined), false);
  assert.equal(_v3RemoteEngineDiscovered({}), false);
});

test('v3 detect: engine autorevole presente ma nessun engine locale -> v3 (e remoto)', () => {
  assert.equal(_v3RemoteEngineDiscovered(sess('80000009030050b76c002a00', null)), true);
});
