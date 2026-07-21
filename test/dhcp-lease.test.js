// Test per il parser puro dei lease DHCP (lib/dhcp-lease.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDhcpLeases, detectLeaseFormat, reconcileDhcpLeases } = require('../lib/dhcp-lease.js');

const byMac = (res) => Object.fromEntries(res.leases.map(l => [l.mac, l]));

// ---------- ISC dhcpd ----------
const ISC = `
# ISC dhcpd lease file
lease 10.0.20.50 {
  starts 4 2026/06/26 10:00:00;
  ends 4 2026/06/26 22:00:00;
  binding state active;
  hardware ethernet aa:bb:cc:dd:ee:ff;
  client-hostname "laptop-01";
}
lease 10.0.20.51 {
  starts 4 2026/06/26 09:00:00;
  ends 4 2026/06/26 21:00:00;
  binding state active;
  hardware ethernet 11:22:33:44:55:66;
}
`;

test('ISC: blocchi lease → mac normalizzato, ip, hostname, stato, subnet', () => {
  const res = parseDhcpLeases(ISC, 'auto');
  assert.equal(res.format, 'isc');
  assert.equal(res.count, 2);
  const m = byMac(res);
  assert.ok(m['AA:BB:CC:DD:EE:FF'], 'MAC normalizzato UPPER colon-sep');
  assert.equal(m['AA:BB:CC:DD:EE:FF'].ip, '10.0.20.50');
  assert.equal(m['AA:BB:CC:DD:EE:FF'].hostname, 'laptop-01');
  assert.equal(m['AA:BB:CC:DD:EE:FF'].state, 'active');
  assert.equal(m['AA:BB:CC:DD:EE:FF'].subnet, '10.0.20');
  assert.equal(m['11:22:33:44:55:66'].hostname, '', 'hostname assente → stringa vuota');
});

test('ISC: blocco senza hardware ethernet (abandoned) viene saltato', () => {
  const txt = `lease 10.0.0.9 {\n  binding state abandoned;\n}\n` + ISC;
  const res = parseDhcpLeases(txt, 'auto');
  assert.equal(res.count, 2, 'solo i lease con MAC');
});

test('ISC: dedup per MAC tiene il lease con ends più recente', () => {
  const txt = `
lease 10.0.0.5 {
  ends 4 2026/06/26 10:00:00;
  binding state expired;
  hardware ethernet de:ad:be:ef:00:01;
}
lease 10.0.0.8 {
  ends 4 2026/06/26 20:00:00;
  binding state active;
  hardware ethernet de:ad:be:ef:00:01;
}`;
  const res = parseDhcpLeases(txt, 'auto');
  assert.equal(res.count, 1);
  assert.equal(res.parsed, 2, 'due righe lette, una dopo dedup');
  assert.equal(res.leases[0].ip, '10.0.0.8', 'vince il lease più recente');
  assert.equal(res.leases[0].state, 'active');
});

// ---------- dnsmasq ----------
const DNSMASQ = `duid 00:01:00:01:2a:...
1750944000 aa:bb:cc:11:22:33 10.0.30.10 printer-hp 01:aa:bb:cc:11:22:33
1750940000 a1:b2:c3:d4:e5:f6 10.0.30.11 * 01:a1:b2:c3:d4:e5:f6
`;

test('dnsmasq: righe → mac/ip/hostname; "*" → vuoto; duid saltato; epoch→ISO', () => {
  const res = parseDhcpLeases(DNSMASQ, 'auto');
  assert.equal(res.format, 'dnsmasq');
  assert.equal(res.count, 2);
  const m = byMac(res);
  assert.equal(m['AA:BB:CC:11:22:33'].ip, '10.0.30.10');
  assert.equal(m['AA:BB:CC:11:22:33'].hostname, 'printer-hp');
  assert.ok(/^2025-/.test(m['AA:BB:CC:11:22:33'].expiry), 'epoch convertito in ISO');
  assert.equal(m['A1:B2:C3:D4:E5:F6'].hostname, '', 'hostname "*" → vuoto');
});

