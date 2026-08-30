'use strict';
// ============================================================
//  lib/api-shape.js — trasformazioni PURE state→DTO per la REST API v1.
//
//  Zero DOM, zero stato: solo funzioni pure (ADR D4) testabili con node --test.
//  Gira SOLO lato server (CommonJS). La forma pubblica usa una ALLOWLIST esplicita
//  dei campi: NON deve MAI esporre segreti (es. integration.community/credenziali).
//
//  La VLAN di un device è DERIVATA da IP↔subnet (state.ipam.vlans) riusando
//  lib/cidr.js — coerente con l'IPAM-lite per-VLAN già presente nell'app.
// ============================================================
const { _parseCidrInfo, _ipInCidr } = require('./cidr.js');
const { ipamByVidView } = require('./ipam-model.js');
const { vendorToNetworkOs } = require('./ansible-netos.js');
const { stripRefCreds } = require('./backup-ref.js');

// Tipi puramente strutturali/di layout (TYPES[x].isStructural in src/app-types.js):
// non sono device di rete → esclusi dall'inventario. Oggi "room" (stanza) e
// "storey" (piano), i due contenitori disegnati: PIANO ⊃ STANZA ⊃ apparati.
// Tenuto come piccola denylist locale: i tipi strutturali sono rari e stabili,
// e la lib resta pura (TYPES è un modulo frontend, non importabile lato server).
// ⚠️ Questa lista e il catalogo del frontend sono la STESSA cosa scritta due
// volte, di proposito e con la ragione qui sopra — ma non a caso: le tiene
// insieme `test/layout-types-parity.test.js`, che va rosso se divergono.
const LAYOUT_TYPES = new Set(['room', 'storey']);

// Tipi passivi STRUTTURALI di pavimento (isFloor && isPassive && !hasIP nel catalogo
// src/app-types.js): la "presa a muro" (wallport) e il "quadro elettrico" (panelboard).
// Sono infrastruttura di cablaggio/elettrica dell'edificio, NON asset IT con identita'
// (niente IP/MAC/brand/modello): vanno ESCLUSI dal Registro asset (ISO 27001 A.5.9 =
// inventario di ASSET). NB: i patch panel / passacavi / pannelli ciechi sono elementi
// RACK (compaiono nell'elevation, hanno collocazione) e NON sono qui: restano nel
// registro. Denylist locale come LAYOUT_TYPES (TYPES e' un modulo frontend, non
// importabile lato server); un nuovo tipo floor-passivo-senza-IP va aggiunto qui.
const STRUCTURAL_CABLING_TYPES = new Set(['wallport', 'panelboard']);

// True se il tipo (o il DTO device) e' cablaggio strutturale da NON documentare come asset.
function isStructuralCabling(typeOrDev) {
  const type = typeof typeOrDev === 'string' ? typeOrDev : (typeOrDev && typeOrDev.type);
  return STRUCTURAL_CABLING_TYPES.has(type);
}

// IP canonico di un nodo: campo esplicito, poi host dell'integrazione SNMP.
function _ipOf(node) {
  if (!node) return '';
  return (node.ip || (node.integration && node.integration.host) || '').toString().trim();
}

// Rimuove eventuali credenziali (`user:pass@` / `user@`) dall'authority di un URL.
// L'URL di gestione è "solo IP" per design (src/app-management.js), ma è input
// libero: difesa contro un leak accidentale di credenziali nella superficie pubblica.
function _stripUrlCreds(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) return '';
  return s.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

