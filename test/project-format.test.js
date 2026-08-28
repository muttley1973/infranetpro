'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROJECT_STATE_SCHEMA_VERSION,
  PORTABLE_EXPORT_FORMAT,
  createPortableProjectExport,
  unwrapProjectState,
  isProjectState,
  pruneProjectStateCaches,
  dropObsoleteFields,
  stripDerivedVlan,
} = require('../lib/project-format.js');

test('portable export redige credenziali e conserva il modello del progetto', () => {
  const state = {
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    racks: [{ id: 'r1' }],
    nodes: [{
      id: 'sw1',
      integration: { host: '192.0.2.1', community: 'secret', v3authPass: 'auth', v3privPass: 'priv' },
      backup: { ref: 'https://user:pass@example.test/config' },
      vms: [{ integration: { community: 'vm-secret' }, snmp: { v3privPass: 'vm-priv' } }],
    }],
    links: [],
  };
  const exported = createPortableProjectExport(state, { projectId: 7, projectName: 'Lab' });
  assert.equal(exported.format, PORTABLE_EXPORT_FORMAT);
  assert.equal(exported.schemaVersion, PROJECT_STATE_SCHEMA_VERSION);
  assert.equal(exported.projectId, '7');
  assert.equal(exported.projectName, 'Lab');
  assert.equal(exported.state.nodes[0].integration.community, '');
  assert.equal(exported.state.nodes[0].integration.v3authPass, '');
  assert.equal(exported.state.nodes[0].backup.ref, 'https://example.test/config');
  assert.equal(exported.state.nodes[0].vms[0].integration.community, '');
  assert.equal(exported.state.nodes[0].vms[0].snmp.v3privPass, '');
  assert.equal(state.nodes[0].integration.community, 'secret');
});

test('⚠️ l\'export porta il documento, non le misure: la presenza resta a casa', () => {
  const state = {
    racks: [], links: [],
    nodes: [{ id: 'pc7', name: 'PC contabilità', proof: { status: 'absent', absentEvidence: true } }],
  };
  state.discoveryHistory = { observations: [{ mac: 'aa:bb', ip: '10.0.0.1', count: 4 }] };
  const exported = createPortableProjectExport(state, {});
  assert.equal('proof' in exported.state.nodes[0], false, 'chi apre altrove non eredita i nostri rossi');
  assert.equal('discoveryHistory' in exported.state, false, 'né gli avvistamenti della nostra rete');
  assert.equal(exported.state.nodes[0].name, 'PC contabilità', 'il dichiarato parte tutto');
  // Si lavora su un clone: lo stato vivo non deve perdere le sue misure.
  assert.equal(state.nodes[0].proof.status, 'absent');
  assert.equal(state.discoveryHistory.observations.length, 1);
});

test('unwrapProjectState accetta sia export portatile sia stato legacy', () => {
  const state = { nodes: [], racks: [], links: [] };
  assert.deepEqual(unwrapProjectState({ format: PORTABLE_EXPORT_FORMAT, state }), state);
  assert.equal(unwrapProjectState(state), state);
  assert.equal(isProjectState(state), true);
  assert.equal(isProjectState({ nodes: [] }), false);
});

test('pruneProjectStateCaches rimuove solo cache topologia orfane', () => {
  const state = {
    nodes: [{ id: 'sw1' }],
    topoCache: { sw1: { ts: 1 }, removed: { ts: 2 } },
    discoveryHistory: { observations: [{ switchId: 'removed' }] },
  };
  pruneProjectStateCaches(state);
  assert.deepEqual(Object.keys(state.topoCache), ['sw1']);
  assert.equal(state.discoveryHistory.observations.length, 1);
});

