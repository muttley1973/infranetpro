'use strict';

/**
 * Fusion Scoring Engine.
 *
 * Combines signals from sysObjectID, OS fingerprint, OUI lookup, sysDescr text,
 * vendor PEN, sysServices, TCP ports, hostname patterns, NetBIOS/SMB and
 * vendor regexes into a single device-type decision with confidence.
 *
 * Extracted from `server/classify.js` so the heuristic is testable as a unit,
 * exposes a stable `confidence` score and a list of `alternatives`, and can be
 * tuned via constructor options without editing the call sites.
 *
 *   const scorer = new FusionScorer();
 *   const result = scorer.classify(row, {
 *     sysObjectInfo, osFingerprint, ouiInfo, vendorByObjectId, normMac, decodeSysServices
 *   });
 *   // → { deviceType, confidence, alternatives, scores, evidences, reasons }
 *
 * The engine is stateless across `classify()` calls; storage (SQLite seam) is
 * accepted for forward-compat with future learned weights / per-tenant rule
 * overrides, but is intentionally not used today.
 */

// Tie-break order when two device types have identical raw scores: the one
// listed first wins. Matches the legacy `_classifyDiscoveredDevice` priority.
const DEFAULT_PRIORITY = [
  'firewall', 'router', 'switch', 'nas', 'hypervisor', 'server', 'printer',
  'webcam', 'ap', 'ups', 'pdu', 'voip', 'tv', 'iot', 'pc',
];

// Minimum raw score required to commit to the best device-type guess.
// Below this we fall back to httpTitle → iot or hasSnmpSignal → switch / pc.
const DEFAULT_DECISION_THRESHOLD = 30;

// ---------- Pre-compiled regex tables ---------------------------------------
// Kept as module-level constants so each `classify()` call doesn't recompile.

const SWITCH_WORDS_RE = /switch|gs\d{3,4}|xgs\d{3,4}|catalyst|nexus|procurve|comware|ios[_-]?l2|l2iol/;
const ROUTER_WORDS_RE = /router|gateway|junos|mikrotik|vyos|openwrt|edgerouter|zywall|usg|fritz|web-based configurator/;
const NET_VENDOR_GW_RE = /zyxel|tp-link|netgear|d-link|mikrotik|ubiquiti|huawei|avm|fritz/;
const PRINTER_RE = /officejet|laserjet|deskjet|pagewide|designjet|colorlaserjet|printer|printserver|\bhp.*print|print.*hp|epson|xerox|ricoh|kyocera|jetdirect|imagerunner|imageclass|ecosys|taskalfa|bizhub|lexmark|brother/;
const WEBCAM_RE = /reolink|hikvision|dahua|vivotek|hanwha|uniview|axis.*camera|bosch.*security|\bcctv\b|ip.?camera|\bnvr\b|\bdvr\b|onvif/;
const NAS_RE = /\bnas\b|synology|sinology|qnap|lacie|truenas|freenas|netapp|readynas|buffalo|drobo|iomega|wd\s*my\s*cloud|seagate\s*nas|asustor|terramaster|openmediavault/;
const FIREWALL_RE = /fortigate|fortinet|pfsense|opnsense|firewall|sonicwall|watchguard|checkpoint|palo\s?alto|pan-os|panorama|\basa\b|sophos.*utm|sophos.*firewall|stormshield|barracuda.*firewall/;
const AP_RE = /\baironet\b|air-ap[0-9]|unifi.*ap|\buap-|ruckus|zoneflex|unleashed|aruba.*iap|aruba.*rap|\biap-[0-9]|\brap-[0-9]|meraki\s*mr|access point|\bap\b|omada.*ap|eap[0-9]{3,4}|wlan controller/;
const PDU_RE = /\bpdu\b|power.?distribution|raritan|servertech|\bgeist\b/;
const UPS_RE = /\bups\b|\bapc\b|powerware|cyberpower|riello|liebert|vertiv/;
const VOIP_RE = /polycom|yealink|grandstream|\bsnom\b|\bmitel\b|\baastra\b|sip.*phone|voip.*phone/;
const IOT_EMBED_RE = /keil-eweb|embedded web|webrelay|modbus|plc|eaton corporation/;
const ROUTER_VENDOR_RE = /mikrotik|routeros|edgerouter|edgeos|unifi gateway|\busg\b|\budm\b|dream machine|tp-link.*router|netgear.*router|d-link.*router|draytek|fritz!box|fritzbox|openwrt|vyos/;
const SWITCH_VENDOR_RE = /aruba|comware|procurve|cx\s*[0-9]{4}|ex[0-9]{3,4}|qfx[0-9]{3,4}|nexus|catalyst|brocade|icx[0-9]{4}|extreme.*switch|dell.*powerconnect|dell.*n[0-9]{4}|d-link.*switch|tp-link.*switch|netgear.*switch/;
const JUNIPER_FIREWALL_RE = /juniper.*srx|\bsrx[0-9]{3,4}\b/;
const JUNIPER_ROUTER_RE = /juniper.*(?:mx|ptx|acx)|\bmx[0-9]{3,4}\b|\bptx[0-9]{3,4}\b|\bacx[0-9]{3,4}\b/;
// Hypervisor BARE-METAL (l'host, non la VM): mappa al nuovo tipo `hypervisor`.
// NB: niente bare 'kvm' qui — collide col tipo `kvm` (KVM switch keyboard/video).
const HYPERVISOR_RE = /vmware\s*esx|esxi|proxmox|hyper.?v|xcp-ng|xenserver|nutanix|\bahv\b/;
// Altri host di virtualizzazione/orchestrazione e server-OS → restano `server`.
const SERVER_VIRT_RE = /windows server|truenas scale|pnetlab|eve-ng|unetlab|openstack|kubernetes|k8s|docker/;
const SERVER_LINUX_RE = /ubuntu server|debian|centos|red\s?hat|fedora|suse|freebsd|rocky linux|alma linux|oracle linux/;

