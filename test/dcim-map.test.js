// Test della mappatura PURA import DCIM (lib/dcim-map.js): NetBox → stato InfraNet.
// Copre: nodi/porte/link/rack/ipam, ordine slot deterministico, ruolo→tipo,
// riconciliazione catalogo, selezione (exclude), toggle entità, cavi legacy,
// nessun segreto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const map = require('../lib/dcim-map');

function fixture() {
  return {
    manufacturers: [{ id: 1, name: 'Cisco', slug: 'cisco' }, { id: 2, name: 'Aruba', slug: 'aruba' }],
    deviceTypes: [
      { id: 10, manufacturer: { id: 1 }, model: 'C9200-24T', slug: 'cisco-c9200-24t', u_height: 1 },
      { id: 11, manufacturer: { id: 2 }, model: '6300M', slug: 'aruba-6300m', u_height: 1 },
    ],
    deviceRoles: [{ id: 20, name: 'Access Switch', slug: 'access-switch' }, { id: 21, name: 'Mystery', slug: 'mystery-role' }],
    racks: [{ id: 30, name: 'Rack A', u_height: 42 }],
    devices: [
      { id: 100, name: 'SW-CORE-01', device_type: { id: 10 }, role: { id: 20 }, rack: { id: 30 }, position: 40, serial: 'ABC123', primary_ip4: { address: '10.0.0.2/24' } },
      { id: 101, name: 'SW-ACC-03', device_type: { id: 11 }, role: { id: 21 }, rack: { id: 30 }, position: 38, primary_ip4: { address: '10.0.0.3/24' } },
    ],
    interfaces: [
      { id: 1000, device: { id: 100 }, name: 'GigabitEthernet1/0/1', mac_address: '00:11:22:33:44:01', mode: { value: 'access' }, untagged_vlan: { vid: 10 } },
      { id: 1001, device: { id: 100 }, name: 'GigabitEthernet1/0/2', mode: { value: 'tagged' }, tagged_vlans: [{ vid: 10 }, { vid: 20 }] },
      { id: 1002, device: { id: 100 }, name: 'mgmt0', mgmt_only: true },
      { id: 1100, device: { id: 101 }, name: 'GigabitEthernet1/0/1' },
    ],
    cables: [
      { id: 500, a_terminations: [{ object_type: 'dcim.interface', object_id: 1001 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 1100 }], type: { value: 'cat6' }, length: 3, length_unit: { value: 'm' }, color: 'ff0000' },
    ],
    vlans: [{ id: 60, vid: 10, name: 'Mgmt' }, { id: 61, vid: 20, name: 'Voice' }],
    prefixes: [{ id: 70, prefix: '10.0.0.0/24', vlan: { vid: 10 } }],
    ipAddresses: [{ id: 80, address: '10.0.0.2/24' }],
  };
}

test('mappa device → nodi con brand/model/serial/rack/ip', () => {
  const { state, report } = map.netboxToState(fixture());
  assert.equal(state.nodes.length, 2);
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.type, 'switch');
  assert.equal(core.brand, 'Cisco');
  assert.equal(core.model, 'C9200-24T');
  assert.equal(core.serialNumber, 'ABC123');
  assert.equal(core.rackId, 'nb-rack-30');
  assert.equal(core.rackU, 40);
  assert.equal(core.sizeU, 1);
  assert.equal(core.ip, '10.0.0.2');
  assert.equal(core.ports, 3);
  assert.equal(report.counts.devices, 2);
});

test('rack importato con altezza dichiarata (no invenzione 42U se assente)', () => {
  const { state } = map.netboxToState(fixture());
  assert.deepEqual(state.racks, [{ id: 'nb-rack-30', name: 'Rack A', sizeU: 42 }]);
  const noU = map.netboxToState({ racks: [{ id: 1, name: 'R' }] });
  assert.equal('sizeU' in noU.state.racks[0], false);
});

