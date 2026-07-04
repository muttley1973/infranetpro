'use strict';
// ============================================================
//  Classificazione device e metadati di discovery
//  (vendor PEN, classify per funzione, confidence/sources).
//  Estratto da server.js senza modifiche di logica.
// ============================================================
const path = require('path');
const { _normMac } = require('./netscan');
const { SysObjectEngine, OuiEngine, FusionScorer } = require('../engine');
const { oidTypeVotes } = require('../lib/device-signatures');

let _defaultSysObjectEngine = null;
let _defaultOuiEngine = null;
let _defaultFusionScorer = null;

function _cleanHostname(v) {
  return String(v || '').trim().replace(/\.$/, '');
}

const PEN_VENDOR = {
  9: 'Cisco',
  11: 'Hewlett Packard',
  171: 'D-Link',
  253: 'Xerox',
  318: 'APC',
  367: 'Ricoh',
  368: 'Axis',
  534: 'Eaton',
  674: 'Dell',
  890: 'Zyxel',
  1588: 'Brocade',
  1916: 'Extreme Networks',
  1248: 'Epson',
  1347: 'Kyocera',
  1602: 'Canon',
  2435: 'Brother',
  2636: 'Juniper',
  4526: 'Netgear',
  6574: 'Synology',
  6876: 'VMware',
  11863: 'TP-Link',
  12356: 'Fortinet',
  14179: 'Cisco',
  14823: 'Aruba',
  14988: 'MikroTik',
  18334: 'Konica Minolta',
  25053: 'Ruckus',
  24681: 'QNAP',
  25461: 'Palo Alto Networks',
  37049: 'Yealink',
  39165: 'Hikvision',
  41112: 'Ubiquiti',
};

function _createSysObjectEngine(options = {}) {
  return new SysObjectEngine({
    pluginDir: options.pluginDir || path.resolve(__dirname, '..', 'plugins'),
    watch: options.watch !== false,
    logger: options.logger || console,
    storage: options.storage || null,
  });
}

function _getSysObjectEngine() {
  if (!_defaultSysObjectEngine) {
    _defaultSysObjectEngine = _createSysObjectEngine();
  }
  return _defaultSysObjectEngine;
}

function _setSysObjectEngineForTests(engine) {
  if (_defaultSysObjectEngine && _defaultSysObjectEngine !== engine && typeof _defaultSysObjectEngine.close === 'function') {
    _defaultSysObjectEngine.close();
  }
  _defaultSysObjectEngine = engine || null;
}

function _createOuiEngine(options = {}) {
  return new OuiEngine({
    pluginDir: options.pluginDir || path.resolve(__dirname, '..', 'plugins', 'oui'),
    watch: options.watch !== false,
    logger: options.logger || console,
    storage: options.storage || null,
  });
}

function _getOuiEngine() {
  if (!_defaultOuiEngine) {
    _defaultOuiEngine = _createOuiEngine();
  }
  return _defaultOuiEngine;
}

function _setOuiEngineForTests(engine) {
  if (_defaultOuiEngine && _defaultOuiEngine !== engine && typeof _defaultOuiEngine.close === 'function') {
    _defaultOuiEngine.close();
  }
  _defaultOuiEngine = engine || null;
}

function _resolveOui(row, resolver) {
  const mac = String(row?.mac || '').trim();
  if (!mac) return null;
  const engine = resolver || _getOuiEngine();
  if (!engine || typeof engine.lookup !== 'function') return null;
  const resolved = engine.lookup(mac, _sysObjectContext(row));
  return resolved && resolved.status === 'found' ? resolved : null;
}

function _createFusionScorer(options = {}) {
  return new FusionScorer({
    logger: options.logger || console,
    storage: options.storage || null,
    priority: options.priority,
    decisionThreshold: options.decisionThreshold,
  });
}

function _getFusionScorer() {
  if (!_defaultFusionScorer) {
    _defaultFusionScorer = _createFusionScorer();
  }
  return _defaultFusionScorer;
}

function _setFusionScorerForTests(scorer) {
  if (_defaultFusionScorer && _defaultFusionScorer !== scorer && typeof _defaultFusionScorer.close === 'function') {
    _defaultFusionScorer.close();
  }
  _defaultFusionScorer = scorer || null;
}

function _penFromObjectId(objectId) {
  const m = String(objectId || '').trim().match(/^1\.3\.6\.1\.4\.1\.(\d+)(?:\.|$)/);
  return m ? parseInt(m[1], 10) : 0;
}

function _vendorByObjectId(objectId) {
  const pen = _penFromObjectId(objectId);
  return PEN_VENDOR[pen] || '';
}

function _sysObjectContext(row) {
  return {
    descr: row?.descr || '',
    hostname: row?.hostname || '',
    sysServices: row?.sysServices || 0,
    vendor: row?.vendor || '',
    mac: row?.mac || '',
    httpTitle: row?.httpTitle || '',
    httpsTitle: row?.httpsTitle || '',
    netbiosName: row?.netbiosName || row?.netbios?.name || '',
    netbiosGroup: row?.netbiosGroup || row?.netbios?.group || '',
    services: Array.isArray(row?.services) ? row.services : [],
    smbShares: Array.isArray(row?.smbShares) ? row.smbShares : [],
    source: 'discovery',
  };
}

