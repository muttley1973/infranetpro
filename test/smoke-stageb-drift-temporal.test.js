'use strict';
// ============================================================================
// SMOKE — STAGE B (Verifica → Panoramica «Vero») su ENTERPRISE-500
// ----------------------------------------------------------------------------
// Verifica le implementazioni recenti sui MOTORI PURI, a scala reale (500 nodi
// se il generatore gitignored è presente, altrimenti mini-enterprise self-
// contained), con particolare attenzione a:
//   1. DRIFT NEL TEMPO — una sequenza di "letture" (T0 baseline → T4 recupero)
//      con VARIAZIONI DI RETE simulate: porta che cambia stato, device non
//      documentato, cambio IP (stesso MAC), identità hardware sostituita, e le
//      due categorie che MATURANO col tempo (cavo fantasma + assente via porta-
//      down streak >= N). Ad ogni T si verifica che il Drift rilevi la cosa giusta.
//   2. CONFIDENCE TEMPORALE — score/tier che evolvono nel tempo (fresh → recurring
//      → established → stable) e DECADONO (stale) al non-più-visto; aggregazione.
//   3. PANORAMICA «Vero» (Fase 2) — buildOverview con report VIVO (driftLive) +
//      Verifica persistita (lastVerify) + reti: righe-categoria drill, riga verify,
//      riga «Reti del progetto», salute; e il comportamento al reload (solo conteggi).
//   4. SCALA & DETERMINISMO — l'intera pipeline pura regge 500 nodi in tempi sani
//      e dà lo stesso output sullo stesso input.
//   5. PERSISTENZA — lastVerify sopravvive al round-trip JSON (save/load).
//
// Motori PURI, zero DOM/state: input espliciti → output JSON. Fixture-or-fallback
// come stress-enterprise-500 (CI-safe).
// ============================================================================
const test = require('node:test');
const assert = require('node:assert');

const { buildDocSnapshot, buildSnmpSnapshot } = require('../lib/drift-snapshot.js');
const { buildDriftReport, driftBannerKind } = require('../lib/drift-report.js');
const { temporalConfidence, aggregateObservations } = require('../lib/temporal-confidence.js');
const { buildOverview } = require('../lib/overview.js');
const { summarizeDriftReport } = require('../lib/update-summary.js');
const pnet = require('../lib/project-networks.js');

const N = 3;   // downStreakN (soglia cavo-fantasma / porta-down)

// ── FIXTURE: generatore 500-nodi (gitignored) se presente, altrimenti mini ────
function loadFixture() {
  try {
    const gen = require('../tools/gen-enterprise-500.js');
    if (gen && typeof gen.buildEnterpriseState === 'function') {
      return { label: 'ENTERPRISE-500 (generatore)', state: gen.buildEnterpriseState() };
    }
  } catch (_) { /* assente → fallback */ }
  return { label: 'mini-enterprise (fallback)', state: buildMini() };
}
function buildMini() {
  let _mac = 0x2000; const OUI = '02:aa:bb';
  const mac = () => { _mac += 7; return `${OUI}:40:${((_mac >> 8) & 0xff).toString(16).padStart(2, '0')}:${(_mac & 0xff).toString(16).padStart(2, '0')}`; };
  let _ip = 10; const ip = () => `10.20.30.${++_ip}`;
  const state = { racks: [{ id: 'rk1', name: 'R1', sizeU: 42 }], lagGroups: {}, nodes: [], links: [], ports: {},
    ipam: { vlans: { 10: { subnet: '10.20.30.0/24', gateway: '10.20.30.1' } } }, guestVlans: [40], mgmtVlans: [10] };
  const dev = (id, type, ports, managed) => {
    const n = { id, type, name: id.toUpperCase(), rackId: 'rk1', ports };
    if (managed) { n.mac = mac(); n.ip = ip(); n.integration = { driver: 'snmp-v2c', host: n.ip, community: 'public' }; }
    state.nodes.push(n); return n;
  };
  dev('core', 'switch', 48, true); dev('dist', 'switch', 48, true);
  dev('acc1', 'switch', 48, true); dev('edge', 'router', 8, true);
  dev('srv1', 'server', 4, true); dev('nas1', 'nas', 4, true);
  for (let i = 1; i <= 6; i++) { const n = dev('pc' + i, 'pc', 1, false); n.mac = mac(); n.ip = ip(); state.ports[`pc${i}-1`] = { status: 'active', vlan: 20 }; }
  const linkPorts = [['core-1', 'dist-1'], ['dist-2', 'acc1-1'], ['core-3', 'edge-1'], ['dist-3', 'srv1-1'], ['acc1-2', 'nas1-1']];
  linkPorts.forEach(([a, b], i) => {
    state.links.push({ id: 'l' + i, src: a, dst: b });
    state.ports[a] = { status: 'active', speed: 1000, vlan: 10 };
    state.ports[b] = { status: 'active', speed: 1000, vlan: 10 };
  });
  return state;
}

