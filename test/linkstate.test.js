// Test per gli stati link espliciti (lib/linkstate.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkState, AMBIGUOUS_BELOW } = require('../lib/linkstate.js');

test('manuale: link senza autoLinked', () => {
  assert.equal(linkState({ id: 'l1', src: 'a-1', dst: 'b-1' }).key, 'manual');
  assert.equal(linkState({ autoLinked: false }).key, 'manual');
});

test('membro LAG: lagLogicalKey o lagMemberPair', () => {
  assert.equal(linkState({ autoLinked: true, confidence: 0.9, lagLogicalKey: 'sw1||sw2' }).key, 'lag');
  assert.equal(linkState({ autoLinked: true, confidence: 0.5, lagMemberPair: 'x' }).key, 'lag');
});

test('scoperto: vicino dichiarato esplicitamente (LLDP/CDP)', () => {
  // LLDP/CDP: lo switch DICHIARA il vicino - sempre "discovered"
  assert.equal(linkState({ autoLinked: true, confidence: 0.97, protocol: 'LLDP' }).key, 'discovered');
  assert.equal(linkState({ autoLinked: true, confidence: 0.90, protocol: 'CDP' }).key, 'discovered');
  // Case-insensitive
  assert.equal(linkState({ autoLinked: true, confidence: 0.95, protocol: 'lldp' }).key, 'discovered');
});

test('inferito: dedotto dall\'app (MAC/ARP/FDB-SEGMENT)', () => {
  // Tutti i protocolli di inferenza sono "ambiguous" indipendentemente da confidence.
  // Anche MAC score 8/8 (conf 0.92) e' una DEDUZIONE, non una conferma del vicino.
  assert.equal(linkState({ autoLinked: true, confidence: 0.92, protocol: 'MAC' }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: 0.88, protocol: 'MAC' }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: 0.84, protocol: 'MAC' }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: 0.83, protocol: 'MAC' }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: 0.72, protocol: 'MAC' }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: 0.84, protocol: 'MAC-WALLPORT' }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: 0.83, protocol: 'ARP-MAC' }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: 0.70, protocol: 'FDB-SEGMENT' }).key, 'ambiguous');
});

test('legacy: link senza protocol cade sulla soglia AMBIGUOUS_BELOW', () => {
  // Per progetti vecchi salvati senza il campo protocol, fallback sulla soglia.
  assert.equal(linkState({ autoLinked: true, confidence: 0.97 }).key, 'discovered');
  assert.equal(linkState({ autoLinked: true, confidence: 0.5 }).key, 'ambiguous');
  assert.equal(linkState({ autoLinked: true, confidence: AMBIGUOUS_BELOW }).key, 'discovered'); // confine incluso
});

test('campi accessori: confidence/protocol/label riportati', () => {
  const s = linkState({ autoLinked: true, confidence: 0.97, protocol: 'LLDP' });
  assert.equal(s.confidence, 0.97);
  assert.equal(s.protocol, 'LLDP');
  assert.equal(typeof s.label, 'string');
  // auto-link senza confidence numerica -> trattato come scoperto (non ambiguo)
  assert.equal(linkState({ autoLinked: true }).key, 'discovered');
  assert.equal(linkState({ autoLinked: true }).confidence, null);
});

test('GAP1: protocolli fusi LLDP+MAC / CDP+MAC -> discovered (il MAC corrobora)', () => {
  assert.equal(linkState({ autoLinked: true, confidence: 0.99, protocol: 'LLDP+MAC' }).key, 'discovered');
  assert.equal(linkState({ autoLinked: true, confidence: 0.92, protocol: 'CDP+MAC' }).key, 'discovered');
});

test('GAP2: MAC+ARP resta ambiguous (cross-check rafforza, ma resta inferenza)', () => {
  assert.equal(linkState({ autoLinked: true, confidence: 0.90, protocol: 'MAC+ARP' }).key, 'ambiguous');
});
