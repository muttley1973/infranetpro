// Test della mappatura PURA import DCIM (lib/dcim-map.js): NetBox → stato InfraNet.
// Copre: nodi/porte/link/rack/ipam, ordine slot deterministico, ruolo→tipo,
// riconciliazione catalogo, selezione (exclude), toggle entità, cavi legacy,
// nessun segreto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const map = require('../lib/dcim-map');
const deviceCatalog = require('../lib/device-catalog');

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
  assert.equal(core.ports, 2);
  assert.equal(report.counts.devices, 2);
  assert.equal(report.counts.devicesRack, 2);
  assert.equal(report.counts.devicesFloor, 0);
});

test('rack importato con altezza dichiarata (no invenzione 42U se assente)', () => {
  const { state } = map.netboxToState(fixture());
  assert.deepEqual(state.racks, [{ id: 'nb-rack-30', name: 'Rack A', srcRack: 30, sizeU: 42, x: 120, y: 120 }]);
  const noU = map.netboxToState({ racks: [{ id: 1, name: 'R' }] });
  assert.equal('sizeU' in noU.state.racks[0], false);
});

test('rack importati vengono piazzati sul floor con coordinate deterministiche e non sovrapposte', () => {
  const nb = { racks: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: 'Rack ' + (i + 1) })) };
  const { state } = map.netboxToState(nb);
  assert.deepEqual(state.racks.map(r => [r.x, r.y]), [
    [120, 120], [340, 120], [560, 120], [780, 120], [1000, 120], [120, 260],
  ]);
  assert.equal(new Set(state.racks.map(r => r.x + ',' + r.y)).size, state.racks.length);
});

test('import apre la vista Rack sul primo rack (currentRack impostato)', () => {
  const { state } = map.netboxToState(fixture());
  assert.equal(state.currentRack, 'nb-rack-30');           // altrimenti rack-chassis vuoto
  const noRack = map.netboxToState({ devices: [] });
  assert.equal('currentRack' in noRack.state, false);      // niente rack → niente selezione
});

test('slot porte deterministici: dati numerici e MGMT su PID dedicato', () => {
  const { state } = map.netboxToState(fixture());
  assert.equal(state.ports['nb-dev-100-1'].ifName, 'GigabitEthernet1/0/1');
  assert.equal(state.ports['nb-dev-100-1'].vlanOvr, 10);
  assert.equal(state.ports['nb-dev-100-2'].mode, 'trunk');
  assert.deepEqual(state.ports['nb-dev-100-2'].trunkVlans, [10, 20]);
  assert.equal(state.ports['nb-dev-100-mgmt1'].ifName, 'mgmt0');
  assert.equal(state.ports['nb-dev-100-mgmt1'].mgmt, true);
  assert.equal(state.ports['nb-dev-100-1'].mac, '00:11:22:33:44:01');
});

test('PDU NetBox: interfacce Ethernet diventano MGMT e power outlet conservano lo stato', () => {
  const nb = {
    deviceTypes: [{ id: 50, manufacturer: { id: 1 }, model: 'APC PDU', slug: 'apc-pdu', u_height: 1 }],
    manufacturers: [{ id: 1, name: 'APC', slug: 'apc' }],
    deviceRoles: [{ id: 51, name: 'PDU', slug: 'pdu' }],
    racks: [{ id: 52, name: 'Rack PDU', u_height: 42 }],
    devices: [{ id: 53, name: 'PDU-01', device_type: { id: 50 }, role: { id: 51 }, rack: { id: 52 }, position: 1 }],
    interfaces: [
      { id: 540, device: { id: 53 }, name: 'eth0', enabled: true, mark_connected: true },
      { id: 541, device: { id: 53 }, name: 'eth1', enabled: false },
    ],
    consolePorts: [{ id: 550, device: { id: 53 }, name: 'console' }],
    powerPorts: [{ id: 560, device: { id: 53 }, name: 'power-in', maximum_draw: 3680, feed_leg: 'A' }],
    powerOutlets: [
      { id: 570, device: { id: 53 }, name: 'outlet-1', status: { value: 'enabled' }, mark_connected: true,
        link_peer: { id: 660, name: 'PSU-1', device: { id: 66, name: 'Server-01' } }, link_peer_type: 'powerport' },
      { id: 571, device: { id: 53 }, name: 'outlet-2', status: { value: 'faulty' } },
      { id: 572, device: { id: 53 }, name: 'outlet-3', status: { value: 'disabled' } },
    ],
  };
  const { state, report } = map.netboxToState(nb);
  const pdu = state.nodes[0];
  assert.equal(pdu.type, 'pdu');
  assert.equal(pdu.pduMgmtMode, 'ethernet-serial');
  assert.equal(pdu.pduEthernetPorts, 2);
  assert.equal(pdu.pduSerialPorts, 1);
  assert.equal(pdu.pduOutletCount, 3);
  assert.deepEqual(pdu.powerOutlets.map(outlet => outlet.status), ['active', 'fault', 'inactive']);
  assert.deepEqual(pdu.powerOutlets.map(outlet => outlet.rawStatus), ['enabled', 'faulty', 'disabled']);
  assert.equal(pdu.powerOutlets[0].connectedTo.deviceName, 'Server-01');
  assert.equal(pdu.powerOutlets[0].connectedTo.name, 'PSU-1');
  assert.equal(pdu.pduPowerPorts[0].maximumDraw, 3680);
  assert.equal(state.ports['nb-dev-53-1'].mgmt, true);
  assert.equal(state.ports['nb-dev-53-1'].status, 'active');
  assert.equal(state.ports['nb-dev-53-2'].status, 'inactive');
  assert.equal('nb-dev-53-mgmt1' in state.ports, false);
  assert.equal(report.counts.powerOutlets, 3);
  assert.equal(report.counts.powerPorts, 1);
  assert.equal(report.counts.consolePorts, 1);
});

test('ruolo sconosciuto → customrack + report.unmappedRoles', () => {
  const { state, report } = map.netboxToState(fixture());
  const acc = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(acc.type, 'customrack');
  assert.ok(report.unmappedRoles.includes('Mystery'));
});

test('mapping manuale: tipo e posizione prevalgono e risolvono la revisione', () => {
  const { state, report } = map.netboxToState(fixture(), {
    selection: {
      mapping: {
        '100': { type: 'server', placement: 'floor' },
        '101': { type: 'ap', placement: 'floor' },
      },
    },
  });
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  const acc = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(core.type, 'server');
  assert.equal(core.placement, 'floor');
  assert.equal(core.rackId, undefined);
  assert.deepEqual(core.source.manualMapping, { type: 'server', placement: 'floor' });
  assert.equal(acc.type, 'ap');
  assert.equal(acc.placement, 'floor');
  assert.equal(report.reviewRequired.length, 0);
  assert.equal(report.manualMappings.applied.length, 4);
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
  assert.equal(report.counts.directLinks, 1);
  assert.equal(report.counts.passThroughLinks, 0);
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
  const nb = fixture();
  nb.ipAddresses[0].assigned_object = { id: 1000, device: { id: 100 } };
  const { state, report } = map.netboxToState(nb);
  // La subnet NON viene più ricopiata dentro la VLAN: il prefisso è l'autorità e
  // la VLAN un riferimento. Sul record VLAN restano i suoi metadati NetBox.
  assert.equal(state.ipam.vlans[10].subnet, undefined);
  assert.equal(state.ipam.vlans[10].name, 'Mgmt');
  assert.deepEqual(state.ipam.prefixes, [{ id: 70, cidr: '10.0.0.0/24', vlan: 10, source: 'dcim' }]);
  assert.deepEqual(state.ipam.addresses, [{ id: 80, address: '10.0.0.2/24', interfaceId: 1000, portId: 'nb-dev-100-1', deviceId: '100' }]);
  assert.equal(state.vlanNames[10], 'Mgmt');
  assert.equal(state.vlanNames[20], 'Voice');
  assert.equal(report.counts.ips, 1);
});

test('riconciliazione catalogo: template capiente → ports+frontPanel del modello', () => {
  const catalogByKey = { 'cisco c9200-24t': { ports: 24, frontPanel: { baseLayout: 'x' }, rackU: 1 } };
  const { state, report } = map.netboxToState(fixture(), { catalogByKey });
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.ports, 24);
  assert.deepEqual(core.frontPanel, { baseLayout: 'x', mgmtCount: 1 });
  // il modello non nel catalogo (6300M) finisce fra gli unmatched
  assert.ok(report.unmatchedDeviceTypes.some(s => /6300M/.test(s)));
});

// ── Decisione «porte oltre il catalogo» ─────────────────────────────────────
// NetBox dichiara più interfacce fisiche di quante ne preveda il modello. Il
// CONTEGGIO non è in discussione (`_effectivePortLayout` allarga già dataPorts: in
// nessuno dei due rami si perde una porta) — si sceglie la DISPOSIZIONE del frontale.
const _tooSmall = { 'cisco c9200-24t': { ports: 1, frontPanel: { baseLayout: 'x' }, rackU: 1 } };

test('porte oltre il catalogo: senza scelta resta la disposizione del modello + avviso strutturato', () => {
  const { state, report } = map.netboxToState(fixture(), { catalogByKey: _tooSmall });
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.ports, 2, 'tutte le porte NetBox sono dichiarate: nessuna si perde');
  assert.deepEqual(core.frontPanel, { baseLayout: 'x', mgmtCount: 1 }, 'e la disposizione resta quella del catalogo');
  assert.equal(report.catalogMatches.templateTooSmall, 1);
  const issue = report.issues.find(i => i.code === 'ports.overTemplate');
  assert.deepEqual(
    { code: issue.code, deviceId: issue.deviceId, deviceName: issue.deviceName, netbox: issue.netbox, template: issue.template, applied: issue.applied },
    { code: 'ports.overTemplate', deviceId: 100, deviceName: 'SW-CORE-01', netbox: 2, template: 1, applied: 'keepCatalog' },
    'l\'avviso porta il NOME e i due numeri: il pannello non deve piu\' leggere una frase');
});