const APPLIANCE_RE = /washing ?machine|\bwasher\b|tumble ?dryer|\bdryer\b|dishwasher|refrigerator|\bfridge\b|freezer|\boven\b|microwave|cooktop|range ?hood|cooker ?hood|air ?conditioner|air ?con\b|\bhvac\b|heat ?pump|thermostat|\bboiler\b|water ?heater|dehumidifier|humidifier|air ?purifier|robot ?vacuum|\bvacuum\b|coffee ?machine|lavatrice|asciugatrice|lavastoviglie|frigo(?:rifero)?|congelatore|\bforno\b|microonde|\bcappa\b|condizionatore|climatizzatore|caldaia|scaldabagno|scaldacqua|aspirapolvere|deumidificatore|umidificatore|purificatore|macchina ?caff/;
const SMART_HOME_RE = /thinq|smartthings|smart ?life|\btuya\b|tasmota|sonoff|\bshelly\b|esphome|espressif|home ?assistant|homekit|\bmatter\b|zigbee|z-?wave|miele@?home|home ?connect|\bhon\b|electrolux|whirlpool|gorenje|miele|\bbeko\b|smart ?plug|smart ?bulb|smart ?(?:light )?switch|smart ?lock|doorbell|\bsensor\b|daikin|azurewave/;
const TV_SIGNAL_RE = /lg ?webos|\bwebos\b|tizen|android ?tv|google ?tv|\btvos\b|fire ?tv|firetv|\broku\b|\bvidaa\b|netcast|\bbravia\b|\boled\b|\bqled\b|nanocell|the ?frame|smart ?tv|\btelevision\b|televisore/;
const MEDIA_PLAYER_RE = /nvidia ?shield|\bshield\b|apple ?tv|mi ?box|fire ?stick|firestick|dlna ?renderer|miracast/;
const PC_OS_RE = /vmware\s*esx|esxi|proxmox|hyper.?v|windows server|nas|synology|qnap|truenas|freenas|samba server/;
const PC_HOSTNAME_RE = /^desktop-|^win[0-9-]|^win-|workstation|laptop|notebook/i;
const PC_VENDOR_RE = /hewlett packard|dell|lenovo|intel|apple|parallels|microsoft|asus|acer|toshiba|pcs systemtechnik|vmware/;

// ---------- Helpers ----------------------------------------------------------

