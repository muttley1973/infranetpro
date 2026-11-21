'use strict';
// ============================================================
// VM ↔ NETBOX — cio' che NetBox dichiara su una macchina virtuale e sulle sue schede, e che l'import perdeva in silenzio
// (l'unico rapporto era `vm.imported n=8`):
//   · i COMMENTI sparivano appena c'era una descrizione;
//   · il ciclo di vita (planned, staged, failed, decommissioning) non entrava: la VM nasceva «in servizio»;
//   · una scheda in modo `tagged` perdeva le sue VLAN taggate (e il trunk dell'uplink dell'host restava access);
//   · il `primary_ip6` non si leggeva;
//   · MTU, VRF, descrizione, padre, bridge, disabilitata, i dischi, il cluster, il tenant: non c'erano.
// Le fixture portano il NULL che manda l'API vera (`untagged_vlan: null`): `+null` e' 0 (v. dcim-null-vlan.test.js).
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dcim = require('../lib/dcim-map.js');
const DS = require('../lib/device-status.js');
const P = require('../lib/vm-presence.js');
const SRC = require('../lib/dcim-source-view.js');
const VT = require('../lib/vlan-trunk.js');
const { buildDecisions, sanitizeDecisions, DECISION_CATALOG } = require('../lib/dcim-decisions.js');
const i18n = require('../lib/i18n.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const HOST = { id: 1, name: 'HV-1', role: { id: 40 }, site: { id: 1, name: 'S' } };
const VM = (id, extra) => Object.assign({ id, name: 'vm' + id, device: { id: 1 }, status: { value: 'active' } }, extra || {});
const NIC = (id, vmId, extra) => Object.assign({ id, virtual_machine: { id: vmId }, name: 'eth0', enabled: true, untagged_vlan: null }, extra || {});

function importa(vms, extra, decisions) {
  const nb = Object.assign({
    deviceRoles: [{ id: 40, slug: 'server', name: 'Server' }], devices: [HOST], racks: [], interfaces: [],
    virtualMachines: vms, vmInterfaces: [], vmIpAddresses: [],
  }, extra || {});
  const r = dcim.netboxToState(nb, decisions ? { selection: { decisions } } : undefined);
  const host = r.state.nodes.find((n) => n.id === 'nb-dev-1');
  return { r, host, vms: (host && host.vms) || [], issues: (code) => r.report.issues.filter((i) => i.code === code) };
}
const una = (v, extra, nics) => importa([v], Object.assign({ vmInterfaces: nics || [] }, extra || {})).vms[0];

// ── commenti ──────────────────────────────────────────────────────────────────────────────────────────────
test('note: la descrizione e i commenti sono due testi diversi e entrano TUTTI E DUE, col separatore degli apparati', () => {
  const n = (extra) => una(VM(10, extra)).notes;
  assert.equal(n({ description: 'Gestionale', comments: 'Da migrare in primavera' }), 'Gestionale — Da migrare in primavera');
  assert.equal(n({ description: 'Gestionale' }), 'Gestionale');
  assert.equal(n({ comments: 'Da migrare in primavera' }), 'Da migrare in primavera', 'solo i commenti: prima si vedevano, ora anche con la descrizione');
  assert.equal(n({ description: '', comments: '   ' }), undefined, 'niente da dire: nessuna nota');
});

// ── IPv6 primario ─────────────────────────────────────────────────────────────────────────────────────────
test('primary_ip6: una VM con solo l\'IPv6 primario arriva con un indirizzo, e un v4 nel campo v6 non entra', () => {
  assert.deepEqual(una(VM(11, { primary_ip6: { address: '2001:db8::11/64' } })).nics, [{ id: 'nic1', ip6: '2001:db8::11' }]);
  assert.equal(una(VM(12, { primary_ip6: { address: '10.0.0.5/24' } })).nics, undefined, 'un v4 spacciato per v6');
  const both = una(VM(13, { primary_ip4: { address: '10.0.0.13/24' }, primary_ip6: { address: '2001:db8::13/64' } }), { vmInterfaces: [NIC(100, 13)] });
  assert.equal(both.nics[0].ip, '10.0.0.13');
  assert.equal(both.nics[0].ip6, '2001:db8::13', 'sulla prima scheda, accanto al v4');
});

test('primary_ip6: un v6 gia\' scritto sulle schede (dagli indirizzi) NON viene sovrascritto dal primario', () => {
  const v = una(VM(14, { primary_ip6: { address: '2001:db8::99/64' } }), {
    vmInterfaces: [NIC(101, 14)],
    vmIpAddresses: [{ id: 5, address: '2001:db8::14/64', assigned_object_type: 'virtualization.vminterface', assigned_object_id: 101 }],
  });
  assert.equal(v.nics[0].ip6, '2001:db8::14');
});

// ── ciclo di vita ─────────────────────────────────────────────────────────────────────────────────────────
test('ciclo di vita: planned, staged, failed, decommissioning entrano col loro stato; l\'accensione resta non dichiarata', () => {
  for (const s of ['planned', 'staged', 'failed', 'decommissioning']) {
    const v = una(VM(20, { status: { value: s } }));
    assert.equal(v.status, s, s);
    assert.equal('state' in v, false, s + ': non dice se la macchina giri');
    assert.equal(v.source.status, s, s + ': la parola di NetBox, verbatim');
  }
  assert.equal(una(VM(21, { status: 'planned' })).status, 'planned', 'anche come testo semplice (NetBox piu\' vecchi)');
});

test('ciclo di vita: active e offline sono l\'ACCENSIONE (state), non un ciclo di vita: nessuno `status`', () => {
  const a = una(VM(22, { status: { value: 'active' } }));
  assert.equal(a.state, 'running'); assert.equal('status' in a, false); assert.equal(a.source.status, 'active');
  const o = una(VM(23, { status: { value: 'offline' } }));
  assert.equal(o.state, 'stopped'); assert.equal('status' in o, false); assert.equal(o.source.status, 'offline');
});

test('ciclo di vita: stato assente o ignoto non diventa un verdetto, e senza niente da dire non c\'e\' `source`', () => {
  for (const status of [null, undefined]) {
    const v = una(VM(24, { status }));
    assert.equal('status' in v, false); assert.equal('state' in v, false); assert.equal('source' in v, false, 'status ' + String(status));
  }
  const x = una(VM(25, { status: { value: 'boh' } }));
  assert.equal('status' in x, false, 'una parola che non conosciamo: nessun ciclo di vita inventato');
  assert.equal(x.source.status, 'boh', 'ma la parola di NetBox si legge');
  assert.deepEqual(importa([VM(26, { status: { value: 'active' } })]).issues('vm.statusNotActive'), [], 'in servizio: nessun avviso');
});

test('decisione «solo le VM in servizio»: restano fuori, non sono orfane e non sono «fuori dal censimento»', () => {
  const vms = [VM(30), VM(31, { status: { value: 'planned' } }), VM(32, { status: { value: 'decommissioning' } }), VM(33, { status: { value: 'offline' } })];
  const census = { vmCensus: { total: 4, sample: ['vm30'] } };
  const skip = importa(vms, census, { 'vm.statusNotActive': 'skipNotActive' });
  assert.deepEqual(skip.vms.map((v) => v.name), ['vm30', 'vm33'], 'una VM spenta (offline) esiste: resta dentro');
  assert.equal(skip.r.report.counts.vms, 2);
  assert.equal(skip.r.report.counts.vmsSkipped, 2);
  assert.deepEqual(skip.issues('vm.noHost'), [], 'escluse per scelta non sono senza host');
  assert.deepEqual(skip.issues('vm.outOfScope'), [], 'il censimento sottrae anche le escluse: tutte sono state viste');
  assert.deepEqual(skip.issues('vm.statusNotActive').map((i) => i.kind).sort(), ['decommissioning', 'planned'], 'la riga resta: e\' il modo di tornare indietro');

  const all = importa(vms, census);
  assert.deepEqual(all.vms.map((v) => v.name), ['vm30', 'vm31', 'vm32', 'vm33'], 'predefinito: entrano tutte');
  assert.equal(all.r.report.counts.vmsSkipped, 0);
  assert.deepEqual(all.issues('vm.statusNotActive').map((i) => i.kind).sort(), ['decommissioning', 'planned']);
  assert.equal(importa(vms, census, { 'vm.statusNotActive': 'importAll' }).vms.length, 4);
});

test('la decisione delle VM e\' nel catalogo, col predefinito storico, e si spedisce solo se non e\' il predefinito', () => {
  assert.deepEqual(DECISION_CATALOG['vm.statusNotActive'].options, ['importAll', 'skipNotActive']);
  assert.equal(DECISION_CATALOG['vm.statusNotActive'].def, 'importAll');
  assert.equal(DECISION_CATALOG['vm.statusNotActive'].severity, 'choice', 'una scelta: nell\'ordine di lettura sta fra le perdite e le informazioni');
  assert.deepEqual(sanitizeDecisions({ 'vm.statusNotActive': 'skipNotActive' }), { 'vm.statusNotActive': 'skipNotActive' });
  assert.deepEqual(sanitizeDecisions({ 'vm.statusNotActive': 'importAll' }), {});
  assert.deepEqual(sanitizeDecisions({ 'vm.statusNotActive': 'boh' }), {});
  const rep = importa([VM(40, { status: { value: 'planned' } }), VM(41, { status: { value: 'failed' } }), VM(42, { status: { value: 'planned' } })]).r.report;
  const row = buildDecisions(rep).decisions.find((d) => d.code === 'vm.statusNotActive');
  assert.ok(row, 'e\' una decisione, non una riga informativa');
  assert.equal(row.count, 3);
  assert.deepEqual(row.kinds, ['planned', 'failed']);
  assert.deepEqual(row.sample, ['vm40', 'vm41', 'vm42'], 'i NOMI delle VM, non gli id');
  assert.equal(row.chosen, 'importAll');
});

test('vmLifecycle: solo le quattro parole che dicono «non c\'e\' ancora / non c\'e\' piu\' / non funziona»', () => {
  assert.deepEqual(DS.VM_LIFECYCLES, ['planned', 'staged', 'failed', 'decommissioning']);
  for (const s of DS.VM_LIFECYCLES) assert.ok(DS.STATUSES.includes(s), s + ' sta nel vocabolario degli apparati');
  assert.equal(DS.vmLifecycle('planned'), 'planned');
  assert.equal(DS.vmLifecycle({ value: 'staged' }), 'staged');
  assert.equal(DS.vmLifecycle(' Failed '), 'failed');
  for (const v of ['active', 'offline', '', null, undefined, 'boh', 'inventory', {}, 0]) assert.equal(DS.vmLifecycle(v), '', JSON.stringify(v));
});

// ── la presenza: il silenzio di una VM fuori servizio non e' un guasto ─────────────────────────────────────
const NOW = Date.parse('2026-11-21T12:00:00Z');
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const SEEN = { status: 'proven', lastProvenAt: iso(NOW - HOUR), lastCheckedAt: iso(NOW - HOUR), method: 'tcp' };
const GONE = { status: 'absent', absentEvidence: true, lastProvenAt: null, lastCheckedAt: iso(NOW - HOUR) };
const SILENT = { status: 'unverified', lastProvenAt: null, lastCheckedAt: iso(NOW - HOUR) };

test('presenza: una VM che dichiara di non essere in servizio non e\' contraddetta dal silenzio della rete', () => {
  assert.equal(P.vmStateConflict({ state: 'running', proof: GONE }, NOW), 'goneButRunning', 'senza ciclo di vita: la contraddizione resta');
  for (const status of DS.VM_LIFECYCLES) assert.equal(P.vmStateConflict({ state: 'running', status, proof: GONE }, NOW), null, status);
  assert.equal(P.vmStateConflict({ state: 'stopped', status: 'planned', proof: SEEN }, NOW), 'aliveButStopped',
    'il contrario resta una contraddizione vera: risponde mentre dichiara di non esserci');
});

test('presenza: il racconto dice che il silenzio era atteso, e solo per il silenzio', () => {
  const plain = P.presenceView(SILENT, NOW);
  assert.equal(plain.kind, 'silent'); assert.equal('expected' in plain, false);
  assert.equal(P.presenceView(SILENT, NOW, { status: 'planned' }).expected, 'planned');
  assert.equal(P.presenceView(GONE, NOW, { status: 'decommissioning' }).expected, 'decommissioning');
  assert.equal('expected' in P.presenceView(SEEN, NOW, { status: 'planned' }), false, 'si vede davvero: niente «atteso»');
  assert.equal('expected' in P.presenceView(SILENT, NOW, { status: 'boh' }), false);
  assert.equal(P.presenceView(null, NOW, { status: 'planned' }), null);
});

test('presenza: «segui lo stato osservato» non scrive «spenta» su una VM che dichiara di non esserci', () => {
  assert.equal(P.followedState({}, 'stopped'), 'stopped', 'senza ciclo di vita: come prima');
  assert.equal(P.followedState({ status: 'planned' }, 'stopped'), null);
  assert.equal(P.followedState({ status: 'failed' }, 'running'), null);
});

// ── le schede: VLAN ───────────────────────────────────────────────────────────────────────────────────────
const tagged = (...vids) => vids.map((vid) => ({ vid }));
const vlanOf = (nic) => una(VM(50), { vmInterfaces: [NIC(200, 50, nic)] }).nics[0].vlan;

test('vNIC: in modo tagged entrano le VLAN taggate nella lista tollerante («10,20,30»), la untagged per prima', () => {
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: tagged(30, 10, 20) }), '10,20,30', 'in ordine, anche se NetBox le manda sparse');
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: tagged(40), untagged_vlan: { vid: 1 } }), '1,40', 'la nativa davanti');
  assert.equal(vlanOf({ mode: 'tagged', tagged_vlans: tagged(30, 10), untagged_vlan: { vid: 20 } }), '20,10,30', 'la untagged davanti, poi le taggate in ordine (il modo come testo semplice)');
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: tagged(20, 30, 20), untagged_vlan: { vid: 20 } }), '20,30', 'senza doppioni');
});

