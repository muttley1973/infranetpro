'use strict';
// ============================================================
// Il nome di una porta: `ifDescr`, e `ifName` quando `ifDescr` e' vuoto.
//
// Il driver costruiva il nome SOLO da `ifDescr` e non leggeva mai `ifName` (IF-MIB ifXTable, colonna 1).
// Su Cisco coincidono nella sostanza; su un FortiGate `ifDescr` e' VUOTO e il nome vero sta in `ifName`
// («port1»…): le porte uscivano come `if1…if4`, un nome INVENTATO dal driver mentre quello misurato
// restava sull'apparato. Letto dal vivo sul banco il 18/11/2026 (FortiGate-VM 7.0.3, cluster FGCP).
//
// La regola e' stretta di proposito: `ifName` entra SOLO dove `ifDescr` non dice niente. Dove `ifDescr`
// c'e' resta lui — i progetti salvati hanno `ifName`=«GigabitEthernet0/1» e cambiare preferenza
// riscriverebbe ogni nome. E se non c'e' nessuno dei due resta il ripiego `if<ifIndex>` di prima.
//
// Fixture SINTETICHE nella FORMA di quella cattura (varbind veri in _local/lab-scripts/fortigate-ha/):
// i numeri (MAC, ifIndex) sono inventati.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = (s) => Buffer.from(s, 'utf8');
const mac = (s) => Buffer.from(s.replace(/[^0-9a-f]/gi, ''), 'hex');
const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const IFNAME = '1.3.6.1.2.1.31.1.1.1.1';   // IF-MIB::ifName

// Un FortiGate come lo ha risposto il banco: ifDescr VUOTO ovunque, ifName pieno.
function fortigate() {
  const v = { [`${OID.sysName}.0`]: B('FGT-SYN') };
  const port = (ix, nm, type, m, ifnm) => {
    v[`${OID.ifDescr}.${ix}`] = Buffer.alloc(0);                 // «» — l'agente non lo riempie
    v[`${IFNAME}.${ix}`] = B(ifnm || nm);
    v[`${OID.ifType}.${ix}`] = type;
    if (m) v[`${OID.ifPhysAddress}.${ix}`] = mac(m);
    v[`${OID.ifOperStatus}.${ix}`] = u32(1);
  };
  port(1, 'port1', 6, '02:00:00:00:35:00'); port(2, 'port2', 6, '02:00:00:00:35:01');
  port(3, 'port3', 6, '02:00:00:00:35:02'); port(4, 'port4', 6, '02:00:00:00:35:03');
  port(5, 'naf.root', 131); port(6, 'ssl.root', 131);              // tunnel virtuali: ifType 131
  port(8, 'fortilink', 161, '00:00:00:00:00:00');                   // aggregato di fabbrica, nessun membro
  return v;
}
const porte = (v) => Object.fromEntries(extractData(v).interfaces.map((p) => [p.index, p.name]));

test('ifDescr VUOTO e ifName pieno: la porta si chiama come dice l\'apparato, non «if<n>»', () => {
  assert.deepEqual(porte(fortigate()), { 1: 'port1', 2: 'port2', 3: 'port3', 4: 'port4' });
});

test('i tunnel virtuali (ifType 131) restano fuori; l\'aggregato di fabbrica porta il SUO nome', () => {
  const r = extractData(fortigate());
  assert.ok(!r.interfaces.some((p) => /root$/.test(p.name)), 'naf.root / ssl.root non sono porte');
  assert.deepEqual(r.lags.map((l) => l.name), ['fortilink'], 'l\'aggregato era «if8»: un nome inventato');
});

test('ifDescr PIENO: resta lui, anche se ifName dice altro (i progetti salvati non si riscrivono)', () => {
  const v = {
    [`${OID.sysName}.0`]: B('SW-SYN'),
    [`${OID.ifDescr}.1`]: B('GigabitEthernet0/1'), [`${IFNAME}.1`]: B('Gi0/1'), [`${OID.ifType}.1`]: 6, [`${OID.ifPhysAddress}.1`]: mac('02:00:00:00:00:01'),
    [`${OID.ifDescr}.2`]: B('GigabitEthernet0/2'), [`${IFNAME}.2`]: B('Gi0/2'), [`${OID.ifType}.2`]: 6, [`${OID.ifPhysAddress}.2`]: mac('02:00:00:00:00:02'),
  };
  assert.deepEqual(porte(v), { 1: 'GigabitEthernet0/1', 2: 'GigabitEthernet0/2' });
});