test('porte oltre il catalogo: «pannello neutro» toglie la disposizione dichiarata, non le porte', () => {
  const { state, report } = map.netboxToState(fixture(), {
    catalogByKey: _tooSmall, selection: { decisions: { 'ports.overTemplate': 'genericPanel' } },
  });
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.ports, 2, 'stesse porte del ramo di default');
  assert.equal(core.frontPanel, undefined, 'ma nessuna posizione inventata: meglio non sapere che sbagliare');
  assert.equal(report.issues.find(i => i.code === 'ports.overTemplate').applied, 'genericPanel');
  assert.ok(state.ports['nb-dev-100-2'], 'la porta c\'era in entrambi i rami');
});

test('avvisi strutturati: stesso evento, una sola emissione (issues + warnings restano allineati)', () => {
  const { report } = map.netboxToState(fixture(), { catalogByKey: _tooSmall });
  // Il ruolo "Mystery" non e' mappato: l'avviso esce con il nome del device, non con l'id.
  const role = report.issues.find(i => i.code === 'role.unmapped');
  assert.deepEqual({ deviceId: role.deviceId, deviceName: role.deviceName, role: role.role },
    { deviceId: 101, deviceName: 'SW-ACC-03', role: 'Mystery' });
  // Il modello Aruba non e' a catalogo: e' una classe, non una frase da leggere.
  assert.ok(report.issues.some(i => i.code === 'catalog.unmatched' && /6300M/.test(i.model)));
  assert.ok(!report.warnings.some(w => /6300M/.test(w)), 'e non sporca il log testuale');
});

// ── Fedeltà del mapping: quello che NetBox dichiara, e SOLO quello ──────────
// Reperti misurati su un NetBox 4.6.7 vero (72 apparati, 90 prefissi, 63 VLAN).
test('prefisso SENZA VLAN: nessuna «VLAN 0» inventata, nessuna VLAN fantasma', () => {
  const nb = fixture();
  nb.prefixes = [
    { id: 70, prefix: '10.0.0.0/24', vlan: { vid: 10 } },   // con VLAN
    { id: 71, prefix: '192.168.0.0/20' },                   // SENZA VLAN
  ];
  const { state } = map.netboxToState(nb);
  const senza = state.ipam.prefixes.find(p => p.cidr === '192.168.0.0/20');
  assert.equal(senza.vlan, null, 'senza VLAN dichiarata il prefisso non ne inventa una');
  assert.notEqual(senza.vlan, 0, '`+null === 0`: la VLAN 0 non esiste, non va documentata');
  assert.equal('null' in state.ipam.vlans, false, 'e non nasce una VLAN fantasma con chiave null');
  assert.equal(state.ipam.prefixes.find(p => p.cidr === '10.0.0.0/24').vlan, 10, 'il prefisso CON VLAN resta agganciato');
});

test('VLAN NetBox per sito/gruppo: il conteggio annunciato è quello che ATTERRA', () => {
  const nb = fixture();
  // Stesso vid dichiarato in tre siti diversi + un secondo vid: NetBox ne conta 4,
  // il documento ne contiene 2 (lo spazio vid di InfraNet e' piatto).
  nb.vlans = [
    { id: 1, vid: 100, name: 'Data', site: { id: 1 } },
    { id: 2, vid: 100, name: 'Data', site: { id: 2 } },
    { id: 3, vid: 100, name: 'Data', site: { id: 3 } },
    { id: 4, vid: 200, name: 'Voice' },
  ];
  nb.prefixes = [];
  const { state, report } = map.netboxToState(nb);
  assert.equal(report.counts.vlans, 2, 'annuncia le VLAN che si ottengono');
  assert.equal(report.counts.vlanRecords, 4, 'senza nascondere quante righe ha letto');
  assert.equal(Object.keys(state.vlanNames).length, 2);
  const issue = report.issues.find(i => i.code === 'vlan.collapsed');
  assert.deepEqual({ declared: issue.declared, kept: issue.kept, conflicts: issue.conflicts },
    { declared: 4, kept: 2, conflicts: 0 }, 'il collasso viene dichiarato, non subito');
});

test('VLAN con lo stesso vid e nomi DIVERSI: il conflitto viene contato', () => {
  const nb = fixture();
  nb.vlans = [{ id: 1, vid: 100, name: 'Data' }, { id: 2, vid: 100, name: 'Ospiti' }];
  nb.prefixes = [];
  const { report } = map.netboxToState(nb);
  assert.equal(report.issues.find(i => i.code === 'vlan.collapsed').conflicts, 1,
    'un nome che ne sovrascrive un altro in silenzio va almeno contato');
});

test('cavi fuori perimetro (alimentazione/console/WAN): dichiarati, non taciuti', () => {
  const nb = fixture();
  nb.cables = [
    { id: 600, a_terminations: [{ object_type: 'dcim.poweroutlet', object_id: 1 }], b_terminations: [{ object_type: 'dcim.powerport', object_id: 2 }] },
    { id: 601, a_terminations: [{ object_type: 'circuits.circuittermination', object_id: 3 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 1000 }] },
  ];
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.links.length, 0, 'non entrano fra i cavi del progetto');
  assert.equal(report.counts.unresolvedCables, 0, 'e non sono un guasto da risolvere');
  const oos = report.issues.filter(i => i.code === 'cable.outOfScope');
  assert.equal(oos.length, 2, 'ma vengono dichiarati');
  assert.deepEqual(oos.map(i => i.kind).sort(), ['circuit', 'power'], 'col motivo per cui restano fuori');
  assert.equal(report.warnings.some(w => /600|601/.test(w)), false, 'senza rumore nel log testuale');
});

test('catalogo: SFP nelle posizioni del frontale e MGMT separata anche con porte NetBox incomplete', () => {
  const nb = fixture();
  nb.interfaces = [
    { id: 1003, device: { id: 100 }, name: 'SFP1', type: { value: '10gbase-x-sfpp' } },
    { id: 1004, device: { id: 100 }, name: 'SFP2', type: { value: '10gbase-x-sfpp' } },
    { id: 1000, device: { id: 100 }, name: 'GigabitEthernet1/0/1', type: { value: '1000base-t' } },
    { id: 1001, device: { id: 100 }, name: 'GigabitEthernet1/0/2', type: { value: '1000base-t' } },
    { id: 1002, device: { id: 100 }, name: 'mgmt0', mgmt_only: true },
    { id: 1100, device: { id: 101 }, name: 'GigabitEthernet1/0/1', type: { value: '1000base-t' } },
  ];
  nb.ipAddresses.push({ id: 81, address: '10.0.0.10/24', assigned_object: { id: 1002, device: { id: 100 } } });
  const { state } = map.netboxToState(nb, {
    catalogByKey: {
      'cisco c9200-24t': { ports: 24, frontPanel: { separateSfp: true, sfpCount: 4, mgmtCount: 1 } },
    },
  });
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.ports, 24);
  assert.deepEqual(core.frontPanel, { separateSfp: true, sfpCount: 4, mgmtCount: 1 });
  assert.equal(state.ports['nb-dev-100-1'].ifName, 'GigabitEthernet1/0/1');
  assert.equal(state.ports['nb-dev-100-2'].ifName, 'GigabitEthernet1/0/2');
  assert.equal(state.ports['nb-dev-100-21'].ifName, 'SFP1');
  assert.equal(state.ports['nb-dev-100-22'].ifName, 'SFP2');
  assert.equal(state.ports['nb-dev-100-mgmt1'].ifName, 'mgmt0');
  assert.equal(state.ipam.addresses.find(ip => ip.id === 81).portId, 'nb-dev-100-mgmt1');
});

test('catalogo neutrale: media condivisi occupano uno slot senza creare MGMT', () => {
  const nb = fixture();
  nb.deviceTypes[0] = { id: 10, manufacturer: { id: 1 }, model: 'ISR 1111-8P', slug: 'cisco-isr-1111-8p', u_height: 1 };
  nb.deviceRoles[0] = { id: 20, name: 'Router', slug: 'router' };
  nb.interfaces = [
    ...Array.from({ length: 9 }, (_, index) => ({
      id: 1200 + index,
      device: { id: 100 },
      name: 'GigabitEthernet1/0/' + (index + 1),
      type: { value: '1000base-t' },
    })),
    { id: 1299, device: { id: 100 }, name: 'GigabitEthernet0/0/0', type: { value: '1000base-x-sfp' } },
    { id: 1100, device: { id: 101 }, name: 'GigabitEthernet1/0/1', type: { value: '1000base-t' } },
  ];
  const catalogByKey = {
    'cisco isr 1111-8p': {
      ports: 10,
      frontPanel: {
        separateSfp: false,
        sfpCount: 0,
        sharedMediaSlots: [{ start: 10, count: 1, media: ['copper', 'fiber'] }],
      },
      counts: { copper: 9, sfp: 1, qsfp: 0, mgmt: 0, combo: 1 },
    },
  };
  const { state } = map.netboxToState(nb, { catalogByKey });
  const router = state.nodes.find(node => node.id === 'nb-dev-100');
  assert.equal(router.type, 'router');
  assert.equal(router.ports, 10);
  assert.equal(router.frontPanel.separateSfp, false);
  assert.deepEqual(router.frontPanel.sharedMediaSlots, [{ slot: 10, media: ['copper', 'fiber'] }]);
  // Il media della porta si legge da mediaOptions + frontPanel: `physicalKind` non
  // si persiste piu' (era scritto su OGNI porta e non lo leggeva nessuno).
  assert.equal(state.ports['nb-dev-100-1'].physicalKind, undefined);
  assert.equal(state.ports['nb-dev-100-10'].physicalKind, undefined);
  assert.deepEqual(state.ports['nb-dev-100-10'].mediaOptions, ['copper', 'fiber']);
  assert.equal(state.ports['nb-dev-100-10'].sharedMedia, true);
  assert.equal(state.ports['nb-dev-100-mgmt1'], undefined);
});

