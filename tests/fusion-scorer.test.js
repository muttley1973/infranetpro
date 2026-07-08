'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FusionScorer, DEFAULT_PRIORITY } = require('../engine/fusion-scorer');
const {
  _scoreDiscoveredDevice,
  _classifyDiscoveredDevice,
} = require('../server/classify');

function makeScorer(options = {}) {
  return new FusionScorer(options);
}

test('FusionScorer: classify returns full structured result', () => {
  const scorer = makeScorer();
  const result = scorer.classify({
    descr: 'Cisco Catalyst 2960',
    objectId: '1.3.6.1.4.1.9.1.694',
    snmpReachable: true,
    sysServices: 2 | 4, // L2 + L3
    mac: '00:00:0c:11:22:33',
  });
  assert.equal(result.deviceType, 'switch');
  assert.ok(result.confidence >= 70, `confidence too low: ${result.confidence}`);
  assert.ok(Array.isArray(result.alternatives));
  assert.ok(Array.isArray(result.evidences));
  assert.ok(Array.isArray(result.reasons));
  assert.ok(Object.keys(result.scores).includes('switch'));
});

test('FusionScorer: confidence rises with multi-source agreement', () => {
  const scorer = makeScorer();
  // Single weak signal: just http title
  const weak = scorer.classify({ httpTitle: 'Generic Web' });
  // Strong sysObjectID + OUI + sysServices triangulating switch
  const strong = scorer.classify({
    descr: 'Cisco Catalyst 9300',
    objectId: '1.3.6.1.4.1.9.1.516',
    snmpReachable: true,
    sysServices: 2,
    mac: '00:00:0c:aa:bb:cc',
  }, {
    sysObjectInfo: { deviceType: 'switch', vendor: 'Cisco', confidence: 90 },
    ouiInfo: { deviceType: 'switch', vendor: 'Cisco', source: { priority: 100 } },
  });
  assert.ok(strong.confidence > weak.confidence + 30,
    `expected strong (${strong.confidence}) much greater than weak (${weak.confidence})`);
});

test('FusionScorer: alternatives are sorted by score and exclude winner', () => {
  const scorer = makeScorer();
  const result = scorer.classify({
    descr: 'fortigate firewall',
    snmpReachable: true,
    httpsTitle: 'FortiGate',
    sysServices: 4,
  });
  assert.equal(result.deviceType, 'firewall');
  assert.ok(result.alternatives.every(a => a.type !== 'firewall'));
  if (result.alternatives.length >= 2) {
    assert.ok(result.alternatives[0].score >= result.alternatives[1].score);
  }
});

test('FusionScorer: fallback chain when no signals (httpTitle → iot)', () => {
  const scorer = makeScorer();
  const result = scorer.classify({ httpTitle: 'Login' });
  assert.equal(result.deviceType, 'iot');
  assert.equal(result.confidence, 20);
});

test('FusionScorer: fallback chain when only SNMP signal (→ switch)', () => {
  const scorer = makeScorer();
  const result = scorer.classify({ snmpReachable: true });
  assert.equal(result.deviceType, 'switch');
  assert.equal(result.confidence, 25);
});

test('FusionScorer: fallback default → pc', () => {
  const scorer = makeScorer();
  const result = scorer.classify({});
  assert.equal(result.deviceType, 'pc');
  assert.equal(result.confidence, 15);
});

// --- Guardrail vendor≠tipo (Move 1): il NOME AZIENDA non decide il tipo ---------
// Regressione IANA-PEN: un vendor la cui ragione sociale contiene un sostantivo-tipo
// generico (gateway/switch/router/firewall) veniva tipizzato per quella parola.
test('FusionScorer: a generic type-noun in the VENDOR company name does NOT set type', () => {
  const scorer = makeScorer();
  // "Gateway Inc." è un vero produttore di PC: un host (L4+L7) non deve diventare router.
  const gw = scorer.classify({ vendor: 'Gateway Inc.', sysServices: 72, snmpReachable: true });
  assert.notEqual(gw.deviceType, 'router', 'vendor-name "gateway" must not force router');
  assert.equal(gw.deviceType, 'server');   // host via sysServices L4+L7
  // org letteralmente chiamata "SWITCH".
  const sw = scorer.classify({ vendor: 'SWITCH Communication', sysServices: 72, snmpReachable: true });
  assert.notEqual(sw.deviceType, 'switch', 'vendor-name "switch" must not force switch');
  // "Firewall Services".
  const fw = scorer.classify({ vendor: 'Firewall Services', sysServices: 72, snmpReachable: true });
  assert.notEqual(fw.deviceType, 'firewall', 'vendor-name "firewall" must not force firewall');
});

