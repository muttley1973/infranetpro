// ============================================================================
// Il pavimento: un cavo che COMMUTA sta sempre in una VLAN
// ============================================================================
// «VLAN non dichiarata» non e' uno stato che esiste nella commutazione. Ogni
// porta di un bridge ha un PVID, e se nessuno l'ha configurato quel PVID e' 1:
// e' l'802.1Q, non una convenzione di un vendor — la VLAN 1 esiste sempre, non
// si cancella, ed e' li' che finisce tutto cio' che nessuno ha assegnato altrove.
// Misurato sul banco: l'Arista risponde PVID 1 su tutte le porte mai toccate, e
// la lista di appartenenza della VLAN 1 le contiene esattamente quelle.
//
// Quindi l'ultimo gradino non e' una lacuna, e' la NATIVA DI SITO: 1 di default,
// dichiarabile diversa (`state.nativeVlan`) da chi lavora con native 99. Il
// numero si vede, e la provenienza dice che e' un default e non una misura.
//
// ⚠️ Sta per ULTIMO apposta. Prima vengono tutte le fonti che sanno qualcosa —
// misura, propagazione, sotto-interfaccia, rete dichiarata, untagged. Se il
// pavimento salisse di un gradino coprirebbe le risposte vere con un numero
// plausibile, che e' la famiglia di difetti da cui e' partita tutta la 2.10.1.
//
// ⚠️ E NON si applica a un cavo INSTRADATO: li' una VLAN non manca, non c'e'.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { linkPaintVlan } = require('../lib/link-vlan-color.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

test('un cavo che commuta e di cui nessuno sa niente sta nella nativa di sito', () => {
  const r = linkPaintVlan({ mode: 'access', vlans: [], siteNative: 1,
    src: { active: true, deviceVlans: [] }, dst: { active: false } });
  assert.equal(r.vlan, 1);
  assert.equal(r.kind, 'vlan');
  assert.equal(r.source, 'site-native');
  assert.equal(r.known, true, 'ha un colore: non e’ piu’ un cavo senza VLAN');
});

test('la nativa di sito e’ DICHIARABILE: chi lavora con native 99 vede 99', () => {
  const r = linkPaintVlan({ mode: 'access', vlans: [], siteNative: 99,
    src: { active: true, deviceVlans: [] }, dst: {} });
  assert.equal(r.vlan, 99);
  assert.equal(r.source, 'site-native');
});

test('il pavimento non copre NESSUNA fonte che sappia qualcosa', () => {
  const base = { mode: 'access', vlans: [], siteNative: 1 };
  const casi = [
    ['ovr',         { src: { active: true, vlanOvr: 42 }, dst: {} }, 42],
    ['measured',    { src: { active: true, vlan: 30, deviceVlans: [1, 30] }, dst: {} }, 30],
    ['prop',        { src: { vlanProp: 20 }, dst: {} }, 20],
    ['subif',       { src: { active: true, subIfVlans: [99] }, dst: {} }, 99],
    ['declared-ip', { src: { active: true }, dst: { singleHomed: true, endpointVlan: 50 } }, 50],
    ['untagged',    { src: { active: true, vlan: 1, deviceVlans: [1] }, dst: {} }, 1],
  ];
  for (const [fonte, ends, atteso] of casi) {
    const r = linkPaintVlan(Object.assign({}, base, ends));
    assert.equal(r.vlan, atteso, `${fonte}: il pavimento non deve scavalcarla`);
    assert.equal(r.source, fonte, `${fonte}: provenienza sbagliata`);
  }
});

test('un cavo INSTRADATO non prende il pavimento: li’ una VLAN non c’e’', () => {
  const r = linkPaintVlan({ mode: 'access', vlans: [], siteNative: 1,
    src: { active: true, ownsIp: true }, dst: { active: true } });
  assert.equal(r.kind, 'routed');
  assert.equal(r.vlan, null, 'la VLAN 1 e’ il pavimento del dominio di commutazione, non dell’universo');
});

test('un trunk multi-VLAN non prende il pavimento: nessuna delle sue vince', () => {
  const r = linkPaintVlan({ mode: 'trunk', vlans: [10, 20, 30], siteNative: 1, src: {}, dst: {} });
  assert.equal(r.kind, 'trunk');
  assert.equal(r.vlan, null);
});

test('senza `siteNative` il pavimento e’ 1 — la VLAN che esiste sempre', () => {
  const r = linkPaintVlan({ mode: 'access', vlans: [], src: { active: true }, dst: {} });
  assert.equal(r.vlan, 1);
  assert.equal(r.source, 'site-native');
});

test('un valore di nativa fuori range non inventa una VLAN: si ricade sulla 1', () => {
  for (const v of [0, 4095, 'x', -3]) {
    const r = linkPaintVlan({ mode: 'access', vlans: [], siteNative: v, src: { active: true }, dst: {} });
    assert.equal(r.vlan, 1, `siteNative=${v}`);
  }
});

// ---- La catena completa, dallo stato dell'app ------------------------------

test('percorso completo: la catena muta prende la nativa dichiarata del progetto', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.nativeVlan = 99;                       // la sede lavora con native 99
    state.nodes.push({ id:'sw1', type:'switch', name:'SW', ports:2 });
    state.nodes.push({ id:'pp1', type:'patchpanel', name:'PP', ports:4 });
    state.links.push({ id:'l1', src:'sw1-2', dst:'pp1-1' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    const p = _linkPaintVlan(state.links[0]);
    return { vlan: p.vlan, source: p.source, kind: p.kind, eff: _effPortVlan('sw1-2') };
  })()`);
  assert.equal(out.vlan, 99);
  assert.equal(out.source, 'site-native');
  assert.equal(out.eff, 99, 'il pannello della porta diceva gia’ la nativa: ora concordano');
});
