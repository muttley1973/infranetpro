'use strict';
// ============================================================
//  test/ai-context.test.js — server/ai/context.js (contesto per l'AI).
//
//  ⭐ GUARDIA ANTI-LEAK (paletto SICUREZZA #1): il contesto che esce verso il
//  modello NON deve MAI contenere segreti — community SNMP, credenziali v3,
//  password, API key, né credenziali nell'URL di gestione. Se questo test
//  fallisce, un segreto può trapelare: NON allentarlo, correggi l'allowlist.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { buildAiContext } = require('../server/ai/context.js');

function projWithSecrets() {
  return {
    id: 7, name: 'Sede', updated_at: '2026-06-29',
    state: {
      vlanNames: { 20: 'Uffici' },
      ipam: { vlans: { 20: { subnet: '10.0.20.0/24', gateway: '10.0.20.1', dns: '10.0.20.1' } } },
      racks: [{ id: 'r1', name: 'Rack 1', sizeU: 42 }],
      nodes: [{
        id: 'n1', type: 'switch', name: 'SW-Core', ip: '10.0.20.2', mac: 'aa:bb:cc:dd:ee:ff',
        hostname: 'sw-core', rackId: 'r1', rackU: 1, sizeU: 1,
        mgmtUrl: 'https://admin:SUPERSECRETPW@10.0.20.2',
        integration: { driver: 'snmp', host: '10.0.20.2', community: 'PRIVATE-COMM-XYZ', v3: { authKey: 'AUTHLEAK', privKey: 'PRIVLEAK' } },
        password: 'NODEPW-LEAK', apiKey: 'APIKEY-LEAK',
      }],
    },
  };
}

const SECRETS = ['PRIVATE-COMM-XYZ', 'SUPERSECRETPW', 'AUTHLEAK', 'PRIVLEAK', 'NODEPW-LEAK', 'APIKEY-LEAK'];

test('GUARDIA: nessun segreto (community/credenziali) nel contesto AI', () => {
  const json = JSON.stringify(buildAiContext(projWithSecrets(), null));
  for (const s of SECRETS) assert.ok(!json.includes(s), `segreto trapelato nel contesto: ${s}`);
});

test('contesto §8b: forma corretta + VLAN derivata + mgmtUrl senza credenziali', () => {
  const ctx = buildAiContext(projWithSecrets(), null);
  assert.equal(ctx.project.id, 7);
  assert.equal(ctx.summary.devices, 1);
  assert.equal(ctx.summary.snmp, 1);                 // booleano (gestito via SNMP), MAI la community
  assert.equal(ctx.vlans[0].subnet, '10.0.20.0/24');
  const d = ctx.devices[0];
  assert.equal(d.vlan, 20, 'VLAN derivata da IP↔subnet (lib/cidr)');
  assert.equal(d.snmp, true);
  assert.equal(d.mgmtUrl, 'https://10.0.20.2', 'credenziali rimosse dall\'URL di gestione');
  assert.ok(!('community' in d) && !('password' in d) && !('apiKey' in d), 'nessun campo segreto sul device');
});

test('liveFacts ri-sanitizzati: solo allowlist, qualunque extra (anche segreti) scartato', () => {
  const live = {
    drift: {
      absent: [{ id: 'n2', name: 'AP-1', ip: '10.0.20.9', mac: '11:22:33:44:55:66', vlan: 20, secretField: 'LIVELEAK' }],
      undocumented: [{ ip: '10.0.20.50', mac: 'aa:00:bb:11:cc:22', vlan: 20 }],
      ipChanged: [{ id: 'n3', name: 'NAS', from: '10.0.20.7', to: '10.0.20.8', mac: 'de:ad:be:ef:00:01', token: 'TOKENLEAK' }],
    },
    ipam: [{ vlan: 20, used: 38, free: 216, nextFree: '10.0.20.39', evil: 'IPAMLEAK' }],
    gaps: [{ kind: 'vlan_no_gateway', vlan: 30 }],
    rogue: { community: 'ROGUELEAK' },                // intera sezione sconosciuta → scartata
  };
  const ctx = buildAiContext(projWithSecrets(), live);
  const json = JSON.stringify(ctx);
  for (const s of ['LIVELEAK', 'TOKENLEAK', 'IPAMLEAK', 'ROGUELEAK']) {
    assert.ok(!json.includes(s), `liveFacts: campo extra trapelato: ${s}`);
  }
  assert.equal(ctx.facts.drift.absent[0].name, 'AP-1');
  assert.equal(ctx.facts.drift.ipChanged[0].to, '10.0.20.8');
  assert.equal(ctx.facts.ipam[0].nextFree, '10.0.20.39');
  assert.equal(ctx.facts.gaps[0].kind, 'vlan_no_gateway');
});

