// Test per la costruzione pura della lista linee topologia (lib/topo-lines.js).
// Hardening rendering: il "COSA disegnare" e' ora testabile senza DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTopoLines, isTopoEndpointType } = require('../lib/topo-lines.js');

// ---- Fixtures minime ---------------------------------------------------------

const TYPES = {
  switch:     { isRack: true },
  router:     { isRack: true },
  patchpanel: { isRack: true },
  pc:         { isFloor: true },
  printer:    { isFloor: true },
  voip:       { isFloor: true, hasIP: true, passThrough: 'port' }, // terminale con PC in cascata
  wallport:   { isFloor: true, passThrough: 'port' },
  room:       { isFloor: true, isStructural: true },
};

function helpers(over = {}) {
  return {
    portNodeId: pid => String(pid || '').split('-')[0],
    portDisplayName: pid => String(pid || ''),
    linkVlan: l => l.vlan || 1,
    linkMatchesVlanFilter: () => true,
    rackPairMatchesVlan: () => true,
    isAmbiguousLink: l => !!l.autoLinked,
    chainAmbiguousIds: null,
    chainColors: null,
    findPortByIfName: () => '',
    findProjectLinkByPorts: () => null,
    ...over,
  };
}

function model(over = {}) {
  return {
    nodes: [], links: [], racks: [],
    types: TYPES,
    topoData: null,
    currentRack: null, hoverRackId: null,
    filterVlan: null, vlanColors: {},
    highPathIds: new Set(), selectedLinkId: null,
    helpers: helpers(over.helpers || {}),
    ...over,
    ...(over.helpers ? { helpers: helpers(over.helpers) } : {}),
  };
}

// Scenario base: 2 rack piazzati con uno switch ciascuno, PC e presa sul floor.
function baseModel(over = {}) {
  return model({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1' },
      { id: 'sw2', type: 'switch', rackId: 'r2' },
      { id: 'pc1', type: 'pc', x: 100, y: 100 },
      { id: 'wp1', type: 'wallport', x: 200, y: 200 },
    ],
    racks: [
      { id: 'r1', name: 'Rack 1', x: 500, y: 500 },
      { id: 'r2', name: 'Rack 2', x: 800, y: 500 },
    ],
    ...over,
  });
}

// Tutti i linkId che compaiono nel risultato (pairs.edges + fanout), con
// molteplicita': la regola d'oro e' che ogni link e' disegnato UNA volta sola.
function drawnLinkIds(res) {
  const ids = [];
  for (const p of res.pairs) for (const e of p.edges) if (e.linkId) ids.push(e.linkId);
  for (const f of res.fanout) ids.push(f.linkId);
  return ids;
}

// ---- Trunk effettivo iniettato (derivato da voce/SSID) ----------------------

test('trunk derivato: helper linkIsTrunk iniettato → fanout marcato trunk', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'pc1-1', dst: 'sw1-3' }],   // floor↔rack → fanout
    helpers: { linkIsTrunk: () => true, linkTrunkVlans: () => '1,20' },
  }));
  assert.equal(res.fanout[0].mode, 'trunk');
  assert.equal(res.fanout[0].trunkVlans, '1,20');
});

test('default senza helper: il trunk segue link.mode/trunkVlans', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'pc1-1', dst: 'sw1-3', mode: 'trunk', trunkVlans: '5,6' }],
  }));
  assert.equal(res.fanout[0].mode, 'trunk');
  assert.equal(res.fanout[0].trunkVlans, '5,6');
});

// ---- Regola d'oro: nessun link disegnato due volte (regressione sessione 21) --

test('un link floor↔rack appare SOLO nel fanout, mai nelle pairs (no doppio cavo)', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'pc1-1', dst: 'sw1-3' }],
  }));
  assert.equal(res.pairs.length, 0, 'nessuna pair per un link misto floor↔rack');
  assert.equal(res.fanout.length, 1);
  assert.equal(res.fanout[0].linkId, 'l1');
  assert.equal(res.fanout[0].rackId, 'r1');
});

test('nessun linkId duplicato fra pairs e fanout su uno scenario misto', () => {
  const res = buildTopoLines(baseModel({
    links: [
      { id: 'a', src: 'sw1-1', dst: 'sw2-1' },   // rack↔rack
      { id: 'b', src: 'pc1-1', dst: 'wp1-1' },   // floor↔floor
      { id: 'c', src: 'wp1-1', dst: 'sw1-5' },   // floor↔rack → solo fanout
      { id: 'd', src: 'pc1-1', dst: 'sw2-7' },   // floor↔rack → solo fanout
    ],
  }));
  const ids = drawnLinkIds(res);
  assert.deepEqual([...ids].sort(), [...new Set(ids)].sort(), 'ogni link disegnato una volta sola');
  assert.equal(ids.length, 4);
});

// ---- Pairs: kind, conferma, conteggio -----------------------------------------

test('cavo manuale cross-rack → 1 pair rack-rack confermata, protocollo Manual', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1' }],
  }));
  assert.equal(res.pairs.length, 1);
  const p = res.pairs[0];
  assert.equal(p.kind, 'rack-rack');
  assert.equal(p.confirmed, true);
  assert.equal(p.protocol, 'Manual');
  assert.equal(p.count, 1);
  assert.equal(p.rackAId, 'r1');
  assert.equal(p.rackBId, 'r2');
});

