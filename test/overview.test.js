'use strict';
// ============================================================
//  test/overview.test.js — lib/overview.js (fatti della Panoramica).
//
//  Il punto di questa lib non e' "fare i conti": e' non mentire. I test pinnano
//  soprattutto i casi in cui un numero SEMBRA una risposta e non lo e':
//    - l'infrastruttura conta fra gli indirizzabili (niente hasIP sugli attivi);
//    - un nome uguale all'indirizzo NON e' un nome;
//    - zero porte in fibra libere != nessuna porta in fibra dichiarata;
//    - le porte libere ma viste attive non sono margine disponibile;
//    - il dato assente esce come 'none', mai come 0.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { buildOverview, _isAddressable, _hasRealName, _rackFill, _BLIND_SPOTS } = require('../lib/overview.js');

const TYPES = {
  switch: { isActive: true, isRack: true },      // attivo: hasIP implicito
  router: { isActive: true, isRack: true },
  pc:     { hasIP: true, isFloor: true },
  printer: { hasIP: true, isFloor: true },       // non e' infrastruttura, ma parla SNMP
  ups:    { hasIP: true, isPassive: true, isRack: true },
  wallport: { isPassive: true },                 // niente IP possibile
  room:   { isStructural: true },
};

const rowOf = (sec, key) => sec.rows.find((r) => r.key === key);

test('indirizzabile = attivo OPPURE hasIP (l\'infrastruttura non sparisce dal conto)', () => {
  assert.equal(_isAddressable({ isActive: true }), true);
  assert.equal(_isAddressable({ hasIP: true }), true);
  assert.equal(_isAddressable({ isPassive: true }), false);
  assert.equal(_isAddressable(null), false);
});

test('un nome uguale all\'indirizzo non e\' un nome (IPv4 e IPv6)', () => {
  assert.equal(_hasRealName({ name: 'SW-CORE', ip: '10.0.0.1' }), true);
  assert.equal(_hasRealName({ name: '10.0.0.1', ip: '10.0.0.1' }), false);
  assert.equal(_hasRealName({ name: 'fe80::1', ip6: 'fe80::1' }), false);
  assert.equal(_hasRealName({ name: '', ip: '10.0.0.1' }), false, 'nessun nome != nome vero');
});

test('input vuoto: tre sezioni, nessun throw, nessun numero inventato', () => {
  for (const bad of [undefined, null, 42, 'x', {}]) {
    const o = buildOverview(bad);
    assert.ok(o.complete && o.truth && o.margin, 'le tre sezioni ci sono sempre');
    assert.equal(rowOf(o.complete, 'addr').total, 0);
    assert.equal(rowOf(o.margin, 'freeSfp').prov, 'none', 'nessuna fibra dichiarata -> non dichiarato');
  }
});

test('① COMPLETO: struttura e passivi fuori dal denominatore, le lacune escono come elenco', () => {
  const nodes = [
    { id: 'r1', type: 'room' },                                            // strutturale
    { id: 'wp1', type: 'wallport' },                                       // passivo senza IP
    { id: 'sw1', type: 'switch', name: 'SW-CORE', ip: '10.0.0.1', mac: 'aa:bb:cc:00:00:01' },
    { id: 'rt1', type: 'router', name: '10.0.0.254', ip: '10.0.0.254' },   // nome = IP, niente MAC
    { id: 'pc1', type: 'pc', ip: '10.0.0.50', mac: 'aa:bb:cc:00:00:02' },  // nessun nome
    { id: 'ups1', type: 'ups' },                                           // indirizzabile SENZA IP
  ];
  const o = buildOverview({ types: TYPES, nodes,
    links: [{ src: 'sw1-1', dst: 'rt1-1' }, { autoLinked: true, src: 'sw1-2', dst: 'pc1-1' }],
    spare: { totals: { used: 4 } } });
  const c = o.complete;
  assert.equal(rowOf(c, 'addr').total, 4, 'switch+router+pc+ups (stanza e presa fuori)');
  assert.equal(rowOf(c, 'addr').value, 3, 'l\'UPS non ha indirizzo');
  // Il dettaglio è l'ABBINAMENTO ARP: tutti gli indirizzabili, con IP e MAC. Le
  // lacune restano IN CIMA — prima chi non ha IP, poi chi non ha MAC.
  assert.deepEqual(rowOf(c, 'addr').items.map((i) => [i.id, i.addr, i.mac]), [
    ['ups1', '', ''],                                  // né IP né MAC → primo
    ['rt1', '10.0.0.254', ''],                         // IP sì, MAC no → secondo
    ['pc1', '10.0.0.50', 'aa:bb:cc:00:00:02'],
    ['sw1', '10.0.0.1', 'aa:bb:cc:00:00:01'],
  ]);
  assert.equal(rowOf(c, 'name').value, 1, 'solo SW-CORE ha un nome vero');
  assert.deepEqual(rowOf(c, 'name').items.map((i) => i.id).sort(), ['pc1', 'rt1', 'ups1']);
  // Il MAC non è più una riga a sé: vive dentro `addr`, con la sua lacuna e la sua
  // provenienza. Il numero grande della riga resta quello degli IP.
  assert.equal(rowOf(c, 'mac'), undefined, 'niente più riquadro «Indirizzo MAC» separato');
  assert.equal(rowOf(c, 'addr').extra.mac, 2, 'due apparati hanno un MAC osservato');
  assert.equal(rowOf(c, 'addr').extra.macNone, 2, 'e due no');
  assert.equal(rowOf(c, 'addr').extra.fromPorts, 0, 'nessun MAC preso dalle interfacce qui');
  assert.equal(rowOf(c, 'cables').value, 2);
  // Un cavo dedotto dall'auto-link NON è un cavo dichiarato: la sezione che
  // chiede «il documento descrive tutto?» deve tenerli separati.
  assert.deepEqual(rowOf(c, 'cables').extra, { portsUsed: 4, auto: 1, manual: 1 });
  // Il click sui Cavi mostra i DEDOTTI (i «da verificare»), coi due capi come nodo.
  assert.deepEqual(rowOf(c, 'cables').items, [{ id: 'sw1', peer: 'pc1' }]);
  assert.equal(rowOf(c, 'addr').pct, 75, 'la percentuale la calcola la lib, non il renderer');
});

test('① COMPLETO: dopo una Verifica la riga Cavi porta il numero-d\'identità del cablaggio (Proof-State)', () => {
  const fresh = new Date().toISOString();
  const nodes = [
    { id: 'sw1', type: 'switch', name: 'SW', ip: '10.0.0.1', proof: { status: 'proven', lastProvenAt: fresh } },
    { id: 'rt1', type: 'router', name: 'RT', ip: '10.0.0.254', proof: { status: 'proven', lastProvenAt: fresh } },
    { id: 'pc1', type: 'pc', name: 'PC', ip: '10.0.0.50', proof: { status: 'unverified' } },   // muto in questa passata
  ];
  const o = buildOverview({ types: TYPES, nodes, links: [
    { id: 'lm', src: 'sw1-1', dst: 'rt1-1' },                                                       // manuale, estremi provati → declared
    { id: 'ls', autoLinked: true, protocol: 'LLDP', confidence: 0.97, src: 'sw1-2', dst: 'rt1-2' }, // dedotto forte, provati → derived-strong
    { id: 'lg', autoLinked: true, protocol: 'MAC', confidence: 0.72, src: 'sw1-3', dst: 'pc1-1' },  // dedotto verso muto → ghost
  ] });
  const ex = rowOf(o.complete, 'cables').extra;
  assert.equal(ex.proofCounts.declared, 1, 'il manuale con estremi provati resta declared (il dichiarato è legge)');
  assert.equal(ex.proofCounts.derivedStrong, 1, 'LLDP 0.97 con estremi provati → derived-strong');
  assert.equal(ex.proofCounts.ghost, 1, 'dedotto verso un estremo unverified → ghost');
  assert.equal(ex.proofScore.total, 3, 'i tre cavi entrano nel Truth Score');
  assert.equal(ex.proofScore.declared, 1, 'un cavo dichiarato, tenuto distinto (non collassato in proven)');
  assert.equal(ex.proofScore.proven, 0, 'un cavo non è mai «provato» dalla macchina, solo i suoi estremi');
  // Ogni cavo (dedotto) porta il SUO stato di prova nell'item del drill-down (il badge).
  const items = rowOf(o.complete, 'cables').items;
  assert.equal(items.length, 2, 'i due cavi dedotti nel drill-down «da verificare»');
  assert.ok(items.some((i) => i.proof === 'ghost'), 'il dedotto verso il muto porta ghost nel suo item');
  assert.ok(items.some((i) => i.proof === 'derived-strong'), 'il dedotto forte porta derived-strong nel suo item');
  // Retro-compatibile: SENZA proof (nessuna Verifica) la extra non porta i nuovi campi.
  const noProof = buildOverview({ types: TYPES, nodes: [{ id: 'a', type: 'switch', ip: '1.1.1.1' }],
    links: [{ src: 'a-1', dst: 'a-2' }] });
  assert.equal(rowOf(noProof.complete, 'cables').extra.proofCounts, undefined, 'niente proof → nessun campo aggiunto');
});

test('① REGRESSIONE: su un apparato SNMP il MAC sta sulle INTERFACCE, non su node.mac', () => {
  // Caso reale (Rete+Lab, 2026-07-23): 6 switch/router gestiti via SNMP hanno
  // `node.mac` vuoto e il MAC per-porta (ifPhysAddress) + quello dei LAG. La
  // Panoramica li dichiarava "senza MAC": un dato che c'è, dato per mancante.
  const nodes = [
    { id: 'sw1', type: 'switch', name: 'SW-CORE', ip: '10.0.0.1', mac: '' },   // MAC solo sulle porte
    { id: 'sw2', type: 'switch', name: 'SW-ACC', ip: '10.0.0.2', mac: '' },    // nessun MAC da nessuna parte
    { id: 'pc1', type: 'pc', name: 'PC-1', ip: '10.0.0.50', mac: 'aa:bb:cc:00:00:01' },
  ];
  const o = buildOverview({ types: TYPES, nodes, portMacNodeIds: new Set(['sw1']),
    portMacById: { sw1: '00:11:22:33:44:55' } });
  const addr = rowOf(o.complete, 'addr');
  assert.equal(addr.extra.mac, 2, 'sw1 conta come documentato: l\'identità L2 c\'è');
  assert.equal(addr.extra.fromPorts, 1, 'e si dichiara che arriva dalle interfacce');
  assert.equal(addr.extra.macNone, 1, 'manca solo a chi non ce l\'ha davvero');
  // Nel dettaglio ARP chi non ha MAC viene per primo. sw1 il MAC ce l'ha ma sulle
  // INTERFACCE: si mostra quello, non un trattino — dare per assente un indirizzo
  // che la riga stessa conta come documentato sarebbe la contraddizione peggiore.
  assert.deepEqual(addr.items.map((i) => [i.id, i.mac, i.macFromPorts]),
    [['sw2', '', false], ['pc1', 'aa:bb:cc:00:00:01', false], ['sw1', '00:11:22:33:44:55', true]]);

  // Accetta anche un array (non solo Set): il chiamante non deve indovinare il tipo.
  const o2 = buildOverview({ types: TYPES, nodes, portMacNodeIds: ['sw1', 'sw2'] });
  assert.equal(rowOf(o2.complete, 'addr').extra.mac, 3);
  assert.equal(rowOf(o2.complete, 'addr').extra.fromPorts, 2);
});

test('① un hostname PINNATO A MANO vale come nome proprio anche se node.name resta l\'IP', () => {
  // Il campo Hostname (app-properties.js) aggiorna hostname+hostnameManual ma NON
  // node.name: un device puo' avere un nome dato a mano e mostrarsi ancora come IP.
  // Quello e' un nome vero; il node.hostname AUTO (grezzo, blob) invece no.
  const nodes = [
    { id: 'a', type: 'pc', ip: '10.0.0.1', name: 'PC-Uff' },                                            // nome vero classico
    { id: 'b', type: 'pc', ip: '10.0.0.2', name: '10.0.0.2', hostname: 'SRV-DB', hostnameManual: true },// name=IP, hostname MANUALE → conta
    { id: 'c', type: 'pc', ip: '10.0.0.3', name: '10.0.0.3', hostname: 'DESKTOP-9F2A1' },               // hostname AUTO (non manuale) → NON conta
    { id: 'd', type: 'pc', ip: '10.0.0.4', name: '10.0.0.4', hostname: '10.0.0.4', hostnameManual: true },// hostname manuale = IP → NON conta
    { id: 'e', type: 'pc', ip: '10.0.0.5', name: '10.0.0.5', hostnameManual: true },                    // manuale ma hostname vuoto → NON conta
  ];
  const name = rowOf(buildOverview({ types: TYPES, nodes }).complete, 'name');
  assert.equal(name.value, 2, 'a (nome vero) + b (hostname manuale)');
  assert.deepEqual(name.items.map((i) => i.id).sort(), ['c', 'd', 'e'], 'restano senza nome solo c/d/e');
  // e la funzione pura, i casi limite:
  assert.equal(_hasRealName({ name: '10.0.0.2', ip: '10.0.0.2', hostname: 'SRV-DB', hostnameManual: true }), true);
  assert.equal(_hasRealName({ name: '10.0.0.3', ip: '10.0.0.3', hostname: 'DESKTOP-X' }), false, 'auto (non manuale) non conta');
  assert.equal(_hasRealName({ name: '10.0.0.5', ip: '10.0.0.5', hostnameManual: true }), false, 'manuale ma vuoto non conta');
});

test('① il titolo grande e\' la lacuna piu\' grave presente, in ordine fisso', () => {
  const base = { types: TYPES, links: [] };
  // manca un indirizzo -> vince 'addr' anche se mancano pure nomi
  const a = buildOverview(Object.assign({}, base, { nodes: [
    { id: 'a', type: 'pc' }, { id: 'b', type: 'pc', ip: '10.0.0.2' },
  ] }));
  assert.equal(a.complete.headline.key, 'addr');
  // tutti indirizzati, nomi mancanti -> vince 'name'
  const b = buildOverview(Object.assign({}, base, { nodes: [
    { id: 'a', type: 'pc', ip: '10.0.0.1' }, { id: 'b', type: 'pc', ip: '10.0.0.2', name: 'PC-UFF' },
  ] }));
  assert.equal(b.complete.headline.key, 'name');
  assert.equal(b.complete.headline.gap, 1, 'quante ne mancano, non quante ce ne sono');
});

test('① subnet e nomi VLAN assenti escono come «non dichiarato», non come zero', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'pc1', type: 'pc', ip: '10.0.0.5' }],
    vlanIdsInUse: [1, 10, 20], vlanNames: {},
    networks: [{ cidr: '10.0.0.0/24', deviceCount: 7 }],
  });
  const sub = rowOf(o.complete, 'subnets');
  assert.equal(sub.prov, 'none', 'nessuna subnet dichiarata');
  assert.equal(sub.extra.observed, 1, 'ma una rete e\' OSSERVATA dagli indirizzi');
  assert.deepEqual(sub.items[0], { id: '10.0.0.0/24', meta: 7, tag: 'undeclared', net: '10.0.0.0/24' });
  assert.equal(rowOf(o.complete, 'vlanNames').prov, 'none');
  assert.equal(rowOf(o.complete, 'vlanNames').total, 3, '3 VLAN in uso, 0 con un nome');
});

test('① Nomi VLAN via SNMP: colma le lacune e segnala i conflitti; il dichiarato non viene mai riscritto', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1' }],
    vlanIdsInUse: [10, 20, 30, 40],
    vlanNames: { 10: 'Voice', 20: 'Guest' },            // dichiarate: 10 e 20
    measuredVlanNames: {
      10: { name: 'Voice' },                            // dichiarato = misurato → ok
      20: { name: 'VOIP' },                             // dichiarato ≠ misurato → conflitto
      30: { name: 'Servers' },                          // non dichiarato, ma la rete lo sa → colmabile
      // 40: nessun nome da nessuna parte → gap semplice (né colmabile né conflitto)
    },
  });
  const vn = rowOf(o.complete, 'vlanNames');
  assert.equal(vn.value, 2, 'due nomi DICHIARATI (10, 20) — SNMP non li conta come suoi');
  assert.equal(vn.total, 4);
  assert.equal(vn.extra.fromSnmp, 1, 'VLAN 30 colmabile da SNMP');
  assert.equal(vn.extra.conflict, 1, 'VLAN 20 in conflitto (Guest ↔ VOIP)');
  // drill-down: prima i conflitti (decisione umana), poi le lacune colmabili.
  assert.deepEqual(vn.items, [
    { id: 'VLAN 20', meta: 'Guest ↔ VOIP', vid: 20 },
    { id: 'VLAN 30', meta: 'Servers', tag: 'measured', vid: 30 },
  ]);
});

