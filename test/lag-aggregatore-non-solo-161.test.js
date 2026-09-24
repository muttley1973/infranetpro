'use strict';
// Un aggregatore non è solo «ifType=161».
//
// L'aggregazione si MISURA — è la regola introdotta nella 2.11.9, e resta — ma la
// misura arrivava solo da chi dichiara ifType=161 (ieee8023adLag, RFC 2863). Cisco
// non lo fa: sui Port-channel mette 53 = propVirtual. Il driver lo sapeva già in un
// punto (la classificazione finale, che li metteva in `lags[]` per NOME) e lo
// ignorava negli altri due (il lettore di ifStackTable e il cross-check di
// AttachedAggID). Risultato: l'aggregatore c'era, i membri no — un LAG senza membri,
// che a valle è come non averlo. Poi l'auto-link, giustamente, si rifiutava di
// dedurlo da due cavi paralleli, e il LAG spariva del tutto dal documento.
//
// Misurato sul banco PnetLab il 2026-09-24 (SW-CORE 10.10.99.1, vIOS/IOSvL2):
//   Port-channel1/2/3  ifType=53   ifStackTable: 10.2 10.3 / 11.4 11.5 / 12.6 12.7
//   802.3ad, CISCO-PAGP-MIB, CISCO-LAG-MIB, LLDP-EXT-DOT3: ZERO righe.
// Quindi ifStackTable è l'unica fonte che quell'apparato offre, e la offre giusta.
//
// ⚠️ E il 53 da solo non può bastare: sullo STESSO apparato `Vlan10`…`Vlan99` sono
// anch'esse ifType=53 (misurate). È il nome a distinguerle, e il nome lo riconosce
// `_ifNameMeta` — l'unico elenco vendor-neutral del progetto, non una sua copia.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');
const porte = vbs => Object.fromEntries(extractData(vbs).interfaces.map(p => [p.name, p]));
const aggregatori = vbs => extractData(vbs).lags.map(l => l.name);

// Bitmap VLAN Cisco: il bit 1 vale VLAN 0, quindi la posizione è vlanId+1.
const bitmapVlans = (...ids) => {
  const b = Buffer.alloc(128);
  for (const v of ids) { const pos = v + 1; b[Math.floor((pos - 1) / 8)] |= 0x80 >> ((pos - 1) % 8); }
  return b;
};

// Il banco, come lo dichiara il vIOS: due porte fisiche, l'aggregatore a 53, e
// l'appartenenza in ifStackTable. Gli ifIndex sono quelli veri di SW-ACC1.
function cisco(extra) {
  return Object.assign({
    [`${OID.sysName}.0`]: B('SW-ACC1'),
    [`${OID.ifDescr}.2`]:  B('GigabitEthernet0/1'), [`${OID.ifType}.2`]:  6,
    [`${OID.ifDescr}.3`]:  B('GigabitEthernet0/2'), [`${OID.ifType}.3`]:  6,
    [`${OID.ifDescr}.11`]: B('Port-channel1'),      [`${OID.ifType}.11`]: 53,
    [`${OID.ifStackStatus}.11.2`]: 1,
    [`${OID.ifStackStatus}.11.3`]: 1,
  }, extra || {});
}

test('il caso misurato: su Cisco i membri del Port-channel hanno un lagId', () => {
  const p = porte(cisco());
  for (const nome of ['GigabitEthernet0/1', 'GigabitEthernet0/2']) {
    assert.equal(p[nome].lagId, 1, `${nome}: id LOGICO del bundle (Po1 → 1)`);
    assert.equal(p[nome].lagIfIndex, 11, `${nome}: ifIndex dell'aggregatore`);
  }
});

test('e l\'aggregatore resta un aggregatore (non era quello, il difetto)', () => {
  assert.deepEqual(aggregatori(cisco()), ['Port-channel1']);
});

test('i membri ereditano il trunk del bundle — su Cisco è lì che vive la config', () => {
  // Sulle porte membro l'apparato non dichiara VLAN: la configurazione sta tutta
  // sul Port-channel. Senza appartenenza l'eredità non poteva scattare, e due
  // trunk risultavano porte access.
  const v = cisco({
    [`${OID.vlanTrunkPortDynState}.11`]: 1,
    [`${OID.vlanTrunkPortVlans}.11`]: bitmapVlans(30, 99),
  });
  const p = porte(v);
  assert.equal(p['GigabitEthernet0/1'].isTrunk, true);
  assert.deepEqual(p['GigabitEthernet0/1'].trunkVlans, [30, 99]);
});

test('ifType=161 continua a bastare da solo (Arista, e la RFC)', () => {
  const v = {
    [`${OID.sysName}.0`]: B('SW-ARISTA'),
    [`${OID.ifDescr}.1`]: B('Ethernet1'),     [`${OID.ifType}.1`]: 6,
    [`${OID.ifDescr}.1000003`]: B('Port-Channel3'), [`${OID.ifType}.1000003`]: 161,
    [`${OID.ifStackStatus}.1000003.1`]: 1,
  };
  assert.equal(porte(v)['Ethernet1'].lagId, 3);
});

test('vendor-neutral: un bond0 Linux è un aggregato, e lo zero conta', () => {
  const v = {
    [`${OID.sysName}.0`]: B('srv'),
    [`${OID.ifDescr}.1`]: B('eth0'),  [`${OID.ifType}.1`]: 6,
    [`${OID.ifDescr}.9`]: B('bond0'), [`${OID.ifType}.9`]: 53,
    [`${OID.ifStackStatus}.9.1`]: 1,
  };
  assert.equal(porte(v)['eth0'].lagIfIndex, 9, 'bond0 aggrega, anche se il numero è 0');
});

test('⚠️ GUARDIA DI DIREZIONE: un 53 senza nome da bundle non aggrega', () => {
  // Questa non è una misura del banco — sul vIOS nessuna riga di stack sta sotto
  // una SVI — ma è il rischio che l'allargamento introduce, e va pinnato: le SVI
  // `Vlan10`…`Vlan99` di quello stesso switch sono ifType=53 (misurato). Se
  // bastasse il tipo, una VLAN diventerebbe un LAG e le porte sotto i suoi membri.
  const v = {
    [`${OID.sysName}.0`]: B('SW-CORE'),
    [`${OID.ifDescr}.2`]:  B('GigabitEthernet0/1'), [`${OID.ifType}.2`]:  6,
    [`${OID.ifDescr}.16`]: B('Vlan99'),             [`${OID.ifType}.16`]: 53,
    [`${OID.ifStackStatus}.16.2`]: 1,
  };
  const p = porte(v);
  assert.equal(p['GigabitEthernet0/1'].lagId, 0, 'una SVI non è un bundle');
  assert.deepEqual(aggregatori(v), [], 'e non entra fra gli aggregatori');
});
