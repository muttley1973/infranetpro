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
// Prese PDU: stato e apparato alimentato si leggono con GLI STESSI helper del
// pannello e del report (lib/pdu-layout), mai reinterpretando la forma della
// presa qui — sarebbe la terza definizione dello stesso concetto.
const { pduOutletStatusState, pduOutletConnection } = require('../../lib/pdu-layout.js');
const { outletLabel } = require('../../lib/pdu-report.js');

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
    id: d.id, name: d.name, type: d.type, ip: d.ip, ip6: d.ip6 || undefined, mac: d.mac, hostname: d.hostname,
    vlan: d.vlan, brand: d.brand, model: d.model, serial: d.serial, firmware: d.firmware,
    passive: _PASSIVE_NO_IP_TYPES.has(d.type) ? true : undefined,
    rack: d.rack ? _compact({ name: d.rack.name, u: d.rack.u }) : undefined,
    snmp: d.snmp || undefined, wireless: d.wireless || undefined,
    mgmtProtocol: d.mgmtProtocol, mgmtUrl: d.mgmtUrl,
    // ansible_network_os (per scegliere il modulo del playbook) + segnale DR "manca
    // il backup". 🔒 NON esponiamo il PATH del backup all'LLM (solo un booleano):
    // il playbook lo referenzia via {{ config_backup_ref }} dall'inventory, non serve.
    networkOs: d.networkOs || undefined,
    backupMissing: (d.snmp && !(d.backup && d.backup.ref)) ? true : undefined,
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
// Le porte DICHIARATE dell'apparato. NON è il numero di record in `state.ports`:
// un record nasce quando qualcuno documenta o cabla quella porta, quindi quasi
// ogni record ha un vicino e «totale − usate» veniva 0 su OGNI switch — l'app
// diceva all'assistente che il campus era pieno mentre il report «Porte libere»
// ne contava 291 (audit 2026-08-18, difetto C1). Se il documento non dichiara
// quante porte ha l'apparato non lo si inventa: `total` e `free` restano fuori,
// e resta `documented`, che è ciò che sappiamo davvero (ADR no-invention).
function _declaredPortCount(node) {
  const n = Number(node && node.ports);
  return (Number.isFinite(n) && n >= 0) ? n : null;
}

