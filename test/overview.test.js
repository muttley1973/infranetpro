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
  const o = buildOverview({ types: TYPES, nodes, links: [{}, { autoLinked: true }], spare: { totals: { used: 4 } } });
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
  assert.deepEqual(sub.items[0], { id: '10.0.0.0/24', meta: 7 });
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
    topoCache: { sw1: { ts: 1900, neighbors: [{}, {}, {}] } },   // sw2: mai risposto
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
  assert.equal(rowOf(t, 'neighbors').value, 3);
  assert.equal(rowOf(t, 'neighbors').extra.neverAnswered, 1);
  assert.deepEqual(rowOf(t, 'neighbors').items.map((i) => i.id), ['sw2']);
  assert.deepEqual(rowOf(t, 'lags').extra, { measured: 1, derived: 1 }, 'la chiave dice da dove viene');
  assert.equal(rowOf(t, 'verify').prov, 'none', 'fase 1: la Verifica non e\' ancora stato salvato');
  assert.equal(t.headline.key, 'suspectPorts', 'il colpo d\'occhio e\' la cosa da guardare');
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
    spare: { totals: { free: 181, suspect: 15, ports: 208, freeSfp: 0 } },
    sfpTotal: 0,
    rackFill: [{ sizeU: 42, free: 26 }],
  });
  const g = o.margin;
  assert.equal(rowOf(g, 'freePorts').value, 166, '181 libere − 15 viste attive');
  assert.deepEqual(rowOf(g, 'freePorts').extra, { raw: 181, suspect: 15 }, 'il numero grezzo resta leggibile');
  assert.equal(rowOf(g, 'rackU').value, 26);
  assert.equal(g.headline.key, 'freePorts');
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
