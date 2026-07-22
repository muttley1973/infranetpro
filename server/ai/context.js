'use strict';
// ============================================================
//  server/ai/context.js — assembla il CONTESTO che l'AI riceve (sanitizzato).
//
//  Principio (spec §3): «InfraNet calcola, l'AI racconta». Snapshot compatto §8b
//  costruito dai dati GIÀ sanitizzati di lib/api-shape.js (allowlist → MAI community
//  SNMP / credenziali) + arricchimento L1: **porte** (stato/velocità/VLAN/trunk/LAG/
//  PoE/collegata-a), **salute SNMP** (CPU/RAM/disco/toner/UPS/uptime) e **topologia**
//  (adiacenza device). Tutto gated dall'oggetto `scope` (interruttori d'ambito):
//  l'admin decide quali categorie escono (privacy + costo).
//
//  È questo l'oggetto mostrato da «mostra cosa esce» (preview): ciò che vedi qui
//  è ESATTAMENTE ciò che lascerebbe la macchina verso il modello.
//
//  Modulo CommonJS puro (zero IO, zero DOM). Bersaglio della GUARDIA anti-leak
//  (test/ai-context.test.js): nessun segreto deve mai comparire nell'output.
// ============================================================
const { projectToInventory } = require('../../lib/api-shape.js');
const { _getLinkDrawEndpoints } = require('../../lib/link-model.js');
const { computeDeviceCapabilities, computeFleetCapabilities } = require('../../lib/hw-capabilities.js');
const { computeHealthAlerts, summarizeAlerts } = require('../../lib/health-alerts.js');