test('① Nomi VLAN: due switch che discordano tra loro = conflitto (paletto ② no vincitore arbitrario)', () => {
  const vn = rowOf(buildOverview({
    types: TYPES, nodes: [],
    vlanIdsInUse: [100], vlanNames: { 100: 'Voice' },
    measuredVlanNames: { 100: { name: 'Voice', said: [
      { node: 'SW-A', name: 'Voice' }, { node: 'SW-B', name: 'Telefoni' },
    ] } },
  }).complete, 'vlanNames');
  assert.equal(vn.extra.conflict, 1, 'gli switch discordano → conflitto, anche se il dichiarato combacia con uno');
});

test('① Il conflitto NOMINA il dissenziente: mai due volte lo stesso nome', () => {
  // Il difetto che questo test inchioda: la riga stampava «dichiarato ↔ PRIMO misurato»,
  // e quando a discordare erano gli apparati fra loro usciva «DATA ↔ DATA» — un'accusa
  // che chi legge non può né capire né chiudere. Il nome divergente esisteva solo in un
  // commento. Misurato al banco il 23/08: SW-CORE/SW-ACC1 dicono DATA, l'Arista VLAN0010.
  const vn = rowOf(buildOverview({
    types: TYPES, nodes: [],
    vlanIdsInUse: [10], vlanNames: { 10: 'DATA' },
    measuredVlanNames: { 10: { name: 'DATA', said: [
      { node: 'SW-CORE', name: 'DATA' }, { node: 'SW-ACC1', name: 'DATA' }, { node: 'vEOS', name: 'VLAN0010' },
    ] } },
  }).complete, 'vlanNames');
  assert.equal(vn.extra.conflict, 1);
  assert.deepEqual(vn.items, [{ id: 'VLAN 10', meta: 'DATA (SW-CORE, SW-ACC1) ↔ VLAN0010 (vEOS)', vid: 10 }],
    'si vede CHI dice cosa; il dichiarato non si ripete, perché due apparati lo confermano');
});

test('① Nomi VLAN: la sola MAIUSCOLA non è una discordanza del fabric', () => {
  // Misurato al banco: la VLAN 1 è `default` per Cisco e Arista e `Default` per Extreme.
  // È la stessa VLAN e lo stesso nome — accusarli di discordare è un falso positivo che
  // insegna a saltare gli avvisi veri. Famiglia di macKey/addrKey: mai confronti nudi.
  const vn = rowOf(buildOverview({
    types: TYPES, nodes: [],
    vlanIdsInUse: [1, 20], vlanNames: { 1: 'default', 20: 'VOIP' },
    measuredVlanNames: {
      1:  { name: 'default', said: [{ node: 'SW-CORE', name: 'default' }, { node: 'EXOS', name: 'Default' }] },
      20: { name: 'voip',    said: [{ node: 'SW-CORE', name: 'voip' }] },   // dichiarato «VOIP»: stesso nome
    },
  }).complete, 'vlanNames');
  assert.equal(vn.extra.conflict, 0, 'né fra apparati né contro il dichiarato: cambia solo come ogni vendor lo compita');
  assert.deepEqual(vn.items, [], 'nessun reperto da mostrare');
});

test('① Nomi VLAN: il verbale senza rappresentante resta leggibile (lacuna colmabile)', () => {
  const vn = rowOf(buildOverview({
    types: TYPES, nodes: [],
    vlanIdsInUse: [30], vlanNames: {},
    measuredVlanNames: { 30: { said: [{ node: 'SW-CORE', name: 'SERVER' }] } },   // niente `name`
  }).complete, 'vlanNames');
  assert.equal(vn.extra.fromSnmp, 1, 'la rete un nome ce l\'ha: si legge dal verbale, non solo dal rappresentante');
  assert.deepEqual(vn.items, [{ id: 'VLAN 30', meta: 'SERVER', tag: 'measured', vid: 30 }]);
});

test('① Gateway per subnet: le dichiarate SENZA gateway emergono come lacuna (dato dal pannello VLAN)', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1' }],
    ipamVlans: {
      10: { subnet: '10.0.0.0/24', gateway: '10.0.0.1' },   // completa
      20: { subnet: '10.0.20.0/24' },                        // subnet senza gateway
      30: { subnet: '', gateway: '' },                       // niente CIDR → non conta
    },
  });
  const gw = rowOf(o.complete, 'gateways');
  assert.equal(gw.total, 2, 'solo le VLAN con un CIDR (10 e 20)');
  assert.equal(gw.value, 1, 'solo la 10 ha il gateway');
  // Il click elenca TUTTE le dichiarate (la mappa subnet→gateway): prima le SENZA
  // gateway (marcate, azione), poi le complete con il loro gateway come meta.
  assert.deepEqual(gw.items.map((i) => i.id), ['10.0.20.0/24', '10.0.0.0/24'],
    'prima le subnet SENZA gateway, poi le complete');
  assert.deepEqual(gw.items[0], { id: '10.0.20.0/24', meta: '—', tag: 'noGateway', net: '10.0.20.0/24' }, 'la lacuna è marcata');
  assert.deepEqual(gw.items[1], { id: '10.0.0.0/24', meta: '10.0.0.1', net: '10.0.0.0/24' }, 'la completa mostra il suo gateway');
  assert.equal(gw.prov, 'declared');
  assert.ok(o.complete.health.issues >= 1, 'un gateway mancante pesa sulla salute di Documento');

  // Nessuna subnet dichiarata → prov 'none' e NON conta come lacuna gateway
  // (la mancanza di subnet è già detta dalla riga subnets).
  const noIpam = buildOverview({ types: TYPES, nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1' }] });
  assert.equal(rowOf(noIpam.complete, 'gateways').prov, 'none');
  assert.equal(rowOf(noIpam.complete, 'gateways').total, 0);
});

test('② VERO: verificabili, porte sospette ordinate per gravita, chi non ha mai risposto', () => {
  const nodes = [
    { id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } },
    { id: 'sw2', type: 'switch', ip: '10.0.0.2', integration: { driver: 'snmp-v2c' } },
    { id: 'pc1', type: 'pc', ip: '10.0.0.50' },
    { id: 'pc2', type: 'pc', ip: '10.0.0.51' },
  ];
  const o = buildOverview({
    types: TYPES, nodes, now: 5000, lastSyncAt: 2000, lastSyncResult: { ok: 2, total: 2, at: 2000 },
    topoCache: { sw1: { ts: 1900, neighbors: [
      { remoteDevice: 'R-EDGE', remotePort: 'e2' }, { remoteDevice: 'AP-1' }, { remoteIP: '10.0.0.9' },
      { remoteDevice: 'AA:BB:CC:DD:EE:FF', remotePort: 'eth0' },   // vicino annunciato SOLO col MAC
    ] } },   // sw2: mai risposto
    macToNode: { aabbccddeeff: 'pc1' },   // quel MAC e' di pc1 (formato diverso: risolve lo stesso)
    lagGroups: { 'snmp-lag-sw1-1': 'LAG1', 'lldp-lag-sw1||sw2': 'Po1' },
    spare: { totals: { free: 40, suspect: 5, ports: 48, freeSfp: 0 },
      racks: [{ devices: [{ id: 'sw1', suspect: 2 }, { id: 'sw2', suspect: 3 }] }], unracked: [] },
  });
  const t = o.truth;
  assert.equal(rowOf(t, 'verifiable').value, 2, 'sw1 e sw2 hanno driver+host/ip');
  assert.equal(rowOf(t, 'verifiable').total, 2, 'il denominatore e\' la popolazione GESTIBILE, non i PC');
  assert.equal(rowOf(t, 'verifiable').extra.unverifiable, 2, 'i due PC non si interrogano: non verificabili');
  assert.deepEqual(rowOf(t, 'verifiable').items.map((i) => i.tag), ['unverifiable', 'unverifiable']);
  assert.equal(rowOf(t, 'lastSync').extra.ageMs, 3000, 'eta\' del dato, non un timestamp crudo');
  assert.deepEqual(rowOf(t, 'suspectPorts').items, [{ id: 'sw2', meta: 3 }, { id: 'sw1', meta: 2 }],
    'peggiore in cima: si ordina per cio\' su cui si agisce');
  assert.equal(rowOf(t, 'suspectPorts').tone, 'alert');
  const nb = rowOf(t, 'neighbors');
  assert.equal(nb.value, 4);
  assert.equal(nb.extra.neverAnswered, 1, 'sw2 non ha mai risposto: resta in extra');
  // Il click mostra le ADIACENZE (numero grande e lista coincidono), NON i mai-risposto:
  // era il bug «mi dice 15 poi ne esce 1» (2026-07-24).
  assert.equal(nb.items.length, 4, 'quattro adiacenze, come il numero in cima');
  assert.deepEqual(nb.items.map((i) => i.id), ['sw1', 'sw1', 'sw1', 'sw1']);
  // I primi tre non risolvono a un device del progetto: restano testo.
  assert.deepEqual(nb.items.slice(0, 3).map((i) => i.meta), ['R-EDGE · e2', 'AP-1', '10.0.0.9']);
  assert.ok(nb.items.slice(0, 3).every((i) => !i.peer), 'nessun peer per i vicini non risolti');
  // Il quarto: chassis-id MAC che corrisponde a un device → risolto a peer (nome),
  // la porta remota resta come meta. Formato MAC diverso, stessa chiave esadecimale.
  assert.equal(nb.items[3].peer, 'pc1', 'MAC del vicino risolto al device');
  assert.equal(nb.items[3].meta, 'eth0');
  const lg = rowOf(t, 'lags');
  assert.deepEqual(lg.extra, { measured: 1, derived: 1 }, 'la chiave dice da dove viene');
  // Cliccabile: i LAG coi due capi risolti e la provenienza per-voce (misurato/dedotto).
  assert.deepEqual(lg.items.map((i) => i.id), ['sw1', 'sw1']);
  assert.deepEqual(lg.items.map((i) => i.peer), [null, 'sw2'], 'lldp-lag-<a>||<b>: il secondo capo');
  assert.deepEqual(lg.items.map((i) => i.tag), ['measured', 'derived']);
  assert.deepEqual(lg.items.map((i) => i.meta), ['LAG1', 'Po1']);
  // ⭐ `unread` e non `none`: qui non manca una TUA dichiarazione, manca una
  // VERIFICA. Resta tratteggiata come prima — cambia la parola, non la forma.
  assert.equal(rowOf(t, 'verify').prov, 'unread', 'mai verificato -> riga \'unread\' (tratteggiata), non 0');
  assert.equal(t.headline.key, 'suspectPorts', 'il colpo d\'occhio e\' la cosa da guardare');
});

test('② VERO: la Verifica persistita diventa STATO (riga misurata + salute warn)', () => {
  const model = {
    types: TYPES,
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncAt: 1000, now: 1000 + 3000,
    // conteggi come da buildDriftReport: azionabili = stato+MAC+non-doc+cavi+IP+identità.
    // undocumentedEndpoint e identityFirmware NON entrano (rumore/informativo).
    lastVerify: { at: 1000, banner: 'discrepancies', docCount: 5, counts: {
      stateDrift: 2, macOrphan: 1, undocumented: 1, undocumentedEndpoint: 9,
      ghostCable: 0, ipChanged: 1, identityDrift: 0, identityFirmware: 3, unverified: 0, consistent: 4,
    } },
  };
  const t = buildOverview(model).truth;
  const v = rowOf(t, 'verify');
  assert.equal(v.prov, 'measured', 'verificato almeno una volta -> stato reale, non piu\' \'none\'');
  assert.equal(v.value, 5, '2 stato + 1 MAC + 1 non-doc + 0 cavi + 1 IP + 0 identita\' = 5 (no endpoint/firmware)');
  assert.equal(v.extra.ageMs, 3000, 'eta\' del dato dalla Verifica, non un timestamp crudo');
  assert.equal(v.extra.banner, 'discrepancies');
  assert.equal(t.health.level, 'warn', 'differenze da decidere -> sezione in avviso');
  assert.equal(t.health.issues, 5, 'gli issues includono le differenze (il delta migliora risolvendole)');

  // Allineato: girata ma zero azionabili -> riga misurata a 0 (affermazione), salute ok.
  const aligned = buildOverview(Object.assign({}, model, {
    lastVerify: { at: 1000, banner: 'aligned', docCount: 5, counts: { stateDrift: 0, macOrphan: 0, undocumented: 0, ghostCable: 0, ipChanged: 0, identityDrift: 0, unverified: 0, consistent: 5 } },
  })).truth;
  assert.equal(rowOf(aligned, 'verify').value, 0, 'zero differenze = 0 (non \'none\': la Verifica c\'e\' stata)');
  assert.equal(rowOf(aligned, 'verify').prov, 'measured');
  assert.equal(aligned.health.level, 'ok', 'nessuna anomalia e coerente -> ok');
});

test('② VERO: i conflitti IPAM (IP duplicati + overlap subnet) emergono come riga e ingialliscono il verdetto', () => {
  const base = {
    types: TYPES,
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncAt: 1000, now: 2000, lastSyncResult: { at: 1000, ok: 1, total: 1 },
    // Igiene CALCOLATA e risultata pulita: un oggetto (vuoto) e' un esito, non
    // l'assenza di esito — vedi il caso «non valutata» in fondo al test.
    ipamAudit: { duplicateIps: [], subnetOverlaps: [] },
  };
  // Rete pulita: la riga c'e' comunque, a 0, e non abbassa la salute.
  const clean = buildOverview(base).truth;
  const cr = rowOf(clean, 'conflicts');
  assert.ok(cr, 'la riga conflicts e\' sempre presente');
  assert.equal(cr.value, 0);
  assert.equal(cr.prov, 'derived');
  assert.equal(clean.health.level, 'ok', 'nessun conflitto -> verde');

  // Un IP duplicato + un overlap di subnet: value = somma, verdetto warn.
  const dirty = buildOverview(Object.assign({}, base, {
    ipamAudit: {
      duplicateIps: [{ ip: '10.0.0.9', nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }],
      subnetOverlaps: [{ a: { cidr: '10.0.0.0/24', vlan: 10 }, b: { cidr: '10.0.0.0/25', vlan: 20 }, identical: false }],
    },
  })).truth;
  const dr = rowOf(dirty, 'conflicts');
  assert.equal(dr.value, 2, 'un duplicato + un overlap = 2 conflitti');
  assert.equal(dr.extra.dup, 1);
  assert.equal(dr.extra.overlap, 1);
  assert.equal(dr.tone, 'alert');
  // Il duplicato a 2 nodi e' cliccabile su entrambi i capi; l'IP nel meta.
  assert.deepEqual(dr.items[0], { id: 'a', peer: 'b', meta: '10.0.0.9' });
  // L'overlap: ancora testuale + VLAN nel meta (nessun nodo da risolvere).
  assert.equal(dr.items[1].id, '10.0.0.0/24 ⇄ 10.0.0.0/25');
  assert.equal(dr.items[1].meta, 'VLAN 10/20');
  assert.equal(dirty.health.level, 'warn', 'un conflitto IPAM ingiallisce la «Vero»');
  assert.equal(dirty.health.issues, 2, 'i conflitti contano fra gli issues');

  // Un duplicato con >2 nodi: l'IP fa da ancora, i nomi nel meta.
  const many = buildOverview(Object.assign({}, base, {
    ipamAudit: { duplicateIps: [{ ip: '10.0.0.9', nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] }], subnetOverlaps: [] },
  })).truth;
  const mr = rowOf(many, 'conflicts');
  assert.equal(mr.items[0].id, '10.0.0.9');
  assert.equal(mr.items[0].meta, 'A, B, C');

  // La VLAN del prefisso e' FACOLTATIVA: senza, '—' (mai «VLAN 0»); se non ce l'ha
  // nessuna delle due non c'e' niente da nominare e resta il solo marcatore '='.
  const noVlan = buildOverview(Object.assign({}, base, {
    ipamAudit: {
      duplicateIps: [],
      subnetOverlaps: [
        { a: { cidr: '172.16.0.0/16', vlan: null }, b: { cidr: '172.16.5.0/24', vlan: 30 }, identical: false },
        { a: { cidr: '192.168.9.0/24', vlan: null }, b: { cidr: '192.168.9.0/24', vlan: null }, identical: true },
      ],
    },
  })).truth;
  const nr = rowOf(noVlan, 'conflicts');
  assert.equal(nr.items[0].id, '172.16.0.0/16 ⇄ 172.16.5.0/24');
  assert.equal(nr.items[0].meta, 'VLAN —/30');
  assert.equal(nr.items[1].meta, '=');

  // Igiene NON valutata (motore assente o in errore: il glue passa null) ≠ rete
  // pulita. Prima un fallimento di calcolo usciva come «nessun conflitto» VERDE.
  for (const missing of [null, undefined]) {
    const unknown = buildOverview(Object.assign({}, base, { ipamAudit: missing })).truth;
    const ur = rowOf(unknown, 'conflicts');
    assert.equal(ur.prov, 'none', 'non valutata -> provenienza \'none\' (tratteggiata)');
    assert.equal(ur.value, null, 'nessun numero: 0 direbbe «ho guardato e non c\'era nulla»');
    assert.equal(ur.tone, 'normal', 'non e\' un allarme: e\' un\'assenza di dato');
    assert.equal(unknown.health.level, 'ok', 'un conteggio mancante non ingiallisce da solo');
  }
});

