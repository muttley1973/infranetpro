'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { OuiEngine, normalizeMac, normalizePrefixKey } = require('../engine/oui-engine');

const PROD_PLUGIN_DIR = path.resolve(__dirname, '..', 'plugins', 'oui');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oui-engine-test-'));
}

function writePlugin(dir, name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

function basicPlugin({ prefixes, vendor, deviceType = 'switch', priority = 100, extra = '' }) {
  const arr = JSON.stringify(prefixes);
  return `
'use strict';
module.exports = {
  ouiPrefixes: ${arr},
  priority: ${priority},
  match: () => true,
  enrich: () => ({ vendor: ${JSON.stringify(vendor)}, deviceType: ${JSON.stringify(deviceType)}${extra} }),
};
`;
}

test('normalizeMac accepts common MAC formats', () => {
  assert.equal(normalizeMac('aa:bb:cc:dd:ee:ff'), 'AABBCCDDEEFF');
  assert.equal(normalizeMac('AA-BB-CC-DD-EE-FF'), 'AABBCCDDEEFF');
  assert.equal(normalizeMac('aabb.ccdd.eeff'),    'AABBCCDDEEFF');
  assert.equal(normalizeMac('AABBCCDDEEFF'),      'AABBCCDDEEFF');
  assert.equal(normalizeMac(''),                  '');
  assert.equal(normalizeMac(null),                '');
  // Garbage input keeps the hex-valid characters; lookup() guards against
  // anything that does not normalize to 12 chars.
  assert.notEqual(normalizeMac('not a mac').length, 12);
  assert.notEqual(normalizeMac('xyz').length,       12);
});

test('normalizePrefixKey accepts 2..12 hex chars', () => {
  assert.equal(normalizePrefixKey('00:50:56'),       '005056');         // 6 char MA-L
  assert.equal(normalizePrefixKey('001132F'),        '001132F');        // 7 char MA-M
  assert.equal(normalizePrefixKey('00:11:32:23:0'),  '001132230');      // 9 char MA-S
  assert.equal(normalizePrefixKey('0242'),           '0242');           // 4 char Docker-style
  assert.equal(normalizePrefixKey(''),               '');
  assert.equal(normalizePrefixKey('1'),              '');               // too short (< 2)
  assert.equal(normalizePrefixKey('GG:HH'),          '');               // invalid hex
});

test('isolated instances resolve independently', () => {
  const dirA = makeTempDir();
  const dirB = makeTempDir();
  try {
    writePlugin(dirA, 'a.js', basicPlugin({ prefixes: ['AABBCC'], vendor: 'VendorA' }));
    writePlugin(dirB, 'b.js', basicPlugin({ prefixes: ['AABBCC'], vendor: 'VendorB' }));
    const engA = new OuiEngine({ pluginDir: dirA, watch: false });
    const engB = new OuiEngine({ pluginDir: dirB, watch: false });
    assert.equal(engA.lookup('aa:bb:cc:11:22:33').vendor, 'VendorA');
    assert.equal(engB.lookup('aa:bb:cc:11:22:33').vendor, 'VendorB');
    engA.close(); engB.close();
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('longest-prefix wins regardless of plugin order', () => {
  const dir = makeTempDir();
  try {
    writePlugin(dir, 'broad.js',    basicPlugin({ prefixes: ['001132'],    vendor: 'BroadVendor' }));
    writePlugin(dir, 'specific.js', basicPlugin({ prefixes: ['00113223'],  vendor: 'SpecificVendor' }));
    const engine = new OuiEngine({ pluginDir: dir, watch: false });
    assert.equal(engine.lookup('00:11:32:23:aa:bb').vendor, 'SpecificVendor');
    assert.equal(engine.lookup('00:11:32:99:aa:bb').vendor, 'BroadVendor');
    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('higher priority plugin beats lower priority on same prefix length', () => {
  const dir = makeTempDir();
  try {
    writePlugin(dir, 'low.js',  basicPlugin({ prefixes: ['005056'], vendor: 'Generic', priority: 10 }));
    writePlugin(dir, 'high.js', basicPlugin({ prefixes: ['005056'], vendor: 'VMware',  priority: 100 }));
    const engine = new OuiEngine({ pluginDir: dir, watch: false });
    assert.equal(engine.lookup('00:50:56:aa:bb:cc').vendor, 'VMware');
    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('plugin load failure is isolated and engine keeps working', () => {
  const dir = makeTempDir();
  try {
    writePlugin(dir, 'good.js', basicPlugin({ prefixes: ['AABBCC'], vendor: 'Good' }));
    writePlugin(dir, 'broken.js', `module.exports = { ouiPrefixes: 'invalid', match: 1, enrich: 2 };`);
    const errors = [];
    const engine = new OuiEngine({
      pluginDir: dir, watch: false,
      logger: { error: (msg, err) => errors.push(`${msg}: ${err}`) }
    });
    assert.equal(engine.lookup('aa:bb:cc:11:22:33').vendor, 'Good');
    assert.ok(errors.length >= 1, 'broken plugin should log error');
    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('plugin enrich failure returns null without crashing engine', () => {
  const dir = makeTempDir();
  try {
    writePlugin(dir, 'crash.js', `
      'use strict';
      module.exports = {
        ouiPrefixes: ['AABBCC'],
        match: () => true,
        enrich: () => { throw new Error('boom'); },
      };
    `);
    const errors = [];
    const engine = new OuiEngine({
      pluginDir: dir, watch: false,
      logger: { error: (msg, err) => errors.push(`${msg}: ${err}`) }
    });
    const result = engine.lookup('aa:bb:cc:11:22:33');
    assert.equal(result, null);
    assert.ok(errors.some(e => /enrich failed/i.test(e)));
    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hot-reload registers added plugins and unregisters removed ones', () => {
  const dir = makeTempDir();
  try {
    const engine = new OuiEngine({ pluginDir: dir, watch: false });
    assert.equal(engine.lookup('aa:bb:cc:11:22:33').status, 'not_found');

    writePlugin(dir, 'added.js', basicPlugin({ prefixes: ['AABBCC'], vendor: 'Added' }));
    engine.refresh();
    assert.equal(engine.lookup('aa:bb:cc:11:22:33').vendor, 'Added');

    fs.unlinkSync(path.join(dir, 'added.js'));
    engine.refresh();
    assert.equal(engine.lookup('aa:bb:cc:11:22:33').status, 'not_found');
    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid MAC returns structured not_found', () => {
  const engine = new OuiEngine({ pluginDir: PROD_PLUGIN_DIR, watch: false });
  try {
    const result = engine.lookup('not-a-mac');
    assert.equal(result.status, 'not_found');
    assert.equal(result.reason, 'invalid_mac');
  } finally {
    engine.close();
  }
});

test('seed catalog classifies major virtual ranges', () => {
  const engine = new OuiEngine({ pluginDir: PROD_PLUGIN_DIR, watch: false });
  try {
    assert.equal(engine.getVendor('00:50:56:00:11:22'), 'VMware');
    assert.equal(engine.getVendor('00:0c:29:00:11:22'), 'VMware');
    assert.equal(engine.getVendor('00:15:5d:00:11:22'), 'Microsoft');
    assert.equal(engine.getVendor('00:16:3e:00:11:22'), 'XenSource');
    assert.equal(engine.getVendor('52:54:00:00:11:22'), 'QEMU / KVM');
    assert.equal(engine.getVendor('02:42:ac:00:11:22'), 'Docker');

    assert.equal(engine.isVirtual('00:50:56:11:22:33'), true);
    assert.equal(engine.isVirtual('00:00:0c:11:22:33'), false, 'Cisco physical NIC');
  } finally {
    engine.close();
  }
});

test('seed catalog classifies common vendors with deviceType', () => {
  const engine = new OuiEngine({ pluginDir: PROD_PLUGIN_DIR, watch: false });
  try {
    const cisco = engine.lookup('00:00:0c:aa:bb:cc');
    assert.equal(cisco.vendor, 'Cisco Systems');
    assert.equal(cisco.deviceType, 'switch');

    const apple = engine.lookup('00:03:93:aa:bb:cc');
    assert.equal(apple.vendor, 'Apple');
    assert.equal(apple.deviceType, 'pc');

    const lgTv = engine.lookup('58:fd:b1:aa:bb:cc');
    assert.equal(lgTv.vendor, 'LG Electronics');
    assert.equal(lgTv.deviceType, 'tv');

    const reolink = engine.lookup('78:c1:cf:aa:bb:cc');
    assert.equal(reolink.deviceType, 'webcam');

    const mikrotik = engine.lookup('4c:5e:0c:aa:bb:cc');
    assert.equal(mikrotik.vendor, 'MikroTik');
  } finally {
    engine.close();
  }
});

test('IEEE database plugin covers vendors without specific plugin', () => {
  const engine = new OuiEngine({ pluginDir: PROD_PLUGIN_DIR, watch: false });
  try {
    // Raspberry Pi Foundation (B8:27:EB) — present in IEEE registry, no specific plugin
    const rpi = engine.lookup('b8:27:eb:aa:bb:cc');
    assert.equal(rpi.status, 'found');
    assert.match(rpi.vendor, /Raspberry/i);
    assert.equal(rpi.source.priority, 0, 'should come from IEEE fallback plugin');
  } finally {
    engine.close();
  }
});

test('isLocallyAdministered detects bit 1 of first byte', () => {
  const engine = new OuiEngine({ pluginDir: PROD_PLUGIN_DIR, watch: false });
  try {
    assert.equal(engine.isLocallyAdministered('02:42:ac:11:00:02'), true);
    assert.equal(engine.isLocallyAdministered('52:54:00:00:11:22'), true);
    assert.equal(engine.isLocallyAdministered('00:00:0c:00:00:00'), false);
  } finally {
    engine.close();
  }
});

test('isMulticast detects bit 0 of first byte', () => {
  const engine = new OuiEngine({ pluginDir: PROD_PLUGIN_DIR, watch: false });
  try {
    assert.equal(engine.isMulticast('01:00:5e:00:00:01'), true);
    assert.equal(engine.isMulticast('ff:ff:ff:ff:ff:ff'), true);
    assert.equal(engine.isMulticast('00:00:0c:00:00:00'), false);
  } finally {
    engine.close();
  }
});

test('trie: longest-prefix-wins on overlapping plugins', () => {
  const dir = makeTempDir();
  try {
    // 6-char prefix common to two plugins; only the 8-char variant gives
    // an unambiguous more-specific match.
    writePlugin(dir, 'broad.js',    basicPlugin({ prefixes: ['001132'],    vendor: 'BroadOEM' }));
    writePlugin(dir, 'narrower.js', basicPlugin({ prefixes: ['001132AB'],  vendor: 'NarrowOEM' }));
    writePlugin(dir, 'narrowest.js',basicPlugin({ prefixes: ['001132ABCD'],vendor: 'NarrowestOEM' }));
    const engine = new OuiEngine({ pluginDir: dir, watch: false });

    assert.equal(engine.lookup('00:11:32:ab:cd:ef').vendor, 'NarrowestOEM');
    assert.equal(engine.lookup('00:11:32:ab:99:99').vendor, 'NarrowOEM');
    assert.equal(engine.lookup('00:11:32:99:99:99').vendor, 'BroadOEM');
    assert.equal(engine.lookup('00:11:33:99:99:99').status, 'not_found');

    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trie: priority desc wins within same-depth node', () => {
  const dir = makeTempDir();
  try {
    writePlugin(dir, 'low.js',  basicPlugin({ prefixes: ['001132'], vendor: 'LowPrio',  priority: 50 }));
    writePlugin(dir, 'high.js', basicPlugin({ prefixes: ['001132'], vendor: 'HighPrio', priority: 100 }));
    const engine = new OuiEngine({ pluginDir: dir, watch: false });
    assert.equal(engine.lookup('00:11:32:ab:cd:ef').vendor, 'HighPrio');
    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trie: fallback through shorter prefix when longer match has no plugin', () => {
  const dir = makeTempDir();
  try {
    // Only a 6-char prefix; the trie must keep walking and fall back from
    // longer (no match) to shorter (match) within a single lookup.
    writePlugin(dir, 'p.js', basicPlugin({ prefixes: ['001132'], vendor: 'PartialMatch' }));
    const engine = new OuiEngine({ pluginDir: dir, watch: false });
    assert.equal(engine.lookup('00:11:32:ff:ff:ff').vendor, 'PartialMatch');
    engine.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
