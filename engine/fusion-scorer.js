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

const { oidTypeVotes } = require('../lib/device-signatures');

// Tie-break order when two device types have identical raw scores: the one
// listed first wins. This is the single authoritative type priority.
const DEFAULT_PRIORITY = [
  'firewall', 'sdwan', 'router', 'switch', 'nas', 'hypervisor', 'server', 'printer',
  'webcam', 'wlanctrl', 'ap', 'ups', 'pdu', 'voip', 'tv', 'iot', 'mobile', 'pc',
];

// Minimum raw score required to commit to the best device-type guess.
// Below this we fall back to httpTitle → iot or hasSnmpSignal → switch / pc.
const DEFAULT_DECISION_THRESHOLD = 30;

// ---------- Pre-compiled regex tables ---------------------------------------
// Kept as module-level constants so each `classify()` call doesn't recompile.

// Canonical, SHARED regex tables (lib/device-patterns.js) — single source consumed
// here (weighted) and by the client fallback (first-match) so the two can't drift
// (B3). Extraction is behavior-preserving; tests/classify-golden.test.js proves it.
const {
  SWITCH_WORDS_RE, ROUTER_WORDS_RE, NET_VENDOR_GW_RE, PRINTER_RE, WEBCAM_RE, NAS_RE,
  FIREWALL_RE, AP_RE, WLANCTRL_RE, PDU_RE, UPS_RE, VOIP_RE, IOT_EMBED_RE,
  ROUTER_VENDOR_RE, SWITCH_VENDOR_RE, JUNIPER_FIREWALL_RE, JUNIPER_ROUTER_RE,
  HYPERVISOR_RE, SERVER_VIRT_RE, SERVER_LINUX_RE, APPLIANCE_RE, SMART_HOME_RE,
  TV_SIGNAL_RE, MEDIA_PLAYER_RE, PC_OS_RE, PC_HOSTNAME_RE, PC_VENDOR_RE,
  VENDOR_TYPE_NOUN_RE,
} = require('../lib/device-patterns');

// ---------- Helpers ----------------------------------------------------------

