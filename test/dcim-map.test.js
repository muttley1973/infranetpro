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

// ── Cablaggio via patch panel (front/rear port → slot passanti) ──────────────
// Percorso strutturato: SW:Gi0/1 —cavo— PP-A:F1 ═interno═ PP-A:R1 —cavo—
// PP-B:R1 ═interno═ PP-B:F1 —cavo— SRV:eth0. In NetBox = 3 cavi (interface↔
// frontport, rearport↔rearport, frontport↔interface). In InfraNet = 3 link che
// condividono lo slot passante del pannello (fronte+retro = una sola porta).
function ppFixture() {
  return {
    manufacturers: [{ id: 1, name: 'Cisco' }, { id: 2, name: 'CommScope' }],
    deviceTypes: [
      { id: 10, manufacturer: { id: 1 }, model: 'C9200', u_height: 1 },
      { id: 12, manufacturer: { id: 2 }, model: 'PP-24', u_height: 1 },
    ],
    deviceRoles: [
      { id: 20, slug: 'access-switch', name: 'Access Switch' },
      { id: 22, slug: 'patch-panel', name: 'Patch Panel' },
      { id: 23, slug: 'server', name: 'Server' },
    ],
    devices: [
      { id: 100, name: 'SW', device_type: { id: 10 }, role: { id: 20 } },
      { id: 200, name: 'PP-A', device_type: { id: 12 }, role: { id: 22 } },
      { id: 201, name: 'PP-B', device_type: { id: 12 }, role: { id: 22 } },
      { id: 300, name: 'SRV', device_type: { id: 10 }, role: { id: 23 } },
    ],
    interfaces: [
      { id: 1000, device: { id: 100 }, name: 'GigabitEthernet0/1' },
      { id: 1300, device: { id: 300 }, name: 'eth0' },
    ],
    frontPorts: [
      // fuori ordine di proposito → devono ordinarsi 1,2 (ordine naturale)
      { id: 2001, device: { id: 200 }, name: '2', rear_port: { id: 3001 } },
      { id: 2000, device: { id: 200 }, name: '1', rear_port: { id: 3000 } },
      { id: 2100, device: { id: 201 }, name: '1', rear_port: { id: 3100 } },
      { id: 2101, device: { id: 201 }, name: '2', rear_port: { id: 3101 } },
    ],
    cables: [
      { id: 500, a_terminations: [{ object_type: 'dcim.interface', object_id: 1000 }], b_terminations: [{ object_type: 'dcim.frontport', object_id: 2000 }] },
      { id: 501, a_terminations: [{ object_type: 'dcim.rearport', object_id: 3000 }], b_terminations: [{ object_type: 'dcim.rearport', object_id: 3100 }], type: { value: 'cat6a' } },
      { id: 502, a_terminations: [{ object_type: 'dcim.frontport', object_id: 2100 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 1300 }] },
    ],
  };
}

test('front port di un patch panel → slot passanti (ordine naturale, conteggio)', () => {
  const { state } = map.netboxToState(ppFixture());
  const pa = state.nodes.find(n => n.id === 'nb-dev-200');
  assert.equal(pa.type, 'patchpanel');
  assert.equal(pa.ports, 2);                     // 2 front port → 2 slot
  // front port "1" → slot 1, "2" → slot 2 (naturale, non ordine di array)
  // (nessuna ifName perché il nome coincide col numero di slot)
  assert.equal('nb-dev-200-1' in state.ports, false);
  assert.equal('nb-dev-200-2' in state.ports, false);
});

test('cavo interface↔front-port → link su slot del pannello', () => {
  const { state } = map.netboxToState(ppFixture());
  const l = state.links.find(x => x.id === 'nb-cbl-500');
  assert.ok(l);
  assert.deepEqual([l.src, l.dst].sort(), ['nb-dev-100-1', 'nb-dev-200-1'].sort());
});

test('cavo rear-port↔rear-port → backbone risolto via FK del front (stesso slot)', () => {
  const { state } = map.netboxToState(ppFixture());
  const l = state.links.find(x => x.id === 'nb-cbl-501');
  assert.ok(l);
  // rear 3000 → slot 1 di PP-A ; rear 3100 → slot 1 di PP-B
  assert.deepEqual([l.src, l.dst].sort(), ['nb-dev-200-1', 'nb-dev-201-1'].sort());
  assert.equal(l.cableCategory, 'cat6a');
});

test('catena patch panel: lo slot passante è CONDIVISO fra i tratti (nessun segments[])', () => {
  const { state } = map.netboxToState(ppFixture());
  assert.equal(state.links.length, 3);
  const touch = pid => state.links.filter(l => l.src === pid || l.dst === pid).length;
  // PP-A slot 1: fronte (verso SW) + retro (verso PP-B) = 2 link
  assert.equal(touch('nb-dev-200-1'), 2);
  // PP-B slot 1: retro (da PP-A) + fronte (verso SRV) = 2 link
  assert.equal(touch('nb-dev-201-1'), 2);
  // estremi attivi = 1 link ciascuno
  assert.equal(touch('nb-dev-100-1'), 1);
  assert.equal(touch('nb-dev-300-1'), 1);
  // nessun link usa segments[] (modello nativo a catena)
  assert.ok(state.links.every(l => !('segments' in l)));
});