test('cavo manuale floor-floor → 1 pair floor-floor con nodeAId/nodeBId', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'pc1-1', dst: 'wp1-1' }],
  }));
  assert.equal(res.pairs.length, 1);
  const p = res.pairs[0];
  assert.equal(p.kind, 'floor-floor');
  assert.equal(p.rackAId, null);
  assert.deepEqual([p.nodeAId, p.nodeBId].sort(), ['pc1', 'wp1']);
});

test('piu\' link sulla stessa coppia rack → count aggregato e width crescente', () => {
  const res = buildTopoLines(baseModel({
    links: [
      { id: 'l1', src: 'sw1-1', dst: 'sw2-1' },
      { id: 'l2', src: 'sw1-2', dst: 'sw2-2' },
    ],
  }));
  assert.equal(res.pairs.length, 1);
  assert.equal(res.pairs[0].count, 2);
  assert.ok(res.pairs[0].width > _w(1), 'width cresce col conteggio');
  function _w(c){ return Math.min(0.9 + c * 0.3, 3); }
});

test('rack non piazzato (x undefined) → nessuna pair', () => {
  const m = baseModel({ links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1' }] });
  m.racks = [{ id: 'r1', name: 'Rack 1' }, { id: 'r2', name: 'Rack 2', x: 800, y: 500 }];
  const res = buildTopoLines(m);
  assert.equal(res.pairs.length, 0);
});

// ---- Priorita' colore -----------------------------------------------------------

test('colore: VLAN dominante >1 vince', () => {
  const res = buildTopoLines(baseModel({
    vlanColors: { 10: '#00d4ff' },
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1', vlan: 10 }],
  }));
  assert.equal(res.pairs[0].color, '#00d4ff');
});

test('colore: senza VLAN vince il colore manuale del cavo (colorOvr)', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1', colorOvr: '#ff0000' }],
  }));
  assert.equal(res.pairs[0].color, '#ff0000');
});

test('colore: catena (chainColors) come fallback dopo il manuale', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1' }],
    helpers: { chainColors: new Map([['l1', '#3fb950']]) },
  }));
  assert.equal(res.pairs[0].color, '#3fb950');
});

test('colore: VLAN 1 in palette come ultimo fallback prima del grigio', () => {
  const withV1 = buildTopoLines(baseModel({
    vlanColors: { 1: '#aabb00' },
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1', vlan: 1 }],
  }));
  assert.equal(withV1.pairs[0].color, '#aabb00');
  const noPalette = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1', vlan: 1 }],
  }));
  assert.equal(noPalette.pairs[0].color, '#8b949e');   // grigio
});

// ---- Filtro VLAN ---------------------------------------------------------------

test('filterVlan: pair rack-rack esclusa se rackPairMatchesVlan=false', () => {
  const res = buildTopoLines(baseModel({
    filterVlan: 10,
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1' }],
    helpers: { rackPairMatchesVlan: () => false },
  }));
  assert.equal(res.pairs.length, 0);
});

test('filterVlan: fanout escluso se il link non matcha il filtro', () => {
  const res = buildTopoLines(baseModel({
    filterVlan: 10,
    links: [{ id: 'l1', src: 'pc1-1', dst: 'sw1-3' }],
    helpers: { linkMatchesVlanFilter: () => false },
  }));
  assert.equal(res.fanout.length, 0);
});

// ---- Ambiguita' -----------------------------------------------------------------

test('pair.ambiguous via chainAmbiguousIds (chain-aware)', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1' }],
    helpers: { chainAmbiguousIds: new Set(['l1']) },
  }));
  assert.equal(res.pairs[0].ambiguous, true);
});

test('fanout.ambiguous per-link (isAmbiguousLink)', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'l1', src: 'pc1-1', dst: 'sw1-3', autoLinked: true }],
  }));
  assert.equal(res.fanout[0].ambiguous, true);
});

// ---- Fanout: enfasi per rack corrente -------------------------------------------

test('fanout: il rack corrente e\' enfatizzato, gli altri attenuati', () => {
  const res = buildTopoLines(baseModel({
    currentRack: 'r1',
    links: [
      { id: 'a', src: 'pc1-1', dst: 'sw1-3' },   // verso r1 (corrente)
      { id: 'b', src: 'wp1-1', dst: 'sw2-3' },   // verso r2
    ],
  }));
  const fa = res.fanout.find(f => f.linkId === 'a');
  const fb = res.fanout.find(f => f.linkId === 'b');
  assert.equal(fa.emphasized, true);
  assert.equal(fa.opacity, 0.78);
  assert.equal(fb.emphasized, false);
  assert.equal(fb.opacity, 0.38);
});

// L'enfasi e' una questione di ASPETTO e non deve decidere che cosa si puo'
// cliccare: quando lo faceva, i cavi degli altri rack erano disegnati ma inerti
// e non c'era modo di capire perche' uno si selezionasse e il vicino no.
// Il drag dei rack lo protegge il renderer, arretrando la banda di hit dai capi.
test('fanout: l\'enfasi NON porta con se\' l\'interattivita\'', () => {
  const res = buildTopoLines(baseModel({
    currentRack: 'r1',
    links: [
      { id: 'a', src: 'pc1-1', dst: 'sw1-3' },
      { id: 'b', src: 'wp1-1', dst: 'sw2-3' },
    ],
  }));
  for (const f of res.fanout) {
    assert.equal('interactive' in f, false,
      'il descrittore non deve piu\' dettare chi e\' cliccabile: lo decide il renderer');
  }
});

