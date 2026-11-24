'use strict';
// ============================================================
// PORT LIVE — la lettura dal vivo di UNA porta: lib pura + driver con un agente finto
// ============================================================
// Due strati, due modi di sbagliare:
//   • lib/port-live.js trasforma DUE letture in cio' che il pannello mostra. Gli errori che costano sono
//     quelli che DICONO una cosa falsa: una velocita' calcolata su contatori azzerati, uno zero al posto
//     di «non letto», un'ambra per un contatore che non e' salito, un Counter64 letto male.
//   • il driver deve trovare la porta dal NOME (non dall'ifIndex), tollerare una colonna non pubblicata
//     e NON indovinare quando due interfacce hanno lo stesso nome.
// I valori dei test sono quelli MISURATI il 24/11/2026 su uno Zyxel GS1900-24 vero (porta 3: 6,9 GB
// ricevuti, 676 GB inviati, MTU 10000, full duplex a 1 Gbit/s) e sul lab (Cisco IOL, EXOS, Aruba CX).
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../lib/port-live.js');
const drv = require('../drivers/snmp.js');
const { _findIfIndex, _readPortSample } = drv._internals;

const sample = (upCs, v, at) => ({ upCs, at: at ?? upCs * 10, v });

// Una lettura completa di una porta in salute (valori dello Zyxel, porta 3).
const base = (over) => Object.assign({
  oper: 1, admin: 1, lastChange: 2000, mtu: 10000, speed: 1000000000, highSpeed: 1000,
  hcInOctets: 6926135670, hcOutOctets: 677016500224,
  hcInUcast: 18000000, hcInMulti: 100000, hcInBcast: 20811,
  hcOutUcast: 739000000, hcOutMulti: 600000, hcOutBcast: 75437,
  inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, inUnknown: 0,
  duplex: 3, fcs: 0, align: 0, symbol: 0, tooLong: 0, macRx: 0, macTx: 0, late: 0, excessive: 0, carrier: 0,
  single: 0, multiple: 0, deferred: 0, pauseIn: 0, pauseOut: 0,
}, over || {});

// ── counterValue: i Counter64 arrivano come Buffer di lunghezza variabile ──────
test('counterValue: un Counter64 e\' un Buffer senza zeri iniziali, e va letto come intero grande', () => {
  assert.strictEqual(L.counterValue(Buffer.from('019b6f2404', 'hex')), parseInt('019b6f2404', 16), 'il valore vero letto dallo Zyxel: 5 byte');
  assert.strictEqual(L.counterValue(Buffer.from([0x00])), 0, 'un Counter64 a zero arriva come un solo byte 0x00');
  assert.strictEqual(L.counterValue(Buffer.from('0100000000', 'hex')), 4294967296, 'oltre i 32 bit');
  assert.ok(L.counterValue(Buffer.from('00ffffffffffffffff', 'hex')) > 1.8e19, 'il byte 0x00 iniziale (segno ASN.1) si tollera');
});

test('counterValue: numeri e testi numerici si leggono, il resto e\' «non letto» (null), mai zero', () => {
  assert.strictEqual(L.counterValue(42), 42);
  assert.strictEqual(L.counterValue('12345'), 12345);
  assert.strictEqual(L.counterValue(null), null);
  assert.strictEqual(L.counterValue(undefined), null);
  assert.strictEqual(L.counterValue(-1), null);
  assert.strictEqual(L.counterValue(NaN), null);
  assert.strictEqual(L.counterValue('abc'), null);
  assert.strictEqual(L.counterValue(Buffer.alloc(0)), null);
  assert.strictEqual(L.counterValue(Buffer.alloc(12, 1)), null, 'un Buffer piu\' lungo di un Counter64 non e\' un contatore');
});

