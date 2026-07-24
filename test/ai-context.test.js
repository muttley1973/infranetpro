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

test('passivi: prese a muro/patch panel marcati passive:true (non sono lacune «senza IP»)', () => {
  const proj = {
    id: 8, name: 'Piano', updated_at: '2026-07-01',
    state: {
      nodes: [
        { id: 'sw', type: 'switch', name: 'SW-1', ip: '10.0.0.2', mac: 'aa:bb:cc:00:00:01' },
        { id: 'wp', type: 'wallport', name: 'A-42' },            // presa a muro: nessun IP/VLAN PER DISEGNO
        { id: 'pp', type: 'patchpanel', name: 'PP-1', rackId: 'r1', rackU: 1 },
        { id: 'ups', type: 'ups', name: 'UPS-1', ip: '10.0.0.9', mac: 'aa:bb:cc:00:00:09' }, // passivo ma hasIP → NON passive
      ],
    },
  };
  const ctx = buildAiContext(proj, null);
  const byName = Object.fromEntries(ctx.devices.map(d => [d.name, d]));
  assert.equal(byName['A-42'].passive, true, 'wallport deve essere passive:true');
  assert.equal(byName['PP-1'].passive, true, 'patchpanel deve essere passive:true');
  assert.ok(!('passive' in byName['SW-1']), 'lo switch (attivo) NON deve avere passive');
  assert.ok(!('passive' in byName['UPS-1']), 'UPS ha hasIP → NON marcato passive (puo avere IP di mgmt)');
  assert.ok(!('ip' in byName['A-42']), 'la presa a muro resta senza IP (corretto)');
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
            // Forma REALE del driver: ram/volumes annidati (3 livelli) + segreto in fondo.
            hostResources: { cpuLoad: 42, cpuCores: 4, ram: { pct: 55 },
              volumes: [{ name: '/vol1', kind: 'fixedDisk', pct: 90, authKey: 'HOSTLEAK' }] },
            system: { sysUpTime: '10 days', sysDescr: 'Cisco IOS', sysContact: 'admin@x.com' } } },
        { id: 'ap1', type: 'ap', name: 'AP-Sala', ip: '10.0.20.9', integration: { driver: 'snmp', community: 'SECRET2' } },
        { id: 'pr1', type: 'printer', name: 'HP-LJ', ip: '10.0.20.50',
          // Forma REALE Printer-MIB: supplies è un ARRAY di oggetti (3 livelli) + segreto annidato.
          integration: { printer: { supplies: [
            { index: 1, color: 'black', type: 'ink', max: 200, level: 30, pct: 15, secretToken: 'PRLEAK' },
            { index: 2, color: 'cyan', type: 'ink', max: 200, level: 180, pct: 90 } ], pageCount: 12000 } } },
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

test('salute SNMP: host (CPU/RAM + dischi annidati) + printer (inchiostro) + system, niente contatto/segreti', () => {
  const ctx = buildAiContext(projWithTopo(), null);
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(sw.health && sw.health.host, 'host resources presenti');
  assert.equal(sw.health.host.cpuLoad, 42);
  assert.equal(sw.health.host.ram.pct, 55, 'RAM% (oggetto annidato) presente');
  assert.equal(sw.health.host.volumes[0].pct, 90, 'disco (array annidato di 3° livello) ORA raggiunto');
  assert.ok(!('authKey' in sw.health.host.volumes[0]), 'segreto annidato in profondità scartato');
  assert.equal(sw.health.snmpStatus, 'ok');
  assert.match(sw.health.system.descr, /Cisco IOS/);
  assert.ok(!('contact' in sw.health.system) && !('sysContact' in sw.health.system), 'sysContact non incluso');
  const pr = ctx.devices.find(d => d.id === 'pr1');
  assert.equal(pr.health.printer.supplies[0].pct, 15, 'livello inchiostro (array annidato) ORA raggiunto');
  assert.ok(!('secretToken' in pr.health.printer.supplies[0]), 'segreto annidato nelle supplies scartato');
});

test('alert salute: disco quasi pieno + inchiostro basso + riepilogo flotta', () => {
  const ctx = buildAiContext(projWithTopo(), null);
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(Array.isArray(sw.alerts) && sw.alerts.some(a => a.kind === 'disk' && a.value === 90), 'disco 90% segnalato');
  const pr = ctx.devices.find(d => d.id === 'pr1');
  assert.ok(pr.alerts.some(a => a.kind === 'ink' && a.value === 15), 'inchiostro 15% segnalato');
  assert.ok(ctx.summary.alerts && ctx.summary.alerts.warn >= 2, 'riepilogo flotta conta i warn');
});