test('fanout: senza rack corrente nessuna linea e\' enfatizzata (ma restano tutte)', () => {
  const res = buildTopoLines(baseModel({
    currentRack: null,
    links: [
      { id: 'a', src: 'pc1-1', dst: 'sw1-3' },
      { id: 'b', src: 'wp1-1', dst: 'sw2-3' },
    ],
  }));
  assert.equal(res.fanout.length, 2, 'le linee ci sono comunque');
  assert.ok(res.fanout.every(f => !f.emphasized));
});

test('fanout: selected se il link e\' in highPath o selezionato', () => {
  const res = buildTopoLines(baseModel({
    highPathIds: new Set(['a']),
    links: [{ id: 'a', src: 'pc1-1', dst: 'sw1-3' }],
  }));
  assert.equal(res.fanout[0].selected, true);
});

// ---- Passata 1 (topoData LLDP/CDP) ----------------------------------------------

function topoDataModel(over = {}) {
  return baseModel({
    topoData: {
      nodes: [
        { id: 't1', nodeId: 'sw1' },
        { id: 't2', nodeId: 'sw2' },
      ],
      edges: [{ src: 't1', dst: 't2', srcPort: 'Gi0/1', dstPort: 'Gi0/2', protocol: 'LLDP' }],
    },
    ...over,
  });
}

test('edge LLDP fra rack piazzati → pair scoperta NON confermata', () => {
  const res = buildTopoLines(topoDataModel());
  assert.equal(res.pairs.length, 1);
  assert.equal(res.pairs[0].protocol, 'LLDP');
  assert.equal(res.pairs[0].confirmed, false);
});

test('edge LLDP + cavo manuale fra gli stessi rack → pair confermata, no edge duplicato', () => {
  const res = buildTopoLines(topoDataModel({
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-2' }],
    helpers: { findProjectLinkByPorts: () => null },
  }));
  assert.equal(res.pairs.length, 1);
  assert.equal(res.pairs[0].confirmed, true);
  // 1 edge LLDP (senza linkId) + 1 edge Manual (con linkId)
  assert.equal(res.pairs[0].count, 2);
});

test('REGRESSIONE crash latente: pair floor-floor da LLDP + cavo manuale VLAN>1 non lancia', () => {
  // Nell'overlay originale la entry floor-floor di passata 1 non aveva
  // vlanCounts → TypeError alla passata 3. Qui deve funzionare e contare.
  const m = baseModel({
    vlanColors: { 20: '#ff00d4' },
    topoData: {
      nodes: [
        { id: 't1', nodeId: 'pc1' },
        { id: 't2', nodeId: 'wp1' },
      ],
      edges: [{ src: 't1', dst: 't2', srcPort: 'eth0', dstPort: '1', protocol: 'MAC-WALLPORT' }],
    },
    links: [{ id: 'l1', src: 'pc1-1', dst: 'wp1-1', vlan: 20 }],
  });
  const res = buildTopoLines(m);   // non deve lanciare
  assert.equal(res.pairs.length, 1);
  assert.equal(res.pairs[0].color, '#ff00d4');   // la VLAN del cavo manuale colora la pair
});

// ---- Rack alerts ----------------------------------------------------------------

test('rackAlerts: cavo intra-rack inferito → badge sul rack piazzato (una volta sola)', () => {
  const res = buildTopoLines(baseModel({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1' },
      { id: 'pp1', type: 'patchpanel', rackId: 'r1' },
      { id: 'sw2', type: 'switch', rackId: 'r2' },
    ],
    links: [
      { id: 'a', src: 'sw1-1', dst: 'pp1-1', autoLinked: true },
      { id: 'b', src: 'sw1-2', dst: 'pp1-2', autoLinked: true },   // stesso rack: niente doppio badge
    ],
  }));
  assert.equal(res.rackAlerts.length, 1);
  assert.equal(res.rackAlerts[0].rackId, 'r1');
});

test('rackAlerts: rack non piazzato → nessun badge', () => {
  const m = baseModel({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1' },
      { id: 'pp1', type: 'patchpanel', rackId: 'r1' },
    ],
    links: [{ id: 'a', src: 'sw1-1', dst: 'pp1-1', autoLinked: true }],
  });
  m.racks = [{ id: 'r1', name: 'Rack 1' }];   // senza x/y
  const res = buildTopoLines(m);
  assert.equal(res.rackAlerts.length, 0);
});

// ---- Toggle TRUNK (evidenzia trunk, attenua il resto) -----------------------------

test('hasTrunk: pair con almeno un link mode=trunk → true, solo access → false', () => {
  const res = buildTopoLines(baseModel({
    links: [
      { id: 't', src: 'sw1-1', dst: 'sw2-1', mode: 'trunk' },
      { id: 'b', src: 'pc1-1', dst: 'wp1-1' },               // access floor-floor
    ],
  }));
  const rackPair = res.pairs.find(p => p.kind === 'rack-rack');
  const floorPair = res.pairs.find(p => p.kind === 'floor-floor');
  assert.equal(rackPair.hasTrunk, true);
  assert.equal(floorPair.hasTrunk, false);
});

