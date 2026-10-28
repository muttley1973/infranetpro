'use strict';
// ============================================================
//  test/snmp-target.test.js — lib/snmp-target.js («si interroga con SNMP?»)
//
//  La domanda era scritta a mano in una dozzina di punti, e due di loro
//  rispondevano in modo diverso allo stesso apparato: il conteggio della
//  sotto-header non faceva la minuscola (`SNMP-V2C` → «0 apparati SNMP») mentre
//  l'API v1 sì (`snmp: true`), e con un host di soli spazi l'API ripiegava
//  sull'IP del nodo mentre l'app e il poller no. Qui si prova la definizione, e
//  che chi la usa dia la stessa risposta a un apparato (la guardia che vieta di
//  riscriverla è test/snmp-target-unica-definizione.test.js).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { isSnmpDriver, hasSnmpDriver, snmpTargetHost, hasSnmpTarget } = require('../lib/snmp-target.js');
const { _hasSnmp: subbarHasSnmp } = require('../lib/subbar-stats.js');
const { nodeToDevice } = require('../lib/api-shape.js');
const { snmpSilence } = require('../lib/snmp-silence.js');

test('isSnmpDriver: i driver SNMP, in qualunque maiuscola e con gli spazi; nient\'altro', () => {
  for (const d of ['snmp-v1', 'snmp-v2c', 'snmp-v3', 'SNMP-V2C', ' snmp-v3 ']) assert.equal(isSnmpDriver(d), true, JSON.stringify(d));
  for (const d of ['http', 'ssh', '', '   ', null, undefined, 0, 'xsnmp']) assert.equal(isSnmpDriver(d), false, JSON.stringify(d));
});

test('hasSnmpDriver: guarda solo il driver, con o senza indirizzo', () => {
  assert.equal(hasSnmpDriver({ integration: { driver: 'snmp-v2c' } }), true);
  assert.equal(hasSnmpDriver({ integration: { driver: 'http' }, ip: '10.0.0.1' }), false);
  assert.equal(hasSnmpDriver({ ip: '10.0.0.1' }), false);
  assert.equal(hasSnmpDriver(null), false);
});

test('snmpTargetHost: integration.host, altrimenti l\'IP del nodo, tagliati; vuoto se non c\'e\' niente', () => {
  assert.equal(snmpTargetHost({ ip: '10.0.0.9', integration: { host: ' 10.0.0.1 ' } }), '10.0.0.1');
  assert.equal(snmpTargetHost({ ip: ' 10.0.0.9 ', integration: {} }), '10.0.0.9');
  assert.equal(snmpTargetHost({ integration: {} }), '');
  assert.equal(snmpTargetHost(null), '');
  // un `ip` risolto dal chiamante vale al posto dell'IP del nodo, ma mai al posto dell'host scritto
  assert.equal(snmpTargetHost({ ip: '10.0.0.9', integration: {} }, '10.0.0.5'), '10.0.0.5');
  assert.equal(snmpTargetHost({ integration: { host: 'sw1' } }, '10.0.0.5'), 'sw1');
});

test('hasSnmpTarget: driver SNMP E un indirizzo; e\' vero se e solo se il poller avrebbe un host', () => {
  const casi = [
    [{ integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }, true],
    [{ ip: '10.0.0.2', integration: { driver: 'snmp-v3' } }, true],
    [{ integration: { driver: 'snmp-v2c' } }, false],
    [{ ip: '10.0.0.3', integration: { driver: 'http' } }, false],
    [{ ip: '10.0.0.4' }, false],
    [null, false],
  ];
  for (const [n, atteso] of casi) {
    assert.equal(hasSnmpTarget(n), atteso, JSON.stringify(n));
    // l'invariante che tiene insieme il filtro e il poller: «interrogabile» == driver SNMP + host non vuoto
    assert.equal(hasSnmpTarget(n), hasSnmpDriver(n) && snmpTargetHost(n) !== '');
  }
});

test('hasSnmpTarget passata a .filter non scambia l\'indice per un indirizzo', () => {
  const nodi = [{ integration: { driver: 'snmp-v2c' } }, { integration: { driver: 'snmp-v2c' } }, { integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }];
  assert.deepEqual(nodi.filter(hasSnmpTarget).length, 1);
});

// ── chi la usa risponde come lei ─────────────────────────────────────────────
const CASI = [
  ['driver minuscolo + host', { integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }, true],
  ['driver MAIUSCOLO + host', { integration: { driver: 'SNMP-V2C', host: '10.0.0.1' } }, true],
  ['driver con spazi, IP sul nodo', { ip: '10.0.0.2', integration: { driver: ' snmp-v3 ' } }, true],
  ['host di soli spazi: il poller non ha un indirizzo', { ip: '10.0.0.3', integration: { driver: 'snmp-v2c', host: '   ' } }, false],
  ['nessun indirizzo', { integration: { driver: 'snmp-v2c' } }, false],
  ['driver non SNMP', { ip: '10.0.0.4', integration: { driver: 'http' } }, false],
  ['nessuna integrazione', { ip: '10.0.0.5' }, false],
];

test('la sotto-header e l\'API v1 dicono la stessa cosa dello stesso apparato', () => {
  CASI.forEach(([etichetta, n, atteso], i) => {
    const nodo = Object.assign({ id: 'n' + i, type: 'switch' }, n);
    assert.equal(subbarHasSnmp(nodo), atteso, 'sotto-header: ' + etichetta);
    assert.equal(nodeToDevice(nodo, {}).snmp, atteso, 'API v1: ' + etichetta);
  });
});

test('«silenziosa alla chiave»: il driver documentato conta in qualunque maiuscola', () => {
  const riga = { alive: true };
  assert.deepEqual(snmpSilence(riga, { documentedDriver: 'SNMP-V2C' }), { why: 'declared' });
  assert.deepEqual(snmpSilence(riga, { documentedDriver: ' snmp-v3 ' }), { why: 'declared' });
  assert.equal(snmpSilence(riga, { documentedDriver: 'http' }), null);
});
