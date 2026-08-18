'use strict';
// ============================================================
// IL TEST FONDAMENTALE — l'identità d'origine sopravvive a SALVA e RIAPRI.
//
//   interfaccia NetBox #1000 → import → porta del documento → export portabile →
//   JSON → riapertura → l'objectId è ancora 1000.
//
// Perché è un CANCELLO e non un test come gli altri: scrivere all'indietro verso
// un DCIM significa dire «modifica QUELL'oggetto». Se il riferimento non attraversa
// un salvataggio, ogni riga di codice di scrittura costruita sopra è costruita sul
// vuoto — e il giorno che si rompe non lo scopri con un errore, lo scopri
// modificando l'oggetto sbagliato di qualcun altro.
//
// Il giro è quello VERO: `createPortableProjectExport` (che sanifica), serializza,
// rilegge, e riapplica le potature del caricamento (`dropObsoleteFields`,
// `pruneProjectStateCaches`). Se un domani una potatura diventasse una whitelist,
// questo test cade — ed è esattamente ciò che deve fare.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const map = require('../lib/dcim-map.js');
const fmt = require('../lib/project-format.js');
const { refOf, refOfType, refKey } = require('../lib/source-ref.js');

// Un NetBox minimo ma completo: apparato, interfacce, patch panel (front+rear),
// rack, cavo, prefisso, indirizzo. Uno per ogni identità che dovrà reggere.
function fixture() {
  return {
    manufacturers: [{ id: 1, name: 'Cisco' }, { id: 2, name: 'CommScope' }],
    deviceTypes: [
      { id: 10, manufacturer: { id: 1 }, model: 'C9200', u_height: 1 },
      { id: 12, manufacturer: { id: 2 }, model: 'PP-24', u_height: 1 },
    ],
    deviceRoles: [
      { id: 20, slug: 'access-switch', name: 'Access Switch' },
      { id: 22, slug: 'patch-panel', name: 'Patch Panel' },
    ],
    racks: [{ id: 30, name: 'MDF', u_height: 42 }],
    sites: [{ id: 7, name: 'Sede' }],
    devices: [
      { id: 100, name: 'SW-01', device_type: { id: 10 }, role: { id: 20 }, site: { id: 7 }, rack: { id: 30 }, position: 40 },
      { id: 200, name: 'PP-A', device_type: { id: 12 }, role: { id: 22 }, site: { id: 7 }, rack: { id: 30 }, position: 20 },
    ],
    interfaces: [
      { id: 1000, device: { id: 100 }, name: 'GigabitEthernet0/1' },
      { id: 1001, device: { id: 100 }, name: 'GigabitEthernet0/2' },
      { id: 1002, device: { id: 100 }, name: 'Vlan10', type: { value: 'virtual' } },
    ],
    frontPorts: [{ id: 2000, device: { id: 200 }, name: '1', rear_port: { id: 3000 } }],
    cables: [{
      id: 500,
      a_terminations: [{ object_type: 'dcim.interface', object_id: 1000 }],
      b_terminations: [{ object_type: 'dcim.frontport', object_id: 2000 }],
    }],
    prefixes: [{ id: 70, prefix: '10.0.0.0/24' }],
    ipAddresses: [{ id: 900, address: '10.0.0.5/24', assigned_object_id: 1001, assigned_object: { id: 1001 } }],
  };
}

// Salva e riapri, com'è per davvero: sanifica → JSON → rileggi → pota.
function salvaERiapri(state) {
  const pacchetto = fmt.createPortableProjectExport(state, {});
  const riletto = JSON.parse(JSON.stringify(pacchetto));
  const out = fmt.unwrapProjectState(riletto);
  fmt.dropObsoleteFields(out);
  fmt.pruneProjectStateCaches(out);
  return out;
}

