'use strict';
// ============================================================
// STP (BRIDGE-MIB dot1dStp) — la lettura e' VALIDA o non c'e'
// ============================================================
// Le fixture NON sono inventate: ricalcano le catture reali del banco (10/11/2026,
// `_local/lab-scripts/stp/`), senza community ne' indirizzi di gestione. Ognuna e' un
// apparato vero che risponde a modo suo:
//   EXOS      — lettura conforme, radice di se stesso
//   vIOS      — conforme sull'albero predefinito (VLAN 1), priorita' 32769 = 32768 + 1,
//               e `dot1dBaseBridgeAddress` che NON e' il MAC con cui vota
//   Zyxel     — STP spento: BridgeId come TESTO, costo 0 ma porta radice 28
//   Aruba CX  — radice che non e' nessun MAC dell'apparato, pur con costo 0 e porta 0
//   vIOS core — albero predefinito VUOTO ma STP acceso su altre VLAN
// Quello che si pretende: nessuna lettura a meta', nessun verdetto, nessun «STP spento».
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractStp, extractData, OID } = require('../drivers/snmp.js')._internals;

const P = OID.dot1dStp;
const mac = (s) => Buffer.from(s.replace(/[^0-9a-f]/gi, ''), 'hex');
const bridgeId = (prio, m) => Buffer.concat([Buffer.from([(prio >> 8) & 0xff, prio & 0xff]), mac(m)]);
const sc = (n) => `${P}.${n}.0`;
const pcol = (col, bp) => `${P}.15.1.${col}.${bp}`;

// vbs minimo: scalari + (facoltativo) tabella porte. `ports` = { bp: stato }.
function vbsOf({ root, cost, rootPort, topChanges = 1, ports = null, base = null }) {
  const v = { [sc(5)]: root, [sc(6)]: cost, [sc(7)]: rootPort, [sc(4)]: topChanges };
  if (base) v[`${OID.dot1dBaseAddr}.0`] = mac(base);
  if (ports) for (const [bp, st] of Object.entries(ports)) v[pcol(3, bp)] = st;
  return v;
}
const iface = (name, m, oper = 1) => ({ name, macBuf: m ? mac(m) : undefined, oper });

test('EXOS: conforme, radice di se stesso (il MAC e\' fra i suoi)', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x8000, '50:a4:8c:00:2d:00'), cost: 0, rootPort: 0, base: '50:a4:8c:00:2d:00',
            ports: { 1: 5, 2: 1 } }),
    { bpToIf: { 1: 1001, 2: 1002 }, ifaces: { 1001: iface('1:1', '50:a4:8c:00:2d:00'), 1002: iface('1:2', null, 2) } });
  assert.equal(r.isRoot, true);
  assert.equal(r.rootMac, '50:a4:8c:00:2d:00');
  assert.equal(r.rootPriority, 32768);
  assert.equal(r.rootSysId, 0);
  assert.equal(r.scope, 'default', 'l\'ambito si dichiara sempre: albero predefinito');
  assert.deepEqual(r.blocked, [], 'tabella porte letta e nessuna bloccata');
});

test('vIOS: la priorita\' 32769 si separa in 32768 + sys-id 1; l\'indirizzo base NON conta', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x8001, '50:b7:6c:00:2a:00'), cost: 0, rootPort: 0, base: 'cc:cc:00:00:00:02',
            ports: { 8: 5 } }),
    { bpToIf: { 8: 9 }, ifaces: { 1: iface('Gi0/0', '50:b7:6c:00:2a:00'), 9: iface('Gi2/3', '50:b7:6c:00:2a:08') } });
  assert.equal(r.isRoot, true, 'il MAC della radice e\' quello di Gi0/0, non l\'indirizzo base');
  assert.equal(r.rootPriority, 32768, 'senza la maschera «priorita\' diversa dal default» scatterebbe su ogni Cisco');
  assert.equal(r.rootSysId, 1);
});

test('Zyxel con STP spento: BridgeId come testo → NON letto', () => {
  const r = extractStp(
    vbsOf({ root: Buffer.from('0/00:00:00:00:00:00'), cost: 0, rootPort: 28, ports: { 1: 5 } }),
    { bpToIf: { 1: 1 }, ifaces: { 1: iface('1', 'bc:cf:4f:d0:41:33') } });
  assert.equal(r, null);
});

test('Aruba CX: radice che non e\' un MAC dell\'apparato (pur con costo 0 e porta 0) → NON letto', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x0008, '00:00:e0:84:ee:a8'), cost: 0, rootPort: 0, base: '08:00:09:1d:04:bf',
            ports: { 1: 5, 2: 5 } }),
    { bpToIf: { 1: 1, 2: 2 }, ifaces: { 1: iface('1/1/1', '08:00:09:1d:04:c0'), 2: iface('1/1/2', '08:00:09:1d:04:c1') } });
  assert.equal(r, null, 'una lettura che non torna si scarta per intero: niente verdetti sopra la spazzatura');
});

test('costo 0 ma porta radice ≠ 0 (o il contrario) → segnaposto, NON letto', () => {
  const ctx = { bpToIf: { 3: 3 }, ifaces: { 3: iface('Gi0/3', '50:b7:6c:00:2a:03') } };
  assert.equal(extractStp(vbsOf({ root: bridgeId(0x8000, '50:b7:6c:00:2a:03'), cost: 0, rootPort: 3 }), ctx), null);
  assert.equal(extractStp(vbsOf({ root: bridgeId(0x8000, '50:b7:6c:00:2a:03'), cost: 4, rootPort: 0 }), ctx), null);
});

