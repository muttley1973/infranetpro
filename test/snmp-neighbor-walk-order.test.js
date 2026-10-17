'use strict';
// ============================================================
// Le letture che dicono CHE COSA e' un vicino non devono mai rubare tempo alla topologia
// ============================================================
// La walk dei vicini procede a ondate di WALK_CONCURRENCY basi sotto un budget di tempo
// (max(15 s, 3 x timeout)). La FDB sta in fondo all'elenco. Le quattro basi aggiunte per
// tipizzare i vicini (modello e capabilities LLDP/CDP) erano nell'elenco PRIMA della FDB: su
// un agente lento ogni ondata in timeout costa un timeout intero, e la FDB poteva non partire
// mai — la topologia «non si ricostruisce, soprattutto dalla FDB». Ora si leggono DOPO, solo
// per i protocolli che hanno vicini, e solo se il budget non e' finito.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../drivers/snmp.js');
const { walkNeighbors, NEIGHBOR_OIDS, EVIDENCE_LLDP, EVIDENCE_CDP, N_OID, FDB_RETRY_BASES } = _internals;

// Sessione finta: registra l'ORDINE delle basi interrogate e risponde con i varbind dati.
function mockSession(data, onCall) {
  const calls = [];
  return {
    calls,
    subtree(base, _maxReps, feedCb, doneCb) {
      calls.push(base);
      if (onCall) onCall(base);
      setImmediate(() => {
        const vbs = data[base];
        if (vbs && vbs.length) feedCb(vbs);
        doneCb(null);
      });
    },
  };
}
const vb = (oid, v = 'x') => ({ oid, value: Buffer.from(v) });
const base = (extra) => Object.assign({
  [N_OID.sysName]: [vb(N_OID.sysName + '.0', 'SW1')],
  [N_OID.fdbPort]: [vb(N_OID.fdbPort + '.0.17.34.51.68.85', '1')],
}, extra);
const LLDP_NBR = { [N_OID.lldpRemChassisId]: [vb(N_OID.lldpRemChassisId + '.0.1.1', 'aabbcc')], [N_OID.lldpRemSysName]: [vb(N_OID.lldpRemSysName + '.0.1.1', 'SW2')] };
const CDP_NBR = { [N_OID.cdpDeviceId]: [vb(N_OID.cdpDeviceId + '.2.1', 'SW3')] };
const evidenceCalled = (calls) => calls.filter((b) => EVIDENCE_LLDP.includes(b) || EVIDENCE_CDP.includes(b));

test('le basi di prova non sono nell\'elenco principale: la FDB non scala di un\'ondata', () => {
  for (const b of [...EVIDENCE_LLDP, ...EVIDENCE_CDP]) assert.ok(!NEIGHBOR_OIDS.includes(b), b + ' non e\' nella walk principale');
  for (const b of FDB_RETRY_BASES) assert.ok(NEIGHBOR_OIDS.includes(b), 'la FDB resta nella walk principale: ' + b);
  assert.equal(EVIDENCE_LLDP.length + EVIDENCE_CDP.length, 4);
});

test('con vicini LLDP: le prove LLDP si leggono DOPO tutta la topologia (FDB compresa), le CDP no', async () => {
  const sess = mockSession(base(LLDP_NBR));
  const res = await walkNeighbors(sess, {});
  const lastMain = Math.max(...NEIGHBOR_OIDS.map((b) => sess.calls.lastIndexOf(b)));
  const firstEv = Math.min(...EVIDENCE_LLDP.map((b) => sess.calls.indexOf(b)));
  assert.ok(firstEv > lastMain, 'prima la topologia (ultima base principale a ' + lastMain + '), poi le prove (' + firstEv + ')');
  assert.deepEqual(evidenceCalled(sess.calls).sort(), [...EVIDENCE_LLDP].sort(), 'solo LLDP: nessun vicino CDP');
  assert.ok(Object.keys(res).some((o) => o.startsWith(N_OID.fdbPort + '.')), 'la FDB e\' nel risultato');
});

test('con vicini CDP: solo le prove CDP', async () => {
  const sess = mockSession(base(CDP_NBR));
  await walkNeighbors(sess, {});
  assert.deepEqual(evidenceCalled(sess.calls).sort(), [...EVIDENCE_CDP].sort());
});

test('senza vicini (uno switch d\'accesso che non annuncia niente): NESSUNA lettura di prove', async () => {
  const sess = mockSession(base({}));
  await walkNeighbors(sess, {});
  assert.deepEqual(evidenceCalled(sess.calls), [], 'un agente senza CDP non paga timeout per tabelle che non ha');
  assert.equal(sess.calls.length, NEIGHBOR_OIDS.length, 'esattamente le basi della topologia, come prima');
});

test('budget finito dopo la topologia: le prove NON si leggono, e la FDB resta', async () => {
  // Orologio finto: ogni interrogazione costa 100 ms. Il budget scade durante l'ultima ondata
  // della walk principale; l'ondata c'e' (parte prima della scadenza), le prove no.
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    const sess = mockSession(base(LLDP_NBR), () => { clock += 100; });
    const deadline = clock + 100 * NEIGHBOR_OIDS.length - 50;
    const res = await walkNeighbors(sess, { deadline });
    assert.deepEqual(evidenceCalled(sess.calls), [], 'niente prove oltre il budget');
    assert.ok(Object.keys(res).some((o) => o.startsWith(N_OID.fdbPort + '.')), 'la topologia c\'e\' tutta');
    assert.ok(Object.keys(res).some((o) => o.startsWith(N_OID.lldpRemSysName + '.')), 'e i vicini pure');
  } finally { Date.now = realNow; }
});

test('agente muto (sysName non risponde): niente walk, ne\' principali ne\' di prova', async () => {
  const sess = mockSession({});
  const res = await walkNeighbors(sess, {});
  assert.deepEqual(sess.calls, [N_OID.sysName]);
  assert.deepEqual(res, {});
});
