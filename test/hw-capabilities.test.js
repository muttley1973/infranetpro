'use strict';
// ============================================================
//  test/hw-capabilities.test.js — lib/hw-capabilities.js (capacità HW, pura).
//  «InfraNet calcola»: ogni numero deve venire dai dati documentati; campo
//  assente → sotto-blocco OMESSO (paletto #2). Più: matematica PoE (caso peggiore
//  per classe), parsing velocità, aggregazione LAG, riepilogo flotta.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const {
  computeDeviceCapabilities, computeFleetCapabilities, _speedToMbps, _speedLabel,
} = require('../lib/hw-capabilities.js');

test('velocità: numero Mbps + stringhe 1G/10G/100M/nudo', () => {
  assert.equal(_speedToMbps(1000), 1000);
  assert.equal(_speedToMbps(10000), 10000);
  assert.equal(_speedToMbps('1G'), 1000);
  assert.equal(_speedToMbps('10g'), 10000);
  assert.equal(_speedToMbps('100M'), 100);
  assert.equal(_speedToMbps('1000'), 1000);
  assert.equal(_speedToMbps('2.5G'), 2500);
  assert.equal(_speedToMbps(''), null);
  assert.equal(_speedToMbps('boh'), null);
  assert.equal(_speedLabel(1000), '1G');
  assert.equal(_speedLabel(10000), '10G');
  assert.equal(_speedLabel(100), '100M');
  assert.equal(_speedLabel(2500), '2.5G');   // 802.3bz NBASE-T, non '2500M'
  assert.equal(_speedLabel(5000), '5G');
  assert.equal(_speedLabel(25000), '25G');
});

test('PoE: budget + caso peggiore per classe + headroom', () => {
  const caps = computeDeviceCapabilities({
    type: 'switch', spec: { swPoeBudgetW: 370 },
    ports: { total: 48, used: 12, free: 36, list: [
      { poe: '802.3at', speed: 1000 }, { poe: '802.3at', speed: 1000 },
      { poe: '802.3af', speed: 1000 }, { poe: '802.3bt', speed: 1000 },
      { speed: 1000 },                      // non-PoE → ignorata
    ] },
  });
  assert.ok(caps.poe, 'blocco PoE presente con budget documentato');
  assert.equal(caps.poe.budgetW, 370);
  assert.equal(caps.poe.poePorts, 4);
  assert.deepEqual(caps.poe.byClass, { af: 1, at: 2, bt: 1 });
  // worst-case = 2*30 + 1*15.4 + 1*60 = 135.4
  assert.equal(caps.poe.worstCaseW, 135.4);
  assert.equal(caps.poe.headroomW, 234.6);
});

test('PoE: senza budget documentato → nessun blocco poe (paletto #2)', () => {
  const caps = computeDeviceCapabilities({
    type: 'switch', spec: {},
    ports: { total: 24, free: 24, list: [{ poe: '802.3at', speed: 1000 }] },
  });
  assert.ok(!caps || !caps.poe, 'niente budget → niente PoE inventato');
});

test('PoE: sovra-sottoscritto → headroom negativo (informativo)', () => {
  const caps = computeDeviceCapabilities({
    type: 'switch', spec: { swPoeBudgetW: 60 },
    ports: { list: [{ poe: '802.3bt' }, { poe: '802.3bt' }] },   // 120W teorici > 60
  });
  assert.equal(caps.poe.headroomW, -60);
});

test('UPS: VA/W/autonomia documentati', () => {
  const caps = computeDeviceCapabilities({ type: 'ups', spec: { upsVa: 3000, upsW: 2700, upsAutonomyMin: 12, upsTopology: 'online' } });
  assert.deepEqual(caps.power, { va: 3000, w: 2700, autonomyMin: 12, topology: 'online' });
});

test('server: CPU/RAM/storage + VM ospitate', () => {
  const caps = computeDeviceCapabilities({ type: 'server', spec: { srvCpu: 'Xeon Gold 6338', srvRamGb: 512, srvStorageTb: 8 }, vmsCount: 8 });
  assert.equal(caps.compute.cpu, 'Xeon Gold 6338');
  assert.equal(caps.compute.ramGb, 512);
  assert.equal(caps.compute.storageTb, 8);
  assert.equal(caps.compute.vms, 8);
});

test('hypervisor: socket/core/RAM + platform', () => {
  const caps = computeDeviceCapabilities({ type: 'hypervisor', spec: { hvPlatform: 'VMware ESXi', hvCpuSockets: 2, hvCores: 32, hvRamGb: 768 }, vmsCount: 20 });
  assert.equal(caps.compute.platform, 'VMware ESXi');
  assert.equal(caps.compute.cpuSockets, 2);
  assert.equal(caps.compute.cores, 32);
  assert.equal(caps.compute.vms, 20);
});

test('nas/firewall/wlanctrl/nvr: capacità per tipo', () => {
  assert.equal(computeDeviceCapabilities({ type: 'nas', spec: { nasCapacityTb: 96, nasRaid: 'RAID6' } }).storage.capacityTb, 96);
  assert.equal(computeDeviceCapabilities({ type: 'firewall', spec: { fwThroughputMbps: 10000 } }).throughputMbps, 10000);
  assert.equal(computeDeviceCapabilities({ type: 'wlanctrl', spec: { apManaged: 40, apCapacity: 100 } }).wlc.apCapacity, 100);
  assert.equal(computeDeviceCapabilities({ type: 'nvr', spec: { nvrChannels: 32, nvrChannelsUsed: 18, nvrStorageTb: 40 } }).nvr.channels, 32);
});