// ── Helpers snapshot ──────────────────────────────────────────────────────────
const norm = (x) => String(x == null ? '' : x).toLowerCase();

function docOf(state) {
  return buildDocSnapshot({ nodes: state.nodes, links: state.links, ports: state.ports });
}
// tutti i nodi SNMP-gestiti "rispondono"
function respondedAll(state) {
  const r = {};
  for (const n of state.nodes) {
    const drv = String((n.integration && n.integration.driver) || '');
    if (drv.indexOf('snmp') === 0) r[n.id] = true;
  }
  return r;
}
// snapshot REALTÀ "baseline" che COMBACIA col documento (nessuna anomalia):
// porte come da doc, ogni MAC documentato è "visto", ogni MAC vive al suo IP doc.
function baselineSnmp(doc, state) {
  const responded = respondedAll(state);
  const ports = {};
  for (const pid of Object.keys(doc.ports)) {
    const dp = doc.ports[pid];
    ports[pid] = { status: dp.status, speed: dp.speed, duplex: dp.duplex, vlan: dp.vlan };
  }
  const observedMacs = [];
  const macAtIps = {};
  for (const dm of doc.macs) {
    observedMacs.push(dm.mac);
    if (dm.ip) macAtIps[norm(dm.mac)] = [dm.ip];   // vivo al suo IP documentato → niente cambio-IP
  }
  return {
    responded, ports, observedMacs, observedDevices: [], rejectedSigs: [],
    portDownStreak: {}, fdbObserved: true, presentNodeIds: Object.assign({}, responded),
    trustAbsentNodeIds: {}, reachabilityChecked: true, macAtIp: {}, macAtIps,
    observedSubnets: [], aliveIps: [], releasedMacs: {}, measuredIds: {},
  };
}
const report = (snmp, doc, ignores) => buildDriftReport(snmp, doc, ignores || [], {
  downStreakN: N, guestVlans: [40], mgmtVlans: [10], endpointPortThreshold: 5,
});
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── SETUP memoizzato ──────────────────────────────────────────────────────────
let FX = null, DOC = null, SETUP_ERR = null;
try {
  FX = loadFixture();
  DOC = docOf(FX.state);
} catch (e) { SETUP_ERR = e; }

test('setup: fixture + snapshot doc costruiti', () => {
  assert.equal(SETUP_ERR, null, SETUP_ERR && (SETUP_ERR.stack || String(SETUP_ERR)));
  assert.ok(FX.state.nodes.length > 0, 'fixture vuota');
  assert.ok(Object.keys(DOC.ports).length > 0, 'nessuna porta su link nel doc snapshot');
  assert.ok(DOC.macs.length > 0, 'nessun MAC documentato');
  console.log(`     fixture: ${FX.label} — ${FX.state.nodes.length} nodi · ${FX.state.links.length} link · doc: ${Object.keys(DOC.ports).length} porte · ${DOC.macs.length} MAC · ${DOC.cables.length} cavi`);
});

// ════════════════════════════════════════════════════════════════════════════
// 1) DRIFT NEL TEMPO — variazioni di rete rilevate lettura dopo lettura
// ════════════════════════════════════════════════════════════════════════════
test('T0 — baseline: realtà == documento → allineato (zero anomalie azionabili)', () => {
  const snmp = baselineSnmp(DOC, FX.state);
  const rep = report(snmp, DOC);
  const c = rep.counts;
  assert.equal(c.stateDrift, 0, 'nessuna discrepanza di stato attesa a baseline');
  assert.equal(c.undocumented, 0, 'nessun non-documentato a baseline');
  assert.equal(c.ipChanged, 0, 'nessun cambio IP a baseline');
  assert.equal(c.ghostCable, 0, 'nessun cavo fantasma a baseline');
  assert.equal(c.macOrphan, 0, 'nessun assente a baseline');
  assert.equal(c.identityDrift, 0, 'nessun drift identità a baseline');
  assert.ok(rep.consistent.length > 0, 'attese porte coerenti a baseline');
  assert.equal(driftBannerKind(c, rep), 'aligned', 'banner: allineato a baseline');
});

