'use strict';
// ============================================================
// HA — la lettura fatta a questo indirizzo e' di un'ALTRA unita' dello stesso gruppo?
// ============================================================
// Dopo un failover l'indirizzo del cluster risponde con l'altra unita': i suoi vicini LLDP, la sua FDB e la sua
// ARP sono dell'altra unita', non del nodo che il documento tiene su quell'indirizzo. Credere a quella lettura
// per quel nodo disegnava un SECONDO cavo sulla stessa porta (visto sul banco, 03/11 e 15/11/2026: il cavo
// del firewall B verso la porta dello switch dove e' attaccato il firewall A).
// Questa regola dice SOLO se la lettura e' dell'altra unita'; cosa farne sta nel glue dell'auto-link.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { answeredByHaPartner } = require('../lib/ha-failover.js');

const CL = { group: 'LAB-HA', mode: 'active-passive', members: [{ serial: 'SER-A', name: 'FGT-A' }, { serial: 'SER-B', name: 'FGT-B' }] };
const fw3 = (over = {}, inv = { serialNumber: 'SER-A', model: 'FGT-VM' }, cluster = CL) => ({
  id: 'fw3', name: 'FGT-B', serialNumber: 'SER-B', integration: { host: '10.0.0.50', inventory: inv, ...(cluster ? { cluster } : {}) }, ...over,
});

test('la serie che risponde e\' quella di un altro membro del cluster letto → e\' un\'altra unita\'', () => {
  const n = fw3();
  const r = answeredByHaPartner(n, [n]);
  assert.equal(r.source, 'cluster');
  assert.equal(r.realName, 'FGT-A');
});

test('senza lettura del cluster: la prova e\' il documento (coppia dichiarata + serie del compagno)', () => {
  const b = fw3({ spec: { haPeer: 'fw4' } }, undefined, null);
  const a = { id: 'fw4', name: 'FGT-A', serialNumber: 'SER-A', spec: { haPeer: 'fw3' } };
  assert.equal(answeredByHaPartner(b, [a, b]).source, 'declared');
});

test('la serie che risponde e\' la STESSA documentata → la lettura e\' di questo nodo', () => {
  assert.equal(answeredByHaPartner(fw3({}, { serialNumber: 'SER-B' }), []), null);
});

test('una serie che nessun compagno ha → NON si dice che e\' un\'altra unita\' (un apparato sostituito resta un apparato sostituito)', () => {
  assert.equal(answeredByHaPartner(fw3({}, { serialNumber: 'SER-Z' }), []), null);
});

test('una misura non riconfermata (stale) non decide niente', () => {
  assert.equal(answeredByHaPartner(fw3({}, { serialNumber: 'SER-A', stale: true }), []), null);
  assert.equal(answeredByHaPartner(fw3({}, null), []), null);
});

test('una serie bloccata dall\'utente non si contesta: la lettura resta di questo nodo', () => {
  assert.equal(answeredByHaPartner(fw3({ serialNumberManual: true }), []), null);
});

test('senza una serie documentata o misurata non si puo\' dire', () => {
  assert.equal(answeredByHaPartner(fw3({ serialNumber: '' }), []), null);
  assert.equal(answeredByHaPartner(fw3({}, { serialNumber: '', model: 'x' }), []), null);
});

// ── la lettura di QUESTO poll, non ancora scritta sul nodo ─────────────────────────────────────────
// `applyPollResult` decide cosa scrivere PRIMA di salvare l'inventario nuovo: la domanda «risponde un'altra
// unita'?» va fatta sulla lettura appena arrivata (`fresh`), non sulla misura del giro prima.
test('fresh: la lettura appena arrivata decide, anche se la misura salvata dice che e\' tutto a posto', () => {
  const n = fw3({}, { serialNumber: 'SER-B', model: 'FGT-VM' }, null);   // salvata: risponde il nodo stesso
  assert.equal(answeredByHaPartner(n, [n]), null);
  const r = answeredByHaPartner(n, [n], undefined, { inventory: { serialNumber: 'SER-A', model: 'FGT-VM' }, cluster: CL });
  assert.equal(r.source, 'cluster');
  assert.equal(r.realName, 'FGT-A');
});

test('fresh: una lettura senza identita\' non decide (non si ricade sulla misura vecchia)', () => {
  const n = fw3();   // salvata: risponde A, quindi sarebbe un\'altra unita\'
  assert.ok(answeredByHaPartner(n, [n]));
  assert.equal(answeredByHaPartner(n, [n], undefined, { inventory: {}, cluster: CL }), null);
});

test('fresh: il cluster della lettura nuova vince su quello salvato', () => {
  const n = fw3({}, { serialNumber: 'SER-A' }, { group: 'VECCHIO', members: [{ serial: 'SER-A' }, { serial: 'SER-B' }] });
  const r = answeredByHaPartner(n, [n], undefined, { inventory: { serialNumber: 'SER-A' }, cluster: CL });
  assert.equal(r.group, 'LAB-HA');
});

test('un nodo qualunque, senza HA ne\' cluster, non e\' toccato', () => {
  const sw = { id: 'sw', name: 'SW', serialNumber: 'S1', integration: { inventory: { serialNumber: 'S2' } } };
  assert.equal(answeredByHaPartner(sw, [sw]), null);
  assert.equal(answeredByHaPartner(null, []), null);
});
