'use strict';

// Pure unit tests for lib/discovery-mdns.js — query building, wire-format parsing
// (incl. DNS name compression), the vendor-neutral service->type map, and the
// combined identity resolver. No sockets here (that is netscan's _mdnsSsdpSweep).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  serviceLabel, mdnsServiceToType, ssdpTypeToType,
  buildMdnsQuery, buildSsdpQuery, buildWsDiscoveryProbe, buildOnvifGetDeviceInfo,
  parseMdnsResponse, parseSsdpResponse, parseUpnpXml, parseWsDiscovery, parseOnvifDeviceInfo,
  resolveDiscoveryIdentity, MDNS_DEFAULT_QUERIES,
} = require('../lib/discovery-mdns');

// ---- helpers: encode a synthetic DNS response packet ----
function encName(name) {
  const parts = [];
  for (const l of String(name).replace(/\.$/, '').split('.')) {
    const b = Buffer.from(l, 'utf8');
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}
function txtData(pairs) {
  return Buffer.concat(pairs.map(s => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s, 'utf8')])));
}
function rr(name, type, rdata) {
  const n = Buffer.isBuffer(name) ? name : encName(name);
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(1, 2);        // class IN
  head.writeUInt32BE(120, 4);      // ttl
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([n, head, rdata]);
}
function mkMdns(answers) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // response + AA
  header.writeUInt16BE(answers.length, 6);
  return Buffer.concat([header, ...answers]);
}

// ---------------- service -> type map (vendor-neutral) ----------------
test('mdnsServiceToType: media, printer, iot, mobile — strong vs weak', () => {
  assert.deepEqual(mdnsServiceToType('googlecast'), { type: 'tv', strength: 'strong' });
  assert.deepEqual(mdnsServiceToType('_ipp._tcp.local'), { type: 'printer', strength: 'strong' });
  assert.deepEqual(mdnsServiceToType('printer'), { type: 'printer', strength: 'strong' });
  assert.deepEqual(mdnsServiceToType('apple-mobdev2'), { type: 'mobile', strength: 'moderate' });
  assert.deepEqual(mdnsServiceToType('airplay'), { type: 'tv', strength: 'weak' });
  assert.deepEqual(mdnsServiceToType('hap'), { type: 'iot', strength: 'weak' });
  assert.deepEqual(mdnsServiceToType('matter'), { type: 'iot', strength: 'weak' });
  assert.equal(mdnsServiceToType('ssh'), null);          // generic -> no type
  assert.equal(mdnsServiceToType('workstation'), null);
});

test('ssdpTypeToType: UPnP device types', () => {
  assert.deepEqual(ssdpTypeToType('urn:schemas-upnp-org:device:MediaRenderer:1'), { type: 'tv', strength: 'strong' });
  assert.deepEqual(ssdpTypeToType('urn:dial-multiscreen-org:device:dial:1'), { type: 'tv', strength: 'strong' });
  assert.deepEqual(ssdpTypeToType('urn:schemas-upnp-org:device:InternetGatewayDevice:1'), { type: 'router', strength: 'strong' });
  assert.deepEqual(ssdpTypeToType('urn:schemas-upnp-org:device:MediaServer:1'), { type: 'nas', strength: 'weak' });
  assert.deepEqual(ssdpTypeToType('urn:schemas-upnp-org:device:Basic:1'), { type: 'iot', strength: 'weak' });
  assert.equal(ssdpTypeToType('upnp:rootdevice'), null);
});

test('serviceLabel: extracts the DNS-SD service label', () => {
  assert.equal(serviceLabel('_googlecast._tcp.local'), 'googlecast');
  assert.equal(serviceLabel('Living Room._airplay._tcp.local.'), 'airplay');
  assert.equal(serviceLabel('DESKTOP-ABC'), '');
});