test('counterDelta: a 32 bit un calo e\' un giro del contatore; a 64 bit e\' un azzeramento e non si dice niente', () => {
  assert.strictEqual(L.counterDelta(100, 150, 64), 50);
  assert.strictEqual(L.counterDelta(4294967290, 10, 32), 16, 'un giro: 2^32 - 4294967290 + 10');
  assert.strictEqual(L.counterDelta(500, 10, 64), null, 'calato a 64 bit: azzerato');
  assert.strictEqual(L.counterDelta(null, 10, 64), null);
  assert.strictEqual(L.counterDelta(10, null, 32), null);
});

// ── summarizePortLive ──────────────────────────────────────────────────────────
test('una sola lettura: i totali ci sono, la velocita\' attuale NO (serve una differenza)', () => {
  const s = L.summarizePortLive([sample(98507136, base())]);
  assert.strictEqual(s.answered, true);
  assert.strictEqual(s.traffic.inBytes, 6926135670);
  assert.strictEqual(s.traffic.outBytes, 677016500224);
  assert.strictEqual(s.traffic.inBps, null);
  assert.strictEqual(s.traffic.outBps, null);
  assert.strictEqual(s.traffic.spanS, null);
});

test('due letture: la velocita\' attuale viene dalla differenza e dal tempo dell\'APPARATO (sysUpTime), non dall\'orologio', () => {
  // 3,04 s di sysUpTime ma 9 s di orologio (rete lenta): si fida dell'apparato.
  const a = sample(98507136, base(), 1000);
  const b = sample(98507440, base({ hcInOctets: 6926135670 + 145000, hcOutOctets: 677016500224 + 2520000 }), 10000);
  const s = L.summarizePortLive([a, b]);
  assert.ok(Math.abs(s.traffic.spanS - 3.04) < 1e-9, 'span da sysUpTime');
  assert.ok(Math.abs(s.traffic.inBps - 145000 * 8 / 3.04) < 1);
  assert.ok(Math.abs(s.traffic.outBps - 2520000 * 8 / 3.04) < 1);
  // utilizzo: 6,6 Mbit/s su 1 Gbit/s = 0,66 %
  assert.ok(s.traffic.outUtil > 0.6 && s.traffic.outUtil < 0.7, 'utilizzo ' + s.traffic.outUtil);
});

test('contatori AZZERATI nel mezzo della misura (ifCounterDiscontinuityTime cambia): nessuna velocita\'', () => {
  const a = sample(1000, base({ discontinuity: 5 }));
  const b = sample(1300, base({ discontinuity: 1200, hcInOctets: 100, hcOutOctets: 100 }));
  const s = L.summarizePortLive([a, b]);
  assert.strictEqual(s.traffic.reset, true);
  assert.strictEqual(s.traffic.inBps, null);
  assert.strictEqual(s.traffic.outBps, null);
  assert.deepStrictEqual(s.errors.grew, [], 'nemmeno gli errori si confrontano');
});

test("azzeramento dichiarato (discontinuity cambia) anche se i numeri SALGONO: la velocità non si dice lo stesso", () => {
  // I contatori ripartono da zero e in 3 s risalgono OLTRE il valore di prima: il calo non si vede, la discontinuity si.
  const a = sample(1000, base({ discontinuity: 5, hcOutOctets: 100, outErrors: 1 }));
  const b = sample(1300, base({ discontinuity: 1200, hcOutOctets: 9999999, outErrors: 7 }));
  const s = L.summarizePortLive([a, b]);
  assert.strictEqual(s.traffic.reset, true);
  assert.strictEqual(s.traffic.outBps, null, "nessuna velocità su un azzeramento");
  assert.deepStrictEqual(s.errors.grew, [], 'e nessun errore «salito»');
});

test("due letture troppo vicine (meno di mezzo secondo): nessuna velocità, una divisione per quasi zero direbbe una cifra enorme", () => {
  const s = L.summarizePortLive([sample(1000, base()), sample(1010, base({ hcOutOctets: 677016500224 + 5000000 }))]);
  assert.strictEqual(s.traffic.spanS, null);
  assert.strictEqual(s.traffic.outBps, null);
});