// Rimuove le chiavi a valore null/'' da un oggetto piatto (snapshot più compatto).
function _compact(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

// Tipi PASSIVI SENZA IP (isPassive && !hasIP nel catalogo src/app-types.js):
// prese a muro, patch panel, passacavi, pannelli vuoti, quadri elettrici. Sono
// cablaggio fisico / pass-through: NON hanno IP/MAC/VLAN propri PER DISEGNO. Li
// marchiamo `passive:true` così l'AI non li scambia per «device senza IP» o
// lacune (paletto #2). Allineato a app-drift.js isPassiveNoIp; ups/pdu/ats/
// mediaconv sono passivi ma hasIP:true → NON qui (possono avere un IP di mgmt).
const _PASSIVE_NO_IP_TYPES = new Set(['wallport', 'patchpanel', 'blankpanel', 'cablemanager', 'panelboard']);

// Device compatto: parte dal DTO allowlist di api-shape (già sicuro).
function _device(d) {
  return _compact({
    id: d.id, name: d.name, type: d.type, ip: d.ip, mac: d.mac, hostname: d.hostname,
    vlan: d.vlan, brand: d.brand, model: d.model, serial: d.serial, firmware: d.firmware,
    passive: _PASSIVE_NO_IP_TYPES.has(d.type) ? true : undefined,
    rack: d.rack ? _compact({ name: d.rack.name, u: d.rack.u }) : undefined,
    snmp: d.snmp || undefined, wireless: d.wireless || undefined,
    mgmtProtocol: d.mgmtProtocol, mgmtUrl: d.mgmtUrl,
  });
}

// ── Ambito (scope): default tutto ON; solo un esplicito false spegne. ────────
function _normScope(scope) {
  const s = (scope && typeof scope === 'object') ? scope : {};
  const on = (k) => s[k] !== false;
  return { devices: on('devices'), ports: on('ports'), snmpHealth: on('snmpHealth'), topology: on('topology'), drift: on('drift') };
}

// ── Risoluzione porta→nodo + indice dei vicini (cablaggio) ───────────────────
// pid = `${nodeId}-${num}`; gli id nodo possono contenere trattini → match per
// PREFISSO PIÙ LUNGO sull'insieme degli id noti (deterministico).
// pid → nodeId, a PREFISSO PIÙ LUNGO: gli id dei nodi possono contenere '-'
// (`rack_default`, id importati), quindi `a-b-1` va risolto su `a-b` se quel
// nodo esiste, non su `a`.
//
// ⚠️ PERFORMANCE (misurata): la versione precedente scorreva l'INTERO elenco dei
// nodi per ogni pid. Dentro _devicePorts — che a sua volta girava su tutte le
// porte per ogni device — il costo diventava device × porte × nodi: su 500 nodi
// e 910 porte ≈ 2·10⁸ confronti di stringa, cioè 4,4 s per UNA costruzione del
// contesto (ogni altro motore del progetto sta sotto i 30 ms).
// Ora i candidati si generano DAL pid — i suoi prefissi tagliati su ogni '-',
// dal più lungo al più corto — e si cercano in un Set: il costo dipende dal
// numero di trattini nel pid (1-3 nella pratica), non dalla dimensione del
// progetto. Il memo copre i pid richiesti più volte nella stessa costruzione.
// Il risultato è identico a prima, incluso il tie-break sul prefisso più lungo.
function _buildPortNodeResolver(nodeIds) {
  const set = new Set(nodeIds);
  const memo = new Map();
  return (pid) => {
    if (!pid) return null;
    if (memo.has(pid)) return memo.get(pid);
    let out = null;
    if (set.has(pid)) out = pid;                       // il pid È l'id di un nodo
    else for (let i = pid.lastIndexOf('-'); i > 0; i = pid.lastIndexOf('-', i - 1)) {
      const cand = pid.slice(0, i);                    // prefissi dal più LUNGO
      if (set.has(cand)) { out = cand; break; }
    }
    memo.set(pid, out);
    return out;
  };
}
function _portNum(pid, nodeId) {
  if (nodeId && pid.startsWith(nodeId + '-')) return pid.slice(nodeId.length + 1);
  const m = String(pid).match(/-([^-]+)$/);
  return m ? m[1] : String(pid);
}
// pid → Set(pid vicino), dagli estremi disegnati dei link (lib/link-model).
function _buildNeighborIndex(links) {
  const idx = {};
  for (const link of (Array.isArray(links) ? links : [])) {
    const { src, dst } = _getLinkDrawEndpoints(link);
    if (src && dst && src !== dst) {
      (idx[src] || (idx[src] = new Set())).add(dst);
      (idx[dst] || (idx[dst] = new Set())).add(src);
    }
  }
  return idx;
}

// ── Scalari sicuri: tiene numeri/bool/stringhe corte; SCARTA le chiavi che
// "sembrano" segreti (community/password/key/token/auth…). Difesa in profondità
// per i blocchi salute a passthrough (hostResources/printer/powerLive).
// Profondità 4: le forme REALI dei driver sono annidate fino a 3 livelli
// (printer.supplies[].pct, hostResources.volumes[].pct) → con un cap troppo basso
// venivano scartate e l'AI non vedeva inchiostro/dischi. Il filtro _SECRET_RE gira
// per-chiave a OGNI livello (+ cap 24 elementi / 200 char) → nessun segreto
// trapela anche più in profondità. ───────────────────────────────────────────
const _SECRET_RE = /pass|pwd|secret|token|key|community|auth|credential/i;
function _safeScalars(obj, depth) {
  if (depth == null) depth = 4;
  if (obj == null) return undefined;
  if (typeof obj === 'number') return Number.isFinite(obj) ? obj : undefined;
  if (typeof obj === 'boolean') return obj;
  if (typeof obj === 'string') { const s = obj.trim(); return s ? s.slice(0, 200) : undefined; }
  if (depth <= 0) return undefined;
  if (Array.isArray(obj)) {
    const out = obj.slice(0, 24).map(v => _safeScalars(v, depth - 1)).filter(v => v !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (_SECRET_RE.test(k)) continue;                 // scarta chiavi sospette
      const v = _safeScalars(obj[k], depth - 1);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

// ── Porte di un device (compatte). Salta le vuote; cap per device. ───────────
// `pids` = le porte GIÀ attribuite a questo nodo (indice costruito una volta in
// buildAiContext). Se manca si ricade sulla scansione completa, così la firma
// resta compatibile per chi chiama la funzione da fuori.
function _devicePorts(node, state, resolveNode, neighborIndex, nameById, pids) {
  const ports = (state && state.ports) || {};
  const pidList = Array.isArray(pids) ? pids : Object.keys(ports).filter(pid => resolveNode(pid) === node.id);
  const entries = [];
  let total = 0, used = 0;
  for (const pid of pidList) {
    total++;
    const p = ports[pid] || {};
    const neigh = neighborIndex[pid] ? [...neighborIndex[pid]] : [];
    if (neigh.length) used++;
    if (p.hidden) continue;
    const status = p.statusOvr || p.status || null;
    const speed = p.speedOvr || p.speed || null;
    const vlanRaw = (p.vlanOvr != null) ? p.vlanOvr : p.vlan;
    const name = (p.desc || p.alias || p.ifName || '').toString().trim() || null;
    const trunk = p.isTrunk ? ((Array.isArray(p.trunkVlans) && p.trunkVlans.length) ? p.trunkVlans : true) : undefined;
    const connectedTo = neigh.map((npid) => {
      const nid = resolveNode(npid);
      return _compact({ device: nid ? (nameById[nid] || nid) : null, port: nid ? _portNum(npid, nid) : npid });
    });
    const meaningful = neigh.length || name || (vlanRaw != null) || (status && status !== 'unknown') || trunk || p.lagGroup;
    if (!meaningful) continue;
    entries.push(_compact({
      port: _portNum(pid, node.id),
      name,
      status,
      speed,
      vlan: (vlanRaw != null) ? (Number(vlanRaw) || vlanRaw) : undefined,
      trunk,
      lag: p.lagGroup || undefined,
      poe: (p.snmpPoe != null) ? p.snmpPoe : undefined,
      connectedTo: connectedTo.length ? connectedTo : undefined,
    }));
    if (entries.length >= 64) break;          // cap di sicurezza (budget token)
  }
  const out = _compact({ total: total || undefined, used: used || undefined, free: total ? (total - used) : undefined });
  if (entries.length) out.list = entries;
  return Object.keys(out).length ? out : undefined;
}

// ── Porte GREZZE di un device per il motore capacità (lib/hw-capabilities). ──
// A differenza di _devicePorts (che filtra/cappa la lista mostrata all'AI), qui
// raccogliamo TUTTE le porte del nodo con i soli campi utili al calcolo (velocità/
// stato/LAG/PoE) + il conteggio total/used/free dal cablaggio. Cap alto di sicurezza.
function _collectPorts(node, state, resolveNode, neighborIndex, pids) {
  const ports = (state && state.ports) || {};
  const pidList = Array.isArray(pids) ? pids : Object.keys(ports).filter(pid => resolveNode(pid) === node.id);
  const list = [];
  let total = 0, used = 0;
  for (const pid of pidList) {
    total++;
    const p = ports[pid] || {};
    if (neighborIndex[pid] && neighborIndex[pid].size) used++;
    list.push({
      speed: (p.speedOvr != null) ? p.speedOvr : (p.speed != null ? p.speed : null),
      status: p.statusOvr || p.status || null,
      lagGroup: p.lagGroup || null,
      poe: (p.snmpPoe != null) ? p.snmpPoe : null,
    });
    if (list.length >= 512) break;
  }
  return { total, used, free: total - used, list };
}

// ── Salute SNMP (sola lettura, già importata): system/host/printer/power. ────
function _deviceHealth(node) {
  const integ = (node && node.integration) || {};
  const h = {};
  const sys = _safeScalars(integ.system);
  if (sys) {
    const sblk = _compact({
      uptime: sys.sysUpTime || sys.uptime,
      descr: (sys.sysDescr || sys.descr || '').toString().slice(0, 160) || undefined,
      location: sys.sysLocation || sys.location,
    });
    if (Object.keys(sblk).length) h.system = sblk;
  }
  const host = _safeScalars(integ.hostResources);   // CPU/RAM/dischi
  if (host) h.host = host;
  const printer = _safeScalars(integ.printer);       // toner/contapagine/stato
  if (printer) h.printer = printer;
  const power = _safeScalars(node.powerLive);        // UPS/ATS
  if (power) h.power = power;
  if (node.snmpStatus) h.snmpStatus = node.snmpStatus;
  return Object.keys(h).length ? h : undefined;
}

// ── Wireless: inventario SSID per AP (allowlist ESPLICITA). ──────────────────
// Il modello radio è a 2 livelli: radios[i] = PHY (banda/standard) · radios[i].ssids[]
// = BSS logici {ssid, vlan, security}. `security` è il TIPO (es. wpa3-personal),
// NON una chiave: nel modello non esiste passphrase/psk. Per difesa in profondità
// leggiamo SOLO ssid/vlan/security/banda (qualunque campo extra è scartato per
// costruzione → nessun segreto può uscire). Dedup per ssid+vlan, bande raccolte.
function _wirelessSsids(node) {
  const radios = (node && Array.isArray(node.radios)) ? node.radios : [];
  const map = new Map();
  for (const r of radios) {
    const band = (r && r.band) ? String(r.band).slice(0, 8) : null;
    const ssids = (r && Array.isArray(r.ssids)) ? r.ssids : [];
    for (const s of ssids) {
      if (!s || s.ssid == null || String(s.ssid).trim() === '') continue;
      const ssid = String(s.ssid).slice(0, 64);
      const vlan = (s.vlan != null) ? (Number(s.vlan) || s.vlan) : undefined;
      const key = ssid + '|' + (vlan != null ? vlan : '');
      let e = map.get(key);
      if (!e) { e = { ssid, vlan, security: s.security ? String(s.security).slice(0, 32) : undefined, bands: [] }; map.set(key, e); }
      if (band && !e.bands.includes(band)) e.bands.push(band);
      if (map.size >= 64) break;       // cap di sicurezza
    }
  }
  if (!map.size) return undefined;
  return [...map.values()].map(e => _compact({ ssid: e.ssid, vlan: e.vlan, security: e.security, bands: e.bands.length ? e.bands : undefined }));
}

// ── Topologia: adiacenza device↔device dai link. ─────────────────────────────
function _topology(links, resolveNode, nameById) {
  const seen = new Set();
  const edges = [];
  for (const link of (Array.isArray(links) ? links : [])) {
    const { src, dst } = _getLinkDrawEndpoints(link);
    const a = resolveNode(src), b = resolveNode(dst);
    if (!a || !b || a === b) continue;
    const key = a < b ? (a + '|' + b) : (b + '|' + a);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ a: nameById[a] || a, b: nameById[b] || b });
    if (edges.length >= 200) break;
  }
  return edges.length ? edges : undefined;
}

// ── Ri-sanitizzazione dei liveFacts (allowlist per categoria) ────────────────
const _num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const _str = (v) => { const t = (v == null ? '' : String(v)).trim(); return t || null; };
function _arr(x) { return Array.isArray(x) ? x : []; }

function _driftEntry(e, fields) {
  if (!e || typeof e !== 'object') return null;
  const out = {};
  for (const f of fields) {
    const v = (f === 'vlan') ? _num(e[f]) : _str(e[f]);
    if (v !== null) out[f] = v;
  }
  return Object.keys(out).length ? out : null;
}

function _sanitizeFacts(liveFacts, scope) {
  const lf = (liveFacts && typeof liveFacts === 'object') ? liveFacts : {};
  const sc = _normScope(scope);
  const facts = {};

  const drift = (sc.drift && lf.drift && typeof lf.drift === 'object') ? lf.drift : null;
  if (drift) {
    const d = {};
    const absent = _arr(drift.absent).map(e => _driftEntry(e, ['id', 'name', 'ip', 'mac', 'vlan'])).filter(Boolean);
    const undoc = _arr(drift.undocumented).map(e => _driftEntry(e, ['ip', 'mac', 'vlan', 'hostname'])).filter(Boolean);
    const ipch = _arr(drift.ipChanged).map(e => _driftEntry(e, ['id', 'name', 'mac', 'from', 'to'])).filter(Boolean);
    if (absent.length) d.absent = absent;
    if (undoc.length) d.undocumented = undoc;
    if (ipch.length) d.ipChanged = ipch;
    if (Object.keys(d).length) facts.drift = d;
  }

  const ipam = _arr(lf.ipam).map((e) => {
    if (!e || typeof e !== 'object') return null;
    const o = _compact({ vlan: _num(e.vlan), used: _num(e.used), free: _num(e.free), nextFree: _str(e.nextFree) });
    return Object.keys(o).length ? o : null;
  }).filter(Boolean);
  if (ipam.length) facts.ipam = ipam;

  const gaps = _arr(lf.gaps).map((e) => {
    if (!e || typeof e !== 'object') return null;
    const o = _compact({ kind: _str(e.kind), vlan: _num(e.vlan) });
    return o.kind ? o : null;
  }).filter(Boolean);
  if (gaps.length) facts.gaps = gaps;

  return facts;
}

// Costruisce il contesto §8b da un progetto persistito + liveFacts + scope.
// `project` = { id, name, updated_at, state } come da projects-store.loadProject.
function buildAiContext(project, liveFacts, scope) {
  const sc = _normScope(scope);
  const p = project || {};
  const state = p.state || {};
  const inv = projectToInventory(p);

  const rawById = {};
  for (const n of (Array.isArray(state.nodes) ? state.nodes : [])) if (n && n.id) rawById[n.id] = n;
  const nameById = {};
  for (const d of inv.devices) nameById[d.id] = d.name || d.id;
  const resolveNode = _buildPortNodeResolver(Object.keys(rawById));
  const neighborIndex = (sc.ports || sc.topology) ? _buildNeighborIndex(state.links) : {};
  // Indice porte→nodo costruito UNA volta: prima ogni device ri-scorreva TUTTE
  // le porte del progetto (device × porte). L'ordine è quello di
  // Object.keys(state.ports), lo stesso di prima, così le liste emesse e i cap
  // per-device (64 / 512) restano identici.
  const pidsByNode = {};
  if (sc.ports) {
    for (const pid of Object.keys(state.ports || {})) {
      const nid = resolveNode(pid);
      if (nid) (pidsByNode[nid] || (pidsByNode[nid] = [])).push(pid);
    }
  }

  const devices = (sc.devices ? inv.devices : []).map((d) => {
    const out = _device(d);
    const raw = rawById[d.id];
    if (sc.ports && raw) { const pr = _devicePorts(raw, state, resolveNode, neighborIndex, nameById, pidsByNode[d.id] || []); if (pr) out.ports = pr; }
    if (sc.snmpHealth && raw) { const hl = _deviceHealth(raw); if (hl) out.health = hl; }
    if (raw) { const ss = _wirelessSsids(raw); if (ss) out.ssids = ss; }   // inventario SSID (AP)
    // Capacità hardware DOCUMENTATE (lib/hw-capabilities): «InfraNet calcola».
    // Allowlist per costruzione (legge solo chiavi spec note). I sotto-blocchi
    // derivati dalle porte arrivano solo se anche lo scope Porte è ON.
    if (raw) {
      const portsCap = sc.ports ? _collectPorts(raw, state, resolveNode, neighborIndex, pidsByNode[d.id] || []) : undefined;
      const cap = computeDeviceCapabilities({
        type: raw.type, spec: raw.spec, radios: raw.radios,
        vmsCount: Array.isArray(raw.vms) ? raw.vms.length : 0,
        ports: portsCap, lagNames: state.lagGroups, lagModes: state.lagModes,
      });
      if (cap) out.capabilities = cap;
    }
    // PROBLEMI (lib/health-alerts): alert deterministici dalla salute → l'AI li
    // segnala proattivamente. Naturalmente gated da snmpHealth: senza il blocco
    // health (scope off o nessun dato) non c'è nulla da cui derivarli.
    if (out.health) { const al = computeHealthAlerts(out); if (al) out.alerts = al; }
    return out;
  });

  const vlans = (inv.vlans || []).map(v => _compact({ id: v.id, name: v.name, subnet: v.subnet, gateway: v.gateway, dns: v.dns }));
  const ctx = {
    project: { id: inv.id, name: inv.name },
    summary: {
      devices: inv.counts.devices, withIp: inv.counts.withIp, snmp: inv.counts.snmp,
      vlans: vlans.length, racks: (inv.racks || []).length,
    },
    vlans,
  };
  if (devices.length) ctx.devices = devices;
  // Riepilogo capacità di FLOTTA (totali utili: porte libere, headroom PoE, banda
  // uplink, AP/SSID) — solo se almeno un device porta capacità.
  const fleetCap = computeFleetCapabilities(devices.map(d => d.capabilities));
  if (fleetCap) ctx.summary.capabilities = fleetCap;
  // Riepilogo problemi di flotta (conteggi warn/crit) — solo se almeno un alert.
  const fleetAlerts = summarizeAlerts(devices.map(d => d.alerts));
  if (fleetAlerts) ctx.summary.alerts = fleetAlerts;
  if (sc.topology) { const topo = _topology(state.links, resolveNode, nameById); if (topo) ctx.topology = topo; }
  const facts = _sanitizeFacts(liveFacts, sc);
  if (Object.keys(facts).length) ctx.facts = facts;
  return ctx;
}

module.exports = {
  buildAiContext, _sanitizeFacts, _device, _compact,
  _normScope, _buildPortNodeResolver, _portNum, _buildNeighborIndex,
  _safeScalars, _devicePorts, _deviceHealth, _topology, _wirelessSsids, _collectPorts,
  _PASSIVE_NO_IP_TYPES,
};
