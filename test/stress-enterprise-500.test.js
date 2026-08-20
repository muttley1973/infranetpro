'use strict';
// ============================================================================
// STRESS TEST — ENTERPRISE 500  (tenuta JSON su rete reale arricchita)
// ----------------------------------------------------------------------------
// Base regression che simula una rete aziendale VERA e ne verifica la TENUTA
// DEL JSON attraverso tutte le funzioni recenti:
//   - migrazione client REALE (_migrateState): re-ID nodi non-canonici + LAG
//     remap (regressione ab6e04d: LAG persi al load).
//   - "Applica modello" reale (applyTemplateToNode) dal catalogo device-type:
//     clamp altezza al rack (M12), split fibra (porte SFP ≠ rame), fiberDropped
//     oltre cap 48/blocco (M10).
//   - hw-capabilities sulla flotta arricchita (PoE/power/compute/wlc/wireless/
//     banda-LAG + riepilogo flotta).
//   - guardia ANTI-LEAK: buildAiContext non fa MAI trapelare community/apiKey/
//     password/driver/host, ma espone le capacità legittime.
//   - store atomico (saveProject/loadProject): round-trip + .bak + recupero da
//     JSON troncato; re-migrazione idempotente.
//
// FIXTURE: il generatore 500-nodi (tools/gen-enterprise-500.js) è GITIGNORED →
// se presente si usa quello (scala reale 500 nodi sulla macchina di sviluppo),
// altrimenti si costruisce una mini-enterprise self-contained (CI/checkout
// pulito). Le asserzioni sono RELATIVE alla baseline della fixture caricata
// (nessun 500/44 hardcoded) → il test regge con entrambe.
// Il catalogo device-type (data/device-types.json) è invece TRACCIATO → usato
// ovunque per "Applica modello".
// ============================================================================
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isola lo store su una dir temporanea PRIMA di require('projects-store').
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-stress-'));
process.env.INFRANET_PROJECTS_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const hw = require('../lib/hw-capabilities.js');
const { frontPanelSfpGroups } = require('../lib/frontpanel.js');
const aictx = require('../server/ai/context.js');
const ipam = require('../lib/ipam.js');
const apiShape = require('../lib/api-shape.js');
const pnet = require('../lib/project-networks.js');
const drift = require('../lib/drift-snapshot.js');
const lagAudit = require('../lib/lag-audit.js');
const store = require('../server/projects-store.js');
const catalog = require('../data/device-types.json');
const ROOT = path.join(__dirname, '..');

// ── helper integrità ─────────────────────────────────────────────────────────
function pidToNode(pid, nodeIdSet) {
  const parts = String(pid).split('-');
  for (let i = parts.length - 1; i >= 1; i--) {
    const cand = parts.slice(0, i).join('-');
    if (nodeIdSet.has(cand)) return cand;
  }
  return null;
}
const MAC_RE = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function ipValid(ip) { const m = IP_RE.exec(String(ip)); return !!m && m.slice(1).every(o => +o >= 0 && +o <= 255); }