test('physicalTrace: mostra SOLO i segmenti del percorso (fanout rack↔presa + coppia presa↔endpoint), evidenziati', () => {
  // Catena: sw1(rack) → wp1(presa) → pc1(endpoint). Due link, entrambi nel percorso.
  const links = [
    { id: 'seg1', src: 'sw1-5', dst: 'wp1-1' },   // rack↔presa (fanout)
    { id: 'seg2', src: 'wp1-1', dst: 'pc1-1' },   // presa↔endpoint (floor-floor)
    { id: 'noise', src: 'sw1-1', dst: 'sw2-1' },  // backbone NON nel percorso → escluso
  ];
  const res = buildTopoLines(baseModel({
    links,
    physicalTrace: true,
    highPathIds: new Set(['seg1', 'seg2']),
  }));
  // Solo i 2 segmenti del percorso, niente backbone
  assert.ok(!res.pairs.some(p => p.kind === 'rack-rack'), 'backbone fuori dal percorso escluso');
  assert.ok(res.fanout.some(f => f.linkId === 'seg1' && f.selected), 'fanout rack↔presa presente ed evidenziato');
  assert.ok(res.pairs.some(p => p.kind === 'floor-floor' && p.selected), 'coppia presa↔endpoint presente ed evidenziata');
  assert.equal(res.rackAlerts.length, 0);
});

test('hideEndpoints: nasconde solo il segmento verso l\'endpoint + l\'endpoint, tiene presa↔rack e backbone', () => {
  const base = {
    links: [
      { id: 't', src: 'sw1-1', dst: 'sw2-1', mode: 'trunk' },  // rack-rack (backbone) → resta
      { id: 'e', src: 'pc1-1', dst: 'wp1-1' },                 // PC↔presa (ultimo spezzone) → via
      { id: 'w', src: 'wp1-1', dst: 'sw1-5' },                 // presa↔rack (fanout infra) → resta
      { id: 'g', src: 'pc1-1', dst: 'sw2-7' },                 // PC↔rack diretto (endpoint) → via
    ],
  };
  const on = buildTopoLines(baseModel({ ...base, hideEndpoints: true }));
  // presa↔rack resta; PC↔rack diretto sparisce
  assert.ok(on.fanout.some(f => f.linkId === 'w'), 'fanout presa↔rack resta');
  assert.ok(!on.fanout.some(f => f.linkId === 'g'), 'fanout verso endpoint via');
  // niente coppie floor-floor che toccano un endpoint; rack-rack resta
  assert.ok(!on.pairs.some(p => p.kind === 'floor-floor'), 'PC↔presa via');
  assert.ok(on.pairs.some(p => p.kind === 'rack-rack'), 'backbone resta');

  const off = buildTopoLines(baseModel({ ...base, hideEndpoints: false }));
  assert.ok(off.pairs.some(p => p.kind === 'floor-floor'), 'OFF: PC↔presa c\'e\'');
  assert.ok(off.fanout.some(f => f.linkId === 'g'), 'OFF: PC↔rack c\'e\'');
});

test('filterVlan + ENDPOINT: il toggle comanda anche sotto filtro (ON = percorso fino al device)', () => {
  // Sotto filtro VLAN il toggle ENDPOINT deve comandare comunque: ON → percorso
  // completo fino al device; OFF → ferma alla wall-port. Il filtro NON forza il
  // nascondi-endpoint (regressione: prima lo forzava e il device non si vedeva mai).
  const base = {
    filterVlan: 10,
    links: [
      { id: 't', src: 'sw1-1', dst: 'sw2-1', mode: 'trunk' },  // backbone rack-rack
      { id: 'e', src: 'pc1-1', dst: 'wp1-1' },                 // PC↔presa (ultimo spezzone)
      { id: 'w', src: 'wp1-1', dst: 'sw1-5' },                 // presa↔rack
    ],
  };
  // ENDPOINT ON (hideEndpoints:false): si vede il percorso fino al device.
  const on = buildTopoLines(baseModel({ ...base, hideEndpoints: false }));
  assert.ok(on.pairs.some(p => p.kind === 'floor-floor'), 'filtro+ENDPOINT ON: ultimo spezzone PC↔presa VISIBILE');
  assert.ok(on.fanout.some(f => f.linkId === 'w'), 'presa↔rack visibile');
  // ENDPOINT OFF (hideEndpoints:true): ferma alla wall-port.
  const off = buildTopoLines(baseModel({ ...base, hideEndpoints: true }));
  assert.ok(!off.pairs.some(p => p.kind === 'floor-floor'), 'filtro+ENDPOINT OFF: ferma alla wall-port (PC↔presa via)');
  assert.ok(off.fanout.some(f => f.linkId === 'w'), 'presa↔rack resta come confine');
});

test('hideEndpoints: il VoIP (pass-through con IP) è un endpoint → nascosto fino alla wall-port', () => {
  // Catena: presa(wp1) → telefono(tel) → PC dietro. Il VoIP ha passThrough:'port'
  // (PC in cascata) ma è un device terminale CON IP: col toggle ENDPOINT (OFF) va
  // nascosto come gli altri, la vista si ferma alla presa. La presa↔rack resta.
  const res = buildTopoLines(baseModel({
    hideEndpoints: true,
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1' },
      { id: 'wp1', type: 'wallport', x: 200, y: 200 },
      { id: 'tel', type: 'voip', x: 250, y: 260 },
      { id: 'pcx', type: 'pc', x: 300, y: 320 },
    ],
    links: [
      { id: 'wr', src: 'wp1-1', dst: 'sw1-5' },  // presa↔rack → resta (confine)
      { id: 'wt', src: 'wp1-2', dst: 'tel-1' },  // presa↔telefono → via (telefono endpoint)
      { id: 'tp', src: 'tel-2', dst: 'pcx-1' },  // telefono↔PC → via
    ],
  }));
  assert.ok(res.fanout.some(f => f.linkId === 'wr'), 'la wall-port resta (confine)');
  assert.ok(!res.pairs.some(p => p.kind === 'floor-floor'),
    'né presa↔telefono né telefono↔PC sono disegnate: il VoIP è trattato come endpoint');
});