test('② VERO: senza NEMMENO una lettura, «0 porte sospette» non e\' una misura', () => {
  // suspectPorts e' l'unico confronto realta'↔documento senza Verifica, ma vive
  // sulle letture SNMP: a zero letture il conteggio 0 e' assenza di dati, non
  // assenza di guai. Stesso gating della riga sorella lastSync.
  const nodes = [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }];
  const never = buildOverview({ types: TYPES, nodes, now: 2000,
    spare: { totals: { free: 10, suspect: 0, ports: 24 } } }).truth;
  const nr = rowOf(never, 'suspectPorts');
  assert.equal(nr.prov, 'none', 'mai letto -> nessuna provenienza misurata');
  assert.equal(nr.value, null, 'niente «0 · tutto coerente» in verde su una misura mai fatta');
  assert.equal(nr.total, null);
  assert.equal(rowOf(never, 'lastSync').prov, 'none', 'le due righe raccontano la stessa storia');

  // Dopo una lettura il conteggio torna una misura vera, zero incluso.
  const read = buildOverview({ types: TYPES, nodes, now: 2000,
    lastSyncAt: 1000, lastSyncResult: { at: 1000, ok: 1, total: 1 },
    spare: { totals: { free: 10, suspect: 0, ports: 24 } } }).truth;
  const rr = rowOf(read, 'suspectPorts');
  assert.equal(rr.prov, 'measured');
  assert.equal(rr.value, 0, 'letto e coerente: lo zero ora significa qualcosa');
  assert.equal(rr.total, 10);
});

test('② VERO B3: il report VIVO aggiunge righe-categoria navigabili (drill), non al reload', () => {
  const model = {
    types: TYPES,
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncAt: 1000, now: 4000,
    // solo le categorie >0 compaiono; endpoint/firmware NON diventano righe.
    driftLive: { counts: { stateDrift: 2, ipChanged: 1, undocumented: 1, undocumentedEndpoint: 5,
      macOrphan: 0, ghostCable: 0, identityDrift: 0, identityFirmware: 3, unverified: 0, consistent: 20 } },
  };
  const t = buildOverview(model).truth;
  const drill = t.rows.filter((r) => r.drill);
  assert.deepEqual(drill.map((r) => [r.key, r.drill, r.value]),
    [['driftState', 'stateDrift', 2], ['driftIp', 'ipChanged', 1], ['driftUndoc', 'undocumented', 1]],
    'una riga per categoria >0, ordine fisso, col marcatore drill = categoria del report');
  assert.ok(drill.every((r) => r.prov === 'measured'), 'misurate dal report vivo');
  const keys = t.rows.map((r) => r.key);
  assert.ok(keys.indexOf('driftState') > keys.indexOf('suspectPorts'), 'le differenze vanno dopo le porte sospette');
  assert.ok(keys.indexOf('driftState') < keys.indexOf('neighbors'), 'e prima dei vicini');
  // Al reload (nessun report vivo) NON compaiono: resta il solo conteggio persistito (B2).
  const noLive = buildOverview(Object.assign({}, model, { driftLive: null })).truth;
  assert.equal(noLive.rows.filter((r) => r.drill).length, 0, 'niente report vivo -> niente righe drill');
});

test('② senza porte sospette il titolo scende alla copertura della verifica', () => {
  const o = buildOverview({
    types: TYPES,
    // sw2 e' interrogato ma NON risponde: e' quella la lacuna di copertura.
    // Un apparato che non si interroga affatto non lo e' — e' una scelta.
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } },
      { id: 'sw2', type: 'switch', ip: '10.0.0.2', integration: { driver: 'snmp-v2c', host: '10.0.0.2' }, snmpStatus: 'err' },
      { id: 'pc1', type: 'pc', ip: '10.0.0.50' }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
  });
  assert.equal(o.truth.headline.key, 'verifiable');
});

test('② VERO: chi si interroga lo dice IL DRIVER — non il tipo di apparato', () => {
  // Una stampante non e' infrastruttura ma parla Printer-MIB, e la si interroga a
  // ogni Verifica: il discrimine non e' il TIPO ma la configurazione. Prima la
  // popolazione era «isActive», quindi una stampante muta non emergeva da nessuna
  // parte e toglierle il driver non spostava un numero in cui non compariva
  // (segnalato provandolo, 2026-07-30).
  const base = {
    types: TYPES, now: 5000, lastSyncAt: 2000, lastSyncResult: { ok: 2, total: 2, at: 2000 },
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
  };
  const o = buildOverview(Object.assign({}, base, {
    nodes: [
      { id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } },
      { id: 'prn1', type: 'printer', ip: '10.0.0.60', integration: { driver: 'snmp-v2c', host: '10.0.0.60' } },
      { id: 'pc1', type: 'pc', ip: '10.0.0.50' },
    ],
  }));
  const v = rowOf(o.truth, 'verifiable');
  assert.equal(v.total, 2, 'la stampante interrogata entra nel conto quanto lo switch');
  assert.equal(v.value, 2);
  assert.deepEqual(v.items.map((i) => i.id), ['pc1'], 'resta il solo PC, che non si interroga');
  assert.equal(v.extra.unverifiable, 1, 'non e\' verificabile via SNMP, e si conta a parte');
  assert.equal(o.truth.health.level, 'ok', 'VERDE raggiungibile: era tutto il punto');
});

test('② VERO: senza driver l\'apparato esce dal conto e va nella lista «a mano»', () => {
  // Nessun driver E' gia' una dichiarazione: non lo interrogo, quindi non e'
  // VERIFICABILE via SNMP. Non e' una lacuna da rimproverare — non blocca il verde
  // — ma non sparisce: resta in elenco e nella nota accanto al verdetto, altrimenti
  // sarebbe bastato non configurare nulla per comprarsi un verde. La lista copre
  // TUTTI quelli che un accesso potrebbero averlo (isActive || hasIP), non la sola
  // infrastruttura: e' lo stesso confine con cui il pannello offre l'Integrazione.
  const o = buildOverview({
    types: TYPES, now: 5000, lastSyncAt: 2000, lastSyncResult: { ok: 1, total: 1, at: 2000 },
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    nodes: [
      { id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } },
      { id: 'dumb', type: 'switch', ip: '10.0.0.2' },
      { id: 'prn1', type: 'printer', ip: '10.0.0.60' },
      { id: 'pc1', type: 'pc', ip: '10.0.0.50' },
    ],
  });
  const v = rowOf(o.truth, 'verifiable');
  assert.equal(v.total, 1, 'si conta solo cio\' che si interroga');
  assert.equal(v.value, 1);
  assert.equal(v.extra.unverifiable, 3, 'switch, stampante e PC non interrogati: nessuno e\' verificabile via SNMP');
  assert.deepEqual(v.items.map((i) => i.tag), ['unverifiable', 'unverifiable', 'unverifiable']);
  assert.deepEqual(v.items.map((i) => i.id), ['dumb', 'prn1', 'pc1'], '…e ognuno ha un nome, subito');
  assert.equal(o.truth.health.level, 'ok', 'una scelta non e\' un problema: non blocca il verde');
  assert.equal(o.truth.health.issues, 0);
});

test('② VERO: senza NESSUN accesso configurato la riga e\' tratteggiata, mai verde', () => {
  // Il verde piu' facile da comprare: non interrogare niente e dichiarare che
  // tutto quel niente risponde. La riga esce 'none' — non lo sappiamo.
  const o = buildOverview({
    types: TYPES, now: 5000, lastSyncAt: 2000, lastSyncResult: { ok: 0, total: 0, at: 2000 },
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1' }, { id: 'pc1', type: 'pc', ip: '10.0.0.50' }],
  });
  const v = rowOf(o.truth, 'verifiable');
  assert.equal(v.prov, 'none');
  assert.equal(v.value, null);
  assert.equal(v.total, null);
  assert.equal(v.extra.unverifiable, 2, 'switch e PC: nessuno dei due e\' verificabile');
});


test('② VERO: un apparato configurato che NON risponde non diventa verde', () => {
  // Configurato ma muto e' una misura FALLITA, non una scelta: pesa finche' non
  // si sana (credenziali, apparato acceso, o smettendo di interrogarlo). Il
  // contrario — verde su una lettura andata male — e' esattamente cio' che questa
  // Panoramica non fa piu' da nessuna parte.
  const o = buildOverview({
    types: TYPES, now: 5000, lastSyncAt: 2000, lastSyncResult: { ok: 1, total: 2, at: 2000 },
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    nodes: [
      { id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' }, snmpStatus: 'ok' },
      { id: 'sw2', type: 'switch', ip: '10.0.0.2', integration: { driver: 'snmp-v2c', host: '10.0.0.2' }, snmpStatus: 'err' },
    ],
  });
  const v = rowOf(o.truth, 'verifiable');
  assert.equal(v.total, 2, 'due interrogati');
  assert.equal(v.value, 1, '…uno solo risponde: il numero lo dice senza spiegazioni');
  assert.equal(v.extra.errors, 1);
  assert.deepEqual(v.items.map((i) => [i.id, i.tag]), [['sw2', 'snmpErr']], 'col NOME, senza cliccare');
  assert.equal(o.truth.health.level, 'warn', 'nessun verde su una misura fallita');
  assert.equal(o.truth.health.issues, 1);
  // Smettere di interrogarlo e' la terza via per sanare: esce dal conto e va
  // nella lista «a mano» — che resta visibile, quindi non e' una scorciatoia.
  const nonPiuInterrogato = buildOverview({
    types: TYPES, now: 5000, lastSyncAt: 2000, lastSyncResult: { ok: 1, total: 1, at: 2000 },
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    nodes: [
      { id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' }, snmpStatus: 'ok' },
      { id: 'sw2', type: 'switch', ip: '10.0.0.2', integration: {}, snmpStatus: 'err' },
    ],
  });
  const v2 = rowOf(nonPiuInterrogato.truth, 'verifiable');
  assert.equal(v2.extra.errors, 0);
  assert.equal(v2.extra.unverifiable, 1, 'non sparisce: passa fra i non verificabili');
  assert.equal(nonPiuInterrogato.truth.health.level, 'ok');
});

test('② VERO: il verdetto degrada a «warn» quando il dato è vecchio di GIORNI (staleness)', () => {
  const day = 86400000;
  const now = 1000 * day;
  const base = {
    types: TYPES,
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncResult: { ok: 1, total: 1 },
  };
  // 3 giorni: ancora verde (sotto la soglia)
  const fresh = buildOverview(Object.assign({}, base, { lastSyncAt: now - 3 * day, now })).truth;
  assert.equal(fresh.health.level, 'ok', '3 giorni: ancora fresco');
  assert.ok(!fresh.health.stale);
  // 20 giorni: warn per SOLA vecchiaia (nessuna differenza da decidere)
  const old = buildOverview(Object.assign({}, base, { lastSyncAt: now - 20 * day, now })).truth;
  assert.equal(old.health.level, 'warn', '20 giorni: il verdetto non può restare verde');
  assert.equal(old.health.stale, true);
  assert.equal(old.health.staleDays, 20);
  // una Verifica recente ripristina la freschezza pur con Sync vecchio
  const reVerified = buildOverview(Object.assign({}, base, {
    lastSyncAt: now - 20 * day, now, lastVerify: { at: now - 1 * day, banner: 'aligned', counts: {} },
  })).truth;
  assert.ok(!reVerified.health.stale, 'la Verifica di ieri conta come contatto fresco');
  // mai letto → resta «bad» (il gate staleness non lo tocca)
  const never = buildOverview(Object.assign({}, base, { now })).truth;
  assert.equal(never.health.level, 'bad');
  assert.ok(!never.health.stale, 'niente lettura → non è "stantìo", è "mai letto"');
});

test('il gate di staleness vale su ③ MARGINE, e NON su ① LAN né ⑤ Sicurezza', () => {
  // N15. Non è «estendilo dappertutto»: si gatta solo ciò che poggia su una MISURA.
  const day = 86400000;
  const now = 1000 * day;
  const base = {
    types: TYPES,
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', ports: 8,
      integration: { driver: 'snmp-v3', v3user: 'u', host: '10.0.0.1' } }],
    spare: { totals: { free: 8, suspect: 0, ports: 8, freeSfp: 0, sfp: 0 },
      racks: [], unracked: [{ id: 'sw1', total: 8, free: 8 }] },
    mgmtVlans: [99],
    lastSyncResult: { ok: 1, total: 1 },
  };
  const fresco = buildOverview(Object.assign({}, base, { lastSyncAt: now - 2 * day, now }));
  const vecchio = buildOverview(Object.assign({}, base, { lastSyncAt: now - 20 * day, now }));

  // ③ poggia su una misura (porte sospette, classi PoE): degrada e lo dice.
  assert.equal(fresco.margin.health.level, 'ok');
  assert.equal(vecchio.margin.health.level, 'warn', '20 giorni: «margine ampio» è un ricordo');
  assert.equal(vecchio.margin.health.stale, true);
  assert.equal(vecchio.margin.health.staleDays, 20);

  // ① chiede se il DOCUMENTO descrive tutto: un documento non invecchia.
  assert.equal(vecchio.complete.health.level, fresco.complete.health.level, '① non si tocca');
  assert.ok(!vecchio.complete.health.stale);

  // ⑤ sembra «da misura» ma i suoi tre ingressi sono DICHIARATI (driver scelto,
  // community scritta, VLAN marcata): non invecchiano perché non sincronizzi.
  assert.equal(vecchio.security.health.level, fresco.security.health.level, '⑤ non si tocca');
  assert.ok(!vecchio.security.health.stale);
});

test('③ MARGINE: il margine e\' quello ONESTO (libere meno sospette)', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }],
    spare: { totals: { free: 181, suspect: 15, ports: 208, freeSfp: 0 },
      racks: [{ devices: [{ id: 'sw2', total: 24, free: 4 }, { id: 'sw1', total: 48, free: 40 }] }],
      unracked: [{ id: 'rt1', total: 8, free: 2 }] },
    sfpTotal: 0,
    rackFill: [{ sizeU: 42, free: 26 }],
  });
  const g = o.margin;
  assert.equal(rowOf(g, 'freePorts').value, 166, '181 libere − 15 viste attive');
  assert.deepEqual(rowOf(g, 'freePorts').extra, { raw: 181, suspect: 15 },
    'il numero grezzo (raw−suspect = onesto) resta leggibile in extra');
  // Il click mostra, per ogni device, le libere sul totale, DISTINTI in rack e
  // fuori rack (prima i device in rack, piu' libere in cima, poi i liberi).
  assert.deepEqual(rowOf(g, 'freePorts').items.map((i) => [i.id, i.meta, i.of, i.group]),
    [['sw1', 40, 48, 'rack'], ['sw2', 4, 24, 'rack'], ['rt1', 2, 8, 'loose']]);
  assert.equal(rowOf(g, 'rackU').value, 26);
  assert.equal(g.headline.key, 'freePorts');
});