// ---------------- query builders ----------------
test('buildMdnsQuery: default enumerates services; explicit names set QDCOUNT', () => {
  const def = buildMdnsQuery();
  assert.equal(def.readUInt16BE(4), 1, 'default = 1 question');
  const multi = buildMdnsQuery(['_ipp._tcp.local', '_googlecast._tcp.local']);
  assert.equal(multi.readUInt16BE(4), 2, 'QDCOUNT = number of names');
  // last 4 bytes = QTYPE(PTR=12) + QCLASS(IN=1)
  assert.equal(multi.readUInt16BE(multi.length - 4), 12);
  assert.equal(multi.readUInt16BE(multi.length - 2), 1);
  assert.ok(MDNS_DEFAULT_QUERIES.includes('_googlecast._tcp.local'));
  // unicastResponse=true sets the QU bit (top bit of QCLASS) -> replies come back unicast
  const qu = buildMdnsQuery(['_ipp._tcp.local'], true);
  assert.equal(qu.readUInt16BE(qu.length - 2), 1 | 0x8000, 'QU bit set on QCLASS');
});

test('buildSsdpQuery: valid M-SEARCH datagram', () => {
  const q = buildSsdpQuery().toString('utf8');
  assert.match(q, /^M-SEARCH \* HTTP\/1\.1\r\n/);
  assert.match(q, /HOST: 239\.255\.255\.250:1900/);
  assert.match(q, /MAN: "ssdp:discover"/);
  assert.match(q, /ST: ssdp:all/);
  assert.match(buildSsdpQuery('urn:x:1', 3).toString('utf8'), /ST: urn:x:1/);
});

// ---------------- mDNS response parsing ----------------
test('parseMdnsResponse: PTR + TXT -> services + txt model', () => {
  const pkt = mkMdns([
    rr('_googlecast._tcp.local', 12, encName('Chromecast-1234._googlecast._tcp.local')),
    rr('Chromecast-1234._googlecast._tcp.local', 16, txtData(['md=Chromecast Ultra', 'id=abc123'])),
  ]);
  const p = parseMdnsResponse(pkt);
  assert.ok(p, 'parsed');
  assert.ok(p.services.includes('googlecast'), 'service googlecast');
  assert.equal(p.txt.md, 'Chromecast Ultra');
});

test('parseMdnsResponse: service enumeration (PTR target carries the type)', () => {
  const pkt = mkMdns([
    rr('_services._dns-sd._udp.local', 12, encName('_ipp._tcp.local')),
  ]);
  const p = parseMdnsResponse(pkt);
  assert.ok(p.services.includes('ipp'), 'ipp discovered via enumeration target');
});

test('parseMdnsResponse: handles DNS name compression pointers', () => {
  // record 1 name '_ipp._tcp.local' lands at offset 12; record 2 name is a pointer to it.
  const name1 = encName('_ipp._tcp.local');           // starts at offset 12 (after header)
  const a1 = rr(name1, 12, encName('HP-Printer._ipp._tcp.local'));
  const ptrName = Buffer.from([0xc0, 0x0c]);           // pointer -> offset 12
  const a2 = rr(ptrName, 16, txtData(['ty=HP OfficeJet Pro', 'usb_MFG=HP']));
  const p = parseMdnsResponse(mkMdns([a1, a2]));
  assert.ok(p.services.includes('ipp'), 'compressed name resolved to _ipp');
  assert.equal(p.txt.ty, 'HP OfficeJet Pro');
  assert.equal(p.txt.usb_mfg, 'HP');
});

test('parseMdnsResponse: rejects junk without crashing', () => {
  assert.equal(parseMdnsResponse(Buffer.from([1, 2, 3])), null);
  assert.equal(parseMdnsResponse('not a buffer'), null);
  assert.equal(parseMdnsResponse(Buffer.alloc(12)), null); // no answers
});

// ---------------- SSDP + UPnP XML parsing ----------------
test('parseSsdpResponse: extracts ST/LOCATION/SERVER', () => {
  const resp = [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=1800',
    'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
    'LOCATION: http://192.168.1.5:8080/desc.xml',
    'SERVER: Linux/4.0 UPnP/1.0 GUPnP/1.0',
    'USN: uuid:abcd::urn:...:MediaRenderer:1',
    '', '',
  ].join('\r\n');
  const p = parseSsdpResponse(resp);
  assert.equal(p.st, 'urn:schemas-upnp-org:device:MediaRenderer:1');
  assert.equal(p.location, 'http://192.168.1.5:8080/desc.xml');
  assert.match(p.server, /UPnP\/1\.0/);
  assert.equal(parseSsdpResponse('garbage'), null);
});