function integrity(s) {
  const nodes = s.nodes || [], links = s.links || [], ports = s.ports || {};
  const nodeIds = new Set(nodes.map(n => n.id));
  const rackIds = new Set((s.racks || []).map(r => r.id));
  const rackU = {}; (s.racks || []).forEach(r => { rackU[r.id] = r.sizeU || 42; });
  const lagKeys = new Set(Object.keys(s.lagGroups || {}));
  let badLink = 0;
  for (const l of links) for (const ep of [l.src, l.dst, l.a, l.b, l.from, l.to].filter(Boolean)) if (!pidToNode(ep, nodeIds)) badLink++;
  let badPort = 0;
  for (const pid of Object.keys(ports)) if (!pidToNode(pid, nodeIds)) badPort++;
  let badRack = 0;
  for (const n of nodes) if (n.rackId && !rackIds.has(n.rackId)) badRack++;
  let overflow = 0;
  for (const n of nodes) { if (!n.rackId || !rackU[n.rackId]) continue; const pos = n.rackU || 1, h = n.sizeU || 1; if (pos < 1 || pos + h - 1 > rackU[n.rackId]) overflow++; }
  let danglingMembers = 0; const referenced = new Set();
  for (const p of Object.values(ports)) if (p && p.lagGroup) { referenced.add(p.lagGroup); if (!lagKeys.has(p.lagGroup)) danglingMembers++; }
  let orphanGroups = 0; for (const k of lagKeys) if (!referenced.has(k)) orphanGroups++;
  let badMac = 0, badIp = 0;
  for (const n of nodes) { if (n.ip && !ipValid(n.ip)) badIp++; if (n.mac && !MAC_RE.test(n.mac)) badMac++; }
  let rtStable = false;
  try { rtStable = JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s); } catch (_) {}
  return { nodes: nodes.length, links: links.length, ports: Object.keys(ports).length,
    lagGroups: lagKeys.size, badLink, badPort, badRack, overflow, danglingMembers, orphanGroups, badMac, badIp, rtStable };
}
function assertClean(t, r) {
  assert.equal(r.badLink, 0, 'link endpoints dangling');
  assert.equal(r.badPort, 0, 'port pid dangling');
  assert.equal(r.badRack, 0, 'rackId inesistente');
  assert.equal(r.overflow, 0, 'device fuori dal telaio (rack bounds)');
  assert.equal(r.danglingMembers, 0, 'membri LAG dangling');
  assert.equal(r.orphanGroups, 0, 'gruppi LAG orfani');
  assert.equal(r.badMac, 0, 'MAC malformati');
  assert.equal(r.badIp, 0, 'IP malformati');
  assert.ok(r.rtStable, 'JSON round-trip non stabile');
}

// applyTemplateToNode — LOGICA IDENTICA a src/app-device-types.js (M12 clamp).
function applyTemplateToNode(node, tmpl, rackTotalU) {
  if (!node || !tmpl) return false;
  node.ports = tmpl.ports;
  node.frontPanel = Object.assign({}, tmpl.frontPanel || {});
  if (tmpl.brand) node.brand = tmpl.brand;
  if (tmpl.model) node.model = tmpl.model;
  if (tmpl.rackU) {
    node.sizeU = rackTotalU ? Math.max(1, Math.min(tmpl.rackU, rackTotalU)) : Math.max(1, tmpl.rackU);
    if (rackTotalU) node.rackU = Math.max(1, Math.min(node.rackU || 1, rackTotalU - node.sizeU + 1));
  }
  return true;
}

// ── FIXTURE: generatore gitignored se presente, altrimenti mini self-contained ─
function loadFixture() {
  try {
    const gen = require('../tools/gen-enterprise-500.js');   // gitignored → assente su CI
    if (gen && typeof gen.buildEnterpriseState === 'function') {
      return { label: 'ENTERPRISE 500 (generatore)', state: gen.buildEnterpriseState() };
    }
  } catch (_) { /* assente → fallback */ }
  return { label: 'mini-enterprise (fallback self-contained)', state: buildMiniEnterprise() };
}

