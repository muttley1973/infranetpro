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
const FDB_BASE = '1.3.6.1.2.1.17.4.3.1.2';   // dot1dTpFdbPort — DENTRO FDB_RETRY_BASES
const LLDP_BASE = '1.0.8802.1.1.2.1.4.1.1.7'; // lldpRemPortId — FUORI dal gruppo FDB

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
  assert.equal(sess.calls.length, 2, '1 + 1 retry (WALK_RETRIES=1 default)');
  assert.deepEqual(sess.calls.map(c => c.maxReps), [25, 12], 'max-reps 25→12');
});

test('abort deliberato (OID non crescente) NON si ritenta', async () => {
  const sess = mockSession([{ feed: [VB(FDB_BASE + '.5'), VB(FDB_BASE + '.5')], err: null }]);
  const result = {};
  const errs = await _runWalks(sess, [FDB_BASE], result, 'TEST');
  assert.equal(errs, 1, 'abort conta come errore');
  assert.equal(sess.calls.length, 1, 'nessun retry sull\'abort (loop/runaway)');
});

// --- Retry MIRATO al gruppo FDB (opts.retryBases): il crawl passa FDB_RETRY_BASES,
//     cosi' LLDP/CDP/ARP che vanno in timeout falliscono subito (nessun timeout ripetuto),
//     mentre le basi FDB continuano a ritentare (la cura del troncamento macsuck).
test('retry mirato: con retryBases una base FDB ritenta ancora', async () => {
  const { FDB_RETRY_BASES } = _internals;
  assert.ok(FDB_RETRY_BASES.has(FDB_BASE), 'FDB_BASE deve stare nel gruppo FDB');
  const sess = mockSession([{ feed: null, err: TIMEOUT() }]); // sempre timeout
  const errs = await _runWalks(sess, [FDB_BASE], {}, 'TEST', 4, { retryBases: FDB_RETRY_BASES });
  assert.equal(errs, 1);
  assert.equal(sess.calls.length, 2, 'FDB dentro il set → 1 + 1 retry');
});

test('retry mirato: una base NON-FDB (LLDP) fallisce subito, zero retry', async () => {
  const { FDB_RETRY_BASES } = _internals;
  assert.ok(!FDB_RETRY_BASES.has(LLDP_BASE), 'LLDP deve stare FUORI dal gruppo FDB');
  const sess = mockSession([{ feed: null, err: TIMEOUT() }]); // sempre timeout
  const errs = await _runWalks(sess, [LLDP_BASE], {}, 'TEST', 4, { retryBases: FDB_RETRY_BASES });
  assert.equal(errs, 1);
  assert.equal(sess.calls.length, 1, 'LLDP fuori dal set → nessun retry, un solo timeout');
});

test('compat: senza retryBases ogni base ritenta (poll/printer/hostres invariati)', async () => {
  const sess = mockSession([{ feed: null, err: TIMEOUT() }]); // sempre timeout
  const errs = await _runWalks(sess, [LLDP_BASE], {}, 'TEST'); // niente opts → retryBases=null
  assert.equal(errs, 1);
  assert.equal(sess.calls.length, 2, 'default (nessun set) → anche una base non-FDB ritenta 1 volta');
});

// --- Deadline wall-clock (opts.deadline): un device che va in timeout su OGNI subtree
//     non deve bruciare l'intero budget in sequenza (root cause del "Sync appeso" su un
//     firewall che rispondeva solo a sysName: ~70s a vuoto). Regressione con clock reale.
const { _walkDeadline } = _internals;

// Mock lento: doneCb ritardato di `delayMs` così Date.now() avanza durante la walk.
function mockSlowSession(plan, delayMs) {
  const calls = [];
  return {
    calls,
    subtree(base, maxReps, feedCb, doneCb) {
      const step = plan[calls.length] || plan[plan.length - 1];
      calls.push({ base, maxReps });
      setTimeout(() => {
        if (step.feed && step.feed.length) feedCb(step.feed);
        doneCb(step.err || null);
      }, delayMs);
    },
  };
}

test('deadline: oltre il budget i gruppi di subtree rimanenti sono saltati (dati parziali salvi)', async () => {
  const bases = ['1.1.1', '1.1.2', '1.1.3', '1.1.4', '1.1.5', '1.1.6', '1.1.7', '1.1.8'];
  // Ogni subtree "risponde" (feed ok) ma impiega 80ms; deadline a +120ms → dopo 1-2 basi
  // il controllo tra le ondate scatta e salta il resto. Concorrenza 1 = una base per ondata.
  const sess = mockSlowSession([{ feed: [VB('1.1.1.0')], err: null }], 80);
  const result = {};
  const deadline = Date.now() + 120;
  const errs = await _runWalks(sess, bases, result, 'TEST', 1, { deadline });
  assert.ok(sess.calls.length < bases.length, `alcune basi saltate: ${sess.calls.length}/${bases.length}`);
  assert.ok(sess.calls.length >= 1, 'almeno la prima base e\' stata interrogata');
  assert.ok(errs >= 1, 'le basi saltate contano come errore (dati parziali, non completi)');
  assert.ok(Object.keys(result).length >= 1, 'i varbind raccolti PRIMA della deadline restano');
});

test('deadline: nessun retry se il budget e\' gia\' scaduto quando il timeout ritorna', async () => {
  // Base FDB (di norma ritenta 1 volta in timeout). Il primo tentativo impiega 60ms e la
  // deadline e' a +25ms → al ritorno del timeout il budget e' scaduto → retry saltato.
  const sess = mockSlowSession([{ feed: null, err: TIMEOUT() }], 60);
  const errs = await _runWalks(sess, [FDB_BASE], {}, 'TEST', 4, { retryBases: _internals.FDB_RETRY_BASES, deadline: Date.now() + 25 });
  assert.equal(errs, 1, 'un errore finale');
  assert.equal(sess.calls.length, 1, 'un solo tentativo: il retry e\' stato saltato per deadline');
});

test('deadline: assente (default) → nessun tetto, comportamento storico invariato', async () => {
  const sess = mockSession([{ feed: null, err: TIMEOUT() }]);
  const errs = await _runWalks(sess, [FDB_BASE], {}, 'TEST'); // niente deadline
  assert.equal(sess.calls.length, 2, 'senza deadline il retry avviene comunque');
  assert.equal(errs, 1);
});

test('_walkDeadline: budget = max(floor, timeout*mult), override secco via env', () => {
  const t0 = Date.now();
  const dl = _walkDeadline(5000, 3, 15000);   // 5s*3=15000 vs floor 15000 → 15000
  assert.ok(dl - t0 >= 14000 && dl - t0 <= 16500, `~15s dal now (misurato ${dl - t0}ms)`);
  const dlFloor = _walkDeadline(1000, 3, 15000); // 1s*3=3000 < floor 15000 → floor vince
  assert.ok(dlFloor - Date.now() >= 14000, 'il pavimento vince quando timeout*mult e\' piu\' basso');
  const dlScale = _walkDeadline(10000, 3, 15000); // 10s*3=30000 > floor → scala col timeout
  assert.ok(dlScale - Date.now() >= 29000, 'scala col timeout quando supera il pavimento');
});
