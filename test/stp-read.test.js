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
// `desig` = { bp: BridgeId } = la colonna «radice designata» (6) della riga di quella porta.
// `timers` = { 8: MaxAge, 9: HelloTime, 11: ForwardDelay } in centesimi di secondo, come li pubblica l'agente.
function vbsOf({ root, cost, rootPort, topChanges = 1, ports = null, base = null, desig = null, timers = null }) {
  const v = { [sc(5)]: root, [sc(6)]: cost, [sc(7)]: rootPort, [sc(4)]: topChanges };
  if (timers) for (const [col, cs] of Object.entries(timers)) v[sc(col)] = cs;
  if (base) v[`${OID.dot1dBaseAddr}.0`] = mac(base);
  if (ports) for (const [bp, st] of Object.entries(ports)) v[pcol(3, bp)] = st;
  if (desig) for (const [bp, id] of Object.entries(desig)) v[pcol(6, bp)] = id;
  return v;
}
const iface = (name, m, oper = 1) => ({ name, macBuf: m ? mac(m) : undefined, oper });
// I timer che pubblicano davvero EXOS e i due Cisco del banco (20 s · 2 s · 15 s): le letture buone li portano.
const REAL_TIMERS = { 8: 2000, 9: 200, 11: 1500 };

test('EXOS: conforme, radice di se stesso (il MAC e\' fra i suoi)', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x8000, '50:a4:8c:00:2d:00'), cost: 0, rootPort: 0, base: '50:a4:8c:00:2d:00',
            ports: { 1: 5, 2: 1 }, timers: REAL_TIMERS }),
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
            ports: { 8: 5 }, timers: REAL_TIMERS }),
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

// ---- Segnaposto con i timer a zero (cattura vera, Cisco vWLC AireOS, 15/11/2026) ----
// Un controller wireless non esegue lo STP ma risponde alla MIB: «radice = io» (priorita' 0, diversa dalla
// SUA 32768), costo 0, porta radice 0, UNA porta in forwarding… e MaxAge/Hello/ForwardDelay a ZERO.
// Tutto il resto torna, quindi le altre regole lo lasciavano passare e l'app diceva «questo apparato e' la
// radice dello spanning-tree». Un bridge che esegue lo STP usa timer positivi (802.1D: 6–40 s, 1–10 s, 4–30 s).
test('vWLC: radice di se stesso con i timer a zero (nessuno STP in esecuzione) → NON letto', () => {
  const r = extractStp(
    vbsOf({ root: bridgeId(0x0000, '50:fb:8a:00:28:01'), cost: 0, rootPort: 0, topChanges: 0,
            ports: { 1: 5 }, timers: { 8: 0, 9: 0, 11: 0 } }),
    { bpToIf: { 1: 1 }, ifaces: { 1: iface('GigabitEthernet0/0/1', '50:fb:8a:00:28:01') } });
  assert.equal(r, null, 'un segnaposto che per il resto torna non deve diventare «sono la radice»');
});

test('un timer a zero scarta la lettura intera, qualunque sia (MaxAge, Hello, ForwardDelay) e anche su un non-radice', () => {
  for (const col of [8, 9, 11]) {
    const { vbs, ctx } = _acc2Mst({ timers: { ...REAL_TIMERS, [col]: 0 } });
    assert.equal(extractStp(vbs, ctx), null, `timer ${col} a zero`);
  }
  const { vbs, ctx } = _acc2Mst({ timers: REAL_TIMERS });
  assert.ok(extractStp(vbs, ctx), 'gli stessi timer positivi: si legge');
});

test('timer non pubblicati: non e\' un\'obiezione (la lettura si decide sul resto)', () => {
  const { vbs, ctx } = _acc2Mst();
  assert.ok(extractStp(vbs, ctx), 'molte letture buone non portano i timer: l\'assenza non scarta');
});

test('costo 0 ma porta radice ≠ 0 (o il contrario) → segnaposto, NON letto', () => {
  const ctx = { bpToIf: { 3: 3 }, ifaces: { 3: iface('Gi0/3', '50:b7:6c:00:2a:03') } };
  assert.equal(extractStp(vbsOf({ root: bridgeId(0x8000, '50:b7:6c:00:2a:03'), cost: 0, rootPort: 3 }), ctx), null);
  assert.equal(extractStp(vbsOf({ root: bridgeId(0x8000, '50:b7:6c:00:2a:03'), cost: 4, rootPort: 0 }), ctx), null);
});

