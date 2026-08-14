// Test per l'identità hardware misurata (lib/identity-reconcile.js).
// L'invariante d'onestà, in una riga: una lettura che non dice CHI È l'apparato
// non cancella quello che si sapeva, e quello che si sapeva non accusa nessuno.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  IDENTITY_FIELDS, hasIdentity, isConfirmedMeasure, reconcileInventory,
} = require('../lib/identity-reconcile.js');

const FRESCA = { brand: 'Zyxel', model: 'GS1900-24', serialNumber: 'S123', firmwareVer: 'V2.70', source: 'ENTITY-MIB' };
const AT = '2026-08-14T10:00:00.000Z';

// ── hasIdentity: cosa conta come misura ──────────────────────────────────────

test('hasIdentity: bastano marca/modello/seriale/firmware, uno solo', () => {
  for (const k of IDENTITY_FIELDS) {
    assert.equal(hasIdentity({ [k]: 'x' }), true, k + ' da solo è identità');
  }
});

test('hasIdentity: un guscio senza campi d\'identità NON è una misura', () => {
  // Capita quando l'unica riga ENTITY-MIB sopravvissuta porta solo metadati:
  // trattarla da misura rimetterebbe in scena il bug (una lettura vuota che
  // cancella una buona).
  assert.equal(hasIdentity({ source: 'ENTITY-MIB', entityIndex: 64, entities: [{ index: 64 }] }), false);
  assert.equal(hasIdentity({ brand: '   ' }), false, 'solo spazi non è un valore');
  assert.equal(hasIdentity(null), false);
  assert.equal(hasIdentity([]), false, 'un array non è un inventory');
});

// ── reconcileInventory: i tre stati ──────────────────────────────────────────

test('misura fresca: sostituisce e si data', () => {
  const out = reconcileInventory({ model: 'Stack', stale: true }, FRESCA, AT);
  assert.equal(out.model, 'GS1900-24');
  assert.equal(out.measuredAt, AT);
  assert.ok(!('stale' in out), 'una misura fresca non è mai «ultimo noto»');
});

test('misura fresca: non muta l\'oggetto del driver', () => {
  const fresh = { model: 'X' };
  const out = reconcileInventory(null, fresh, AT);
  assert.notEqual(out, fresh);
  assert.ok(!('measuredAt' in fresh), 'il driver resta pulito');
});

test('IL BUG: una lettura senza identità NON cancella la misura buona', () => {
  const prev = { model: 'GS1900-24', serialNumber: 'S123', measuredAt: '2026-01-01T00:00:00.000Z' };
  const out = reconcileInventory(prev, null, AT);
  assert.equal(out.model, 'GS1900-24', 'quello che si sapeva resta');
  assert.equal(out.serialNumber, 'S123');
  assert.equal(out.stale, true, 'ma marcato «ultimo noto»');
  assert.equal(out.measuredAt, '2026-01-01T00:00:00.000Z', 'la data è quella della MISURA, non del poll');
});

test('degradare non muta l\'oggetto precedente (undo/history al sicuro)', () => {
  const prev = { model: 'GS1900-24' };
  const out = reconcileInventory(prev, null, AT);
  assert.equal(out.stale, true);
  assert.ok(!('stale' in prev), 'lo storico non si riscrive sotto i piedi');
});

test('già degradata: nessun churn, stesso oggetto', () => {
  const prev = { model: 'GS1900-24', stale: true, measuredAt: AT };
  assert.equal(reconcileInventory(prev, null, '2026-09-01T00:00:00.000Z'), prev);
});

test('mai misurata e niente in arrivo → null («non risulta»)', () => {
  assert.equal(reconcileInventory(null, null, AT), null);
  assert.equal(reconcileInventory(undefined, undefined, AT), null);
  assert.equal(reconcileInventory({ source: 'ENTITY-MIB' }, null, AT), null,
    'un guscio precedente non è qualcosa da conservare');
});

test('senza timestamp la misura resta senza data (mai una inventata)', () => {
  const out = reconcileInventory(null, { model: 'X' }, '');
  assert.ok(!('measuredAt' in out));
});

// ── isConfirmedMeasure: chi ha diritto di accusare ───────────────────────────

test('solo una misura riconfermata può accusare', () => {
  assert.equal(isConfirmedMeasure({ model: 'X' }), true);
  assert.equal(isConfirmedMeasure({ model: 'X', stale: true }), false);
  assert.equal(isConfirmedMeasure(null), false);
  assert.equal(isConfirmedMeasure({ source: 'ENTITY-MIB' }), false, 'un guscio non conferma nulla');
});

test('il ciclo completo: troncata, poi riletta bene', () => {
  // 1) prima lettura completa
  let inv = reconcileInventory(null, FRESCA, '2026-01-01T00:00:00.000Z');
  assert.equal(isConfirmedMeasure(inv), true);
  // 2) walk troncata: si tiene, non accusa
  inv = reconcileInventory(inv, null, '2026-02-01T00:00:00.000Z');
  assert.equal(inv.model, 'GS1900-24');
  assert.equal(isConfirmedMeasure(inv), false);
  // 3) lettura di nuovo buona: torna a valere, con la data nuova
  inv = reconcileInventory(inv, { model: 'GS1900-24', serialNumber: 'S999' }, AT);
  assert.equal(isConfirmedMeasure(inv), true);
  assert.equal(inv.serialNumber, 'S999');
  assert.equal(inv.measuredAt, AT);
});
