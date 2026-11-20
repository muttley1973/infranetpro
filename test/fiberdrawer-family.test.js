'use strict';
// ============================================================
//  IL CASSETTO OTTICO E' UN PASSIVO PASS-THROUGH COME IL PATCH PANEL: STESSO PANNELLO, STESSE FUNZIONI
// ============================================================
// Un cassetto ottico non ha IP, MAC, SNMP, porte SFP o MGMT: e' un passivo, ogni porta e' una tappa del cavo.
// Il pannello Proprieta' deve dire solo quello che e' vero di un passivo (hostname, tipologia, porte), e il cassetto
// deve entrare nelle funzioni di InfraNet in cui il patch panel gia' c'e': numerazione in serie, nome delle prese nelle
// descrizioni di porta, tappa del cavo, import dal DCIM. Una DEFINIZIONE sola («famiglia dei pannelli», `patchLike`):
// i `type === 'patchpanel'` sparsi erano esattamente il modo in cui il cassetto restava fuori da tutto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const dcim = require('../lib/dcim-map');

const ROOT = path.join(__dirname, '..');
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const dalCodice = (espressione) => JSON.parse(run(APP.ctx, `JSON.stringify((() => { try { return ${espressione}; } catch (e) { return { __err: String(e && e.message || e) }; } })())`));

function pannello(type, extra) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    _propsExplicit = true;
    const n = Object.assign({ id: 'x1', type: ${JSON.stringify(type)}, name: 'X', rackId: state.currentRack, rackU: 1, sizeU: ${type === 'patchpanel' ? 2 : 1}, ports: 24 }, ${JSON.stringify(extra || {})});
    state.nodes.push(n); if (typeof _invalidateIdx === 'function') _invalidateIdx();
    selType = 'node'; selId = 'x1'; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
}
const sezione = (html, id) => { const m = new RegExp(`<details[^>]*data-section="${id}"[\\s\\S]*?</details>`).exec(html); return m ? m[0] : ''; };
const campi = (html) => [...new Set([...html.matchAll(/data-nfield="(\w+)"|data-fpkey="(\w+)"|data-change="(update-hostname|node-[\w-]+|mgmt[\w-]*)"/g)].map((m) => m[1] || m[2] || m[3]))].sort();

// ── Il pannello ────────────────────────────────────────────────────────────────────────────────────────
test('«Rete & accesso» del cassetto = quella del patch panel: SOLO l\'hostname (niente IP, IPv6, protocollo, URL)', () => {
  const pp = campi(sezione(pannello('patchpanel', { ppMedia: 'fiber' }), 'network-access'));
  const fd = campi(sezione(pannello('fiberdrawer', { spec: { ppFiberConnector: 'lc-duplex' } }), 'network-access'));
  assert.deepEqual(pp, ['update-hostname'], 'il riferimento: il patch panel ha solo l\'hostname');
  assert.deepEqual(fd, pp, 'il cassetto ha gli stessi campi');
});

test('«Layout porte» del cassetto = quella del patch panel: numero porte, layout, numerazione in serie; niente SFP/MGMT', () => {
  const pp = campi(sezione(pannello('patchpanel', { ppMedia: 'fiber' }), 'layout-ports'));
  const fd = campi(sezione(pannello('fiberdrawer', { spec: { ppFiberConnector: 'lc-duplex' } }), 'layout-ports'));
  assert.ok(pp.includes('ppContinueFrom') && pp.includes('ppStartNum'), 'il riferimento ha la numerazione progressiva');
  assert.deepEqual(fd, pp, 'il cassetto ha gli stessi campi');
  assert.ok(!fd.includes('sfpCount'), 'nessuna porta SFP su un cassetto ottico');
});

test('il pannello del cassetto non dice nulla di un apparato attivo, in nessuna sezione', () => {
  const html = pannello('fiberdrawer', { spec: { ppFiberConnector: 'lc-duplex' }, ip: '10.0.0.5', mac: '00:11:22:33:44:55' });
  for (const campo of ['node-ip6', 'mgmtProto', 'mgmtUrl', 'sfpCount', 'node-field-manual']) assert.ok(!html.includes(campo), campo);
  assert.doesNotMatch(html, /Indirizzo IP|Indirizzo IPv6|Porte SFP|MGMT/);
  assert.match(html, /data-nfield="ppFiberConnector"/, 'resta la tipologia in fibra');
  assert.match(html, /update-hostname/, 'resta l\'hostname');
});

test('gli altri tipi non cambiano: uno switch ha ancora IP e SFP, il patch panel in rame ancora le sue categorie', () => {
  const sw = pannello('switch', {});
  assert.match(sw, /Indirizzo IP/);
  assert.match(sw, /sfpCount|Porte SFP/);
  assert.match(pannello('patchpanel', { ppMedia: 'copper' }), /data-nfield="ppCopperCat"/);
});

