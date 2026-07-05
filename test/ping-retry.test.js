'use strict';
// _pingHostRetry: un host puo' perdere il PRIMO ICMP (VPCS, stack lenti) → un singolo
// ping darebbe un falso negativo. Ritenta fino a `tries` volte, VIVO se anche UNO
// risponde. I ritenti sono SPAZIATI (`gapMs`) perche' la perdita ICMP arriva a raffiche:
// due ping ravvicinati cadono nella stessa finestra e falliscono insieme. Testato con
// ping + sleep INIETTATI (nessuna rete reale, nessuna attesa vera).
const test = require('node:test');
const assert = require('node:assert/strict');
const { _pingHostRetry, _pingResultIsAlive } = require('../server/netscan.js');

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

// ── _pingResultIsAlive: l'exit code di `ping` NON basta (task_977d2930) ──────────
// Su Windows `ping.exe` esce con codice 0 anche quando un gateway risponde
// "Destination host unreachable" al posto del target → falso POSITIVO nello sweep.
// L'echo reply genuino contiene sempre "TTL=" (non localizzato); gli errori ICMP no.

test('_pingResultIsAlive/win: reply genuino (TTL presente, IT) → vivo', () => {
  const r = { ok: true, stdout: 'Esecuzione di Ping 192.168.1.50 con 32 byte di dati:\r\nRisposta da 192.168.1.50: byte=32 durata=1ms TTL=64', stderr: '' };
  assert.equal(_pingResultIsAlive('win32', r), true);
});

test('_pingResultIsAlive/win: gateway "non raggiungibile" con EXIT 0 (IT) → MORTO (il bug)', () => {
  // ping.exe esce 0 pur avendo solo un ICMP-unreachable dal gateway: senza TTL = non vivo.
  const r = { ok: true, stdout: 'Esecuzione di Ping 10.10.30.99 con 32 byte di dati:\r\nRisposta da 192.168.1.1: Host di destinazione non raggiungibile.', stderr: '' };
  assert.equal(_pingResultIsAlive('win32', r), false);
});

test('_pingResultIsAlive/win: gateway "Destination host unreachable" con EXIT 0 (EN) → MORTO', () => {
  const r = { ok: true, stdout: 'Pinging 10.10.30.99 with 32 bytes of data:\r\nReply from 192.168.1.1: Destination host unreachable.', stderr: '' };
  assert.equal(_pingResultIsAlive('win32', r), false);
});

test('_pingResultIsAlive/win: "TTL expired in transit" con EXIT 0 → MORTO (non matcha ttl=)', () => {
  const r = { ok: true, stdout: 'Reply from 10.0.0.1: TTL expired in transit.', stderr: '' };
  assert.equal(_pingResultIsAlive('win32', r), false);
});

test('_pingResultIsAlive/win: exit 0 ma output vuoto → MORTO (mai fidarsi dell exit code su Windows)', () => {
  assert.equal(_pingResultIsAlive('win32', { ok: true, stdout: '', stderr: '' }), false);
});

test('_pingResultIsAlive/win: richiesta scaduta (exit != 0) → MORTO', () => {
  assert.equal(_pingResultIsAlive('win32', { ok: false, stdout: 'Richiesta scaduta.', stderr: '' }), false);
});

test('_pingResultIsAlive/linux: reply genuino (exit 0) → vivo', () => {
  const r = { ok: true, stdout: '64 bytes from 10.0.0.5: icmp_seq=1 ttl=64 time=0.30 ms', stderr: '' };
  assert.equal(_pingResultIsAlive('linux', r), true);
});

test('_pingResultIsAlive/linux: unreachable (exit != 0) → MORTO', () => {
  const r = { ok: false, stdout: 'From 10.0.0.1 icmp_seq=1 Destination Host Unreachable', stderr: '' };
  assert.equal(_pingResultIsAlive('linux', r), false);
});

test('_pingResultIsAlive/linux: exit code AFFIDABILE → exit 0 resta vivo anche senza marker (comportamento storico invariato)', () => {
  // Su Linux/macOS l'exit code e' attendibile (unreachable -> exit != 0): non lo tocchiamo.
  assert.equal(_pingResultIsAlive('linux', { ok: true, stdout: '', stderr: '' }), true);
  assert.equal(_pingResultIsAlive('darwin', { ok: true, stdout: '', stderr: '' }), true);
});