test("un contatore di errori che CALA fra le due letture è stato azzerato: non è un errore «salito» (non è un giro a 32 bit)", () => {
  const s = L.summarizePortLive([sample(1000, base({ fcs: 5, inErrors: 9 })), sample(1300, base({ fcs: 2, inErrors: 3 }))]);
  assert.deepStrictEqual(s.errors.grew, []);
});

test('un contatore a 64 bit che CALA senza discontinuity: niente velocita\', non una velocita\' gigantesca', () => {
  const s = L.summarizePortLive([sample(1000, base()), sample(1300, base({ hcInOctets: 5, hcOutOctets: 5 }))]);
  assert.strictEqual(s.traffic.inBps, null);
  assert.strictEqual(s.traffic.outBps, null);
});

test('senza i contatori a 64 bit si usano quelli a 32, e la card lo DICE (bits = 32)', () => {
  const v = base({ hcInOctets: null, hcOutOctets: null, inOctets32: 1000, outOctets32: 5000 });
  const a = sample(1000, v), b = sample(1300, Object.assign({}, v, { inOctets32: 4000, outOctets32: 5000 + 30000 }));
  const s = L.summarizePortLive([a, b]);
  assert.strictEqual(s.traffic.bits, 32);
  assert.ok(Math.abs(s.traffic.inBps - 3000 * 8 / 3) < 1);
});

test('senza nessun contatore di byte: traffic.bits e\' null (la card dice «non pubblicati»)', () => {
  const v = base({ hcInOctets: null, hcOutOctets: null });
  assert.strictEqual(L.summarizePortLive([sample(1, v)]).traffic.bits, null);
});

test('errori: «cresciuti» = saliti FRA le due letture, e basta (nessuna soglia)', () => {
  const a = sample(1000, base({ outDiscards: 11 })), b = sample(1300, base({ outDiscards: 14, fcs: 2, late: 1 }));
  const s = L.summarizePortLive([a, b]);
  assert.deepStrictEqual(s.errors.grew.sort(), ['fcs', 'late', 'outDiscards'].sort());
  assert.strictEqual(s.errors.deltas.outDiscards, 3);
  assert.strictEqual(s.errors.any, true);
});

test('errori che NON sono saliti: valori presenti, nessuna ambra (undici scarti vecchi non sono un problema in corso)', () => {
  const a = sample(1000, base({ outDiscards: 11 })), b = sample(1300, base({ outDiscards: 11 }));
  const s = L.summarizePortLive([a, b]);
  assert.deepStrictEqual(s.errors.grew, []);
  assert.strictEqual(s.errors.outDiscards, 11);
  assert.strictEqual(s.errors.any, true);
});

test('le collisioni singole, multiple e differite NON fanno ambra: in half duplex sono normali', () => {
  const a = sample(1000, base({ single: 1, multiple: 1, deferred: 1 })), b = sample(1300, base({ single: 50, multiple: 20, deferred: 30 }));
  const s = L.summarizePortLive([a, b]);
  assert.deepStrictEqual(s.errors.grew, []);
  assert.deepStrictEqual(s.errors.detail.map(d => d.key).sort(), ['deferred', 'multiple', 'single'], 'ma si ELENCANO, sono un fatto');
});

test('rete sana: tutto a zero → nessun dettaglio, any = false (la card dice «nessun errore»)', () => {
  const s = L.summarizePortLive([sample(1000, base()), sample(1300, base())]);
  assert.strictEqual(s.errors.any, false);
  assert.deepStrictEqual(s.errors.detail, []);
  assert.strictEqual(s.errors.answered, true);
});

test('colonne errori NON pubblicate: «non letto», mai zero (answered = false, valori null)', () => {
  const v = base({ inErrors: null, outErrors: null, inDiscards: null, outDiscards: null, fcs: null });
  const s = L.summarizePortLive([sample(1, v)]);
  assert.strictEqual(s.errors.answered, false);
  assert.strictEqual(s.errors.inErrors, null);
  assert.strictEqual(s.errors.any, false);
});

