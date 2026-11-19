'use strict';
// L'appartenenza ai LAG (ifStack + 802.3ad) non deve dipendere da QUANTO ci mettono le famiglie
// opzionali a fallire. Gemello di test/snmp-identity-first.test.js: stesso apparato, stessa causa.
//
// Caso misurato dal vivo il 18/11/2026 su uno switch Zyxel GS1900 con un LAG STATICO (LAG1 = porte 3+6):
// le tre subtree Cisco VTP (`vlanTrunkPort*`) non esistono su quell'agente e restano MUTE, ognuna costa
// due timeout (≈ 12 s in tutto); l'ultimo gruppo — dove stanno `aggMemberPorts`, `lagAttached`,
// `lagOperState`, cioe' l'802.3ad — parte a 19 s e il tetto di 25 s lo taglia. Il poll riusciva, ma
// SENZA i membri del LAG: 0 varbind 802.3ad su 6 giri, e le porte 3 e 6 risultavano porte qualunque.
// Spostando UNA SOLA colonna in piu' nell'elenco comune lo stesso agente rispondeva (60 varbind su 6 giri):
// l'ordine decideva, e nessuno lo aveva scritto. Ora il LAG si legge PRIMA, in un passaggio suo.
// Mock della sessione net-snmp: zero rete, orologio vero.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../drivers/snmp.js');
const { walkSession, OID, ENTITY_BASES, LAG_BASES } = _internals;

const TIMEOUT = () => new Error('Request timed out');
const S = (s) => Buffer.from(s);

// Una riga per ogni base del LAG, come risponde l'agente (la colonna 802.3ad e' una PortList: qui un blob).
const LAG_ROW = { [OID.aggMemberPorts]: { 1000: Buffer.from([0x24]) }, [OID.lagAttached]: { 3: 1000, 6: 1000 }, [OID.lagOperState]: { 3: 1, 6: 1 } };

// Agente «con le famiglie opzionali mute»: sysName, ENTITY-MIB e LAG rispondono subito, ogni altra
// subtree va in timeout dopo `silentMs`.
function mockMuteAgent(silentMs) {
  const calls = [];
  return {
    calls,
    subtree(base, maxReps, feedCb, doneCb) {
      calls.push(base);
      if (base === OID.sysName) return setImmediate(() => { feedCb([{ oid: OID.sysName + '.0', value: S('GS1900') }]); doneCb(null); });
      // sysObjectID viaggia con sysName nella prima ondata (v. snmp-vendor-gate.test.js): qui l'agente non lo
      // pubblica, quindi nessuna prova contraria e si leggono tutte le famiglie, come prima.
      if (base === OID.sysObjectID) return setImmediate(() => doneCb(null));
      if (ENTITY_BASES.includes(base)) return setImmediate(() => doneCb(null));
      if (LAG_BASES.includes(base)) {
        return setImmediate(() => {
          const col = LAG_ROW[base] || {};
          const vbs = Object.keys(col).map((i) => ({ oid: `${base}.${i}`, value: col[i] }));
          if (vbs.length) feedCb(vbs);
          doneCb(null);
        });
      }
      setTimeout(() => doneCb(TIMEOUT()), silentMs);
    },
  };
}

test('LAG_BASES: ifStack + le tre colonne dell\'802.3ad (L0, L1, L2), e nient\'altro', () => {
  assert.deepEqual([...LAG_BASES].sort(), [OID.ifStackStatus, OID.aggMemberPorts, OID.lagAttached, OID.lagOperState].sort());
});

test('LAG: con le famiglie opzionali mute e il budget che si esaurisce, i membri arrivano lo stesso', async () => {
  // Budget stretto rispetto a UN gruppo di subtree mute (2 timeout + backoff ≈ 280 ms): dopo il primo
  // gruppo il tetto e' passato e il resto viene saltato. Prima del cambio le basi del LAG stavano nel resto.
  const sess = mockMuteAgent(80);
  const vbs = await walkSession(sess, { deadline: Date.now() + 250 });
  for (const base of [OID.aggMemberPorts, OID.lagAttached, OID.lagOperState]) {
    assert.ok(Object.keys(vbs).some((o) => o.startsWith(base + '.')), `${base}: una walk col budget esaurito NON deve perdere il LAG`);
  }
});

test('LAG: si legge PRIMA di qualunque altra famiglia, dopo l\'identita\'', async () => {
  const sess = mockMuteAgent(1);
  await walkSession(sess, { deadline: Date.now() + 5000 });
  const idx = (b) => sess.calls.indexOf(b);
  const ultimaLag = Math.max(...LAG_BASES.map(idx));
  const ultimaEnt = Math.max(...ENTITY_BASES.map(idx));
  const altre = sess.calls.filter((b) => b !== OID.sysName && b !== OID.sysObjectID && !ENTITY_BASES.includes(b) && !LAG_BASES.includes(b));
  assert.ok(altre.length > 0, 'le altre famiglie vengono interrogate');
  assert.ok(ultimaEnt < Math.min(...LAG_BASES.map(idx)), 'l\'identita\' resta la prima');
  assert.ok(ultimaLag < Math.min(...altre.map(idx)), `LAG (ultima @${ultimaLag}) prima delle altre (prima @${Math.min(...altre.map(idx))})`);
});

test('LAG: ogni subtree e\' interrogata UNA volta sola (lo spostamento non ne duplica ne\' ne perde)', async () => {
  const sess = mockMuteAgent(1);
  await walkSession(sess, { deadline: Date.now() + 5000 });
  assert.deepEqual([...new Set(sess.calls)].sort(), [...new Set(Object.values(OID))].sort(), 'stesse basi di prima: nessuna persa');
  for (const b of LAG_BASES) assert.equal(sess.calls.filter((c) => c === b).length, 1, `${b} letta una volta`);
});

test('LAG: un 802.3ad che resta MUTO non affama il resto del poll (ha un sotto-budget)', async () => {
  // Agente che sull'802.3ad va in timeout (come altri firmware) e risponde bene al resto: il LAG non e'
  // un motivo per perdere le porte. Tetto totale 600 ms; il passaggio del LAG puo' usarne al piu' un terzo.
  // 320 ms di silenzio: SENZA sotto-budget il primo timeout (320) cade dentro il tetto, scatta il retry
  // (backoff + altri 320 ≈ 760 ms) e il resto viene saltato; CON il sotto-budget (200 ms) il retry non parte.
  const sess = {
    calls: [],
    subtree(base, maxReps, feedCb, doneCb) {
      this.calls.push(base);
      if (base === OID.sysName) return setImmediate(() => { feedCb([{ oid: OID.sysName + '.0', value: S('x') }]); doneCb(null); });
      if (LAG_BASES.includes(base)) return setTimeout(() => doneCb(TIMEOUT()), 320);
      setImmediate(() => { feedCb([{ oid: base + '.1', value: S('ok') }]); doneCb(null); });
    },
  };
  const t0 = Date.now();
  const vbs = await walkSession(sess, { deadline: t0 + 600 });
  assert.ok(Object.keys(vbs).some((o) => o.startsWith(OID.ifDescr + '.')), 'le interfacce sono state lette comunque');
  assert.ok(Date.now() - t0 < 700, `il poll resta nel tetto (misurato ${Date.now() - t0} ms)`);
});
