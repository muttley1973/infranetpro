'use strict';
// ============================================================
// SMOKE E2E — carica TUTTA l'app (app.js + lib/app-*.js) in un DOM finto
// (zero dipendenze, node:vm + test/helpers/dom-stub.js) ed esercita i percorsi
// di rendering. Cattura la classe di regressioni invisibile ai test puri:
// ordine script sbagliato, simbolo globale mancante, crash di renderProps/
// renderAll. Rete di sicurezza per i refactoring del glue (R-series) e per la
// futura decomposizione di renderProps.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// Carica una sola volta: se il load lancia, TUTTI i test falliscono (giusto).
let APP;
test('load: tutti gli script di netmapper.html caricano senza errori', () => {
  APP = loadApp(ROOT);
  assert.ok(APP.files.length > 10, `attesi molti script, trovati ${APP.files.length}`);
});

test('load: le funzioni di ingresso chiave sono definite (ordine script ok)', () => {
  // Lo stub carica anche /dist/app.bundle.js (è uno <script src> in netmapper.html):
  // le funzioni migrate restano disponibili nel contesto (es. pollAllSNMP).
  const fns = ['renderAll', 'renderProps', 'renderCables', 'init', 'pollAllSNMP',
    'switchRightTab', 'discoverTopology', 'buildDriftReport', 'validateCable',
    'runDriftCheck', '_buildDefaultState', 'nodeById'];
  const missing = fns.filter(f => typeof APP.ctx[f] !== 'function');
  assert.deepEqual(missing, [], `funzioni mancanti (regressione ordine/scope): ${missing.join(', ')}`);
});

test('render: progetto di default → renderAll non lancia', () => {
  const out = run(APP.ctx, `(() => {
    try { state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state); if(typeof _invalidateIdx==='function') _invalidateIdx();
          renderAll(); renderCables(); return 'ok'; }
    catch(e){ return 'ERR: ' + (e && e.stack || e); }
  })()`);
  assert.equal(out, 'ok', out);
});

test('render: renderProps su OGNI tipo di device senza crash', () => {
  const json = run(APP.ctx, `(() => {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    const types = Object.keys(TYPES);
    const res = []; let i = 0;
    for (const t of types) {
      try {
        const n = { id:'smoke-'+(i++), type:t, name:'S', x:10, y:10, w:60, h:40 };
        if (TYPES[t] && TYPES[t].ports) n.ports = TYPES[t].ports;
        state.nodes.push(n);
        if (typeof _invalidateIdx==='function') _invalidateIdx();
        selType = 'node'; selId = n.id;
        renderProps();
        res.push({ t, ok:true });
      } catch(e) { res.push({ t, ok:false, err: String(e && e.message || e) }); }
    }
    return JSON.stringify(res);
  })()`);
  const res = JSON.parse(json);
  const failed = res.filter(r => !r.ok);
  assert.equal(failed.length, 0, 'renderProps lancia su: ' + failed.map(f => `${f.t} (${f.err})`).join(' · '));
  assert.ok(res.length > 15, `attesi >15 tipi, trovati ${res.length}`);
});

test('render: pannello cavo (link) → renderProps + validateCable senza crash', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      const a = { id:'la', type:'switch', name:'A', x:0,   y:0, w:60, h:40, ports:8 };
      const b = { id:'lb', type:'switch', name:'B', x:120, y:0, w:60, h:40, ports:8 };
      state.nodes.push(a, b); if(typeof _invalidateIdx==='function') _invalidateIdx();
      state.ports['la-1'] = { speed:10000, snmpMedium:'fiber' };
      state.ports['lb-1'] = {};
      // link ben formato col costruttore reale, poi campi "cattivi" apposta:
      // Rame + Cat5e + 10G + 130m → deve attivare ≥3 validazioni.
      const lk = (typeof _createLinkRecord === 'function')
        ? _createLinkRecord('la-1', 'lb-1')
        : { id:'lk1', src:'la-1', dst:'lb-1' };
      Object.assign(lk, { medium:'copper', cableCategory:'Cat5e', maxSpeed:'10G', length:130 });
      state.links.push(lk);
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      selType = 'link'; selId = lk.id;
      renderProps();
      const issues = validateCable(lk, { snmpSpeedMbps:10000, snmpMedium:'fiber' });
      return JSON.stringify({ ok:true, issues: issues.length });
    } catch(e) { return JSON.stringify({ ok:false, err: String(e && e.stack || e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'render link lancia: ' + r.err);
  assert.ok(r.issues >= 3, `attese ≥3 incompatibilità sul cavo cattivo, trovate ${r.issues}`);
});

// MIGRATO A ESM: la glue "porte libere" (ex lib/app-spare.js) ora vive nel
// bundle esbuild (src/app-spare.js) e NON è caricabile dal DOM-stub (node:vm).
// La copertura si è spostata sul browser reale: vedi il test "bundle esbuild:
// i moduli ESM migrati …" in test/e2e/critical-flows.test.js (apre il report
// Porte libere e verifica le righe). Il modulo puro resta coperto da
// buildSpareReport. Questo smoke resta come segnaposto della migrazione.
test('render: porte libere — report + toggle highlight senza crash', { skip: 'migrato al bundle ESM → coperto da test/e2e (RUN_E2E=1)' }, () => {});

test('render: mappa L3 (gateway VLAN→device) — report + badge + SVI + overlay senza crash', { skip: 'migrato al bundle ESM (src/app-l3.js) → coperto da test/e2e (RUN_E2E=1)' }, () => {});

test('render: adotta non documentati — candidati + creazione nodi + modal senza crash', { skip: 'migrato al bundle ESM (src/app-drift-adopt.js) → coperto da test/e2e (RUN_E2E=1)' }, () => {});

test('render: il cavo floor parte coerente con la direzione dominante (niente "virgola" sul nome)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      document.getElementById('export-area').clientWidth = 1000;   // forza il ramo floor (x < 550)
      const cps = d => { const m = d.match(/C ([\\-\\d.]+) ([\\-\\d.]+),([\\-\\d.]+) ([\\-\\d.]+),/);
                         return { c1x:+m[1], c1y:+m[2], c2x:+m[3], c2y:+m[4] }; };
      const vert = cps(getCablePath(100,100,120,320));   // dy≫dx → partenza VERTICALE
      const horz = cps(getCablePath(100,100,420,120));   // dx≫dy a DESTRA
      const left = cps(getCablePath(420,100,100,120));   // dx≫dy a SINISTRA (provenienza sx)
      const shortV = cps(getCablePath(100,100,120,160));  // cavo CORTO verticale (ex-cappio)
      return JSON.stringify({ ok:true, vertCpX:vert.c1x, horzCpY:horz.c1y,
        // provenienza-coerente: verso destra il control point va a destra (c1x>x1),
        // verso sinistra va a sinistra (c1x<x1) — niente giro intorno al tile.
        rightTowardDest: horz.c1x > 100, leftTowardDest: left.c1x < 420,
        // niente "nodo": su un cavo corto i control point non si scavalcano (c1y ≤ c2y).
        shortNoCross: shortV.c1y <= shortV.c2y });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'getCablePath lancia: ' + r.err);
  assert.equal(r.vertCpX, 100, 'cavo verticale: il primo control point ha x=x1 → parte dritto in verticale');
  assert.equal(r.horzCpY, 100, 'cavo orizzontale: il primo control point ha y=y1 → parte dritto in orizzontale');
  assert.ok(r.rightTowardDest, 'connessione verso destra: control point a destra (si attacca dal lato giusto)');
  assert.ok(r.leftTowardDest, 'connessione verso sinistra: control point a sinistra (niente giro attorno al tile)');
  assert.ok(r.shortNoCross, 'cavo corto: i control point non si scavalcano → niente nodo/cappio');
});

