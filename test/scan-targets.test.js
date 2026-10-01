'use strict';
// ============================================================
// test/scan-targets.test.js — un indirizzo che sta per diventare TRAFFICO si legge
// UNA volta, con la definizione unica del progetto, e si manda sul filo nella forma
// canonica.
//
// Il difetto, misurato il 01/10 su questa macchina Windows:
//
//   · `ping.exe` legge `0300.0250.0.1` come OTTALE e pinga 192.168.0.1; il resolver di
//     Node (quello di dgram → SNMP, e di net.connect → sonde TCP) rifiuta le stesse forme
//     («ENOTFOUND»). Il progetto accetta APPOSTA gli zeri iniziali (`192.168.001.005` è
//     lo stesso indirizzo di `192.168.1.5`, v. `_parseIpv4Int`), quindi un IP documentato
//     come `10.10.010.5` veniva sondato dal ping come 10.10.8.5 — un ALTRO host —, e il
//     verdetto «presente/assente» della Verifica parlava di quello. Con le sonde TCP
//     succedeva il contrario: l'indirizzo non si risolveva proprio.
//   · `expandSubnet` aveva la sua lettura dell'indirizzo, e nel ramo «IP singolo» nessun
//     controllo sui valori: `999.999.999.999` e `256.1.1.1` passavano. Stessa famiglia di
//     `/api/reachability` e dei semi del crawl: `/^\d{1,3}(\.\d{1,3}){3}$/` accetta tutto.
//   · `255.255.255.255`, `224.0.0.1` e `0.0.0.0` erano bersagli ammessi: un SNMP v2c verso
//     un multicast spedisce la community a tutto il segmento, e il ping al broadcast
//     risponde per conto di chiunque.
//   · il messaggio diceva «Prefisso /16 - /30», ma da /16 a /21 cade il tetto di 1024 host:
//     l'intervallo vero era /22 - /30. E `expandSubnet` non aveva NESSUN test.
//
// Regola: si controlla e si manda la STESSA stringa. Chi controlla con una lettura e
// manda un'altra ha due letture, e il giorno che divergono la guardia guarda altro.
//
// ⚠️ Nessun pacchetto parte da qui: `child_process.execFile` è sostituito da una spia
// PRIMA di caricare i moduli (netscan lo destruttura al caricamento), e gli indirizzi
// delle prove che potrebbero uscire sono invalidi o fermati dalla spia.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-scan-targets-'));
const dir = (n) => { const p = path.join(TMP, n); fs.mkdirSync(p, { recursive: true }); return p; };
process.env.INFRANET_PROJECTS_DIR = dir('projects');
process.env.INFRANET_SKINS_DIR = dir('skins');
process.env.INFRANET_ORG_FILE = path.join(TMP, 'organization.json');
process.env.INFRANET_USERS_FILE = path.join(TMP, 'users.json');
process.env.INFRANET_API_TOKENS_FILE = path.join(TMP, 'api-tokens.json');
process.env.INFRANET_AI_CONFIG_FILE = path.join(TMP, 'ai.json');
process.env.INFRANET_DCIM_CONFIG_FILE = path.join(TMP, 'dcim.json');
process.env.INFRANET_SESSION_SECRET_FILE = path.join(TMP, '.session-secret');
process.env.SESSION_SECRET = 'test';

// ── La spia: registra i comandi che verrebbero lanciati, e NON ne lancia nessuno ──
const lanciati = [];
cp.execFile = function spia(cmd, args, opts, cb) {
  const callback = typeof opts === 'function' ? opts : cb;
  lanciati.push({ cmd, args: Array.isArray(args) ? args.slice() : [] });
  if (callback) setImmediate(() => callback(new Error('spia: nessun processo lanciato'), '', ''));
  return { kill() {}, on() {} };
};
const nuoviComandi = (da) => lanciati.slice(da);