test('T1 — variazioni singole: porta giù · non-documentato · cambio IP · identità sostituita', () => {
  const snmp = baselineSnmp(DOC, FX.state);

  // (a) una porta documentata attiva risulta DOWN nella realtà (su switch che risponde) → stateDrift
  const respPid = Object.keys(DOC.ports).find(pid => {
    const nodeId = pid.slice(0, pid.lastIndexOf('-'));
    return snmp.responded[nodeId] && DOC.ports[pid].status === 'active';
  });
  assert.ok(respPid, 'serve almeno una porta doc attiva su nodo che risponde');
  snmp.ports[respPid] = Object.assign({}, snmp.ports[respPid], { status: 'down' });

  // (b) un device MAI visto prima compare in FDB su VLAN infra (nessun segnale endpoint) → undocumented infra
  snmp.observedDevices.push({ sig: 'aabbccddee01', mac: 'AA:BB:CC:DD:EE:01', label: 'visto su CORE · Gi0/9', vlan: 10, portMacCount: 1, consumer: false });
  // e un endpoint su VLAN guest → undocumented endpoint (collassato, non nel conteggio infra)
  snmp.observedDevices.push({ sig: 'aabbccddee02', mac: 'AA:BB:CC:DD:EE:02', label: 'telefono guest', vlan: 40, portMacCount: 1, consumer: false });

  // (c) un device documentato risponde a un IP DIVERSO (stesso MAC) → ipChanged
  const dmWithIp = DOC.macs.find(m => m.ip);
  assert.ok(dmWithIp, 'serve un device documentato con IP');
  const newIp = '10.99.99.99';
  snmp.macAtIps[norm(dmWithIp.mac)] = [newIp];   // il doc-IP non è più tra gli IP vivi

  // (d) identità hardware sostituita: serial dichiarato ≠ misurato (ENTITY-MIB) su nodo che risponde
  const idNode = FX.state.nodes.find(n => snmp.responded[n.id]);
  const docId = clone(DOC);
  docId.identities = [{ nodeId: idNode.id, label: idNode.name || idNode.id, serialNumber: 'SN-DOC-001', model: 'MODEL-X', firmwareVer: '1.0' }];
  snmp.measuredIds[idNode.id] = { serialNumber: 'SN-REAL-999', model: 'MODEL-X', firmwareVer: '2.0' };  // serial diverso = sostituito; firmware diverso = informativo

  const rep = report(snmp, docId);
  const c = rep.counts;
  assert.equal(c.stateDrift, 1, 'una porta cambiata di stato');
  assert.equal(rep.stateDrift[0].diffs[0].field, 'status', 'il diff è sullo status');
  assert.equal(c.undocumented, 1, 'un non-documentato INFRA (l\'endpoint guest è contato a parte)');
  assert.equal(c.undocumentedEndpoint, 1, 'un non-documentato ENDPOINT (guest)');
  assert.equal(rep.undocumented.find(r => r.cls === 'endpoint').reasons.includes('guestVlan'), true, 'l\'endpoint è taggato guestVlan');
  assert.equal(c.ipChanged, 1, 'un cambio IP');
  assert.equal(rep.ipChanged[0].newIp, newIp, 'il nuovo IP è quello vivo');
  assert.equal(c.identityDrift, 1, 'un drift identità AZIONABILE (serial)');
  assert.equal(rep.identityDrift[0].identity, true, 'serial diverso = apparato sostituito (azionabile)');
  assert.ok(rep.identityDrift[0].diffs.some(d => d.field === 'firmwareVer' && d.kind === 'firmware'), 'il firmware diverso è presente ma marcato informativo');
  assert.equal(driftBannerKind(c, rep), 'discrepancies', 'banner: discrepanze');
});

