'use strict';
// ============================================================
//  test/subbar-stats.test.js — lib/subbar-stats.js (statistiche sotto-header).
//
//  Verifica che i tre numeri (documentazione %, device totali, salute SNMP)
//  escano SOLO dai campi reali del nodo, con le stesse definizioni del resto
//  dell'app, senza stime: strutturali esclusi, indirizzabili/withIp, "ha SNMP"
//  (driver snmp* + host|ip), snmpStatus==='ok', e gli stati di salute.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { computeSubbarStats, _hasSnmp } = require('../lib/subbar-stats.js');

// Mini-catalogo TYPES sufficiente ai test (struttura come src/app-types.js).
const TYPES = {
  switch: { hasIP: true },
  pc:     { hasIP: true },
  ups:    { hasIP: true },
  wallport:  { isPassive: true },          // niente hasIP -> non indirizzabile
  patchpanel:{ isPassive: true },
  room:   { isStructural: true },          // strutturale -> non e' un device
};

test('input vuoto/assurdo -> tutto a zero, mai throw', () => {
  for (const bad of [undefined, null, 42, {}, 'x']) {
    const s = computeSubbarStats(bad, TYPES);
    assert.deepEqual(
      { d: s.devices, a: s.addressable, w: s.withIp, doc: s.docPct, health: s.snmpHealth },
      { d: 0, a: 0, w: 0, doc: null, health: 'none' }
    );
  }
});

test('gli elementi strutturali (stanze) non contano come device', () => {
  const s = computeSubbarStats([{ type: 'room' }, { type: 'room' }, { type: 'pc', ip: '10.0.0.5' }], TYPES);
  assert.equal(s.devices, 1, 'solo il PC e\' un device');
  assert.equal(s.addressable, 1);
  assert.equal(s.withIp, 1);
});

test('documentazione % = withIp / indirizzabili (passivi esclusi dal denominatore)', () => {
  const nodes = [
    { type: 'switch', ip: '10.0.0.1' },   // indirizzabile + IP
    { type: 'pc',     ip: '10.0.0.2' },   // indirizzabile + IP
    { type: 'pc' },                       // indirizzabile SENZA IP
    { type: 'ups' },                      // indirizzabile SENZA IP
    { type: 'wallport' },                 // passivo: NON indirizzabile, fuori dal calcolo
    { type: 'patchpanel' },               // passivo: idem
  ];
  const s = computeSubbarStats(nodes, TYPES);
  assert.equal(s.devices, 6, 'tutti e 6 sono device (nessuno strutturale)');
  assert.equal(s.addressable, 4, 'switch+pc+pc+ups');
  assert.equal(s.withIp, 2);
  assert.equal(s.docPct, 50, '2/4 = 50%');
});

test('nessun device indirizzabile -> docPct null (niente 0% fuorviante)', () => {
  const s = computeSubbarStats([{ type: 'wallport' }, { type: 'patchpanel' }], TYPES);
  assert.equal(s.addressable, 0);
  assert.equal(s.docPct, null);
});

test('"ha SNMP" = driver snmp* + host|ip; altrimenti non conta', () => {
  assert.equal(_hasSnmp({ integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }), true);
  assert.equal(_hasSnmp({ integration: { driver: 'snmp-v3' }, ip: '10.0.0.2' }), true, 'ip come fallback host');
  assert.equal(_hasSnmp({ integration: { driver: 'snmp-v2c' } }), false, 'niente host/ip -> no');
  assert.equal(_hasSnmp({ integration: { driver: 'http' }, ip: '10.0.0.3' }), false, 'driver non snmp -> no');
  assert.equal(_hasSnmp({ ip: '10.0.0.4' }), false, 'nessuna integrazione -> no');
});

test('salute SNMP: none / ok / warn / err in base ai responder', () => {
  const snmp = (driver, status) => ({ type: 'switch', integration: { driver, host: '10.0.0.1' }, snmpStatus: status });

  // nessun device SNMP configurato
  assert.equal(computeSubbarStats([{ type: 'pc', ip: '1.1.1.1' }], TYPES).snmpHealth, 'none');

  // tutti ok
  let s = computeSubbarStats([snmp('snmp-v2c', 'ok'), snmp('snmp-v2c', 'ok')], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpHealth], [2, 2, 'ok']);

  // misto (uno su, uno giu') -> warn
  s = computeSubbarStats([snmp('snmp-v2c', 'ok'), snmp('snmp-v2c', 'err')], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpDown, s.snmpHealth], [2, 1, 1, 'warn']);

  // nessuno su + almeno un guasto REALE -> err (rosso)
  s = computeSubbarStats([snmp('snmp-v2c', 'err'), snmp('snmp-v2c', 'err')], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpDown, s.snmpHealth], [2, 0, 2, 'err']);

  // configurati ma MAI sondati (snmpStatus assente) -> warn (ambra), NON rosso:
  // "non ancora verificato" non e' "guasto" (niente rosso a sproposito).
  s = computeSubbarStats([snmp('snmp-v2c', undefined), snmp('snmp-v2c', undefined)], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpDown, s.snmpHealth], [2, 0, 0, 'warn']);
});

test('catalogo TYPES assente -> difensivo (nessun crash, niente indirizzabili)', () => {
  const s = computeSubbarStats([{ type: 'pc', ip: '10.0.0.9' }], undefined);
  assert.equal(s.devices, 1);
  assert.equal(s.addressable, 0, 'senza TYPES non sappiamo chi e\' indirizzabile');
  assert.equal(s.docPct, null);
});