// Il dettaglio di «Porte libere» ha DUE schede: «In rack» e «Fuori rack» (quest'ultima
// = le prese a muro / ciò che sta sul piano). Niente scheda «Per velocità»: scelta di
// prodotto (2026-08-02), il conteggio fuori-rack è più utile della ripartizione velocità.
test('③ Porte libere: due schede — In rack / Fuori rack — niente «Per velocità»', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }],
    spare: { totals: { free: 31, suspect: 0, ports: 49, freeSfp: 0 },
      racks: [{ devices: [{ id: 'sw1', total: 48, free: 30, capClass: 'switch' }] }],
      unracked: [{ id: 'wa1', total: 1, free: 1, capClass: 'other' }] },
    sfpTotal: 0, rackFill: [],
  });
  const r = rowOf(o.margin, 'freePorts');
  const groups = new Set(r.items.map((i) => i.group));
  assert.ok(!groups.has('speed'), 'nessuna scheda «Per velocità»');
  assert.deepEqual([...groups].sort(), ['loose', 'rack'], 'solo In rack / Fuori rack');
  assert.equal(r.items.find((i) => i.id === 'wa1').tag, 'nonSwitch',
    'la presa a muro sta in «Fuori rack», marcata «non switch»');
  assert.equal(r.extra.bySpeed, undefined, 'niente ripartizione per velocità in extra');
});

// La testata «Porte libere» è la capacità SWITCH (dove attacchi un nuovo device);
// patch panel/appliance hanno porte libere ma non sono fabric → contate a parte
// (badge «+N non switch»), mai nel numero grande. Lo split arriva da byClass.
test('③ Porte libere: la testata è la capacità SWITCH; il resto a parte (byClass)', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }],
    spare: {
      totals: { free: 55, suspect: 0, ports: 88, freeSfp: 0 },
      byClass: {
        switch: { free: 40, suspect: 0, ports: 48, freeBySpeed: {}, freeNoSpeed: 0 },
        other: { free: 15, suspect: 0, ports: 40 },
      },
      racks: [{ devices: [
        { id: 'sw1', total: 48, free: 40, capClass: 'switch' },
        { id: 'pp1', total: 24, free: 9, capClass: 'other' },
        { id: 'nvr1', total: 16, free: 6, capClass: 'other' },
      ] }],
      unracked: [],
    },
    sfpTotal: 0, rackFill: [],
  });
  const r = rowOf(o.margin, 'freePorts');
  assert.equal(r.value, 40, 'il numero grande è la capacità switch onesta, non 55');
  assert.equal(r.total, 48, 'su 48 porte switch, non 88');
  assert.equal(r.extra.otherFree, 15, 'patch panel (9) + NVR (6) contati a parte');
  assert.equal(r.extra.otherPorts, 40);
  // I non-switch portano il tag «non switch» nel drill-down; lo switch no.
  const tagById = {};
  for (const it of r.items) tagById[it.id] = it.tag || null;
  assert.equal(tagById.sw1, null, 'lo switch è capacità, niente tag');
  assert.equal(tagById.pp1, 'nonSwitch');
  assert.equal(tagById.nvr1, 'nonSwitch');
});

test('③ Indirizzi liberi: mostra i LIBERI (host del /24 meno gli usati), non gli usati', () => {
  // Prima la riga mostrava deviceCount (gli USATI) sotto l'etichetta «liberi»:
  // misura giusta, etichetta sbagliata (2026-07-24). Ora calcola i liberi dal CIDR.
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }],
    networks: [
      { cidr: '192.168.1.0/24', deviceCount: 20, ips: Array.from({ length: 20 }, (_, i) => '192.168.1.' + (i + 1)) },
      { cidr: '10.0.0.0/24', deviceCount: 3, ips: ['10.0.0.1', '10.0.0.2', '10.0.0.3'] },
    ],
    spare: { totals: { free: 1, ports: 24 } },
  });
  const ip = rowOf(o.margin, 'ipFree');
  assert.equal(ip.prov, 'derived', 'assume /24 → dedotto, non dichiarato');
  assert.equal(ip.value, (254 - 20) + (254 - 3), 'liberi TOTALI = host /24 meno usati');
  assert.deepEqual(ip.items.map((i) => i.meta), [254 - 20, 254 - 3], 'per subnet: i LIBERI, non i device');
  assert.deepEqual(ip.items.map((i) => i.of), [254, 254], 'e gli utilizzabili del /24 accanto');
  // senza reti osservate → «non dichiarato», mai un numero
  const none = buildOverview({ types: TYPES, nodes: [], spare: { totals: { free: 0, ports: 0 } } });
  assert.equal(rowOf(none.margin, 'ipFree').prov, 'none');
  assert.equal(rowOf(none.margin, 'ipFree').value, null);
});

test('③ Indirizzi liberi: PALETTO «sempre sul dichiarato» — usa il prefisso IPAM DICHIARATO, non il /24 assunto', () => {
  // L'utente dichiara una /16: la capacità va misurata su 65.534 host, NON su 254.
  // deriveProjectNetworks resta /24 (serve al workflow «Reti del progetto»), ma qui i
  // /24 osservati si ri-raggruppano sotto la subnet dichiarata che li contiene.
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }],
    ipamVlans: { 10: { subnet: '10.20.0.0/16' } },
    networks: [
      { net: '10.20.30', cidr: '10.20.30.0/24', deviceCount: 2, ips: ['10.20.30.1', '10.20.30.2'] },
      { net: '10.20.40', cidr: '10.20.40.0/24', deviceCount: 1, ips: ['10.20.40.5'] },
      { net: '192.168.1', cidr: '192.168.1.0/24', deviceCount: 3, ips: ['192.168.1.1', '192.168.1.2', '192.168.1.3'] },
    ],
    spare: { totals: { free: 1, ports: 24 } },
  });
  const ip = rowOf(o.margin, 'ipFree');
  assert.equal(ip.prov, 'declared', 'con una subnet dichiarata che contiene IP → dichiarato, non dedotto');
  // la /16 assorbe i due /24 (3 IP usati su 65.534); la 192.168.1.0/24 resta /24 assunto (3 su 254)
  assert.equal(ip.value, (65534 - 3) + (254 - 3), 'liberi = (host /16 − usati) + (host /24 − usati)');
  assert.deepEqual(ip.items.map((i) => i.id), ['10.20.0.0/16', '192.168.1.0/24'], 'una riga per la /16, non due /24');
  assert.deepEqual(ip.items.map((i) => i.of), [65534, 254], 'utilizzabili: prima /16 dichiarata, poi /24 assunta');
  assert.equal(ip.items[0].meta, 65534 - 3, 'liberi della /16 sul suo prefisso reale');
  assert.deepEqual(ip.items.map((i) => i.tag), ['declaredNet', 'undeclared'], 'la /16 è dichiarata, la 192.168.1 no');
  assert.equal(ip.extra.declared, true);
  assert.equal(ip.extra.subnets, 2);

  // Forma HOST del CIDR dichiarato ("10.0.0.1/8") e nessun IP dentro → si ignora,
  // resta il /24 assunto (nessuna regressione sul comportamento precedente).
  const o2 = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }],
    ipamVlans: { 5: { subnet: '172.16.0.0/12' } },   // dichiarata ma nessun IP osservato vi cade
    networks: [{ net: '192.168.9', cidr: '192.168.9.0/24', deviceCount: 4, ips: ['192.168.9.1', '192.168.9.2', '192.168.9.3', '192.168.9.4'] }],
    spare: { totals: { free: 1, ports: 24 } },
  });
  const ip2 = rowOf(o2.margin, 'ipFree');
  assert.equal(ip2.prov, 'derived', 'subnet dichiarata SENZA IP dentro → non pesa, resta il /24 assunto');
  assert.equal(ip2.value, 254 - 4);
});

test('②③ /28 dichiarata DENTRO una /24: split per-IP, i device FUORI dalla dichiarazione NON si perdono', () => {
  // ② "il dichiarato è legge": una /28 (14 host, .1–.14) dichiarata dentro una /24
  // osservata prende i suoi host; il resto della /24 resta «non dichiarata» → i device
  // oltre la /28 EMERGONO invece di sparire. Niente doppio conteggio dello spazio.
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }],
    ipamVlans: { 1: { subnet: '192.168.1.0/28' } },
    networks: [{
      net: '192.168.1', cidr: '192.168.1.0/24', deviceCount: 5,
      ips: ['192.168.1.1', '192.168.1.10', '192.168.1.100', '192.168.1.150', '192.168.1.200'],
    }],
    spare: { totals: { free: 1, ports: 24 } },
  });
  // Indirizzi liberi: /28 (usable 14, used 2 → 12); residuo /24 (usable 254−14=240, used 3 → 237)
  const ip = rowOf(o.margin, 'ipFree');
  assert.deepEqual(ip.items.map((i) => i.id), ['192.168.1.0/28', '192.168.1.0/24']);
  assert.deepEqual(ip.items.map((i) => i.of), [14, 240], 'la /24 residua toglie i 14 host della /28: niente doppio conteggio');
  assert.deepEqual(ip.items.map((i) => i.meta), [14 - 2, 240 - 3]);
  assert.deepEqual(ip.items.map((i) => i.tag), ['declaredNet', 'undeclared']);
  assert.equal(ip.value, (14 - 2) + (240 - 3));
  // Subnet di progetto: stessa ripartizione, meta = device (2 dentro, 3 fuori: nessuno perso)
  const sub = rowOf(o.complete, 'subnets');
  assert.deepEqual(sub.items.map((i) => i.id), ['192.168.1.0/28', '192.168.1.0/24']);
  assert.deepEqual(sub.items.map((i) => i.meta), [2, 3], '2 device nella /28, 3 fuori — tutti presenti');
  assert.deepEqual(sub.items.map((i) => i.tag), ['declaredNet', 'undeclared']);
  assert.equal(sub.extra.undeclared, 1, 'la /24 residua è una subnet «da dichiarare»');
});

test('③ REGRESSIONE denominatore rack: il totale U viene da `sizeU`, non da un campo inventato', () => {
  // Il glue leggeva `r.units || r.u || 42` — campi che sul rack NON esistono
  // (il vero e' `sizeU`) → il totale cadeva SEMPRE a 42, quale che fosse l'altezza
  // reale (progetto 8: 126U dichiarate contro 78U vere, audit 2026-07-23). Ora il
  // calcolo e' nella lib pura, coperto: un rack da 24U deve dare 24, non 42.
  const types = { switch: { isActive: true, isRack: true, sizeU: 1 }, room: { isStructural: true } };
  const nodes = [
    { id: 'a', type: 'switch', rackId: 'r1', sizeU: 2 },
    { id: 'b', type: 'switch', rackId: 'r1' },              // sizeU dal catalogo (1)
    { id: 'c', type: 'switch', rackId: 'r2', sizeU: 3 },
    { id: 'x', type: 'switch', rackId: 'ALTRO', sizeU: 5 }, // in un altro rack: non conta
  ];
  const fill = _rackFill([{ id: 'r1', sizeU: 24 }, { id: 'r2', sizeU: 12 }], nodes, types);
  assert.equal(fill[0].sizeU, 24, 'il totale e\' sizeU, non 42');
  assert.equal(fill[0].used, 3, '2U + 1U (default catalogo) occupati in r1');
  assert.equal(fill[0].free, 21);
  assert.equal(fill[1].sizeU, 12);
  assert.equal(fill[1].free, 9);

  // sizeU assente sul rack → ripiego 42 per DISEGNARE, MAI 0 — ma marcato come
  // NON dichiarato: il documento non ha mai detto quanto e' alto quel rack.
  const undecl = _rackFill([{ id: 'r3' }], [], types)[0];
  assert.equal(undecl.sizeU, 42);
  assert.equal(undecl.declared, false, '42U e\' un ripiego, non una dichiarazione');
  assert.ok(fill.every((r) => r.declared === true), 'r1/r2 dichiarano la propria altezza');
  // e passato dentro buildOverview, il totale non e' piu' fisso a 42.
  const o = buildOverview({ types, nodes, rackFill: fill, spare: { totals: { free: 0, ports: 0 } } });
  assert.equal(rowOf(o.margin, 'rackU').total, 36, '24 + 12, non 84');
  assert.equal(rowOf(o.margin, 'rackU').prov, 'declared', 'tutte le altezze dichiarate');
  assert.equal(rowOf(o.margin, 'rackU').extra.assumed, 0);
});

test('③ un totale U che include altezze ASSUNTE non si dichiara «dichiarato»', () => {
  // Un rack importato/creato via API non dichiara sizeU: il suo contributo al
  // totale e' il ripiego 42U, cioe' un'ipotesi. Dire 'declared' su quel totale
  // sarebbe spacciare un default per una scelta dell'utente (② no-invenzioni).
  const types = { switch: { isActive: true, isRack: true, sizeU: 1 } };
  const nodes = [{ id: 'a', type: 'switch', rackId: 'r1', sizeU: 2 }];
  const mixed = _rackFill([{ id: 'r1', sizeU: 24 }, { id: 'r2' }], nodes, types);
  const o = buildOverview({ types, nodes, rackFill: mixed, spare: { totals: { free: 0, ports: 0 } } });
  const row = rowOf(o.margin, 'rackU');
  assert.equal(row.total, 66, '24 dichiarati + 42 assunti');
  assert.equal(row.prov, 'derived', 'basta un rack senza altezza per non poter dire «dichiarato»');
  assert.equal(row.extra.assumed, 1, 'quanti rack stanno assumendo: la riga lo dice');

  // Un rack «pieno» ma con altezza ASSUNTA non tinge la sezione: sarebbe un
  // allarme inventato (potrebbe essere un 47U con spazio di avanzo).
  const fullAssumed = _rackFill([{ id: 'r2' }], [{ id: 'big', type: 'switch', rackId: 'r2', sizeU: 42 }], types);
  const fa = buildOverview({ types, nodes: [{ id: 'big', type: 'switch', rackId: 'r2', sizeU: 42 }],
    rackFill: fullAssumed, spare: { totals: { free: 5, ports: 24 } } });
  assert.equal(rowOf(fa.margin, 'rackU').value, 0, '0 U libere sul ripiego 42');
  assert.equal(fa.margin.health.level, 'ok', 'niente warn «rack pieno» su un\'altezza assunta');
});

test('③ zero fibre LIBERE e zero fibre DICHIARATE non sono la stessa cosa', () => {
  const noFibre = buildOverview({ types: TYPES, nodes: [], sfpTotal: 0,
    spare: { totals: { free: 10, ports: 24, freeSfp: 0 } } });
  assert.equal(rowOf(noFibre.margin, 'freeSfp').prov, 'none');
  assert.equal(rowOf(noFibre.margin, 'freeSfp').value, null, 'niente fibra in catalogo -> nessun numero');
  assert.notEqual(noFibre.margin.headline.key, 'freeSfp', 'non e\' un vincolo: non puo\' essere il titolo');

  const fibreFull = buildOverview({ types: TYPES, nodes: [], sfpTotal: 4,
    spare: { totals: { free: 10, ports: 24, freeSfp: 0 } } });
  assert.equal(rowOf(fibreFull.margin, 'freeSfp').prov, 'declared');
  assert.equal(rowOf(fibreFull.margin, 'freeSfp').tone, 'alert', '4 dichiarate, 0 libere -> vincolo vero');
  assert.equal(fibreFull.margin.headline.key, 'freeSfp');
});

test('③ PoE e banda uplink non dichiarati: «non dichiarato», mai 0 W', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }, { id: 'sw2', type: 'switch' }],
    caps: [{ id: 'sw1', caps: {} }, { id: 'sw2', caps: {} }], fleet: {},
    spare: { totals: { free: 10, ports: 24 } },
  });
  assert.equal(rowOf(o.margin, 'poe').prov, 'none');
  assert.equal(rowOf(o.margin, 'poe').extra.headroomW, null, 'nessun watt inventato');
  assert.equal(rowOf(o.margin, 'poe').total, 2, 'ma si sa su quanti switch manca');
  assert.equal(rowOf(o.margin, 'uplink').prov, 'none');
  assert.equal(rowOf(o.margin, 'uplink').value, null);
});

test('③ con il PoE dichiarato la riga diventa misurabile e somma il margine', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }, { id: 'sw2', type: 'switch' }],
    caps: [{ id: 'sw1', caps: { poe: { budgetW: 370, headroomW: 248.2 } } }, { id: 'sw2', caps: {} }],
    spare: { totals: { free: 10, ports: 24 } },
  });
  assert.equal(rowOf(o.margin, 'poe').prov, 'declared');
  assert.equal(rowOf(o.margin, 'poe').value, 1, '1 switch su 2 lo dichiara');
  assert.equal(rowOf(o.margin, 'poe').extra.headroomW, 248.2);
  assert.equal(rowOf(o.margin, 'poe').extra.debtW, null, 'nessuno sforamento = nessun debito');
  assert.equal(rowOf(o.margin, 'poe').tone, 'normal');
  assert.equal(o.margin.health.issues, 0, 'un budget capiente non e\' un problema di margine');
});