test('T2→T3 — MATURAZIONE nel tempo: cavo fantasma + assente scattano solo a streak >= N', () => {
  // scelgo un cavo il cui capo dst è un nodo con MAC documentato (così può diventare "assente")
  const macNodeIds = new Set(DOC.macs.map(m => m.nodeId).filter(Boolean));
  const cable = DOC.cables.find(c => c.src && c.dst && (macNodeIds.has(c.dst.slice(0, c.dst.lastIndexOf('-'))) || macNodeIds.has(c.src.slice(0, c.src.lastIndexOf('-')))));
  assert.ok(cable, 'serve un cavo con almeno un capo verso un nodo con MAC');
  // orienta: downPort sul capo "switch", il device assente è all'altro capo
  let downPort = cable.src, victimNode = cable.dst.slice(0, cable.dst.lastIndexOf('-'));
  if (!macNodeIds.has(victimNode)) { downPort = cable.dst; victimNode = cable.src.slice(0, cable.src.lastIndexOf('-')); }
  const victimMac = DOC.macs.find(m => m.nodeId === victimNode);

  const mkSnmp = (streak) => {
    const s = baselineSnmp(DOC, FX.state);
    s.portDownStreak[downPort] = streak;
    // il device vittima non è più visto in rete (né FDB, né vivo, né risponde)
    if (victimMac) {
      s.observedMacs = s.observedMacs.filter(m => norm(m) !== norm(victimMac.mac));
      delete s.macAtIps[norm(victimMac.mac)];
      delete s.responded[victimNode];
      delete s.presentNodeIds[victimNode];
    }
    return s;
  };

  const cAt = (streak) => report(mkSnmp(streak), DOC).counts;
  const c2 = cAt(N - 1);   // streak 2: sotto soglia → niente ghost, niente assenza-da-porta
  assert.equal(c2.ghostCable, 0, `streak ${N - 1} < ${N}: nessun cavo fantasma ancora`);

  const c3 = cAt(N);       // streak 3: >= soglia → cavo fantasma
  assert.ok(c3.ghostCable >= 1, `streak ${N}: cavo fantasma rilevato`);
  if (victimMac) {
    assert.ok(c3.macOrphan >= 1, 'il device all\'altro capo del cavo down diventa "assente" (trustAbsent via porta-down)');
    // e a streak 2 lo stesso device era solo "non-verificabile" (grigio), non "assente" (rosso)
    assert.equal(c2.macOrphan, 0, 'a streak sotto-soglia il device è non-verificabile, non assente');
    assert.ok(c2.unverified >= 1, 'a streak sotto-soglia: non-verificabile (grigio, onesto)');
  }
});

test('T4 — recupero: risolte le variazioni, il Drift torna pulito (chiavi stabili)', () => {
  // ripristino: porta su, streak 0, device adottato (doc.deviceSigs), IP allineato
  const snmp = baselineSnmp(DOC, FX.state);
  const rep = report(snmp, DOC);
  const c = rep.counts;
  assert.equal(c.stateDrift + c.undocumented + c.ipChanged + c.ghostCable + c.macOrphan + c.identityDrift, 0,
    'dopo il recupero: zero anomalie azionabili');
  assert.equal(driftBannerKind(c, rep), 'aligned', 'banner torna allineato');
});

test('DRIFT — falsi-positivi evitati: multihoming ≠ cambio-IP · osservabilità cieca ≠ assente', () => {
  // (a) stesso MAC vivo su 2 IP (alias/multihoming): il doc-IP è tra i vivi → NON cambio-IP
  const snmp = baselineSnmp(DOC, FX.state);
  const dm = DOC.macs.find(m => m.ip);
  snmp.macAtIps[norm(dm.mac)] = [dm.ip, '10.88.88.88'];   // doc-IP ancora presente
  assert.equal(report(snmp, DOC).counts.ipChanged, 0, 'MAC su più IP col doc-IP presente = alias, non cambio');

  // (b) AUDIT CIECO: nessuna osservabilità (nessuno risponde, fdb non popolato, sweep
  // non eseguita) → nessuno dichiarato assente e banner "cieco", MAI "allineato".
  const blind = baselineSnmp(DOC, FX.state);
  blind.responded = {};   // SNMP muto → nessuna porta valutata (consistent=0)
  blind.fdbObserved = false; blind.reachabilityChecked = false;
  blind.observedMacs = []; blind.presentNodeIds = {}; blind.macAtIps = {};
  const repBlind = report(blind, DOC);
  assert.equal(repBlind.counts.macOrphan, 0, 'audit cieco non dichiara assenti (no-invenzioni)');
  assert.equal(driftBannerKind(repBlind.counts, repBlind), 'blind', 'banner: cieco (né allineato né discrepanze)');
});