test('FusionScorer: real vendor BRAND tokens still drive type (guardrail keeps brands)', () => {
  const scorer = makeScorer();
  // Il brand reale sopravvive allo strip dei sostantivi generici.
  assert.equal(scorer.classify({ vendor: 'MikroTik', descr: 'RouterOS', sysServices: 78, snmpReachable: true }).deviceType, 'router');
  assert.equal(scorer.classify({ vendor: 'Fortinet', sysServices: 78, snmpReachable: true }).deviceType, 'firewall');
});

// --- Move 2: fallback MISURATO (sysServices) invece di indovinare 'switch' -------
test('FusionScorer: measured fallback — SNMP host (L4+L7) → server, bare responder → switch', () => {
  const scorer = makeScorer();
  assert.equal(scorer.classify({ sysServices: 72, snmpReachable: true }).deviceType, 'server');
  assert.equal(scorer.classify({ snmpReachable: true }).deviceType, 'switch'); // nessun layer → storico
});

// --- NetBIOS come segnale (deep-scan): host Windows = computer, mai apparato di rete --
test('FusionScorer: NetBIOS host → pc/server, mai apparato di rete; NAS non declassato', () => {
  const scorer = makeScorer();
  // workstation (nome NetBIOS) → pc
  assert.equal(scorer.classify({ netbiosName: 'DESKTOP-X', netbiosGroup: 'WORKGROUP', alive: true }).deviceType, 'pc');
  // <20> Server-service (file/print sharing) → server
  assert.equal(scorer.classify({ netbiosName: 'FILESRV', netbiosServer: true, alive: true }).deviceType, 'server');
  // Domain Controller (<1B>/<1C>) → server
  assert.equal(scorer.classify({ netbiosName: 'DC01', netbiosDomainCtrl: true, alive: true }).deviceType, 'server');
  // un NAS che espone <20> NON deve diventare server (il segnale nas vince)
  assert.equal(scorer.classify({ descr: 'Synology DiskStation', netbiosServer: true, sysServices: 72, snmpReachable: true }).deviceType, 'nas');
});

// --- SMB file-sharing host batte l'inferenza OUI-vendor (Canon/HP → printer) --------
// NetBIOS è morto sul Windows moderno (nbtstat non risponde); l'SMB (445+share, senza
// porte di stampa) è il segnale comportamentale reale che un PC Windows è un computer.
test('FusionScorer: SMB file-sharing host beats OUI-printer; print ports and NAS are respected', () => {
  const scorer = makeScorer();
  const ouiPrinter = { vendor: 'Canon', deviceType: 'printer', confidence: 88, source: { priority: 100 } };
  // OUI dice printer, ma 445 + WSD(5357) + share e NESSUNA porta di stampa → pc
  const host = scorer.classify(
    { services: [{ port: 443 }, { port: 445 }, { port: 5357 }], smbShares: [{ name: 'docs' }, { name: 'C$' }], alive: true },
    { ouiInfo: ouiPrinter });
  assert.equal(host.deviceType, 'pc');
  // una VERA stampante (porte di stampa 9100/631) NON viene toccata → resta printer
  const printer = scorer.classify(
    { services: [{ port: 445 }, { port: 9100 }, { port: 631 }], smbShares: [{ name: 'scan' }], alive: true },
    { ouiInfo: ouiPrinter });
  assert.equal(printer.deviceType, 'printer');
  // un NAS con condivisioni SMB resta NAS (il segnale nas vince, guard !score.nas)
  const nas = scorer.classify({ descr: 'Synology DiskStation', services: [{ port: 445 }], smbShares: [{ name: 'vol1' }], sysServices: 72, snmpReachable: true });
  assert.equal(nas.deviceType, 'nas');
});