test('da quanto tempo e\' in questo stato: sysUpTime - ifLastChange; lastChange 0 = dall\'avvio; piu\' grande dell\'uptime = giro dei tick, non attendibile', () => {
  assert.strictEqual(L.summarizePortLive([sample(98507136, base({ lastChange: 39869700 }))]).sinceSec, (98507136 - 39869700) / 100);
  const boot = L.summarizePortLive([sample(5000, base({ lastChange: 0 }))]);
  assert.strictEqual(boot.sinceBoot, true);
  assert.strictEqual(boot.sinceSec, 50);
  assert.strictEqual(L.summarizePortLive([sample(100, base({ lastChange: 99999 }))]).sinceSec, null);
  assert.strictEqual(L.summarizePortLive([sample(100, base({ lastChange: null }))]).sinceSec, null);
});

test('velocita\' del link: ifHighSpeed (Mbit/s) se c\'e\'; ifSpeed in bit/s; ifSpeed SATURO a 4294967295 non dice niente', () => {
  assert.strictEqual(L.speedMbps({ highSpeed: 10000, speed: 4294967295 }), 10000);
  assert.strictEqual(L.speedMbps({ highSpeed: 0, speed: 100000000 }), 100);
  assert.strictEqual(L.speedMbps({ highSpeed: 0, speed: 4294967295 }), null);
  assert.strictEqual(L.speedMbps({ highSpeed: null, speed: null }), null);
  assert.strictEqual(L.speedMbps({ highSpeed: 0, speed: 0 }), null, 'zero e\' «ignota», non «zero Mbit/s»');
});

test('duplex: 3 = full, 2 = half, 1 = unknown (porta giu\') resta null — non si inventa un duplex', () => {
  const d = n => L.summarizePortLive([sample(1, base({ duplex: n }))]).duplex;
  assert.strictEqual(d(3), 'full');
  assert.strictEqual(d(2), 'half');
  assert.strictEqual(d(1), null);
  assert.strictEqual(d(null), null);
});

test('l\'utilizzo non si calcola su una porta che non e\' su (la velocita\' di un link giu\' e\' il suo massimo, non il suo uso)', () => {
  const a = sample(1000, base({ oper: 2 })), b = sample(1300, base({ oper: 2, hcOutOctets: 677016500224 + 1000000 }));
  assert.strictEqual(L.summarizePortLive([a, b]).traffic.outUtil, null);
});

test('l\'apparato risponde ma non pubblica NESSUNA colonna: answered = false (non e\' una porta a zero)', () => {
  const nulls = {}; for (const k of L.PORT_KEYS) nulls[k] = null;
  assert.strictEqual(L.summarizePortLive([sample(1, nulls)]).answered, false);
  assert.strictEqual(L.summarizePortLive([]).answered, false);
  assert.strictEqual(L.summarizePortLive(null).answered, false);
});

test('stati dell\'interfaccia: oper e admin si traducono, un valore fuori tabella e\' «unknown» e non esplode', () => {
  const s = L.summarizePortLive([sample(1, base({ oper: 5, admin: 2 }))]);
  assert.strictEqual(s.oper, 'dormant');
  assert.strictEqual(s.admin, 'down');
  assert.strictEqual(L.summarizePortLive([sample(1, base({ oper: 99 }))]).oper, 'unknown');
});

test('pause frame: presenti solo se almeno una colonna risponde', () => {
  assert.deepStrictEqual(L.summarizePortLive([sample(1, base({ pauseIn: 3, pauseOut: 0 }))]).pause, { in: 3, out: 0 });
  assert.strictEqual(L.summarizePortLive([sample(1, base({ pauseIn: null, pauseOut: null }))]).pause, null);
});