const netscan = require('../server/netscan.js');
const { expandSubnet, _pingHost } = netscan;
const { _skipNeighborIp, crawlNetwork } = require('../server/crawl-bfs.js');
let ST = null;
try { ST = require('../server/scan-target.js'); } catch (_) { ST = null; }
const serve = () => assert.ok(ST, 'server/scan-target.js non esiste: la lettura unica dei bersagli non e\' ancora scritta');

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* pazienza */ } });

// ════════════════════════════════════════════════════════════════════════════
// A. La lettura unica
// ════════════════════════════════════════════════════════════════════════════
test('scanTarget: gli zeri iniziali diventano la forma canonica (decimale, come per il resto del progetto)', () => {
  serve();
  for (const [dato, atteso] of [['010.008.001.005', '10.8.1.5'], ['192.168.001.010', '192.168.1.10'],
    [' 10.0.0.1 ', '10.0.0.1'], ['10.0.0.1', '10.0.0.1']]) {
    const t = ST.scanTarget(dato);
    assert.equal(t.ok, true, dato);
    assert.equal(t.ip, atteso, dato);
  }
});

test('scanTarget: ciò che non è un IPv4 decimale NON passa, qualunque lettura ne dia un altro mondo', () => {
  serve();
  for (const x of ['999.999.999.999', '256.1.1.1', '1e2.0.0.1', '0x7f.0.0.1', '127.1', '2130706433', '10..1.1',
    '10.0.0', '10.0.0.1.5', '10.0.0.1/24', '', '   ', null, undefined, '１０.0.0.1', '10.0.0.1\n10.0.0.2']) {
    const t = ST.scanTarget(x);
    assert.equal(t.ok, false, JSON.stringify(x));
    assert.equal(t.reason, 'invalid', JSON.stringify(x));
  }
});

test('scanTarget: non è mai un HOST — «questa rete», multicast, broadcast limitato', () => {
  serve();
  for (const [x, motivo] of [['0.0.0.0', 'unspecified'], ['0.1.2.3', 'unspecified'], ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'], ['255.255.255.255', 'broadcast']]) {
    const t = ST.scanTarget(x);
    assert.equal(t.ok, false, x);
    assert.equal(t.reason, motivo, x);
  }
});

test('scanTarget: gli host veri restano ammessi — loopback (il banco), link-local, 192.0.0.64 (default di certe telecamere)', () => {
  serve();
  for (const x of ['127.0.0.1', '169.254.1.1', '192.0.0.64', '10.0.0.0', '10.0.0.255', '8.8.8.8', '203.0.113.7', '100.64.0.1']) {
    assert.equal(ST.scanTarget(x).ok, true, x + ' e\' un host: respingerlo toglierebbe un bersaglio vero');
  }
});

test('targetList: chiavi originali conservate, due scritture dello stesso indirizzo = UNA sonda, scarti con motivo', () => {
  serve();
  const r = ST.targetList(['10.0.0.5', '010.000.000.005', '10.0.0.6', '999.1.1.1', '224.0.0.1', '', null]);
  assert.deepEqual([...r.targets.keys()], ['10.0.0.5', '10.0.0.6'], 'una sonda per indirizzo canonico');
  assert.deepEqual(r.targets.get('10.0.0.5'), ['10.0.0.5', '010.000.000.005'], 'la risposta va data sotto OGNI scrittura');
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['invalid', 'multicast']);
  assert.equal(ST.targetList(['10.0.0.1', '10.0.0.2', '10.0.0.3'], { max: 2 }).targets.size, 2, 'il tetto vale');
});