// Mini-enterprise deterministica: ~34 nodi, ID NON canonici (core1/acc1a/edge…),
// LAG in formato lag-<id>-poN (2 membri) → riproduce le STRUTTURE che contano
// (re-ID + LAG remap, apply-model, hw-caps, store). Zero dipendenze gitignored.
function buildMiniEnterprise() {
  let _mac = 0x1000; const OUI = '02:1a:2b';
  const mac = () => { _mac += 7; return `${OUI}:40:${((_mac >> 8) & 0xff).toString(16).padStart(2, '0')}:${(_mac & 0xff).toString(16).padStart(2, '0')}`; };
  let _ip = 10; const ip = () => `10.10.10.${++_ip}`;
  const state = {
    vlanColors: { 10: '#00d4ff', 20: '#39d353' }, vlanNames: { 10: 'Mgmt', 20: 'Dati' },
    guestVlans: [40], voiceVlans: [30], mgmtVlans: [10],
    ipam: { vlans: { 10: { subnet: '10.10.10.0/24', gateway: '10.10.10.1', dns: '10.10.10.1' }, 20: { subnet: '10.10.20.0/24', gateway: '10.10.20.1' } } },
    racks: [{ id: 'rk-mdf', name: 'MDF', sizeU: 42 }, { id: 'rk-idf1', name: 'IDF1', sizeU: 24 }],
    currentRack: 'rk-mdf', lagGroups: {}, nodes: [], links: [], ports: {},
  };
  const rackTop = { 'rk-mdf': 42, 'rk-idf1': 24 };
  function rackDev(rackId, id, type, name, sizeU, ports, managed) {
    const rackU = rackTop[rackId] - sizeU + 1; rackTop[rackId] -= sizeU;
    const n = { id, type, name, brand: 'Acme', rackId, rackU, sizeU, ports };
    if (managed) { n.mac = mac(); n.ip = ip(); n.integration = { driver: 'snmp-v2c', host: n.ip, community: 'public' }; }
    state.nodes.push(n); return n;
  }
  let _lid = 0; const link = (a, b) => state.links.push({ id: 'l' + (++_lid), src: a, dst: b });
  const port = (pid, cfg) => { state.ports[pid] = Object.assign(state.ports[pid] || {}, cfg); };
  let _po = 0;
  function lagBundle(aId, aStart, bId, bStart, ten) {
    _po++; const poName = 'Port-channel' + _po;
    const gA = `lag-${aId}-po${_po}`, gB = `lag-${bId}-po${_po}`;
    state.lagGroups[gA] = poName; state.lagGroups[gB] = poName;
    for (let k = 0; k < 2; k++) {
      const pa = `${aId}-${aStart + k}`, pb = `${bId}-${bStart + k}`;
      port(pa, { status: 'active', mode: 'trunk', trunkVlans: [10, 20], vlanOvr: 99, isTrunk: true, speed: ten ? 10000 : 1000, lagGroup: gA, lagId: _po, mac: mac() });
      port(pb, { status: 'active', mode: 'trunk', trunkVlans: [10, 20], vlanOvr: 99, isTrunk: true, speed: ten ? 10000 : 1000, lagGroup: gB, lagId: _po, mac: mac() });
      link(pa, pb);
    }
  }
  // MDF
  rackDev('rk-mdf', 'core1', 'switch', 'CORE-1', 1, 48, true);
  rackDev('rk-mdf', 'core2', 'switch', 'CORE-2', 1, 48, true);
  rackDev('rk-mdf', 'dist1', 'switch', 'DIST-1', 1, 48, true);
  rackDev('rk-mdf', 'edge', 'router', 'EDGE', 1, 8, true);
  rackDev('rk-mdf', 'fw1', 'firewall', 'FW-1', 1, 10, true);
  rackDev('rk-mdf', 'fw2', 'firewall', 'FW-2', 1, 10, true);
  rackDev('rk-mdf', 'srv1', 'server', 'ESXi-1', 2, 4, true);
  rackDev('rk-mdf', 'srv2', 'server', 'ESXi-2', 2, 4, true);
  rackDev('rk-mdf', 'nas1', 'nas', 'NAS-1', 2, 4, true);
  rackDev('rk-mdf', 'wlc1', 'wlanctrl', 'WLC', 1, 4, true);
  rackDev('rk-mdf', 'ups1', 'ups', 'UPS-MDF', 3, 1, true);
  rackDev('rk-mdf', 'pp1', 'patchpanel', 'PP-MDF', 2, 24, false);
  // IDF
  rackDev('rk-idf1', 'acc1a', 'switch', 'ACC-1A', 1, 48, true);
  rackDev('rk-idf1', 'acc1b', 'switch', 'ACC-1B', 1, 48, true);
  rackDev('rk-idf1', 'ups2', 'ups', 'UPS-IDF', 2, 1, true);
  // LAG dorsale (formato lag-<id>-poN)
  lagBundle('core1', 1, 'core2', 1, true);
  lagBundle('core1', 3, 'dist1', 1, true);
  lagBundle('dist1', 3, 'acc1a', 1, true);
  lagBundle('acc1a', 3, 'acc1b', 1, false);
  lagBundle('srv1', 1, 'dist1', 5, true);   // NIC teaming server
  // AP con radio + uplink trunk verso acc1a
  let _ap = 0;
  function makeAP(id) {
    _ap++;
    const radios = [
      { band: '2.4', standard: 'wifi6', ssids: [{ id: `s${_ap}a`, ssid: 'Corp', vlan: 20 }, { id: `s${_ap}g`, ssid: 'Guest', vlan: 40 }] },
      { band: '5', standard: 'wifi6', ssids: [{ id: `s${_ap}b`, ssid: 'Corp', vlan: 20 }] },
    ];
    state.nodes.push({ id, type: 'ap', name: id.toUpperCase(), brand: 'Acme', x: 100 + _ap * 60, y: 100, ports: 1, ip: ip(), mac: mac(), integration: { driver: 'snmp-v2c', host: '10.10.10.9', community: 'public' }, radios });
    port(`${id}-1`, { status: 'active', mode: 'trunk', trunkVlans: [10, 20, 40], vlanOvr: 10, isTrunk: true, mac: mac() });
  }
  makeAP('ap1'); makeAP('ap2');
  // endpoint floor: PC + VoIP (access)
  for (let i = 1; i <= 8; i++) { const id = `pc${i}`; state.nodes.push({ id, type: 'pc', name: 'PC-' + i, brand: 'Dell', x: 100 + i * 40, y: 300, ports: 1, mac: mac(), ip: ip() }); port(`${id}-1`, { status: 'active', vlan: 20 }); }
  for (let i = 1; i <= 4; i++) { const id = `voip${i}`; state.nodes.push({ id, type: 'voip', name: 'TEL-' + i, brand: 'Acme', x: 100 + i * 40, y: 360, ports: 1, mac: mac(), ip: ip(), voiceVlan: 30 }); port(`${id}-1`, { status: 'active', vlan: 30 }); }
  return state;
}