test('riconciliazione catalogo: slug NetBox prioritario e device senza rack resta floor', () => {
  const nb = fixture();
  nb.devices[0] = Object.assign({}, nb.devices[0], { rack: null });
  const catalogIndexes = deviceCatalog.buildIndexes([{
    sourceSlug: 'cisco-c9200-24t',
    brand: 'Cisco',
    brandSlug: 'cisco',
    model: 'C9200-24T',
    ports: 24,
    frontPanel: { baseLayout: 'slug' },
  }]);
  const { state, report } = map.netboxToState(nb, { catalogIndexes, catalogVersion: 'catalog-rev-1' });
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.placement, 'floor');
  assert.equal(core.type, 'switch');
  assert.equal(core.ports, 24);
  assert.equal(core.source.deviceTypeSlug, 'cisco-c9200-24t');
  assert.equal(core.source.catalogMatch, 'source-slug');
  assert.equal(core.source.catalogVersion, 'catalog-rev-1');
  assert.equal(report.catalogMatches.byStrategy['source-slug'], 1);
  assert.deepEqual([core.x, core.y], [120, 430]);
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

// ── Split fronte/retro (a1) ─────────────────────────────────────────────────
// NetBox = UN rack con device.face front/rear; InfraNet = fronte e retro sono
// DUE rack. Un rack bifacciale va spezzato in 2 (fronte = nome, retro = "· retro").
test('rack bifacciale → 2 rack InfraNet (fronte + "· retro"), device assegnati per faccia', () => {
  const nb = {
    manufacturers: [{ id: 1, name: 'Cisco' }, { id: 2, name: 'CommScope' }],
    deviceTypes: [{ id: 10, manufacturer: { id: 1 }, model: 'C9200', u_height: 1 }, { id: 12, manufacturer: { id: 2 }, model: 'PP-24', u_height: 1 }],
    deviceRoles: [{ id: 20, slug: 'access-switch', name: 'SW' }, { id: 22, slug: 'patch-panel', name: 'PP' }],
    racks: [{ id: 30, name: 'MDF', u_height: 42 }],
    devices: [
      { id: 100, name: 'SW', device_type: { id: 10 }, role: { id: 20 }, rack: { id: 30 }, position: 40, face: { value: 'front', label: 'Front' } },
      { id: 200, name: 'PP', device_type: { id: 12 }, role: { id: 22 }, rack: { id: 30 }, position: 42, face: { value: 'rear', label: 'Rear' } },
    ],
    interfaces: [{ id: 1000, device: { id: 100 }, name: 'Gi0/1' }],
    frontPorts: [{ id: 2000, device: { id: 200 }, name: '1', rear_ports: [{ rear_port: 3000 }] }],
    cables: [{ id: 500, a_terminations: [{ object_type: 'dcim.interface', object_id: 1000 }], b_terminations: [{ object_type: 'dcim.frontport', object_id: 2000 }] }],
  };
  const { state } = map.netboxToState(nb);
  const byId = id => state.racks.find(r => r.id === id);
  assert.equal(state.racks.length, 2);
  assert.deepEqual(byId('nb-rack-30'), { id: 'nb-rack-30', name: 'MDF', srcRack: 30, sizeU: 42, x: 120, y: 120 });
  // ⚠️ I due lati di un bifacciale portano lo STESSO riferimento: di la' e' un rack solo.
  assert.deepEqual(byId('nb-rack-30-rear'), { id: 'nb-rack-30-rear', name: 'MDF · retro', srcRack: 30, sizeU: 42, x: 340, y: 120 });
  const sw = state.nodes.find(n => n.id === 'nb-dev-100');
  const pp = state.nodes.find(n => n.id === 'nb-dev-200');
  assert.equal(sw.rackId, 'nb-rack-30'); assert.equal(sw.rackU, 40);        // fronte
  assert.equal(pp.rackId, 'nb-rack-30-rear'); assert.equal(pp.rackU, 42);   // retro
  // il cavo fronte↔retro diventa un link CROSS-RACK (nodi in rack diversi)
  const l = state.links.find(x => x.id === 'nb-cbl-500');
  assert.ok(l);
  const rackOf = pid => state.nodes.find(n => pid.startsWith(n.id + '-')).rackId;
  assert.notEqual(rackOf(l.src), rackOf(l.dst));
});

test('rack con device su UNA sola faccia → UN rack, nessun "· retro" spurio', () => {
  const nb = {
    deviceRoles: [{ id: 22, slug: 'patch-panel', name: 'PP' }],
    racks: [{ id: 31, name: 'R105', u_height: 42 }],
    devices: [
      { id: 201, name: 'PP1', role: { id: 22 }, rack: { id: 31 }, position: 26, face: { value: 'rear', label: 'Rear' } },
      { id: 202, name: 'PP2', role: { id: 22 }, rack: { id: 31 }, position: 24, face: { value: 'rear', label: 'Rear' } },
    ],
  };
  const { state } = map.netboxToState(nb);
  assert.equal(state.racks.length, 1);
  assert.equal(state.racks[0].id, 'nb-rack-31');
  assert.equal(state.racks[0].name, 'R105');                 // niente "· retro"
  assert.ok(!/retro/.test(state.racks[0].name));
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-201').rackId, 'nb-rack-31');
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-202').rackId, 'nb-rack-31');
});

test('face assente/null → trattata come fronte (rack singolo)', () => {
  assert.equal(map._faceOf({ face: null }), 'front');
  assert.equal(map._faceOf({}), 'front');
  assert.equal(map._faceOf({ face: { value: 'rear' } }), 'rear');
  assert.equal(map._faceOf({ face: 'rear' }), 'rear');
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
  // front port "1" → slot 1, "2" → slot 2 (naturale, non ordine di array).
  // ⚠️ Dal riferimento all'origine la voce ESISTE — uno slot deve essere
  // indirizzabile all'oggetto NetBox da cui viene — ma l'invariante che questo
  // test difende resta la stessa: NESSUNA `ifName` quando il nome coincide col
  // numero di slot, perché ripeterlo sarebbe un'etichetta che non dice niente.
  assert.equal('nb-dev-200-1' in state.ports, true);
  assert.equal(state.ports['nb-dev-200-1'].ifName, undefined);
  assert.equal(state.ports['nb-dev-200-2'].ifName, undefined);
  assert.equal(state.ports['nb-dev-200-1'].srcFront, 2000);
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
  assert.equal(report.counts.unresolvedCables, 1);
  assert.deepEqual(report.cables.unresolved, [{ id: 702, reason: 'network-termination-not-imported' }]);
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

// ── Virtual chassis → stack ──────────────────────────────────────────────────
// Il modello InfraNet esiste già (lib/stack.js, tag-based su spec.stackId): qui si
// verifica solo che il filo sia collegato, non che nasca un modello nuovo.
test('virtual chassis NetBox → stack InfraNet: nome, numero di membro, master', () => {
  const nb = fixture();
  nb.devices[0].virtual_chassis = { id: 7, name: 'stack-piano-1', master: { id: 100 } };
  nb.devices[0].vc_position = 1;
  nb.devices[1].virtual_chassis = { id: 7, name: 'stack-piano-1', master: { id: 100 } };
  nb.devices[1].vc_position = 2;
  const { state, report } = map.netboxToState(nb);
  const a = state.nodes.find(n => n.id === 'nb-dev-100');
  const b = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(a.spec.stackId, 'stack-piano-1');
  assert.equal(a.spec.stackMemberId, 1);
  assert.equal(a.spec.stackRole, 'master');
  assert.equal(b.spec.stackId, 'stack-piano-1');
  assert.equal(b.spec.stackMemberId, 2);
  assert.equal(b.spec.stackRole, 'member');
  assert.equal(report.counts.stacks, 1, 'due apparati, UNO stack');
  assert.equal(state.nodes.length, 2, 'i membri restano due nodi: sono due scatole in due U');
});

test('virtual chassis senza nome ne\' master: ripiego leggibile e nessun ruolo inventato', () => {
  const nb = fixture();
  nb.devices[0].virtual_chassis = { id: 7 };
  nb.devices[0].vc_position = 3;
  const { state } = map.netboxToState(nb);
  const a = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(a.spec.stackId, 'nb-vc-7');
  assert.equal(a.spec.stackMemberId, 3);
  assert.equal('stackRole' in a.spec, false, 'senza master dichiarato decide getStackMaster, non l\'import');
});

test('due virtual chassis omonimi finiscono in un solo stack: si dichiara', () => {
  const nb = fixture();
  nb.devices[0].virtual_chassis = { id: 7, name: 'stack' };
  nb.devices[1].virtual_chassis = { id: 8, name: 'stack' };
  const { report } = map.netboxToState(nb);
  const issue = report.issues.find(i => i.code === 'stack.nameConflict');
  assert.ok(issue, 'l\'omonimia fonde due stack in uno: va detta');
  assert.equal(issue.deviceName, 'SW-ACC-03');
  assert.equal(report.counts.stacks, 1);
});

// ── Status di servizio ───────────────────────────────────────────────────────
test('status diverso da attivo: entra lo stesso, ma l\'anteprima lo dice', () => {
  const nb = fixture();
  nb.devices[1].status = { value: 'decommissioning', label: 'Decommissioning' };
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.nodes.length, 2, 'default storico: entra');
  const issue = report.issues.find(i => i.code === 'device.statusNotActive');
  assert.equal(issue.deviceName, 'SW-ACC-03');
  assert.equal(issue.kind, 'decommissioning');
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-101').source.status, 'decommissioning');
});

test('status attivo o assente: nessun avviso (ignoto non diventa un verdetto)', () => {
  const nb = fixture();
  nb.devices[0].status = { value: 'active' };
  const { report } = map.netboxToState(nb);
  assert.equal(report.issues.filter(i => i.code === 'device.statusNotActive').length, 0);
});

test('decisione «solo apparati in servizio»: restano fuori loro e i loro cavi', () => {
  const nb = fixture();
  nb.devices[1].status = { value: 'planned' };
  const { state, report } = map.netboxToState(nb, { selection: { decisions: { 'device.statusNotActive': 'skipNotActive' } } });
  assert.deepEqual(state.nodes.map(n => n.id), ['nb-dev-100']);
  assert.ok(report.excluded.devices.includes(101));
  assert.equal(report.counts.devices, 1);
  assert.equal(state.links.length, 0, 'il cavo non sopravvive all\'apparato che non c\'e\'');
  assert.ok(report.issues.some(i => i.code === 'device.statusNotActive'), 'la riga resta: e\' il modo di tornare indietro');
});

// ── Componenti che InfraNet non modella fuori dai PDU ────────────────────────
test('porte console fuori dai PDU: dichiarate, non sparite', () => {
  const nb = fixture();
  nb.consolePorts = [{ id: 900, device: { id: 100 }, name: 'console' }, { id: 901, device: { id: 100 }, name: 'aux' }];
  const { report } = map.netboxToState(nb);
  const issue = report.issues.find(i => i.code === 'ports.consoleSkipped');
  assert.equal(issue.found, 2);
  assert.equal(issue.deviceName, 'SW-CORE-01');
  assert.equal(report.counts.consolePortsSkipped, 2);
  assert.equal(report.counts.consolePorts, 0, 'il contatore dei PDU non si gonfia con quelle scartate');
});

test('alimentazione fuori dai PDU: ingressi e prese contati insieme e dichiarati', () => {
  const nb = fixture();
  nb.powerPorts = [{ id: 910, device: { id: 100 }, name: 'PSU-1' }, { id: 911, device: { id: 100 }, name: 'PSU-2' }];
  nb.powerOutlets = [{ id: 920, device: { id: 100 }, name: 'out-1' }];
  const { report } = map.netboxToState(nb);
  const issue = report.issues.find(i => i.code === 'ports.powerSkipped');
  assert.equal(issue.found, 3);
  assert.equal(report.counts.powerPortsSkipped, 3);
  assert.equal(report.counts.powerPorts, 0);
});

// ── Campi NetBox senza una casa in InfraNet ──────────────────────────────────
test('tenant, platform e description: ognuno dove ha senso, la platform MAI nel firmware', () => {
  const nb = fixture();
  nb.devices[0].tenant = { id: 5, name: 'Acme SpA' };
  nb.devices[0].platform = { id: 6, name: 'Cisco IOS', slug: 'cisco-ios' };
  nb.devices[0].description = 'Armadio di piano, chiave in portineria';
  nb.devices[0].site = { id: 1, name: 'Sede' };
  nb.devices[0].location = { id: 2, name: 'Piano 1' };
  const { state, report } = map.netboxToState(nb);
  const core = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(core.source.tenant, 'Acme SpA');
  assert.equal(core.source.platformSlug, 'cisco-ios');
  assert.equal(core.source.platformName, 'Cisco IOS');
  assert.equal(core.firmwareVer, undefined, 'la platform non e\' il firmware: la confusione farebbe scattare un identity-drift falso');
  assert.equal(core.notes, 'Sede · Piano 1 — Armadio di piano, chiave in portineria');
  // ⚠️ Il tenant NON produce piu' un avviso: fino alla 2.8.0 nessuna schermata lo
  // leggeva e l'anteprima doveva dichiararlo come limite; ora si vede nel riquadro
  // «Dichiarato dal DCIM» come ruolo, stato e platform, che una riga non ce l'hanno.
  assert.equal(report.issues.some(i => i.code === 'device.tenantSkipped'), false);
});

test('description senza ubicazione: la nota e\' solo la descrizione', () => {
  const nb = fixture();
  nb.devices[0].description = 'Solo prosa';
  const { state } = map.netboxToState(nb);
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-100').notes, 'Solo prosa');
});

// ── Prefissi: quello che entra, e la riga che lo dice ────────────────────────
// I due difetti che il modello a prefissi chiude, misurati su un NetBox vero:
// 51 prefissi su 90 senza VLAN (sparivano) e le VLAN dual-stack (il secondo
// prefisso sovrascriveva il primo, in silenzio).
test('prefissi: le reti senza VLAN entrano davvero, e l\'import lo dichiara', () => {
  const nb = fixture();
  nb.prefixes = [
    { id: 70, prefix: '10.0.0.0/24', vlan: { vid: 10 } },
    { id: 71, prefix: '192.168.0.0/20' },
    { id: 72, prefix: '10.255.0.0/30', description: 'punto-punto R1-R2' },
  ];
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.ipam.prefixes.length, 3, 'entrano tutti e tre');
  const senzaVlan = state.ipam.prefixes.filter(p => p.vlan == null);
  assert.equal(senzaVlan.length, 2);
  assert.equal(senzaVlan[1].description, 'punto-punto R1-R2', 'la descrizione NetBox arriva nel documento');
  assert.equal(state.ipam.prefixes.every(p => p.source === 'dcim'), true, 'provenienza dichiarata');

  const iss = report.issues.find(i => i.code === 'prefix.noVlan');
  assert.ok(iss, 'una riga lo dice: prima sparivano senza che nessuno lo sapesse');
  assert.equal(iss.n, 2);
});

test('prefissi: una VLAN dual-stack tiene tutti e due, e l\'import lo dichiara', () => {
  const nb = fixture();
  nb.prefixes = [
    { id: 70, prefix: '10.0.0.0/24', vlan: { vid: 10 } },
    { id: 73, prefix: '2001:db8:0:10::/64', vlan: { vid: 10 } },
  ];
  const { state, report } = map.netboxToState(nb);
  const v10 = state.ipam.prefixes.filter(p => p.vlan === 10);
  assert.equal(v10.length, 2, 'il secondo NON cancella il primo');
  assert.deepEqual(v10.map(p => p.cidr), ['10.0.0.0/24', '2001:db8:0:10::/64']);

  const iss = report.issues.find(i => i.code === 'prefix.multiPerVlan');
  assert.ok(iss);
  assert.equal(iss.n, 1);
  assert.equal(iss.total, 2);
});

test('prefissi: l\'esempio resta un esempio, non la lista intera della VLAN', () => {
  // Visto a schermo su NetBox vero: una VLAN con diciotto /24 stampava tutte e
  // diciotto dentro il campione, e tre campioni facevano un muro di testo. Una riga
  // che non si legge non informa.
  const nb = fixture();
  nb.prefixes = [];
  for (let i = 1; i <= 18; i++) nb.prefixes.push({ id: 700 + i, prefix: `10.112.${i}.0/24`, vlan: { vid: 100 } });
  const { report } = map.netboxToState(nb);
  const iss = report.issues.find(i => i.code === 'prefix.multiPerVlan');
  assert.equal(iss.total, 18, 'il TOTALE resta vero');
  assert.equal(iss.sample.length, 1, 'una VLAN sola, un campione solo');
  assert.equal(iss.sample[0], 'VLAN 100: 10.112.1.0/24, 10.112.2.0/24, 10.112.3.0/24 +15',
    'tre reti e quante restano');
});

test('prefissi: senza doppioni ne` reti orfane, nessuna delle due righe compare', () => {
  const nb = fixture();
  nb.prefixes = [{ id: 70, prefix: '10.0.0.0/24', vlan: { vid: 10 } }];
  const { report } = map.netboxToState(nb);
  assert.equal(report.issues.some(i => i.code === 'prefix.noVlan'), false);
  assert.equal(report.issues.some(i => i.code === 'prefix.multiPerVlan'), false);
});

// ── Indirizzi dichiarati che non entrano ─────────────────────────────────────
// Su un NetBox vero: 180 dichiarati, 180 senza apparato, 0 importati. Il numero
// era esatto e il silenzio no — «Indirizzi IP 0» accanto a «Prefissi 90» si
// legge come un guasto. Il censimento lo misura il server (due `limit=1`); qui
// si prova la parte che decide se quel numero e` dimostrabile.
test('IP: quelli senza apparato restano fuori, e l\'import lo dichiara', () => {
  const nb = fixture();
  nb.ipCensus = { total: 181, unassigned: 180, sample: ['10.0.5.7/24', '10.0.5.8/24'] };
  const { report } = map.netboxToState(nb);
  assert.equal(report.counts.ips, 1, 'entra solo l\'indirizzo agganciato');
  const iss = report.issues.find(i => i.code === 'ip.unassigned');
  assert.ok(iss, 'la riga c\'e\': senza, lo zero si legge come un guasto');
  assert.equal(iss.n, 180);
  assert.equal(iss.total, 181);
  assert.equal(iss.imported, 1);
  // Un numero da solo non si giudica: gli esempi dicono se e` roba che serve.
  assert.deepEqual(iss.sample, ['10.0.5.7/24', '10.0.5.8/24']);
});

test('IP: senza censimento non si dichiara niente', () => {
  const nb = fixture();
  delete nb.ipCensus;                              // versione che non l'ha misurato
  const { report } = map.netboxToState(nb);
  assert.equal(report.issues.some(i => i.code === 'ip.unassigned'), false,
    'nessun numero e` meglio di un numero inventato');
});

// La guardia, che e` il punto del blocco. Il filtro «non agganciato» ha un nome
// che cambia fra le versioni di NetBox: una che non lo conosce puo` IGNORARLO e
// rispondere col totale. L'invariante che lo smaschera: chi e` entrato E`
// agganciato, quindi i non agganciati non possono superare (totale - entrati).
test('IP: un conteggio impossibile non si stampa (filtro caduto nel vuoto)', () => {
  const nb = fixture();
  nb.ipCensus = { total: 181, unassigned: 181 };   // 181 liberi su 181, ma 1 e` entrato
  const { report } = map.netboxToState(nb);
  assert.equal(report.counts.ips, 1);
  assert.equal(report.issues.some(i => i.code === 'ip.unassigned'), false,
    '181 non agganciati con 1 agganciato e` una contraddizione: il filtro non e` stato applicato');
});

test('IP: se sono tutti agganciati la riga non compare', () => {
  const nb = fixture();
  nb.ipCensus = { total: 1, unassigned: 0 };
  const { report } = map.netboxToState(nb);
  assert.equal(report.issues.some(i => i.code === 'ip.unassigned'), false);
});

// ── L'indirizzo dell'interfaccia arriva sulla porta ──────────────────────────
// L'import risolveva gia' l'abbinamento porta↔indirizzo e poi lo lasciava in
// `state.ipam.addresses[]`, che non legge nessuno: di un router importato entrava
// il solo indirizzo di gestione. Il campo esiste, e' `state.ports[pid].ip`.
test('indirizzo di interfaccia → campo indirizzo della porta', () => {
  const nb = fixture();
  nb.ipAddresses[0].assigned_object = { id: 1000, device: { id: 100 } };
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.ports['nb-dev-100-1'].ip, '10.0.0.2', 'senza maschera: e\' un indirizzo, non una rete');
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-100').ip, '10.0.0.2', 'l\'indirizzo di gestione resta anche sul nodo');
  assert.equal(report.issues.some(i => i.code === 'ip.portExtra'), false, 'niente resta fuori, niente da dichiarare');
});