test('hostOrName: un NOME passa com\'è, ciò che ha la forma di un IPv4 si legge come tale', () => {
  serve();
  for (const nome of ['sw-core.lab.local', 'localhost', '2001:db8::1', 'fe80::1']) {
    assert.deepEqual(ST.hostOrName(nome), { host: nome }, nome);
  }
  assert.deepEqual(ST.hostOrName('192.168.001.010'), { host: '192.168.1.10' });
  for (const x of ['10.0.0', '12345', '999.1.1.1', '224.0.0.1', '255.255.255.255', '1.2.3.4.5']) {
    assert.ok(ST.hostOrName(x).error, x + ' sembra un IPv4 e non lo e\': deve dire perche\'');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// B. expandSubnet — il confine d'ingresso dello scanner (prima: nessun test)
// ════════════════════════════════════════════════════════════════════════════
test('expandSubnet: un IP singolo con ottetti fuori scala NON è un bersaglio', () => {
  for (const x of ['999.999.999.999', '256.1.1.1', '1.2.3.300']) {
    assert.throws(() => expandSubnet(x), undefined, x + ' passava come bersaglio');
  }
});

test('expandSubnet: gli zeri iniziali escono in forma canonica (IP singolo, range, CIDR)', () => {
  assert.deepEqual(expandSubnet('010.000.000.005'), ['10.0.0.5']);
  assert.deepEqual(expandSubnet('192.168.001.1-3'), ['192.168.1.1', '192.168.1.2', '192.168.1.3']);
  assert.deepEqual(expandSubnet('010.0.0.0/30'), ['10.0.0.1', '10.0.0.2']);   // controllo: era gia' cosi'
});

test('expandSubnet: multicast, broadcast e «questa rete» non sono bersagli, né da soli né come blocco', () => {
  for (const x of ['224.0.0.1', '255.255.255.255', '0.0.0.0', '224.0.0.0/24', '0.0.0.0/24', '224.0.0.1-5']) {
    assert.throws(() => expandSubnet(x), undefined, x + ' passava come bersaglio');
  }
});

test('expandSubnet: i bersagli veri restano (loopback del banco, link-local, un /24, il tetto)', () => {
  assert.deepEqual(expandSubnet('127.0.0.1'), ['127.0.0.1']);
  assert.deepEqual(expandSubnet('169.254.1.1'), ['169.254.1.1']);
  const c24 = expandSubnet('192.168.1.0/24');
  assert.equal(c24.length, 254);
  assert.equal(c24[0], '192.168.1.1'); assert.equal(c24[253], '192.168.1.254');
  assert.equal(expandSubnet('10.0.0.0/22').length, 1022);
  assert.throws(() => expandSubnet('10.0.0.0/21'), undefined, 'oltre il tetto di 1024 host');
  assert.throws(() => expandSubnet('300.1.1.1-5'), undefined, 'range con ottetto fuori scala');
});

test('expandSubnet: l\'intervallo di prefissi che il messaggio DICE è quello che accetta', () => {
  // Si sonda cosa accetta DAVVERO (da /0 a /32) e si pretende che il messaggio, per un
  // prefisso troppo largo, nomini proprio quegli estremi. Prima diceva «/16 - /30»
  // mentre da /16 a /21 cadeva il tetto di host: l'intervallo vero era /22 - /30.
  const accettati = [];
  for (let p = 0; p <= 32; p++) { try { expandSubnet('10.0.0.0/' + p); accettati.push(p); } catch (_) { /* respinto */ } }
  const lo = Math.min(...accettati), hi = Math.max(...accettati);
  assert.ok(accettati.length > 0, 'qualche prefisso deve essere accettato');
  assert.deepEqual(accettati, Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), 'gli accettati sono un intervallo continuo');
  let msg = '';
  try { expandSubnet('10.0.0.0/8'); } catch (e) { msg = e.message; }
  assert.ok(msg.includes('/' + lo) && msg.includes('/' + hi),
    `il messaggio «${msg}» deve nominare gli estremi veri /${lo} e /${hi}`);
  assert.ok(!/\/16\b/.test(msg), `il messaggio «${msg}» nomina ancora /16, che non e' accettato`);
});

// ════════════════════════════════════════════════════════════════════════════
// C. Dove l'indirizzo diventa un PROCESSO: si manda la forma canonica, o niente
// ════════════════════════════════════════════════════════════════════════════
test('ping: l\'argomento che parte è la forma canonica (ping.exe leggerebbe 010.8.8.8 come 8.8.8.8)', async () => {
  const da = lanciati.length;
  await _pingHost('010.8.8.8', 300);
  const c = nuoviComandi(da);
  assert.equal(c.length, 1, 'un solo ping');
  assert.equal(c[0].cmd, 'ping');
  assert.equal(c[0].args[c[0].args.length - 1], '10.8.8.8', 'argomenti: ' + JSON.stringify(c[0].args));
});

test('ping: ciò che non è un host NON viene pingato (invalido, multicast, broadcast)', async () => {
  for (const x of ['999.1.1.1', '224.0.0.1', '255.255.255.255', '0.0.0.0', '', 'host.lab', '-t']) {
    const da = lanciati.length;
    const r = await _pingHost(x, 300);
    assert.equal(nuoviComandi(da).length, 0, JSON.stringify(x) + ' ha lanciato un processo');
    assert.deepEqual(r, { alive: false, ttl: null }, JSON.stringify(x));
  }
});

test('net view: sul solo Windows, il percorso UNC porta la forma canonica', { skip: process.platform !== 'win32' && 'net view esiste solo su Windows' }, async () => {
  const da = lanciati.length;
  await netscan._smbSharesProbe('010.8.8.8', 300);
  const c = nuoviComandi(da);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].args, ['view', '\\\\10.8.8.8', '/all']);
});