// ── PIPELINE (calcolata UNA volta, memoizzata) ───────────────────────────────
let S = null, SETUP_ERR = null;
function buildAll() {
  if (S) return S;
  const APP = loadApp(ROOT);
  const ctx = APP.ctx;
  const fixture = loadFixture();
  const rawState = JSON.parse(JSON.stringify(fixture.state));

  // migrazione client reale (import → re-ID + LAG remap)
  run(ctx, 'state = ' + JSON.stringify(fixture.state) + ';');
  run(ctx, 'if(typeof _migrateState==="function") _migrateState(state); if(typeof _invalidateIdx==="function") _invalidateIdx();');
  const migrated = JSON.parse(run(ctx, 'JSON.stringify(state)'));
  const base = { nodes: migrated.nodes.length, links: migrated.links.length, ports: Object.keys(migrated.ports).length, lags: Object.keys(migrated.lagGroups).length };

  // apply-model reale sui switch
  const racksById = {}; (migrated.racks || []).forEach(r => { racksById[r.id] = r.sizeU || 42; });
  const rackSize = n => (n.rackId ? (racksById[n.rackId] || 0) : 0);
  const denseFibre = catalog.filter(c => c.counts && c.counts.fiberDropped > 0).sort((a, b) => b.counts.fiberDropped - a.counts.fiberDropped)[0];
  const bigSfp = catalog.filter(c => c.frontPanel && c.frontPanel.separateSfp && (c.frontPanel.sfpCount || 0) >= 40 && (!c.counts || !c.counts.fiberDropped)).sort((a, b) => (b.frontPanel.sfpCount) - (a.frontPanel.sfpCount))[0];
  const copperPoe = catalog.filter(c => c.counts && c.counts.copper >= 44).sort((a, b) => b.counts.copper - a.counts.copper)[0];
  const tall = catalog.filter(c => (c.rackU || 1) >= 6).sort((a, b) => (b.rackU) - (a.rackU))[0];
  const models = [denseFibre, bigSfp, copperPoe].filter(Boolean);
  const switches = migrated.nodes.filter(n => n.type === 'switch');
  switches.forEach((sw, i) => applyTemplateToNode(sw, models[i % models.length], rackSize(sw)));

  // M12: clamp esplicito — modello alto in cima + modello > rack
  const clampNode = switches.find(n => n.rackId) || switches[0];
  const clamp = {};
  if (clampNode && tall) {
    clampNode.rackU = Math.max(1, rackSize(clampNode) - 1);
    applyTemplateToNode(clampNode, tall, rackSize(clampNode));
    clamp.tall = { rackU: clampNode.rackU, sizeU: clampNode.sizeU, rack: rackSize(clampNode), id: clampNode.id };
    const c2 = switches.find(n => n.rackId && n !== clampNode) || clampNode;
    applyTemplateToNode(c2, { ports: 48, rackU: 999, brand: 'X', model: 'GIANT', frontPanel: {} }, rackSize(c2));
    clamp.giant = { rackU: c2.rackU, sizeU: c2.sizeU, rack: rackSize(c2) };
  }

  // split fibra + SFP entro pannello (frontpanel reale)
  let sfpOverCap = 0, fibreSample = null;
  for (const sw of switches) {
    const groups = frontPanelSfpGroups({ type: 'switch', frontPanel: sw.frontPanel }, sw.ports, true);
    const sfpPorts = groups.reduce((a, g) => a + g.ports.length, 0);
    for (const g of groups) for (const p of g.ports) if (p < 1 || p > sw.ports) sfpOverCap++;
    if (!fibreSample && sfpPorts > 0) fibreSample = { sfpPorts, portCount: sw.ports, blocks: groups.length };
  }

  // spec documentate (come un admin reale)
  const portsByNode = {};
  { const ids = new Set(migrated.nodes.map(n => n.id)); for (const pid of Object.keys(migrated.ports)) { const nid = pidToNode(pid, ids); if (nid) (portsByNode[nid] || (portsByNode[nid] = [])).push(pid); } }
  for (const sw of switches) {
    sw.spec = Object.assign({}, sw.spec, { swPoeBudgetW: 740 });
    (portsByNode[sw.id] || []).slice(0, 24).forEach(pid => { migrated.ports[pid].poe = '802.3at'; });
  }
  // over-subscrizione informativa: un switch con porte PoE → headroom negativo
  const overSw = switches.find(sw => (portsByNode[sw.id] || []).some(pid => migrated.ports[pid].poe));
  if (overSw) overSw.spec.swPoeBudgetW = 30;
  const ofType = t => migrated.nodes.filter(n => n.type === t);
  ofType('ups').forEach(u => { u.spec = Object.assign({}, u.spec, { upsVa: 3000, upsW: 2700, upsAutonomyMin: 12, upsTopology: 'online' }); });
  // Anche le barre e gli ATS: il blocco `power` esce per tutte e tre le classi,
  // e una fixture che documenta solo gli UPS non lo mette alla prova.
  ofType('pdu').forEach(p => { p.spec = Object.assign({}, p.spec, { pduPhase: 'single', pduCurrentA: 32, pduOutletCount: 24 }); });
  ofType('ats').forEach(a => { a.spec = Object.assign({}, a.spec, { atsInputV: 230, atsCurrentA: 16, atsOutletCount: 8 }); });
  ofType('server').forEach(s => { s.spec = Object.assign({}, s.spec, { srvCpu: 'Xeon Silver 4310', srvRamGb: 128, srvStorageTb: 4, srvOs: 'Ubuntu 22.04' }); });
  ofType('nas').forEach(s => { s.spec = Object.assign({}, s.spec, { nasCapacityTb: 48, nasRaid: 'RAID6', nasPlatform: 'Synology DSM' }); });
  ofType('firewall').forEach(s => { s.spec = Object.assign({}, s.spec, { fwThroughputMbps: 10000 }); });
  ofType('wlanctrl').forEach(s => { s.spec = Object.assign({}, s.spec, { apManaged: 24, apCapacity: 100, wlcPlatform: 'Cisco 9800' }); });
  ofType('ap').forEach(ap => { if (!Array.isArray(ap.radios) || !ap.radios.length) ap.radios = [{ band: '2.4', ssids: [{ id: 'c', ssid: 'Corp', vlan: 20 }] }, { band: '5', ssids: [{ id: 'g', ssid: 'Guest', vlan: 40 }] }]; });

  const enrichCounts = {
    switchesPoe: switches.filter(sw => (portsByNode[sw.id] || []).some(pid => migrated.ports[pid].poe)).length,
    // Un blocco `power` esce per UPS, PDU **e** ATS (lib/hw-capabilities.js
    // `_power`): contare i soli UPS reggeva finche' la fixture non documentava
    // nessun campo di alimentazione sulle barre, cioe' per un fatto della
    // FIXTURE e non per un invariante dell'app (audit 2026-08-18, T1).
    ups: ofType('ups').length, servers: ofType('server').length, nas: ofType('nas').length,
    powerDevices: ofType('ups').length + ofType('pdu').length + ofType('ats').length,
    firewalls: ofType('firewall').length, wlanctrl: ofType('wlanctrl').length,
    apsWithRadios: ofType('ap').filter(a => Array.isArray(a.radios) && a.radios.length).length,
  };

  // hw-capabilities per device
  function portListOf(nodeId) { return (portsByNode[nodeId] || []).map(pid => { const p = migrated.ports[pid]; return { speed: p.speed, status: p.status, lagGroup: p.lagGroup, poe: p.poe }; }); }
  const caps = { poe: 0, negHeadroom: 0, power: 0, compute: 0, wlc: 0, wireless: 0, lagBand: 0, list: [] };
  for (const n of migrated.nodes) {
    const list = portListOf(n.id);
    const cap = hw.computeDeviceCapabilities({ type: n.type, spec: n.spec, radios: n.radios, vmsCount: Array.isArray(n.vms) ? n.vms.length : 0, ports: list.length ? { total: list.length, free: list.filter(p => p.status !== 'active').length, list } : undefined, lagNames: migrated.lagGroups, lagModes: migrated.lagModes });
    caps.list.push(cap);
    if (!cap) continue;
    if (cap.poe) { caps.poe++; if (cap.poe.headroomW < 0) caps.negHeadroom++; }
    if (cap.power) caps.power++;
    if (cap.compute) caps.compute++;
    if (cap.wlc) caps.wlc++;
    if (cap.wireless) caps.wireless++;
    if (cap.ports && cap.ports.lags && cap.ports.lagAggregateMbps) caps.lagBand++;
  }
  const fleet = hw.computeFleetCapabilities(caps.list);

  // guardia anti-leak
  const SECRETS = ['ZZSECRETCOMMZZ', 'ZZSECRETKEYZZ', 'ZZSECRETPWZZ', 'ZZDRIVERZZ', '198.51.100.77'];
  const leakState = JSON.parse(JSON.stringify(migrated));
  const victim = leakState.nodes.find(n => n.type === 'switch');
  victim.spec = Object.assign({}, victim.spec, { community: 'ZZSECRETCOMMZZ', apiKey: 'ZZSECRETKEYZZ', swPoeBudgetW: 740 });
  victim.integration = { host: '198.51.100.77', driver: 'ZZDRIVERZZ', community: 'ZZSECRETCOMMZZ', password: 'ZZSECRETPWZZ' };
  const context = aictx.buildAiContext({ id: 9, name: 'stress', state: leakState }, {}, { devices: true, ports: true, snmpHealth: true, topology: true });
  const ctxStr = JSON.stringify(context);
  const victimDev = (context.devices || []).find(d => d.id === victim.id || d.name === victim.name);

  // store atomico: round-trip + .bak + recupero
  const saveState = JSON.parse(JSON.stringify(migrated)); saveState.bgImage = null; delete saveState.bgImageAsset; delete saveState.bgImageHash;
  store.saveProject(9, 'stress', saveState, '2026-01-01T00:00:00Z', '2026-01-01T10:00:00Z');
  const loaded = store.loadProject(9);
  const ls = loaded && loaded.state;
  store.saveProject(9, 'stress', saveState, '2026-01-01T00:00:00Z', '2026-01-01T11:00:00Z');   // v2 → .bak = v1
  const bakExists = fs.existsSync(path.join(TMP, '9.json.bak'));
  fs.writeFileSync(path.join(TMP, '9.json'), '{ "id":9, "name":"trunc', 'utf8');               // corrompi principale
  const recovered = store.loadProject(9);

  // re-migrazione idempotente
  run(ctx, 'state = ' + JSON.stringify(ls) + '; if(typeof _migrateState==="function") _migrateState(state); if(typeof _invalidateIdx==="function") _invalidateIdx();');
  const remig = JSON.parse(run(ctx, 'JSON.stringify(state)'));

  S = {
    label: fixture.label, rawState, migrated, base, switches, clamp, sfpOverCap, fibreSample,
    denseFibre, enrichCounts, caps, fleet, SECRETS, ctxStr, victimDev, ls, remig, bakExists, recovered,
  };
  return S;
}