test('wireless (AP): conteggi radio/bande/SSID dal modello radios[]', () => {
  const caps = computeDeviceCapabilities({ type: 'ap', radios: [
    { band: '2.4', ssids: [{ ssid: 'ACME', vlan: 20 }, { ssid: 'Guest', vlan: 40 }] },
    { band: '5', ssids: [{ ssid: 'ACME', vlan: 20 }] },        // dedup ssid+vlan
    { band: '6', ssids: [{ ssid: 'ACME', vlan: 20 }] },
  ] });
  assert.equal(caps.wireless.radios, 3);
  assert.deepEqual(caps.wireless.bands, ['2.4', '5', '6']);
  assert.equal(caps.wireless.ssids, 2, 'ACME|20 + Guest|40 = 2 distinti');
});

test('porte: porte libere + mix velocità + banda LAG aggregata', () => {
  const caps = computeDeviceCapabilities({
    type: 'switch', spec: {},
    ports: { total: 48, used: 4, free: 44, list: [
      { speed: 10000, lagGroup: 'g1' }, { speed: 10000, lagGroup: 'g1' },   // Po1 = 20G
      { speed: 1000 }, { speed: 1000 }, { speed: 1000 },
    ] },
    lagNames: { g1: 'Port-channel1' },
  });
  assert.equal(caps.ports.free, 44);
  assert.deepEqual(caps.ports.speeds, { '10G': 2, '1G': 3 });
  assert.equal(caps.ports.lagAggregateMbps, 20000);
  assert.equal(caps.ports.lags.length, 1);
  assert.equal(caps.ports.lags[0].name, 'Port-channel1');
  assert.equal(caps.ports.lags[0].members, 2);
  assert.equal(caps.ports.lags[0].aggregateMbps, 20000);
  assert.ok(!('mode' in caps.ports.lags[0]), 'senza lagModes → nessuna modalità');
});

test('porte: modalità LACP nel blocco LAG quando documentata (lagModes)', () => {
  const caps = computeDeviceCapabilities({
    type: 'switch', spec: {},
    ports: { total: 8, used: 2, free: 6, list: [
      { speed: 10000, lagGroup: 'g1' }, { speed: 10000, lagGroup: 'g1' },
    ] },
    lagNames: { g1: 'Po1' },
    lagModes: { g1: 'active', gX: 'bogus' },
  });
  assert.equal(caps.ports.lags[0].mode, 'active');
});

test('device senza dati-capacità → undefined (niente blocco)', () => {
  assert.equal(computeDeviceCapabilities({ type: 'pc', spec: {} }), undefined);
  assert.equal(computeDeviceCapabilities({ type: 'switch' }), undefined);
  assert.equal(computeDeviceCapabilities(null), undefined);
});

test('allowlist: chiavi spec ignote/segrete non finiscono nelle capacità', () => {
  const caps = computeDeviceCapabilities({ type: 'switch', spec: { swPoeBudgetW: 200, community: 'LEAK', apiKey: 'LEAK2', randomField: 'x' }, ports: { list: [] } });
  const json = JSON.stringify(caps);
  assert.ok(!json.includes('LEAK'), 'nessuna chiave segreta nelle capacità');
  assert.equal(caps.poe.budgetW, 200);
});

test('flotta: somma porte libere + headroom PoE + LAG più capiente (MAX, non somma) + AP/SSID', () => {
  const a = computeDeviceCapabilities({ type: 'switch', spec: { swPoeBudgetW: 370 }, ports: { free: 36, list: [{ poe: '802.3at' }, { speed: 10000, lagGroup: 'g1' }, { speed: 10000, lagGroup: 'g1' }] }, lagNames: { g1: 'Po1' } });
  const b = computeDeviceCapabilities({ type: 'ap', radios: [{ band: '5', ssids: [{ ssid: 'X', vlan: 10 }] }] });
  const fleet = computeFleetCapabilities([a, b, undefined]);
  assert.equal(fleet.freePorts, 36);
  assert.equal(fleet.maxLagAggregateMbps, 20000);
  assert.equal(fleet.aps, 1);
  assert.equal(fleet.ssids, 1);
  assert.equal(fleet.poeHeadroomW, 370 - 30);   // 1 porta at = 30W
});

test('flotta: la banda LAG NON si somma sui due capi (schema ④: MAX, non ×2)', () => {
  // Lo STESSO Port-channel fra due switch appare su entrambi i capi a 20G.
  const end1 = computeDeviceCapabilities({ type: 'switch', spec: {}, ports: { list: [{ speed: 10000, lagGroup: 'p1' }, { speed: 10000, lagGroup: 'p1' }] }, lagNames: { p1: 'Po1' } });
  const end2 = computeDeviceCapabilities({ type: 'switch', spec: {}, ports: { list: [{ speed: 10000, lagGroup: 'p1' }, { speed: 10000, lagGroup: 'p1' }] }, lagNames: { p1: 'Po1' } });
  const fleet = computeFleetCapabilities([end1, end2]);
  assert.equal(fleet.maxLagAggregateMbps, 20000, 'MAX dei due capi = 20G, non 40G');
  assert.ok(!('uplinkAggregateMbps' in fleet), 'niente più totale-flotta che raddoppia i LAG');
});

test('flotta vuota → undefined', () => {
  assert.equal(computeFleetCapabilities([]), undefined);
  assert.equal(computeFleetCapabilities([undefined, {}]), undefined);
});