test('la porta ne tiene uno: il resto si conta e si dice', () => {
  const nb = fixture();
  nb.ipAddresses = [
    { id: 80, address: '10.0.0.2/24', assigned_object: { id: 1000, device: { id: 100 } } },
    { id: 81, address: '10.0.0.9/24', assigned_object: { id: 1000, device: { id: 100 } } },
    { id: 82, address: '2001:db8::1/64', assigned_object: { id: 1000, device: { id: 100 } } },
  ];
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.ports['nb-dev-100-1'].ip, '10.0.0.2', 'vince il primo IPv4 nell\'ordine di NetBox');
  const iss = report.issues.find(i => i.code === 'ip.portExtra');
  assert.ok(iss, 'cio\' che non entra nel campo va dichiarato');
  assert.equal(iss.n, 2);
  assert.ok(iss.sample.some(s => s.includes('GigabitEthernet1/0/1') && s.includes('2001:db8::1')),
    'l\'esempio nomina l\'interfaccia e l\'indirizzo');
});

// ── Le prenotazioni dell'IPAM occupano la rete ───────────────────────────────
test('prenotazioni: si posano sulla rete piu\' specifica che le contiene', () => {
  const nb = fixture();
  nb.prefixes = [
    { id: 70, prefix: '10.0.0.0/16', status: { value: 'container' } },
    { id: 71, prefix: '10.0.0.0/24', vlan: { vid: 10 } },
  ];
  nb.ipReservations = [
    { id: 900, address: '10.0.0.240/24' },
    { id: 901, address: '10.0.5.7/24' },       // dentro la /16, fuori dalla /24
    { id: 902, address: '192.168.9.9/24' },    // fuori da tutte le reti importate
  ];
  const { state, report } = map.netboxToState(nb);
  const p24 = state.ipam.prefixes.find(p => p.cidr === '10.0.0.0/24');
  const p16 = state.ipam.prefixes.find(p => p.cidr === '10.0.0.0/16');
  assert.deepEqual(p24.reserved, ['10.0.0.240'], 'la /24 batte il contenitore che la contiene');
  assert.deepEqual(p16.reserved, ['10.0.5.7']);
  const iss = report.issues.find(i => i.code === 'ip.reserved');
  assert.equal(iss.n, 2, 'quella fuori dalle reti importate non e\' affare di questo documento');
  assert.equal(iss.nets, 2);
});