test('pacchetti: la somma di unicast + multicast + broadcast, e la velocita\' in pacchetti/s', () => {
  const a = sample(1000, base({ hcInUcast: 1000, hcInMulti: 10, hcInBcast: 5 }));
  const b = sample(1200, base({ hcInUcast: 1400, hcInMulti: 20, hcInBcast: 9 }));
  const s = L.summarizePortLive([a, b]);
  assert.strictEqual(s.traffic.inPkts, 1400 + 20 + 9);
  assert.ok(Math.abs(s.traffic.inPps - (400 + 10 + 4) / 2) < 1e-9);
});

test("byte che passano e zero pacchetti: «non letto», non uno zero che mente (un host ESXi conta gli uni e non gli altri)", () => {
  const v = base({ hcInUcast: 0, hcInMulti: 0, hcInBcast: 0, hcOutUcast: 0, hcOutMulti: 0, hcOutBcast: 0 });
  const s = L.summarizePortLive([sample(1000, v), sample(1300, Object.assign({}, v, { hcOutOctets: v.hcOutOctets + 9000 }))]);
  assert.strictEqual(s.traffic.inPkts, null);
  assert.strictEqual(s.traffic.outPkts, null);
  assert.strictEqual(s.traffic.outPps, null);
  assert.ok(s.traffic.outBps > 0, 'i byte restano');
  // una porta davvero ferma (zero byte, zero pacchetti) resta uno zero vero
  const ferma = base({ hcInOctets: 0, hcOutOctets: 0, hcInUcast: 0, hcInMulti: 0, hcInBcast: 0, hcOutUcast: 0, hcOutMulti: 0, hcOutBcast: 0 });
  assert.strictEqual(L.summarizePortLive([sample(1, ferma)]).traffic.inPkts, 0);
});

test('scale per mostrare i numeri: unita\' decimali per i byte e i bit, durata a gradini', () => {
  assert.deepStrictEqual(L.scaleBytes(676016500224).unit, 'GB');
  assert.strictEqual(Math.round(L.scaleBytes(676016500224).value), 676);
  assert.strictEqual(L.scaleBits(6639689).unit, 'Mbit/s');
  assert.strictEqual(L.scaleBits(383813).unit, 'kbit/s');
  assert.strictEqual(L.scaleBits(500).unit, 'bit/s');
  assert.strictEqual(L.scaleCount(739675437).unit, 'M');
  assert.strictEqual(L.scaleDuration(45).unit, 's');
  assert.strictEqual(L.scaleDuration(600).unit, 'min');
  assert.strictEqual(L.scaleDuration(7200).unit, 'h');
  assert.strictEqual(L.scaleDuration(985054).unit, 'd');
});

test('le colonne sono standard IF-MIB / EtherLike-MIB: nessun OID di fornitore (paletto ③)', () => {
  for (const [k, oid] of Object.entries(L.PORT_COLUMNS)) {
    assert.ok(/^1\.3\.6\.1\.2\.1\.(2|31|10)\./.test(oid), `${k}: ${oid} non e' IF-MIB/EtherLike-MIB`);
  }
  assert.strictEqual(new Set(Object.values(L.PORT_COLUMNS)).size, L.PORT_KEYS.length, 'nessun OID ripetuto');
});

// ── Il driver con un agente finto ─────────────────────────────────────────────
// Un agente finto con `subtree` e `get`: risponde con quello che gli si e' dato; un OID che non conosce
// ritorna un varbind d'errore (noSuchInstance), come un agente vero.
const snmp = require('net-snmp');
function fakeSession(tables, getLog) {
  return {
    subtree(base, _rep, feed, done) {
      const rows = [];
      for (const [oid, value] of Object.entries(tables)) {
        if (oid.startsWith(base + '.')) rows.push({ oid, type: snmp.ObjectType.OctetString, value: Buffer.from(String(value)) });
      }
      setImmediate(() => { if (rows.length) feed(rows); done(); });
    },
    get(oids, cb) {
      if (getLog) getLog.push(oids.slice());
      const out = oids.map(oid => (oid in tables)
        ? { oid, type: snmp.ObjectType.Integer, value: tables[oid] }
        : { oid, type: snmp.ObjectType.NoSuchInstance, value: null });
      setImmediate(() => cb(null, out));
    },
  };
}
const IFNAME = '1.3.6.1.2.1.31.1.1.1.1', IFDESCR = '1.3.6.1.2.1.2.2.1.2';