test('nessuno dei due: il ripiego di sempre, `if<ifIndex>`', () => {
  const v = { [`${OID.sysName}.0`]: B('X'), [`${OID.ifType}.7`]: 6, [`${OID.ifPhysAddress}.7`]: mac('02:00:00:00:00:07'), [`${OID.ifOperStatus}.7`]: u32(1) };
  assert.deepEqual(porte(v), { 7: 'if7' });
});

test('anche i nomi che nascono DOPO (porta bloccata dallo STP) usano il nome effettivo', () => {
  // un apparato con ifDescr vuoto e una porta in blocking: il nome che esce in `stp.blocked` e' quello di ifName
  const { ciscoPoll } = require('./fixtures/stp-poll.js');
  const v = ciscoPoll({ po1State: 2 });
  for (const k of Object.keys(v)) if (k.startsWith(OID.ifDescr + '.')) { const ix = k.split('.').pop(); v[`${IFNAME}.${ix}`] = v[k]; v[k] = Buffer.alloc(0); }
  const r = extractData(v);
  assert.deepEqual(r.stp.blocked.map((b) => b.name), ['Port-channel1'], 'il blocco si nomina con ifName, non con if<n>');
  assert.deepEqual(r.interfaces.map((p) => p.name).sort(), ['GigabitEthernet0/1', 'GigabitEthernet0/2', 'GigabitEthernet0/3', 'GigabitEthernet0/4', 'GigabitEthernet0/5']);
});

// ---- Il costo si paga SOLO dove serve ----
// ⚠️ Prima versione: `ifName` nell'elenco `OID`, quindi camminato da OGNI apparato. Misurato il 18/11/2026 su uno
// Zyxel reale che una subtree in piu' sposta il raggruppamento delle richieste sotto il tetto di tempo e cambia
// COSA viene saltato (l'802.3ad prima non arrivava mai, con una colonna in piu' si'): un effetto collaterale su un
// apparato che non c'entra niente col FortiGate. Ora `ifName` si legge in un passaggio a parte, e solo se serve.
const { walkSession, _ifDescrMissing } = require('../drivers/snmp.js')._internals;

test('_ifDescrMissing: scatta solo dove ifDescr e\' vuoto o manca', () => {
  assert.equal(_ifDescrMissing(fortigate()), true, 'FortiGate: ifDescr vuoto');
  const cisco = { [`${OID.ifType}.1`]: 6, [`${OID.ifDescr}.1`]: B('GigabitEthernet0/1'), [`${OID.ifType}.2`]: 6, [`${OID.ifDescr}.2`]: B('GigabitEthernet0/2') };
  assert.equal(_ifDescrMissing(cisco), false, 'Cisco: ifDescr pieno ovunque -> nessun passaggio in piu\'');
  assert.equal(_ifDescrMissing({ [`${OID.ifType}.1`]: 6 }), true, 'riga ifDescr assente per una interfaccia che ha un tipo');
  assert.equal(_ifDescrMissing({ [`${OID.ifType}.1`]: 6, [`${OID.ifDescr}.1`]: '' }), true, 'stringa vuota');
  assert.equal(_ifDescrMissing({}), false, 'nessuna interfaccia: niente da cercare');
  assert.equal(_ifDescrMissing(null), false);
});

test('walkSession NON legge ifName: l\'elenco comune a tutti gli apparati resta quello di prima', async () => {
  const calls = [];
  const sess = { subtree(base, maxReps, feedCb, doneCb) { calls.push(base); setImmediate(() => { if (base === OID.sysName) feedCb([{ oid: OID.sysName + '.0', value: B('x') }]); doneCb(null); }); } };
  await walkSession(sess, { deadline: Date.now() + 5000 });
  assert.ok(!calls.includes(IFNAME), 'ifName non entra nel giro di tutti: si legge a parte, solo dove ifDescr manca');
  assert.equal(OID.ifName, undefined, 'e non e\' nella tabella OID (lo camminerebbe ogni apparato)');
});
