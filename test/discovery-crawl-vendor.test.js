'use strict';
// Regressione VENDOR nel crawl LLDP/CDP: un device scoperto via crawl deve
// CONSERVARE il vendor gia' risolto dal backend (da sysObjectID / PEN), non
// azzerarlo. Il bug era `vendor:''` (e `mac:''`) messi DOPO lo spread `...device`
// in _runCrawlPhase → ogni vicino usciva con Vendor "—". _discCrawlRow e' la
// mappatura pura estratta; la testiamo via la DOM-stub harness (bare global
// esposto da expose()).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (crawl-vendor)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('crawl: il vendor risolto dal backend (Cisco/PEN 9) NON viene azzerato', () => {
  const r = JSON.parse(run(APP.ctx, `JSON.stringify(_discCrawlRow({
    ip:'10.10.99.11', hostname:'SW-ACC1', vendor:'Cisco',
    objectId:'1.3.6.1.4.1.9.1.1227', deviceClass:'switch', descr:'Cisco IOS'
  }, 'CDP'))`));
  assert.equal(r.vendor, 'Cisco', 'vendor preservato (era il bug: veniva svuotato)');
  assert.equal(r.viaProtocol, 'CDP', 'protocollo di scoperta propagato');
  assert.equal(r.snmpReachable, true);
  assert.equal(r.objectId, '1.3.6.1.4.1.9.1.1227', 'objectId conservato');
  assert.equal(r.hostname, 'SW-ACC1', 'hostname conservato');
});

test('crawl: device senza vendor resta con vendor vuoto (default innocuo)', () => {
  const r = JSON.parse(run(APP.ctx, `JSON.stringify(_discCrawlRow({
    ip:'10.10.99.22', hostname:'RTR-VYOS', objectId:'1.3.6.1.4.1.44641'
  }, 'LLDP'))`));
  assert.equal(r.vendor, '', 'nessun vendor dal backend -> stringa vuota, non undefined');
  assert.equal(r.viaProtocol, 'LLDP');
  assert.equal(r.mac, '', 'mac assente -> default vuoto');
});

test('crawl: viaProtocol dal device ha priorita sul protocol del wrapper', () => {
  const r = JSON.parse(run(APP.ctx, `JSON.stringify(_discCrawlRow({
    ip:'10.10.99.12', viaProtocol:'LLDP', vendor:'Cisco'
  }, 'CDP'))`));
  assert.equal(r.viaProtocol, 'LLDP', 'viaProtocol gia presente sul device vince');
  assert.equal(r.vendor, 'Cisco');
});
