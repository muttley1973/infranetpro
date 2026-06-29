// Test per lib/api-shape.js — trasformazioni PURE state→DTO della REST API v1.
// Verifica: allowlist (niente segreti), VLAN derivata da IP↔subnet, esclusione
// dei tipi strutturali, forma Ansible dynamic inventory.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  projectToInventory, projectToDevices, toAnsibleInventory, nodeToDevice,
} = require('../lib/api-shape.js');

// Progetto campione minimale ma realistico (modellato su projects/8.json).
function sampleProject() {
  return {
    id: 8,
    name: 'Azienda Demo',
    updated_at: '2026-06-27 10:00:00',
    state: {
      vlanNames: { 10: 'Management', 20: 'Dati' },
      ipam: { vlans: {
        10: { subnet: '10.20.10.0/24', gateway: '10.20.10.1', dns: '10.20.10.1' },
        20: { subnet: '10.20.20.0/24', gateway: '10.20.20.1', dns: '10.20.10.1' },
      } },
      racks: [{ id: 'rk-core', name: 'CED · Rack Core', sizeU: 42, x: 1, y: 2 }],
      nodes: [
        { id: 'sw1', type: 'switch', name: 'CORE-SW-1', brand: 'Cisco', model: 'C9300-48P', rackId: 'rk-core', rackU: 42, sizeU: 1, ports: 48,
          mac: '50:9d:dd:30:03:07', ip: '10.20.10.2', hostname: 'core-sw-1.corp.local',
          serialNumber: 'FCW2245X0AB', firmwareVer: 'IOS-XE 17.6', mgmtProto: 'ssh', mgmtUrl: 'ssh://10.20.10.2',
          integration: { driver: 'snmp-v2c', host: '10.20.10.2', community: 'SECRET-COMMUNITY' } },
        { id: 'pc1', type: 'pc', name: 'PC-Ufficio', ip: '10.20.20.50', mac: 'aa:bb:cc:dd:ee:01' },
        { id: 'ap1', type: 'ap', name: 'AP-Sala', ip: '10.20.10.30', mac: 'aa:bb:cc:dd:ee:02', radios: [{ band: '5' }] },
        { id: 'r1', type: 'room', name: 'Server Room' },     // strutturale → escluso
        { id: 'wp1', type: 'wallport', name: 'Presa 1' },     // passivo senza IP, niente VLAN
      ],
    },
  };
}

test('projectToInventory: forma stabile + counts', () => {
  const inv = projectToInventory(sampleProject());
  assert.equal(inv.id, 8);
  assert.equal(inv.name, 'Azienda Demo');
  assert.equal(inv.updated_at, '2026-06-27 10:00:00');
  // room escluso, gli altri 4 inclusi
  assert.equal(inv.devices.length, 4);
  assert.equal(inv.counts.devices, 4);
  assert.equal(inv.counts.withIp, 3);   // sw1, pc1, ap1
  assert.equal(inv.counts.snmp, 1);     // solo sw1
  // VLAN normalizzate (id numerico, nome, subnet)
  const v10 = inv.vlans.find(v => v.id === 10);
  assert.equal(v10.name, 'Management');
  assert.equal(v10.subnet, '10.20.10.0/24');
  // rack normalizzato
  assert.equal(inv.racks[0].id, 'rk-core');
  assert.equal(inv.racks[0].sizeU, 42);
});

test('nodeToDevice: ALLOWLIST — la community SNMP non trapela', () => {
  const inv = projectToInventory(sampleProject());
  const sw = inv.devices.find(d => d.id === 'sw1');
  // booleano snmp presente, ma nessun campo che contenga il segreto
  assert.equal(sw.snmp, true);
  const json = JSON.stringify(sw);
  assert.ok(!/community/i.test(json), 'la chiave community non deve comparire');
  assert.ok(!/SECRET-COMMUNITY/.test(json), 'il valore community non deve comparire');
  // MAC normalizzato in UPPER (identità)
  assert.equal(sw.mac, '50:9D:DD:30:03:07');
  // rack + posizione U
  assert.equal(sw.rack.id, 'rk-core');
  assert.equal(sw.rack.u, 42);
});

test('VLAN derivata da IP↔subnet', () => {
  const inv = projectToInventory(sampleProject());
  assert.equal(inv.devices.find(d => d.id === 'sw1').vlan, 10); // 10.20.10.2 ∈ 10.20.10.0/24
  assert.equal(inv.devices.find(d => d.id === 'pc1').vlan, 20); // 10.20.20.50 ∈ 10.20.20.0/24
  assert.equal(inv.devices.find(d => d.id === 'ap1').vlan, 10);
  assert.equal(inv.devices.find(d => d.id === 'wp1').vlan, null); // niente IP → niente VLAN
});

test('wireless: true solo con radios', () => {
  const inv = projectToInventory(sampleProject());
  assert.equal(inv.devices.find(d => d.id === 'ap1').wireless, true);
  assert.equal(inv.devices.find(d => d.id === 'sw1').wireless, false);
});

test('projectToDevices: stessa lista, senza contorno', () => {
  const devs = projectToDevices(sampleProject());
  assert.equal(devs.length, 4);
  assert.ok(devs.every(d => d.type !== 'room'));
});

