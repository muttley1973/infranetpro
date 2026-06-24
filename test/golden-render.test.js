'use strict';
// ============================================================
// GOLDEN-MASTER RENDER — rete di sicurezza per la UI generata dalla glue.
// Cattura l'innerHTML prodotto da:
//   - pannello Proprietà per OGNI tipo device (scope node)
//   - i 4 scope di selezione (node/port/link/floor)
//   - il render del device sul RACK (innerHTML generato) per alcuni tipi
// e lo confronta con una baseline salvata (test/golden/render-golden.json).
// Qualsiasi cambiamento NON intenzionale dell'output fa fallire il test.
//
// Dopo una modifica VOLUTA all'output, rigenera la baseline e rivedi il diff:
//     UPDATE_GOLDEN=1 node --test test/golden-render.test.js
//
// Limite noto: nello stub DOM manca DOMParser → il render SKIN (_panelSkinRackHtml)
// ritorna '' (fallback). La parte SVG-skin si verifica a mano nel browser; qui si
// blinda tutta la restante glue di rendering (la più toccata e la meno coperta).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const GOLDEN_FILE = path.join(GOLDEN_DIR, 'render-golden.json');

// Costruisce la mappa { scenario -> innerHTML } eseguendo i render reali nel
// contesto app (stub DOM). Deterministico: stato ricreato per ogni scenario.
function buildSnapshots() {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    const snap = {};
    const reset = () => { state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state); _propsExplicit = true; selType=null; selId=null; };
    const panel = () => document.getElementById('props-panel').innerHTML || '';
    const cap = (name, fn) => { try { reset(); fn(); } catch(e){ snap[name] = '__ERR__ '+String(e&&e.message||e); } };

    // A. Pannello Proprietà per ogni tipo device (scope node)
    for (const ty of Object.keys(TYPES)) {
      cap('node:'+ty, () => {
        const id='g_'+ty;
        const n={ id, type:ty, name:'G_'+ty, rackId:state.currentRack, rackU:1, sizeU:1, x:40, y:40, w:60, h:40,
                  ports:(TYPES[ty]&&TYPES[ty].ports)||1, hostname:'h', ip:'10.0.0.1', mac:'00:11:22:33:44:55',
                  radios: ty==='ap'?[{ssid:'S',vlan:30}]:undefined, integration:{}, notes:'n' };
        state.nodes=state.nodes.filter(x=>x.id!==id); state.nodes.push(n);
        if(typeof _invalidateIdx==='function') _invalidateIdx();
        selType='node'; selId=id; renderProps(); snap['node:'+ty]=panel();
      });
    }

    // B. Scope link — cavo router→switch (trunk derivato)
    cap('scope:link', () => {
      const rt={id:'rt',type:'router',name:'RT',rackId:state.currentRack,rackU:1,sizeU:1,radios:[{ssid:'A',vlan:30},{ssid:'B',vlan:40}]};
      const sw={id:'sw',type:'switch',name:'SW',rackId:state.currentRack,rackU:2,sizeU:1};
      state.nodes.push(rt,sw); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const up=_createLinkRecord('rt-1','sw-3'); up.id='goldlink'; state.links.push(up);   // id fisso → output deterministico
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      if(typeof propagateVlans==='function') propagateVlans();
      selType='link'; selId=up.id; renderProps(); snap['scope:link']=panel();
    });

    // C. Scope floor / nessuna selezione
    cap('scope:floor', () => { selType=null; selId=null; renderProps(); snap['scope:floor']=panel(); });

    // D. Scope port — porta su switch
    cap('scope:port', () => {
      const sw={id:'swp',type:'switch',name:'SWP',rackId:state.currentRack,rackU:1,sizeU:1,ports:8};
      state.nodes.push(sw); if(typeof _invalidateIdx==='function') _invalidateIdx();
      selType='port'; selId='swp-1'; renderProps(); snap['scope:port']=panel();
    });

    // E. Render rack generato (innerHTML del device) per alcuni tipi
    const rackCap = (name, build) => cap('rack:'+name, () => {
      const n = build(); state.nodes=state.nodes.filter(x=>x.id!==n.id); state.nodes.push(n);
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      renderAll();
      const ch=document.getElementById('rack-chassis');
      const dev=(ch.children||[]).find(e=>e.dataset && e.dataset.id===n.id);
      snap['rack:'+name] = dev ? (dev.innerHTML||'') : '__NO_DEVICE__';
    });
    rackCap('switch24',     () => ({id:'rk1',type:'switch',name:'RK1',rackId:state.currentRack,rackU:1,sizeU:1,ports:24}));
    rackCap('switch48',     () => ({id:'rk2',type:'switch',name:'RK2',rackId:state.currentRack,rackU:1,sizeU:1,ports:48}));
    rackCap('router-radio', () => ({id:'rk3',type:'router',name:'RK3',rackId:state.currentRack,rackU:1,sizeU:1,ports:8,radios:[{ssid:'X'},{ssid:'Y'}]}));

    return JSON.stringify(snap);
  })()`);
  return JSON.parse(out);
}

// RIATTIVATO come GATE FISSO (2026-06-22): dopo il redesign UX la UI è considerata
// stabile → la baseline corrente è "buona" e il golden gira in `npm test` di default.
//   UPDATE_GOLDEN=1 node --test test/golden-render.test.js   (rigenera la baseline dopo una modifica VOLUTA)
//   SKIP_GOLDEN=1   node --test                              (escape hatch: salta il golden)
const _goldenSkip = process.env.SKIP_GOLDEN
  ? 'golden saltato (SKIP_GOLDEN=1)'
  : false;

test('golden render: nessuno scenario va in errore', { skip: _goldenSkip }, () => {
  const cur = buildSnapshots();
  const errs = Object.keys(cur).filter(k => String(cur[k]).startsWith('__ERR__'));
  assert.equal(errs.length, 0,
    'render in errore:\n' + errs.map(k => `  ${k}: ${cur[k].slice(0, 200)}`).join('\n'));
});

test('golden render: output invariato vs baseline', { skip: _goldenSkip }, () => {
  const cur = buildSnapshots();

  if (process.env.UPDATE_GOLDEN || !fs.existsSync(GOLDEN_FILE)) {
    if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(GOLDEN_FILE, JSON.stringify(cur, null, 1));
    console.log(`golden render: baseline scritta (${Object.keys(cur).length} scenari) → test/golden/render-golden.json`);
    return; // primo run / update → pass
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
  const curKeys = Object.keys(cur).sort();
  const goldKeys = Object.keys(golden).sort();
  assert.deepEqual(curKeys, goldKeys,
    'set di scenari cambiato (aggiunti/rimossi). Se voluto: UPDATE_GOLDEN=1 per rigenerare.');

  const diffs = [];
  for (const k of curKeys) {
    if (cur[k] !== golden[k]) {
      const a = golden[k] || '', b = cur[k] || '';
      let i = 0; while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
      diffs.push(`  ${k} @${i}:\n      golden: ${JSON.stringify(a.slice(Math.max(0, i - 30), i + 30))}\n      now:    ${JSON.stringify(b.slice(Math.max(0, i - 30), i + 30))}`);
    }
  }
  assert.equal(diffs.length, 0,
    `\n${diffs.length} scenari divergono dal golden (regressione UI?).\n` +
    `Se la modifica è VOLUTA: UPDATE_GOLDEN=1 node --test test/golden-render.test.js e rivedi il diff.\n` +
    diffs.join('\n'));
});