test('parseUpnpXml: manufacturer / modelName / deviceType', () => {
  const xml = '<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>' +
    '<friendlyName>Living Room TV</friendlyName><manufacturer>Samsung Electronics</manufacturer>' +
    '<modelName>QN90A</modelName><modelNumber>2021</modelNumber></device></root>';
  const p = parseUpnpXml(xml);
  assert.equal(p.manufacturer, 'Samsung Electronics');
  assert.equal(p.modelName, 'QN90A');
  assert.match(p.deviceType, /MediaRenderer/);
});

// ---------------- WS-Discovery (ONVIF cameras) ----------------
test('buildWsDiscoveryProbe: valid ONVIF Probe SOAP', () => {
  const s = buildWsDiscoveryProbe().toString('utf8');
  assert.match(s, /discovery\/Probe/);
  assert.match(s, /NetworkVideoTransmitter/);
  assert.match(s, /MessageID/);
});

test('parseWsDiscovery: extracts name + hardware (model) from ONVIF scopes', () => {
  const xml = '<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">' +
    '<SOAP-ENV:Body><d:ProbeMatches><d:ProbeMatch>' +
    '<d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/name/HIKVISION%20DS-2CD2042 ' +
    'onvif://www.onvif.org/hardware/DS-2CD2042WD-I onvif://www.onvif.org/location/</d:Scopes>' +
    '<d:XAddrs>http://192.168.1.159/onvif/device_service</d:XAddrs>' +
    '</d:ProbeMatch></d:ProbeMatches></SOAP-ENV:Body></SOAP-ENV:Envelope>';
  const w = parseWsDiscovery(xml);
  assert.equal(w.name, 'HIKVISION DS-2CD2042');      // %20 decoded
  assert.equal(w.hardware, 'DS-2CD2042WD-I');
  assert.match(w.xaddrs, /192\.168\.1\.159/);
  assert.equal(parseWsDiscovery('not soap'), null);
});

test('buildOnvifGetDeviceInfo / parseOnvifDeviceInfo: commercial model from GetDeviceInformation', () => {
  assert.match(buildOnvifGetDeviceInfo().toString('utf8'), /GetDeviceInformation/);
  const resp = '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>' +
    '<tds:GetDeviceInformationResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">' +
    '<tds:Manufacturer>Reolink</tds:Manufacturer><tds:Model>RLC-810A</tds:Model>' +
    '<tds:FirmwareVersion>v3.1</tds:FirmwareVersion><tds:SerialNumber>123</tds:SerialNumber>' +
    '<tds:HardwareId>IPC-122</tds:HardwareId>' +
    '</tds:GetDeviceInformationResponse></s:Body></s:Envelope>';
  const info = parseOnvifDeviceInfo(resp);
  assert.equal(info.model, 'RLC-810A');          // commercial model, not the internal code
  assert.equal(info.manufacturer, 'Reolink');
  assert.equal(info.hardwareId, 'IPC-122');
  assert.equal(parseOnvifDeviceInfo('not soap'), null);
});

test('aggregateSweep: ONVIF GetDeviceInformation model beats the WS-Discovery hardware code', () => {
  const camWsd = '<Envelope xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><Body><d:ProbeMatches><d:ProbeMatch>' +
    '<d:Scopes>onvif://www.onvif.org/hardware/IPC-122 onvif://www.onvif.org/name/Cam</d:Scopes>' +
    '<d:XAddrs>http://192.168.1.159/onvif/device_service</d:XAddrs>' +
    '</d:ProbeMatch></d:ProbeMatches></Body></Envelope>';
  const info = '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>' +
    '<tds:GetDeviceInformationResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">' +
    '<tds:Model>RLC-810A</tds:Model><tds:Manufacturer>Reolink</tds:Manufacturer>' +
    '</tds:GetDeviceInformationResponse></s:Body></s:Envelope>';
  const cam = aggregateSweep([
    { ip: '192.168.1.159', kind: 'wsd', data: camWsd },
    { ip: '192.168.1.159', kind: 'onvifinfo', data: info },
  ]).get('192.168.1.159');
  assert.equal(cam.type, 'webcam');
  assert.equal(cam.model, 'RLC-810A');           // commercial model wins over the "IPC-122" scope
});