test('dropObsoleteFields toglie i campi che non legge nessuno e NON tocca il resto', () => {
  const state = {
    nodes: [
      { id: 'sw1', name: 'Core', lastDiscoveryMatch: 'mac', identitySource: 'snmp' },
      { id: 'sw2', name: 'Access' },
    ],
    ports: {
      'sw1-1': { ifName: 'Gi1/0/1', physicalKind: 'copper', mediaOptions: ['copper', 'fiber'] },
      'sw1-2': { ifName: 'Gi1/0/2' },
    },
  };
  // ⚠️ Un campo di apparato vive sul nodo E in node.spec: vanno puliti entrambi.
  state.nodes.push({ id: 'pdu1', name: 'PDU', pduOrientation: 'vertical-0u',
    spec: { pduOrientation: 'vertical-0u', pduOutletCount: 8 } });
  const dropped = dropObsoleteFields(state);
  assert.equal(dropped, 4, 'un campo per nodo, uno per porta, e i due della PDU (nodo + spec)');
  assert.equal('pduOrientation' in state.nodes[2], false);
  assert.equal('pduOrientation' in state.nodes[2].spec, false, 'anche dentro spec');
  assert.equal(state.nodes[2].spec.pduOutletCount, 8, 'il resto dello spec non si tocca');
  assert.equal('lastDiscoveryMatch' in state.nodes[0], false);
  assert.equal('physicalKind' in state.ports['sw1-1'], false);
  // Il documento resta intatto: si tolgono i morti, non i vivi.
  assert.equal(state.nodes[0].identitySource, 'snmp');
  assert.equal(state.nodes[0].name, 'Core');
  assert.deepEqual(state.ports['sw1-1'].mediaOptions, ['copper', 'fiber']);
  assert.equal(state.ports['sw1-2'].ifName, 'Gi1/0/2');
  // Idempotente: un progetto gia' ripulito non cambia piu'.
  assert.equal(dropObsoleteFields(state), 0);
});

test('dropObsoleteFields non esplode su stati malformati', () => {
  assert.equal(dropObsoleteFields(null), 0);
  assert.equal(dropObsoleteFields({}), 0);
  assert.equal(dropObsoleteFields({ nodes: [null, 'x'], ports: { a: null, b: 3 } }), 0);
  assert.equal(dropObsoleteFields({ ports: [] }), 0);
});

// ============================================================
// La propagazione VLAN è DERIVATA: nel documento non ci va.
// ============================================================
test('⚠️ stripDerivedVlan toglie i tre campi e SOLO i record che restano vuoti', () => {
  const state = { ports: {
    // Porta vera: perde il derivato, resta tutto il resto.
    'sw1-1': { ifName: 'Gi1/0/1', vlanOvr: 20, vlanProp: 20, isTrunkProp: true, trunkProp: [10, 20] },
    // Record FANTASMA: il render l'ha creato con dentro solo la propagazione.
    'tel4-1': { vlanProp: 20 },
    // Porta dichiarata senza derivati: non si tocca.
    'sw1-2': { ifName: 'Gi1/0/2' },
    // Record già vuoto ma NON creato da noi: si lascia stare.
    'pp1-9': {},
  } };
  assert.equal(stripDerivedVlan(state), 2, 'due record avevano campi derivati');
  assert.deepEqual(state.ports['sw1-1'], { ifName: 'Gi1/0/1', vlanOvr: 20 }, 'il dichiarato resta intatto');
  assert.equal('tel4-1' in state.ports, false, 'il fantasma sparisce del tutto');
  assert.deepEqual(state.ports['sw1-2'], { ifName: 'Gi1/0/2' });
  assert.ok('pp1-9' in state.ports, 'un record vuoto che non abbiamo svuotato noi resta');
  assert.equal(stripDerivedVlan(state), 0, 'idempotente');
});

test('stripDerivedVlan non esplode su stati malformati', () => {
  assert.equal(stripDerivedVlan(null), 0);
  assert.equal(stripDerivedVlan({}), 0);
  assert.equal(stripDerivedVlan({ ports: [] }), 0);
  assert.equal(stripDerivedVlan({ ports: { a: null, b: 3 } }), 0);
});

