'use strict';
// ============================================================
//  lib/dcim-map.js — mappatura PURA DCIM (adapter NetBox) ↔ stato InfraNet.
//
//  Fase B: direzione IMPORT (oggetti NetBox → nuovo `state` InfraNet). Zero DOM,
//  zero IO: solo funzioni pure testabili con node --test. UMD-lite (browser+node)
//  come lib/link-model.js. L'EXPORT (state→NetBox) arriverà in Fase C.
//
//  Gli ID nodo generati qui NON sono canonici (`nb-dev-<id>`): il caricamento
//  progetto (`_migrateState`→`_normalizeProjectNodeIds`) li rinumera a `sw1/rt1/…`
//  e RIMAPPA di conseguenza chiavi porte e src/dst dei link. Basta che porte e
//  link referenzino gli stessi id che assegno qui: la coerenza interna regge.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DcimMap = api;   // browser: window.DcimMap (uso futuro lato client)
}(typeof self !== 'undefined' ? self : this, function () {

  function _lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function _str(s) { return String(s == null ? '' : s).trim(); }

  // Prefisso IP → indirizzo nudo: "10.0.0.2/24" → "10.0.0.2".
  function _stripPrefix(addr) {
    const s = _str(addr);
    const cut = s.indexOf('/');
    return cut > 0 ? s.slice(0, cut) : s;
  }

  // Ordinamento naturale per nome interfaccia (numeri come numeri): così
  // "Gi1/0/2" < "Gi1/0/10". Deterministico → assegnazione slot stabile.
  function _natCmp(a, b) {
    const ax = String(a || '').match(/(\d+|\D+)/g) || [];
    const bx = String(b || '').match(/(\d+|\D+)/g) || [];
    for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
      const as = ax[i], bs = bx[i];
      if (as === undefined) return -1;
      if (bs === undefined) return 1;
      const an = /^\d+$/.test(as), bn = /^\d+$/.test(bs);
      if (an && bn) { const d = parseInt(as, 10) - parseInt(bs, 10); if (d) return d; }
      else if (as !== bs) return as < bs ? -1 : 1;
    }
    return 0;
  }

  // Ordine di slot delle interfacce di UN device: prima le porte dati, poi le
  // mgmt-only; dentro ogni gruppo ordine naturale per nome. Ritorna l'array
  // ordinato (input non mutato).
  function _ifaceSlotOrder(interfaces) {
    const list = Array.isArray(interfaces) ? interfaces.slice() : [];
    return list.sort((a, b) => {
      const am = a && a.mgmt_only ? 1 : 0, bm = b && b.mgmt_only ? 1 : 0;
      if (am !== bm) return am - bm;
      return _natCmp(a && a.name, b && b.name);
    });
  }

  // Tabella ruolo NetBox (slug) → tipo InfraNet (chiave TYPES).
  const _ROLE_MAP = {
    switch: 'switch', 'access-switch': 'switch', 'core-switch': 'switch', 'distribution-switch': 'switch',
    'l3-switch': 'switch', 'tor-switch': 'switch', 'top-of-rack-switch': 'switch',
    router: 'router', 'edge-router': 'router', firewall: 'firewall',
    'ap': 'ap', 'wireless-ap': 'ap', 'access-point': 'ap', 'wireless-lan-controller': 'wlanctrl', wlc: 'wlanctrl',
    server: 'server', 'application-server': 'server', 'database-server': 'server',
    'app-server': 'server', 'db-server': 'server', 'web-server': 'server',
    hypervisor: 'hypervisor', storage: 'nas', nas: 'nas', pdu: 'pdu', ups: 'ups', ats: 'ats',
    printer: 'printer', labelprinter: 'printer', 'label-printer': 'printer',
    'patch-panel': 'patchpanel', 'console-server': 'consolesvr', pbx: 'pbx', nvr: 'nvr',
  };

  // Ruolo/nome/modello → tipo InfraNet. Ritorna { type, mapped } (mapped=false se
  // ha usato il default generico → finisce in report.unmappedRoles).
  function _roleToInfranetType(roleSlug, roleName, model) {
    const s = _lc(roleSlug);
    if (_ROLE_MAP[s]) return { type: _ROLE_MAP[s], mapped: true };
    const hay = (s + ' ' + _lc(roleName) + ' ' + _lc(model)).trim();
    if (/firewall|\bfw\b|palo ?alto|fortigate|sonicwall|checkpoint/.test(hay)) return { type: 'firewall', mapped: true };
    if (/access ?point|\bap\b|airengine|aironet|unifi ?ap/.test(hay)) return { type: 'ap', mapped: true };
    if (/hypervisor|\besxi\b|proxmox|vmware ?esx/.test(hay)) return { type: 'hypervisor', mapped: true };   // prima di "server"
    if (/label ?printer|\bprinter\b/.test(hay)) return { type: 'printer', mapped: true };
    if (/\bups\b/.test(hay)) return { type: 'ups', mapped: true };
    if (/\bpdu\b/.test(hay)) return { type: 'pdu', mapped: true };
    if (/\bnas\b|storage|synology|qnap|truenas/.test(hay)) return { type: 'nas', mapped: true };
    if (/\brouter\b|mikrotik|\bisr\b|\basr\b/.test(hay)) return { type: 'router', mapped: true };
    if (/\bserver\b|poweredge|proliant/.test(hay)) return { type: 'server', mapped: true };
    if (/switch|catalyst|nexus|\bex\d|arista/.test(hay)) return { type: 'switch', mapped: true };
    return { type: 'customrack', mapped: false };   // generico rack: non inventiamo una classe precisa
  }

  // Device-type NetBox → template del catalogo InfraNet (data/device-types.json),
  // per chiave "brand model" (come src/app-device-types.js `_byKey`). null se assente.
  function _deviceTypeToCatalog(brand, model, catalogByKey) {
    if (!catalogByKey) return null;
    const key = (_lc(brand) + ' ' + _lc(model)).trim();
    return catalogByKey[key] || null;
  }

  // Mappa il tipo di cavo NetBox a una categoria InfraNet (best-effort).
  function _cableCategory(nbType) {
    const t = _lc(nbType && nbType.value !== undefined ? nbType.value : nbType);
    if (!t) return '';
    if (/^cat/.test(t)) return t.replace(/[^a-z0-9]/g, '');   // cat5e/cat6/cat6a/cat7/cat8
    if (/mmf|om[1-5]/.test(t)) return 'fiber-mm';
    if (/smf|os[12]/.test(t)) return 'fiber-sm';
    if (/dac|twinax/.test(t)) return 'dac';
    return t;
  }

  function _indexById(arr) {
    const idx = Object.create(null);
    for (const o of (Array.isArray(arr) ? arr : [])) if (o && o.id != null) idx[o.id] = o;
    return idx;
  }

  /**
   * netboxToState(nb, opts) → { state, report }
   *  nb = { manufacturers, deviceTypes, deviceRoles, sites, racks, devices,
   *         interfaces, cables, vlans, prefixes, ipAddresses, truncated }
   *       (array già paginati; una categoria non richiesta può mancare = []).
   *  opts = { catalogByKey, selection }
   *       selection.exclude = ["device:<id>", "rack:<id>", "cable:<id>", …]
   */
  function netboxToState(nb, opts) {
    nb = nb || {};
    opts = opts || {};
    const catalogByKey = opts.catalogByKey || null;
    const sel = opts.selection || {};
    const excluded = new Set(Array.isArray(sel.exclude) ? sel.exclude : []);
    const isOut = (kind, id) => excluded.has(kind + ':' + id);

    const dtById = _indexById(nb.deviceTypes);
    const mfById = _indexById(nb.manufacturers);
    const roleById = _indexById(nb.deviceRoles);
    const vlanById = _indexById(nb.vlans);

    const state = { nodes: [], links: [], ports: {}, racks: [], ipam: { vlans: {} }, vlanNames: {}, vlanColors: {} };
    const report = {
      counts: { devices: 0, interfaces: 0, cables: 0, vlans: 0, prefixes: 0, ips: 0, racks: 0 },
      unmappedRoles: [], unmatchedDeviceTypes: [], warnings: [], truncated: !!nb.truncated,
    };
    const seenUnmappedRole = new Set(), seenUnmatchedDt = new Set();

    // ── Rack ──────────────────────────────────────────────────────────────
    // I nomi rack restano quelli di NetBox (unici dentro un sito). Modello:
    // "UN SITO = UN PROGETTO" → il nome del sito va nel NOME DEL PROGETTO
    // (_proposedName lato route), non spalmato sui rack. Importa un sito alla volta.
    const rackIdMap = Object.create(null);   // nbRackId → infranet rackId
    for (const r of (Array.isArray(nb.racks) ? nb.racks : [])) {
      if (!r || r.id == null || isOut('rack', r.id)) continue;
      const rid = 'nb-rack-' + r.id;
      rackIdMap[r.id] = rid;
      const rk = { id: rid, name: _str(r.name) || rid };
      if (Number.isFinite(+r.u_height) && +r.u_height > 0) rk.sizeU = +r.u_height;   // no invenzione 42U
      state.racks.push(rk);
      report.counts.racks++;
    }

    // ── Interfacce raggruppate per device ────────────────────────────────
    const ifByDevice = Object.create(null);
    for (const itf of (Array.isArray(nb.interfaces) ? nb.interfaces : [])) {
      const did = itf && itf.device && itf.device.id;
      if (did == null) continue;
      (ifByDevice[did] || (ifByDevice[did] = [])).push(itf);
    }
    const ifSlot = Object.create(null);   // nbInterfaceId → { nodeId, slot }

    // ── Device → nodi + porte ────────────────────────────────────────────
    for (const dev of (Array.isArray(nb.devices) ? nb.devices : [])) {
      if (!dev || dev.id == null || isOut('device', dev.id)) continue;
      const nodeId = 'nb-dev-' + dev.id;

      const dt = (dev.device_type && dtById[dev.device_type.id]) || dev.device_type || null;
      const mf = dt && dt.manufacturer ? (mfById[dt.manufacturer.id] || dt.manufacturer) : null;
      const brand = _str(mf && mf.name);
      const model = _str(dt && dt.model);
      // NetBox recente: dev.role ; versioni vecchie: dev.device_role.
      const roleRef = dev.role || dev.device_role || null;
      const role = roleRef ? (roleById[roleRef.id] || roleRef) : null;
      const rt = _roleToInfranetType(role && role.slug, role && role.name, model);
      if (!rt.mapped) {
        const rn = _str((role && (role.name || role.slug)) || '(nessun ruolo)');
        if (!seenUnmappedRole.has(rn)) { seenUnmappedRole.add(rn); report.unmappedRoles.push(rn); }
      }

      // Nome: quello dichiarato; se assente, il `display` di NetBox (se non è solo
      // l'id tipo "{123}"), poi "Modello #id", infine l'id interno come ultima spiaggia.
      let name = _str(dev.name);
      if (!name) {
        const disp = _str(dev.display);
        const dispOk = disp && !/^\{?\d+\}?$/.test(disp);
        name = dispOk ? disp : (model ? model + ' #' + dev.id : nodeId);
      }
      const node = { id: nodeId, name, type: rt.type };
      if (brand) node.brand = brand;
      if (model) node.model = model;
      const serial = _str(dev.serial);
      if (serial) node.serialNumber = serial;

      // Ubicazione (Location NetBox = piano/stanza): InfraNet non ha un campo dedicato
      // né un multipiano nativo, e i rack non hanno una nota → il piano si preserva
      // nelle NOTE del device (mostrate in Proprietà). Modello IBRIDO: un progetto per
      // sito, il piano resta come metadato leggibile, senza fingere una gerarchia.
      const locName = _str(dev.location && dev.location.name);
      if (locName) {
        const siteName = _str(dev.site && dev.site.name);
        node.notes = siteName ? siteName + ' · ' + locName : locName;
      }

      // Collocazione rack (solo tipi rack + rack importato).
      if (dev.rack && rackIdMap[dev.rack.id]) {
        node.rackId = rackIdMap[dev.rack.id];
        if (Number.isFinite(+dev.position) && +dev.position > 0) node.rackU = +dev.position;
      }
      if (Number.isFinite(+(dt && dt.u_height)) && +dt.u_height > 0) node.sizeU = +dt.u_height;

      // IP primari (dal device serialization di NetBox).
      const ip4 = dev.primary_ip4 && _stripPrefix(dev.primary_ip4.address);
      const ip6 = dev.primary_ip6 && _stripPrefix(dev.primary_ip6.address);
      if (ip4) node.ip = ip4;
      if (ip6) node.ip6 = ip6;

      // Porte dalle interfacce (slot 1..K, ordine deterministico).
      const ordered = _ifaceSlotOrder(ifByDevice[dev.id]);
      let slot = 0;
      for (const itf of ordered) {
        slot++;
        const pid = nodeId + '-' + slot;
        if (itf && itf.id != null) ifSlot[itf.id] = { nodeId, slot };
        const port = {};
        if (_str(itf.name)) port.ifName = _str(itf.name);
        const desc = _str(itf.description) || _str(itf.label);
        if (desc) port.desc = desc;
        if (_str(itf.mac_address)) port.mac = _str(itf.mac_address).toUpperCase();
        const mode = itf.mode && (itf.mode.value !== undefined ? itf.mode.value : itf.mode);
        if (mode === 'access' && itf.untagged_vlan && Number.isFinite(+itf.untagged_vlan.vid)) {
          port.vlanOvr = +itf.untagged_vlan.vid;
        } else if ((mode === 'tagged' || mode === 'tagged-all') && Array.isArray(itf.tagged_vlans)) {
          port.mode = 'trunk';
          port.trunkVlans = itf.tagged_vlans.map(v => +v.vid).filter(Number.isFinite);
        }
        if (itf.lag && itf.lag.id != null) port.lagGroup = 'nb-lag-' + itf.lag.id;
        if (itf.type && _lc(itf.type.value) === 'lag') port.lagGroup = 'nb-lag-' + itf.id;
        state.ports[pid] = port;
        report.counts.interfaces++;
      }

      // Conteggio porte del nodo: template del catalogo se combacia ED è
      // capiente (mai nascondere interfacce misurate), altrimenti = K misurate.
      const tmpl = _deviceTypeToCatalog(brand, model, catalogByKey);
      if (tmpl && Number.isFinite(+tmpl.ports) && +tmpl.ports >= slot) {
        node.ports = +tmpl.ports;
        if (tmpl.frontPanel) node.frontPanel = Object.assign({}, tmpl.frontPanel);
      } else {
        node.ports = slot;
        if (brand && model) {
          const dk = brand + ' ' + model;
          if (!seenUnmatchedDt.has(dk)) { seenUnmatchedDt.add(dk); report.unmatchedDeviceTypes.push(dk); }
        }
      }

      state.nodes.push(node);
      report.counts.devices++;
    }

    // ── Cavi → link (dopo che tutte le porte esistono) ───────────────────
    const _terms = (cable, side) => {
      // NetBox 3.3+: a_terminations/b_terminations[]; versioni vecchie: termination_a_id.
      const arr = cable[side + '_terminations'];
      if (Array.isArray(arr)) return arr.map(t => ({ type: t.object_type, id: t.object_id }));
      const legacyId = cable['termination_' + side + '_id'];
      if (legacyId != null) return [{ type: cable['termination_' + side + '_type'], id: legacyId }];
      return [];
    };
    for (const c of (Array.isArray(nb.cables) ? nb.cables : [])) {
      if (!c || c.id == null || isOut('cable', c.id)) continue;
      const a = _terms(c, 'a'), b = _terms(c, 'b');
      // MVP: solo cavi diretti interfaccia↔interfaccia (una terminazione per lato).
      const aif = a.find(t => ifSlot[t.id]);
      const bif = b.find(t => ifSlot[t.id]);
      if (!aif || !bif) { report.warnings.push('cavo ' + c.id + ' saltato (terminazione non su interfaccia importata)'); continue; }
      const A = ifSlot[aif.id], B = ifSlot[bif.id];
      const link = { id: 'nb-cbl-' + c.id, src: A.nodeId + '-' + A.slot, dst: B.nodeId + '-' + B.slot };
      const cat = _cableCategory(c.type);
      if (cat) link.cableCategory = cat;
      if (Number.isFinite(+c.length) && +c.length > 0) {
        const unit = _lc(c.length_unit && (c.length_unit.value !== undefined ? c.length_unit.value : c.length_unit));
        link.lengthM = unit === 'ft' ? Math.round(+c.length * 0.3048 * 100) / 100 : +c.length;
      }
      if (_str(c.color)) link.color = '#' + _str(c.color).replace(/^#/, '');
      state.links.push(link);
      report.counts.cables++;
    }

    // ── VLAN + prefissi → IPAM ──────────────────────────────────────────
    for (const v of (Array.isArray(nb.vlans) ? nb.vlans : [])) {
      if (!v || !Number.isFinite(+v.vid)) continue;
      const name = _str(v.name);
      if (name) state.vlanNames[v.vid] = name;
      report.counts.vlans++;
    }
    for (const p of (Array.isArray(nb.prefixes) ? nb.prefixes : [])) {
      if (!p || !_str(p.prefix)) continue;
      report.counts.prefixes++;
      const vid = p.vlan && (p.vlan.vid != null ? p.vlan.vid : (vlanById[p.vlan.id] && vlanById[p.vlan.id].vid));
      if (Number.isFinite(+vid)) {
        (state.ipam.vlans[vid] || (state.ipam.vlans[vid] = {})).subnet = _str(p.prefix);
      }
    }
    report.counts.ips = (Array.isArray(nb.ipAddresses) ? nb.ipAddresses.length : 0);

    return { state, report };
  }

  return {
    netboxToState,
    // esportati per i test puri
    _roleToInfranetType, _deviceTypeToCatalog, _ifaceSlotOrder, _cableCategory,
    _stripPrefix, _natCmp,
  };
}));