// ---------- Kea CSV memfile ----------
const KEA = `address,hwaddr,client_id,valid_lifetime,expire,subnet_id,fqdn_fwd,fqdn_rev,hostname,state,user_context
10.0.40.20,aa:bb:cc:00:00:20,,3600,1750944000,4,0,0,nas-01,0,
10.0.40.21,aa:bb:cc:00:00:21,,3600,1750944000,4,0,0,,2,
`;

test('Kea CSV: header mappato; state 0→active, 2→expired; subnet_id; expire ISO', () => {
  const res = parseDhcpLeases(KEA, 'auto');
  assert.equal(res.format, 'kea-csv');
  assert.equal(res.count, 2);
  const m = byMac(res);
  assert.equal(m['AA:BB:CC:00:00:20'].ip, '10.0.40.20');
  assert.equal(m['AA:BB:CC:00:00:20'].hostname, 'nas-01');
  assert.equal(m['AA:BB:CC:00:00:20'].state, 'active');
  assert.equal(m['AA:BB:CC:00:00:20'].subnetId, 4);
  assert.equal(m['AA:BB:CC:00:00:21'].state, 'expired');
});

// ---------- CSV generico (export Windows / generico) ----------
const WIN_CSV = `IPAddress,ScopeId,AddressState,ClientId,HostName,LeaseExpiryTime
10.0.50.30,10.0.50.0,Active,aa-bb-cc-dd-ee-30,PC-OFFICE,2026-06-26T22:00:00
10.0.50.31,10.0.50.0,Active,AABB.CCDD.EE31,PC-DESK,
`;

test('CSV generico: header Windows (ClientId/IPAddress/HostName); MAC dash e dotted', () => {
  const res = parseDhcpLeases(WIN_CSV, 'auto');
  assert.equal(res.format, 'csv');
  assert.equal(res.count, 2);
  const m = byMac(res);
  assert.equal(m['AA:BB:CC:DD:EE:30'].ip, '10.0.50.30', 'MAC con trattini normalizzato');
  assert.equal(m['AA:BB:CC:DD:EE:30'].hostname, 'PC-OFFICE');
  assert.ok(m['AA:BB:CC:DD:EE:31'], 'MAC dotted (aabb.ccdd.ee31) normalizzato');
});

test('CSV generico: colonna VLAN opzionale viene letta', () => {
  const txt = `ip,mac,hostname,vlan\n10.0.60.5,aa:bb:cc:00:60:05,cam-01,60\n`;
  const res = parseDhcpLeases(txt, 'auto');
  assert.equal(res.count, 1);
  assert.equal(res.leases[0].vlan, 60);
});

// ---------- robustezza / validazione ----------
test('IPv4 non valido (ottetto > 255) → riga scartata', () => {
  const txt = `ip,mac\n10.0.0.999,aa:bb:cc:dd:ee:ff\n10.0.0.7,aa:bb:cc:dd:ee:aa\n`;
  const res = parseDhcpLeases(txt, 'auto');
  assert.equal(res.count, 1);
  assert.equal(res.leases[0].ip, '10.0.0.7');
});

test('MAC non valido (non 12 hex) → riga scartata', () => {
  const txt = `ip,mac\n10.0.0.7,not-a-mac\n10.0.0.8,aa:bb:cc:dd:ee:ff\n`;
  const res = parseDhcpLeases(txt, 'auto');
  assert.equal(res.count, 1);
  assert.equal(res.leases[0].mac, 'AA:BB:CC:DD:EE:FF');
});

test('input vuoto / spazzatura → unknown, nessun lease, nessun crash', () => {
  assert.equal(parseDhcpLeases('', 'auto').format, 'unknown');
  assert.equal(parseDhcpLeases('   \n\n', 'auto').count, 0);
  assert.equal(parseDhcpLeases('blah blah not a lease', 'auto').count, 0);
});

// ---------- detectLeaseFormat ----------
test('detectLeaseFormat: riconosce ciascun formato e unknown', () => {
  assert.equal(detectLeaseFormat(ISC), 'isc');
  assert.equal(detectLeaseFormat(DNSMASQ), 'dnsmasq');
  assert.equal(detectLeaseFormat(KEA), 'kea-csv');
  assert.equal(detectLeaseFormat(WIN_CSV), 'csv');
  assert.equal(detectLeaseFormat('niente di riconoscibile'), 'unknown');
});