test('DRIFT — "ignora" filtra la riga e la chiave-fingerprint la fa riapparire se la realtà cambia', () => {
  const snmp = baselineSnmp(DOC, FX.state);
  const respPid = Object.keys(DOC.ports).find(pid => snmp.responded[pid.slice(0, pid.lastIndexOf('-'))] && DOC.ports[pid].status === 'active');
  snmp.ports[respPid] = Object.assign({}, snmp.ports[respPid], { status: 'down' });
  const rep1 = report(snmp, DOC);
  const key = rep1.stateDrift[0].key;
  assert.ok(key, 'la riga stateDrift ha una chiave');
  // ignorata → sparisce
  const rep2 = report(snmp, DOC, [key]);
  assert.equal(rep2.stateDrift.length, 0, 'la riga ignorata sparisce');
  // la realtà cambia ancora (down → speed diverso): la chiave-fingerprint cambia → riappare
  snmp.ports[respPid] = Object.assign({}, snmp.ports[respPid], { status: 'down', speed: 100 });
  const rep3 = report(snmp, DOC, [key]);
  assert.ok(rep3.stateDrift.length >= 1 && rep3.stateDrift[0].key !== key, 'condizione cambiata → riga riappare con nuova chiave');
});

// ════════════════════════════════════════════════════════════════════════════
// 2) CONFIDENCE TEMPORALE — score/tier nel tempo
// ════════════════════════════════════════════════════════════════════════════
test('TEMPORALE — i tier evolvono nel tempo: fresh → recurring → established → stable', () => {
  const DAY = 86400000;
  const now = 1_700_000_000_000;   // ancora fisso (i timestamp sono STRINGHE ISO: Date.parse)
  const iso = (ms) => new Date(ms).toISOString();
  const t = (seen, firstMs, lastMs) => temporalConfidence({ seen, firstSeen: iso(firstMs), lastSeen: iso(lastMs) }, now);

  const fresh = t(1, now - DAY, now);
  const recurring = t(2, now - 3 * DAY, now);
  const established = t(4, now - 8 * DAY, now);
  const stable = t(12, now - 20 * DAY, now);

  assert.equal(fresh.tier, 'fresh', 'visto una volta = fresh');
  assert.equal(recurring.tier, 'recurring', 'visto due volte = recurring');
  assert.equal(established.tier, 'established', 'visto 3-4 volte su ~settimana = established');
  assert.equal(stable.tier, 'stable', 'visto molte volte su settimane = stable');
  // lo score cresce con ripetizione + persistenza
  assert.ok(fresh.score < recurring.score && recurring.score < established.score && established.score < stable.score,
    `score monotòno crescente: ${fresh.score} < ${recurring.score} < ${established.score} < ${stable.score}`);
  assert.ok(stable.score <= 1 && fresh.score >= 0, 'score in [0,1]');
});

test('TEMPORALE — DECADIMENTO: non più visto da >30gg = stale (score abbattuto)', () => {
  const DAY = 86400000;
  const now = 1_700_000_000_000;
  const iso = (ms) => new Date(ms).toISOString();
  const staleObs = { seen: 12, firstSeen: iso(now - 90 * DAY), lastSeen: iso(now - 40 * DAY) };  // visto tanto ma non di recente
  const s = temporalConfidence(staleObs, now);
  assert.equal(s.tier, 'stale', 'non visto da >30gg = stale, a prescindere dal conteggio storico');
  const freshSame = temporalConfidence({ seen: 12, firstSeen: iso(now - 20 * DAY), lastSeen: iso(now) }, now);
  assert.ok(s.score < freshSame.score, 'lo stale ha score inferiore allo stesso conteggio ma recente');
});

