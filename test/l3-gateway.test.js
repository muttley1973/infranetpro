'use strict';
// Test del report L3-lite gateway (lib/l3-gateway.js): risoluzione rete→device
// (bound/auto/orphan/none), warning, vista per-VLAN e aggregazione device L3.
//
// UNA RIGA PER PREFISSO. Fino alla 2.8.x il report ciclava le VLAN e ne leggeva il
// prefisso PRINCIPALE (il primo IPv4): il secondo prefisso di una VLAN dual-stack
// e le reti senza VLAN non arrivavano mai al report — cioè NESSUN gateway IPv6
// veniva verificato. Da qui in giù l'input è `prefixes[]`, l'autorità.
const test = require('node:test');
const assert = require('node:assert');
const { buildL3Report, findNodeByIp } = require('../lib/l3-gateway.js');
// Parser CIDR REALE: senza IPv6 vero questi test non proverebbero niente.
const { _parseCidrInfo, _ipInCidr } = require('../lib/cidr.js');
const { compareCidr } = require('../lib/ipam-audit.js');

const NODES = [
  { id: 'core', name: 'Core-SW', ip: '192.168.10.1', type: 'switch' },
  { id: 'fw', name: 'FW01', ip: '192.168.20.1', ip6: '2001:db8:0:20::1', type: 'firewall' },
  { id: 'edge', name: 'Edge', ip: '10.0.0.1', type: 'router' },
];

const VLANS = [{ vid: 10, name: 'Server', color: '#f00' }, { vid: 20, name: 'User', color: '#0f0' }];

function run(prefixes, opts) {
  opts = opts || {};
  return buildL3Report({
    prefixes,
    vlans: opts.vlans || VLANS,
    ipamByVid: opts.ipamByVid || {},
    nodes: opts.nodes || NODES,
    usageByCidr: opts.usageByCidr,
    parseCidr: _parseCidrInfo, ipInCidr: _ipInCidr, compareCidr,
  });
}
const netRow = (r, cidr) => r.rows.find(x => x.cidr === cidr);

// ── Risoluzione del device ──────────────────────────────────────────────────
test('auto: gateway IP combacia con un device → status auto + device agganciato', () => {
  const row = netRow(run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.1' }]), '192.168.10.0/24');
  assert.equal(row.status, 'auto');
  assert.equal(row.nodeId, 'core');
  assert.equal(row.nodeName, 'Core-SW');
  assert.deepEqual(row.warnings, []);
});

test('bound: gatewayNodeId esplicito vince anche senza match IP', () => {
  const r = run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.254' }],
    { ipamByVid: { 10: { gatewayNodeId: 'core' } } });
  const row = netRow(r, '192.168.10.0/24');
  assert.equal(row.status, 'bound');
  assert.equal(row.nodeId, 'core');
  assert.ok(!row.warnings.includes('gatewayOutOfSubnet'), '.254 è dentro la /24');
});

test('orphan: gateway IP scritto ma nessun device → orphanGateway', () => {
  const row = netRow(run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.99' }]), '192.168.10.0/24');
  assert.equal(row.status, 'orphan');
  assert.equal(row.nodeId, null);
  assert.ok(row.warnings.includes('orphanGateway'));
});

test('none + noGateway: rete senza gateway', () => {
  const row = netRow(run([{ cidr: '192.168.10.0/24', vlan: 10 }]), '192.168.10.0/24');
  assert.equal(row.status, 'none');
  assert.ok(row.warnings.includes('noGateway'));
});

test('staleBinding: gatewayNodeId punta a device cancellato', () => {
  const r = run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.1' }],
    { ipamByVid: { 10: { gatewayNodeId: 'ghost' } } });
  const row = netRow(r, '192.168.10.0/24');
  assert.equal(row.status, 'orphan');
  assert.ok(row.warnings.includes('staleBinding'));
  assert.equal(row.nodeId, null, 'un binding stantio non si rimpiazza in silenzio con l\'auto-match');
});