test('vNIC: un modo diverso da tagged ignora le taggate; vid fuori da 1..4094 o nulli non entrano mai', () => {
  assert.equal(vlanOf({ mode: { value: 'access' }, tagged_vlans: tagged(10, 20), untagged_vlan: { vid: 5 } }), '5', 'access: solo la untagged');
  assert.equal(vlanOf({ tagged_vlans: tagged(10), untagged_vlan: { vid: 5 } }), '5', 'modo assente: solo la untagged');
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: [{ vid: 0 }, { vid: 4095 }, { vid: null }, { vid: '' }, { vid: 'x' }, null, {}] }), undefined, 'nessuna VLAN inventata');
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: [{ vid: null }, { vid: 7 }, { vid: 4094 }] }), '7,4094');
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: [] }), undefined);
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: null }), undefined);
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: [{ vid: 10.5 }, { vid: '10.5' }, { vid: 7 }] }), '7', 'un VID non e\' un decimale');
  assert.equal(vlanOf({ mode: { value: 'tagged' }, tagged_vlans: tagged(30, 30, 10, 10) }), '10,30', 'senza doppioni anche fra le sole taggate');
});

test('vNIC tagged-all: nessuna lista da scrivere (non c\'e\' niente da inventare), e l\'import dice che al trunk manca qualcosa', () => {
  const r = importa([VM(51)], { vmInterfaces: [NIC(201, 51, { mode: { value: 'tagged-all' }, untagged_vlan: { vid: 10 } }), NIC(202, 51, { mode: { value: 'tagged-all' } })] });
  assert.equal(r.vms[0].nics[0].vlan, '10', 'la nativa dichiarata entra');
  assert.equal('vlan' in r.vms[0].nics[1], false);
  assert.equal(r.issues('vm.taggedAll')[0].n, 2);
  assert.equal(DECISION_CATALOG['vm.taggedAll'].severity, 'loss');
  assert.deepEqual(importa([VM(52)], { vmInterfaces: [NIC(203, 52, { mode: { value: 'tagged' }, tagged_vlans: tagged(10) })] }).issues('vm.taggedAll'), []);
});