// ── La numerazione in serie (catena «continua da» / «parti dal numero») ─────────────────────────────────
const SCENARIO = `(() => {
  state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
  const rid = state.currentRack;
  state.nodes = []; state.links = []; state.ports = {};   // niente demo: gli id del test sono i soli
  state.nodes.push(
    { id: 'fd1', type: 'fiberdrawer', name: 'ODF-1', rackId: rid, rackU: 1, sizeU: 1, ports: 24 },
    { id: 'fd2', type: 'fiberdrawer', name: 'ODF-2', rackId: rid, rackU: 2, sizeU: 1, ports: 24, frontPanel: { ppContinueFrom: 'fd1' } },
    { id: 'fd3', type: 'fiberdrawer', name: 'ODF-3', rackId: rid, rackU: 3, sizeU: 1, ports: 12, frontPanel: { ppStartNum: 101 } },
    { id: 'pp1', type: 'patchpanel', name: 'PP-1', rackId: rid, rackU: 4, sizeU: 2, ports: 24 },
    { id: 'pp2', type: 'patchpanel', name: 'PP-2', rackId: rid, rackU: 6, sizeU: 2, ports: 24, frontPanel: { ppContinueFrom: 'pp1' } },
  );
  if (typeof _invalidateIdx === 'function') _invalidateIdx();
`;

test('un cassetto puo\' continuare la numerazione di un altro: ODF-2 riparte dopo le 24 porte di ODF-1', () => {
  const r = dalCodice(SCENARIO + `
    const fd2 = state.nodes.find(n => n.id === 'fd2'), fd3 = state.nodes.find(n => n.id === 'fd3'), fd1 = state.nodes.find(n => n.id === 'fd1');
    return { off1: _patchPanelOffset(fd1), off2: _patchPanelOffset(fd2), off3: _patchPanelOffset(fd3),
      lab2: _frontPanelPortLabel(fd2, 1, 24), lab2b: _frontPanelPortLabel(fd2, 24, 24), lab3: _frontPanelPortLabel(fd3, 1, 12), lab1: _frontPanelPortLabel(fd1, 5, 24),
      tip: String(portTip('fd2-3')).match(/Porta [0-9]+/)[0] };
  })()`);
  assert.deepEqual(r, { off1: 0, off2: 24, off3: 100, lab2: '25', lab2b: '48', lab3: '101', lab1: '5', tip: 'Porta 27' });
});

test('la catena resta fra pannelli dello STESSO tipo: un cassetto non continua un patch panel, ne\' viceversa', () => {
  const r = dalCodice(SCENARIO + `
    const id = (x) => x.map(n => n.id).sort();
    const get = (i) => state.nodes.find(n => n.id === i);
    return { perFd2: id(_patchPanelChainOptions(get('fd2'))), perFd1: id(_patchPanelChainOptions(get('fd1'))),
      perPp1: id(_patchPanelChainOptions(get('pp1'))), perPp2: id(_patchPanelChainOptions(get('pp2'))) };
  })()`);
  assert.deepEqual(r.perFd1, ['fd3'], 'ODF-1: gli altri cassetti, non ODF-2 (a valle, farebbe un ciclo) e non i patch panel');
  assert.deepEqual(r.perFd2, ['fd1', 'fd3'], 'ODF-2: i cassetti, mai i patch panel');
  assert.deepEqual(r.perPp1, [], 'PP-1: PP-2 e\' a valle, i cassetti non c\'entrano');
  assert.deepEqual(r.perPp2, ['pp1'], 'PP-2: solo patch panel');
});

test('la catena ignora i legami fra tipi diversi anche quando decide chi e\' «a valle» (nessun ciclo fantasma)', () => {
  // dato sbagliato: PP-1 continua da ODF-1, ODF-1 continua da PP-2. Fra pannelli dello stesso tipo non c'e' nessun legame,
  // quindi PP-1 non e' «a valle» di PP-2 e PP-2 puo' continuare da PP-1.
  const r = dalCodice(`(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    const rid = state.currentRack;
    state.nodes = []; state.links = []; state.ports = {};
    state.nodes.push({ id: 'pp1', type: 'patchpanel', name: 'PP-1', rackId: rid, rackU: 4, sizeU: 2, ports: 24, frontPanel: { ppContinueFrom: 'fd1' } },
      { id: 'pp2', type: 'patchpanel', name: 'PP-2', rackId: rid, rackU: 6, sizeU: 2, ports: 24 },
      { id: 'fd1', type: 'fiberdrawer', name: 'ODF-1', rackId: rid, rackU: 1, sizeU: 1, ports: 24, frontPanel: { ppContinueFrom: 'pp2' } });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    return _patchPanelChainOptions(state.nodes.find(n => n.id === 'pp2')).map(n => n.id);
  })()`);
  assert.deepEqual(r, ['pp1']);
});

