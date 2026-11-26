'use strict';
// ============================================================
// Scopri con PIU' reti: il piano di scansione (server/scan-plan.js) e le sue due rotte
// ============================================================
// Una sola definizione di «intervallo valido»: `expandSubnet` (server/netscan.js). Il piano la
// chiama per ogni voce della lista e dice, PRIMA di mandare un solo pacchetto: quali voci vanno
// scansionate, quali sono sbagliate (col motivo di sempre), quali sono doppioni o stanno dentro un'altra,
// e quanti host sono in tutto. Le reti della macchina (le interfacce) sono la stessa lettura che il
// server gia' faceva per sapere cosa e' «sul filo»: ora e' anche un elenco da proporre.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { planScanTargets, expandScanTargets, localNetworksFrom, MAX_SCAN_PLAN_HOSTS, MAX_SCAN_RANGES } = require('../server/scan-plan.js');

const testi = (l) => l.map((r) => r.text);

// ── il piano ─────────────────────────────────────────────────────────────────────────────────────
test('una voce valida: un intervallo, nessun scarto, il conteggio degli host', () => {
  const p = planScanTargets('192.168.1.0/24');
  assert.deepEqual(testi(p.ranges), ['192.168.1.0/24']);
  assert.equal(p.ranges[0].hosts, 254);
  assert.equal(p.ranges[0].first, '192.168.1.1');
  assert.equal(p.ranges[0].last, '192.168.1.254');
  assert.deepEqual(p.invalid, []);
  assert.deepEqual(p.skipped, []);
  assert.equal(p.total, 254);
  assert.equal(p.tooMany, false);
  assert.deepEqual(p.limits, { ranges: 32, hosts: 4096 }, 'i tetti viaggiano col piano: la pagina non ne tiene una copia');
});

test('tre forme insieme: CIDR, intervallo e IP singolo, in ordine', () => {
  const p = planScanTargets('10.0.1.0/30, 10.0.2.5-9; 10.0.3.7');
  assert.deepEqual(testi(p.ranges), ['10.0.1.0/30', '10.0.2.5-9', '10.0.3.7']);
  assert.deepEqual(p.ranges.map((r) => r.hosts), [2, 5, 1]);
  assert.equal(p.total, 8);
});

test('una voce sbagliata NON ferma le altre e porta il motivo di expandSubnet (lo stesso di sempre)', () => {
  const p = planScanTargets('10.0.1.0/24, banana, 10.0.2.0/24');
  assert.deepEqual(testi(p.ranges), ['10.0.1.0/24', '10.0.2.0/24']);
  assert.equal(p.invalid.length, 1);
  assert.equal(p.invalid[0].text, 'banana');
  assert.match(p.invalid[0].error, /Formato non valido/);
});

test('un prefisso troppo largo e\' sbagliato col messaggio del tetto, e dice quale voce', () => {
  const p = planScanTargets('10.0.0.0/16');
  assert.deepEqual(p.ranges, []);
  assert.equal(p.invalid[0].text, '10.0.0.0/16');
  assert.match(p.invalid[0].error, /Prefisso \/22 - \/30/);
});

test('un doppione esatto si scansiona UNA volta e lo scarto lo dice', () => {
  const p = planScanTargets('10.0.1.0/24, 10.0.2.0/24, 10.0.1.0/24');
  assert.deepEqual(testi(p.ranges), ['10.0.1.0/24', '10.0.2.0/24']);
  assert.deepEqual(p.skipped, [{ text: '10.0.1.0/24', reason: 'duplicate', in: '10.0.1.0/24' }]);
  assert.equal(p.total, 508);
});