test('trunk: le VLAN taggate di una vNIC arrivano all\'uplink dell\'host (e` il consumatore del campo)', () => {
  const r = importa([VM(53)], { vmInterfaces: [NIC(204, 53, { mode: { value: 'tagged' }, tagged_vlans: tagged(30, 10, 20), untagged_vlan: { vid: 5 } })] });
  assert.deepEqual(VT.carriedVlans(r.host), [5, 10, 20, 30]);
});

// ── le schede: il resto ───────────────────────────────────────────────────────────────────────────────────
const srcOf = (nic) => una(VM(60), { vmInterfaces: [NIC(300, 60, nic)] }).nics[0].source;

test('vNIC: abilitata e senza altro NON ha `source` (tacere e\' piu\' onesto di un campo sempre pieno)', () => {
  assert.equal(srcOf({}), undefined);
  assert.equal(srcOf({ enabled: true, mtu: null, vrf: null, description: '', parent: null, bridge: null }), undefined);
});

test('vNIC: disabilitata, MTU, VRF, descrizione, padre e bridge stanno in `source`', () => {
  assert.deepEqual(srcOf({ enabled: false, mtu: 9000, vrf: { name: 'MGMT' }, description: 'Backup', parent: { name: 'bond0' }, bridge: { display: 'br0' } }),
    { enabled: false, mtu: 9000, vrf: 'MGMT', description: 'Backup', parent: 'bond0', bridge: 'br0' });
  assert.deepEqual(srcOf({ mtu: 1500 }), { mtu: 1500 });
  for (const mtu of [0, -1, null, '', 'abc']) assert.equal(srcOf({ mtu }), undefined, 'mtu ' + JSON.stringify(mtu));
  assert.deepEqual(srcOf({ mtu: '1500' }), { mtu: 1500 }, 'un numero come testo diventa un numero');
  assert.deepEqual(srcOf({ vrf: { display: 'Y' } }), { vrf: 'Y' }, 'il nome, o in sua mancanza il nome mostrato');
  assert.equal(srcOf({ enabled: undefined }), undefined, 'un NetBox che non dice se e\' abilitata non la dichiara disabilitata');
});

