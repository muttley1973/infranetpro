'use strict';
// La VLAN nativa di un trunk Cisco si legge, non si dà per 1.
//
// Su IOS il PVID standard (dot1qPvid) non copre i trunk e vmVlan vale solo per le
// porte access: la nativa sta in vlanTrunkPortNativeVlan, colonna .5 della tabella
// VTP. Misurato sul banco il 2026-08-20: sul vIOS L2 quella colonna RISPONDE — su
// SW-ACC1 dava 1 su nove porte — mentre le altre due sorgenti tacciono del tutto.
// Finché non la si leggeva, la nativa di ogni trunk risultava 1: giusto per caso
// quando la nativa è davvero 1, sbagliato e indistinguibile appena non lo è.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');

// Un trunk Cisco configurato esplicitamente (dynState=1 = on), con due VLAN
// trasportate: la forma che il predicato di trunk riconosce.
function trunk(nativa) {
  const v = {
    [`${OID.sysName}.0`]: B('SW-TEST'),
    [`${OID.ifDescr}.1`]: B('Gi0/1'), [`${OID.ifType}.1`]: 6,
    [`${OID.vlanTrunkPortDynState}.1`]: 1,
    // bitmap VLAN abilitate: byte 0 bit per VLAN 0..7 → accende 1 e 30
    [`${OID.vlanTrunkPortVlans}.1`]: Buffer.from([0b01000000, 0, 0, 0b10000000]),
  };
  if (nativa !== undefined) v[`${OID.vlanTrunkPortNative}.1`] = nativa;
  return v;
}
const porta = vbs => extractData(vbs).interfaces[0] || {};

test('la nativa dichiarata del trunk diventa la VLAN della porta', () => {
  const p = porta(trunk(99));
  assert.equal(p.isTrunk, true, 'precondizione: la porta è riconosciuta come trunk');
  assert.equal(p.vlan, 99, 'nativa 99 dichiarata ⇒ la porta è sulla 99, non sulla 1');
});

test('una nativa che vale davvero 1 resta 1 (nessun effetto collaterale)', () => {
  assert.equal(porta(trunk(1)).vlan, 1);
});

test('la nativa entra nell\'elenco VLAN del device', () => {
  assert.ok(extractData(trunk(99)).vlans.includes(99),
    'una VLAN nativa dichiarata è una VLAN che esiste su quell\'apparato');
});

test('valori fuori intervallo sono ignorati, non scritti', () => {
  // 0 e 4095 non sono VLAN: un agente che li ritorna sta dicendo "nessuna".
  assert.notEqual(porta(trunk(0)).vlan, 0);
  assert.notEqual(porta(trunk(4095)).vlan, 4095);
});

test('su una porta ACCESS la colonna non viene applicata', () => {
  // La tabella VTP resta popolata anche sulle porte non-trunk: applicarla lì
  // significherebbe chiamare "nativa" una colonna che per quella porta non vuol
  // dire niente. dynState=2 = off/access.
  const v = trunk(99);
  v[`${OID.vlanTrunkPortDynState}.1`] = 2;
  const p = porta(v);
  assert.equal(p.isTrunk, false, 'precondizione: qui NON è un trunk');
  assert.notEqual(p.vlan, 99, 'la nativa di un trunk non si applica a una porta access');
});