// DTO del PUNTATORE backup (node.backup): { ref, method, at } — MAI il config, MAI `by`
// (metadato d'audit interno). `ref` cred-strippato per difesa in profondità (come mgmtUrl).
function _backupDto(backup) {
  const b = (backup && typeof backup === 'object') ? backup : null;
  if (!b) return null;
  // `stripRefCreds` e non `_stripUrlCreds`: il puntatore backup accetta anche la
  // forma scp senza schema (`user:pass@host:/path`), che l'altra non vede. Una
  // regola sola, quella del validatore, per DTO REST e pagina DR del PDF.
  const ref = stripRefCreds(b.ref) || null;
  const method = (b.method == null ? '' : String(b.method)).trim() || null;
  const at = (b.at == null ? '' : String(b.at)).trim() || null;
  return (ref || method || at) ? { ref, method, at } : null;
}

// Slug sicuro per nomi di gruppo Ansible / segmenti: minuscolo, non-alnum → "_".
function _slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

// Indice VLAN precompilato: [{vlan:Number, info:cidrInfo, prefix:Number}] da
// state.ipam.prefixes. TUTTI i prefissi, non uno per VLAN: un indirizzo puo'
// cadere in una /25 dentro una /24 e la risposta giusta e' la piu' specifica.
function _vlanIndex(state) {
  const idx = [];
  const list = (state && state.ipam && Array.isArray(state.ipam.prefixes)) ? state.ipam.prefixes : [];
  for (const p of list) {
    if (!p || p.vlan == null) continue;          // `+null === 0`: niente «VLAN 0»
    const info = p.cidr ? _parseCidrInfo(p.cidr) : null;
    if (info) idx.push({ vlan: Number(p.vlan), info, prefix: info.prefix });
  }
  return idx;
}

function _vlanForIp(ip, vlanIdx) {
  if (!ip) return null;
  let best = null, bestLen = -1;
  for (const e of vlanIdx) {
    if (!_ipInCidr(ip, e.info) || e.prefix <= bestLen) continue;
    best = e.vlan; bestLen = e.prefix;
  }
  return best;
}

// «Gestito via SNMP» = driver snmp* **e** un indirizzo a cui rivolgersi. È la
// stessa condizione con cui il resto del prodotto decide chi interrogare
// (lib/subbar-stats.js `_hasSnmp`, lib/overview.js, src/app-drift.js): guardare
// il solo driver contava anche chi non ha ancora un indirizzo, e quel device
// finiva nel conteggio pubblico E nel gruppo Ansible `snmp_managed`, cioè fra i
// bersagli di un playbook. Tre switch, uno solo interrogabile: l'app ne diceva 1
// e l'API 3 (audit 2026-08-20, C3).
function _hasSnmpAccess(node, ip) {
  const integ = (node && node.integration) || {};
  const driver = (integ.driver == null ? '' : String(integ.driver)).trim().toLowerCase();
  if (driver.indexOf('snmp') !== 0) return false;
  const host = (integ.host == null ? '' : String(integ.host)).trim();
  const addr = (ip == null ? '' : String(ip)).trim();
  return !!(host || addr);
}