test('③ un margine PoE NEGATIVO e\' un DEBITO, non un margine: mai in verde', () => {
  // Il budget DICHIARATO non copre le classi MISURATE sulle porte: se tutti gli
  // alimentati tirassero la loro classe, quello switch resterebbe corto. Sommarlo
  // agli avanzi degli altri lo cancellava dalla vista (il totale di flotta
  // compensa) e il verdetto usciva «−40 W di margine» in VERDE.
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }, { id: 'sw2', type: 'switch' }],
    caps: [
      { id: 'sw1', caps: { poe: { budgetW: 130, headroomW: -40 } } },
      { id: 'sw2', caps: { poe: { budgetW: 370, headroomW: 248.2 } } },
    ],
    spare: { totals: { free: 10, ports: 24 } },
  });
  const poe = rowOf(o.margin, 'poe');
  assert.equal(poe.extra.debtW, 40, 'il debito esce A PARTE: sommato agli avanzi sparirebbe');
  assert.equal(poe.extra.over, 1, 'e si sa su quanti apparati');
  assert.equal(poe.extra.headroomW, 208.2, 'il totale di flotta resta, ma non e\' piu\' l\'unico numero');
  assert.equal(poe.tone, 'alert');
  assert.deepEqual(poe.items.map((i) => i.id), ['sw1'], 'il dettaglio dice QUALE switch');
  assert.equal(poe.items[0].metric, 'poeDebt', 'la lib da\' il token, il renderer la parola');
  assert.equal(poe.items[0].value, 40);
  // La salute della colonna lo conta: un budget sforato e' una risorsa esaurita,
  // esattamente come un rack pieno o zero porte libere.
  assert.equal(o.margin.health.level, 'warn');
  assert.equal(o.margin.health.issues, 1);
  // …ed e' il PUNTO D'INGRESSO della colonna: l'unica capacita' gia' sforata.
  assert.equal(o.margin.headline.key, 'poe');
});

test('③ la banda uplink è il LAG PIÙ CAPIENTE, non la somma (un LAG ha due capi)', () => {
  // Un Port-channel fra sw1 e sw2 compare su ENTRAMBI i device: sommare darebbe
  // 4 Gbps per un collegamento fisico da 2. La domanda vera — «che banda ho fra
  // gli armadi?» — si risponde col più capiente.
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch' }, { id: 'sw2', type: 'switch' }],
    caps: [
      { id: 'sw1', caps: { ports: { lags: [{ aggregateMbps: 2000 }] } } },
      { id: 'sw2', caps: { ports: { lags: [{ aggregateMbps: 2000 }] } } },
      { id: 'sw3', caps: { ports: { lags: [{ aggregateMbps: 4000 }] } } },
    ],
    spare: { totals: { free: 10, ports: 24 } },
  });
  const up = rowOf(o.margin, 'uplink');
  assert.equal(up.value, 4000, 'il massimo, non 8000');
  assert.equal(up.prov, 'derived');
  assert.equal(up.extra.devices, 3);
  assert.deepEqual(up.items.map((i) => i.id), ['sw3', 'sw1', 'sw2'], 'più capiente in cima');
});

test('④ SALUTE colonna (strato colpo d\'occhio): ok/warn/bad + conteggio dai segnali che ESISTONO', () => {
  const nodes = [
    { id: 'sw1', type: 'switch', name: 'SW-CORE', ip: '10.0.0.1', mac: 'aa:bb:cc:00:00:01' },
    { id: 'sw2', type: 'switch', name: '10.0.0.2', ip: '10.0.0.2', mac: 'aa:bb:cc:00:00:02' }, // nome = IP → lacuna
  ];
  // Nessun Sync (lastSyncAt assente) → Conformità vola alla cieca (rosso). Nessuna
  // subnet dichiarata → una lacuna in Documento oltre al nome. Margine intatto.
  const blind = buildOverview({ types: TYPES, nodes, spare: { totals: { free: 5, ports: 10 } } });
  assert.equal(blind.complete.health.level, 'warn', 'lacune di documentazione = giallo, mai rosso');
  assert.ok(blind.complete.health.issues >= 2, 'almeno nome + subnet non dichiarate');
  assert.equal(blind.truth.health.level, 'bad', 'mai letto → si vola alla cieca (rosso)');
  assert.equal(blind.margin.health.level, 'ok', 'porte libere disponibili → verde');

  // Letto di recente MA con discrepanze/non-verificabili → giallo «da riverificare»,
  // NON rosso: il rosso e' riservato al non-letto (la riga «Verifica completa» e'
  // un segnaposto di Fase 2, sempre 'none', e non deve tingere di rosso ogni progetto).
  const synced = buildOverview({ types: TYPES, nodes,
    lastSyncAt: 1000, now: 2000, lastSyncResult: { at: 1000, ok: 2, total: 2 },
    spare: { totals: { free: 5, ports: 10, suspect: 3 } } });
  assert.equal(synced.truth.health.level, 'warn', 'letto ma con discrepanze = giallo, non rosso');

  // Rack pieno + zero porte libere → Espansione giallo (risorsa chiave esaurita).
  const full = buildOverview({ types: TYPES, nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1' }],
    rackFill: [{ id: 'r1', sizeU: 10, used: 10, free: 0 }],
    spare: { totals: { free: 0, ports: 24 } } });
  assert.equal(full.margin.health.level, 'warn', '0 porte libere o rack pieno → giallo');
});

// ── ④ RIPRISTINABILITÀ (DR-readiness) ────────────────────────────────────────
// La lente non deve MENTIRE sul "se cade stanotte, lo rimetti in piedi?": conta
// come ripristinabile SOLO chi ha backup fresco + identità nota + posizione; un
// backup vecchio, un serial diverso (apparato sostituito) o un apparato senza
// rack NON valgono. La presenza è advisory (non fa da gate).
const DR_TYPES = {
  switch: { isActive: true, isRack: true },
  router: { isActive: true, isRack: true },
  pc:     { hasIP: true, isFloor: true },      // endpoint: FUORI dalla popolazione DR
  room:   { isStructural: true },
};

test('④ DR: popolazione = apparati gestiti (isActive); endpoint e strutturali fuori', () => {
  const o = buildOverview({ types: DR_TYPES, now: 1e12, nodes: [
    { id: 'sw1', type: 'switch' }, { id: 'rt1', type: 'router' },
    { id: 'pc1', type: 'pc', ip: '10.0.0.5' }, { id: 'room1', type: 'room' },
  ] });
  const r = o.recovery;
  assert.equal(rowOf(r, 'drBackup').total, 2, 'solo switch+router: il PC endpoint non è un concern DR');
  assert.equal(r.total, 2);
  assert.equal(r.recoverable, 0, 'niente backup/identità/posizione → 0 ripristinabili');
});

test('④ DR: ripristinabile = backup FRESCO + identità nota + posizione; nessuna scorciatoia', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const fresh = '2026-07-01T00:00:00Z';        // 28 giorni fa → fresco (<90)
  const old = '2025-01-01T00:00:00Z';          // >1 anno → stantìo
  const nodes = [
    // pieno: backup fresco + serial + rack → ripristinabile
    { id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'ABC123', backup: { ref: 'git@x/sw1', at: fresh } },
    // backup vecchio → NON ripristinabile, va nel drill backup taggato 'stale'
    { id: 'sw2', type: 'switch', rackId: 'r1', serialNumber: 'DEF456', backup: { ref: 'git@x/sw2', at: old } },
    // serial dichiarato ≠ misurato (apparato sostituito) → identità 'mismatch', NON ripristinabile
    { id: 'sw3', type: 'switch', rackId: 'r1', serialNumber: 'OLD999',
      integration: { inventory: { serialNumber: 'NEW111' } }, backup: { ref: 'git@x/sw3', at: fresh } },
    // senza rack → posizione ignota, NON ripristinabile
    { id: 'sw4', type: 'switch', serialNumber: 'GHI789', backup: { ref: 'git@x/sw4', at: fresh } },
  ];
  const r = buildOverview({ types: DR_TYPES, nodes, now }).recovery;
  assert.equal(r.total, 4);
  assert.equal(r.recoverable, 1, 'solo sw1 è pieno; backup vecchio/serial diverso/senza rack NON contano');

  const bk = rowOf(r, 'drBackup');
  assert.equal(bk.value, 3, 'sw1/sw3/sw4 hanno backup fresco; sw2 è vecchio');
  assert.equal(bk.extra.stale, 1);
  assert.deepEqual(bk.items.map((i) => [i.id, i.tag]), [['sw2', 'dated']], 'il vecchio esce taggato «backup datato» (≠ presenza stantìa)');

  const idr = rowOf(r, 'drIdentity');
  assert.equal(idr.value, 3, 'sw1/sw2/sw4 hanno un serial noto; sw3 è divergente');
  assert.equal(idr.extra.mismatch, 1);
  assert.deepEqual(idr.items.map((i) => [i.id, i.tag]), [['sw3', 'mismatch']], 'apparato sostituito → mismatch');

  const loc = rowOf(r, 'drLocation');
  assert.equal(loc.value, 3, 'sw4 non è in nessun rack');
  assert.deepEqual(loc.items.map((i) => i.id), ['sw4']);

  assert.equal(r.health.level, 'warn', 'ci sono lacune ma non tutto perso');
  assert.equal(r.health.issues, 3, 'non ripristinabili = total − recoverable');
});

test('④ DR: un serial DICHIARATO ma mai misurato conta come noto (sai cosa rimpiazzare)', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const at = '2026-07-20T00:00:00Z';
  const r = buildOverview({ types: DR_TYPES, now, nodes: [
    { id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'DECL-ONLY', backup: { ref: 'x', at } },
    { id: 'sw2', type: 'switch', rackId: 'r1', backup: { ref: 'x', at },
      integration: { inventory: { serialNumber: 'MEAS-ONLY' } } },        // solo misurato
    { id: 'sw3', type: 'switch', rackId: 'r1', backup: { ref: 'x', at } },  // nessun serial → unknown
  ] }).recovery;
  assert.equal(rowOf(r, 'drIdentity').value, 2, 'dichiarato-solo e misurato-solo contano; sw3 no');
  assert.deepEqual(rowOf(r, 'drIdentity').items.map((i) => i.id), ['sw3']);
  assert.equal(r.recoverable, 2, 'sw1+sw2 pieni (backup+identità+rack); sw3 senza identità no');
});

test('④ DR: il MODELLO basta a identificare (anche senza serial) e il firmware ignoto è advisory', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const at = '2026-07-20T00:00:00Z';   // backup fresco (9 giorni)
  const r = buildOverview({ types: DR_TYPES, now, nodes: [
    // modello DICHIARATO, nessun serial → identificabile (sai cosa ricomprare); firmware noto
    { id: 'sw1', type: 'switch', rackId: 'r1', model: 'C9300-48P', firmwareVer: 'IOS-XE 17.9', backup: { ref: 'x', at } },
    // modello MISURATO (ENTITY-MIB), nessun serial, firmware IGNOTO → identificabile + fw gap
    { id: 'sw2', type: 'switch', rackId: 'r1', backup: { ref: 'x', at },
      integration: { inventory: { model: 'EX2300-24T' } } },
    // né modello né serial → da identificare
    { id: 'sw3', type: 'switch', rackId: 'r1', backup: { ref: 'x', at } },
  ] }).recovery;
  const idr = rowOf(r, 'drIdentity');
  assert.equal(idr.value, 2, 'modello dichiarato e modello misurato contano; sw3 no');
  assert.deepEqual(idr.items.map((i) => i.id), ['sw3'], 'solo sw3 (senza identità) nel drill-down');
  assert.equal(idr.extra.mismatch, 0);
  assert.equal(idr.extra.noFirmware, 1, 'fra gli identificabili solo sw2 non ha un firmware noto');
  assert.equal(r.recoverable, 2, 'sw1+sw2 ripristinabili; il firmware ignoto NON abbassa il conto');
});

test('④ DR: un\'identità NON riconfermata non grida «apparato sostituito»', () => {
  // Stessa regola della Verifica (lib/identity-reconcile.js): se la lettura
  // ENTITY-MIB non ha riconfermato chi è l'apparato, quello che resta è l'ultimo
  // noto — utile per sapere cosa ricomprare, non abbastanza per un'accusa.
  const now = Date.parse('2026-07-29T00:00:00Z');
  const at = '2026-07-20T00:00:00Z';
  const nodes = [
    { id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'OLD999', backup: { ref: 'x', at },
      integration: { inventory: { serialNumber: 'NEW111', model: 'Stack', stale: true } } },
  ];
  const idr = rowOf(buildOverview({ types: DR_TYPES, nodes, now }).recovery, 'drIdentity');
  assert.equal(idr.extra.mismatch, 0, 'misura stantìa → nessun mismatch');
  assert.equal(idr.value, 1, 'ma l\'apparato resta identificabile');

  // Controprova (mutation-proof): togli `stale` e l'accusa torna.
  nodes[0].integration.inventory = { serialNumber: 'NEW111', model: 'Stack' };
  assert.equal(rowOf(buildOverview({ types: DR_TYPES, nodes, now }).recovery, 'drIdentity').extra.mismatch, 1);
});

test('④ DR: presenza temporale è ADVISORY (denominatore = solo chi ha storia) e non fa da gate', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const at = '2026-07-20T00:00:00Z';
  // sw1 pieno e visto di recente; sw2 pieno ma STALE (non fa da gate: resta ripristinabile);
  // sw3 pieno senza storia di discovery (non entra nel denominatore presenza).
  const nodes = [
    { id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'A', backup: { ref: 'x', at } },
    { id: 'sw2', type: 'switch', rackId: 'r1', serialNumber: 'B', backup: { ref: 'x', at } },
    { id: 'sw3', type: 'switch', rackId: 'r1', serialNumber: 'C', backup: { ref: 'x', at } },
  ];
  const presence = {
    sw1: { tier: 'stable', ageDays: 1 },
    sw2: { tier: 'stale', ageDays: 120 },
    // sw3: nessuna voce → nessuna storia
  };
  const r = buildOverview({ types: DR_TYPES, nodes, now, presence }).recovery;
  const pr = rowOf(r, 'drPresence');
  assert.equal(pr.total, 2, 'solo sw1+sw2 hanno storia: sw3 non è "non visto", è "mai scansionato"');
  assert.equal(pr.value, 1, 'uno visto di recente, uno stantìo');
  assert.equal(pr.extra.stale, 1);
  assert.deepEqual(pr.items.map((i) => [i.id, i.tag, i.meta]), [['sw2', 'stale', '120gg']]);
  assert.equal(r.recoverable, 3, 'la presenza NON abbassa i ripristinabili: sw2 stantìo resta ripristinabile');
});

test('④ DR: senza dati di presenza la riga è «non dichiarato», mai uno zero', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const r = buildOverview({ types: DR_TYPES, now, nodes: [
    { id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'A', backup: { ref: 'x', at: '2026-07-20T00:00:00Z' } },
  ] }).recovery;
  const pr = rowOf(r, 'drPresence');
  assert.equal(pr.prov, 'none', 'nessuna observation → non dichiarato');
  assert.equal(pr.value, null);
  assert.equal(pr.total, null);
});

test('④ DR: progetto senza apparati gestiti → lente vuota, salute ok, nessun throw', () => {
  const r = buildOverview({ types: DR_TYPES, now: 1e12, nodes: [
    { id: 'pc1', type: 'pc', ip: '10.0.0.5' }, { id: 'room1', type: 'room' },
  ] }).recovery;
  assert.equal(r.total, 0);
  assert.equal(r.recoverable, 0);
  assert.equal(r.health.level, 'ok', 'niente da ripristinare → non è un allarme');
  assert.equal(r.health.issues, 0);
  assert.equal(rowOf(r, 'drBackup').prov, 'none');
});

test('④ DR: flotta intera non ripristinabile → salute «bad»', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const r = buildOverview({ types: DR_TYPES, now, nodes: [
    { id: 'sw1', type: 'switch', rackId: 'r1' },   // niente backup né serial
    { id: 'sw2', type: 'switch' },
  ] }).recovery;
  assert.equal(r.recoverable, 0);
  assert.equal(r.health.level, 'bad', 'zero ripristinabili su una flotta non vuota = rosso');
});

