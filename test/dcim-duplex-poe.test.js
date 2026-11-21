'use strict';
// ============================================================
// CAVI E RETE ↔ NETBOX — il DUPLEX e il PoE che NetBox dichiara sulle interfacce.
//   · DUPLEX → `duplexOvr`, lo slot della persona (come la velocita'): il pannello della porta lo offre, la Verifica lo confronta
//     con la lettura e il cavo ne confronta i DUE capi (`duplex-mismatch`: full contro half).
//   · PoE → la classe sta sul CAVO (`link.poe`: 802.3af/at/bt), dal capo che EROGA (`pse`), e solo se il tipo e' una classe 802.3:
//     il PoE passivo, un capo alimentato da solo, due capi discordi o una porta senza cavo non producono niente — si CONTANO
//     (`port.poeLeftOut`). Sul cavo la classe fa funzionare le regole che gia' c'erano (`poe-cat`, `poe-fiber`).
// Le fixture portano il NULL che manda l'API vera (`poe_mode: null`, `duplex: null`).
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dcim = require('../lib/dcim-map.js');
const { validateCable } = require('../lib/cable-validate.js');
const { buildDocSnapshot } = require('../lib/drift-snapshot.js');
const { buildDriftReport } = require('../lib/drift-report.js');
const { buildDecisions, DECISION_CATALOG } = require('../lib/dcim-decisions.js');
const i18n = require('../lib/i18n.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const DEV = (id, name) => ({ id, name, role: { id: 40 }, site: { id: 1, name: 'S' }, device_type: { id: 7, model: 'SW', manufacturer: { slug: 'x', name: 'X' }, u_height: 1 } });
const ITF = (id, device, name, extra) => Object.assign({ id, device: { id: device }, name, type: { value: '1000base-t' }, enabled: true }, extra || {});
const TERM = (id) => [{ object_type: 'dcim.interface', object_id: id }];
const CBL = (id, a, b, extra) => Object.assign({ id, a_terminations: TERM(a), b_terminations: TERM(b), status: { value: 'connected' } }, extra || {});
const PSE = (type) => ({ poe_mode: { value: 'pse' }, poe_type: type == null ? null : { value: type } });
const PD = (type) => ({ poe_mode: { value: 'pd' }, poe_type: type == null ? null : { value: type } });

function importa(interfaces, cables) {
  return dcim.netboxToState({ deviceRoles: [{ id: 40, slug: 'switch', name: 'Switch' }], devices: [DEV(1, 'A'), DEV(2, 'B')], racks: [], interfaces, cables: cables || [] });
}
const portByName = (r, name) => Object.values(r.state.ports).find((p) => p.ifName === name) || null;
const righe = (r, code) => r.report.issues.filter((i) => i.code === code);

// ── duplex ────────────────────────────────────────────────────────────────────────────────────────────────
test('duplex: full, half e auto (come oggetto NetBox o come testo) entrano nello slot dichiarato, mai in quello della lettura', () => {
  for (const d of ['full', 'half', 'auto']) {
    for (const duplex of [{ value: d, label: d }, d]) {
      const p = portByName(importa([ITF(10, 1, 'e1', { duplex })]), 'e1');
      assert.equal(p.duplexOvr, d, JSON.stringify(duplex));
      assert.equal('duplex' in p, false, 'lo slot della lettura resta vuoto');
    }
  }
});

test('duplex: assente, null (come lo manda NetBox), vuoto o una parola che non e\' una delle tre = nessun duplex', () => {
  for (const duplex of [null, undefined, '', 'boh', { value: null }, { value: 'FULLISH' }, 10]) {
    assert.equal('duplexOvr' in portByName(importa([ITF(10, 1, 'e1', { duplex })]), 'e1'), false, JSON.stringify(duplex));
  }
  assert.equal(portByName(importa([ITF(10, 1, 'e1', { duplex: { value: 'FULL' } })]), 'e1').duplexOvr, 'full', 'maiuscole: la stessa parola');
});

test('duplex: vale anche per una porta di gestione e per una logica (altri rami del mapper)', () => {
  const r = importa([ITF(10, 1, 'mgmt0', { mgmt_only: true, duplex: 'full' }), ITF(11, 1, 'po1', { type: { value: 'lag' }, duplex: 'half' })]);
  assert.equal(portByName(r, 'mgmt0').duplexOvr, 'full');
  assert.equal(portByName(r, 'po1').duplexOvr, 'half');
});

// ── PoE sul cavo ──────────────────────────────────────────────────────────────────────────────────────────
test('PoE: il tipo del capo che EROGA diventa la classe del cavo (af, at, bt; i tipi 3 e 4 sono entrambi bt)', () => {
  for (const [tipo, classe] of [['type1-ieee802.3af', '802.3af'], ['type2-ieee802.3at', '802.3at'], ['type3-ieee802.3bt', '802.3bt'], ['type4-ieee802.3bt', '802.3bt']]) {
    const r = importa([ITF(10, 1, 'e1', PSE(tipo)), ITF(11, 2, 'e1', PD(null))], [CBL(1, 10, 11)]);
    assert.equal(r.state.links[0].poe, classe, tipo);
    assert.deepEqual(righe(r, 'port.poeLeftOut'), [], tipo + ': tutto tenuto, niente da dire');
  }
});

test('PoE: il capo PSE puo\' stare da una parte o dall\'altra del cavo, e come testo semplice', () => {
  const r = importa([ITF(10, 1, 'e1', PD(null)), ITF(11, 2, 'e1', { poe_mode: 'pse', poe_type: 'type2-ieee802.3at' })], [CBL(1, 10, 11)]);
  assert.equal(r.state.links[0].poe, '802.3at');
});

test('PoE: senza un capo che eroga con una classe 802.3 il cavo non dichiara niente', () => {
  const casi = {
    'solo il capo alimentato': [ITF(10, 1, 'e1', PD('type2-ieee802.3at')), ITF(11, 2, 'e1', {})],
    'erogante senza tipo': [ITF(10, 1, 'e1', PSE(null)), ITF(11, 2, 'e1', {})],
    'PoE passivo': [ITF(10, 1, 'e1', PSE('passive-24v-2pair')), ITF(11, 2, 'e1', {})],
    'null veri': [ITF(10, 1, 'e1', { poe_mode: null, poe_type: null }), ITF(11, 2, 'e1', { poe_mode: null, poe_type: null })],
  };
  for (const [nome, itfs] of Object.entries(casi)) assert.equal('poe' in importa(itfs, [CBL(1, 10, 11)]).state.links[0], false, nome);
});

test('PoE: due capi che erogano con classi DIVERSE non ne dichiarano nessuna; con la stessa classe si', () => {
  const diverse = importa([ITF(10, 1, 'e1', PSE('type2-ieee802.3at')), ITF(11, 2, 'e1', PSE('type3-ieee802.3bt'))], [CBL(1, 10, 11)]);
  assert.equal('poe' in diverse.state.links[0], false);
  assert.equal(righe(diverse, 'port.poeLeftOut')[0].n, 2, 'tutti e due i tipi restano fuori');
  const uguali = importa([ITF(10, 1, 'e1', PSE('type3-ieee802.3bt')), ITF(11, 2, 'e1', PSE('type4-ieee802.3bt'))], [CBL(1, 10, 11)]);
  assert.equal(uguali.state.links[0].poe, '802.3bt', 'type3 e type4 sono la stessa classe');
});

test('PoE: cio\' che NetBox dichiara e non finisce in un cavo si CONTA, in una riga sola', () => {
  const r = importa([
    ITF(10, 1, 'e1', PSE('type2-ieee802.3at')), ITF(11, 2, 'e1', PD('type2-ieee802.3at')),      // tenuto (e il capo alimentato e' coperto)
    ITF(12, 1, 'e2', PSE('passive-24v-2pair')), ITF(13, 2, 'e2', {}),                           // passivo: fuori
    ITF(14, 1, 'e3', PSE('type3-ieee802.3bt')),                                                 // erogante senza cavo: fuori
    ITF(15, 2, 'e3', PD('type1-ieee802.3af')),                                                  // alimentato senza cavo: fuori
    ITF(16, 1, 'e4', PSE(null)),                                                                // modo senza tipo: niente da tenere
  ], [CBL(1, 10, 11), CBL(2, 12, 13)]);
  const rr = righe(r, 'port.poeLeftOut');
  assert.equal(rr.length, 1, 'UNA riga');
  assert.equal(rr[0].n, 3, 'e2 passivo, e3 senza cavo, e3 alimentato senza cavo');
  assert.equal(DECISION_CATALOG['port.poeLeftOut'].severity, 'loss');
  const row = buildDecisions(r.report).info.find((x) => x.code === 'port.poeLeftOut');
  assert.ok(row && row.count === 3 && row.severity === 'loss');
});

test('PoE: le interfacce che non sono entrate nel documento non si contano come perse da questa riga', () => {
  const r = importa([ITF(10, 1, 'e1', PSE('type2-ieee802.3at')), ITF(11, 99, 'x1', PSE('type2-ieee802.3at'))]);   // l'apparato 99 non esiste
  assert.equal(righe(r, 'port.poeLeftOut')[0].n, 1, 'solo la porta importata (senza cavo)');
});

test('PoE: un capo che NON e\' un\'interfaccia (un front port) non legge il PoE di un\'interfaccia con lo stesso id', () => {
  // Gli spazi di id di NetBox sono separati per tipo di oggetto: front port #2000 e interfaccia #2000 sono due cose.
  const r = dcim.netboxToState({
    deviceRoles: [{ id: 20, slug: 'access-switch', name: 'Switch' }, { id: 22, slug: 'patch-panel', name: 'Patch Panel' }],
    devices: [{ id: 100, name: 'SW', role: { id: 20 }, site: { id: 1, name: 'S' } }, { id: 200, name: 'PP', role: { id: 22 }, site: { id: 1, name: 'S' } }, { id: 300, name: 'SRV', role: { id: 20 }, site: { id: 1, name: 'S' } }],
    racks: [],
    interfaces: [ITF(1000, 100, 'e1', PSE('type2-ieee802.3at')), ITF(2000, 300, 'e1', PSE('type3-ieee802.3bt'))],
    frontPorts: [{ id: 2000, device: { id: 200 }, name: '1', rear_port: { id: 3000 } }],
    cables: [{ id: 500, a_terminations: [{ object_type: 'dcim.interface', object_id: 1000 }], b_terminations: [{ object_type: 'dcim.frontport', object_id: 2000 }], status: { value: 'connected' } }],
  });
  assert.equal(r.state.links.length, 1, 'il cavo c\'e\'');
  assert.equal(r.state.links[0].poe, '802.3at', 'la classe viene solo dall\'interfaccia #1000: l\'interfaccia #2000 (bt) non e\' un capo di questo cavo');
});

test('PoE: la classe sul cavo fa lavorare le regole che c\'erano — bt su Cat5e avvisa, PoE su fibra e\' un errore', () => {
  const lk = (tipo) => importa([ITF(10, 1, 'e1', PSE('type3-ieee802.3bt')), ITF(11, 2, 'e1', PD(null))], [CBL(1, 10, 11, { type: tipo })]).state.links[0];
  const cat5e = lk('cat5e');
  assert.equal(cat5e.poe, '802.3bt');
  assert.ok(validateCable(cat5e).some((x) => x.code === 'poe-cat'), 'bt su Cat5e');
  assert.ok(!validateCable(lk('cat6a')).some((x) => x.code === 'poe-cat'), 'bt su Cat6A: nessun avviso');
  assert.ok(validateCable(lk('smf-os2')).some((x) => x.code === 'poe-fiber' && x.level === 'error'), 'PoE su fibra');
});

// ── duplex discordante ai due capi ────────────────────────────────────────────────────────────────────────
test('cavo: full contro half ai due capi e\' un avviso, in tutti e due i versi; il resto non lo e\'', () => {
  const v = (s, d) => validateCable({}, { srcDuplex: s, dstDuplex: d }).filter((x) => x.code === 'duplex-mismatch');
  assert.equal(v('full', 'half').length, 1); assert.equal(v('half', 'full').length, 1);
  assert.deepEqual(v('full', 'half')[0].params, { a: 'full', b: 'half' });
  assert.equal(v('full', 'half')[0].level, 'warn');
  for (const [s, d] of [['full', 'full'], ['half', 'half'], ['auto', 'auto'], ['auto', 'full'], ['half', 'auto'], ['full', null], [null, 'half'], [null, null], [undefined, undefined], ['', 'half']]) {
    assert.equal(v(s, d).length, 0, `${s} / ${d}`);
  }
  assert.equal(validateCable({}, {}).filter((x) => x.code === 'duplex-mismatch').length, 0, 'senza opzioni');
});

// ── la Verifica ───────────────────────────────────────────────────────────────────────────────────────────
test('Verifica: il documento dice il duplex DICHIARATO e la realta\' quello letto: «NetBox dichiara full, la porta e\' half»', () => {
  const m = { links: [{ id: 'c1', src: 'sw-1', dst: 'pc-1' }], ports: { 'sw-1': { duplexOvr: 'full', duplex: 'half' }, 'pc-1': { duplex: 'full' } }, normMac: (s) => String(s).toLowerCase() };
  const d = buildDocSnapshot(m);
  assert.equal(d.ports['sw-1'].duplex, 'full', 'il dichiarato vince nel documento');
  assert.equal(d.ports['pc-1'].duplex, 'full', 'senza dichiarato: il campo della lettura, come prima');
  assert.equal(buildDocSnapshot({ links: m.links, ports: { 'sw-1': {}, 'pc-1': {} }, normMac: m.normMac }).ports['sw-1'].duplex, null);
  const snmp = { responded: { sw: true }, ports: { 'sw-1': { status: 'active', speed: null, duplex: 'half', vlan: null, measured: true } } };
  const rep = buildDriftReport(snmp, { ports: { 'sw-1': { label: 'SW / P1', status: 'active', speed: null, duplex: d.ports['sw-1'].duplex, vlan: null } } }, [], {});
  const row = rep.stateDrift.find((x) => x.diffs.some((y) => y.field === 'duplex'));
  assert.ok(row, 'una discrepanza');
  assert.deepEqual(row.diffs.find((y) => y.field === 'duplex'), { field: 'duplex', doc: 'full', real: 'half' });
});

// ── testi ─────────────────────────────────────────────────────────────────────────────────────────────────
test('i testi nuovi esistono in italiano e in inglese, con gli stessi segnaposto', () => {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const chiavi = ['port.duplex', 'port.duplexFull', 'port.duplexHalf', 'port.duplexAuto', 'cbl.duplex-mismatch.t', 'cbl.duplex-mismatch.w',
    'dcim.dec.port.poeLeftOut.title', 'dcim.dec.port.poeLeftOut.titleOne', 'dcim.dec.port.poeLeftOut.why', 'dcim.cost.port.poeLeftOut', 'dcim.cost.port.poeLeftOutOne'];
  for (const k of chiavi) {
    for (const lang of ['it', 'en']) assert.ok(typeof i18n._i18nDict[lang][k] === 'string' && i18n._i18nDict[lang][k], `${lang}: manca ${k}`);
    assert.equal(ph(i18n._i18nDict.it[k]), ph(i18n._i18nDict.en[k]), 'segnaposto diversi: ' + k);
  }
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
const tendina = (html) => (/<select[^>]*data-pfield="duplexOvr"[^>]*>([\s\S]*?)<\/select>/.exec(html) || []);
const scelte = (html) => [...(tendina(html)[1] || '').matchAll(/<option value="([^"]*)"\s*(selected)?[^>]*>/g)].filter((m) => m[2]).map((m) => m[1]);

test('pannello porta: la tendina del duplex c\'e\', offre full/half/auto e mostra quello dichiarato (classe `ovr`)', () => {
  const html = pannello(`state.ports['sw1-1'] = { duplexOvr: 'half' }; selType='port'; selId='sw1-1';`);
  assert.ok(tendina(html)[1], 'la tendina c\'e\'');
  assert.deepEqual([...tendina(html)[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), ['', 'full', 'half', 'auto']);
  assert.deepEqual(scelte(html), ['half']);
  assert.match(tendina(html)[0], /class="ovr"/);
  assert.ok(tendina(html)[1].includes(i18n._i18nDict.it['port.duplexHalf']), 'il testo');
});

test('pannello porta: senza dichiarazione mostra il campo della lettura, senza `ovr`; vuoto = nessuna voce scelta', () => {
  const letto = pannello(`state.ports['sw1-1'] = { duplex: 'full' }; selType='port'; selId='sw1-1';`);
  assert.deepEqual(scelte(letto), ['full']);
  assert.doesNotMatch(tendina(letto)[0], /class="ovr"/);
  const vuoto = pannello(`state.ports['sw1-1'] = { }; selType='port'; selId='sw1-1';`);
  assert.deepEqual(scelte(vuoto), ['']);
  const dichiaraVince = pannello(`state.ports['sw1-1'] = { duplexOvr: 'full', duplex: 'half' }; selType='port'; selId='sw1-1';`);
  assert.deepEqual(scelte(dichiaraVince), ['full'], 'il dichiarato batte la lettura');
});

test('pannello porta: scegliere il duplex lo salva nello slot della persona, vuoto lo toglie, ripristina azzera', () => {
  const dopo = (js) => JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = []; state.ports = { 'sw1-1': { duplex: 'half' } };
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:4 });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    ${js}
    return JSON.stringify(state.ports['sw1-1']);
  })()`));
  assert.equal(dopo(`setPortField('sw1-1', 'duplexOvr', 'full');`).duplexOvr, 'full');
  assert.equal(dopo(`setPortField('sw1-1', 'duplexOvr', 'full'); setPortField('sw1-1', 'duplexOvr', '');`).duplexOvr, undefined);
  assert.equal(dopo(`setPortField('sw1-1', 'duplexOvr', 'full'); clearPortField('sw1-1', 'duplexOvr');`).duplexOvr, undefined);
  assert.equal(dopo(`setPortField('sw1-1', 'duplexOvr', 'full');`).duplex, 'half', 'la lettura non si tocca');
});

test('pannello cavo: il duplex discordante dei due capi si dice, e quello concorde no', () => {
  const html = (a, b) => pannello(`state.ports['sw1-1'] = ${JSON.stringify(a)}; state.ports['sw2-1'] = ${JSON.stringify(b)}; state.links.push({ id:'l1', src:'sw1-1', dst:'sw2-1' }); selType='link'; selId='l1';`);
  const titolo = i18n._i18nDict.it['cbl.duplex-mismatch.t'];
  assert.ok(html({ duplexOvr: 'full' }, { duplexOvr: 'half' }).includes(titolo), 'full contro half: avviso');
  assert.ok(html({ duplexOvr: 'half' }, { duplex: 'full' }).includes(titolo), 'anche con il campo della lettura sul capo di destinazione');
  assert.ok(html({ duplex: 'half' }, { duplexOvr: 'full' }).includes(titolo), 'e sul capo di partenza');
  assert.ok(!html({ duplexOvr: 'full' }, { duplexOvr: 'full' }).includes(titolo), 'concordi: niente');
  assert.ok(!html({ duplexOvr: 'full' }, {}).includes(titolo), 'un capo non dichiarato: niente');
});

test('pannello porta: il pulsante «ripristina» del duplex c\'e\' solo se il duplex e\' dichiarato', () => {
  const reset = (html) => /data-act="port-clear-render"[^>]*data-pfield="duplexOvr"/.test(html);
  assert.ok(reset(pannello(`state.ports['sw1-1'] = { duplexOvr: 'full' }; selType='port'; selId='sw1-1';`)), 'dichiarato: c\'e\'');
  assert.ok(!reset(pannello(`state.ports['sw1-1'] = { duplex: 'full' }; selType='port'; selId='sw1-1';`)), 'solo letto: non c\'e\' niente da ripristinare');
});

test('tabella porte: una porta con il solo duplex dichiarato ha un override da ripristinare (`has-ovr`)', () => {
  const html = run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = []; state.ports = { 'sw1-1': { duplexOvr: 'full' } };
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:2 });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    return renderPortsTable(nodeById('sw1'));
  })()`);
  assert.deepEqual(html.match(/class="pt-rst[^"]*"/g), ['class="pt-rst has-ovr"', 'class="pt-rst"'], 'la porta 1 si, la 2 no');
});