// Le non-trunk venivano ATTENUATE a 0.12 (`trunkDim`). Ora escono dalla lista:
// una linea quasi trasparente e' ancora li' da leggere e da scavalcare col mouse,
// e si confonde con le altre attenuazioni della vista.
test('«solo trunk»: le non-trunk escono dalla lista, coppie e fan-out insieme', () => {
  const m = baseModel({
    links: [
      { id: 't', src: 'sw1-1', dst: 'sw2-1', mode: 'trunk' },   // pair trunk
      { id: 'b', src: 'pc1-1', dst: 'wp1-1' },                  // pair access
      { id: 'f', src: 'wp1-1', dst: 'sw1-5', mode: 'trunk' },   // fanout trunk
      { id: 'g', src: 'pc1-1', dst: 'sw2-7' },                  // fanout access
    ],
    helpers: { linkIsTrunk: l => l.mode === 'trunk' },
  });
  const res = buildTopoLines({ ...m, trunkFilter: 'trunk' });
  assert.ok(res.pairs.every(p => p.hasTrunk), 'restano solo le coppie che portano un trunk');
  assert.deepEqual(res.fanout.map(f => f.linkId), ['f']);
  assert.ok(res.hidden.access > 0, 'e va detto quante ne ha tolte');
  // nessun residuo del vecchio meccanismo di attenuazione
  assert.ok([...res.pairs, ...res.fanout].every(x => !('trunkDim' in x)));
});

test('«trunk + access»: non toglie niente e non attenua niente', () => {
  const res = buildTopoLines(baseModel({
    trunkFilter: 'all',
    links: [
      { id: 't', src: 'sw1-1', dst: 'sw2-1', mode: 'trunk' },
      { id: 'b', src: 'pc1-1', dst: 'wp1-1' },
      { id: 'g', src: 'pc1-1', dst: 'sw2-7' },
    ],
    helpers: { linkIsTrunk: l => l.mode === 'trunk' },
  }));
  assert.equal(res.hidden.trunk, 0);
  assert.equal(res.hidden.access, 0);
  assert.ok([...res.pairs, ...res.fanout].every(x => !('trunkDim' in x)));
});

// ---- «Endpoint»: UNA definizione sola --------------------------------------------
// Il renderer del tile (app-render-core.js) ne aveva una SUA — «endpoint = tipo
// senza pass-through» — che non coincideva con questa. Il telefono VoIP, che fa
// pass-through perche' regge il PC in cascata, spariva dalle LINEE ma restava a
// schermo come piastrella sospesa. Ora `isTopoEndpointType` e' esportata e la
// usano tutti e due; questi test la bloccano.

test('isTopoEndpointType: il VoIP e\' un endpoint anche se fa pass-through', () => {
  assert.equal(isTopoEndpointType(TYPES.voip), true,
    'ha un IP: e\' un terminale, non un pezzo di rame — il PC in cascata non lo rende un conduit');
});

test('isTopoEndpointType: i conduit puri NON sono endpoint (sono il confine della vista)', () => {
  assert.equal(isTopoEndpointType(TYPES.wallport), false);
});

test('isTopoEndpointType: i device floor con IP sono endpoint, strutturali e rack no', () => {
  assert.equal(isTopoEndpointType(TYPES.pc), true);
  assert.equal(isTopoEndpointType(TYPES.printer), true);
  assert.equal(isTopoEndpointType(TYPES.room), false, 'una stanza non e\' un endpoint');
  assert.equal(isTopoEndpointType(TYPES.switch), false, 'gli apparati in rack nemmeno');
  assert.equal(isTopoEndpointType(undefined), false, 'tipo ignoto: fail-closed, non si nasconde nulla');
});

test('il filtro ENDPOINT usa quella funzione e non una copia: il VoIP sparisce', () => {
  const res = buildTopoLines(baseModel({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1' },
      { id: 'wpV', type: 'wallport', x: 100, y: 100 },
      { id: 'tel', type: 'voip', x: 200, y: 100 },
      { id: 'pcV', type: 'pc', x: 300, y: 100 },
    ],
    links: [
      { id: 'e1', src: 'wpV-1', dst: 'tel-1' },
      { id: 'e2', src: 'tel-2', dst: 'pcV-1' },
    ],
    hideEndpoints: true,
  }));
  const tocca = id => res.pairs.some(p => p.nodeAId === id || p.nodeBId === id);
  assert.equal(tocca('tel'), false, 'nessuna linea deve restare attaccata al telefono');
  assert.equal(tocca('pcV'), false);
});

// ---- Purezza --------------------------------------------------------------------

test('buildTopoLines non muta il model (links/nodes/racks)', () => {
  const m = baseModel({
    links: [{ id: 'l1', src: 'sw1-1', dst: 'sw2-1', vlan: 10 }],
    vlanColors: { 10: '#00d4ff' },
  });
  const snapshot = JSON.stringify({ nodes: m.nodes, links: m.links, racks: m.racks });
  buildTopoLines(m);
  assert.equal(JSON.stringify({ nodes: m.nodes, links: m.links, racks: m.racks }), snapshot);
});

