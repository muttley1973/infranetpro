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
      // Schema 2: prefissi di primo livello (il progetto arriva già migrato dal
      // projects-store, che è l'unica porta d'ingresso lato server).
      ipam: { vlans: {}, prefixes: [{ cidr: '10.0.20.0/24', vlan: 20, gateway: '10.0.20.1', dns: '10.0.20.1' }] },
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
      ipam: { vlans: {}, prefixes: [{ cidr: '10.0.20.0/24', vlan: 20, gateway: '10.0.20.1' }] },
      racks: [],
      nodes: [
        // `ports: 24` = le porte DICHIARATE. Un documento vero dice quante porte
        // ha l'apparato; i record in `state.ports` sono solo quelle documentate.
        { id: 'sw1', type: 'switch', name: 'SW-Core', ip: '10.0.20.2', snmpStatus: 'ok', ports: 24,
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
      ipam: { vlans: {}, prefixes: [{ cidr: '10.40.20.0/24', vlan: 20 }] },
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
      ipam: { vlans: {}, prefixes: [{ cidr: '10.0.20.0/24', vlan: 20, gateway: '10.0.20.1' }] },
      racks: [],
      lagGroups: { g1: 'Port-channel1' },
      nodes: [
        // PoE budget documentato + chiavi segrete iniettate NELLO SPEC → non devono uscire.
        { id: 'sw1', type: 'switch', name: 'SW-Core', ip: '10.0.20.2', snmpStatus: 'ok', ports: 4,
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

test('②/③ SNMP configurato ≠ risponde: summary.snmp (configurati) vs snmpResponding (risposti «ok»)', () => {
  const p = { id: 1, name: 'X', state: { nodes: [
    { id: 'a', type: 'switch', name: 'A', ip: '10.0.0.1', integration: { driver: 'snmp' }, snmpStatus: 'ok' },
    { id: 'b', type: 'switch', name: 'B', ip: '10.0.0.2', integration: { driver: 'snmp' }, snmpStatus: 'err' },
    { id: 'c', type: 'switch', name: 'C', ip: '10.0.0.3', integration: { driver: 'snmp' } },  // configurato, mai risposto
  ] } };
  const ctx = buildAiContext(p, null, { devices: true, snmpHealth: true });
  assert.equal(ctx.summary.snmp, 3, '3 device configurati con un driver SNMP');
  assert.equal(ctx.summary.snmpResponding, 1, 'solo A ha risposto «ok» — mai «3 monitorati»');
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

// ── Parità documentale: ciò che l'utente DICHIARA deve arrivare al modello ───
// L'audit del 2026-08-14 ha misurato che 23 parametri su 30 non uscivano: il
// contesto raccontava una rete più povera di quella documentata, e sul dichiarato
// (reti, IPv6, VM, prese) l'assistente rispondeva «non risulta» — cioè il falso.
// Questi test sono l'argine: ogni categoria ha la sua copertura E la sua guardia
// anti-leak, perché aggiungere dati non deve mai aprire una fuga.

function projDeclared() {
  return {
    id: 9, name: 'Dichiarato', updated_at: '2026-08-14',
    state: {
      vlanNames: { 10: 'Uffici', 99: 'Ospiti' },
      guestVlans: [99], voiceVlans: [20], mgmtVlans: [10],
      ipam: {
        prefixes: [
          { cidr: '10.10.10.0/24', vlan: 10, gateway: '10.10.10.1', name: 'Uffici' },
          { cidr: '2001:db8:10::/64', vlan: 10, gateway: '2001:db8:10::1', name: 'Uffici v6' },
          // La rete SENZA VLAN: la norma in un import DCIM, invisibile prima del fix.
          { cidr: '192.168.77.0/24', vlan: null, gateway: '192.168.77.1', name: 'DMZ', source: 'netbox' },
        ],
      },
      racks: [],
      nodes: [
        { id: 'rt1', type: 'router', name: 'RT-EDGE', ip: '10.10.10.1', ip6: '2001:db8:10::1', ports: 2,
          warrantyUntil: '2025-01-01', eolDate: '2027-06-30' },
        { id: 'hv1', type: 'hypervisor', name: 'ESXi-01', ip: '10.10.10.20', ports: 1,
          vms: [{ id: 'vm1', name: 'DC-01', ip: '10.10.10.21', mac: 'f8:bc:12:00:00:01', vlan: 10, state: 'running',
            integration: { driver: 'snmp', community: 'VMCOMM-LEAK' }, password: 'VMPW-LEAK' }] },
        { id: 'pdu1', type: 'pdu', name: 'PDU-A', ip: '10.10.10.9', ports: 0,
          powerOutlets: [
            { name: 'C13-1', status: 'active', connectedDeviceId: 'rt1', connectedPortName: 'PS1', community: 'OUTLET-LEAK' },
            { name: 'C13-2', status: 'inactive' },
          ] },
      ],
      links: [],
      ports: {
        'rt1-1': { status: 'up', ifName: 'Gi0/0', desc: 'LAN', ip: '10.10.10.1', ip6: '2001:db8:10::1' },
        'rt1-2': { status: 'up', ifName: 'Gi0/1', desc: 'WAN', ip: '203.0.113.7', community: 'PORT-LEAK' },
      },
    },
  };
}

test('reti dichiarate: escono TUTTE, anche senza VLAN e anche IPv6 (prefix-first)', () => {
  const ctx = buildAiContext(projDeclared(), null);
  const cidrs = (ctx.networks || []).map(n => n.cidr);
  assert.deepEqual(cidrs.sort(), ['10.10.10.0/24', '192.168.77.0/24', '2001:db8:10::/64'].sort());
  const dmz = ctx.networks.find(n => n.cidr === '192.168.77.0/24');
  assert.equal(dmz.gateway, '192.168.77.1');
  assert.ok(!('vlan' in dmz), 'rete senza VLAN: nessuna «VLAN 0» inventata');
  assert.equal(ctx.summary.networks, 3, 'il totale dichiarato sta nel summary');
});

test('ruoli VLAN dichiarati (ospiti/voce/gestione) nel contesto', () => {
  const ctx = buildAiContext(projDeclared(), null);
  const guest = ctx.vlans.find(v => v.id === 99);
  const mgmt = ctx.vlans.find(v => v.id === 10);
  assert.deepEqual(guest.roles, ['guest']);
  assert.deepEqual(mgmt.roles, ['mgmt']);
});

test('indirizzi: ip6 del nodo + ip/ip6 di PORTA (il lato WAN sta sulla porta)', () => {
  const ctx = buildAiContext(projDeclared(), null);
  const rt = ctx.devices.find(d => d.id === 'rt1');
  assert.equal(rt.ip6, '2001:db8:10::1');
  const wan = rt.ports.list.find(p => p.name === 'WAN');
  assert.equal(wan.ip, '203.0.113.7');
  const lan = rt.ports.list.find(p => p.name === 'LAN');
  assert.equal(lan.ip6, '2001:db8:10::1');
});

test('VM documentate sull\'host: nome/IP/MAC/VLAN/stato (non solo il conteggio)', () => {
  const ctx = buildAiContext(projDeclared(), null);
  const hv = ctx.devices.find(d => d.id === 'hv1');
  assert.equal(hv.vms.length, 1);
  assert.equal(hv.vms[0].name, 'DC-01');
  assert.equal(hv.vms[0].ip, '10.10.10.21');
  assert.equal(hv.vms[0].vlan, 10);
});

test('prese PDU: stato + apparato alimentato (catena di alimentazione)', () => {
  const ctx = buildAiContext(projDeclared(), null);
  const pdu = ctx.devices.find(d => d.id === 'pdu1');
  assert.equal(pdu.outlets.length, 2);
  assert.equal(pdu.outlets[0].outlet, 'C13-1');
  assert.equal(pdu.outlets[0].state, 'active');
  assert.equal(pdu.outlets[0].powers, 'RT-EDGE', 'il nome del device, non l\'id opaco');
});

test('ciclo di vita: garanzia e fine vita DICHIARATE', () => {
  const ctx = buildAiContext(projDeclared(), null);
  const rt = ctx.devices.find(d => d.id === 'rt1');
  assert.equal(rt.lifecycle.warrantyUntil, '2025-01-01');
  assert.equal(rt.lifecycle.eol, '2027-06-30');
});

test('GUARDIA: i blocchi nuovi (VM/prese/porte) non aprono fughe di segreti', () => {
  const json = JSON.stringify(buildAiContext(projDeclared(), null));
  for (const s of ['VMCOMM-LEAK', 'VMPW-LEAK', 'OUTLET-LEAK', 'PORT-LEAK']) {
    assert.ok(!json.includes(s), `segreto trapelato dai blocchi nuovi: ${s}`);
  }
});

test('scope: devices=false toglie anche VM/prese/ciclo di vita; ports=false toglie gli IP di porta', () => {
  const noDev = buildAiContext(projDeclared(), null, { devices: false });
  assert.ok(!('devices' in noDev), 'nessun device → nessuna VM, presa o data di garanzia');
  const noPorts = buildAiContext(projDeclared(), null, { ports: false });
  const rt = noPorts.devices.find(d => d.id === 'rt1');
  assert.ok(!rt.ports, 'niente porte → niente indirizzi di porta');
  assert.ok(rt.vms === undefined && rt.lifecycle, 'il resto del device resta');
});

test('drift: identità sostituita e «non verificabile» arrivano al modello', () => {
  const live = {
    drift: {
      identityChanged: [{ id: 'rt1', name: 'RT-EDGE', swapped: true, changes: ['serial: FOC123→FOC999'], secret: 'IDLEAK' }],
      unverified: [{ id: 'hv1', name: 'ESXi-01', ip: '10.10.10.20', reason: 'leaseReleased' }],
    },
  };
  const ctx = buildAiContext(projDeclared(), live);
  const d = ctx.facts.drift;
  assert.equal(d.identityChanged[0].swapped, true);
  assert.deepEqual(d.identityChanged[0].changes, ['serial: FOC123→FOC999']);
  assert.equal(d.unverified[0].reason, 'leaseReleased');
  assert.ok(!JSON.stringify(ctx).includes('IDLEAK'), 'campo extra scartato dall\'allowlist');
});

test('scope.drift=false spegne anche identità e non-verificabili', () => {
  const live = { drift: { identityChanged: [{ id: 'rt1', swapped: true }], unverified: [{ id: 'hv1' }] } };
  const off = buildAiContext(projDeclared(), live, { drift: false });
  assert.ok(!(off.facts && off.facts.drift), 'tutte le categorie drift sono sotto lo stesso interruttore');
});

// ── C1 (audit 2026-08-20): «quante porte ha, e quante ne restano libere» ─────
// Il totale sono le porte DICHIARATE, non il numero di record in `state.ports`.
// Un record nasce quando si documenta o si cabla una porta: contarli come totale
// faceva `used === total` e quindi «0 libere» su ogni switch di ogni progetto.
function projSpare() {
  return {
    id: 11, name: 'Spare',
    state: {
      vlanNames: {}, ipam: { vlans: {}, prefixes: [] }, racks: [],
      nodes: [
        { id: 'sw1', type: 'switch', name: 'ACC-SW-1', ip: '10.0.0.2', ports: 48 },   // 48 dichiarate
        { id: 'ap1', type: 'ap', name: 'AP-1', ip: '10.0.0.9' },
        { id: 'sw2', type: 'switch', name: 'SW-IGNOTO', ip: '10.0.0.3' },             // nessun conteggio dichiarato
      ],
      ports: {
        'sw1-1': { status: 'active', speed: 1000, ifName: 'Gi1/0/1' },
        'sw1-2': { status: 'active', speed: 1000, ifName: 'Gi1/0/2' },
        'sw2-1': { status: 'active', speed: 1000 },
      },
      links: [{ id: 'L1', src: 'sw1-1', dst: 'ap1-1' }],
    },
  };
}

test('porte: il totale sono le DICHIARATE, i record sono «documented» (C1)', () => {
  const ctx = buildAiContext(projSpare(), null);
  const sw = ctx.devices.find(d => d.id === 'sw1');
  assert.equal(sw.ports.total, 48, 'il totale è quello dichiarato sul nodo');
  assert.equal(sw.ports.documented, 2, 'le porte con un record sono 2');
  assert.equal(sw.ports.used, 1, 'una sola è cablata');
  assert.equal(sw.ports.free, 47, '48 dichiarate − 1 usata: non 1, e soprattutto non 0');
  assert.equal(sw.capabilities.ports.free, 47, 'le capacità leggono lo stesso numero');
});

test('porte: senza un conteggio dichiarato si TACE, non si spaccia il record count (C1)', () => {
  const ctx = buildAiContext(projSpare(), null);
  const sw2 = ctx.devices.find(d => d.id === 'sw2');
  assert.equal(sw2.ports.total, undefined, 'nessun totale inventato');
  assert.equal(sw2.ports.free, undefined, 'e quindi nessun «libere» inventato');
  assert.equal(sw2.ports.documented, 1, 'ciò che sappiamo davvero resta');
});

// ── Un TAGLIO su una relazione si DICHIARA ─────────────────────────────────
// Tagliare un ELENCO è onesto: chi legge sa di meno, e ciò che sa è vero.
// Tagliare una RELAZIONE no: basta UN arco mancante perché due metà collegate
// sembrino separate, o perché una presa risulti alimentare nessuno. La risposta
// non diventa parziale, diventa SBAGLIATA — e da fuori ha la faccia di una
// completa. Qui si prova che il taglio esce dichiarato, e che quando non c'è
// taglio non esce niente: l'assenza deve restare il segnale di «completo».
// ⚠️ Il marcatore sta sull'OGGETTO PADRE e non sull'array: una proprietà
// appesa a un array sparisce in JSON.stringify, e il contesto viaggia in JSON —
// sarebbe una dichiarazione che non arriva mai al lettore. Per questo la prova
// guarda il contesto DOPO un giro di serializzazione.
function projTagli(nCavi, nPorte, nPrese) {
  const nodes = [{ id: 'pdu1', type: 'pdu', name: 'PDU-A', powerOutlets:
    Array.from({ length: nPrese }, (_, i) => ({ label: 'C13-' + (i + 1), status: 'on', deviceName: 'DEV-' + i })) }];
  const ports = {};
  const links = [];
  // Una stella: sw0 al centro, un apparato per ogni cavo. Ogni cavo è
  // un'adiacenza DISTINTA, quindi il conteggio non può essere gonfiato da doppioni.
  nodes.push({ id: 'sw0', type: 'switch', name: 'SW-CORE', ports: 400 });
  for (let i = 0; i < nCavi; i++) {
    nodes.push({ id: 'n' + i, type: 'pc', name: 'PC-' + i });
    ports['sw0-' + (i + 1)] = { status: 'active' };
    ports['n' + i + '-1'] = { status: 'active' };
    links.push({ id: 'L' + i, src: 'sw0-' + (i + 1), dst: 'n' + i + '-1' });
  }
  // Porte in più sul centro-stella, tutte «interessanti» perché hanno un nome.
  for (let i = 0; i < nPorte; i++) ports['sw0-' + (300 + i)] = { status: 'active', ifName: 'Gi1/0/' + i };
  return { id: 1, name: 'tagli', state: { nodes, ports, links } };
}

test('taglio dichiarato: topologia, porte e prese dicono quanto se n\'è mostrato', () => {
  // ⚠️ I tetti si DERIVANO dal modulo, non si ricopiano: ricopiati, il giorno che
  // qualcuno li alza questa prova smette di provare il taglio — resta verde e non
  // guarda più niente. Si costruisce sempre un po oltre il tetto, qualunque sia.
  const { MAX_ARCHI_MOSTRATI: ARCHI, MAX_PORTE_MOSTRATE: PORTE, MAX_PRESE_MOSTRATE: PRESE } = require('../server/ai/context.js');
  const nCavi = ARCHI + 60, nPorte = PORTE + 60, nPrese = PRESE + 16;
  const ctx = JSON.parse(JSON.stringify(buildAiContext(projTagli(nCavi, nPorte, nPrese), null)));

  assert.equal(ctx.topology.length, ARCHI, 'la topologia si ferma al tetto');
  assert.deepEqual(ctx.topologyPartial, { shown: ARCHI, of: nCavi },
    'e dichiara quante adiacenze distinte c\'erano DAVVERO — non quante ne ha mostrate');

  const sw = ctx.devices.find(d => d.id === 'sw0');
  assert.equal(sw.ports.list.length, PORTE, 'le porte si fermano al tetto');
  assert.ok(sw.ports.listPartial && sw.ports.listPartial.shown === PORTE,
    'e il taglio si dichiara: ogni porta porta connectedTo, quindi troncare porte tronca CAVI');
  assert.ok(sw.ports.listPartial.of > PORTE, 'con il totale vero, non con quello mostrato');

  const pdu = ctx.devices.find(d => d.id === 'pdu1');
  assert.equal(pdu.outlets.length, PRESE, 'le prese si fermano al tetto');
  assert.deepEqual(pdu.outletsPartial, { shown: PRESE, of: nPrese },
    'e il taglio si dichiara: è la catena di alimentazione, «chi si spegne se muore la PDU»');
});

test('nessun taglio, nessun marcatore: l\'assenza resta il segnale di «completo»', () => {
  const ctx = JSON.parse(JSON.stringify(buildAiContext(projTagli(5, 3, 4), null)));
  assert.equal(ctx.topology.length, 5);
  assert.ok(!('topologyPartial' in ctx), 'niente marcatore quando non si è tagliato niente');
  const sw = ctx.devices.find(d => d.id === 'sw0');
  assert.ok(!('listPartial' in sw.ports), 'idem sulle porte');
  const pdu = ctx.devices.find(d => d.id === 'pdu1');
  assert.ok(!('outletsPartial' in pdu), 'idem sulle prese');
});

test('il modello sa cosa farne: la regola della vista parziale è nel prompt, in due lingue', () => {
  // Una dichiarazione che nessuno insegna a leggere è un campo in più e basta.
  const { buildSystemPrompt } = require('../server/ai/prompt.js');
  // ⚠️ Non basta cercare «Partial»: la prima versione di questa prova passava
  // anche togliendo mezza regola, perché la parola restava nella metà rimasta.
  // Si chiedono TUTTI E TRE i nomi (stanno su righe diverse, quindi toglierne una
  // si vede) e il DIVIETO, che è la parte che cambia il comportamento.
  for (const lang of ['it', 'en']) {
    // ⚠️ La firma e POSIZIONALE — buildSystemPrompt(lang, features, help). Con
    // {lang} usciva sempre ITALIANO, e due prove hanno detto "in due lingue" per
    // due giorni controllando due volte la stessa lingua.
    const p = buildSystemPrompt(lang);
    for (const campo of ['topologyPartial', 'listPartial', 'outletsPartial']) {
      assert.ok(p.includes(campo), lang + ': il prompt deve nominare ' + campo);
    }
    assert.match(p, /(NON rispondere|do NOT answer)/, lang + ': e deve dire cosa NON fare');
  }
});

// ── I tetti sono TARATI sul profilo cliente, e la prova lo dice ─────────────
// Un tetto è un numero, e un numero senza il caso che deve coprire si sposta al
// primo che ha fretta. Qui il caso è scritto: la media impresa mono-sede — ~500
// apparati attivi — documentata BENE, cioè con le prese a muro e i patch panel,
// che è il modo in cui questo prodotto chiede di documentare.
// ⚠️ E quello è il punto che un tetto «500 apparati = 500 archi» sbaglierebbe: un
// percorso fisico qui è una CATENA (apparato → presa → patch panel → switch = TRE
// adiacenze), quindi il documento fatto bene ha il DOPPIO degli archi di quello
// fatto a metà — e verrebbe tagliato proprio lui.
test('tetti: una PMI da profilo cliente, cablata per intero, NON viene troncata', () => {
  const nodes = [], ports = {}, links = [];
  const SW = 12;
  for (let s = 0; s < SW; s++) {
    nodes.push({ id: 'sw' + s, type: 'switch', name: 'SW-' + s, ports: 48 });
    nodes.push({ id: 'pp' + s, type: 'patchpanel', name: 'PP-' + s, ports: 48 });
  }
  for (let i = 0; i < 500; i++) {
    const s = i % SW;
    nodes.push({ id: 'n' + i, type: 'pc', name: 'DEV-' + i });
    nodes.push({ id: 'wp' + i, type: 'wallport', name: 'Presa ' + i, ports: 2 });
    ports['n' + i + '-1'] = { status: 'active' };
    ports['wp' + i + '-1'] = { status: 'active' };
    ports['wp' + i + '-2'] = { status: 'active' };
    ports['pp' + s + '-' + ((i % 40) + 1)] = { status: 'active' };
    ports['sw' + s + '-' + ((i % 40) + 1)] = { status: 'active' };
    links.push({ id: 'La' + i, src: 'n' + i + '-1', dst: 'wp' + i + '-1' });
    links.push({ id: 'Lb' + i, src: 'wp' + i + '-2', dst: 'pp' + s + '-' + ((i % 40) + 1) });
    links.push({ id: 'Lc' + i, src: 'pp' + s + '-' + ((i % 40) + 1), dst: 'sw' + s + '-' + ((i % 40) + 1) });
  }
  const ctx = buildAiContext({ id: 1, name: 'pmi', state: { nodes, ports, links } }, null);
  assert.ok(ctx.topology.length >= 1000, 'la PMI cablata fa ~1024 adiacenze: misurate ' + ctx.topology.length);
  assert.ok(!('topologyPartial' in ctx),
    'e il tetto deve COPRIRLA: se questa prova arrossisce, o la rete tipo è cresciuta o ' +
    'qualcuno ha abbassato MAX_ARCHI_MOSTRATI — in tutt\'e due i casi va deciso, non subito');
});

// ── Il cablaggio passivo esce dalle SCHEDE e resta nel PERCORSO ────────────
// Prese a muro e patch panel sono metà del documento di una rete cablata bene, e
// la loro scheda è quasi vuota per disegno (niente IP, MAC, VLAN). Al modello
// servono come TAPPE di un percorso, non come apparati: i nomi restano nella
// topologia, le schede no. Misurato sulla PMI di prova: 335 → 146 KB, il 56% in
// meno, e delle venti domande d'esercizio se ne perde UNA (su che bandella del
// patch panel passa un cavo).
// ⚠️ E il riassunto DICHIARA di essere un riassunto: senza quella riga il modello
// legge «516 apparati» e conclude che gli altri non esistono — che è peggio del
// non saperlo, perché è una risposta invece di una domanda.
function pmiCablata(quantiEndpoint) {
  const nodes = [{ id: 'sw0', type: 'switch', name: 'SW-0', ports: 48 }];
  const ports = {}, links = [];
  nodes.push({ id: 'pp0', type: 'patchpanel', name: 'PP-0', ports: 48 });
  for (let i = 0; i < quantiEndpoint; i++) {
    nodes.push({ id: 'n' + i, type: 'pc', name: 'DEV-' + i });
    nodes.push({ id: 'wp' + i, type: 'wallport', name: 'Presa ' + i, ports: 2 });
    ports['n' + i + '-1'] = { status: 'active' };
    ports['wp' + i + '-1'] = { status: 'active' };
    ports['wp' + i + '-2'] = { status: 'active' };
    ports['pp0-' + (i + 1)] = { status: 'active' };
    ports['sw0-' + (i + 1)] = { status: 'active' };
    links.push({ id: 'a' + i, src: 'n' + i + '-1', dst: 'wp' + i + '-1' });
    links.push({ id: 'b' + i, src: 'wp' + i + '-2', dst: 'pp0-' + (i + 1) });
    links.push({ id: 'c' + i, src: 'pp0-' + (i + 1), dst: 'sw0-' + (i + 1) });
  }
  return { id: 1, name: 'pmi', state: { nodes, ports, links } };
}

test('passivi: sopra soglia le schede si riassumono, e i nomi restano nel percorso', () => {
  const ctx = buildAiContext(pmiCablata(60), null);
  const nomi = (ctx.devices || []).map((d) => d.name);
  assert.ok(!nomi.includes('Presa 3'), 'la scheda della presa non esce piu');
  assert.ok(!nomi.includes('PP-0'), 'ne quella del patch panel');
  assert.ok(nomi.includes('SW-0'), 'gli apparati veri restano interi');

  assert.ok(ctx.passiveCabling, 'e il riassunto c\'e\'');
  assert.equal(ctx.passiveCabling.summarised, 61, '60 prese + 1 patch panel');
  assert.deepEqual(ctx.passiveCabling.byType, { wallport: 60, patchpanel: 1 });
  assert.match(ctx.passiveCabling.note, /topology/,
    'e DICE dove sono finiti: un riassunto muto si legge come «non esistono»');

  // ⭐ La proprieta' che rende il taglio accettabile: il PERCORSO si legge ancora.
  const archi = ctx.topology || [];
  const tappe = (nome) => archi.some((e) => e.a === nome || e.b === nome);
  assert.ok(tappe('Presa 3') && tappe('PP-0'),
    'le tappe restano in topologia: senza, un percorso si spezza e si perde il senso del taglio');
});

test('passivi: sotto soglia non si riassume niente — un risparmio nullo e\' solo una perdita', () => {
  const ctx = buildAiContext(pmiCablata(5), null);
  const nomi = (ctx.devices || []).map((d) => d.name);
  assert.ok(nomi.includes('Presa 3'), 'su una rete piccola il dettaglio costa niente e resta');
  assert.ok(!('passiveCabling' in ctx), 'e non si dichiara un riassunto che non c\'e\'');
});

test('passivi: il modello sa cosa puo\' e cosa non puo\' rispondere, in due lingue', () => {
  // ⚠️ Si chiede un pezzo di OGNI riga della regola, non una parola sola: la
  // prima versione cercava «bandella» e restava verde anche togliendo l'ultima
  // riga, perche quella parola stava in quella prima. E' la seconda volta in due
  // giorni che una prova sul prompt passa su meta' regola.
  const { buildSystemPrompt } = require('../server/ai/prompt.js');
  const PEZZI = {
    it: ['passiveCabling', 'NON sono nel context', 'restano in "topology"', 'bandella', 'Dillo e offri'],
    en: ['passiveCabling', 'are not in the context', 'stay in "topology"', 'position', 'Say so'],
  };
  for (const lang of ['it', 'en']) {
    const p = buildSystemPrompt(lang);
    for (const pezzo of PEZZI[lang]) {
      assert.ok(p.includes(pezzo), lang + ': manca dalla regola del cablaggio passivo -> ' + pezzo);
    }
  }
});
