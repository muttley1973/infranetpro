'use strict';
// ============================================================
//  lib/discovery-mdns.js — mDNS (DNS-SD) + SSDP (UPnP) discovery: helper PURI (UMD-lite).
//
//  I device consumer/IoT a PORTE CHIUSE (telefoni, tablet, elettrodomestici smart,
//  TV, speaker) non rispondono a SNMP/HTTP/porte di gestione, ma si ANNUNCIANO in
//  multicast. Qui vivono le parti PURE e testabili:
//    - costruzione delle query (mDNS PTR query, SSDP M-SEARCH);
//    - parsing delle risposte (DNS wire-format con compressione, header SSDP, XML UPnP);
//    - mappa SERVIZIO -> TIPO device, VENDOR-NEUTRAL (il servizio E' il tipo:
//      _ipp->printer, _googlecast->tv, MediaRenderer->tv, InternetGatewayDevice->router).
//
//  Segnale MISURATO (il device dichiara sé stesso) e vendor-neutral, come RTSP->camera
//  o il probe Google Cast (eureka_info) gia' in casa: qui lo si generalizza a tutte le
//  famiglie consumer. NESSUN IO qui: i socket li guida server/netscan.js (_mdnsSsdpSweep).
//
//  ⚠️ Il multicast e' LINK-LOCAL (mDNS TTL 1): si sentono solo i device sullo STESSO
//  segmento L2. La scoperta cross-subnet richiede un mDNS reflector — onesto per design.
//
//  Mappa conservativa (solo servizi non-ambigui in "strong"; i dubbi in "weak" cosi'
//  un segnale piu' forte vince). Additivo: un device senza dati mDNS/SSDP non cambia.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (server + test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Indirizzi/porte canonici del multicast (esposti; l'IO li usa in netscan.js).
  const MDNS_ADDR = '224.0.0.251';
  const MDNS_PORT = 5353;
  const SSDP_ADDR = '239.255.255.250';
  const SSDP_PORT = 1900;
  // WS-Discovery (ONVIF): scoperta standard delle IP-cam/NVR (SOAP-over-UDP multicast).
  const WSD_ADDR = '239.255.255.250';
  const WSD_PORT = 3702;

  // Query mDNS di default: enumera TUTTI i tipi di servizio + i tipi utili piu' comuni
  // (una domanda esplicita fa rispondere anche chi non pubblica il meta-record).
  const MDNS_DEFAULT_QUERIES = [
    '_services._dns-sd._udp.local',
    '_googlecast._tcp.local', '_airplay._tcp.local', '_raop._tcp.local',
    '_ipp._tcp.local', '_ipps._tcp.local', '_printer._tcp.local',
    '_hap._tcp.local', '_matter._tcp.local', '_matterc._udp.local',
    '_androidtvremote2._tcp.local', '_amzn-wplay._tcp.local',
    '_spotify-connect._tcp.local', '_sonos._tcp.local',
    '_apple-mobdev2._tcp.local', '_device-info._tcp.local',
  ];

  // ---- Mappa SERVIZIO mDNS -> {type, strength} (VENDOR-NEUTRAL, first-match) --------
  //   strong  = servizio non-ambiguo per quel tipo (googlecast, ipp, roku…)
  //   moderate= indicativo ma non esclusivo (apple-mobdev2)
  //   weak    = media/iot generico (airplay/raop/sonos, hap/matter) -> un segnale piu'
  //             forte lo scavalca (un Mac che fa AirPlay resta pc dai suoi altri segnali)
  const MDNS_RULES = [
    [/^(googlecast|amzn-wplay|nvstream|androidtvremote2?|dial)$/, 'tv', 'strong'],
    [/^(ipp|ipps|printer|pdl-datastream|fax-ipp|scanner|uscans?|ptr-uscan)$/, 'printer', 'strong'],
    [/^(apple-mobdev2)$/, 'mobile', 'moderate'],
    [/^(airplay|raop|sonos|spotify-connect|daap|dacp)$/, 'tv', 'weak'],
    [/^(hap|matterc?|matterd|homekit|hue|ewelink|esphomelib|miio|tuya)$/, 'iot', 'weak'],
    [/^(adisk|smb-storage)$/, 'nas', 'weak'],
  ];

  // ---- Mappa tipo UPnP (SSDP ST/NT) -> {type, strength} ----------------------------
  const SSDP_RULES = [
    [/mediarenderer|:dial:|roku:|:tvdevice:|dmr\b/, 'tv', 'strong'],
    [/mediaserver|:dms:|contentdirectory/, 'nas', 'weak'],
    [/internetgatewaydevice|wanconnectiondevice|wandevice|:landevice:/, 'router', 'strong'],
    [/:printer:|printbasic/, 'printer', 'strong'],
    [/:basic:/, 'iot', 'weak'],
  ];

  // Punteggio per il FusionScorer (unica fonte del PESO: qui solo la semantica).
  const STRENGTH_POINTS = { strong: 82, moderate: 70, weak: 55 };

  // Etichetta di servizio DNS-SD -> label nudo: "_googlecast._tcp.local" -> "googlecast",
  // "Instance Name._ipp._tcp.local." -> "ipp". Vuoto se non e' un service type.
  function serviceLabel(fqdn) {
    const m = String(fqdn || '').toLowerCase().match(/_([a-z0-9-]+)\._(?:tcp|udp)\b/);
    return m ? m[1] : '';
  }

  function mdnsServiceToType(labelOrFqdn) {
    const label = /_(?:tcp|udp)\b/.test(String(labelOrFqdn || ''))
      ? serviceLabel(labelOrFqdn)
      : String(labelOrFqdn || '').toLowerCase().replace(/^_/, '').trim();
    if (!label) return null;
    for (const [re, type, strength] of MDNS_RULES) if (re.test(label)) return { type, strength };
    return null;
  }

  function ssdpTypeToType(st) {
    const s = String(st || '').toLowerCase();
    if (!s) return null;
    for (const [re, type, strength] of SSDP_RULES) if (re.test(s)) return { type, strength };
    return null;
  }

  // ------------------------------------------------------------------
  //  Query builders
  // ------------------------------------------------------------------
  function _encodeName(name) {
    const labels = String(name).replace(/\.$/, '').split('.');
    const parts = [];
    for (const l of labels) {
      const b = Buffer.from(l, 'utf8');
      parts.push(Buffer.from([b.length & 0x3f]), b);   // label len (mai compresso in query)
    }
    parts.push(Buffer.from([0]));
    return Buffer.concat(parts);
  }

  // Query mDNS (id 0, QDCOUNT=n, PTR/IN per ogni service name). Con `unicastResponse`
  // imposta il bit QU (RFC 6762 §5.4): i responder rispondono in UNICAST alla porta
  // sorgente invece che in multicast su 5353 -> si ricevono le risposte anche quando la
  // 5353 e' occupata da un altro mDNS responder (tipico su Windows: Bonjour).
  function buildMdnsQuery(names, unicastResponse) {
    const q = (Array.isArray(names) && names.length) ? names : ['_services._dns-sd._udp.local'];
    const header = Buffer.alloc(12);      // id=0, flags=0, an/ns/ar=0
    header.writeUInt16BE(q.length, 4);    // QDCOUNT
    const parts = [header];
    const qclass = unicastResponse ? (1 | 0x8000) : 1;   // IN (+ QU bit se unicast)
    for (const n of q) {
      parts.push(_encodeName(n));
      const tc = Buffer.alloc(4);
      tc.writeUInt16BE(12, 0);            // QTYPE = PTR
      tc.writeUInt16BE(qclass, 2);
      parts.push(tc);
    }
    return Buffer.concat(parts);
  }

  function buildSsdpQuery(st, mx) {
    const _st = st || 'ssdp:all';
    const _mx = Math.max(1, Math.min(parseInt(mx, 10) || 2, 5));
    return Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: ' + SSDP_ADDR + ':' + SSDP_PORT + '\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: ' + _mx + '\r\n' +
      'ST: ' + _st + '\r\n\r\n', 'utf8');
  }

  // ------------------------------------------------------------------
  //  Parsing: mDNS response (DNS wire-format con compressione)
  // ------------------------------------------------------------------
  // Legge un nome DNS a partire da `offset`, seguendo i puntatori di compressione
  // (0xC0). Ritorna { name, offset } dove offset e' la posizione DOPO il nome nel
  // record corrente (non dopo il salto). Difensivo: cap sui salti e sui byte.
  function _readName(buf, offset) {
    const labels = [];
    let o = offset;
    let end = -1;
    let hops = 0;
    let nameLen = 0;
    while (o >= 0 && o < buf.length && hops < 128) {
      const len = buf[o];
      if (len === 0) { o += 1; if (end < 0) end = o; break; }
      if ((len & 0xc0) === 0xc0) {                 // puntatore di compressione
        if (o + 1 >= buf.length) break;
        const ptr = ((len & 0x3f) << 8) | buf[o + 1];
        if (end < 0) end = o + 2;
        o = ptr; hops++;
        continue;
      }
      const start = o + 1;
      if (start + len > buf.length) break;
      // RFC 1035: un nome DNS non supera 255 ottetti. Il cap sui SALTI da solo non
      // basta: tra due salti si possono leggere label sequenziali all'infinito, e un
      // pacchetto ostile (label 1-byte + back-pointer, referenziato da centinaia di
      // record) amplificherebbe a MB per record -> CPU/RAM DoS locale. Tronchiamo qui.
      nameLen += len + 1;
      if (nameLen > 255) break;
      labels.push(buf.toString('utf8', start, start + len));
      o = start + len;
    }
    if (end < 0) end = o;
    return { name: labels.join('.'), offset: end };
  }

  function _parseTxtInto(buf, start, rdlen, out) {
    let o = start;
    const end = Math.min(start + rdlen, buf.length);
    while (o < end) {
      const len = buf[o]; o += 1;
      if (!len || o + len > end) { o += len; continue; }
      const s = buf.toString('utf8', o, o + len); o += len;
      const eq = s.indexOf('=');
      if (eq > 0) out[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
    }
  }

  // Ritorna { services:[label], txt:{}, host, addresses:[] } o null se non e' un
  // messaggio DNS plausibile. Non lancia mai su input malformato (best-effort).
  function parseMdnsResponse(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
    let qd, an, ns, ar;
    try {
      qd = buf.readUInt16BE(4); an = buf.readUInt16BE(6);
      ns = buf.readUInt16BE(8); ar = buf.readUInt16BE(10);
    } catch (_) { return null; }
    const total = an + ns + ar;
    if (total <= 0 || total > 512) return null;      // sanity
    let o = 12;
    for (let i = 0; i < qd && o < buf.length; i++) { o = _readName(buf, o).offset + 4; }
    const services = new Set();
    const txt = {};
    const addresses = [];
    let host = '';
    for (let i = 0; i < total && o + 10 <= buf.length; i++) {
      const nameR = _readName(buf, o); o = nameR.offset;
      if (o + 10 > buf.length) break;
      const type = buf.readUInt16BE(o); o += 2;
      o += 2;                                          // class
      o += 4;                                          // ttl
      const rdlen = buf.readUInt16BE(o); o += 2;
      const rdStart = o;
      if (rdStart + rdlen > buf.length) break;
      if (type === 12) {                               // PTR
        const target = _readName(buf, rdStart).name;
        const svc = _serviceFromPtr(nameR.name, target);
        if (svc) services.add(svc);
      } else if (type === 16) {                        // TXT
        _parseTxtInto(buf, rdStart, rdlen, txt);
        const svc = serviceLabel(nameR.name);
        if (svc) services.add(svc);
      } else if (type === 33) {                        // SRV -> target host
        if (rdlen > 6) { const t = _readName(buf, rdStart + 6).name; if (t && !host) host = t; }
        const svc = serviceLabel(nameR.name);
        if (svc) services.add(svc);
      } else if (type === 1 && rdlen === 4) {          // A
        addresses.push(`${buf[rdStart]}.${buf[rdStart + 1]}.${buf[rdStart + 2]}.${buf[rdStart + 3]}`);
      }
      o = rdStart + rdlen;
    }
    return { services: [...services], txt, host, addresses };
  }

  // Il service type puo' stare nel NOME del record (risposta a "_ipp._tcp.local" PTR)
  // oppure nel TARGET (risposta all'enumerazione "_services._dns-sd._udp.local").
  function _serviceFromPtr(recordName, ptrTarget) {
    const rn = String(recordName || '').toLowerCase();
    if (rn.startsWith('_services._dns-sd._udp')) return serviceLabel(ptrTarget);
    if (/\._(tcp|udp)\.local/.test(rn)) return serviceLabel(rn);
    return serviceLabel(ptrTarget) || serviceLabel(rn);
  }

  // ------------------------------------------------------------------
  //  Parsing: SSDP response (HTTP-over-UDP) + descrizione UPnP (XML)
  // ------------------------------------------------------------------
  function parseSsdpResponse(text) {
    const s = String(text || '');
    if (!/^(HTTP\/1\.1|NOTIFY|M-SEARCH)/i.test(s.trim())) {
      // tollera comunque risposte con soli header
    }
    const h = {};
    for (const line of s.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    if (!h.st && !h.nt && !h.location && !h.server) return null;
    return { st: h.st || h.nt || '', location: h.location || '', server: h.server || '', usn: h.usn || '' };
  }

  // Estrae {deviceType, friendlyName, manufacturer, modelName, modelNumber} dall'XML
  // di descrizione UPnP (fetch UNICAST della LOCATION, best-effort). Regex, non parser
  // completo: prendiamo solo i primi tag utili con un cap di lunghezza (anti-abuso).
  function parseUpnpXml(xml) {
    const g = (tag) => {
      const m = String(xml || '').match(new RegExp('<' + tag + '>\\s*([^<]{0,200})\\s*</' + tag + '>', 'i'));
      return m ? m[1].trim() : '';
    };
    return {
      deviceType: g('deviceType'),
      friendlyName: g('friendlyName'),
      manufacturer: g('manufacturer'),
      modelName: g('modelName'),
      modelNumber: g('modelNumber'),
    };
  }

  // ------------------------------------------------------------------
  //  WS-Discovery (ONVIF) — scoperta standard di IP-cam / NVR
  // ------------------------------------------------------------------
  // Probe SOAP-over-UDP: chiede i device di tipo NetworkVideoTransmitter (ONVIF). Le
  // telecamere ONVIF di QUALSIASI marca rispondono con un ProbeMatch che porta i "scopes".
  function buildWsDiscoveryProbe(messageId) {
    const id = String(messageId || 'urn:uuid:00000000-0000-4000-8000-000000000001');
    return Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"' +
      ' xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"' +
      ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"' +
      ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
      '<e:Header><w:MessageID>' + id + '</w:MessageID>' +
      '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>' +
      '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>' +
      '</e:Header>' +
      '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>' +
      '</e:Envelope>', 'utf8');
  }

  // Estrae dai ProbeMatch ONVIF gli "scopes" utili: `name` (nome) e `hardware` (modello).
  // Forma degli scope: "onvif://www.onvif.org/<kind>/<valore>" (valore url-encoded). Bounded.
  function parseWsDiscovery(xml) {
    const s = String(xml || '');
    if (!/ProbeMatch/i.test(s) && !/Scopes/i.test(s)) return null;
    const scM = s.match(/<[^>]*Scopes[^>]*>([\s\S]*?)<\/[^>]*Scopes>/i);
    const scopes = scM ? scM[1].trim().split(/\s+/).filter(Boolean).slice(0, 64) : [];
    const xM = s.match(/<[^>]*XAddrs[^>]*>([\s\S]*?)<\/[^>]*XAddrs>/i);
    const _scope = (kind) => {
      for (const sc of scopes) {
        const m = sc.match(new RegExp('onvif://[^/]+/' + kind + '/(.+)$', 'i'));
        if (m) { try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim().slice(0, 80); } catch (_) { return m[1].slice(0, 80); } }
      }
      return '';
    };
    return { scopes, name: _scope('name'), hardware: _scope('hardware'), location: _scope('location'), xaddrs: xM ? xM[1].trim().slice(0, 300) : '' };
  }

  // GetDeviceInformation ONVIF (SOAP) — chiede il MODELLO COMMERCIALE alla telecamera
  // (device service URL preso dagli XAddrs del ProbeMatch). Il campo Model e' quello di
  // marketing ("RLC-810A") mentre HardwareId e' il codice interno ("IPC-122").
  function buildOnvifGetDeviceInfo() {
    return Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">' +
      '<s:Body xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:GetDeviceInformation/></s:Body>' +
      '</s:Envelope>', 'utf8');
  }

  // Estrae {manufacturer, model, firmware, serial, hardwareId} dalla risposta ONVIF.
  function parseOnvifDeviceInfo(xml) {
    const s = String(xml || '');
    if (!/GetDeviceInformationResponse|:Model>|Manufacturer>/i.test(s)) return null;
    const g = (tag) => {
      const m = s.match(new RegExp('<(?:[a-z0-9]+:)?' + tag + '>\\s*([^<]{0,120})\\s*</(?:[a-z0-9]+:)?' + tag + '>', 'i'));
      return m ? m[1].trim() : '';
    };
    return { manufacturer: g('Manufacturer'), model: g('Model'), firmware: g('FirmwareVersion'), serial: g('SerialNumber'), hardwareId: g('HardwareId') };
  }

  // ------------------------------------------------------------------
  //  Sintesi: parsed mDNS/SSDP/WS-Discovery -> identita' unica del device
  // ------------------------------------------------------------------
  // Nomi GENERICI = descrittori di CLASSE/SERVIZIO UPnP-DLNA (non un modello ne' un nome
  // proprio): un friendlyName "WPS Access Point" / "Internet Gateway Device" / "MediaRenderer"
  // e' la funzione del device, non la sua identita' -> non lo usiamo come nome/hostname.
  // Vendor-neutral: sono termini di CLASSE standard, nessun marchio. Normalizzati (solo a-z0-9).
  const _GENERIC_NAMES = new Set([
    'accesspoint', 'wpsaccesspoint', 'ap', 'wirelessap', 'wirelessaccesspoint',
    'gateway', 'gatewaydevice', 'internetgatewaydevice', 'residentialgateway', 'homegateway',
    'broadbandgateway', 'router', 'wirelessrouter', 'broadbandrouter', 'wandevice', 'landevice',
    'mediarenderer', 'mediaserver', 'digitalmediarenderer', 'digitalmediaserver', 'dmr', 'dms',
    'dlna', 'dlnarenderer', 'dlnaserver', 'upnpdevice', 'upnprootdevice', 'rootdevice',
    'basicdevice', 'wfadevice', 'device', 'unknown', 'generic', 'network', 'localhost',
    'smarttv', 'tv', 'printer', 'scanner', 'camera', 'ipcamera',
    'android', 'androidtv', 'raspberrypi', 'localdomain', 'esp', 'esp32', 'esp8266',
    // Valori-icona Bonjour `_device-info` (NON modelli reali): NAS/Samba li dichiarano
    // per l'icona nel Finder Apple. I Mac veri hanno un suffisso versione (es. "Macmini8,1")
    // che qui non matcha, quindi restano.
    'xserve', 'rackmac', 'macpro', 'powermac', 'macmini', 'imac', 'macbook', 'appletv',
  ]);
  function isGenericDeviceName(s) {
    const x = String(s || '').toLowerCase().replace(/\.local\.?$/, '').replace(/[^a-z0-9]/g, '');
    return !x || _GENERIC_NAMES.has(x);
  }

  // Modello/brand dai TXT mDNS (chiavi note) o dall'XML UPnP.
  const _MODEL_KEYS = ['md', 'model', 'ty', 'usb_mdl', 'product', 'am', 'rmodel'];
  const _VENDOR_KEYS = ['mf', 'manufacturer', 'usb_mfg', 'vendor', 'org'];
  function _pick(obj, keys) {
    for (const k of keys) { const v = obj && obj[k]; if (v && String(v).trim()) return String(v).trim().slice(0, 80); }
    return '';
  }

  // Combina i segnali di UN device in un'identita' unica:
  //   { type, strength, points, model, manufacturer, services, host, source }
  // `type` = tipo piu' forte fra mDNS e SSDP (strong > moderate > weak). Ritorna null
  // se non c'e' alcun segnale di tipo utile (ma model/host possono comunque servire).
  function resolveDiscoveryIdentity(input) {
    const mdns = (input && input.mdns) || null;
    const ssdp = (input && input.ssdp) || null;
    const wsd = (input && input.wsd) || null;   // ONVIF WS-Discovery (telecamere)
    const services = mdns && Array.isArray(mdns.services) ? mdns.services.slice() : [];
    const candidates = [];
    for (const svc of services) { const r = mdnsServiceToType(svc); if (r) candidates.push({ ...r, source: 'mdns' }); }
    if (ssdp && ssdp.st) { const r = ssdpTypeToType(ssdp.st); if (r) candidates.push({ ...r, source: 'ssdp' }); }
    // Un ProbeMatch ONVIF = un NetworkVideoTransmitter -> telecamera. ⚠️ MA moltissimi
    // device NON-camera (PC e stampanti Windows via WSD/Function Discovery) rispondono a
    // WS-Discovery: accettiamo il match SOLO se porta uno scope ONVIF vero ("onvif://…"),
    // altrimenti NON e' una telecamera (evita che ogni PC/stampante diventi webcam).
    const wsdOnvif = !!(wsd && (wsd.scopes || []).some(s => /onvif:/i.test(String(s))));
    if (wsdOnvif) candidates.push({ type: 'webcam', strength: 'strong', source: 'onvif' });

    const rank = { strong: 3, moderate: 2, weak: 1 };
    candidates.sort((a, b) => rank[b.strength] - rank[a.strength]);
    const best = candidates[0] || null;

    // Modello: mDNS `md`/`ty` -> ONVIF (Model di GetDeviceInformation = COMMERCIALE, es.
    // "RLC-810A"; poi lo scope `hardware` = codice interno "IPC-122") -> UPnP modelName.
    // I dati WS-Discovery si usano SOLO se e' davvero ONVIF (vedi sopra).
    const model = _pick(mdns && mdns.txt, _MODEL_KEYS) || (wsdOnvif && (wsd.model || wsd.hardware)) || (ssdp && (ssdp.modelName || ssdp.modelNumber)) || '';
    const manufacturer = _pick(mdns && mdns.txt, _VENDOR_KEYS) || (ssdp && ssdp.manufacturer) || '';
    // host = nome proprio del device (SRV mDNS, friendlyName UPnP o nome ONVIF), SCARTANDO
    // i descrittori di classe generici ("WPS Access Point", "Internet Gateway Device"…).
    const host = [mdns && mdns.host, ssdp && ssdp.friendlyName, wsdOnvif && wsd.name]
      .map(x => String(x || '').trim())
      .find(x => x && !isGenericDeviceName(x)) || '';

    if (!best && !model && !manufacturer && !host && !services.length) return null;
    return {
      type: best ? best.type : '',
      strength: best ? best.strength : '',
      points: best ? (STRENGTH_POINTS[best.strength] || 55) : 0,
      source: best ? best.source : '',
      model, manufacturer, host,
      services,
    };
  }

  // Aggregazione PURA di una sweep: array di messaggi grezzi raccolti dai socket
  //   [{ ip, kind:'mdns'|'ssdp'|'upnpxml'|'wsd', data:Buffer|string }]
  // -> Map<ip, identity> (identity = output di resolveDiscoveryIdentity). Accumula
  // per IP i servizi/TXT mDNS, gli header/XML SSDP e gli scope ONVIF prima di risolvere
  // il tipo, cosi' piu' frammenti dallo stesso device convergono. Testabile senza socket.
  function aggregateSweep(messages) {
    const byIp = new Map();
    const _acc = (ip) => {
      let a = byIp.get(ip);
      if (!a) {
        a = {
          mdns: { services: new Set(), txt: {}, host: '' },
          ssdp: { st: '', location: '', server: '', manufacturer: '', modelName: '', modelNumber: '', friendlyName: '' },
          wsd: { name: '', hardware: '', model: '', scopes: [], xaddrs: '' },
        };
        byIp.set(ip, a);
      }
      return a;
    };
    for (const m of (Array.isArray(messages) ? messages : [])) {
      const ip = String((m && m.ip) || '').trim();
      if (!ip || !m) continue;
      const acc = _acc(ip);
      if (m.kind === 'mdns') {
        const p = parseMdnsResponse(m.data);
        if (p) {
          for (const s of p.services) acc.mdns.services.add(s);
          for (const k in p.txt) if (!(k in acc.mdns.txt)) acc.mdns.txt[k] = p.txt[k];
          if (p.host && !acc.mdns.host) acc.mdns.host = p.host;
        }
      } else if (m.kind === 'ssdp') {
        const p = parseSsdpResponse(typeof m.data === 'string' ? m.data : (Buffer.isBuffer(m.data) ? m.data.toString('utf8') : ''));
        if (p) {
          if (p.st && !acc.ssdp.st) acc.ssdp.st = p.st;
          if (p.location && !acc.ssdp.location) acc.ssdp.location = p.location;
          if (p.server && !acc.ssdp.server) acc.ssdp.server = p.server;
        }
      } else if (m.kind === 'upnpxml') {
        const x = parseUpnpXml(typeof m.data === 'string' ? m.data : (Buffer.isBuffer(m.data) ? m.data.toString('utf8') : ''));
        if (x.manufacturer && !acc.ssdp.manufacturer) acc.ssdp.manufacturer = x.manufacturer;
        if (x.modelName && !acc.ssdp.modelName) acc.ssdp.modelName = x.modelName;
        if (x.modelNumber && !acc.ssdp.modelNumber) acc.ssdp.modelNumber = x.modelNumber;
        if (x.friendlyName && !acc.ssdp.friendlyName) acc.ssdp.friendlyName = x.friendlyName;
        if (x.deviceType && !acc.ssdp.st) acc.ssdp.st = x.deviceType;
      } else if (m.kind === 'wsd') {
        const w = parseWsDiscovery(typeof m.data === 'string' ? m.data : (Buffer.isBuffer(m.data) ? m.data.toString('utf8') : ''));
        if (w) {
          if (w.hardware && !acc.wsd.hardware) acc.wsd.hardware = w.hardware;
          if (w.name && !acc.wsd.name) acc.wsd.name = w.name;
          if (w.xaddrs && !acc.wsd.xaddrs) acc.wsd.xaddrs = w.xaddrs;
          if ((w.scopes || []).length && !acc.wsd.scopes.length) acc.wsd.scopes = w.scopes;
        }
      } else if (m.kind === 'onvifinfo') {
        const info = parseOnvifDeviceInfo(typeof m.data === 'string' ? m.data : (Buffer.isBuffer(m.data) ? m.data.toString('utf8') : ''));
        if (info) {
          if (info.model && !acc.wsd.model) acc.wsd.model = info.model;        // modello COMMERCIALE
          if (info.manufacturer && !acc.ssdp.manufacturer) acc.ssdp.manufacturer = info.manufacturer;
        }
      }
    }
    const out = new Map();
    for (const [ip, acc] of byIp) {
      const identity = resolveDiscoveryIdentity({
        mdns: { services: [...acc.mdns.services], txt: acc.mdns.txt, host: acc.mdns.host },
        ssdp: acc.ssdp,
        wsd: acc.wsd,
      });
      if (identity) out.set(ip, identity);
    }
    return out;
  }

  // Proiezione PUBBLICA di un'identita' mDNS/SSDP verso il client. Teniamo la provenienza
  // (tipo/forza/punti/sorgente/servizi) e il `model` — un IDENTIFICATIVO DI PRODOTTO NON
  // personale ("Chromecast Ultra", "Samsung QN90A") che serve a comporre un nome device
  // descrittivo. Scartiamo invece `host` (friendlyName UPnP / SRV target: PUO' contenere
  // dati personali tipo "iPhone di Mario" -> gia' finito, ripulito, in hostname) e
  // `manufacturer` (ridondante: gia' in vendor). misurato != dichiarato per i nomi-persona.
  function publicMdns(identity) {
    if (!identity || typeof identity !== 'object') return identity;
    return {
      type: identity.type || '',
      strength: identity.strength || '',
      points: identity.points || 0,
      source: identity.source || '',
      services: Array.isArray(identity.services) ? identity.services.slice() : [],
      model: identity.model || '',
    };
  }

  return {
    MDNS_ADDR, MDNS_PORT, SSDP_ADDR, SSDP_PORT, WSD_ADDR, WSD_PORT, MDNS_DEFAULT_QUERIES, STRENGTH_POINTS,
    serviceLabel, mdnsServiceToType, ssdpTypeToType,
    buildMdnsQuery, buildSsdpQuery, buildWsDiscoveryProbe, buildOnvifGetDeviceInfo,
    parseMdnsResponse, parseSsdpResponse, parseUpnpXml, parseWsDiscovery, parseOnvifDeviceInfo,
    resolveDiscoveryIdentity, aggregateSweep, publicMdns, isGenericDeviceName,
  };
});
