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
        if(ty==='pdu') n.powerOutlets=[{name:'P1',status:'active'},{name:'P2',status:'fault'},{name:'P3',status:'inactive'}];
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

    // D-bis. Scope port — tappa PASSIVA (patch panel) con un cavo dentro. Caso
    // distinto dallo switchport: qui velocita' e VLAN non sono della porta (le
    // decide lo switch a monte e si propagano), ma lo STATO si' — «occupata da un
    // cavo» e' un fatto del pannello. Il golden lo blinda perche' era la meta' non
    // coperta: una porta col cavo dentro resa identica a una libera passava liscia.
    cap('scope:port-passive', () => {
      const pp={id:'ppg',type:'patchpanel',name:'PPG',rackId:state.currentRack,rackU:3,sizeU:2,ports:24};
      const sw={id:'swg',type:'switch',name:'SWG',rackId:state.currentRack,rackU:1,sizeU:1,ports:8};
      state.nodes.push(pp,sw); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const lk=_createLinkRecord('ppg-1','swg-1'); lk.id='goldpasslink'; state.links.push(lk);
      state.ports['ppg-1']={ status:'active' };   // come lo scrive chi collega il cavo
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      selType='port'; selId='ppg-1'; renderProps(); snap['scope:port-passive']=panel();
    });

    // D-ter. Scope PDU power outlet: editor dedicato, senza entrare nel dominio
    // delle porte Ethernet e senza creare un endpoint cablabile.
    cap('scope:pdu-outlet', () => {
      const pdu={id:'pdug',type:'pdu',name:'PDUG',rackId:state.currentRack,rackU:4,sizeU:1,pduOutletCount:4,
                 powerOutlets:[{id:11,name:'P1',status:'enabled',statusOvr:'fault',connectedTo:{deviceName:'Server-01',name:'PSU-1',type:'powerport'}}]};
      const server={id:'serverg',type:'server',name:'Server-01',rackId:state.currentRack,rackU:6,sizeU:2,ports:4};
      state.nodes.push(pdu,server); if(typeof _invalidateIdx==='function') _invalidateIdx();
      selType='pdu-outlet'; selId='pdug::11'; renderProps(); snap['scope:pdu-outlet']=panel();
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
    rackCap('pdu48',         () => ({id:'rkpdu',type:'pdu',name:'PDU48',rackId:state.currentRack,rackU:1,sizeU:1,ports:1,spec:{pduOutletCount:48,pduMgmtMode:'ethernet',pduEthernetPorts:1,pduSensorPorts:2,pduUsbPorts:2}}));

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

test('golden render: PDU separa prese power e management', () => {
  const cur = buildSnapshots();
  const html = cur['rack:pdu48'] || '';
  assert.equal((html.match(/pdu-power-outlet/g) || []).length, 48);
  assert.equal((html.match(/pdu-power-outlet inactive/g) || []).length, 48);
  assert.match(html, /pdu-management-ports/);
  assert.match(html, /pdu-auxiliary-ports/);
  assert.doesNotMatch(html, /pdu-power-outlet[^>]*data-pid=/);
  assert.doesNotMatch(html, /pdu-aux-port[^>]*data-pid=/);
  assert.match(html, /data-pdu-selection="rkpdu::1"/);
  assert.match(html, /data-pdu-label="P1" data-pdu-number="1"/);
  assert.match(html, /data-pid="rkpdu-1"/);
});

test('golden render: PDU property panel separates network and auxiliary ports', () => {
  const cur = buildSnapshots();
  const html = cur['node:pdu'] || '';
  assert.match(html, /data-nfield="pduMgmtMode"/);
  assert.match(html, /data-nfield="pduEthernetPorts"/);
  assert.match(html, /data-nfield="pduSensorPorts"/);
  assert.match(html, /data-nfield="pduUsbPorts"/);
  assert.match(html, /data-nfield="pduExpansionPorts"/);
  assert.doesNotMatch(html, /data-fpkey="mgmtCount"/);
});

test('golden render: PDU property panel mostra lo stato delle prese power', () => {
  const cur = buildSnapshots();
  const html = cur['node:pdu'] || '';
  assert.match(html, /Stato prese power/);
  assert.match(html, /3 /);
  assert.match(html, /Fault/);
});

test('golden render: power outlet ha editor manual-first separato dalle porte di rete', () => {
  const cur = buildSnapshots();
  const html = cur['scope:pdu-outlet'] || '';
  // Il sottotitolo porta il TIPO dell'apparato («PDU · …», «UPS · …») e poi la cosa
  // selezionata, che e' una presa e basta: dirle «presa PDU» su un UPS era la stessa
  // svista per cui quelle prese non entravano nemmeno.
  assert.match(html, /PDU · Presa di alimentazione/);
  assert.match(html, /pdu-outlet-connection-section/);
  assert.match(html, /prop-row2 pdu-outlet-connection-fields/);
  assert.match(html, /prop-group pdu-outlet-connection-field/);
  assert.match(html, /data-change="pdu-connection-field"/);
  assert.match(html, /data-pfield="deviceId"/);
  assert.match(html, /data-pfield="portName"/);
  assert.match(html, /data-change="pdu-outlet-field"/);
  assert.match(html, /data-pfield="statusOvr"/);
  assert.match(html, /pdu-outlet-status-editor/);
  assert.match(html, /pdu-outlet-status-reset/);
  assert.doesNotMatch(html, /value="idle"/);
  assert.match(html, /Manuale/);
  assert.match(html, /Device collegato/);
  assert.match(html, /Server-01/);
  assert.match(html, /PSU-1/);
  // Il fatto non si perde, si divide: la RIGA dice cos'e` la presa, il TOOLTIP
  // cosa non fa. Se una delle due meta` sparisce, il riquadro sta mentendo per
  // omissione — quindi il test pretende tutt'e due.
  assert.match(html, /Presa di alimentazione, non porta Ethernet/);
  assert.match(html, /data-tip="Non crea cavi di rete\."/);
});

// Ospitare macchine virtuali e' una CAPACITA' del tipo (TYPES.hostsVms), non un
// privilegio di «hypervisor»: uno storage Synology/QNAP le ospita con un pacchetto
// e resta uno storage. Il pannello deve offrire la sezione a TUTTI e SOLI i tipi
// che la dichiarano — e l'atteso si LEGGE dal catalogo invece di essere ricopiato
// qui: due elenchi della stessa cosa divergono al primo ritocco.
test('golden render: la sezione VM sta su tutti e soli i tipi che ospitano VM', () => {
  const cur = buildSnapshots();
  const APP = loadApp(ROOT);
  const capaci = run(APP.ctx, 'Object.keys(TYPES).filter(k => !!TYPES[k].hostsVms).sort()');
  assert.ok(capaci.length >= 5, 'il catalogo deve dichiarare dei tipi che ospitano VM');

  const conSezione = Object.keys(cur)
    .filter(k => k.indexOf('node:') === 0 && String(cur[k]).includes('data-vm-dropzone'))
    .map(k => k.slice(5)).sort();
  assert.deepEqual(conSezione, capaci,
    'la sezione «Macchine virtuali» segue TYPES.hostsVms: né un tipo in più né uno in meno');

  // E la sezione e' quella VERA, non un guscio: lista, invito al drop e bottone.
  for (const ty of capaci) {
    const html = cur['node:' + ty] || '';
    assert.match(html, /data-act="hv-add-vm"/, ty + ': manca il bottone «Aggiungi VM»');
    assert.match(html, /class="vm-import-dz"/, ty + ': manca la zona di importazione');
    assert.match(html, /data-section="hv-vms"/, ty + ': manca la fisarmonica delle VM');
  }
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