test('slot porte deterministici: dati prima, mgmt in coda, ordine naturale', () => {
  const { state } = map.netboxToState(fixture());
  assert.equal(state.ports['nb-dev-100-1'].ifName, 'GigabitEthernet1/0/1');
  assert.equal(state.ports['nb-dev-100-1'].vlanOvr, 10);
  assert.equal(state.ports['nb-dev-100-2'].mode, 'trunk');
  assert.deepEqual(state.ports['nb-dev-100-2'].trunkVlans, [10, 20]);
  assert.equal(state.ports['nb-dev-100-3'].ifName, 'mgmt0');   // mgmt_only → ultimo
  assert.equal(state.ports['nb-dev-100-1'].mac, '00:11:22:33:44:01');
});

test('ruolo sconosciuto → customrack + report.unmappedRoles', () => {
  const { state, report } = map.netboxToState(fixture());
  const acc = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(acc.type, 'customrack');
  assert.ok(report.unmappedRoles.includes('Mystery'));
});

test('cavo → link con endpoint risolti su slot, categoria, lunghezza, colore', () => {
  const { state, report } = map.netboxToState(fixture());
  assert.equal(state.links.length, 1);
  const l = state.links[0];
  assert.equal(l.id, 'nb-cbl-500');
  assert.equal(l.src, 'nb-dev-100-2');   // iface 1001 = slot 2
  assert.equal(l.dst, 'nb-dev-101-1');   // iface 1100 = slot 1
  assert.equal(l.cableCategory, 'cat6');
  assert.equal(l.lengthM, 3);
  assert.equal(l.color, '#ff0000');
  assert.equal(report.counts.cables, 1);
});

test('cavo con modello di terminazione LEGACY (termination_a_id)', () => {
  const nb = fixture();
  nb.cables = [{ id: 501, termination_a_type: 'dcim.interface', termination_a_id: 1000, termination_b_type: 'dcim.interface', termination_b_id: 1100 }];
  const { state } = map.netboxToState(nb);
  assert.equal(state.links.length, 1);
  assert.equal(state.links[0].src, 'nb-dev-100-1');
  assert.equal(state.links[0].dst, 'nb-dev-101-1');
});

test('VLAN + prefisso → ipam + vlanNames', () => {
  const { state } = map.netboxToState(fixture());
  assert.deepEqual(state.ipam.vlans[10], { subnet: '10.0.0.0/24' });
  assert.equal(state.vlanNames[10], 'Mgmt');
  assert.equal(state.vlanNames[20], 'Voice');
});

test('riconciliazione catalogo: template capiente → ports+frontPanel del modello', () => {
  const catalogByKey = { 'cisco c9200-24t': { ports: 24, frontPanel: { baseLayout: 'x' }, rackU: 1 } };
  const { state, report } = map.netboxToState(fixture(), { catalogByKey });
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.ports, 24);
  assert.deepEqual(core.frontPanel, { baseLayout: 'x' });
  // il modello non nel catalogo (6300M) finisce fra gli unmatched
  assert.ok(report.unmatchedDeviceTypes.some(s => /6300M/.test(s)));
});

test('selezione: exclude device rimuove il nodo e i suoi cavi', () => {
  const { state, report } = map.netboxToState(fixture(), { selection: { exclude: ['device:101'] } });
  assert.equal(state.nodes.length, 1);
  assert.equal(state.links.length, 0);   // il cavo puntava a un device escluso
  assert.ok(report.warnings.some(w => /500/.test(w)));
});

test('toggle entità: senza array cavi/vlan → niente link/ipam', () => {
  const nb = fixture();
  delete nb.cables; delete nb.vlans; delete nb.prefixes;
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.links.length, 0);
  assert.deepEqual(state.ipam.vlans, {});
  assert.deepEqual(state.vlanNames, {});
  assert.equal(report.counts.cables, 0);
  assert.equal(report.counts.vlans, 0);
});

test('nessun segreto nello stato importato', () => {
  const { state } = map.netboxToState(fixture());
  const s = JSON.stringify(state);
  assert.ok(!/community/i.test(s));
  assert.ok(!/integration/i.test(s));
});