test('non radice: porta radice, costo e radice nominata', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x1000, 'aa:bb:cc:00:00:01'), cost: 4, rootPort: 3, topChanges: 7, ports: { 3: 5 } }),
    { bpToIf: { 3: 12 }, ifaces: { 12: iface('Gi0/1', '50:b7:6c:00:2a:01') } });
  assert.equal(r.isRoot, false);
  assert.equal(r.rootMac, 'aa:bb:cc:00:00:01');
  assert.equal(r.rootPriority, 4096);
  assert.equal(r.rootCost, 4);
  assert.equal(r.rootPortIfIndex, 12);
  assert.equal(r.rootPortName, 'Gi0/1');
  assert.equal(r.topologyChanges, 7);
});

test('non radice con una porta radice che il bridge non conosce → NON letto', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x1000, 'aa:bb:cc:00:00:01'), cost: 4, rootPort: 99 }),
    { bpToIf: { 3: 12 }, ifaces: { 12: iface('Gi0/1', '50:b7:6c:00:2a:01') } });
  assert.equal(r, null);
});

test('porte bloccate: solo blocking/broken, solo con link; listening/learning/giu\' no', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x1000, 'aa:bb:cc:00:00:01'), cost: 4, rootPort: 3,
            ports: { 3: 5, 4: 2, 5: 2, 6: 3, 7: 4, 8: 6, 9: 1 } }),
    { bpToIf: { 3: 13, 4: 14, 5: 15, 6: 16, 7: 17, 8: 18, 9: 19 },
      ifaces: {
        13: iface('Gi0/1', '50:b7:6c:00:2a:01'),
        14: iface('Gi0/2', '50:b7:6c:00:2a:02', 1),      // blocking, su → SI
        15: iface('Gi0/3', '50:b7:6c:00:2a:03', 2),      // blocking ma giu' → NO (e' giu', non bloccata)
        16: iface('Gi0/4', '50:b7:6c:00:2a:04', 1),      // listening → NO (dura secondi)
        17: iface('Gi0/5', '50:b7:6c:00:2a:05', 1),      // learning → NO
        18: iface('Gi0/6', '50:b7:6c:00:2a:06', 1),      // broken, su → SI
        19: iface('Gi0/7', '50:b7:6c:00:2a:07', 1),      // disabled → NO
      } });
  assert.deepEqual(r.blocked, [
    { ifIndex: 14, name: 'Gi0/2', state: 'blocking' },
    { ifIndex: 18, name: 'Gi0/6', state: 'broken' },
  ]);
});

test('tabella porte assente: «porte bloccate» e\' SCONOSCIUTO (null), non «nessuna»', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x8000, '50:a4:8c:00:2d:00'), cost: 0, rootPort: 0 }),
    { bpToIf: {}, ifaces: { 1: iface('1:1', '50:a4:8c:00:2d:00') } });
  assert.equal(r.isRoot, true);
  assert.equal(r.blocked, null);
});

test('albero predefinito VUOTO (vIOS core con i trunk senza VLAN 1) → NON letto, mai «STP spento»', () => {
  assert.equal(extractStp({}, { bpToIf: {}, ifaces: {} }), null);
  assert.equal(extractStp(undefined, undefined), null);
});

test('extractData porta il campo `stp` (null quando non c\'e\' niente da leggere)', () => {
  const vbs = { [`${OID.sysName}.0`]: Buffer.from('sw-x') };
  const r = extractData(vbs);
  assert.ok(Object.prototype.hasOwnProperty.call(r, 'stp'), 'il campo esiste sempre: il chiamante lo scrive anche null, cosi\' una lettura mancata cancella quella vecchia');
  assert.equal(r.stp, null);
});

test('extractData: dalla lettura STP alle porte di un bridge vero (bridge-port → ifIndex → nome)', () => {
  const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const vbs = {
    [`${OID.sysName}.0`]: Buffer.from('sw-acc'),
    [`${OID.ifDescr}.1`]: Buffer.from('Gi0/0'), [`${OID.ifPhysAddress}.1`]: mac('50:b7:6c:00:2a:00'), [`${OID.ifOperStatus}.1`]: u32(1),
    [`${OID.ifDescr}.2`]: Buffer.from('Gi0/1'), [`${OID.ifPhysAddress}.2`]: mac('50:b7:6c:00:2a:01'), [`${OID.ifOperStatus}.2`]: u32(1),
    [`${OID.bridgePortIf}.1`]: u32(1), [`${OID.bridgePortIf}.2`]: u32(2),
    ...vbsOf({ root: bridgeId(0x8001, '50:b7:6c:00:2a:00'), cost: 0, rootPort: 0, ports: { 1: 5, 2: 2 } }),
  };
  const r = extractData(vbs);
  assert.ok(r.stp, 'lettura valida');
  assert.equal(r.stp.isRoot, true);
  assert.deepEqual(r.stp.blocked, [{ ifIndex: 2, name: 'Gi0/1', state: 'blocking' }]);
  // …e lo stato arriva SULLA porta (e solo su quella): e' li' che lo legge `_applySnmpBasePortFields`.
  const byIdx = Object.fromEntries(r.interfaces.map(i => [i.index, i]));
  assert.equal(byIdx[2].stpState, 'blocking');
  assert.equal(byIdx[1].stpState, undefined, 'una porta che inoltra non porta nessun segno');
});

test('il segno sul LED scade come le altre misure di porta (forgetPortMeasure)', () => {
  const { forgetPortMeasure } = require('../lib/port-state.js');
  const pi = { ifName: 'Gi0/2', stpBlocked: 'blocking' };
  assert.equal(forgetPortMeasure(pi), true, 'se lo switch tace, «bloccata» non si sa piu\'');
  assert.equal('stpBlocked' in pi, false);
  assert.equal(forgetPortMeasure({ ifName: 'Gi0/2' }), false, 'niente da dimenticare, niente da toccare');
});