test('toAnsibleInventory: _meta.hostvars + gruppi per tipo/VLAN/rack/brand', () => {
  const inv = toAnsibleInventory(sampleProject());
  // solo i 3 device con IP diventano host (wallport e room esclusi)
  const hosts = Object.keys(inv._meta.hostvars);
  assert.equal(hosts.length, 3);
  // ansible_host = IP
  assert.equal(inv._meta.hostvars['CORE-SW-1'].ansible_host, '10.20.10.2');
  assert.equal(inv._meta.hostvars['CORE-SW-1'].infranet_type, 'switch');
  // niente segreti nelle hostvars
  assert.ok(!/community/i.test(JSON.stringify(inv._meta)));
  // gruppi
  assert.deepEqual(inv.type_switch.hosts, ['CORE-SW-1']);
  assert.deepEqual(inv.vlan_10.hosts.sort(), ['AP-Sala', 'CORE-SW-1']);
  assert.deepEqual(inv.vlan_20.hosts, ['PC-Ufficio']);
  assert.deepEqual(inv.rack_rk_core.hosts, ['CORE-SW-1']);
  assert.ok(inv.brand_cisco.hosts.includes('CORE-SW-1'));
  // all.children elenca tutti i gruppi + ungrouped
  assert.ok(inv.all.children.includes('type_switch'));
  assert.ok(inv.all.children.includes('ungrouped'));
});

test('nodeToDevice: campi arricchiti (serial/firmware/hostname/mgmt) nel DTO', () => {
  const sw = projectToInventory(sampleProject()).devices.find(d => d.id === 'sw1');
  assert.equal(sw.serial, 'FCW2245X0AB');
  assert.equal(sw.firmware, 'IOS-XE 17.6');
  assert.equal(sw.hostname, 'core-sw-1.corp.local');
  assert.equal(sw.model, 'C9300-48P');
  assert.equal(sw.mgmtProtocol, 'ssh');
  assert.equal(sw.mgmtUrl, 'ssh://10.20.10.2');
  // device senza questi campi → null (non stringa vuota)
  const pc = projectToInventory(sampleProject()).devices.find(d => d.id === 'pc1');
  assert.equal(pc.serial, null);
  assert.equal(pc.mgmtProtocol, null);
});

test('nodeToDevice: mgmtUrl con credenziali → ripulito (mai esporre user:pass)', () => {
  const d = nodeToDevice({ id: 'fw', type: 'firewall', name: 'FW', ip: '10.0.0.1', mgmtUrl: 'https://admin:s3cr3t@10.0.0.1' }, {});
  assert.equal(d.mgmtUrl, 'https://10.0.0.1');
  assert.ok(!/admin|s3cr3t|@/.test(JSON.stringify(d)), 'nessuna credenziale nell\'URL esposto');
});

test('toAnsibleInventory: hostvars arricchite (contesto rete + asset + mgmt) e gruppi wireless/snmp_managed', () => {
  const inv = toAnsibleInventory(sampleProject());
  const sw = inv._meta.hostvars['CORE-SW-1'];
  // contesto di rete derivato dalla VLAN del device (vlan 10 → 10.20.10.0/24)
  assert.equal(sw.subnet, '10.20.10.0/24');
  assert.equal(sw.gateway, '10.20.10.1');
  assert.equal(sw.dns, '10.20.10.1');
  assert.equal(sw.vlan_name, 'Management');
  // asset + collocazione + gestione
  assert.equal(sw.serial, 'FCW2245X0AB');
  assert.equal(sw.firmware, 'IOS-XE 17.6');
  assert.equal(sw.hostname, 'core-sw-1.corp.local');
  assert.equal(sw.rack_id, 'rk-core');
  assert.equal(sw.rack_unit, 42);
  assert.equal(sw.mgmt_protocol, 'ssh');
  assert.equal(sw.mgmt_url, 'ssh://10.20.10.2');
  // pc1 ∈ vlan 20 → contesto rete della sua VLAN
  assert.equal(inv._meta.hostvars['PC-Ufficio'].subnet, '10.20.20.0/24');
  // nuovi gruppi facet
  assert.deepEqual(inv.wireless.hosts, ['AP-Sala']);
  assert.deepEqual(inv.snmp_managed.hosts, ['CORE-SW-1']);
  assert.ok(inv.all.children.includes('wireless'));
  assert.ok(inv.all.children.includes('snmp_managed'));
  // ancora ZERO segreti dopo l'arricchimento
  assert.ok(!/community|SECRET/i.test(JSON.stringify(inv._meta)));
});

test('toAnsibleInventory: hostname deduplicato su collisione di nome', () => {
  const proj = { id: 1, name: 'x', state: { nodes: [
    { id: 'a', type: 'pc', name: 'NODO', ip: '1.1.1.1' },
    { id: 'b', type: 'pc', name: 'NODO', ip: '1.1.1.2' },
  ] } };
  const inv = toAnsibleInventory(proj);
  const hosts = Object.keys(inv._meta.hostvars).sort();
  assert.deepEqual(hosts, ['NODO', 'NODO_2']);
});

test('robustezza: progetto/stato vuoti non esplodono', () => {
  assert.deepEqual(projectToDevices({}), []);
  assert.deepEqual(projectToDevices(null), []);
  const inv = projectToInventory(null);
  assert.equal(inv.devices.length, 0);
  const ans = toAnsibleInventory({});
  assert.deepEqual(Object.keys(ans._meta.hostvars), []);
  assert.deepEqual(ans.all.children, ['ungrouped']);
});

test('nodeToDevice: funzione diretta con context vuoto', () => {
  const d = nodeToDevice({ id: 'x', type: 'server', name: 'SRV', ip: '10.0.0.9' }, {});
  assert.equal(d.id, 'x');
  assert.equal(d.vlan, null);  // nessun vlanIdx → null
  assert.equal(d.rack, null);
  assert.equal(d.snmp, false);
});