test('④ DR: soglia backup ALLINEATA al pannello device (fresco ≤ 30 giorni, non 90)', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const day = 86400000;
  const mk = (ageDays) => buildOverview({ types: DR_TYPES, now, nodes: [
    { id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'A', backup: { ref: 'x', at: new Date(now - ageDays * day).toISOString() } },
  ] }).recovery;
  assert.equal(rowOf(mk(20), 'drBackup').value, 1, '20 giorni: fresco');
  assert.equal(rowOf(mk(45), 'drBackup').value, 0, '45 giorni: oltre 30 → non più fresco (col 90 era ancora verde)');
  assert.equal(rowOf(mk(45), 'drBackup').extra.stale, 1, 'e conta come «datato»');
});

test('④ DR: ridondanza HA — advisory, conta gli apparati con gemello/cluster dichiarato', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const at = '2026-07-20T00:00:00Z';
  const r = buildOverview({ types: DR_TYPES, now, nodes: [
    { id: 'fw1', type: 'router', rackId: 'r1', backup: { ref: 'x', at }, spec: { haPeer: 'fw2' } },
    { id: 'fw2', type: 'router', rackId: 'r1', backup: { ref: 'x', at }, spec: { haPeer: 'fw1' } },
    { id: 'sw1', type: 'switch', rackId: 'r1', spec: { haGroupId: 'core-cluster' } },   // cluster N>2
    { id: 'sw2', type: 'switch', rackId: 'r1' },                                        // nessuna ridondanza
  ] }).recovery;
  const red = rowOf(r, 'drRedundancy');
  assert.equal(red.value, 3, 'fw1+fw2 (pair) + sw1 (cluster)');
  assert.equal(red.total, 4);
  assert.equal(red.prov, 'declared');
  assert.deepEqual(red.items.map((i) => i.id).sort(), ['fw1', 'fw2', 'sw1']);
  // La ridondanza NON gioca sul verdetto «ripristinabile»: è resilienza, non ricostruzione.
  assert.equal(r.recoverable, 0, 'nessuno ha backup+identità+posizione completi qui');
  // Nessuna ridondanza dichiarata → prov 'none' (tratteggiato «nessuna ridondanza»).
  const none = buildOverview({ types: DR_TYPES, now, nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1' }] }).recovery;
  assert.equal(rowOf(none, 'drRedundancy').prov, 'none');
  assert.equal(rowOf(none, 'drRedundancy').value, 0);
});

test('⑤ Sicurezza: SNMP v3 cifrato vs v1/v2c in chiaro; la community di default emerge, il suo VALORE mai', () => {
  const s = buildOverview({
    types: DR_TYPES, mgmtVlans: [99],
    nodes: [
      { id: 'sw1', type: 'switch', integration: { driver: 'snmp-v3', v3user: 'admin' } },       // cifrato
      { id: 'sw2', type: 'switch', integration: { driver: 'snmp-v2c', community: 'public' } },   // in chiaro + default
      { id: 'sw3', type: 'switch', integration: { driver: 'snmp-v2c', community: 'S3cr3t!' } },  // in chiaro, community custom
      { id: 'sw4', type: 'switch' },                                                             // nessun SNMP
    ],
  }).security;
  const snmp = rowOf(s, 'secSnmp');
  assert.equal(snmp.total, 3, 'sw1/sw2/sw3 hanno un accesso SNMP; sw4 no');
  assert.equal(snmp.value, 1, 'solo sw1 è v3 (cifrato)');
  assert.deepEqual(snmp.items.map((i) => i.id), ['sw2', 'sw3'], 'i v1/v2c nel drill-down');
  assert.equal(s.secured, 1);
  assert.equal(s.snmpTotal, 3);

  const comm = rowOf(s, 'secCommunity');
  assert.equal(comm.value, 1, 'solo sw2 usa una community di default (public)');
  assert.deepEqual(comm.items.map((i) => i.id), ['sw2']);
  // VIEWER (nessun isAdmin): elenca l'apparato ma NON marca QUALE default.
  assert.ok(comm.items.every((i) => !i.tag), 'il viewer non vede quale default');
  // ANTI-LEAK: nessun VALORE grezzo di community esce dal motore (nemmeno il default).
  const dump = JSON.stringify(s);
  assert.ok(!dump.includes('public') && !dump.includes('S3cr3t'), 'nessun valore di community nel report');

  assert.equal(rowOf(s, 'secMgmtVlan').value, 1, 'una VLAN di gestione dichiarata');
  assert.equal(rowOf(s, 'secMgmtVlan').prov, 'declared');
  assert.deepEqual(rowOf(s, 'secMgmtVlan').items, [{ id: 'VLAN 99', meta: null }], 'il drill-down la elenca (nome assente qui)');
  assert.equal(s.health.level, 'bad', 'una community indovinabile = porta aperta (rosso)');
});

test('⑤ community di default: SOLO l\'admin vede QUALE default (tag-enum); mai il valore di una custom', () => {
  const base = {
    types: DR_TYPES,
    nodes: [
      { id: 'sw2', type: 'switch', ip: '10.0.0.2', integration: { driver: 'snmp-v2c', community: 'public' } },
      { id: 'sw5', type: 'switch', ip: '10.0.0.5', integration: { driver: 'snmp-v2c', community: '' } },       // vuota
      { id: 'sw3', type: 'switch', ip: '10.0.0.3', integration: { driver: 'snmp-v2c', community: 'S3cr3t!' } }, // CUSTOM: non è un default
    ],
  };
  // admin: il TAG del default (public/vuota), mai la stringa grezza; la custom non è nemmeno flaggata.
  const admin = rowOf(buildOverview(Object.assign({ isAdmin: true }, base)).security, 'secCommunity');
  assert.deepEqual(admin.items.map((i) => i.id), ['sw2', 'sw5'], 'solo i default noti sono flaggati, non la custom');
  assert.deepEqual(admin.items.map((i) => i.tag), ['commPublic', 'commEmpty'], 'l\'admin vede QUALE default, come tag');
  // Il valore grezzo non entra nel modello nemmeno per l'admin (il renderer risolve il tag).
  const dumpAdmin = JSON.stringify(buildOverview(Object.assign({ isAdmin: true }, base)).security);
  assert.ok(!/"public"|S3cr3t/.test(dumpAdmin), 'nessun valore grezzo di community, né default né custom');
});

test('⑤ VLAN di gestione: il drill-down elenca ogni VLAN col suo NOME, e possono essere più d\'una', () => {
  const s = buildOverview({
    types: DR_TYPES, mgmtVlans: [10, 99],
    vlanNames: { 10: 'Management', 99: 'OOB' },
    nodes: [{ id: 'sw1', type: 'switch', integration: { driver: 'snmp-v3', v3user: 'admin' } }],
  }).security;
  const mv = rowOf(s, 'secMgmtVlan');
  assert.equal(mv.value, 2, 'due VLAN di gestione');
  assert.deepEqual(mv.items, [
    { id: 'VLAN 10', meta: 'Management' },
    { id: 'VLAN 99', meta: 'OOB' },
  ], 'ogni VLAN col suo nome dichiarato, nell\'ordine dichiarato');

  // Nome non dichiarato ma MISURATO via SNMP → si usa quello (manual-first: dichiarato prima).
  const s2 = buildOverview({
    types: DR_TYPES, mgmtVlans: [20],
    measuredVlanNames: { 20: { name: 'MgmtSNMP' } },
    nodes: [{ id: 'sw1', type: 'switch', integration: { driver: 'snmp-v3', v3user: 'admin' } }],
  }).security;
  assert.deepEqual(rowOf(s2, 'secMgmtVlan').items, [{ id: 'VLAN 20', meta: 'MgmtSNMP' }], 'nome misurato in mancanza del dichiarato');
});

test('⑤ Sicurezza: tutto v3 con VLAN di gestione → verde; senza VLAN di gestione → giallo', () => {
  const base = { types: DR_TYPES, nodes: [
    { id: 'sw1', type: 'switch', integration: { driver: 'snmp-v3', v3user: 'u' } },
    { id: 'sw2', type: 'switch', integration: { driver: 'snmp-v3', v3user: 'u' } },
  ] };
  const ok = buildOverview(Object.assign({}, base, { mgmtVlans: [10] })).security;
  assert.equal(rowOf(ok, 'secSnmp').value, 2);
  assert.equal(ok.health.level, 'ok', 'tutti cifrati + VLAN di gestione = a norma');
  const noVlan = buildOverview(base).security;
  assert.equal(noVlan.health.level, 'warn', 'gestione non segmentata = giallo');
  assert.equal(rowOf(noVlan, 'secMgmtVlan').prov, 'none');
});

test('⑤ Sicurezza: coerenza VLAN wireless — SSID fuori dal trunk emerge; senza AP la riga è neutra', () => {
  const snmpOk = { id: 'sw1', type: 'switch', integration: { driver: 'snmp-v3', v3user: 'u' } };
  const issues = [{ kind: 'ssid-not-in-trunk', ssid: 'Guest', vlan: 40, ap: 'AP-1' }];

  // Senza AP con SSID → riga neutra (prov 'none', value null); non tocca il verdetto SNMP.
  const none = buildOverview({ types: DR_TYPES, nodes: [snmpOk], mgmtVlans: [10] }).security;
  assert.equal(rowOf(none, 'secWifiVlan').prov, 'none', 'senza wireless documentato la riga è neutra');
  assert.equal(rowOf(none, 'secWifiVlan').value, null);
  assert.equal(none.health.level, 'ok', 'il wireless assente non altera il verde SNMP');

  // Un SSID con VLAN fuori dal trunk → 1 problema, drill-down, verdetto almeno giallo.
  const bad = buildOverview({ types: DR_TYPES, nodes: [snmpOk], mgmtVlans: [10], wifiApCount: 2, wifiVlanIssues: issues }).security;
  const r = rowOf(bad, 'secWifiVlan');
  assert.equal(r.prov, 'declared', 'con AP che trasmettono SSID la coerenza è valutata');
  assert.equal(r.value, 1);
  assert.equal(r.tone, 'alert');
  assert.deepEqual(r.items, [{ id: 'SSID «Guest» · VLAN 40', meta: 'AP-1' }], 'il drill-down elenca l\'SSID incoerente');
  assert.equal(bad.health.level, 'warn', 'un SSID fuori dal trunk porta ⑤ ad almeno giallo');

  // AP con SSID ma coerenti → 0 problemi, non abbassa un verde.
  const okw = buildOverview({ types: DR_TYPES, nodes: [snmpOk], mgmtVlans: [10], wifiApCount: 1, wifiVlanIssues: [] }).security;
  assert.equal(rowOf(okw, 'secWifiVlan').value, 0, 'wireless coerente = 0 problemi');
  assert.equal(okw.health.level, 'ok', 'wireless coerente non abbassa il verde');

  // Wireless incoerente SENZA SNMP: la lente non resta grigia, sale a giallo (mai verde).
  const wifiOnly = buildOverview({ types: DR_TYPES, nodes: [{ id: 'ap1', type: 'ap' }], mgmtVlans: [10], wifiApCount: 1, wifiVlanIssues: issues }).security;
  assert.equal(wifiOnly.health.level, 'warn', 'un problema wireless emerge anche senza SNMP');
});

test('⑤ Sicurezza: progetto senza apparati gestiti → lente vuota (managed 0), verdetto neutro, nessun throw', () => {
  const s = buildOverview({ types: DR_TYPES, nodes: [{ id: 'pc1', type: 'pc', ip: '10.0.0.5' }] }).security;
  assert.equal(s.managed, 0);
  assert.equal(s.snmpTotal, 0);
  assert.equal(s.health.level, 'none', 'niente da valutare non è «a norma»');
  assert.equal(rowOf(s, 'secSnmp').prov, 'none');
});

test('⑤ Sicurezza: apparati gestiti ma NESSUN accesso SNMP → verdetto neutro, mai verde', () => {
  // Il caso quotidiano di un progetto appena disegnato: gli switch ci sono, le
  // credenziali non ancora. Zero misure di esposizione ≠ esposizione zero: l'app
  // non sa se quegli apparati non parlano SNMP o se nessuno ha scritto l'accesso.
  const s = buildOverview({
    types: DR_TYPES, mgmtVlans: [99],
    nodes: [{ id: 'sw1', type: 'switch' }, { id: 'sw2', type: 'switch' }],
  }).security;
  assert.equal(s.managed, 2, 'gli apparati gestibili ci sono');
  assert.equal(s.snmpTotal, 0, 'nessuno di loro ha un accesso configurato');
  assert.equal(s.health.level, 'none');
  assert.equal(s.health.issues, 0, 'neutro non è «zero problemi»: è nessuna misura');
  // Una VLAN di gestione dichiarata NON compra il verde: è advisory, e comunque
  // parla di segmentazione, non di quanto sia esposto un accesso che non esiste.
  assert.equal(rowOf(s, 'secMgmtVlan').value, 1);
});

test('nessuna riga contiene stringhe di interfaccia (le parole le mette il renderer)', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1' }],
    spare: { totals: { free: 1, ports: 24 } },
  });
  const all = [...o.complete.rows, ...o.truth.rows, ...o.margin.rows, ...o.recovery.rows, ...o.security.rows, ...o.health.rows];
  for (const r of all) {
    assert.equal(typeof r.key, 'string');
    // ⚠️ `unread` è la SECONDA assenza: `none` = nessuno l'ha SCRITTO,
    // `unread` = nessuno l'ha LETTO. Chiedono a due persone diverse di muoversi,
    // e prima collassavano su `none` — con l'etichetta «non dichiarato» appiccicata
    // anche alla riga `verify`, dove di dichiarazioni non ne mancava nessuna.
    assert.ok(['declared', 'measured', 'derived', 'none', 'unread'].includes(r.prov), 'provenienza dichiarata: ' + r.key);
    assert.ok(!('label' in r) && !('text' in r), 'la lib non scrive testo: ' + r.key);
  }
});

// ── ④ DR · CICLO DI VITA (garanzia / fine vita) ──────────────────────────────
// Due date DICHIARATE, senza gemello misurato: nessun apparato dice via SNMP
// quando scade il contratto. I test presidiano il punto delicato — il
// DENOMINATORE: chi non dichiara niente non è «coperto», è fuori dal conto.
const LC_NOW = Date.parse('2026-07-30T12:00:00Z');
const LC_D = (giorni) => new Date(LC_NOW + giorni * 864e5).toISOString().slice(0, 10);

test('④ ciclo di vita: senza date dichiarate la riga è tratteggiata, non verde', () => {
  const o = buildOverview({
    types: TYPES, now: LC_NOW,
    nodes: [{ id: 'sw1', type: 'switch' }, { id: 'sw2', type: 'switch' }],
  });
  const lc = rowOf(o.recovery, 'drLifecycle');
  assert.equal(lc.prov, 'none', 'nessuno dichiara: non lo sappiamo');
  assert.equal(lc.value, null, 'mai uno zero al posto di «non lo so»');
  assert.equal(lc.total, null);
});

test('④ ciclo di vita: il denominatore è chi DICHIARA, e chi non dichiara resta contato a parte', () => {
  const o = buildOverview({
    types: TYPES, now: LC_NOW,
    nodes: [
      { id: 'ok1', type: 'switch', warrantyUntil: LC_D(400) },        // coperto
      { id: 'muto', type: 'switch' },                                  // non dichiara nulla
      { id: 'muto2', type: 'router' },
    ],
  });
  const lc = rowOf(o.recovery, 'drLifecycle');
  assert.equal(lc.total, 1, 'solo chi dichiara entra nel conto');
  assert.equal(lc.value, 1);
  assert.equal(lc.prov, 'declared');
  assert.equal(lc.extra.undeclared, 2, '…e i muti si sanno, così «1 di 1» non si spaccia per «tutto a posto»');
  assert.equal(lc.items.length, 0);
});

