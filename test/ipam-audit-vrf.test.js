'use strict';
// «IP duplicato» e VRF — lib/ipam-audit.js.
//
// Due apparati con lo STESSO indirizzo in VRF DIVERSE non sono un conflitto: sono due tabelle di routing
// separate, ed è la norma (clienti diversi sulla stessa 10.0.0.0/24). Il controllo dei prefissi lo sapeva già
// (`vrf` fra le sovrapposizioni attese); quello degli indirizzi no, e accusava di «IP duplicato» chi non lo era.
//
// La regola è la stessa dei prefissi, e per lo stesso motivo: si esclude SOLO se entrambe le VRF sono
// DICHIARATE e diverse. Se una manca non lo sappiamo, e il silenzio non si compra con l'ignoranza.
//
// L'import DCIM scrive `ipam.addresses[]` (indirizzo, `vrfId`, `vrfName`, e l'àncora: `portId` o `deviceId`).
// La VRF di un apparato si LEGGE da lì, per valore: se l'utente corregge l'indirizzo a mano, il record non
// combacia più e la VRF smette di valere (declare-first), invece di restare attaccata a un indirizzo che non c'è.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildIpamAudit, findDuplicateIps, findSharedHaIps, findDuplicateIpsAcrossVrf, attachVrfs } = require('../lib/ipam-audit.js');

const V1 = { id: 1, name: 'CLIENTE-A' };
const V2 = { id: 2, name: 'CLIENTE-B' };

// ── il caso che accusava a torto, dal percorso intero (buildIpamAudit) ──────────────────────────────────
test('buildIpamAudit: lo stesso IP in due VRF dichiarate e diverse NON è un duplicato, e si dice a parte', () => {
  const audit = buildIpamAudit({
    nodes: [
      { id: 'nb-dev-1', name: 'FW-A', ip: '172.16.0.1', deviceRef: '1' },
      { id: 'nb-dev-2', name: 'FW-B', ip: '172.16.0.1', deviceRef: '2' },
    ],
    addresses: [
      { address: '172.16.0.1/24', deviceId: '1', vrfId: 1, vrfName: 'CLIENTE-A' },
      { address: '172.16.0.1/24', deviceId: '2', vrfId: 2, vrfName: 'CLIENTE-B' },
    ],
    prefixes: [],
  });
  assert.deepEqual(audit.duplicateIps, [], 'due VRF diverse: nessun duplicato');
  assert.equal(audit.duplicateIpsAcrossVrf.length, 1, 'non sparisce: «ce n\'erano e li ho giudicati normali»');
  assert.equal(audit.duplicateIpsAcrossVrf[0].ip, '172.16.0.1');
  assert.deepEqual(audit.duplicateIpsAcrossVrf[0].vrfs.map(v => v.name).sort(), ['CLIENTE-A', 'CLIENTE-B']);
});

test('buildIpamAudit: lo stesso IP nella STESSA VRF resta un duplicato', () => {
  const audit = buildIpamAudit({
    nodes: [
      { id: 'a', name: 'A', ip: '10.0.0.5', deviceRef: '1' },
      { id: 'b', name: 'B', ip: '10.0.0.5', deviceRef: '2' },
    ],
    addresses: [
      { address: '10.0.0.5/24', deviceId: '1', vrfId: 7 },
      { address: '10.0.0.5/24', deviceId: '2', vrfId: 7 },
    ],
    prefixes: [],
  });
  assert.equal(audit.duplicateIps.length, 1);
  assert.deepEqual(audit.duplicateIpsAcrossVrf, []);
});

test('buildIpamAudit: senza `addresses` (progetto non importato da un DCIM) il comportamento è quello di sempre', () => {
  const audit = buildIpamAudit({
    nodes: [{ id: 'a', name: 'A', ip: '10.0.0.5' }, { id: 'b', name: 'B', ip: '10.0.0.5' }],
    prefixes: [],
  });
  assert.equal(audit.duplicateIps.length, 1);
  assert.deepEqual(audit.duplicateIpsAcrossVrf, []);
});

// ── la regola, sulle VRF già attaccate ────────────────────────────────────────────────────────────────
const N = (id, ip, vrf) => ({ id, name: id.toUpperCase(), ip, ipVrf: vrf || null });