function _resolveSysObject(row, resolver) {
  const objectId = String(row?.objectId || '').trim();
  if (!objectId) return null;
  const engine = resolver || _getSysObjectEngine();
  if (!engine || typeof engine.resolve !== 'function') return null;
  const resolved = engine.resolve(objectId, _sysObjectContext(row));
  return resolved && resolved.status === 'found' ? resolved : null;
}

function _resolveOsFingerprint(row, resolver) {
  const engine = resolver || _getSysObjectEngine();
  if (!engine || typeof engine.fingerprint !== 'function') return null;
  const resolved = engine.fingerprint(_sysObjectContext(row));
  return resolved && resolved.status === 'found' ? resolved : null;
}

function _decodeSysServices(value) {
  const n = parseInt(value || 0, 10) || 0;
  return {
    raw: n,
    l1: !!(n & 1),
    l2: !!(n & 2),
    l3: !!(n & 4),
    l4: !!(n & 8),
    l5: !!(n & 16),
    l6: !!(n & 32),
    l7: !!(n & 64),
  };
}

/**
 * Run the fusion scorer with the project signal sources (sysObjectID engine,
 * OS fingerprint, OUI engine, PEN vendor table).
 *
 * Returns the full structured result `{ deviceType, confidence, alternatives,
 * scores, evidences, reasons }`. The legacy `_classifyDiscoveredDevice(row)`
 * wrapper below preserves the original API by returning only the device type.
 */
function _scoreDiscoveredDevice(row, options = {}) {
  // Allow callers to pass pre-resolved engine results so we don't pay the
  // resolution cost three times per row across the discovery pipeline.
  const sysObjectInfo = options.sysObjectInfo !== undefined
    ? options.sysObjectInfo
    : _resolveSysObject(row);
  const osFingerprint = options.osFingerprint !== undefined
    ? options.osFingerprint
    : (sysObjectInfo?.os ? null : _resolveOsFingerprint(row));
  const ouiInfo = options.ouiInfo !== undefined
    ? options.ouiInfo
    : _resolveOui(row);
  const scorer = options.scorer || _getFusionScorer();
  return scorer.classify(row, {
    sysObjectInfo,
    osFingerprint,
    ouiInfo,
    vendorByObjectId: _vendorByObjectId,
    normMac: _normMac,
    decodeSysServices: _decodeSysServices,
  });
}

/**
 * Legacy entry point used elsewhere in the codebase: returns just the
 * canonical device type string.
 */
function _classifyDiscoveredDevice(row) {
  return _scoreDiscoveredDevice(row).deviceType;
}