test('gatewayOutOfSubnet: IP fuori dalla rete dichiarata', () => {
  const row = netRow(run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.99.1' }]), '192.168.10.0/24');
  assert.ok(row.warnings.includes('gatewayOutOfSubnet'));
});

test('invalidCidr: rete malformata segnala invalidCidr e resta in elenco', () => {
  const row = netRow(run([{ cidr: 'non-valido', vlan: 10, gateway: '192.168.10.1' }]), 'non-valido');
  assert.equal(row.cidrValid, false);
  assert.ok(row.warnings.includes('invalidCidr'));
});

// ── IPv6: il cuore di questa suite ──────────────────────────────────────────
test('dual-stack: una VLAN con due prefissi produce DUE righe, non una', () => {
  const r = run([
    { cidr: '192.168.20.0/24', vlan: 20, gateway: '192.168.20.1' },
    { cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:20::1' },
  ]);
  const v4 = netRow(r, '192.168.20.0/24'), v6 = netRow(r, '2001:db8:0:20::/64');
  assert.ok(v4 && v6, 'entrambi i prefissi sono in elenco');
  assert.equal(v4.family, 4);
  assert.equal(v6.family, 6);
  assert.equal(r.totals.nets, 2);
});

test('il gateway IPv6 aggancia il device tramite node.ip6', () => {
  const row = netRow(run([{ cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:20::1' }]), '2001:db8:0:20::/64');
  assert.equal(row.status, 'auto');
  assert.equal(row.nodeId, 'fw', 'FW01 dichiara quell\'IPv6: non è un gateway orfano');
  assert.deepEqual(row.warnings, []);
});

test('IPv6 scritto in un\'altra forma è lo STESSO indirizzo (canonico, non testuale)', () => {
  // Stesso indirizzo del device, ma esteso e maiuscolo: il confronto fra stringhe
  // lo mancava, e il router risultava «nessuno risponde a questo indirizzo».
  const row = netRow(run([{ cidr: '2001:DB8:0:20::/64', vlan: 20, gateway: '2001:DB8:0:20:0:0:0:1' }]), '2001:DB8:0:20::/64');
  assert.equal(row.nodeId, 'fw');
  assert.equal(row.status, 'auto');
});

test('findNodeByIp risponde per entrambe le famiglie e in forma canonica', () => {
  assert.equal(findNodeByIp(NODES, '192.168.20.1').id, 'fw');
  assert.equal(findNodeByIp(NODES, '2001:db8:0:20::1').id, 'fw');
  assert.equal(findNodeByIp(NODES, '2001:DB8:0:20:0:0:0:1').id, 'fw');
  assert.equal(findNodeByIp(NODES, '2001:db8:0:99::1'), null, 'nessun aggancio inventato');
  assert.equal(findNodeByIp(NODES, ''), null);
});

test('gatewayOutOfSubnet vale anche in IPv6', () => {
  const row = netRow(run([{ cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:99::1' }]), '2001:db8:0:20::/64');
  assert.ok(row.warnings.includes('gatewayOutOfSubnet'));
  assert.ok(!row.warnings.includes('gatewayFamilyMismatch'), 'stessa famiglia: è un errore di indirizzo, non di specie');
});

test('gatewayFamilyMismatch: un IPv4 non instrada un prefisso IPv6', () => {
  const row = netRow(run([{ cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '192.168.20.1' }]), '2001:db8:0:20::/64');
  assert.ok(row.warnings.includes('gatewayFamilyMismatch'));
  assert.ok(!row.warnings.includes('gatewayOutOfSubnet'),
    'famiglia sbagliata ≠ fuori subnet: si correggono in due modi diversi');
  assert.equal(run([{ cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '192.168.20.1' }]).totals.familyMismatch, 1);
});

test('gatewayFamilyMismatch: e nemmeno un IPv6 instrada una /24', () => {
  const row = netRow(run([{ cidr: '192.168.20.0/24', vlan: 20, gateway: '2001:db8:0:20::1' }]), '192.168.20.0/24');
  assert.ok(row.warnings.includes('gatewayFamilyMismatch'));
});

// ── Reti senza VLAN e VLAN senza rete ───────────────────────────────────────
test('una rete senza VLAN è nel report, con vid null (non «VLAN 0»)', () => {
  const r = run([{ cidr: '10.0.0.0/24', vlan: null, gateway: '10.0.0.1' }]);
  const row = netRow(r, '10.0.0.0/24');
  assert.strictEqual(row.vid, null, '+null === 0: senza il controllo diventerebbe «VLAN 0»');
  assert.equal(row.status, 'auto', 'si risolve come tutte le altre: la VLAN è facoltativa, il gateway no');
  assert.equal(row.nodeId, 'edge');
  assert.equal(r.totals.nets, 1);
});

test('una VLAN senza reti resta in elenco, dichiarata come tale', () => {
  const r = run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.1' }]);
  const bare = r.rows.find(x => x.vid === 20);
  assert.ok(bare, 'la VLAN 20 non sparisce dal report');
  assert.equal(bare.cidr, '');
  assert.equal(bare.status, 'none');
  assert.deepEqual(bare.warnings, [], 'non manca il gateway: manca la rete');
  assert.equal(r.totals.nets, 1, 'una VLAN nuda non conta come rete');
  assert.equal(r.totals.noGateway, 0);
});

// ── Vista per-VLAN derivata ─────────────────────────────────────────────────
test('byVlan: una VLAN dual-stack ha UNA risposta, la migliore delle sue reti', () => {
  const r = run([
    { cidr: '192.168.20.0/24', vlan: 20, gateway: '192.168.20.50' },   // nessun device
    { cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:20::1' },  // → fw
  ]);
  const v = r.byVlan['20'];
  assert.equal(v.status, 'auto', 'un solo aggancio basta a dire chi la instrada');
  assert.equal(v.nodeId, 'fw');
  assert.equal(v.gateway, '2001:db8:0:20::1', 'cita l\'indirizzo che HA prodotto l\'aggancio');
  assert.deepEqual(v.nets.slice().sort(), ['192.168.20.0/24', '2001:db8:0:20::/64']);
  assert.ok(v.warnings.includes('orphanGateway'), 'i problemi delle singole reti non si perdono');
});

test('byVlan: il binding esplicito vale per TUTTI i prefissi della VLAN', () => {
  const r = run([
    { cidr: '192.168.20.0/24', vlan: 20, gateway: '192.168.20.1' },
    { cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:20::1' },
  ], { ipamByVid: { 20: { gatewayNodeId: 'core' } } });
  assert.equal(r.byVlan['20'].status, 'bound');
  assert.equal(netRow(r, '192.168.20.0/24').nodeId, 'core');
  assert.equal(netRow(r, '2001:db8:0:20::/64').nodeId, 'core',
    'l\'interfaccia SVI è una sola anche quando porta due indirizzi');
});

test('byVlan non contiene le reti senza VLAN', () => {
  const r = run([{ cidr: '10.0.0.0/24', vlan: null, gateway: '10.0.0.1' }], { vlans: [] });
  assert.deepEqual(Object.keys(r.byVlan), []);
});

// ── Aggregazione device + totali ────────────────────────────────────────────
test('aggregazione: un device L3 raccoglie tutte le RETI che instrada', () => {
  const r = run([
    { cidr: '192.168.20.0/24', vlan: 20, gateway: '192.168.20.1' },
    { cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:20::1' },
  ]);
  assert.equal(r.totals.l3Devices, 1);
  const fw = r.l3Devices.find(d => d.id === 'fw');
  assert.equal(fw.nets.length, 2, 'due reti, non una VLAN');
  assert.deepEqual(r.l3NodeIds, ['fw']);
  assert.equal(r.totals.withGateway, 2);
});

test('totals: conta orphan/noGateway/outOfSubnet sulle RETI', () => {
  const r = run([
    { cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.1' },   // ok
    { cidr: '192.168.20.0/24', vlan: 20 },                            // noGateway
  ]);
  assert.equal(r.totals.nets, 2);
  assert.equal(r.totals.vlans, 2);
  assert.equal(r.totals.withGateway, 1);
  assert.equal(r.totals.noGateway, 1);
});

test('usageByCidr passa attraverso come usedCount, per prefisso', () => {
  const r = run([
    { cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.1' },
    { cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:20::1' },
  ], { usageByCidr: { '192.168.10.0/24': 7, '2001:db8:0:20::/64': 3 } });
  assert.equal(netRow(r, '192.168.10.0/24').usedCount, 7);
  assert.equal(netRow(r, '2001:db8:0:20::/64').usedCount, 3, 'anche una rete v6 ha indirizzi occupati');
  assert.equal(run([{ cidr: '192.168.10.0/24', vlan: 10 }]).rows[0].usedCount, 0, 'senza usage → 0');
});

// ── Ordine ──────────────────────────────────────────────────────────────────
test('ordine: spazio degli indirizzi (v4, poi v6), e le VLAN nude in coda', () => {
  const r = run([
    { cidr: '2001:db8:0:20::/64', vlan: 20 },
    { cidr: '192.168.20.0/24', vlan: 20 },
    { cidr: '10.0.0.0/8', vlan: null },
  ], { vlans: [{ vid: 30, name: 'Vuota' }] });
  assert.deepEqual(r.rows.map(x => x.cidr),
    ['10.0.0.0/8', '192.168.20.0/24', '2001:db8:0:20::/64', '']);
});

// ── S2.3 (audit 2026-07-20): gateway = network/broadcast address ────────────
test('gatewayReserved: gateway = network address (.0 su /24) → warning', () => {
  const row = netRow(run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.0' }]), '192.168.10.0/24');
  assert.ok(row.warnings.includes('gatewayReserved'), '.0 non è un host valido');
  assert.ok(!row.warnings.includes('gatewayOutOfSubnet'), 'è comunque dentro la subnet');
});

test('gatewayReserved: gateway = broadcast address (.255 su /24) → warning', () => {
  const row = netRow(run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.255' }]), '192.168.10.0/24');
  assert.ok(row.warnings.includes('gatewayReserved'), '.255 non è un host valido');
});

test('gatewayReserved: /31 (RFC 3021) — gli estremi SONO host validi, nessun warning', () => {
  const row = netRow(run([{ cidr: '10.0.0.0/31', vlan: 10, gateway: '10.0.0.0' }]), '10.0.0.0/31');
  assert.ok(!row.warnings.includes('gatewayReserved'), 'su /31 network address = host valido');
});

test('gatewayReserved: gateway normale (.1) → nessun warning', () => {
  const row = netRow(run([{ cidr: '192.168.10.0/24', vlan: 10, gateway: '192.168.10.1' }]), '192.168.10.0/24');
  assert.ok(!row.warnings.includes('gatewayReserved'));
});

test('gatewayReserved NON scatta in IPv6: su 128 bit non esiste un broadcast', () => {
  // L'indirizzo tutto-zeri di una /64 è il subnet-router anycast (RFC 4291), non
  // un indirizzo riservato inutilizzabile: dichiararlo «non un host valido»
  // sarebbe un'invenzione. Prima il caso era escluso per coincidenza aritmetica.
  const row = netRow(run([{ cidr: '2001:db8:0:20::/64', vlan: 20, gateway: '2001:db8:0:20::' }]), '2001:db8:0:20::/64');
  assert.ok(!row.warnings.includes('gatewayReserved'));
  const wide = netRow(run([{ cidr: '2001:db8::/28', vlan: 20, gateway: '2001:db8::' }]), '2001:db8::/28');
  assert.ok(!wide.warnings.includes('gatewayReserved'), 'nemmeno con un prefisso corto (<=30)');
});