test('⚠️ il Salva ripulisce i derivati PRIMA di scrivere, e l\'export non li porta', () => {
  const fs = require('node:fs'), path = require('node:path');
  const R = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'projects.js'), 'utf8');
  assert.match(R, /stripDerivedVlan\(state\);/);
  assert.ok(R.indexOf('stripDerivedVlan(state);') < R.indexOf('saveProject(id, name, state, p.created_at, now)'),
    'prima si ripulisce, poi si scrive');
  assert.match(R, /stripDerivedVlan\(src\.state\);/, 'anche la copia');

  const exported = createPortableProjectExport({ racks: [], links: [], nodes: [],
    ports: { 'sw1-1': { ifName: 'Gi1/0/1', vlanProp: 20 }, 'tel4-1': { vlanProp: 20 } } }, {});
  assert.deepEqual(exported.state.ports['sw1-1'], { ifName: 'Gi1/0/1' });
  assert.equal('tel4-1' in exported.state.ports, false);
});

// ============================================================================
// CAMBIO 3B — l'export si costruisce dalla CLASSIFICA, non a memoria
// ============================================================================
// Prima era una blocklist: un campo misurato nuovo usciva finché qualcuno non si
// ricordava di aggiungerlo alla lista (è già successo con `modelMatch`). Il
// censimento del 28/08/2026 su 13 progetti veri ne ha contati 41 che uscivano
// senza doverlo — fra cui i lease DHCP, cioè chi c'era su quella rete.
const SCHEMA = require('../lib/project-schema.js');