test('ruoli NetBox reali → tipo InfraNet (hypervisor/printer/tor/app-server)', () => {
  const nb = {
    manufacturers: [{ id: 9, name: 'X' }],
    deviceTypes: [{ id: 1, manufacturer: { id: 9 }, model: 'M' }],
    deviceRoles: [
      { id: 1, slug: 'hypervisor', name: 'Hypervisor' },
      { id: 2, slug: 'printer', name: 'Printer' },
      { id: 3, slug: 'tor-switch', name: 'ToR Switch' },
      { id: 4, slug: 'application-server', name: 'Application Server' },
      { id: 5, slug: 'labelprinter', name: 'Labelprinter' },
    ],
    devices: [
      { id: 10, name: 'H', device_type: { id: 1 }, role: { id: 1 } },
      { id: 11, name: 'P', device_type: { id: 1 }, role: { id: 2 } },
      { id: 12, name: 'T', device_type: { id: 1 }, role: { id: 3 } },
      { id: 13, name: 'A', device_type: { id: 1 }, role: { id: 4 } },
      { id: 14, name: 'L', device_type: { id: 1 }, role: { id: 5 } },
    ],
  };
  const { state, report } = map.netboxToState(nb);
  const ty = id => state.nodes.find(n => n.id === 'nb-dev-' + id).type;
  assert.equal(ty(10), 'hypervisor');
  assert.equal(ty(11), 'printer');
  assert.equal(ty(12), 'switch');
  assert.equal(ty(13), 'server');
  assert.equal(ty(14), 'printer');
  assert.equal(report.unmappedRoles.length, 0);   // tutti mappati → nessun avviso
});

test('ubicazione (Location NetBox) preservata nelle note del device', () => {
  const nb = {
    manufacturers: [{ id: 9, name: 'X' }],
    deviceTypes: [{ id: 1, manufacturer: { id: 9 }, model: 'M' }],
    deviceRoles: [{ id: 1, slug: 'switch', name: 'Switch' }],
    devices: [
      { id: 10, name: 'sw', device_type: { id: 1 }, role: { id: 1 }, site: { name: 'HQ' }, location: { id: 5, name: 'Piano 2' } },
      { id: 11, name: 'sw2', device_type: { id: 1 }, role: { id: 1 }, location: { id: 6, name: 'Comms closet' } },  // senza site
      { id: 12, name: 'sw3', device_type: { id: 1 }, role: { id: 1 }, site: { name: 'HQ' } },                        // senza location
    ],
  };
  const { state } = map.netboxToState(nb);
  const byId = id => state.nodes.find(n => n.id === 'nb-dev-' + id);
  assert.equal(byId(10).notes, 'HQ · Piano 2');
  assert.equal(byId(11).notes, 'Comms closet');
  assert.equal('notes' in byId(12), false);   // niente location → niente nota (no invenzioni)
});

test('rack: nomi NetBox intatti (niente prefisso sito → sta nel nome progetto)', () => {
  const nb = {
    racks: [
      { id: 1, name: 'Comms closet', site: { name: 'Akron' }, u_height: 42 },
      { id: 2, name: 'R103', site: { name: 'Akron' }, u_height: 48 },
    ],
  };
  const { state } = map.netboxToState(nb);
  const names = state.racks.map(r => r.name);
  assert.ok(names.includes('Comms closet'));   // nome NetBox intatto
  assert.ok(names.includes('R103'));
});

test('nome di ripiego: device senza name → "Modello #id"', () => {
  const nb = {
    manufacturers: [{ id: 9, name: 'Juniper' }],
    deviceTypes: [{ id: 1, manufacturer: { id: 9 }, model: 'QFX5100-48T-6Q' }],
    deviceRoles: [{ id: 1, slug: 'tor-switch', name: 'ToR Switch' }],
    devices: [
      { id: 98, name: '', device_type: { id: 1 }, role: { id: 1 } },                        // nessun nome → modello
      { id: 99, name: '', display: '{99}', device_type: { id: 1 }, role: { id: 1 } },        // display inutile (id) → modello
      { id: 100, name: '', display: 'core-fabric-99', device_type: { id: 1 }, role: { id: 1 } }, // display utile → usato
    ],
  };
  const { state } = map.netboxToState(nb);
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-98').name, 'QFX5100-48T-6Q #98');
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-99').name, 'QFX5100-48T-6Q #99');
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-100').name, 'core-fabric-99');
});
