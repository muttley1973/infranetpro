// Test per la logica PURA della scoperta associazioni wireless (lib/wifi-assoc.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/wifi-assoc.js');

test('isWirelessInterface: ifType ieee80211(71) è autorevole a prescindere dal nome', () => {
  assert.equal(W.isWirelessInterface('GigabitEthernet0/1', 71), true);   // nome ethernet, ma ifType=71 vince
  assert.equal(W.isWirelessInterface('anything', '71'), true);           // stringa numerica ok
  assert.equal(W.isWirelessInterface('eth0', 6), false);                 // ethernetCsmacd
});

test('isWirelessInterface: pattern nome vendor-neutral (radio) → true', () => {
  for (const n of ['wlan0', 'wlan1', 'wl0', 'wifi0', 'wifi', 'wi-fi', 'ath0', 'ath1',
                   'ra0', 'rai0', 'wlp2s0', 'radio0', 'Dot11Radio0', 'apcli0', 'wds0',
                   'br-wlan', 'WLAN2.4', 'Wireless']) {
    assert.equal(W.isWirelessInterface(n), true, `atteso wireless: ${n}`);
  }
});

test('isWirelessInterface: NON confondere ethernet/velocità/wan con wireless', () => {
  for (const n of ['GigabitEthernet0/1', 'Gi1/0/1', 'Te1/1/1', 'eth0', 'eno1', 'enp3s0',
                   'Port-channel1', 'ae0', 'bond0', '1', '10G', '1G', '40GbE', 'lo',
                   'vlan10', 'wan1', 'lan1', 'wwan0', 'camera0', 'infra0', 'docker0']) {
    assert.equal(W.isWirelessInterface(n), false, `NON wireless: ${n}`);
  }
});

test('isWirelessInterface: i nomi di fabbrica di OpenWrt attuale e della chiavetta USB', () => {
  // ⚠️ Misurati il 01/09 come falsi negativi VERI, su piattaforme che COMPATIBILITY.md
  // dichiara supportate. Su Linux una radio in modalità AP si presenta al kernel come
  // ethernet (net-snmp riporta ifType=6, non 71): il nome è l'unico canale rimasto, e
  // non riconoscerlo vuol dire non vedere niente — in silenzio, come tutti gli altri
  // cancelli di questa catena.
  for (const n of ['phy0-ap0', 'phy1-ap0', 'phy0-sta0', 'phy0-mesh0',
                   'wlx00c0ca123456', 'wlxa0b1c2d3e4f5']) {
    assert.equal(W.isWirelessInterface(n), true, `atteso wireless: ${n}`);
  }
});

test('isWirelessInterface: le esclusioni VOLUTE restano fuori, e non sono lacune', () => {
  // ⛔ Nomi di DRIVER FreeBSD: la rete non ci gira sopra, si clona un `wlan0` con
  // `ifconfig wlan0 create wlandev ath0` ed è quello a portare il traffico — già
  // coperto sopra. Riconoscerli allargherebbe la regex a interfacce che non hanno
  // mai un client, senza guadagnare un'onda.
  for (const n of ['run0', 'iwm0', 'rtwn0', 'bwn0']) {
    assert.equal(W.isWirelessInterface(n), false, `driver FreeBSD, non porta client: ${n}`);
  }
  // ⛔ Modalità MONITOR: cattura pacchetti, non ha associati. Dirla wireless sarebbe
  // vero della radio e falso di quello che ci si chiede — se ha client attaccati.
  assert.equal(W.isWirelessInterface('mon0'), false, 'monitor: nessun associato');
});

test('isWirelessInterface: le aggiunte non aprono falsi positivi sul cablato', () => {
  // ⭐ È il verso che conta di più: un falso positivo disegna un client CABLATO come
  // associazione wireless, cioè scrive nel documento una cosa falsa. Un falso negativo
  // perde un'onda. `phy…` e `wlx…` sono stretti apposta — la controparte cablata di
  // `wlx` è `enx`, e `phyN` in Linux è per definizione la PHY wireless.
  for (const n of ['enx00c0ca123456', 'phy0', 'phy0-eth0', 'physical0', 'phyto1',
                   'wlxyz', 'sfp-sfpplus1', 'bridge-local', 'br-lan', 'ether1']) {
    assert.equal(W.isWirelessInterface(n), false, `NON wireless: ${n}`);
  }
});

