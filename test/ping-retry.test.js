'use strict';
// _pingHostRetry: un host puo' perdere il PRIMO ICMP (VPCS, stack lenti) → un singolo
// ping darebbe un falso negativo. Ritenta fino a `tries` volte, VIVO se anche UNO
// risponde. I ritenti sono SPAZIATI (`gapMs`) perche' la perdita ICMP arriva a raffiche:
// due ping ravvicinati cadono nella stessa finestra e falliscono insieme. Testato con
// ping + sleep INIETTATI (nessuna rete reale, nessuna attesa vera).
const test = require('node:test');
const assert = require('node:assert/strict');
const { _pingHostRetry } = require('../server/netscan.js');

// sleep spy: registra le pause SENZA attendere davvero
const spySleep = () => { const calls = []; return { calls, fn: async (ms) => { calls.push(ms); } }; };

test('_pingHostRetry: VIVO se anche un solo tentativo risponde (falso negativo da perdita ICMP)', async () => {
  let calls = 0;
  const flaky = async () => { calls++; return calls >= 2; };   // 1o fallisce, 2o risponde
  const s = spySleep();
  const ok = await _pingHostRetry('10.0.0.1', 200, 3, flaky, 200, s.fn);
  assert.equal(ok, true, 'vivo appena un tentativo risponde');
  assert.equal(calls, 2, 'si ferma al primo successo (non spreca tentativi)');
  assert.deepEqual(s.calls, [200], 'una sola pausa, TRA il 1o (fallito) e il 2o (riuscito)');
});

test('_pingHostRetry: MORTO dopo esattamente tries tentativi falliti', async () => {
  let calls = 0;
  const dead = async () => { calls++; return false; };
  const s = spySleep();
  const ok = await _pingHostRetry('10.0.0.2', 200, 3, dead, 200, s.fn);
  assert.equal(ok, false);
  assert.equal(calls, 3, 'prova esattamente tries volte');
  assert.deepEqual(s.calls, [200, 200], 'pausa TRA i tentativi: tries-1 pause');
});

test('_pingHostRetry: tries clampato a >=1 e un ping che throwa non fa crashare', async () => {
  let calls = 0;
  const boom = async () => { calls++; throw new Error('spawn fail'); };
  const s = spySleep();
  const ok = await _pingHostRetry('10.0.0.3', 200, 0, boom, 200, s.fn);   // 0 -> clamp a 1
  assert.equal(ok, false);
  assert.equal(calls, 1, 'clamp a 1 tentativo; l errore del ping e catturato');
  assert.deepEqual(s.calls, [], 'un solo tentativo -> nessuna pausa');
});

test('_pingHostRetry: NESSUNA pausa se il 1o tentativo risponde subito (costo minimo sui vivi)', async () => {
  let calls = 0;
  const alive = async () => { calls++; return true; };
  const s = spySleep();
  const ok = await _pingHostRetry('10.0.0.4', 200, 3, alive, 200, s.fn);
  assert.equal(ok, true);
  assert.equal(calls, 1, 'risponde al 1o → non ritenta');
  assert.deepEqual(s.calls, [], 'nessun ritento → nessuna pausa');
});

test('_pingHostRetry: gapMs=0 disabilita la spaziatura (ritenti back-to-back)', async () => {
  let calls = 0;
  const dead = async () => { calls++; return false; };
  const s = spySleep();
  const ok = await _pingHostRetry('10.0.0.5', 200, 3, dead, 0, s.fn);
  assert.equal(ok, false);
  assert.equal(calls, 3);
  assert.deepEqual(s.calls, [], 'gap=0 → nessuna pausa anche con ritenti');
});

test('_pingHostRetry: la pausa usa il valore gapMs passato', async () => {
  let calls = 0;
  const flaky = async () => { calls++; return calls >= 3; };  // riesce al 3o
  const s = spySleep();
  const ok = await _pingHostRetry('10.0.0.6', 200, 4, flaky, 150, s.fn);
  assert.equal(ok, true);
  assert.deepEqual(s.calls, [150, 150], 'due pause da 150ms prima del 2o e del 3o tentativo');
});
