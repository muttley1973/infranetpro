// Test per la derivazione PURA del trunk dalle VLAN trasportate (lib/vlan-trunk.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/vlan-trunk.js');

test('parseVlanList: numeri, range, dedup, ordinato, scarta invalidi', () => {
  assert.deepEqual(V.parseVlanList('10,20,10'), [10, 20]);
  assert.deepEqual(V.parseVlanList('100-103'), [100, 101, 102, 103]);
  assert.deepEqual(V.parseVlanList('20, 10 , 5-6'), [5, 6, 10, 20]);
  assert.deepEqual(V.parseVlanList('0,5000,abc,7'), [7]);   // fuori range / non numero
  assert.deepEqual(V.parseVlanList(''), []);
  assert.deepEqual(V.parseVlanList([30, 10, 30]), [10, 30]);
});

test('carriedVlans: voip → [voiceVlan] solo se > 1', () => {
  assert.deepEqual(V.carriedVlans({ type: 'voip', voiceVlan: 20 }), [20]);
  assert.deepEqual(V.carriedVlans({ type: 'voip', voiceVlan: 1 }), []);   // VLAN 1 = nessuna voce
  assert.deepEqual(V.carriedVlans({ type: 'voip' }), []);
});

test('carriedVlans: voip → legge voiceVlan anche da node.spec (campo spec via updateN)', () => {
  // updateN sposta i campi spec in node.spec e cancella il top-level: la voce
  // impostata dalla UI vive in spec → deve comunque essere trasportata.
  assert.deepEqual(V.carriedVlans({ type: 'voip', spec: { voiceVlan: 20 } }), [20]);
  assert.deepEqual(V.carriedVlans({ type: 'voip', spec: { voiceVlan: 1 } }), []);
  // il top-level, se presente, ha la precedenza (manual-first immediato)
  assert.deepEqual(V.carriedVlans({ type: 'voip', voiceVlan: 30, spec: { voiceVlan: 20 } }), [30]);
});

test('carriedVlans: VLAN dei BSS (ssids[]) per QUALSIASI tipo (ap/router/firewall)', () => {
  // Multi-SSID: una radio può portare più BSS; si aggregano tutte le VLAN.
  const radios = [{ band: '2.4', ssids: [{ id: 'a', ssid: 'A', vlan: 30 }] },
                  { band: '5',   ssids: [{ id: 'b', ssid: 'B', vlan: 40 }, { id: 'c', ssid: 'C', vlan: 30 }] }];
  assert.deepEqual(V.carriedVlans({ type: 'ap', radios }), [30, 40]);
  assert.deepEqual(V.carriedVlans({ type: 'router', radios }), [30, 40]);     // router con Wi-Fi
  assert.deepEqual(V.carriedVlans({ type: 'firewall', radios }), [30, 40]);   // firewall con Wi-Fi
  assert.deepEqual(V.carriedVlans({ type: 'ap', radios: [{ ssids: [{ id: 'x', ssid: 'X' }] }] }), []); // nessuna vlan
  assert.deepEqual(V.carriedVlans({ type: 'ap', radios: [{ band: '5' }] }), []); // radio senza BSS
  assert.deepEqual(V.carriedVlans({ type: 'ap' }), []);
});

test('carriedVlans: voip → voce + eventuali radio', () => {
  assert.deepEqual(V.carriedVlans({ type: 'voip', voiceVlan: 20 }), [20]);
  // device senza radio né voce → []
  assert.deepEqual(V.carriedVlans({ type: 'pc' }), []);
  assert.deepEqual(V.carriedVlans(null), []);
});

test('carriedVlans: hypervisor/homelab → VLAN delle VM (node.vms[].vlan)', () => {
  // Le VM dichiarano la VLAN del loro port-group → l'uplink le trasporta tutte.
  const vms = [{ name: 'dc01', vlan: 10 }, { name: 'web01', vlan: 20 }, { name: 'app01', vlan: 20 }];
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor', vms }), [10, 20]);   // dedup
  assert.deepEqual(V.carriedVlans({ type: 'homelab', vms }), [10, 20]);      // stesso motore
  // VM appliance multi-vNIC nella vecchia forma: vlan come lista tollerante.
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor', vms: [{ name: 'fw', vlan: '20,30' }] }), [20, 30]);
  // VM senza vlan / lista vuota → nessuna VLAN trasportata.
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor', vms: [{ name: 'x' }] }), []);
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor', vms: [] }), []);
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor' }), []);
});