// Legacy in-line classifier — kept intact for behavioural parity verification
// during the fusion-scorer rollout. Will be removed in a follow-up commit once
// the new engine path is confirmed stable on production traces.
function _classifyDiscoveredDeviceLegacy(row) {
  const descr = String(row?.descr || '').toLowerCase();
  const objectId = String(row?.objectId || '').trim();
  const sysObjectInfo = _resolveSysObject(row);
  const osFingerprint = sysObjectInfo?.os ? null : _resolveOsFingerprint(row);
  const osInfo = sysObjectInfo?.os || osFingerprint?.os || null;
  // OUI lookup decorates the device with vendor + (often) deviceType derived from
  // its physical MAC. Plugins specialize over the IEEE catch-all by priority.
  // Used both as a vendor source and as a scoring signal (see bump below).
  const ouiInfo = _resolveOui(row);
  const vendor = String(
    row?.vendor
    || sysObjectInfo?.vendor
    || osFingerprint?.vendor
    || ouiInfo?.vendor
    || _vendorByObjectId(objectId)
    || ''
  ).toLowerCase();
  const banner = `${row?.httpTitle || ''} ${row?.httpsTitle || ''}`.toLowerCase();
  const host = String(row?.hostname || '').toLowerCase();
  const netbiosName = String(row?.netbiosName || row?.netbios?.name || '').toLowerCase();
  const netbiosGroup = String(row?.netbiosGroup || row?.netbios?.group || '').toLowerCase();
  const shareText = (row?.smbShares || []).map(s => `${s.name || s} ${s.type || ''} ${s.comment || ''}`).join(' ').toLowerCase();
  const ip = String(row?.ip || '').trim();
  const svc = _decodeSysServices(row?.sysServices);
  const text = `${descr} ${vendor} ${banner} ${host} ${netbiosName} ${netbiosGroup} ${shareText}`.toLowerCase();
  const servicePorts = new Set((row?.services || []).map(s => parseInt(s.port, 10)).filter(Number.isFinite));
  const serviceText = (row?.services || []).map(s => `${s.service || ''} ${s.banner || ''}`).join(' ').toLowerCase();
  const fullText = `${text} ${serviceText}`.toLowerCase();
  const macPrefix = _normMac(row?.mac).substring(0, 8);
  const isLikelyGatewayIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.1$/.test(ip);
  const switchWords = /switch|gs\d{3,4}|xgs\d{3,4}|catalyst|nexus|procurve|comware|ios[_-]?l2|l2iol/.test(fullText);
  const routerWords = /router|gateway|junos|mikrotik|vyos|openwrt|edgerouter|zywall|usg|fritz|web-based configurator/.test(fullText);
  const networkVendorGateway = isLikelyGatewayIp && /zyxel|tp-link|netgear|d-link|mikrotik|ubiquiti|huawei|avm|fritz/.test(text);
  const hasSnmpSignal = !!(row?.snmpReachable || String(row?.descr || '').trim() || String(row?.objectId || '').trim());
  const score = {};
  const bump = (type, points) => {
    // 'unknown' = SysObjectEngine "matched-but-untyped" placeholder, not an app
    // type: never score it (parity with engine/fusion-scorer.js bump guard).
    if (!type || type === 'unknown' || !points) return;
    score[type] = (score[type] || 0) + points;
  };
  const oid = p => objectId.startsWith(p);

  // sysObjectID e descrizioni esplicite sono segnali forti: vengono prima delle porte TCP.
  if (sysObjectInfo?.deviceType) bump(sysObjectInfo.deviceType, Math.max(75, Math.min(98, parseInt(sysObjectInfo.confidence || 0, 10) || 85)));
  if (osFingerprint?.deviceType) bump(osFingerprint.deviceType, Math.max(35, Math.min(82, parseInt(osFingerprint.confidence || 0, 10) || 55)));
  // OUI plugin: high priority specialized plugin contributes a strong signal,
  // the IEEE catch-all (priority 0) only contributes vendor (no deviceType).
  if (ouiInfo?.deviceType) {
    const ouiPriority = parseInt(ouiInfo?.source?.priority ?? 0, 10) || 0;
    const baseConfidence = parseInt(ouiInfo?.confidence || 0, 10) || 60;
    // Specific vendor plugins (priority >= 90) score solidly; IEEE fallback
    // doesn't carry deviceType so this branch is effectively skipped for it.
    const points = ouiPriority >= 90
      ? Math.max(40, Math.min(80, baseConfidence))
      : Math.max(15, Math.min(45, baseConfidence));
    bump(ouiInfo.deviceType, points);
  }
  if (osInfo?.family === 'windows' && /server/.test(String(osInfo.name || '').toLowerCase())) bump('server', 55);
  if ((osInfo?.family === 'linux' || osInfo?.family === 'bsd' || osInfo?.family === 'vmware') && !/android/.test(fullText)) bump(osFingerprint?.deviceType || 'server', 45);
  // OID prefix votes — dalla tabella CANONICA condivisa (parità col FusionScorer).
  for (const v of oidTypeVotes(objectId)) bump(v.type, v.points);

  if (/officejet|laserjet|deskjet|pagewide|designjet|colorlaserjet|printer|printserver|\bhp.*print|print.*hp|epson|xerox|ricoh|kyocera|jetdirect|imagerunner|imageclass|ecosys|taskalfa|bizhub|lexmark|brother/.test(fullText)) bump('printer', 90);
  if (/^hp[0-9a-f]{6}$/i.test(String(row?.hostname || '').trim()) && /hewlett packard/.test(vendor)) bump('printer', 65);
  if (/reolink|hikvision|dahua|vivotek|hanwha|uniview|axis.*camera|bosch.*security|\bcctv\b|ip.?camera|\bnvr\b|\bdvr\b|onvif/.test(fullText)) bump('webcam', 90);
  if (/\bnas\b|synology|sinology|qnap|lacie|truenas|freenas|netapp|readynas|buffalo|drobo|iomega|wd\s*my\s*cloud|seagate\s*nas|asustor|terramaster|openmediavault/.test(fullText)) bump('nas', 90);
  if (/fortigate|fortinet|pfsense|opnsense|firewall|sonicwall|watchguard|checkpoint|palo\s?alto|pan-os|panorama|\basa\b|sophos.*utm|sophos.*firewall|stormshield|barracuda.*firewall/.test(fullText)) bump('firewall', 90);
  if (/\baironet\b|air-ap[0-9]|unifi.*ap|\buap-|ruckus|zoneflex|unleashed|aruba.*iap|aruba.*rap|\biap-[0-9]|\brap-[0-9]|meraki\s*mr|access point|\bap\b|omada.*ap|eap[0-9]{3,4}|wlan controller/.test(fullText)) bump('ap', 80);
  if (/\bpdu\b|power.?distribution|raritan|servertech|\bgeist\b/.test(fullText)) bump('pdu', 85);
  if (/\bups\b|\bapc\b|powerware|cyberpower|riello|liebert|vertiv/.test(fullText)) bump('ups', 85);
  if (/polycom|yealink|grandstream|\bsnom\b|\bmitel\b|\baastra\b|sip.*phone|voip.*phone/.test(fullText)) bump('voip', 80);
  if (/keil-eweb|embedded web|webrelay|modbus|plc|eaton corporation/.test(fullText) && !/\bups\b|\bpdu\b|power/.test(fullText)) bump('iot', 80);

  if (routerWords && !switchWords) bump('router', 80);
  if (networkVendorGateway && !switchWords) bump('router', 75);
  if (/mikrotik|routeros|edgerouter|edgeos|unifi gateway|\busg\b|\budm\b|dream machine|tp-link.*router|netgear.*router|d-link.*router|draytek|fritz!box|fritzbox|openwrt|vyos/.test(fullText)) bump('router', 82);
  if (switchWords || /aruba|comware|procurve|cx\s*[0-9]{4}|ex[0-9]{3,4}|qfx[0-9]{3,4}|nexus|catalyst|brocade|icx[0-9]{4}|extreme.*switch|dell.*powerconnect|dell.*n[0-9]{4}|d-link.*switch|tp-link.*switch|netgear.*switch/.test(fullText)) bump('switch', 78);
  if (/juniper.*srx|\bsrx[0-9]{3,4}\b/.test(fullText)) bump('firewall', 86);
  if (/juniper.*(?:mx|ptx|acx)|\bmx[0-9]{3,4}\b|\bptx[0-9]{3,4}\b|\bacx[0-9]{3,4}\b/.test(fullText)) bump('router', 82);
  if (macPrefix === '08:00:09' && !/officejet|laserjet|printer|desktop|win|workstation|laptop|notebook/.test(fullText)) bump('switch', 45);
  if (/\bios\b/.test(fullText) && !/switch|catalyst/.test(fullText)) bump('router', 55);
  // Hypervisor bare-metal (host) → tipo `hypervisor`; il resto (server-OS,
  // orchestrazione, lab) resta `server`. NB: niente bare 'kvm' (collide con KVM switch).
  if (/vmware\s*esx|esxi|proxmox|hyper.?v|xcp-ng|xenserver|nutanix|\bahv\b/.test(fullText)) bump('hypervisor', 90);
  if (/windows server|truenas scale|pnetlab|eve-ng|unetlab|openstack|kubernetes|k8s|docker/.test(fullText)) bump('server', 90);
  if (/ubuntu server|debian|centos|red\s?hat|fedora|suse|freebsd|rocky linux|alma linux|oracle linux/.test(fullText)) bump('server', 55);

  // ---- Elettrodomestici smart / IoT di casa (brand-agnostic, EN + IT) --------
  // Classificazione per FUNZIONE (parola chiave / piattaforma), non per vendor:
  // un elettrodomestico resta IoT a prescindere dal marchio (LG, Samsung, Haier…).
  // Segnali riconosciuti per funzione (non per brand). Calcolati una volta.
  const applianceWords = /washing ?machine|\bwasher\b|tumble ?dryer|\bdryer\b|dishwasher|refrigerator|\bfridge\b|freezer|\boven\b|microwave|cooktop|range ?hood|cooker ?hood|air ?conditioner|air ?con\b|\bhvac\b|heat ?pump|thermostat|\bboiler\b|water ?heater|dehumidifier|humidifier|air ?purifier|robot ?vacuum|\bvacuum\b|coffee ?machine|lavatrice|asciugatrice|lavastoviglie|frigo(?:rifero)?|congelatore|\bforno\b|microonde|\bcappa\b|condizionatore|climatizzatore|caldaia|scaldabagno|scaldacqua|aspirapolvere|deumidificatore|umidificatore|purificatore|macchina ?caff/;
  const smartHomePlatform = /thinq|smartthings|smart ?life|\btuya\b|tasmota|sonoff|\bshelly\b|esphome|espressif|home ?assistant|homekit|\bmatter\b|zigbee|z-?wave|miele@?home|home ?connect|\bhon\b|electrolux|whirlpool|gorenje|miele|\bbeko\b|smart ?plug|smart ?bulb|smart ?(?:light )?switch|smart ?lock|doorbell|\bsensor\b|daikin|azurewave/;
  // TV / media player guidati dall'OS o dal modello, MAI dal solo marchio: così
  // un device dello stesso brand ma di altra natura (es. lavatrice LG) NON è TV.
  const tvSignal = /lg ?webos|\bwebos\b|tizen|android ?tv|google ?tv|\btvos\b|fire ?tv|firetv|\broku\b|\bvidaa\b|netcast|\bbravia\b|\boled\b|\bqled\b|nanocell|the ?frame|smart ?tv|\btelevision\b|televisore/;
  const mediaPlayerSignal = /nvidia ?shield|\bshield\b|apple ?tv|mi ?box|fire ?stick|firestick|dlna ?renderer|miracast/;
  const isTv = tvSignal.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords;
  const isMediaPlayer = mediaPlayerSignal.test(fullText) && !isTv && !svc.l2 && !svc.l3 && !switchWords && !routerWords;
  const isAppliance = applianceWords.test(fullText);
  // Una TV vera prevale: i segnali smart-home/IoT su una TV (es. SmartThings)
  // NON la declassano a IoT.
  if (isAppliance) bump('iot', 88);
  if (smartHomePlatform.test(fullText) && !isTv) bump('iot', 80);
  if (isTv) bump('tv', 80);
  if (isMediaPlayer) bump('tv', 55); // media player puro: meno di una TV
  if (/chromecast|google ?cast/.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords) bump('iot', 75);
  if (/sony|bravia/.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords && !/camera|cctv|nvr|dvr|projector/.test(fullText)) bump('tv', 58);
  if ((macPrefix === '58:FD:B1' || /lg ?webos|lgwebostv/.test(fullText)) && !svc.l2 && !svc.l3 && !switchWords && !routerWords) bump('tv', 82);
  if (/lg|lge|lg electronics|lg innotek/.test(vendor) && isAppliance) bump('iot', 88);
  // Android/tablet/phone generico (senza segnale TV/elettrodomestico): endpoint.
  if (!svc.l2 && !svc.l3 && !switchWords && !routerWords &&
      /\bandroid\b/.test(fullText) && !isTv && !isAppliance && !smartHomePlatform.test(fullText)) bump('pc', 25);

  if (servicePorts.has(554)) bump('webcam', /rtsp|onvif|camera|reolink|hikvision|dahua|vivotek|axis/.test(fullText) ? 65 : 55);
  if (servicePorts.has(502) || servicePorts.has(1883)) bump('iot', 35);
  if ((servicePorts.has(9100) || servicePorts.has(631)) && !(switchWords || routerWords || networkVendorGateway)) bump('printer', 35);

  // SMB/RDP indicano "host Windows o file sharing", non necessariamente server.
  if ((servicePorts.has(445) || servicePorts.has(3389)) && /windows server|vmware|esxi|nas|synology|qnap|truenas|freenas|samba server/.test(fullText)) bump('server', 45);
  else if (servicePorts.has(445) || servicePorts.has(3389)) bump('pc', 35);

  if (svc.l3 && !svc.l7 && !switchWords) bump('router', 45);
  if (svc.l2 && !svc.l3 && !svc.l7) bump('switch', 45);
  if (svc.l2 && svc.l3) {
    bump('switch', 35);
    bump('router', 25);
  }
  if (svc.l4 && svc.l7 && !svc.l2 && !svc.l3 && !/printer|officejet|laserjet|camera|nas|ups|pdu|ap|iot|keil/.test(fullText)) bump('server', 30);

  if (!hasSnmpSignal && !switchWords && !routerWords) {
    if (/^desktop-|^win[0-9-]|^win-|workstation|laptop|notebook/i.test(String(row?.hostname || '').trim())) bump('pc', 55);
    if (/hewlett packard|dell|lenovo|intel|apple|parallels|microsoft|asus|acer|toshiba|pcs systemtechnik|vmware/.test(vendor) && !/officejet|laserjet|printer|aruba/.test(fullText)) bump('pc', 30);
    if (!score.tv && !score.webcam && !score.nas && !score.printer && !score.iot && (row?.alive || row?.mac)) bump('pc', 15);
  }
  if ((row?.httpTitle || row?.httpsTitle) && !score.router && !score.switch && !score.server && !score.nas && !score.printer && !score.webcam && !score.tv) bump('iot', 20);

  const priority = ['firewall', 'router', 'switch', 'nas', 'hypervisor', 'server', 'printer', 'webcam', 'ap', 'ups', 'pdu', 'voip', 'tv', 'iot', 'pc'];
  const best = Object.entries(score).sort((a, b) => (b[1] - a[1]) || (priority.indexOf(a[0]) - priority.indexOf(b[0])))[0];
  if (best && best[1] >= 30) {
    // Promozione server→hypervisor (specializzazione): stessa regola del FusionScorer
    // per mantenere la parità legacy↔fusion. Vedi engine/fusion-scorer.js.
    if (best[0] === 'server' &&
        (/vmware\s*esx|esxi|proxmox|hyper.?v|xcp-ng|xenserver|nutanix|\bahv\b/.test(fullText) ||
         oid('1.3.6.1.4.1.6876.') || sysObjectInfo?.deviceType === 'hypervisor')) {
      return 'hypervisor';
    }
    return best[0];
  }

  if (row?.httpTitle || row?.httpsTitle) return 'iot';
  return hasSnmpSignal ? 'switch' : 'pc';
}