test('vNIC: MTU e VRF non cambiano la scheda per i motori (`vlan`, `ip`, `mac` restano quelli di prima)', () => {
  const n = una(VM(61), { vmInterfaces: [NIC(301, 61, { mtu: 9000, vrf: { name: 'X' }, mac_address: '00:50:56:AA:00:01', untagged_vlan: { vid: 20 } })] }).nics[0];
  assert.equal(n.vlan, '20'); assert.equal(n.mac, '00:50:56:AA:00:01');
  assert.deepEqual(Object.keys(n).sort(), ['id', 'mac', 'name', 'source', 'vlan']);
});

// ── la VM: provenienza e dischi ───────────────────────────────────────────────────────────────────────────
test('VM: cluster, tenant e dischi stanno in `source`; i dischi uno per uno, in GB, in ordine di nome', () => {
  const v = importa([VM(70, { tenant: { name: 'Cliente A' }, cluster: { name: 'cl-prod' } }), VM(71)], {
    vmDisks: [
      { id: 1, name: 'sdb', size: 51200, virtual_machine: { id: 70 } },
      { id: 2, name: 'sda', size: 20480, virtual_machine: { id: 70 } },
      { id: 3, name: 'vda', size: 1536, virtual_machine: 71 },
    ],
  }).vms;
  assert.deepEqual(v[0].source, { system: 'netbox', status: 'active', tenant: 'Cliente A', cluster: 'cl-prod', disks: [{ name: 'sda', sizeGb: 20 }, { name: 'sdb', sizeGb: 50 }] });
  assert.deepEqual(v[1].source.disks, [{ name: 'vda', sizeGb: 1.5 }], 'il disco di un\'altra VM non si attacca; l\'id puo\' arrivare nudo');
});

