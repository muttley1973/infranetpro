'use strict';
// Estrazione PURA delle /24 del progetto (lib/project-networks.js): dai device
// documentati + lease DHCP deriva le reti da contattare e le classifica per il
// workflow (covered/blocked/open). Zero rete, zero DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveProjectNetworks, annotateNetworksVerification } = require('../lib/project-networks.js');

const node = (id, ip, extra = {}) => ({ id, ip, ...extra });

test('deriva le /24 dai device e le ordina per numero di device', () => {
  const nodes = [
    node('a', '192.168.1.10'), node('b', '192.168.1.11'), node('c', '192.168.1.12'),
    node('d', '10.10.99.1'),
  ];
  const { networks } = deriveProjectNetworks({ nodes });
  assert.equal(networks.length, 2);
  assert.equal(networks[0].net, '192.168.1', 'la rete con più device viene prima');
  assert.equal(networks[0].cidr, '192.168.1.0/24');
  assert.equal(networks[0].deviceCount, 3);
  assert.equal(networks[1].net, '10.10.99');
});

test('classifica COVERED: switch SNMP raggiungibile → topologia ricostruibile', () => {
  const nodes = [
    node('sw', '10.10.99.1', { type: 'switch', snmpStatus: 'ok', integration: { driver: 'snmp-v2c', host: '10.10.99.1' } }),
    node('pc', '10.10.99.50'),
  ];
  const { networks } = deriveProjectNetworks({ nodes });
  assert.equal(networks[0].status, 'covered');
  assert.equal(networks[0].reachableSwitch, true);
  assert.equal(networks[0].snmpReachable, 1);
});

test('classifica BLOCKED: switch SNMP presente ma NON raggiungibile (es. creds v3) → azione utente', () => {
  const nodes = [
    node('sw', '192.168.1.100', { type: 'switch', snmpStatus: 'err', integration: { driver: 'snmp-v3', host: '192.168.1.100' } }),
    node('rt', '192.168.1.200', { type: 'router', snmpStatus: 'ok', integration: { driver: 'snmp-v2c', host: '192.168.1.200' } }),
    node('pc', '192.168.1.10'),
  ];
  const { networks } = deriveProjectNetworks({ nodes });
  const n = networks[0];
  assert.equal(n.status, 'blocked', 'lo switch c\'è ma non risponde: un router raggiungibile non basta per la topologia L2');
  assert.equal(n.blockedSwitch, true);
  assert.equal(n.reachableSwitch, false);
  assert.equal(n.snmpReachable, 1, 'il router risponde');
  assert.equal(n.snmpUnreachable, 1, 'lo switch no');
});

test('classifica OPEN: nessuno switch SNMP → serve scan / verifica presenza', () => {
  const nodes = [
    node('rt', '10.10.30.1', { type: 'router', snmpStatus: 'ok', integration: { driver: 'snmp-v2c', host: '10.10.30.1' } }),
    node('pc', '10.10.30.10'),
  ];
  const { networks } = deriveProjectNetworks({ nodes });
  assert.equal(networks[0].status, 'open', 'router SNMP raggiungibile ma nessuno switch → topologia L2 non ricostruibile da solo');
});

test('i lease DHCP contribuiscono IP e possono INTRODURRE una rete non documentata', () => {
  const nodes = [node('pc', '192.168.1.10')];
  const leases = [
    { mac: 'aa:bb:cc:00:00:01', ip: '192.168.1.55' },   // stessa rete di un device
    { mac: 'aa:bb:cc:00:00:02', ip: '192.168.7.20' },   // rete NUOVA, solo da lease
  ];
  const { networks } = deriveProjectNetworks({ nodes, leases });
  const nets = networks.map(n => n.net).sort();
  assert.deepEqual(nets, ['192.168.1', '192.168.7']);
  const lan7 = networks.find(n => n.net === '192.168.7');
  assert.equal(lan7.deviceCount, 0);
  assert.equal(lan7.leaseCount, 1, 'la rete 192.168.7 emerge SOLO dai lease');
  assert.equal(lan7.status, 'open');
});

test('preferisce integration.host all\'ip, ignora IP non validi, non lancia su input vuoto', () => {
  const nodes = [
    node('a', '10.0.0.5', { integration: { host: '172.16.4.9' } }),   // host vince
    node('b', 'non-un-ip'),
    node('c', ''),
    node('d', '999.1.1.1'),   // ottetto fuori range → scartato
  ];
  const { networks } = deriveProjectNetworks({ nodes });
  assert.deepEqual(networks.map(n => n.net), ['172.16.4']);
  assert.deepEqual(deriveProjectNetworks(), { networks: [] });
  assert.deepEqual(deriveProjectNetworks({}), { networks: [] });
});

test('snmpSources riporta tipo/driver/raggiungibilità di ogni sorgente SNMP della rete', () => {
  const nodes = [
    node('sw', '10.10.99.1', { type: 'switch', snmpStatus: 'ok', integration: { driver: 'snmp-v2c', host: '10.10.99.1' } }),
    node('pc', '10.10.99.9'),   // non-SNMP → non entra tra le sorgenti
  ];
  const { networks } = deriveProjectNetworks({ nodes });
  assert.equal(networks[0].snmpSources.length, 1);
  assert.deepEqual(networks[0].snmpSources[0], { id: 'sw', ip: '10.10.99.1', type: 'switch', driver: 'snmp-v2c', reachable: true });
});

