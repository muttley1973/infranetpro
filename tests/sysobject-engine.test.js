'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { SysObjectEngine } = require('../engine');

test('isolated instances resolve independently from different plugin directories', () => {
  const dirA = makeTempDir();
  const dirB = makeTempDir();
  writePlugin(dirA, 'vendor.js', {
    prefix: '1.3.6.1.4.1.1000',
    vendor: 'Vendor A',
    type: 'switch',
  });
  writePlugin(dirB, 'vendor.js', {
    prefix: '1.3.6.1.4.1.2000',
    vendor: 'Vendor B',
    type: 'router',
  });

  const engineA = new SysObjectEngine({ pluginDir: dirA, watch: false, logger: silentLogger() });
  const engineB = new SysObjectEngine({ pluginDir: dirB, watch: false, logger: silentLogger() });

  try {
    assert.equal(engineA.resolve('1.3.6.1.4.1.1000.1').vendor, 'Vendor A');
    assert.equal(engineA.resolve('1.3.6.1.4.1.2000.1').status, 'not_found');
    assert.equal(engineB.resolve('1.3.6.1.4.1.2000.1').vendor, 'Vendor B');
    assert.equal(engineB.resolve('1.3.6.1.4.1.1000.1').status, 'not_found');
  } finally {
    engineA.close();
    engineB.close();
    removeTempDir(dirA);
    removeTempDir(dirB);
  }
});

test('longest-prefix-wins over broader vendor plugins', () => {
  const dir = makeTempDir();
  writePlugin(dir, 'broad.js', {
    prefix: '1.3.6.1.4.1.9',
    vendor: 'Broad Cisco',
    type: 'router',
  });
  writePlugin(dir, 'specific.js', {
    prefix: '1.3.6.1.4.1.9.1',
    vendor: 'Specific Cisco',
    type: 'switch',
  });

  const engine = new SysObjectEngine({ pluginDir: dir, watch: false, logger: silentLogger() });

  try {
    const result = engine.resolve('1.3.6.1.4.1.9.1.516');
    assert.equal(result.status, 'found');
    assert.equal(result.vendor, 'Specific Cisco');
    assert.equal(result.deviceType, 'switch');
  } finally {
    engine.close();
    removeTempDir(dir);
  }
});

test('hot-reload registers added plugins and unregisters removed plugins', async () => {
  const dir = makeTempDir();
  const engine = new SysObjectEngine({ pluginDir: dir, watch: true, watchDebounceMs: 25, logger: silentLogger() });

  try {
    assert.equal(engine.resolve('1.3.6.1.4.1.3000.1').status, 'not_found');

    const file = writePlugin(dir, 'hot.js', {
      prefix: '1.3.6.1.4.1.3000',
      vendor: 'Hot Vendor',
      type: 'ap',
    });

    const added = await waitFor(() => engine.resolve('1.3.6.1.4.1.3000.1').status === 'found', 500);
    assert.equal(added, true);
    assert.equal(engine.resolve('1.3.6.1.4.1.3000.1').vendor, 'Hot Vendor');

    fs.unlinkSync(file);
    const removed = await waitFor(() => engine.resolve('1.3.6.1.4.1.3000.1').status === 'not_found', 500);
    assert.equal(removed, true);
  } finally {
    engine.close();
    removeTempDir(dir);
  }
});

test('plugin load failure is isolated and valid plugins continue resolving', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'broken.js'), "'use strict';\nthrow new Error('boom on load');\n", 'utf8');
  writePlugin(dir, 'good.js', {
    prefix: '1.3.6.1.4.1.4000',
    vendor: 'Good Vendor',
    type: 'nas',
  });
  const errors = [];
  const engine = new SysObjectEngine({ pluginDir: dir, watch: false, logger: captureLogger(errors) });

  try {
    assert.equal(engine.resolve('1.3.6.1.4.1.4000.1').vendor, 'Good Vendor');
    assert.equal(errors.some(line => line.includes('Plugin load skipped')), true);
  } finally {
    engine.close();
    removeTempDir(dir);
  }
});

