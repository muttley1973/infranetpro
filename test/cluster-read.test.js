'use strict';
// ============================================================
// Cluster HA letto dal dispositivo — la lettura e' VALIDA o non c'e'
// ============================================================
// Non esiste un OID standard che dica «questo apparato fa parte di un cluster con QUESTI membri»: il
// VRRP-MIB (RFC 6527) descrive i gruppi di indirizzi virtuali, non le unita'. Ogni fornitore pubblica la
// sua tabella, e si legge solo quella dell'enterprise che il sysObjectID dichiara (zero costo sugli altri).
// La fixture ricalca la cattura VERA del 15/11/2026 dall'indirizzo del cluster di due FortiGate-VM 7.0.3
// in HA attivo-passivo (senza community ne' indirizzi): una riga per unita', le seriali, i nomi, lo stato
// di sincronizzazione e la serie del PRIMARIO. Quello che si pretende, come per lo STP: nessuna lettura a
// meta' e nessuna invenzione — solo cio' che il dispositivo ha detto.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractCluster, extractData, OID } = require('../drivers/snmp.js')._internals;

const B = '1.3.6.1.4.1.12356.101.13';
const SYS = `${OID.sysObjectID}.0`;
const FGT = '1.3.6.1.4.1.12356.101.1.80001';
const SERIAL_A = 'FGVMEVZZR30PN1D5';
const SERIAL_B = 'FGVMEVHZZF0YDP98';
const txt = (s) => Buffer.from(s);

// `rows` = [{ i, serial, name, sync, primary }]; null su un campo = colonna NON pubblicata.
function fgcp({ mode = 3, group = 'LAB-HA', rows = null, sys = FGT } = {}) {
  const v = {};
  if (sys !== null) v[SYS] = sys;
  if (mode !== null) v[`${B}.1.1.0`] = mode;
  if (group !== null) v[`${B}.1.7.0`] = txt(group);
  const list = rows || [
    { i: 1, serial: SERIAL_A, name: 'FGT-A', sync: 1, primary: SERIAL_A },
    { i: 2, serial: SERIAL_B, name: 'FGT-B', sync: 1, primary: SERIAL_A },
  ];
  for (const r of list) {
    v[`${B}.2.1.1.1.${r.i}`] = r.i;
    if (r.serial !== null) v[`${B}.2.1.1.2.${r.i}`] = txt(r.serial);
    if (r.name !== null && r.name !== undefined) v[`${B}.2.1.1.11.${r.i}`] = txt(r.name);
    if (r.sync !== null && r.sync !== undefined) v[`${B}.2.1.1.12.${r.i}`] = r.sync;
    if (r.primary !== null && r.primary !== undefined) v[`${B}.2.1.1.16.${r.i}`] = txt(r.primary);
  }
  return v;
}

test('FortiGate in HA attivo-passivo: i due membri, chi e\' primario, la sincronizzazione', () => {
  const r = extractCluster(fgcp());
  assert.deepEqual(r, {
    kind: 'fortinet-fgcp', mode: 'active-passive', group: 'LAB-HA', primarySerial: SERIAL_A,
    members: [
      { serial: SERIAL_A, name: 'FGT-A', primary: true, inSync: true },
      { serial: SERIAL_B, name: 'FGT-B', primary: false, inSync: true },
    ],
  });
});

test('dopo un failover il primario e\' l\'altra unita\': lo dice la colonna della serie del primario', () => {
  const r = extractCluster(fgcp({ rows: [
    { i: 1, serial: SERIAL_A, name: 'FGT-A', sync: 1, primary: SERIAL_B },
    { i: 2, serial: SERIAL_B, name: 'FGT-B', sync: 1, primary: SERIAL_B },
  ] }));
  assert.equal(r.primarySerial, SERIAL_B);
  assert.deepEqual(r.members.map(m => m.primary), [false, true]);
});

test('active-active si dichiara com\'e\'; un apparato fuori HA (modo 1) NON e\' un cluster → non letto', () => {
  assert.equal(extractCluster(fgcp({ mode: 2 })).mode, 'active-active');
  assert.equal(extractCluster(fgcp({ mode: 1 })), null, 'standalone: una tabella con se stesso non e\' un cluster');
});

test('modo ignoto o assente → NON letto (non si indovina)', () => {
  assert.equal(extractCluster(fgcp({ mode: 9 })), null);
  assert.equal(extractCluster(fgcp({ mode: null })), null);
});

test('nessuna riga con una serie valida → NON letto', () => {
  assert.equal(extractCluster(fgcp({ rows: [] })), null);
  assert.equal(extractCluster(fgcp({ rows: [{ i: 1, serial: null, name: 'x', sync: 1, primary: '' }] })), null);
  assert.equal(extractCluster(fgcp({ rows: [{ i: 1, serial: '', name: 'x', sync: 1, primary: '' }] })), null);
});