test('format esplicito sovrascrive auto-detect', () => {
  // Testo CSV ma forziamo isc → nessun match (0 lease), senza crash.
  const res = parseDhcpLeases(WIN_CSV, 'isc');
  assert.equal(res.format, 'isc');
  assert.equal(res.count, 0);
});

// ---------- reconcileDhcpLeases (riconciliazione coi nodi) ----------
const NODES = [
  { id: 'pc1', name: 'PC-Ufficio', mac: 'AA:BB:CC:DD:EE:30', ip: '10.0.50.30' },          // IP combacia
  { id: 'pc2', name: 'PC-Sala', mac: 'aa-bb-cc-dd-ee-31', ip: '10.0.50.99' },             // IP cambiato (dash → match)
  { id: 'srv', name: 'NAS', mac: 'AA:BB:CC:00:00:20', ip: '10.0.40.5', ipManual: true },  // IP cambiato ma manuale
  { id: 'sw1', name: 'Switch', ip: '10.0.0.1' },                                          // senza MAC → ignorato
];
const LEASES = [
  { mac: 'AA:BB:CC:DD:EE:30', ip: '10.0.50.30', hostname: 'pc-office' },
  { mac: 'AA:BB:CC:DD:EE:31', ip: '10.0.50.30', hostname: 'pc-sala' }, // doc 10.0.50.99 → cambio
  { mac: 'AA:BB:CC:00:00:20', ip: '10.0.40.77', hostname: 'nas' },
  { mac: 'DE:AD:BE:EF:00:99', ip: '10.0.50.200', hostname: 'sconosciuto' },
];

test('reconcile: confirmed / updates / manualHold / unmatched classificati', () => {
  const r = reconcileDhcpLeases(LEASES, NODES);
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.confirmed[0].nodeId, 'pc1');

  assert.equal(r.updates.length, 1, 'solo il cambio su IP non-manuale');
  assert.equal(r.updates[0].nodeId, 'pc2');
  assert.equal(r.updates[0].oldIp, '10.0.50.99');
  assert.equal(r.updates[0].newIp, '10.0.50.30');

  assert.equal(r.manualHold.length, 1, 'il cambio su IP manuale è trattenuto');
  assert.equal(r.manualHold[0].nodeId, 'srv');
  assert.equal(r.manualHold[0].newIp, '10.0.40.77');

  assert.equal(r.unmatched.length, 1, 'MAC non documentato');
  assert.equal(r.unmatched[0].mac, 'DE:AD:BE:EF:00:99');
});

test('reconcile (hardening): un lease con MAC NON normalizzato (lowercase + dash) combacia comunque', () => {
  // Le chiavi di byMac sono _normMac dei MAC dei nodi: il lookup deve normalizzare
  // anche il MAC del lease, così un chiamante che passa lease "sporchi" (export
  // Linux/dnsmasq, case/separatori diversi) non genera falsi "non documentati".
  const nodes = [{ id: 'pc', name: 'PC', mac: 'AA:BB:CC:DD:EE:30', ip: '10.0.50.30' }];
  const leases = [{ mac: 'aa-bb-cc-dd-ee-30', ip: '10.0.50.45', hostname: 'pc' }];
  const r = reconcileDhcpLeases(leases, nodes);
  assert.equal(r.unmatched.length, 0, 'il MAC non normalizzato NON resta orfano');
  assert.equal(r.updates.length, 1, 'combacia col nodo → cambio IP');
  assert.equal(r.updates[0].nodeId, 'pc');
});

test('reconcile: input vuoti → tutte liste vuote, nessun crash', () => {
  const r = reconcileDhcpLeases([], []);
  assert.deepEqual(r, { updates: [], manualHold: [], confirmed: [], unmatched: [] });
});

