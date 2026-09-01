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
const { extractData, OID, bufToInt } = require('../drivers/snmp.js')._internals;

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

// ---------------------------------------------------------------------------
// Lo stesso difetto un livello più sotto: il driver raccoglieva il PVID con
// `bufToInt(val) || 1`. `bufToInt` rende 0 quando non riesce a decodificare, e
// quello zero usciva di lì come un 1 — cioè come una porta che sta davvero
// nella VLAN 1, indistinguibile da una lettura riuscita. Per RFC 4363
// `dot1qPvid` è un `VlanIndex` e lo 0 non gli è permesso: uno zero lì è un
// errore di DECODIFICA, e trasformarlo in una misura gli dà TITOLO — su un
// apparato che commuta VLAN quel numero può scavalcare la rete dichiarata.
// ---------------------------------------------------------------------------

// Il PVID è indicizzato per BRIDGE PORT: bridge port 5 → ifIndex 1.
const conPvid = valore => {
  const v = muto();
  v[`${OID.bridgePortIf}.5`] = 1;
  v[`${OID.dot1qPvid}.5`] = valore;
  return v;
};

test('un PVID che non si decodifica resta ASSENTE, non diventa 1', () => {
  // Tre byte che non sono né un intero di lunghezza nota né cifre in ASCII:
  // è la FORMA di una decodifica fallita, chiunque la produca.
  const illeggibile = Buffer.from([0x00, 0x1e, 0xff]);
  assert.equal(bufToInt(illeggibile), 0,
    'precondizione: è proprio il caso in cui bufToInt cade a 0 — se un giorno' +
    ' rendesse altro, questa prova starebbe misurando una cosa diversa');
  assert.equal(porta(conPvid(illeggibile)).vlan, undefined,
    'un errore di lettura non è una porta sulla VLAN 1');
});

test('uno 0 esplicito è assenza, non la VLAN 1', () => {
  // RFC 4363 lo dice a chiare lettere: in `VlanIdOrNone` lo 0 significa
  // «nessuna VLAN». Non è una scelta nostra, è la convenzione dello standard.
  assert.equal(porta(conPvid(0)).vlan, undefined);
});

test('il 4095 è riservato: non entra come misura', () => {
  assert.equal(porta(conPvid(4095)).vlan, undefined);
});

test('il 4094 invece è una VLAN vera: il confine è incluso', () => {
  // Il lato che si guasta in silenzio se qualcuno scrive `< 4094`.
  assert.equal(porta(conPvid(4094)).vlan, 4094);
});

test('col PVID illeggibile il ripiego vmVlan può ancora riempire', () => {
  // ⚠️ È il verso che dimostra che togliere il caso non chiude una porta: un
  // ripiego ETICHETTATO resta buono, è quello MUTO che non deve esistere.
  // Prima il PVID scriveva 1 e vmVlan lo scavalcava per caso (`p.vlan === 1`);
  // adesso non scrive niente, e vmVlan riempie perché non c'era nulla.
  const v = conPvid(Buffer.from([0x00, 0x1e, 0xff]));
  v[`${OID.vmVlan}.1`] = 20;
  assert.equal(porta(v).vlan, 20);
});