// ---- MSTP dentro la regione della radice CIST (cattura vera, Cisco vIOS, 12/11/2026) ----
// SW-ACC2 in `spanning-tree mode mst`, regione «LAB», radice CIST = SW-ACC1. Il suo `show` dice
// «Root ID … Cost 0 · Port 1» e la tabella standard dice lo STESSO: RootCost 0 + RootPort 1,
// DesignatedRoot = ACC1, Gi0/0 forwarding, Gi1/2 blocking, costo porte 20000 (metodo lungo).
const _acc2Mst = (over = {}) => ({
  vbs: vbsOf({
    root: bridgeId(0x8000, '50:b7:6c:00:2a:00'), cost: 0, rootPort: 1, topChanges: 7,
    base: 'cc:cc:00:00:00:02',
    ports: { 1: 5, 7: 2 },
    desig: { 1: bridgeId(0x8000, '50:b7:6c:00:2a:00'), 7: bridgeId(0x8000, '50:b7:6c:00:2a:00') },
    ...over,
  }),
  ctx: { bpToIf: { 1: 1, 7: 7 }, ifaces: { 1: iface('GigabitEthernet0/0', '50:c3:01:00:22:00'), 7: iface('GigabitEthernet1/2', '50:c3:01:00:22:06') } },
});

test('MSTP: un non-radice della regione ha costo 0 E porta radice → si legge, con la porta bloccata', () => {
  const { vbs, ctx } = _acc2Mst();
  const r = extractStp(vbs, ctx);
  assert.ok(r, 'senza questa eccezione ogni switch non radice di una regione MST risulterebbe «non letto»');
  assert.equal(r.isRoot, false, 'la radice e\' ACC1: nessun MAC mio');
  assert.equal(r.rootMac, '50:b7:6c:00:2a:00');
  assert.equal(r.rootPriority, 32768);
  assert.equal(r.rootSysId, 0, 'istanza 0 (CIST): nessun sys-id di VLAN');
  assert.equal(r.rootCost, 0, 'la misura si tiene com\'e\': e\' il costo esterno, non si ritocca');
  assert.equal(r.rootPortIfIndex, 1);
  assert.equal(r.rootPortName, 'GigabitEthernet0/0');
  assert.deepEqual(r.blocked, [{ ifIndex: 7, name: 'GigabitEthernet1/2', state: 'blocking' }]);
});

test('MSTP: costo 0 + porta radice SENZA la conferma della tabella porte → NON letto', () => {
  const { vbs, ctx } = _acc2Mst({ desig: null });
  assert.equal(extractStp(vbs, ctx), null, 'nessuna riga di porta con la radice: e\' un segnaposto, non una regione');
  // la riga della porta radice c'e' ma nomina UN'ALTRA radice: le due tabelle non si accordano
  const { vbs: v2, ctx: c2 } = _acc2Mst({ desig: { 1: bridgeId(0x8000, 'aa:bb:cc:00:00:09') } });
  assert.equal(extractStp(v2, c2), null);
  // la riga c'e' per un'altra porta, non per quella radice
  const { vbs: v3, ctx: c3 } = _acc2Mst({ desig: { 7: bridgeId(0x8000, '50:b7:6c:00:2a:00') } });
  assert.equal(extractStp(v3, c3), null);
});

test('MSTP: costo 0 + porta radice che il bridge non conosce → NON letto', () => {
  const { vbs, ctx } = _acc2Mst();
  assert.equal(extractStp(vbs, { ...ctx, bpToIf: { 7: 7 } }), null);
});

test('costo 0 + porta radice con la radice che e\' un MIO MAC → si contraddice, NON letto (anche con la conferma)', () => {
  const { vbs, ctx } = _acc2Mst({
    root: bridgeId(0x8000, '50:c3:01:00:22:00'),
    desig: { 1: bridgeId(0x8000, '50:c3:01:00:22:00') },
  });
  assert.equal(extractStp(vbs, ctx), null, '«la radice sono io» e «ho una porta radice» non stanno insieme');
});

