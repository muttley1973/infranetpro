'use strict';
// ============================================================
//  test/subbar-stats.test.js — lib/subbar-stats.js (statistiche sotto-header).
//
//  Verifica che i tre numeri (documentazione %, device totali, salute SNMP)
//  escano SOLO dai campi reali del nodo, con le stesse definizioni del resto
//  dell'app, senza stime: strutturali esclusi, indirizzabili/withIp, "ha SNMP"
//  (driver snmp* + host|ip), snmpStatus==='ok', e gli stati di salute.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { computeSubbarStats, computeTopoHiddenCables, _hasSnmp, _isAddressable } = require('../lib/subbar-stats.js');

// Mini-catalogo TYPES sufficiente ai test. DEVE rispecchiare src/app-types.js:
// sugli attivi (switch/router/…) il flag `hasIP` NON c'e', l'indirizzo e'
// implicito in `isActive`. Questa fixture prima scriveva `switch:{hasIP:true}` —
// un catalogo che non esiste — e per questo i test passavano mentre in produzione
// l'infrastruttura restava fuori dal conteggio degli indirizzabili.
const TYPES = {
  switch: { isActive: true, isRack: true },   // attivo: niente hasIP, IP implicito
  router: { isActive: true, isRack: true },
  pc:     { hasIP: true, isFloor: true },
  ups:    { hasIP: true, isPassive: true, isRack: true },   // passivo MA indirizzabile
  wallport:  { isPassive: true },          // niente hasIP -> non indirizzabile
  patchpanel:{ isPassive: true },
  room:   { isStructural: true },          // strutturale -> non e' un device
};

test('input vuoto/assurdo -> tutto a zero, mai throw', () => {
  for (const bad of [undefined, null, 42, {}, 'x']) {
    const s = computeSubbarStats(bad, TYPES);
    assert.deepEqual(
      { d: s.devices, a: s.addressable, w: s.withIp, doc: s.docPct, health: s.snmpHealth },
      { d: 0, a: 0, w: 0, doc: null, health: 'none' }
    );
  }
});

test('gli elementi strutturali (stanze) non contano come device', () => {
  const s = computeSubbarStats([{ type: 'room' }, { type: 'room' }, { type: 'pc', ip: '10.0.0.5' }], TYPES);
  assert.equal(s.devices, 1, 'solo il PC e\' un device');
  assert.equal(s.addressable, 1);
  assert.equal(s.withIp, 1);
});

test('documentazione % = withIp / indirizzabili (passivi esclusi dal denominatore)', () => {
  const nodes = [
    { type: 'switch', ip: '10.0.0.1' },   // indirizzabile + IP
    { type: 'pc',     ip: '10.0.0.2' },   // indirizzabile + IP
    { type: 'pc' },                       // indirizzabile SENZA IP
    { type: 'ups' },                      // indirizzabile SENZA IP
    { type: 'wallport' },                 // passivo: NON indirizzabile, fuori dal calcolo
    { type: 'patchpanel' },               // passivo: idem
  ];
  const s = computeSubbarStats(nodes, TYPES);
  assert.equal(s.devices, 6, 'tutti e 6 sono device (nessuno strutturale)');
  assert.equal(s.addressable, 4, 'switch+pc+pc+ups');
  assert.equal(s.withIp, 2);
  assert.equal(s.docPct, 50, '2/4 = 50%');
  assert.equal(s.passive, 2, 'presa a muro + patch panel contati a parte (per il tooltip «di cui N passivi»)');
});

test('REGRESSIONE: gli apparati ATTIVI sono indirizzabili anche senza il flag hasIP', () => {
  // Nel catalogo reale switch/router/firewall/hypervisor/WLC NON hanno `hasIP`:
  // l'indirizzo e' implicito in `isActive`. Contando il solo `hasIP`, su un
  // progetto vero (Rete+Lab) la barra dichiarava «19/19 · 100%» lasciando fuori
  // 12 apparati — una percentuale giusta per caso, su un denominatore sbagliato.
  assert.equal(_isAddressable({ isActive: true }), true, 'attivo -> indirizzabile');
  assert.equal(_isAddressable({ hasIP: true }), true, 'endpoint con hasIP -> indirizzabile');
  assert.equal(_isAddressable({ isPassive: true }), false, 'passivo senza IP -> no');
  assert.equal(_isAddressable(undefined), false, 'tipo sconosciuto -> no, mai throw');

  const nodes = [
    { type: 'switch', ip: '10.0.0.1' },
    { type: 'router' },                    // attivo SENZA IP: e' una lacuna, va contata
    { type: 'pc', ip: '10.0.0.2' },
    { type: 'wallport' },
  ];
  const s = computeSubbarStats(nodes, TYPES);
  assert.equal(s.addressable, 3, 'switch + router + pc (la presa a muro no)');
  assert.equal(s.withIp, 2);
  assert.equal(s.docPct, 67, '2/3 — il router senza IP abbassa la percentuale, come deve');
});

test('nessun device indirizzabile -> docPct null (niente 0% fuorviante)', () => {
  const s = computeSubbarStats([{ type: 'wallport' }, { type: 'patchpanel' }], TYPES);
  assert.equal(s.addressable, 0);
  assert.equal(s.docPct, null);
});

