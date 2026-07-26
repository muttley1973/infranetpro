'use strict';
// ============================================================
// Layer 4c dell'auto-link: ASSOCIAZIONI WIRELESS dalla FDB (src/app-autolink.js →
// _autoLinkWirelessAssoc). Un MAC endpoint appreso nella FDB di un apparato su una sua
// interfaccia WIRELESS = client associato via onda. Chiave dell'apparato TUTT'UNO
// (router+AP+switch): la sua FDB contiene già i client wireless, appresi sulle radio.
// Il client scoperto riceve una radio-stazione e si aggancia alla radio dell'AP (BSS
// per match VLAN). Manual-first: non tocca i link manuali; gestisce solo WIFI-FDB.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (autolink-wireless-assoc)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('all-in-one: il client su interfaccia radio → onda radio↔radio; il cablato resta al Layer wired', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];  // parti da una tela pulita
    state.nodes.push(
      { id:'aio', type:'router', name:'AllInOne', ports:5,
        radios:[{ band:'2.4', ssids:[{ id:'ssidA', ssid:'Casa', vlan:10 }] }] },
      { id:'pcw', type:'pc', name:'Laptop',  ports:1, mac:'aa:bb:cc:00:00:11' },  // via WiFi
      { id:'pce', type:'pc', name:'Desktop', ports:1, mac:'aa:bb:cc:00:00:22' }   // cablato
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const fdb = {};
    fdb[_normMacKey('aa:bb:cc:00:00:11')] = 'wlan0';               // laptop appreso su radio
    fdb[_normMacKey('aa:bb:cc:00:00:22')] = 'GigabitEthernet0/2';  // desktop su porta ethernet
    const fv = {}; fv[_normMacKey('aa:bb:cc:00:00:11')] = 10;
    window._topoFdbCache     = { aio: fdb };
    window._topoFdbVlanCache = { aio: fv };
    window._topoWifiIfsCache = { aio: ['wlan0'] };
    const res = _autoLinkWirelessAssoc();
    const links = state.links.map(l => ({ src:l.src, dst:l.dst, wireless:!!l.wireless, proto:l.protocol||'', bss:l.bss||'', auto:!!l.autoLinked, conf:l.confidence }));
    return JSON.stringify({ res, links, pcwRadios:(nodeById('pcw').radios||[]).length, pceRadios:(nodeById('pce').radios||[]).length });
  })()`));
  assert.equal(r.res.created, 1, 'crea UNA sola onda (il laptop wireless)');
  assert.equal(r.res.updated, 0);
  assert.equal(r.links.length, 1, 'il desktop cablato NON è compito del Layer 4c (nessun cavo qui)');
  const l = r.links[0];
  assert.equal(l.wireless, true);
  assert.equal(l.proto, 'WIFI-FDB');
  assert.equal(l.auto, true);
  assert.equal(l.conf, 0.85);
  assert.equal(l.bss, 'ssidA', 'BSS scelto per match VLAN 10');
  assert.deepEqual([l.src, l.dst].sort(), ['aio-radio', 'pcw-radio'], 'onda tra la radio dell\'AP e la radio-stazione del client');
  assert.equal(r.pcwRadios, 1, 'il client wireless ha ricevuto una radio-stazione');
  assert.equal(r.pceRadios, 0, 'il client cablato NON riceve radio');
});

test('BSS per match VLAN: due SSID su VLAN diverse → sceglie quello giusto', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];  // parti da una tela pulita
    state.nodes.push(
      { id:'ap1', type:'ap', name:'AP', ports:1,
        radios:[{ band:'5', ssids:[{ id:'sGuest', ssid:'Guest', vlan:20 }, { id:'sCorp', ssid:'Corp', vlan:30 }] }] },
      { id:'ph1', type:'voip', name:'Phone', ports:1, mac:'de:ad:be:ef:00:30' }
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const fdb = {}; fdb[_normMacKey('de:ad:be:ef:00:30')] = 'ath0';
    const fv  = {}; fv[_normMacKey('de:ad:be:ef:00:30')] = 30;
    window._topoFdbCache = { ap1: fdb };
    window._topoFdbVlanCache = { ap1: fv };
    window._topoWifiIfsCache = { ap1: ['ath0'] };
    const res = _autoLinkWirelessAssoc();
    const l = state.links[0] || {};
    return JSON.stringify({ created:res.created, bss:l.bss||'', wireless:!!l.wireless });
  })()`));
  assert.equal(r.created, 1);
  assert.equal(r.wireless, true);
  assert.equal(r.bss, 'sCorp', 'VLAN 30 → BSS Corp');
});