// ── una definizione sola degli slot della persona ─────────────────────────────────────────────────────────
const PS = require('../lib/port-state.js');
const FP = require('../lib/field-provenance.js');
const { classifyField } = require('../lib/project-schema.js');
const fs = require('fs');

test('slot della persona: l\'elenco e\' uno (stato, velocita\', duplex, VLAN) e dice se la porta ne ha uno compilato', () => {
  assert.deepEqual([...PS.PORT_OVERRIDE_FIELDS], ['statusOvr', 'speedOvr', 'duplexOvr', 'vlanOvr']);
  for (const f of PS.PORT_OVERRIDE_FIELDS) assert.equal(PS.hasPortOverride({ [f]: 'x' }), true, f);
  assert.equal(PS.hasPortOverride({ speedOvr: 0 }), true, 'zero e\' un valore');
  assert.equal(PS.hasPortOverride({ duplexOvr: '' }), true, 'anche il vuoto scritto non e\' assenza (e\' `null`/`undefined` che lo e\')');
  for (const pi of [{}, { speed: 1000, duplex: 'full', vlan: 10, status: 'active', desc: 'x' }, { speedOvr: null }, { duplexOvr: undefined }, null, undefined]) assert.equal(PS.hasPortOverride(pi), false, JSON.stringify(pi));
});

