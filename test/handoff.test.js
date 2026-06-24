'use strict';
// Test della logica pura del Dossier di consegna (lib/handoff.js).
const test = require('node:test');
const assert = require('node:assert');
const { buildHandoffSections } = require('../lib/handoff.js');

test('cover: conteggi device (esclusi gli strutturali) + cavi/vlan + default title', () => {
  const r = buildHandoffSections({
    project: 'Rete X', date: '12/06/2026', user: 'mario',
    devices: [
      { name: 'Core-01', typeLabel: 'Switch', structural: false },
      { name: 'Stanza', typeLabel: 'Stanza', structural: true },   // escluso
      { name: 'AP-07', typeLabel: 'Access Point', structural: false },
    ],
    cableCount: 5, vlanCount: 3,
  });
  assert.equal(r.cover.title, 'Dossier di consegna');
  assert.equal(r.cover.project, 'Rete X');
  assert.equal(r.cover.user, 'mario');
  assert.equal(r.cover.deviceCount, 2);   // strutturale non contato
  assert.equal(r.cover.cableCount, 5);
  assert.equal(r.cover.vlanCount, 3);
});

test('note: solo device con testo non vuoto, ordinate per nome', () => {
  const r = buildHandoffSections({
    devices: [
      { name: 'Zeta', notes: 'spegnere di notte', structural: false },
      { name: 'Alfa', notes: '  ', structural: false },         // vuota → esclusa
      { name: 'Beta', notes: 'VLAN 99 isolata GDPR', structural: false },
      { name: 'Sala', notes: 'qualcosa', structural: true },     // strutturale → escluso
    ],
  });
  assert.equal(r.notes.length, 2);
  assert.deepEqual(r.notes.map(n => n.label), ['Beta', 'Zeta']);   // ordinate
  assert.equal(r.notes[0].text, 'VLAN 99 isolata GDPR');
});

test('changelog: ultime N voci dalla più recente', () => {
  const log = [];
  for (let i = 1; i <= 60; i++) log.push({ ts: `2026-06-${String(i % 28 + 1).padStart(2, '0')}T10:00:00Z`, user: 'u', action: 'device-add', target: 'N' + i });
  const r = buildHandoffSections({ devices: [], auditLog: log, changelogLimit: 50 });
  assert.equal(r.changelog.length, 50);                 // capped
  assert.equal(r.changelog[0].target, 'N60');           // più recente in cima
  assert.equal(r.changelog[49].target, 'N11');          // 60-50+1
});

test('changelog: limit di default 50; meno voci → tutte', () => {
  const log = [{ ts: '2026-06-01T10:00:00Z', user: 'u', action: 'snmp-sync', target: 'x' }];
  const r = buildHandoffSections({ devices: [], auditLog: log });
  assert.equal(r.changelog.length, 1);
});

test('input vuoto → struttura valida con default', () => {
  const r = buildHandoffSections({});
  assert.equal(r.cover.deviceCount, 0);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.changelog, []);
});