test('una VRF dichiarata e una no: NON si sa, quindi resta un duplicato (come per i prefissi)', () => {
  const dups = findDuplicateIps([N('a', '10.1.1.1', V1), N('b', '10.1.1.1', null)]);
  assert.equal(dups.length, 1);
  assert.deepEqual(findDuplicateIpsAcrossVrf([N('a', '10.1.1.1', V1), N('b', '10.1.1.1', null)]), []);
});

test('nessuna VRF su nessuno: duplicato (il caso di tutti i progetti scritti a mano)', () => {
  assert.equal(findDuplicateIps([N('a', '10.1.1.1'), N('b', '10.1.1.1')]).length, 1);
});

test('tre apparati, due nella stessa VRF e uno in un\'altra: il duplicato sono SOLO i due, e il terzo non è accusato', () => {
  const nodes = [N('a', '10.2.2.2', V1), N('b', '10.2.2.2', V1), N('c', '10.2.2.2', V2)];
  const dups = findDuplicateIps(nodes);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].nodes.map(n => n.id).sort(), ['a', 'b'], 'c vive in un\'altra tabella di routing');
  const across = findDuplicateIpsAcrossVrf(nodes);
  assert.equal(across.length, 1, 'e l\'indirizzo che vive in due VRF si dice');
  assert.deepEqual(across[0].vrfs.map(v => v.id).sort(), [1, 2]);
});

test('uno ignoto accanto a due VRF diverse: l\'ignoto è in conflitto con entrambi, quindi tutti e tre restano nominati', () => {
  const dups = findDuplicateIps([N('a', '10.3.3.3', V1), N('b', '10.3.3.3', V2), N('c', '10.3.3.3', null)]);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].nodes.map(n => n.id).sort(), ['a', 'b', 'c']);
});

test('la forma dei duplicati non cambia: { ip, nodes:[{id,name}] }', () => {
  const [d] = findDuplicateIps([N('a', '10.4.4.4', V1), N('b', '10.4.4.4', V1)]);
  assert.deepEqual(Object.keys(d).sort(), ['ip', 'nodes']);
  assert.deepEqual(Object.keys(d.nodes[0]).sort(), ['id', 'name']);
});

test('il gruppo HA dichiarato che condivide un indirizzo nella STESSA VRF resta «condiviso», non un duplicato', () => {
  const ha = (id, peer) => ({ id, name: id, ip: '10.5.5.5', ipVrf: V1, haPeer: peer });
  const nodes = [ha('fw-a', 'fw-b'), ha('fw-b', 'fw-a')];
  assert.deepEqual(findDuplicateIps(nodes), []);
  assert.equal(findSharedHaIps(nodes).length, 1);
});

test('IPv6: la VRF dell\'indirizzo v6 è quella di `ip6Vrf`, non di `ipVrf`', () => {
  const a = { id: 'a', name: 'A', ip: '10.6.6.1', ipVrf: V1, ip6: '2001:db8::7', ip6Vrf: V1 };
  const b = { id: 'b', name: 'B', ip: '10.6.6.2', ipVrf: V1, ip6: '2001:db8::7', ip6Vrf: V2 };
  assert.deepEqual(findDuplicateIps([a, b]), [], 'lo stesso v6 in due VRF diverse');
  assert.equal(findDuplicateIpsAcrossVrf([a, b]).length, 1);
});

// ── come la VRF di un apparato si legge da ipam.addresses[] ───────────────────────────────────────────
const vrfOf = (nodes, addresses, i, campo) => attachVrfs(nodes, addresses)[i][campo || 'ipVrf'];

test('attachVrfs: l\'àncora è il DEVICE: lo stesso indirizzo in due VRF si assegna a chi lo tiene', () => {
  const addresses = [
    { address: '172.16.0.1/24', deviceId: '1', vrfId: 1, vrfName: 'CLIENTE-A' },
    { address: '172.16.0.1/24', deviceId: '2', vrfId: 2, vrfName: 'CLIENTE-B' },
  ];
  const nodes = [{ id: 'a', ip: '172.16.0.1', deviceRef: '1' }, { id: 'b', ip: '172.16.0.1', deviceRef: 2 }];
  assert.deepEqual(vrfOf(nodes, addresses, 0), { id: 1, name: 'CLIENTE-A' });
  assert.deepEqual(vrfOf(nodes, addresses, 1), { id: 2, name: 'CLIENTE-B' }, 'numero e stringa sono lo stesso id');
});

