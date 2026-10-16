'use strict';
// Che COSA è un vicino LLDP/CDP: dalle prove che annuncia (capabilities, piattaforma).
//
// Prima ogni vicino non documentato nasceva «switch da 24 porte in rack»: un access point,
// un telefono, un server finivano nello scaffale col tipo sbagliato. I casi qui sotto sono
// gli annunci reali dei banchi: i byte sono quelli che l'agente consegna.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLldpCaps, parseCdpCaps, parseNeighborCaps, inferNeighborType, usableNeighborIp, dropMaterialized,
} = require('../lib/neighbor-type.js');

// LLDP-MIB LldpSystemCapabilitiesMap — bit 0 = MSB: other, repeater, bridge, wlanAP, router, phone, docsis, station
const LLDP = { bridge: '2000', bridgeRouter: '2800', router: '0800', ap: '1000', apBridge: '3000', phone: '0400',
               phoneBridge: '2400', station: '0100', repeater: '4000' };
// CISCO-CDP-MIB cdpCacheCapabilities — 4 byte big-endian: 1 router, 2 trans-bridge, 8 switch, 0x10 host, 0x20 IGMP
const CDP = { switchIgmp: '00000028', routerSwitch: '00000029', router: '00000001', host: '00000010', bridge: '00000002' };

test('LLDP: i bit si leggono dal più significativo (bit 0 = 0x80)', () => {
  assert.deepEqual(
    Object.entries(parseLldpCaps('3000')).filter(([, v]) => v).map(([k]) => k).sort(), ['ap', 'bridge']);
  assert.equal(parseLldpCaps('0100').station, true);
  assert.equal(parseLldpCaps(''), null, 'nessuna colonna ⇒ nessuna prova, non «nessuna capability»');
  assert.equal(parseLldpCaps('zz'), null);
});

test('CDP: la maschera è big-endian a 4 byte; Switch (0x08) implica bridge', () => {
  const c = parseCdpCaps(CDP.switchIgmp);
  assert.equal(c.switch, true);
  assert.equal(c.bridge, true);
  assert.equal(c.router, false);
  assert.equal(parseCdpCaps(CDP.routerSwitch).router, true);
  assert.equal(parseCdpCaps(CDP.host).host, true);
});

test('parseNeighborCaps: stesso vocabolario per le due famiglie', () => {
  const l = parseNeighborCaps('LLDP', LLDP.apBridge);
  const c = parseNeighborCaps('CDP', CDP.switchIgmp);
  for (const k of ['router', 'bridge', 'ap', 'phone', 'host', 'repeater']) {
    assert.ok(k in l && k in c, k);
  }
  assert.equal(l.ap, true);
  assert.equal(c.bridge, true);
});

// ── il tipo ────────────────────────────────────────────────────────────────

test('access point: il bit wlanAccessPoint vince sul bridge che ha dentro', () => {
  assert.deepEqual(inferNeighborType({ protocol: 'LLDP', caps: LLDP.apBridge }), { type: 'ap', via: 'caps' });
});

test('telefono: il bit telephone vince sul mini-switch che ha dentro', () => {
  assert.deepEqual(inferNeighborType({ protocol: 'LLDP', caps: LLDP.phoneBridge }), { type: 'voip', via: 'caps' });
});

test('switch: solo bridge, e CDP Switch(0x08)', () => {
  assert.deepEqual(inferNeighborType({ protocol: 'LLDP', caps: LLDP.bridge }), { type: 'switch', via: 'caps' });
  assert.deepEqual(inferNeighborType({ protocol: 'CDP', caps: CDP.switchIgmp }), { type: 'switch', via: 'caps' });
});

test('router: solo router, senza bridge', () => {
  assert.deepEqual(inferNeighborType({ protocol: 'LLDP', caps: LLDP.router }), { type: 'router', via: 'caps' });
  assert.deepEqual(inferNeighborType({ protocol: 'CDP', caps: CDP.router }), { type: 'router', via: 'caps' });
});

test('bridge+router è ambiguo: lo decide il modello, e senza modello resta switch DEDOTTO', () => {
  assert.deepEqual(inferNeighborType({ protocol: 'LLDP', caps: LLDP.bridgeRouter }), { type: 'switch', via: 'default' });
  assert.deepEqual(
    inferNeighborType({ protocol: 'LLDP', caps: LLDP.bridgeRouter, platform: 'MikroTik RouterOS 7.11 (stable) RB4011iGS+' }),
    { type: 'router', via: 'platform' });
  assert.deepEqual(
    inferNeighborType({ protocol: 'LLDP', caps: LLDP.bridgeRouter, platform: 'Cisco IOS Software, Catalyst L3 Switch Software (CAT9K)' }),
    { type: 'switch', via: 'platform' });
});