test('render: associazione wireless radio↔radio — flag + onda + pannelli senza crash', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      // AP con radio serving (SSID) + repeater con radio station.
      const a={id:'wa',type:'ap',name:'AP',x:0,y:0,w:60,h:40,ports:4,radios:[{band:'5',channel:44,ssids:[{id:'t1',ssid:'Test',security:'wpa3-personal'}]}]};
      const b={id:'wb',type:'pc',name:'Repeater',x:200,y:0,w:60,h:40,ports:1,radios:[{}]};
      state.nodes.push(a,b); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const lk = _createLinkRecord('wa-radio','wb-radio');
      state.links.push(lk); if(typeof _invalidateIdx==='function') _invalidateIdx();
      setLinkWireless(lk.id, true);
      selType='node'; selId='wa'; renderProps();    // gestore interfacce radio dell'AP
      selType='port'; selId='wa-radio'; renderProps(); // pannello della singola radio
      selType='link'; selId=lk.id; renderProps();    // pannello associazione (eredita)
      const wifiHtml = _wifiCfgHtml(a.radios[0],'wa',0), assocHtml = _wifiAssocHtml(lk);
      const wave = buildWavePath(0,0,120,0);
      return JSON.stringify({ ok:true, wireless: !!lk.wireless, waveHasPoints: wave.split('L').length>5,
        cfgHasSsid: wifiHtml.indexOf('Test')>=0, assocInherits: assocHtml.indexOf('Test')>=0 });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'wireless lancia: ' + r.err);
  assert.ok(r.wireless, 'il flag link.wireless dovrebbe essere true');
  assert.ok(r.waveHasPoints, 'la wave dovrebbe avere molti punti (onda fluida)');
  assert.ok(r.cfgHasSsid, 'il pannello della radio deve mostrare lo SSID');
  assert.ok(r.assocInherits, 'associazione: deve ereditare lo SSID dalla radio serving');
});

test('radio: solo radio↔radio (mix=invalid) + multi-interfaccia + render senza crash', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      const ap={id:'apx',type:'ap',name:'AP',x:10,y:10,w:60,h:40,ports:4,radios:[{ssids:[{id:'o1',ssid:'Off'}]}]};
      const cl={id:'clx',type:'pc',name:'Repeater',x:200,y:10,w:60,h:40,ports:1,radios:[{}]};
      const pc={id:'pcw',type:'pc',name:'PC',x:400,y:10,w:60,h:40,ports:1}; // niente radio
      state.nodes.push(ap,cl,pc); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const rpid = _radioPid('apx',0);
      const isRadio = _isRadioPid(rpid);
      const maxc = getPortMaxConnections(rpid);
      // Regola: radio↔radio = wireless ; radio↔porta-di-rete = NON ammesso (invalid).
      const kWl  = linkKind(_isRadioPid(rpid), _isRadioPid('clx-radio'));
      const kMix = linkKind(_isRadioPid(rpid), _isRadioPid('pcw-1'));
      const wl = _createLinkRecord(rpid,'clx-radio');
      if(kWl==='wireless') wl.wireless=true;
      state.links.push(wl); if(typeof _invalidateIdx==='function') _invalidateIdx();
      // Multi-interfaccia: porta l'AP a 8 radio → 8 badge sugli anchor.
      setNodeRadioCount('apx',8);
      const apRadios = _radioCountOf(nodeById('apx'));
      const apHtml = _radioPortHtml(nodeById('apx')), pcHtml = _radioPortHtml(pc);
      const anchorCount = (apHtml.match(/radio-port/g)||[]).length;
      renderAll(); renderCables();
      return JSON.stringify({ ok:true, isRadio, maxc, apHasRadio: apHtml.indexOf('data-pid')>=0,
        pcNoRadio: pcHtml==='', kWl, kMix, wlWireless: !!wl.wireless, apRadios, anchorCount });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'radio lancia: ' + r.err);
  assert.ok(r.isRadio, 'il pid -radio di un device con radio deve risultare porta radio');
  assert.ok(r.maxc >= 256, 'la radio deve accettare molte associazioni (cap 9999)');
  assert.ok(r.apHasRadio, 'un device con radio deve esporre il badge');
  assert.ok(r.pcNoRadio, 'un device senza radio non deve avere il badge');
  assert.equal(r.kWl, 'wireless', 'radio↔radio deve essere wireless');
  assert.equal(r.kMix, 'invalid', 'radio↔porta-di-rete non è ammesso (invalid)');
  assert.ok(r.wlWireless, 'la connessione radio↔radio porta il flag wireless');
  assert.equal(r.apRadios, 8, 'setNodeRadioCount deve portare a 8 interfacce');
  assert.equal(r.anchorCount, 8, 'devono comparire 8 badge radio (4 angoli + 4 centri-lato)');
});

test('vlan CATENA COMPLETA: switchport → run (patch/presa) → endpoint/porta endpoint coerenti', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      // Topologia reale: switch → patch panel → presa a muro → PC, + ramo VoIP (PC dietro telefono).
      state.nodes.push(
        {id:'sw',type:'switch',name:'CORE',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'pp',type:'patchpanel',name:'PP',rackId:rid,rackU:3,sizeU:2,ports:24},
        {id:'wp',type:'wallport',name:'WP',x:100,y:100,ports:1},
        {id:'pc',type:'pc',name:'PC',x:200,y:200,ports:1},
        {id:'tel',type:'voip',name:'TEL',x:300,y:100,ports:1,spec:{voiceVlan:20}},
        {id:'pcv',type:'pc',name:'PCV',x:300,y:200,ports:1});
      _invalidateIdx&&_invalidateIdx();
      const mk=(s,d)=>{ const r=_createLinkRecord(s,d); state.links.push(r); return r; };
      const A=mk('sw-1','pp-1'), B=mk('pp-1','wp-1'), C=mk('wp-1','pc-1');   // run strutturato dati
      const V1=mk('sw-2','tel-1'), V2=mk('tel-1','pcv-1');                   // ramo VoIP
      _invalidateIdx&&_invalidateIdx();

      const md=l=>_getLinkTrunk(l).mode, vl=l=>_getLinkTrunk(l).vlans;
      const panel=(ty,id)=>{ selType=ty; selId=id; renderProps(); return document.getElementById('props-panel').innerHTML; };
      const ro = h => ({                                   // marcatori "editabile?" del pannello
        statusEdit:/onchange="setPortField\\('[^']+','statusOvr'/.test(h),
        speedEdit:/onchange="setPortSpeed/.test(h),
        portVlanEdit:/onchange="setPortField\\('[^']+','vlanOvr'/.test(h) });

      // ── FASE 1: switchport ACCESS VLAN 10 → propaga lungo tutto il run ──
      state.ports['sw-1']={vlanOvr:10}; propagateVlans();
      const f1 = {
        runModes:[md(A),md(B),md(C)],
        pcEff:_effPortVlan('pc-1'),                        // endpoint riceve la VLAN propagata
        pcPortRO:ro(panel('port','pc-1')),                 // porta endpoint: read-only
        pcNodeEditable:/updateN\\('vlanPc'/.test(panel('node','pc')) // nodo endpoint: niente edit VLAN
      };

      // ── FASE 2: switchport TRUNK 10,20,30 → trunk su TUTTI i segmenti del run ──
      setPortMode('sw-1','trunk'); setPortTrunkVlans('sw-1','10,20,30');
      const f2 = { runModes:[md(A),md(B),md(C)], termVlans:vl(C) };

      // ── FASE 3: VoIP — switch↔telefono trunk (voce 20 + dati nativi), telefono↔PC access ──
      state.ports['sw-2']={vlanOvr:10}; propagateVlans();
      const f3 = { swTel:md(V1), swTelVlans:vl(V1), telPc:md(V2), pcvEff:_effPortVlan('pcv-1') };

      // ── FASE 4: endpoint SENZA monte (nessuna VLAN propagata) → editor VLAN ──
      // L'utente documenta la VLAN del device dal pannello PORTA (interfaccia):
      // scrive il vlanOvr della porta access (setEndpointVlan). Quando invece una
      // VLAN è propagata (FASE 1) il campo resta in sola lettura.
      state.nodes.push({id:'pcStd',type:'pc',name:'PC-STD',x:500,y:500,ports:1});
      _invalidateIdx&&_invalidateIdx(); propagateVlans();
      const pcStdEditable = /onchange="setEndpointVlan\\('pcStd'/.test(panel('port','pcStd-1'));
      selType='node'; selId='pcStd'; setEndpointVlan('pcStd','pcStd-1','30');
      const f4 = { editable:pcStdEditable, ovr:(state.ports['pcStd-1']||{}).vlanOvr,
                   eff:_effPortVlan('pcStd-1'), keptSel:(selType==='node'&&selId==='pcStd') };

      return JSON.stringify({ ok:true, f1, f2, f3, f4 });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'catena completa lancia: ' + r.err);

  // FASE 1 — access propaga dallo switch fino all'endpoint
  assert.deepEqual(r.f1.runModes, ['access','access','access'], 'run access su tutti i segmenti');
  assert.equal(r.f1.pcEff, 10, 'l’endpoint riceve la VLAN access propagata dallo switch (10)');
  assert.deepEqual(r.f1.pcPortRO, { statusEdit:false, speedEdit:false, portVlanEdit:false },
    'porta endpoint: Stato/Velocità/VLAN in sola lettura');
  assert.equal(r.f1.pcNodeEditable, false, 'nodo endpoint: nessun campo VLAN editabile (derivato)');

  // FASE 2 — switchport trunk → tutta la tratta passiva è trunk, fino all’endpoint
  assert.deepEqual(r.f2.runModes, ['trunk','trunk','trunk'], 'trunk propagato su tutti i segmenti del run');
  assert.ok(r.f2.termVlans.includes(20) && r.f2.termVlans.includes(30),
    'la membership trunk arriva fino al segmento presa↔endpoint');

  // FASE 3 — voce: trunk lato switch (voce+dati), access lato PC
  assert.equal(r.f3.swTel, 'trunk', 'switch↔telefono è trunk (voce taggata + dati nativi)');
  assert.ok(r.f3.swTelVlans.includes(20), 'il trunk del telefono trasporta la VLAN voce (20)');
  assert.equal(r.f3.telPc, 'access', 'telefono↔PC è access (dati untagged)');
  assert.equal(r.f3.pcvEff, 10, 'il PC dietro il telefono riceve la VLAN dati nativa (10)');

  // FASE 4 — endpoint senza monte: VLAN editabile dal pannello (scrive vlanOvr di porta)
  assert.equal(r.f4.editable, true, 'endpoint senza VLAN propagata: campo VLAN editabile (setEndpointVlan)');
  assert.equal(r.f4.ovr, 30, 'setEndpointVlan scrive il vlanOvr della porta access');
  assert.equal(r.f4.eff, 30, 'la VLAN effettiva dell’endpoint riflette l’override impostato');
  assert.equal(r.f4.keptSel, true, 'setEndpointVlan mantiene il nodo selezionato (non deseleziona)');
});

test('vlan: distribuzione unificata cavo↔wireless (SSID→client, router-WiFi→trunk)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      // AP con SSID su VLAN 30 ↔ client wireless (station radio).
      const ap={id:'ap',type:'ap',name:'AP',x:0,y:0,w:60,h:40,ports:1,radios:[{ssids:[{id:'o1',ssid:'Off',vlan:30}]}]};
      const cl={id:'cl',type:'pc',name:'Client',x:200,y:0,w:60,h:40,ports:1,radios:[{}]};
      // Router con Wi-Fi: UNA radio fisica con 2 SSID (VLAN 30,40) + uplink cablato.
      const rt={id:'rt',type:'router',name:'RT',rackId:state.currentRack,radios:[{ssids:[{id:'a',ssid:'A',vlan:30},{id:'b',ssid:'B',vlan:40}]}]};
      const sw={id:'sw',type:'switch',name:'SW',rackId:state.currentRack};
      state.nodes.push(ap,cl,rt,sw); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const wl=_createLinkRecord('ap-radio','cl-radio'); wl.wireless=true;     // radio↔radio
      const up=_createLinkRecord('rt-1','sw-3');                                // uplink cablato
      state.links.push(wl,up); if(typeof _invalidateIdx==='function') _invalidateIdx();
      propagateVlans();
      const clientVlan = _effPortVlan('cl-radio');        // il client deve ereditare la VLAN SSID
      const tk = _getLinkTrunk(up);                        // uplink router → trunk con 30,40
      // VLAN nativa editabile inline: scrive il PVID del capo attivo (rt-1).
      setLinkNativeVlan(up.id, 99);
      const nativeAfter = _getLinkTrunk(up).native;
      return JSON.stringify({ ok:true, clientVlan, upMode:tk.mode, upVlans:tk.vlans, nativeAfter });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'vlan unificata lancia: ' + r.err);
  assert.equal(r.clientVlan, 30, 'il client wireless deve ereditare la VLAN dell’SSID (30)');
  assert.equal(r.upMode, 'trunk', 'l’uplink del router con Wi-Fi deve essere un trunk');
  assert.ok(r.upVlans.includes(30) && r.upVlans.includes(40), 'il trunk deve trasportare le VLAN dei due SSID (30,40)');
  assert.equal(r.nativeAfter, 99, 'setLinkNativeVlan deve cambiare la nativa (PVID del capo attivo)');
});