// La trappola vera: NetBox IGNORA IN SILENZIO un filtro che non conosce e
// risponde con TUTTO. Se succede, un indirizzo di apparato non deve diventare
// una prenotazione — o l'occupazione conterebbe due volte lo stesso indirizzo.
test('prenotazioni: un indirizzo agganciato a un\'interfaccia non lo diventa', () => {
  const nb = fixture();
  nb.ipReservations = [
    { id: 900, address: '10.0.0.240/24' },
    { id: 901, address: '10.0.0.2/24', assigned_object: { id: 1000, device: { id: 100 } } },
  ];
  const { state } = map.netboxToState(nb);
  const p = state.ipam.prefixes.find(x => x.cidr === '10.0.0.0/24');
  assert.deepEqual(p.reserved, ['10.0.0.240'], 'la seconda cintura tiene anche se il filtro cade nel vuoto');
});

test('prenotazioni: senza, il prefisso resta esattamente com\'era', () => {
  const { state, report } = map.netboxToState(fixture());
  assert.equal(state.ipam.prefixes[0].reserved, undefined, 'nessun campo vuoto nel documento');
  assert.equal(report.issues.some(i => i.code === 'ip.reserved'), false);
});

// ── Ruoli: i terminali, e il tipo sbagliato che era peggio di quello mancante ──
test('ruoli: i terminali hanno finalmente il loro tipo', () => {
  const want = [
    ['ip-camera', 'IP Camera', 'webcam'], ['voip-phone', 'VoIP Phone', 'voip'],
    ['desktop', 'Desktop PC', 'pc'], ['display', 'Display', 'tv'],
    ['projector', 'Projector', 'projector'], ['door-controller', 'Door Controller', 'doorctrl'],
    ['iot-sensor', 'IoT Sensor', 'iot'], ['kvm', 'KVM Switch', 'kvm'],
    ['tablet', 'Tablet', 'mobile'],
  ];
  for (const [slug, name, type] of want) {
    const r = map._roleToInfranetType(slug, name, '');
    assert.equal(r.type, type, slug + ' → ' + type);
    assert.equal(r.mapped, true, slug + ' non deve finire fra i non mappati');
  }
});

// Un «KVM Switch» contiene la parola switch: la regola di ripiego lo classificava
// come switch. Un tipo sbagliato non lo va a controllare nessuno.
test('ruoli: «KVM Switch» non e\' uno switch, nemmeno per ripiego', () => {
  assert.equal(map._roleToInfranetType('kvm-over-ip', 'KVM Switch', 'KVM over IP 8-port').type, 'kvm');
  assert.equal(map._roleToInfranetType('access-switch', 'Access Switch', 'C9200').type, 'switch',
    'e lo switch resta uno switch');
});

test('generico: sul pavimento e\' customfloor, non «generico da rack»', () => {
  const nb = fixture();
  nb.deviceRoles.push({ id: 22, name: 'Cosa Ignota', slug: 'cosa-ignota' });
  nb.devices.push({ id: 102, name: 'MISTERO-01', device_type: { id: 10 }, role: { id: 22 } });   // niente rack
  nb.devices.push({ id: 103, name: 'MISTERO-02', device_type: { id: 10 }, role: { id: 22 }, rack: { id: 30 }, position: 10 });
  const { state } = map.netboxToState(nb);
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-102').type, 'customfloor');
  assert.equal(state.nodes.find(n => n.id === 'nb-dev-103').type, 'customrack');
});

// ── Wireless: un'interfaccia 802.11 e' un'antenna, non una porta ─────────────
function wifiFixture() {
  const nb = fixture();
  nb.wirelessLans = [
    { id: 900, ssid: 'Corp', auth_type: { value: 'wpa-enterprise' }, vlan: { vid: 20 } },
    { id: 901, ssid: 'Guest', auth_type: { value: 'wpa-personal' }, vlan: { vid: 40 } },
    { id: 902, ssid: 'Hotspot', auth_type: { value: 'open' } },
  ];
  nb.interfaces.push(
    { id: 1200, device: { id: 101 }, name: 'radio0', type: { value: 'ieee802.11ax' },
      rf_role: { value: 'ap' }, rf_channel: { value: '2.4g-6-2437-22' },
      wireless_lans: [{ id: 901 }, { id: 902 }] },
    { id: 1201, device: { id: 101 }, name: 'radio1', type: { value: 'ieee802.11ax' },
      rf_role: { value: 'ap' }, rf_channel: { value: '5g-42-5210-80' },
      wireless_lans: [{ id: 900 }] },
  );
  return nb;
}

