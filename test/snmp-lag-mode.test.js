'use strict';
// ============================================================
// SNMP-M1 (audit 2026-07-21, VERIFICATO dal vivo su Zyxel GS1900): l'etichetta di
// modalità LACP (active/passive) va messa SOLO se LACP è davvero operativo, cioè
// ActorOperState con Aggregation(0x04) set E NON Defaulted(0x40) NÉ Expired(0x80).
// Il GS1900 ritorna 0xc4 (agg+defaulted+expired) su OGNI porta anche per una LAG
// STATICA: prima veniva etichettata "passive" a torto. Bit-order confermato LSB.
// La MEMBERSHIP (AttachedAggID .13) NON dipende da questo byte e resta invariata.
const test = require('node:test');
const assert = require('node:assert');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const MAC = last => Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, last]);

// Scenario LAG: aggregatore Port-channel1 (ifType 161, ifIndex 100) + 2 membri (3,6)
// via AttachedAggID + 1 porta fisica non-membro (9) per non superare la soglia 90%
// del filtro anti-falso-positivo. `actorByte` = ActorOperState dei membri.
function lagScenario(actorByte) {
  const vbs = {};
  vbs[`${OID.ifDescr}.100`] = 'Port-channel1';
  vbs[`${OID.ifType}.100`] = 161;
  vbs[`${OID.ifPhysAddress}.100`] = MAC(0x99);
  for (const [idx, name, last] of [[3, 'Gi0/3', 0x03], [6, 'Gi0/6', 0x06], [9, 'Gi0/9', 0x09]]) {
    vbs[`${OID.ifDescr}.${idx}`] = name;
    vbs[`${OID.ifType}.${idx}`] = 6;
    vbs[`${OID.ifPhysAddress}.${idx}`] = MAC(last);
    vbs[`${OID.ifOperStatus}.${idx}`] = 1;
  }
  vbs[`${OID.lagAttached}.3`] = 100;   // membership: porte 3,6 → aggregatore 100
  vbs[`${OID.lagAttached}.6`] = 100;
  vbs[`${OID.lagOperState}.3`] = Buffer.from([actorByte]);
  vbs[`${OID.lagOperState}.6`] = Buffer.from([actorByte]);
  return extractData(vbs);
}

test('SNMP-M1: LAG STATICA (ActorState 0xc4 = agg+defaulted+expired) → nessuna etichetta modalità', () => {
  const out = lagScenario(0xc4);   // il valore REALE del GS1900
  const agg = (out.lags || []).find(l => l.index === 100);
  assert.ok(agg, 'aggregatore rilevato');
  assert.equal(agg.mode, undefined, 'LAG statica NON etichettata "passive" (LACP non operativo)');
  const members = (out.interfaces || []).filter(f => f.lagId > 0);
  assert.equal(members.length, 2, 'membership preservata (Gi0/3 + Gi0/6 via AttachedAggID)');
});

test('SNMP-M1: LACP OPERATIVO (agg+sync+coll+dist+activity, no defaulted/expired) → mode=active', () => {
  const out = lagScenario(0x3d);   // 0x01|0x04|0x08|0x10|0x20
  const agg = (out.lags || []).find(l => l.index === 100);
  assert.ok(agg, 'aggregatore rilevato');
  assert.equal(agg.mode, 'active', 'LACP operativo + Activity → active');
});

test('SNMP-M1: LACP OPERATIVO passivo (Activity NON set) → mode=passive', () => {
  const out = lagScenario(0x3c);   // 0x04|0x08|0x10|0x20 (agg+sync+coll+dist, NO activity)
  const agg = (out.lags || []).find(l => l.index === 100);
  assert.equal(agg.mode, 'passive', 'LACP operativo senza Activity → passive');
});