// Brand dal nome host/mDNS quando l'OUI non aiuta (MAC randomizzato/privato dei BYOD).
// I nomi mDNS/DHCP dei device consumer sono indicativi del produttore e li annuncia il
// device stesso ("iPhone-di-Mario", "Galaxy-S23", "Pixel-7") → NON e' un'invenzione, e'
// un segnale reale. Lista conservativa (solo brand consumer/BYOD ben identificabili) per
// evitare falsi positivi. Vendor-neutral: nessun lab, nessun cliente specifico.
const _HOST_VENDOR = [
  [/\b(iphone|ipad|ipod|macbook|imac|mac-?mini|mac-?pro|airpods|apple-?watch|apple-?tv)\b/i, 'Apple'],
  [/\b(galaxy|samsung|sm-[a-z]?[0-9])\b/i, 'Samsung'],
  [/\b(pixel|nexus|chromecast|google-?home|google-?nest|nest-?(mini|hub|audio))\b/i, 'Google'],
  [/\b(huawei|honor)\b/i, 'Huawei'],
  [/\b(xiaomi|redmi|poco|mi-?(band|phone|box|tv))\b/i, 'Xiaomi'],
  [/\boneplus\b/i, 'OnePlus'],
  [/\brealme\b/i, 'Realme'],
  [/\boppo\b/i, 'Oppo'],
  [/\b(xperia|sony)\b/i, 'Sony'],
  [/\b(motorola|moto-?[ge][0-9])\b/i, 'Motorola'],
  [/\bnokia\b/i, 'Nokia'],
  [/\b(surface|lumia)\b/i, 'Microsoft'],
  [/\b(kindle|echo-?(dot|show)?|alexa|fire-?(tv|tablet)|amazon)\b/i, 'Amazon'],
];
function _vendorFromHostname(host) {
  const h = String(host || '').trim();
  if (!h) return '';
  for (const [re, brand] of _HOST_VENDOR) { if (re.test(h)) return brand; }
  return '';
}