test('fanout: link wireless → descrittore wireless=true', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'lw', src: 'sw1-1', dst: 'pc1-1', wireless: true }],
  }));
  const f = res.fanout.find(x => x.linkId === 'lw');
  assert.ok(f, 'atteso un fanout per il link sw→pc');
  assert.equal(f.wireless, true);
});

test('fanout: link normale → wireless=false', () => {
  const res = buildTopoLines(baseModel({
    links: [{ id: 'ln', src: 'sw1-1', dst: 'pc1-1' }],
  }));
  const f = res.fanout.find(x => x.linkId === 'ln');
  assert.ok(f);
  assert.equal(f.wireless, false);
});

test('pair floor-floor: link wireless → pair.wireless=true', () => {
  const res = buildTopoLines(baseModel({
    nodes: [
      { id: 'pc9', type: 'pc', x: 100, y: 100 },
      { id: 'pr9', type: 'printer', x: 300, y: 100 },
    ],
    racks: [],
    links: [{ id: 'lwf', src: 'pc9-1', dst: 'pr9-1', wireless: true }],
  }));
  const p = res.pairs.find(x => x.kind === 'floor-floor' && x.wireless);
  assert.ok(p, 'attesa una coppia floor-floor wireless');
});

test('hideWireless: nasconde i fanout wireless, tiene i cablati', () => {
  const res = buildTopoLines(baseModel({
    links: [
      { id: 'lw', src: 'sw1-1', dst: 'pc1-1', wireless: true },   // fanout wireless
      { id: 'lc', src: 'sw1-2', dst: 'wp1-1' },                   // fanout cablato
    ],
    hideWireless: true,
  }));
  assert.ok(!res.fanout.some(f => f.wireless), 'i fanout wireless devono sparire');
  assert.ok(res.fanout.some(f => f.linkId === 'lc'), 'il fanout cablato resta');
});

// ---- Filtro TRUNK/ACCESS a tre stati ----------------------------------------
// Chi non passa SPARISCE: prima veniva solo attenuato (`trunkDim`), che e' un'altra
// cosa — una linea al 12% resta da leggere e da scavalcare col mouse.

function trunkModel(over = {}) {
  return baseModel({
    links: [
      { id: 'lt', src: 'sw1-1', dst: 'wp1-1', mode: 'trunk' },   // fanout trunk
      { id: 'la', src: 'sw1-2', dst: 'pc1-1' },                  // fanout access
    ],
    helpers: { linkIsTrunk: l => l.mode === 'trunk' },
    ...over,
  });
}

test('trunkFilter "all": trunk e access insieme, niente nascosto', () => {
  const res = buildTopoLines(trunkModel({ trunkFilter: 'all' }));
  assert.equal(res.fanout.length, 2);
  assert.equal(res.hidden.trunk, 0);
  assert.equal(res.hidden.access, 0);
});

test('trunkFilter "trunk": le access SPARISCONO (non attenuate) e si contano', () => {
  const res = buildTopoLines(trunkModel({ trunkFilter: 'trunk' }));
  assert.deepEqual(res.fanout.map(f => f.linkId), ['lt']);
  assert.equal(res.hidden.access, 1);
  assert.ok(res.fanout.every(f => !('trunkDim' in f)), 'trunkDim non deve piu\' esistere');
});

test('trunkFilter "access": il verso opposto — spariscono i trunk', () => {
  const res = buildTopoLines(trunkModel({ trunkFilter: 'access' }));
  assert.deepEqual(res.fanout.map(f => f.linkId), ['la']);
  assert.equal(res.hidden.trunk, 1);
});

test('trunkOnly=true resta accettato come sinonimo di "trunk"', () => {
  const res = buildTopoLines(trunkModel({ trunkOnly: true }));
  assert.deepEqual(res.fanout.map(f => f.linkId), ['lt']);
});

test('una coppia e\' un fascio: passa se contiene almeno una linea del tipo chiesto', () => {
  const base = {
    nodes: [
      { id: 'pcA', type: 'pc', x: 100, y: 100 },
      { id: 'prA', type: 'printer', x: 300, y: 100 },
    ],
    racks: [],
    links: [
      { id: 'm1', src: 'pcA-1', dst: 'prA-1', mode: 'trunk' },
      { id: 'm2', src: 'pcA-2', dst: 'prA-2' },              // stessa coppia, access
    ],
    helpers: { linkIsTrunk: l => l.mode === 'trunk' },
  };
  const misto = buildTopoLines(model({ ...base, trunkFilter: 'all' })).pairs[0];
  assert.equal(misto.hasTrunk, true);
  assert.equal(misto.hasAccess, true);
  // la coppia sopravvive a ENTRAMBI i filtri, perche' porta l'uno e l'altro
  assert.equal(buildTopoLines(model({ ...base, trunkFilter: 'trunk' })).pairs.length, 1);
  assert.equal(buildTopoLines(model({ ...base, trunkFilter: 'access' })).pairs.length, 1);
});