test('«continua da» ha senso solo per un pannello: per uno switch non ci sono opzioni', () => {
  const r = dalCodice(`(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    const rid = state.currentRack;
    state.nodes = []; state.links = []; state.ports = {};
    state.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-1', rackId: rid, rackU: 1, sizeU: 1, ports: 24 }, { id: 'sw2', type: 'switch', name: 'SW-2', rackId: rid, rackU: 2, sizeU: 1, ports: 24 });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    return { sw: _patchPanelChainOptions(state.nodes[0]).length, nullo: _patchPanelChainOptions(null).length, off: _patchPanelOffset(state.nodes[0]) };
  })()`);
  assert.deepEqual(r, { sw: 0, nullo: 0, off: 0 });
});

test('un riferimento «continua da» verso un tipo diverso non fa niente (dato vecchio o sbagliato)', () => {
  const r = dalCodice(`(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    const rid = state.currentRack;
    state.nodes = []; state.links = []; state.ports = {};
    state.nodes.push({ id: 'pp1', type: 'patchpanel', name: 'PP-1', rackId: rid, rackU: 4, sizeU: 2, ports: 24 },
      { id: 'fd1', type: 'fiberdrawer', name: 'ODF-1', rackId: rid, rackU: 1, sizeU: 1, ports: 24, frontPanel: { ppContinueFrom: 'pp1' } });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    return _patchPanelOffset(state.nodes.find(n => n.id === 'fd1'));
  })()`);
  assert.equal(r, 0);
});

test('il patch panel non e\' cambiato: PP-2 continua da PP-1', () => {
  const r = dalCodice(SCENARIO + `return { off: _patchPanelOffset(state.nodes.find(n => n.id === 'pp2')), lab: _frontPanelPortLabel(state.nodes.find(n => n.id === 'pp2'), 1, 24) };
  })()`);
  assert.deepEqual(r, { off: 24, lab: '25' });
});

// ── DCIM: i ruoli che la gente scrive davvero ───────────────────────────────────────────────────────────
test('DCIM: un ruolo «fiber-drawer», «fiber-patch-panel» o «odf» diventa un cassetto ottico, non un apparato generico', () => {
  for (const slug of ['fiber-drawer', 'fibre-drawer', 'fiber-patch-panel', 'fibre-patch-panel', 'odf']) {
    const nb = {
      deviceRoles: [{ id: 30, slug, name: 'Fibre' }],
      racks: [{ id: 31, name: 'R1', u_height: 42 }],
      devices: [{ id: 301, name: 'ODF-A', role: { id: 30 }, rack: { id: 31 }, position: 10 }],
    };
    const { state } = dcim.netboxToState(nb);
    assert.equal(state.nodes.find((n) => n.id === 'nb-dev-301').type, 'fiberdrawer', slug);
  }
  const pp = dcim.netboxToState({ deviceRoles: [{ id: 22, slug: 'patch-panel', name: 'PP' }], racks: [{ id: 31, name: 'R1', u_height: 42 }], devices: [{ id: 201, name: 'PP1', role: { id: 22 }, rack: { id: 31 }, position: 10 }] });
  assert.equal(pp.state.nodes[0].type, 'patchpanel', 'il patch panel resta com\'e\'');
});

// ── La DEFINIZIONE unica: nessun `type === 'patchpanel'` sparso nel codice di runtime ───────────────────────
test('la famiglia dei pannelli e\' una definizione sola: il flag del catalogo e un helper, non i confronti sparsi', () => {
  assert.equal(dalCodice('TYPES.patchpanel.patchLike'), true);
  assert.equal(dalCodice('TYPES.fiberdrawer.patchLike'), true);
  for (const t of ['switch', 'wallport', 'blankpanel', 'ups']) assert.notEqual(dalCodice(`!!TYPES.${t}.patchLike`), true, t);
  assert.deepEqual(dalCodice("[isPatchLike('patchpanel'), isPatchLike({type:'fiberdrawer'}), isPatchLike('switch'), isPatchLike(null), isPatchLike('')]"), [true, true, false, false, false]);
});

test('ratchet: i confronti con \'patchpanel\' che restano nel runtime sono solo quelli di TIPOLOGIA (rame/fibra del patch panel)', () => {
  // Chi vuole sapere «e' un pannello passivo?» usa isPatchLike; confrontare col nome del tipo e' giusto solo dove la
  // domanda e' «e' proprio un patch panel?» — la sezione Patch Panel (categoria rame/fibra/misto) e il catalogo.
  const AMMESSI = { 'src/app-properties-node.js': 1 };
  const trovati = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter((x) => x.endsWith('.js'))) {
    const righe = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').split('\n');
    righe.forEach((r) => { if (/\.type\s*={2,3}\s*'patchpanel'|type\s*!={1,2}\s*'patchpanel'/.test(r) && !/^\s*(\/\/|\*)/.test(r)) trovati['src/' + f] = (trovati['src/' + f] || 0) + 1; });
  }
  assert.deepEqual(trovati, AMMESSI, 'confronti con \'patchpanel\' fuori dai posti ammessi: ' + JSON.stringify(trovati));
});