test('l\'eccezione e\' una sola: costo > 0 con porta radice 0 resta un segnaposto, anche con la tabella porte', () => {
  const { vbs, ctx } = _acc2Mst({ cost: 4, rootPort: 0 });
  assert.equal(extractStp(vbs, ctx), null);
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

// ---- Port-channel: lo spanning-tree lo vede come UNA porta, ma i LED del rack sono dei MEMBRI ----
// La lettura (BRIDGE-MIB) arriva sull'ifIndex dell'AGGREGATORE, e l'aggregatore non e' una porta del
// documento (sta in `lags`). Se il driver non porta lo stato fino ai membri, la card dice «Port-channel1
// bloccato» e sul rack non si accende niente: due racconti diversi dello stesso fatto. L'appartenenza
// e' MISURATA (`lagIfIndex`, da ifStackTable/LACP), quindi lo stato dell'aggregato non e' un'ipotesi.
// Fixture SINTETICA nella forma del banco vIOS (v. test/fixtures/stp-poll.js).
const { ciscoPoll, col } = require('./fixtures/stp-poll.js');
const stpPerNome = (r) => Object.fromEntries(r.interfaces.map((i) => [i.name, i.stpState]));

test('Port-channel bloccato: lo stato arriva su OGNI suo membro, e solo su quelli', () => {
  const r = extractData(ciscoPoll({ po1State: 2 }));
  assert.deepEqual(r.stp.blocked, [{ ifIndex: 11, name: 'Port-channel1', state: 'blocking' }], 'la card legge l\'aggregato per nome');
  const s = stpPerNome(r);
  assert.equal(s['GigabitEthernet0/1'], 'blocking', 'membro del Po1 bloccato');
  assert.equal(s['GigabitEthernet0/2'], 'blocking', 'l\'altro membro');
  assert.equal(s['GigabitEthernet0/3'], undefined, 'porta radice, fuori da ogni LAG');
  assert.equal(s['GigabitEthernet0/4'], undefined, 'membro di un ALTRO aggregato (Po2 inoltra)');
  assert.equal(s['GigabitEthernet0/5'], undefined);
});

test('Port-channel «broken»: i membri portano broken, non blocking', () => {
  const s = stpPerNome(extractData(ciscoPoll({ po2State: 6 })));
  assert.equal(s['GigabitEthernet0/4'], 'broken');
  assert.equal(s['GigabitEthernet0/5'], 'broken');
  assert.equal(s['GigabitEthernet0/1'], undefined, 'il Po1 inoltra');
});

test('Port-channel che inoltra: nessun membro portato in blocco', () => {
  const r = extractData(ciscoPoll());
  assert.deepEqual(r.stp.blocked, []);
  assert.ok(r.interfaces.every((i) => i.stpState === undefined));
});

// ---- Una lettura PARZIALE non e' «nessuna porta bloccata» ----
// «nessuna» e' un'affermazione: si fa solo su una tabella letta per intero. Se la walk si taglia a meta'
// (il tetto di tempo sacrifica la coda, e lo STP e' in coda) il driver non lo dice — `walkSession` non
// riporta quante subtree sono fallite — quindi lo si riconosce dalla FORMA del dato: una porta che ha
// righe ma non ha lo stato, uno stato letto senza il link per giudicarlo, un blocco che non sappiamo nominare.
const _tagliata = (rimuovi) => {
  const v = ciscoPoll({ po1State: 2 });
  for (const k of rimuovi(v)) delete v[k];
  return extractData(v);
};

test('tabella porte TAGLIATA dentro la colonna dello stato → «porte bloccate» e\' SCONOSCIUTO, il resto della lettura tiene', () => {
  // le righe di colonna 1 e 2 sono arrivate per tutte; lo stato (colonna 3) solo per la prima
  const r = _tagliata(() => [col(3, 2), col(3, 3)]);
  assert.ok(r.stp, 'radice, costo, porta radice si leggono lo stesso');
  assert.equal(r.stp.isRoot, false);
  assert.equal(r.stp.blocked, null, 'una tabella a meta\' non dice «nessuna bloccata»');
  assert.ok(r.interfaces.every((i) => i.stpState === undefined), 'e nessun LED riceve un segno su una lettura incompleta');
});

test('tabella porte tagliata PRIMA della colonna dello stato → SCONOSCIUTO, non «nessuna»', () => {
  const r = _tagliata(() => [col(3, 1), col(3, 2), col(3, 3)]);
  assert.equal(r.stp.blocked, null);
});

test('OGNI taglio possibile della subtree STP: mai «nessuna porta bloccata» quando una porta e\' bloccata', () => {
  // Una walk che si ferma produce un PREFISSO dell'ordine OID. Si provano tutti: da zero varbind a tutti.
  // Il risultato ammesso e' uno solo di tre — STP non letto, porte bloccate non lette, oppure la lettura
  // completa — e MAI «nessuna». (Provato anche sui varbind VERI di uno switch del banco il 17/11/2026:
  // 35 tagli, 7 «non letto», 13 «non lette», 15 complete, 0 «nessuna».)
  const { _oidGt } = require('../drivers/snmp.js')._internals;
  const v = ciscoPoll({ po1State: 2 });
  const stpKeys = Object.keys(v).filter((k) => k.startsWith(OID.dot1dStp + '.')).sort((a, b) => (_oidGt(a, b) ? 1 : -1));
  assert.ok(stpKeys.length >= 10, 'la fixture ha una subtree STP con scalari e tabella porte (' + stpKeys.length + ' varbind)');
  const esiti = new Set();
  for (let n = 0; n <= stpKeys.length; n++) {
    const cut = { ...v };
    for (const k of stpKeys) delete cut[k];
    for (const k of stpKeys.slice(0, n)) cut[k] = v[k];
    const r = extractData(cut);
    const esito = !r.stp ? 'stp-null' : r.stp.blocked === null ? 'non-lette' : r.stp.blocked.length === 0 ? 'NESSUNA' : 'complete';
    esiti.add(esito);
    assert.notEqual(esito, 'NESSUNA', `taglio dopo ${n} varbind (${stpKeys[n - 1]}): «nessuna» su una tabella a meta'`);
  }
  assert.deepEqual([...esiti].sort(), ['complete', 'non-lette', 'stp-null'], 'tutti e tre gli esiti onesti compaiono: il test attraversa davvero la tabella');
});

test('ifOperStatus NON letto per una porta in blocco → SCONOSCIUTO, non «nessuna» (SNMP-M2: assente non e\' down)', () => {
  // un ifOperStatus assente e' una walk troncata, non una porta giu': scartarla in silenzio la fa sparire
  const v = ciscoPoll({ po1State: 2 });
  delete v[`${OID.ifOperStatus}.11`];
  assert.equal(extractData(v).stp.blocked, null);
});

test('ifOperStatus unknown(4): l\'agente dice «non lo so» → SCONOSCIUTO; giu\'(2) → non e\' bloccata, e\' giu\'', () => {
  assert.equal(extractData(Object.assign(ciscoPoll({ po1State: 2 }), { [`${OID.ifOperStatus}.11`]: Buffer.from([0, 0, 0, 4]) })).stp.blocked, null);
  const giu = extractData(Object.assign(ciscoPoll({ po1State: 2 }), { [`${OID.ifOperStatus}.11`]: Buffer.from([0, 0, 0, 2]) }));
  assert.deepEqual(giu.stp.blocked, [], 'una porta giu\' non e\' «bloccata»: lo si sa, quindi si dice «nessuna»');
});

test('porta in blocco che il bridge non sa nominare (bridge-port senza ifIndex) → SCONOSCIUTO', () => {
  // dot1dBasePortIfIndex troncata: «qualcosa e\' bloccato» si sa, «cosa» no — dirlo con un elenco sarebbe inventarlo
  const v = ciscoPoll({ po1State: 2 });
  delete v[`${OID.bridgePortIf}.2`];
  assert.equal(extractData(v).stp.blocked, null);
});

test('il segno sul LED scade come le altre misure di porta (forgetPortMeasure)', () => {
  const { forgetPortMeasure } = require('../lib/port-state.js');
  const pi = { ifName: 'Gi0/2', stpBlocked: 'blocking' };
  assert.equal(forgetPortMeasure(pi), true, 'se lo switch tace, «bloccata» non si sa piu\'');
  assert.equal('stpBlocked' in pi, false);
  assert.equal(forgetPortMeasure({ ifName: 'Gi0/2' }), false, 'niente da dimenticare, niente da toccare');
});
