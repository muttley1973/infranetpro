'use strict';
// Candidati "solo ARP" (ipNetToMediaTable SNMP) per lo Scopri: un host visto
// nell'ARP di uno switch/router SNMP ma muto a ping/SNMP/LLDP (VPCS, off-segment)
// va proposto lo stesso. buildArpCandidates e' PURA: filtra per subnet scansionata,
// MAC unicast reale, non-gia-noto. Vendor-neutral.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArpCandidates } = require('../lib/correlate.js');
const { _buildDiscoveryMeta } = require('../server.js')._internals;

// arpTable dal driver SNMP: { mac(lowercase) -> ip }
const ARP = {
  'aa:bb:cc:00:00:10': '10.10.10.100',  // VPCS off-segment (nella subnet scansionata)
  'aa:bb:cc:00:00:20': '10.10.10.50',   // altro host nella subnet
  'aa:bb:cc:00:00:99': '10.10.99.1',    // FUORI dalla subnet scansionata
  'ff:ff:ff:ff:ff:ff': '10.10.10.255',  // broadcast MAC -> scartato
  '01:00:5e:00:00:fb': '10.10.10.251',  // multicast MAC -> scartato
  '00:00:00:00:00:00': '10.10.10.9',    // MAC zero -> scartato
};
const scanSet = new Set(['10.10.10.50', '10.10.10.100', '10.10.10.251', '10.10.10.255', '10.10.10.9']); // subnet 10.10.10.0/24 (senza .99.x)

test('buildArpCandidates: surface off-segment host dalla ARP dello switch', () => {
  const out = buildArpCandidates(ARP, { scanSet, knownIps: new Set(), fromIp: '10.10.10.1' });
  const ips = out.map(c => c.ip).sort();
  assert.deepEqual(ips, ['10.10.10.100', '10.10.10.50'], 'solo host validi dentro la subnet');
  const vpcs = out.find(c => c.ip === '10.10.10.100');
  assert.equal(vpcs.mac, 'aa:bb:cc:00:00:10', 'MAC normalizzato');
  assert.equal(vpcs.viaFrom, '10.10.10.1', 'traccia il device che ha fornito la ARP');
});

test('buildArpCandidates: fuori subnet scansionata -> escluso', () => {
  const out = buildArpCandidates(ARP, { scanSet });
  assert.equal(out.some(c => c.ip === '10.10.99.1'), false, 'IP di altra subnet non proposto');
});

test('buildArpCandidates: broadcast / multicast / zero MAC -> esclusi', () => {
  const out = buildArpCandidates(ARP, { scanSet });
  const ips = out.map(c => c.ip);
  assert.ok(!ips.includes('10.10.10.255'), 'broadcast escluso');
  assert.ok(!ips.includes('10.10.10.251'), 'multicast escluso');
  assert.ok(!ips.includes('10.10.10.9'),   'MAC zero escluso');
});

test('buildArpCandidates: gia noto (knownIps) -> non duplicato', () => {
  const out = buildArpCandidates(ARP, { scanSet, knownIps: new Set(['10.10.10.100']) });
  assert.equal(out.some(c => c.ip === '10.10.10.100'), false, 'host gia trovato via SNMP non riproposto');
  assert.equal(out.some(c => c.ip === '10.10.10.50'), true);
});

test('buildArpCandidates: ON-SEGMENT (subnet del collector) -> escluso (ARP locale autorevole)', () => {
  // Scenario reale: una Synology on-segment ha nella sua ipNetToMediaTable voci STANTIE
  // per host 10.10.10.x ormai morti. Il collector e' sulla stessa /24 -> la sua ARP
  // locale e' autorevole, quindi quegli IP NON vanno resuscitati dall'ARP del NAS.
  const localSubnets = new Set(['10.10.10']);
  const out = buildArpCandidates(ARP, { scanSet, knownIps: new Set(), fromIp: '10.10.10.5', localSubnets });
  assert.equal(out.length, 0, 'nessun candidato ARP-SNMP on-segment (il sweep locale li copre)');
});

test('buildArpCandidates: OFF-SEGMENT resta proposto anche con localSubnets (scopo della feature)', () => {
  // Il collector e' su 192.168.1.x; scansiona 10.10.10.x via un router -> off-segment,
  // che la sua ARP locale NON vede -> l'ARP dello switch e' preziosa, resta.
  const localSubnets = new Set(['192.168.1']);
  const out = buildArpCandidates(ARP, { scanSet, knownIps: new Set(), fromIp: '10.10.10.1', localSubnets });
  const ips = out.map(c => c.ip).sort();
  assert.deepEqual(ips, ['10.10.10.100', '10.10.10.50'], 'gli host off-segment restano proposti');
});

test('buildArpCandidates: senza scanSet non filtra per subnet (ma resta il filtro MAC)', () => {
  const out = buildArpCandidates(ARP, { knownIps: new Set() });
  assert.ok(out.some(c => c.ip === '10.10.99.1'), 'senza scanSet include anche altre subnet');
  assert.ok(!out.some(c => c.mac === 'ff:ff:ff:ff:ff:ff'), 'il filtro MAC resta attivo');
});

test('buildArpCandidates: input malformato -> []', () => {
  assert.deepEqual(buildArpCandidates(null, {}), []);
  assert.deepEqual(buildArpCandidates(undefined), []);
  assert.deepEqual(buildArpCandidates({}, { scanSet }), []);
});

test('decorate ARP-SNMP: sorgente dice "ARP SNMP di <device>" e reason dedicata (non "locale")', () => {
  const meta = _buildDiscoveryMeta(
    { ip: '10.10.10.100', mac: '00:50:79:66:68:23' },
    { viaProtocol: 'ARP', viaFrom: '10.10.99.1' }
  );
  const arpSrc = meta.sources.find(s => s.id === 'arp');
  assert.ok(arpSrc, 'sorgente ARP presente');
  assert.match(arpSrc.detail, /SNMP/, 'detail indica ARP SNMP (non cache locale)');
  assert.match(arpSrc.detail, /10\.10\.99\.1/, 'cita il device che ha fornito la ARP');
  assert.ok(meta.reasonCodes.includes('arp-snmp-seen'), 'reason arp-snmp-seen');
  assert.equal(meta.manageability, 'observed', 'ARP-only = osservato, non gestito');
});

test('decorate ARP locale: resta "cache ARP locale" / arp-seen (nessuna regressione)', () => {
  const meta = _buildDiscoveryMeta({ ip: '192.168.1.9', mac: 'aa:bb:cc:00:00:09' }, {});
  const arpSrc = meta.sources.find(s => s.id === 'arp');
  assert.match(arpSrc.detail, /locale/, 'ARP senza viaProtocol resta "locale"');
  assert.ok(meta.reasonCodes.includes('arp-seen'));
  assert.ok(!meta.reasonCodes.includes('arp-snmp-seen'));
});
