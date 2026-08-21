'use strict';
// ============================================================================
// Il pannello del cavo e la mappa dicono la stessa VLAN
// ============================================================================
// Erano due risposte alla stessa domanda. La mappa usa il modello
// (`lib/link-vlan-color.js`); il pannello usava `_getLinkVlan`, che risponde a
// una domanda DIVERSA — la VLAN **nativa** del collegamento — e la cui scala non
// ha né la sotto-interfaccia né la rete dichiarata dell'endpoint.
//
// Misurato sul banco il 2026-08-21, e trovato dall'utente guardando lo schermo:
// quattro cavi dipinti 99 o 30 (VyOS, Juniper, il controller wireless, il server
// Linux — tutti apparati mono-cablati con l'IP dentro un prefisso dichiarato)
// mentre il pannello scriveva «VLAN 1». Nono punto della stessa classe di bug.
//
// ⚠️ Il campo del pannello è EDITABILE e scrive un override sulla porta attiva:
// pre-compilarlo con un ripiego afferma una cosa che nessuno ha detto. Ora porta
// solo la DICHIARAZIONE, e il resto vive nel placeholder — lo stesso schema che
// il pannello della porta usava già.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (pannello-cavo)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Il caso del banco, ridotto: uno switch muto sul PVID, un endpoint mono-cablato
// con l'IP nel prefisso dichiarato della VLAN 99.
const scenario = (extra = '') => `(() => {
  state = _buildDefaultState();
  state.nodes = []; state.links = []; state.ports = {};
  state.ipam = { vlans:{}, prefixes:[{ cidr:'10.10.99.0/24', vlan:99 }], addresses:[] };
  state.vlanNames = { 99:'MGMT' };
  state.nodes.push({ id:'sw1', type:'switch', name:'SW', ports:2, ip:'10.10.99.1',
                     integration:{ vlans:[1,30,99] } });
  state.nodes.push({ id:'rt1', type:'router', name:'RTR', ports:1, ip:'10.10.99.22' });
  state.links.push({ id:'l1', src:'sw1-2', dst:'rt1-1' });
  ${extra}
  if(typeof _invalidateIdx==='function') _invalidateIdx();
  propagateVlans();
  selType='link'; selId='l1'; renderProps();
  const html = document.getElementById('props-panel').innerHTML || '';
  const i = html.indexOf('<label>VLAN</label>');
  const blocco = i >= 0 ? html.slice(i, i + 1200) : '';
  const inp = blocco.match(/<input[^>]*data-change="link-native-vlan"[^>]*>/);
  const p = _linkPaintVlan(state.links[0]);
  return {
    modello: p.vlan, fonte: p.source,
    nativa: _getLinkVlan(state.links[0]),
    input: inp ? inp[0] : '',
    blocco,
  };
})()`;

test('il pannello mostra la VLAN del MODELLO, non la nativa', () => {
  const o = run(APP.ctx, scenario());
  assert.equal(o.modello, 99, 'la mappa dipinge 99 (rete dichiarata dell’endpoint mono-cablato)');
  assert.equal(o.nativa, 1, 'e la NATIVA resta 1: sono due domande diverse, tutt’e due legittime');
  assert.match(o.input, /placeholder="99"/, 'il pannello propone 99, non 1');
  assert.doesNotMatch(o.input, /value="1"/, 'e non lo scrive come se qualcuno l’avesse dichiarato');
});

test('il campo è VUOTO finché nessuno ha dichiarato: un ripiego non è una scelta', () => {
  const o = run(APP.ctx, scenario());
  assert.match(o.input, /value=""/);
});

test('e porta la DICHIARAZIONE appena c’è', () => {
  const o = run(APP.ctx, scenario(`state.ports['sw1-2'] = { vlanOvr: 30 };`));
  assert.equal(o.modello, 30, 'l’override manuale vince: manual-first');
  assert.match(o.input, /value="30"/, 'ed è scritto nel campo, perché ora qualcuno l’ha detto');
});

test('il nome accompagna il numero mostrato, non quello della nativa', () => {
  // Prima leggeva `vlanNames[nativa]`: su un cavo dipinto 99 mostrava il nome
  // della VLAN 1, cioè quasi sempre nessun nome — e il numero sbagliato.
  const o = run(APP.ctx, scenario());
  assert.match(o.blocco, /MGMT/, 'il nome della 99');
});
