'use strict';
// buildNdCandidates — gemello IPv6 di buildArpCandidates (lib/correlate.js).
// Propone i vicini IPv6 (ipNetToPhysicalTable) come candidati: solo indirizzi-host
// ROUTABILI (global/ULA), MAC normalizzato e unicast reale, dedup/known-filter.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNdCandidates } = require('../lib/correlate');

test('buildNdCandidates: tiene solo global/ULA, scarta link-local; MAC normalizzato', () => {
  const nd = {
    'AA:BB:CC:11:22:33': ['fe80::a8bb:ccff:fe11:2233', '2001:db8::10'], // link-local scartato, global tenuto
    '00-11-22-44-55-66': ['fd12:3456::5'],                              // ULA tenuto, formato MAC diverso
  };
  const out = buildNdCandidates(nd, { fromIp: '10.0.0.1' });
  assert.deepEqual(out.map(c => c.ip6).sort(), ['2001:db8::10', 'fd12:3456::5']);
  assert.ok(out.every(c => c.viaFrom === '10.0.0.1'));
  const byIp = Object.fromEntries(out.map(c => [c.ip6, c.mac]));
  assert.equal(byIp['2001:db8::10'], 'aa:bb:cc:11:22:33', 'MAC normalizzato colon-lowercase');
  assert.equal(byIp['fd12:3456::5'], '00:11:22:44:55:66');
});

test('buildNdCandidates: scarta multicast/loopback/unspecified e MAC non-unicast', () => {
  const nd = {
    'aa:bb:cc:dd:ee:ff': ['ff02::1', '::1', '::'],   // nessun indirizzo-host routabile
    'ff:ff:ff:ff:ff:ff': ['2001:db8::99'],           // broadcast MAC
    '01:00:5e:00:00:01': ['2001:db8::a'],            // MAC multicast (bit 0x01)
  };
  assert.deepEqual(buildNdCandidates(nd, {}), []);
});

test('buildNdCandidates: knownMacs e knownIp6 filtrano', () => {
  const nd = { 'aa:bb:cc:00:00:01': ['2001:db8::1'], 'aa:bb:cc:00:00:02': ['2001:db8::2'] };
  const all = buildNdCandidates(nd, {});
  const mac1 = all.find(c => c.ip6 === '2001:db8::1').mac;
  assert.deepEqual(buildNdCandidates(nd, { knownMacs: new Set([mac1]) }).map(c => c.ip6), ['2001:db8::2']);
  assert.deepEqual(buildNdCandidates(nd, { knownIp6: new Set(['2001:db8::1']) }).map(c => c.ip6), ['2001:db8::2']);
});

test('buildNdCandidates: input degeneri → [] (mai throw)', () => {
  assert.deepEqual(buildNdCandidates(null), []);
  assert.deepEqual(buildNdCandidates({}), []);
  assert.deepEqual(buildNdCandidates({ 'aa:bb:cc:00:00:01': [] }), []);
});
