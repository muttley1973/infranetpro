'use strict';
// Orchestrazione del crawl BFS (server/crawl-bfs.js) — rete di sicurezza che PRIMA
// mancava (la route SSE non era testata). probe/pollNeighbors iniettati = zero rete.
// Test cardine: pool=1 vs pool=8 con latenze sfasate -> output IDENTICO (il
// parallelismo non cambia i dati; il determinismo e' garantito dalla barriera+ordinamento).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crawlNetwork, probeArpCandidates, cmpIp, _skipNeighborIp } = require('../server/crawl-bfs.js');

const delay = ms => new Promise(r => setTimeout(r, ms));
// Ritardo deterministico ma "sfasato": IP piu' alto risponde PRIMA -> l'ordine di
// completamento e' l'OPPOSTO dell'ordine IP, cosi' se il codice non fosse deterministico
// l'output cambierebbe tra pool=1 e pool=N.
function skew(ip) { const o = Number(String(ip).split('.')[3]) || 0; return (250 - o) % 40; }

// topo: { ip: { host, neighbors:[{remoteIP,protocol,localPort,remoteDevice}], arpTable, fdbTable, down } }
function makeNet(topo, opts = {}) {
  const calls = { probe: [], poll: [] };
  const probe = async (ip) => {
    calls.probe.push(ip);
    if (opts.latency) await delay(skew(ip));
    const d = topo[ip];
    if (!d || d.down) return { reachable: false, error: 'no response' };
    return { reachable: true, hostname: d.host || '', descr: d.descr || '', objectId: d.oid || '', sysServices: d.sysServices || 0 };
  };
  const pollNeighbors = async (ip) => {
    calls.poll.push(ip);
    if (opts.latency) await delay(skew(ip));
    const d = topo[ip] || {};
    if (d.pollThrows) throw new Error('boom');
    return { neighbors: d.neighbors || [], arpTable: d.arpTable, fdbTable: d.fdbTable };
  };
  return { probe, pollNeighbors, calls };
}
const decorate = (row) => ({ ...row });   // identity: espone il row costruito
function collect() { const ev = []; return { ev, emit: e => ev.push(e) }; }
const nbr = (ip, extra = {}) => ({ remoteIP: ip, protocol: extra.protocol || 'LLDP', localPort: extra.port || '', remoteDevice: extra.name || '' });

const NET = {
  '10.0.0.1': { host: 'CORE', neighbors: [nbr('10.0.0.4'), nbr('10.0.0.2'), nbr('10.0.0.3')] },
  '10.0.0.2': { host: 'ACC1', neighbors: [nbr('10.0.0.10'), nbr('10.0.0.1')], fdbTable: { 'aa:bb:cc:00:00:01': 'Gi0/1' } },
  '10.0.0.3': { host: 'ACC2', neighbors: [nbr('10.0.0.11')], arpTable: { 'aa:bb:cc:00:00:02': '10.0.0.99' } },
  '10.0.0.4': { host: 'ACC3', neighbors: [] },
  '10.0.0.10': { host: 'LEAF1', neighbors: [] },
  '10.0.0.11': { host: 'LEAF2', neighbors: [] },
};

async function crawl(net, over = {}) {
  const c = collect();
  const out = await crawlNetwork({
    seeds: ['10.0.0.1'], maxDepth: 5, maxDevices: 100, pool: 1, collectArp: false,
    probe: net.probe, pollNeighbors: net.pollNeighbors, decorate, emit: c.emit, isAborted: () => false,
    ...over,
  });
  return { out, ev: c.ev, ips: out.results.map(r => r.ip) };
}

test('BFS base: scopre tutti i device raggiungibili via LLDP/CDP', async () => {
  const net = makeNet(NET);
  const { out, ips } = await crawl(net);
  assert.deepEqual(ips.sort(), ['10.0.0.1', '10.0.0.10', '10.0.0.11', '10.0.0.2', '10.0.0.3', '10.0.0.4']);
  assert.equal(out.results.length, 6);
});

test('CARDINE: pool=1 e pool=8 (con latenze sfasate) danno output IDENTICO', async () => {
  const a = await crawl(makeNet(NET, { latency: true }), { pool: 1 });
  const b = await crawl(makeNet(NET, { latency: true }), { pool: 8 });
  assert.deepEqual(a.ips, b.ips, 'ordine dei results identico');
  assert.deepEqual(a.out.fdbTables, b.out.fdbTables, 'fdbTables identiche');
  assert.deepEqual([...a.out.visited].sort(), [...b.out.visited].sort(), 'visited identici');
  // eventi significativi (found/dup/miss/skip) nello stesso ordine deterministico
  const sig = ev => ev.filter(e => ['found', 'dup', 'miss', 'skip'].includes(e.type)).map(e => `${e.type}:${e.ip}`);
  assert.deepEqual(sig(a.ev), sig(b.ev), 'sequenza eventi found/dup/miss/skip identica');
});