test('wireless: le radio diventano node.radios, non porte logiche', () => {
  const { state, report } = map.netboxToState(wifiFixture());
  const ap = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(ap.radios.length, 2);
  assert.deepEqual({ band: ap.radios[0].band, channel: ap.radios[0].channel, standard: ap.radios[0].standard },
    { band: '2.4', channel: 6, standard: 'wifi6' });
  // Il canale largo non entra: v. il test dedicato più sotto. Qui conta la banda.
  assert.deepEqual({ band: ap.radios[1].band, channel: ap.radios[1].channel },
    { band: '5', channel: undefined });
  assert.equal(state.ports['nb-dev-101-logical-1200'], undefined, 'non deve nascere anche una porta logica');
  assert.equal(report.counts.radios, 2);
  assert.equal(report.counts.ssids, 3);
});

test('wireless: ogni SSID porta la sua VLAN e la sua cifratura', () => {
  const { state, report } = map.netboxToState(wifiFixture());
  const ap = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.deepEqual(ap.radios[0].ssids.map(s => [s.ssid, s.vlan, s.security]),
    [['Guest', 40, 'wpa2-psk'], ['Hotspot', undefined, 'open']]);
  assert.deepEqual(ap.radios[1].ssids.map(s => [s.ssid, s.vlan, s.security]), [['Corp', 20, 'wpa2-ent']]);
  assert.ok(ap.radios[0].ssids.every(s => /^nb-wl-/.test(s.id)), 'id BSS stabile, derivato da NetBox');
  // La generazione WPA NetBox non la dice: si legge WPA2 e lo si DICHIARA.
  const iss = report.issues.find(i => i.code === 'wifi.securityAssumed');
  assert.equal(iss.n, 2, 'i due WPA; la rete aperta non e\' una lettura, e\' un dato');
  assert.ok(report.issues.some(i => i.code === 'wifi.imported'));
});

test('wireless: senza wirelessLans la radio entra lo stesso con banda e canale', () => {
  const nb = wifiFixture();
  delete nb.wirelessLans;
  const { state, report } = map.netboxToState(nb);
  const ap = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(ap.radios.length, 2);
  assert.equal(ap.radios[0].ssids, undefined, 'nessun SSID inventato');
  assert.equal(report.counts.ssids, 0);
});

test('wireless: nessuna radio → nessuna riga e nessun campo', () => {
  const { state, report } = map.netboxToState(fixture());
  assert.equal(state.nodes.every(n => n.radios === undefined), true);
  assert.equal(report.counts.radios, 0);
  assert.equal(report.issues.some(i => String(i.code).startsWith('wifi.')), false);
});

// Il canale LARGO di NetBox non è il canale primario di InfraNet: «5g-42-5210-80»
// è il blocco da 80 MHz, e 42 non è un primario ammesso. Scriverlo produceva un
// avviso rosso su ogni AP importato — l'app aveva ragione, la mappatura no.
test('wireless: un canale largo non entra come primario, e si dichiara', () => {
  const nb = wifiFixture();
  const { state, report } = map.netboxToState(nb);
  const ap = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(ap.radios[0].channel, 6, '2,4 GHz: il 6 è un primario vero, entra');
  assert.equal(ap.radios[1].band, '5', 'la banda è certa e entra comunque');
  assert.equal(ap.radios[1].channel, undefined, 'il 42 è un blocco, non un canale: non si scrive');
  const iss = report.issues.find(i => i.code === 'wifi.wideChannel');
  assert.ok(iss, 'e va detto, non taciuto');
  assert.equal(iss.n, 1);
});

// ── Macchine virtuali ────────────────────────────────────────────────────────
// NetBox le tiene in un archivio a parte e l'import non lo apriva: l'hypervisor
// arrivava e la sua lista di VM restava vuota. Qui si verifica che tornino sopra
// il loro host, e soprattutto che NON ne finisca nessuna dove non si sa.
function vmFixture() {
  return {
    manufacturers: [{ id: 1, name: 'Dell', slug: 'dell' }],
    deviceTypes: [{ id: 10, manufacturer: { id: 1 }, model: 'PowerEdge R650', slug: 'dell-r650', u_height: 1 }],
    deviceRoles: [{ id: 20, name: 'Hypervisor', slug: 'hypervisor' }, { id: 21, name: 'Server', slug: 'server' }],
    racks: [{ id: 30, name: 'Rack A', u_height: 42 }],
    devices: [
      { id: 100, name: 'ESX-01', device_type: { id: 10 }, role: { id: 20 }, rack: { id: 30 }, position: 10, cluster: { id: 900 } },
      { id: 101, name: 'SRV-02', device_type: { id: 10 }, role: { id: 21 }, rack: { id: 30 }, position: 8 },
    ],
    interfaces: [],
    virtualMachines: [
      {
        id: 700, name: 'DC01', device: { id: 101 }, cluster: { id: 901 },
        status: { value: 'active' }, role: { name: 'Domain controller' },
        platform: { name: 'Windows Server 2022' }, vcpus: 4, memory: 8192, disk: 102400,
        description: 'Primario', primary_ip4: { address: '10.0.0.20/24' },
      },
      {
        id: 701, name: 'FILE01', cluster: { id: 900 },
        status: { value: 'offline' }, platform: { name: 'Ubuntu 22.04' }, vcpus: 2, memory: 4096,
      },
    ],
    vmInterfaces: [
      { id: 800, virtual_machine: { id: 700 }, name: 'eth0', mac_address: '00:50:56:aa:bb:01', untagged_vlan: { vid: 20 } },
    ],
    vmIpAddresses: [
      { id: 850, address: '10.0.0.20/24', assigned_object_type: 'virtualization.vminterface', assigned_object_id: 800 },
      { id: 851, address: 'fd00::20/64', assigned_object_type: 'virtualization.vminterface', assigned_object_id: 800 },
    ],
  };
}

test('VM: quella con il device dichiarato finisce su quell\'apparato', () => {
  const { state, report } = map.netboxToState(vmFixture());
  const srv = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(srv.vms.length, 1);
  const vm = srv.vms[0];
  assert.equal(vm.id, 'nb-vm-700', 'id stabile derivato da NetBox');
  assert.equal(vm.name, 'DC01');
  assert.equal(vm.role, 'Domain controller');
  assert.equal(vm.guestOs, 'win-srv', 'la platform passa dal vocabolario OS gia\' esistente');
  assert.equal(vm.state, 'running');
  assert.equal(vm.vcpu, 4);
  assert.equal(vm.ramGb, 8, '8192 MB dichiarati da NetBox = 8 GB');
  assert.equal(vm.diskGb, 100, '102400 MB = 100 GB');
  assert.equal(vm.notes, 'Primario');
  assert.equal(report.counts.vms, 2);
});

test('VM: la vNIC porta nome, MAC, VLAN e i due indirizzi', () => {
  const { state } = map.netboxToState(vmFixture());
  const vm = state.nodes.find(n => n.id === 'nb-dev-101').vms[0];
  assert.equal(vm.nics.length, 1);
  assert.equal(vm.nics[0].name, 'eth0');
  assert.equal(vm.nics[0].mac, '00:50:56:aa:bb:01');
  assert.equal(vm.nics[0].vlan, '20');
  assert.equal(vm.nics[0].ip, '10.0.0.20');
  assert.equal(vm.nics[0].ip6, 'fd00::20');
});

// NetBox spesso non nomina la macchina fisica: dice il cluster. Con UN SOLO
// apparato importato di quel cluster l'host non e' ambiguo — ma resta una
// LETTURA, e va dichiarata.
test('VM: senza device, il cluster con un solo host importato basta — e si dichiara', () => {
  const { state, report } = map.netboxToState(vmFixture());
  const esx = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(esx.vms.length, 1);
  assert.equal(esx.vms[0].name, 'FILE01');
  assert.equal(esx.vms[0].state, 'stopped', 'offline in NetBox = spenta');
  assert.equal(esx.vms[0].guestOs, 'ubuntu');
  const iss = report.issues.find(i => i.code === 'vm.viaCluster');
  assert.ok(iss, 'la deduzione si dichiara');
  assert.equal(iss.n, 1);
});

test('VM: cluster con due host importati → nessuno se la prende, e si dichiara', () => {
  const nb = vmFixture();
  nb.devices[1].cluster = { id: 900 };          // ora il cluster 900 ha DUE apparati
  delete nb.virtualMachines[0].device;          // e la prima VM non nomina piu' l'host
  nb.virtualMachines[0].cluster = { id: 900 };
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.nodes.every(n => !n.vms || !n.vms.length), true, 'appenderle a caso sarebbe un\'invenzione');
  const iss = report.issues.find(i => i.code === 'vm.noHost');
  assert.ok(iss);
  assert.equal(iss.n, 2);
  assert.deepEqual(iss.sample, ['DC01', 'FILE01']);
  assert.equal(report.counts.vms, 0);
});

test('VM: nessun host importato → restano fuori dichiarandolo, non spariscono', () => {
  const nb = vmFixture();
  nb.virtualMachines = [{ id: 700, name: 'ORFANA', cluster: { id: 999 }, status: { value: 'active' } }];
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.nodes.every(n => !n.vms), true);
  const iss = report.issues.find(i => i.code === 'vm.noHost');
  assert.equal(iss.n, 1);
  assert.deepEqual(iss.sample, ['ORFANA']);
});

