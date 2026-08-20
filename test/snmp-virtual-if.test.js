'use strict';
// Un'interfaccia che si dichiara VIRTUALE non è una porta che si cabla.
//
// Il driver riconosce come fisiche le ifType 6/62/117 e scarta per NOME quelle
// virtuali — ma l'elenco dei nomi era tutto di scuola Linux (docker, veth, virbr,
// lxc, cni…) e non conteneva la parola che descrive la cosa: «virtual».
//
// Misurato sul banco il 2026-08-20: un controller wireless Cisco espone due
// interfacce ifType 117 con lo STESSO MAC — «Unit: 0 Slot: 0 Port: 1 Gigabit…»,
// che è la porta vera, e «Virtual Interface», che porta è non è. Entravano
// entrambe: l'apparato risultava a due porte, e siccome un vicino annunciato su
// un device MULTI-porta fa dedurre la porta invece di conoscerla, il cavo del
// controller usciva «Inferito · da verificare» pur essendo l'unico possibile.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');
const nomi = vbs => extractData(vbs).interfaces.map(p => p.name);

// Il WLC del banco, ridotto: due ifType 117, stesso MAC, un nome che si dichiara.
const MAC = Buffer.from([0x50, 0xfb, 0x8a, 0x00, 0x28, 0x01]);
const wlc = () => ({
  [`${OID.sysName}.0`]: B('Cisco_00:28:01'),
  [`${OID.ifDescr}.1`]: B('Unit: 0 Slot: 0 Port: 1 Gigabit - Level 0x7030001'),
  [`${OID.ifType}.1`]: 117, [`${OID.ifPhysAddress}.1`]: MAC,
  [`${OID.ifDescr}.2`]: B('Virtual Interface'),
  [`${OID.ifType}.2`]: 117, [`${OID.ifPhysAddress}.2`]: MAC,
});

test('«Virtual Interface» non è una porta fisica (WLC Cisco, dal banco)', () => {
  const p = nomi(wlc());
  assert.equal(p.length, 1, 'una porta sola: quella che si può cablare');
  assert.equal(p[0], 'Unit: 0 Slot: 0 Port: 1 Gigabit - Level 0x7030001');
});

test('il nome vale anche col MAC buono: un MAC reale non rende fisica una virtuale', () => {
  // Le due interfacce condividono lo STESSO MAC vero: se bastasse il MAC a
  // promuoverle, la seconda passerebbe. È la stessa regola per cui `docker0`
  // resta fuori pur avendo un MAC.
  const d = extractData(wlc());
  assert.equal(d.interfaces.filter(x => /virtual/i.test(x.name)).length, 0);
});

test('la regola è sul PREFISSO, non sulla parola ovunque', () => {
  // «Virtual» in coda descrive la porta, non la sostituisce: un nome che
  // CONTIENE la parola più avanti non deve sparire, o si perderebbero porte vere.
  const v = wlc();
  v[`${OID.ifDescr}.3`] = B('Port 3 (virtual chassis link)');
  v[`${OID.ifType}.3`] = 6;
  assert.ok(nomi(v).includes('Port 3 (virtual chassis link)'),
    'una porta fisica che nomina «virtual» a metà frase resta una porta');
});

test('le altre virtuali già note restano escluse (nessuna regressione)', () => {
  const v = {
    [`${OID.sysName}.0`]: B('LINUX'),
    [`${OID.ifDescr}.1`]: B('eth0'),    [`${OID.ifType}.1`]: 6,
    [`${OID.ifDescr}.2`]: B('docker0'), [`${OID.ifType}.2`]: 6,
    [`${OID.ifDescr}.3`]: B('veth9a1'), [`${OID.ifType}.3`]: 6,
    [`${OID.ifDescr}.4`]: B('virbr0'),  [`${OID.ifType}.4`]: 6,
  };
  assert.deepEqual(nomi(v), ['eth0']);
});