try { buildAll(); } catch (e) { SETUP_ERR = e; }

test.after(() => { try { for (const f of fs.readdirSync(TMP)) fs.unlinkSync(path.join(TMP, f)); fs.rmdirSync(TMP); } catch (_) { /* best-effort */ } });

// ── TEST ─────────────────────────────────────────────────────────────────────
test('setup: pipeline stress costruita senza errori', () => {
  assert.equal(SETUP_ERR, null, SETUP_ERR && (SETUP_ERR.stack || String(SETUP_ERR)));
  assert.ok(S && S.migrated && S.migrated.nodes.length > 0);
  console.log(`     fixture: ${S.label} — ${S.base.nodes} nodi · ${S.base.links} link · ${S.base.ports} porte · ${S.base.lags} chiavi-LAG`);
});

test('F0 — integrità di base dello scheletro grezzo', () => {
  assertClean(assert, integrity(S.rawState));
});

test('F0b — migrazione client: re-ID non-canonico + LAG remap (ab6e04d)', () => {
  assert.notEqual(S.rawState.nodes[0].id, S.migrated.nodes[0].id, 'atteso re-ID degli ID non canonici');
  const m = integrity(S.migrated);
  assert.equal(m.nodes, S.rawState.nodes.length, 'nodi persi nella migrazione');
  assert.equal(m.links, S.rawState.links.length, 'link persi nella migrazione');
  assert.equal(m.ports, Object.keys(S.rawState.ports).length, 'porte perse nella migrazione');
  assert.ok(m.lagGroups > 0, 'la fixture deve avere LAG');
  assert.equal(m.danglingMembers, 0, 'LAG membri dangling dopo re-ID (regressione ab6e04d)');
  assert.equal(m.orphanGroups, 0, 'LAG gruppi orfani dopo re-ID (regressione ab6e04d)');
  assertClean(assert, m);
});