test('una voce dentro un\'altra non si rifa\': ne\' se viene DOPO ne\' se viene PRIMA', () => {
  const dopo = planScanTargets('10.0.1.0/24, 10.0.1.10-20');
  assert.deepEqual(testi(dopo.ranges), ['10.0.1.0/24']);
  assert.deepEqual(dopo.skipped, [{ text: '10.0.1.10-20', reason: 'contained', in: '10.0.1.0/24' }]);

  const prima = planScanTargets('10.0.1.10-20, 10.0.1.0/24');
  assert.deepEqual(testi(prima.ranges), ['10.0.1.0/24'], 'quella piu\' larga resta, a prescindere dall\'ordine');
  assert.deepEqual(prima.skipped, [{ text: '10.0.1.10-20', reason: 'contained', in: '10.0.1.0/24' }]);
  assert.equal(prima.total, 254, 'gli host si contano una volta sola');
});

test('due voci che si sovrappongono solo in parte restano tutte e due, e il totale non conta due volte', () => {
  const p = planScanTargets('10.0.1.1-100, 10.0.1.50-150');
  assert.deepEqual(testi(p.ranges), ['10.0.1.1-100', '10.0.1.50-150']);
  assert.deepEqual(p.overlaps, [{ a: '10.0.1.1-100', b: '10.0.1.50-150', hosts: 51 }]);
  assert.equal(p.total, 150, '1..150, non 100 + 101');
});

test('anche UN solo indirizzo in comune si dice (e il totale lo conta una volta)', () => {
  const p = planScanTargets('10.0.1.1-5, 10.0.1.5-9');
  assert.deepEqual(p.overlaps, [{ a: '10.0.1.1-5', b: '10.0.1.5-9', hosts: 1 }]);
  assert.equal(p.total, 9);
});

test('il tetto sul totale e\' dichiarato: oltre, `tooMany` (e il numero parla da solo)', () => {
  const sedici = Array.from({ length: 16 }, (_, i) => `10.0.${i}.0/24`).join(', ');
  const ok = planScanTargets(sedici);
  assert.equal(ok.total, 16 * 254);
  assert.equal(ok.tooMany, MAX_SCAN_PLAN_HOSTS < 16 * 254);
  const diciassette = Array.from({ length: 17 }, (_, i) => `10.0.${i}.0/24`).join(', ');
  const no = planScanTargets(diciassette);
  assert.equal(no.tooMany, true);
  assert.equal(no.total, 17 * 254);
  assert.equal(MAX_SCAN_PLAN_HOSTS, 4096);
});

test('troppe voci (oltre il tetto) non si leggono nemmeno: un errore, non 1000 espansioni', () => {
  const tante = Array.from({ length: MAX_SCAN_RANGES + 1 }, (_, i) => `10.${i}.0.5`).join(', ');
  const p = planScanTargets(tante);
  assert.deepEqual(p.ranges, []);
  assert.equal(p.tooManyRanges, true);
  assert.equal(MAX_SCAN_RANGES, 32);
});

test('il tetto sulle voci e\' ESATTAMENTE 32: trentadue si leggono, trentatre no', () => {
  const voci = (n) => Array.from({ length: n }, (_, i) => `10.${i}.0.5`).join(', ');
  const ok = planScanTargets(voci(MAX_SCAN_RANGES));
  assert.equal(ok.tooManyRanges, false);
  assert.equal(ok.ranges.length, MAX_SCAN_RANGES);
  assert.throws(() => expandScanTargets(voci(MAX_SCAN_RANGES + 1)), /Massimo 32 intervalli/);
  assert.equal(expandScanTargets(voci(MAX_SCAN_RANGES)).length, MAX_SCAN_RANGES);
});

test('un campo vuoto e\' un piano vuoto, non un errore', () => {
  for (const v of ['', '   ', null, undefined]) {
    const p = planScanTargets(v);
    assert.deepEqual(p.ranges, []);
    assert.deepEqual(p.invalid, []);
    assert.equal(p.total, 0);
  }
});

test('gli indirizzi che non sono bersagli restano respinti uno per uno (multicast, 0.0.0.0, ottali)', () => {
  const p = planScanTargets('224.0.0.1, 0.0.0.0, 10.0.1.5');
  assert.deepEqual(testi(p.ranges), ['10.0.1.5']);
  assert.deepEqual(testi(p.invalid), ['224.0.0.1', '0.0.0.0']);
});