test('VM: un disco senza nome ne\' dimensione non entra, uno senza dimensione porta il nome, nessun VM senza dischi ne inventa', () => {
  const v = importa([VM(72), VM(73)], { vmDisks: [{ id: 1, name: '', size: null, virtual_machine: { id: 72 } }, { id: 2, name: 'sda', size: null, virtual_machine: { id: 72 } }, { id: 3, name: 'x', size: 0, virtual_machine: { id: 73 } }] }).vms;
  assert.deepEqual(v[0].source.disks, [{ name: 'sda' }]);
  assert.deepEqual(v[1].source.disks, [{ name: 'x' }], 'dimensione zero: non e\' una dimensione');
  assert.deepEqual(importa([VM(77)], { vmDisks: [{ id: 1, name: '', size: 1024, virtual_machine: { id: 77 } }] }).vms[0].source.disks, [{ sizeGb: 1 }], 'senza nome ma con una dimensione: entra');
  assert.equal('disks' in una(VM(74), { vmDisks: [] }).source, false);
  assert.equal('disks' in una(VM(75), {}).source, false, 'un NetBox senza l\'endpoint dei dischi: nessun campo');
});

test('VM: la somma dei dischi resta `diskGb` (i dischi singoli sono SOLO provenienza, nessun motore li legge)', () => {
  const v = una(VM(76, { disk: 71680 }), { vmDisks: [{ id: 1, name: 'sda', size: 20480, virtual_machine: { id: 76 } }] });
  assert.equal(v.diskGb, 70);
});

// ── cio' che resta fuori, contato ─────────────────────────────────────────────────────────────────────────
test('campi che InfraNet non tiene: una riga per campo, col numero, e aggregata su tutte le VM', () => {
  const r = importa([
    VM(80, { serial: 'ABC', tags: [{ slug: 'a' }, { slug: 'b' }], custom_fields: { x: 1 }, start_on_boot: { value: 'on' }, local_context_data: { k: 1 }, owner: { id: 3 }, config_template: { id: 4 }, virtual_machine_type: { id: 5 } }),
    VM(81, { serial: 'DEF', tags: [{ slug: 'c' }] }),
  ], { vmInterfaces: [NIC(400, 80, { tags: [{ slug: 't' }], custom_fields: { y: 1 }, mac_addresses: [{ mac_address: 'a' }, { mac_address: 'b' }, { mac_address: 'c' }], qinq_svlan: { vid: 9 }, vlan_translation_policy: { id: 1 }, l2vpn_termination: { id: 2 } })] });
  const n = Object.fromEntries(r.issues('vm.fieldsSkipped').map((i) => [i.kind, i.n]));
  assert.deepEqual(n, {
    'vmf.serial': 2, 'vmf.tags': 4, 'vmf.customFields': 2, 'vmf.startOnBoot': 1, 'vmf.localContext': 1, 'vmf.owner': 1,
    'vmf.configTemplate': 1, 'vmf.vmType': 1, 'vmf.extraMacs': 2, 'vmf.qinq': 1, 'vmf.vlanPolicy': 1, 'vmf.l2vpn': 1,
  });
  assert.equal(DECISION_CATALOG['vm.fieldsSkipped'].severity, 'loss');
});

test('campi personalizzati: NetBox manda TUTTI quelli definiti, quasi sempre null — contano solo se c\'e\' un valore', () => {
  const n = (cf, nicCf) => importa([VM(83, { custom_fields: cf })], { vmInterfaces: [NIC(402, 83, { custom_fields: nicCf })] }).issues('vm.fieldsSkipped').map((i) => i.kind + ':' + i.n).join();
  assert.equal(n({ a: null, b: '', c: [] }, { d: null }), '', 'definiti e vuoti: niente da perdere');
  assert.equal(n({ a: null, b: 'x' }, { d: null }), 'vmf.customFields:1');
  assert.equal(n({ a: null }, { d: 0 }), 'vmf.customFields:1', 'zero e\' un valore');
  assert.equal(n({ a: [1] }, { d: false }), 'vmf.customFields:2', 'una lista piena e false sono valori');
});

test('campi che InfraNet non tiene: il modo q-in-q conta anche senza la VLAN di servizio', () => {
  const n = (itf) => importa([VM(84)], { vmInterfaces: [NIC(403, 84, itf)] }).issues('vm.fieldsSkipped').map((i) => i.kind + ':' + i.n).join();
  assert.equal(n({ mode: { value: 'q-in-q' } }), 'vmf.qinq:1');
  assert.equal(n({ qinq_svlan: { vid: 9 } }), 'vmf.qinq:1');
  assert.equal(n({ mode: { value: 'access' } }), '');
});

test('campi che InfraNet non tiene: vuoti, spenti o assenti NON fanno rumore', () => {
  const r = importa([VM(82, { serial: '', tags: [], custom_fields: {}, start_on_boot: { value: 'off' }, local_context_data: null, owner: null })],
    { vmInterfaces: [NIC(401, 82, { tags: [], custom_fields: null, mac_addresses: [{ mac_address: 'a' }] })] });
  assert.deepEqual(r.issues('vm.fieldsSkipped'), []);
  assert.deepEqual(r.issues('vm.taggedAll'), []);
});