test('dedup per sysName: due IP stesso hostname -> un solo result, IP piu\' basso vince', async () => {
  const net = makeNet({
    '10.0.0.1': { host: 'CORE', neighbors: [nbr('10.0.0.5'), nbr('10.0.0.2')] },
    '10.0.0.2': { host: 'TWIN', neighbors: [] },
    '10.0.0.5': { host: 'TWIN', neighbors: [] },   // stesso sysName di .2
  }, { latency: true });
  const { ips, ev } = await crawl(net, { pool: 8 });
  assert.ok(ips.includes('10.0.0.2'), 'l\'IP piu\' basso (.2) e\' il device tenuto');
  assert.ok(!ips.includes('10.0.0.5'), '.5 e\' scartato come duplicato');
  assert.ok(ev.some(e => e.type === 'dup' && e.ip === '10.0.0.5'), 'evento dup su .5');
});

test('maxDepth=0: solo i semi vengono sondati, i vicini -> skip (non sondati)', async () => {
  const net = makeNet(NET);
  const { ips, ev } = await crawl(net, { maxDepth: 0 });
  assert.deepEqual(ips, ['10.0.0.1'], 'solo il seme');
  assert.ok(ev.some(e => e.type === 'skip' && e.reason === 'maxDepth'), 'vicini a profondita\' 1 skippati');
  assert.ok(!net.calls.probe.includes('10.0.0.2'), 'un vicino oltre maxDepth NON viene sondato');
});

test('maxDevices: il numero di result e\' limitato', async () => {
  const net = makeNet(NET);
  const { out } = await crawl(net, { maxDevices: 3 });
  assert.ok(out.results.length <= 3 + 1, 'cap rispettato (piccolo overshoot di livello ammesso)');
  assert.ok(out.results.length >= 3);
});

test('device irraggiungibile -> miss, non entra nei results', async () => {
  const net = makeNet({
    '10.0.0.1': { host: 'CORE', neighbors: [nbr('10.0.0.2')] },
    '10.0.0.2': { down: true },
  });
  const { ips, ev } = await crawl(net);
  assert.deepEqual(ips, ['10.0.0.1']);
  assert.ok(ev.some(e => e.type === 'miss' && e.ip === '10.0.0.2'));
});

test('collectArp gating + fdb sempre raccolta; pollNeighbors che lancia -> warn, crawl continua', async () => {
  const net = makeNet({
    '10.0.0.1': { host: 'CORE', neighbors: [nbr('10.0.0.2'), nbr('10.0.0.3')], arpTable: { 'x': '10.0.0.50' }, fdbTable: { 'm': 'Gi0/1' } },
    '10.0.0.2': { host: 'ACC1', pollThrows: true },
    '10.0.0.3': { host: 'ACC2', neighbors: [] },
  });
  const on = await crawl(net, { collectArp: true });
  assert.equal(on.out.arpTables.length, 1, 'arp raccolta con collectArp=true');
  assert.equal(on.out.fdbTables.length, 1, 'fdb raccolta');
  assert.ok(on.ev.some(e => e.type === 'warn' && e.ip === '10.0.0.2'), 'pollNeighbors in errore -> warn');
  assert.ok(on.ips.includes('10.0.0.3'), 'il crawl continua dopo l\'errore');
  const off = await crawl(makeNet({ '10.0.0.1': { host: 'CORE', neighbors: [], arpTable: { 'x': '10.0.0.50' } } }), { collectArp: false });
  assert.equal(off.out.arpTables.length, 0, 'nessuna arp senza collectArp');
});

test('propaga la via (protocol/from/port) dello scopritore nel device', async () => {
  const net = makeNet({
    '10.0.0.1': { host: 'CORE', neighbors: [nbr('10.0.0.2', { protocol: 'CDP', port: 'Gi0/1', name: 'ACC1' })] },
    '10.0.0.2': { host: 'ACC1', neighbors: [] },
  });
  const { out } = await crawl(net);
  const acc = out.results.find(r => r.ip === '10.0.0.2');
  assert.equal(acc.viaProtocol, 'CDP');
  assert.equal(acc.viaFrom, '10.0.0.1');
  assert.equal(acc.viaPort, 'Gi0/1');
});