test('F1 — Applica modello: catalogo reale copre fibra-densa/SFP/rame/alto', () => {
  assert.ok(S.denseFibre && S.denseFibre.counts.fiberDropped > 0, 'nessun modello fibra-densa nel catalogo');
  assert.ok(S.switches.length > 0, 'la fixture deve avere switch');
});

test('F1 — M12: clamp altezza al rack (modello alto e modello > rack restano nel telaio)', () => {
  if (!S.clamp.tall) return;   // fixture senza switch in rack
  const t = S.clamp.tall;
  assert.ok(t.rackU >= 1 && t.rackU + t.sizeU - 1 <= t.rack, `modello alto fuori dal telaio: rackU=${t.rackU} sizeU=${t.sizeU} rack=${t.rack}`);
  assert.ok(t.sizeU >= 1 && t.sizeU <= t.rack, 'altezza = sizeU (non rackU): il device non deve svanire');
  const g = S.clamp.giant;
  assert.equal(g.sizeU, g.rack, 'modello 999U: sizeU clampato all altezza del rack');
  assert.equal(g.rackU, 1, 'modello 999U: posizione clampata a 1');
  assert.equal(g.rackU + g.sizeU - 1, g.rack, 'modello 999U: occupa esattamente il telaio');
});

test('F1 — split fibra: porte SFP rese come fibra, mai fuori dal pannello (87f961e/cap 48)', () => {
  assert.equal(S.sfpOverCap, 0, 'porta SFP fuori range 1..portCount');
  assert.ok(S.fibreSample, 'nessuno switch con blocco SFP (fibra) reso');
  assert.ok(S.fibreSample.sfpPorts <= S.fibreSample.portCount, 'più porte SFP delle porte totali');
});

