'use strict';
// La ricerca globale (campo in testata) deve trovare ciò che il documento SA.
//
// Prima cercava solo nome/host/marca/modello/IP/MAC/utente/note dell'apparato e, per le porte, un riepilogo
// «nome apparato · id · stato · numero VLAN · velocità». Non trovava:
//   · la DESCRIZIONE della porta — dove, per convenzione del prodotto, sta la PRESA («PP1-14 | 203»);
//   · il nome dell'interfaccia (`Gi1/0/5`) né l'alias letto dall'apparato;
//   · la MATRICOLA, dichiarata o letta via SNMP;
//   · il NOME di una VLAN (si poteva cercare `vlan:20`, non «Ospiti»);
//   · l'IP di una porta (un router ne ha uno per interfaccia) né l'IPv6 dell'apparato.
// Una ricerca che non trova la presa scritta nel documento costringe a scorrere a mano ciò che il documento
// già dice: è il motivo per cui si scrive la presa.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('carico l\'app (ricerca globale)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Costruisce lo stato e interroga: ritorna [{kind,id,title,meta}] per la query.
function cerca(query, build) {
  return JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    state.nodes.length = 0; state.links.length = 0; state.ports = {}; state.vlanNames = {};
    (${build.toString()})(state);
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    return JSON.stringify(buildSearchResults(${JSON.stringify(query)}));
  })()`));
}

const ids = (res, kind) => res.filter(r => r.kind === kind).map(r => r.id).sort();

test('la descrizione della porta (la PRESA) si trova, per intero e a pezzi, senza badare alle maiuscole', () => {
  const build = (s) => {
    s.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-CORE', x: 0, y: 0, w: 60, h: 40, ports: 8 });
    s.ports['sw1-3'] = { desc: 'PP1-14 | 203' };
  };
  for (const q of ['203', 'pp1-14', 'PP1-14 | 203', '| 203']) {
    const res = cerca(q, build);
    assert.deepEqual(ids(res, 'port'), ['sw1-3'], 'query «' + q + '»');
  }
  const r = cerca('203', build)[0];
  assert.match(r.meta, /PP1-14 \| 203/, 'il risultato mostra la presa che ha trovato');
});

test('una descrizione che non c\'è non fa trovare niente: la ricerca non inventa', () => {
  const build = (s) => { s.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-CORE', x: 0, y: 0, w: 60, h: 40, ports: 8 }); s.ports['sw1-3'] = { desc: 'PP1-14 | 203' }; };
  assert.deepEqual(cerca('204', build), []);
});

test('il nome dell\'interfaccia e l\'alias letto dall\'apparato si trovano', () => {
  const build = (s) => {
    s.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-CORE', x: 0, y: 0, w: 60, h: 40, ports: 8 });
    s.ports['sw1-5'] = { ifName: 'Gi1/0/5', alias: 'uplink-verso-edge' };
  };
  assert.deepEqual(ids(cerca('gi1/0/5', build), 'port'), ['sw1-5']);
  assert.deepEqual(ids(cerca('verso-edge', build), 'port'), ['sw1-5']);
});

test('la matricola si trova, dichiarata e letta', () => {
  const build = (s) => {
    s.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-CORE', x: 0, y: 0, w: 60, h: 40, ports: 2, serialNumber: 'FOC1234ABCD' });
    s.nodes.push({ id: 'sw2', type: 'switch', name: 'SW-EDGE', x: 0, y: 0, w: 60, h: 40, ports: 2,
                   integration: { inventory: { serialNumber: 'MEAS99887766' } } });
  };
  assert.deepEqual(ids(cerca('foc1234', build), 'device'), ['sw1'], 'dichiarata');
  assert.deepEqual(ids(cerca('meas9988', build), 'device'), ['sw2'], 'letta via SNMP');
  assert.deepEqual(ids(cerca('zzz00000', build), 'device'), []);
});

test('il NOME di una VLAN trova le porte che la portano (e non le altre)', () => {
  const build = (s) => {
    s.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-CORE', x: 0, y: 0, w: 60, h: 40, ports: 4 });
    s.vlanNames[20] = 'Ospiti';
    s.ports['sw1-1'] = { vlan: 20 }; s.ports['sw1-2'] = { vlan: 20 }; s.ports['sw1-3'] = { vlan: 30 };
  };
  assert.deepEqual(ids(cerca('ospiti', build), 'port'), ['sw1-1', 'sw1-2']);
  assert.deepEqual(ids(cerca('vlan:20', build), 'port'), ['sw1-1', 'sw1-2'], 'il vecchio modo di cercare resta');
});

test('l\'IP di una porta e l\'IPv6 dell\'apparato si trovano', () => {
  const build = (s) => {
    s.nodes.push({ id: 'rt1', type: 'router', name: 'GW', x: 0, y: 0, w: 60, h: 40, ports: 4, ip: '192.168.50.1', ip6: '2001:db8:0:50::1' });
    s.ports['rt1-2'] = { ip: '10.9.9.9' };
  };
  assert.deepEqual(ids(cerca('10.9.9.9', build), 'port'), ['rt1-2']);
  assert.deepEqual(ids(cerca('2001:db8:0:50', build), 'device'), ['rt1']);
});

test('il nome dell\'apparato, il MAC e la query corta si comportano come prima', () => {
  const build = (s) => { s.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-CORE', x: 0, y: 0, w: 60, h: 40, ports: 2, mac: 'AA:BB:CC:DD:EE:FF' }); };
  assert.deepEqual(ids(cerca('sw-core', build), 'device'), ['sw1']);
  assert.deepEqual(ids(cerca('aa-bb-cc-dd-ee-ff', build), 'device'), ['sw1']);
  assert.deepEqual(cerca('s', build), [], 'sotto i due caratteri non si cerca');
});

test('con tante porte che combaciano i DISPOSITIVI vengono per primi: il tetto di 40 non li taglia', () => {
  // Il primo apparato porta 48 porte nella VLAN «Ospiti»; il secondo si chiama «Ospiti-AP». Prima i risultati
  // uscivano nell'ordine dei nodi: le 40 porte del primo riempivano il tetto e l'apparato non si vedeva.
  const build = (s) => {
    s.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-A', x: 0, y: 0, w: 60, h: 40, ports: 48 });
    s.nodes.push({ id: 'ap1', type: 'ap', name: 'Ospiti-AP', x: 0, y: 0, w: 60, h: 40, ports: 1 });
    s.vlanNames[20] = 'Ospiti';
    for (let i = 1; i <= 48; i++) s.ports['sw1-' + i] = { vlan: 20 };
  };
  const res = cerca('ospiti', build);
  assert.equal(res.length, 40, 'il tetto resta quello');
  assert.equal(res[0].kind, 'device');
  assert.equal(res[0].id, 'ap1');
  assert.ok(res.slice(1).every(r => r.kind === 'port'));
});
