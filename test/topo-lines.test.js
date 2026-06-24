// Test per la costruzione pura della lista linee topologia (lib/topo-lines.js).
// Hardening rendering: il "COSA disegnare" e' ora testabile senza DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTopoLines } = require('../lib/topo-lines.js');

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

// ---- Fanout: enfasi/interattivita' per rack corrente ----------------------------

test('fanout: rack corrente emphasized+interactive, gli altri attenuati e non interattivi', () => {
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
  assert.equal(fa.interactive, true);
  assert.equal(fa.opacity, 0.78);
  assert.equal(fb.emphasized, false);
  assert.equal(fb.interactive, false);   // niente hit → non blocca il drag dei rack
  assert.equal(fb.opacity, 0.38);
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

test('trunkOnly: attenua (trunkDim) le linee non-trunk, mai quelle trunk', () => {
  const res = buildTopoLines(baseModel({
    trunkOnly: true,
    links: [
      { id: 't', src: 'sw1-1', dst: 'sw2-1', mode: 'trunk' },   // pair trunk
      { id: 'b', src: 'pc1-1', dst: 'wp1-1' },                  // pair access
      { id: 'f', src: 'wp1-1', dst: 'sw1-5', mode: 'trunk' },   // fanout trunk
      { id: 'g', src: 'pc1-1', dst: 'sw2-7' },                  // fanout access
    ],
  }));
  assert.equal(res.pairs.find(p => p.kind === 'rack-rack').trunkDim, false);
  assert.equal(res.pairs.find(p => p.kind === 'floor-floor').trunkDim, true);
  assert.equal(res.fanout.find(f => f.linkId === 'f').trunkDim, false);
  assert.equal(res.fanout.find(f => f.linkId === 'g').trunkDim, true);
});

test('trunkOnly off: nessuna linea attenuata (trunkDim sempre false)', () => {
  const res = buildTopoLines(baseModel({
    links: [
      { id: 't', src: 'sw1-1', dst: 'sw2-1', mode: 'trunk' },
      { id: 'b', src: 'pc1-1', dst: 'wp1-1' },
      { id: 'g', src: 'pc1-1', dst: 'sw2-7' },
    ],
  }));
  assert.ok(res.pairs.every(p => p.trunkDim === false));
  assert.ok(res.fanout.every(f => f.trunkDim === false));
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