test('modo IGNOTO: nessun cavo documentato dietro → fuori da entrambi, contato a parte', () => {
  // topoData con un edge LLDP che non risolve a nessun link del progetto
  const m = model({
    nodes: [
      { id: 'pcU', type: 'pc', x: 100, y: 100 },
      { id: 'prU', type: 'printer', x: 300, y: 100 },
    ],
    racks: [], links: [],
    topoData: {
      nodes: [{ id: 't1', nodeId: 'pcU' }, { id: 't2', nodeId: 'prU' }],
      edges: [{ src: 't1', dst: 't2', protocol: 'LLDP' }],
    },
    helpers: { linkIsTrunk: l => l.mode === 'trunk' },
  });
  const tutto = buildTopoLines({ ...m, trunkFilter: 'all' });
  assert.equal(tutto.pairs.length, 1, 'senza filtro la coppia scoperta si vede');
  assert.equal(tutto.pairs[0].hasTrunk, false);
  assert.equal(tutto.pairs[0].hasAccess, false, 'non e\' access per esclusione');
  for (const f of ['trunk', 'access']) {
    const r = buildTopoLines({ ...m, trunkFilter: f });
    assert.equal(r.pairs.length, 0, `con filtro "${f}" una linea di modo ignoto non si afferma`);
    assert.equal(r.hidden.unknownMode, 1, 'e si conta a parte, non fra le access');
  }
});

test('i due filtri si compongono: mezzo e modo insieme', () => {
  const res = buildTopoLines(baseModel({
    links: [
      { id: 'x1', src: 'sw1-1', dst: 'wp1-1', mode: 'trunk' },
      { id: 'x2', src: 'sw1-2', dst: 'pc1-1' },
      { id: 'x3', src: 'sw1-3', dst: 'pc1-2', wireless: true, mode: 'trunk' },
    ],
    helpers: { linkIsTrunk: l => l.mode === 'trunk' },
    mediumFilter: 'wired', trunkFilter: 'trunk',
  }));
  assert.deepEqual(res.fanout.map(f => f.linkId), ['x1'], 'solo il trunk via cavo');
  assert.equal(res.hidden.wireless, 1);
  assert.equal(res.hidden.access, 1);
});

// ---- Filtro di mezzo a tre stati --------------------------------------------
// Il vecchio booleano `hideWireless` e' UNO dei tre stati: resta accettato perche'
// i chiamanti esistenti non devono cambiare per una funzionalita' che si aggiunge.

const mixed = () => ({
  links: [
    { id: 'lw', src: 'sw1-1', dst: 'pc1-1', wireless: true },   // fanout wireless
    { id: 'lc', src: 'sw1-2', dst: 'wp1-1' },                   // fanout cablato
  ],
});

test('mediumFilter "all": non toglie niente e non conta niente', () => {
  const res = buildTopoLines(baseModel({ ...mixed(), mediumFilter: 'all' }));
  assert.equal(res.fanout.filter(f => f.wireless).length, 1);
  assert.equal(res.fanout.filter(f => !f.wireless).length, 1);
  assert.equal(res.hidden.wireless, 0);
  assert.equal(res.hidden.wired, 0);
});

test('mediumFilter "wired": via le onde, resta il cavo', () => {
  const res = buildTopoLines(baseModel({ ...mixed(), mediumFilter: 'wired' }));
  assert.ok(!res.fanout.some(f => f.wireless), 'le onde devono sparire');
  assert.ok(res.fanout.some(f => f.linkId === 'lc'), 'il cavo resta');
  assert.equal(res.hidden.wireless, 1, 'e va DETTO quante ne ha tolte');
  assert.equal(res.hidden.wired, 0);
});

test('mediumFilter "wireless": il verso opposto — via il cavo, restano le onde', () => {
  const res = buildTopoLines(baseModel({ ...mixed(), mediumFilter: 'wireless' }));
  assert.ok(!res.fanout.some(f => !f.wireless), 'il cavo deve sparire');
  assert.ok(res.fanout.some(f => f.linkId === 'lw'), 'l\'onda resta');
  assert.equal(res.hidden.wired, 1);
  assert.equal(res.hidden.wireless, 0);
});

test('mediumFilter vale anche sulle coppie floor↔floor, non solo sul fan-out', () => {
  const base = {
    nodes: [
      { id: 'pc9', type: 'pc', x: 100, y: 100 },
      { id: 'pr9', type: 'printer', x: 300, y: 100 },
      { id: 'pc8', type: 'pc', x: 100, y: 300 },
      { id: 'pr8', type: 'printer', x: 300, y: 300 },
    ],
    racks: [],
    links: [
      { id: 'lwf', src: 'pc9-1', dst: 'pr9-1', wireless: true },
      { id: 'lcf', src: 'pc8-1', dst: 'pr8-1' },
    ],
  };
  const soloCavo = buildTopoLines(model({ ...base, mediumFilter: 'wired' }));
  assert.equal(soloCavo.pairs.length, 1);
  assert.equal(soloCavo.pairs[0].wireless, false);
  assert.equal(soloCavo.hidden.wireless, 1);

  const soloOnde = buildTopoLines(model({ ...base, mediumFilter: 'wireless' }));
  assert.equal(soloOnde.pairs.length, 1);
  assert.equal(soloOnde.pairs[0].wireless, true);
  assert.equal(soloOnde.hidden.wired, 1);
});

test('mediumFilter batte hideWireless quando ci sono entrambi (nuovo vince)', () => {
  const res = buildTopoLines(baseModel({ ...mixed(), hideWireless: true, mediumFilter: 'wireless' }));
  assert.ok(res.fanout.some(f => f.linkId === 'lw'), 'con mediumFilter=wireless l\'onda deve restare');
  assert.ok(!res.fanout.some(f => f.linkId === 'lc'));
});

