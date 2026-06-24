'use strict';
// ============================================================
// SMOKE UI — verifica i marker UX/UI introdotti in questa sessione (radio
// multiple, fisarmonica WIRELESS, multi-porta LAN, trunk derivato + nativa,
// associazione wireless, VLAN nativa di sito). Carica TUTTA l'app nel DOM finto
// ed esercita i render REALI (renderProps/_renderLinkProps), poi asserisce sui
// frammenti HTML prodotti. Login blocca la preview → questo è il sostituto E2E.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const ROOT = path.join(__dirname, '..');

let APP;
test('ui: carica l’app per lo smoke UX', () => {
  APP = loadApp(ROOT);
  assert.ok(APP.files.length > 10, `attesi molti script, trovati ${APP.files.length}`);
});

// Helper: esegue uno scenario e ritorna l'oggetto JSON.
function ui(body) {
  const out = run(APP.ctx, `(() => { try {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    ${body}
  } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); } })()`);
  return JSON.parse(out);
}
function panelHtml() { return `document.getElementById('props-panel').innerHTML`; }

test('ui: AP = wireless per definizione (niente toggle, fisarmonica sempre); PC = toggle opzionale', () => {
  const r = ui(`
    const ap={id:'ap',type:'ap',name:'AP',x:0,y:0,w:60,h:40,ports:1,radios:[{ssid:'Az',vlan:30}]};
    const pc={id:'pc',type:'pc',name:'PC',x:0,y:0,w:60,h:40,ports:1};   // wifi-capable ma OFF
    state.nodes.push(ap,pc); if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='ap'; renderProps();  const apH=${panelHtml()};
    selType='node'; selId='pc'; renderProps();  const pcH=${panelHtml()};
    return JSON.stringify({ ok:true,
      apToggle: apH.indexOf("setDeviceWifi('ap'")>=0,
      apWirelessAcc: apH.indexOf("setPropsSectionState('wireless'")>=0,
      apRadioMgr: apH.indexOf("setNodeRadioCount('ap'")>=0,
      pcToggle: pcH.indexOf("setDeviceWifi('pc'")>=0,
      pcWirelessAcc: pcH.indexOf("setPropsSectionState('wireless'")>=0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(!r.apToggle, 'AP: NESSUN toggle Wi-Fi (è wireless per definizione)');
  assert.ok(r.apWirelessAcc, 'AP: fisarmonica WIRELESS sempre presente');
  assert.ok(r.apRadioMgr, 'AP: gestore interfacce radio dentro WIRELESS');
  assert.ok(r.pcToggle, 'PC: toggle Wi-Fi presente (opzionale, wifi-capable)');
  assert.ok(!r.pcWirelessAcc, 'PC wifi-OFF: nessuna fisarmonica WIRELESS');
});

test('ui: multi-porta LAN solo su floor non-passivi e non pass-through', () => {
  const r = ui(`
    const mk=(id,type)=>({id,type,name:id,x:0,y:0,w:60,h:40,ports:(TYPES[type]&&TYPES[type].ports)||1});
    const printer=mk('pr','printer'), wall=mk('wp','wallport'), voip=mk('vp','voip'), panel=mk('qd','panelboard');
    state.nodes.push(printer,wall,voip,panel); if(typeof _invalidateIdx==='function') _invalidateIdx();
    const has = id => { selType='node'; selId=id; renderProps(); return ${panelHtml()}.indexOf("setPropsSectionState('floor-ports'")>=0; };
    return JSON.stringify({ ok:true, printer:has('pr'), wall:has('wp'), voip:has('vp'), panel:has('qd') });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(r.printer, 'printer (non-passivo): deve avere "Porte di rete"');
  assert.ok(!r.wall, 'presa a muro (pass-through): niente multi-porta');
  assert.ok(!r.voip, 'VoIP (pass-through): niente multi-porta');
  assert.ok(!r.panel, 'quadro elettrico (passivo): niente multi-porta');
});

test('ui: pannello cavo trunk → nativa editabile + VLAN trasportate (derivato)', () => {
  const r = ui(`
    const rt={id:'rt',type:'router',name:'RT',rackId:state.currentRack,radios:[{ssids:[{id:'a',ssid:'A',vlan:30},{id:'b',ssid:'B',vlan:40}]}]};
    const sw={id:'sw',type:'switch',name:'SW',rackId:state.currentRack};
    state.nodes.push(rt,sw); if(typeof _invalidateIdx==='function') _invalidateIdx();
    const up=_createLinkRecord('rt-1','sw-3'); state.links.push(up); if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    selType='link'; selId=up.id; renderProps(); const h=${panelHtml()};
    return JSON.stringify({ ok:true,
      nativeEditable: h.indexOf("setLinkNativeVlan('"+up.id+"'")>=0,
      trunkVlansField: h.indexOf("setLinkTrunkVlans('"+up.id+"'")>=0,
      trunkBadge: h.indexOf('TRUNK')>=0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(r.trunkBadge, 'cavo router→switch: badge TRUNK (derivato dagli SSID)');
  assert.ok(r.nativeEditable, 'campo VLAN nativa editabile (setLinkNativeVlan)');
  assert.ok(r.trunkVlansField, 'campo VLAN trasportate presente');
});

test('ui: associazione wireless → solo proprietà radio, niente specifiche cavo', () => {
  const r = ui(`
    const a={id:'wa',type:'ap',name:'AP',x:0,y:0,w:60,h:40,ports:1,radios:[{ssid:'Off',band:'5'}]};
    const b={id:'wb',type:'pc',name:'Rep',x:200,y:0,w:60,h:40,ports:1,radios:[{}]};
    state.nodes.push(a,b); if(typeof _invalidateIdx==='function') _invalidateIdx();
    const wl=_createLinkRecord('wa-radio','wb-radio'); wl.wireless=true; state.links.push(wl); if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='link'; selId=wl.id; renderProps(); const h=${panelHtml()};
    return JSON.stringify({ ok:true,
      hasRssi: h.indexOf("'rssi'")>=0,
      noCableType: h.indexOf("'cableType'")<0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(r.hasRssi, 'pannello associazione: campo RSSI');
  assert.ok(r.noCableType, 'wireless: nessun campo specifiche cavo (cableType)');
});

test('ui: card VLAN → toggle "nativa" per-riga (no più campo numerico)', () => {
  const r = ui(`
    state.vlanColors = Object.assign({}, state.vlanColors||{}, { 99:'#00d4ff' });
    selType=null; selId=null; renderProps(); const h=${panelHtml()};
    return JSON.stringify({ ok:true,
      toggle: h.indexOf('toggleSiteNativeVlan(99)')>=0,
      noOldField: h.indexOf('setSiteNativeVlan(this.value)')<0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(r.toggle, 'card VLAN: toggle nativa per-riga (toggleSiteNativeVlan)');
  assert.ok(r.noOldField, 'il vecchio campo numerico "VLAN nativa predefinita" è stato rimosso');
});

test('ui: badge radio — floor 8 anchor perimetrali, rack in fila a sinistra', () => {
  const r = ui(`
    const apF={id:'apf',type:'ap',name:'F',x:0,y:0,w:60,h:40,ports:1,radios:[{},{},{},{},{},{},{},{}]};
    const rtR={id:'rtr',type:'router',name:'R',rackId:state.currentRack,radios:[{},{}]};
    state.nodes.push(apF,rtR); if(typeof _invalidateIdx==='function') _invalidateIdx();
    const floorH=_radioPortHtml(apF), rackH=_radioPortHtml(rtR);
    return JSON.stringify({ ok:true,
      floorAnchors: (floorH.match(/radio-port/g)||[]).length,
      floorHasCorners: floorH.indexOf('pos-tr')>=0 && floorH.indexOf('pos-bl')>=0,
      rackRow: rackH.indexOf('rack-radios')>=0 && rackH.indexOf('pos-rack')>=0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.equal(r.floorAnchors, 8, 'floor: 8 badge radio sul perimetro');
  assert.ok(r.floorHasCorners, 'floor: ancore agli angoli (pos-tr/pos-bl)');
  assert.ok(r.rackRow, 'rack: badge in fila (.rack-radios .pos-rack)');
});

test('ui: card info di sistema SNMP (sysLocation/sysContact/uptime) — solo se presenti', () => {
  const r = ui(`
    const mk=(id,sys)=>({id,type:'printer',name:id,x:0,y:0,w:60,h:40,ports:1,ip:'192.168.1.13',
      integration:{driver:'snmp-v2c',community:'public',system:sys}});
    const withSys=mk('p-sys',{sysLocation:'Camera',sysContact:'admin@az.local',sysUpTimeText:'12d 4h 30m',sysUpTimeTicks:1});
    const noSys  =mk('p-none',null);
    state.nodes.push(withSys,noSys); if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='p-sys';  renderProps(); const a=${panelHtml()};
    selType='node'; selId='p-none'; renderProps(); const b=${panelHtml()};
    return JSON.stringify({ ok:true,
      hasLoc:     a.indexOf('Camera')>=0,
      hasContact: a.indexOf('admin@az.local')>=0,
      hasUptime:  a.indexOf('12d 4h 30m')>=0,
      hasCard:    a.indexOf('rgba(139,148,158')>=0,
      noneCard:   b.indexOf('rgba(139,148,158')>=0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(r.hasLoc,     'mostra sysLocation');
  assert.ok(r.hasContact, 'mostra sysContact');
  assert.ok(r.hasUptime,  'mostra uptime formattato');
  assert.ok(r.hasCard,    'card info di sistema presente (palette grigia neutra)');
  assert.ok(!r.noneCard,  'senza system: nessuna card (niente rumore)');
});

test('ui: card Printer-MIB (toner % + contapagine + stato) sul device stampante', () => {
  const r = ui(`
    const pr={id:'prn',type:'printer',name:'HP',x:0,y:0,w:60,h:40,ports:1,ip:'192.168.1.13',
      integration:{driver:'snmp-v2c',community:'public',printer:{
        supplies:[{index:1,name:'cyan ink',color:'cyan',pct:45},
                  {index:4,name:'black ink',color:'black',pct:8}],
        pageCount:2939,status:'idle'}}};
    state.nodes.push(pr); if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='prn'; renderProps(); const h=${panelHtml()};
    return JSON.stringify({ ok:true,
      hasToner:  h.indexOf('cyan ink')>=0,
      hasPct:    h.indexOf('45%')>=0,
      lowRed:    h.indexOf('#f85149')>=0 && h.indexOf('8%')>=0,
      hasPages:  h.indexOf('2.939')>=0 || h.indexOf('2,939')>=0 || h.indexOf('2939')>=0,
      hasBar:    h.indexOf('width:45%')>=0,
      hasSwatch: h.indexOf('#22b8cf')>=0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(r.hasToner,  'mostra il materiale di consumo (cyan ink)');
  assert.ok(r.hasPct,    'mostra la percentuale toner');
  assert.ok(r.lowRed,    'toner basso (<10%) evidenziato in rosso');
  assert.ok(r.hasPages,  'mostra il contapagine formattato');
  assert.ok(r.hasBar,    'barra toner proporzionale alla percentuale');
  assert.ok(r.hasSwatch, 'swatch colore inchiostro (ciano)');
});

test('ui: card HOST-RESOURCES (CPU/RAM/dischi) sul device NAS', () => {
  const r = ui(`
    const nas={id:'nas',type:'nas',name:'NAS',x:0,y:0,w:60,h:40,ports:1,ip:'192.168.1.120',
      integration:{driver:'snmp-v2c',community:'public',hostResources:{
        cpuLoad:3,cpuCores:4,
        ram:{pct:99,usedBytes:12240000000,totalBytes:12400000000},
        volumes:[{name:'/volume1',kind:'fixedDisk',pct:34,usedBytes:2600000000000,totalBytes:7670000000000}]}}};
    state.nodes.push(nas); if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='nas'; renderProps(); const h=${panelHtml()};
    return JSON.stringify({ ok:true,
      hasCpu:   h.indexOf('CPU')>=0 && h.indexOf('4 core')>=0,
      hasRam:   h.indexOf('RAM')>=0 && h.indexOf('99%')>=0,
      ramRed:   h.indexOf('#f85149')>=0,
      hasVol:   h.indexOf('/volume1')>=0,
      hasTB:    h.indexOf('TB')>=0,
      hasGB:    h.indexOf('GB')>=0 });
  `);
  assert.ok(r.ok, 'render lancia: ' + r.err);
  assert.ok(r.hasCpu, 'mostra CPU + numero core');
  assert.ok(r.hasRam, 'mostra RAM + percentuale');
  assert.ok(r.ramRed, 'occupazione >=90% in rosso');
  assert.ok(r.hasVol, 'mostra il volume');
  assert.ok(r.hasTB && r.hasGB, 'dimensioni formattate (GB/TB)');
});