test('F2 — hw-capabilities: blocchi capacità emessi coerentemente con la flotta arricchita', () => {
  const c = S.caps, e = S.enrichCounts;
  assert.equal(c.poe, e.switchesPoe, 'un blocco PoE per switch con budget+porte PoE');
  assert.ok(c.negHeadroom >= 1, 'atteso ≥1 switch con headroom PoE negativo (sovra-sottoscrizione)');
  assert.equal(c.power, e.powerDevices, 'un blocco power per ogni UPS, barra e ATS documentati');
  assert.equal(c.compute, e.servers, 'un blocco compute per server');
  assert.equal(c.wlc, e.wlanctrl, 'un blocco WLC per controller');
  assert.equal(c.wireless, e.apsWithRadios, 'un blocco wireless per AP con radio');
  assert.ok(c.lagBand >= 1, 'attesa ≥1 banda LAG aggregata');
  assert.ok(S.fleet && Object.keys(S.fleet).length > 0, 'riepilogo flotta vuoto');
});

test('F2 — motori reali: nessun throw sulla flotta arricchita', () => {
  assert.doesNotThrow(() => ipam.computeIpamUsage(S.migrated), 'IPAM');
  assert.doesNotThrow(() => apiShape.projectToInventory({ id: 9, name: 's', state: S.migrated }), 'projectToInventory');
  assert.doesNotThrow(() => apiShape.toAnsibleInventory(apiShape.projectToDevices({ id: 9, name: 's', state: S.migrated })), 'toAnsibleInventory');
  assert.doesNotThrow(() => pnet.deriveProjectNetworks(S.migrated), 'deriveProjectNetworks');
  assert.doesNotThrow(() => drift.buildDocSnapshot(S.migrated), 'buildDocSnapshot');
  assert.doesNotThrow(() => {
    for (const key of Object.keys(S.migrated.lagGroups)) {
      const members = Object.entries(S.migrated.ports).filter(([, p]) => p.lagGroup === key).map(([pid, p]) => Object.assign({ pid }, p));
      lagAudit.checkLagMembers(members);
    }
  }, 'checkLagMembers');
});

