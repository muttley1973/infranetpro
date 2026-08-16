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

  const _catalogApi = typeof require === 'function' ? require('./device-catalog') : null;
  const _pduLayoutApi = typeof require === 'function' ? require('./pdu-layout') : null;

  function _lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function _str(s) { return String(s == null ? '' : s).trim(); }

  function _ifaceValue(value) {
    return _lc(value && typeof value === 'object' && value.value !== undefined ? value.value : value);
  }

  function _ifaceKind(iface) {
    const name = _lc(iface && (iface.name || iface.label));
    const type = _ifaceValue(iface && iface.type);
    const mgmt = iface && (iface.mgmt_only !== undefined ? iface.mgmt_only : iface.mgmtOnly);
    if (mgmt === true || _lc(mgmt) === 'true' || /(^|[^a-z])(mgmt|management)([^a-z]|$)/.test(name)) return 'mgmt';
    if (/virtual|lag|bridge|ieee802\.11|wireless|lte/.test(type) || /(^|[^a-z])(lag|loopback|vlan|virtual|bridge|wifi|wlan)([^a-z]|$)/.test(name)) return 'logical';
    if (/sfp|qsfp|xfp|cfp|base-x|gbic|fiber|optical/.test(type) || /sfp|qsfp|xfp|cfp|gbic|fiber|optical/.test(name)) return 'fiber';
    return 'copper';
  }

  function _fiberGroup(iface) {
    const name = _lc(iface && (iface.name || iface.label));
    const type = _ifaceValue(iface && iface.type);
    return /qsfp|cfp/.test(type + ' ' + name) ? 2 : 1;
  }

  function _componentValue(value) {
    if (value && typeof value === 'object') {
      return _str(value.value !== undefined ? value.value : (value.name !== undefined ? value.name : (value.label !== undefined ? value.label : value.display)));
    }
    return _str(value);
  }

  function _componentDeviceId(component) {
    const reference = component && (component.device || component.device_id || component.deviceId);
    if (reference && typeof reference === 'object') return reference.id;
    return reference;
  }

  function _componentConnected(component) {
    if (!component || typeof component !== 'object') return false;
    if (component.mark_connected === true || component.markConnected === true) return true;
    if (component.cable || component.cable_id != null || component.cableId != null) return true;
    const endpoints = component.connected_endpoints || component.connectedEndpoints || component.connected_endpoint || component.connectedEndpoint;
    if (Array.isArray(endpoints) ? endpoints.length > 0 : !!endpoints) return true;
    return !!_componentPeer(component);
  }

  function _componentPeer(component) {
    if (!component || typeof component !== 'object') return null;
    for (const key of ['link_peer', 'cable_peer', 'connected_endpoint', 'connectedEndpoint', 'link_peers', 'cable_peers']) {
      const value = component[key];
      if (Array.isArray(value)) {
        const peer = value.find(Boolean);
        if (peer) return peer;
      } else if (value) {
        return value;
      }
    }
    return null;
  }

  function _mapComponentPeer(component) {
    const peer = _componentPeer(component);
    if (!peer) return null;
    if (typeof peer !== 'object') return { name: _str(peer) };
    const device = peer.device || peer.device_id || peer.deviceId || peer.parent_device || peer.parentDevice;
    const mapped = {};
    const name = _str(peer.name || peer.label || peer.display);
    const type = _componentValue(component.link_peer_type || component.cable_peer_type || component.connected_endpoint_type || component.connectedEndpointType);
    if (peer.id != null) mapped.id = peer.id;
    if (name) mapped.name = name;
    if (type) mapped.type = type;
    if (device && typeof device === 'object') {
      if (device.id != null) mapped.deviceId = device.id;
      const deviceName = _str(device.name || device.label || device.display);
      if (deviceName) mapped.deviceName = deviceName;
    } else if (device != null && _str(device)) {
      mapped.deviceId = device;
    }
    return Object.keys(mapped).length ? mapped : null;
  }

  function _mapPowerOutlet(outlet) {
    const mapped = {};
    if (outlet && outlet.id != null) mapped.id = outlet.id;
    const name = _str(outlet && outlet.name);
    const label = _str(outlet && outlet.label);
    const type = _componentValue(outlet && outlet.type);
    const status = _componentValue(outlet && outlet.status).toLowerCase();
    const feedLeg = _componentValue(outlet && (outlet.feed_leg || outlet.feedLeg));
    const powerPort = _componentValue(outlet && (outlet.power_port || outlet.powerPort));
    const description = _str(outlet && outlet.description);
    const connectedTo = _mapComponentPeer(outlet);
    if (name) mapped.name = name;
    if (label) mapped.label = label;
    if (type) mapped.type = type;
    if (status) mapped.rawStatus = status;
    if (_str(outlet && outlet.color)) mapped.color = _str(outlet.color);
    if (feedLeg) mapped.feedLeg = feedLeg;
    if (powerPort) mapped.powerPort = powerPort;
    if (description) mapped.description = description;
    if (connectedTo) mapped.connectedTo = connectedTo;
    if (outlet && typeof outlet.mark_connected === 'boolean') mapped.markConnected = outlet.mark_connected;
    if (_componentConnected(outlet)) mapped.connected = true;
    if (status || _componentConnected(outlet)) {
      mapped.status = _pduLayoutApi ? _pduLayoutApi.normalizePduOutletStatus(outlet) : status;
    }
    return mapped;
  }

  function _mapPowerPort(port) {
    const mapped = {};
    if (port && port.id != null) mapped.id = port.id;
    const name = _str(port && port.name);
    const label = _str(port && port.label);
    const type = _componentValue(port && port.type);
    const feedLeg = _componentValue(port && (port.feed_leg || port.feedLeg));
    const maximumDraw = port && (port.maximum_draw ?? port.maximumDraw);
    const allocatedDraw = port && (port.allocated_draw ?? port.allocatedDraw);
    if (name) mapped.name = name;
    if (label) mapped.label = label;
    if (type) mapped.type = type;
    if (feedLeg) mapped.feedLeg = feedLeg;
    if (Number.isFinite(+maximumDraw)) mapped.maximumDraw = +maximumDraw;
    if (Number.isFinite(+allocatedDraw)) mapped.allocatedDraw = +allocatedDraw;
    if (_componentConnected(port)) mapped.connected = true;
    return mapped;
  }

  function _ifaceSlotOrder(interfaces) {
    const list = Array.isArray(interfaces) ? interfaces.slice() : [];
    const rank = iface => {
      const kind = _ifaceKind(iface);
      if (kind === 'copper') return 0;
      if (kind === 'fiber') return _fiberGroup(iface);
      if (kind === 'mgmt') return 3;
      return 4;
    };
    return list.sort((a, b) => rank(a) - rank(b) || _natCmp(a && a.name, b && b.name));
  }

  function _sharedMediaSlots(template) {
    const frontPanel = template && template.frontPanel && typeof template.frontPanel === 'object'
      ? template.frontPanel : {};
    const raw = Array.isArray(frontPanel.sharedMediaSlots) ? frontPanel.sharedMediaSlots : [];
    const output = [];
    const seen = new Set();
    const add = (value, media) => {
      const slot = parseInt(value, 10);
      if (!Number.isFinite(slot) || slot < 1 || seen.has(slot)) return;
      seen.add(slot);
      output.push({ slot, media: Array.isArray(media) ? media.map(item => _lc(item)).filter(Boolean) : [] });
    };
    for (const item of raw) {
      if (Number.isFinite(+item)) {
        add(item, []);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const media = item.media || item.mediaOptions || item.options || [];
      if (Array.isArray(item.slots)) {
        for (const slot of item.slots) add(slot, media);
        continue;
      }
      const start = parseInt(item.start, 10);
      const count = Math.max(1, parseInt(item.count, 10) || 1);
      if (Number.isFinite(start)) {
        for (let offset = 0; offset < count; offset++) add(start + offset, media);
      }
    }
    return output.sort((a, b) => a.slot - b.slot);
  }

  function _sharedMediaSupports(entry, media) {
    if (!entry || !Array.isArray(entry.media) || !entry.media.length) return true;
    const values = entry.media.join(' ');
    if (media === 'copper') return /copper|rj45|base-t|ethernet|twisted/.test(values);
    if (media === 'fiber') return /fiber|optical|sfp|qsfp|xfp|cfp|base-x|gbic/.test(values);
    return false;
  }

  function _sharedMediaGroup(entry) {
    return entry && /qsfp|cfp/.test((entry.media || []).join(' ')) ? 2 : 1;
  }

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

  // Ordine di slot delle FRONT PORT di un patch panel: ordine naturale per nome
  // (così "1" < "2" < "10"). Ritorna l'array ordinato (input non mutato).
  function _frontPortOrder(frontPorts) {
    const list = Array.isArray(frontPorts) ? frontPorts.slice() : [];
    return list.sort((a, b) => _natCmp(a && a.name, b && b.name));
  }

  // ID dei rear port associati a un front port. Due schemi NetBox (drift di
  // versione — cfr rischio #1 del piano):
  //   • ≤4.5: `rear_port` singolo ({id} o id nudo) + `rear_port_position`.
  //   • 4.6+: `rear_ports: [{ rear_port:<id|{id}>, rear_port_position, position }]`
  //     (un front può mappare PIÙ rear = breakout/modulo). Ritorna tutti gli id.
  function _frontRearIds(fp) {
    const out = [];
    const push = v => { const id = (v && v.id != null) ? v.id : v; if (id != null) out.push(id); };
    if (fp && Array.isArray(fp.rear_ports)) { for (const r of fp.rear_ports) if (r) push(r.rear_port); }
    else if (fp && fp.rear_port != null) push(fp.rear_port);
    return out;
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
    'patch-panel': 'patchpanel', wallport: 'wallport', 'wall-port': 'wallport', 'wall-port-outlet': 'wallport',
    'console-server': 'consolesvr', pbx: 'pbx', nvr: 'nvr',
  };
  const _MANUAL_TYPES = new Set([
    'switch', 'router', 'firewall', 'server', 'hypervisor', 'nas', 'kvm', 'ups', 'pdu', 'ats',
    'patchpanel', 'ap', 'wallport', 'webcam', 'tv', 'iot', 'pc', 'mobile', 'voip', 'printer',
    'projector', 'doorctrl', 'consolesvr', 'pbx', 'nvr', 'wlanctrl', 'customfloor', 'customrack',
  ]);

  function _manualMapping(mapping, deviceId) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return {};
    const raw = mapping[String(deviceId)] || mapping['device:' + String(deviceId)];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    if (_MANUAL_TYPES.has(_lc(raw.type))) out.type = _lc(raw.type);
    if (raw.placement === 'floor' || raw.placement === 'rack') out.placement = raw.placement;
    return out;
  }

  function _interfacePortData(iface, kind, slotDefinition) {
    const port = {};
    if (_str(iface && iface.name)) port.ifName = _str(iface.name);
    const desc = _str(iface && iface.description) || _str(iface && iface.label);
    if (desc) port.desc = desc;
    if (_str(iface && iface.mac_address)) port.mac = _str(iface.mac_address).toUpperCase();
    const mode = iface && iface.mode && (iface.mode.value !== undefined ? iface.mode.value : iface.mode);
    if (mode === 'access' && iface.untagged_vlan && Number.isFinite(+iface.untagged_vlan.vid)) {
      port.vlanOvr = +iface.untagged_vlan.vid;
    } else if ((mode === 'tagged' || mode === 'tagged-all') && Array.isArray(iface.tagged_vlans)) {
      port.mode = 'trunk';
      port.trunkVlans = iface.tagged_vlans.map(vlan => +vlan.vid).filter(Number.isFinite);
    }
    if (iface && iface.lag && iface.lag.id != null) port.lagGroup = 'nb-lag-' + iface.lag.id;
    if (iface && iface.type && _ifaceValue(iface.type) === 'lag') port.lagGroup = 'nb-lag-' + iface.id;
    if (kind === 'mgmt') port.mgmt = true;
    if (kind === 'logical') port.logical = true;
    // NIENTE `physicalKind`: il tipo di media che il render usa davvero viaggia in
    // `mediaOptions` + `frontPanel.sharedMediaSlots` (sotto). Scriverlo anche qui
    // significava persistere per ogni porta un campo che non leggeva nessuno.
    if (iface && iface.enabled === false) port.status = 'inactive';
    else if (_componentConnected(iface)) port.status = 'active';
    if (slotDefinition) {
      port.sharedMedia = true;
      if (slotDefinition.media.length) port.mediaOptions = slotDefinition.media.slice();
    }
    return port;
  }

  function _effectivePortLayout(template, physicalInterfaces) {
    const source = template && typeof template === 'object' ? template : null;
    const base = source && source.frontPanel && typeof source.frontPanel === 'object'
      ? Object.assign({}, source.frontPanel) : {};
    const physical = Array.isArray(physicalInterfaces) ? physicalInterfaces : [];
    const copperCount = physical.filter(iface => _ifaceKind(iface) === 'copper').length;
    const fiberOneCount = physical.filter(iface => _ifaceKind(iface) === 'fiber' && _fiberGroup(iface) === 1).length;
    const fiberTwoCount = physical.filter(iface => _ifaceKind(iface) === 'fiber' && _fiberGroup(iface) === 2).length;
    const sourceCounts = source && source.counts && typeof source.counts === 'object' ? source.counts : {};
    const sharedMediaSlots = _sharedMediaSlots(source);
    const sharedFiberOneSlots = sharedMediaSlots.filter(item => _sharedMediaSupports(item, 'fiber') && _sharedMediaGroup(item) === 1);
    const sharedFiberTwoSlots = sharedMediaSlots.filter(item => _sharedMediaSupports(item, 'fiber') && _sharedMediaGroup(item) === 2);
    const declaredSfp = Number.isFinite(+base.sfpCount) ? +base.sfpCount : (+sourceCounts.sfp || 0);
    const declaredSfp2 = Number.isFinite(+base.sfp2Count) ? +base.sfp2Count : (+sourceCounts.qsfp || 0);
    const templateSfp = Math.max(0, declaredSfp - sharedFiberOneSlots.length);
    const templateSfp2 = Math.max(0, declaredSfp2 - sharedFiberTwoSlots.length);
    const templateMgmt = Number.isFinite(+base.mgmtCount) ? +base.mgmtCount : (+sourceCounts.mgmt || 0);
    const sfpCount = Math.min(48, Math.max(0, templateSfp, fiberOneCount - sharedFiberOneSlots.length));
    const sfp2Count = Math.min(48, Math.max(0, templateSfp2, fiberTwoCount - sharedFiberTwoSlots.length));
    const catalogPorts = source && Number.isFinite(+source.ports) ? +source.ports : 0;
    const highestSharedSlot = sharedMediaSlots.reduce((highest, item) => Math.max(highest, item.slot), 0);
    const dataPorts = Math.max(catalogPorts, copperCount + fiberOneCount + fiberTwoCount, highestSharedSlot);
    const layout = Object.assign({}, base);
    if (sfpCount + sfp2Count > 0) {
      layout.separateSfp = true;
      layout.sfpCount = sfpCount;
      if (sfp2Count > 0) layout.sfp2Count = sfp2Count;
      else delete layout.sfp2Count;
    } else if (sharedMediaSlots.length) {
      layout.separateSfp = false;
      layout.sfpCount = 0;
      delete layout.sfp2Count;
      delete layout.sfpStartNum;
      delete layout.sfp2StartNum;
    }
    if (sharedMediaSlots.length) layout.sharedMediaSlots = sharedMediaSlots;
    const actualMgmtCount = physical.filter(iface => _ifaceKind(iface) === 'mgmt').length;
    const mgmtCount = Math.min(4, Math.max(0, templateMgmt, actualMgmtCount));
    if (mgmtCount > 0) layout.mgmtCount = mgmtCount;
    const portRange = Array.from({ length: dataPorts }, (_, index) => index + 1);
    const standaloneFiberOneSlots = Array.from({ length: sfpCount }, (_, index) => dataPorts - sfpCount - sfp2Count + index + 1);
    const standaloneFiberTwoSlots = Array.from({ length: sfp2Count }, (_, index) => dataPorts - sfp2Count + index + 1);
    const standaloneFiberSlots = new Set(standaloneFiberOneSlots.concat(standaloneFiberTwoSlots));
    const sharedCopperSlots = new Set(sharedMediaSlots.filter(item => _sharedMediaSupports(item, 'copper')).map(item => item.slot));
    const copperSlots = portRange.filter(slot => !standaloneFiberSlots.has(slot) || sharedCopperSlots.has(slot));
    const fiberOneSlots = sharedFiberOneSlots.map(item => item.slot).concat(standaloneFiberOneSlots).sort((a, b) => a - b);
    const fiberTwoSlots = sharedFiberTwoSlots.map(item => item.slot).concat(standaloneFiberTwoSlots).sort((a, b) => a - b);
    return {
      dataPorts,
      sfpCount,
      sfp2Count,
      mgmtCount,
      copperStart: 1,
      sfpStart: dataPorts - sfpCount - sfp2Count + 1,
      sfp2Start: dataPorts - sfp2Count + 1,
      copperSlots,
      fiberOneSlots,
      fiberTwoSlots,
      sharedMediaSlots,
      layout,
      hasLayout: !!source || sfpCount > 0 || sfp2Count > 0 || mgmtCount > 0,
    };
  }

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

  function _catalogMatch(brand, model, catalogByKey, sourceSlug, manufacturerSlug, catalogIndexes, aliases) {
    if (catalogIndexes && _catalogApi) {
      return _catalogApi.resolveCatalogEntry({ brand, model, sourceSlug, manufacturerSlug }, catalogIndexes, aliases);
    }
    if (!catalogByKey) return { entry: null, strategy: 'unmatched', sourceSlug: sourceSlug || null };
    const key = (_lc(brand) + ' ' + _lc(model)).trim();
    const entry = catalogByKey[key] || null;
    return { entry, strategy: entry ? 'legacy-name' : 'unmatched', sourceSlug: entry && (entry.sourceSlug || entry.slug) || sourceSlug || null };
  }

  // Device-type NetBox → template del catalogo InfraNet (data/device-types.json).
  function _deviceTypeToCatalog(brand, model, catalogByKey, sourceSlug, manufacturerSlug, catalogIndexes, aliases) {
    return _catalogMatch(brand, model, catalogByKey, sourceSlug, manufacturerSlug, catalogIndexes, aliases).entry;
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

  // Faccia di montaggio del device nel rack: 'rear' se NetBox dice rear, altrimenti
  // 'front' (default, copre anche face assente/null). InfraNet non ha un fronte/retro
  // nativo (fronte e retro = due rack separati) → serve a spezzare un rack NetBox
  // bifacciale nei due rack InfraNet corrispondenti.
  function _faceOf(dev) {
    const f = dev && dev.face;
    const v = _lc(f && (f.value !== undefined ? f.value : f));
    return v === 'rear' ? 'rear' : 'front';
  }

  const _FLOOR_RACK_LAYOUT = Object.freeze({
    originX: 120,
    originY: 120,
    stepX: 220,
    stepY: 140,
    columns: 5,
  });

  function _autoPlaceRacks(racks, options) {
    const layout = Object.assign({}, _FLOOR_RACK_LAYOUT, options || {});
    const columns = Math.max(1, Math.floor(Number(layout.columns) || _FLOOR_RACK_LAYOUT.columns));
    const originX = Number.isFinite(Number(layout.originX)) ? Number(layout.originX) : _FLOOR_RACK_LAYOUT.originX;
    const originY = Number.isFinite(Number(layout.originY)) ? Number(layout.originY) : _FLOOR_RACK_LAYOUT.originY;
    const stepX = Number.isFinite(Number(layout.stepX)) ? Number(layout.stepX) : _FLOOR_RACK_LAYOUT.stepX;
    const stepY = Number.isFinite(Number(layout.stepY)) ? Number(layout.stepY) : _FLOOR_RACK_LAYOUT.stepY;
    const occupied = new Set();
    let cursor = 0;

    for (const rack of Array.isArray(racks) ? racks : []) {
      if (!rack || typeof rack !== 'object') continue;
      const existingX = Number(rack.x), existingY = Number(rack.y);
      if (Number.isFinite(existingX) && Number.isFinite(existingY)) {
        rack.x = existingX;
        rack.y = existingY;
        occupied.add(existingX + ',' + existingY);
        continue;
      }

      let x, y, key;
      do {
        const col = cursor % columns;
        const row = Math.floor(cursor / columns);
        x = originX + col * stepX;
        y = originY + row * stepY;
        key = x + ',' + y;
        cursor++;
      } while (occupied.has(key));
      rack.x = x;
      rack.y = y;
      occupied.add(key);
    }
    return racks;
  }

  // I device senza rack arrivano da NetBox senza coordinate grafiche. Un
  // import deve comunque essere immediatamente leggibile: assegniamo una
  // griglia deterministica separata dai rack, lasciando poi il drag dell'utente
  // come dato InfraNet. Non usiamo coordinate derivate dal modello hardware.
  function _autoPlaceFloorDevices(nodes, options) {
    const layout = Object.assign({ originX: 120, originY: 430, stepX: 190, stepY: 150, columns: 6 }, options || {});
    const columns = Math.max(1, Math.floor(Number(layout.columns) || 6));
    const floor = (Array.isArray(nodes) ? nodes : [])
      .filter(n => n && n.placement === 'floor')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    floor.forEach((node, index) => {
      if (!Number.isFinite(Number(node.x))) node.x = Number(layout.originX) + (index % columns) * Number(layout.stepX);
      if (!Number.isFinite(Number(node.y))) node.y = Number(layout.originY) + Math.floor(index / columns) * Number(layout.stepY);
      node.positionSource = node.positionSource || 'infranet-import-grid';
    });
  }

  /**
   * netboxToState(nb, opts) → { state, report }
   *  nb = { manufacturers, deviceTypes, deviceRoles, sites, racks, devices,
   *         interfaces, frontPorts, cables, vlans, prefixes, ipAddresses, truncated }
   *       (array già paginati; una categoria non richiesta può mancare = []).
   *  opts = { catalogByKey, catalogIndexes, catalogAliases, selection }
   *       selection.exclude = ["device:<id>", "rack:<id>", "cable:<id>", …]
   *       selection.mapping = { "<deviceId>": { type, placement } }
   */
  function netboxToState(nb, opts) {
    nb = nb || {};
    opts = opts || {};
    const catalogByKey = opts.catalogByKey || null;
    const catalogIndexes = opts.catalogIndexes || null;
    const catalogAliases = opts.catalogAliases || null;
    const sel = opts.selection || {};
    const excluded = new Set(Array.isArray(sel.exclude) ? sel.exclude : []);
    const isOut = (kind, id) => excluded.has(kind + ':' + id);

    const dtById = _indexById(nb.deviceTypes);
    const mfById = _indexById(nb.manufacturers);
    const roleById = _indexById(nb.deviceRoles);
    const vlanById = _indexById(nb.vlans);

    const state = { nodes: [], links: [], ports: {}, racks: [], ipam: { vlans: {}, prefixes: [], addresses: [] }, vlanNames: {}, vlanColors: {} };
    const report = {
      catalogVersion: opts.catalogVersion || null,
      counts: {
        devices: 0, devicesRack: 0, devicesFloor: 0, interfaces: 0, powerOutlets: 0, powerPorts: 0, consolePorts: 0, cables: 0,
        directLinks: 0, passThroughLinks: 0, unresolvedCables: 0,
        vlans: 0, vlanRecords: 0, prefixes: 0, ips: 0, racks: 0, stacks: 0,
        // Ciò che NON entra, contato a parte: un conteggio che vale zero perché
        // nessuno lo ha guardato è indistinguibile da uno che vale zero davvero.
        consolePortsSkipped: 0, powerPortsSkipped: 0,
      },
      unmappedRoles: [], unmatchedDeviceTypes: [],
      catalogMatches: { total: 0, matched: 0, unmatched: 0, templateTooSmall: 0, byStrategy: {}, details: [] },
      cables: { unresolved: [], outOfScope: [], loops: [] },
      excluded: { devices: [], racks: [], cables: [] },
      reviewRequired: [],
      manualMappings: { applied: [], invalid: [] },
      warnings: [], issues: [], truncated: !!nb.truncated,
    };
    if (Array.isArray(nb.warnings)) report.warnings.push(...nb.warnings);
    // ── Un evento, una sola emissione ────────────────────────────────────────
    // `issues` e' la forma STRUTTURATA (codice + dati) che l'interfaccia legge per
    // raggruppare, contare e tradurre; `warnings` resta la forma leggibile per log e
    // retrocompatibilita'. Passano dalla STESSA chiamata di proposito: quando il testo
    // e il suo consumatore vivono in due punti diversi divergono al primo ritocco —
    // e' successo davvero (il renderer ri-parsava la frase con una regex, una parola
    // aggiunta al messaggio ha spento il raggruppamento e ogni apparato e' diventato
    // una riga a se'). Chi legge `issues` non deve mai piu' interpretare prosa.
    const _issue = (code, data, text) => {
      report.issues.push(Object.assign({ code }, data || {}));
      if (text) report.warnings.push(text);
    };
    // Scelte di riconciliazione prese dall'utente nell'anteprima (lib/dcim-decisions.js
    // ne conosce il catalogo). Assenti = comportamento storico.
    const decisions = (sel.decisions && typeof sel.decisions === 'object') ? sel.decisions : {};
    const seenUnmappedRole = new Set(), seenUnmatchedDt = new Set();

    // ── Status NetBox: active / planned / staged / failed / inventory / offline /
    //    decommissioning ────────────────────────────────────────────────────────
    // Il comportamento storico importa TUTTO senza dire niente: un apparato in
    // dismissione entrava indistinguibile da uno in produzione. Ora l'anteprima lo
    // DICHIARA sempre, e la decisione «solo apparati in servizio» puo' tenerlo
    // fuori. ⚠️ Uno status ASSENTE (NetBox vecchio, o campo non serializzato) non
    // e' «non attivo»: ignoto non diventa un verdetto (paletto ②).
    const _nbStatus = (dev) => _lc(dev && dev.status && (dev.status.value != null ? dev.status.value : dev.status));
    const _notInService = (dev) => { const s = _nbStatus(dev); return !!s && s !== 'active'; };
    const skipNotActive = decisions['device.statusNotActive'] === 'skipNotActive';
    // Il set si calcola PRIMA del pre-scan delle facce rack: un device escluso non
    // deve far nascere il rack "· retro" con la sua faccia.
    const skippedByStatus = new Set();
    if (skipNotActive) {
      for (const dev of (Array.isArray(nb.devices) ? nb.devices : [])) {
        if (dev && dev.id != null && _notInService(dev)) skippedByStatus.add(dev.id);
      }
    }

    // ── Rack ──────────────────────────────────────────────────────────────
    // I nomi rack restano quelli di NetBox (unici dentro un sito). Modello:
    // "UN SITO = UN PROGETTO" → il nome del sito va nel NOME DEL PROGETTO
    // (_proposedName lato route), non spalmato sui rack. Importa un sito alla volta.
    //
    // Fronte/retro: NetBox = UN rack con `device.face` = front/rear; InfraNet non ha
    // il fronte/retro nativo → un rack NetBox con device su ENTRAMBE le facce diventa
    // DUE rack InfraNet (fronte = nome NetBox, retro = "nome · retro"), stessa U. Un
    // rack con device su una sola faccia resta UN rack (niente "· retro" spurio).
    // Pre-scan: quali facce sono usate in ogni rack (tra i device importati).
    const rackFaces = Object.create(null);   // nbRackId → { front:bool, rear:bool }
    for (const dev of (Array.isArray(nb.devices) ? nb.devices : [])) {
      if (!dev || dev.id == null) continue;
      if (isOut('device', dev.id)) { report.excluded.devices.push(dev.id); continue; }
      if (skippedByStatus.has(dev.id)) continue;
      const rid = dev.rack && dev.rack.id;
      if (rid == null) continue;
      (rackFaces[rid] || (rackFaces[rid] = { front: false, rear: false }))[_faceOf(dev)] = true;
    }

    const rackIdMap = Object.create(null);   // nbRackId → id fronte ; nbRackId+'|rear' → id retro
    for (const r of (Array.isArray(nb.racks) ? nb.racks : [])) {
      if (!r || r.id == null) continue;
      if (isOut('rack', r.id)) { report.excluded.racks.push(r.id); continue; }
      const faces = rackFaces[r.id] || { front: true, rear: false };   // rack senza device visti → fronte
      const split = faces.front && faces.rear;                          // bifacciale → due rack
      const name = _str(r.name) || ('nb-rack-' + r.id);
      const sizeU = (Number.isFinite(+r.u_height) && +r.u_height > 0) ? +r.u_height : null;   // no invenzione 42U
      const mk = (id, dispName) => {
        const rk = { id, name: dispName };
        if (sizeU != null) rk.sizeU = sizeU;
        state.racks.push(rk); report.counts.racks++;
        return id;
      };
      rackIdMap[r.id] = mk('nb-rack-' + r.id, name);                                        // fronte (o unico)
      if (split) rackIdMap[r.id + '|rear'] = mk('nb-rack-' + r.id + '-rear', name + ' · retro');
    }
    _autoPlaceRacks(state.racks);
    // Apri la vista Rack sul primo rack importato: senza `currentRack` il
    // rack-chassis resta vuoto finché non se ne seleziona uno a mano (il filtro di
    // rendering è n.rackId === currentRack). _migrateState fa lo stesso ripiego.
    if (state.racks.length) state.currentRack = state.racks[0].id;

    // ── Interfacce raggruppate per device ────────────────────────────────
    const ifByDevice = Object.create(null);
    for (const itf of (Array.isArray(nb.interfaces) ? nb.interfaces : [])) {
      const did = itf && itf.device && itf.device.id;
      if (did == null) continue;
      (ifByDevice[did] || (ifByDevice[did] = [])).push(itf);
    }
    const powerOutletsByDevice = Object.create(null);
    for (const outlet of (Array.isArray(nb.powerOutlets) ? nb.powerOutlets : [])) {
      const did = _componentDeviceId(outlet);
      if (did == null) continue;
      (powerOutletsByDevice[did] || (powerOutletsByDevice[did] = [])).push(outlet);
    }
    const powerPortsByDevice = Object.create(null);
    for (const powerPort of (Array.isArray(nb.powerPorts) ? nb.powerPorts : [])) {
      const did = _componentDeviceId(powerPort);
      if (did == null) continue;
      (powerPortsByDevice[did] || (powerPortsByDevice[did] = [])).push(powerPort);
    }
    const consolePortsByDevice = Object.create(null);
    for (const consolePort of (Array.isArray(nb.consolePorts) ? nb.consolePorts : [])) {
      const did = _componentDeviceId(consolePort);
      if (did == null) continue;
      (consolePortsByDevice[did] || (consolePortsByDevice[did] = [])).push(consolePort);
    }
    const ifSlot = Object.create(null);   // nbInterfaceId → { nodeId, slot }
    const stackIdByName = Object.create(null);   // nome stack → nbVirtualChassisId (guardia omonimia)

    // ── Front port (patch panel) raggruppate per device ──────────────────
    // In NetBox un patch panel ha front port + rear port; la corrispondenza
    // interna fronte↔retro è il FK `rear_port` sul front (non un cavo). In
    // InfraNet una porta patch-panel è PASSANTE (fronte+retro = UNA sola porta
    // con max 2 connessioni): quindi ogni front port = uno slot, e il rear port
    // corrispondente mappa allo STESSO slot. I rear port non hanno slot propri.
    const fpByDevice = Object.create(null);
    for (const fp of (Array.isArray(nb.frontPorts) ? nb.frontPorts : [])) {
      const did = fp && fp.device && fp.device.id;
      if (did == null) continue;
      (fpByDevice[did] || (fpByDevice[did] = [])).push(fp);
    }
    const frontSlot = Object.create(null);   // nbFrontPortId → { nodeId, slot }
    const rearSlot = Object.create(null);    // nbRearPortId  → { nodeId, slot } (via FK del front)

    // ── Device → nodi + porte ────────────────────────────────────────────
    for (const dev of (Array.isArray(nb.devices) ? nb.devices : [])) {
      if (!dev || dev.id == null) continue;
      if (isOut('device', dev.id)) { if (!report.excluded.devices.includes(dev.id)) report.excluded.devices.push(dev.id); continue; }
      const nodeId = 'nb-dev-' + dev.id;

      const dt = (dev.device_type && dtById[dev.device_type.id]) || dev.device_type || null;
      const mf = dt && dt.manufacturer ? (mfById[dt.manufacturer.id] || dt.manufacturer) : null;
      const brand = _str(mf && mf.name);
      const model = _str(dt && dt.model);
      // NetBox recente: dev.role ; versioni vecchie: dev.device_role.
      const roleRef = dev.role || dev.device_role || null;
      const role = roleRef ? (roleById[roleRef.id] || roleRef) : null;
      const rt = _roleToInfranetType(role && role.slug, role && role.name, model);
      const manualMapping = _manualMapping(sel.mapping, dev.id);
      const unmappedRoleName = rt.mapped ? '' : _str((role && (role.name || role.slug)) || '(nessun ruolo)');

      // Nome: quello dichiarato; se assente, il `display` di NetBox (se non è solo
      // l'id tipo "{123}"), poi "Modello #id", infine l'id interno come ultima spiaggia.
      let name = _str(dev.name);
      if (!name) {
        const disp = _str(dev.display);
        const dispOk = disp && !/^\{?\d+\}?$/.test(disp);
        name = dispOk ? disp : (model ? model + ' #' + dev.id : nodeId);
      }

      // Status: si dichiara SEMPRE (anche quando l'apparato entra lo stesso), perche'
      // «entra» e «e' in servizio» sono due cose diverse e solo NetBox sa la seconda.
      // La riga sta prima di tutto il resto: se la decisione lo esclude, gli avvisi
      // sugli altri fronti (ruolo, catalogo, porte) parlerebbero di un apparato che
      // non c'e'.
      const nbStatus = _nbStatus(dev);
      if (_notInService(dev)) {
        _issue('device.statusNotActive', { deviceId: dev.id, deviceName: name, kind: nbStatus },
          'device ' + dev.id + ' ha status NetBox "' + nbStatus + '": non e\' in servizio');
        if (skipNotActive) {
          if (!report.excluded.devices.includes(dev.id)) report.excluded.devices.push(dev.id);
          continue;
        }
      }

      if (unmappedRoleName && !seenUnmappedRole.has(unmappedRoleName)) {
        seenUnmappedRole.add(unmappedRoleName); report.unmappedRoles.push(unmappedRoleName);
      }
      // Emesso QUI e non alla riga del controllo: il nome del device si conosce solo
      // adesso, e un avviso che parla per id NetBox e' illeggibile per chi decide.
      if (unmappedRoleName) _issue('role.unmapped', { deviceId: dev.id, deviceName: name, role: unmappedRoleName });
      const node = { id: nodeId, name, type: rt.type };
      if (brand) node.brand = brand;
      if (model) node.model = model;
      const sourceDeviceTypeSlug = _str(dt && dt.slug);
      const sourceManufacturerSlug = _str(mf && mf.slug);
      const sourceRoleSlug = _str(role && role.slug);
      node.source = {
        system: 'netbox',
        deviceId: dev.id,
      };
      if (sourceDeviceTypeSlug) node.source.deviceTypeSlug = sourceDeviceTypeSlug;
      if (sourceManufacturerSlug) node.source.manufacturerSlug = sourceManufacturerSlug;
      if (sourceRoleSlug) node.source.roleSlug = sourceRoleSlug;
      const serial = _str(dev.serial);
      if (serial) node.serialNumber = serial;

      // ── Provenienza: ciò che il DCIM dichiara dell'apparato ──────────────────
      // Tenant, stato, ruolo e platform entrano come METADATO DI PROVENIENZA e si
      // vedono nel pannello Proprietà, riquadro «Dichiarato dal DCIM», in sola
      // lettura (lib/dcim-source-view.js). ⚠️ Il tenant NON produce piu' una riga
      // nell'anteprima: fino alla 2.8.0 nessuna schermata lo leggeva e andava
      // dichiarato come limite, ma ora ha una casa come gli altri tre — lasciare
      // quella riga voleva dire stampare un limite che non esiste piu'.
      const tenantName = _str(dev.tenant && (dev.tenant.name || dev.tenant.display));
      if (tenantName) node.source.tenant = tenantName;
      if (nbStatus) node.source.status = nbStatus;
      // ⚠️ La platform NON va in `firmwareVer`: quel campo e' il firmware DICHIARATO,
      // che il Drift confronta con quello MISURATO via ENTITY-MIB per dedurre
      // «apparato sostituito» (lib/drift-report.js). Scriverci "Cisco IOS" farebbe
      // scattare un identity-drift falso su ogni apparato importato. Qui serve a
      // un'altra cosa: e' un NOS dichiarato, e batte quello indovinato dal brand
      // nell'inventory Ansible (lib/ansible-netos.js).
      const platformSlug = _str(dev.platform && dev.platform.slug);
      const platformName = _str(dev.platform && (dev.platform.name || dev.platform.display));
      if (platformSlug) node.source.platformSlug = platformSlug;
      if (platformName) node.source.platformName = platformName;

      // Ubicazione (Location NetBox = piano/stanza): InfraNet non ha un campo dedicato
      // né un multipiano nativo, e i rack non hanno una nota → il piano si preserva
      // nelle NOTE del device (mostrate in Proprietà). Modello IBRIDO: un progetto per
      // sito, il piano resta come metadato leggibile, senza fingere una gerarchia.
      // La `description` NetBox e' prosa scritta a mano su quell'apparato: stessa
      // natura delle note InfraNet, quindi ci va accanto (separatore ' — ', non un
      // a-capo: la nota viene ristampata a larghezza piena nel Registro asset del
      // PDF, dove il ritorno a capo non e' un separatore ma un buco).
      const locName = _str(dev.location && dev.location.name);
      const noteParts = [];
      if (locName) {
        const siteName = _str(dev.site && dev.site.name);
        noteParts.push(siteName ? siteName + ' · ' + locName : locName);
      }
      const nbDescription = _str(dev.description);
      if (nbDescription) noteParts.push(nbDescription);
      if (noteParts.length) node.notes = noteParts.join(' — ');

      // Collocazione rack: se il rack è stato spezzato fronte/retro, il device
      // rear-mounted va nel rack "· retro", gli altri nel rack fronte/unico.
      if (dev.rack && rackIdMap[dev.rack.id]) {
        const rearId = rackIdMap[dev.rack.id + '|rear'];
        node.rackId = (rearId && _faceOf(dev) === 'rear') ? rearId : rackIdMap[dev.rack.id];
        if (Number.isFinite(+dev.position) && +dev.position > 0) node.rackU = +dev.position;
      }
      if (dt && Number.isFinite(+dt.u_height) && +dt.u_height > 0) node.sizeU = +dt.u_height;

      if (manualMapping.type) {
        node.type = manualMapping.type;
        node.source.manualMapping = Object.assign({}, node.source.manualMapping || {}, { type: manualMapping.type });
        report.manualMappings.applied.push({ deviceId: dev.id, field: 'type', value: manualMapping.type });
      }
      if (manualMapping.placement === 'floor') {
        delete node.rackId;
        delete node.rackU;
        node.source.manualMapping = Object.assign({}, node.source.manualMapping || {}, { placement: 'floor' });
        report.manualMappings.applied.push({ deviceId: dev.id, field: 'placement', value: 'floor' });
      } else if (manualMapping.placement === 'rack' && !node.rackId) {
        report.manualMappings.invalid.push({ deviceId: dev.id, field: 'placement', value: 'rack', reason: 'rack-not-available' });
        _issue('rack.missing', { deviceId: dev.id, deviceName: name },
          'device ' + dev.id + ' non puo\' essere spostato nel rack: rack NetBox assente');
      } else if (manualMapping.placement === 'rack') {
        node.source.manualMapping = Object.assign({}, node.source.manualMapping || {}, { placement: 'rack' });
        report.manualMappings.applied.push({ deviceId: dev.id, field: 'placement', value: 'rack' });
      }

      // IP primari (dal device serialization di NetBox).
      const ip4 = dev.primary_ip4 && _stripPrefix(dev.primary_ip4.address);
      const ip6 = dev.primary_ip6 && _stripPrefix(dev.primary_ip6.address);
      if (ip4) node.ip = ip4;
      if (ip6) node.ip6 = ip6;

      // ── Virtual chassis NetBox → stack InfraNet ──────────────────────────────
      // Non e' un modello da inventare: InfraNet lo ha gia' (lib/stack.js), tag-based
      // su `spec.stackId` + `spec.stackMemberId`, con master = ruolo esplicito o
      // memberId piu' basso. NetBox descrive la stessa cosa con virtual_chassis +
      // vc_position + il puntatore al master: la corrispondenza e' 1:1, mancava solo
      // il filo. Senza, uno stack di due switch entrava come due apparati che non si
      // sanno parenti — e la porta Gi2/0/24 sembrava di un altro apparato.
      // I membri restano DUE nodi: sono due scatole fisiche, in due U del rack.
      const vc = dev.virtual_chassis || dev.virtualChassis || null;
      if (vc && vc.id != null) {
        const vcName = _str(vc.name) || _str(vc.display) || ('nb-vc-' + vc.id);
        const prev = stackIdByName[vcName];
        if (prev != null && String(prev) !== String(vc.id)) {
          // Due virtual chassis diversi con lo stesso nome collasserebbero in un solo
          // stack: e' lo stesso difetto delle VLAN per sito, e va detto, non subito.
          _issue('stack.nameConflict', { deviceId: dev.id, deviceName: name, kind: vcName },
            'device ' + dev.id + ': nome stack "' + vcName + '" gia\' usato da un altro virtual chassis NetBox');
        } else if (prev == null) {
          stackIdByName[vcName] = vc.id;
          report.counts.stacks++;
        }
        node.spec = node.spec || {};
        node.spec.stackId = vcName;
        if (Number.isFinite(+dev.vc_position) && +dev.vc_position > 0) node.spec.stackMemberId = +dev.vc_position;
        const masterId = vc.master && (typeof vc.master === 'object' ? vc.master.id : vc.master);
        // Ruolo esplicito SOLO quando NetBox dichiara chi e' il master: senza quel
        // dato, `getStackMaster` ripiega sul memberId piu' basso — meglio il suo
        // ripiego dichiarato che un "member" scritto da noi su tutti.
        if (masterId != null) node.spec.stackRole = String(masterId) === String(dev.id) ? 'master' : 'member';
      }

      node.placement = node.rackId ? 'rack' : 'floor';

      const catalogMatch = _catalogMatch(brand, model, catalogByKey, sourceDeviceTypeSlug, sourceManufacturerSlug, catalogIndexes, catalogAliases);

      // Porte dalle interfacce: le porte fisiche occupano gli slot del frontale,
      // MGMT e interfacce logiche hanno identificativi separati.
      const ordered = _ifaceSlotOrder(ifByDevice[dev.id]);
      const physical = ordered.filter(iface => {
        const kind = _ifaceKind(iface);
        return node.type !== 'pdu' && (kind === 'copper' || kind === 'fiber');
      });
      const layout = _effectivePortLayout(catalogMatch.entry, ordered);
      const slotByInterface = new Map();
      let mgmtIndex = 0;
      const copperSlots = layout.copperSlots.slice();
      const fiberOneSlots = layout.fiberOneSlots.slice();
      const fiberTwoSlots = layout.fiberTwoSlots.slice();
      const sharedMediaBySlot = new Map(layout.sharedMediaSlots.map(item => [item.slot, item]));
      const fiberTwoInterfaces = physical.filter(iface => _ifaceKind(iface) === 'fiber' && _fiberGroup(iface) === 2);
      const fiberOneInterfaces = physical.filter(iface => _ifaceKind(iface) === 'fiber' && _fiberGroup(iface) === 1);
      const copperInterfaces = physical.filter(iface => _ifaceKind(iface) === 'copper');
      let overflowIndex = 0;

      const assignPhysicalInterface = (itf, slots) => {
        const kind = _ifaceKind(itf);
        const slot = slots.length ? slots.shift() : layout.dataPorts + 1 + overflowIndex++;
        const sharedMedia = sharedMediaBySlot.get(slot);
        const pid = nodeId + '-' + slot;
        slotByInterface.set(itf, { nodeId, slot, portId: pid, kind, shared: !!sharedMedia, overflow: slot > layout.dataPorts });
        if (itf && itf.id != null) ifSlot[itf.id] = slotByInterface.get(itf);
        const port = _interfacePortData(itf, kind, sharedMedia);
        if (slot > layout.dataPorts) port.overflow = true;
        state.ports[pid] = port;
        report.counts.interfaces++;
      };

      for (const itf of fiberTwoInterfaces) assignPhysicalInterface(itf, fiberTwoSlots);
      for (const itf of fiberOneInterfaces) assignPhysicalInterface(itf, fiberOneSlots);
      for (const itf of copperInterfaces) assignPhysicalInterface(itf, copperSlots);

      for (const itf of ordered) {
        const detectedKind = _ifaceKind(itf);
        // Un PDU non ha porte Ethernet "utente": ogni interfaccia non logica
        // rappresenta la gestione IP, anche se NetBox la chiama eth0/lan1 e
        // non ha impostato `mgmt_only`.
        const kind = node.type === 'pdu' && detectedKind !== 'logical' ? 'mgmt' : detectedKind;
        if (kind !== 'mgmt' && kind !== 'logical') continue;
        if (kind === 'mgmt') {
          mgmtIndex++;
          const portId = node.type === 'pdu' ? nodeId + '-' + mgmtIndex : nodeId + '-mgmt' + mgmtIndex;
          if (itf && itf.id != null) ifSlot[itf.id] = { nodeId, portId, kind, slot: null };
          state.ports[portId] = _interfacePortData(itf, kind);
        } else if (itf && itf.id != null) {
          const portId = nodeId + '-logical-' + itf.id;
          ifSlot[itf.id] = { nodeId, portId, kind, slot: null, logical: true };
          state.ports[portId] = _interfacePortData(itf, kind);
        }
        report.counts.interfaces++;
      }

      if (node.type === 'pdu') {
        const consolePorts = consolePortsByDevice[dev.id] || [];
        if (mgmtIndex || consolePorts.length) {
          node.pduMgmtMode = mgmtIndex && consolePorts.length ? 'ethernet-serial'
            : mgmtIndex ? 'ethernet' : 'serial';
          if (mgmtIndex) node.pduEthernetPorts = Math.min(2, mgmtIndex);
          if (consolePorts.length) node.pduSerialPorts = Math.min(2, consolePorts.length);
        }
        if (mgmtIndex > 2) _issue('pdu.mgmtCapped', { deviceId: dev.id, deviceName: name, found: mgmtIndex, max: 2 },
          'device ' + dev.id + ' ha ' + mgmtIndex + ' interfacce Ethernet PDU; InfraNet ne visualizza al massimo 2');
        report.counts.consolePorts += consolePorts.length;
      } else {
        // Fuori dai PDU, InfraNet non ha una porta console: il frontale modella porte
        // dati, SFP e gestione IP. Inventarne una per far entrare il dato NetBox
        // significherebbe disegnare un connettore che nessuno ha misurato (paletto ②).
        // Quindi non entra — e proprio per questo va detto: su un NetBox vero erano
        // 41 porte, sparite senza una riga.
        const consolePorts = consolePortsByDevice[dev.id] || [];
        if (consolePorts.length) {
          report.counts.consolePortsSkipped += consolePorts.length;
          _issue('ports.consoleSkipped', { deviceId: dev.id, deviceName: name, found: consolePorts.length },
            'device ' + dev.id + ' ha ' + consolePorts.length + ' porte console: InfraNet le modella solo sui PDU');
        }
      }

      // Front port (patch panel) → slot passanti, dopo le eventuali interfacce.
      // Ogni front port è uno slot; il suo rear port (FK) punta allo stesso slot.
      let slot = layout.dataPorts;
      for (const fp of _frontPortOrder(fpByDevice[dev.id])) {
        slot++;
        const pid = nodeId + '-' + slot;
        const ref = { nodeId, slot, portId: pid, kind: 'frontport' };
        if (fp && fp.id != null) frontSlot[fp.id] = ref;
        for (const rid of _frontRearIds(fp)) if (rearSlot[rid] === undefined) rearSlot[rid] = ref;
        const port = {};
        const nm = _str(fp.name);
        if (nm && nm !== String(slot)) port.ifName = nm;   // preserva etichette non banali (es. "A1")
        const desc = _str(fp.description) || _str(fp.label);
        if (desc) port.desc = desc;
        if (Object.keys(port).length) state.ports[pid] = port;
        report.counts.interfaces++;
      }

      // Conteggio porte del nodo: il layout del catalogo resta applicato anche
      // quando NetBox contiene meno o più interfacce fisiche.
      report.catalogMatches.total++;
      report.catalogMatches.byStrategy[catalogMatch.strategy] = (report.catalogMatches.byStrategy[catalogMatch.strategy] || 0) + 1;
      const matchDetail = {
        deviceId: dev.id,
        name,
        brand: brand || null,
        model: model || null,
        roleSlug: sourceRoleSlug || null,
        roleName: _str(role && role.name) || null,
        type: node.type,
        placement: node.placement,
        status: catalogMatch.entry ? 'matched' : catalogMatch.strategy === 'ambiguous' ? 'ambiguous' : 'unmatched',
        strategy: catalogMatch.strategy,
        sourceSlug: catalogMatch.sourceSlug || null,
        catalogVersion: opts.catalogVersion || null,
      };
      const reviewNeeded = (!catalogMatch.entry || !rt.mapped) && !manualMapping.type;
      matchDetail.reviewRequired = reviewNeeded;
      matchDetail.resolvedBy = manualMapping.type ? 'manual' : null;
      if (catalogMatch.reason) matchDetail.reason = catalogMatch.reason;
      if (catalogMatch.alias) matchDetail.alias = catalogMatch.alias;
      report.catalogMatches.details.push(matchDetail);
      if (reviewNeeded) report.reviewRequired.push(dev.id);
      if (catalogMatch.entry) {
        report.catalogMatches.matched++;
        node.catalogMatch = { strategy: catalogMatch.strategy, sourceSlug: catalogMatch.sourceSlug, catalogVersion: opts.catalogVersion || null };
        node.source.catalogMatch = catalogMatch.strategy;
        if (opts.catalogVersion) node.source.catalogVersion = opts.catalogVersion;
        if (catalogMatch.alias) node.catalogMatch.alias = catalogMatch.alias;
      } else {
        report.catalogMatches.unmatched++;
      }
      const tmpl = catalogMatch.entry;
      if (node.type === 'pdu') {
        const importedOutlets = powerOutletsByDevice[dev.id] || [];
        const templateOutlets = tmpl && Array.isArray(tmpl.powerOutlets) ? tmpl.powerOutlets : [];
        const sourceOutlets = importedOutlets.length ? importedOutlets : templateOutlets;
        if (sourceOutlets.length > 48) _issue('pdu.outletsCapped', { deviceId: dev.id, deviceName: name, found: sourceOutlets.length, max: 48 },
          'device ' + dev.id + ' ha ' + sourceOutlets.length + ' prese power; InfraNet ne importa al massimo 48');
        const mappedOutlets = sourceOutlets.slice(0, 48).map(_mapPowerOutlet);
        if (mappedOutlets.length) {
          node.powerOutlets = mappedOutlets;
          node.pduOutletCount = mappedOutlets.length;
          report.counts.powerOutlets += mappedOutlets.length;
        }
        const importedPowerPorts = powerPortsByDevice[dev.id] || [];
        if (importedPowerPorts.length) {
          node.pduPowerPorts = importedPowerPorts.map(_mapPowerPort);
          report.counts.powerPorts += importedPowerPorts.length;
        }
      } else {
        // L'alimentazione di un apparato NON-PDU (il suo ingresso, e le eventuali
        // prese se e' un UPS classificato altrimenti) non ha un posto nel modello:
        // InfraNet documenta le prese SUL PDU, e da li' punta all'apparato alimentato.
        // La catena feedA/feedB per-apparato e' una feature a se', non un ripiego da
        // improvvisare qui. Su un NetBox vero erano 62 power port su 75, mute.
        const skippedPower = (powerPortsByDevice[dev.id] || []).length + (powerOutletsByDevice[dev.id] || []).length;
        if (skippedPower) {
          report.counts.powerPortsSkipped += skippedPower;
          _issue('ports.powerSkipped', { deviceId: dev.id, deviceName: name, found: skippedPower },
            'device ' + dev.id + ' ha ' + skippedPower + ' connessioni di alimentazione: InfraNet le modella solo sui PDU');
        }
      }
      node.ports = slot;
      if (layout.hasLayout) node.frontPanel = Object.assign({}, layout.layout);
      if (tmpl && Number.isFinite(+tmpl.ports) && physical.length > +tmpl.ports) {
        report.catalogMatches.templateTooSmall++;
        // DECISIONE «ports.overTemplate». Il CONTEGGIO non e' in discussione: quando
        // NetBox porta piu' interfacce del modello, `_effectivePortLayout` allarga gia'
        // `dataPorts` fino a coprirle tutte — nessuna porta viene persa, in nessuno dei
        // due rami. In discussione c'e' la DISPOSIZIONE: il frontale del catalogo
        // (posizioni SFP, porte di gestione, layout base) descrive un apparato con meno
        // porte di quello vero, e viene disegnato allargato.
        //  · keepCatalog (default, comportamento storico) = tiene quella disposizione:
        //    su una variante della stessa famiglia e' quasi sempre giusta;
        //  · genericPanel = pannello neutro, porte in fila senza posizioni dichiarate.
        //    Non sapere dov'e' una SFP e' meglio che indicarne una sbagliata.
        const genericPanel = decisions['ports.overTemplate'] === 'genericPanel';
        if (genericPanel) delete node.frontPanel;
        _issue('ports.overTemplate', {
          deviceId: dev.id, deviceName: name, model: model || null,
          netbox: physical.length, template: +tmpl.ports, applied: genericPanel ? 'genericPanel' : 'keepCatalog',
        }, 'device ' + dev.id + ' ha più interfacce fisiche NetBox (' + physical.length + ') del template catalogo (' + tmpl.ports + ')');
      } else if (!catalogMatch.entry && brand && model) {
        const dk = brand + ' ' + model;
        if (!seenUnmatchedDt.has(dk)) { seenUnmatchedDt.add(dk); report.unmatchedDeviceTypes.push(dk); }
        if (catalogMatch.strategy === 'ambiguous') {
          _issue('catalog.ambiguous', { deviceId: dev.id, deviceName: name, model: dk },
            'device ' + dev.id + ' ha un modello catalogo ambiguo (' + dk + ')');
        } else {
          // Nessun testo: non e' un guaio da segnalare a parole, e' una classe di
          // decisione («questi modelli non li conosco») che il pannello raggruppa.
          _issue('catalog.unmatched', { deviceId: dev.id, deviceName: name, model: dk });
        }
      }

      state.nodes.push(node);
      report.counts.devices++;
      if (node.rackId) report.counts.devicesRack++;
      else report.counts.devicesFloor++;
    }

    _autoPlaceFloorDevices(state.nodes);

    // ── Cavi → link (dopo che tutte le porte esistono) ───────────────────
    const _terms = (cable, side) => {
      // NetBox 3.3+: a_terminations/b_terminations[]; versioni vecchie: termination_a_id.
      const arr = cable[side + '_terminations'];
      if (Array.isArray(arr)) return arr.map(t => ({ type: t.object_type, id: t.object_id }));
      const legacyId = cable['termination_' + side + '_id'];
      if (legacyId != null) return [{ type: cable['termination_' + side + '_type'], id: legacyId }];
      return [];
    };
    // Risolve una terminazione (type + id) → { nodeId, slot }. TYPE-AWARE: ogni
    // object_type consulta SOLO la sua mappa, così gli spazi id separati di NetBox
    // (interface #5 ≠ front-port #5 ≠ rear-port #5) non collidono. Le power/console
    // port non sono importate → restano irrisolte e il cavo viene saltato.
    const _resolveTerm = (t) => {
      if (!t) return undefined;
      const ot = _lc(t.type);
      if (/interface$/.test(ot)) {
        const ref = ifSlot[t.id];
        return ref && !ref.logical ? ref : undefined;
      }
      if (/frontport$/.test(ot)) return frontSlot[t.id];
      if (/rearport$/.test(ot)) return rearSlot[t.id];
      // type assente (NetBox molto vecchi): prova interfaccia, poi patch panel.
      if (!ot) {
        const ref = ifSlot[t.id];
        return (ref && !ref.logical) ? ref : (frontSlot[t.id] || rearSlot[t.id]);
      }
      return undefined;
    };
    // Terminazione "di rete" (interfaccia/front/rear): distingue un miss VERO da
    // un cavo fuori scope per scelta (alimentazione power-port/outlet, console,
    // circuito WAN) — quest'ultimo si salta senza avviso.
    const _termIsNet = (t) => !!t && /(?:interface|frontport|rearport)$/.test(_lc(t.type));
    for (const c of (Array.isArray(nb.cables) ? nb.cables : [])) {
      if (!c || c.id == null) continue;
      if (isOut('cable', c.id)) { report.excluded.cables.push(c.id); continue; }
      const a = _terms(c, 'a'), b = _terms(c, 'b');
      // Una terminazione risolvibile per lato (MVP: cavo semplice, non split).
      // Ammesse interfaccia / front-port / rear-port: il percorso strutturato
      // (switch → pp → pp → server) diventa una CATENA nativa di link che
      // condividono lo stesso slot passante del pannello — nessun `segments[]`.
      const A = a.map(_resolveTerm).find(Boolean);
      const B = b.map(_resolveTerm).find(Boolean);
      if (!A || !B) {
        // Avvisa SOLO se entrambi i lati sono porte di rete (interfaccia/front/
        // rear) ma non risolte = miss vero (es. capo su device fuori scope). Se
        // un lato è alimentazione/console/circuito, è fuori scope per scelta →
        // salto silenzioso (niente rumore nell'anteprima).
        const netA = a.some(_termIsNet), netB = b.some(_termIsNet);
        const reason = netA && netB ? 'network-termination-not-imported' : 'out-of-scope-termination';
        (netA && netB ? report.cables.unresolved : report.cables.outOfScope).push({ id: c.id, reason });
        if (netA && netB) {
          report.counts.unresolvedCables++;
          _issue('cable.skipped', { cableId: c.id, reason: 'port-not-imported' },
            'cavo ' + c.id + ' saltato (porta di rete non importata)');
        } else {
          // Fuori perimetro PER SCELTA (alimentazione, console, circuiti WAN): non è
          // un guasto e non va gridato, ma nemmeno taciuto. Misurato su NetBox vero:
          // 58 cavi su 108 finivano qui e l'anteprima diceva «0 non risolti» — chi
          // legge concludeva che il cablaggio fosse importato per intero.
          const kinds = a.concat(b).map(t => String((t && t.type) || '').replace(/^dcim\./, ''));
          _issue('cable.outOfScope', {
            cableId: c.id,
            kind: kinds.some(k => /circuit/i.test(k)) ? 'circuit'
              : kinds.some(k => /power/i.test(k)) ? 'power'
                : kinds.some(k => /console/i.test(k)) ? 'console' : 'other',
          });
        }
        continue;
      }
      const src = A.portId || (A.nodeId + '-' + A.slot), dst = B.portId || (B.nodeId + '-' + B.slot);
      if (src === dst) {
        report.cables.loops.push({ id: c.id, reason: 'same-termination' });
        _issue('cable.skipped', { cableId: c.id, reason: 'loop' },
          'cavo ' + c.id + ' saltato (anello sulla stessa porta)');
        continue;
      }
      // `sourceCableId` e' la CHIAVE ESTERNA del cavo in NetBox (come source.deviceId
      // per l'apparato): oggi non la legge nessuno perche' il ri-allineamento verso
      // il DCIM non e' ancora scritto, ma senza di lei un secondo import non sa piu'
      // quale cavo sta riguardando. Non e' peso morto: si tiene.
      const link = { id: 'nb-cbl-' + c.id, src, dst, source: 'netbox', sourceCableId: c.id, resolution: 'direct', confidence: 'authoritative' };
      if (a.some(t => /rearport$/.test(_lc(t.type))) || b.some(t => /rearport$/.test(_lc(t.type))) ||
          a.some(t => /frontport$/.test(_lc(t.type))) || b.some(t => /frontport$/.test(_lc(t.type)))) {
        link.resolution = 'pass-through';
      }
      const cat = _cableCategory(c.type);
      if (cat) link.cableCategory = cat;
      if (Number.isFinite(+c.length) && +c.length > 0) {
        const unit = _lc(c.length_unit && (c.length_unit.value !== undefined ? c.length_unit.value : c.length_unit));
        link.lengthM = unit === 'ft' ? Math.round(+c.length * 0.3048 * 100) / 100 : +c.length;
      }
      if (_str(c.color)) link.color = '#' + _str(c.color).replace(/^#/, '');
      state.links.push(link);
      report.counts.cables++;
      if (link.resolution === 'pass-through') report.counts.passThroughLinks++;
      else report.counts.directLinks++;
    }

    // ── VLAN + prefissi → IPAM ──────────────────────────────────────────
    // NetBox modella le VLAN per GRUPPO/SITO: lo stesso vid può essere dichiarato
    // decine di volte. InfraNet ha uno spazio vid PIATTO → le dichiarazioni
    // collassano. Misurato su NetBox vero: 63 dichiarazioni → 7 VLAN. Contarne 63
    // nell'anteprima prometteva nove volte quello che si ottiene; il conteggio
    // adesso è quello che ATTERRA, e le dichiarazioni lette restano a parte.
    let vlanConflicts = 0;
    for (const v of (Array.isArray(nb.vlans) ? nb.vlans : [])) {
      if (!v || !Number.isFinite(+v.vid)) continue;
      report.counts.vlanRecords++;
      const name = _str(v.name);
      // Due VLAN NetBox con lo stesso vid e nomi diversi: il secondo nome vince in
      // silenzio. Non si può fare di meglio senza inventare uno spazio vid per sito,
      // ma si può DIRLO invece di lasciarlo scoprire a chi legge il documento.
      if (name && state.vlanNames[v.vid] && state.vlanNames[v.vid] !== name) vlanConflicts++;
      if (name) state.vlanNames[v.vid] = name;
      const record = state.ipam.vlans[v.vid] || (state.ipam.vlans[v.vid] = {});
      if (name) record.name = name;
      if (_str(v.description)) record.description = _str(v.description);
      if (v.status && v.status.value != null) record.status = _str(v.status.value);
      if (v.site && v.site.id != null) record.siteId = v.site.id;
      if (v.tenant && v.tenant.id != null) record.tenantId = v.tenant.id;
    }
    // Il contatore = VLAN che finiscono nel documento, non righe lette da NetBox.
    report.counts.vlans = Object.keys(state.ipam.vlans).length;
    if (report.counts.vlanRecords > report.counts.vlans) {
      _issue('vlan.collapsed', {
        declared: report.counts.vlanRecords, kept: report.counts.vlans, conflicts: vlanConflicts,
      });
    }
    const noVlanPrefixes = [];      // reti dichiarate senza VLAN (in NetBox sono la norma)
    const perVlanPrefixes = {};     // vid -> [cidr…], per accorgersi del dual-stack
    for (const p of (Array.isArray(nb.prefixes) ? nb.prefixes : [])) {
      if (!p || !_str(p.prefix)) continue;
      report.counts.prefixes++;
      const vidRaw = p.vlan && (p.vlan.vid != null ? p.vlan.vid : (vlanById[p.vlan.id] && vlanById[p.vlan.id].vid));
      // ⚠️ `Number.isFinite(+null)` è TRUE (`+null === 0`): un prefisso SENZA VLAN
      // finiva documentato come «VLAN 0» — una VLAN che non esiste, inventata dal
      // motore — e creava una voce fantasma `ipam.vlans[null]`. Misurato su NetBox
      // vero: 51 prefissi su 90 marcati VLAN 0. Il null va escluso PRIMA della
      // conversione: nessuna VLAN è meglio di una VLAN falsa.
      const vid = (vidRaw != null && Number.isFinite(+vidRaw)) ? +vidRaw : null;
      // `cidr` e' il nome del campo nel modello (lib/ipam-model.js): il prefisso e'
      // un oggetto di primo livello e la VLAN un riferimento facoltativo. Fino alla
      // 2.8.x questa riga si scriveva `prefix` e non la leggeva nessuno, mentre la
      // subnet veniva RICOPIATA dentro ipam.vlans[vid] — dove ci stava una sola
      // rete per VLAN, e la seconda cancellava la prima in silenzio.
      const prefix = { id: p.id != null ? p.id : null, cidr: _str(p.prefix), vlan: vid, source: 'dcim' };
      if (p.vrf && p.vrf.id != null) prefix.vrfId = p.vrf.id;
      if (p.tenant && p.tenant.id != null) prefix.tenantId = p.tenant.id;
      if (p.status && p.status.value != null) prefix.status = _str(p.status.value);
      if (_str(p.description)) prefix.description = _str(p.description);
      state.ipam.prefixes.push(prefix);
      if (vid == null) noVlanPrefixes.push(_str(p.prefix));
      else (perVlanPrefixes[vid] || (perVlanPrefixes[vid] = [])).push(_str(p.prefix));
    }
    // Reti senza VLAN: sono la maggioranza in un NetBox vero (misurato: 51 su 90).
    // Prima finivano in un array che non leggeva nessuno e sparivano dall'app.
    if (noVlanPrefixes.length) {
      _issue('prefix.noVlan', { n: noVlanPrefixes.length, sample: noVlanPrefixes.slice(0, 5) });
    }
    // Piu' prefissi sulla stessa VLAN: e' il caso dual-stack (una /24 e una /64) e
    // ora entrano tutti. Va DETTO perche' fino alla 2.8.x uno dei due spariva senza
    // una riga da nessuna parte, e chi rilegge il documento deve sapere che adesso
    // ci sono entrambi.
    const multi = Object.keys(perVlanPrefixes).filter(k => perVlanPrefixes[k].length > 1);
    if (multi.length) {
      _issue('prefix.multiPerVlan', {
        n: multi.length,
        total: multi.reduce((s, k) => s + perVlanPrefixes[k].length, 0),
        // L'esempio è un ESEMPIO: la lista intera delle reti di una VLAN (su un
        // NetBox vero anche diciotto /24) trasformava tre campioni in un muro di
        // testo, e una riga che non si legge non informa. Tre reti e quante restano
        // — il `+N` non ha bisogno di traduzione.
        sample: multi.slice(0, 5).map(k => {
          const list = perVlanPrefixes[k];
          const rest = list.length - 3;
          return `VLAN ${k}: ${list.slice(0, 3).join(', ')}${rest > 0 ? ` +${rest}` : ''}`;
        }),
      });
    }
    for (const ip of (Array.isArray(nb.ipAddresses) ? nb.ipAddresses : [])) {
      const address = _str(ip && ip.address);
      if (!address) continue;
      const assigned = ip.assigned_object || ip.assignedObject || null;
      const ifaceId = assigned && assigned.id != null ? assigned.id : null;
      const slotRef = ifaceId != null ? ifSlot[ifaceId] : null;
      const record = { id: ip.id != null ? ip.id : null, address };
      if (ip.status && ip.status.value != null) record.status = _str(ip.status.value);
      if (_str(ip.dns_name)) record.dnsName = _str(ip.dns_name);
      if (_str(ip.description)) record.description = _str(ip.description);
      if (ifaceId != null) record.interfaceId = ifaceId;
      if (slotRef) {
        record.portId = slotRef.portId || (slotRef.nodeId + '-' + slotRef.slot);
        record.deviceId = String(slotRef.nodeId).replace(/^nb-dev-/, '');
      } else if (assigned && assigned.device && assigned.device.id != null) {
        record.deviceId = assigned.device.id;
      }
      if (ip.vrf && ip.vrf.id != null) record.vrfId = ip.vrf.id;
      if (ip.tenant && ip.tenant.id != null) record.tenantId = ip.tenant.id;
      state.ipam.addresses.push(record);
    }
    report.counts.ips = state.ipam.addresses.length;

    // Indirizzi che NetBox dichiara e che non entrano perché non sono agganciati
    // a nessun apparato: riservati, futuri, avanzi di una migrazione. Sono la
    // norma, non un guasto — InfraNet documenta l'indirizzo DI un apparato — ma
    // «Indirizzi IP 0» accanto a «Prefissi 90» si legge come un guasto invece che
    // come una scelta. Misurato su un NetBox vero: 180 dichiarati, 180 senza
    // apparato, 0 importati. Stessa ragione di `cable.outOfScope`: non si perde
    // niente, ma va DETTO, o il silenzio afferma qualcosa che non è vero.
    //
    // ⚠️ GUARDIA. Il conteggio dei non agganciati arriva da un filtro il cui nome
    // cambia fra le versioni di NetBox, e una versione che non lo conosce può
    // ignorarlo e rispondere col TOTALE. L'invariante che lo smaschera: chi è
    // entrato È agganciato, quindi i non agganciati non possono essere più di
    // (totale − entrati). Se il numero supera quel tetto non è una misura, è il
    // filtro caduto nel vuoto → si tace. Non c'è una via di mezzo: un numero che
    // non si può dimostrare è peggio di nessun numero.
    const census = nb.ipCensus || null;
    if (census) {
      const total = Number.isFinite(+census.total) ? +census.total : null;
      const free = Number.isFinite(+census.unassigned) ? +census.unassigned : null;
      const fuori = (total != null) ? total - report.counts.ips : null;
      if (free != null && free > 0 && fuori != null && free <= fuori) {
        // Gli esempi seguono lo STESSO destino del conteggio: se il numero non si
        // può dimostrare non si stampa, e allora nemmeno le righe che dovrebbero
        // illustrarlo — verrebbero da una risposta che non abbiamo filtrato.
        const sample = Array.isArray(census.sample)
          ? census.sample.map(x => _str(x)).filter(Boolean).slice(0, 5) : [];
        _issue('ip.unassigned', { n: free, total, imported: report.counts.ips, sample });
      }
    }

    return { state, report };
  }

  return {
    netboxToState,
    // esportati per i test puri
    _roleToInfranetType, _deviceTypeToCatalog, _catalogMatch, _ifaceSlotOrder, _frontPortOrder, _frontRearIds, _faceOf, _cableCategory,
    _autoPlaceRacks, _autoPlaceFloorDevices,
    _stripPrefix, _natCmp,
  };
}));