test('expandScanTargets: l\'unione degli indirizzi, senza doppioni, in ordine di voce', () => {
  const ips = expandScanTargets('10.0.1.1-3, 10.0.2.1-2, 10.0.1.2-4');
  assert.deepEqual(ips, ['10.0.1.1', '10.0.1.2', '10.0.1.3', '10.0.2.1', '10.0.2.2', '10.0.1.4']);
});

test('expandScanTargets su una voce sbagliata lancia come expandSubnet (chi lo chiama decide)', () => {
  assert.throws(() => expandScanTargets('10.0.1.0/24, banana'), /Formato non valido/);
});

// ── le reti della macchina ───────────────────────────────────────────────────────────────────────
const nic = (address, netmask, extra) => Object.assign({ address, netmask, family: 'IPv4', internal: false, mac: '00:00:00:00:00:00', cidr: null }, extra || {});

test('localNetworksFrom: la rete e\' address & netmask, col prefisso VERO (non si assume il /24)', () => {
  const r = localNetworksFrom({
    Ethernet: [nic('192.168.1.45', '255.255.255.0')],
    Uffici: [nic('10.20.7.9', '255.255.252.0')],
  });
  assert.deepEqual(r.map((x) => x.cidr), ['192.168.1.0/24', '10.20.4.0/22']);
  assert.deepEqual(r.map((x) => x.address), ['192.168.1.45', '10.20.7.9']);
  assert.deepEqual(r.map((x) => x.iface), ['Ethernet', 'Uffici']);
  assert.deepEqual(r.map((x) => x.hosts), [254, 1022]);
});

test('localNetworksFrom: loopback, IPv6, link-local (169.254) e /32 non sono reti da proporre', () => {
  const r = localNetworksFrom({
    lo: [nic('127.0.0.1', '255.0.0.0', { internal: true })],
    v6: [{ address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false }],
    apipa: [nic('169.254.10.20', '255.255.0.0')],
    vpn: [nic('10.99.0.2', '255.255.255.255')],
    Ethernet: [nic('192.168.1.45', '255.255.255.0')],
  });
  assert.deepEqual(r.map((x) => x.cidr), ['192.168.1.0/24']);
});

test('localNetworksFrom: la stessa rete su due schede e\' UNA riga, con tutti e due i nomi', () => {
  const r = localNetworksFrom({
    'Ethernet': [nic('192.168.1.45', '255.255.255.0')],
    'Wi-Fi': [nic('192.168.1.46', '255.255.255.0')],
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].cidr, '192.168.1.0/24');
  assert.equal(r[0].iface, 'Ethernet, Wi-Fi');
});

test('localNetworksFrom: una netmask che non e\' contigua non e\' una rete (non si inventa un prefisso)', () => {
  const r = localNetworksFrom({ strana: [nic('10.0.0.5', '255.0.255.0')] });
  assert.deepEqual(r, []);
});

test('localNetworksFrom: Node 18.0-18.3 dava family come NUMERO (4): si legge uguale', () => {
  const r = localNetworksFrom({ Ethernet: [nic('192.168.1.45', '255.255.255.0', { family: 4 })] });
  assert.deepEqual(r.map((x) => x.cidr), ['192.168.1.0/24']);
});

test('localNetworksFrom: input guasto (null, interfaccia senza voci) non rompe niente', () => {
  assert.deepEqual(localNetworksFrom(null), []);
  assert.deepEqual(localNetworksFrom({ a: null, b: undefined, c: [] }), []);
  assert.deepEqual(localNetworksFrom({ a: [null, {}] }), []);
});

// ── le rotte ─────────────────────────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-scanplan-'));
const dir = (n) => { const p = path.join(TMP, n); fs.mkdirSync(p, { recursive: true }); return p; };
process.env.INFRANET_PROJECTS_DIR = dir('projects');
process.env.INFRANET_SKINS_DIR = dir('skins');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_SESSION_SECRET_FILE = path.join(TMP, '.session-secret');
process.env.SESSION_SECRET = 'test';

