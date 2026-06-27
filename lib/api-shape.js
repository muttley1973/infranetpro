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

// Tipi puramente strutturali/di layout (TYPES[x].isStructural in src/app-types.js):
// non sono device di rete → esclusi dall'inventario. Oggi solo "room" (stanza).
// Tenuto come piccola denylist locale: i tipi strutturali sono rari e stabili,
// e la lib resta pura (TYPES è un modulo frontend, non importabile lato server).
const LAYOUT_TYPES = new Set(['room']);

// IP canonico di un nodo: campo esplicito, poi host dell'integrazione SNMP.
function _ipOf(node) {
  if (!node) return '';
  return (node.ip || (node.integration && node.integration.host) || '').toString().trim();
}

// Slug sicuro per nomi di gruppo Ansible / segmenti: minuscolo, non-alnum → "_".
function _slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

// Indice VLAN precompilato: [{vlan:Number, info:cidrInfo}] da state.ipam.vlans.
function _vlanIndex(ipamVlans) {
  const idx = [];
  if (ipamVlans && typeof ipamVlans === 'object') {
    for (const vid of Object.keys(ipamVlans)) {
      const sub = ipamVlans[vid] && ipamVlans[vid].subnet;
      const info = sub ? _parseCidrInfo(sub) : null;
      if (info) idx.push({ vlan: Number(vid), info });
    }
  }
  return idx;
}

function _vlanForIp(ip, vlanIdx) {
  if (!ip) return null;
  for (const e of vlanIdx) if (_ipInCidr(ip, e.info)) return e.vlan;
  return null;
}

// DTO device — ALLOWLIST. Solo i campi qui elencati finiscono nella risposta.
// `snmp` è un BOOLEANO (il device ha un'integrazione configurata), MAI la community.
function nodeToDevice(node, ctx) {
  ctx = ctx || {};
  const rackById = ctx.rackById || {};
  const vlanIdx = ctx.vlanIdx || [];
  const ip = _ipOf(node);
  const rack = (node.rackId && rackById[node.rackId]) ? rackById[node.rackId] : null;
  return {
    id: node.id,
    name: (node.name || '').toString() || node.id,
    type: node.type || null,
    brand: node.brand || null,
    model: node.model || null,
    ip: ip || null,
    mac: (node.mac || '').toString().toUpperCase() || null,   // identità (MAC)
    vlan: _vlanForIp(ip, vlanIdx),
    rack: rack
      ? { id: rack.id, name: rack.name || null, u: (node.rackU != null ? node.rackU : null), sizeU: (node.sizeU != null ? node.sizeU : null) }
      : null,
    snmp: !!(node.integration && node.integration.driver),    // booleano, NON la community
    wireless: Array.isArray(node.radios) && node.radios.length > 0,
  };
}

function _devices(state) {
  const nodes = Array.isArray(state.nodes) ? state.nodes : [];
  const rackById = {};
  for (const r of (Array.isArray(state.racks) ? state.racks : [])) rackById[r.id] = r;
  const vlanIdx = _vlanIndex(state.ipam && state.ipam.vlans);
  const ctx = { rackById, vlanIdx };
  return nodes
    .filter(n => n && n.type && !LAYOUT_TYPES.has(n.type))
    .map(n => nodeToDevice(n, ctx));
}

function _vlans(state) {
  const out = [];
  const ipam = (state.ipam && state.ipam.vlans) || {};
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

  for (const dev of inv.devices) {
    if (!dev.ip) continue;                            // niente IP → non instradabile da Ansible
    const host = _ansibleHostname(dev, used);
    meta.hostvars[host] = {
      ansible_host: dev.ip,
      infranet_id: dev.id,
      infranet_type: dev.type,
      mac: dev.mac,
      brand: dev.brand,
      model: dev.model,
      vlan: dev.vlan,
      rack: dev.rack ? dev.rack.name : null,
      snmp: dev.snmp,
    };
    if (dev.type) addGroup('type_' + _slug(dev.type), host);
    if (dev.vlan != null) addGroup('vlan_' + dev.vlan, host);
    if (dev.rack) addGroup('rack_' + _slug(dev.rack.id), host);
    if (dev.brand) addGroup('brand_' + _slug(dev.brand), host);
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

module.exports = {
  projectToInventory,
  projectToDevices,
  toAnsibleInventory,
  nodeToDevice,
  // esportati per i test puri
  _vlanIndex, _vlanForIp, _slug, _ipOf, LAYOUT_TYPES,
};