// --- Move 3: sconto-per-contraddizione sulla confidenza -------------------------
test('FusionScorer: contradiction discount lowers confidence when runner-up is close', () => {
  const scorer = makeScorer();
  const close = scorer.classify({ sysServices: 2 | 4 | 64, snmpReachable: true }); // L2+L3+L7 → switch 35 vs router 25 (vicini)
  const clean = scorer.classify({ sysServices: 2, snmpReachable: true });          // L2 solo → switch 45, nessun rivale
  assert.equal(close.deviceType, 'switch');
  assert.equal(clean.deviceType, 'switch');
  assert.ok(clean.confidence > close.confidence,
    `runner-up vicino deve abbassare la confidenza: close=${close.confidence} clean=${clean.confidence}`);
});

test('FusionScorer: priority tie-break (firewall wins over router)', () => {
  const scorer = makeScorer({ priority: ['firewall', 'router'] });
  // Same score on firewall and router; firewall should win by priority
  const result = scorer.classify({}, {});
  // Empty row → pc fallback; verify with synthetic context instead:
  const synth = scorer.classify({
    descr: 'fortigate router gateway',
    snmpReachable: true,
  });
  // FortiGate triggers firewall regex (90), router words (80). Firewall wins.
  assert.equal(synth.deviceType, 'firewall');
});

test('FusionScorer: TV vs appliance brand-agnostic disambiguation', () => {
  const scorer = makeScorer();
  // LG webOS TV → tv
  const tv = scorer.classify({
    descr: 'LG webOS TV',
    hostname: 'lgwebostv-living',
    mac: '58:FD:B1:11:22:33',
  });
  assert.equal(tv.deviceType, 'tv');
  // LG washing machine → iot, NOT tv
  const washer = scorer.classify({
    descr: 'LG ThinQ washing machine',
    hostname: 'lg-washer',
  });
  assert.equal(washer.deviceType, 'iot');
});

test('FusionScorer: decision threshold can be overridden', () => {
  // Lower threshold so even weak signals commit
  const scorer = makeScorer({ decisionThreshold: 10 });
  const result = scorer.classify({
    descr: 'unknown',
    services: [{ port: 502, service: 'modbus' }],
  });
  // Modbus port → iot (35 points) above lowered threshold
  assert.equal(result.deviceType, 'iot');
});

test('FusionScorer: storage seam is accepted but unused', () => {
  const fakeStorage = { read: () => null, write: () => null };
  const scorer = makeScorer({ storage: fakeStorage });
  assert.equal(scorer.storage, fakeStorage);
  const result = scorer.classify({ snmpReachable: true });
  assert.equal(result.deviceType, 'switch');
});

test('FusionScorer: a plugin match without a type ("unknown") never becomes the device type', () => {
  const scorer = makeScorer();
  // SysObjectEngine.normalizeRecord defaults deviceType to 'unknown' when a
  // plugin matches (status:found) but its enrich() returns no type. That must
  // NOT be scored as a device type: 'unknown' is not a valid app type and would
  // be a high-confidence non-type invention (violates the no-invention rule).
  const result = scorer.classify(
    { httpTitle: 'Some Web UI' },   // only a weak fallback signal
    { sysObjectInfo: { deviceType: 'unknown', vendor: 'ACME', confidence: 95 } }
  );
  assert.notEqual(result.deviceType, 'unknown');
  assert.ok(!Object.keys(result.scores).includes('unknown'),
    `'unknown' must not appear as a scored type: ${JSON.stringify(result.scores)}`);
});

test('FusionScorer: LG webOS TV recognized by MAC prefix even with the default normMac', () => {
  const scorer = makeScorer();
  // No TV text at all: the only TV signal is the LG OUI prefix 58:FD:B1. When
  // the caller does not pass a normMac, the built-in default must still match the
  // (uppercase) prefix literal used in the rule — otherwise the signal is dead
  // off the production path.
  const result = scorer.classify({ mac: '58:FD:B1:00:11:22' });   // no ctx.normMac
  assert.equal(result.deviceType, 'tv',
    `expected tv from the LG MAC prefix, got ${result.deviceType} (scores ${JSON.stringify(result.scores)})`);
});