test('④ ciclo di vita: fuori produzione > fuori garanzia > in scadenza, e la voce porta la data', () => {
  const o = buildOverview({
    types: TYPES, now: LC_NOW,
    nodes: [
      { id: 'vecchio', type: 'switch', eolDate: LC_D(-30), warrantyUntil: LC_D(-60) },  // EOL vince sulla garanzia scaduta
      { id: 'scaduto', type: 'switch', warrantyUntil: LC_D(-1) },
      { id: 'quasi', type: 'router', warrantyUntil: LC_D(45) },                          // entro i 90 giorni
      { id: 'sereno', type: 'router', warrantyUntil: LC_D(400), eolDate: LC_D(900) },
    ],
  });
  const lc = rowOf(o.recovery, 'drLifecycle');
  assert.equal(lc.total, 4);
  assert.equal(lc.value, 1, 'uno solo senza niente da dire');
  assert.equal(lc.extra.eol, 1);
  assert.equal(lc.extra.expired, 1);
  assert.equal(lc.extra.soon, 1);
  assert.equal(lc.tone, 'alert', 'scaduti o fuori produzione: la riga si accende');
  const byId = new Map(lc.items.map((i) => [i.id, i]));
  assert.equal(byId.get('vecchio').tag, 'eol', 'fuori produzione batte fuori garanzia');
  assert.equal(byId.get('vecchio').value, LC_D(-30), 'e porta la data che conta');
  assert.equal(byId.get('vecchio').metric, 'date', 'ISO nella lib, formato locale nel renderer');
  assert.equal(byId.get('scaduto').tag, 'expired');
  assert.equal(byId.get('quasi').tag, 'soon');
  assert.ok(!byId.has('sereno'), 'chi è a posto non finisce nell\'elenco');
});

test('④ ciclo di vita: ADVISORY — non decide chi è «ripristinabile stanotte»', () => {
  // Un apparato fuori produzione con backup fresco, identità e posizione resta
  // ripristinabile: l'EOL dice che non lo RICOMPRI, non che non lo rimetti su.
  const o = buildOverview({
    types: TYPES, now: LC_NOW,
    nodes: [{
      id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'ABC123',
      eolDate: LC_D(-500), warrantyUntil: LC_D(-500),
      backup: { ref: 'git@repo:sw1.cfg', at: new Date(LC_NOW - 5 * 864e5).toISOString() },
    }],
  });
  assert.equal(o.recovery.recoverable, 1, 'il verdetto DR non cambia definizione');
  assert.equal(o.recovery.health.level, 'ok');
  assert.equal(rowOf(o.recovery, 'drLifecycle').extra.eol, 1, '…ma la riga lo dice comunque');
});

// ── ⑥ SALUTE ─────────────────────────────────────────────────────────────────
// L'unica lente che parla del PRESENTE. Gli allarmi arrivano gia' derivati da
// lib/health-alerts.js (soglie testate li'): qui si presidia che la composizione
// non trasformi «non lo so» in «va tutto bene».
const HL_NOW = Date.parse('2026-07-30T12:00:00Z');
const hl = (over) => Object.assign(
  { id: 'x', type: 'nas', at: HL_NOW, blocks: { host: true }, cpu: null, alerts: [] }, over);

test('⑥ SALUTE LIVE: senza NEMMENO una lettura il verdetto e\' «non lo so», non verde', () => {
  const o = buildOverview({
    types: TYPES, now: HL_NOW,
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }],
  });
  assert.equal(o.health.health.level, 'none', 'assenza di misura != salute buona');
  assert.equal(o.health.measured, 0);
  assert.equal(o.health.targets, 1, 'un apparato interrogabile c\'e\': il denominatore lo dice');
  for (const k of ['hlHost', 'hlPower', 'hlSupplies', 'hlCpu']) {
    assert.equal(rowOf(o.health, k).prov, 'none', k + ': tratteggiata');
    assert.equal(rowOf(o.health, k).value, null, k + ': mai uno zero al posto di «non lo so»');
  }
  assert.equal(rowOf(o.health, 'hlReading').prov, 'none');
});

test('⑥ il denominatore e\' chi ha RISPOSTO con quella telemetria, non la flotta', () => {
  const o = buildOverview({
    types: TYPES, nodes: [], now: HL_NOW,
    liveHealth: [hl({ id: 'nas1', blocks: { host: true } }), hl({ id: 'ups1', blocks: { power: true } })],
  });
  assert.equal(rowOf(o.health, 'hlHost').total, 1, 'un NAS non rende l\'UPS «un host a posto»');
  assert.equal(rowOf(o.health, 'hlPower').total, 1);
  assert.equal(rowOf(o.health, 'hlSupplies').prov, 'none', 'nessuna stampante ha parlato: riga tratteggiata');
  assert.equal(o.health.measured, 2);
  assert.equal(o.health.healthy, 2);
  assert.equal(o.health.health.level, 'ok');
});

test('⑥ un critico tinge di rosso, un avviso di giallo — e la voce dice QUALE metrica', () => {
  const o = buildOverview({
    types: TYPES, nodes: [], now: HL_NOW,
    liveHealth: [
      hl({ id: 'nas1', blocks: { host: true }, alerts: [{ severity: 'crit', kind: 'disk', value: 97, label: '/volume1' }] }),
      hl({ id: 'ups1', blocks: { power: true }, alerts: [{ severity: 'warn', kind: 'ups', value: 12, label: 'runtime' }] }),
    ],
  });
  assert.equal(o.health.health.level, 'bad', 'un critico non e\' «da guardare»');
  assert.equal(o.health.health.issues, 2);
  assert.equal(o.health.crit, 1);
  assert.equal(o.health.healthy, 0);
  const host = rowOf(o.health, 'hlHost');
  assert.equal(host.value, 0);
  assert.equal(host.total, 1);
  assert.equal(host.extra.crit, 1);
  assert.equal(host.items[0].metric, 'disk', 'token, non parole (le mette il renderer)');
  assert.equal(host.items[0].label, '/volume1', 'il nome grezzo del volume passa intatto');
  assert.equal(host.items[0].tag, 'crit');
  assert.equal(rowOf(o.health, 'hlPower').items[0].metric, 'ups.runtime', 'la sotto-metrica UPS entra nel token');
});

test('⑥ la CPU si RIPORTA, non si giudica: nessuna soglia inventata', () => {
  // hrProcessorLoad e' il carico ISTANTANEO fra due poll: un 97% non e' un guasto.
  // La riga da' il numero e da chi arriva; il verdetto della lente non lo usa.
  const o = buildOverview({
    types: TYPES, nodes: [], now: HL_NOW,
    liveHealth: [hl({ id: 'nas1', cpu: 12 }), hl({ id: 'srv1', cpu: 97 })],
  });
  const cpu = rowOf(o.health, 'hlCpu');
  assert.equal(cpu.value, 97, 'il piu\' carico');
  assert.equal(cpu.prov, 'measured');
  assert.equal(cpu.tone, 'normal');
  assert.deepEqual(cpu.items.map((i) => i.id), ['srv1', 'nas1'], 'piu\' carico in cima');
  assert.equal(o.health.health.level, 'ok', 'la CPU non abbassa il verdetto');
});

test('⑥ «salute live» letta ieri non e\' piu\' live: il verde degrada e lo DICE', () => {
  const old = buildOverview({ types: TYPES, nodes: [], now: HL_NOW, liveHealth: [hl({ at: HL_NOW - 9 * 3600e3 })] });
  assert.equal(old.health.health.level, 'warn', 'una misura di 9 ore fa non e\' «adesso»');
  assert.equal(old.health.health.stale, true);
  assert.equal(old.health.health.staleHours, 9);
  const fresh = buildOverview({ types: TYPES, nodes: [], now: HL_NOW, liveHealth: [hl({ at: HL_NOW - 60e3 })] });
  assert.equal(fresh.health.health.level, 'ok');
  assert.ok(!fresh.health.health.stale, 'un dato appena letto non si ingiallisce');
});

test('⑥ la freschezza del quadro e\' quella del dato PIU\' VECCHIO, non del piu\' recente', () => {
  // Un solo apparato riletto adesso non rinfresca gli altri cinque letti ieri:
  // «nessun allarme su 6» vale quanto vale la misura piu' stantia fra quelle sei.
  const o = buildOverview({
    types: TYPES, nodes: [], now: HL_NOW,
    liveHealth: [hl({ id: 'vecchio', at: HL_NOW - 30 * 3600e3 }), hl({ id: 'appena', at: HL_NOW - 60e3 })],
  });
  assert.equal(o.health.health.level, 'warn', 'il piu\' recente non copre il piu\' vecchio');
  assert.equal(o.health.health.staleHours, 30);
  const rd = rowOf(o.health, 'hlReading');
  assert.equal(rd.extra.at, HL_NOW - 30 * 3600e3, 'l\'eta\' mostrata e\' quella della lettura piu\' vecchia');
  assert.equal(rd.extra.newestAt, HL_NOW - 60e3, 'l\'altra faccia resta a disposizione');
  // Due situazioni, due frasi: qui una lettura e' fresca, quindi il problema sono
  // gli apparati rimasti indietro — non «il dato e' vecchio» tout court.
  assert.equal(o.health.health.allStale, false);
  assert.equal(o.health.staleReadings, 1, 'una sola lettura ha passato la soglia');

  // Se invece anche la PIU' RECENTE ha passato la soglia, il dato e' vecchio e basta.
  const tutte = buildOverview({
    types: TYPES, nodes: [], now: HL_NOW,
    liveHealth: [hl({ id: 'a', at: HL_NOW - 30 * 3600e3 }), hl({ id: 'b', at: HL_NOW - 8 * 3600e3 })],
  });
  assert.equal(tutte.health.health.allStale, true);
  assert.equal(tutte.health.staleReadings, 2);
});

test('⑥ «Ultima lettura»: il drill-down elenca i target SNMP — prima i silenti (marcati), poi chi ha risposto', () => {
  const o = buildOverview({
    types: TYPES, now: HL_NOW,
    nodes: [
      { id: 'nas1', type: 'nas', ip: '10.0.0.5', integration: { driver: 'snmp-v2c', host: '10.0.0.5' } }, // risponde
      { id: 'sw9', type: 'switch', ip: '10.0.0.9', integration: { driver: 'snmp', host: '10.0.0.9' } },    // silente
    ],
    liveHealth: [hl({ id: 'nas1', type: 'nas', blocks: { host: true } })],
  });
  const rd = rowOf(o.health, 'hlReading');
  assert.equal(rd.value, 1, 'un apparato ha risposto');
  assert.equal(rd.total, 2, 'due target SNMP');
  assert.deepEqual(rd.items.map((i) => i.id), ['sw9', 'nas1'], 'il silente PRIMA (azione), poi chi ha risposto');
  assert.deepEqual(rd.items[0], { id: 'sw9', type: 'switch', meta: '—', tag: 'noReading' }, 'il silente è marcato');
  assert.deepEqual(rd.items[1], { id: 'nas1', type: 'nas' }, 'chi ha risposto: solo il device, nessun chip');
});

test('perimetro esplicito: buildOverview dichiara «cosa non sto guardando» (chiavi + tier, nessuna parola)', () => {
  const o = buildOverview({ types: TYPES, nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1' }] });
  assert.ok(Array.isArray(o.blindSpots) && o.blindSpots.length > 0, 'il perimetro non e\' vuoto');
  // Ogni voce = una CHIAVE + un tier valido; MAI una stringa d\'interfaccia (le parole
  // le mette il renderer via i18n, come per le righe).
  for (const b of o.blindSpots) {
    assert.equal(typeof b.key, 'string');
    assert.ok(b.key.length > 0);
    assert.ok(['unmodeled', 'elsewhere'].includes(b.tier), 'tier valido: ' + b.key);
    assert.ok(!('label' in b) && !('text' in b) && !('title' in b), 'nessun testo nel dato: ' + b.key);
  }
  // Le dimensioni-chiave che il giudizio da senior aveva chiamato buchi sono dichiarate.
  // 'nac' (802.1X/MAB/port-security) sta qui perche' la lente «Sicurezza» esiste: la'
  // dentro il silenzio si legge come assoluzione, quindi la dimensione non letta va
  // detta a voce alta o non va detta per niente.
  const keys = o.blindSpots.map((b) => b.key);
  for (const must of ['wan', 'stp', 'firewall', 'restore', 'sensors', 'nac']) {
    assert.ok(keys.includes(must), 'perimetro dichiara: ' + must);
  }
  // Il perimetro è un TODO VIVO, non una scritta fissa: ciò che viene modellato
  // ESCE dalla lista. UPS e salute host sono ora in un verdetto (lente ⑥), quindi
  // le loro voci non devono più comparire — altrimenti la Panoramica dichiarerebbe
  // di non guardare una cosa che guarda.
  for (const gone of ['power', 'health', 'lifecycle']) {
    assert.ok(!keys.includes(gone), 'ora modellato, quindi fuori dal perimetro: ' + gone);
  }
  // ⭐ E c'e' un TERZO caso, che non e' ne' «lo guardo» ne' «non esiste»: la WAN.
  // Le linee verso l'operatore, la loro banda e i collegamenti fra sedi
  // sono modellati dal 30/08 — ma nel pannello «Sedi e collegamenti», che e' UNO
  // per INSTALLAZIONE, mentre questo motore legge UN progetto. Toglierlo dalla
  // lista direbbe che la Panoramica li guarda; lasciarlo 'unmodeled' diceva che
  // il prodotto non li modella. Sono due bugie opposte, e il tier che le evita
  // tutt'e due esisteva gia' e non lo usava nessuno.
  const wan = o.blindSpots.find((b) => b.key === 'wan');
  assert.equal(wan.tier, 'elsewhere',
    'la WAN e\' documentata altrove (pannello inter-sede), non non-modellata');
  // Il perimetro e\' una COPIA difensiva della costante (mutarlo non tocca la lib).
  assert.notStrictEqual(o.blindSpots, _BLIND_SPOTS);
});

// ── Un perimetro senza parole non dichiara niente ──────────────────────────
test('perimetro: ogni dimensione ha etichetta E tooltip, in ENTRAMBE le lingue', () => {
  // `ov.blindHint.trunkSym` mancava da it E da en: la chip mostrava la CHIAVE GREZZA
  // nel title (t() ricade sulla chiave stessa quando non trova niente). La parita'
  // it/en non poteva vederlo — mancando da tutte e due, i due dizionari restavano
  // identici: la simmetria era perfetta e il buco pure.
  // La guardia sta QUI e non fra i test i18n perche' e' il perimetro a crescere: e'
  // un TODO vivo, e chi ci aggiunge una voce deve portarsi dietro le parole.
  const DICT = require('../lib/i18n.js')._i18nDict;
  const mancanti = [];
  for (const b of _BLIND_SPOTS) {
    for (const lang of ['it', 'en']) {
      for (const prefix of ['ov.blind.', 'ov.blindHint.']) {
        if (!DICT[lang][prefix + b.key]) mancanti.push(lang + ' · ' + prefix + b.key);
      }
    }
  }
  assert.deepEqual(mancanti, [], 'chiavi i18n mancanti per il perimetro');
});

// ── N13: la provenienza non si eredita per distrazione ─────────────────────
test('② ogni riga DICHIARA la sua provenienza: il default e\' «non dichiarato», non «dichiarato»', () => {
  // Guardia strutturale sul SORGENTE, come il test di parità i18n sui validatori.
  // `_row` aveva default `prov:'declared'`: una riga nuova che si dimenticava di
  // dirlo affermava provenienza umana — fail-OPEN sul paletto centrale. Ora il
  // default tace, e questo test impedisce che qualcuno riapra la porta.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'overview.js'), 'utf8');
  const lines = src.split(/\r?\n/);
  const senzaProv = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/_row\('([a-zA-Z]+)'/);
    if (!m) continue;
    let depth = 0, txt = '', j = i, started = false;
    while (j < lines.length) {
      for (const ch of lines[j]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') { depth--; } }
      txt += lines[j] + '\n'; j++;
      if (started && depth <= 0) break;
    }
    if (!/\bprov:/.test(txt)) senzaProv.push(m[1] + ' (riga ' + (i + 1) + ')');
    i = j - 1;
  }
  assert.deepEqual(senzaProv, [], 'righe senza `prov` esplicito: ' + senzaProv.join(', '));
  assert.ok(!/prov: 'declared', tone: 'normal', items: \[\] \}/.test(src), 'il default di _row non torna «declared»');
});

test('② un insieme MISTO non si etichetta con la sua parte migliore (cavi dedotti)', () => {
  const T = { switch: { isActive: true } };
  const nodes = [{ id: 'a', type: 'switch', ip: '10.0.0.1' }, { id: 'b', type: 'switch', ip: '10.0.0.2' }];
  const manuali = buildOverview({ types: T, nodes, links: [{ src: 'a-1', dst: 'b-1' }] }).complete;
  assert.equal(rowOf(manuali, 'cables').prov, 'declared', 'tutti posati a mano');
  const misti = buildOverview({ types: T, nodes,
    links: [{ src: 'a-1', dst: 'b-1' }, { src: 'a-2', dst: 'b-2', autoLinked: true }] }).complete;
  assert.equal(rowOf(misti, 'cables').value, 2);
  assert.equal(rowOf(misti, 'cables').prov, 'derived', 'un solo cavo dedotto basta: l\'insieme non e\' dichiarato');
  assert.equal(rowOf(buildOverview({ types: T, nodes, links: [] }).complete, 'cables').prov, 'none');
});

test('② un MAC non si dichiara, si osserva — e le porte libere sono un conto, non una cifra scritta', () => {
  const T = { switch: { isActive: true } };
  // Il MAC sta nella riga `addr`, ma resta una MISURA: `prov` della riga parla
  // dell'IP (dichiarato), il MAC porta il suo conteggio a parte — fonderli in una
  // sola parola avrebbe fatto passare per dichiarati 48 bit che nessuno digita.
  const conMac = buildOverview({ types: T, nodes: [{ id: 'a', type: 'switch', ip: '10.0.0.1', mac: 'AA:BB:CC:DD:EE:01' }] }).complete;
  assert.equal(rowOf(conMac, 'addr').prov, 'declared', 'la riga misura la completezza del DOCUMENTO');
  assert.equal(rowOf(conMac, 'addr').extra.mac, 1, 'il MAC osservato c\'è');
  assert.equal(rowOf(conMac, 'addr').items[0].mac, 'AA:BB:CC:DD:EE:01', 'e finisce nell\'abbinamento ARP');
  const senzaMac = buildOverview({ types: T, nodes: [{ id: 'a', type: 'switch', ip: '10.0.0.1' }] }).complete;
  assert.equal(rowOf(senzaMac, 'addr').extra.mac, 0, 'zero MAC osservati');
  assert.equal(rowOf(senzaMac, 'addr').extra.macNone, 1, 'e uno dichiarato mancante');
  const marg = buildOverview({ types: T, nodes: [{ id: 'a', type: 'switch', ip: '10.0.0.1', ports: 8 }],
    spare: { totals: { ports: 8, free: 8, used: 0, suspect: 0 }, racks: [], unracked: [] } }).margin;
  assert.equal(rowOf(marg, 'freePorts').prov, 'derived');
});

// ---- AUDIT 2026-08-13: fix P2 (prefix-first: reti senza VLAN dichiarate) ----
test('② prefix-first: una rete dichiarata SENZA VLAN conta come dichiarata (non «da dichiarare»)', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch', ip: '10.9.9.5' }],
    // ipam.prefixes[] è l'autorità: la 10.9.9.0/24 non ha VLAN ma è dichiarata
    prefixes: [
      { cidr: '10.9.9.0/24', vlan: null, gateway: '' },
      { cidr: '192.168.20.0/24', vlan: 20, gateway: '192.168.20.1' },
    ],
    networks: [{ net: '10.9.9', cidr: '10.9.9.0/24', ips: ['10.9.9.5', '10.9.9.8'], deviceCount: 2 }],
  });
  const gw = rowOf(o.complete, 'gateways');
  assert.equal(gw.total, 2, 'le reti dichiarate sono 2, compresa quella senza VLAN');
  assert.deepEqual(gw.items.filter((i) => i.tag === 'noGateway').map((i) => i.id), ['10.9.9.0/24']);
  const sub = rowOf(o.complete, 'subnets');
  assert.equal(sub.extra.undeclared, 0, 'gli IP osservati cadono in una rete DICHIARATA (vlan:null)');
  assert.deepEqual(sub.items.map((i) => i.tag), ['declaredNet']);
});

