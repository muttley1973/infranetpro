'use strict';
// Retry adattivo delle walk SNMP (`_runWalks` in drivers/snmp.js) — la cura del
// troncamento FDB sotto carico crawl ("a volte 0 badge macsuck"). Come netdisco: una
// walk che va in TIMEOUT si ri-prova con max-repetitions DIMEZZATO + backoff; un abort
// deliberato (loop/runaway) no. Mock della sessione net-snmp, zero rete.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../drivers/snmp.js');
const { _runWalks } = _internals;

// Mock sessione net-snmp: subtree(base, maxReps, feedCb, doneCb). `plan` = comportamento
// per-tentativo: { feed: [varbind]|null, err: Error|null }. L'ultimo step si ripete.
function mockSession(plan) {
  const calls = [];
  return {
    calls,
    subtree(base, maxReps, feedCb, doneCb) {
      const step = plan[calls.length] || plan[plan.length - 1];
      calls.push({ base, maxReps });
      setImmediate(() => {
        if (step.feed && step.feed.length) feedCb(step.feed);
        doneCb(step.err || null);
      });
    },
  };
}

const VB = oid => ({ oid, value: Buffer.from('x') });
const TIMEOUT = () => new Error('Request timed out');
const FDB_BASE = '1.3.6.1.2.1.17.4.3.1.2';

test('retry: timeout al 1o giro, successo al retry con max-reps dimezzato', async () => {
  const sess = mockSession([
    { feed: null, err: TIMEOUT() },              // 1o: timeout
    { feed: [VB(FDB_BASE + '.1')], err: null },  // 2o: ok
  ]);
  const result = {};
  const errs = await _runWalks(sess, [FDB_BASE], result, 'TEST');
  assert.equal(errs, 0, 'nessun errore finale: il retry ha recuperato');
  assert.ok(Object.keys(result).length >= 1, 'FDB popolata dal retry');
  assert.equal(sess.calls.length, 2, 'due tentativi');
  assert.equal(sess.calls[0].maxReps, 25, '1o a max-reps pieno');
  assert.equal(sess.calls[1].maxReps, 12, 'retry a max-reps dimezzato (25>>1)');
});

test('nessun retry se la walk riesce al primo colpo', async () => {
  const sess = mockSession([{ feed: [VB(FDB_BASE + '.9')], err: null }]);
  const result = {};
  const errs = await _runWalks(sess, [FDB_BASE], result, 'TEST');
  assert.equal(errs, 0);
  assert.equal(sess.calls.length, 1, 'una sola passata');
});

test('timeout persistente: esaurisce i retry (1 + WALK_RETRIES) con max-reps decrescente', async () => {
  const sess = mockSession([{ feed: null, err: TIMEOUT() }]); // sempre timeout
  const result = {};
  const errs = await _runWalks(sess, [FDB_BASE], result, 'TEST');
  assert.equal(errs, 1, 'un errore finale dopo i retry esauriti');
  assert.equal(sess.calls.length, 3, '1 + 2 retry (WALK_RETRIES=2 default)');
  assert.deepEqual(sess.calls.map(c => c.maxReps), [25, 12, 6], 'max-reps 25→12→6');
});

test('abort deliberato (OID non crescente) NON si ritenta', async () => {
  const sess = mockSession([{ feed: [VB(FDB_BASE + '.5'), VB(FDB_BASE + '.5')], err: null }]);
  const result = {};
  const errs = await _runWalks(sess, [FDB_BASE], result, 'TEST');
  assert.equal(errs, 1, 'abort conta come errore');
  assert.equal(sess.calls.length, 1, 'nessun retry sull\'abort (loop/runaway)');
});