test('nbtstat/net view: un indirizzo che non si legge non lancia niente', async () => {
  const da = lanciati.length;
  const r = await netscan._netbiosProbe('999.1.1.1', 300);
  assert.ok(!r || (!r.name && !r.group), 'nessuna identita\' per un indirizzo invalido');
  assert.deepEqual(await netscan._smbSharesProbe('999.1.1.1', 300), []);
  assert.equal(nuoviComandi(da).length, 0, 'nessun processo per un indirizzo invalido');
});

// ════════════════════════════════════════════════════════════════════════════
// D. Il crawl: la politica dei vicini guarda la STESSA lettura che poi va sul filo
// ════════════════════════════════════════════════════════════════════════════
test('crawl: un vicino che la lettura unica non legge è scartato (prima passava per Number())', () => {
  // `Number('0x0a')` vale 10: la copia larga leggeva `0x0a.0.0.1` come 10.0.0.1, cioe' interno.
  for (const x of ['0x0a.0.0.1', '1e1.0.0.1', '10..0.1', ' 10.0.0.1x', '999.1.1.1']) {
    assert.equal(_skipNeighborIp(x), true, JSON.stringify(x) + ' non e\' un indirizzo: non si segue');
  }
  assert.equal(_skipNeighborIp('010.000.000.002'), false, 'una scrittura con zeri dello stesso interno resta interno');
});

test('crawl: neppure «allowPublic» apre multicast, broadcast e «questa rete» — la community non va a un gruppo', () => {
  for (const x of ['224.0.0.5', '239.1.1.1', '255.255.255.255', '0.0.0.0', '0.9.9.9']) {
    assert.equal(_skipNeighborIp(x, { allowPublic: true }), true, x + ' non e\' un indirizzo pubblico: e\' un gruppo');
    assert.equal(_skipNeighborIp(x, { allow: new Set([x]) }), true, x + ' neppure se dichiarato nell\'ambito');
  }
  assert.equal(_skipNeighborIp('8.8.8.8', { allowPublic: true }), false, 'controllo: il pubblico dichiarato resta aperto');
});

test('crawl: quel che si interroga è la forma canonica, e due scritture sono UN apparato', async () => {
  const sonde = [];
  const topo = {
    '10.0.0.1': { host: 'CORE', neighbors: [{ remoteIP: '010.000.000.002', protocol: 'LLDP' }, { remoteIP: '10.0.0.2', protocol: 'CDP' }] },
    '10.0.0.2': { host: 'ACC1', neighbors: [] },
  };
  const out = await crawlNetwork({
    seeds: ['10.0.0.1'], maxDepth: 3, maxDevices: 10, pool: 1,
    probe: async (ip) => { sonde.push(ip); const d = topo[ip]; return d ? { reachable: true, hostname: d.host } : { reachable: false, error: 'muto' }; },
    pollNeighbors: async (ip) => ({ neighbors: (topo[ip] || {}).neighbors || [] }),
    decorate: (r) => ({ ...r }), emit: () => {}, isAborted: () => false,
  });
  assert.deepEqual(sonde.sort(), ['10.0.0.1', '10.0.0.2'], 'una sonda per apparato, nella forma canonica: ' + JSON.stringify(sonde));
  assert.deepEqual(out.results.map((r) => r.ip).sort(), ['10.0.0.1', '10.0.0.2']);
});