test('hidden c\'e\' anche sui return anticipati (traccia fisica, endpoint nascosti)', () => {
  const conTraccia = buildTopoLines(baseModel({
    ...mixed(), mediumFilter: 'wired',
    physicalTrace: true, highPathIds: new Set(['lc']),
  }));
  assert.equal(conTraccia.hidden.wireless, 1);

  const senzaEndpoint = buildTopoLines(baseModel({
    ...mixed(), mediumFilter: 'wired', hideEndpoints: true,
  }));
  assert.equal(senzaEndpoint.hidden.wireless, 1);
});

// ---- Adiacenze SENZA porta ---------------------------------------------------
// «So che sono attaccati, non so su quale porta»: il protocollo nomina entrambi
// gli apparati ma il nome di porta non combacia con nessuna porta del documento.
// Prima non usciva niente e i due risultavano estranei; ora la linea c'è e dice
// `?`, invece di scegliere una porta a caso pur di disegnare qualcosa.

test('adiacenza senza porta: due rack piazzati → una linea, con ? al posto della porta', () => {
  const out = buildTopoLines(model({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'rA' },
      { id: 'sw2', type: 'switch', rackId: 'rB' },
    ],
    racks: [{ id: 'rA', name: 'A', x: 10, y: 10 }, { id: 'rB', name: 'B', x: 200, y: 10 }],
    adjacencies: [{ srcNodeId: 'sw1', dstNodeId: 'sw2', protocol: 'LLDP', srcPort: 'port97' }],
  }));
  assert.equal(out.pairs.length, 1);
  const p = out.pairs[0];
  assert.equal(p.confirmed, false, 'nessun cavo fra i due: la coppia NON è confermata');
  assert.equal(p.edges.length, 1);
  assert.equal(p.edges[0].dstPort, '?', 'la porta che non si sa si dichiara, non si inventa');
  assert.equal(p.edges[0].portless, true);
});

test('adiacenza senza porta: il cavo VERO prevale — la coppia risulta confermata', () => {
  const out = buildTopoLines(model({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'rA' },
      { id: 'sw2', type: 'switch', rackId: 'rB' },
    ],
    racks: [{ id: 'rA', name: 'A', x: 10, y: 10 }, { id: 'rB', name: 'B', x: 200, y: 10 }],
    links: [{ id: 'L1', src: 'sw1-1', dst: 'sw2-1' }],
    adjacencies: [{ srcNodeId: 'sw1', dstNodeId: 'sw2', protocol: 'LLDP' }],
  }));
  assert.equal(out.pairs.length, 1);
  assert.equal(out.pairs[0].confirmed, true, 'il porta-a-porta sostituisce l\'approssimazione');
});

test('adiacenza senza porta: due apparati a pavimento → linea floor↔floor', () => {
  const out = buildTopoLines(model({
    nodes: [
      { id: 'pc1', type: 'pc', x: 10, y: 10, name: 'PC1' },
      { id: 'prn', type: 'printer', x: 90, y: 10, name: 'Stampante' },
    ],
    adjacencies: [{ srcNodeId: 'pc1', dstNodeId: 'prn', protocol: 'CDP' }],
  }));
  assert.equal(out.pairs.length, 1);
  assert.equal(out.pairs[0].protocol, 'CDP');
});

test('adiacenza senza porta: un apparato non piazzato → nessuna linea inventata', () => {
  const out = buildTopoLines(model({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'rA' },
      { id: 'sw2', type: 'switch', rackId: 'rB' },
    ],
    racks: [{ id: 'rA', name: 'A', x: 10, y: 10 }, { id: 'rB', name: 'B' }],  // rB senza x
    adjacencies: [{ srcNodeId: 'sw1', dstNodeId: 'sw2', protocol: 'LLDP' }],
  }));
  assert.equal(out.pairs.length, 0, 'senza posizione non c\'è dove disegnarla');
});

test('adiacenza senza porta: riferimenti a nodi inesistenti o a sé stesso → ignorati', () => {
  const out = buildTopoLines(model({
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'rA' }],
    racks: [{ id: 'rA', name: 'A', x: 10, y: 10 }],
    adjacencies: [
      { srcNodeId: 'sw1', dstNodeId: 'sw1' },          // sé stesso
      { srcNodeId: 'sw1', dstNodeId: 'non-esiste' },   // nodo assente
      { srcNodeId: '', dstNodeId: 'sw1' },             // id vuoto
      null,
    ],
  }));
  assert.equal(out.pairs.length, 0);
});

test('adiacenza senza porta: senza `adjacencies` il risultato è identico a prima', () => {
  const base = model({
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'rA' }, { id: 'sw2', type: 'switch', rackId: 'rB' }],
    racks: [{ id: 'rA', name: 'A', x: 10, y: 10 }, { id: 'rB', name: 'B', x: 200, y: 10 }],
    links: [{ id: 'L1', src: 'sw1-1', dst: 'sw2-1' }],
  });
  const senza = buildTopoLines(base);
  const conVuoto = buildTopoLines(Object.assign({}, base, { adjacencies: [] }));
  assert.equal(JSON.stringify(senza.pairs.map(p => p.edges)), JSON.stringify(conVuoto.pairs.map(p => p.edges)));
});
