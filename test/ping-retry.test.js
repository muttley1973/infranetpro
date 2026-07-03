'use strict';
// _pingHostRetry: un host puo' perdere il PRIMO ICMP (VPCS, stack lenti) → un singolo
// ping darebbe un falso negativo. Ritenta fino a `tries` volte, VIVO se anche UNO
// risponde. Testato con una funzione ping INIETTATA (nessuna rete reale).
const test = require('node:test');
const assert = require('node:assert/strict');
const { _pingHostRetry } = require('../server/netscan.js');

test('_pingHostRetry: VIVO se anche un solo tentativo risponde (falso negativo da perdita ICMP)', async () => {
  let calls = 0;
  const flaky = async () => { calls++; return calls >= 2; };   // 1o fallisce, 2o risponde
  const ok = await _pingHostRetry('10.0.0.1', 200, 3, flaky);
  assert.equal(ok, true, 'vivo appena un tentativo risponde');
  assert.equal(calls, 2, 'si ferma al primo successo (non spreca tentativi)');
});

test('_pingHostRetry: MORTO dopo esattamente tries tentativi falliti', async () => {
  let calls = 0;
  const dead = async () => { calls++; return false; };
  const ok = await _pingHostRetry('10.0.0.2', 200, 3, dead);
  assert.equal(ok, false);
  assert.equal(calls, 3, 'prova esattamente tries volte');
});

test('_pingHostRetry: tries clampato a >=1 e un ping che throwa non fa crashare', async () => {
  let calls = 0;
  const boom = async () => { calls++; throw new Error('spawn fail'); };
  const ok = await _pingHostRetry('10.0.0.3', 200, 0, boom);   // 0 -> clamp a 1
  assert.equal(ok, false);
  assert.equal(calls, 1, 'clamp a 1 tentativo; l errore del ping e catturato');
});
