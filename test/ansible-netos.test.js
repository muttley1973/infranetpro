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

// ── La piattaforma DICHIARATA (import DCIM: NetBox `platform`) ───────────────
// È documentazione, non deduzione: batte l'ipotesi ricavata da marca e modello.
test('platform dichiarata: vince sul brand, e non si arrende se e\' muta', () => {
  // Il caso che conta: brand generico, platform precisa.
  assert.equal(vendorToNetworkOs({ brand: 'Cisco', model: 'C9500', platform: 'Cisco NX-OS' }), 'cisco.nxos.nxos');
  assert.equal(vendorToNetworkOs({ platform: 'cisco-ios' }), 'cisco.ios.ios', 'lo slug NetBox va bene quanto il nome');
  assert.equal(vendorToNetworkOs({ platform: 'juniper-junos' }), 'junipernetworks.junos.junos');
  // Platform che non dice niente → si ripiega sul brand invece di arrendersi.
  assert.equal(vendorToNetworkOs({ brand: 'Arista', platform: 'linux-generico' }), 'arista.eos.eos');
  assert.equal(vendorToNetworkOs({ platform: 'boh' }), null, 'nessun segnale da nessuna parte → null');
});

test('platform Meraki: veto esplicito, NON si ripiega sul brand Cisco', () => {
  // ⚠️ La regressione da evitare: `_match` torna null perche' Meraki e' cloud-managed,
  // e un fallback cieco sul brand "Cisco" direbbe cisco.ios.ios — l'opposto.
  assert.equal(vendorToNetworkOs({ brand: 'Cisco', model: 'MS220', platform: 'Cisco Meraki' }), null);
});