test('① Cavi: il cavo DICHIARATO su porta in shutdown ha un contatore suo, non NaN', () => {
  // Regressione: `cableProofCounts.shut++` su un campo non seminato dava NaN, e a
  // valle `pc.shut || 0` lo leggeva come 0 — la voce non compariva MAI nella tessera
  // «Cavi». Un bug che sparisce invece di rompere: questo test lo tiene visibile.
  const fresh = new Date().toISOString();
  const nodes = [
    { id: 'sw1', type: 'switch', name: 'SW', ip: '10.0.0.1', proof: { status: 'proven', lastProvenAt: fresh } },
    { id: 'rt1', type: 'router', name: 'RT', ip: '10.0.0.254', proof: { status: 'proven', lastProvenAt: fresh } },
  ];
  const o = buildOverview({ types: TYPES, nodes, driftLive: { counts: { shutCable: 1 } }, links: [
    { id: 'lm', src: 'sw1-1', dst: 'rt1-1' },                    // dichiarato, porta sana
    { id: 'lx', src: 'sw1-2', dst: 'rt1-2', portShut: true },     // dichiarato su porta chiusa a mano
  ] });
  const ex = rowOf(o.complete, 'cables').extra;
  const pc = ex.proofCounts;
  assert.equal(ex.shutCable, 1, 'contato — e preso dal report della Verifica, non da uno stato sui link');
  assert.ok(Number.isFinite(ex.shutCable), 'e come NUMERO: un NaN qui sparirebbe in silenzio');
  assert.equal(pc.declared, 1, 'non ruba il conteggio ai dichiarati sani');
  assert.equal(pc.review, 0, 'e non finisce fra i riesami: ha una voce sua');
});

// ── ② VERO · lo STATO DICHIARATO davanti alla misura ────────────────────────
// (lib/device-status.js · il campo `n.status`)

test('② VERO: nessuno dichiara lo stato -> riga tratteggiata, non uno zero verde', () => {
  const o = buildOverview({
    types: TYPES,
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncAt: 1000, now: 2000,
  }).truth;
  const r = rowOf(o, 'statusDeclared');
  assert.ok(r, 'la riga c\'e\' sempre');
  assert.equal(r.prov, 'none', 'nessuna dichiarazione = non lo sappiamo');
  assert.equal(r.value, null, 'zero sarebbe un\'affermazione: qui e\' assenza di dato');
  assert.equal(r.extra.declared, 0);
  assert.equal(r.extra.undeclared, 1);
});

test('② VERO: l\'assenza SPIEGATA si conta, e non e\' una contraddizione', () => {
  const o = buildOverview({
    types: TYPES,
    nodes: [
      { id: 'sw1', type: 'switch', status: 'planned', proof: { status: 'absent' } },
      { id: 'sw2', type: 'switch', status: 'active', proof: { status: 'proven' } },
    ],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncAt: 1000, now: 2000,
  }).truth;
  const r = rowOf(o, 'statusDeclared');
  assert.equal(r.value, 0, 'nessuna contraddizione');
  assert.equal(r.prov, 'measured');
  assert.equal(r.extra.declared, 2);
  assert.equal(r.extra.absentExpected, 1, 'il rosso NON acceso si conta: un silenziamento muto e\' invisibile');
  assert.deepEqual(r.extra.byStatus, { planned: 1, active: 1 });
  assert.equal(r.tone, 'normal');
});

test('② VERO: dichiarato fuori servizio ma risponde = contraddizione, e guida il titolo', () => {
  const o = buildOverview({
    types: TYPES,
    nodes: [
      { id: 'sw1', type: 'switch', status: 'decommissioning', ip: '10.0.0.5', proof: { status: 'proven' } },
      { id: 'sw2', type: 'switch', status: 'active', proof: { status: 'proven' } },
    ],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncAt: 1000, now: 2000,
  }).truth;
  const r = rowOf(o, 'statusDeclared');
  assert.equal(r.value, 1);
  assert.equal(r.tone, 'alert');
  assert.equal(r.items.length, 1, 'il numero grande e l\'elenco parlano della stessa cosa');
  assert.equal(r.items[0].id, 'sw1');
  assert.equal(r.items[0].tag, 'decommissioning', 'la riga dice QUALE stato e\' stato dichiarato');
  assert.equal(o.headline.key, 'statusDeclared', 'la bugia piu\' netta e\' la notizia');
});

test('② VERO: uno stato non riconosciuto non dichiara nulla e non silenzia nulla', () => {
  const o = buildOverview({
    types: TYPES,
    nodes: [{ id: 'sw1', type: 'switch', status: 'banana', proof: { status: 'absent' } }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
    lastSyncAt: 1000, now: 2000,
  }).truth;
  const r = rowOf(o, 'statusDeclared');
  assert.equal(r.prov, 'none');
  assert.equal(r.extra.undeclared, 1);
  assert.equal(r.extra.absentExpected, 0);
});

test('① Cavi: la voce dedotta porta il link-id (lid) per evidenziare il percorso sul floor', () => {
  const nodes = [
    { id: 'sw1', type: 'switch', name: 'SW', ip: '10.0.0.1' },
    { id: 'pc1', type: 'pc', name: 'PC', ip: '10.0.0.2' },
  ];
  const o = buildOverview({ types: TYPES, nodes,
    links: [{ id: 'L-42', autoLinked: true, src: 'sw1-1', dst: 'pc1-1' }] });
  assert.deepEqual(rowOf(o.complete, 'cables').items, [{ id: 'sw1', peer: 'pc1', lid: 'L-42' }],
    'il link-id viaggia con la voce → il click evidenzia il percorso sul floor');
});

test('① Vicini: un\'adiacenza che e\' anche un cavo del progetto porta il link-id (lid)', () => {
  const o = buildOverview({
    types: TYPES,
    nodes: [
      { id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } },
      { id: 'pc1', type: 'pc', ip: '10.0.0.50' },
    ],
    now: 5000,
    topoCache: { sw1: { ts: 1900, neighbors: [{ remoteDevice: 'AA:BB:CC:DD:EE:FF', remotePort: 'eth0' }] } },
    macToNode: { aabbccddeeff: 'pc1' },
    links: [{ id: 'L-sw1-pc1', src: 'sw1-3', dst: 'pc1-1' }],
  });
  const nb = rowOf(o.truth, 'neighbors');
  const item = nb.items.find((i) => i.peer === 'pc1');
  assert.ok(item, 'il vicino risolto a pc1 c\'e\'');
  assert.equal(item.lid, 'L-sw1-pc1', 'porta il link-id del cavo che rappresenta l\'adiacenza -> il click evidenzia il percorso');
});

// ============================================================
//  IL VERDETTO — una forma sola per tutte e sei le sezioni.
//
//  Ce n'erano DUE: la Sintesi rendeva una frase da i18n, le tre lenti un numero
//  grande costruito a mano dentro il renderer. Due alfabeti per la stessa
//  domanda, dentro il componente che esiste per non averne — e l'idea migliore
//  delle due («non lo so ha il suo colore») viveva in una sezione su sei.
//
//  ⚠️ Le prove qui sotto DERIVANO l'elenco delle sezioni da `buildOverview`:
//  una sezione aggiunta domani entra nel controllo da sola. Elencarle a mano
//  sarebbe il difetto che questa unificazione toglie, riscritto nel banco.
// ============================================================

const sezioniDi = (o) => Object.keys(o).filter((k) => k !== 'blindSpots');

test('verdetto: ogni sezione ne ha uno, e nessuna resta indietro in silenzio', () => {
  const o = buildOverview({ types: TYPES, nodes: [{ id: 'a', type: 'switch', ip: '10.0.0.1' }] });
  const sez = sezioniDi(o);
  assert.ok(sez.length >= 6, 'le sezioni ci sono: ' + sez.join(', '));
  for (const k of sez) {
    assert.ok(o[k].verdict, 'sezione senza verdetto: ' + k);
    assert.ok(['ok', 'warn', 'bad', 'none'].includes(o[k].verdict.level),
      k + ': livello inatteso ' + o[k].verdict.level);
  }
});

test('verdetto: un progetto vuoto dice «non lo so», non «tutto a posto»', () => {
  // ⭐ È la proprietà che vale più di tutte: l'assenza di dati non deve avere lo
  // stesso aspetto di un esito positivo. Un verde su un progetto mai letto è la
  // bugia più costosa che questa Panoramica possa dire.
  const o = buildOverview({ types: TYPES, nodes: [] });
  for (const k of sezioniDi(o)) {
    assert.notEqual(o[k].verdict.level, 'ok',
      k + ': senza un dato il verdetto non può essere «ok»');
  }
});

test('verdetto: «mai sincronizzato» è un NON SO, non un guasto', () => {
  // ⚠️ Cambio di comportamento voluto: prima era rosso. Ma il rosso è un guasto,
  // e non aver mai letto non è un guasto — è non sapere. Il rosso prometteva una
  // diagnosi che nessuno aveva fatto.
  const o = buildOverview({ types: TYPES, nodes: [{ id: 'a', type: 'switch', ip: '10.0.0.1' }] });
  assert.equal(o.truth.verdict.level, 'none', 'mai letto -> non so');
  assert.equal(o.truth.health.level, 'bad', 'la salute grezza resta quella di prima');
});

test('verdetto: dove la risposta È un numero, il numero c\'è; dove non lo è, non si inventa', () => {
  const nodes = [{ id: 'a', type: 'switch', ip: '10.0.0.1', snmp: { community: 'x' } }];
  const o = buildOverview({ types: TYPES, nodes });
  // Le tre lenti portano una coppia che riassume la domanda.
  for (const k of ['recovery', 'security', 'health']) {
    const v = o[k].verdict;
    assert.ok(v.total === null || typeof v.total === 'number', k + ': totale malformato');
  }
  // Le tre della Sintesi non ne hanno una: la loro risposta è la frase.
  for (const k of ['complete', 'truth', 'margin']) {
    assert.equal(o[k].verdict.value, null, k + ': non deve inventarsi un numero per simmetria');
  }
});

test('verdetto: `none` azzera i conteggi invece di riportare quelli della salute', () => {
  // Un «3 da decidere» accanto a un grigio direbbe due cose incompatibili nella
  // stessa riga: non lo so, ma sono tre.
  const o = buildOverview({ types: TYPES, nodes: [] });
  for (const k of sezioniDi(o)) {
    if (o[k].verdict.level !== 'none') continue;
    assert.equal(o[k].verdict.issues, 0, k + ': un «non so» non conta problemi');
    assert.equal(o[k].verdict.value, null, k + ': un «non so» non porta numeri');
  }
});

test('verdetto: ogni frase che il renderer andrà a cercare ESISTE, in tutt\'e due le lingue', () => {
  // ⚠️ Una chiave i18n mancante NON è silenziosa: `t()` rende la chiave stessa,
  // quindi a schermo comparirebbe «ov.health.margin.none». Prima di questa
  // unificazione tre sezioni su sei non avevano nessuna di queste chiavi — non
  // si vedeva solo perché passavano da un secondo verdetto scritto a mano.
  //
  // ⭐ I due elenchi si DERIVANO: le sezioni leggendo quali passano da
  // `_sectionEl` nel renderer, i livelli osservando quelli che il motore produce
  // davvero su modelli diversi. Scriverli a mano qui vorrebbe dire che il banco
  // enumera lo stesso elenco del codice, e allora il verde non dimostra niente.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-overview.js'), 'utf8');
  const conFrase = [...src.matchAll(/_sectionEl\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(conFrase.length >= 3, 'sezioni che usano la frase: ' + conFrase.join(', '));

  // I livelli davvero raggiungibili, osservati su modelli diversi.
  const modelli = [
    { types: TYPES, nodes: [] },
    { types: TYPES, nodes: [{ id: 'a', type: 'switch', ip: '10.0.0.1' }] },
    { types: TYPES, nodes: [{ id: 'a', type: 'switch', ip: '10.0.0.1' }, { id: 'b', type: 'pc' }] },
  ];
  const visti = new Map();
  for (const m of modelli) {
    const o = buildOverview(m);
    for (const k of conFrase) if (o[k] && o[k].verdict) {
      if (!visti.has(k)) visti.set(k, new Set());
      visti.get(k).add(o[k].verdict.level);
    }
  }

  const i18n = require('../lib/i18n.js');
  const dizionari = i18n._i18nDict;
  // Le lingue si leggono da `LANGS`, che è la dichiarazione: una terza aggiunta
  // domani entra nel controllo da sola.
  const lingue = i18n.LANGS.slice();
  assert.ok(lingue.length >= 2, 'servono due lingue, trovate: ' + lingue.join(', '));
  const mancanti = [];
  for (const [sez, livelli] of visti) {
    for (const lvl of livelli) {
      for (const lang of lingue) {
        const k = 'ov.health.' + sez + '.' + lvl;
        if (!dizionari[lang] || dizionari[lang][k] == null) mancanti.push(lang + ':' + k);
      }
    }
  }
  assert.deepEqual(mancanti, [], 'frasi di verdetto mancanti: ' + mancanti.join(' · '));
});
