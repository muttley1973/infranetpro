'use strict';
// Test della logica pura dell'Audit Log (lib/audit-log.js).
const test = require('node:test');
const assert = require('node:assert');
const {
  buildAuditEntry, appendAudit, auditActionLabel,
  formatAuditLine, filterAudit, auditToCsv,
} = require('../lib/audit-log.js');

test('buildAuditEntry: default ts + user=sistema su campi mancanti', () => {
  const e = buildAuditEntry({ action: 'device-add' });
  assert.equal(e.action, 'device-add');
  assert.equal(e.user, 'sistema');
  assert.ok(e.ts && !Number.isNaN(Date.parse(e.ts)));
  assert.equal(e.target, '');
});

test('appendAudit: aggiunge in coda e rispetta il cap (drop dei piu vecchi)', () => {
  let log = [];
  for (let i = 1; i <= 5; i++) appendAudit(log, { user: 'u', action: 'device-add', target: 'N' + i }, 3);
  assert.equal(log.length, 3);
  assert.deepEqual(log.map(e => e.target), ['N3', 'N4', 'N5']); // i 2 piu vecchi scartati
});

test('appendAudit: cap di default quando non specificato', () => {
  const log = [];
  appendAudit(log, { action: 'snmp-sync' });
  assert.equal(log.length, 1);
});

test('auditActionLabel: chiave nota → etichetta IT, ignota → fallback', () => {
  assert.equal(auditActionLabel('cable-add'), 'Cavo creato');
  assert.equal(auditActionLabel('roba-strana'), 'roba-strana');
});

test('auditActionLabel: lang=en → etichetta EN; default resta IT (retrocompat)', () => {
  assert.equal(auditActionLabel('cable-add', 'en'), 'Cable created');
  assert.equal(auditActionLabel('device-add', 'en'), 'Device added');
  assert.equal(auditActionLabel('cable-add'), 'Cavo creato');       // nessun lang → IT
  assert.equal(auditActionLabel('roba-strana', 'en'), 'roba-strana'); // fallback = azione grezza
});

test('formatAuditLine: include utente, azione, target e dettaglio', () => {
  const s = formatAuditLine({ ts: '2026-06-12T08:30:00.000Z', user: 'mario', action: 'device-add', target: 'Core-01', summary: 'switch' });
  assert.match(s, /mario/);
  assert.match(s, /Dispositivo aggiunto/);
  assert.match(s, /«Core-01»/);
  assert.match(s, /switch/);
});

test('filterAudit: per action, per target (substring), e since', () => {
  const log = [
    { ts: '2026-06-01T10:00:00Z', user: 'a', action: 'device-add', target: 'Core-01' },
    { ts: '2026-06-05T10:00:00Z', user: 'b', action: 'cable-add', target: 'Core-01 P1' },
    { ts: '2026-06-10T10:00:00Z', user: 'c', action: 'device-add', target: 'Edge-02' },
  ];
  assert.equal(filterAudit(log, { action: 'device-add' }).length, 2);
  assert.equal(filterAudit(log, { target: 'core-01' }).length, 2);   // case-insensitive substring
  assert.equal(filterAudit(log, { since: '2026-06-06T00:00:00Z' }).length, 1);
});

test('auditToCsv: header, BOM, escaping di virgole e virgolette', () => {
  const csv = auditToCsv([{ ts: '2026-06-12T08:30:00Z', user: 'mario', action: 'device-rename', target: 'A, B', summary: 'da "X" a "Y"' }]);
  assert.ok(csv.startsWith('﻿'));                       // BOM UTF-8
  assert.match(csv, /data_ora,utente,azione,oggetto,dettaglio/);
  assert.match(csv, /"A, B"/);                                // virgola → quotato
  assert.match(csv, /"da ""X"" a ""Y"""/);                    // virgolette raddoppiate
  assert.match(csv, /Dispositivo rinominato/);                // azione tradotta
});
