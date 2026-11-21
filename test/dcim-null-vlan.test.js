'use strict';
// ============================================================
// IMPORT NETBOX — una VLAN assente NON e' la VLAN 0.
// NetBox manda `null` dove non c'e' niente (`vlan: null` su una WLAN, `untagged_vlan: null` su una vNIC), e in JS
// `Number.isFinite(+null)` e' VERO perche' `+null === 0`: l'import scriveva la VLAN 0, inventata, su ogni SSID e su ogni
// scheda di rete virtuale senza VLAN. La trappola era gia' stata pagata per i prefissi (`vidRaw`); le SSID e le vNIC no.
// L'ha trovata un NetBox vero (le simulazioni di allora passavano `undefined`, non `null`, e non la vedevano).
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const dcim = require('../lib/dcim-map.js');

const IF = (id, device, extra) => Object.assign({ id, device: { id: device }, name: 'wlan0', type: { value: 'ieee802.11ax' },
  rf_role: { value: 'ap' }, rf_channel: { value: '5g-36-5180-20' }, wireless_lans: [] }, extra || {});
const DEV = (id, name) => ({ id, name, role: { id: 40 }, site: { id: 1, name: 'S' } });
const wlan = (extra) => Object.assign({ id: 701, ssid: 'Corp', status: { value: 'active' }, auth_type: { value: 'open' } }, extra || {});
const ssidOf = (wl) => {
  const r = dcim.netboxToState({ deviceRoles: [{ id: 40, slug: 'access-point', name: 'AP' }], devices: [DEV(310, 'AP-1')], interfaces: [IF(900, 310, { wireless_lans: [{ id: 701 }] })], wirelessLans: [wl] });
  return r.state.nodes.find((n) => n.id === 'nb-dev-310').radios[0].ssids[0];
};

test('SSID: una WLAN senza VLAN (null come lo manda NetBox, o assente) non ha VLAN, mai la 0', () => {
  for (const vlan of [null, undefined]) assert.equal('vlan' in ssidOf(wlan({ vlan })), false, 'vlan = ' + String(vlan));
  assert.equal('vlan' in ssidOf(wlan({ vlan: { vid: null } })), false, 'un oggetto VLAN senza vid');
});

test('SSID: una VLAN vera entra col suo numero', () => {
  assert.equal(ssidOf(wlan({ vlan: { vid: 20, name: 'Uffici' } })).vlan, 20);
  assert.equal(ssidOf(wlan({ vlan: { vid: '30' } })).vlan, 30, 'un numero come testo');
});

const nicsOf = (itf) => {
  const host = { id: 1, name: 'HV-1', role: { id: 40 }, site: { id: 1, name: 'S' } };
  const r = dcim.netboxToState({
    deviceRoles: [{ id: 40, slug: 'server', name: 'Server' }], devices: [host], racks: [], interfaces: [],
    virtualMachines: [{ id: 10, name: 'vm10', device: { id: 1 }, status: { value: 'active' } }],
    vmInterfaces: [Object.assign({ id: 100, virtual_machine: { id: 10 }, name: 'eth0', enabled: true }, itf)], vmIpAddresses: [],
  });
  return r.state.nodes.find((n) => n.id === 'nb-dev-1').vms[0].nics;
};

test('vNIC: una scheda virtuale senza VLAN untagged non ha VLAN, mai la "0"', () => {
  for (const untagged_vlan of [null, undefined]) assert.equal('vlan' in nicsOf({ untagged_vlan })[0], false, 'untagged_vlan = ' + String(untagged_vlan));
  assert.equal('vlan' in nicsOf({ untagged_vlan: { vid: null } })[0], false);
});

test('vNIC: una VLAN untagged vera entra, come testo (la lista tollerante «20,30» di `nics[].vlan`)', () => {
  assert.equal(nicsOf({ untagged_vlan: { vid: 20 } })[0].vlan, '20');
  assert.equal(nicsOf({ untagged_vlan: { vid: 1 } })[0].vlan, '1', 'la VLAN 1 e\' una VLAN vera');
});
