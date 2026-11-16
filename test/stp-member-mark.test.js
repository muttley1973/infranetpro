'use strict';
// ============================================================
// STP sul RACK — il membro di un Port-channel bloccato porta il segno (percorso di render VERO).
//
// Un Port-channel è UNA porta per lo spanning-tree: la lettura arriva sull'aggregatore, non sui
// membri, e sul rack il Po logico non ha un LED. Finché il segno restava solo sulla porta che
// portava `stpBlocked`, un canale bloccato era invisibile. La regola sta in lib/port-state.js
// (`portStpBlockedState`) e i renderer la CHIEDONO. Qui si prova il frontale generato davvero,
// nello stub DOM: un membro eredita, una porta bloccata di suo resta bloccata (regressione), una
// porta fuori dal LAG no.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

test('rack: un membro di un Port-channel bloccato porta il segno stp-blocked; una porta diretta pure, una fuori dal LAG no', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      const n = { id:'swx', type:'switch', name:'SWX', rackId:state.currentRack, rackU:1, sizeU:1, ports:4 };
      state.nodes.push(n);
      // L'aggregatore «Port-channel1» è bloccato; NON è una porta del frontale (pid fuori da 1..4).
      state.ports['swx-po'] = { ifName:'Port-channel1', stpBlocked:'blocking' };
      state.ports['swx-1']  = { ifName:'Gi0/1', stpBlocked:'blocking' };        // bloccata DI SUO
      state.ports['swx-2']  = { ifName:'Gi0/2', lagGroup:'g1' };                // membro → eredita
      state.ports['swx-3']  = { ifName:'Gi0/3', lagGroup:'g1' };                // membro → eredita
      state.ports['swx-4']  = { ifName:'Gi0/4' };                               // fuori dal LAG
      state.lagGroups = { g1: 'Port-channel1' };
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      renderAll();
      const ch = document.getElementById('rack-chassis');
      const dev = (ch && ch.children ? Array.prototype.slice.call(ch.children) : []).find(e => e.dataset && e.dataset.id==='swx');
      const html = dev ? (dev.innerHTML||'') : '';
      const clsOf = (pid) => { const m = new RegExp('class="([^"]*)"\\\\s+data-pid="'+pid+'"').exec(html); return m ? m[1] : null; };
      return JSON.stringify({ ok:true, found: !!dev,
        p1: clsOf('swx-1'), p2: clsOf('swx-2'), p3: clsOf('swx-3'), p4: clsOf('swx-4') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'il render lancia: ' + r.err);
  assert.ok(r.found, 'il device SWX deve comparire nel rack');
  assert.ok(/\bstp-blocked\b/.test(r.p1 || ''), 'una porta bloccata di suo resta marcata (regressione): ' + r.p1);
  assert.ok(/\bstp-blocked\b/.test(r.p2 || ''), 'il membro del Po bloccato eredita il segno: ' + r.p2);
  assert.ok(/\bstp-blocked\b/.test(r.p3 || ''), 'anche l\'altro membro: ' + r.p3);
  assert.ok(!/\bstp-blocked\b/.test(r.p4 || ''), 'una porta fuori dal LAG non è marcata: ' + r.p4);
});