test('TEMPORALE — invariante «0 avvistamenti = 0»: seen<=0 non prende spanBonus (D6)', () => {
  const DAY = 86400000, now = 1_700_000_000_000, iso = (ms) => new Date(ms).toISOString();
  const zero = temporalConfidence({ seen: 0, firstSeen: iso(now - 14 * DAY), lastSeen: iso(now) }, now);
  assert.equal(zero.score, 0, 'nessun avvistamento → score 0 anche con span ampio (niente spanBonus che trapela)');
  assert.equal(zero.tier, 'fresh');
  const neg = temporalConfidence({ seen: -5, firstSeen: iso(now - 14 * DAY), lastSeen: iso(now) }, now);
  assert.equal(neg.score, 0, 'seen negativo → score 0');
  // controprova: con seen>=1 lo span dà il suo bonus (non l'ho spento del tutto)
  const one = temporalConfidence({ seen: 1, firstSeen: iso(now - 14 * DAY), lastSeen: iso(now) }, now);
  assert.ok(one.score > 0.2, 'seen 1 + span 14gg → rep 0.20 + spanBonus 0.08 = 0.28');
});

test('TEMPORALE — aggregazione di più osservazioni (somma count, min firstSeen, max lastSeen)', () => {
  const DAY = 86400000, base = 1_700_000_000_000;
  const iso = (ms) => new Date(ms).toISOString();
  const recs = [
    { count: 2, firstSeen: iso(base - 10 * DAY), lastSeen: iso(base - 8 * DAY) },
    { count: 3, firstSeen: iso(base - 5 * DAY), lastSeen: iso(base - 1 * DAY) },
    { count: 1, firstSeen: iso(base - 12 * DAY), lastSeen: iso(base - 12 * DAY) },
  ];
  const agg = aggregateObservations(recs);
  assert.equal(agg.seen, 6, 'somma dei count');
  assert.equal(Date.parse(agg.firstSeen), base - 12 * DAY, 'firstSeen = il più antico (ISO)');
  assert.equal(Date.parse(agg.lastSeen), base - 1 * DAY, 'lastSeen = il più recente (ISO)');
  const empty = aggregateObservations([]);
  assert.equal(empty.seen, 0, 'nessuna osservazione → seen 0');
});

// ════════════════════════════════════════════════════════════════════════════
// 3) PANORAMICA «Vero» (Fase 2) — buildOverview con driftLive + lastVerify + reti
// ════════════════════════════════════════════════════════════════════════════
const OV_TYPES = {
  switch: { isActive: true, isRack: true }, router: { isActive: true, isRack: true }, firewall: { isActive: true, isRack: true },
  server: { isActive: true, isRack: true, hasIP: true }, nas: { isActive: true, isRack: true, hasIP: true },
  wlanctrl: { isActive: true, isRack: true }, wlc: { isActive: true, isRack: true },
  ups: { hasIP: true, isPassive: true, isRack: true }, patchpanel: { isPassive: true, isRack: true },
  ap: { isActive: true, hasIP: true }, pc: { hasIP: true, isFloor: true }, voip: { hasIP: true, isFloor: true },
};
function ovModel(driftLive, lastVerify) {
  let networks = [];
  try { networks = (pnet.deriveProjectNetworks({ nodes: FX.state.nodes, types: OV_TYPES }) || {}).networks || []; } catch (_) {}
  return {
    types: OV_TYPES, nodes: FX.state.nodes, links: FX.state.links, ports: FX.state.ports,
    portMacNodeIds: new Set(), macToNode: {}, ipamVlans: {}, vlanIdsInUse: [], vlanNames: {},
    spare: { totals: { free: 100, suspect: 0, ports: 500 }, racks: [], unracked: [] }, sfpTotal: 0,
    rackFill: [], networks, caps: [], fleet: {}, topoCache: {}, lagGroups: FX.state.lagGroups || {},
    lastSyncAt: 1_700_000_000_000, lastSyncResult: { ok: 10, total: 10, at: 1_700_000_000_000 },
    driftLive, lastVerify, now: 1_700_000_003_000,
  };
}
const rowOf = (sec, key) => sec.rows.find(r => r.key === key);

