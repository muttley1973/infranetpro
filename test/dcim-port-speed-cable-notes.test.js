'use strict';
// ============================================================
// CAVI E RETE ↔ NETBOX — due campi che NetBox riempie e il documento aveva gia' un posto per tenere:
//   · la VELOCITA' dell'interfaccia (kbps in NetBox) → «Velocita'» della porta, nello slot DICHIARATO (`speedOvr`; `speed`
//     e' quello della lettura SNMP). La Verifica li confronta: «NetBox dichiara 1G, la porta e' a 100M»;
//   · la DESCRIZIONE e i COMMENTI del cavo → «Descrizione» del pannello del cavo (`link.notes`).
// Le fixture portano il NULL che manda l'API vera: `+null` e' 0 e un 0 non e' una velocita'.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dcim = require('../lib/dcim-map.js');
const { buildDocSnapshot } = require('../lib/drift-snapshot.js');
const { buildDriftReport } = require('../lib/drift-report.js');
const { buildDecisions, DECISION_CATALOG } = require('../lib/dcim-decisions.js');
const i18n = require('../lib/i18n.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const DEV = (id, name) => ({ id, name, role: { id: 40 }, site: { id: 1, name: 'S' }, device_type: { id: 7, model: 'SW', manufacturer: { slug: 'x', name: 'X' }, u_height: 1 } });
const ITF = (id, device, name, extra) => Object.assign({ id, device: { id: device }, name, type: { value: '1000base-t' }, enabled: true }, extra || {});
const TERM = (id) => [{ object_type: 'dcim.interface', object_id: id }];

function importa(interfaces, cables, devices) {
  return dcim.netboxToState({
    deviceRoles: [{ id: 40, slug: 'switch', name: 'Switch' }], devices: devices || [DEV(1, 'A'), DEV(2, 'B')], racks: [],
    interfaces, cables: cables || [],
  });
}
const portByName = (r, name) => Object.values(r.state.ports).find((p) => p.ifName === name) || null;
const speedOf = (speed) => { const r = importa([ITF(10, 1, 'e1', { speed })]); return portByName(r, 'e1'); };

// ── velocita' della porta ─────────────────────────────────────────────────────────────────────────────────
test('velocita\': i kbps di NetBox diventano Mbps nello slot dichiarato (`speedOvr`), mai in quello della lettura (`speed`)', () => {
  for (const [kbps, mbps] of [[10000, 10], [100000, 100], [1000000, 1000], [2500000, 2500], [10000000, 10000], [25000000, 25000], [100000000, 100000]]) {
    const p = speedOf(kbps);
    assert.equal(p.speedOvr, mbps, kbps + ' kbps');
    assert.equal('speed' in p, false, 'lo slot della lettura SNMP resta vuoto');
  }
  assert.equal(speedOf('100000').speedOvr, 100, 'un numero come testo');
});

test('velocita\': non dichiarata (null, assente, vuota, zero, negativa, non numerica) = nessuna velocita\' e nessuna riga nel rapporto', () => {
  for (const speed of [null, undefined, '', 0, -1000, 'abc', NaN]) {
    const r = importa([ITF(10, 1, 'e1', { speed })]);
    assert.equal('speedOvr' in portByName(r, 'e1'), false, 'speed = ' + String(speed));
    assert.deepEqual(r.report.issues.filter((i) => i.code === 'port.speedUnusable'), [], 'non dichiarata: niente da dire (' + String(speed) + ')');
  }
});

test('velocita\': una velocita\' che non e\' un numero INTERO di Mbps non si arrotonda — resta assente, e la riga la conta', () => {
  const r = importa([ITF(10, 1, 'e1', { speed: 1544 }), ITF(11, 1, 'e2', { speed: 1500 }), ITF(12, 1, 'e3', { speed: 1000000 }), ITF(13, 2, 'e1', { speed: 100 })]);
  const speeds = Object.values(r.state.ports).map((p) => p.ifName + ':' + p.speedOvr).sort();
  assert.deepEqual(speeds, ['e1:undefined', 'e1:undefined', 'e2:undefined', 'e3:1000'], "solo l'intera entra");
  const rows = r.report.issues.filter((i) => i.code === 'port.speedUnusable');
  assert.equal(rows.length, 1, 'UNA riga per tutte le porte');
  assert.equal(rows[0].n, 3, '1544, 1500 e 100 kbps');
});

test('velocita\': vale anche per le porte di gestione e per le logiche (LAG), che passano da altri rami del mapper', () => {
  const r = importa([
    ITF(10, 1, 'mgmt0', { mgmt_only: true, speed: 1000000 }),
    ITF(11, 1, 'po1', { type: { value: 'lag' }, speed: 20000000 }),
    ITF(12, 1, 'mgmt1', { mgmt_only: true, speed: 1544 }),
    ITF(13, 1, 'po2', { type: { value: 'lag' }, speed: 1544 }),
  ]);
  assert.equal(portByName(r, 'mgmt0').speedOvr, 1000);
  assert.equal(portByName(r, 'po1').speedOvr, 20000);
  assert.equal('speedOvr' in portByName(r, 'mgmt1'), false);
  assert.equal(r.report.issues.find((i) => i.code === 'port.speedUnusable').n, 2, 'anche le due non intere, di rami diversi');
});

test('velocita\': e\' lo slot della PERSONA: la lettura SNMP non lo tocca e la Verifica lo confronta con la misura', () => {
  const r = importa([ITF(10, 1, 'e1', { speed: 1000000 }), ITF(11, 2, 'e1', { speed: 1000000 })], [{ id: 1, a_terminations: TERM(10), b_terminations: TERM(11), status: { value: 'connected' } }]);
  const [pidA, pidB] = [r.state.links[0].src, r.state.links[0].dst];
  assert.equal(r.state.ports[pidA].speedOvr, 1000);
  // la lettura scrive `speed` (e `operUp`): il dichiarato non si sposta
  r.state.ports[pidA].speed = 100; r.state.ports[pidA].operUp = true;
  const doc = buildDocSnapshot({ links: r.state.links, ports: r.state.ports, normMac: (s) => String(s).toLowerCase() });
  assert.equal(doc.ports[pidA].speed, 1000, 'il documento dice 1G: vince il dichiarato');
  const nodeA = pidA.replace(/-\d+$/, '');
  const snmp = { responded: { [nodeA]: true }, ports: { [pidA]: { status: doc.ports[pidA].status, speed: r.state.ports[pidA].speed, vlan: null, measured: true } } };
  const rep = buildDriftReport(snmp, doc, [], {});
  const row = rep.stateDrift.find((x) => x.diffs.some((d) => d.field === 'speed'));
  assert.ok(row, 'NetBox dichiara 1G, la porta e\' a 100M: e\' una discrepanza');
  assert.deepEqual(row.diffs.find((d) => d.field === 'speed'), { field: 'speed', doc: 1000, real: 100 });
  assert.ok(pidB, 'l\'altro capo esiste');
});

test('velocita\': la riga «non la posso tenere» e\' una perdita dichiarata, con testo in italiano e in inglese', () => {
  assert.equal(DECISION_CATALOG['port.speedUnusable'].severity, 'loss');
  const rep = importa([ITF(10, 1, 'e1', { speed: 1544 }), ITF(11, 1, 'e2', { speed: 1500 })]).report;
  const row = buildDecisions(rep).info.find((x) => x.code === 'port.speedUnusable');
  assert.ok(row, 'e\' una riga informativa di perdita');
  assert.equal(row.count, 2); assert.equal(row.severity, 'loss');
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of ['dcim.dec.port.speedUnusable.title', 'dcim.dec.port.speedUnusable.titleOne', 'dcim.dec.port.speedUnusable.why', 'dcim.cost.port.speedUnusable', 'dcim.cost.port.speedUnusableOne']) {
    for (const lang of ['it', 'en']) assert.ok(typeof i18n._i18nDict[lang][k] === 'string' && i18n._i18nDict[lang][k], `${lang}: manca ${k}`);
    assert.equal(ph(i18n._i18nDict.it[k]), ph(i18n._i18nDict.en[k]), 'segnaposto diversi: ' + k);
  }
});