// ── annotateNetworksVerification: accorpa "Non verificabili" dentro "Reti del progetto" ──
const sampleNets = () => deriveProjectNetworks({ nodes: [
  node('sw', '192.168.1.1', { type: 'switch', snmpStatus: 'ok', integration: { driver: 'snmp-v2c', host: '192.168.1.1' } }),
  node('pc', '192.168.1.10'),
  node('cam', '10.0.5.20'),   // subnet off-segment (non raggiunta)
] }).networks;

test('annotate: senza sweep -> observed=null, nessun device annidato', () => {
  const { networks, orphanUnverified } = annotateNetworksVerification(sampleNets(), { sweepRan: false });
  assert.ok(networks.every(n => n.observed === null), 'presenza non ancora verificata');
  assert.ok(networks.every(n => n.unverifiedCount === 0));
  assert.deepEqual(orphanUnverified, []);
});

test('annotate: post-sweep -> osservata=verde, cieca=grigia + device non verificabili annidati sotto la /24', () => {
  const verification = {
    sweepRan: true,
    observedSubnets: ['192.168.1'],                                   // solo la LAN locale è stata vista
    unverified: [{ key: 'unver:aa', mac: 'AA', label: 'Cam', ip: '10.0.5.20' }],
  };
  const { networks, orphanUnverified } = annotateNetworksVerification(sampleNets(), verification);
  const lan = networks.find(n => n.net === '192.168.1');
  const off = networks.find(n => n.net === '10.0.5');
  assert.equal(lan.observed, true, 'la LAN locale è stata osservata');
  assert.equal(lan.unverifiedCount, 0, 'niente non-verificati sulla rete osservata');
  assert.equal(off.observed, false, 'la subnet off-segment è cieca');
  assert.equal(off.unverifiedCount, 1, 'la cam non verificabile è annidata sotto la SUA /24');
  assert.equal(off.unverifiedDevices[0].mac, 'AA');
  assert.deepEqual(orphanUnverified, [], 'nessun orfano: ogni non-verificabile ha la sua riga rete');
});

test('annotate: anti-perdita — un non-verificabile su /24 senza riga rete finisce negli orfani (mai perso)', () => {
  const verification = {
    sweepRan: true, observedSubnets: ['192.168.1'],
    unverified: [{ key: 'unver:bb', mac: 'BB', label: 'Ghost', ip: '172.31.9.9' }],   // /24 assente dai networks
  };
  const { orphanUnverified } = annotateNetworksVerification(sampleNets(), verification);
  assert.equal(orphanUnverified.length, 1);
  assert.equal(orphanUnverified[0].mac, 'BB');
});

test('annotate: input difensivi non lanciano', () => {
  assert.deepEqual(annotateNetworksVerification(), { networks: [], orphanUnverified: [] });
  assert.deepEqual(annotateNetworksVerification([], {}), { networks: [], orphanUnverified: [] });
});

// ── D2: le righe rete seguono la maschera DICHIARATA, non una /24 assunta ───
// La chiave di segmento prodotta qui viene CONFRONTATA con `observedSubnets`
// (lib/drift-snapshot): se i due lati la calcolassero diversamente, «la sweep ha
// visto questa rete?» risponderebbe sempre no. Per questo la lista di prefissi
// va passata a entrambi — ed è la stessa funzione (lib/cidr `segmentKey`).
test('D2: una /22 dichiarata è UNA riga, non quattro /24', () => {
  const nodes = [node('a', '10.0.0.5'), node('b', '10.0.1.5'), node('c', '10.0.3.9')];
  const senza = deriveProjectNetworks({ nodes }).networks;
  assert.equal(senza.length, 3, 'senza reti dichiarate: la vecchia convenzione, tre /24');
  const con = deriveProjectNetworks({ nodes, prefixes: [{ cidr: '10.0.0.0/22' }] }).networks;
  assert.equal(con.length, 1, 'con la rete dichiarata: una sola rete, come l\'ha scritta l\'utente');
  assert.equal(con[0].cidr, '10.0.0.0/22', 'il CIDR è quello dichiarato, non «10.0.0.0/24» ricomposto');
  assert.equal(con[0].deviceCount, 3);
});

test('D2: due /25 dentro una /24 restano due reti (il rosso non si estende alla metà mai sondata)', () => {
  const prefixes = [{ cidr: '192.168.1.0/25' }, { cidr: '192.168.1.128/25' }];
  const nodes = [node('bassa', '192.168.1.10'), node('alta', '192.168.1.130')];
  const { networks } = deriveProjectNetworks({ nodes, prefixes });
  assert.equal(networks.length, 2);
  // La sweep ha visto SOLO la metà bassa: l'altra resta non osservata.
  const { networks: joined } = annotateNetworksVerification(networks, {
    sweepRan: true, observedSubnets: ['192.168.1.0/25'], unverified: [], prefixes,
  });
  const bassa = joined.find(n => n.cidr === '192.168.1.0/25');
  const alta = joined.find(n => n.cidr === '192.168.1.128/25');
  assert.equal(bassa.observed, true, 'sondata');
  assert.equal(alta.observed, false, 'MAI sondata: con la /24 assunta risultava coperta, e i suoi device rossi');
});

test('D2: produttore e consumatore devono usare la stessa lista (altrimenti due mondi)', () => {
  const prefixes = [{ cidr: '10.0.0.0/22' }];
  const { networks } = deriveProjectNetworks({ nodes: [node('a', '10.0.1.5')], prefixes });
  const giusto = annotateNetworksVerification(networks, {
    sweepRan: true, observedSubnets: ['10.0.0.0/22'], unverified: [], prefixes,
  }).networks[0];
  assert.equal(giusto.observed, true, 'stesse chiavi da entrambi i lati → il join funziona');
});
