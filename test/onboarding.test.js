'use strict';
// ============================================================
//  test/onboarding.test.js — lib/onboarding.js (copilota onboarding, §4d).
//
//  Verifica le REGOLE DETERMINISTICHE del «prossimo passo»: priorità, target del
//  bottone reale da illuminare, domanda da seminare, robustezza agli input monchi.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { nextStep } = require('../lib/onboarding.js');

test('rete vuota → Scopri (illumina #btn-discover)', () => {
  const s = nextStep({ devices: 0 });
  assert.equal(s.id, 'discover');
  assert.equal(s.target, '#btn-discover');
  assert.equal(s.askKey, null, 'lo step discover non semina domande (è un bottone)');
});

test('input mancante/assurdo → trattato come rete vuota (mai throw)', () => {
  assert.equal(nextStep().id, 'discover');
  assert.equal(nextStep(null).id, 'discover');
  assert.equal(nextStep({ devices: -3 }).id, 'discover');
  assert.equal(nextStep({ devices: 'x' }).id, 'discover');
});

test('documentata ma non verificata → Verifica (illumina #btn-drift) + conteggio', () => {
  const s = nextStep({ devices: 12, verified: false });
  assert.equal(s.id, 'verify');
  assert.equal(s.target, '#btn-drift');
  assert.equal(s.data.devices, 12);
});

test('verificata ma VLAN senza subnet → semina domanda (no bottone)', () => {
  const s = nextStep({ devices: 12, verified: true, gaps: { noSubnet: 2 } });
  assert.equal(s.id, 'vlanSubnet');
  assert.equal(s.target, null);
  assert.equal(s.askKey, 'onboard.askVlanSubnet');
  assert.equal(s.data.n, 2);
});

test('priorità: subnet mancante vince su gateway mancante', () => {
  const s = nextStep({ devices: 5, verified: true, gaps: { noSubnet: 1, noGateway: 3 } });
  assert.equal(s.id, 'vlanSubnet');
});

test('VLAN senza gateway (subnet ok) → semina domanda gateway', () => {
  const s = nextStep({ devices: 5, verified: true, gaps: { noGateway: 3 } });
  assert.equal(s.id, 'vlanGateway');
  assert.equal(s.askKey, 'onboard.askVlanGateway');
  assert.equal(s.data.n, 3);
});

test('non-documentati → proponi adozione', () => {
  const s = nextStep({ devices: 20, verified: true, drift: { undocumented: 4 } });
  assert.equal(s.id, 'adopt');
  assert.equal(s.askKey, 'onboard.askAdopt');
  assert.equal(s.data.n, 4);
});

test('priorità: buchi VLAN vincono sui non-documentati', () => {
  const s = nextStep({ devices: 20, verified: true, gaps: { noGateway: 1 }, drift: { undocumented: 9 } });
  assert.equal(s.id, 'vlanGateway');
});

test('device assenti → semina domanda assenza', () => {
  const s = nextStep({ devices: 8, verified: true, drift: { absent: 2 } });
  assert.equal(s.id, 'absent');
  assert.equal(s.data.n, 2);
});

test('cambi IP (nient\'altro aperto) → semina domanda cambio IP', () => {
  const s = nextStep({ devices: 8, verified: true, drift: { ipChanged: 1 } });
  assert.equal(s.id, 'ipChanged');
  assert.equal(s.data.n, 1);
});

test('device SNMP in errore → snmpDown (solo informativo, niente bottone) + conteggio', () => {
  const s = nextStep({ devices: 11, verified: true, snmpDown: 8 });
  assert.equal(s.id, 'snmpDown');
  assert.equal(s.target, null, 'niente bottone: il testo dice già cosa fare');
  assert.equal(s.askKey, null);
  assert.equal(s.data.n, 8);
});

test('priorità: mai-verificata vince su snmpDown (prima la Verifica)', () => {
  const s = nextStep({ devices: 11, verified: false, snmpDown: 8 });
  assert.equal(s.id, 'verify');
});

test('priorità: snmpDown vince su buchi VLAN e drift (prima la realtà operativa)', () => {
  const s = nextStep({
    devices: 11, verified: true, snmpDown: 3,
    gaps: { noSubnet: 2, noGateway: 1 },
    drift: { undocumented: 4, absent: 2, ipChanged: 1 },
  });
  assert.equal(s.id, 'snmpDown');
});

test('device su subnet non raggiunte → unverified (semina domanda)', () => {
  const s = nextStep({ devices: 10, verified: true, drift: { unverified: 4 } });
  assert.equal(s.id, 'unverified');
  assert.equal(s.target, null);
  assert.equal(s.askKey, 'onboard.askUnverified');
  assert.equal(s.data.n, 4);
});

test('priorità: snmpDown vince su unverified; unverified vince sui buchi VLAN', () => {
  assert.equal(nextStep({ devices: 10, verified: true, snmpDown: 2, drift: { unverified: 4 } }).id, 'snmpDown');
  assert.equal(nextStep({ devices: 10, verified: true, drift: { unverified: 4 }, gaps: { noSubnet: 1 } }).id, 'unverified');
});

test('porte doc ≠ realtà SNMP → portConflicts (ultima prima di allGood)', () => {
  const s = nextStep({ devices: 10, verified: true, portConflicts: 3 });
  assert.equal(s.id, 'portConflicts');
  assert.equal(s.askKey, 'onboard.askPortConflicts');
  assert.equal(s.data.n, 3);
});

test('priorità: cambi IP vincono su portConflicts; senza conflitti → allGood', () => {
  assert.equal(nextStep({ devices: 10, verified: true, portConflicts: 3, drift: { ipChanged: 1 } }).id, 'ipChanged');
  assert.equal(nextStep({ devices: 10, verified: true, portConflicts: 0 }).id, 'allGood');
});

test('snmpDown assurdo/zero → non scatta (robustezza)', () => {
  assert.equal(nextStep({ devices: 5, verified: true, snmpDown: 0 }).id, 'allGood');
  assert.equal(nextStep({ devices: 5, verified: true, snmpDown: 'x' }).id, 'allGood');
  assert.equal(nextStep({ devices: 5, verified: true, snmpDown: -2 }).id, 'allGood');
});

test('tutto a posto → allGood (nessuna azione)', () => {
  const s = nextStep({ devices: 30, verified: true, drift: { absent: 0, undocumented: 0, ipChanged: 0 }, gaps: {} });
  assert.equal(s.id, 'allGood');
  assert.equal(s.target, null);
  assert.equal(s.askKey, null);
});

test('drift conteggi: assenti vincono su cambi IP', () => {
  const s = nextStep({ devices: 10, verified: true, drift: { absent: 1, ipChanged: 5 } });
  assert.equal(s.id, 'absent');
});
