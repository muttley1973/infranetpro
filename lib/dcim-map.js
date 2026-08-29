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
  // Chi ha delle prese: definizione UNICA in lib/pdu-layout.js (pdu + ups; l'ATS è
  // fuori per decisione, il suo senso sono i due ingressi). Il ripiego serve solo
  // al caricamento nel browser senza `require`, dove il mapper non gira comunque.
  const _hasOutlets = (type) => _pduLayoutApi ? _pduLayoutApi.hasPowerOutlets(type) : type === 'pdu';
  // lib/cidr.js — l'UNICA definizione di «che indirizzo e' questo» e «sta dentro
  // questa rete». Stesso schema opzionale degli altri due: se manca, i pezzi che
  // ne dipendono si ASTENGONO invece di reinventare la regola qui (una seconda
  // definizione di cos'e' un IPv4 e' il difetto che si ripete da solo).
  const _cidrApi = typeof require === 'function' ? require('./cidr') : null;
  // lib/wifi-spec.js — il vocabolario Wi-Fi (bande, canali AMMESSI per banda,
  // standard). Serve a non scrivere nel documento un canale che l'app poi rifiuta.
  const _wifiSpec = typeof require === 'function' ? require('./wifi-spec') : null;
  // lib/os-icon.js — riconosce un sistema operativo da una stringa libera. Serve
  // al guest-OS delle VM, e si riusa invece di riscrivere le stesse espressioni.
  const _osIconApi = typeof require === 'function' ? require('./os-icon') : null;
  // lib/device-status.js — il vocabolario dello stato operativo. Il DCIM parla la
  // sua lingua (`active`, `planned`, `decommissioning`…), il documento la traduce
  // nella propria: senza questa riduzione il campo sarebbe testo libero e nessun
  // verdetto potrebbe ragionarci. Se manca, ci si ASTIENE dallo scriverlo.
  const _deviceStatusApi = typeof require === 'function' ? require('./device-status') : null;
  // lib/source-ref.js — l'identità dell'oggetto nel sistema d'origine, in un CAMPO.
  // È la sola cosa che permetterà, un giorno, di dire «questa porta è quella
  // interfaccia» senza confrontare stringhe. Se manca, ci si astiene dallo
  // scriverla: meglio nessun riferimento che uno a metà.
  const _srcRef = typeof require === 'function' ? require('./source-ref') : null;
  const _setRef = (obj, tipo, id) => (_srcRef ? _srcRef.setRef(obj, tipo, id) : false);
  const _T = _srcRef ? _srcRef.OBJECT_TYPES : {};
  const _canAddr = !!(_cidrApi && typeof _cidrApi.addrFamily === 'function'
    && typeof _cidrApi._parseCidrInfo === 'function' && typeof _cidrApi._ipInCidr === 'function');
  /** La chiave di un prefisso — la STESSA di `lib/ipam-model.js` (`prefixKey`),
   *  che qui non si può importare senza legare il mapper al modello IPAM: si
   *  chiama la stessa `subnetInputToCidr`, che è LA definizione. Senza la lib si
   *  ripiega sul testo normalizzato: due CIDR scritti uguali restano uguali, e
   *  fondere un po' meno è meglio che fondere a caso. */
  const _prefixKeyLocal = (cidr) => {
    const s = cidr == null ? '' : String(cidr).trim();
    if (!s) return '';
    const f = _cidrApi && _cidrApi.subnetInputToCidr;
    return ((typeof f === 'function' ? f(s) : '') || s).toLowerCase();
  };

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
    // ── I terminali: ciò che sta in fondo al cavo ──────────────────────────────
    // Mancavano tutti, e non per una scelta: InfraNet ha il tipo, la tabella no.
    // Misurato su un NetBox con un ruolo per tipologia, otto apparati diversi —
    // telecamera, telefono, PC, monitor, proiettore, controllo accessi, sensore —
    // entravano tutti come lo stesso generico «customrack», per giunta stando sul
    // pavimento. Gli slug sono quelli che la gente scrive davvero nei propri
    // NetBox, non quelli di un vendor: la regola resta neutrale.
    kvm: 'kvm', 'kvm-switch': 'kvm', 'ip-kvm': 'kvm',
    'ip-camera': 'webcam', camera: 'webcam', cctv: 'webcam', 'security-camera': 'webcam',
    display: 'tv', tv: 'tv', signage: 'tv', 'digital-signage': 'tv', monitor: 'tv',
    'iot-sensor': 'iot', iot: 'iot', sensor: 'iot', 'environmental-sensor': 'iot',
    desktop: 'pc', pc: 'pc', workstation: 'pc', 'desktop-pc': 'pc', thinclient: 'pc', 'thin-client': 'pc',
    tablet: 'mobile', smartphone: 'mobile', mobile: 'mobile', 'mobile-device': 'mobile',
    'voip-phone': 'voip', 'ip-phone': 'voip', voip: 'voip', phone: 'voip', 'desk-phone': 'voip',
    projector: 'projector', beamer: 'projector',
    'door-controller': 'doorctrl', 'access-control': 'doorctrl', 'door-control': 'doorctrl',
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
    // L'IDENTITÀ, prima di tutto il resto. Fino a oggi l'unico aggancio di una
    // porta all'interfaccia da cui viene era `ifName`: una stringa, cioè proprio
    // il confronto che questo progetto vieta ovunque — e che basta a rendere
    // impossibile scrivere un cavo all'indietro, perché un cavo si indirizza
    // sulle due INTERFACCE, non sui due apparati.
    _setRef(port, _T.interface, iface && iface.id);
    if (_str(iface && iface.name)) port.ifName = _str(iface.name);
    const desc = _str(iface && iface.description) || _str(iface && iface.label);
    if (desc) port.desc = desc;
    const _mac = _ifaceMac(iface);        // piatto (≤4.1) o oggetto dedicato (4.2+)
    if (_mac) port.mac = _mac.toUpperCase();
    const mode = iface && iface.mode && (iface.mode.value !== undefined ? iface.mode.value : iface.mode);
    // `untagged_vlan` significa due cose diverse a seconda del modo, e sono
    // ENTRAMBE una VLAN dichiarata da qualcuno: su una porta di accesso è il suo
    // PVID, su un trunk è la NATIVA. InfraNet le scrive nello stesso campo — su un
    // trunk `vlanOvr` È la nativa, e il motore del colore lo dice a chiare lettere
    // (lib/link-vlan-color.js: la contraddizione fra i due capi si guarda solo sui
    // cavi access, «perché su un trunk vlanOvr è la NATIVA»).
    const untagged = (iface && iface.untagged_vlan && Number.isFinite(+iface.untagged_vlan.vid))
      ? +iface.untagged_vlan.vid : null;
    if (mode === 'access' && untagged != null) {
      port.vlanOvr = untagged;
    } else if ((mode === 'tagged' || mode === 'tagged-all') && Array.isArray(iface.tagged_vlans)) {
      port.mode = 'trunk';
      port.trunkVlans = iface.tagged_vlans.map(vlan => +vlan.vid).filter(Number.isFinite);
      // ⚠️ Prima la nativa di un trunk veniva LETTA da NetBox e buttata via: il
      // ramo `access` non la prendeva e questo non la guardava. Conseguenza
      // misurata, non teorica — `native-mismatch` (lib/cable-validate.js) è un
      // errore di livello ERROR, il loop di traffico untagged fra due switch con
      // native diverse, e su qualunque progetto nato da un import NetBox non
      // poteva scattare MAI: i due capi arrivavano entrambi senza nativa.
      // È la classe «la VLAN si legge o resta assente»: qui era dichiarata alla
      // sorgente e diventava assente per strada.
      if (untagged != null) port.vlanOvr = untagged;
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
    // ⚠️ PRIMA della regola «switch»: un «KVM Switch» contiene la parola switch e
    // finiva fra gli switch — non un tipo mancante, un tipo SBAGLIATO, che è
    // peggio perché nessuno va a controllarlo. Stessa ragione per le altre righe
    // qui sotto: nomi che contengono una parola di un'altra classe.
    if (/\bkvm\b/.test(hay)) return { type: 'kvm', mapped: true };
    if (/camera|\bcctv\b|\bipcam\b/.test(hay)) return { type: 'webcam', mapped: true };
    if (/\bvoip\b|ip ?phone|desk ?phone|\bsip\b/.test(hay)) return { type: 'voip', mapped: true };
    if (/projector|beamer/.test(hay)) return { type: 'projector', mapped: true };
    if (/signage|\bdisplay\b|\bmonitor\b/.test(hay)) return { type: 'tv', mapped: true };
    if (/door ?control|access ?control|badge ?reader/.test(hay)) return { type: 'doorctrl', mapped: true };
    if (/\bsensor\b|\biot\b/.test(hay)) return { type: 'iot', mapped: true };
    if (/desktop|workstation|thin ?client|optiplex|thinkcentre/.test(hay)) return { type: 'pc', mapped: true };
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

  // ── Wireless NetBox → radio InfraNet ────────────────────────────────────────
  // I due modelli dicono la stessa cosa e non si parlavano. In NetBox una radio è
  // un'interfaccia con `rf_role: ap`, un tipo 802.11 e un canale; gli SSID sono
  // oggetti a sé (`wireless-lans`) con cifratura e VLAN, appesi all'interfaccia.
  // In InfraNet una radio è una voce di `node.radios[]` con banda/canale/standard,
  // e sotto i BSS `{ssid, vlan, security}` — lo stesso modello a due livelli.
  // Prima di questa mappatura un'interfaccia 802.11 finiva fra le porte LOGICHE:
  // il documento non sapeva che quell'apparato trasmettesse, e l'audit wireless
  // (coerenza VLAN↔SSID, reti aperte) non aveva niente da guardare.
  const _WIFI_STD_BY_IFTYPE = {
    'ieee802.11n': 'wifi4', 'ieee802.11ac': 'wifi5', 'ieee802.11ax': 'wifi6', 'ieee802.11be': 'wifi7',
    // 802.11a/g sono anteriori a Wi-Fi 4 e non hanno una voce nel vocabolario:
    // restano senza standard invece di prendersene uno che non è il loro.
  };

  function _isRadioIface(itf) {
    if (!itf) return false;
    const role = _lc(itf.rf_role && itf.rf_role.value !== undefined ? itf.rf_role.value : itf.rf_role);
    if (role === 'ap' || role === 'station') return true;
    return /^ieee802\.11/.test(_ifaceValue(itf.type));
  }

  // `rf_channel` è una stringa sola: banda-canale-frequenza-larghezza
  // («5g-42-5210-80»). Frequenza e larghezza sono DERIVATE dal canale e InfraNet
  // non le tiene: si prendono i due campi che sono davvero un dato.
  function _rfChannel(v) {
    const m = /^(2\.4|5|6)g-(\d+)-/.exec(_lc(v && v.value !== undefined ? v.value : v));
    return m ? { band: m[1], channel: +m[2] } : null;
  }

  // ⚠️ NetBox dice «personal» o «enterprise» e NON dice la generazione: WPA2 e
  // WPA3 gli sono la stessa voce. InfraNet invece le distingue. Si legge come
  // WPA2 — è quello che c'è installato nella stragrande maggioranza dei casi — e
  // lo si DICHIARA nella lista di decisioni, così chi ha WPA3 lo corregge invece
  // di scoprirlo per caso. `wep` non ha una voce nel vocabolario InfraNet: resta
  // vuoto, che è meglio di una cifratura vicina ma sbagliata.
  // Il canale sta fra quelli che InfraNet ammette per quella banda? Se il
  // vocabolario non e' disponibile non si inventa un giudizio: si accetta.
  function _wifiChannelOk(band, channel) {
    const f = _wifiSpec && _wifiSpec.channelsForBand;
    if (typeof f !== 'function') return true;
    const list = f(band);
    return !Array.isArray(list) || !list.length || list.indexOf(channel) >= 0;
  }

  function _wifiSecurity(authType) {
    const a = _lc(authType && authType.value !== undefined ? authType.value : authType);
    if (a === 'open') return { security: 'open', assumed: false };
    if (a === 'wpa-personal') return { security: 'wpa2-psk', assumed: true };
    if (a === 'wpa-enterprise') return { security: 'wpa2-ent', assumed: true };
    return { security: '', assumed: false };
  }

  // ── Virtualizzazione ──────────────────────────────────────────────────────
  // I tipi che SANNO ospitare VM. Non è un elenco di hypervisor: ospitare
  // macchine virtuali è una cosa che un apparato FA, non una cosa che È — uno
  // storage Synology/QNAP le ospita con un pacchetto (Virtual Machine Manager,
  // Virtualization Station) e resta uno storage. Perciò qui ci sono anche i due
  // NAS e il server: il tipo dice cosa c'è nel rack, la capacità cosa ci gira.
  // ⚠️ È uno SPECCHIO del flag `hostsVms` in src/app-types.js: quel file è un
  // modulo ESM del frontend e questa è una lib pura, quindi non si può
  // importare. Due elenchi della stessa cosa divergono al primo ritocco —
  // perciò test/dcim-map.test.js legge app-types.js e fallisce se qualcuno
  // aggiunge un tipo là e non qui.
  const _VM_HOST_TYPES = new Set(['hypervisor', 'homelab', 'server', 'nas', 'nasdesktop']);

  // Chiave-icona di lib/os-icon.js → codice guest della VM (`_VM_GUEST_OS` in
  // src/app-properties-vm.js). Il RICONOSCIMENTO dell'OS non si riscrive qui:
  // la tabella di espressioni che sa cos'è «Ubuntu 22.04» o «Rocky Linux» esiste
  // già in os-icon.js ed è l'unica. Qui c'è solo la traduzione fra due
  // vocabolari chiusi. Le chiavi assenti (android, i loghi hypervisor…) non
  // hanno un guest corrispondente: si lascia vuoto invece di avvicinarsi.
  const _GUEST_BY_OSKEY = {
    ubuntu: 'ubuntu', debian: 'debian', rhel: 'rhel', fedora: 'fedora', suse: 'suse',
    linux: 'linux', raspberrypi: 'linux', bsd: 'bsd', macos: 'macos',
    container: 'container', netdev: 'appliance',
  };

  function _vmGuestOs(platformLabel) {
    const s = _str(platformLabel);
    if (!s || !_osIconApi || typeof _osIconApi.osIconFromString !== 'function') return '';
    const d = _osIconApi.osIconFromString(s);
    const key = d && d.key;
    if (!key) return '';
    // L'unica distinzione che la tabella degli OS non fa e che il guest sì:
    // Windows Server contro Windows client. La parola sta nel nome della
    // platform o non sta da nessuna parte.
    if (key === 'windows') return /server|\bsrv\b/i.test(s) ? 'win-srv' : 'win';
    return _GUEST_BY_OSKEY[key] || '';
  }

  // Il MAC di UN'INTERFACCIA — vNIC o porta fisica, la regola è la stessa.
  // NetBox 4.2 ha spostato i MAC in oggetti dedicati (`primary_mac_address`)
  // lasciando il campo piatto per compatibilità: si guardano entrambi,
  // nell'ordine in cui NetBox li considera autorevoli.
  //
  // ⚠️ Questa funzione esisteva già ma la usavano solo le VM, mentre le porte
  // fisiche leggevano `iface.mac_address` e basta. Su NetBox 4.2+ quel campo è
  // `null` — misurato su un 4.6.7 vero, dove le porte tornavano tutte senza MAC.
  // Il risultato era che **ogni MAC di ogni porta spariva all'import**, e il MAC
  // in InfraNet non è un dettaglio: ci si appoggiano `macKey`, l'audit di
  // presenza, l'aggancio FDB e il drift d'identità. La regola giusta c'era, in
  // un posto solo: è la stessa classe di difetto delle definizioni duplicate.
  function _ifaceMac(itf) {
    const primary = itf && (itf.primary_mac_address || itf.primaryMacAddress);
    if (primary && typeof primary === 'object') {
      const m = _str(primary.mac_address || primary.macAddress || primary.display);
      if (m) return m;
    }
    return _str(itf && itf.mac_address);
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

  // ── Le stanze: un'ubicazione NetBox diventa un rettangolo ─────────────────
  // ⚠️ Una Location NetBox NON HA geometria: ha un nome, un sito, un padre. I
  // quattro numeri che fanno una stanza (x, y, larghezza, altezza) di là non
  // esistono, e inventarli sarebbe una bugia. Quindi la divisione è netta:
  //   • che la stanza ESISTA lo dice il DCIM          → misura;
  //   • che forma e posizione abbia lo decidiamo noi  → dichiarazione, e si dice.
  // È la stessa regola con cui l'import piazza già i rack (_autoPlaceRacks), e
  // ogni oggetto disposto qui porta lo stesso marchio: `positionSource`.
  //
  // La DIMENSIONE non è un numero a caso: si deriva dal CONTENUTO. Una stanza
  // con due rack è piccola, una con dodici è grande — il rettangolo dice quanto
  // c'è dentro, e questo è un fatto misurato.
  //
  // ⚠️ Niente `color`: il renderer usa già `n.color || def.defaultColor`, e
  // ricopiare qui il colore del tipo sarebbe la solita definizione in due posti.
  const _ROOM_LAYOUT = Object.freeze({
    originX: 60, originY: 60,
    padTop: 56, pad: 40, gap: 60,     // padTop lascia aria all'etichetta della stanza
    cellX: 220, cellY: 140,           // stessi passi di _FLOOR_RACK_LAYOUT: non si accavallano
    innerColumns: 4, roomColumns: 3,
    minW: 220, minH: 180,
  });

  // Il nome: le ubicazioni NetBox si ANNIDANO, le stanze InfraNet no. La catena
  // dei padri si appiattisce nel nome («Piano 1 · Sala server») invece di
  // fingere una gerarchia che il documento non sa rappresentare.
  function _locationLabel(locId, names, byId) {
    const parts = [];
    let cur = byId.get(_str(locId));
    let guard = 0;
    while (cur && guard++ < 8) {
      const nm = _str(cur.name);
      if (nm) parts.unshift(nm);
      const p = cur.parent && cur.parent.id;
      cur = (p != null) ? byId.get(_str(p)) : null;
    }
    if (parts.length) return parts.join(' · ');
    return _str(names.get(_str(locId))) || ('nb-loc-' + locId);
  }

  function _autoPlaceRooms(state, ctx) {
    const L = _ROOM_LAYOUT;
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    const racks = Array.isArray(state.racks) ? state.racks : [];
    const locOfDevice = ctx.locOfDevice, names = ctx.locNames;
    const byId = new Map();
    for (const l of (Array.isArray(ctx.locations) ? ctx.locations : [])) {
      if (l && l.id != null) byId.set(_str(l.id), l);
    }

    // Un rack senza ubicazione propria la EREDITA dagli apparati che ospita: in
    // NetBox un device in rack sta nell'ubicazione del rack, quindi è una
    // derivazione dal dato, non un'invenzione.
    const rackLoc = new Map(ctx.locOfRack);
    for (const n of nodes) {
      if (!n || n.placement !== 'rack' || !n.rackId || rackLoc.has(n.rackId)) continue;
      const loc = locOfDevice.get(_str(n.source && n.source.deviceId));
      if (loc) rackLoc.set(n.rackId, loc);
    }

    // Si raggruppa ciò che è ENTRATO davvero. Un'ubicazione senza contenuto non
    // diventa una stanza: un rettangolo vuoto non documenta niente.
    const gruppi = new Map();
    const g = (id) => { let x = gruppi.get(id); if (!x) gruppi.set(id, x = { racks: [], nodes: [] }); return x; };
    for (const r of racks) { const loc = rackLoc.get(r.id); if (loc) g(loc).racks.push(r); }
    const senza = [];
    for (const n of nodes) {
      if (!n || n.placement !== 'floor') continue;
      const loc = locOfDevice.get(_str(n.source && n.source.deviceId));
      if (loc) g(loc).nodes.push(n); else senza.push(n);
    }
    const senzaUbicazione = senza.length;
    if (!gruppi.size) return { rooms: 0, placed: 0, senzaUbicazione: 0, nested: 0 };

    // Ordine STABILE (nome, poi id): due import dello stesso sito devono dare la
    // stessa planimetria, altrimenti il confronto vedrebbe differenze inventate.
    const etichette = new Map();
    for (const locId of gruppi.keys()) etichette.set(locId, _locationLabel(locId, names, byId));
    const ordine = [...gruppi.keys()].sort((a, b) => {
      const c = _str(etichette.get(a)).localeCompare(_str(etichette.get(b)));
      return c || _natCmp(_str(a), _str(b));
    });

    let cursorX = L.originX, cursorY = L.originY, rowH = 0, col = 0;
    let rooms = 0, placed = 0, nested = 0, fondo = 0;
    for (const locId of ordine) {
      const grp = gruppi.get(locId);
      const items = grp.racks.concat(grp.nodes);
      if (!items.length) continue;
      const cols = Math.max(1, Math.min(L.innerColumns, items.length));
      const rows = Math.ceil(items.length / cols);
      const w = Math.max(L.minW, L.pad * 2 + cols * L.cellX);
      const h = Math.max(L.minH, L.padTop + L.pad + rows * L.cellY);
      if (col >= L.roomColumns) { col = 0; cursorX = L.originX; cursorY += rowH + L.gap; rowH = 0; }

      const nome = etichette.get(locId);
      if (nome.indexOf(' · ') >= 0) nested++;
      const room = { id: 'nb-loc-' + locId, type: 'room', name: nome,
                     x: cursorX, y: cursorY, w, h, positionSource: 'infranet-import-grid' };
      _setRef(room, _T.location, locId);
      state.nodes.push(room);
      rooms++;

      items.forEach((it, i) => {
        it.x = cursorX + L.pad + (i % cols) * L.cellX;
        it.y = cursorY + L.padTop + Math.floor(i / cols) * L.cellY;
        it.positionSource = 'infranet-import-grid';
        placed++;
      });

      cursorX += w + L.gap;
      rowH = Math.max(rowH, h);
      col++;
      fondo = Math.max(fondo, cursorY + h);
    }

    // Chi non ha un'ubicazione va SOTTO le stanze, non sopra: un apparato
    // disegnato dentro un rettangolo si legge come «sta in quella stanza», e
    // sarebbe una cosa che il DCIM non ha mai detto.
    if (rooms && senza.length) {
      const y0 = fondo + L.gap;
      senza.sort((a, b) => _natCmp(_str(a.id), _str(b.id)));
      senza.forEach((n, i) => {
        n.x = L.originX + (i % 6) * 190;
        n.y = y0 + Math.floor(i / 6) * 150;
        n.positionSource = 'infranet-import-grid';
      });
    }
    return { rooms, placed, senzaUbicazione, nested };
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
    // Le WLAN per id: l'interfaccia porta solo il riferimento (id + ssid), e
    // cifratura e VLAN stanno sull'oggetto WLAN. Senza questa tabella si potrebbe
    // scrivere il nome della rete e non che cos'è — il pezzo che conta.
    const wlanById = _indexById(nb.wirelessLans);

    const state = { nodes: [], links: [], ports: {}, racks: [], ipam: { vlans: {}, prefixes: [], addresses: [] }, vlanNames: {}, vlanColors: {} };
    const report = {
      catalogVersion: opts.catalogVersion || null,
      counts: {
        devices: 0, devicesRack: 0, devicesFloor: 0, interfaces: 0, powerOutlets: 0, powerPorts: 0, consolePorts: 0, cables: 0,
        directLinks: 0, passThroughLinks: 0, unresolvedCables: 0,
        vlans: 0, vlanRecords: 0, prefixes: 0, ips: 0, racks: 0, stacks: 0, radios: 0, ssids: 0, vms: 0,
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
    const originSites = new Map();   // id sito → nome, dagli apparati che entrano

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

    // Ubicazioni: chi sta dove. Si raccoglie strada facendo — il payload del
    // device porta l'ubicazione come oggetto breve (id + nome) — e si usa alla
    // fine per costruire le stanze.
    const _locOfRack = new Map();     // id rack InfraNet → id ubicazione NetBox
    const _locOfDevice = new Map();   // id device NetBox → id ubicazione NetBox
    const _locNames = new Map();      // id ubicazione → nome breve (senza i padri)

    const rackIdMap = Object.create(null);   // nbRackId → id fronte ; nbRackId+'|rear' → id retro
    for (const r of (Array.isArray(nb.racks) ? nb.racks : [])) {
      if (!r || r.id == null) continue;
      if (isOut('rack', r.id)) { report.excluded.racks.push(r.id); continue; }
      const faces = rackFaces[r.id] || { front: true, rear: false };   // rack senza device visti → fronte
      const split = faces.front && faces.rear;                          // bifacciale → due rack
      const name = _str(r.name) || ('nb-rack-' + r.id);
      const sizeU = (Number.isFinite(+r.u_height) && +r.u_height > 0) ? +r.u_height : null;   // no invenzione 42U
      // ⚠️ I due rack di un bifacciale portano lo STESSO riferimento, e non è un
      // errore: di là è un rack solo, ed è di là che vive l'identità. Chi confronta
      // deve saperlo — appaiare per riferimento su un bifacciale trova due righe.
      const mk = (id, dispName) => {
        const rk = { id, name: dispName };
        _setRef(rk, _T.rack, r.id);
        if (r.location && r.location.id != null) {
          _locOfRack.set(id, _str(r.location.id));
          if (!_locNames.has(_str(r.location.id))) _locNames.set(_str(r.location.id), _str(r.location.name));
        }
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
    // Wireless: quanti apparati trasmettono, quante radio non ci stanno nel tetto,
    // quanti SSID hanno una cifratura LETTA e non dichiarata (v. `_wifiSecurity`).
    let wifiDevices = 0, wifiOverCap = 0, wifiAssumedSec = 0, wifiWideChannel = 0;

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
      // Lo stato entra DUE volte, e non è una duplicazione: `source.status` è la
      // parola di NetBox, verbatim, e resta l'origine da mostrare; `node.status` è
      // il campo del documento, ridotto al vocabolario di InfraNet, ed è quello che
      // i verdetti leggono. Averli separati è ciò che, il giorno del ri-import,
      // permette di dire «NetBox diceva X, tu hai messo Y» invece di indovinare.
      // ⚠️ Nessun `statusManual`: l'import crea un progetto NUOVO, qui non c'è una
      // scelta dell'utente da proteggere. Sarà la metà che riscrive a doverlo
      // rispettare — il flag lo mette solo il pannello.
      if (nbStatus && _deviceStatusApi) {
        const s = _deviceStatusApi.normalizeStatus(nbStatus);
        if (s) node.status = s;   // non riconosciuto = non dichiarato: mai un ripiego
      }
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
      const locId = dev.location && dev.location.id;
      if (locId != null) {
        _locOfDevice.set(_str(dev.id), _str(locId));
        if (!_locNames.has(_str(locId))) _locNames.set(_str(locId), locName);
      }
      // Da DOVE viene questo documento. Si registra il sito degli apparati che sono
      // ENTRATI davvero, non l'ambito che è stato chiesto: se ne scegli tre e uno
      // solo ha apparati, l'origine è quello. È una misura del risultato, non la
      // copia della domanda — e serve al confronto, che senza questo non sa a quale
      // fetta di NetBox appartenga il progetto e finisce per dichiarare «nuovo»
      // tutto il resto dell'archivio (misurato: 181 novità su un progetto di un sito).
      if (dev.site && dev.site.id != null) originSites.set(_str(dev.site.id), _str(dev.site.name));
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
      // Il generico segue DOVE STA l'apparato. `customrack` e `customfloor` sono
      // due tipi diversi e si disegnano in due posti diversi: un ruolo che la
      // tabella non conosce, su un apparato che nel rack non c'è, usciva
      // «generico da rack» piantato sul pavimento. La classe non la sappiamo —
      // quella resta generica — ma il posto sì, ed è già deciso qui sopra.
      if (!rt.mapped && node.type === 'customrack' && node.placement === 'floor') node.type = 'customfloor';

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

      // Le radio non sono porte: sono antenne. Vanno raccolte PRIMA che
      // `_ifaceKind` le mandi fra le logiche (il suo test su `ieee802.11` è
      // giusto per una porta, e qui non stiamo facendo una porta).
      const radioIfaces = [];
      for (const itf of ordered) {
        const detectedKind = _ifaceKind(itf);
        if (_isRadioIface(itf)) { radioIfaces.push(itf); continue; }
        // Un PDU — e un UPS da rack — non ha porte Ethernet "utente": ogni
        // interfaccia non logica rappresenta la gestione IP (la scheda di rete
        // dell'apparato), anche se NetBox la chiama eth0/lan1 e non ha impostato
        // `mgmt_only`.
        const kind = _hasOutlets(node.type) && detectedKind !== 'logical' ? 'mgmt' : detectedKind;
        if (kind !== 'mgmt' && kind !== 'logical') continue;
        if (kind === 'mgmt') {
          mgmtIndex++;
          const portId = _hasOutlets(node.type) ? nodeId + '-' + mgmtIndex : nodeId + '-mgmt' + mgmtIndex;
          if (itf && itf.id != null) ifSlot[itf.id] = { nodeId, portId, kind, slot: null };
          state.ports[portId] = _interfacePortData(itf, kind);
        } else if (itf && itf.id != null) {
          const portId = nodeId + '-logical-' + itf.id;
          ifSlot[itf.id] = { nodeId, portId, kind, slot: null, logical: true };
          state.ports[portId] = _interfacePortData(itf, kind);
        }
        report.counts.interfaces++;
      }

      // ── Le radio diventano `node.radios[]` ────────────────────────────────
      // Il tetto è 8 (lib/radio.js MAX_RADIOS): non è una scelta di qui, è il
      // modello. Chi ne dichiara di più se lo sente dire invece di perderle.
      if (radioIfaces.length) {
        const radios = [];
        for (const itf of radioIfaces) {
          if (radios.length >= 8) { wifiOverCap++; continue; }
          const radio = {};
          const label = _str(itf.name);
          if (label) radio.label = label;
          const ch = _rfChannel(itf.rf_channel);
          if (ch) {
            radio.band = ch.band;
            // ⚠️ Il numero di canale di NetBox e quello di InfraNet non sono la
            // stessa cosa quando il canale e' LARGO. «5g-42-5210-80» vuol dire
            // «blocco da 80 MHz centrato su 5210»: 42 e' la designazione del
            // BLOCCO, non un canale primario da 20 MHz. InfraNet chiede il
            // primario (36, 40, 44, 48…) e infatti rifiutava il 42 con un avviso
            // rosso su ogni AP importato — aveva ragione lui.
            // Dedurre il primario non si puo': quel blocco ne copre quattro e
            // NetBox non dice quale sia. Quindi la banda entra (è certa), il
            // canale no, e la cosa si dichiara invece di lasciare un campo
            // rifiutato dentro il documento.
            if (_wifiChannelOk(ch.band, ch.channel)) radio.channel = ch.channel;
            else wifiWideChannel++;
          }
          const std = _WIFI_STD_BY_IFTYPE[_ifaceValue(itf.type)];
          // Wi-Fi 6 sui 6 GHz si chiama 6E: stesso 802.11ax, banda diversa.
          if (std) radio.standard = (std === 'wifi6' && ch && ch.band === '6') ? 'wifi6e' : std;
          const ssids = [];
          for (const ref of (Array.isArray(itf.wireless_lans) ? itf.wireless_lans : [])) {
            const wlId = (ref && ref.id != null) ? ref.id : ref;
            const wl = wlanById[wlId] || (ref && typeof ref === 'object' ? ref : null);
            const ssid = _str(wl && wl.ssid);
            if (!ssid) continue;
            // id STABILE, derivato dall'id NetBox: due import dello stesso SSID
            // danno lo stesso BSS, e i link che lo referenziano reggono.
            const bss = { id: 'nb-wl-' + (wl && wl.id != null ? wl.id : ssid), ssid };
            const vid = wl && wl.vlan && wl.vlan.vid;
            if (Number.isFinite(+vid)) bss.vlan = +vid;
            const sec = _wifiSecurity(wl && wl.auth_type);
            if (sec.security) bss.security = sec.security;
            if (sec.assumed) wifiAssumedSec++;
            ssids.push(bss);
            report.counts.ssids++;
          }
          if (ssids.length) radio.ssids = ssids;
          radios.push(radio);
        }
        if (radios.length) {
          node.radios = radios;
          report.counts.radios += radios.length;
          wifiDevices++;
        }
      }

      if (_hasOutlets(node.type)) {
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
        // Uno slot di patch panel è UNA porta InfraNet sopra DUE oggetti NetBox: il
        // front e il rear. Servono entrambi gli identificativi, perché un cavo può
        // terminare sull'uno o sull'altro. Il rear si scrive solo quando è UNO: se
        // il front ne collassa più d'uno, sceglierne uno sarebbe un'invenzione.
        _setRef(port, _T.frontPort, fp && fp.id);
        const rearIds = _frontRearIds(fp);
        if (rearIds.length === 1) _setRef(port, _T.rearPort, rearIds[0]);
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
      // ⚠️ Il gate NON è «è un PDU», è «ha delle prese». Un UPS da rack ne ha
      // quanto una barra — spesso a gruppi che si spengono da soli — e le sue
      // prese sono l'unica cosa che dice CHI RESTA ACCESO quando manca la
      // corrente. Finché qui c'era scritto `pdu`, quelle prese arrivavano fino a
      // questa riga e venivano contate fra le perdite.
      if (_hasOutlets(node.type)) {
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

    // Le stanze si costruiscono per ULTIME, quando si sa che cosa è entrato
    // davvero: la loro dimensione dipende dal contenuto, e il contenuto si
      // sposta dentro la propria stanza (sovrascrivendo la griglia di sopra, che
    // resta per chi un'ubicazione non ce l'ha).
    const _rooms = _autoPlaceRooms(state, { locOfRack: _locOfRack, locOfDevice: _locOfDevice, locNames: _locNames, locations: nb.locations });
    if (_rooms.rooms) {
      _issue('location.rooms', { n: _rooms.rooms, placed: _rooms.placed, nested: _rooms.nested });
      if (_rooms.senzaUbicazione) _issue('location.none', { n: _rooms.senzaUbicazione });
    }

    // ── Che cosa è successo al wireless ─────────────────────────────────────
    // Una riga che dice cosa ENTRA: fino alla 2.9.1 le interfacce 802.11 finivano
    // fra le porte logiche e SSID, cifratura, banda e canale non entravano affatto.
    if (report.counts.radios) {
      _issue('wifi.imported', { n: report.counts.radios, devices: wifiDevices, ssids: report.counts.ssids });
    }
    // E una che dice cosa è stato LETTO invece che dichiarato: NetBox non
    // distingue WPA2 da WPA3, InfraNet sì. Chi ha WPA3 lo corregge da qui.
    if (wifiAssumedSec) _issue('wifi.securityAssumed', { n: wifiAssumedSec });
    // Oltre il tetto del modello: dichiarato, non perso in silenzio.
    if (wifiOverCap) _issue('wifi.radiosCapped', { n: wifiOverCap });
    // Canale largo: la banda entra, il numero no. Dichiarato, non taciuto.
    if (wifiWideChannel) _issue('wifi.wideChannel', { n: wifiWideChannel });

    // ── Le macchine virtuali tornano sopra il loro host ──────────────────────
    // NetBox tiene le VM in un'applicazione a parte (`virtualization/`) e fino
    // alla 2.9.2 l'import non la interrogava affatto: l'hypervisor arrivava, il
    // pannello si apriva, e l'elenco delle VM era vuoto. Sembrava un difetto di
    // visualizzazione ed era un dato mai partito.
    //
    // CHI OSPITA CHI — NetBox ha due modi di dirlo, e uno solo è esplicito:
    //   `vm.device`  → questa VM gira su QUELLA macchina fisica. Dichiarato.
    //   `vm.cluster` → gira su quel cluster. Se del cluster è stato importato UN
    //                  SOLO apparato l'host non è ambiguo, si aggancia lì e lo si
    //                  dichiara (è una LETTURA, non un dato). Se sono due o più,
    //                  NetBox non dice quale: la VM resta fuori e lo si dichiara.
    //                  Sceglierne uno a caso sarebbe un'invenzione (paletto ②).
    // Il legame cluster → apparati sta già sul DEVICE (`dev.cluster`), che è
    // dentro la lettura che abbiamo: nessuna chiamata in più.
    const vmList = Array.isArray(nb.virtualMachines) ? nb.virtualMachines : [];
    if (vmList.length) {
      const nodeByDevice = new Map();
      for (const n of state.nodes) {
        const did = n.source && n.source.deviceId;
        if (did != null) nodeByDevice.set(String(did), n);
      }
      const nodesByCluster = new Map();
      for (const dev of (Array.isArray(nb.devices) ? nb.devices : [])) {
        const cid = dev && dev.cluster && dev.cluster.id;
        if (cid == null) continue;
        const host = nodeByDevice.get(String(dev.id));
        if (!host) continue;                       // escluso dal perimetro: non conta
        const k = String(cid);
        if (!nodesByCluster.has(k)) nodesByCluster.set(k, []);
        nodesByCluster.get(k).push(host);
      }

      // Indirizzi delle vNIC. Arrivano dalla stessa tabella degli indirizzi di
      // apparato, distinti dal tipo dell'oggetto agganciato.
      const ipsByIface = new Map();
      for (const a of (Array.isArray(nb.vmIpAddresses) ? nb.vmIpAddresses : [])) {
        const kind = _lc(a && (a.assigned_object_type || a.assignedObjectType));
        const oid = a && (a.assigned_object_id != null ? a.assigned_object_id : a.assignedObjectId);
        if (!kind || kind.indexOf('vminterface') < 0 || oid == null) continue;
        const bare = _stripPrefix(_str(a.address));
        if (!bare) continue;
        const k = String(oid);
        if (!ipsByIface.has(k)) ipsByIface.set(k, []);
        ipsByIface.get(k).push(bare);
      }
      const ifacesByVm = new Map();
      for (const itf of (Array.isArray(nb.vmInterfaces) ? nb.vmInterfaces : [])) {
        const ref = itf && (itf.virtual_machine || itf.virtualMachine);
        const vid = ref && typeof ref === 'object' ? ref.id : ref;
        if (vid == null) continue;
        const k = String(vid);
        if (!ifacesByVm.has(k)) ifacesByVm.set(k, []);
        ifacesByVm.get(k).push(itf);
      }

      let vmHosts = 0, vmViaCluster = 0, vmExtraAddr = 0;
      const vmRetyped = [], vmOrphans = [];
      const touched = new Set();
      for (const vm of vmList) {
        if (!vm || vm.id == null) continue;
        const vmName = _str(vm.name) || _str(vm.display) || ('#' + vm.id);
        const devRef = vm.device && typeof vm.device === 'object' ? vm.device.id : vm.device;
        const clRef = vm.cluster && typeof vm.cluster === 'object' ? vm.cluster.id : vm.cluster;
        let host = devRef != null ? nodeByDevice.get(String(devRef)) : null;
        if (host) {
          // niente da dichiarare: NetBox nomina la macchina fisica
        } else if (clRef != null) {
          const candidates = nodesByCluster.get(String(clRef)) || [];
          if (candidates.length === 1) { host = candidates[0]; vmViaCluster++; }
        }
        if (!host) {
          if (vmOrphans.length < 5) vmOrphans.push(vmName);
          continue;
        }

        // Un apparato su cui NetBox mette delle VM deve avere DOVE mostrarle.
        // Storage, NAS, server e mini-server sanno gia' ospitarle (_VM_HOST_TYPES)
        // e da qui non passano: restano quello che il DCIM dice che sono. Ci arriva
        // solo chi non puo' ospitarle per costruzione — uno switch, un firewall —
        // e lì il tipo si adegua, perché il dato esiste e non può restare
        // invisibile. Rack → hypervisor, pavimento → homelab; la riga di decisione
        // lo dice all'utente, che può sempre rimetterlo com'era.
        if (!_VM_HOST_TYPES.has(host.type)) {
          host.type = (host.placement === 'floor') ? 'homelab' : 'hypervisor';
          vmRetyped.push({ id: (host.source && host.source.deviceId), name: host.name });
        }

        const nics = [];
        for (const itf of (ifacesByVm.get(String(vm.id)) || [])) {
          const nic = { id: 'nb-vnic-' + itf.id };
          const nm = _str(itf.name); if (nm) nic.name = nm;
          const mac = _ifaceMac(itf); if (mac) nic.mac = mac;
          const vid = itf.untagged_vlan && itf.untagged_vlan.vid;
          if (Number.isFinite(+vid)) nic.vlan = String(+vid);
          for (const addr of (ipsByIface.get(String(itf.id)) || [])) {
            const fam = _canAddr ? _cidrApi.addrFamily(addr) : 4;
            if (fam === 4 && !nic.ip) nic.ip = addr;
            else if (fam === 6 && !nic.ip6) nic.ip6 = addr;
            else vmExtraAddr++;              // una vNIC tiene un v4 e un v6: il resto si dichiara
          }
          nics.push(nic);
        }
        // Indirizzo primario della VM: se le vNIC non ne portano nessuno (NetBox
        // permette di dichiararlo senza passare da un'interfaccia) si tiene lo
        // stesso, perché è quello che rende la VM visibile all'audit IPAM.
        const primary = _stripPrefix(_str(vm.primary_ip4 && vm.primary_ip4.address));
        if (primary && !nics.some(n => n.ip)) {
          if (nics.length) nics[0].ip = primary;
          else nics.push({ id: 'nic1', ip: primary });
        }

        const rec = { id: 'nb-vm-' + vm.id, name: vmName };
        const role = _str(vm.role && (vm.role.name || vm.role.slug));
        if (role) rec.role = role;
        const guest = _vmGuestOs(vm.platform && (vm.platform.name || vm.platform.slug));
        if (guest) rec.guestOs = guest;
        // Lo stato: NetBox `active`/`offline` sono le sue due parole per «in
        // servizio» e «spenta». Gli altri stati del ciclo di vita (planned,
        // staged, failed…) non dicono se la macchina giri: restano non
        // specificati, che nel modello è un valore vero e non un default.
        const st = _lc(vm.status && (vm.status.value != null ? vm.status.value : vm.status));
        if (st === 'active') rec.state = 'running';
        else if (st === 'offline') rec.state = 'stopped';
        const vcpu = +vm.vcpus;
        if (Number.isFinite(vcpu) && vcpu > 0) rec.vcpu = Math.round(vcpu);
        // ⚠️ NetBox conta memoria e disco in MEGABYTE, InfraNet in gigabyte.
        // L'unità non è dichiarata da nessun campo dell'API — è la convenzione
        // del suo modello, misurata: `vm.disk` è la somma dei dischi virtuali e
        // vale lo stesso numero che ha `virtual-disk.size`. Perciò la
        // conversione si DICE nell'anteprima invece di sparire dentro una
        // divisione: è la stessa classe di trappola del canale largo, dove due
        // sistemi usano la stessa unità per domande diverse.
        const mem = +vm.memory;
        if (Number.isFinite(mem) && mem > 0) rec.ramGb = Math.round(mem / 1024 * 10) / 10;
        const disk = +vm.disk;
        if (Number.isFinite(disk) && disk > 0) rec.diskGb = Math.round(disk / 1024 * 10) / 10;
        const notes = _str(vm.description) || _str(vm.comments);
        if (notes) rec.notes = notes;
        if (nics.length) rec.nics = nics;

        if (!Array.isArray(host.vms)) host.vms = [];
        host.vms.push(rec);
        report.counts.vms++;
        if (!touched.has(host.id)) { touched.add(host.id); vmHosts++; }
      }

      if (report.counts.vms) _issue('vm.imported', { n: report.counts.vms, hosts: vmHosts });
      if (vmViaCluster) _issue('vm.viaCluster', { n: vmViaCluster });
      if (vmRetyped.length) {
        _issue('vm.hostRetyped', { n: vmRetyped.length, sample: vmRetyped.map(h => h.name).slice(0, 5) });
      }
      const orphanTotal = vmList.length - report.counts.vms;
      if (orphanTotal > 0) _issue('vm.noHost', { n: orphanTotal, sample: vmOrphans });
      if (vmExtraAddr) _issue('vm.addrExtra', { n: vmExtraAddr });
    }

    // Il censimento sta FUORI dal blocco qui sopra apposta: il caso che conta
    // davvero è quello in cui non arriva NESSUNA VM. Un elenco vuoto senza una
    // riga che lo spieghi si legge come un difetto dell'applicazione — è
    // successo, ed è la domanda da cui nasce tutta questa funzione.
    const vmCensus = nb.vmCensus || null;
    if (vmCensus && Number.isFinite(+vmCensus.total)) {
      const out = +vmCensus.total - report.counts.vms;
      if (out > 0) {
        // ⚠️ Gli esempi arrivano dalle prime righe del censimento, che sono
        // spesso proprio quelle ENTRATE: stamparle sotto «restano fuori» era
        // una piccola bugia. Si tengono solo i nomi che nel documento non ci
        // sono; se non ne resta nessuno, la riga vive benissimo col suo numero.
        const imported = new Set();
        for (const n of state.nodes) for (const v of (Array.isArray(n.vms) ? n.vms : [])) imported.add(_str(v.name));
        const sample = (Array.isArray(vmCensus.sample) ? vmCensus.sample : [])
          .map(x => _str(x)).filter(x => x && !imported.has(x)).slice(0, 5);
        _issue('vm.outOfScope', { n: out, total: +vmCensus.total, imported: report.counts.vms, sample });
      }
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
    // Il RUOLO della VLAN, raccolto qui e abbinato più avanti. NetBox lo serializza
    // già dentro l'oggetto VLAN (`role`), quindi non costa una chiamata in più.
    const vlanRoles = new Map();     // slug → { slug, name, vids:Set, n }
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
      // ⚠️ Il ruolo si RACCOGLIE, non si interpreta. In NetBox è testo libero scelto
      // da chi ha compilato l'archivio — misurato su un NetBox vero: «Access - Data»,
      // «Access - Voice», «Access - Wireless», «Management», «Testing» — e nessuna
      // convenzione dice che cosa significhino. «Access - Wireless» NON è la rete
      // ospiti, e una regola che ci vedesse dentro la parola «wireless» avrebbe
      // dichiarato ospiti l'intera rete aziendale senza che nessuno lo chiedesse.
      // L'abbinamento lo fa l'utente una volta sola nell'anteprima (paletto ②).
      const rSlug = _str(v.role && (v.role.slug || v.role.name));
      if (rSlug) {
        let e = vlanRoles.get(rSlug);
        if (!e) { e = { slug: rSlug, name: _str(v.role.name) || rSlug, vids: new Set(), n: 0 }; vlanRoles.set(rSlug, e); }
        e.vids.add(+v.vid); e.n++;
      }
    }
    // Il contatore = VLAN che finiscono nel documento, non righe lette da NetBox.
    report.counts.vlans = Object.keys(state.ipam.vlans).length;
    if (report.counts.vlanRecords > report.counts.vlans) {
      _issue('vlan.collapsed', {
        declared: report.counts.vlanRecords, kept: report.counts.vlans, conflicts: vlanConflicts,
      });
    }
    // Le righe già scritte, per chiave: due dichiarazioni dello stesso CIDR non
    // possono diventare due righe (vedi il commento sulla fusione, più sotto).
    const prefissiPerChiave = new Map();
    let prefixCollapsed = 0;
    const noVlanPrefixes = [];      // reti dichiarate senza VLAN (in NetBox sono la norma)
    const perVlanPrefixes = {};     // vid -> [cidr…], per accorgersi del dual-stack
    const roleOnlyOnPrefix = new Map();   // slug → { name, n }: ruolo su reti SENZA VLAN
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
      // ⚠️ **Lo spazio dei prefissi di InfraNet è PIATTO, come quello delle VLAN.**
      // In NetBox lo STESSO CIDR può esistere più volte — in due VRF diversi, o
      // una volta legato a una VLAN e una volta no — e sono reti diverse. Qui la
      // chiave di un prefisso è il CIDR e basta: spingerne due dentro produceva
      // un documento che contraddice il proprio modello. A schermo comparivano
      // due righe che condividevano UNA identità — stesso tooltip, stessa
      // occupazione, e il bottone «togli» le cancellava tutte e due, perché
      // `removePrefix` filtra per chiave. Segnalato guardandolo.
      // Si fondono, come le dichiarazioni VLAN, e lo si DICE: `prefix.collapsed`.
      // Vince la riga che porta la VLAN — è l'informazione che il resto
      // dell'applicazione usa davvero, e il ripiego opposto la butterebbe.
      const kPrefix = _prefixKeyLocal(prefix.cidr);
      const gia = kPrefix ? prefissiPerChiave.get(kPrefix) : null;
      if (gia) {
        prefixCollapsed++;
        // ⚠️ La fusione NON dipende dall'ordine in cui NetBox risponde. La prima
        // versione teneva la descrizione solo dentro il ramo «la VLAN mancava»:
        // con la riga senza VLAN che arrivava per SECONDA — l'ordine vero
        // dell'archivio, misurato — la sua descrizione spariva. Un innesto che
        // funziona in un ordine solo è un innesto che passa i test e perde dati.
        if (gia.vlan == null && vid != null) gia.vlan = vid;
        for (const campo of ['description', 'status', 'vrfId', 'tenantId']) {
          if (!gia[campo] && prefix[campo]) gia[campo] = prefix[campo];
        }
      } else {
        state.ipam.prefixes.push(prefix);
        if (kPrefix) prefissiPerChiave.set(kPrefix, prefix);
      }
      if (vid == null) noVlanPrefixes.push(_str(p.prefix));
      else (perVlanPrefixes[vid] || (perVlanPrefixes[vid] = [])).push(_str(p.prefix));
      // Anche le RETI portano un ruolo, e a volte è l'unico posto dove sta: misurato
      // su un NetBox vero, «Management» è su tredici reti e su nessuna VLAN. Un
      // ruolo così non può diventare una lista di VLAN — non c'è una VLAN a cui
      // appenderlo — ma il silenzio farebbe sembrare che quel ruolo non esista.
      const pSlug = _str(p.role && (p.role.slug || p.role.name));
      if (pSlug && vid == null) {
        const e = roleOnlyOnPrefix.get(pSlug) || { name: _str(p.role.name) || pSlug, n: 0 };
        e.n++; roleOnlyOnPrefix.set(pSlug, e);
      }
    }
    // Reti senza VLAN: sono la maggioranza in un NetBox vero (misurato: 51 su 90).
    // Prima finivano in un array che non leggeva nessuno e sparivano dall'app.
    if (noVlanPrefixes.length) {
      _issue('prefix.noVlan', { n: noVlanPrefixes.length, sample: noVlanPrefixes.slice(0, 5) });
    }
    // Lo stesso CIDR dichiarato più volte in NetBox (VRF diverse, o una volta con
    // VLAN e una senza) diventa UNA riga: lo spazio dei prefissi qui è piatto.
    // Va detto per lo stesso motivo del collasso VLAN — chi conta le righe
    // dell'anteprima e quelle del documento deve trovare la differenza scritta,
    // non doverla dedurre.
    if (prefixCollapsed) {
      _issue('prefix.collapsed', {
        declared: report.counts.prefixes,
        kept: report.counts.prefixes - prefixCollapsed,
      });
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
    // ── Ruoli IPAM → le liste di VLAN dichiarate ─────────────────────────────
    // InfraNet ha quattro dichiarazioni sulle VLAN che oggi si compilano a mano e
    // che alimentano codice già scritto: `mgmtVlans` (audit sicurezza), `voiceVlans`
    // (assegnazione ai telefoni e trunk derivato), `guestVlans` (i loro apparati non
    // sono «non documentati», sono ospiti) e `nativeVlan`. NetBox le sa, ma le
    // chiama come vuole chi ha compilato l'archivio.
    //
    // La regola: il motore NON indovina. Raccoglie i ruoli, li porta all'anteprima
    // con quante VLAN toccano, e applica soltanto l'abbinamento che l'utente ha
    // scelto — una volta per ruolo, non per VLAN. Senza scelta non scrive niente:
    // una lista sbagliata è peggio di una lista vuota, perché la lista vuota si vede.
    report.vlanRoles = [...vlanRoles.values()]
      .map(e => ({ slug: e.slug, name: e.name, vids: [...e.vids].sort((a, b) => a - b), n: e.n }))
      .sort((a, b) => (b.vids.length - a.vids.length) || a.slug.localeCompare(b.slug));
    const roleMap = (sel.vlanRoleMap && typeof sel.vlanRoleMap === 'object') ? sel.vlanRoleMap : {};
    const VLAN_ROLE_TARGETS = { mgmt: 'mgmtVlans', voice: 'voiceVlans', guest: 'guestVlans' };
    const bucketOfVid = new Map();   // vid → primo bucket, per accorgersi dei doppi
    let rolesApplied = 0, vlansApplied = 0, roleConflicts = 0;
    for (const r of report.vlanRoles) {
      const target = _str(roleMap[r.slug]);
      if (!target) continue;
      if (target === 'native') {
        // `nativeVlan` è UNO SCALARE: un ruolo che tocca più VLAN non ci sta, e
        // sceglierne una a caso sarebbe un'invenzione. Stessa soglia del pannello
        // (src/app-vlan-autopoll.js): la VLAN 1 è il default e non si dichiara.
        const only = r.vids.filter(v => v > 1 && v <= 4094);
        if (only.length === 1) { state.nativeVlan = only[0]; rolesApplied++; vlansApplied++; }
        else _issue('vlanRole.nativeMany', { role: r.name, vids: r.vids.length });
        continue;
      }
      const key = VLAN_ROLE_TARGETS[target];
      if (!key) continue;
      const list = state[key] || (state[key] = []);
      let touched = 0;
      for (const vid of r.vids) {
        const prev = bucketOfVid.get(vid);
        if (prev && prev !== target) roleConflicts++;
        else bucketOfVid.set(vid, target);
        if (list.indexOf(vid) < 0) { list.push(vid); touched++; }
      }
      if (touched) { rolesApplied++; vlansApplied += touched; }
    }
    if (rolesApplied) _issue('vlanRole.applied', { n: rolesApplied, vlans: vlansApplied });
    // La stessa VLAN in due liste: legittimo nel modello (sono elenchi indipendenti)
    // ma quasi sempre è un abbinamento sbagliato — una VLAN non è insieme di
    // gestione e ospiti. Si applica e si dice, non si corregge di nascosto.
    if (roleConflicts) _issue('vlanRole.conflict', { n: roleConflicts });
    // Ruoli che NON possono diventare una lista: stanno su reti senza VLAN.
    const prefixOnly = [...roleOnlyOnPrefix.entries()].filter(([slug]) => !vlanRoles.has(slug));
    if (prefixOnly.length) {
      _issue('vlanRole.prefixOnly', {
        n: prefixOnly.length,
        nets: prefixOnly.reduce((s, [, e]) => s + e.n, 0),
        sample: prefixOnly.slice(0, 5).map(([, e]) => e.name),
      });
    }

    // Indirizzi d'interfaccia raccolti PER PORTA, nell'ordine in cui NetBox li
    // dichiara: sotto diventano `state.ports[pid].ip`, il campo che l'app mostra.
    const portAddrs = new Map();
    const orphanIfaceAddrs = [];   // indirizzi d'interfaccia senza una porta nel documento
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
      if (record.portId && state.ports[record.portId]) {
        const bare = _stripPrefix(address);
        if (bare) {
          const list = portAddrs.get(record.portId) || [];
          list.push(bare);
          portAddrs.set(record.portId, list);
        }
      } else if (ifaceId != null) {
        const bare = _stripPrefix(address);
        if (bare) orphanIfaceAddrs.push(bare);
      }
      state.ipam.addresses.push(record);
    }
    report.counts.ips = state.ipam.addresses.length;

    // ── L'indirizzo dell'interfaccia arriva SULLA PORTA ──────────────────────
    // L'indirizzo non e' dell'apparato, e' della presa: un router ne ha uno per
    // interfaccia, e InfraNet ha il campo dove metterlo (`state.ports[pid].ip`,
    // editabile nel pannello porta e gia' letto da chi conta l'occupazione e da
    // chi cerca i duplicati). L'import lo RISOLVEVA — `record.portId` sta qui
    // sopra dalla 2.8.0 — e poi lo lasciava in `state.ipam.addresses[]`, che non
    // legge nessuno: di un router importato arrivava il solo indirizzo di
    // gestione. Costava una riga, ed e' quella.
    //
    // Il campo ne tiene UNO e lo vuole IPv4 (il pannello valida cosi'): vince il
    // primo IPv4 nell'ordine di NetBox. Tutto il resto — il secondo indirizzo
    // della stessa interfaccia, un IPv6, un indirizzo su un'interfaccia che nel
    // documento non ha una porta — non si perde in silenzio: si conta e si dice.
    // `!port.ip` e' manual-first: l'import non sovrascrive mai un valore scritto.
    if (_canAddr) {
      const leftOut = [];
      for (const [pid, list] of portAddrs) {
        const port = state.ports[pid];
        const label = _str(port && port.ifName) || pid;
        for (const addr of list) {
          if (!port.ip && _cidrApi.addrFamily(addr) === 4) { port.ip = addr; continue; }
          leftOut.push(label + ': ' + addr);
        }
      }
      for (const addr of orphanIfaceAddrs) leftOut.push(addr);
      if (leftOut.length) _issue('ip.portExtra', { n: leftOut.length, sample: leftOut.slice(0, 5) });
    }

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
    // ── Le prenotazioni dell'IPAM occupano la rete ───────────────────────────
    // Un indirizzo che NetBox dichiara e non aggancia a niente non e' un apparato
    // — non ha un nome, non ha un MAC, nessuno sa di chi sia — ma e' un indirizzo
    // che NON SI PUO' ASSEGNARE. InfraNet calcolava l'occupazione dai soli
    // apparati documentati e dai lease DHCP, quindi proponeva come «prossimo IP
    // libero» roba gia' impegnata. Le prenotazioni si posano sulla RETE, non su un
    // apparato: e' il posto giusto nel modello e non inventa nessuno.
    //
    // Vince il prefisso PIU' SPECIFICO, la regola di ogni tabella di routing e la
    // stessa di `prefixForIp`: un contenitore /16 non si prende un indirizzo che
    // appartiene alla /24 dichiarata dentro di lui.
    if (_canAddr) {
      const parsed = [];
      for (const p of state.ipam.prefixes) {
        const info = _cidrApi._parseCidrInfo(p && p.cidr);
        if (info) parsed.push({ row: p, info });
      }
      const seen = new Map();          // riga prefisso → chiavi gia' prese (no doppioni)
      let placed = 0;
      const sample = [];
      for (const r of (Array.isArray(nb.ipReservations) ? nb.ipReservations : [])) {
        // Seconda cintura, dopo quella del server: qui non deve arrivare NIENTE
        // che sia agganciato a un'interfaccia. Se il filtro di NetBox e' caduto nel
        // vuoto, un indirizzo di apparato non diventa una prenotazione.
        if (!r || (r.assigned_object || r.assignedObject)) continue;
        const bare = _stripPrefix(_str(r.address));
        if (!bare) continue;
        let best = null, bestLen = -1;
        for (const p of parsed) {
          if (p.info.prefix <= bestLen || !_cidrApi._ipInCidr(bare, p.info)) continue;
          best = p.row; bestLen = p.info.prefix;
        }
        if (!best) continue;           // fuori dalle reti importate: non e' affare di questo documento
        const key = _cidrApi.addrKey ? _cidrApi.addrKey(bare) : bare;
        let keys = seen.get(best);
        if (!keys) { keys = new Set(); seen.set(best, keys); }
        if (keys.has(key)) continue;
        keys.add(key);
        (best.reserved || (best.reserved = [])).push(bare);
        placed++;
        if (sample.length < 5) sample.push(bare);
      }
      if (placed) _issue('ip.reserved', { n: placed, nets: seen.size, sample });
    }

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

    // ── L'origine del documento ──────────────────────────────────────────────
    // Una riga sola, e chiude il difetto che rendeva il ri-confronto inutile: il
    // progetto sa da quale fetta di NetBox è nato. Da qui «Confronta col progetto
    // aperto» rilegge ESATTAMENTE quella fetta invece di chiederla a chi guarda.
    // ⚠️ Non ci finisce l'indirizzo dell'istanza NetBox: il JSON di progetto si
    // esporta e si passa di mano, e l'URL interno del DCIM non deve viaggiarci.
    // ⚠️ Vuoto = nessun apparato con un sito: si scrive `sites: []`, non si tace,
    // così chi legge distingue «importato da nessun sito» da «progetto vecchio,
    // che l'origine non la registrava».
    if (Array.isArray(nb.devices) && nb.devices.length) {
      state.source = {
        dcim: {
          system: 'netbox',
          sites: [...originSites.entries()].map(([id, name]) => ({ id, name })),
        },
      };
    }

    return { state, report };
  }

  return {
    netboxToState,
    // esportati per i test puri
    _roleToInfranetType, _deviceTypeToCatalog, _catalogMatch, _ifaceSlotOrder, _frontPortOrder, _frontRearIds, _faceOf, _cableCategory,
    // `_vmIfaceMac` resta esposto col vecchio nome: era già pubblico, e vale per
    // qualunque interfaccia — il nome nuovo dice cosa fa, l'alias non rompe nulla.
    _vmGuestOs, _ifaceMac, _vmIfaceMac: _ifaceMac, _VM_HOST_TYPES,
    _autoPlaceRacks, _autoPlaceFloorDevices,
    _stripPrefix, _natCmp,
  };
}));