test('shared OID table: server now recognizes vendors it previously missed (Lexmark, Grandstream)', () => {
  // Before the shared lib/device-signatures table, the server had no OID prefix
  // for Lexmark (641) or Grandstream VoIP (25858), so these fell to the 'switch'
  // hasSnmpSignal fallback. Now the canonical table votes them.
  const lex = { objectId: '1.3.6.1.4.1.641.1.1', snmpReachable: true };
  const gs  = { objectId: '1.3.6.1.4.1.25858.2', snmpReachable: true };
  assert.equal(_classifyDiscoveredDevice(lex), 'printer');
  assert.equal(_classifyDiscoveredDevice(gs), 'voip');
});

// -------- Representative device-type freeze (authoritative classifier) --------
//
// The in-line "legacy twin" classifier was removed once the fusion scorer became
// the single authoritative path (commit: one authoritative classifier). These
// rows used to prove fusion == legacy; they are kept as a golden-style freeze of
// the fusion scorer's decisions — a compact regression net alongside the broader
// tests/classify-golden.test.js. A deliberate behaviour change updates the
// expected type here in the same commit.

const FREEZE_CASES = [
  { label: 'Cisco switch sysObjectID',         expect: 'switch',    row: { descr: 'Cisco Catalyst 2960', objectId: '1.3.6.1.4.1.9.1.694', snmpReachable: true, sysServices: 2 } },
  { label: 'Zyxel router gateway',              expect: 'router',    row: { ip: '192.168.1.1', vendor: 'Zyxel', httpTitle: 'Web Configurator' } },
  { label: 'HP OfficeJet sysDescr',             expect: 'printer',   row: { descr: 'HP OfficeJet Pro 9020 series', snmpReachable: true } },
  { label: 'Reolink RTSP',                      expect: 'webcam',    row: { hostname: 'reolink-cam', services: [{ port: 554, service: 'rtsp' }] } },
  { label: 'Sony Bravia',                       expect: 'tv',        row: { hostname: 'KD-55X80J', vendor: 'Sony', httpTitle: 'BRAVIA' } },
  { label: 'LG webOS TV',                       expect: 'tv',        row: { hostname: 'lgwebostv', mac: '58:FD:B1:00:11:22' } },
  { label: 'NVIDIA Shield media player',        expect: 'tv',        row: { vendor: 'NVIDIA', hostname: 'Shield-TV' } },
  { label: 'Synology DSM',                      expect: 'nas',       row: { descr: 'Linux DSM7', objectId: '1.3.6.1.4.1.6574.1.0', hostname: 'nas-lab', snmpReachable: true } },
  { label: 'Eaton UPS sysObjectID',             expect: 'ups',       row: { objectId: '1.3.6.1.4.1.534.1', snmpReachable: true } },
  { label: 'VMware ESXi server',                expect: 'hypervisor', row: { objectId: '1.3.6.1.4.1.6876.1', descr: 'VMware ESXi 7.0', snmpReachable: true } },
  { label: 'Windows desktop',                   expect: 'pc',        row: { hostname: 'DESKTOP-ABC123', vendor: 'Microsoft' } },
  { label: 'Daikin AzureWave IoT',              expect: 'iot',       row: { vendor: 'AzureWave', mac: 'AC:83:F3:00:11:22', hostname: 'daikin-AP' } },
  { label: 'Chromecast',                        expect: 'tv',        row: { vendor: 'Google', hostname: 'Chromecast' } },
  { label: 'ArubaCX switch',                    expect: 'switch',    row: { descr: 'Aruba CX 6300', objectId: '1.3.6.1.4.1.14823.1.3', snmpReachable: true, sysServices: 2 } },
  { label: 'Google Cast device (probe)',        expect: 'tv',        row: { vendor: 'NVIDIA', hostname: 'SHIELD', cast: true, services: [{ port: 8008 }] } },
  { label: 'Zyxel switch by banner (not OUI)',  expect: 'switch',    row: { mac: 'bc:cf:4f:00:00:10', vendor: 'Zyxel', httpTitle: 'Intelligent Switch' } },
  { label: 'Android tablet fingerprint',        expect: 'mobile',    row: { vendor: 'Huawei', mac: 'f4:bf:80:11:22:33' } },
  { label: 'iPhone by hostname',                expect: 'mobile',    row: { hostname: 'iPhone-di-Anna', vendor: 'Apple' } },
  { label: 'Arista L3 switch (sysObjectID)',    expect: 'switch',    row: { objectId: '1.3.6.1.4.1.30065.1.2759', descr: 'Arista Networks EOS running on vEOS', sysServices: 2 | 4 | 8, snmpReachable: true, hostname: 'lab-switch' } },
  { label: 'Cisco WLAN controller',             expect: 'wlanctrl',  row: { objectId: '1.3.6.1.4.1.9.1.1631', descr: 'Cisco Controller', sysServices: 2, snmpReachable: true } },
  { label: 'Cisco IOS switch (not Apple iOS)',  expect: 'switch',    row: { descr: 'Cisco IOS Software, vios_l2', sysServices: 2, snmpReachable: true } },
];