test('manual-first: associazione MANUALE sul client non viene toccata', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];  // parti da una tela pulita
    state.nodes.push(
      { id:'ap2', type:'ap', name:'AP', ports:1, radios:[{ ssids:[{ id:'sM', ssid:'Net', vlan:1 }] }] },
      { id:'cl2', type:'pc', name:'PC', ports:1, mac:'11:22:33:44:55:66', radios:[{}] }
    );
    // onda MANUALE già presente sul client (autoLinked assente)
    state.links.push({ id:'lman', src:'ap2-radio', dst:'cl2-radio', wireless:true });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const fdb = {}; fdb[_normMacKey('11:22:33:44:55:66')] = 'wlan0';
    window._topoFdbCache = { ap2: fdb };
    window._topoFdbVlanCache = { ap2: {} };
    window._topoWifiIfsCache = { ap2: ['wlan0'] };
    const res = _autoLinkWirelessAssoc();
    const l = state.links.find(x => x.id === 'lman') || {};
    return JSON.stringify({ res, links:state.links.length, stillManual: !l.autoLinked, proto:l.proto||l.protocol||'' });
  })()`));
  assert.equal(r.res.created, 0, 'niente creato: il client ha già un link manuale');
  assert.equal(r.res.updated, 0);
  assert.equal(r.links, 1);
  assert.equal(r.stillManual, true, 'il link manuale resta manuale (nessun autoLinked/WIFI-FDB sovrascritto)');
});

test('device senza radio: un MAC su nome-radio nella FDB NON fabbrica onde (serve un AP)', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];  // parti da una tela pulita
    state.nodes.push(
      { id:'sw9', type:'switch', name:'SW', ports:24 },                 // nessuna radio
      { id:'pcx', type:'pc', name:'PC', ports:1, mac:'ca:fe:00:00:00:01' }
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const fdb = {}; fdb[_normMacKey('ca:fe:00:00:00:01')] = 'wlan0';
    window._topoFdbCache = { sw9: fdb };
    window._topoFdbVlanCache = { sw9: {} };
    window._topoWifiIfsCache = { sw9: ['wlan0'] };
    const res = _autoLinkWirelessAssoc();
    return JSON.stringify({ res, links:state.links.length, pcxRadios:(nodeById('pcx').radios||[]).length });
  })()`));
  assert.equal(r.res.created, 0, 'lo switch non ha radio → non è un AP → nessuna onda');
  assert.equal(r.links, 0);
  assert.equal(r.pcxRadios, 0, 'il client non riceve una radio se non c\'è un AP a cui associarlo');
});

test('caso reale HP: stampante che espone il proprio Wifi0 con FDB vuota → 0 onde, 0 radio', () => {
  // Riproduce il device reale OfficeJet8715 visto dal vivo: si auto-dichiara con
  // wifiIfs=[Wifi0] (la SUA interfaccia di connessione), ma NON è un AP — non ha radio
  // modellate e la sua FDB è vuota (una stampante non è un bridge). Il suo Wifi0 deve
  // restare INERTE: nessuna radio aggiunta alla stampante, nessuna onda fabbricata.
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'prn', type:'printer', name:'OfficeJet', ports:1, mac:'aa:bb:cc:dd:ee:0f' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    window._topoFdbCache     = { prn: {} };           // stampante = NON bridge → FDB vuota
    window._topoFdbVlanCache = { prn: {} };
    window._topoWifiIfsCache = { prn: ['Wifi0'] };     // la SUA interfaccia radio, auto-dichiarata
    const res = _autoLinkWirelessAssoc();
    return JSON.stringify({ res, links: state.links.length, prnRadios: (nodeById('prn').radios||[]).length });
  })()`));
  assert.equal(r.res.created, 0, 'il Wifi0 della stampante è inerte: non è un AP (FDB vuota)');
  assert.equal(r.links, 0, 'nessuna onda creata');
  assert.equal(r.prnRadios, 0, 'nessuna radio-stazione aggiunta alla stampante');
});

test('PC-SoftAP: FDB vuota ma vicino L3 su radio + SSID → onda WIFI-NBR', () => {
  // Riproduce un PC-hotspot (Windows/Linux): NON espone la FDB bridge, ma il client
  // associato è nella tabella vicini (ARP/ND) sull'interfaccia radio → wifiNeighborMacs.
  // Il device trasmette un SSID (è un AP) → il path L3 è abilitato.
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push(
      { id:'softap', type:'pc', name:'PC-Hotspot', ports:1, radios:[{ ssids:[{ id:'sHot', ssid:'Hotspot', vlan:1 }] }] },
      { id:'cl', type:'pc', name:'Phone', ports:1, mac:'02:11:22:33:44:55' }   // MAC randomizzato = client WiFi
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    window._topoFdbCache     = { softap: {} };                       // SoftAP: nessuna FDB bridge
    window._topoFdbVlanCache = { softap: {} };
    window._topoWifiIfsCache = { softap: [] };
    window._topoWifiNbrCache = { softap: ['02:11:22:33:44:55'] };    // client visto come vicino su radio
    const res = _autoLinkWirelessAssoc();
    const l = state.links[0] || {};
    return JSON.stringify({ res:{created:res.created,protocols:[...(res.protocols||[])]}, wireless:!!l.wireless, proto:l.protocol||'', conf:l.confidence, clRadios:(nodeById('cl').radios||[]).length });
  })()`));
  assert.equal(r.res.created, 1, 'l\'onda si crea dal segnale L3 anche senza FDB');
  assert.equal(r.wireless, true);
  assert.equal(r.proto, 'WIFI-NBR', 'protocollo del path vicino L3');
  assert.equal(r.conf, 0.80);
  assert.deepEqual(r.res.protocols, ['WIFI-NBR']);
  assert.equal(r.clRadios, 1, 'il client riceve la radio-stazione');
});