test('plugin enrich failure returns null without crashing the engine', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'throws.js'), [
    "'use strict';",
    "const vendorPrefix = '1.3.6.1.4.1.5000';",
    "function match(oid) { return oid.startsWith(vendorPrefix); }",
    "function enrich() { throw new Error('boom on enrich'); }",
    'module.exports = { vendorPrefix, match, enrich };',
    '',
  ].join('\n'), 'utf8');
  const engine = new SysObjectEngine({ pluginDir: dir, watch: false, logger: silentLogger() });

  try {
    assert.equal(engine.resolve('1.3.6.1.4.1.5000.1'), null);
  } finally {
    engine.close();
    removeTempDir(dir);
  }
});

test('malformed OIDs return structured NotFound', () => {
  const dir = makeTempDir();
  const engine = new SysObjectEngine({ pluginDir: dir, watch: false, logger: silentLogger() });

  try {
    assert.deepEqual(engine.resolve('not an oid'), {
      status: 'not_found',
      oid: 'not an oid',
      reason: 'invalid_oid',
    });
  } finally {
    engine.close();
    removeTempDir(dir);
  }
});

test('seed catalog resolves major vendor sysObjectIDs', () => {
  const pluginDir = path.resolve(__dirname, '..', 'plugins');
  const engine = new SysObjectEngine({ pluginDir, watch: false, logger: silentLogger() });

  try {
    assert.equal(engine.resolve('1.3.6.1.4.1.14988.1.1', { descr: 'RouterOS CCR2004' }).deviceType, 'router');
    assert.equal(engine.resolve('1.3.6.1.4.1.6574.1', { hostname: 'DiskStation' }).deviceType, 'nas');
    assert.equal(engine.resolve('1.3.6.1.4.1.890.1.5.8', { descr: 'Zyxel GS1900' }).deviceType, 'switch');
    assert.equal(engine.resolve('1.3.6.1.4.1.12356.101.1', { descr: 'FortiGate' }).deviceType, 'firewall');
    assert.equal(engine.resolve('1.3.6.1.4.1.41112.1.4.1', { descr: 'UniFi AP' }).deviceType, 'ap');
  } finally {
    engine.close();
  }
});

test('seed catalog resolves OS agent sysObjectIDs and context fingerprints', () => {
  const pluginDir = path.resolve(__dirname, '..', 'plugins');
  const engine = new SysObjectEngine({ pluginDir, watch: false, logger: silentLogger() });

  try {
    const windows = engine.resolve('1.3.6.1.4.1.311.1.1.3.1.1', { descr: 'Microsoft Windows Server 2022' });
    assert.equal(windows.deviceType, 'server');
    assert.equal(windows.os.family, 'windows');

    const linux = engine.resolve('1.3.6.1.4.1.8072.3.2.10', { descr: 'Linux pve 6.8 Proxmox' });
    assert.equal(linux.deviceType, 'server');
    assert.equal(linux.os.name, 'Proxmox VE');

    const apple = engine.fingerprint({ vendor: 'Apple', hostname: 'MacBook-Pro' });
    assert.equal(apple.os.family, 'macos');

    const androidTv = engine.fingerprint({ descr: 'Sony BRAVIA Android TV' });
    assert.equal(androidTv.deviceType, 'tv');
    assert.equal(androidTv.os.family, 'android');
  } finally {
    engine.close();
  }
});

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-sysobject-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writePlugin(dir, name, options) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [
    "'use strict';",
    `const vendorPrefix = '${options.prefix}';`,
    "function match(oid) { return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`); }",
    'function enrich() {',
    '  return {',
    `    vendor: '${options.vendor}',`,
    `    deviceType: '${options.type}',`,
    `    family: '${options.vendor} Family',`,
    '    confidence: 99,',
    `    tags: ['test', '${options.type}'],`,
    `    infranet: { deviceType: '${options.type}', sourcePriority: 'sysObjectID' },`,
    '  };',
    '}',
    'module.exports = { vendorPrefix, match, enrich };',
    '',
  ].join('\n'), 'utf8');
  return file;
}

function silentLogger() {
  return { error() {} };
}

function captureLogger(errors) {
  return { error(...args) { errors.push(args.join(' ')); } };
}

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}