test('resolveDiscoveryIdentity: an ONVIF ProbeMatch -> webcam + model from hardware', () => {
  const cam = resolveDiscoveryIdentity({ wsd: { name: 'Front Door', hardware: 'DS-2CD2042WD-I', scopes: ['onvif://www.onvif.org/hardware/DS-2CD2042WD-I'], xaddrs: 'http://10.0.0.9/onvif' } });
  assert.equal(cam.type, 'webcam');
  assert.equal(cam.strength, 'strong');
  assert.equal(cam.model, 'DS-2CD2042WD-I');
  assert.equal(cam.host, 'Front Door');
  // A NON-ONVIF WS-Discovery responder (Windows PC/printer via WSD) must NOT become a webcam.
  const pc = resolveDiscoveryIdentity({ wsd: { name: 'DESKTOP-X', hardware: '', scopes: ['http://schemas.microsoft.com/windows/2006/08/wdp/print'], xaddrs: 'http://10.0.0.5/wsd' } });
  assert.equal(pc, null, 'no onvif scope -> not a camera, no identity');
});

// ---------------- combined identity resolver ----------------
test('resolveDiscoveryIdentity: strongest signal wins; carries model/vendor', () => {
  const cast = resolveDiscoveryIdentity({ mdns: { services: ['googlecast', 'airplay'], txt: { md: 'Chromecast Ultra' } } });
  assert.equal(cast.type, 'tv');
  assert.equal(cast.strength, 'strong');   // googlecast(strong) beats airplay(weak)
  assert.equal(cast.points, 82);
  assert.equal(cast.model, 'Chromecast Ultra');

  const nas = resolveDiscoveryIdentity({ ssdp: { st: 'urn:schemas-upnp-org:device:MediaServer:1', manufacturer: 'Synology', modelName: 'DS220+' } });
  assert.equal(nas.type, 'nas');
  assert.equal(nas.manufacturer, 'Synology');
  assert.equal(nas.model, 'DS220+');

  // mDNS weak iot + SSDP strong tv -> tv wins
  const both = resolveDiscoveryIdentity({ mdns: { services: ['hap'] }, ssdp: { st: 'urn:dial-multiscreen-org:device:dial:1' } });
  assert.equal(both.type, 'tv');
  assert.equal(both.strength, 'strong');

  // only generic services -> no type, but not null (services still carried as text)
  const generic = resolveDiscoveryIdentity({ mdns: { services: ['ssh', 'workstation'] } });
  assert.equal(generic.type, '');
  assert.deepEqual(generic.services, ['ssh', 'workstation']);

  // nothing at all -> null
  assert.equal(resolveDiscoveryIdentity({}), null);
  assert.equal(resolveDiscoveryIdentity({ mdns: { services: [] } }), null);
});

// ---------------- aggregateSweep: raw messages -> Map<ip, identity> ----------------
const { aggregateSweep, isGenericDeviceName } = require('../lib/discovery-mdns');

test('isGenericDeviceName: UPnP class descriptors are generic; real names are not', () => {
  assert.equal(isGenericDeviceName('WPS Access Point'), true);
  assert.equal(isGenericDeviceName('Internet Gateway Device'), true);
  assert.equal(isGenericDeviceName('MediaRenderer'), true);
  assert.equal(isGenericDeviceName('Router'), true);
  assert.equal(isGenericDeviceName('Sony BRAVIA'), false);
  assert.equal(isGenericDeviceName('KD-55X80J'), false);
  assert.equal(isGenericDeviceName('Chromecast'), false);
  // Bonjour _device-info icon placeholders (NAS/Samba report these, not a real model)
  assert.equal(isGenericDeviceName('Xserve'), true);
  assert.equal(isGenericDeviceName('RackMac'), true);
  assert.equal(isGenericDeviceName('Macmini8,1'), false);   // a REAL Mac model (version suffix) is kept
  assert.equal(isGenericDeviceName('Android'), true);
});