// Chi ospita VM e' un host di virtualizzazione: lo dice l'archivio stesso. Il
// tipo si adegua, altrimenti il pannello non ha la sezione dove mostrarle — che
// e' il difetto da cui nasce tutto questo.
test('VM: un server che ospita VM diventa un host, e la riga lo dice', () => {
  const { state, report } = map.netboxToState(vmFixture());
  const srv = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(srv.type, 'hypervisor', 'era un server, NetBox ci mette sopra una VM');
  const esx = state.nodes.find(n => n.id === 'nb-dev-100');
  assert.equal(esx.type, 'hypervisor', 'gia\' hypervisor per ruolo: non cambia');
  const iss = report.issues.find(i => i.code === 'vm.hostRetyped');
  assert.ok(iss);
  assert.equal(iss.n, 1, 'solo quello che e\' cambiato davvero');
  assert.deepEqual(iss.sample, ['SRV-02']);
});

test('VM: un host da pavimento diventa homelab, non un hypervisor da rack', () => {
  const nb = vmFixture();
  delete nb.devices[1].rack;
  delete nb.devices[1].position;
  const { state } = map.netboxToState(nb);
  const srv = state.nodes.find(n => n.id === 'nb-dev-101');
  assert.equal(srv.placement, 'floor');
  assert.equal(srv.type, 'homelab');
});

test('VM: l\'indirizzo primario entra anche senza interfacce dichiarate', () => {
  const nb = vmFixture();
  nb.vmInterfaces = []; nb.vmIpAddresses = [];
  const { state } = map.netboxToState(nb);
  const vm = state.nodes.find(n => n.id === 'nb-dev-101').vms[0];
  assert.equal(vm.nics.length, 1);
  assert.equal(vm.nics[0].ip, '10.0.0.20');
});

// Il caso che conta di piu': l'import non porta NESSUNA VM perche' quelle di
// NetBox stanno altrove. Senza una riga che lo dica, l'elenco vuoto si legge
// come un difetto — ed e' la domanda da cui nasce tutta la funzione.
test('VM: zero importate ma NetBox ne ha, e la riga lo dice', () => {
  const nb = fixture();
  nb.vmCensus = { total: 180, sample: ['app-1', 'app-2'] };
  const { report } = map.netboxToState(nb);
  const iss = report.issues.find(i => i.code === 'vm.outOfScope');
  assert.ok(iss, 'zero VM senza spiegazione e\' il difetto, non il risultato');
  assert.equal(iss.n, 180);
  assert.equal(iss.imported, 0);
  assert.equal(iss.total, 180);
  assert.deepEqual(iss.sample, ['app-1', 'app-2']);
});

// Il censimento porta le PRIME righe di NetBox, che sono spesso proprio quelle
// entrate: stamparle sotto «restano fuori» sarebbe una bugia piccola e sicura.
test('VM: gli esempi del confine non nominano le VM che sono entrate', () => {
  const nb = vmFixture();
  nb.vmCensus = { total: 50, sample: ['DC01', 'altra-sede-01', 'FILE01'] };
  const { report } = map.netboxToState(nb);
  const iss = report.issues.find(i => i.code === 'vm.outOfScope');
  assert.equal(iss.n, 48);
  assert.deepEqual(iss.sample, ['altra-sede-01'], 'DC01 e FILE01 sono entrate: non sono esempi di cio\' che resta fuori');
});

test('VM: se sono entrate tutte, la riga del confine non compare', () => {
  const nb = vmFixture();
  nb.vmCensus = { total: 2 };
  const { report } = map.netboxToState(nb);
  assert.equal(report.counts.vms, 2);
  assert.equal(report.issues.some(i => i.code === 'vm.outOfScope'), false);
});

test('VM: nessuna VM → nessuna riga, nessun campo, nessun tipo cambiato', () => {
  const { state, report } = map.netboxToState(fixture());
  assert.equal(state.nodes.every(n => n.vms === undefined), true);
  assert.equal(report.counts.vms, 0);
  assert.equal(report.issues.some(i => String(i.code).startsWith('vm.')), false);
});

// ⚠️ DEFINIZIONE DUPLICATA, chiusa da qui. `_VM_HOST_TYPES` nel mapper e il flag
// `hostsVms` in src/app-types.js dicono la stessa cosa in due posti: il mapper e'
// una lib pura e non puo' importare un modulo ESM del frontend. Se qualcuno
// aggiunge un tipo che ospita VM di la' e non di qua, un apparato di quel tipo
// verrebbe riclassificato a hypervisor senza motivo — e nessun altro test lo
// vedrebbe.
test('VM: l\'elenco dei tipi che ospitano VM combacia con app-types.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-types.js'), 'utf8');
  const declared = new Set();
  const re = /^\s*([a-z][\w-]*)\s*:\s*\{([^}]*)\}/gmi;
  let m;
  while ((m = re.exec(src))) { if (/hostsVms\s*:\s*true/.test(m[2])) declared.add(m[1]); }
  assert.ok(declared.size > 0, 'la lettura di app-types.js deve trovare qualcosa');
  assert.deepEqual([...declared].sort(), [...map._VM_HOST_TYPES].sort());
});

// ── Ruoli IPAM → le liste di VLAN dichiarate ────────────────────────────────
// Il paletto e' uno solo e vale piu' della funzione: il motore NON indovina.
// Misurato su un NetBox vero, i ruoli si chiamano «Access - Data», «Access -
// Voice», «Access - Wireless», «Management», «Testing»: una regola che cercasse
// «wireless» dentro il nome avrebbe dichiarato ospiti l'intera rete aziendale.
function roleFixture() {
  const nb = fixture();
  nb.vlans = [
    { id: 60, vid: 10, name: 'Mgmt', role: { id: 1, name: 'Management', slug: 'management' } },
    { id: 61, vid: 20, name: 'Voice', role: { id: 2, name: 'Access - Voice', slug: 'access-voice' } },
    { id: 62, vid: 30, name: 'Wi-Fi', role: { id: 3, name: 'Access - Wireless', slug: 'access-wireless' } },
    // Stesso ruolo dichiarato una seconda volta su un altro sito: in NetBox e' la
    // norma (misurato: 13 dichiarazioni per lo stesso vid) e qui deve collassare.
    { id: 63, vid: 20, name: 'Voice', role: { id: 2, name: 'Access - Voice', slug: 'access-voice' } },
    { id: 64, vid: 40, name: 'Senza ruolo' },
  ];
  return nb;
}

test('ruoli VLAN: senza abbinamento il documento non guadagna NESSUNA lista', () => {
  const { state, report } = map.netboxToState(roleFixture());
  assert.equal(state.mgmtVlans, undefined);
  assert.equal(state.voiceVlans, undefined);
  assert.equal(state.guestVlans, undefined);
  assert.equal(state.nativeVlan, undefined);
  // I ruoli si vedono comunque: sono le righe di scelta dell'anteprima.
  assert.deepEqual(report.vlanRoles.map(r => r.slug).sort(),
    ['access-voice', 'access-wireless', 'management']);
  assert.equal(report.issues.some(i => String(i.code).startsWith('vlanRole.applied')), false);
});

test('ruoli VLAN: il ruolo riporta le VLAN distinte, non le dichiarazioni lette', () => {
  const { report } = map.netboxToState(roleFixture());
  const voice = report.vlanRoles.find(r => r.slug === 'access-voice');
  assert.deepEqual(voice.vids, [20], 'due dichiarazioni dello stesso vid sono una VLAN sola');
  assert.equal(voice.n, 2, 'ma quante ne ha lette si sa lo stesso');
  assert.equal(voice.name, 'Access - Voice');
});

test('ruoli VLAN: l\'abbinamento scelto compila le liste, e solo quelle scelte', () => {
  const { state, report } = map.netboxToState(roleFixture(), {
    selection: { vlanRoleMap: { management: 'mgmt', 'access-voice': 'voice' } },
  });
  assert.deepEqual(state.mgmtVlans, [10]);
  assert.deepEqual(state.voiceVlans, [20]);
  assert.equal(state.guestVlans, undefined, 'Access - Wireless non e\' stato abbinato: niente lista ospiti');
  const iss = report.issues.find(i => i.code === 'vlanRole.applied');
  assert.equal(iss.n, 2);
  assert.equal(iss.vlans, 2);
});

test('ruoli VLAN: un bersaglio inventato non scrive niente', () => {
  const { state } = map.netboxToState(roleFixture(), {
    selection: { vlanRoleMap: { management: 'gestione', 'access-voice': true } },
  });
  assert.equal(state.mgmtVlans, undefined);
  assert.equal(state.voiceVlans, undefined);
});

test('ruoli VLAN: la nativa e\' UNA, un ruolo con piu\' VLAN non la sceglie a caso', () => {
  const nb = roleFixture();
  nb.vlans.push({ id: 65, vid: 21, name: 'Voice 2', role: { id: 2, name: 'Access - Voice', slug: 'access-voice' } });
  const { state, report } = map.netboxToState(nb, {
    selection: { vlanRoleMap: { 'access-voice': 'native' } },
  });
  assert.equal(state.nativeVlan, undefined);
  const iss = report.issues.find(i => i.code === 'vlanRole.nativeMany');
  assert.equal(iss.vids, 2);
  assert.equal(iss.role, 'Access - Voice');
});

test('ruoli VLAN: la nativa entra quando il ruolo tocca una VLAN sola', () => {
  const { state } = map.netboxToState(roleFixture(), {
    selection: { vlanRoleMap: { management: 'native' } },
  });
  assert.equal(state.nativeVlan, 10);
});

