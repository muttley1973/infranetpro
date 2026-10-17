'use strict';
// Un Catalyst vecchio non si chiama «Catalyst» nel suo sysDescr: dice «C2950 Software». Con
// sysServices 6 (L2+L3 — lo dichiarano anche gli switch che non instradano) cadeva sul fallback
// «router»: uno switch d'accesso classificato router. Misurato sul banco con la registrazione di
// un Catalyst 2950 (sysObjectID 1.3.6.1.4.1.9.1.359).
const test = require('node:test');
const assert = require('node:assert/strict');
const cisco = require('../plugins/cisco.js');
const { SWITCH_WORDS_RE } = require('../lib/device-patterns.js');

const tipo = (oid, descr, svc) => cisco.enrich(oid, { descr, hostname: '', sysServices: svc }).deviceType;

test('Catalyst 2950: l\'OID noto lo dice switch con la famiglia giusta', () => {
  const r = cisco.enrich('1.3.6.1.4.1.9.1.359', { descr: 'Cisco Internetwork Operating System Software IOS (tm) C2950 Software', sysServices: 6 });
  assert.equal(r.deviceType, 'switch');
  assert.equal(r.family, 'Catalyst 2950');
  assert.equal(r.confidence, 96, 'riconosciuto dall\'OID, non indovinato');
});

test('modello sconosciuto: il CODICE nel sysDescr basta, anche con sysServices 6', () => {
  for (const descr of [
    'Cisco IOS Software, C2950 Software (C2950-I6K2L2Q4-M), Version 12.1(22)EA14',
    'Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E',
    'Cisco IOS Software, C3560 Software (C3560-IPSERVICESK9-M)',
    'Cisco IOS Software, C3750 Software (C3750-IPSERVICESK9-M)',
    'Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT9K_IOSXE)',
    'Cisco IOS Software, C9300 Software (CAT9K_IOSXE), Version 16.9.4',
    'Cisco IOS Software, WS-C2960X-24PS-L',
  ]) assert.equal(tipo('1.3.6.1.4.1.9.1.99999', descr, 6), 'switch', descr);
});

test('i codici di ROUTER e di CONTROLLER non diventano switch', () => {
  assert.equal(tipo('1.3.6.1.4.1.9.1.99999', 'Cisco IOS Software, 3700 Software (C3725-ADVENTERPRISEK9-M), Version 12.4', 6), 'router');
  assert.equal(tipo('1.3.6.1.4.1.9.1.99999', 'Cisco IOS Software, C3640 Software (C3640-JK9S-M)', 6), 'router');
  assert.equal(tipo('1.3.6.1.4.1.9.1.99999', 'Cisco IOS Software, ISR Software (X86_64_LINUX_IOSD-UNIVERSALK9-M), C8300', 6), 'router');
  assert.equal(tipo('1.3.6.1.4.1.9.1.99999', 'Cisco Controller, C9800-CL', 6), 'wlanctrl');
});

test('lo stesso criterio nel classificatore generico (device-patterns)', () => {
  for (const s of ['cisco ios software, c2950 software (c2950-i6k2l2q4-m)', 'ws-c2960x-24ps-l', 'cisco c3850 software', 'c9300-24p']) {
    assert.match(s, SWITCH_WORDS_RE, s);
  }
  for (const s of ['cisco ios software, c3725 software', 'c3640', 'cisco c9800-cl controller', 'cisco 2901 isr']) {
    assert.doesNotMatch(s, SWITCH_WORDS_RE, s);
  }
});