test('niente liveFacts → niente blocco facts (contesto minimale)', () => {
  const ctx = buildAiContext(projWithSecrets(), null);
  assert.ok(!('facts' in ctx), 'senza liveFacts il contesto non ha la sezione facts');
});

// ── L1: porte + salute SNMP + topologia (con segreti iniettati) ──────────────
function projWithTopo() {
  return {
    id: 9, name: 'Topo',
    state: {
      vlanNames: { 20: 'Uffici' },
      ipam: { vlans: { 20: { subnet: '10.0.20.0/24', gateway: '10.0.20.1' } } },
      racks: [],
      nodes: [
        { id: 'sw1', type: 'switch', name: 'SW-Core', ip: '10.0.20.2', snmpStatus: 'ok',
          integration: { driver: 'snmp', community: 'SECRET-COMM',
            hostResources: { cpuPercent: 42, memPercent: 55, authKey: 'HOSTLEAK' },
            system: { sysUpTime: '10 days', sysDescr: 'Cisco IOS', sysContact: 'admin@x.com' } } },
        { id: 'ap1', type: 'ap', name: 'AP-Sala', ip: '10.0.20.9', integration: { driver: 'snmp', community: 'SECRET2' } },
        { id: 'pr1', type: 'printer', name: 'HP-LJ', ip: '10.0.20.50',
          integration: { printer: { tonerBlackPct: 80, pageCount: 12000, secretToken: 'PRLEAK' } } },
      ],
      ports: {
        'sw1-1': { status: 'active', speed: '1G', vlan: 20, ifName: 'Gi0/1', password: 'PORTLEAK' },
        'sw1-2': { statusOvr: 'active', vlanOvr: 30, desc: 'Uplink', isTrunk: true, trunkVlans: [20, 30] },
        'sw1-3': {},   // vuota → saltata dalla lista
      },
      links: [{ id: 'L1', src: 'sw1-1', dst: 'ap1-1' }],
    },
  };
}

const TOPO_SECRETS = ['SECRET-COMM', 'SECRET2', 'HOSTLEAK', 'PRLEAK', 'PORTLEAK', 'admin@x.com'];

test('GUARDIA L1: nessun segreto in porte/salute (community/password/authKey/token/contact)', () => {
  const json = JSON.stringify(buildAiContext(projWithTopo(), null));
  for (const s of TOPO_SECRETS) assert.ok(!json.includes(s), `segreto trapelato (porte/salute): ${s}`);
});

test('porte: lista + summary used/free + connectedTo (cablaggio risolto al nome)', () => {
  const ctx = buildAiContext(projWithTopo(), null);
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(sw.ports, 'sw1 ha il blocco porte');
  assert.ok(sw.ports.total >= 3, 'conteggio porte totali');
  assert.equal(sw.ports.used, 1, '1 porta collegata (sw1-1 → ap1)');
  assert.equal(sw.ports.free, sw.ports.total - 1);
  const p1 = sw.ports.list.find(p => p.port === '1');
  assert.ok(p1 && p1.connectedTo && p1.connectedTo[0].device === 'AP-Sala', 'connectedTo risolto al nome');
  const p2 = sw.ports.list.find(p => p.port === '2');
  assert.deepEqual(p2.trunk, [20, 30], 'trunk con VLAN trasportate');
  assert.equal(p2.name, 'Uplink');
  assert.equal(p2.vlan, 30, 'override VLAN vince');
  assert.ok(!sw.ports.list.find(p => p.port === '3'), 'porta vuota assente dalla lista');
});

test('salute SNMP: host (CPU/RAM) + printer (toner) + system, niente contatto/segreti', () => {
  const ctx = buildAiContext(projWithTopo(), null);
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(sw.health && sw.health.host, 'host resources presenti');
  assert.equal(sw.health.host.cpuPercent, 42);
  assert.ok(!('authKey' in sw.health.host), 'authKey scartato');
  assert.equal(sw.health.snmpStatus, 'ok');
  assert.match(sw.health.system.descr, /Cisco IOS/);
  assert.ok(!('contact' in sw.health.system) && !('sysContact' in sw.health.system), 'sysContact non incluso');
  const pr = ctx.devices.find(d => d.id === 'pr1');
  assert.equal(pr.health.printer.tonerBlackPct, 80);
  assert.ok(!('secretToken' in pr.health.printer), 'token scartato');
});

