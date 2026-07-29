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
const { buildOverview, _isAddressable, _hasRealName, _rackFill } = require('../lib/overview.js');

const TYPES = {
  switch: { isActive: true, isRack: true },      // attivo: hasIP implicito
  router: { isActive: true, isRack: true },
  pc:     { hasIP: true, isFloor: true },
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
  assert.deepEqual(rowOf(c, 'addr').items.map((i) => i.id), ['ups1']);
  assert.equal(rowOf(c, 'name').value, 1, 'solo SW-CORE ha un nome vero');
  assert.deepEqual(rowOf(c, 'name').items.map((i) => i.id).sort(), ['pc1', 'rt1', 'ups1']);
  assert.equal(rowOf(c, 'mac').value, 2);
  assert.equal(rowOf(c, 'mac').extra.fromPorts, 0, 'nessun MAC preso dalle interfacce qui');
  assert.equal(rowOf(c, 'cables').value, 2);
  // Un cavo dedotto dall'auto-link NON è un cavo dichiarato: la sezione che
  // chiede «il documento descrive tutto?» deve tenerli separati.
  assert.deepEqual(rowOf(c, 'cables').extra, { portsUsed: 4, auto: 1, manual: 1 });
  // Il click sui Cavi mostra i DEDOTTI (i «da verificare»), coi due capi come nodo.
  assert.deepEqual(rowOf(c, 'cables').items, [{ id: 'sw1', peer: 'pc1' }]);
  assert.equal(rowOf(c, 'addr').pct, 75, 'la percentuale la calcola la lib, non il renderer');
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
  const o = buildOverview({ types: TYPES, nodes, portMacNodeIds: new Set(['sw1']) });
  const mac = rowOf(o.complete, 'mac');
  assert.equal(mac.value, 2, 'sw1 conta come documentato: l\'identità L2 c\'è');
  assert.equal(mac.extra.fromPorts, 1, 'e si dichiara che arriva dalle interfacce');
  assert.deepEqual(mac.items.map((i) => i.id), ['sw2'], 'manca solo a chi non ce l\'ha davvero');

  // Accetta anche un array (non solo Set): il chiamante non deve indovinare il tipo.
  const o2 = buildOverview({ types: TYPES, nodes, portMacNodeIds: ['sw1', 'sw2'] });
  assert.equal(rowOf(o2.complete, 'mac').value, 3);
  assert.equal(rowOf(o2.complete, 'mac').extra.fromPorts, 2);
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
  assert.deepEqual(sub.items[0], { id: '10.0.0.0/24', meta: 7, tag: 'undeclared' });
  assert.equal(rowOf(o.complete, 'vlanNames').prov, 'none');
  assert.equal(rowOf(o.complete, 'vlanNames').total, 3, '3 VLAN in uso, 0 con un nome');
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
  assert.equal(rowOf(t, 'verifiable').total, 4);
  assert.deepEqual(rowOf(t, 'verifiable').items.map((i) => i.id), ['pc1', 'pc2'], 'i NON verificabili, per nome');
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
  assert.equal(rowOf(t, 'verify').prov, 'none', 'mai verificato -> riga \'none\' (tratteggiata), non 0');
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
    nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } },
      { id: 'pc1', type: 'pc', ip: '10.0.0.50' }],
    spare: { totals: { free: 10, suspect: 0, ports: 24 } },
  });
  assert.equal(o.truth.headline.key, 'verifiable');
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
  assert.deepEqual(rowOf(g, 'freePorts').extra, { raw: 181, suspect: 15 }, 'il numero grezzo resta leggibile');
  // Il click mostra, per ogni device, le libere sul totale, DISTINTI in rack e
  // fuori rack (prima i device in rack, piu' libere in cima, poi i liberi).
  assert.deepEqual(rowOf(g, 'freePorts').items.map((i) => [i.id, i.meta, i.of, i.group]),
    [['sw1', 40, 48, 'rack'], ['sw2', 4, 24, 'rack'], ['rt1', 2, 8, 'loose']]);
  assert.equal(rowOf(g, 'rackU').value, 26);
  assert.equal(g.headline.key, 'freePorts');
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
  assert.deepEqual(ip.items.map((i) => i.tag), ['declared', 'undeclared'], 'la /16 è dichiarata, la 192.168.1 no');
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
  assert.deepEqual(ip.items.map((i) => i.tag), ['declared', 'undeclared']);
  assert.equal(ip.value, (14 - 2) + (240 - 3));
  // Subnet di progetto: stessa ripartizione, meta = device (2 dentro, 3 fuori: nessuno perso)
  const sub = rowOf(o.complete, 'subnets');
  assert.deepEqual(sub.items.map((i) => i.id), ['192.168.1.0/28', '192.168.1.0/24']);
  assert.deepEqual(sub.items.map((i) => i.meta), [2, 3], '2 device nella /28, 3 fuori — tutti presenti');
  assert.deepEqual(sub.items.map((i) => i.tag), ['declared', 'undeclared']);
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

  // sizeU assente sul rack → default app-wide 42 (come app.js:656), MAI 0.
  assert.equal(_rackFill([{ id: 'r3' }], [], types)[0].sizeU, 42);
  // e passato dentro buildOverview, il totale non e' piu' fisso a 42.
  const o = buildOverview({ types, nodes, rackFill: fill, spare: { totals: { free: 0, ports: 0 } } });
  assert.equal(rowOf(o.margin, 'rackU').total, 36, '24 + 12, non 84');
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

test('nessuna riga contiene stringhe di interfaccia (le parole le mette il renderer)', () => {
  const o = buildOverview({
    types: TYPES, nodes: [{ id: 'sw1', type: 'switch', ip: '10.0.0.1' }],
    spare: { totals: { free: 1, ports: 24 } },
  });
  const all = [...o.complete.rows, ...o.truth.rows, ...o.margin.rows];
  for (const r of all) {
    assert.equal(typeof r.key, 'string');
    assert.ok(['declared', 'measured', 'derived', 'none'].includes(r.prov), 'provenienza dichiarata: ' + r.key);
    assert.ok(!('label' in r) && !('text' in r), 'la lib non scrive testo: ' + r.key);
  }
});