test('slot della persona: «ripristina» toglie tutti e quattro e lascia la lettura e la descrizione', () => {
  const pi = { statusOvr: 'fault', speedOvr: 1000, duplexOvr: 'full', vlanOvr: 20, status: 'active', speed: 100, duplex: 'half', vlan: 10, desc: 'dorsale' };
  PS.clearPortOverrides(pi);
  assert.deepEqual(pi, { status: 'active', speed: 100, duplex: 'half', vlan: 10, desc: 'dorsale' });
  assert.doesNotThrow(() => PS.clearPortOverrides(null));
});

test('slot della persona: ognuno e\' un documento nello schema e ha il suo campo della lettura nel registro della provenienza', () => {
  for (const f of PS.PORT_OVERRIDE_FIELDS) {
    const base = f.replace(/Ovr$/, '');
    assert.equal(classifyField('port', f), 'document', f + ' classificato');
    assert.equal(FP.FIELD_PROVENANCE.port[base] && FP.FIELD_PROVENANCE.port[base].override, f, `port.${base} dice che il suo slot e' ${f}`);
  }
});

test('slot della persona: «adotta la realta\'» e «ripristina» usano l\'elenco, non una copia scritta a mano', () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  assert.match(src('app-drift.js'), /clearPortOverrides\(state\.ports\[pid\]\)/);
  assert.match(src('app-ports.js'), /clearPortOverrides\(state\.ports\[pid\]\)/);
  assert.match(src('app-ports.js'), /hasPortOverride\(pi\)/);
  for (const f of ['app-drift.js', 'app-ports.js']) assert.doesNotMatch(src(f), /delete state\.ports\[pid\]\.(status|speed|duplex|vlan)Ovr/, f + ': una cancellazione a mano di uno slot');
});

test('ripristino di tutti gli override della porta: toglie anche il duplex', () => {
  const dopo = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = []; state.ports = { 'sw1-1': { speedOvr: 1000, duplexOvr: 'full', duplex: 'half' } };
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:4 });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    clearAllPortOverrides('sw1-1');
    return JSON.stringify(state.ports['sw1-1']);
  })()`));
  assert.equal(dopo.duplexOvr, undefined); assert.equal(dopo.speedOvr, undefined);
  assert.equal(dopo.duplex, 'half', 'la lettura resta');
});