test('vlan: trunk di RUN — switchport propaga il trunk su patch panel/presa fino al device', () => {
  const out = run(APP.ctx, `(() => {
    try {
      // Run strutturato reale: switch → patch panel → presa a muro → PC.
      const build = () => {
        state=_buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
        const rid=state.currentRack;
        state.nodes.push(
          {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
          {id:'pp',type:'patchpanel',name:'PP',rackId:rid,rackU:3,sizeU:2,ports:24},
          {id:'wp',type:'wallport',name:'WP',x:100,y:100,ports:1},
          {id:'pc',type:'pc',name:'PC',x:200,y:200,ports:1});
        if(typeof _invalidateIdx==='function') _invalidateIdx();
        const A=_createLinkRecord('sw-1','pp-1'), B=_createLinkRecord('pp-1','wp-1'), C=_createLinkRecord('wp-1','pc-1');
        state.links.push(A,B,C); if(typeof _invalidateIdx==='function') _invalidateIdx();
        state.ports['sw-1']={vlanOvr:10};   // switch access VLAN10 (PVID)
        return {A,B,C};
      };
      const modes = (segs)=>segs.map(l=>_getLinkTrunk(l).mode);

      // 1. Base: senza trunk tutto il run è access (nessuna regressione).
      let {A,B,C}=build(); propagateVlans();
      const baseModes = modes([A,B,C]);

      // 2. L'utente seleziona un SEGMENTO PASSIVO (presa↔patch) e imposta trunk:
      //    la verità deve finire sullo switchport (sw-1) e propagarsi a TUTTO il run.
      ({A,B,C}=build());
      setLinkMode(B.id,'trunk'); setLinkTrunkVlans(B.id,'10,20,30');
      const anchorMode = state.ports['sw-1'].mode;
      const trunkModes = modes([A,B,C]);
      const trunkVlansA = _getLinkTrunk(A).vlans, trunkVlansC = _getLinkTrunk(C).vlans;

      // 3. Tornando ad access (su un qualsiasi segmento) il run intero torna access.
      setLinkMode(A.id,'access');
      const backModes = modes([A,B,C]);

      return JSON.stringify({ ok:true, baseModes, anchorMode, trunkModes, trunkVlansA, trunkVlansC, backModes });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'trunk di run lancia: ' + r.err);
  assert.deepEqual(r.baseModes, ['access','access','access'], 'di base tutto il run è access');
  assert.equal(r.anchorMode, 'trunk', 'il trunk impostato su un segmento passivo si ancora allo switchport (sw-1)');
  assert.deepEqual(r.trunkModes, ['trunk','trunk','trunk'], 'il trunk si propaga a TUTTI i segmenti del run');
  assert.ok(r.trunkVlansA.includes(20) && r.trunkVlansA.includes(30), 'il segmento switch↔patch trasporta le VLAN del trunk');
  assert.ok(r.trunkVlansC.includes(20) && r.trunkVlansC.includes(30), 'la membership arriva fino al segmento presa↔PC');
  assert.deepEqual(r.backModes, ['access','access','access'], 'tornando ad access l’intero run torna access');
});

test('percorso fisico: selezionare il NODO (anche presa a muro) evidenzia tutto il run', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'pp',type:'patchpanel',name:'PP',rackId:rid,rackU:3,sizeU:2,ports:24},
        {id:'wp',type:'wallport',name:'WP',x:0,y:0,ports:1},
        {id:'pc',type:'pc',name:'PC',x:9,y:9,ports:1},
        {id:'room',type:'room',name:'R',x:0,y:0});
      _invalidateIdx&&_invalidateIdx();
      state.links.push(_createLinkRecord('sw-1','pp-1'),_createLinkRecord('pp-1','wp-1'),_createLinkRecord('wp-1','pc-1'));
      _invalidateIdx&&_invalidateIdx();
      const sel=id=>{ highPath.clear(); _traceNodeFloor(id); return highPath.size; };
      return JSON.stringify({ ok:true, wp:sel('wp'), pc:sel('pc'), room:sel('room') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'trace nodo lancia: ' + r.err);
  assert.equal(r.wp, 3, 'selezionando la presa a muro si evidenzia tutto il run (3 segmenti)');
  assert.equal(r.pc, 3, 'l’endpoint evidenzia lo stesso run');
  assert.equal(r.room, 0, 'una struttura (stanza) non evidenzia nulla');
});

test('porta VoIP: uplink trunk (voce+dati) read-only + stato/velocità ereditati (allineato ai floor)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'tel',type:'voip',name:'TEL',x:0,y:0,ports:1,spec:{voiceVlan:20}},
        {id:'pc',type:'pc',name:'PC',x:9,y:9,ports:1});
      _invalidateIdx&&_invalidateIdx();
      const A=_createLinkRecord('sw-2','tel-1'), B=_createLinkRecord('tel-1','pc-1');
      state.links.push(A,B); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-2']={vlanOvr:10, speed:1000, status:'active'};
      propagateVlans();
      const reEdit=new RegExp("setPortField\\\\('[^']+','(vlanOvr|statusOvr)'|setPortSpeed");
      selType='port'; selId='tel-1'; renderProps();
      const h=document.getElementById('props-panel').innerHTML;
      return JSON.stringify({ ok:true,
        trunk:/>TRUNK</.test(h), native:/VLAN 10/.test(h), voice:/20/.test(h),
        active:/Attivo/.test(h), speed:/1G/.test(h), editable:reEdit.test(h) });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'voip lancia: ' + r.err);
  assert.ok(r.trunk && r.native && r.voice, 'porta VoIP mostra il TRUNK · nativa 10 · voce 20 (read-only)');
  assert.ok(r.active && r.speed, 'stato/velocità ereditati dallo switch');
  assert.equal(r.editable, false, 'niente campi editabili (allineato agli altri endpoint floor)');
});

test('wireless: chip "VLAN sul trunk" sull’AP mostra le VLAN in arrivo (anche non mappate su SSID)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      // AP con UNA radio mappata su VLAN 10; il trunk dell'uplink (SNMP) porta 10 e 20.
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'ap',type:'ap',name:'AP',x:0,y:0,ports:1,radios:[{ssids:[{id:'az',ssid:'Azienda',vlan:10}]}]});
      _invalidateIdx&&_invalidateIdx();
      const up=_createLinkRecord('ap-1','sw-2'); state.links.push(up); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-2']={vlan:1, isTrunk:true, trunkVlans:[10,20]}; propagateVlans();
      selType='node'; selId='ap'; renderProps();
      const h=document.getElementById('props-panel').innerHTML;
      return JSON.stringify({ ok:true,
        section:/VLAN sul trunk/.test(h),
        v10:/VLAN 10/.test(h), assigned:/Azienda/.test(h),
        v20:/VLAN 20/.test(h), unassigned:/non assegnata/.test(h),
        nativeShown:/VLAN 1\\b/.test(h) });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'chip trunk lancia: ' + r.err);
  assert.ok(r.section && r.v10 && r.assigned, 'mostra la sezione e VLAN 10 → SSID Azienda');
  assert.ok(r.v20 && r.unassigned, 'mostra VLAN 20 in arrivo, marcata "non assegnata"');
  assert.equal(r.nativeShown, true, 'la VLAN nativa (1) è inclusa: può servire (es. PC IT sull’untagged)');
});

test('wireless: dal chip "VLAN non assegnata" si crea un SSID con quella VLAN (addSsidForVlan)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'ap',type:'ap',name:'AP',x:0,y:0,ports:1,radios:[{ssids:[{id:'az',ssid:'Azienda',vlan:10}]}]});
      _invalidateIdx&&_invalidateIdx();
      const up=_createLinkRecord('ap-1','sw-2'); state.links.push(up); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-2']={vlan:1,isTrunk:true,trunkVlans:[10,20]}; propagateVlans();
      addSsidForVlan('ap', 20);
      const radios=nodeById('ap').radios, ss=radios[0].ssids, last=ss[ss.length-1];
      return JSON.stringify({ ok:true, radioCount:radios.length, ssidCount:ss.length, newVlan:last.vlan,
        newSsidEmpty:!last.ssid, sel:selType+'/'+selId });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'addSsidForVlan lancia: ' + r.err);
  assert.equal(r.radioCount, 1, 'NON crea una radio nuova: il BSS si aggiunge alla radio esistente');
  assert.equal(r.ssidCount, 2, 'la radio ora trasmette 2 SSID (Azienda + il nuovo)');
  assert.equal(r.newVlan, 20, 'il nuovo SSID ha la VLAN preimpostata (20)');
  assert.ok(r.newSsidEmpty, 'l’SSID è da nominare (vuoto)');
  assert.equal(r.sel, 'port/ap-radio', 'la radio viene selezionata per nominare il nuovo SSID');
});

test('wireless: associazione al drop — 1 SSID = auto link.bss, >1 SSID = menu di scelta', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      // AP1: una sola radio con UN SSID → bss auto. AP2: una radio con DUE SSID → menu.
      state.nodes.push(
        {id:'ap1',type:'ap',name:'AP1',x:0,y:0,ports:1,radios:[{ssids:[{id:'one',ssid:'Solo',vlan:30}]}]},
        {id:'ap2',type:'ap',name:'AP2',x:0,y:0,ports:1,radios:[{ssids:[{id:'a',ssid:'A',vlan:30},{id:'b',ssid:'B',vlan:40}]}]},
        {id:'c1',type:'pc',name:'C1',x:9,y:9,ports:1,radios:[{}]},
        {id:'c2',type:'pc',name:'C2',x:9,y:9,ports:1,radios:[{}]});
      _invalidateIdx&&_invalidateIdx();
      const l1=_createLinkRecord('ap1-radio','c1-radio'); l1.wireless=true;
      const l2=_createLinkRecord('ap2-radio','c2-radio'); l2.wireless=true;
      state.links.push(l1,l2); _invalidateIdx&&_invalidateIdx();
      _assignWirelessBss(l1);   // 1 SSID → assegna in automatico
      _assignWirelessBss(l2);   // 2 SSID → apre il menu, non assegna ancora
      const menu = document.getElementById('bss-menu-overlay');
      const menuHasPicks = !!menu && /bss-pick/.test(menu.innerHTML) && /VLAN 40/.test(menu.innerHTML);
      const l2BssBefore = l2.bss;   // non assegnato finché non si sceglie
      // dal menu scelgo B
      _pickBss(l2.id, 'b'); propagateVlans();
      return JSON.stringify({ ok:true, autoBss:l1.bss, l2BssBefore, l2Bss:l2.bss, menuHasPicks,
        c2Vlan:_effPortVlan('c2-radio') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, '_assignWirelessBss lancia: ' + r.err);
  assert.equal(r.autoBss, 'one', 'radio con 1 SSID: link.bss assegnato automaticamente');
  assert.ok(!r.l2BssBefore, 'radio con >1 SSID: nessuna assegnazione automatica (serve scelta)');
  assert.ok(r.menuHasPicks, 'radio con >1 SSID: il menu elenca i BSS (con VLAN) da scegliere');
  assert.equal(r.l2Bss, 'b', 'la scelta dal menu imposta link.bss');
  assert.equal(r.c2Vlan, 40, 'il client eredita la VLAN del BSS scelto (40)');
});

test('wireless: il client eredita la VLAN anche con SSID su una radio diversa da quella linkata', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      // AP con 2 radio: SSID solo sulla radio[1]; il client è agganciato a radio[0] (nuda).
      state.nodes.push(
        {id:'ap',type:'ap',name:'AP',x:0,y:0,ports:1,radios:[{},{}]},
        {id:'cl',type:'pc',name:'CL',x:9,y:9,ports:1,radios:[{}]});
      _invalidateIdx&&_invalidateIdx();
      const bid=addBss('ap',1,40); updateBssCfg('ap',1,bid,'ssid','OnR1');
      const wl=_createLinkRecord('ap-radio','cl-radio'); wl.wireless=true;
      state.links.push(wl); _invalidateIdx&&_invalidateIdx();
      if(typeof _assignWirelessBss==='function') _assignWirelessBss(wl);
      propagateVlans();
      return JSON.stringify({ ok:true, eff:_effPortVlan('cl-radio') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'lancia: ' + r.err);
  assert.equal(r.eff, 40, 'il lato servente è il NODO AP (SSID su qualsiasi radio), non solo la radio toccata');
});

test('wireless: solo infrastruttura wifiServe crea SSID; i client si associano e basta', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      state.nodes.push(
        {id:'pc',type:'pc',name:'PC',x:0,y:0,ports:1,radios:[{}]},
        {id:'rt',type:'router',name:'RT',rackId:state.currentRack,radios:[{}]});
      _invalidateIdx&&_invalidateIdx();
      // CLIENT (pc): addBss è no-op; il pannello radio mostra l'hint client, niente "Aggiungi SSID".
      addBss('pc',0,30);
      const pcSsids = (nodeById('pc').radios[0].ssids||[]).length;
      selType='port'; selId='pc-radio'; renderProps();
      const pcPanel = document.getElementById('props-panel').innerHTML;
      // INFRASTRUTTURA (router): addBss funziona; il pannello mostra "Aggiungi SSID".
      const bid=addBss('rt',0,40);
      const rtSsids = (nodeById('rt').radios[0].ssids||[]).length;
      selType='port'; selId='rt-radio'; renderProps();
      const rtPanel = document.getElementById('props-panel').innerHTML;
      return JSON.stringify({ ok:true, pcSsids, pcClientHint:/clientOnly|associ/i.test(pcPanel) || pcPanel.indexOf('addBss')<0,
        pcHasAddBtn:/addBss\\(/.test(pcPanel), rtSsids, rtBid:bid, rtHasAddBtn:/addBss\\(/.test(rtPanel),
        rtAccordion:/props-collapsible/.test(rtPanel), rtRedTrash:/toolbar-btn danger[^>]*onclick="removeBss/.test(rtPanel) });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'lancia: ' + r.err);
  assert.equal(r.pcSsids, 0, 'un client (pc) non può creare SSID: addBss è no-op');
  assert.equal(r.pcHasAddBtn, false, 'il pannello radio del client NON mostra "Aggiungi SSID"');
  assert.equal(r.rtSsids, 1, 'un router (wifiServe) può creare SSID');
  assert.ok(r.rtHasAddBtn, 'il pannello radio del router mostra "Aggiungi SSID"');
  assert.ok(r.rtAccordion, 'la lista SSID è in una fisarmonica (details.props-collapsible) coerente con la UX');
  assert.ok(r.rtRedTrash, 'il cestino dentro al pannello SSID è rosso (toolbar-btn danger)');
});

test('wireless VLAN: SSID picker client + chip AP + report coerenza (SSID non nel trunk)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'ap',type:'ap',name:'AP',x:0,y:0,ports:1,radios:[{band:'5',ssids:[{id:'a',ssid:'A',vlan:30},{id:'b',ssid:'B',vlan:40}]}]},
        {id:'cl',type:'pc',name:'CL',x:9,y:9,ports:1,radios:[{}]});
      _invalidateIdx&&_invalidateIdx();
      const wl=_createLinkRecord('ap-radio','cl-radio'); wl.wireless=true; wl.bss='a';   // associato a SSID A
      const up=_createLinkRecord('ap-1','sw-2');
      state.links.push(wl,up); _invalidateIdx&&_invalidateIdx();
      // SNMP: il trunk dell'uplink permette 10,30 ma NON 40 → SSID B fuori trunk.
      state.ports['sw-2']={vlanOvr:10, isTrunk:true, trunkVlans:[10,30]};
      propagateVlans();
      const before=_effPortVlan('cl-radio');
      // picker: il client sceglie il BSS B (la VLAN deriva)
      setClientAssoc('cl-radio', 'b');
      const after=_effPortVlan('cl-radio');
      const issues=_wifiVlanIssues();
      return JSON.stringify({ ok:true, before, after, issues });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'wireless vlan lancia: ' + r.err);
  assert.equal(r.before, 30, 'client parte su SSID A (VLAN 30)');
  assert.equal(r.after, 40, 'il picker ri-associa a SSID B (VLAN 40) — VLAN sempre valida per costruzione');
  // report: la VLAN 40 dell'SSID B non è nel trunk SNMP [10,30] dell'uplink AP
  const ssidIssue = r.issues.find(i => i.kind==='ssid-not-in-trunk' && i.vlan===40);
  assert.ok(ssidIssue, 'il report segnala SSID B (VLAN 40) non permessa sul trunk dell’uplink');
});

test('wireless: l’interfaccia Ethernet dell’AP mostra il TRUNK (nativa + VLAN SSID), non una VLAN singola', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'ap',type:'ap',name:'AP',x:0,y:0,ports:1,radios:[{ssids:[{id:'a',ssid:'A',vlan:30},{id:'b',ssid:'B',vlan:40}]}]},
        {id:'pc',type:'pc',name:'PC',x:9,y:9,ports:1});
      _invalidateIdx&&_invalidateIdx();
      const up=_createLinkRecord('ap-1','sw-2'), wl=_createLinkRecord('sw-3','pc-1');
      state.links.push(up,wl); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-2']={vlanOvr:10}; state.ports['sw-3']={vlanOvr:50}; propagateVlans();
      const panel=id=>{ selType='port'; selId=id; renderProps(); return document.getElementById('props-panel').innerHTML; };
      const ap=panel('ap-1'), pc=panel('pc-1');
      return JSON.stringify({ ok:true,
        apTrunk:/>TRUNK</.test(ap), apNative:/VLAN 10/.test(ap), apCarried:/30, 40/.test(ap),
        pcTrunk:/>TRUNK</.test(pc), pcAccess:/VLAN 50/.test(pc) });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'ap uplink lancia: ' + r.err);
  assert.ok(r.apTrunk && r.apNative && r.apCarried, 'la porta Ethernet dell’AP mostra TRUNK · nativa 10 · trasportate 30,40');
  assert.ok(!r.pcTrunk && r.pcAccess, 'l’endpoint access (PC) resta a VLAN singola, niente trunk');
});

test('wireless: client coerente — VLAN del nodo dalla radio + radio client read-only (G1/G2)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'ap',type:'ap',name:'AP',x:0,y:0,ports:1,radios:[{band:'5',ssids:[{id:'az',ssid:'Az',vlan:30}]}]},
        {id:'cl',type:'pc',name:'CLIENT',x:0,y:0,ports:1,radios:[{}]});      // client solo-wireless
      _invalidateIdx&&_invalidateIdx();
      const wl=_createLinkRecord('ap-radio','cl-radio'); wl.wireless=true; wl.bss='az';
      const up=_createLinkRecord('ap-1','sw-2');
      state.links.push(wl,up); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-2']={vlanOvr:10}; propagateVlans();
      // VLAN editabile = la radio AP la espone via updateBssCfg (per-SSID); il client no.
      const reEdit=new RegExp("(updateRadioCfg|updateBssCfg)\\\\([^)]*'vlan'");
      const panel=(ty,id)=>{ selType=ty; selId=id; renderProps(); return document.getElementById('props-panel').innerHTML; };
      // G1: uniformatura — il nodo NON mostra la VLAN nel pannello device (vive
      // nell'interfaccia/radio); in particolare niente "VLAN 1" della porta cablata.
      const node = panel('node','cl');
      // G2: pannello radio client vs AP servente
      const cliRadio = panel('port','cl-radio');
      const apRadio  = panel('port','ap-radio');
      return JSON.stringify({ ok:true,
        clVlanReal:_effPortVlan('cl-radio'),
        nodeShows30: /VLAN 30/.test(node), nodeShows1: /VLAN 1\\b/.test(node),
        cliEditable: reEdit.test(cliRadio), cliInherits: /ereditati/.test(cliRadio), cliShows30:/30/.test(cliRadio),
        apEditable: reEdit.test(apRadio) });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'wireless coerenza lancia: ' + r.err);
  assert.equal(r.clVlanReal, 30, 'la VLAN reale del client wireless è quella dell’SSID (30, propagata da monte)');
  // G1 — la VLAN non è più nel pannello device del client (uniformatura: vive
  // nell'interfaccia/radio, verificata da G2); in particolare niente VLAN 1 cablata.
  assert.ok(!r.nodeShows30 && !r.nodeShows1, 'il nodo client non mostra la VLAN nel pannello device (è nell’interfaccia)');
  // G2
  assert.equal(r.cliEditable, false, 'la radio CLIENT non ha VLAN editabile');
  assert.ok(r.cliInherits && r.cliShows30, 'la radio CLIENT mostra SSID/VLAN ereditati read-only (30)');
  assert.equal(r.apEditable, true, 'la radio AP servente resta editabile (è autorevole)');
});

test('cavo specifiche fisiche: hint SNMP velocità/PoE su TUTTI i segmenti del run (eredità anchor)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'pp',type:'patchpanel',name:'PP',rackId:rid,rackU:3,sizeU:2,ports:24},
        {id:'wp',type:'wallport',name:'WP',x:0,y:0,ports:1},
        {id:'pc',type:'pc',name:'PC',x:0,y:0,ports:1});
      _invalidateIdx&&_invalidateIdx();
      const mk=(s,d)=>{ const r=_createLinkRecord(s,d); state.links.push(r); return r; };
      const segs=[mk('sw-1','pp-1'),mk('pp-1','wp-1'),mk('wp-1','pc-1')];
      _invalidateIdx&&_invalidateIdx();
      state.ports['sw-1']={vlan:10, speed:1000, snmpPoe:'802.3at'};   // dati SNMP solo sulla porta switch
      propagateVlans();
      const reSpeed=new RegExp('SNMP:\\\\s*<b>1G');
      const rePoe=new RegExp('SNMP:\\\\s*<b>802.3at');
      const res=segs.map(l=>{ selType='link'; selId=l.id; renderProps();
        const h=document.getElementById('props-panel').innerHTML;
        return { speed:reSpeed.test(h), poe:rePoe.test(h) }; });
      return JSON.stringify({ ok:true, res });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'hint cavo lancia: ' + r.err);
  r.res.forEach((seg, i) => {
    assert.ok(seg.speed, 'segmento '+i+': hint SNMP velocità presente su tutto il run');
    assert.ok(seg.poe,   'segmento '+i+': hint SNMP PoE presente su tutto il run');
  });
});

test('porta: endpoint eredita Stato/Velocità/VLAN dalla porta switch a monte (diretto + via presa)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      const rid=state.currentRack;
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'pc',type:'pc',name:'PC',x:0,y:0,ports:1},                       // diretto su sw-1
        {id:'pp',type:'patchpanel',name:'PP',rackId:rid,rackU:3,sizeU:2,ports:24},
        {id:'wp',type:'wallport',name:'WP',x:0,y:0,ports:1},
        {id:'pc2',type:'pc',name:'PC2',x:0,y:0,ports:1});                    // via presa su sw-2
      _invalidateIdx&&_invalidateIdx();
      const mk=(s,d)=>{ const r=_createLinkRecord(s,d); state.links.push(r); return r; };
      mk('sw-1','pc-1'); mk('sw-2','pp-1'); mk('pp-1','wp-1'); mk('wp-1','pc2-1');
      _invalidateIdx&&_invalidateIdx();
      // dati SNMP sulle PORTE SWITCH (poll di progetto)
      state.ports['sw-1']={vlan:10, speed:1000,  status:'active'};
      state.ports['sw-2']={vlan:20, speed:10000, status:'fault'};
      propagateVlans();
      const inh=pid=>_portInheritedLinkData(pid);
      return JSON.stringify({ ok:true,
        pcVlan:_effPortVlan('pc-1'),  pcInh:inh('pc-1'),
        pc2Vlan:_effPortVlan('pc2-1'), pc2Inh:inh('pc2-1') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'eredità porta lancia: ' + r.err);
  // Diretto: l'endpoint replica VLAN + stato + velocità della porta switch.
  assert.equal(r.pcVlan, 10, 'PC diretto: VLAN propagata 10');
  assert.deepEqual(r.pcInh, { status:'active', speed:1000 }, 'PC diretto eredita stato/velocità da sw-1');
  // Via presa: eredita attraverso il run passivo (patch panel + presa).
  assert.equal(r.pc2Vlan, 20, 'PC via presa: VLAN propagata 20');
  assert.deepEqual(r.pc2Inh, { status:'fault', speed:10000 }, 'PC via presa eredita stato/velocità da sw-2 attraverso il run');
});

test('porta: endpoint floor — Stato/Velocità read-only, VLAN editabile (override di porta), switch editabile, presa nulla', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes=[]; state.links=[]; state.ports={};
      state.nodes.push(
        {id:'pc6',type:'pc',name:'PC',x:0,y:0,ports:1},
        {id:'sw',type:'switch',name:'SW',rackId:state.currentRack,rackU:1,sizeU:1,ports:24},
        {id:'wp',type:'wallport',name:'WP',x:0,y:0,ports:1});
      _invalidateIdx&&_invalidateIdx();
      const probe = pid => { selType='port'; selId=pid; renderProps();
        const h=document.getElementById('props-panel').innerHTML;
        return { statusEdit:/onchange="setPortField\\('[^']+','statusOvr'/.test(h),
                 speedEdit:/onchange="setPortSpeed/.test(h),
                 vlanEditPort:/onchange="setPortField\\('[^']+','vlanOvr'/.test(h),
                 vlanEditEndpoint:/onchange="setEndpointVlan\\(/.test(h),
                 hasVlanLabel:/>VLAN</.test(h) };
      };
      return JSON.stringify({ ok:true, pc:probe('pc6-1'), sw:probe('sw-1'), wp:probe('wp-1') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'porta lancia: ' + r.err);
  // Endpoint floor SENZA monte: Stato/Velocità in sola lettura, ma la VLAN è
  // editabile (scrive il vlanOvr di porta via setEndpointVlan). Quando una VLAN
  // è propagata dallo switch a monte il campo torna in sola lettura (vedi CATENA).
  assert.deepEqual({s:r.pc.statusEdit,sp:r.pc.speedEdit,lbl:r.pc.hasVlanLabel},
    {s:false,sp:false,lbl:true}, 'endpoint floor: Stato/Velocità in sola lettura (VLAN mostrata)');
  assert.equal(r.pc.vlanEditEndpoint, true, 'endpoint floor senza monte: VLAN editabile (setEndpointVlan)');
  // Switch: tutto editabile (VLAN via setPortField sulla porta attiva).
  assert.ok(r.sw.statusEdit && r.sw.speedEdit && r.sw.vlanEditPort, 'switch: stato/velocità/VLAN editabili');
  // Presa a muro (passive conduit): nessun campo VLAN.
  assert.equal(r.wp.hasVlanLabel, false, 'presa a muro: niente VLAN/stato/velocità');
});

test('vlan: campo device floor coerente col motore (migrazione spec→porta + switch vince)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      // Migrazione: vlanPc>1 in spec → override di porta; valore 1/assente ignorato.
      let s=_buildDefaultState();
      s.nodes=[{id:'pc1',type:'pc',name:'PC',x:0,y:0,ports:1,spec:{vlanPc:50}},
               {id:'pc2',type:'pc',name:'PC2',x:0,y:0,ports:1,spec:{vlanPc:1}}];
      s.links=[]; s.ports={};
      _migrateState(s);
      const mig={ specGone: !(s.nodes[0].spec&&s.nodes[0].spec.vlanPc), ovr: s.ports['pc1-1']&&s.ports['pc1-1'].vlanOvr,
                  noOvrForDefault: !(s.ports['pc2-1']&&s.ports['pc2-1'].vlanOvr!=null) };
      // Coerenza: la VLAN del device = _effPortVlan; lo switch a monte prevale.
      state=_buildDefaultState(); if(_migrateState)_migrateState(state);
      state.nodes=[]; state.links=[]; state.ports={};
      const rid=state.currentRack;
      state.nodes.push({id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
                       {id:'pc1',type:'pc',name:'PC',x:0,y:0,ports:1});
      _invalidateIdx&&_invalidateIdx();
      state.ports['pc1-1']={vlanOvr:50}; propagateVlans();
      const detached=_effPortVlan('pc1-1');
      const L=_createLinkRecord('sw-1','pc1-1'); state.links.push(L); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-1']={vlanOvr:10}; propagateVlans();
      const attached=_effPortVlan('pc1-1');
      return JSON.stringify({ ok:true, mig, detached, attached });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'migrazione lancia: ' + r.err);
  assert.equal(r.mig.specGone, true, 'il campo spec scollegato viene rimosso');
  assert.equal(r.mig.ovr, 50, 'la VLAN documentata (>1) migra sull’override di porta');
  assert.equal(r.mig.noOvrForDefault, true, 'VLAN 1/assente non crea override');
  assert.equal(r.detached, 50, 'senza switch a monte la VLAN del device = override migrato');
  assert.equal(r.attached, 10, 'collegato allo switch, la VLAN propagata prevale (switch autorevole)');
});

test('vlan voce: assegnazione in blocco dal pannello (solo-vuoti vs sovrascrivi, spec-aware)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(_migrateState&&_migrateState(state));
      state.nodes.length=0; state.links.length=0; state.ports={};
      // 3 telefoni: A senza voce, B con voce 99 (manuale, in spec), C senza voce.
      state.nodes.push(
        {id:'tA',type:'voip',name:'A',x:0,y:0,ports:1},
        {id:'tB',type:'voip',name:'B',x:0,y:0,ports:1,spec:{voiceVlan:99}},
        {id:'tC',type:'voip',name:'C',x:0,y:0,ports:1});
      _invalidateIdx&&_invalidateIdx();
      const voice=id=>_voipVoiceVlan(nodeById(id));
      // policy 'empty': non tocca B (ha già 99), riempie A e C con 20
      applyVoiceVlanBulk(20,'all','empty');
      const afterEmpty={A:voice('tA'),B:voice('tB'),C:voice('tC'),classified:_isVoiceVlan(20)};
      // policy 'all': sovrascrive TUTTI con 30 (anche B)
      applyVoiceVlanBulk(30,'all','all');
      const afterAll={A:voice('tA'),B:voice('tB'),C:voice('tC')};
      // scope 'selected': solo il telefono selezionato (B) → 40
      selType='node'; selId='tB';
      applyVoiceVlanBulk(40,'selected','all');
      const afterSel={A:voice('tA'),B:voice('tB'),C:voice('tC')};
      // verifica che finisca in spec (come updateN)
      const inSpec = nodeById('tA').spec && nodeById('tA').spec.voiceVlan;
      return JSON.stringify({ ok:true, afterEmpty, afterAll, afterSel, inSpec });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'voce bulk lancia: ' + r.err);
  assert.deepEqual(r.afterEmpty, {A:20,B:99,C:20,classified:true}, 'policy solo-vuoti: riempie A/C, non tocca B (manuale), e classifica la VLAN come voce');
  assert.deepEqual(r.afterAll, {A:30,B:30,C:30}, 'policy sovrascrivi: tutti a 30, incluso B');
  assert.deepEqual(r.afterSel, {A:30,B:40,C:30}, 'scope selezionato: cambia solo il telefono selezionato (B)');
  assert.equal(r.inSpec, 30, 'la voce viene scritta nel node.spec (coerente con updateN)');
});

test('vlan: switchport trunk da SNMP appare/agisce da trunk (manual-first: access lo sovrascrive)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      const rid=(state=_buildDefaultState(), _migrateState&&_migrateState(state), state.currentRack);
      state.nodes.length=0; state.links.length=0; state.ports={};
      state.nodes.push({id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
                       {id:'sx',type:'switch',name:'SX',rackId:rid,rackU:2,sizeU:1,ports:24});
      _invalidateIdx&&_invalidateIdx();
      const L=_createLinkRecord('sw-1','sx-1'); state.links.push(L); _invalidateIdx&&_invalidateIdx();
      // SNMP ha rilevato sw-1 come trunk (nessun mode manuale).
      state.ports['sw-1']={vlan:10, isTrunk:true, trunkVlans:[10,20,30]};
      propagateVlans();
      const snmpEff = _portEffTrunk(state.ports['sw-1']);     // deve essere trunk pur senza mode
      const snmpLink = _getLinkTrunk(L).mode;                  // e il cavo deve risultare trunk
      // Override manuale ad access: deve vincere sullo SNMP (manual-first).
      setPortMode('sw-1','access');
      const ovrEff = _portEffTrunk(state.ports['sw-1']);
      const ovrMode = state.ports['sw-1'].mode;
      const ovrLink = _getLinkTrunk(L).mode;
      return JSON.stringify({ ok:true, snmpEff, snmpLink, ovrEff, ovrMode, ovrLink });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'snmp switchport lancia: ' + r.err);
  assert.equal(r.snmpEff, true, 'una porta trunk da SNMP è effettivamente trunk anche senza mode manuale');
  assert.equal(r.snmpLink, 'trunk', 'il cavo su una porta trunk SNMP risulta trunk');
  assert.equal(r.ovrEff, false, 'l’override manuale ad access vince sullo SNMP');
  assert.equal(r.ovrMode, 'access', 'l’override scrive mode=access esplicito (manual-first)');
  assert.equal(r.ovrLink, 'access', 'dopo l’override il cavo torna access');
});

test('vlan: IP phone (voce trunk + dati access al PC) e media converter (trasparente L1)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      const rid=(state=_buildDefaultState(), _migrateState&&_migrateState(state), state.currentRack);
      const tr=l=>_getLinkTrunk(l);

      // --- IP phone: switch(access 10) → telefono(voce 20) → PC ---
      state.nodes.length=0; state.links.length=0; state.ports={};
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'tel',type:'voip',name:'TEL',x:100,y:100,ports:1,voiceVlan:20},
        {id:'pc',type:'pc',name:'PC',x:200,y:200,ports:1});
      _invalidateIdx&&_invalidateIdx();
      const A=_createLinkRecord('sw-1','tel-1'), B=_createLinkRecord('tel-1','pc-1');
      state.links.push(A,B); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-1']={vlanOvr:10}; propagateVlans();
      const phone = { swMode:tr(A).mode, swVlans:tr(A).vlans, pcMode:tr(B).mode, pcVlan:_effPortVlan('pc-1') };

      // --- Media converter: switch(trunk 10,20) → mc(IN/OUT) → switch2 ---
      state.nodes.length=0; state.links.length=0; state.ports={};
      state.nodes.push(
        {id:'sw',type:'switch',name:'SW',rackId:rid,rackU:1,sizeU:1,ports:24},
        {id:'mc',type:'mediaconv',name:'MC',rackId:rid,rackU:5,sizeU:1,ports:2},
        {id:'sx',type:'switch',name:'SX',rackId:rid,rackU:7,sizeU:1,ports:24});
      _invalidateIdx&&_invalidateIdx();
      const M1=_createLinkRecord('sw-1','mc-1'), M2=_createLinkRecord('mc-2','sx-1');
      state.links.push(M1,M2); _invalidateIdx&&_invalidateIdx();
      state.ports['sw-1']={vlanOvr:10,mode:'trunk',trunkVlans:'10,20'}; propagateVlans();
      const mconv = { inMode:tr(M1).mode, inVlans:tr(M1).vlans, outMode:tr(M2).mode, outVlans:tr(M2).vlans };

      return JSON.stringify({ ok:true, phone, mconv });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'voip/mediaconv lancia: ' + r.err);
  // IP phone: lato switch trunk con voce+dati; lato PC access con la sola VLAN dati.
  assert.equal(r.phone.swMode, 'trunk', 'switch↔telefono deve essere trunk (voce taggata + dati nativi)');
  assert.ok(r.phone.swVlans.includes(10) && r.phone.swVlans.includes(20), 'il trunk del telefono porta dati(10) + voce(20)');
  assert.equal(r.phone.pcMode, 'access', 'telefono↔PC deve essere access (dati untagged)');
  assert.equal(r.phone.pcVlan, 10, 'il PC dietro il telefono riceve la VLAN dati (10)');
  // Media converter: trasparente L1 → il trunk attraversa entrambe le porte.
  assert.equal(r.mconv.inMode, 'trunk', 'lato IN del media converter = trunk');
  assert.equal(r.mconv.outMode, 'trunk', 'lato OUT del media converter = trunk (attraversa il convertitore)');
  assert.ok(r.mconv.outVlans.includes(20), 'la membership trunk attraversa il media converter (10,20)');
});

test('vlan: nativa predefinita di sito (default 1, override globale 1→99)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      const a={id:'pa',type:'pc',name:'A',x:0,y:0,w:60,h:40,ports:1};
      const b={id:'pb',type:'pc',name:'B',x:200,y:0,w:60,h:40,ports:1};
      state.nodes.push(a,b); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const l=_createLinkRecord('pa-1','pb-1'); state.links.push(l); if(typeof _invalidateIdx==='function') _invalidateIdx();
      propagateVlans();
      const before=_getLinkVlan(l);     // connessione non documentata → nativa di sito
      setSiteNativeVlan(99);
      const after=_getLinkVlan(l);
      setSiteNativeVlan(1);
      const reset=_getLinkVlan(l);
      return JSON.stringify({ ok:true, before, after, reset });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r=JSON.parse(out);
  assert.ok(r.ok, 'site native lancia: '+r.err);
  assert.equal(r.before, 1, 'di serie la nativa è VLAN 1');
  assert.equal(r.after, 99, 'cambiata la nativa di sito, una connessione non documentata diventa 99');
  assert.equal(r.reset, 1, 'tornando a 1 si ripristina il default');
});

test('vlan: trunk SNMP della porta alimenta il derivato (anche cavo manuale) + manual-first', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state=_buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      const sw={id:'sw',type:'switch',name:'SW',rackId:state.currentRack};
      const sx={id:'sx',type:'switch',name:'SX',rackId:state.currentRack};
      state.nodes.push(sw,sx); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const l=_createLinkRecord('sw-1','sx-1'); state.links.push(l); if(typeof _invalidateIdx==='function') _invalidateIdx();
      // Simula il poll SNMP: porta trunk con membership {10,20} (cavo disegnato a mano).
      state.ports['sw-1']={isTrunk:true, trunkVlans:[10,20]};
      const auto=_getLinkTrunk(l);
      // Manual-first: forzo trunkVlans a mano → deve vincere sullo SNMP.
      l.trunkVlans='5';
      const manual=_getLinkTrunk(l);
      return JSON.stringify({ ok:true, autoMode:auto.mode, autoVlans:auto.vlans, manualVlans:manual.vlans, manualDerived:manual.derived });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r=JSON.parse(out);
  assert.ok(r.ok, 'snmp trunk lancia: '+r.err);
  assert.equal(r.autoMode, 'trunk', 'una porta-trunk SNMP rende il cavo (anche manuale) un trunk');
  assert.ok(r.autoVlans.includes(10) && r.autoVlans.includes(20), 'il trunk derivato include le VLAN SNMP della porta');
  assert.deepEqual(r.manualVlans, [5], 'manual-first: trunkVlans a mano vince sullo SNMP');
  assert.equal(r.manualDerived, false, 'override manuale → derived:false');
});

test('radio: migrazione wifiCfg→radios + conteggio 0..8', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      // router = wifi-capable OPZIONALE → la migrazione da wifiCfg vale, e il conteggio 0 è ammesso.
      const n={id:'mg',type:'router',name:'x',rackId:state.currentRack,wifi:true,wifiCfg:{ssid:'Legacy',band:'5'}};
      migrateNodeRadios(n,{defaultOn:true});
      state.nodes.push(n); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const c1 = _radioCountOf(n), ssid = (n.radios[0]||{}).ssid;
      setNodeRadioCount('mg',8); const c8 = _radioCountOf(n);
      setNodeRadioCount('mg',0); const c0 = _radioCountOf(n);
      // AP = wireless per definizione: non scende sotto 1 radio.
      const ap={id:'apm',type:'ap',name:'AP',x:0,y:0,w:60,h:40,ports:1,radios:[{}]};
      state.nodes.push(ap); if(typeof _invalidateIdx==='function') _invalidateIdx();
      setNodeRadioCount('apm',0); const apMin = _radioCountOf(ap);
      return JSON.stringify({ ok:true, c1, ssid, c8, c0, apMin });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'migrazione lancia: ' + r.err);
  assert.equal(r.c1, 1, 'wifiCfg legacy → 1 radio');
  assert.equal(r.ssid, 'Legacy', 'la radio migrata conserva lo SSID');
  assert.equal(r.c8, 8, 'conteggio portabile a 8');
  assert.equal(r.c0, 0, 'su device opzionale, conteggio 0 rimuove tutte le radio');
  assert.equal(r.apMin, 1, 'AP: il conteggio non scende sotto 1 (sempre wireless)');
});

test('render: pannello UPS/ATS con stato live (powerLive) senza crash', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      const ups={id:'ux',type:'ups',name:'UPS',x:0,y:0,w:60,h:40, powerLive:{batteryPct:80,runtimeMin:6,outputSource:'battery',onBattery:true,batteryStatus:'normal',loadPct:30,outputV:230}, powerLiveAt:new Date().toISOString()};
      const ats={id:'ax',type:'ats',name:'ATS',x:0,y:0,w:60,h:40, powerLive:{selectedSource:'A',redundant:true}, powerLiveAt:new Date().toISOString()};
      state.nodes.push(ups,ats); if(typeof _invalidateIdx==='function') _invalidateIdx();
      const upsHtml=_powerLiveHtml(ups), atsHtml=_powerLiveHtml(ats);
      selType='node'; selId='ux'; renderProps();   // pannello UPS con blocco live
      selType='node'; selId='ax'; renderProps();   // pannello ATS con blocco live
      return JSON.stringify({ ok:true, upsBatt: upsHtml.indexOf('80 %')>=0, upsCrit: upsHtml.indexOf('6 min')>=0, atsSrc: atsHtml.indexOf('Sorgente A')>=0 });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r=JSON.parse(out);
  assert.ok(r.ok, 'power lancia: ' + r.err);
  assert.ok(r.upsBatt, 'UPS deve mostrare batteria 80%');
  assert.ok(r.upsCrit, 'UPS deve mostrare autonomia 6 min (critica)');
  assert.ok(r.atsSrc, 'ATS deve mostrare Sorgente A attiva');
});

test('render: switchRightTab(props/rack) non lancia', () => {
  const out = run(APP.ctx, `(() => {
    try { state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state); switchRightTab('rack'); switchRightTab('props'); return 'ok'; }
    catch(e){ return 'ERR: ' + (e && e.message || e); }
  })()`);
  assert.equal(out, 'ok', out);
});

test('nomi abbreviati: il toggle abbrevia il cable auto-label (planimetria/etichette)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      state.nodes.length=0; state.links.length=0; state.ports={};
      state.racks=[{id:'r1',name:'R',sizeU:12}]; state.currentRack='r1';
      state.nodes.push(
        { id:'sw1', type:'switch', name:'ACC-SW-P2', rackId:'r1', rackU:1, sizeU:1, ports:8 },
        { id:'prn1', type:'printer', name:'PRINTER-D01', x:100, y:100, ports:1 });
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      state.links.push(_createLinkRecord('sw1-1','prn1-1'));
      const off = _cableAutoLabel(state.links[0]);
      toggleAbbrevNames(true);
      const on = _cableAutoLabel(state.links[0]);
      toggleAbbrevNames(false);
      const off2 = _cableAutoLabel(state.links[0]);
      return JSON.stringify({ ok:true, off, on, off2, flagAfter: state.abbrevNames });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'flusso abbrev lancia: ' + r.err);
  assert.match(r.off, /PRINTER-D01/, 'OFF: nome pieno');
  assert.doesNotMatch(r.off, /PRN-D01/, 'OFF: niente sigla');
  assert.match(r.on, /PRN-D01/, 'ON: sigla applicata (PRINTER -> PRN)');
  assert.doesNotMatch(r.on, /PRINTER-D01/, 'ON: niente nome pieno');
  assert.match(r.on, /ACC-SW-P2/, 'ON: i nomi non-tipo restano invariati');
  assert.match(r.off2, /PRINTER-D01/, 'toggle OFF ripristina il nome pieno');
  assert.equal(r.flagAfter, false, 'state.abbrevNames riflette il toggle');
});

// pruneDiscoveryHistory/DISCOVERY_HISTORY_MAX estratti in lib/discovery-history.js: lo
// stub carica i lib-script di netmapper.html → restano esercitabili qui (integrazione).
// Integrazione: pruneDiscoveryHistory/DISCOVERY_HISTORY_MAX ora vivono in
// lib/discovery-history.js (lib-script) → questo smoke verifica che siano DAVVERO
// caricati e raggiungibili nello scope pagina. La logica pura è in test/discovery-history.test.js.
test('discoveryHistory: pruneDiscoveryHistory (lib) applica aging + tetto e mantiene il riferimento', () => {
  const out = run(APP.ctx, `(() => {
    try {
      const DAY = 864e5, now = Date.now();
      const iso = ms => new Date(ms).toISOString();

      // --- Scenario A: aging sotto il tetto (verifica scarto vecchie + tieni senza-data) ---
      const a = [];
      for(let i=0;i<5;i++) a.push({ ts: iso(now-200*DAY), lastSeen: iso(now-200*DAY), mac:'old'+i }); // >90gg → via
      a.push({ mac:'nodate' });                                                                        // senza data → resta
      for(let i=0;i<20;i++) a.push({ ts: iso(now-1*DAY), lastSeen: iso(now-1*DAY), mac:'new'+i });      // recenti → restano
      const refA = a;
      const retA = pruneDiscoveryHistory(a);

      // --- Scenario B: tetto rigido (tutte recenti, oltre il cap) ---
      const b = [];
      const N = DISCOVERY_HISTORY_MAX + 50;
      for(let i=0;i<N;i++) b.push({ ts: iso(now-1*DAY), lastSeen: iso(now-1*DAY), mac:'r'+i });
      pruneDiscoveryHistory(b);

      return JSON.stringify({
        sameRef: retA === refA,                                  // bonifica in place
        aLen: a.length,                                          // 1 nodate + 20 recenti
        noOld: !a.some(r => String(r.mac).startsWith('old')),    // aging ha tolto le vecchie
        keptNoDate: a.some(r => r.mac === 'nodate'),             // record senza data tenuto
        cap: DISCOVERY_HISTORY_MAX,
        bLen: b.length,                                          // == cap
      });
    } catch(e){ return JSON.stringify({ err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(!r.err, 'prune lancia: ' + r.err);
  assert.ok(r.sameRef, 'deve sfoltire IN PLACE (stesso riferimento array)');
  assert.ok(r.noOld, 'le observation oltre 90 giorni sono scartate (aging)');
  assert.ok(r.keptNoDate, 'le observation senza data valida sono mantenute');
  assert.equal(r.aLen, 21, 'restano 1 senza-data + 20 recenti');
  assert.equal(r.bLen, r.cap, 'il tetto rigido limita a DISCOVERY_HISTORY_MAX');
});