// ── S2.2 (audit 2026-07-20): i lease INFINITI sono i più autorevoli ─────────
test('dedup: lease infinito attivo (ends never) VINCE sul lease storico scaduto datato', () => {
  // Riproduzione del bug: file ISC con un lease storico del 2017 (expired) e la
  // riserva corrente `ends never` per lo stesso MAC. Prima del fix il null
  // valeva epoch 0 → sopravviveva il 2017 → isLeaseStale=true → il device con
  // lease statico perdeva presenza e IP corrente.
  const ISC = [
    'lease 10.0.50.99 {',
    '  starts 3 2017/01/04 10:00:00;',
    '  ends 3 2017/01/04 22:00:00;',
    '  binding state expired;',
    '  hardware ethernet aa:bb:cc:dd:ee:99;',
    '}',
    'lease 10.0.50.10 {',
    '  starts 3 2026/07/01 10:00:00;',
    '  ends never;',
    '  binding state active;',
    '  hardware ethernet aa:bb:cc:dd:ee:99;',
    '  client-hostname "nas-static";',
    '}',
  ].join('\n');
  const res = parseDhcpLeases(ISC, 'isc');
  assert.equal(res.count, 1, 'dedup per MAC');
  const l = res.leases[0];
  assert.equal(l.ip, '10.0.50.10', 'sopravvive il lease corrente, non lo storico 2017');
  assert.equal(l.state, 'active');
  assert.equal(l.expiry, null, 'ends never → expiry infinita (null)');
  const { isLeaseStale } = require('../lib/dhcp-lease.js');
  assert.equal(isLeaseStale(l), false, 'lease infinito attivo = presenza valida');
});

test('dedup: lease morto senza expiry NON vince su un lease attivo datato futuro', () => {
  const { parseDhcpLeases: p } = require('../lib/dhcp-lease.js');
  const ISC = [
    'lease 10.0.50.20 {',
    '  ends 3 2099/01/04 22:00:00;',
    '  binding state active;',
    '  hardware ethernet aa:bb:cc:dd:ee:98;',
    '}',
    'lease 10.0.50.21 {',
    '  ends never;',
    '  binding state released;',
    '  hardware ethernet aa:bb:cc:dd:ee:98;',
    '}',
  ].join('\n');
  const res = p(ISC, 'isc');
  assert.equal(res.count, 1);
  assert.equal(res.leases[0].ip, '10.0.50.20', 'lo stato morto (released) non è autorevole anche se senza scadenza');
});

// ── DRIFT-A3: la fusione multi-fonte usa lo stesso ranking del dedup intra-fonte ──
test('mergeLeaseSources: riserva statica (∞) di una fonte VINCE su un released datato di un\'altra', () => {
  const { mergeLeaseSources } = require('../lib/dhcp-lease.js');
  const sources = [
    // Server A: riserva statica corrente per il MAC (expiry infinito = null)
    { name: 'srvA', leases: [{ mac: 'AA:BB:CC:00:00:01', ip: '10.0.0.9', state: 'active', expiry: null }] },
    // Server B: vecchio lease released datato per lo STESSO MAC
    { name: 'srvB', leases: [{ mac: 'AA:BB:CC:00:00:01', ip: '10.9.9.9', state: 'released', expiry: '2023-01-01T00:00:00Z' }] },
  ];
  const merged = mergeLeaseSources(sources);
  assert.equal(merged.length, 1, 'un solo lease per MAC dopo la fusione');
  assert.equal(merged[0].ip, '10.0.0.9', 'vince la riserva statica infinita, non il released datato (no bug S2.2 cross-fonte)');
});

test('mergeLeaseSources: fra due datati per lo stesso MAC vince il più recente', () => {
  const { mergeLeaseSources } = require('../lib/dhcp-lease.js');
  const merged = mergeLeaseSources([
    { leases: [{ mac: 'AA:BB:CC:00:00:02', ip: '10.0.0.1', state: 'active', expiry: '2026-01-01T00:00:00Z' }] },
    { leases: [{ mac: 'AA:BB:CC:00:00:02', ip: '10.0.0.2', state: 'active', expiry: '2026-06-01T00:00:00Z' }] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].ip, '10.0.0.2', 'expiry più recente vince');
});