// ── le viste di sola lettura ──────────────────────────────────────────────────────────────────────────────
test('vista della VM: le righe sono quelle dichiarate, in ordine, e una VM senza provenienza non ne ha', () => {
  const rows = SRC.vmSourceRows({ source: { system: 'netbox', status: 'planned', tenant: 'ACME', cluster: 'cl1', disks: [{ name: 'sda', sizeGb: 20 }, { sizeGb: 1.5 }] } });
  assert.deepEqual(rows.map((r) => r.key), ['tenant', 'status', 'cluster', 'disks']);
  assert.equal(rows[3].value, 'sda 20 GB · 1.5 GB');
  assert.equal(SRC.vmSourceRows({ source: { disks: [{ name: 'x', sizeGb: 0 }] } })[0].value, 'x', 'dimensione zero: si mostra il nome e basta');
  assert.deepEqual(SRC.vmSourceRows({}), []);
  assert.deepEqual(SRC.vmSourceRows({ source: { system: 'netbox' } }), []);
  assert.deepEqual(SRC.vmSourceRows(null), []);
});

test('vista della scheda: «disabilitata» in testa e solo se falsa; il resto nell\'ordine dichiarato', () => {
  const rows = SRC.nicSourceRows({ source: { enabled: false, mtu: 9000, vrf: 'MGMT', description: 'Backup', parent: 'bond0', bridge: 'br0' } });
  assert.deepEqual(rows.map((r) => r.key), ['enabled', 'description', 'mtu', 'vrf', 'parent', 'bridge']);
  assert.equal(rows[0].valueKey, 'src.disabled');
  assert.deepEqual(SRC.nicSourceRows({ source: { enabled: true } }), []);
  assert.deepEqual(SRC.nicSourceRows({}), []);
});

// ── i testi ───────────────────────────────────────────────────────────────────────────────────────────────
const KEYS = [
  'hv.life.planned', 'hv.life.staged', 'hv.life.failed', 'hv.life.decommissioning', 'hv.vmLifecycle', 'hv.pres.expectedAbsent',
  'src.cluster', 'src.disks', 'src.mtu', 'src.vrf', 'src.parent', 'src.bridge', 'src.enabled', 'src.disabled', 'src.tipVm',
  'dcim.dec.vm.statusNotActive.title', 'dcim.dec.vm.statusNotActive.titleOne', 'dcim.dec.vm.statusNotActive.why', 'dcim.dec.vm.statusNotActive.kinds',
  'dcim.dec.vm.statusNotActive.importAll', 'dcim.dec.vm.statusNotActive.importAllEff', 'dcim.dec.vm.statusNotActive.skipNotActive', 'dcim.dec.vm.statusNotActive.skipNotActiveEff',
  'dcim.cost.vm.statusNotActive.importAll', 'dcim.cost.vm.statusNotActive.importAllOne', 'dcim.cost.vm.statusNotActive.skipNotActive', 'dcim.cost.vm.statusNotActive.skipNotActiveOne',
  'dcim.dec.vm.taggedAll.title', 'dcim.dec.vm.taggedAll.titleOne', 'dcim.dec.vm.taggedAll.why', 'dcim.cost.vm.taggedAll', 'dcim.cost.vm.taggedAllOne',
  'dcim.dec.vm.fieldsSkipped.title', 'dcim.dec.vm.fieldsSkipped.titleOne', 'dcim.dec.vm.fieldsSkipped.why', 'dcim.dec.vm.fieldsSkipped.kinds',
  'dcim.cost.vm.fieldsSkipped', 'dcim.cost.vm.fieldsSkippedOne',
  ...['serial', 'tags', 'customFields', 'startOnBoot', 'localContext', 'owner', 'configTemplate', 'vmType', 'extraMacs', 'qinq', 'vlanPolicy', 'l2vpn'].map((k) => 'dcim.dec.kind.vmf.' + k),
];

test('i testi nuovi esistono in italiano e in inglese, con gli stessi segnaposto', () => {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of KEYS) {
    for (const lang of ['it', 'en']) assert.ok(typeof i18n._i18nDict[lang][k] === 'string' && i18n._i18nDict[lang][k], `${lang}: manca ${k}`);
    assert.equal(ph(i18n._i18nDict.it[k]), ph(i18n._i18nDict.en[k]), 'segnaposto diversi: ' + k);
  }
});

test('ogni parola dell\'import delle VM che finisce a schermo e\' tradotta: nessun campo contato e\' senza testo', () => {
  const r = importa([VM(90, { serial: 'a', tags: [{ slug: 'x' }], custom_fields: { a: 1 } })], { vmInterfaces: [NIC(500, 90, { mode: { value: 'tagged-all' } })] });
  for (const i of r.issues('vm.fieldsSkipped')) assert.ok(i18n._i18nDict.it['dcim.dec.kind.' + i.kind], i.kind);
});

