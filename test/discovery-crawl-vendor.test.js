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

// ---- ARP-SNMP: candidati off-segment (VPCS ecc.) via ipNetToMediaTable ------
test('arp: _discArpRow marca _via:arp, osservato (non pre-selezionato), preserva vendor', () => {
  run(APP.ctx, `window._dhcpLeases = [];`);
  const r = JSON.parse(run(APP.ctx, `JSON.stringify(_discArpRow({
    ip:'10.10.10.100', mac:'00:50:79:66:68:23', vendor:'ACME', deviceClass:'pc',
    confidence:{score:14,level:'low'}, sources:[{id:'arp',label:'ARP',strength:'medium'}]
  }))`));
  assert.equal(r._via, 'arp');
  assert.equal(r.snmpReachable, false);
  assert.equal(r.alive, false, 'alive:false -> canImport false -> checkbox non spuntata di default');
  assert.equal(r.vendor, 'ACME', 'vendor preservato (niente clobber)');
  assert.equal(r.ip, '10.10.10.100');
});

test('arp: rifinitura DHCP — MAC nel lease -> hostname + confidenza + reason', () => {
  run(APP.ctx, `window._dhcpLeases = [{ mac:'00:50:79:66:68:23', ip:'10.10.10.100', hostname:'PC1' }];`);
  const r = JSON.parse(run(APP.ctx, `JSON.stringify(_discArpRow({
    ip:'10.10.10.100', mac:'00:50:79:66:68:23', vendor:'', confidence:{score:25,level:'low'}
  }))`));
  assert.equal(r.hostname, 'PC1', 'hostname preso dal lease DHCP');
  assert.equal(r._dhcpMatched, true);
  assert.ok(r.confidence.score >= 40, 'confidenza alzata (visto in ARP E DHCP)');
  assert.ok((r.reasonCodes||[]).includes('dhcp-lease'));
});

test('arp: match DHCP per IP SOLO se il MAC non contraddice (DISC-M1)', () => {
  // Stesso IP ma MAC DIVERSO fra ARP osservato e lease → device diverso (lease stantio
  // o di un altro host): NON adottare l'hostname del lease (② no-invenzioni).
  run(APP.ctx, `window._dhcpLeases = [{ mac:'aa:aa:aa:aa:aa:aa', ip:'10.10.10.100', hostname:'PC1-byip' }];`);
  const mismatch = JSON.parse(run(APP.ctx, `JSON.stringify(_discArpRow({ ip:'10.10.10.100', mac:'00:50:79:66:68:23' }))`));
  assert.ok(!mismatch.hostname, 'MAC discordante sullo stesso IP → nessun hostname adottato');
  assert.ok(!mismatch._dhcpMatched);
  // Riga SENZA MAC osservato (solo ping/IP): il match per IP resta lecito.
  const noMac = JSON.parse(run(APP.ctx, `JSON.stringify(_discArpRow({ ip:'10.10.10.100' }))`));
  assert.equal(noMac.hostname, 'PC1-byip', 'senza MAC osservato il match per IP è ammesso');
});

test('arp: nessun lease corrispondente -> nessun hostname inventato (no-invenzioni)', () => {
  run(APP.ctx, `window._dhcpLeases = [{ mac:'ff:ee:dd:cc:bb:aa', ip:'10.10.10.9', hostname:'ALTRO' }];`);
  const r = JSON.parse(run(APP.ctx, `JSON.stringify(_discArpRow({ ip:'10.10.10.100', mac:'00:50:79:66:68:23' }))`));
  assert.ok(!r.hostname, 'nessun hostname (no match) — niente invenzioni');
  assert.ok(!r._dhcpMatched);
});

// MAC in forma canonica (MAIUSCOLO con ':') in OGNI sorgente: senza, lo sweep dava
// maiuscolo e l'ARP-SNMP minuscolo → case miste in tabella e lo STESSO device (stesso
// IP/MAC) sfuggiva al dedup, comparendo due volte (es. .178 "HP" + .178 "Canon").
test('arp: il MAC minuscolo viene normalizzato a MAIUSCOLO (coerenza con lo sweep + dedup)', () => {
  run(APP.ctx, `window._dhcpLeases = [];`);
  const r = JSON.parse(run(APP.ctx, `JSON.stringify(_discArpRow({ ip:'192.168.1.178', mac:'18:60:24:78:37:0b' }))`));
  assert.equal(r.mac, '18:60:24:78:37:0B', 'MAC uppercased come normalizeMacAddress');
});

// Vendor BYOD: il MAC randomizzato non ha OUI reale → etichetta onesta invece di "—";
// "Private" (OUI IEEE riservato) resta invariato; un vendor risolto vince sempre.
test('vendor: etichetta onesta per MAC randomizzato; "Private" e vendor reali invariati', () => {
  const r = JSON.parse(run(APP.ctx, `JSON.stringify({
    apple: _discVendorLabel({ mac:'3A:42:5E:10:70:89', vendor:'Apple' }),
    priv:  _discVendorLabel({ mac:'10:00:00:11:22:33', vendor:'Private' }),
    rand:  _discVendorLabel({ mac:'3A:42:5E:10:70:89', vendor:'' }),
    wired: _discVendorLabel({ mac:'D4:1A:D1:82:11:20', vendor:'' }),
    none:  _discVendorLabel({ vendor:'' })
  })`));
  assert.equal(r.apple, 'Apple', 'vendor risolto mostrato invariato');
  assert.equal(r.priv, 'Private', 'OUI IEEE riservato: Private resta invariato');
  assert.ok(/casuale|random/i.test(r.rand), 'MAC randomizzato senza brand -> etichetta onesta');
  assert.equal(r.wired, '—', 'MAC normale senza vendor -> trattino (non randomizzato)');
  assert.equal(r.none, '—', 'nessun MAC -> trattino');
});
