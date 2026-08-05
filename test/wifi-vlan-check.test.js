'use strict';
const test = require('node:test');
const assert = require('node:assert');
const W = require('../lib/wifi-vlan-check.js');

test('wifiVlanIssues: SSID-VLAN non permessa sul trunk dell’uplink', () => {
  const out = W.wifiVlanIssues({
    aps: [{ id:'ap', name:'AP', ssids:[{ssid:'A',vlan:30},{ssid:'B',vlan:40}], uplinkAllowed:[10,30] }],
    clients: [],
  });
  assert.equal(out.length, 1, 'solo la VLAN 40 (non permessa) è un problema');
  assert.equal(out[0].kind, 'ssid-not-in-trunk');
  assert.equal(out[0].vlan, 40);
  assert.equal(out[0].ssid, 'B');
});

test('wifiVlanIssues: uplinkAllowed null = non controllato (trunk non dichiarato da SNMP)', () => {
  const out = W.wifiVlanIssues({
    aps: [{ id:'ap', name:'AP', ssids:[{ssid:'A',vlan:30}], uplinkAllowed:null }],
    clients: [],
  });
  assert.deepEqual(out, []);
});

test('wifiVlanIssues: client con VLAN non distribuita dall’AP', () => {
  const out = W.wifiVlanIssues({
    aps: [],
    clients: [{ id:'cl-radio', name:'CL', ap:'AP', clientVlan:99, poolVlans:[30,40] }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'client-vlan-not-distributed');
  assert.equal(out[0].vlan, 99);
});

test('wifiVlanIssues: IP del client in una subnet-VLAN diversa dalla VLAN dell’SSID = incoerenza', () => {
  const out = W.wifiVlanIssues({
    aps: [],
    // SENSORE su SSID VLAN 50 ma IP nella subnet dichiarata come VLAN 70 → mismatch.
    // Un client wireless prende la VLAN dall'SSID: l'IP di un'altra VLAN è incoerente.
    clients: [{ id:'s1', name:'SENSORE-01', ap:'AP-PROD-2', connVlan:50, ipVlan:70 }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'client-ip-vlan-mismatch');
  assert.equal(out[0].vlan, 50, 'vlan = quella dell’SSID (connessione reale)');
  assert.equal(out[0].ipVlan, 70, 'ipVlan = quella implicata dall’IP');
  assert.equal(out[0].client, 'SENSORE-01');
});

test('wifiVlanIssues: client coerente (VLAN dell’SSID = VLAN dell’IP) → nessun problema', () => {
  const out = W.wifiVlanIssues({
    aps: [],
    clients: [{ id:'s2', name:'OK', ap:'AP', connVlan:20, ipVlan:20 }],
  });
  assert.deepEqual(out, []);
});

test('wifiVlanIssues: lo STESSO SSID su più radio = UN problema, non uno per radio (schema ④)', () => {
  // apSsidList elenca lo stesso SSID una volta per radio (2.4/5/6 GHz): senza
  // dedup «8 problemi» diventavano 16/24. Qui 3 radio × lo stesso SSID/VLAN.
  const out = W.wifiVlanIssues({
    aps: [{ id:'ap', name:'AP-Corp', uplinkAllowed:[10],
      ssids:[{ssid:'Corp',vlan:20},{ssid:'Corp',vlan:20},{ssid:'Corp',vlan:20}] }],
    clients: [],
  });
  assert.equal(out.length, 1, 'un solo problema per (AP, SSID, VLAN), non 3');
  assert.equal(out[0].vlan, 20);
});

test('wifiVlanIssues: tutto coerente → nessun problema', () => {
  const out = W.wifiVlanIssues({
    aps: [{ id:'ap', name:'AP', ssids:[{ssid:'A',vlan:30}], uplinkAllowed:[10,30] }],
    clients: [{ id:'cl', name:'CL', ap:'AP', clientVlan:30, poolVlans:[30] }],
  });
  assert.deepEqual(out, []);
});