test('F2b — ANTI-LEAK: nessun segreto nel contesto AI, ma capacità legittime presenti', () => {
  for (const sec of S.SECRETS) assert.ok(S.ctxStr.indexOf(sec) < 0, `marcatore segreto trapelato nel contesto: ${sec}`);
  assert.ok(!/"(community|apiKey|password)"\s*:/.test(S.ctxStr), 'chiave community/apiKey/password presente nel contesto');
  assert.ok(S.victimDev && S.victimDev.capabilities && S.victimDev.capabilities.poe && S.victimDev.capabilities.poe.budgetW === 740, 'capacità legittime (poe.budgetW) assenti dal device vittima');
});

test('F3 — tenuta store: saveProject/loadProject preserva conteggi, LAG, modelli e spec', () => {
  assert.ok(S.ls, 'loadProject non ha restituito lo stato');
  const li = integrity(S.ls);
  assert.equal(li.nodes, S.base.nodes, 'nodi persi nel round-trip store');
  assert.equal(li.links, S.base.links, 'link persi nel round-trip store');
  assert.equal(li.ports, S.base.ports, 'porte perse nel round-trip store');
  assert.equal(li.lagGroups, S.base.lags, 'chiavi-LAG perse nel round-trip store');
  assert.equal(li.danglingMembers, 0, 'membri LAG dangling dopo il round-trip');
  assert.equal(li.orphanGroups, 0, 'gruppi LAG orfani dopo il round-trip');
  assertClean(assert, li);
  const srv = S.ls.nodes.find(n => n.type === 'server');
  assert.ok(srv && srv.spec && srv.spec.srvRamGb === 128, 'spec server non sopravvissuta');
  const poeSw = S.ls.nodes.find(n => n.spec && n.spec.swPoeBudgetW);
  assert.ok(poeSw, 'spec PoE non sopravvissuta');
});

test('F3 — re-migrazione idempotente: conteggi e LAG invariati, nessun re-ID ulteriore', () => {
  const ri = integrity(S.remig);
  assert.equal(ri.nodes, S.base.nodes);
  assert.equal(ri.links, S.base.links);
  assert.equal(ri.ports, S.base.ports);
  assert.equal(ri.lagGroups, S.base.lags);
  assert.equal(ri.danglingMembers, 0, 'LAG rotti dalla seconda migrazione');
  assert.equal(ri.orphanGroups, 0);
  assert.equal(S.ls.nodes[0].id, S.remig.nodes[0].id, 'ID già canonici: la seconda migrazione non deve rinominare');
});

test('F3b — durabilità: .bak al secondo salvataggio + recupero da JSON troncato', () => {
  assert.ok(S.bakExists, '.bak non creato al secondo salvataggio');
  assert.ok(S.recovered && S.recovered.state && Array.isArray(S.recovered.state.nodes), 'nessun recupero dopo corruzione del file principale');
  assert.equal(S.recovered.state.nodes.length, S.base.nodes, 'recupero dal .bak incompleto');
});