test('una serie ripetuta o non stampabile scarta la lettura intera', () => {
  assert.equal(extractCluster(fgcp({ rows: [
    { i: 1, serial: SERIAL_A, name: 'a', sync: 1, primary: SERIAL_A },
    { i: 2, serial: SERIAL_A, name: 'b', sync: 1, primary: SERIAL_A },
  ] })), null, 'due righe con la stessa serie: la tabella e\' guasta');
  assert.equal(extractCluster(fgcp({ rows: [{ i: 1, serial: 'FG\u0001VM', name: 'a', sync: 1, primary: '' }] })), null);
  // …e una riga cattiva fra due buone non si salta: mai una lettura a meta'.
  assert.equal(extractCluster(fgcp({ rows: [
    { i: 1, serial: SERIAL_A, name: 'a', sync: 1, primary: SERIAL_A },
    { i: 2, serial: '', name: 'b', sync: 1, primary: SERIAL_A },
  ] })), null);
});

test('un membro solo (il secondario e\' giu\') resta una lettura valida, in modo HA', () => {
  const r = extractCluster(fgcp({ rows: [{ i: 1, serial: SERIAL_A, name: 'FGT-A', sync: 0, primary: SERIAL_A }] }));
  assert.equal(r.members.length, 1);
  assert.equal(r.members[0].inSync, false);
  assert.equal(r.mode, 'active-passive', 'il modo e\' quello dichiarato, non quello che si deduce dal numero di righe');
});

test('primario: se le righe non concordano o nominano uno che non e\' un membro, NON si sa (mai il primo che capita)', () => {
  const dis = extractCluster(fgcp({ rows: [
    { i: 1, serial: SERIAL_A, name: 'a', sync: 1, primary: SERIAL_A },
    { i: 2, serial: SERIAL_B, name: 'b', sync: 1, primary: SERIAL_B },
  ] }));
  assert.equal(dis.primarySerial, undefined);
  assert.deepEqual(dis.members.map(m => m.primary), [null, null]);
  const ext = extractCluster(fgcp({ rows: [
    { i: 1, serial: SERIAL_A, name: 'a', sync: 1, primary: 'FGVMXXXXXXXXXXXX' },
    { i: 2, serial: SERIAL_B, name: 'b', sync: 1, primary: 'FGVMXXXXXXXXXXXX' },
  ] }));
  assert.equal(ext.primarySerial, undefined, 'il primario nominato non e\' fra i membri letti');
  assert.deepEqual(ext.members.map(m => m.primary), [null, null]);
  const none = extractCluster(fgcp({ rows: [
    { i: 1, serial: SERIAL_A, name: 'a', sync: 1, primary: null },
    { i: 2, serial: SERIAL_B, name: 'b', sync: 1, primary: null },
  ] }));
  assert.deepEqual(none.members.map(m => m.primary), [null, null], 'colonna non pubblicata = sconosciuto');
});

test('nome, sincronizzazione e gruppo non pubblicati restano ASSENTI o nulli, non vuoti inventati', () => {
  const r = extractCluster(fgcp({ group: null, rows: [
    { i: 1, serial: SERIAL_A, name: null, sync: null, primary: SERIAL_A },
    { i: 2, serial: SERIAL_B, name: null, sync: null, primary: SERIAL_A },
  ] }));
  assert.equal('group' in r, false);
  assert.equal(r.members.every(m => !('name' in m)), true, 'un nome non pubblicato non diventa una stringa vuota');
  assert.deepEqual(r.members.map(m => m.inSync), [null, null]);
});

test('il gate e\' l\'enterprise del sysObjectID: la stessa tabella su un apparato di un altro fornitore o senza sysObjectID → NON letto', () => {
  assert.equal(extractCluster(fgcp({ sys: '1.3.6.1.4.1.9.1.1631' })), null, 'Cisco');
  assert.equal(extractCluster(fgcp({ sys: null })), null, 'sysObjectID assente');
  assert.equal(extractCluster({}), null);
  assert.equal(extractCluster(null), null);
});

test('extractData porta il campo `cluster` (null quando non c\'e\' niente da leggere)', () => {
  const none = extractData({ [`${OID.sysName}.0`]: Buffer.from('sw-x') });
  assert.ok(Object.prototype.hasOwnProperty.call(none, 'cluster'), 'il campo esiste sempre: il chiamante lo toglie quando manca');
  assert.equal(none.cluster, null);
  const fw = extractData({ [`${OID.sysName}.0`]: Buffer.from('FGT-A'), ...fgcp() });
  assert.ok(fw.cluster);
  assert.equal(fw.cluster.members.length, 2);
});