test('risoluzione type-aware: interface #N e front-port #N non collidono', () => {
  const nb = {
    manufacturers: [{ id: 1, name: 'Cisco' }],
    deviceTypes: [{ id: 10, manufacturer: { id: 1 }, model: 'C9200' }],
    deviceRoles: [{ id: 20, slug: 'access-switch', name: 'Switch' }, { id: 22, slug: 'patch-panel', name: 'PP' }],
    devices: [
      { id: 100, name: 'SW', device_type: { id: 10 }, role: { id: 20 } },
      { id: 200, name: 'PP', device_type: { id: 10 }, role: { id: 22 } },
    ],
    interfaces: [{ id: 777, device: { id: 100 }, name: 'Gi0/1' }],           // interface #777
    frontPorts: [{ id: 777, device: { id: 200 }, name: '1', rear_port: { id: 900 } }], // front #777 (STESSO id)
    cables: [
      // cavo sulla FRONT PORT #777 → deve andare al pannello, non allo switch
      { id: 500, a_terminations: [{ object_type: 'dcim.interface', object_id: 777 }], b_terminations: [{ object_type: 'dcim.frontport', object_id: 777 }] },
    ],
  };
  const { state } = map.netboxToState(nb);
  const l = state.links.find(x => x.id === 'nb-cbl-500');
  assert.ok(l);
  // un capo sullo switch (interface 777), l'altro sul pannello (front 777) — non lo stesso device
  assert.deepEqual([l.src, l.dst].sort(), ['nb-dev-100-1', 'nb-dev-200-1'].sort());
});

test('schema NetBox 4.6+: front port con rear_ports[] (non rear_port singolo) → backbone risolto', () => {
  // In 4.6 il front port mappa i rear via array `rear_ports:[{rear_port:<id>}]`
  // (id nudo), non `rear_port:{id}`. Il backbone rear↔rear deve comunque risolvere.
  const nb = {
    deviceRoles: [{ id: 22, slug: 'patch-panel', name: 'PP' }],
    devices: [
      { id: 200, name: 'PP-A', role: { id: 22 } },
      { id: 201, name: 'PP-B', role: { id: 22 } },
    ],
    frontPorts: [
      { id: 2000, device: { id: 200 }, name: '1', rear_ports: [{ position: 1, rear_port: 3000, rear_port_position: 1 }] },
      { id: 2100, device: { id: 201 }, name: '1', rear_ports: [{ position: 1, rear_port: 3100, rear_port_position: 1 }] },
    ],
    cables: [
      { id: 600, a_terminations: [{ object_type: 'dcim.rearport', object_id: 3000 }], b_terminations: [{ object_type: 'dcim.rearport', object_id: 3100 }] },
    ],
  };
  assert.deepEqual(map._frontRearIds({ rear_ports: [{ rear_port: 3000 }, { rear_port: { id: 3001 } }] }), [3000, 3001]);
  const { state } = map.netboxToState(nb);
  const l = state.links.find(x => x.id === 'nb-cbl-600');
  assert.ok(l, 'il cavo rear↔rear deve risolversi anche con schema 4.6');
  assert.deepEqual([l.src, l.dst].sort(), ['nb-dev-200-1', 'nb-dev-201-1'].sort());
});

test('cavi fuori scope (power/console/circuito) → saltati SENZA avviso; miss di rete → avviso', () => {
  const nb = {
    deviceRoles: [{ id: 20, slug: 'access-switch', name: 'SW' }],
    devices: [{ id: 100, name: 'SW', role: { id: 20 } }],
    interfaces: [{ id: 1000, device: { id: 100 }, name: 'Gi0/1' }, { id: 1001, device: { id: 100 }, name: 'Gi0/2' }],
    cables: [
      // alimentazione: outlet↔powerport → fuori scope, niente avviso
      { id: 700, a_terminations: [{ object_type: 'dcim.poweroutlet', object_id: 9000 }], b_terminations: [{ object_type: 'dcim.powerport', object_id: 9001 }] },
      // circuito WAN: interfaccia↔circuittermination → fuori scope, niente avviso
      { id: 701, a_terminations: [{ object_type: 'dcim.interface', object_id: 1000 }], b_terminations: [{ object_type: 'circuits.circuittermination', object_id: 9100 }] },
      // miss VERO: interfaccia↔interfaccia con un capo su device non importato → avviso
      { id: 702, a_terminations: [{ object_type: 'dcim.interface', object_id: 1001 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 5555 }] },
    ],
  };
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.links.length, 0);
  // solo il 702 (net↔net non risolto) genera avviso; 700/701 silenziosi
  assert.equal(report.warnings.filter(w => /700|701/.test(w)).length, 0);
  assert.equal(report.warnings.filter(w => /702/.test(w)).length, 1);
});

test('front port con etichetta non banale → preservata in ifName', () => {
  const nb = {
    deviceRoles: [{ id: 22, slug: 'patch-panel', name: 'PP' }],
    devices: [{ id: 200, name: 'PP', role: { id: 22 } }],
    frontPorts: [{ id: 2000, device: { id: 200 }, name: 'A1', description: 'Room 204', rear_port: { id: 3000 } }],
  };
  const { state } = map.netboxToState(nb);
  assert.equal(state.ports['nb-dev-200-1'].ifName, 'A1');
  assert.equal(state.ports['nb-dev-200-1'].desc, 'Room 204');
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
