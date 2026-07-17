'use strict';
// Hint OS dal TTL (lib/os-hint.js) — "poor man's fingerprint" alla nmap.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ttlOsHint, parseTtl } = require('../lib/os-hint.js');

test('ttlOsHint: famiglie principali con hop 0', () => {
  assert.equal(ttlOsHint(64).osFamily, 'unix');
  assert.equal(ttlOsHint(128).osFamily, 'windows');
  assert.equal(ttlOsHint(255).osFamily, 'netdev');
  assert.equal(ttlOsHint(64).hops, 0);
  assert.equal(ttlOsHint(128).initialTtl, 128);
});

test('ttlOsHint: arrotonda al primo TTL iniziale >= osservato (decremento per hop)', () => {
  assert.equal(ttlOsHint(63).osFamily, 'unix');      // Linux a 1 hop
  assert.equal(ttlOsHint(63).hops, 1);
  assert.equal(ttlOsHint(117).osFamily, 'windows');  // Windows a 11 hop
  assert.equal(ttlOsHint(250).osFamily, 'netdev');   // apparato a 5 hop
  assert.equal(ttlOsHint(250).hops, 5);
  assert.equal(ttlOsHint(1).osFamily, 'unix');
});

test('ttlOsHint: input non validi → null (mai throw)', () => {
  assert.equal(ttlOsHint(0), null);
  assert.equal(ttlOsHint(-1), null);
  assert.equal(ttlOsHint(256), null);
  assert.equal(ttlOsHint('x'), null);
  assert.equal(ttlOsHint(null), null);
  assert.equal(ttlOsHint(undefined), null);
});

test('parseTtl: estrae il TTL dall\'output di ping (OS/lingua-neutral)', () => {
  assert.equal(parseTtl('Risposta da 10.0.0.1: byte=32 durata=1ms TTL=64'), 64);   // Windows IT
  assert.equal(parseTtl('64 bytes from 10.0.0.1: icmp_seq=1 ttl=128 time=0.5 ms'), 128); // Linux
  assert.equal(parseTtl('... ttl:255 ...'), 255);
  assert.equal(parseTtl('Host di destinazione non raggiungibile'), null);          // errore ICMP, no TTL
  assert.equal(parseTtl(''), null);
  assert.equal(parseTtl(null), null);
  assert.equal(parseTtl('ttl=999'), null);   // fuori range → scartato
});