// La VLAN 1 e' il default: il pannello la cancella invece di scriverla, e
// l'import deve fare la stessa cosa o il documento dichiarerebbe un'ovvieta'.
test('ruoli VLAN: la VLAN 1 non diventa mai una nativa dichiarata', () => {
  const nb = roleFixture();
  nb.vlans = [{ id: 66, vid: 1, name: 'default', role: { id: 4, name: 'Nativa', slug: 'nativa' } }];
  const { state, report } = map.netboxToState(nb, { selection: { vlanRoleMap: { nativa: 'native' } } });
  assert.equal(state.nativeVlan, undefined);
  assert.ok(report.issues.find(i => i.code === 'vlanRole.nativeMany'));
});

test('ruoli VLAN: la stessa VLAN in due liste si applica e si DICE', () => {
  const nb = roleFixture();
  nb.vlans.push({ id: 67, vid: 10, name: 'Mgmt bis', role: { id: 5, name: 'Ospiti', slug: 'ospiti' } });
  const { state, report } = map.netboxToState(nb, {
    selection: { vlanRoleMap: { management: 'mgmt', ospiti: 'guest' } },
  });
  assert.deepEqual(state.mgmtVlans, [10]);
  assert.deepEqual(state.guestVlans, [10], 'sono elenchi indipendenti: il documento le tiene entrambe');
  assert.equal(report.issues.find(i => i.code === 'vlanRole.conflict').n, 1);
});

// Misurato su un NetBox vero: «Management» sta su tredici RETI e su nessuna VLAN.
// Senza questa riga quel ruolo sparirebbe dall'anteprima e sembrerebbe non esistere.
test('ruoli VLAN: un ruolo che sta solo sulle reti viene dichiarato, non abbinato', () => {
  const nb = roleFixture();
  nb.prefixes = [
    { id: 70, prefix: '10.0.0.0/24', vlan: { vid: 10 }, role: { name: 'Management', slug: 'management' } },
    { id: 71, prefix: '10.9.0.0/24', role: { name: 'Fuori banda', slug: 'oob' } },
    { id: 72, prefix: '10.9.1.0/24', role: { name: 'Fuori banda', slug: 'oob' } },
  ];
  const { report } = map.netboxToState(nb);
  const iss = report.issues.find(i => i.code === 'vlanRole.prefixOnly');
  assert.equal(iss.n, 1, 'management ha gia\' la sua VLAN: non e\' uno di questi');
  assert.equal(iss.nets, 2);
  assert.deepEqual(iss.sample, ['Fuori banda']);
  assert.equal(report.vlanRoles.some(r => r.slug === 'oob'), false, 'senza VLAN non e\' una riga da abbinare');
});

test('ruoli VLAN: senza ruoli in NetBox, nessuna riga e nessun avviso', () => {
  const { state, report } = map.netboxToState(fixture());
  assert.deepEqual(report.vlanRoles, []);
  assert.equal(report.issues.some(i => String(i.code).startsWith('vlanRole.')), false);
  assert.equal(state.mgmtVlans, undefined);
});

// ── Le prese di un UPS ──────────────────────────────────────────────────────
// Non e' il PDU a essere speciale: e' l'avere prese a valle. Un UPS da rack ne ha
// quanto una barra, e sono la sola cosa che dice CHI RESTA ACCESO quando manca la
// corrente. Finche' il cancello diceva `type === 'pdu'`, quelle prese arrivavano
// fino alla riga giusta e finivano contate fra le PERDITE.
function upsFixture() {
  return {
    deviceTypes: [{ id: 80, manufacturer: { id: 1 }, model: 'Smart-UPS 1500', slug: 'apc-smart-ups-1500', u_height: 2 }],
    manufacturers: [{ id: 1, name: 'APC', slug: 'apc' }],
    deviceRoles: [{ id: 81, name: 'UPS', slug: 'ups' }],
    racks: [{ id: 82, name: 'Rack A', u_height: 42 }],
    devices: [{ id: 83, name: 'UPS-01', device_type: { id: 80 }, role: { id: 81 }, rack: { id: 82 }, position: 1 }],
    interfaces: [{ id: 840, device: { id: 83 }, name: 'eth0', enabled: true }],
    powerPorts: [{ id: 860, device: { id: 83 }, name: 'input', maximum_draw: 1500 }],
    powerOutlets: [
      { id: 870, device: { id: 83 }, name: 'Group1-1', status: { value: 'enabled' }, mark_connected: true,
        link_peer: { id: 990, name: 'PSU-1', device: { id: 99, name: 'SRV-01' } }, link_peer_type: 'powerport' },
      { id: 871, device: { id: 83 }, name: 'Group1-2', status: { value: 'enabled' } },
      { id: 872, device: { id: 83 }, name: 'Group2-1', status: { value: 'disabled' } },
    ],
  };
}

test('UPS: le sue prese entrano, con stato e apparato alimentato', () => {
  const { state, report } = map.netboxToState(upsFixture());
  const ups = state.nodes[0];
  assert.equal(ups.type, 'ups');
  assert.equal(ups.pduOutletCount, 3);
  assert.deepEqual(ups.powerOutlets.map(o => o.status), ['active', 'active', 'inactive']);
  assert.equal(ups.powerOutlets[0].connectedTo.deviceName, 'SRV-01');
  assert.equal(report.counts.powerOutlets, 3);
});

test('UPS: le prese non sono piu\' una perdita dichiarata', () => {
  const { report } = map.netboxToState(upsFixture());
  assert.equal(report.counts.powerPortsSkipped, 0);
  assert.equal(report.issues.some(i => i.code === 'ports.powerSkipped'), false);
});

test('UPS: l\'ingresso di corrente entra come sul PDU', () => {
  const { state, report } = map.netboxToState(upsFixture());
  assert.equal(state.nodes[0].pduPowerPorts[0].maximumDraw, 1500);
  assert.equal(report.counts.powerPorts, 1);
});

// La scheda di rete di un UPS e' gestione, non una porta utente: stesso schema di
// id del PDU, cosi' il render la trova dov'e' abituato a cercarla.
test('UPS: l\'interfaccia Ethernet e\' gestione, con lo schema di id del PDU', () => {
  const { state } = map.netboxToState(upsFixture());
  assert.equal(state.nodes[0].pduMgmtMode, 'ethernet');
  assert.equal(state.ports['nb-dev-83-1'].mgmt, true);
  assert.equal('nb-dev-83-mgmt1' in state.ports, false);
});

// ⛔ L'ATS resta fuori, ed e' una decisione: il suo senso sono i DUE INGRESSI.
test('ATS: le prese restano fuori e la perdita si dichiara', () => {
  const nb = upsFixture();
  nb.deviceRoles = [{ id: 81, name: 'ATS', slug: 'ats' }];
  nb.deviceTypes[0].model = 'Rack ATS';
  const { state, report } = map.netboxToState(nb);
  assert.equal(state.nodes[0].powerOutlets, undefined);
  assert.equal(report.counts.powerOutlets, 0);
  assert.ok(report.issues.find(i => i.code === 'ports.powerSkipped'));
});

// ── L'origine del documento ─────────────────────────────────────────────────
// Il progetto registra da quale fetta di NetBox e' nato. Senza, il confronto non
// sa a che cosa appartiene e finisce per dichiarare «nuovo» tutto il resto
// dell'archivio: misurato, 181 novita' vere e inutili su un progetto di un sito.
test('origine: il progetto registra i siti degli apparati ENTRATI', () => {
  const nb = fixture();
  nb.devices[0].site = { id: 7, name: 'Sede Milano' };
  nb.devices[1].site = { id: 7, name: 'Sede Milano' };
  const { state } = map.netboxToState(nb);
  assert.equal(state.source.dcim.system, 'netbox');
  assert.deepEqual(state.source.dcim.sites, [{ id: '7', name: 'Sede Milano' }]);
});

// ⚠️ L'origine e' una MISURA del risultato, non la copia della domanda: se scegli
// tre siti e uno solo ha apparati, il progetto viene da quello.
test('origine: due siti dichiarati, due siti registrati — senza doppioni', () => {
  const nb = fixture();
  nb.devices[0].site = { id: 7, name: 'Milano' };
  nb.devices[1].site = { id: 9, name: 'Roma' };
  nb.devices.push(Object.assign({}, nb.devices[0], { id: 102, name: 'SW-3', site: { id: 7, name: 'Milano' } }));
  const { state } = map.netboxToState(nb);
  assert.deepEqual(state.source.dcim.sites.map(s => s.id).sort(), ['7', '9']);
});

// Vuoto NON e' assente: chi legge deve distinguere «nessun apparato ha un sito»
// da «progetto vecchio, che l'origine non la registrava affatto».
test('origine: apparati senza sito → lista vuota, non campo assente', () => {
  const { state } = map.netboxToState(fixture());
  assert.deepEqual(state.source.dcim.sites, []);
});

test('origine: nessun apparato letto → nessuna origine inventata', () => {
  const { state } = map.netboxToState({ vlans: [{ id: 1, vid: 10, name: 'X' }] });
  assert.equal(state.source, undefined);
});

// ⚠️ Il JSON di progetto si esporta e si passa di mano: l'indirizzo dell'istanza
// NetBox non deve viaggiarci dentro.
test('origine: nessun indirizzo dell\'istanza finisce nel documento', () => {
  const nb = fixture();
  nb.devices[0].site = { id: 7, name: 'Milano' };
  const { state } = map.netboxToState(nb);
  const dump = JSON.stringify(state.source);
  assert.equal(/https?:\/\//.test(dump), false);
  assert.deepEqual(Object.keys(state.source.dcim).sort(), ['sites', 'system']);
});
