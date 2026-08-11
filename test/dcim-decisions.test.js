'use strict';
// Il catalogo delle decisioni: una riga = una decisione, mai un apparato.
const test = require('node:test');
const assert = require('node:assert');
const { buildDecisions, sanitizeDecisions, DECISION_CATALOG } = require('../lib/dcim-decisions.js');

const overTemplate = (id, name) => ({ code: 'ports.overTemplate', deviceId: id, deviceName: name, model: 'C9200-48P', netbox: 11, template: 10 });

test('tredici apparati con lo stesso problema fanno UNA riga, non tredici', () => {
  const issues = [];
  for (let i = 1; i <= 13; i++) issues.push(overTemplate(i, 'sw-' + i));
  const r = buildDecisions({ issues, counts: { devices: 72 } });
  assert.equal(r.decisions.length, 1, 'una sola decisione');
  assert.equal(r.decisions[0].count, 13, 'che vale per tredici apparati');
  assert.equal(r.decisions[0].devices.length, 13);
  assert.deepEqual(r.decisions[0].devices[0], { id: 1, name: 'sw-1' }, 'col NOME, non con l\'id NetBox');
  assert.deepEqual(r.decisions[0].models, ['C9200-48P'], 'modelli distinti, non ripetuti');
  assert.deepEqual(r.decisions[0].data, { netbox: 11, template: 10 });
});

test('il default e\' il comportamento storico: chi non tocca nulla ottiene quel che otteneva prima', () => {
  const r = buildDecisions({ issues: [overTemplate(1, 'sw-1')], counts: {} });
  const d = r.decisions[0];
  assert.equal(d.chosen, 'keepCatalog');
  assert.equal(d.options.find(o => o.isDefault).id, 'keepCatalog');
  assert.deepEqual(d.options.map(o => o.id), ['keepCatalog', 'genericPanel']);
});

test('la scelta dell\'utente vince; una scelta inventata no', () => {
  const issues = [overTemplate(1, 'sw-1')];
  assert.equal(buildDecisions({ issues }, { 'ports.overTemplate': 'genericPanel' }).decisions[0].chosen, 'genericPanel');
  assert.equal(buildDecisions({ issues }, { 'ports.overTemplate': 'qualunque' }).decisions[0].chosen, 'keepCatalog');
});

test('un gruppo NON uniforme lo dichiara invece di spacciarsi per tale', () => {
  const r = buildDecisions({ issues: [
    { code: 'ports.overTemplate', deviceId: 1, deviceName: 'a', netbox: 11, template: 10 },
    { code: 'ports.overTemplate', deviceId: 2, deviceName: 'b', netbox: 64, template: 48 },
  ] });
  assert.equal(r.decisions[0].data.mixed, true);
});

test('ordine di lettura: prima cosa si perde, poi cosa si sceglie, infine cosa informa', () => {
  const r = buildDecisions({ issues: [
    { code: 'pdu.outletsCapped', deviceId: 9, deviceName: 'pdu', found: 60, max: 48 },
    overTemplate(1, 'sw-1'),
    { code: 'cable.skipped', cableId: 500, reason: 'loop' },
  ] });
  assert.deepEqual(r.outcome.costs.map(c => c.code), ['cable.skipped', 'ports.overTemplate', 'pdu.outletsCapped']);
  assert.equal(r.info[0].code, 'cable.skipped', 'senza alternative non e\' una decisione');
  assert.equal(r.info[0].severity, 'loss', 'ma e\' una perdita, non un dettaglio');
  assert.deepEqual(r.info[0].cables, [500]);
});

test('il preventivo somma i due tipi di cavo e non inventa contatori', () => {
  const r = buildDecisions({ issues: [], counts: { devices: 72, directLinks: 120, passThroughLinks: 10, vlans: 14, racks: 5 } });
  assert.deepEqual(r.outcome, { devices: 72, cables: 130, vlans: 14, racks: 5, costs: [] });
  assert.deepEqual(r.decisions, []);
  assert.deepEqual(r.info, []);
});

test('elenco cappato dalla route: il pannello lo sa e puo\' dirlo', () => {
  assert.equal(buildDecisions({ issues: [overTemplate(1, 'a')], issuesTotal: 900 }).truncated, true);
  assert.equal(buildDecisions({ issues: [overTemplate(1, 'a')], issuesTotal: 1 }).truncated, false);
});

test('sanitizeDecisions: passano solo le scelte che il motore sa applicare', () => {
  assert.deepEqual(sanitizeDecisions({ 'ports.overTemplate': 'genericPanel' }), { 'ports.overTemplate': 'genericPanel' });
  assert.deepEqual(sanitizeDecisions({ 'ports.overTemplate': 'keepCatalog' }), {}, 'il default non si spedisce');
  assert.deepEqual(sanitizeDecisions({ 'ports.overTemplate': 'boh', 'codice.inventato': 'x', 'cable.skipped': 'y' }), {});
  assert.deepEqual(sanitizeDecisions(null), {});
});

test('difensivo: report vuoto, issue senza codice, code sconosciuto', () => {
  assert.deepEqual(buildDecisions().decisions, []);
  assert.deepEqual(buildDecisions({ issues: [null, {}, { code: '' }] }).decisions, []);
  const r = buildDecisions({ issues: [{ code: 'codice.mai.visto', deviceId: 3, deviceName: 'x' }] });
  assert.equal(r.info.length, 1, 'un codice nuovo non rompe il pannello: finisce fra gli informativi');
  assert.equal(r.info[0].severity, 'info');
});

test('il catalogo non regala opzioni: solo i codici con una vera alternativa', () => {
  const withOptions = Object.keys(DECISION_CATALOG).filter(c => (DECISION_CATALOG[c].options || []).length > 1);
  assert.deepEqual(withOptions, ['ports.overTemplate']);
});