test('PANORAMICA — con report VIVO: righe-categoria drill + riga «Reti» + salute warn', () => {
  const snmp = baselineSnmp(DOC, FX.state);
  // costruisco un report vivo con più categorie (porta down + non-doc + cambio IP)
  const respPid = Object.keys(DOC.ports).find(pid => snmp.responded[pid.slice(0, pid.lastIndexOf('-'))] && DOC.ports[pid].status === 'active');
  snmp.ports[respPid] = Object.assign({}, snmp.ports[respPid], { status: 'down' });
  snmp.observedDevices.push({ sig: 'aabbccddee01', mac: 'AA:BB:CC:DD:EE:01', label: 'nuovo', vlan: 10, portMacCount: 1, consumer: false });
  const dm = DOC.macs.find(m => m.ip);
  snmp.macAtIps[norm(dm.mac)] = ['10.77.77.77'];
  const rep = report(snmp, DOC);
  const lastVerify = { at: 1_700_000_000_000, banner: driftBannerKind(rep.counts, rep), docCount: rep.docCount, counts: rep.counts };

  const truth = buildOverview(ovModel(rep, lastVerify)).truth;
  const drill = truth.rows.filter(r => r.drill);
  const drillKeys = drill.map(r => r.drill);
  assert.ok(drillKeys.includes('stateDrift'), 'riga drill «Porte cambiate»');
  assert.ok(drillKeys.includes('ipChanged'), 'riga drill «Indirizzi cambiati»');
  assert.ok(drillKeys.includes('undocumented'), 'riga drill «Sconosciuti in rete»');
  assert.ok(drillKeys.includes('__networks'), 'riga «Reti del progetto» presente col report vivo');
  const netRow = drill.find(r => r.drill === '__networks');
  assert.ok(netRow.value >= 1, 'almeno una rete di progetto');
  // riga verify (meta) col conteggio azionabile e provenienza misurata
  const v = rowOf(truth, 'verify');
  assert.equal(v.prov, 'measured', 'verify è stato reale (Verifica eseguita)');
  const actionable = rep.counts.stateDrift + rep.counts.macOrphan + rep.counts.undocumented + rep.counts.ghostCable + rep.counts.ipChanged + rep.counts.identityDrift;
  assert.equal(v.value, actionable, 'verify.value = somma azionabile');
  assert.equal(truth.health.level, 'warn', 'differenze da decidere → sezione in avviso');
});

test('PANORAMICA — al RELOAD (niente report vivo): niente righe drill, ma la Verifica resta come conteggio', () => {
  const persisted = { at: 1_700_000_000_000, banner: 'discrepancies', docCount: 50,
    counts: { stateDrift: 2, ipChanged: 1, undocumented: 1, undocumentedEndpoint: 4, ghostCable: 0, macOrphan: 0, identityDrift: 0, unverified: 0, consistent: 40 } };
  const truth = buildOverview(ovModel(null, persisted)).truth;
  assert.equal(truth.rows.filter(r => r.drill).length, 0, 'senza report vivo: nessuna riga-categoria/reti');
  const v = rowOf(truth, 'verify');
  assert.equal(v.prov, 'measured', 'la Verifica persistita resta visibile');
  assert.equal(v.value, 2 + 1 + 1, 'conteggio azionabile dai conteggi persistiti (endpoint esclusi)');
  assert.equal(truth.health.level, 'warn', 'le differenze persistite pesano sulla salute');
});

test('PANORAMICA — mai verificato: riga verify «none» (tratteggiata), non zero; salute non "warn" da lì', () => {
  const truth = buildOverview(ovModel(null, null)).truth;
  const v = rowOf(truth, 'verify');
  assert.equal(v.prov, 'none', 'mai verificato → riga tratteggiata, non 0');
  assert.equal(v.value, null, 'nessun numero inventato');
});

test('PANORAMICA — robustezza: buildOverview NON lancia su networks con elementi null (D5)', () => {
  assert.doesNotThrow(() => buildOverview({
    types: OV_TYPES, nodes: [], spare: { totals: {} },
    networks: [{ cidr: '10.0.0.0/24', deviceCount: 2 }, null, undefined],
    driftLive: null, lastVerify: null,
  }), 'una voce network null/undefined non deve far lanciare buildOverview');
});