for (const { label, expect, row } of FREEZE_CASES) {
  test(`fusion freeze: ${label} -> ${expect}`, () => {
    assert.equal(_classifyDiscoveredDevice(row), expect);
  });
}

test('_scoreDiscoveredDevice returns structured result with reasons', () => {
  const result = _scoreDiscoveredDevice({
    descr: 'Cisco Catalyst 9300',
    objectId: '1.3.6.1.4.1.9.1.516',
    snmpReachable: true,
    sysServices: 2,
    mac: '00:00:0c:aa:bb:cc',
  });
  assert.equal(result.deviceType, 'switch');
  assert.ok(result.confidence > 70);
  assert.ok(result.reasons.length >= 1);
  assert.ok(result.evidences.length >= 1);
});

test('DEFAULT_PRIORITY is exported and stable', () => {
  assert.ok(Array.isArray(DEFAULT_PRIORITY));
  assert.equal(DEFAULT_PRIORITY[0], 'firewall');
  assert.equal(DEFAULT_PRIORITY[DEFAULT_PRIORITY.length - 1], 'pc');
  assert.ok(DEFAULT_PRIORITY.includes('mobile'), 'mobile type registered in priority');
});

// -------- Vendor-neutral classification rules (driven by a real LAN scan) -----
// The identity of the MAC vendor is a CANDIDATE, never the device type; the type is
// decided by the strongest MEASURED signal. These lock in that method generally, so
// no per-vendor hack can creep back in.

test('G1: an OUI vendor deviceType never outranks a measured banner', () => {
  // Zyxel OUI (plugin default = router) but the web banner reads "Intelligent
  // Switch": the measured banner (78) must beat the vendor-identity (<=45).
  const r = _scoreDiscoveredDevice({ mac: 'bc:cf:4f:00:00:10', vendor: 'Zyxel', httpTitle: 'Intelligent Switch', alive: true });
  assert.equal(r.deviceType, 'switch');
  // Zyxel gateway (banner names no model) stays router via the gateway-ip rule.
  const gw = _scoreDiscoveredDevice({ ip: '192.168.1.1', mac: 'bc:cf:4f:00:00:01', vendor: 'Zyxel', httpTitle: 'Web-Based Configurator', alive: true });
  assert.equal(gw.deviceType, 'router');
});

test('G2: Google Cast (probe or control ports) classifies as tv, vendor-neutral', () => {
  assert.equal(_scoreDiscoveredDevice({ vendor: 'Google', cast: true, services: [{ port: 8008 }, { port: 8009 }], alive: true }).deviceType, 'tv');
  assert.equal(_scoreDiscoveredDevice({ vendor: 'NVIDIA', cast: true, services: [{ port: 445 }, { port: 8008 }], alive: true }).deviceType, 'tv');
  // cast control ports alone (no probe) still lean tv
  assert.equal(_scoreDiscoveredDevice({ services: [{ port: 8008 }, { port: 8009 }], alive: true }).deviceType, 'tv');
});