// ── Wireless: inventario SSID nel contesto (allowlist, niente passphrase) ────
function projWithWifi() {
  return {
    id: 11, name: 'Wifi',
    state: {
      vlanNames: { 20: 'Dati', 40: 'Guest' },
      ipam: { vlans: { 20: { subnet: '10.40.20.0/24' } } },
      racks: [],
      nodes: [{
        id: 'ap1', type: 'ap', name: 'AP-Sala', ip: '10.40.10.20',
        integration: { driver: 'snmp', community: 'SECRET-COMM' },
        radios: [
          // un campo "psk"/"passphrase" iniettato AD ARTE → NON deve uscire.
          { band: '2.4', standard: 'wifi6', psk: 'WIFI-PSK-LEAK', ssids: [
            { id: 's1', ssid: 'ACME-Corp', vlan: 20, security: 'wpa3-personal', passphrase: 'PSK-LEAK-2' },
            { id: 's2', ssid: 'ACME-Guest', vlan: 40, security: 'wpa2-personal' } ] },
          { band: '5', standard: 'wifi6', ssids: [
            { id: 's3', ssid: 'ACME-Corp', vlan: 20, security: 'wpa3-personal' } ] },
        ],
      }],
    },
  };
}

test('wireless: SSID nel contesto (ssid/vlan/security/bande), dedup per ssid+vlan', () => {
  const ctx = buildAiContext(projWithWifi(), null);
  const ap = ctx.devices.find(d => d.id === 'ap1');
  assert.ok(ap && Array.isArray(ap.ssids), 'l\'AP porta l\'inventario SSID');
  assert.equal(ap.ssids.length, 2, 'ACME-Corp (2.4+5) deduplicato + ACME-Guest = 2 voci');
  const corp = ap.ssids.find(s => s.ssid === 'ACME-Corp');
  assert.equal(corp.vlan, 20); assert.equal(corp.security, 'wpa3-personal');
  assert.deepEqual(corp.bands.sort(), ['2.4', '5'], 'le bande della stessa SSID sono raccolte');
});

test('GUARDIA wireless: nessuna passphrase/psk nel contesto SSID', () => {
  const json = JSON.stringify(buildAiContext(projWithWifi(), null));
  for (const s of ['WIFI-PSK-LEAK', 'PSK-LEAK-2', 'SECRET-COMM']) {
    assert.ok(!json.includes(s), `segreto wireless trapelato: ${s}`);
  }
});

test('topologia: adiacenza device coi nomi', () => {
  const ctx = buildAiContext(projWithTopo(), null);
  assert.ok(Array.isArray(ctx.topology) && ctx.topology.length === 1);
  assert.deepEqual([ctx.topology[0].a, ctx.topology[0].b].sort(), ['AP-Sala', 'SW-Core']);
});

test('scope: ports/snmpHealth/topology = false li rimuove dal contesto', () => {
  const ctx = buildAiContext(projWithTopo(), null, { ports: false, snmpHealth: false, topology: false });
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(!sw.ports, 'porte assenti con scope.ports=false');
  assert.ok(!sw.health, 'salute assente con scope.snmpHealth=false');
  assert.ok(!('topology' in ctx), 'topologia assente con scope.topology=false');
});

test('scope: devices=false → nessuna lista device, ma summary resta', () => {
  const ctx = buildAiContext(projWithTopo(), null, { devices: false });
  assert.ok(!('devices' in ctx));
  assert.ok(ctx.summary && ctx.summary.devices >= 1, 'il summary resta');
});

test('scope.drift=false → niente drift anche se nei liveFacts', () => {
  const live = { drift: { absent: [{ id: 'x', name: 'X', ip: '10.0.20.9' }] } };
  const off = buildAiContext(projWithTopo(), live, { drift: false });
  assert.ok(!(off.facts && off.facts.drift), 'drift soppresso da scope.drift=false');
  const on = buildAiContext(projWithTopo(), live, { drift: true });
  assert.ok(on.facts && on.facts.drift, 'drift presente con scope.drift=true');
});