test('alert salute: scope.snmpHealth=false → niente alert (gated come la salute)', () => {
  const ctx = buildAiContext(projWithTopo(), null, { snmpHealth: false });
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(!sw.alerts, 'senza il blocco salute non si derivano alert');
  assert.ok(!(ctx.summary && ctx.summary.alerts), 'nessun riepilogo alert di flotta');
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

// ── Capacità hardware nel contesto (lib/hw-capabilities) ─────────────────────
function projWithCaps() {
  return {
    id: 12, name: 'Caps',
    state: {
      vlanNames: { 20: 'Dati' },
      ipam: { vlans: { 20: { subnet: '10.0.20.0/24', gateway: '10.0.20.1' } } },
      racks: [],
      lagGroups: { g1: 'Port-channel1' },
      nodes: [
        // PoE budget documentato + chiavi segrete iniettate NELLO SPEC → non devono uscire.
        { id: 'sw1', type: 'switch', name: 'SW-Core', ip: '10.0.20.2', snmpStatus: 'ok',
          spec: { swPoeBudgetW: 370, community: 'SPECLEAK', apiKey: 'SPECKEY-LEAK' },
          integration: { driver: 'snmp', community: 'SECRET-COMM' } },
        { id: 'ups1', type: 'ups', name: 'UPS-A', ip: '10.0.20.3', spec: { upsVa: 3000, upsW: 2700, upsAutonomyMin: 12 } },
        { id: 'srv1', type: 'server', name: 'ESXi-01', ip: '10.0.20.4', spec: { srvCpu: 'Xeon Gold', srvRamGb: 512 }, vms: [{ mac: 'aa:aa:aa:aa:aa:01' }, { mac: 'aa:aa:aa:aa:aa:02' }] },
      ],
      ports: {
        'sw1-1': { status: 'active', speed: 10000, lagGroup: 'g1', ifName: 'Te1/0/1' },
        'sw1-2': { status: 'active', speed: 10000, lagGroup: 'g1', ifName: 'Te1/0/2' },
        'sw1-3': { status: 'active', speed: 1000, snmpPoe: '802.3at', ifName: 'Gi1/0/3' },
        'sw1-4': { status: 'active', speed: 1000, snmpPoe: '802.3af', ifName: 'Gi1/0/4' },
      },
      links: [{ id: 'L1', src: 'sw1-1', dst: 'ups1-1' }],   // 1 porta usata su sw1
    },
  };
}

test('GUARDIA capacità: chiavi segrete nello spec NON entrano nelle capacità', () => {
  const json = JSON.stringify(buildAiContext(projWithCaps(), null));
  for (const s of ['SPECLEAK', 'SPECKEY-LEAK', 'SECRET-COMM']) {
    assert.ok(!json.includes(s), `segreto spec trapelato: ${s}`);
  }
});

test('capacità switch: PoE (budget+headroom) + porte (free/mix/LAG)', () => {
  const ctx = buildAiContext(projWithCaps(), null);
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(sw.capabilities, 'lo switch porta le capacità');
  assert.equal(sw.capabilities.poe.budgetW, 370);
  assert.equal(sw.capabilities.poe.poePorts, 2);
  assert.equal(sw.capabilities.poe.worstCaseW, 45.4);          // 30 (at) + 15.4 (af)
  assert.equal(sw.capabilities.poe.headroomW, 324.6);
  assert.equal(sw.capabilities.ports.free, 3);                 // 4 porte − 1 usata
  assert.equal(sw.capabilities.ports.lagAggregateMbps, 20000);
  assert.equal(sw.capabilities.ports.lags[0].name, 'Port-channel1');
  assert.deepEqual(sw.capabilities.ports.speeds, { '10G': 2, '1G': 2 });
});

test('capacità UPS/server: power + compute (con VM)', () => {
  const ctx = buildAiContext(projWithCaps(), null);
  const ups = ctx.devices.find(d => d.id === 'ups1');
  assert.equal(ups.capabilities.power.va, 3000);
  assert.equal(ups.capabilities.power.autonomyMin, 12);
  assert.ok(!ups.capabilities.ports, 'UPS senza porte → niente blocco porte');
  const srv = ctx.devices.find(d => d.id === 'srv1');
  assert.equal(srv.capabilities.compute.ramGb, 512);
  assert.equal(srv.capabilities.compute.vms, 2);
});

test('capacità flotta: summary.capabilities con totali utili', () => {
  const ctx = buildAiContext(projWithCaps(), null);
  assert.ok(ctx.summary.capabilities, 'riepilogo capacità di flotta presente');
  assert.equal(ctx.summary.capabilities.poeHeadroomW, 324.6);
  assert.equal(ctx.summary.capabilities.maxLagAggregateMbps, 20000);
  assert.equal(ctx.summary.capabilities.freePorts, 3);
});

test('② freschezza: asOf (updated_at) + summary.measuredAt (lastSnmpSyncAt) nel contesto', () => {
  const p = projWithCaps();
  p.updated_at = '2026-07-20T09:00:00.000Z';
  p.state.lastSnmpSyncAt = Date.UTC(2026, 6, 22, 8, 0, 0);      // 2026-07-22T08:00Z
  const ctx = buildAiContext(p, null);
  assert.equal(ctx.asOf, '2026-07-20T09:00:00.000Z', 'asOf = ultimo salvataggio della documentazione');
  assert.equal(ctx.summary.measuredAt, '2026-07-22T08:00:00.000Z', 'measuredAt = ultima Verifica/poll SNMP');
});

test('② freschezza: senza timestamp niente campo inventato (compact, no-invenzioni)', () => {
  const ctx = buildAiContext(projWithCaps(), null);            // niente updated_at né lastSnmpSyncAt
  assert.ok(!('asOf' in ctx), 'nessun asOf inventato');
  assert.ok(!('measuredAt' in ctx.summary), 'nessun measuredAt inventato');
});

test('scope.ports=false → capacità SENZA il blocco porte (gating)', () => {
  const ctx = buildAiContext(projWithCaps(), null, { ports: false });
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.ok(sw.capabilities && sw.capabilities.poe, 'PoE (da spec) resta con scope.ports off');
  assert.ok(!sw.capabilities.ports, 'il blocco porte sparisce con scope.ports=false');
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