// DTO device — ALLOWLIST. Solo i campi qui elencati finiscono nella risposta.
// `snmp` è un BOOLEANO (il device ha un accesso SNMP utilizzabile), MAI la community.
function nodeToDevice(node, ctx) {
  ctx = ctx || {};
  const rackById = ctx.rackById || {};
  const vlanIdx = ctx.vlanIdx || [];
  const ip = _ipOf(node);
  const rack = (node.rackId && rackById[node.rackId]) ? rackById[node.rackId] : null;
  const _s = v => { const t = (v == null ? '' : String(v)).trim(); return t || null; };
  return {
    id: node.id,
    name: (node.name || '').toString() || node.id,
    type: node.type || null,
    brand: node.brand || null,
    model: node.model || null,
    ip: ip || null,
    ip6: _s(node.ip6),                                        // IPv6 documentato (campo a sé; NON instrada Ansible)
    mac: (node.mac || '').toString().toUpperCase() || null,   // identità (MAC)
    hostname: _s(node.hostname),                              // sysName / nome di rete documentato
    serial: _s(node.serialNumber),                            // inventario (ENTITY-MIB)
    firmware: _s(node.firmwareVer),                           // firmware / OS
    vlan: _vlanForIp(ip, vlanIdx),
    rack: rack
      ? { id: rack.id, name: rack.name || null, u: (node.rackU != null ? node.rackU : null), sizeU: (node.sizeU != null ? node.sizeU : null) }
      : null,
    snmp: _hasSnmpAccess(node, ip),                           // booleano, NON la community
    wireless: Array.isArray(node.radios) && node.radios.length > 0,
    // Gestione: protocollo + URL (solo IP, MAI credenziali — vedi src/app-management.js).
    mgmtProtocol: _s(node.mgmtProto),
    mgmtUrl: _stripUrlCreds(node.mgmtUrl) || null,
    // ansible_network_os derivato dal vendor NOTO (null se ignoto) — brand/model
    // dichiarati + sysDescr misurato. Serve al modulo Ansible giusto (es. backup).
    // La `platform` di provenienza (import DCIM) è una DICHIARAZIONE del NOS e batte
    // l'ipotesi da marca: un Nexus dichiarato non deve ricevere comandi IOS.
    networkOs: vendorToNetworkOs({
      brand: node.brand, model: node.model,
      sysDescr: node.integration && node.integration.system && node.integration.system.sysDescr,
      platform: node.source && (node.source.platformName || node.source.platformSlug),
    }),
    // Puntatore al backup di config (DOVE vive, non il config): { ref, method, at }.
    backup: _backupDto(node.backup),
  };
}

function _devices(state) {
  const nodes = Array.isArray(state.nodes) ? state.nodes : [];
  const rackById = {};
  for (const r of (Array.isArray(state.racks) ? state.racks : [])) rackById[r.id] = r;
  const vlanIdx = _vlanIndex(state);
  const ctx = { rackById, vlanIdx };
  return nodes
    .filter(n => n && n.type && !LAYOUT_TYPES.has(n.type))
    .map(n => nodeToDevice(n, ctx));
}

// Reti dichiarate — ALLOWLIST, come ogni DTO qui. `id`/`vrfId`/`tenantId` sono
// riferimenti OPACHI del DCIM: si conservano perche' servono a chi riconcilia, non
// si interpretano.
function _prefixes(state) {
  const list = (state.ipam && Array.isArray(state.ipam.prefixes)) ? state.ipam.prefixes : [];
  const out = [];
  for (const p of list) {
    if (!p || !p.cidr) continue;
    out.push({
      cidr: String(p.cidr),
      vlan: p.vlan != null ? Number(p.vlan) : null,
      name: p.name || null,
      gateway: p.gateway || null,
      dns: p.dns || null,
      status: p.status || null,
      description: p.description || null,
      source: p.source || null,
    });
  }
  return out;
}

function _vlans(state) {
  const out = [];
  // Vista per-VLAN derivata dai prefissi. `subnet`/`gateway`/`dns` restano campi
  // singoli per non cambiare la forma del DTO pubblico: una VLAN dual-stack qui
  // mostra il suo prefisso IPv4. L'elenco completo e' in `prefixes`.
  const ipam = ipamByVidView(state);
  const names = state.vlanNames || {};
  const ids = new Set([...Object.keys(ipam), ...Object.keys(names)]);
  for (const vid of [...ids].sort((a, b) => Number(a) - Number(b))) {
    const e = ipam[vid] || {};
    out.push({ id: Number(vid), name: names[vid] || null, subnet: e.subnet || null, gateway: e.gateway || null, dns: e.dns || null });
  }
  return out;
}

function _racks(state) {
  return (Array.isArray(state.racks) ? state.racks : [])
    .map(r => ({ id: r.id, name: r.name || null, sizeU: (r.sizeU != null ? r.sizeU : null) }));
}

