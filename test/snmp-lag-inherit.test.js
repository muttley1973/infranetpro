'use strict';
// Un membro di LAG eredita davvero dall'aggregatore.
//
// L'ereditarietà esisteva già — isTrunk, VLAN trasportate e PVID dal Port-channel
// ai suoi membri — ma la mappa degli aggregatori è chiavata sull'ifIndex mentre la
// ricerca usava `lagId`, che è l'id LOGICO (Po1 → 1, ifIndex 10). I due numeri
// coincidono quasi mai, quindi il blocco era morto: nessun membro ereditava niente,
// e nessun test se ne accorgeva perché nessuno lo esercitava.
//
// Misurato sul banco il 2026-08-20: sull'Arista `Ethernet1` ed `Ethernet2` sono
// dichiarati membri di `Port-Channel3`, che è un trunk con 30 e 99 — e i due membri
// risultavano porte access. Sui vIOS non si vedeva perché quelle immagini non
// pubblicano affatto l'appartenenza: zero membri dichiarati, difetto invisibile.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');

// Bitmap VLAN Cisco: il bit 1 vale VLAN 0, quindi la posizione è vlanId+1.
const bitmapVlans = (...ids) => {
  const b = Buffer.alloc(128);
  for (const v of ids) { const pos = v + 1; b[Math.floor((pos - 1) / 8)] |= 0x80 >> ((pos - 1) % 8); }
  return b;
};

// Due membri fisici e il loro aggregatore, come li dichiara un apparato vero:
// l'aggregatore ha ifIndex 10 e si chiama Po1 → id logico 1. I due numeri
// DIFFERISCONO: è esattamente la condizione in cui il difetto si manifestava.
function bundle(extra) {
  return Object.assign({
    [`${OID.sysName}.0`]: B('SW-LAG'),
    [`${OID.ifDescr}.1`]: B('Gi1/0'), [`${OID.ifType}.1`]: 6,
    [`${OID.ifDescr}.2`]: B('Gi1/1'), [`${OID.ifType}.2`]: 6,
    [`${OID.ifDescr}.10`]: B('Po1'),  [`${OID.ifType}.10`]: 161,
    [`${OID.ifStackStatus}.10.1`]: 1,   // Gi1/0 poggia su Po1
    [`${OID.ifStackStatus}.10.2`]: 1,   // Gi1/1 pure
    [`${OID.vlanTrunkPortDynState}.10`]: 1,               // l'aggregatore è un trunk
    [`${OID.vlanTrunkPortVlans}.10`]: bitmapVlans(30, 99),
  }, extra || {});
}
const porte = vbs => Object.fromEntries(extractData(vbs).interfaces.map(p => [p.name, p]));

test('premessa del caso: id logico e ifIndex dell\'aggregatore NON coincidono', () => {
  // Se un domani coincidessero, questo caso smetterebbe di essere quello misurato
  // senza che nulla lo segnali — e il difetto potrebbe rientrare inosservato.
  const m = porte(bundle())['Gi1/0'];
  assert.equal(m.lagIfIndex, 10, 'l\'aggregatore vive all\'ifIndex 10');
  assert.equal(m.lagId, 1, 'ma il suo id logico è 1');
  assert.notEqual(m.lagId, m.lagIfIndex, 'i due numeri devono restare diversi');
});

test('i membri ereditano il trunk dell\'aggregatore', () => {
  const p = porte(bundle());
  for (const nome of ['Gi1/0', 'Gi1/1']) {
    assert.equal(p[nome].isTrunk, true, `${nome}: membro di un bundle trunk`);
    assert.deepEqual(p[nome].trunkVlans, [30, 99], `${nome}: trasporta le VLAN del bundle`);
  }
});

test('i membri ereditano il PVID dell\'aggregatore se non ne hanno uno proprio', () => {
  const v = bundle({ [`${OID.vlanTrunkPortNative}.10`]: 30 });   // nativa dichiarata sul bundle
  assert.equal(porte(v)['Gi1/0'].vlan, 30);
});

test('un membro che dichiara il PROPRIO trunk non viene sovrascritto', () => {
  // La misura della porta batte l'eredità: se l'apparato parla della singola
  // interfaccia, quella è più specifica del bundle.
  const v = bundle({
    [`${OID.vlanTrunkPortDynState}.1`]: 1,
    [`${OID.vlanTrunkPortVlans}.1`]: bitmapVlans(10),
  });
  assert.deepEqual(porte(v)['Gi1/0'].trunkVlans, [10], 'resta ciò che ha dichiarato lei');
  assert.deepEqual(porte(v)['Gi1/1'].trunkVlans, [30, 99], 'l\'altro membro eredita comunque');
});

test('nessun aggregatore, nessuna eredità: un apparato senza LAG non cambia', () => {
  const v = {
    [`${OID.sysName}.0`]: B('SW-PIATTO'),
    [`${OID.ifDescr}.1`]: B('Gi1/0'), [`${OID.ifType}.1`]: 6,
  };
  const p = porte(v)['Gi1/0'];
  assert.equal(p.isTrunk, false);
  assert.equal(p.vlan, undefined);
});