test('vicini con IP non instradabili scartati (0.x / 127.x / 169.254.x)', async () => {
  assert.equal(_skipNeighborIp('0.1.2.3'), true);
  assert.equal(_skipNeighborIp('127.0.0.1'), true);
  assert.equal(_skipNeighborIp('169.254.1.1'), true);
  assert.equal(_skipNeighborIp('10.0.0.2'), false);
  const net = makeNet({ '10.0.0.1': { host: 'CORE', neighbors: [nbr('127.0.0.1'), nbr('169.254.5.5'), nbr('10.0.0.2')] }, '10.0.0.2': { host: 'ACC1' } });
  const { ips } = await crawl(net);
  assert.deepEqual(ips.sort(), ['10.0.0.1', '10.0.0.2']);
});

test('abort: isAborted true ferma il crawl senza errori', async () => {
  const net = makeNet(NET);
  const { out } = await crawl(net, { isAborted: () => true });
  assert.equal(out.results.length, 0, 'nessun device con abort immediato');
});

test('cmpIp ordina numericamente per ottetti', () => {
  const a = ['10.0.0.20', '10.0.0.3', '10.0.0.100', '10.0.0.1'].sort(cmpIp);
  assert.deepEqual(a, ['10.0.0.1', '10.0.0.3', '10.0.0.20', '10.0.0.100']);
});

// ── candidati ARP: si INTERROGANO prima di descriverli ───────────────────────
// Il difetto: un apparato che non parla il protocollo di vicinato del collector
// (Arista solo LLDP, Cisco solo CDP) usciva dal crawl come host «osservato» a
// bassa confidenza anche se rispondeva SNMP con la stessa community — e una sweep
// sulla stessa subnet lo ritrovava gestito. Misurato al banco il 23/08: 3 apparati
// d'infrastruttura (Arista, Juniper, Extreme) descritti come PC.
const ARP_LIST = [
  { ip: '10.0.99.13', mac: '50:45:45:aa:95:55', viaFrom: '10.0.0.1' },   // risponde
  { ip: '10.0.99.50', mac: 'aa:bb:cc:dd:ee:ff', viaFrom: '10.0.0.1' },   // muto
];
// decorate finto: tiene solo cio' che serve al test (la riga vera la costruisce la route).
const dec = (row) => ({ ip: row.ip, mac: row.mac, hostname: row.hostname || '', snmp: !!row.snmpReachable, alive: !!row.alive, via: row.viaProtocol });

test('candidati ARP: chi risponde SNMP diventa un apparato, chi tace resta osservato', async () => {
  const asked = [];
  const probe = async (ip) => {
    asked.push(ip);
    return ip === '10.0.99.13'
      ? { reachable: true, hostname: 'SW-ARISTA', descr: 'Arista Networks EOS', objectId: '1.3.6.1.4.1.30065.1' }
      : { reachable: false };
  };
  const ev = [];
  const out = await probeArpCandidates(ARP_LIST, { pool: 2, probe, decorate: dec, emit: e => ev.push(e.type) });
  assert.deepEqual(asked.sort(), ['10.0.99.13', '10.0.99.50'], 'entrambi interrogati');
  assert.equal(out.answered, 1);
  assert.deepEqual(out.rows.map(r => [r.ip, r.snmp, r.hostname]), [
    ['10.0.99.13', true, 'SW-ARISTA'],
    ['10.0.99.50', false, ''],
  ], 'chi risponde porta identita\' e SNMP; chi tace resta com\'era');
  assert.deepEqual(ev.sort(), ['arp', 'found'], 'un ritrovamento e un osservato');
});

test('candidati ARP: un nome gia\' visto dal crawl e\' un SECONDO indirizzo, non un device in piu\'', async () => {
  const probe = async () => ({ reachable: true, hostname: 'SW-CORE' });
  const out = await probeArpCandidates([{ ip: '10.0.10.1', mac: '', viaFrom: '10.0.0.1' }], {
    probe, decorate: dec, knownNames: ['SW-CORE'],
  });
  assert.equal(out.dup, 1);
  assert.equal(out.rows.length, 0, 'nessuna riga: e\' l\'apparato che il crawl ha gia\'');
});

test('candidati ARP: una sonda che ESPLODE non ferma le altre', async () => {
  const probe = async (ip) => { if (ip === '10.0.99.13') throw new Error('socket'); return { reachable: false }; };
  const out = await probeArpCandidates(ARP_LIST, { probe, decorate: dec });
  assert.equal(out.answered, 0);
  assert.equal(out.rows.length, 2, 'l\'errore di una sonda non cancella nessun candidato');
});

test('candidati ARP: con abort non si interroga nessuno', async () => {
  let n = 0;
  const out = await probeArpCandidates(ARP_LIST, { probe: async () => { n++; return { reachable: true }; }, decorate: dec, isAborted: () => true });
  assert.equal(n, 0);
  assert.equal(out.rows.length, 0);
});
