(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PDU_OUTLETS = 48;
  const DEFAULT_PDU_OUTLETS = 8;
  const PDU_MANAGEMENT_MODES = ['none', 'ethernet', 'serial', 'ethernet-serial'];

  // ── Chi ha delle PRESE ──────────────────────────────────────────────────────
  // Non è il PDU a essere speciale: è l'avere prese commutate a valle. Un UPS da
  // rack ne ha quanto una barra, spesso divise in gruppi che si spengono da soli —
  // e sono le prese che documentano CHI RESTA ACCESO quando manca la corrente,
  // cioè la sola domanda per cui si compra un UPS. Il modello reggeva già (nessuna
  // riga di `pdu-layout` guarda il tipo, e la dimensione della cella si ricava da
  // `sizeU`): erano SEI cancelli `type === 'pdu'` sparsi fra import, pannelli,
  // rack e PDF a tenerlo fuori.
  //
  // ⛔ **L'ATS resta fuori, ed è una decisione, non una dimenticanza.** Il senso di
  // un ATS sono i DUE INGRESSI (feed A/B): dargli le prese senza documentare quelli
  // significherebbe raccontare la metà che conta meno, lasciando intendere che la
  // ridondanza sia catturata. Entra quando entra la catena di alimentazione.
  //
  // ⚠️ Definizione UNICA: chi decide se mostrare, importare o stampare delle prese
  // chiede QUI. Sei copie di `type === 'pdu'` erano già la trappola «definizioni
  // duplicate» in attesa di divergere.
  const OUTLET_DEVICE_TYPES = ['pdu', 'ups'];

  function hasPowerOutlets(nodeOrType) {
    const type = (nodeOrType && typeof nodeOrType === 'object') ? nodeOrType.type : nodeOrType;
    return OUTLET_DEVICE_TYPES.indexOf(String(type == null ? '' : type)) >= 0;
  }

  // Il RENDER è un'altra domanda. Una barra si disegna sempre a prese — è tutto
  // quello che è, e senza un elenco ne mostra otto per convenzione. Un UPS no: chi
  // ne ha già documentato uno a mano ha davanti un frontale con la sua porta, e
  // sostituirglielo con una griglia di otto prese inventate sarebbe una riscrittura
  // del suo documento fatta da un aggiornamento (manual-first). Quindi l'UPS passa
  // alla griglia solo quando le prese ci sono DAVVERO — importate o scritte da lui.
  function rendersOutletGrid(node) {
    const n = node && typeof node === 'object' ? node : {};
    if (!hasPowerOutlets(n.type)) return false;
    if (n.type === 'pdu') return true;
    const list = Array.isArray(n.powerOutlets) ? n.powerOutlets
      : (n.spec && Array.isArray(n.spec.powerOutlets)) ? n.spec.powerOutlets : [];
    if (list.length) return true;
    return Number.parseInt(nodeField(n, 'pduOutletCount'), 10) > 0;
  }

  function nodeField(node, key) {
    if (!node || typeof node !== 'object') return undefined;
    if (node[key] !== undefined) return node[key];
    const spec = node.spec;
    return spec && typeof spec === 'object' ? spec[key] : undefined;
  }

  function normalizePduManagementMode(value, fallback = 'none') {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    const aliases = {
      network: 'ethernet',
      'ethernet-ip': 'ethernet',
      console: 'serial',
      'serial-console': 'serial',
      'ethernet+serial': 'ethernet-serial',
      'ethernet-seriale': 'ethernet-serial',
    };
    const normalized = aliases[raw] || raw;
    if (PDU_MANAGEMENT_MODES.includes(normalized)) return normalized;
    return PDU_MANAGEMENT_MODES.includes(fallback) ? fallback : 'none';
  }

  function pduManagementMode(node) {
    const explicit = nodeField(node, 'pduMgmtMode');
    if (explicit !== undefined && explicit !== null && explicit !== '') {
      return normalizePduManagementMode(explicit);
    }
    const frontPanel = node && typeof node.frontPanel === 'object' ? node.frontPanel : {};
    if (Number.parseInt(frontPanel.mgmtCount, 10) > 0) return 'ethernet';
    const integration = node && node.integration && typeof node.integration === 'object' ? node.integration : {};
    if (String(node && node.ip || '').trim() || String(integration.driver || '').toLowerCase().startsWith('snmp')) {
      return 'ethernet';
    }
    return 'none';
  }

  function normalizePduPortCount(value, max = 4, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    const fallbackValue = Number.parseInt(fallback, 10);
    const count = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallbackValue) ? fallbackValue : 0);
    return Math.min(Math.max(0, Number.parseInt(max, 10) || 4), Math.max(0, count));
  }

  function normalizePduOutletCount(value, fallback = DEFAULT_PDU_OUTLETS) {
    const parsed = Number.parseInt(value, 10);
    const fallbackValue = Number.parseInt(fallback, 10);
    const count = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallbackValue) ? fallbackValue : DEFAULT_PDU_OUTLETS);
    return Math.min(MAX_PDU_OUTLETS, Math.max(1, count));
  }

  function pduOutletGrid(value) {
    const count = normalizePduOutletCount(value);
    const columns = Math.min(12, count);
    return { count, columns, rows: Math.ceil(count / columns) };
  }

  function pduOutletCellSize(value, sizeU = 1) {
    const count = normalizePduOutletCount(value);
    const base = count <= 4 ? { width: 22, height: 13, fontSize: 7 }
      : count <= 8 ? { width: 18, height: 11, fontSize: 6 }
      : count <= 12 ? { width: 15, height: 9, fontSize: 5 }
      : count <= 18 ? { width: 13, height: 8, fontSize: 5 }
      : count <= 32 ? { width: 10, height: 5, fontSize: 3 }
      : { width: 9, height: 4, fontSize: 3 };
    const units = Math.min(6, Math.max(1, Number.parseInt(sizeU, 10) || 1));
    const widthScale = 1 + (units - 1) * 0.12;
    const heightScale = 1 + (units - 1) * 0.8;
    const fontScale = 1 + (units - 1) * 0.35;
    return {
      width: Math.round(base.width * widthScale),
      height: Math.round(base.height * heightScale),
      fontSize: Math.max(3, Math.round(base.fontSize * fontScale)),
    };
  }

  function pduManagementPortCount(node, fallback = 1) {
    const n = node && typeof node === 'object' ? node : {};
    const frontPanel = n.frontPanel && typeof n.frontPanel === 'object' ? n.frontPanel : {};
    if (!['ethernet', 'ethernet-serial'].includes(pduManagementMode(n))) return 0;
    // The mode is ethernet/ethernet-serial (guarded above), so there is at least
    // ONE cable-able Ethernet management port — including in the console+ethernet
    // (ethernet-serial) mode. Every sub-signal below is therefore floored at 1: a
    // stale or zero port hint must never hide the Ethernet port the declared mode
    // guarantees. Three such hints exist:
    //   • an explicit pduEthernetPorts field driven out of range (e.g. 0);
    //   • a catalog front-panel layout carrying frontPanel.mgmtCount === 0;
    //   • a PDU imported with no data ports (n.ports === 0, a finite value) —
    //     n.ports counts data/front ports, not management.
    const explicit = nodeField(n, 'pduEthernetPorts');
    if (explicit !== undefined && explicit !== null && explicit !== '') {
      return Math.max(1, normalizePduPortCount(explicit, 2, 1));
    }
    // Only honour the legacy front-panel management count when it is POSITIVE;
    // a zero (or missing) mgmtCount falls through to the mode-guaranteed minimum
    // instead of collapsing the cable-able Ethernet port to nothing.
    const legacy = normalizePduPortCount(frontPanel.mgmtCount, 4, 0);
    if (legacy > 0) return legacy;
    const ports = Number.parseInt(n.ports, 10);
    const base = Number.isFinite(ports) && ports > 0 ? ports : Number.parseInt(fallback, 10);
    return normalizePduPortCount(Number.isFinite(base) && base > 0 ? base : 1, 2, 1);
  }

  function pduSerialPortCount(node) {
    const mode = pduManagementMode(node);
    if (!['serial', 'ethernet-serial'].includes(mode)) return 0;
    const explicit = nodeField(node, 'pduSerialPorts');
    if (explicit !== undefined && explicit !== null && explicit !== '') return normalizePduPortCount(explicit, 2, 0);
    return ['serial', 'ethernet-serial'].includes(mode) ? 1 : 0;
  }

  function pduAuxiliaryPortCount(node, field, max = 4) {
    return normalizePduPortCount(nodeField(node, field), max, 0);
  }

  function statusText(value) {
    if (value && typeof value === 'object') {
      return String(value.value || value.label || value.name || '').trim().toLowerCase();
    }
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function outletStatusText(outlet) {
    if (!outlet || typeof outlet !== 'object') return '';
    return statusText(outlet.rawStatus || outlet.status || outlet.state || outlet.powerState);
  }

  function outletIsConnected(outlet) {
    if (!outlet || typeof outlet !== 'object') return false;
    if (outlet.connected === true || outlet.isConnected === true || outlet.mark_connected === true || outlet.markConnected === true) return true;
    if (outlet.cable || outlet.cable_id || outlet.cableId) return true;
    if (Array.isArray(outlet.connectedEndpoints) && outlet.connectedEndpoints.length > 0) return true;
    if (outlet.link_peer || outlet.cable_peer || outlet.connected_endpoint || outlet.connectedEndpoint) return true;
    const override = outlet.connectionOvr && typeof outlet.connectionOvr === 'object' ? outlet.connectionOvr : {};
    if (override.deviceId || override.deviceName || override.portName) return true;
    return ['active', 'planned', 'decommissioning'].includes(statusText(outlet.cableStatus || outlet.cable_status));
  }

  function normalizePduOutletStatus(outlet) {
    const raw = outletStatusText(outlet);
    if (/fault|fail|error|broken|alarm/.test(raw)) return 'fault';
    // "inactive" listed here (before the "active" test) so the substring "active"
    // inside "inactive" can't misclassify a manual inactive override as active.
    if (/disabled|disable|inactive|off|decommissioned/.test(raw)) return 'inactive';
    if (/enabled|enable|active|on|up|operational|ok|ready/.test(raw)) return 'active';
    if (outletIsConnected(outlet)) return 'active';
    return 'inactive';
  }

  function pduOutletStatusState(outlet) {
    const manual = outlet && typeof outlet === 'object' && outlet.statusOvr != null && String(outlet.statusOvr).trim() !== ''
      ? outlet.statusOvr
      : null;
    // Manual-first: a declared override is already one of the canonical states
    // (active/inactive/fault) and is authoritative — it must NOT be re-run through
    // the fuzzy NetBox-string matcher, which matches "active" as a substring of
    // "inactive" and would flip a hand-set "inactive" back to "active".
    const manualCanon = manual != null ? String(manual).trim().toLowerCase() : null;
    if (manualCanon === 'active' || manualCanon === 'inactive' || manualCanon === 'fault') return manualCanon;
    const raw = outlet && typeof outlet === 'object'
      ? (manual ?? outlet.rawStatus ?? outlet.status ?? outlet.state ?? outlet.powerState)
      : '';
    if (raw === null || raw === undefined || String(raw).trim() === '') return outletIsConnected(outlet) ? 'active' : 'inactive';
    return normalizePduOutletStatus({ ...outlet, rawStatus: manual ? '' : outlet.rawStatus, status: raw });
  }

  function pduOutletConnection(outlet) {
    const value = outlet && typeof outlet === 'object' ? outlet : {};
    const peer = value.connectedTo || value.peer || value.cablePeer || value.connectedEndpoint || null;
    const device = peer && typeof peer === 'object'
      ? (peer.device || peer.connectedDevice || null) : null;
    const importedDeviceId = value.connectedDeviceId || (peer && typeof peer === 'object'
      ? (peer.deviceId || peer.connectedDeviceId || (device && typeof device === 'object' ? device.id : ''))
      : '');
    const importedDeviceName = value.connectedDeviceName || (peer && typeof peer === 'object' ? peer.deviceName : '')
      || (typeof value.connectedDevice === 'string' ? value.connectedDevice : '')
      || (device && typeof device === 'object' ? (device.name || device.label || device.display || '') : (device || ''));
    const importedPortName = value.connectedPortName || value.connectedPort || value.connectedOutlet
      || (peer && typeof peer === 'object' ? (peer.portName || peer.name || peer.label || peer.display || '') : (peer || ''))
      || value.powerPort || value.power_port || '';
    const override = value.connectionOvr && typeof value.connectionOvr === 'object' ? value.connectionOvr : {};
    const hasDeviceNameOverride = Object.prototype.hasOwnProperty.call(override, 'deviceName');
    const hasDeviceIdOverride = Object.prototype.hasOwnProperty.call(override, 'deviceId');
    const hasDeviceOverride = hasDeviceNameOverride || hasDeviceIdOverride;
    const hasPortOverride = Object.prototype.hasOwnProperty.call(override, 'portName');
    const deviceName = hasDeviceNameOverride ? String(override.deviceName ?? '') : String(importedDeviceName || '');
    const portName = hasPortOverride ? String(override.portName ?? '') : String(importedPortName || '');
    const deviceId = hasDeviceIdOverride ? String(override.deviceId ?? '') : String(importedDeviceId || '');
    const imported = !!(importedDeviceId || importedDeviceName || importedPortName || value.connected || peer);
    return {
      deviceName,
      deviceId,
      portName,
      importedDeviceId: String(importedDeviceId || ''),
      importedDeviceName: String(importedDeviceName || ''),
      importedPortName: String(importedPortName || ''),
      connected: !!(deviceName || portName || imported),
      imported,
      manual: hasDeviceOverride || hasPortOverride,
      manualDevice: hasDeviceOverride,
      manualPort: hasPortOverride,
    };
  }

  function pduRackDeviceCandidates(state, types, excludeId) {
    const value = state && typeof state === 'object' ? state : {};
    const definitions = types && typeof types === 'object' ? types : {};
    const racks = new Map((Array.isArray(value.racks) ? value.racks : [])
      .filter(rack => rack && rack.id != null)
      .map(rack => [String(rack.id), rack]));
    return (Array.isArray(value.nodes) ? value.nodes : [])
      .filter(node => node && node.id != null
        && String(node.id) !== String(excludeId || '')
        && definitions[node.type] && definitions[node.type].isRack
        && node.rackId != null && racks.has(String(node.rackId)))
      .map(node => ({
        id: String(node.id),
        name: String(node.name || node.hostname || node.id),
        rackId: String(node.rackId),
        rackName: String(racks.get(String(node.rackId)).name || node.rackId),
        rackU: Number.isFinite(Number(node.rackU)) ? Number(node.rackU) : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.rackName.localeCompare(b.rackName, undefined, { sensitivity: 'base' })
        || a.rackU - b.rackU
        || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.id.localeCompare(b.id));
  }

  // nodeField esportato: i campi device vivono in `node.spec[key]` (con fallback al
  // livello nodo per i progetti vecchi). Chi legge un campo PDU fuori da qui — es. il
  // report — deve usare LO STESSO getter, non `node[key]`: due letture diverse dello
  // stesso campo sono la trappola ricorrente «definizioni duplicate».
  return { MAX_PDU_OUTLETS, DEFAULT_PDU_OUTLETS, PDU_MANAGEMENT_MODES, OUTLET_DEVICE_TYPES, hasPowerOutlets, rendersOutletGrid, nodeField, normalizePduOutletCount, normalizePduManagementMode, normalizePduPortCount, pduManagementMode, pduOutletGrid, pduOutletCellSize, pduManagementPortCount, pduSerialPortCount, pduAuxiliaryPortCount, outletStatusText, normalizePduOutletStatus, pduOutletStatusState, pduOutletConnection, pduRackDeviceCandidates };
});