test('isWirelessInterface: input vuoto/nullo → false', () => {
  assert.equal(W.isWirelessInterface(''), false);
  assert.equal(W.isWirelessInterface(null), false);
  assert.equal(W.isWirelessInterface(undefined), false);
});

test('wirelessIfNames: filtra i nomi wireless da una mappa ifName→ifType', () => {
  const names = W.wirelessIfNames({ 'GigabitEthernet0/1': 6, 'wlan0': 71, 'ath0': 6, 'Te1/1': 6 });
  assert.deepEqual(names.sort(), ['ath0', 'wlan0']);   // wlan0 via ifType, ath0 via nome
});

test('classifyFdbAssociations: partiziona FDB in wireless vs cablato (all-in-one)', () => {
  // Apparato TUTT'UNO: la sua FDB ha client wireless su wlan0 e client cablati su le porte.
  const fdb = {
    'aa:aa:aa:aa:aa:aa': 'wlan0',              // telefono via WiFi
    'bb:bb:bb:bb:bb:bb': 'GigabitEthernet0/2', // PC cablato
    'cc:cc:cc:cc:cc:cc': 'wlan0',              // laptop via WiFi
  };
  const fdbVlan = { 'aa:aa:aa:aa:aa:aa': 20, 'cc:cc:cc:cc:cc:cc': 10 };
  const { wireless, wired } = W.classifyFdbAssociations({ fdb, wifiIfs: ['wlan0'], fdbVlan });
  assert.equal(wireless.length, 2);
  assert.equal(wired.length, 1);
  assert.deepEqual(wireless.map(r => r.mac).sort(), ['aa:aa:aa:aa:aa:aa', 'cc:cc:cc:cc:cc:cc']);
  assert.equal(wireless.find(r => r.mac === 'aa:aa:aa:aa:aa:aa').vlan, 20);
  assert.equal(wired[0].mac, 'bb:bb:bb:bb:bb:bb');
  assert.equal(wired[0].vlan, null);            // nessuna VLAN nota → null
});

test('classifyFdbAssociations: senza wifiIfs cade sul predicato per-nome/ifType', () => {
  const fdb = { m1: 'ath0', m2: 'Gi0/1' };
  const { wireless, wired } = W.classifyFdbAssociations({ fdb, ifTypeByName: { 'Gi0/1': 6 } });
  assert.deepEqual(wireless.map(r => r.mac), ['m1']);   // ath0 riconosciuta per nome
  assert.deepEqual(wired.map(r => r.mac), ['m2']);
});

test('resolveClientAssoc: match VLAN univoco → sceglie quel BSS', () => {
  const apSsidList = [
    { radioIdx: 0, id: 's-guest', ssid: 'Guest', vlan: 20, band: '2.4' },
    { radioIdx: 1, id: 's-corp',  ssid: 'Corp',  vlan: 10, band: '5' },
  ];
  assert.deepEqual(W.resolveClientAssoc({ apSsidList, vlan: 10 }), { radioIdx: 1, bssId: 's-corp' });
  assert.deepEqual(W.resolveClientAssoc({ apSsidList, vlan: 20 }), { radioIdx: 0, bssId: 's-guest' });
});

test('resolveClientAssoc: VLAN assente o ambigua → nessun BSS (no-invenzioni)', () => {
  const apSsidList = [
    { radioIdx: 0, id: 's-a', ssid: 'A', vlan: 10 },
    { radioIdx: 0, id: 's-b', ssid: 'B', vlan: 10 },   // stessa VLAN → ambiguo
  ];
  // VLAN 10 combacia con DUE BSS → non indovina; aggancia alla 1ª radio senza BSS.
  assert.deepEqual(W.resolveClientAssoc({ apSsidList, vlan: 10 }), { radioIdx: 0, bssId: null });
  // Nessuna VLAN nota, più BSS → nessuna scelta certa.
  assert.deepEqual(W.resolveClientAssoc({ apSsidList, vlan: null }), { radioIdx: 0, bssId: null });
});