// Un progetto con un po' di tutto: dichiarato, misurato, derivato, privato.
function statoMisto() {
  return {
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    nativeVlan: 1, racks: [{ id: 'r1' }],
    // misure di stato
    lastVerify: { at: '2026-08-28T00:00:00.000Z' }, lastSnmpSyncAt: '2026-08-28T00:00:00.000Z',
    lastSnmpSyncResult: { ok: 3 }, lastAutoLinkResult: { added: 2 },
    dhcpSources: [{ server: '10.0.0.1', leases: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.55', host: 'PC-ROSSI' }] }],
    topoCache: { sw1: { x: 1 } },
    nodes: [{
      id: 'sw1', name: 'SW-01', type: 'switch', model: 'GS1900-24', serialNumber: 'S123',
      srcLoc: 42, spec: { swPoeBudgetW: 180 },
      // misure
      snmpStatus: 'ok', snmpLastOk: '2026-08-28T00:00:00.000Z', firstSeen: '2026-01-01',
      lastSeen: '2026-08-28', currentIp: '10.0.0.2', previousIps: ['10.0.0.9'],
      modelMatch: { key: 'zyxel:gs1900-24', confidence: 'exact' },
      netbiosName: 'SW01', smbShares: ['pubblica'], vendorHint: 'Zyxel',
      identitySource: 'snmp', identityConfidence: 0.9, firmwareVer: '2.70',
    }],
    links: [{ id: 'c1', src: 'sw1-1', dst: 'srv-1', autoLinked: true, confidence: 0.97, protocol: 'LLDP' }],
    ports: {
      // porta con dichiarato + misurato: resta, ripulita
      'sw1-1': { desc: 'Uplink', vlan: 10, mode: 'trunk', alias: 'to-core', operUp: true, snmpPoe: 15 },
      // porta di SOLE misure: era una fotografia, non un documento
      'sw1-9': { alias: 'ifAlias', operUp: false, downStreak: 3, snmpMedium: 'copper' },
    },
  };
}

test('⭐ CAMBIO 3B: nessun campo classificato `measure` sopravvive all\'export', () => {
  const exported = createPortableProjectExport(statoMisto(), {});
  const s = exported.state;
  for (const k of SCHEMA.fieldsOfClass('state', 'measure')) {
    assert.equal(k in s, false, `state.${k} è una misura e non doveva uscire`);
  }
  for (const k of SCHEMA.fieldsOfClass('node', 'measure')) {
    assert.equal(k in s.nodes[0], false, `node.${k} è una misura e non doveva uscire`);
  }
  for (const k of SCHEMA.fieldsOfClass('port', 'measure')) {
    assert.equal(k in (s.ports['sw1-1'] || {}), false, `port.${k} è una misura e non doveva uscire`);
  }
});

test('⭐ i derivati e il privato se ne vanno con la stessa regola', () => {
  const s = createPortableProjectExport(statoMisto(), {}).state;
  assert.equal('topoCache' in s, false, 'una cache si ricalcola, non si spedisce');
  const st = Object.assign(statoMisto(), { auditLog: [{ user: 'mario', at: 'x' }] });
  assert.equal('auditLog' in createPortableProjectExport(st, {}).state, false,
    'il giornale porta i nomi di chi ha lavorato: resta a casa');
});

test('⚠️ i lease DHCP non escono più: sono chi c\'era su QUELLA rete', () => {
  const s = createPortableProjectExport(statoMisto(), {}).state;
  assert.equal('dhcpSources' in s, false);
  // e non devono nemmeno sopravvivere nascosti da qualche parte nel JSON
  assert.equal(JSON.stringify(s).includes('PC-ROSSI'), false, 'nessun host di un lease nell\'export');
  assert.equal(JSON.stringify(s).includes('aa:bb:cc:dd:ee:ff'), false, 'né il suo MAC');
});

test('⭐ il DICHIARATO parte tutto — è il punto: non si butta via il lavoro di nessuno', () => {
  const s = createPortableProjectExport(statoMisto(), {}).state;
  assert.equal(s.nativeVlan, 1);
  assert.equal(s.racks.length, 1);
  const n = s.nodes[0];
  // ⭐ i campi a doppia natura RESTANO: possono venire da una mano, e sbagliare
  //    verso `measure` cancellerebbe il lavoro di qualcuno.
  assert.equal(n.name, 'SW-01');
  assert.equal(n.model, 'GS1900-24');
  assert.equal(n.serialNumber, 'S123');
  assert.equal(n.srcLoc, 42, 'il riferimento d\'origine deve sopravvivere');
  assert.equal(n.spec.swPoeBudgetW, 180);
  const p = s.ports['sw1-1'];
  assert.equal(p.desc, 'Uplink');
  assert.equal(p.vlan, 10);
  assert.equal(p.mode, 'trunk');
});

test('⭐ un cavo dedotto resta DEDOTTO nell\'export (mai promosso a dichiarato)', () => {
  const l = createPortableProjectExport(statoMisto(), {}).state.links[0];
  assert.equal(l.autoLinked, true, 'togliere autoLinked trasformerebbe una deduzione in un\'affermazione');
  assert.equal(l.confidence, 0.97);
  assert.equal(l.protocol, 'LLDP');
});

test('una porta fatta di SOLE misure non lascia un guscio vuoto', () => {
  const s = createPortableProjectExport(statoMisto(), {}).state;
  assert.equal('sw1-9' in s.ports, false, 'era una fotografia, non un documento');
  assert.equal('sw1-1' in s.ports, true, 'quella con del dichiarato resta');
});

test('⚠️ un campo NON classificato sopravvive: il default sta dalla parte dei dati', () => {
  const st = statoMisto();
  st.nodes[0].campoDelFuturo = 'non buttarmi';
  st.campoDiStatoIgnoto = 42;
  const s = createPortableProjectExport(st, {}).state;
  assert.equal(s.nodes[0].campoDelFuturo, 'non buttarmi');
  assert.equal(s.campoDiStatoIgnoto, 42);
});

test('l\'export non muta lo stato vivo, nemmeno con la classifica accesa', () => {
  const st = statoMisto();
  const prima = JSON.stringify(st);
  createPortableProjectExport(st, {});
  assert.equal(JSON.stringify(st), prima);
});