test('carriedVlans: VM multi-vNIC (nics[]) → una VLAN per scheda', () => {
  // Firewall virtuale a tre gambe: ogni vNIC sta su un port-group diverso, e
  // l'uplink dell'host deve trasportarle TUTTE. Prima della 78ª le tre VLAN
  // stavano in un solo campo separate da virgole.
  const fw = { name: 'opnsense', nics: [
    { id: 'nic1', name: 'WAN', vlan: 10 },
    { id: 'nic2', name: 'LAN', vlan: 20 },
    { id: 'nic3', name: 'DMZ', vlan: '30' },
  ] };
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor', vms: [fw] }), [10, 20, 30]);
  // Una singola vNIC su un trunk può a sua volta portarne più d'una.
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor',
    vms: [{ nics: [{ id: 'nic1', vlan: '40,50' }] }] }), [40, 50]);
  // nics[] esplicito VINCE sul residuo piatto non ancora migrato: mai la somma
  // delle due forme (produrrebbe VLAN fantasma sull'uplink).
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor',
    vms: [{ vlan: 99, nics: [{ id: 'nic1', vlan: 20 }] }] }), [20]);
  // Schede senza VLAN dichiarata: nessuna invenzione (niente VLAN 1 d'ufficio).
  assert.deepEqual(V.carriedVlans({ type: 'hypervisor',
    vms: [{ nics: [{ id: 'nic1', ip: '10.0.0.1' }] }] }), []);
});

test('effLinkVlans: derivato — 1 sola VLAN = access, ≥2 = trunk', () => {
  const a = V.effLinkVlans({ native: 1, carried: [] });
  assert.equal(a.mode, 'access');
  assert.deepEqual(a.vlans, [1]);
  assert.equal(a.derived, true);

  const t = V.effLinkVlans({ native: 1, carried: [20] });
  assert.equal(t.mode, 'trunk');
  assert.deepEqual(t.vlans, [1, 20]);   // nativa + voce
  assert.equal(t.derived, true);
});

test('effLinkVlans: AP multi-SSID → trunk con nativa + SSID', () => {
  const r = V.effLinkVlans({ native: 1, carried: [30, 40] });
  assert.equal(r.mode, 'trunk');
  assert.deepEqual(r.vlans, [1, 30, 40]);
});

test('effLinkVlans: nativa già in carried → dedup', () => {
  const r = V.effLinkVlans({ native: 20, carried: [20] });
  assert.equal(r.mode, 'access');       // un solo valore distinto
  assert.deepEqual(r.vlans, [20]);
});

test('effLinkVlans: override manuale trunkVlans VINCE (derived:false)', () => {
  const r = V.effLinkVlans({ manualTrunkVlans: '5,6,7', native: 1, carried: [20] });
  assert.equal(r.mode, 'trunk');
  assert.deepEqual(r.vlans, [5, 6, 7]);  // ignora la derivazione
  assert.equal(r.derived, false);
});

test('effLinkVlans: trunk SNMP (snmpTrunk) → trunk anche con poche VLAN; manuale vince', () => {
  // SNMP porta-trunk con membership {1,30} → trunk derivato.
  const a = V.effLinkVlans({ native: 1, carried: [30], snmpTrunk: true });
  assert.equal(a.mode, 'trunk');
  assert.deepEqual(a.vlans, [1, 30]);
  assert.equal(a.derived, true);
  // snmpTrunk con una sola VLAN → resta trunk (la porta è un trunk reale).
  const b = V.effLinkVlans({ native: 10, carried: [], snmpTrunk: true });
  assert.equal(b.mode, 'trunk');
  // Manual-first: trunkVlans a mano vince e ignora lo SNMP.
  const c = V.effLinkVlans({ manualTrunkVlans: '5,6', native: 1, carried: [30], snmpTrunk: true });
  assert.deepEqual(c.vlans, [5, 6]);
  assert.equal(c.derived, false);
  // Manual-first: access forzato vince anche su snmpTrunk.
  const d = V.effLinkVlans({ manualMode: 'access', native: 1, carried: [30], snmpTrunk: true });
  assert.equal(d.mode, 'access');
});

test('effLinkVlans: override esplicito ad access vince sulla derivazione', () => {
  const r = V.effLinkVlans({ manualMode: 'access', native: 1, carried: [20] });
  assert.equal(r.mode, 'access');
  assert.deepEqual(r.vlans, [1]);
  assert.equal(r.derived, false);
});

test('effLinkVlans: native invalida → fallback VLAN 1', () => {
  const r = V.effLinkVlans({ native: 99999, carried: [20] });
  assert.deepEqual(r.vlans, [1, 20]);
});