function _buildDiscoveryMeta(row, extra = {}) {
  const sources = [];
  const evidences = [];
  const notes = [];
  const reasonCodes = [];
  const reasonSet = new Set();
  const addReason = code => {
    if (!code || reasonSet.has(code)) return;
    reasonSet.add(code);
    reasonCodes.push(code);
  };
  const addSource = (id, label, strength, detail = '') => {
    if (sources.some(s => s.id === id)) return;
    sources.push({ id, label, strength, detail });
  };
  const addEvidence = (type, value, weight, note = '') => {
    if (!value) return;
    evidences.push({ type, value, weight, note });
  };
  const hasServiceSignal = !!(
    row.snmpReachable ||
    row.httpTitle ||
    row.httpsTitle ||
    row.netbiosName ||
    row.netbiosGroup ||
    (Array.isArray(row.services) && row.services.length) ||
    (Array.isArray(row.smbShares) && row.smbShares.length)
  );
  const pingReachable = row.pingReachable === true ||
    (row.pingReachable === undefined && row.alive && !hasServiceSignal);

  if (pingReachable) {
    addSource('ping', 'PING', 'low', 'Host raggiungibile');
    addEvidence('reachability', 'icmp', 10, 'Risposta al ping');
    addReason('ping-reachable');
  }
  if (row.mac) {
    // ARP-SNMP: MAC visto nella ipNetToMediaTable di uno switch/router (host
    // off-segment), NON nella cache ARP locale — la sorgente lo dice esplicito.
    const _arpSnmp = extra.viaProtocol === 'ARP';
    addSource('arp', 'ARP', 'medium', _arpSnmp ? `Visto nell'ARP SNMP di ${extra.viaFrom || 'uno switch'}` : 'MAC rilevato in cache ARP locale');
    addEvidence('mac', row.mac, 12, _arpSnmp ? 'MAC dalla ipNetToMediaTable di un device SNMP' : 'MAC presente in ARP');
    addReason(_arpSnmp ? 'arp-snmp-seen' : 'arp-seen');
  }
  // Reuse engine results when the caller passed them in `extra` to avoid
  // re-running sysObjectID / OS fingerprint / OUI lookups during the
  // discovery pipeline (decorate -> meta -> score chain).
  const sysObjectInfo = extra.sysObjectInfo !== undefined
    ? extra.sysObjectInfo
    : _resolveSysObject(row);
  const osFingerprint = extra.osFingerprint !== undefined
    ? extra.osFingerprint
    : (sysObjectInfo?.os ? null : _resolveOsFingerprint(row));
  const osInfo = sysObjectInfo?.os || osFingerprint?.os || null;
  const ouiInfo = extra.ouiInfo !== undefined
    ? extra.ouiInfo
    : _resolveOui(row);
  let vendor = row.vendor || sysObjectInfo?.vendor || osFingerprint?.vendor || ouiInfo?.vendor || _vendorByObjectId(row.objectId);
  // Fallback BYOD: OUI assente/randomizzato (telefoni con MAC privato) → deduci il brand
  // dal nome host/mDNS che il device stesso annuncia. Peso un filo minore dell'OUI.
  let vendorFromHost = false;
  if (!vendor) {
    const hv = _vendorFromHostname(row.hostname || row.netbiosName);
    if (hv) { vendor = hv; vendorFromHost = true; }
  }
  if (vendor) {
    const vendorNote = vendorFromHost ? 'Brand dedotto dal nome host/mDNS'
      : row.vendor ? 'Vendor da MAC/OUI'
      : sysObjectInfo ? 'Vendor dedotto dal catalogo sysObjectID'
      : ouiInfo ? 'Vendor dedotto dal motore OUI plugin-based'
      : 'Vendor dedotto da sysObjectID/PEN';
    const vendorReason = vendorFromHost ? 'hostname-vendor'
      : row.vendor ? 'mac-vendor'
      : sysObjectInfo ? 'sysobject-vendor'
      : ouiInfo ? 'oui-plugin'
      : 'objectid-vendor';
    addEvidence('vendor', vendor, vendorFromHost ? 6 : 8, vendorNote);
    addReason(vendorReason);
  }
  if (ouiInfo) {
    const ouiPriority = parseInt(ouiInfo?.source?.priority ?? 0, 10) || 0;
    const isSpecific = ouiPriority >= 90;
    const label = [ouiInfo.vendor, ouiInfo.family].filter(Boolean).join(' / ');
    addSource('oui', 'OUI', isSpecific ? 'high' : 'low', label || 'Vendor da OUI MAC');
    if (ouiInfo.deviceType && isSpecific) {
      addEvidence('ouiType', ouiInfo.deviceType, 14, 'Tipo dispositivo dal plugin OUI');
      addReason('oui-plugin-type');
    }
    if (ouiInfo.isVirtual) {
      addEvidence('virtual-nic', `${ouiInfo.vendor}`, 12, 'MAC virtuale (VMware/Hyper-V/Docker/Xen/KVM)');
      addReason('virtual-nic');
    }
  }
  if (sysObjectInfo) {
    const label = [sysObjectInfo.vendor, sysObjectInfo.family, sysObjectInfo.model].filter(Boolean).join(' / ');
    addSource('sysobject', 'SYSOBJECT', 'high', label || 'Catalogo sysObjectID');
    addEvidence('sysObjectID', row.objectId, 22, label || 'Match catalogo plugin sysObjectID');
    if (sysObjectInfo.deviceType) addEvidence('sysObjectType', sysObjectInfo.deviceType, 16, 'Tipo dispositivo dal catalogo sysObjectID');
    addReason('sysobject-plugin');
  }
  if (osInfo) {
    const label = [osInfo.vendor, osInfo.name || osInfo.family].filter(Boolean).join(' / ');
    addSource('os', 'OS', sysObjectInfo?.os ? 'high' : 'medium', label || 'Sistema operativo rilevato');
    addEvidence('os', label || osInfo.family, sysObjectInfo?.os ? 16 : 10, sysObjectInfo?.os ? 'OS dedotto dal plugin sysObjectID' : 'OS dedotto da fingerprint discovery');
    addReason(sysObjectInfo?.os ? 'sysobject-os' : 'os-fingerprint');
  }
  if (row.hostname) {
    addSource('dns', 'DNS', 'medium', 'Hostname risolto');
    addEvidence('hostname', row.hostname, 12, 'Reverse DNS o SNMP sysName');
    addReason('hostname-known');
  }
  if (row.netbiosName || row.netbiosGroup) {
    addSource('netbios', 'NBT', 'medium', 'Nome NetBIOS rilevato');
    addEvidence('netbios', [row.netbiosName, row.netbiosGroup].filter(Boolean).join(' / '), 14, 'Identita Windows/NetBIOS');
    addReason('netbios-name');
  }
  if (Array.isArray(row.smbShares) && row.smbShares.length) {
    addSource('smb', 'SMB', 'medium', 'Condivisioni SMB leggibili');
    const labels = row.smbShares.slice(0, 5).map(s => s.name || String(s)).filter(Boolean).join(', ');
    addEvidence('smb-shares', labels, Math.min(20, 10 + row.smbShares.length * 3), 'Share Windows/SMB visibili');
    addReason('smb-shares');
  }
  if (row.httpTitle) {
    addSource('http', 'WEB', 'medium', 'Servizio HTTP rilevato');
    addEvidence('http-title', row.httpTitle, 8, 'Titolo o banner HTTP');
    addReason('http-banner');
  }
  if (row.httpsTitle) {
    addSource('https', 'WEB', 'medium', 'Servizio HTTPS rilevato');
    addEvidence('https-title', row.httpsTitle, 8, 'Titolo o banner HTTPS');
    addReason('https-banner');
  }
  if (row.snmpReachable) {
    addSource('snmp', 'SNMP', 'high', 'Device interrogabile via SNMP');
    addEvidence('snmp', row.descr || row.objectId || 'reachable', 35, 'Probe SNMP riuscita');
    addReason('snmp-probe');
  }
  if (Number.isFinite(parseInt(row.sysServices, 10)) && parseInt(row.sysServices, 10) > 0) {
    const svc = _decodeSysServices(row.sysServices);
    addEvidence('sysServices', String(svc.raw), 10, `Servizi dichiarati: L2=${svc.l2 ? '1' : '0'} L3=${svc.l3 ? '1' : '0'} L4=${svc.l4 ? '1' : '0'} L7=${svc.l7 ? '1' : '0'}`);
    addReason('snmp-sysservices');
  }
  if (Array.isArray(row.services) && row.services.length) {
    addSource('deep', 'DEEP', 'medium', 'Porte TCP comuni rilevate');
    const labels = row.services.slice(0, 6).map(s => `${s.port}/${s.service}`).join(', ');
    addEvidence('tcp-services', labels, Math.min(18, 6 + row.services.length * 2), 'Servizi TCP rilevati');
    addReason('tcp-service-open');
  }
  if (!row.alive && row.mac) notes.push('Host visto passivamente via ARP ma non confermato attivo');
  if (extra.viaProtocol === 'LLDP') {
    addSource('lldp', 'LLDP', 'high', 'Scoperto da un vicino via LLDP');
    addEvidence('neighbor', `${extra.viaFrom || ''} -> ${extra.viaPort || ''}`.trim(), 45, 'Vicino annunciato via LLDP');
    addReason('neighbor-lldp');
  } else if (extra.viaProtocol === 'CDP') {
    addSource('cdp', 'CDP', 'high', 'Scoperto da un vicino via CDP');
    addEvidence('neighbor', `${extra.viaFrom || ''} -> ${extra.viaPort || ''}`.trim(), 45, 'Vicino annunciato via CDP');
    addReason('neighbor-cdp');
  }

  // Classificazione necessaria prima del calcolo contestuale dello score.
  const deviceClass = _classifyDiscoveredDevice(row);

  let score = evidences.reduce((sum, e) => sum + (e.weight || 0), 0);
  if (row.snmpReachable && row.mac && row.hostname) score += 8;
  if ((row.httpTitle || row.httpsTitle) && vendor) score += 4;

  // ---- Regole contestuali (B) -----------------------------------------------
  // B1: vicino LLDP/CDP → identità quasi certa → alta confidenza
  if (extra.viaProtocol === 'LLDP' || extra.viaProtocol === 'CDP') score += 15;

  // B2: SNMP + sysServices concorda con la classe rilevata → conferma la classe
  if (row.snmpReachable && parseInt(row.sysServices || 0, 10) > 0) {
    const svcCtx = _decodeSysServices(row.sysServices);
    const classConfirmed =
      (deviceClass === 'switch'   && svcCtx.l2 && !svcCtx.l3) ||
      (deviceClass === 'router'   && svcCtx.l3 && !svcCtx.l2) ||
      (deviceClass === 'firewall' && svcCtx.l3) ||
      (deviceClass === 'server'   && svcCtx.l7);
    if (classConfirmed) {
      score += 15;
      addReason('snmp-class-confirmed');
    }
  }

  // B3: convergenza multi-sorgente — sorgenti INDIPENDENTI che concordano
  // sullo stesso host sono il segnale di confidenza più robusto (evidenze
  // indipendenti si rafforzano a vicenda, principio bayesiano — stessa
  // filosofia del GAP scoring sui link). Prima questo ruolo era mascherato
  // dal "+10 ping" generico assegnato a OGNI host alive; ora che il ping e'
  // onesto (solo ICMP confermato via pingReachable), la convergenza prende
  // il peso che merita: es. ARP(L2) + DNS(naming) + HTTP(L7) sullo stesso
  // IP = 3 conferme indipendenti che il device esiste ed e' quel tipo.
  if (sources.length >= 3) score += 10;
  if (sources.length >= 5) score += 5;
  // ---------------------------------------------------------------------------

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? 'high' : score >= 35 ? 'mid' : 'low';
  let manageability = 'observed';
  if (row.snmpReachable) manageability = 'snmp-managed';
  else if (row.httpTitle || row.httpsTitle) manageability = 'web-managed';
  else if (Array.isArray(row.services) && row.services.length) manageability = 'service-observed';
  else if (row.alive) manageability = 'reachable';

  return {
    displayName: row.hostname || row.ip,
    deviceClass,
    manageability,
    sources: sources.sort((a, b) => {
      const prio = { high: 3, medium: 2, low: 1 };
      return (prio[b.strength] || 0) - (prio[a.strength] || 0);
    }),
    evidences,
    confidence: { score, level },
    notes,
    reasonCodes,
    sysObject: sysObjectInfo,
    os: osInfo,
  };
}

