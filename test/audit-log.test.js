'use strict';
// Test della logica pura dell'Audit Log (lib/audit-log.js).
const test = require('node:test');
const assert = require('node:assert');
const {
  buildAuditEntry, appendAudit, auditActionLabel,
  formatAuditLine, filterAudit, auditToCsv,
  foldAudit, stripAudit, mergeAudit, AUDIT_CAP_DEFAULT,
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


// ============================================================
// Il GIORNALE vive fuori dal documento (history/<id>/audit.json).
// ⚠️ Non è una misura: la regola di fusione è l'UNIONE, non «vince il più fresco».
// ============================================================
const E = (over) => Object.assign({
  ts: '2026-08-12T09:00:00.000Z', user: 'admin', action: 'device-add',
  target: 'A-35', summary: 'Presa a muro',
}, over || {});

test('⚠️ fold IDEMPOTENTE: risalvare lo stesso stato non raddoppia il giornale', () => {
  // Il client rimanda SEMPRE l'elenco intero a ogni Salva: senza dedup, due
  // salvataggi di fila darebbero due volte la stessa riga nella Storia modifiche.
  const uno = foldAudit(null, [E()]);
  const due = foldAudit(uno, [E()]);
  const tre = foldAudit(due, uno);
  assert.equal(uno.entries.length, 1);
  assert.equal(due.entries.length, 1);
  assert.equal(tre.entries.length, 1);
});

test('⚠️ fold UNIONE: non perde né le voci su disco né quelle nuove', () => {
  const suDisco = [E({ ts: '2026-08-10T08:00:00.000Z', summary: 'vecchia' })];
  const nuove = [E({ ts: '2026-08-10T08:00:00.000Z', summary: 'vecchia' }),
                 E({ ts: '2026-08-12T10:00:00.000Z', summary: 'nuova' })];
  const { entries } = foldAudit(suDisco, nuove);
  assert.equal(entries.length, 2, 'la comune conta una volta sola');
  assert.deepEqual(entries.map(e => e.summary), ['vecchia', 'nuova'], 'ordine cronologico');
});

test('fold: ordina per data e a parità di istante non rimescola', () => {
  const a = E({ ts: '2026-08-12T09:00:00.000Z', summary: 'prima' });
  const b = E({ ts: '2026-08-12T09:00:00.000Z', summary: 'poi' });
  const { entries } = foldAudit([a, b], []);
  assert.deepEqual(entries.map(e => e.summary), ['prima', 'poi'], 'sort stabile');
  const misto = foldAudit([E({ ts: '2026-08-12T11:00:00.000Z', summary: 'tardi' })],
                          [E({ ts: '2026-08-12T07:00:00.000Z', summary: 'presto' })]);
  assert.deepEqual(misto.entries.map(e => e.summary), ['presto', 'tardi']);
});

test('⚠️ il tetto tiene le voci PIÙ RECENTI, non le prime', () => {
  const molte = [];
  for (let i = 0; i < 12; i++) molte.push(E({ ts: '2026-08-12T09:' + String(i).padStart(2, '0') + ':00.000Z', summary: 'n' + i }));
  const { entries } = foldAudit(null, molte, 5);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map(e => e.summary), ['n7', 'n8', 'n9', 'n10', 'n11']);
});

test('fold difensivo: nulli, non-array, voci senza azione', () => {
  assert.deepEqual(foldAudit(null, null), { entries: [] });
  assert.deepEqual(foldAudit({ entries: 'no' }, undefined), { entries: [] });
  assert.deepEqual(foldAudit(null, [null, 'x', {}]), { entries: [] }, 'senza action non dice niente');
  assert.equal(foldAudit({ entries: [E()] }, null).entries.length, 1, 'accetta la forma { entries }');
});

test('merge rimette il giornale nello stato, strip lo toglie', () => {
  const state = { nodes: [{ id: 'sw1', name: 'Core' }], auditLog: [E({ summary: 'dal documento' })] };
  assert.equal(mergeAudit(state, null), 1, 'quelle del documento non si perdono');
  assert.equal(mergeAudit(state, { entries: [E({ ts: '2026-08-12T12:00:00.000Z', summary: 'dal sidecar' })] }), 2);
  assert.equal(stripAudit(state), 2);
  assert.equal('auditLog' in state, false);
  assert.equal(state.nodes[0].name, 'Core', 'il documento non si tocca');
  assert.equal(stripAudit(state), 0, 'idempotente');
  assert.equal(stripAudit(null), 0);
  assert.equal(mergeAudit(null, { entries: [E()] }), 0);
});

// ── Aggancio alla route e all'export ─────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const R_PROJECTS = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'projects.js'), 'utf8');
const FORMAT = fs.readFileSync(path.join(__dirname, '..', 'lib', 'project-format.js'), 'utf8');

test('⚠️ il Salva fa confluire il giornale PRIMA di scrivere il progetto', () => {
  assert.match(R_PROJECTS, /_auditOutOfDocument\(id, state\);/);
  assert.ok(R_PROJECTS.indexOf('_auditOutOfDocument(id, state);') <
            R_PROJECTS.indexOf('saveProject(id, name, state, p.created_at, now)'),
    'prima nel sidecar, poi il documento');
  assert.match(R_PROJECTS, /mergeAudit\(p\.state, _history\.readAudit\(id\)\)/, 'la GET lo rimette');
  assert.match(R_PROJECTS, /stripAudit\(state\);/, 'progetto NUOVO: la storia di un altro impianto non entra');
  assert.match(R_PROJECTS, /stripAudit\(src\.state\);/, 'la copia inizia la sua storia adesso');
});

test('⚠️ l\'export non porta il giornale: contiene gli username di chi ci lavora', () => {
  assert.match(FORMAT, /delete out\.auditLog;/);
});

// ── Il tetto: un numero solo, in un posto solo ───────────────────────
const HISTORY = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-history.js'), 'utf8');
const AUDIT_UI = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-audit.js'), 'utf8');

test('⚠️ il tetto è definito UNA volta: chi appende non porta il suo numero', () => {
  // Il bug: qui c'era `appendAudit(..., 1000)`, cioè una seconda definizione
  // dello stesso tetto — e vinceva lei, quindi alzarlo nella lib non faceva
  // niente. Famiglia dei doppioni motore/renderer.
  const call = HISTORY.match(/appendAudit\([^)]*\)/);
  assert.ok(call, 'logAudit deve ancora appendere');
  assert.doesNotMatch(call[0], /\d{3,}/, 'nessun tetto scritto a mano: lo decide AUDIT_CAP_DEFAULT');
});

test('il tetto vale 10.000 voci, e il fold ci si appoggia', () => {
  assert.equal(AUDIT_CAP_DEFAULT, 10000);
  const log = [];
  appendAudit(log, { action: 'snmp-sync' });
  assert.equal(log.length, 1, 'senza cap esplicito usa il default');
});

test('⚠️ la lista non disegna 10.000 righe: finestra + avviso di quante restano', () => {
  assert.match(AUDIT_UI, /_AUDIT_VIEW_MAX\s*=\s*\d+/, 'la finestra di rendering è dichiarata');
  assert.match(AUDIT_UI, /rows\.slice\(0, _AUDIT_VIEW_MAX\)/, 'si disegna solo la finestra');
  assert.match(AUDIT_UI, /audit\.capped/, 'e si dice quante ne restano fuori');
  const max = Number(AUDIT_UI.match(/_AUDIT_VIEW_MAX\s*=\s*(\d+)/)[1]);
  assert.ok(max < AUDIT_CAP_DEFAULT, 'la finestra sta sotto il tetto dei dati, altrimenti non serve');
});