test('"ha SNMP" = driver snmp* + host|ip; altrimenti non conta', () => {
  assert.equal(_hasSnmp({ integration: { driver: 'snmp-v2c', host: '10.0.0.1' } }), true);
  assert.equal(_hasSnmp({ integration: { driver: 'snmp-v3' }, ip: '10.0.0.2' }), true, 'ip come fallback host');
  assert.equal(_hasSnmp({ integration: { driver: 'snmp-v2c' } }), false, 'niente host/ip -> no');
  assert.equal(_hasSnmp({ integration: { driver: 'http' }, ip: '10.0.0.3' }), false, 'driver non snmp -> no');
  assert.equal(_hasSnmp({ ip: '10.0.0.4' }), false, 'nessuna integrazione -> no');
});

test('salute SNMP: none / ok / warn / err in base ai responder', () => {
  const snmp = (driver, status) => ({ type: 'switch', integration: { driver, host: '10.0.0.1' }, snmpStatus: status });

  // nessun device SNMP configurato
  assert.equal(computeSubbarStats([{ type: 'pc', ip: '1.1.1.1' }], TYPES).snmpHealth, 'none');

  // tutti ok
  let s = computeSubbarStats([snmp('snmp-v2c', 'ok'), snmp('snmp-v2c', 'ok')], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpHealth], [2, 2, 'ok']);

  // misto (uno su, uno giu') -> warn
  s = computeSubbarStats([snmp('snmp-v2c', 'ok'), snmp('snmp-v2c', 'err')], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpDown, s.snmpHealth], [2, 1, 1, 'warn']);

  // nessuno su + almeno un guasto REALE -> err (rosso)
  s = computeSubbarStats([snmp('snmp-v2c', 'err'), snmp('snmp-v2c', 'err')], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpDown, s.snmpHealth], [2, 0, 2, 'err']);

  // configurati ma MAI sondati (snmpStatus assente) -> warn (ambra), NON rosso:
  // "non ancora verificato" non e' "guasto" (niente rosso a sproposito).
  s = computeSubbarStats([snmp('snmp-v2c', undefined), snmp('snmp-v2c', undefined)], TYPES);
  assert.deepEqual([s.snmpTotal, s.snmpOk, s.snmpDown, s.snmpHealth], [2, 0, 0, 'warn']);
});

test('catalogo TYPES assente -> difensivo (nessun crash, niente indirizzabili)', () => {
  const s = computeSubbarStats([{ type: 'pc', ip: '10.0.0.9' }], undefined);
  assert.equal(s.devices, 1);
  assert.equal(s.addressable, 0, 'senza TYPES non sappiamo chi e\' indirizzabile');
  assert.equal(s.docPct, null);
});

// ── computeTopoHiddenCables ─────────────────────────────────────────────────
// Cavi che la Topologia non mostra perche' il rack non e' sulla planimetria.
const NODES2 = [
  { id: 'sw1', type: 'switch', rackId: 'ra' },
  { id: 'sw2', type: 'switch', rackId: 'rb' },
  { id: 'sw3', type: 'switch', rackId: 'ra' },
  { id: 'pc1', type: 'pc' },
  { id: 'pc2', type: 'pc' },
];
const rackPlaced   = [{ id: 'ra', name: 'Rack A', x: 100, y: 50 }, { id: 'rb', name: 'Rack B', x: 400, y: 50 }];
const rackUnplaced = [{ id: 'ra', name: 'Rack A' },                { id: 'rb', name: 'Rack B', x: 400, y: 50 }];

test('cross-rack con ENTRAMBI i rack piazzati -> nessun cavo nascosto (null)', () => {
  const links = [{ src: 'sw1-1', dst: 'sw2-1' }];
  assert.equal(computeTopoHiddenCables(NODES2, links, rackPlaced, TYPES), null);
});

test('cross-rack con UN rack non piazzato -> 1 nascosto, nomina + id del rack da piazzare', () => {
  const links = [{ src: 'sw1-1', dst: 'sw2-1' }];   // sw1 in ra (NON piazzato)
  const r = computeTopoHiddenCables(NODES2, links, rackUnplaced, TYPES);
  assert.equal(r.hidden, 1);
  assert.deepEqual(r.racks, ['Rack A']);
  assert.deepEqual(r.rackIds, ['ra'], 'espone gli ID per il click "piazza"');
});

test('intra-rack con rack PIAZZATO -> mostrato come badge, NON nascosto (null)', () => {
  const links = [{ src: 'sw1-1', dst: 'sw3-1' }];   // stesso rack ra, piazzato
  assert.equal(computeTopoHiddenCables(NODES2, links, rackPlaced, TYPES), null);
});

test('intra-rack con rack NON piazzato -> nascosto (niente linea ne\' badge)', () => {
  const links = [{ src: 'sw1-1', dst: 'sw3-1' }];   // stesso rack ra, NON piazzato
  const r = computeTopoHiddenCables(NODES2, links, rackUnplaced, TYPES);
  assert.equal(r.hidden, 1);
  assert.deepEqual(r.racks, ['Rack A']);
});

test('cavi floor↔floor e misti floor↔rack non sono mai "nascosti dal rack"', () => {
  const links = [
    { src: 'pc1-1', dst: 'pc2-1' },   // floor↔floor
    { src: 'pc1-1', dst: 'sw1-1' },   // misto (pc floor + sw rack non piazzato)
  ];
  assert.equal(computeTopoHiddenCables(NODES2, links, rackUnplaced, TYPES), null);
});

test('input vuoto/assurdo -> null, mai throw', () => {
  for (const bad of [undefined, null, 42, 'x']) {
    assert.equal(computeTopoHiddenCables(bad, bad, bad, TYPES), null);
  }
  assert.equal(computeTopoHiddenCables(NODES2, [], rackPlaced, TYPES), null);
});
