'use strict';
// Una VLAN che nessuno ha dichiarato resta ASSENTE.
//
// Il driver chiudeva con `vlan: f.vlan || 1`: un apparato muto sulla VLAN riceveva
// comunque un 1, e nel documento quel numero era indistinguibile da un 1 misurato.
// Da lì in poi ogni lettore lo trattava da misura — `_getLinkVlan` ritorna la vlan
// di una porta attiva PRIMA di guardare la propagata — e una VLAN 99 dichiarata o
// propagata non riusciva più a prevalere: perdeva contro un'invenzione.
//
// Misurato sul banco il 2026-08-20: su SW-ACC1 (Cisco vIOS L2) dot1qPvid e vmVlan
// non rispondono affatto, eppure tutte e nove le porte uscivano «VLAN 1». Sullo
// stesso banco l'Arista dichiara i suoi PVID (Ethernet3 = 30) e quelli sono veri:
// i due casi devono restare distinguibili nel documento.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');
const porta = (vbs, i = 0) => extractData(vbs).interfaces[i] || {};

// Una porta fisica e nient'altro: nessuna sorgente di VLAN risponde.
const muto = () => ({
  [`${OID.sysName}.0`]: B('SW-MUTO'),
  [`${OID.ifDescr}.1`]: B('Gi1/0'), [`${OID.ifType}.1`]: 6,
});

test('apparato muto sulla VLAN: il campo resta assente, non diventa 1', () => {
  const p = porta(muto());
  assert.equal(p.name, 'Gi1/0', 'la porta c\'è');
  assert.equal(p.vlan, undefined, 'la VLAN no: nessuno l\'ha dichiarata');
});

test('una VLAN dichiarata via dot1qPvid arriva intatta', () => {
  // dot1qPvid è indicizzato per BRIDGE PORT: serve dot1dBasePortIfIndex per
  // ricondurlo all'ifIndex. Bridge port 5 → ifIndex 1, PVID 30.
  const v = muto();
  v[`${OID.bridgePortIf}.5`] = 1;
  v[`${OID.dot1qPvid}.5`] = 30;
  assert.equal(porta(v).vlan, 30);
});

test('una VLAN dichiarata che vale 1 resta 1: è una misura, non un\'assenza', () => {
  const v = muto();
  v[`${OID.bridgePortIf}.5`] = 1;
  v[`${OID.dot1qPvid}.5`] = 1;
  assert.equal(porta(v).vlan, 1,
    'un 1 MISURATO deve restare distinguibile da un 1 mai misurato');
});

test('il ripiego Cisco vmVlan continua a valere quando il PVID tace', () => {
  const v = muto();
  v[`${OID.vmVlan}.1`] = 20;
  assert.equal(porta(v).vlan, 20);
});

test('l\'assenza non si propaga come 0 né come stringa vuota', () => {
  // Un consumatore che facesse `p.vlan > 0` deve vedere «niente», non uno zero
  // che poi finisce nel documento come se fosse una VLAN.
  const p = porta(muto());
  assert.notEqual(p.vlan, 0);
  assert.notEqual(p.vlan, '');
  assert.ok(!('vlan' in p) || p.vlan === undefined);
});
