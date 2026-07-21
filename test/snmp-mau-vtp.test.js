'use strict';
// ============================================================
// Regressione SNMP-A1 (MAU-MIB) + SNMP-A2 (Cisco VTP trunk off-by-one).
// Audit 2026-07-21: entrambi violazioni ② no-invenzioni (dato SNMP inventato).
//
// SNMP-A1: ifMauType è indicizzato { ifMauIfIndex, ifMauIndex }. Il vecchio codice
//   prendeva l'ULTIMO sub-id (= ifMauIndex, ~sempre 1) come chiave → tutte le porte
//   collassavano sull'indice 1. In più la tabella rame/fibra non rispettava il
//   registro IANA dot3MauType (gigabit rame 30 → "fibra"; SX fibra 26 → "rame").
// SNMP-A2: le OID vlanTrunkPortDynamicState/Status erano lette a .14/.15 invece di
//   .13/.14 (colonne reali del CISCO-VTP-MIB). Gemello dell'ifStackStatus .2→.3.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const MAC = () => Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
// ifMauType: il VALORE è l'OID del tipo (…26.4.<code>); la CHIAVE è "<ifIndex>.<mauIndex>".
const mauVal = code => `1.3.6.1.2.1.26.4.${code}`;

// Costruisce una porta fisica (ifType=6) con nome, MAC e (opz.) codice MAU.
function addIface(vbs, idx, name, mauCode) {
  vbs[`${OID.ifDescr}.${idx}`]       = name;
  vbs[`${OID.ifType}.${idx}`]        = 6;
  vbs[`${OID.ifPhysAddress}.${idx}`] = MAC();
  vbs[`${OID.ifOperStatus}.${idx}`]  = 1;
  if (mauCode != null) vbs[`${OID.mauType}.${idx}.1`] = mauVal(mauCode);
}

test('SNMP-A1: MAU indicizzato per ifIndex (non per ifMauIndex) → mezzo per-porta corretto', () => {
  const vbs = {};
  addIface(vbs, 10, 'Gi0/1', 30); // 1000BaseTFD  → copper
  addIface(vbs, 11, 'Gi0/2', 26); // 1000BaseSXFD → fiber
  addIface(vbs, 12, 'Gi0/3', 16); // 100BaseTXFD  → copper (regressione: prima "fiber")
  addIface(vbs, 13, 'Te0/1', 40); // 10GbaseSW    → fiber  (regressione: prima "copper")
  addIface(vbs, 14, 'Te0/2', 41); // 10GbaseCX4   → dac
  addIface(vbs, 15, 'Te0/3', 33); // 10GbaseR unknown-PMD → nessun mezzo (null)

  const out = extractData(vbs);
  const med = {};
  for (const p of out.interfaces) med[p.index] = p.snmpMedium;

  // Prova dell'indice: porte DIVERSE hanno mezzi DIVERSI (col vecchio bug collassavano
  // tutte sull'indice 1 → tutte undefined).
  assert.equal(med[10], 'copper', 'Gi0/1 = 1000BASE-T → rame');
  assert.equal(med[11], 'fiber',  'Gi0/2 = 1000BASE-SX → fibra');
  assert.equal(med[12], 'copper', '100BASE-TX FD → rame (registro IANA)');
  assert.equal(med[13], 'fiber',  '10GBASE-SW → fibra (registro IANA)');
  assert.equal(med[14], 'dac',    '10GBASE-CX4 → twinax/DAC');
  assert.equal(med[15], undefined, 'PMD sconosciuto → nessun mezzo dichiarato (② no-invenzioni)');
});

test('SNMP-A2: trunk Cisco VTP letto dalle colonne .13/.14 (DynamicState/Status)', () => {
  const vbs = {};
  addIface(vbs, 10, 'Gi0/1');   // dynState=on
  addIface(vbs, 11, 'Gi0/2');   // dynState=desirable + status=trunking + 2 VLAN → trunk
  addIface(vbs, 12, 'Gi0/3');   // dynState=desirable + status=notTrunking → NON trunk

  // Nessuna Q-BRIDGE bitmap → si passa dal fallback Cisco VTP.
  // Colonne REALI del CISCO-VTP-MIB: .13 = DynamicState, .14 = DynamicStatus.
  vbs[`${OID.vlanTrunkPortDynState}.10`] = 1;   // on
  vbs[`${OID.vlanTrunkPortDynState}.11`] = 3;   // desirable
  vbs[`${OID.vlanTrunkPortStatus}.11`]   = 1;   // trunking
  vbs[`${OID.vlanTrunkPortVlans}.11`]    = Buffer.from([0x00, 0x20, 0x08]); // VLAN 10,20
  vbs[`${OID.vlanTrunkPortDynState}.12`] = 3;   // desirable
  vbs[`${OID.vlanTrunkPortStatus}.12`]   = 2;   // notTrunking

  const out = extractData(vbs);
  const byIdx = {};
  for (const p of out.interfaces) byIdx[p.index] = p;

  assert.equal(byIdx[10].isTrunk, true,  'dynState=on (.13) → trunk configurato');
  assert.equal(byIdx[11].isTrunk, true,  'desirable + trunking (.14) + 2 VLAN → trunk DTP negoziato');
  assert.deepEqual(byIdx[11].trunkVlans, [10, 20], 'VLAN del trunk decodificate dalla bitmap');
  assert.equal(byIdx[12].isTrunk, false, 'desirable ma notTrunking (.14) → NON trunk');
});