test('anti-feedback: un vicino L3 su radio ma SENZA SSID (stazione) NON crea onde', () => {
  // Una radio-STAZIONE (senza SSID) vede l'AP fra i propri vicini su wlan. Se il path L3
  // scattasse, scambierebbe la stazione per un AP (direzione invertita) e innescherebbe un
  // loop. La guardia «SSID richiesto» lo impedisce: apSsidList vuota → path L3 disattivato.
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push(
      { id:'sta', type:'pc', name:'Station', ports:1, radios:[{}] },          // radio-stazione, NESSUN ssid
      { id:'peer', type:'pc', name:'Peer', ports:1, mac:'aa:00:00:00:00:99' }
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    window._topoFdbCache     = { sta: {} };
    window._topoFdbVlanCache = { sta: {} };
    window._topoWifiIfsCache = { sta: [] };
    window._topoWifiNbrCache = { sta: ['aa:00:00:00:00:99'] };                // vicino su radio
    const res = _autoLinkWirelessAssoc();
    return JSON.stringify({ created:res.created, links:state.links.length });
  })()`));
  assert.equal(r.created, 0, 'senza SSID il device non è un AP → nessuna onda dal path L3');
  assert.equal(r.links, 0);
});

test('prune manual-first: onda WIFI-FDB AUTO stantia su AP riscansionato viene rimossa', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];  // parti da una tela pulita
    state.nodes.push(
      { id:'ap3', type:'ap', name:'AP', ports:1, radios:[{ ssids:[{ id:'sX', ssid:'X', vlan:5 }] }] },
      { id:'old', type:'pc', name:'Old', ports:1, mac:'00:00:00:00:0a:aa', radios:[{}] },  // non più associato
      { id:'new', type:'pc', name:'New', ports:1, mac:'00:00:00:00:0b:bb' }                // ora associato
    );
    // onda AUTO precedente per il client 'old' (il cui MAC NON è più nella FDB)
    state.links.push({ id:'lold', src:'ap3-radio', dst:'old-radio', wireless:true, autoLinked:true, protocol:'WIFI-FDB' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const fdb = {}; fdb[_normMacKey('00:00:00:00:0b:bb')] = 'wlan0';   // solo 'new' è presente ora
    window._topoFdbCache = { ap3: fdb };
    window._topoFdbVlanCache = { ap3: {} };
    window._topoWifiIfsCache = { ap3: ['wlan0'] };
    const res = _autoLinkWirelessAssoc();
    const ids = state.links.map(l => l.id || (l.dst));
    return JSON.stringify({ res, dsts: state.links.map(l => l.dst), hasOld: state.links.some(l => l.dst==='old-radio'), hasNew: state.links.some(l => l.dst==='new-radio') });
  })()`));
  assert.equal(r.res.created, 1, 'crea l\'onda per il nuovo client');
  assert.equal(r.res.pruned, 1, 'rimuove l\'onda stantia del vecchio client (AP riscansionato, client non più associato)');
  assert.equal(r.hasOld, false, 'onda stantia rimossa');
  assert.equal(r.hasNew, true, 'onda del client attuale presente');
});