// ── descrizione e commenti del cavo ───────────────────────────────────────────────────────────────────────
const cavo = (extra) => {
  const r = importa([ITF(10, 1, 'e1'), ITF(11, 2, 'e1')], [Object.assign({ id: 1, a_terminations: TERM(10), b_terminations: TERM(11), status: { value: 'connected' } }, extra || {})]);
  return r.state.links[0];
};

test('cavo: la descrizione e i commenti sono due testi diversi e entrano TUTTI E DUE in «Descrizione», col separatore degli apparati', () => {
  assert.equal(cavo({ description: 'Dorsale sala A', comments: 'Posato nel 2019' }).notes, 'Dorsale sala A — Posato nel 2019');
  assert.equal(cavo({ description: 'Dorsale sala A' }).notes, 'Dorsale sala A');
  assert.equal(cavo({ comments: 'Posato nel 2019' }).notes, 'Posato nel 2019');
});

test('cavo: niente da dire (null come lo manda NetBox, vuoti, spazi) = nessuna nota', () => {
  for (const extra of [{}, { description: null, comments: null }, { description: '', comments: '' }, { description: '   ', comments: '\n\n' }]) {
    assert.equal('notes' in cavo(extra), false, JSON.stringify(extra));
  }
});

test('cavo: i commenti di NetBox sono Markdown su piu\' righe — un a-capo vale uno spazio, mai parole incollate', () => {
  assert.equal(cavo({ comments: 'posato 2019\nrifatto 2024' }).notes, 'posato 2019 rifatto 2024');
  assert.equal(cavo({ comments: 'uno\r\ndue\n\n   tre' }).notes, 'uno due tre');
  assert.equal(cavo({ comments: 'uno\rdue' }).notes, 'uno due', 'anche un a-capo scritto solo con \\r');
  assert.equal(cavo({ description: 'd', comments: 'a\nb' }).notes, 'd — a b');
});

