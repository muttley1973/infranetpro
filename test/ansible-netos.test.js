'use strict';
// Test della mappa PURA vendor→ansible_network_os (lib/ansible-netos.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { vendorToNetworkOs } = require('../lib/ansible-netos.js');

test('vendor noti → network_os corretto (da brand o sysDescr)', () => {
  assert.equal(vendorToNetworkOs({ brand: 'Cisco', model: 'Catalyst 9300' }), 'cisco.ios.ios');
  assert.equal(vendorToNetworkOs({ sysDescr: 'Cisco IOS Software, C2960X' }), 'cisco.ios.ios');
  assert.equal(vendorToNetworkOs({ brand: 'Cisco', model: 'Nexus 9000' }), 'cisco.nxos.nxos');
  assert.equal(vendorToNetworkOs({ sysDescr: 'Cisco NX-OS n9k' }), 'cisco.nxos.nxos');
  assert.equal(vendorToNetworkOs({ brand: 'Cisco', model: 'ASA 5506' }), 'cisco.asa.asa');
  assert.equal(vendorToNetworkOs({ brand: 'Arista Networks', sysDescr: 'Arista EOS' }), 'arista.eos.eos');
  assert.equal(vendorToNetworkOs({ brand: 'Juniper', model: 'SRX300' }), 'junipernetworks.junos.junos');
  assert.equal(vendorToNetworkOs({ sysDescr: 'Juniper JUNOS 21.4' }), 'junipernetworks.junos.junos');
  assert.equal(vendorToNetworkOs({ brand: 'VyOS' }), 'vyos.vyos.vyos');
  assert.equal(vendorToNetworkOs({ brand: 'MikroTik', model: 'RouterOS 7' }), 'community.routeros.routeros');
  assert.equal(vendorToNetworkOs({ brand: 'Fortinet', model: 'FortiGate 60F' }), 'fortinet.fortios.fortios');
});

test('no-invenzioni: vendor ignoto/ambiguo → null', () => {
  assert.equal(vendorToNetworkOs({ brand: 'Netgear' }), null);
  assert.equal(vendorToNetworkOs({ brand: 'Zyxel', model: 'GS1900' }), null);
  assert.equal(vendorToNetworkOs({ brand: 'Synology' }), null);
  assert.equal(vendorToNetworkOs({}), null);
  assert.equal(vendorToNetworkOs(null), null);
  assert.equal(vendorToNetworkOs({ brand: '', model: '', sysDescr: '' }), null);
});

test('Cisco Meraki (cloud-managed) → null, non cisco.ios (niente backup network_cli)', () => {
  assert.equal(vendorToNetworkOs({ brand: 'Cisco Meraki', model: 'MS220' }), null);
});

test('nessun falso positivo da "iOS" di Apple (serve un segnale Cisco esplicito)', () => {
  assert.equal(vendorToNetworkOs({ brand: 'Apple', model: 'iPhone', sysDescr: 'iOS 17' }), null);
});