// Tutte le identità del documento, in una mappa «dove» → «chiave del riferimento».
function identita(state) {
  const out = new Map();
  for (const n of (state.nodes || [])) {
    const d = n.source && n.source.deviceId;
    if (d != null) out.set('node:' + n.id, 'dcim.device#' + d);
  }
  for (const pid of Object.keys(state.ports || {})) {
    const k = refKey(refOf(state.ports[pid]));
    if (k) out.set('port:' + pid, k);
    const r = refOfType(state.ports[pid], 'dcim.rearport');
    if (r) out.set('portRear:' + pid, refKey(r));
  }
  for (const r of (state.racks || [])) {
    const k = refKey(refOf(r));
    if (k) out.set('rack:' + r.id, k);
  }
  for (const l of (state.links || [])) {
    if (l.sourceCableId != null) out.set('link:' + l.id, 'dcim.cable#' + l.sourceCableId);
  }
  const ipam = state.ipam || {};
  for (const p of (ipam.prefixes || [])) {
    if (p.id != null) out.set('prefix:' + p.cidr, 'ipam.prefix#' + p.id);
  }
  for (const a of (ipam.addresses || [])) {
    if (a.id != null) out.set('address:' + a.address, 'ipam.ipaddress#' + a.id);
    if (a.interfaceId != null) out.set('addressIface:' + a.address, 'dcim.interface#' + a.interfaceId);
  }
  return out;
}

test('⭐ CANCELLO: ogni identita d\'origine attraversa salva-e-riapri, intatta', () => {
  const { state } = map.netboxToState(fixture());
  const prima = identita(state);
  // Se questa mappa fosse vuota il test passerebbe dicendo niente: si pretende
  // che ci sia almeno una identita' per OGNI famiglia prima di confrontare.
  const famiglie = new Set([...prima.keys()].map((k) => k.split(':')[0]));
  for (const f of ['node', 'port', 'rack', 'link', 'prefix']) {
    assert.ok(famiglie.has(f), 'nessuna identita\' per la famiglia «' + f + '»: il test non proverebbe niente');
  }

  const dopo = identita(salvaERiapri(state));
  assert.deepStrictEqual([...dopo.entries()].sort(), [...prima.entries()].sort(),
    'un\'identita\' e\' cambiata o sparita nel giro di salvataggio');
});

test('il caso del concept, alla lettera: l\'interfaccia resta la sua', () => {
  const { state } = map.netboxToState(fixture());
  const pid = Object.keys(state.ports).find((p) => refKey(refOf(state.ports[p])) === 'dcim.interface#1000');
  assert.ok(pid, 'l\'interfaccia 1000 deve essere diventata una porta con il suo riferimento');
  const dopo = salvaERiapri(state);
  assert.deepStrictEqual(refOf(dopo.ports[pid]), { objectType: 'dcim.interface', objectId: 1000 });
});

test('lo slot di patch panel porta ENTRAMBI: front e rear', () => {
  const { state } = map.netboxToState(fixture());
  const pid = Object.keys(state.ports).find((p) => refKey(refOf(state.ports[p])) === 'dcim.frontport#2000');
  assert.ok(pid, 'il front port 2000 deve avere il suo riferimento');
  const dopo = salvaERiapri(state);
  assert.deepStrictEqual(refOf(dopo.ports[pid]), { objectType: 'dcim.frontport', objectId: 2000 });
  assert.deepStrictEqual(refOfType(dopo.ports[pid], 'dcim.rearport'), { objectType: 'dcim.rearport', objectId: 3000 },
    'un cavo puo\' terminare sul retro: serve anche quell\'identita\'');
});

test('anche l\'interfaccia LOGICA (Vlan10) tiene il suo riferimento', () => {
  const { state } = map.netboxToState(fixture());
  const trovate = Object.keys(state.ports)
    .map((p) => refKey(refOf(state.ports[p])))
    .filter((k) => k === 'dcim.interface#1002');
  assert.equal(trovate.length, 1, 'la logica non e\' una porta fisica, ma resta un oggetto di la\'');
});

test('una porta scritta a MANO non acquista un\'identita\' che non ha', () => {
  const { state } = map.netboxToState(fixture());
  state.ports['mia-1'] = { ifName: 'la mia porta' };
  const dopo = salvaERiapri(state);
  assert.strictEqual(refOf(dopo.ports['mia-1']), null,
    'nessun riferimento inventato: e\' lavoro tuo, e di la\' non esiste');
});