test('driver: l\'ifIndex si trova dal NOME, senza badare a spazi e maiuscole (come `applyPollResult` abbina le porte)', async () => {
  const s = fakeSession({ [IFNAME + '.1']: 'Gi0/1', [IFNAME + '.3']: 'Gi0/3', [IFNAME + '.7']: 'Gi0/7' });
  assert.deepStrictEqual(await _findIfIndex(s, '  gi0/3 '), { ifIndex: 3, name: 'Gi0/3', via: 'ifName' });
});

test('driver: se ifName non c\'e\' si ripiega su ifDescr', async () => {
  const s = fakeSession({ [IFDESCR + '.5']: 'GigabitEthernet5' });
  const r = await _findIfIndex(s, 'GigabitEthernet5');
  assert.strictEqual(r.ifIndex, 5);
  assert.strictEqual(r.via, 'ifDescr');
});

test('driver: due interfacce con lo stesso nome = AMBIGUO, non si indovina', async () => {
  const s = fakeSession({ [IFNAME + '.2']: 'eth0', [IFNAME + '.9']: 'ETH0' });
  assert.deepStrictEqual(await _findIfIndex(s, 'eth0'), { ifIndex: 0, reason: 'ambiguous' });
});

test('driver: un nome che non esiste sull\'apparato = not-found, e un nome vuoto non interroga nessuno', async () => {
  const s = fakeSession({ [IFNAME + '.1']: 'Gi0/1' });
  assert.deepStrictEqual(await _findIfIndex(s, 'Gi0/99'), { ifIndex: 0, reason: 'not-found' });
  assert.deepStrictEqual(await _findIfIndex(s, '  '), { ifIndex: 0, reason: 'no-name' });
});

test('driver: una lettura chiede le colonne di QUELL\'ifIndex, a gruppi corti, con sysUpTime nel primo', async () => {
  const log = [];
  const s = fakeSession({ [L.PORT_COLUMNS.hcInOctets + '.3']: Buffer.from('019b6f2404', 'hex'), [L.SYS_UPTIME]: 98507136 }, log);
  const smp = await _readPortSample(s, 3);
  assert.ok(log.length >= 3, 'piu\' GET, non uno enorme');
  assert.ok(log.every(g => g.length <= L.GET_CHUNK), 'nessun GET oltre ' + L.GET_CHUNK + ' OID');
  assert.strictEqual(log[0][0], L.SYS_UPTIME, 'sysUpTime e\' nel primo GET, accanto ai contatori di traffico');
  assert.ok(log.flat().filter(o => o !== L.SYS_UPTIME).every(o => o.endsWith('.3')), 'tutte le colonne sono dell\'ifIndex 3');
  assert.strictEqual(smp.upCs, 98507136);
  assert.strictEqual(smp.v.hcInOctets, parseInt('019b6f2404', 16), 'il Counter64 e\' decodificato');
});

test('driver: una colonna che l\'agente non pubblica (noSuchInstance) vale null, non 0', async () => {
  const s = fakeSession({ [L.SYS_UPTIME]: 1000, [L.PORT_COLUMNS.oper + '.3']: 1 });
  const smp = await _readPortSample(s, 3);
  assert.strictEqual(smp.v.oper, 1);
  assert.strictEqual(smp.v.hcInOctets, null);
  assert.strictEqual(smp.v.fcs, null);
  assert.strictEqual(smp.v.duplex, null);
});

test('driver: pollPort rifiuta un host mancante e lo dice (nessuna lettura alla cieca)', async () => {
  await assert.rejects(drv.pollPort({ host: '  ' }, { ifName: 'Gi0/1' }), /Host/);
});