test('VM: lo stesso per i commenti di una macchina virtuale (il difetto era anche li\')', () => {
  const r = dcim.netboxToState({
    deviceRoles: [{ id: 40, slug: 'server', name: 'S' }], devices: [DEV(1, 'H')], racks: [], interfaces: [],
    virtualMachines: [{ id: 5, name: 'v', device: { id: 1 }, status: { value: 'active' }, description: 'd', comments: 'riga uno\r\nriga due\n\n  riga tre' }], vmInterfaces: [], vmIpAddresses: [],
  });
  assert.equal(r.state.nodes.find((n) => n.id === 'nb-dev-1').vms[0].notes, 'd — riga uno riga due riga tre');
});

test('cavo: la nota non disturba cio\' che c\'era (etichetta, colore, lunghezza, stato) e non tocca il collegamento radio', () => {
  const l = cavo({ label: 'CAVO-7', color: 'ff0000', length: 5, length_unit: { value: 'm' }, description: 'x' });
  assert.equal(l.label, 'CAVO-7'); assert.equal(l.color, '#ff0000'); assert.equal(l.lengthM, 5); assert.equal(l.cableStatus, 'active'); assert.equal(l.notes, 'x');
});

// ── i pannelli, nel DOM finto ─────────────────────────────────────────────────────────────────────────────
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function pannello(js) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] }; state.vlanNames = {}; state.vlanColors = state.vlanColors || {};
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:4 }, { id:'sw2', type:'switch', name:'SW-B', ports:4 });
    ${js}
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    _propsExplicit = true; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
}

test('pannello cavo: la descrizione importata si legge e si puo\' correggere (`data-lprop="notes"`)', () => {
  const html = pannello(`state.links.push({ id:'l1', src:'sw1-1', dst:'sw2-1', notes:'Dorsale sala A — Posato nel 2019' }); selType='link'; selId='l1';`);
  const m = /<textarea[^>]*data-lprop="notes"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
  assert.ok(m, 'il campo c\'e\'');
  assert.equal(m[1], 'Dorsale sala A — Posato nel 2019');
});

test('pannello porta: la velocita\' dichiarata si vede come scritta dalla persona (classe `ovr`) e il valore e\' quello importato', () => {
  const html = pannello(`state.ports['sw1-1'] = { speedOvr: 1000 }; selType='port'; selId='sw1-1';`);
  const m = /<input[^>]*data-change="port-speed"[^>]*>/.exec(html);
  assert.ok(m, 'il campo velocita\' c\'e\'');
  assert.match(m[0], /class="ovr"/);
  assert.match(m[0], /value="(1G|1000)[^"]*"/, 'il valore: ' + m[0]);
  const senza = pannello(`state.ports['sw1-1'] = { }; selType='port'; selId='sw1-1';`);
  assert.doesNotMatch(/<input[^>]*data-change="port-speed"[^>]*>/.exec(senza)[0], /class="ovr"/, 'senza dichiarazione: niente classe');
});