function _devicePorts(node, state, resolveNode, neighborIndex, nameById, pids) {
  const ports = (state && state.ports) || {};
  const pidList = Array.isArray(pids) ? pids : Object.keys(ports).filter(pid => resolveNode(pid) === node.id);
  const entries = [];
  let documented = 0, used = 0;
  for (const pid of pidList) {
    documented++;
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
    // INDIRIZZO DI PORTA: su un router L3 l'indirizzo vive sull'interfaccia, non
    // sul nodo (il nodo ne ha uno solo, di gestione). Senza questi due campi il
    // lato WAN e ogni interfaccia secondaria erano invisibili all'assistente, che
    // pure deve ragionare su «quali IP sono in uso» (stessa autorità dei motori
    // indirizzi, che leggono `state.ports[pid].ip`).
    const pIp = (p.ip == null ? '' : String(p.ip)).trim();
    const pIp6 = (p.ip6 == null ? '' : String(p.ip6)).trim();
    const meaningful = neigh.length || name || (vlanRaw != null) || (status && status !== 'unknown') || trunk || p.lagGroup || pIp || pIp6;
    if (!meaningful) continue;
    entries.push(_compact({
      port: _portNum(pid, node.id),
      name,
      ip: pIp || undefined,
      ip6: pIp6 || undefined,
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
  const declared = _declaredPortCount(node);
  const out = _compact({
    total: (declared != null) ? declared : undefined,
    documented: documented || undefined,
    used: used || undefined,
    free: (declared != null) ? Math.max(0, declared - used) : undefined,
  });
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
  let documented = 0, used = 0;
  for (const pid of pidList) {
    documented++;
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
  // Stessa regola di `_devicePorts`: il totale è quello DICHIARATO, e se manca
  // si tace invece di spacciare il numero di record per capacità.
  const declared = _declaredPortCount(node);
  return {
    total: declared,
    documented,
    used,
    free: (declared != null) ? Math.max(0, declared - used) : null,
    list,
  };
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

// ── Ciclo di vita: due date DICHIARATE (nessun apparato le dice via SNMP). ───
// Servono alla domanda «cosa è fuori garanzia / fuori produzione», che la
// Panoramica calcola già nella lente DR: senza queste l'assistente non poteva
// rispondere su un dato che l'utente aveva scritto a mano.
function _lifecycle(node) {
  const w = (node && node.warrantyUntil == null) ? '' : String(node.warrantyUntil).trim();
  const e = (node && node.eolDate == null) ? '' : String(node.eolDate).trim();
  const out = _compact({ warrantyUntil: w.slice(0, 32) || undefined, eol: e.slice(0, 32) || undefined });
  return Object.keys(out).length ? out : undefined;
}

// ── VM di un host virtuale (allowlist ESPLICITA come il wireless). ───────────
// Le VM vivono in `node.vms[]` e possono portare una `integration` con la sua
// community: qui si leggono SOLO nome/indirizzi/VLAN/stato, per costruzione —
// qualunque altro campo (segreti compresi) è scartato perché non viene copiato.
// Prima usciva solo il CONTEGGIO (capabilities.compute.vms): l'assistente sapeva
// «2 VM» ma non sapeva dire quali, pur essendo documentate.
function _vms(node) {
  const list = (node && Array.isArray(node.vms)) ? node.vms : [];
  const out = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const e = _compact({
      name: (v.name == null ? '' : String(v.name).trim().slice(0, 64)) || undefined,
      ip: (v.ip == null ? '' : String(v.ip).trim()) || undefined,
      ip6: (v.ip6 == null ? '' : String(v.ip6).trim()) || undefined,
      mac: (v.mac == null ? '' : String(v.mac).trim().toUpperCase()) || undefined,
      vlan: (v.vlan != null) ? (Number(v.vlan) || v.vlan) : undefined,
      state: (v.state == null ? '' : String(v.state).trim().slice(0, 16)) || undefined,
    });
    if (Object.keys(e).length) out.push(e);
    if (out.length >= 48) break;                 // cap di sicurezza (budget token)
  }
  return out.length ? out : undefined;
}

// ── Prese di una PDU: la catena di alimentazione. ────────────────────────────
// «Cosa si spegne se muore la PDU-A» è una domanda di continuità operativa a cui
// il documento sa rispondere (il Dossier stampa il capitolo) ma l'assistente no:
// usciva solo il carico misurato. Stato e apparato alimentato si leggono con gli
// helper CONDIVISI di lib/pdu-layout (una sola definizione: pannello, report e
// contesto dicono la stessa cosa). Il nome del device è preferito all'id opaco.
function _outlets(node, nameById) {
  const list = (node && Array.isArray(node.powerOutlets)) ? node.powerOutlets : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o || typeof o !== 'object') continue;
    const conn = pduOutletConnection(o);
    // Il NOME DICHIARATO per primo, esattamente come lo stampa il Dossier PDF
    // (lib/pdu-report → conn.deviceName): se l'assistente chiamasse quella presa
    // in un altro modo rispetto al documento consegnato al cliente, sarebbero due
    // verità per lo stesso dato. L'id serve solo quando il nome non c'è.
    const byId = conn.deviceId ? (nameById && nameById[conn.deviceId]) : null;
    const powers = (conn.deviceName || byId || '').toString().trim().slice(0, 64);
    out.push(_compact({
      outlet: String(outletLabel(o, i)).slice(0, 32),
      state: pduOutletStatusState(o) || undefined,
      powers: powers || undefined,
    }));
    if (out.length >= 64) break;                 // cap di sicurezza (budget token)
  }
  return out.length ? out : undefined;
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

// Identità hardware: seriale/modello MISURATI diversi da quelli DICHIARATI =
// «apparato sostituito». Il client la raccoglieva già, ma l'allowlist non
// conosceva la categoria e la scartava in silenzio: la notizia più grave della
// Verifica non arrivava mai al modello. `changes` sono frasi corte già composte
// dal client («serial: X→Y»), tagliate a 6 × 120 caratteri.
function _identityEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const out = {};
  const id = _str(e.id), name = _str(e.name);
  if (id !== null) out.id = id;
  if (name !== null) out.name = name;
  if (e.swapped === true) out.swapped = true;
  const ch = _arr(e.changes).map(_str).filter(Boolean).slice(0, 6).map(s => s.slice(0, 120));
  if (ch.length) out.changes = ch;
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
    const ident = _arr(drift.identityChanged).map(_identityEntry).filter(Boolean);
    // «Non verificabile» ≠ assente: la sweep non copriva quella subnet, quindi la
    // presenza non è stata provata. Senza questa categoria il modello vedeva solo
    // i presenti e gli assenti, e il grigio — che è metà del verdetto — spariva.
    const unver = _arr(drift.unverified).map(e => _driftEntry(e, ['id', 'name', 'ip', 'mac', 'reason'])).filter(Boolean);
    if (absent.length) d.absent = absent;
    if (undoc.length) d.undocumented = undoc;
    if (ipch.length) d.ipChanged = ipch;
    if (ident.length) d.identityChanged = ident;
    if (unver.length) d.unverified = unver;
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
    if (raw) {
      const lc = _lifecycle(raw); if (lc) out.lifecycle = lc;              // garanzia / fine vita (dichiarate)
      const vm = _vms(raw); if (vm) out.vms = vm;                          // VM documentate sull'host
      const ol = _outlets(raw, nameById); if (ol) out.outlets = ol;        // prese PDU → chi alimentano
    }
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

  // Ruoli DICHIARATI di una VLAN (ospiti / voce / gestione): sono marcati sulla
  // barra VLAN e cambiano il giudizio su un apparato (un non-documentato sulla
  // VLAN di gestione è un fatto di sicurezza, sulla guest è normale). Senza
  // questi l'assistente non sapeva nemmeno quale fosse la rete ospiti.
  const _roleSet = (arr) => new Set((Array.isArray(arr) ? arr : []).map(Number).filter(Number.isFinite));
  const _guestV = _roleSet(state.guestVlans), _voiceV = _roleSet(state.voiceVlans), _mgmtV = _roleSet(state.mgmtVlans);
  const _roles = (vid) => {
    const n = Number(vid);
    const r = [];
    if (_guestV.has(n)) r.push('guest');
    if (_voiceV.has(n)) r.push('voice');
    if (_mgmtV.has(n)) r.push('mgmt');
    return r.length ? r : undefined;
  };
  const vlans = (inv.vlans || []).map(v => _compact({ id: v.id, name: v.name, subnet: v.subnet, gateway: v.gateway, dns: v.dns, roles: _roles(v.id) }));
  // RETI DICHIARATE (prefissi) = l'autorità dell'indirizzamento (schema 2).
  // `vlans[].subnet` da solo mente due volte: di una VLAN dual-stack mostra solo
  // l'IPv4, e le reti SENZA VLAN — la norma in un import DCIM — non le nomina
  // affatto. Senza questo blocco l'assistente rispondeva «non risulta dalla
  // documentazione» su reti dichiarate a mano dall'utente (viola declare-first).
  // Il dato è già calcolato da api-shape (stessa forma della REST v1): qui si
  // copia, non si ricalcola. `description` (prosa libera) resta fuori per
  // disegno, come le note: solo campi strutturati escono verso il modello.
  const networks = (inv.prefixes || []).slice(0, 200).map(p => _compact({
    cidr: p.cidr,
    vlan: (p.vlan != null) ? p.vlan : undefined,      // assente = rete senza VLAN (legittima)
    name: p.name, gateway: p.gateway, dns: p.dns, status: p.status, source: p.source,
  }));
  const ctx = {
    project: { id: inv.id, name: inv.name },
    summary: {
      devices: inv.counts.devices, withIp: inv.counts.withIp, snmp: inv.counts.snmp,
      // `networks` è il TOTALE dichiarato anche se l'elenco è tagliato a 200:
      // un conteggio onesto vale più di una lista completa (no-invenzioni).
      networks: (inv.prefixes || []).length,
      vlans: vlans.length, racks: (inv.racks || []).length,
    },
    vlans,
  };
  if (networks.length) ctx.networks = networks;
  if (devices.length) ctx.devices = devices;
  // FRESCHEZZA dei dati (schema ②: «il tempo non entra mai»). Le misure — salute
  // SNMP, alert, UPS/batteria — sono una FOTO al momento della Verifica, non uno
  // stato live: senza dire QUANDO, l'assistente le racconta al presente («⚠ UPS
  // sotto batteria») come se fossero adesso. Esponiamo i due timestamp onesti:
  //   asOf            = ultimo salvataggio della documentazione (project.updated_at)
  //   summary.measuredAt = ultima Verifica/poll SNMP (state.lastSnmpSyncAt)
  const _asOf = _str(p.updated_at);
  if (_asOf) ctx.asOf = _asOf;
  const _snmpAt = Number(state.lastSnmpSyncAt);
  if (Number.isFinite(_snmpAt) && _snmpAt > 0) ctx.summary.measuredAt = new Date(_snmpAt).toISOString();
  // summary.snmp conta i device CONFIGURATI con un driver (integration.driver),
  // non quelli che RISPONDONO: «61 monitorati SNMP» con 0 risposte è un inganno
  // (schema ②/③). Affianchiamo `snmpResponding` = quanti hanno risposto «ok»
  // all'ultima Verifica → l'assistente distingue «configurati» da «raggiungibili».
  if (sc.snmpHealth) {
    let snmpResponding = 0;
    for (const n of Object.values(rawById)) if (n && n.snmpStatus === 'ok') snmpResponding++;
    ctx.summary.snmpResponding = snmpResponding;
  }
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
  _lifecycle, _vms, _outlets, _identityEntry,
  _PASSIVE_NO_IP_TYPES,
};