function _safeIntMax(value, min, max, fallback) {
  const n = parseInt(value ?? 0, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _defaultNormMac(mac) {
  // Minimal MAC normalization used only if the caller doesn't pass `normMac`.
  // UPPERCASE to match server/netscan.js `_normMac` (the production normMac):
  // the MAC-prefix rules below compare against uppercase literals (e.g.
  // '58:FD:B1'), so a lowercase default silently killed those signals.
  return String(mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase().replace(/(.{2})(?=.)/g, '$1:').slice(0, 17);
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
    // Vendor RIPULITO dai sostantivi-tipo generici prima di entrare nel testo di
    // classificazione: "gateway"/"switch"/"router"/"firewall" dentro un NOME AZIENDA
    // non devono decidere il tipo (guardrail vendor≠tipo). I brand reali restano.
    const vendorForType = vendor.replace(VENDOR_TYPE_NOUN_RE, ' ');
    const banner = `${row?.httpTitle || ''} ${row?.httpsTitle || ''}`.toLowerCase();
    const host = String(row?.hostname || '').toLowerCase();
    const netbiosName = String(row?.netbiosName || row?.netbios?.name || '').toLowerCase();
    const netbiosGroup = String(row?.netbiosGroup || row?.netbios?.group || '').toLowerCase();
    const shareText = (row?.smbShares || []).map(s => `${s.name || s} ${s.type || ''} ${s.comment || ''}`).join(' ').toLowerCase();
    const ip = String(row?.ip || '').trim();
    const svc = decodeSysServices(row?.sysServices);
    const text = `${descr} ${vendorForType} ${banner} ${host} ${netbiosName} ${netbiosGroup} ${shareText}`.toLowerCase();
    const servicePorts = new Set((row?.services || []).map(s => parseInt(s.port, 10)).filter(Number.isFinite));
    const serviceText = (row?.services || []).map(s => `${s.service || ''} ${s.banner || ''}`).join(' ').toLowerCase();
    // mDNS/SSDP: modello, produttore e servizi ANNUNCIATI in multicast entrano nel testo
    // di classificazione (marca/modello -> brand+tipo, es. "Chromecast"/"Daikin"/"LG").
    // Additivo: row.mdns esiste solo se la sweep multicast ha trovato qualcosa.
    const mdnsText = row?.mdns
      ? `${row.mdns.model || ''} ${row.mdns.manufacturer || ''} ${row.mdns.host || ''} ${(row.mdns.services || []).join(' ')}`.toLowerCase()
      : '';
    const fullText = `${text} ${serviceText} ${mdnsText}`.toLowerCase();
    const macPrefix = normMac(row?.mac).substring(0, 8);
    // .1 e .254 = le due convenzioni di default-gateway di gran lunga più comuni.
    // Un device di rete su questi IP riceve un voto router IN PIÙ (segnale additivo:
    // non causa mai un tipo sbagliato, migliora solo il recall sui gateway .254).
    const isLikelyGatewayIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.(?:1|254)$/.test(ip);
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
      // 'unknown' is the SysObjectEngine "matched-but-untyped" placeholder, not a
      // real app type: never let it score (it would win with high confidence and
      // leak a non-type — no-invention rule).
      if (!type || type === 'unknown' || !points) return;
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
      // The OUI deviceType is a VENDOR-IDENTITY inference (derived from the MAC
      // vendor) — the WEAKEST signal tier: a *candidate*, never a decision. It is
      // weighted like the other identity signals (vendor-pc ~30, mac-oui ~45), so it
      // can NEVER outrank a MEASURED behavioural / model / banner / SNMP signal
      // (>=78). This is the vendor-neutral core rule, applied uniformly to EVERY OUI
      // plugin (mono- and multi-product vendors alike): e.g. Zyxel makes routers AND
      // switches — a web banner reading "Intelligent Switch" (78) must beat the OUI's
      // vendor-default (was 80, now <=45). When the OUI type is the ONLY signal it
      // still classifies (>= decisionThreshold), just at honest low confidence (F4).
      const points = ouiPriority >= 90
        ? Math.max(30, Math.min(45, baseConfidence))
        : Math.max(15, Math.min(35, baseConfidence));
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

    // OID prefix votes — dalla tabella CANONICA condivisa (lib/device-signatures).
    // Stessi prefissi/punti di prima + i mancanti (Lexmark 641, VoIP Grandstream/
    // Yealink): un solo posto per server e client -> niente piu' drift.
    for (const v of oidTypeVotes(objectId)) bump(v.type, v.points, 'oid-' + v.type);

    // Vendor / model regex votes from descr/banner/host
    if (PRINTER_RE.test(fullText))   bump('printer', 90, 'regex-printer');
    if (/^hp[0-9a-f]{6}$/i.test(String(row?.hostname || '').trim()) && /hewlett packard/.test(vendor))
                                     bump('printer', 65, 'hostname-hp-printer');
    if (WEBCAM_RE.test(fullText))    bump('webcam', 90, 'regex-webcam');
    if (NAS_RE.test(fullText))       bump('nas', 90, 'regex-nas');
    if (FIREWALL_RE.test(fullText))  bump('firewall', 90, 'regex-firewall');
    if (WLANCTRL_RE.test(fullText))  bump('wlanctrl', 90, 'regex-wlanctrl');
    else if (AP_RE.test(fullText))   bump('ap', 80, 'regex-ap');
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
    if (/chromecast|google ?cast/.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords) bump('tv', 75, 'regex-chromecast');
    if (/sony|bravia/.test(fullText) && !svc.l2 && !svc.l3 && !switchWords && !routerWords && !/camera|cctv|nvr|dvr|projector/.test(fullText)) bump('tv', 58, 'regex-sony-bravia');
    if ((macPrefix === '58:FD:B1' || /lg ?webos|lgwebostv/.test(fullText)) && !svc.l2 && !svc.l3 && !switchWords && !routerWords) bump('tv', 82, 'regex-lg-webos');
    if (/lg|lge|lg electronics|lg innotek/.test(vendor) && isAppliance) bump('iot', 88, 'regex-lg-appliance');
    if (!svc.l2 && !svc.l3 && !switchWords && !routerWords &&
        /\bandroid\b/.test(fullText) && !isTv && !isAppliance && !SMART_HOME_RE.test(fullText)) bump('mobile', 25, 'regex-android-generic');

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

    // Google Cast device (Chromecast, Nvidia Shield, Android TV, Nest, cast-enabled
    // TV/speaker): row.cast is set by the eureka_info PROTOCOL probe; the cast control
    // ports (8008/8009) are the fallback when the probe is blocked. Measured +
    // vendor-neutral → a media endpoint (tv). The ports alone score decisively (70) so
    // Cast wins over a vendor/OS guess (NVIDIA→pc, Google→mobile) even without the
    // probe. One consistent policy: every Cast signal (probe, ports, or the text rule
    // above) → tv.
    if (row?.cast) bump('tv', 85, 'cast-device');
    else if (servicePorts.has(8008) || servicePorts.has(8009)) bump('tv', 70, 'cast-ports');

    // mDNS (DNS-SD) / SSDP (UPnP): il device si ANNUNCIA in multicast e il SERVIZIO
    // pubblicato È il tipo (vendor-neutral: _ipp->printer, _googlecast->tv,
    // MediaRenderer->tv, InternetGatewayDevice->router). Segnale MISURATO, ma solo sul
    // segmento locale (multicast link-local). row.mdns = identità risolta da
    // lib/discovery-mdns col peso già scelto (strong 82 / moderate 70 / weak 55) — così
    // un sysObjectID/banner più forte lo scavalca (identità del servizio, non certezza).
    if (row?.mdns?.type && row.mdns.points) bump(row.mdns.type, row.mdns.points, 'mdns-' + (row.mdns.source || 'ssdp'));

    // NetBIOS / SMB = host WINDOWS → un COMPUTER (pc/server), MAI un apparato di rete.
    // <1B>/<1C> Domain Controller → server; <20> Server-service o share SMB → lean
    // server (salvo NAS/stampante che gia' vincono col loro segnale); altrimenti
    // workstation → pc. Segnale del deep-scan (nbtstat/SMB), vendor-neutral.
    const netbiosHost = !!(netbiosName || netbiosGroup || row?.netbiosServer || row?.netbiosDomainCtrl);
    if (netbiosHost) {
      if (row?.netbiosDomainCtrl) bump('server', 60, 'netbios-domain-controller');
      else if ((row?.netbiosServer || (row?.smbShares || []).length) && !score.nas && !score.printer) bump('server', 45, 'netbios-smb-server');
      else bump('pc', 40, 'netbios-workstation');
    }

    // Host Windows di FILE-SHARING (SMB 445 + condivisioni enumerate / RDP / WSD) e
    // SENZA porte di STAMPA (9100/515/631) = un COMPUTER, non una stampante — anche se
    // l'OUI del vendor (es. Canon) suggerirebbe printer. NetBIOS è morto sul Windows
    // moderno (nbtstat non risponde): l'SMB è il segnale comportamentale reale, e batte
    // l'inferenza-vendor. Un NAS ha già un segnale nas più forte → non lo tocchiamo.
    const _hasPrintPorts = servicePorts.has(9100) || servicePorts.has(515) || servicePorts.has(631);
    const _smbShareN = (row?.smbShares || []).length;
    if (servicePorts.has(445) && (_smbShareN > 0 || servicePorts.has(3389) || servicePorts.has(5357)) && !_hasPrintPorts && !score.nas) {
      bump('pc', 85, 'smb-fileshare-host');
    }

    // sysServices L2/L3 hints
    // Pure L3 (no L2) = router; L2+L3 = a MULTILAYER SWITCH → handled by the l2-l3
    // rule below (switch-leaning), NOT router. Without the `!svc.l2` guard an Arista/
    // Catalyst L3 switch (sysServices L2+L3) was wrongly typed router. Vendor-neutral.
    if (svc.l3 && !svc.l2 && !svc.l7 && !switchWords) bump('router', 45, 'sysservices-l3');
    if (svc.l2 && !svc.l3 && !svc.l7)             bump('switch', 45, 'sysservices-l2');
    if (svc.l2 && svc.l3)                         { bump('switch', 35, 'sysservices-l2-l3'); bump('router', 25, 'sysservices-l2-l3'); }
    if (svc.l4 && svc.l7 && !svc.l2 && !svc.l3 && !/printer|officejet|laserjet|camera|nas|ups|pdu|ap|iot|keil/.test(fullText)) {
      bump('server', 30, 'sysservices-l4-l7');
    }

    // PC fallback chain when no SNMP and no network-device evidence
    if (!hasSnmpSignal && !switchWords && !routerWords) {
      if (PC_HOSTNAME_RE.test(String(row?.hostname || '').trim())) bump('pc', 55, 'hostname-pc');
      if (PC_VENDOR_RE.test(vendor) && !/officejet|laserjet|printer|aruba/.test(fullText)) bump('pc', 30, 'vendor-pc');
      if (!score.tv && !score.webcam && !score.nas && !score.printer && !score.iot && !score.mobile && (row?.alive || row?.mac)) {
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
      // Sconto-per-contraddizione (Fingerbank): quando un tipo concorrente ha punteggio
      // VICINO al vincitore, i segnali si contraddicono → confidenza piu' bassa (onesta,
      // manual-first: l'utente rivede). Fino a -25 quando il runner-up eguaglia il best;
      // ~0 quando e' lontano. NON cambia il TIPO scelto (solo la confidenza).
      const contradiction = runnerUp[1] > 0 ? Math.round((runnerUp[1] / bestPoints) * 25) : 0;
      confidence = Math.max(10, Math.min(99, base + gapBonus + multiSourceBonus - contradiction));
    } else if (row?.httpTitle || row?.httpsTitle) {
      deviceType = 'iot';
      confidence = 20;
    } else if (hasSnmpSignal) {
      // Fallback MISURATO invece di indovinare 'switch': un responder SNMP che espone
      // L4+L7 e' un host, non uno switch. Dai layer OSI dichiarati (sysServices),
      // vendor-neutral. Coarse ma onesto (manual-first): l'utente conferma/corregge.
      if (svc.l4 && svc.l7 && !svc.l2 && !svc.l3) { deviceType = 'server'; confidence = 25; }
      else if (svc.l2 && !svc.l3)                 { deviceType = 'switch'; confidence = 25; }
      else if (svc.l3)                            { deviceType = 'router'; confidence = 25; }
      else                                        { deviceType = 'switch'; confidence = 25; }   // nessun layer → storico
    } else {
      deviceType = 'pc';
      confidence = 15;
    }

    // Onesta della confidenza: senza un segnale MISURATO/comportamentale (SNMP,
    // sysObjectID, banner web, porte, NetBIOS, share SMB, Cast) il tipo poggia solo
    // su un'inferenza da vendor/OS (OUI, fingerprint) — un candidato, non una prova.
    // Cappiamo la confidenza cosi' un tipo indovinato-dal-MAC non viene spacciato per
    // certo (manual-first: l'utente conferma). Vendor-neutral, coerente col peso
    // ridotto dell'OUI: identità != prova del tipo.
    const hasMeasuredSignal = !!(
      hasSnmpSignal ||                       // snmpReachable / sysDescr / sysObjectID
      row?.httpTitle || row?.httpsTitle ||   // web banner
      servicePorts.size || netbiosHost ||    // open ports / NetBIOS
      (row?.smbShares || []).length || row?.cast ||
      (row?.mdns && (row.mdns.type || (row.mdns.services || []).length || row.mdns.model)) // mDNS/SSDP announce
    );
    if (!hasMeasuredSignal) confidence = Math.min(confidence, 60);

    // Promozione server→hypervisor: l'hypervisor è una SPECIALIZZAZIONE del server,
    // quindi un host che vince come `server` ma porta evidenza hypervisor (sysDescr
    // ESXi/Proxmox/Hyper-V/XCP-ng/Nutanix o sysObjectID VMware) È un hypervisor. Il
    // segnale OS generico (linux/vmware→server) altrimenti maschererebbe l'host.
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
