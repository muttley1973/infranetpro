'use strict';
// Una sottointerfaccia dot1Q non è «niente»: è dove vivono la VLAN e l'indirizzo.
//
// I valori non sono inventati: sono quelli letti il 2026-08-20 da un Cisco CSR1000v
// (IOS-XE Amsterdam) sul banco, appeso in trunk a SW-ACC2. Il router annuncia
// `Gi1.99` con ifType 135, dichiara `VLAN 99 → ifIndex 7` nella tabella Cisco e
// `7 sopra 1` nella ifStackTable — e su quella sottointerfaccia, non su Gi1, sta
// l'indirizzo 10.10.99.41 con cui InfraNet lo interroga.
//
// Prima il driver la scartava come «non fisica»: sparivano insieme l'interfaccia,
// il suo indirizzo e l'unico punto in cui quella VLAN era DICHIARATA.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');

// Il CSR del banco, ridotto alle colonne che decidono. ifType: 6=ethernetCsmacd,
// 135=l2vlan(dot1Q), 1=other (Vo0/Nu0, che restano fuori come prima).
function csr(extra) {
  const v = {
    [`${OID.sysName}.0`]: B('CSR1000'),
    [`${OID.ifDescr}.1`]: B('Gi1'),    [`${OID.ifType}.1`]: 6,
    [`${OID.ifDescr}.7`]: B('Gi1.99'), [`${OID.ifType}.7`]: 135,
    // 7 poggia su 1 — è il router che lo dichiara, non noi che leggiamo il nome
    [`${OID.ifStackStatus}.7.1`]: 1,
    // cviRoutedVlanIfIndex: l'indice porta la VLAN, il valore l'ifIndex
    [`${OID.cviRoutedVlan}.99.1`]: 7,
    [`${OID.cviRoutedVlan}.1.1`]: 1,
  };
  return Object.assign(v, extra || {});
}
const subOf = vbs => (extractData(vbs).subInterfaces || [])[0] || {};

test('la sottointerfaccia dot1Q non viene più scartata (CSR1000v, dal banco)', () => {
  const d = extractData(csr());
  assert.equal(d.subInterfaces.length, 1, 'Gi1.99 deve esserci');
  assert.equal(d.subInterfaces[0].name, 'Gi1.99');
});

test('la VLAN è quella DICHIARATA dall\'apparato, non quella scritta nel nome', () => {
  assert.equal(subOf(csr()).vlan, 99);
});

test('senza la tabella Cisco la VLAN resta ignota: il nome non è una misura', () => {
  // Stesso apparato, stessa `Gi1.99`, ma l'agente non pubblica cviRoutedVlanIfIndex
  // (è il caso del vIOS L2, misurato: la tabella è vuota). Dedurre 99 da «Gi1.99»
  // sarebbe la stessa scommessa di «sei byte ⇒ è un MAC»: qui non si indovina.
  const v = csr();
  delete v[`${OID.cviRoutedVlan}.99.1`];
  delete v[`${OID.cviRoutedVlan}.1.1`];
  const s = subOf(v);
  assert.equal(s.name, 'Gi1.99', 'l\'interfaccia resta, è la VLAN a mancare');
  assert.equal(s.vlan, undefined, 'VLAN non dichiarata ⇒ non risulta, non 99 e non 1');
});

test('la sottointerfaccia dichiara la porta FISICA su cui vive (ifStackTable)', () => {
  assert.equal(subOf(csr()).parentIndex, 1, 'Gi1.99 vive su ifIndex 1 = Gi1');
});

test('senza ifStackTable il genitore resta 0, non un numero plausibile', () => {
  const v = csr();
  delete v[`${OID.ifStackStatus}.7.1`];
  assert.equal(subOf(v).parentIndex, 0);
});

test('la sottointerfaccia NON entra fra le porte fisiche (non è cablabile)', () => {
  const d = extractData(csr());
  assert.deepEqual(d.interfaces.map(p => p.name), ['Gi1'],
    'fra le porte cablabili deve restare la sola Gi1');
  assert.equal(d.lags.length, 0);
});

test('la premessa del caso: sul banco l\'indirizzo di management sta sulla SOTTOINTERFACCIA', () => {
  // Se un domani qualcuno "sistemasse" la fixture spostando l'indirizzo su Gi1,
  // il caso smetterebbe di essere quello misurato senza che nessun test se ne accorga.
  // ipAdEntIfIndex: 10.10.99.41 → ifIndex 7, non 1.
  const v = csr({ [`${OID.ipAddrIfIndex}.10.10.99.41`]: 7 });
  const d = extractData(v);
  assert.equal(d.subInterfaces[0].index, 7,
    'l\'ifIndex che porta l\'indirizzo è quello della sottointerfaccia');
});