// ── il pannello e il setter, nel DOM finto ────────────────────────────────────────────────────────────────
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function pannello(vm) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'hv1', type:'hypervisor', name:'HV', ports:1, vms:[${JSON.stringify(vm)}] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    _propsExplicit = true; selId = 'hv1'; selType = 'vm'; selVmId = ${JSON.stringify(vm.id)}; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
}
function dopoVm(vm, js) {
  return JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'hv1', type:'hypervisor', name:'HV', ports:1, vms:[${JSON.stringify(vm)}] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    selId = 'hv1'; selType = 'vm'; selVmId = ${JSON.stringify(vm.id)};
    ${js}
    return JSON.stringify(nodeById('hv1').vms[0]);
  })()`));
}

test('pannello VM: il ciclo di vita ha la sua tendina (vuoto = in servizio) e l\'accensione non ci finisce', () => {
  const html = pannello({ id: 'v1', name: 'web', status: 'planned', state: 'running' });
  const sel = (h) => (/<select[^>]*data-vm-field="status"[^>]*>([\s\S]*?)<\/select>/.exec(h) || [])[1];
  assert.ok(sel(html), 'la tendina c\'e\'');
  assert.match(sel(html), /<option value="planned" selected>/);
  assert.deepEqual([...sel(html).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), ['', ...DS.VM_LIFECYCLES], 'vuoto + le quattro parole, e nessuna parola dell\'accensione');
  assert.ok(sel(html).includes(i18n._i18nDict.it['hv.life.planned']));
  const senza = pannello({ id: 'v1', name: 'web' });
  assert.doesNotMatch(sel(senza), /selected/, 'vuoto = in servizio: nessuna voce scelta tranne il vuoto');
});

test('pannello VM: scrivere il ciclo di vita lo salva, vuoto lo toglie, una parola fuori scala NON entra', () => {
  const base = { id: 'v1', name: 'web' };
  assert.equal(dopoVm(base, `updateVm('hv1','v1','status','planned');`).status, 'planned');
  assert.equal(dopoVm(base, `updateVm('hv1','v1','status','planned'); updateVm('hv1','v1','status','');`).status, undefined);
  for (const bad of ['active', 'offline', 'boh', '<b>']) assert.equal(dopoVm(base, `updateVm('hv1','v1','status','planned'); updateVm('hv1','v1','status','${bad}');`).status, 'planned', 'resta com\'era: ' + bad);
  assert.equal(dopoVm({ id: 'v1', name: 'web', state: 'running' }, `updateVm('hv1','v1','status','failed');`).state, 'running', 'il ciclo di vita non tocca l\'accensione');
});

test('pannello VM: la provenienza del DCIM si legge (VM e schede), non si modifica, e il testo del DCIM e\' escapato', () => {
  const vm = {
    id: 'v1', name: 'web', status: 'decommissioning',
    source: { system: 'netbox', status: 'decommissioning', tenant: '<img src=x onerror=alert(1)>', cluster: 'cl1', disks: [{ name: 'sda', sizeGb: 20 }] },
    nics: [{ id: 'nic1', name: 'eth0', vlan: '10', source: { enabled: false, mtu: 9000, vrf: 'MGMT', description: '<b>bk</b>' } }],
  };
  const html = pannello(vm);
  assert.ok(html.includes(i18n._i18nDict.it['src.header']));
  for (const v of ['cl1', 'sda 20 GB', '9000', 'MGMT']) assert.ok(html.includes(v), v);
  assert.ok(!html.includes('<img src=x') && html.includes('&lt;img'), 'escapato (tenant)');
  assert.ok(!html.includes('<b>bk') && html.includes('&lt;b&gt;bk'), 'escapato (descrizione della scheda)');
  assert.doesNotMatch(html, /data-field="(source|tenant|cluster|disks|mtu|vrf)"/, 'non e\' un campo da compilare');
  assert.ok(html.includes(i18n._i18nDict.it['src.disabled']), 'la scheda disabilitata si dice');
  const senza = pannello({ id: 'v1', name: 'web', nics: [{ id: 'nic1', vlan: '10' }] });
  assert.ok(!senza.includes(i18n._i18nDict.it['src.header']), 'niente da dire: niente intestazione');
});

test('pannello VM: modificare una scheda a mano NON ne perde la provenienza', () => {
  const vm = { id: 'v1', name: 'web', nics: [{ id: 'nic1', name: 'eth0', vlan: '10', source: { mtu: 9000 } }] };
  const dopo = dopoVm(vm, `updateVmNic('hv1','v1','nic1','ip','10.0.0.5');`);
  assert.equal(dopo.nics[0].ip, '10.0.0.5');
  assert.deepEqual(dopo.nics[0].source, { mtu: 9000 });
});

test('pannello VM: il silenzio di una VM fuori servizio e\' una riga neutra; per le altre resta l\'avviso, e chi si vede si vede', () => {
  const ora = () => new Date().toISOString();
  const silent = () => ({ status: 'unverified', lastProvenAt: null, lastCheckedAt: ora() });
  const seen = () => ({ status: 'proven', lastProvenAt: ora(), lastCheckedAt: ora(), method: 'tcp' });
  const atteso = i18n._i18nDict.it['hv.pres.expectedAbsent'].replace('{life}', i18n._i18nDict.it['hv.life.planned']);
  const avviso = (h) => /vm-hint-warn/.test(h);
  const piano = pannello({ id: 'v1', name: 'web', status: 'planned', proof: silent() });
  assert.ok(piano.includes(atteso), 'dichiarata «Pianificata»: non vederla e\' atteso');
  assert.ok(!avviso(piano), 'e non e\' un avviso');
  const normale = pannello({ id: 'v1', name: 'web', proof: silent() });
  assert.ok(!normale.includes(atteso.slice(0, 12)), 'senza ciclo di vita: nessun «atteso»');
  assert.ok(avviso(normale), 'il silenzio di una VM in servizio resta un avviso');
  const vista = pannello({ id: 'v1', name: 'web', status: 'planned', proof: seen() });
  assert.ok(!vista.includes(atteso), 'risponde davvero: nessun «atteso»');
  assert.ok(vista.includes('fa-satellite-dish'), 'e si dice che si vede');
});

test('riga della VM nell\'elenco dell\'host: il ciclo di vita si legge accanto al ruolo', () => {
  const html = run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'hv1', type:'hypervisor', name:'HV', ports:1, vms:[{ id:'v1', name:'web', role:'Contabilita', status:'decommissioning' }, { id:'v2', name:'db', role:'Dati' }] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    _propsExplicit = true; selId = 'hv1'; selType = 'node'; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
  assert.ok(html.includes('Contabilita'), 'la riga c\'e\'');
  const riga = (id) => (html.split('<div class="vm-row"').find((c) => c.includes(`data-vm-id="${id}"`)) || '');
  assert.ok(riga('v1').includes(i18n._i18nDict.it['hv.life.decommissioning']), 'la VM dismessa lo dice');
  assert.ok(riga('v2').includes('Dati') && !riga('v2').includes(i18n._i18nDict.it['hv.life.decommissioning']), 'e quella in servizio no');
});

// ── il server legge i dischi, senza portarsi dietro quelli degli altri e senza perdere le schede se l'endpoint manca ──
const integrations = require('../server/routes/integrations');

function clienteFinto({ dischi, dischiFallisce }) {
  const chiamate = [];
  const host = { id: 1, name: 'HV-1', role: { id: 40 }, site: { id: 1, name: 'S' }, cluster: { id: 5 }, device_type: { id: 7 } };
  const vms = [{ id: 10, name: 'vm10', device: { id: 1 }, cluster: { id: 5 }, status: { value: 'active' } }];
  const ris = (results) => ({ results, truncated: false });
  return {
    chiamate,
    async getPaginated(p, query) {
      chiamate.push([p, query]);
      if (p === '/api/dcim/device-roles/') return ris([{ id: 40, slug: 'server', name: 'Server' }]);
      if (p === '/api/dcim/devices/') return ris([host]);
      if (p === '/api/virtualization/virtual-machines/') return ris(query && query.device_id ? vms : []);
      if (p === '/api/virtualization/interfaces/') return ris([{ id: 100, virtual_machine: { id: 10 }, name: 'eth0' }]);
      if (p === '/api/virtualization/virtual-disks/') { if (dischiFallisce) throw new Error('HTTP 404'); return ris(dischi); }
      return ris([]);
    },
    async get() { return { count: 1, results: [] }; },
  };
}
const SOLO_VM = { entities: { racks: false, cabling: false, ipam: false } };

test('server: i dischi si chiedono per id di VM, e quelli di una VM fuori dal perimetro non passano (filtro sconosciuto = tutto il database)', async () => {
  const c = clienteFinto({ dischi: [{ id: 1, name: 'sda', size: 20480, virtual_machine: { id: 10 } }, { id: 2, name: 'altrui', size: 1, virtual_machine: { id: 999 } }, { id: 3, name: 'nudo', size: 1024, virtual_machine: 10 }] });
  const nb = await integrations._pullForImport(c, SOLO_VM);
  assert.deepEqual(nb.vmDisks.map((d) => d.name), ['sda', 'nudo']);
  const q = c.chiamate.find(([p]) => p === '/api/virtualization/virtual-disks/')[1];
  assert.deepEqual(q, { virtual_machine_id: [10] });
  const r = dcim.netboxToState(Object.assign({}, nb, { racks: [] }));
  assert.deepEqual(r.state.nodes.find((n) => n.id === 'nb-dev-1').vms[0].source.disks, [{ name: 'nudo', sizeGb: 1 }, { name: 'sda', sizeGb: 20 }]);
});

test('server: un NetBox senza l\'endpoint dei dischi importa lo stesso VM e schede, solo senza dischi', async () => {
  const nb = await integrations._pullForImport(clienteFinto({ dischiFallisce: true }), SOLO_VM);
  assert.deepEqual(nb.vmDisks, []);
  assert.equal(nb.virtualMachines.length, 1);
  assert.equal(nb.vmInterfaces.length, 1, 'le schede gia\' lette non si perdono');
});
