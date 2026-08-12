'use strict';
// Test del modello IPAM per prefissi (lib/ipam-model.js). Il prefisso e` di primo
// livello, la VLAN e` un riferimento facoltativo. Usa il VERO lib/cidr.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureIpam, prefixesOf, prefixesForVlan, prefixesWithoutVlan,
  prefixForIp, findPrefix, upsertPrefix, removePrefix, migrateIpam, prefixKey,
} = require('../lib/ipam-model.js');

// Stato in formato 2.8.x: la subnet e` un campo della VLAN.
const legacy = () => ({
  ipam: {
    vlans: {
      10: { subnet: '192.168.10.0/24', gateway: '192.168.10.1', dns: '1.1.1.1' },
      20: { subnet: '192.168.20.0/24', gatewayNodeId: 'rt1', name: 'Uffici' },
      30: { gatewayNodeId: 'rt1' },                       // VLAN senza subnet
    },
  },
});

// ---------- migrazione ----------

test('migrateIpam: la subnet esce dalla VLAN e diventa un prefisso', () => {
  const s = legacy();
  migrateIpam(s);

  assert.equal(s.ipam.prefixes.length, 2);
  const p10 = findPrefix(s, '192.168.10.0/24');
  assert.equal(p10.vlan, 10);
  assert.equal(p10.gateway, '192.168.10.1');
  assert.equal(p10.dns, '1.1.1.1');

  // La VLAN 10 conteneva SOLO subnet/gateway/dns: svuotata, la voce sparisce —
  // la VLAN resta viva nella palette e nel prefisso che la cita.
  assert.equal(s.ipam.vlans['10'], undefined);
  // ...ma cio` che e` davvero PER-VLAN resta dov'e`. `ipam.vlans` non e` un
  // contenitore di sole subnet: ci vivono il legame con l'SVI e i metadati DCIM.
  assert.equal(s.ipam.vlans['20'].gatewayNodeId, 'rt1');
  assert.equal(s.ipam.vlans['20'].name, 'Uffici');
});

test('migrateIpam: una VLAN senza subnet non genera prefissi fantasma', () => {
  const s = legacy();
  migrateIpam(s);
  assert.equal(prefixesOf(s).some(p => p.vlan === 30), false);
  assert.equal(prefixesOf(s).some(p => !p.cidr), false);
  // e la VLAN 30 resta, col suo binding
  assert.equal(s.ipam.vlans['30'].gatewayNodeId, 'rt1');
});

test('migrateIpam: gateway dichiarato senza subnet NON viene distrutto', () => {
  // Caso reale: l'utente compila il gateway e lascia vuota la subnet. Non c'e`
  // un prefisso a cui attaccarlo, quindi resta dov'e`: cancellarlo per fare
  // ordine sarebbe buttare via un dato dichiarato a mano.
  const s = { ipam: { vlans: { 40: { gateway: '10.0.40.1', dns: '9.9.9.9' } } } };
  migrateIpam(s);
  assert.equal(s.ipam.vlans['40'].gateway, '10.0.40.1');
  assert.equal(s.ipam.vlans['40'].dns, '9.9.9.9');
  assert.equal(prefixesOf(s).length, 0);

  // ...e quando la subnet arriva, l'orfano entra nel prefisso.
  upsertPrefix(s, { cidr: '10.0.40.0/24', vlan: 40 });
  migrateIpam(s);
  assert.equal(findPrefix(s, '10.0.40.0/24').gateway, '10.0.40.1');
  assert.equal(findPrefix(s, '10.0.40.0/24').dns, '9.9.9.9');
  assert.equal(s.ipam.vlans['40'], undefined);
});

test('migrateIpam: idempotente — rieseguirla non cambia nulla', () => {
  const s = legacy();
  migrateIpam(s);
  const snapshot = JSON.stringify(s);
  migrateIpam(s);
  migrateIpam(s);
  assert.equal(JSON.stringify(s), snapshot);
});

test('migrateIpam: le righe dell\'import DCIM passano da `prefix` a `cidr`', () => {
  // Dalla 2.8.0 l'import scriveva gia` ipam.prefixes[], ma col campo `prefix` e
  // senza che nessuno lo leggesse. Quelle righe sono dati veri: si rinominano.
  const s = { ipam: {
    vlans: { 20: { subnet: '192.168.20.0/24' } },
    prefixes: [
      { id: 7, prefix: '10.0.0.0/30', vlan: null, description: 'punto-punto R1-R2' },
      { id: 9, prefix: '192.168.20.0/24', vlan: 20, status: 'active' },
    ],
  } };
  migrateIpam(s);

  assert.equal(prefixesOf(s).every(p => p.cidr && p.prefix === undefined), true);
  assert.equal(findPrefix(s, '10.0.0.0/30').description, 'punto-punto R1-R2');
  // Lo stesso CIDR era in tutti e due i posti: si FONDE, non si duplica.
  assert.equal(prefixesOf(s).filter(p => prefixKey(p.cidr) === prefixKey('192.168.20.0/24')).length, 1);
  assert.equal(findPrefix(s, '192.168.20.0/24').status, 'active');
});