test('resolveDiscoveryIdentity: a generic friendlyName is NOT used as host (.1 "WPS Access Point")', () => {
  const gw = resolveDiscoveryIdentity({ ssdp: { st: 'urn:schemas-upnp-org:device:InternetGatewayDevice:1', friendlyName: 'WPS Access Point' } });
  assert.equal(gw.host, '', 'generic class name dropped from host');
  const tv = resolveDiscoveryIdentity({ ssdp: { st: 'urn:schemas-upnp-org:device:MediaRenderer:1', friendlyName: 'Living Room', modelName: 'KD-55X80J' } });
  assert.equal(tv.host, 'Living Room', 'a real friendlyName is kept');
  assert.equal(tv.model, 'KD-55X80J');
});

test('aggregateSweep: Sony TV via SSDP MediaRenderer + UPnP description -> tv + model', () => {
  const ssdpTxt = ['HTTP/1.1 200 OK', 'ST: urn:schemas-upnp-org:device:MediaRenderer:1', 'LOCATION: http://192.168.1.33:52323/dmr.xml', ''].join('\r\n');
  const xml = '<root><device><manufacturer>Sony Corporation</manufacturer><modelName>KD-55X80J</modelName><friendlyName>BRAVIA</friendlyName></device></root>';
  const tv = aggregateSweep([
    { ip: '192.168.1.33', kind: 'ssdp', data: ssdpTxt },
    { ip: '192.168.1.33', kind: 'upnpxml', data: xml },
  ]).get('192.168.1.33');
  assert.equal(tv.type, 'tv');
  assert.equal(tv.model, 'KD-55X80J');       // exact TV model recovered from the UPnP description
});

test('aggregateSweep: merges mDNS + SSDP + UPnP-XML per IP', () => {
  const castPkt = mkMdns([
    rr('_googlecast._tcp.local', 12, encName('TV._googlecast._tcp.local')),
    rr('TV._googlecast._tcp.local', 16, txtData(['md=Chromecast'])),
  ]);
  const ssdpTxt = ['HTTP/1.1 200 OK', 'ST: urn:schemas-upnp-org:device:MediaServer:1', 'LOCATION: http://10.0.0.9/d.xml', ''].join('\r\n');
  const xml = '<root><device><manufacturer>Synology</manufacturer><modelName>DS220+</modelName></device></root>';
  const map = aggregateSweep([
    { ip: '10.0.0.5', kind: 'mdns', data: castPkt },
    { ip: '10.0.0.9', kind: 'ssdp', data: ssdpTxt },
    { ip: '10.0.0.9', kind: 'upnpxml', data: xml },
    { ip: '', kind: 'mdns', data: castPkt },        // no ip -> ignored
  ]);
  assert.equal(map.get('10.0.0.5').type, 'tv');
  assert.equal(map.get('10.0.0.5').model, 'Chromecast');
  const nas = map.get('10.0.0.9');
  assert.equal(nas.type, 'nas');                     // MediaServer
  assert.equal(nas.manufacturer, 'Synology');        // from the dereferenced XML
  assert.equal(nas.model, 'DS220+');
  assert.equal(map.has(''), false);
});

test('aggregateSweep: empty / junk input -> empty Map', () => {
  assert.equal(aggregateSweep([]).size, 0);
  assert.equal(aggregateSweep(null).size, 0);
  assert.equal(aggregateSweep([{ ip: '1.2.3.4', kind: 'mdns', data: Buffer.from([0, 1]) }]).size, 0);
});

// ---------------- publicMdns: client-facing projection drops declared names ----------------
const { publicMdns } = require('../lib/discovery-mdns');

test('publicMdns: keeps provenance + product model, strips personal host & redundant manufacturer', () => {
  const full = {
    type: 'tv', strength: 'strong', points: 82, source: 'mdns',
    services: ['googlecast'],
    host: 'Salotto di Mario', model: 'Chromecast Ultra', manufacturer: 'Google',
  };
  const pub = publicMdns(full);
  assert.deepEqual(pub, { type: 'tv', strength: 'strong', points: 82, source: 'mdns', services: ['googlecast'], model: 'Chromecast Ultra' });
  assert.equal('host' in pub, false, 'personal friendlyName is NOT exposed');
  assert.equal('manufacturer' in pub, false, 'redundant with vendor');
  assert.equal(pub.model, 'Chromecast Ultra', 'non-personal product model kept for the descriptive name');
  // defensive: non-object passes through unchanged
  assert.equal(publicMdns(null), null);
  assert.equal(publicMdns(undefined), undefined);
});