// Inventario pubblico completo di un progetto (forma stabile, versionata v1).
function projectToInventory(project) {
  const p = project || {};
  const state = p.state || {};
  const devices = _devices(state);
  return {
    id: p.id,
    name: p.name || null,
    updated_at: p.updated_at || null,
    counts: {
      devices: devices.length,
      withIp: devices.filter(d => d.ip).length,
      snmp: devices.filter(d => d.snmp).length,
    },
    vlans: _vlans(state),
    // Le reti dichiarate, per intero. `vlans[].subnet` resta il prefisso PRINCIPALE
    // per non cambiare la forma di un campo pubblico, ma da solo mente due volte:
    // di una VLAN dual-stack mostra meta', e le reti senza VLAN — la maggioranza in
    // un NetBox vero — non le nomina affatto. Qui ci sono tutte, con la loro VLAN
    // (`vlan: null` = nessuna) e la provenienza.
    prefixes: _prefixes(state),
    racks: _racks(state),
    devices,
  };
}

// Solo l'elenco device (per consumer che non vogliono VLAN/rack di contorno).
function projectToDevices(project) {
  return _devices((project && project.state) || {});
}

// ── Ansible dynamic inventory (formato `--list`) ────────────────────────────
// _meta.hostvars + gruppi per tipo/VLAN/rack/brand. Solo device con IP (Ansible
// ha bisogno di ansible_host). Hostname = name (deduplicato), univoco per inventory.
function _ansibleHostname(dev, used) {
  let base = String(dev.name || dev.id || '').trim().replace(/\s+/g, '_');
  if (!base) base = String(dev.id || 'host');
  let name = base;
  let i = 2;
  while (used.has(name)) name = base + '_' + (i++);   // disambigua collisioni
  used.add(name);
  return name;
}

function toAnsibleInventory(project) {
  const inv = projectToInventory(project);
  const meta = { hostvars: {} };
  const groups = {};                                  // nome gruppo → Set host
  const used = new Set();
  const addGroup = (g, host) => { (groups[g] || (groups[g] = new Set())).add(host); };
  // Indice VLAN → contesto di rete (subnet/gateway/dns/nome): arricchisce ogni host
  // con la sua rete L3, derivata dall'IPAM-lite per-VLAN. Manual-first: lo dichiari tu.
  const vlanById = {};
  for (const v of inv.vlans) vlanById[v.id] = v;

  for (const dev of inv.devices) {
    if (!dev.ip) continue;                            // niente IP → non instradabile da Ansible
    const host = _ansibleHostname(dev, used);
    const net = (dev.vlan != null && vlanById[dev.vlan]) ? vlanById[dev.vlan] : null;
    meta.hostvars[host] = {
      ansible_host: dev.ip,
      infranet_id: dev.id,
      infranet_type: dev.type,
      hostname: dev.hostname,
      mac: dev.mac,
      brand: dev.brand,
      model: dev.model,
      serial: dev.serial,
      firmware: dev.firmware,
      // contesto di rete (dalla VLAN del device)
      vlan: dev.vlan,
      vlan_name: net ? net.name : null,
      subnet: net ? net.subnet : null,
      gateway: net ? net.gateway : null,
      dns: net ? net.dns : null,
      // collocazione fisica
      rack: dev.rack ? dev.rack.name : null,
      rack_id: dev.rack ? dev.rack.id : null,
      rack_unit: dev.rack ? dev.rack.u : null,
      // gestione / capacità
      snmp: dev.snmp,
      wireless: dev.wireless,
      mgmt_protocol: dev.mgmtProtocol,
      mgmt_url: dev.mgmtUrl,
      // backup config: puntatore (DOVE), non il config. Var consumate dal playbook.
      config_backup_ref: (dev.backup && dev.backup.ref) || null,
      config_backup_method: (dev.backup && dev.backup.method) || null,
      config_backup_at: (dev.backup && dev.backup.at) || null,
    };
    // ansible_network_os: emesso SOLO se noto (un valore null romperebbe la connessione).
    if (dev.networkOs) meta.hostvars[host].ansible_network_os = dev.networkOs;
    if (dev.type) addGroup('type_' + _slug(dev.type), host);
    if (dev.vlan != null) addGroup('vlan_' + dev.vlan, host);
    if (dev.rack) addGroup('rack_' + _slug(dev.rack.id), host);
    if (dev.brand) addGroup('brand_' + _slug(dev.brand), host);
    if (dev.wireless) addGroup('wireless', host);     // target rapido degli AP/radio
    if (dev.snmp) addGroup('snmp_managed', host);      // target dei device gestiti via SNMP
    // Target diretto per la lente «Ripristinabilità» / «chi non ha backup».
    if (!(dev.backup && dev.backup.ref)) addGroup('backup_missing', host);
  }

  const out = { _meta: meta };
  const children = [];
  for (const g of Object.keys(groups).sort()) {
    out[g] = { hosts: [...groups[g]].sort() };
    children.push(g);
  }
  out.all = { children: children.concat('ungrouped') };
  return out;
}