test('attachVrfs: un indirizzo d\'interfaccia si àncora alla PORTA (portId), anche per un nodo senza deviceRef', () => {
  const addresses = [{ address: '10.9.0.1/24', portId: 'sw1-5', vrfId: 9 }];
  const nodes = [{ id: 'sw1', ip: '10.9.0.1', portId: 'sw1-5' }];
  assert.deepEqual(vrfOf(nodes, addresses, 0), { id: 9, name: '' });
});

test('attachVrfs: una VRF di un ALTRO device non si attacca a me (indirizzo uguale, àncora diversa)', () => {
  const addresses = [{ address: '10.9.0.1/24', deviceId: '1', vrfId: 9 }];
  assert.equal(vrfOf([{ id: 'x', ip: '10.9.0.1', deviceRef: '5' }], addresses, 0), null, 'ignota, non quella del vicino');
});

test('attachVrfs: un apparato scritto a mano (nessuna àncora) con indirizzo ambiguo fra due VRF resta ignoto', () => {
  const addresses = [
    { address: '10.9.0.1/24', vrfId: 1 }, { address: '10.9.0.1/24', vrfId: 2 },
  ];
  assert.equal(vrfOf([{ id: 'vm', ip: '10.9.0.1' }], addresses, 0), null);
});

test('attachVrfs: un VM (nessuna àncora) con un indirizzo che in tutto l\'IPAM sta in UNA sola VRF prende quella', () => {
  const addresses = [{ address: '10.9.0.9/24', vrfId: 4, vrfName: 'DMZ' }];
  assert.deepEqual(vrfOf([{ id: 'vm:h:v:n', ip: '10.9.0.9' }], addresses, 0), { id: 4, name: 'DMZ' });
});

test('attachVrfs: un record SENZA VRF (tabella globale) o con una VRF che non concorda non dà una VRF', () => {
  assert.equal(vrfOf([{ id: 'a', ip: '10.9.0.2', deviceRef: '1' }], [{ address: '10.9.0.2/24', deviceId: '1' }], 0), null);
  assert.equal(vrfOf([{ id: 'a', ip: '10.9.0.2', deviceRef: '1' }],
    [{ address: '10.9.0.2/24', deviceId: '1', vrfId: 1 }, { address: '10.9.0.2/24', deviceId: '1' }], 0), null);
});

test('attachVrfs: se l\'indirizzo del nodo è stato CAMBIATO a mano, il record DCIM non combacia e la VRF non vale più', () => {
  const addresses = [{ address: '10.9.0.1/24', deviceId: '1', vrfId: 1 }];
  assert.equal(vrfOf([{ id: 'a', ip: '10.9.0.77', deviceRef: '1' }], addresses, 0), null);
});

test('attachVrfs: IPv4 e IPv6 si guardano per CHIAVE di indirizzo, non per stringa (zeri iniziali, maiuscole)', () => {
  const addresses = [{ address: '2001:DB8:0:0:0:0:0:7/64', deviceId: '1', vrfId: 3 }];
  assert.deepEqual(vrfOf([{ id: 'a', ip6: '2001:db8::7', deviceRef: '1' }], addresses, 0, 'ip6Vrf'), { id: 3, name: '' });
});

test('attachVrfs: non modifica l\'input e tollera elenchi assenti', () => {
  const nodes = [{ id: 'a', ip: '10.9.0.1', deviceRef: '1' }];
  const copia = JSON.parse(JSON.stringify(nodes));
  attachVrfs(nodes, [{ address: '10.9.0.1/24', deviceId: '1', vrfId: 1 }]);
  assert.deepEqual(nodes, copia);
  assert.deepEqual(attachVrfs(undefined, undefined), []);
  assert.deepEqual(attachVrfs(nodes, null).map(n => n.ipVrf), [null]);
});

test('lo stesso id di VRF scritto come numero e come stringa è la STESSA VRF: due apparati restano un duplicato', () => {
  // Un id arriva dal JSON di NetBox (numero) o da un campo scritto a mano (stringa): `1` e `'1'` sono una tabella sola.
  const dups = findDuplicateIps([N('a', '10.7.7.7', { id: 1, name: '' }), N('b', '10.7.7.7', { id: '1', name: '' })]);
  assert.equal(dups.length, 1);
  assert.deepEqual(findDuplicateIpsAcrossVrf([N('a', '10.7.7.7', { id: 1, name: '' }), N('b', '10.7.7.7', { id: '1', name: '' })]), []);
});