test('G3: Android/iOS fingerprint classifies as mobile; a Mac stays pc', () => {
  assert.equal(_scoreDiscoveredDevice({ hostname: 'iPhone-di-Mario', vendor: 'Apple', alive: true }).deviceType, 'mobile');
  assert.equal(_scoreDiscoveredDevice({ vendor: 'Huawei', mac: 'f4:bf:80:11:22:33', alive: true }).deviceType, 'mobile');
  assert.equal(_scoreDiscoveredDevice({ descr: 'Android', alive: true }).deviceType, 'mobile');
  assert.equal(_scoreDiscoveredDevice({ hostname: 'MacBook-Pro', vendor: 'Apple', alive: true }).deviceType, 'pc');
});

test('G4: no measured signal caps confidence; a measured signal does not', () => {
  const guess = _scoreDiscoveredDevice({ vendor: 'Huawei', mac: 'f4:bf:80:44:55:66', alive: true });
  assert.ok(guess.confidence <= 60, `vendor/OS-only guess must be honest, got ${guess.confidence}`);
  const measured = _scoreDiscoveredDevice({ vendor: 'Synology', httpTitle: 'Synology DiskStation', services: [{ port: 5000 }], alive: true });
  assert.ok(measured.confidence > 60, `a measured signal must not be capped, got ${measured.confidence}`);
});

test('G5: L2+L3 is a multilayer switch, not a router (sysServices)', () => {
  // Arista vEOS reports L2+L3(+L4); with an Arista sysObjectID plugin -> switch, high conf.
  const arista = _scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.30065.1.2759', descr: 'Arista Networks EOS running on vEOS', sysServices: 2 | 4 | 8, snmpReachable: true, hostname: 'lab-switch' });
  assert.equal(arista.deviceType, 'switch');
  assert.ok(arista.confidence >= 90, `Arista should be confidently a switch, got ${arista.confidence}`);
  // A PURE L3 device (no L2) is still a router.
  assert.equal(_scoreDiscoveredDevice({ sysServices: 4, snmpReachable: true }).deviceType, 'router');
});

test('G6: a WLAN controller classifies as wlanctrl, not switch (vendor-neutral)', () => {
  // Cisco AireOS: sysDescr "Cisco Controller", sysServices L2, Cisco OID.
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.9.1.1631', descr: 'Cisco Controller', sysServices: 2, snmpReachable: true }).deviceType, 'wlanctrl');
  // Not brand-locked: an Aruba mobility controller too.
  assert.equal(_scoreDiscoveredDevice({ descr: 'ArubaOS Mobility Controller', snmpReachable: true }).deviceType, 'wlanctrl');
});

test('G7: Cisco IOS is not mistaken for Apple iOS (mobile)', () => {
  const r = _scoreDiscoveredDevice({ descr: 'Cisco IOS Software, vios_l2', sysServices: 2, snmpReachable: true });
  assert.notEqual(r.deviceType, 'mobile');
  assert.equal(r.deviceType, 'switch');
});

// SNMP::Info-derived sysObjectID coverage (canonical lib/device-signatures.js): a
// single-purpose vendor with NO dedicated plugin is recognized from its sysObjectID.
test('G8: SNMP::Info sysObjectID coverage for plugin-less vendors', () => {
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.2620.1.1', sysServices: 4, snmpReachable: true }).deviceType, 'firewall'); // Check Point
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.25506.1', sysServices: 2, snmpReachable: true }).deviceType, 'switch');   // H3C
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.14525.1', snmpReachable: true }).deviceType, 'wlanctrl');                  // Trapeze WLC
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.17163.1', snmpReachable: true }).deviceType, 'sdwan');                     // Steelhead
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.30803.1', sysServices: 4, snmpReachable: true }).deviceType, 'router');    // VyOS
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.476.1', snmpReachable: true }).deviceType, 'ups');                         // Liebert
  // A measured banner still overrides the enterprise-level OID vote (vendor != type).
  assert.equal(_scoreDiscoveredDevice({ objectId: '1.3.6.1.4.1.1916.2', descr: 'AXIS Network Camera', snmpReachable: true }).deviceType, 'webcam');
});