test('PANORAMICA — summarizeDriftReport allineato al report (headline = azionabili primari)', () => {
  const snmp = baselineSnmp(DOC, FX.state);
  const respPid = Object.keys(DOC.ports).find(pid => snmp.responded[pid.slice(0, pid.lastIndexOf('-'))] && DOC.ports[pid].status === 'active');
  snmp.ports[respPid] = Object.assign({}, snmp.ports[respPid], { status: 'down' });
  snmp.observedDevices.push({ sig: 'ff0011223344', mac: 'FF:00:11:22:33:44', label: 'x', vlan: 10, portMacCount: 1, consumer: false });
  const rep = report(snmp, DOC);
  const sum = summarizeDriftReport(rep);
  assert.equal(sum.changedCount, rep.counts.stateDrift, 'changedCount = stateDrift');
  assert.equal(sum.newInfra, rep.counts.undocumented, 'newInfra = undocumented infra');
  assert.equal(sum.primaryCount, rep.counts.stateDrift + rep.counts.undocumented + rep.counts.undocumentedEndpoint + rep.counts.identityDrift, 'primary = nuovi + cambiati + identità');
});

// ════════════════════════════════════════════════════════════════════════════
// 4) SCALA & DETERMINISMO
// ════════════════════════════════════════════════════════════════════════════
test('SCALA — la pipeline pura regge la fixture in tempi sani, senza throw', () => {
  const t0 = process.hrtime.bigint();
  const doc = docOf(FX.state);
  const snmpModel = {
    nodes: FX.state.nodes, docPorts: doc.ports, ports: FX.state.ports,
    fdb: {}, vlanCache: {}, leases: [], knownSigs: [], rejectedAutoLinks: [],
  };
  let snmpSnap;
  assert.doesNotThrow(() => { snmpSnap = buildSnmpSnapshot(snmpModel); }, 'buildSnmpSnapshot non lancia a scala');
  assert.ok(snmpSnap && typeof snmpSnap.responded === 'object' && Array.isArray(snmpSnap.observedMacs), 'snmpSnapshot ben formato a scala');
  const rep = report(baselineSnmp(doc, FX.state), doc);
  let ov;
  assert.doesNotThrow(() => { ov = buildOverview(ovModel(rep, { at: 1, banner: 'aligned', docCount: 1, counts: rep.counts })); }, 'buildOverview non lancia a scala');
  assert.ok(ov.complete && ov.truth && ov.margin, 'tre sezioni prodotte');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`     pipeline (doc+snmpSnap+drift+overview) su ${FX.state.nodes.length} nodi: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 5000, `pipeline troppo lenta a scala: ${ms.toFixed(0)} ms`);
});

test('DETERMINISMO — stesso input → stesso output (report + overview)', () => {
  const snmp = baselineSnmp(DOC, FX.state);
  const r1 = report(snmp, DOC), r2 = report(baselineSnmp(DOC, FX.state), DOC);
  assert.deepEqual(r1.counts, r2.counts, 'conteggi drift deterministici');
  const o1 = buildOverview(ovModel(r1, null)), o2 = buildOverview(ovModel(r2, null));
  assert.deepEqual(o1.truth.rows.map(r => [r.key, r.value]), o2.truth.rows.map(r => [r.key, r.value]), 'righe overview deterministiche');
});

// ════════════════════════════════════════════════════════════════════════════
// 5) PERSISTENZA lastVerify — round-trip JSON (save/load)
// ════════════════════════════════════════════════════════════════════════════
test('PERSISTENZA — lastVerify sopravvive al round-trip JSON (dimensione compatta, chiavi fisse)', () => {
  const snmp = baselineSnmp(DOC, FX.state);
  const respPid = Object.keys(DOC.ports).find(pid => snmp.responded[pid.slice(0, pid.lastIndexOf('-'))] && DOC.ports[pid].status === 'active');
  snmp.ports[respPid] = Object.assign({}, snmp.ports[respPid], { status: 'down' });
  const rep = report(snmp, DOC);
  const lastVerify = { at: 1_700_000_000_000, counts: rep.counts, banner: driftBannerKind(rep.counts, rep), docCount: rep.docCount };
  const round = JSON.parse(JSON.stringify(lastVerify));
  assert.deepEqual(round, lastVerify, 'lastVerify round-trip stabile');
  // COMPATTA: solo conteggi + meta, MAI le righe (che possono essere enormi)
  const keys = Object.keys(round).sort();
  assert.deepEqual(keys, ['at', 'banner', 'counts', 'docCount'], 'lastVerify contiene solo {at,banner,counts,docCount}');
  assert.ok(!Array.isArray(round.counts) && typeof round.counts === 'object', 'counts è un oggetto a chiavi fisse');
  const size = JSON.stringify(lastVerify).length;
  assert.ok(size < 600, `lastVerify deve restare compatto (era ${size} byte)`);
});