function _decorateDiscoveryRow(row, extra = {}) {
  const merged = {
    ...row,
    hostname: _cleanHostname(row?.hostname),
  };
  if (!merged.hostname && merged.netbiosName) merged.hostname = _cleanHostname(merged.netbiosName);
  // Resolve upstream engines once, then thread the results through the rest of
  // the pipeline to avoid recomputing them in _scoreDiscoveredDevice and
  // _buildDiscoveryMeta. Cuts per-row engine resolutions from 9 to 3.
  const sysObjectInfo = _resolveSysObject(merged);
  const osFingerprint = sysObjectInfo?.os ? null : _resolveOsFingerprint(merged);
  const ouiInfo = _resolveOui(merged);
  if (!merged.vendor) merged.vendor = sysObjectInfo?.vendor || osFingerprint?.vendor || ouiInfo?.vendor || _vendorByObjectId(merged.objectId) || _vendorFromHostname(merged.hostname || merged.netbiosName);
  // Structured classification (deviceType + numeric confidence + ranked
  // alternatives) is the modern surface that future UI badges read.
  // `meta.confidence` (display-level) remains an aggregate of source weights
  // and is kept for backward compatibility with downstream consumers.
  const classification = _scoreDiscoveredDevice(merged, { sysObjectInfo, osFingerprint, ouiInfo });
  const meta = _buildDiscoveryMeta(merged, { ...extra, sysObjectInfo, osFingerprint, ouiInfo });
  return {
    ...merged,
    displayName: meta.displayName,
    deviceClass: meta.deviceClass,
    manageability: meta.manageability,
    sources: meta.sources,
    evidences: meta.evidences,
    confidence: meta.confidence,
    notes: meta.notes,
    reasonCodes: meta.reasonCodes,
    sysObject: meta.sysObject,
    os: meta.os,
    discovery: meta,
    classification: {
      deviceType: classification.deviceType,
      confidence: classification.confidence,
      alternatives: classification.alternatives,
      scores: classification.scores,
      reasons: classification.reasons,
    },
  };
}

module.exports = { _cleanHostname, PEN_VENDOR, _penFromObjectId, _vendorByObjectId, _decodeSysServices, _resolveSysObject, _resolveOsFingerprint, _resolveOui, _createSysObjectEngine, _setSysObjectEngineForTests, _createOuiEngine, _setOuiEngineForTests, _createFusionScorer, _setFusionScorerForTests, _scoreDiscoveredDevice, _classifyDiscoveredDevice, _classifyDiscoveredDeviceLegacy, _buildDiscoveryMeta, _decorateDiscoveryRow, _vendorFromHostname };
