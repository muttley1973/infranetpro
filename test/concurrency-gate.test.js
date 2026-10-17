'use strict';
// Il cancello di concorrenza (lib/concurrency-gate.js): i lavori pesanti non si sommano all'infinito.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGate } = require('../lib/concurrency-gate.js');

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('fino a `max` partono subito, gli altri aspettano, oltre la coda si rifiuta', async () => {
  const g = createGate({ max: 2, queue: 2, waitMs: 0 });
  const a = await g.acquire(), b = await g.acquire();
  assert.equal(typeof a, 'function');
  assert.equal(typeof b, 'function');
  assert.deepEqual([g.stats().active, g.stats().waiting], [2, 0]);

  let c = null, d = null;
  g.acquire().then((r) => { c = r; });
  g.acquire().then((r) => { d = r; });
  await tick();
  assert.equal(c, null, 'in coda, non ancora partiti');
  assert.equal(g.stats().waiting, 2);

  assert.equal(await g.acquire(), null, 'coda piena → NO subito, senza aspettare');
  assert.equal(g.stats().rejected, 1);

  a();                       // si libera un posto → parte il primo della coda (FIFO)
  await tick();
  assert.equal(typeof c, 'function');
  assert.equal(d, null);
  b(); await tick();
  assert.equal(typeof d, 'function');
  c(); d();
  assert.deepEqual([g.stats().active, g.stats().waiting], [0, 0]);
});

test('release e\' idempotente: chiamarlo due volte non libera due posti', async () => {
  const g = createGate({ max: 1, queue: 0, waitMs: 0 });
  const a = await g.acquire();
  a(); a(); a();
  const b = await g.acquire();
  assert.equal(typeof b, 'function', 'il posto liberato una volta si puo\' riprendere');
  assert.equal(await g.acquire(), null, 'ma non ce ne sono due');
  b();
});

test('chi aspetta troppo viene mandato via (waitMs): la coda che non si muove non tiene appeso nessuno', async () => {
  const g = createGate({ max: 1, queue: 5, waitMs: 40 });
  const a = await g.acquire();
  const t0 = Date.now();
  const lento = await g.acquire();          // aspetta, nessuno rilascia
  assert.equal(lento, null);
  assert.ok(Date.now() - t0 >= 30, 'ha aspettato davvero');
  assert.equal(g.stats().waiting, 0, 'e non resta in coda');
  a();
  const b = await g.acquire();
  assert.equal(typeof b, 'function', 'il cancello e\' integro');
  b();
});

test('un picco breve passa tutto, piu\' lento ma senza rifiuti', async () => {
  const g = createGate({ max: 2, queue: 8, waitMs: 2000 });
  let maxActive = 0, done = 0;
  const job = async () => {
    const rel = await g.acquire();
    assert.equal(typeof rel, 'function');
    try { maxActive = Math.max(maxActive, g.stats().active); await sleep(5); done++; } finally { rel(); }
  };
  await Promise.all(Array.from({ length: 10 }, job));
  assert.equal(done, 10);
  assert.ok(maxActive <= 2, 'mai piu\' di 2 insieme: ' + maxActive);
  assert.equal(g.stats().rejected, 0);
});

test('un flusso che non finisce viene rifiutato quasi tutto, e il cancello resta a posto', async () => {
  const g = createGate({ max: 2, queue: 3, waitMs: 0 });
  const held = [];
  let rejected = 0;
  for (let i = 0; i < 100; i++) {
    const p = g.acquire();
    const settled = await Promise.race([p, tick().then(() => 'pending')]);
    if (settled === null) rejected++;
    else if (typeof settled === 'function') held.push(settled);
    // 'pending' = in coda
  }
  assert.equal(held.length, 2, 'solo `max` partiti');
  assert.equal(g.stats().waiting, 3, 'solo `queue` in attesa');
  assert.equal(rejected, 95);
  for (const r of held) r();
  await tick();
  assert.ok(g.stats().active <= 2);
});

test('parametri assurdi non rompono il cancello', async () => {
  for (const bad of [undefined, null, {}, { max: 0 }, { max: -3 }, { max: NaN }, { queue: -1 }, { waitMs: -5 }, { max: 'x' }]) {
    const g = createGate(bad);
    const a = await g.acquire();
    assert.equal(typeof a, 'function', JSON.stringify(bad));
    a();
  }
  assert.equal(createGate({ max: 0 }).stats().max, 1, 'almeno uno parte, o il login non partirebbe mai');
});
