'use strict';
// Toggle «Modalità AP» (opt-in): un device wifi-capable NON nativamente AP (pc/server…)
// può TRASMETTERE SSID senza cambiare tipo. setDeviceApMode(id,on) imposta node.apMode →
// _canServeSsid true → il pannello radio mostra l'editor SSID (invece dell'hint client).
// Spegnendola cancella i BSS orfani (niente "SSID fantasma" su un client).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (ap-mode)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('modalità AP: un pc con radio mostra l\'editor SSID SOLO con apMode; senza → hint client', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'pc1', type:'pc', name:'Hotspot', ports:1, radios:[{}] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const render = () => { const el = document.createElement('div'); _renderRadioProps(el, 'pc1-radio'); return el.innerHTML || ''; };
    const off = render();                    // pc client: nessun editor SSID
    setDeviceApMode('pc1', true);
    const on = render();                     // pc in modalità AP: editor SSID sbloccato
    return JSON.stringify({
      apModeAfter: !!nodeById('pc1').apMode,
      offHasEditor: /<select/.test(off),
      onHasEditor:  /<select/.test(on),
    });
  })()`));
  assert.equal(r.apModeAfter, true, 'setDeviceApMode ha impostato node.apMode');
  assert.equal(r.offHasEditor, false, 'senza apMode: il pc è un client → nessun editor SSID');
  assert.equal(r.onHasEditor, true, 'con apMode: editor SSID/PHY sbloccato (capacità ≠ tipo)');
});

test('un AP nativo mostra l\'editor SSID senza bisogno di apMode', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'ap1', type:'ap', name:'AP', ports:1, radios:[{}] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const el = document.createElement('div'); _renderRadioProps(el, 'ap1-radio');
    return JSON.stringify({ hasEditor: /<select/.test(el.innerHTML || ''), apMode: !!nodeById('ap1').apMode });
  })()`));
  assert.equal(r.hasEditor, true, 'l\'AP nativo (wifiServe) serve SSID per tipo');
  assert.equal(r.apMode, false, 'senza flag apMode: è il tipo a decidere');
});

test('spegnere la modalità AP cancella i BSS orfani (niente SSID fantasma su un client)', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'pc2', type:'pc', ports:1, apMode:true, radios:[{ ssids:[{ id:'s1', ssid:'Hot', vlan:1 }] }] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    setDeviceApMode('pc2', false);
    const n = nodeById('pc2');
    return JSON.stringify({ apMode: !!n.apMode, ssids: ((n.radios[0]||{}).ssids||[]).length });
  })()`));
  assert.equal(r.apMode, false, 'flag apMode rimosso');
  assert.equal(r.ssids, 0, 'i BSS orfani sono cancellati (device torna client puro)');
});
