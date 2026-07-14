'use strict';
// Catalogo device-type NATIVO: il file committato è ben formato e i suoi campi
// frontPanel producono lo split SFP/MGMT esatto tramite lib/frontpanel.js (lo
// stesso motore del renderer di default). Guarda il valore vero della feature
// "Applica modello": i template pilotano il render nativo, look esatto.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { frontPanelState } = require('../lib/frontpanel');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'device-types.json'), 'utf8'));

test('device-types.json: catalogo ben formato', () => {
  assert.ok(Array.isArray(catalog) && catalog.length > 0, 'array non vuoto');
  for (const c of catalog) {
    assert.equal(typeof c.slug, 'string');
    assert.equal(typeof c.brand, 'string');
    assert.equal(typeof c.ports, 'number');
    assert.ok(c.ports >= 0);
    assert.equal(typeof c.frontPanel, 'object');
    assert.ok(c.counts && typeof c.counts.sfp === 'number');
  }
});

test('frontPanel deriva lo split SFP/MGMT dai campi template (tutti i modelli)', () => {
  for (const c of catalog) {
    const s = frontPanelState({ type: 'switch', ports: c.ports, frontPanel: c.frontPanel }, c.ports, true);
    assert.equal(s.sfpCount, Math.min(48, c.counts.sfp), c.model + ' sfp');
    assert.equal(s.sfp2Count || 0, Math.min(48, c.counts.qsfp), c.model + ' sfp2');
    assert.equal(s.mgmtCount || 0, Math.min(4, c.counts.mgmt), c.model + ' mgmt');
  }
});

// INVARIANTE CARDINE: il rame IMPLICITO dal renderer (ports - sfpBlocchi) deve
// combaciare col rame REALE. Se no, una porta fibra verrebbe disegnata come rame
// (bug segnalato: Aruba 6300M-24SFPP-4SFP56 rendeva 4 rame + 24 SFP).
test('nessuna fibra resa come rame (rame implicito == rame reale, tutti i modelli)', () => {
  for (const c of catalog) {
    const s = frontPanelState({ type: 'switch', ports: c.ports, frontPanel: c.frontPanel }, c.ports, true);
    const impliedCopper = c.ports - s.sfpCount - (s.sfp2Count || 0);
    assert.equal(impliedCopper, c.counts.copper, c.model + ' rame implicito != reale');
  }
});

// Caso del bug: 24x SFP+ (blocco1) + 4x SFP56 (blocco2), ZERO rame.
test('Aruba 6300M-24SFPP-4SFP56: 24 SFP (blk1) + 4 SFP56 (blk2), 0 rame', () => {
  const c = catalog.find(x => /6300M-24SFPP-4SFP56/.test(x.model));
  if (!c) return;
  assert.equal(c.counts.copper, 0, 'zero rame');
  const s = frontPanelState({ type: 'switch', ports: c.ports, frontPanel: c.frontPanel }, c.ports, true);
  assert.equal(s.sfpCount, 24, 'blocco1 = 24 SFP+');
  assert.equal(s.sfp2Count, 4, 'blocco2 = 4 SFP56');
  assert.equal(c.ports - s.sfpCount - (s.sfp2Count || 0), 0, '0 rame implicito');
});

test('CRS354-48G-4S+2Q+RM: 48 rame + 4 SFP + 2 QSFP + 1 MGMT', () => {
  const c = catalog.find(x => /CRS354-48G-4S/.test(x.model));
  assert.ok(c, 'CRS354 presente nel catalogo');
  assert.equal(c.ports, 54);
  const s = frontPanelState({ type: 'switch', ports: c.ports, frontPanel: c.frontPanel }, c.ports, true);
  assert.equal(s.sfpCount, 4);
  assert.equal(s.sfp2Count, 2);
  assert.equal(s.mgmtCount, 1);
});

test('device senza fibra: nessun blocco SFP separato', () => {
  const c = catalog.find(x => x.counts && x.counts.sfp === 0 && x.counts.qsfp === 0 && x.ports > 0);
  if (!c) return; // nessuno nel set: skip silenzioso
  assert.ok(!c.frontPanel.separateSfp, c.model + ' non deve avere separateSfp');
});
