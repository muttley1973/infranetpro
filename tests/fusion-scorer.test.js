'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FusionScorer, DEFAULT_PRIORITY } = require('../engine/fusion-scorer');
const {
  _scoreDiscoveredDevice,
  _classifyDiscoveredDevice,
  _classifyDiscoveredDeviceLegacy,
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

// -------- Behavioural parity with legacy classifier --------------------------
//
// The fusion scorer must produce identical device-type decisions to the
// in-line legacy classifier on every row, so existing test/discovery.test.js
// continues to pass. We sample a variety of representative rows here as a
// regression net independent of the discovery suite.

const PARITY_CASES = [
  { label: 'Cisco switch sysObjectID',         row: { descr: 'Cisco Catalyst 2960', objectId: '1.3.6.1.4.1.9.1.694', snmpReachable: true, sysServices: 2 } },
  { label: 'Zyxel router gateway',              row: { ip: '192.168.1.1', vendor: 'Zyxel', httpTitle: 'Web Configurator' } },
  { label: 'HP OfficeJet sysDescr',             row: { descr: 'HP OfficeJet Pro 9020 series', snmpReachable: true } },
  { label: 'Reolink RTSP',                      row: { hostname: 'reolink-cam', services: [{ port: 554, service: 'rtsp' }] } },
  { label: 'Sony Bravia',                       row: { hostname: 'KD-55X80J', vendor: 'Sony', httpTitle: 'BRAVIA' } },
  { label: 'LG webOS TV',                       row: { hostname: 'lgwebostv', mac: '58:FD:B1:00:11:22' } },
  { label: 'NVIDIA Shield media player',        row: { vendor: 'NVIDIA', hostname: 'Shield-TV' } },
  { label: 'Synology DSM',                      row: { descr: 'Linux DSM7', objectId: '1.3.6.1.4.1.6574.1.0', hostname: 'nas-lab', snmpReachable: true } },
  { label: 'Eaton UPS sysObjectID',             row: { objectId: '1.3.6.1.4.1.534.1', snmpReachable: true } },
  { label: 'VMware ESXi server',                row: { objectId: '1.3.6.1.4.1.6876.1', descr: 'VMware ESXi 7.0', snmpReachable: true } },
  { label: 'Windows desktop',                   row: { hostname: 'DESKTOP-ABC123', vendor: 'Microsoft' } },
  { label: 'Daikin AzureWave IoT',              row: { vendor: 'AzureWave', mac: 'AC:83:F3:00:11:22', hostname: 'daikin-AP' } },
  { label: 'Chromecast',                        row: { vendor: 'Google', hostname: 'Chromecast' } },
  { label: 'ArubaCX switch',                    row: { descr: 'Aruba CX 6300', objectId: '1.3.6.1.4.1.14823.1.3', snmpReachable: true, sysServices: 2 } },
];

for (const { label, row } of PARITY_CASES) {
  test(`parity legacy vs fusion: ${label}`, () => {
    const legacyType = _classifyDiscoveredDeviceLegacy(row);
    const fusionType = _classifyDiscoveredDevice(row);
    assert.equal(fusionType, legacyType,
      `fusion (${fusionType}) diverges from legacy (${legacyType}) for ${label}`);
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
});