test('resolveClientAssoc: BSS unico → scelto anche senza VLAN; AP senza SSID → radio 0 / no BSS', () => {
  const one = [{ radioIdx: 2, id: 's-only', ssid: 'Home', vlan: 1 }];
  assert.deepEqual(W.resolveClientAssoc({ apSsidList: one, vlan: null }), { radioIdx: 2, bssId: 's-only' });
  assert.deepEqual(W.resolveClientAssoc({ apSsidList: [], vlan: 30 }), { radioIdx: 0, bssId: null });
  assert.deepEqual(W.resolveClientAssoc({}), { radioIdx: 0, bssId: null });
});

test('collectWirelessClients: unisce FDB (L2) e vicini L3, dedup con priorità alla FDB', () => {
  const fdb = { 'aa:aa:aa:aa:aa:aa': 'wlan0', 'bb:bb:bb:bb:bb:bb': 'Gi0/1' };  // aa via radio, bb cablato
  const fdbVlan = { 'aa:aa:aa:aa:aa:aa': 10 };
  const out = W.collectWirelessClients({
    fdb, wifiIfs: ['wlan0'], fdbVlan,
    wifiNeighborMacs: ['cc:cc:cc:cc:cc:cc', 'aa:aa:aa:aa:aa:aa'],  // cc solo-vicino; aa già in FDB
  });
  // aa (fdb, VLAN 10) + cc (neighbor). bb è cablato → escluso. aa NON duplicato.
  assert.equal(out.length, 2);
  const aa = out.find(x => x.mac === 'aa:aa:aa:aa:aa:aa');
  const cc = out.find(x => x.mac === 'cc:cc:cc:cc:cc:cc');
  assert.deepEqual({ src: aa.source, vlan: aa.vlan }, { src: 'fdb', vlan: 10 }, 'la FDB (L2) vince sul vicino L3');
  assert.deepEqual({ src: cc.source, vlan: cc.vlan }, { src: 'neighbor', vlan: null }, 'MAC solo-vicino = source neighbor');
});

test('collectWirelessClients: solo vicini L3 (FDB vuota) → tutti source neighbor (caso SoftAP)', () => {
  const out = W.collectWirelessClients({
    fdb: {}, wifiIfs: [],                                   // un SoftAP non espone la FDB bridge
    wifiNeighborMacs: ['de:ad:00:00:00:01', 'de:ad:00:00:00:02'],
    fdbVlan: { 'de:ad:00:00:00:02': 20 },
  });
  assert.equal(out.length, 2);
  assert.ok(out.every(x => x.source === 'neighbor'));
  assert.equal(out.find(x => x.mac === 'de:ad:00:00:00:02').vlan, 20);
});

test('isUnicastMac: unicast sì; broadcast/multicast/null no', () => {
  assert.equal(W.isUnicastMac('2e:f5:0b:aa:cd:4a'), true);   // client reale (randomizzato ma unicast)
  assert.equal(W.isUnicastMac('aa:bb:cc:dd:ee:ff'), true);
  assert.equal(W.isUnicastMac('ff:ff:ff:ff:ff:ff'), false);  // broadcast
  assert.equal(W.isUnicastMac('01:00:5e:00:00:16'), false);  // multicast IPv4
  assert.equal(W.isUnicastMac('33:33:00:00:00:01'), false);  // multicast IPv6
  assert.equal(W.isUnicastMac('00:00:00:00:00:00'), false);  // nullo (ARP incompleto)
  assert.equal(W.isUnicastMac(''), false);
  assert.equal(W.isUnicastMac('non-un-mac'), false);
});

test('collectWirelessClients: i vicini L3 broadcast/multicast/null sono scartati (rumore ARP reale)', () => {
  // MAC misurati dal vivo su un hotspot Windows: solo il client unicast deve restare.
  const out = W.collectWirelessClients({
    fdb: {}, wifiIfs: [],
    wifiNeighborMacs: ['2e:f5:0b:aa:cd:4a', 'ff:ff:ff:ff:ff:ff', '01:00:5e:00:00:16', '00:00:00:00:00:00'],
  });
  assert.equal(out.length, 1, 'resta solo il client unicast reale');
  assert.equal(out[0].mac, '2e:f5:0b:aa:cd:4a');
  assert.equal(out[0].source, 'neighbor');
});