const express = require('express');
let server, base, ruolo = 'admin';
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = ruolo ? { user: { id: 0, username: 'test', role: ruolo } } : {}; next(); });
  app.use(require('../server/routes/discovery'));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('POST /api/discover/plan: il piano di una lista, senza mandare un solo pacchetto', async () => {
  const r = await post('/api/discover/plan', { ranges: '127.0.0.0/30, banana, 127.0.0.4/30' });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(testi(j.ranges), ['127.0.0.0/30', '127.0.0.4/30']);
  assert.equal(j.invalid[0].text, 'banana');
  assert.equal(j.total, 4);
});

test('POST /api/discover/plan: un campo che non e\' testo non rompe il server', async () => {
  for (const ranges of [undefined, null, 42, { a: 1 }, []]) {
    const j = await (await post('/api/discover/plan', { ranges })).json();
    assert.equal(j.ok, true);
    assert.deepEqual(j.ranges, []);
  }
});

test('POST /api/discover/plan: un testo enorme e\' rifiutato prima di essere letto', async () => {
  const j = await (await post('/api/discover/plan', { ranges: '10.0.0.5, '.repeat(5000) })).json();
  assert.equal(j.ok, false);
  assert.match(j.error, /troppo lungo/i);
});

test('GET /api/discover/networks: le reti della macchina, nessuna loopback, ognuna dice se si puo\' scansionare', async () => {
  const j = await (await fetch(base + '/api/discover/networks')).json();
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.networks));
  for (const n of j.networks) {
    assert.match(n.cidr, /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
    assert.ok(!n.cidr.startsWith('127.'), 'la loopback non e\' una rete da proporre');
    assert.ok(!n.cidr.startsWith('169.254.'), 'una rete auto-assegnata non e\' una rete da proporre');
    assert.equal(typeof n.scannable, 'boolean');
    if (!n.scannable) assert.equal(typeof n.reason, 'string', 'una rete non scansionabile dice perche\'');
  }
});

test('GET /api/discover/networks: una /16 si propone ma NON si puo\' spuntare, col motivo del tetto; una /24 si', async () => {
  const vera = os.networkInterfaces;
  os.networkInterfaces = () => ({ Grande: [nic('10.1.2.3', '255.255.0.0')], Uffici: [nic('192.168.1.5', '255.255.255.0')] });
  try {
    const j = await (await fetch(base + '/api/discover/networks')).json();
    assert.equal(j.ok, true);
    const grande = j.networks.find((n) => n.cidr === '10.1.0.0/16');
    const uffici = j.networks.find((n) => n.cidr === '192.168.1.0/24');
    assert.equal(grande.scannable, false);
    assert.match(grande.reason, /Prefisso \/22 - \/30/);
    assert.equal(uffici.scannable, true);
    assert.equal(uffici.reason, undefined);
    assert.equal(uffici.hosts, 254);
    assert.equal(uffici.iface, 'Uffici');
  } finally { os.networkInterfaces = vera; }
});

test('le due rotte nuove sono SOLO per l\'admin come tutte quelle che toccano la rete', async () => {
  ruolo = 'viewer';
  try {
    const a = await post('/api/discover/plan', { ranges: '10.0.0.5' });
    const b = await fetch(base + '/api/discover/networks');
    assert.ok(a.status === 401 || a.status === 403, 'plan: ' + a.status);
    assert.ok(b.status === 401 || b.status === 403, 'networks: ' + b.status);
  } finally { ruolo = 'admin'; }
});

test('il crawl legge `scanCidr` con la STESSA lista (un solo posto che spezza le voci)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'discovery.js'), 'utf8');
  assert.match(src, /expandScanTargets\(scanCidr\)/, 'con piu\' reti il filtro dei vicini deve valere per TUTTE, non spegnersi');
  assert.doesNotMatch(src, /new Set\(expandSubnet\(scanCidr\)\)/, 'la lettura di una voce sola e\' la strada che spegneva il filtro in silenzio');
});