function _safeIntMax(value, min, max, fallback) {
  const n = parseInt(value ?? 0, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _defaultNormMac(mac) {
  // Minimal MAC normalization used only if the caller doesn't pass `normMac`.
  return String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '').replace(/(.{2})(?=.)/g, '$1:').slice(0, 17);
}

function _defaultDecodeSysServices(value) {
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

// ---------- FusionScorer -----------------------------------------------------

class FusionScorer {
  /**
   * @param {Object} options
   * @param {Console=} options.logger
   * @param {Object=}  options.storage   Future SQLite seam (unused today).
   * @param {string[]=} options.priority Override tie-break priority list.
   * @param {number=}  options.decisionThreshold Minimum raw score to commit.
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.storage = options.storage || null;
    this.priority = Array.isArray(options.priority) && options.priority.length
      ? options.priority.slice()
      : DEFAULT_PRIORITY.slice();
    this.decisionThreshold = Number.isFinite(options.decisionThreshold)
      ? options.decisionThreshold
      : DEFAULT_DECISION_THRESHOLD;
  }

  close() { /* nothing to release today, kept for API symmetry */ }

  /**
   * Classify a discovery row.
   * @param {Object} row             Raw discovery row
   * @param {Object} ctx             Pre-resolved engines
   * @param {Object=} ctx.sysObjectInfo  Result of SysObjectEngine.resolve
   * @param {Object=} ctx.osFingerprint  Result of SysObjectEngine.fingerprint
   * @param {Object=} ctx.ouiInfo        Result of OuiEngine.lookup
   * @param {Function=} ctx.vendorByObjectId  (oid)=>vendor (fallback to PEN)
   * @param {Function=} ctx.normMac           (mac)=>normalized
   * @param {Function=} ctx.decodeSysServices (value)=>{raw,l1..l7}
   * @returns {{deviceType:string,confidence:number,alternatives:Array,scores:Object,evidences:Array,reasons:string[]}}
   */
  classify(row, ctx = {}) {
    const sysObjectInfo = ctx.sysObjectInfo || null;
    const osFingerprint = ctx.osFingerprint || null;
    const osInfo        = sysObjectInfo?.os || osFingerprint?.os || null;
    const ouiInfo       = ctx.ouiInfo || null;
    const vendorByObjectId = typeof ctx.vendorByObjectId === 'function' ? ctx.vendorByObjectId : () => '';
    const normMac       = typeof ctx.normMac === 'function' ? ctx.normMac : _defaultNormMac;
    const decodeSysServices = typeof ctx.decodeSysServices === 'function' ? ctx.decodeSysServices : _defaultDecodeSysServices;

    // ---------- Signal collection ----------
    const descr = String(row?.descr || '').toLowerCase();
    const objectId = String(row?.objectId || '').trim();
    const vendor = String(
      row?.vendor || sysObjectInfo?.vendor || osFingerprint?.vendor || ouiInfo?.vendor || vendorByObjectId(objectId) || ''
    ).toLowerCase();
    const banner = `${row?.httpTitle || ''} ${row?.httpsTitle || ''}`.toLowerCase();
    const host = String(row?.hostname || '').toLowerCase();
    const netbiosName = String(row?.netbiosName || row?.netbios?.name || '').toLowerCase();
    const netbiosGroup = String(row?.netbiosGroup || row?.netbios?.group || '').toLowerCase();
    const shareText = (row?.smbShares || []).map(s => `${s.name || s} ${s.type || ''} ${s.comment || ''}`).join(' ').toLowerCase();
    const ip = String(row?.ip || '').trim();
    const svc = decodeSysServices(row?.sysServices);
    const text = `${descr} ${vendor} ${banner} ${host} ${netbiosName} ${netbiosGroup} ${shareText}`.toLowerCase();
    const servicePorts = new Set((row?.services || []).map(s => parseInt(s.port, 10)).filter(Number.isFinite));
    const serviceText = (row?.services || []).map(s => `${s.service || ''} ${s.banner || ''}`).join(' ').toLowerCase();
    const fullText = `${text} ${serviceText}`.toLowerCase();
    const macPrefix = normMac(row?.mac).substring(0, 8);
    const isLikelyGatewayIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.1$/.test(ip);
    const switchWords = SWITCH_WORDS_RE.test(fullText);
    const routerWords = ROUTER_WORDS_RE.test(fullText);
    const networkVendorGateway = isLikelyGatewayIp && NET_VENDOR_GW_RE.test(text);
    const hasSnmpSignal = !!(row?.snmpReachable || String(row?.descr || '').trim() || String(row?.objectId || '').trim());

    // ---------- Scoring ----------
    const score = {};
    const evidences = [];
    const reasons = new Set();
    const oid = p => objectId.startsWith(p);

    const bump = (type, points, reasonId, evidence) => {
      if (!type || !points) return;
      score[type] = (score[type] || 0) + points;
      if (reasonId) reasons.add(reasonId);
      if (evidence) evidences.push({ ...evidence, type, points });
    };

    // sysObjectID + OS fingerprint + OUI plugin → strong upstream signals
    if (sysObjectInfo?.deviceType) {
      const conf = _safeIntMax(sysObjectInfo.confidence, 75, 98, 85);
      bump(sysObjectInfo.deviceType, conf, 'sysobject-plugin',
        { source: 'sysobject', label: [sysObjectInfo.vendor, sysObjectInfo.family].filter(Boolean).join(' / ') });
    }
    if (osFingerprint?.deviceType) {
      const conf = _safeIntMax(osFingerprint.confidence, 35, 82, 55);
      bump(osFingerprint.deviceType, conf, 'os-fingerprint',
        { source: 'os-fingerprint', label: [osFingerprint.vendor, osFingerprint.family].filter(Boolean).join(' / ') });
    }
    if (ouiInfo?.deviceType) {
      const ouiPriority = parseInt(ouiInfo?.source?.priority ?? 0, 10) || 0;
      const baseConfidence = parseInt(ouiInfo?.confidence || 0, 10) || 60;
      const points = ouiPriority >= 90
        ? Math.max(40, Math.min(80, baseConfidence))
        : Math.max(15, Math.min(45, baseConfidence));
      bump(ouiInfo.deviceType, points, 'oui-plugin-type',
        { source: 'oui', label: [ouiInfo.vendor, ouiInfo.family].filter(Boolean).join(' / '), priority: ouiPriority });
    }
    if (osInfo?.family === 'windows' && /server/.test(String(osInfo.name || '').toLowerCase())) {
      bump('server', 55, 'os-windows-server', { source: 'os', label: 'Windows Server' });
    }
    if ((osInfo?.family === 'linux' || osInfo?.family === 'bsd' || osInfo?.family === 'vmware') && !/android/.test(fullText)) {
      bump(osFingerprint?.deviceType || 'server', 45, 'os-unix-server',
        { source: 'os', label: osInfo?.name || osInfo?.family });
    }

    // OID prefix votes (kept verbatim from legacy classifier)
    if (oid('1.3.6.1.4.1.11.2.3.9') || oid('1.3.6.1.4.1.1248.') || oid('1.3.6.1.4.1.1602.') ||
        oid('1.3.6.1.4.1.367.') || oid('1.3.6.1.4.1.253.') || oid('1.3.6.1.4.1.1347.') ||
        oid('1.3.6.1.4.1.2435.') || oid('1.3.6.1.4.1.18334.')) bump('printer', 95, 'oid-printer');
    if (oid('1.3.6.1.4.1.39165.') || oid('1.3.6.1.4.1.368.'))                                               bump('webcam', 95, 'oid-webcam');
    if (oid('1.3.6.1.4.1.6574.') || oid('1.3.6.1.4.1.24681.'))                                               bump('nas', 95, 'oid-nas');
    if (oid('1.3.6.1.4.1.41112.1.4.') || oid('1.3.6.1.4.1.14179.') || oid('1.3.6.1.4.1.25053.'))            bump('ap', 95, 'oid-ap');
    if (oid('1.3.6.1.4.1.13742.') || oid('1.3.6.1.4.1.318.1.1.12.'))                                        bump('pdu', 95, 'oid-pdu');
    if (oid('1.3.6.1.4.1.318.') || oid('1.3.6.1.4.1.534.'))                                                 bump('ups', 85, 'oid-ups');
    if (oid('1.3.6.1.4.1.12356.') || oid('1.3.6.1.4.1.25461.'))                                             bump('firewall', 95, 'oid-firewall');
    if (oid('1.3.6.1.4.1.14988.') || oid('1.3.6.1.4.1.11863.') || oid('1.3.6.1.4.1.4526.') || oid('1.3.6.1.4.1.171.')) bump('router', 60, 'oid-router');
    if (oid('1.3.6.1.4.1.14823.') || oid('1.3.6.1.4.1.1916.') || oid('1.3.6.1.4.1.1588.'))                  bump('switch', 70, 'oid-switch');
    if (oid('1.3.6.1.4.1.6876.'))                                                                          bump('hypervisor', 90, 'oid-hypervisor-vmware');

    // Vendor / model regex votes from descr/banner/host
    if (PRINTER_RE.test(fullText))   bump('printer', 90, 'regex-printer');
    if (/^hp[0-9a-f]{6}$/i.test(String(row?.hostname || '').trim()) && /hewlett packard/.test(vendor))
                                     bump('printer', 65, 'hostname-hp-printer');
    if (WEBCAM_RE.test(fullText))    bump('webcam', 90, 'regex-webcam');
    if (NAS_RE.test(fullText))       bump('nas', 90, 'regex-nas');
    if (FIREWALL_RE.test(fullText))  bump('firewall', 90, 'regex-firewall');
    if (AP_RE.test(fullText))        bump('ap', 80, 'regex-ap');
    if (PDU_RE.test(fullText))       bump('pdu', 85, 'regex-pdu');
    if (UPS_RE.test(fullText))       bump('ups', 85, 'regex-ups');
    if (VOIP_RE.test(fullText))      bump('voip', 80, 'regex-voip');
    if (IOT_EMBED_RE.test(fullText) && !/\bups\b|\bpdu\b|power/.test(fullText)) bump('iot', 80, 'regex-iot-embedded');

    if (routerWords && !switchWords)            bump('router', 80, 'word-router');
    if (networkVendorGateway && !switchWords)    bump('router', 75, 'gateway-ip-vendor');
    if (ROUTER_VENDOR_RE.test(fullText))         bump('router', 82, 'regex-router-vendor');
    if (switchWords || SWITCH_VENDOR_RE.test(fullText)) bump('switch', 78, 'regex-switch-vendor');
    if (JUNIPER_FIREWALL_RE.test(fullText))      bump('firewall', 86, 'regex-juniper-srx');
    if (JUNIPER_ROUTER_RE.test(fullText))        bump('router', 82, 'regex-juniper-mx');
    if (macPrefix === '08:00:09' && !/officejet|laserjet|printer|desktop|win|workstation|laptop|notebook/.test(fullText))
                                                  bump('switch', 45, 'mac-oui-hp-net');
    if (/\bios\b/.test(fullText) && !/switch|catalyst/.test(fullText)) bump('router', 55, 'cisco-ios-text');
    if (HYPERVISOR_RE.test(fullText))           bump('hypervisor', 90, 'regex-hypervisor');
    if (SERVER_VIRT_RE.test(fullText))          bump('server', 90, 'regex-server-virt');
    if (SERVER_LINUX_RE.test(fullText))         bump('server', 55, 'regex-linux-distro');

    // Smart home / appliance / TV (brand-agnostic)
    const isTv = TV_SIGNAL_RE.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords;
    const isMediaPlayer = MEDIA_PLAYER_RE.test(fullText) && !isTv && !svc.l2 && !svc.l3 && !switchWords && !routerWords;
    const isAppliance = APPLIANCE_RE.test(fullText);
    if (isAppliance) bump('iot', 88, 'regex-appliance');
    if (SMART_HOME_RE.test(fullText) && !isTv) bump('iot', 80, 'regex-smarthome');
    if (isTv) bump('tv', 80, 'regex-tv');
    if (isMediaPlayer) bump('tv', 55, 'regex-media-player');
    if (/chromecast|google ?cast/.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords) bump('iot', 75, 'regex-chromecast');
    if (/sony|bravia/.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords && !/camera|cctv|nvr|dvr|projector/.test(fullText)) bump('tv', 58, 'regex-sony-bravia');
    if ((macPrefix === '58:FD:B1' || /lg ?webos|lgwebostv/.test(fullText)) && !svc.l2 && !svc.l3 && !switchWords && !routerWords) bump('tv', 82, 'regex-lg-webos');
    if (/lg|lge|lg electronics|lg innotek/.test(vendor) && isAppliance) bump('iot', 88, 'regex-lg-appliance');
    if (!svc.l2 && !svc.l3 && !switchWords && !routerWords &&
        /\bandroid\b/.test(fullText) && !isTv && !isAppliance && !SMART_HOME_RE.test(fullText)) bump('pc', 25, 'regex-android-generic');

    // Service-port heuristics
    if (servicePorts.has(554)) {
      bump('webcam', /rtsp|onvif|camera|reolink|hikvision|dahua|vivotek|axis/.test(fullText) ? 65 : 55, 'tcp-rtsp');
    }
    if (servicePorts.has(502) || servicePorts.has(1883)) bump('iot', 35, 'tcp-iot-mqtt-modbus');
    if ((servicePorts.has(9100) || servicePorts.has(631)) && !(switchWords || routerWords || networkVendorGateway)) {
      bump('printer', 35, 'tcp-printer');
    }
    if ((servicePorts.has(445) || servicePorts.has(3389)) && PC_OS_RE.test(fullText)) {
      bump('server', 45, 'tcp-smb-rdp-server');
    } else if (servicePorts.has(445) || servicePorts.has(3389)) {
      bump('pc', 35, 'tcp-smb-rdp-pc');
    }

    // sysServices L2/L3 hints
    if (svc.l3 && !svc.l7 && !switchWords)       bump('router', 45, 'sysservices-l3');
    if (svc.l2 && !svc.l3 && !svc.l7)             bump('switch', 45, 'sysservices-l2');
    if (svc.l2 && svc.l3)                         { bump('switch', 35, 'sysservices-l2-l3'); bump('router', 25, 'sysservices-l2-l3'); }
    if (svc.l4 && svc.l7 && !svc.l2 && !svc.l3 && !/printer|officejet|laserjet|camera|nas|ups|pdu|ap|iot|keil/.test(fullText)) {
      bump('server', 30, 'sysservices-l4-l7');
    }

    // PC fallback chain when no SNMP and no network-device evidence
    if (!hasSnmpSignal && !switchWords && !routerWords) {
      if (PC_HOSTNAME_RE.test(String(row?.hostname || '').trim())) bump('pc', 55, 'hostname-pc');
      if (PC_VENDOR_RE.test(vendor) && !/officejet|laserjet|printer|aruba/.test(fullText)) bump('pc', 30, 'vendor-pc');
      if (!score.tv && !score.webcam && !score.nas && !score.printer && !score.iot && (row?.alive || row?.mac)) {
        bump('pc', 15, 'pc-baseline');
      }
    }
    if ((row?.httpTitle || row?.httpsTitle) && !score.router && !score.switch && !score.server && !score.nas && !score.printer && !score.webcam && !score.tv) {
      bump('iot', 20, 'http-baseline-iot');
    }

    // ---------- Aggregation ----------
    const sortedEntries = Object.entries(score).sort((a, b) =>
      (b[1] - a[1]) || (this.priority.indexOf(a[0]) - this.priority.indexOf(b[0]))
    );
    const bestEntry = sortedEntries[0];
    const bestType = bestEntry ? bestEntry[0] : null;
    const bestPoints = bestEntry ? bestEntry[1] : 0;
    const runnerUp = sortedEntries[1] || [null, 0];
    const gap = bestPoints - runnerUp[1];

    let deviceType;
    let confidence;
    if (bestType && bestPoints >= this.decisionThreshold) {
      deviceType = bestType;
      // Heuristic confidence:
      //   base = clamp(bestPoints, 0, 95)
      //   + bonus when there is a comfortable gap from the runner-up
      //   - small penalty when only a single low-strength signal exists
      const sources = new Set(evidences.filter(e => e.type === bestType).map(e => e.source || 'rule'));
      const base = Math.min(95, bestPoints);
      const gapBonus = Math.min(15, Math.round(gap / 5));
      const multiSourceBonus = Math.min(8, (sources.size - 1) * 4);
      confidence = Math.max(10, Math.min(99, base + gapBonus + multiSourceBonus));
    } else if (row?.httpTitle || row?.httpsTitle) {
      deviceType = 'iot';
      confidence = 20;
    } else if (hasSnmpSignal) {
      deviceType = 'switch';
      confidence = 25;
    } else {
      deviceType = 'pc';
      confidence = 15;
    }

    // Promozione server→hypervisor: l'hypervisor è una SPECIALIZZAZIONE del server,
    // quindi un host che vince come `server` ma porta evidenza hypervisor (sysDescr
    // ESXi/Proxmox/Hyper-V/XCP-ng/Nutanix o sysObjectID VMware) È un hypervisor. Il
    // segnale OS generico (linux/vmware→server) altrimenti maschererebbe l'host.
    // Stessa identica regola nel classificatore legacy (parità).
    if (deviceType === 'server' &&
        (HYPERVISOR_RE.test(fullText) || oid('1.3.6.1.4.1.6876.') || sysObjectInfo?.deviceType === 'hypervisor')) {
      deviceType = 'hypervisor';
    }

    const alternatives = sortedEntries
      .filter(([t]) => t !== deviceType)
      .slice(0, 4)
      .map(([type, points]) => ({ type, score: points }));

    return {
      deviceType,
      confidence,
      alternatives,
      scores: { ...score },
      evidences,
      reasons: Array.from(reasons),
    };
  }
}

module.exports = {
  FusionScorer,
  DEFAULT_PRIORITY,
  DEFAULT_DECISION_THRESHOLD,
};