test('migrateIpam: due prefissi sulla stessa VLAN convivono (dual-stack)', () => {
  // E` il difetto che questo modello chiude: prima il secondo sovrascriveva il
  // primo, in silenzio.
  const s = { ipam: { vlans: {}, prefixes: [
    { prefix: '192.168.20.0/24', vlan: 20 },
    { prefix: '2001:db8:0:14::/64', vlan: 20 },
  ] } };
  migrateIpam(s);
  const rows = prefixesForVlan(s, 20);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(p => p.cidr), ['192.168.20.0/24', '2001:db8:0:14::/64']);
});

// ---------- letture ----------

test('prefixesForVlan / prefixesWithoutVlan: il null non diventa VLAN 0', () => {
  const s = { ipam: { vlans: {}, prefixes: [
    { cidr: '192.168.10.0/24', vlan: 10 },
    { cidr: '10.0.0.0/30', vlan: null },
    { cidr: '10.0.0.4/30' },                 // vlan assente = senza VLAN
  ] } };
  migrateIpam(s);
  assert.deepEqual(prefixesForVlan(s, 10).map(p => p.cidr), ['192.168.10.0/24']);
  assert.deepEqual(prefixesForVlan(s, 0).map(p => p.cidr), []);      // «VLAN 0» non esiste
  assert.deepEqual(prefixesForVlan(s, null).map(p => p.cidr), []);
  assert.deepEqual(prefixesWithoutVlan(s).map(p => p.cidr), ['10.0.0.0/30', '10.0.0.4/30']);
});

test('prefixForIp: vince il piu` specifico', () => {
  const s = { ipam: { vlans: {}, prefixes: [
    { cidr: '192.168.0.0/16', vlan: 1 },
    { cidr: '192.168.20.0/24', vlan: 20 },
    { cidr: '192.168.20.128/25', vlan: 21 },
    { cidr: '2001:db8:0:14::/64', vlan: 20 },
  ] } };
  assert.equal(prefixForIp(s, '192.168.20.130').vlan, 21);
  assert.equal(prefixForIp(s, '192.168.20.10').vlan, 20);
  assert.equal(prefixForIp(s, '192.168.99.1').vlan, 1);
  assert.equal(prefixForIp(s, '10.0.0.1'), null);
  assert.equal(prefixForIp(s, '2001:db8:0:14::5').cidr, '2001:db8:0:14::/64');
  assert.equal(prefixForIp(s, ''), null);
});

// ---------- scrittura ----------

test('upsertPrefix: aggiorna senza azzerare i campi che non gli passi', () => {
  const s = {};
  upsertPrefix(s, { cidr: '192.168.20.0/24', vlan: 20, description: 'dal DCIM', source: 'dcim' });
  upsertPrefix(s, { cidr: '192.168.20.0/24', gateway: '192.168.20.1' });

  assert.equal(prefixesOf(s).length, 1);
  const row = findPrefix(s, '192.168.20.0/24');
  assert.equal(row.gateway, '192.168.20.1');
  assert.equal(row.description, 'dal DCIM');   // non sparisce
  assert.equal(row.vlan, 20);

  // stringa vuota = l'utente ha svuotato la casella: quello si cancella
  upsertPrefix(s, { cidr: '192.168.20.0/24', gateway: '' });
  assert.equal(findPrefix(s, '192.168.20.0/24').gateway, undefined);
});

test('prefixKey: la stessa rete scritta in due modi e` la stessa rete', () => {
  assert.equal(prefixKey('2001:DB8:0:14::/64'), prefixKey('2001:db8:0:14::/64'));
  assert.equal(prefixKey('192.168.20.5/24'), prefixKey('192.168.20.0/24'));
  assert.notEqual(prefixKey('192.168.20.0/24'), prefixKey('192.168.20.0/25'));
  assert.equal(prefixKey(''), '');
  // non parsabile: chiave a se stesso, nessun collasso fra stringhe diverse
  assert.notEqual(prefixKey('non-una-rete'), prefixKey('nemmeno-questa'));
});

test('removePrefix: toglie la riga, e dice se ha tolto qualcosa', () => {
  const s = {};
  upsertPrefix(s, { cidr: '10.0.0.0/30', vlan: null });
  assert.equal(removePrefix(s, '10.0.0.0/30'), true);
  assert.equal(prefixesOf(s).length, 0);
  assert.equal(removePrefix(s, '10.0.0.0/30'), false);
});

test('ensureIpam: costruisce la forma senza toccare cio` che c\'e`', () => {
  const s = { ipam: { vlans: { 10: { gatewayNodeId: 'rt1' } } } };
  const ipam = ensureIpam(s);
  assert.deepEqual(ipam.prefixes, []);
  assert.equal(ipam.vlans['10'].gatewayNodeId, 'rt1');
  const empty = ensureIpam({});
  assert.deepEqual(empty.prefixes, []);
  assert.deepEqual(empty.vlans, {});
});