// ════════════════════════════════════════════════════════════════════════════
// E. Le rotte: il confine è usato davvero, non solo scritto
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
let server, base;
before(async () => {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use((req, _res, next) => { req.session = { user: { id: 1, username: 'test', role: 'admin' } }; next(); });
  app.use(require('../server/routes/discovery'));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); server.closeAllConnections && server.closeAllConnections(); } catch (_) { /* già chiuso */ } });

const post = async (p, body) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const status = r.status;
    const ct = r.headers.get('content-type') || '';
    if (/event-stream/.test(ct)) { try { await r.body.cancel(); } catch (_) { /* chiuso */ } return { status, stream: true }; }
    return { status, json: await r.json() };
  } finally { clearTimeout(t); }
};

test('POST /api/discover: un bersaglio fuori scala si rifiuta, non si scansiona', async () => {
  const r = await post('/api/discover', { subnet: '999.999.999.999', driver: 'snmp-v2c', community: 'x', timeout: 1, detectWeb: false, detectDns: false, detectSnmp: false });
  assert.equal(r.json && r.json.ok, false, 'doveva essere respinto con ok:false, e invece: ' + JSON.stringify(r.json && Object.keys(r.json)));
});

test('POST /api/reachability: gli scarti si dicono, e ciò che non si legge non si sonda', async () => {
  const r = await post('/api/reachability', { ips: ['999.999.999.999'], timeout: 1 });
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.results, {}, 'un indirizzo fuori scala non ha un verdetto di presenza');
  assert.deepEqual((r.json.rejected || []).map((x) => x.reason), ['invalid'], 'e lo scarto si dice, non sparisce');
});

test('POST /api/reachability: due scritture dello stesso indirizzo = UNA sonda, e la risposta torna sotto entrambe', async () => {
  // 127.0.0.1 per non toccare la rete: il ping e `arp` passano dalla spia, e le porte TCP sono
  // quelle di casa (chiuse, rifiuto immediato).
  const da = lanciati.length;
  const r = await post('/api/reachability', { ips: ['127.0.0.1', '127.000.000.001'], timeout: 1 });
  assert.equal(r.json.ok, true);
  assert.deepEqual(Object.keys(r.json.results).sort(), ['127.0.0.1', '127.000.000.001'].sort(),
    'la lista del chiamante parla con le SUE stringhe: la risposta va sotto ciascuna');
  assert.deepEqual(r.json.results['127.000.000.001'], r.json.results['127.0.0.1'], 'e dice la stessa cosa');
  const ping = nuoviComandi(da).filter((c) => c.cmd === 'ping');
  assert.ok(ping.length >= 1 && ping.every((c) => c.args[c.args.length - 1] === '127.0.0.1'),
    'ogni ping parte verso la forma canonica: ' + JSON.stringify(ping.map((c) => c.args)));
});

test('POST /api/discover/topology: un seme che non si legge è un 400, non un crawl', async () => {
  const r = await post('/api/discover/topology', { seeds: ['999.999.999.999'], driver: 'snmp-v2c', community: 'x', timeout: 1 });
  assert.equal(r.status, 400, 'il seme invalido ha avviato un crawl (stream=' + r.stream + ')');
});

test('POST /api/poll: un host che ha la forma di un IPv4 ma non lo è si dice, non diventa un timeout del resolver', async () => {
  const r = await post('/api/poll', { host: '999.999.999.999', driver: 'snmp-v2c', community: 'x', timeout: 1 });
  assert.equal(r.json.ok, false);
  assert.match(String(r.json.error), /non valid|not valid|invalid/i, 'l\'errore: ' + r.json.error);
});