test('host / station: PC, e server se la piattaforma lo dice', () => {
  assert.deepEqual(inferNeighborType({ protocol: 'LLDP', caps: LLDP.station }), { type: 'pc', via: 'caps' });
  assert.deepEqual(
    inferNeighborType({ protocol: 'LLDP', caps: LLDP.station, platform: 'Linux srv-db01 5.15.0-91-generic #101-Ubuntu SMP' }),
    { type: 'server', via: 'platform' });
  assert.deepEqual(inferNeighborType({ protocol: 'CDP', caps: CDP.host }), { type: 'pc', via: 'caps' });
});

test('piattaforma inequivocabile: vince anche sulle capabilities', () => {
  assert.equal(inferNeighborType({ protocol: 'CDP', caps: CDP.bridge, platform: 'cisco AIR-AP2802I-E-K9' }).type, 'ap');
  assert.equal(inferNeighborType({ protocol: 'CDP', caps: CDP.host, platform: 'Cisco IP Phone 8841' }).type, 'voip');
  assert.equal(inferNeighborType({ protocol: 'LLDP', caps: LLDP.bridgeRouter, platform: 'FortiGate-60F v7.2.4,build1396' }).type, 'firewall');
  assert.equal(inferNeighborType({ protocol: 'LLDP', caps: LLDP.station, platform: 'VMware ESXi 7.0.3' }).type, 'hypervisor');
  assert.equal(inferNeighborType({ protocol: 'LLDP', platform: 'HP LaserJet Pro M404dn' }).type, 'printer');
});

test('senza prove: il default storico (switch) e `via` lo dice — nessuno lo presenta come letto', () => {
  assert.deepEqual(inferNeighborType({}), { type: 'switch', via: 'default' });
  assert.deepEqual(inferNeighborType(null), { type: 'switch', via: 'default' });
  assert.deepEqual(inferNeighborType({ protocol: 'LLDP', caps: '', platform: '' }), { type: 'switch', via: 'default' });
});

test('una parola larga non rovina il tipo: «switch» dentro un testo qualunque non fa di un server uno switch', () => {
  // Il server annuncia solo station: nemmeno il testo «stateless switchover helper» lo sposta.
  assert.equal(inferNeighborType({ protocol: 'LLDP', caps: LLDP.station, platform: 'Linux node-7 (hosts the switchover helper)' }).type, 'server');
});

test('input ostile: tipi sbagliati e testi enormi non lanciano né rallentano', () => {
  for (const bad of [undefined, 5, 'x', [], { caps: {}, platform: {} }, { caps: 7, platform: 7 }]) {
    assert.doesNotThrow(() => inferNeighborType(bad));
  }
  const t0 = Date.now();
  inferNeighborType({ protocol: 'LLDP', caps: LLDP.bridge, platform: 'a'.repeat(1e6) });
  assert.ok(Date.now() - t0 < 200, 'la piattaforma è troncata prima del confronto');
});

// ── l'IP del vicino ────────────────────────────────────────────────────────

test('usableNeighborIp: solo un indirizzo di management plausibile', () => {
  assert.equal(usableNeighborIp('10.0.0.5'), '10.0.0.5');
  assert.equal(usableNeighborIp(' 192.168.1.1 '), '192.168.1.1');
  for (const bad of ['0.0.0.0', '127.0.0.1', '169.254.1.1', '224.0.0.1', '255.255.255.255', '999.1.1.1', '1.2.3', '', null, undefined, 'abc', '10.0.0.5/24']) {
    assert.equal(usableNeighborIp(bad), '', String(bad));
  }
});

// ── il riepilogo del Sync ──────────────────────────────────────────────────

test('dropMaterialized: toglie solo i «device-unknown» il cui nodo è nato, e rifà il conteggio', () => {
  const unresolved = [
    { reason: 'device-unknown', remoteDevice: 'GW', remoteIP: '10.0.0.1', remoteMac: 'aa:bb:cc:00:00:01' },
    { reason: 'device-unknown', remoteDevice: 'AP-7', remoteIP: '', remoteMac: '' },
    { reason: 'local-port-unresolved', remoteDevice: 'GW', remoteIP: '10.0.0.1', remoteMac: '' },
    { reason: 'no-identity', remoteDevice: '', remoteIP: '', remoteMac: '' },
  ];
  const out = dropMaterialized(unresolved, [{ nodeId: 'r1', mac: 'AA:BB:CC:00:00:01', ip: '10.0.0.1', hostname: 'GW' }]);
  assert.deepEqual(out.reasons, { 'device-unknown': 1, 'local-port-unresolved': 1, 'no-identity': 1 });
  assert.equal(out.unresolved.length, 3);
  assert.ok(out.unresolved.some(u => u.remoteDevice === 'AP-7'), 'quello non creato resta');
});

test('dropMaterialized: niente creati ⇒ niente cambia; ingressi non-array ⇒ vuoto', () => {
  const u = [{ reason: 'device-unknown', remoteDevice: 'X' }];
  assert.deepEqual(dropMaterialized(u, []).reasons, { 'device-unknown': 1 });
  assert.deepEqual(dropMaterialized(null, null), { unresolved: [], reasons: {} });
});