// Fallback MAC per il REGISTRO ASSET (documentazione). I device gestiti via SNMP
// (switch/router/WLC) NON hanno un MAC di device — i loro MAC vivono sulle PORTE
// (dallo SNMP); solo gli endpoint (da ARP) hanno un MAC di nodo. Senza fallback la
// colonna MAC del registro esce vuota per tutta l'infrastruttura, pur essendoci il
// dato. Qui, per ogni device SENZA `mac`, si pesca il MAC della porta col suffisso
// numerico piu' basso (≈ MAC base/chassis), deterministico. È MISURATO (dalle porte)
// e vive SOLO qui: il DTO condiviso (REST API v1 / Ansible) resta col solo MAC di
// device, semanticamente preciso. Muta e ritorna `devices`.
function applyPortMacFallback(devices, ports) {
  const P = (ports && typeof ports === 'object') ? ports : {};
  const list = Array.isArray(devices) ? devices : [];
  for (const d of list) {
    if (!d || d.mac || !d.id) continue;
    const prefix = String(d.id) + '-';
    let best = null, bestN = Infinity;
    for (const pid in P) {
      if (pid.slice(0, prefix.length) !== prefix) continue;      // porta di QUESTO device
      const m = P[pid] && P[pid].mac;
      if (!m) continue;
      const suf = parseInt(pid.slice(prefix.length), 10);         // radio/pid non-numerici → NaN → scartati
      const n = Number.isFinite(suf) ? suf : Infinity;
      if (n < bestN) { bestN = n; best = String(m).toUpperCase(); }
    }
    if (best) d.mac = best;
  }
  return list;
}

// Note per-device per il REGISTRO ASSET (documentazione). La nota e' prosa scritta
// a mano dall'operatore («spegnere di notte», «alimentato dal quadro B»): appartiene
// alla RIGA del suo apparato, non a un capitolo separato dove andrebbe riletta
// incrociando i nomi. Vive SOLO qui, come il fallback MAC: il DTO condiviso
// (REST API v1 / Ansible) non porta testo libero — e' un contratto
// macchina-a-macchina. Muta e ritorna `devices`.
function applyDeviceNotes(devices, nodes) {
  const list = Array.isArray(devices) ? devices : [];
  const byId = new Map();
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    if (!n || n.id == null) continue;
    const t = (n.notes == null ? '' : String(n.notes)).trim();
    if (t) byId.set(String(n.id), t);
  }
  for (const d of list) {
    if (!d || d.id == null) continue;
    const t = byId.get(String(d.id));
    if (t) d.notes = t;
  }
  return list;
}

module.exports = {
  projectToInventory,
  projectToDevices,
  toAnsibleInventory,
  nodeToDevice,
  applyPortMacFallback,
  applyDeviceNotes,
  isStructuralCabling,
  // esportati per i test puri
  _vlanIndex, _vlanForIp, _slug, _ipOf, LAYOUT_TYPES, STRUCTURAL_CABLING_TYPES,
};
