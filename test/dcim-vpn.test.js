// Test di lib/dcim-vpn.js — i servizi L2 e i tunnel di NetBox → i collegamenti
// fra sedi. PURO: nessun server, nessuna rete, nessun DOM. Le forme sono quelle
// MISURATE su un NetBox 4.6.7 vero (oggetti creati, riletti e ricancellati).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { vpnToLinks, _holder } = require('../lib/dcim-vpn.js');

const dev = (id, name) => ({ id, name, display: name });
const itf = (id, name, d) => ({ id, name, display: name, device: d });
const vmItf = (id, name, vm) => ({ id, name, virtual_machine: vm });

const VR = dev(171, 'VR-CORE-SW'), TN = dev(172, 'TN-SW-01');
const SEDI = { 171: { id: 1, name: 'Verona HQ' }, 172: { id: 2, name: 'Trento Filiale' } };
const siteOf = (h) => (h && h.kind === 'device' ? SEDI[h.id] || null : null);

const l2t = (id, l2vpn, iface) => ({
  id, l2vpn: { id: l2vpn }, assigned_object_type: 'dcim.interface', assigned_object: iface,
});
const tunt = (id, tunnel, iface, role, outside) => ({
  id, tunnel: { id: tunnel }, role: { value: role, label: role },
  termination_type: 'dcim.interface', termination: iface,
  outside_ip: outside ? { address: outside } : null,
});

test('① un VPLS di NetBox diventa un collegamento `vpls` — il vocabolario è CHIUSO', () => {
  // ⚠️ È la differenza col tipo di un CIRCUITO, che è testo libero dell'istanza
  // e per questo entra come `other`. `l2vpn.type: 'vpls'` vuol dire VPLS in ogni
  // installazione del mondo: tradurlo non è indovinare.
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'VPLS-VR-TN', type: { value: 'vpls', label: 'VPLS' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'Gi1/0/23', VR)), l2t(2, 1, itf(11, 'Gi0/2', TN))],
  }, { siteIds: [1], siteOf });
  assert.equal(out.links.length, 1);
  const l = out.links[0];
  assert.equal(l.kind, 'vpls');
  assert.equal(l.kindLabel, null, 'una natura vera non porta l\'etichetta di `other`');
  assert.equal(l.name, 'VPLS-VR-TN');
  assert.deepEqual([l.aNetboxSiteName, l.bNetboxSiteName], ['Verona HQ', 'Trento Filiale']);
  assert.deepEqual([l.aDeviceName, l.bDeviceName], ['VR-CORE-SW', 'TN-SW-01']);
});

test('① un tipo L2 che il nostro vocabolario non ha entra come `other`, col NOME NetBox', () => {
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'VX-LAB', type: { value: 'vxlan', label: 'VXLAN' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', TN))],
  }, { siteIds: [1], siteOf });
  assert.equal(out.links[0].kind, 'other');
  assert.equal(out.links[0].kindLabel, 'VXLAN', 'che cos\'È');
  assert.equal(out.links[0].name, 'VX-LAB', 'come si CHIAMA — e sono due cose diverse');
});

test('① un tunnel IPsec (tunnel o transport) diventa `ipsec`; GRE e WireGuard no', () => {
  const tun = (id, name, enc, label) => ({ id, name, status: { value: 'active' }, encapsulation: { value: enc, label } });
  const out = vpnToLinks({
    tunnels: [tun(1, 'T1', 'ipsec-tunnel', 'IPsec - Tunnel'), tun(2, 'T2', 'ipsec-transport', 'IPsec - Transport'),
      tun(3, 'T3', 'gre', 'GRE'), tun(4, 'T4', 'wireguard', 'WireGuard')],
    tunnelTerminations: [1, 2, 3, 4].flatMap(t => [tunt(t * 10, t, itf(10, 'a', VR), 'peer'), tunt(t * 10 + 1, t, itf(11, 'b', TN), 'peer')]),
  }, { siteIds: [1], siteOf });
  assert.deepEqual(out.links.map(l => l.kind), ['ipsec', 'ipsec', 'other', 'other']);
  assert.deepEqual(out.links.slice(2).map(l => l.kindLabel), ['GRE', 'WireGuard']);
});

test('② ⚠️ gli indirizzi si INCROCIANO: il peer di A è l\'esterno di B', () => {
  // In NetBox `outside_ip` è l'indirizzo di QUEL capo; nel modello `peerIp` è
  // quello dell'ALTRO — è l'indirizzo che si scrive nella configurazione. Darli
  // dritti sarebbe esattamente al contrario, e a valle sono due indirizzi
  // plausibili nei due campi sbagliati: nessuno se ne accorgerebbe.
  const out = vpnToLinks({
    tunnels: [{ id: 1, name: 'T', status: { value: 'active' }, encapsulation: { value: 'ipsec-tunnel', label: 'IPsec' } }],
    tunnelTerminations: [
      tunt(1, 1, itf(10, 'a', VR), 'peer', '203.0.113.1/32'),
      tunt(2, 1, itf(11, 'b', TN), 'peer', '198.51.100.9/32'),
    ],
  }, { siteIds: [1], siteOf });
  const l = out.links[0];
  assert.equal(l.aNetboxSiteName, 'Verona HQ');
  assert.equal(l.aPeerIp, '198.51.100.9', 'il peer di Verona è l\'indirizzo di Trento');
  assert.equal(l.bPeerIp, '203.0.113.1');
});

test('la maschera non viaggia: un capo di tunnel è un INDIRIZZO', () => {
  const out = vpnToLinks({
    tunnels: [{ id: 1, name: 'T', status: { value: 'active' }, encapsulation: { value: 'ipsec-tunnel' } }],
    tunnelTerminations: [tunt(1, 1, itf(10, 'a', VR), 'peer', '2001:db8::1/128'), tunt(2, 1, itf(11, 'b', TN), 'peer')],
  }, { siteIds: [1], siteOf });
  assert.equal(out.links[0].bPeerIp, '2001:db8::1');
});

test('⑤ hub + spoke → `hub-and-spoke`; due `peer` NON diventano una maglia', () => {
  const base = (term) => vpnToLinks({
    tunnels: [{ id: 1, name: 'T', status: { value: 'active' }, encapsulation: { value: 'ipsec-tunnel' } }],
    tunnelTerminations: term,
  }, { siteIds: [1], siteOf }).links[0];
  assert.equal(base([tunt(1, 1, itf(10, 'a', VR), 'hub'), tunt(2, 1, itf(11, 'b', TN), 'spoke')]).topology, 'hub-and-spoke');
  // «maglia» è un'affermazione sull'INSIEME dei collegamenti: due capi non la
  // sostengono, e dedurla da qui la scriverebbe su ogni tunnel punto-punto.
  assert.equal(base([tunt(1, 1, itf(10, 'a', VR), 'peer'), tunt(2, 1, itf(11, 'b', TN), 'peer')]).topology, null);
});

test('③ ciò che non è ATTIVO non entra, e si dice con il suo stato', () => {
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'VECCHIO', type: { value: 'vpls' }, status: { value: 'decommissioning' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', TN))],
    tunnels: [{ id: 2, name: 'FUTURO', status: { value: 'planned' }, encapsulation: { value: 'ipsec-tunnel' } },
      { id: 3, name: 'SPENTO', status: { value: 'disabled' }, encapsulation: { value: 'ipsec-tunnel' } }],
    tunnelTerminations: [tunt(1, 2, itf(10, 'a', VR), 'peer'), tunt(2, 2, itf(11, 'b', TN), 'peer'),
      tunt(3, 3, itf(10, 'a', VR), 'peer'), tunt(4, 3, itf(11, 'b', TN), 'peer')],
  }, { siteIds: [1], siteOf });
  assert.equal(out.links.length, 0);
  const n = out.notes.find(x => x.code === 'vpn.notActive');
  assert.equal(n.n, 3);
  // ⚠️ `disabled` NON diventa uno stato «giù»: è una decisione documentale, non
  // una misura, e i due si leggerebbero uguali.
  assert.ok(n.rows.some(r => r.status === 'disabled'));
});

test('④ un servizio MULTIPUNTO non si spezza in coppie: si rifiuta con la ragione', () => {
  const RM = dev(173, 'RM-SW-01');
  const tre = { ...SEDI, 173: { id: 3, name: 'Roma' } };
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'VPLS-3-SEDI', type: { value: 'vpls' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', TN)), l2t(3, 1, itf(12, 'c', RM))],
  }, { siteIds: [1], siteOf: h => (h && h.kind === 'device' ? tre[h.id] || null : null) });
  assert.equal(out.links.length, 0);
  const n = out.notes.find(x => x.code === 'vpn.multipoint');
  assert.equal(n.n, 3);
  assert.deepEqual(n.sites.sort(), ['Roma', 'Trento Filiale', 'Verona HQ']);
});

test('tutti i capi nella STESSA sede: è un servizio interno, non un collegamento', () => {
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'VPLS-INTERNO', type: { value: 'vpls' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', VR))],
  }, { siteIds: [1], siteOf });
  assert.equal(out.links.length, 0);
  assert.equal(out.notes.find(x => x.code === 'vpn.oneSite').site, 'Verona HQ');
});

test('⑥ l\'identificativo VNI/VC-ID non ha un campo, e viene DETTO', () => {
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'V', type: { value: 'vpls' }, status: { value: 'active' }, identifier: 1001 }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', TN))],
  }, { siteIds: [1], siteOf });
  const n = out.notes.find(x => x.code === 'vpn.identifierNoField');
  assert.equal(n.id, '1001');
  // ⚠️ E NON viene infilato in `service`, che è il servizio dell'OPERATORE.
  assert.equal(out.links[0].service, undefined);
  assert.equal(out.links[0].phase1Name, undefined);
});

test('⑦ un capo su una VM o su una VLAN si risolve con lo stesso `siteOf`', () => {
  const vm = { id: 900, name: 'VM-FW' };
  const out = vpnToLinks({
    tunnels: [{ id: 1, name: 'T', status: { value: 'active' }, encapsulation: { value: 'ipsec-tunnel' } }],
    tunnelTerminations: [
      { id: 1, tunnel: { id: 1 }, role: { value: 'peer' }, termination_type: 'virtualization.vminterface', termination: vmItf(1, 'eth0', vm) },
      tunt(2, 1, itf(11, 'b', TN), 'peer'),
    ],
  }, {
    siteIds: [1],
    siteOf: h => (h && h.kind === 'vm' && h.id === 900) ? { id: 1, name: 'Verona HQ' } : siteOf(h),
  });
  assert.equal(out.links.length, 1);
  assert.equal(out.links[0].aDeviceName, 'VM-FW');
});

test('un capo che non si riconduce a una sede non fa sparire il servizio in silenzio', () => {
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'V', type: { value: 'vpls' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', dev(999, 'IGNOTO')))],
  }, { siteIds: [1], siteOf });
  assert.equal(out.links.length, 0);
  assert.ok(out.notes.some(x => x.code === 'vpn.endpointNoSite' && x.n === 1));
  assert.ok(out.notes.some(x => x.code === 'vpn.noSite'));
});

test('⚠️ CINTURA: NetBox ignora un filtro che non conosce anche su `vpn/`', () => {
  // Misurato: `/api/vpn/l2vpns/?pippo_id=9` risponde con TUTTO.
  const AL = dev(180, 'AL-SW'), fuori = { ...SEDI, 180: { id: 9, name: 'Altrove' }, 181: { id: 9, name: 'Altrove' } };
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'MIO', type: { value: 'vpls' }, status: { value: 'active' } },
      { id: 2, name: 'ALTRUI', type: { value: 'vpls' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', TN)),
      l2t(3, 2, itf(12, 'c', AL)), l2t(4, 2, itf(13, 'd', dev(181, 'AL-SW-2')))],
  }, { siteIds: [1], siteOf: h => (h && h.kind === 'device' ? fuori[h.id] || null : null) });
  assert.deepEqual(out.links.map(l => l.name), ['MIO']);
  assert.equal(out.scopeHeld, false);
  assert.equal(out.notes.find(x => x.code === 'vpn.outOfScope').n, 1);
});

test('_holder riconosce i tre agganci, e non inventa sugli altri', () => {
  assert.equal(_holder('dcim.interface', itf(1, 'a', VR)).kind, 'device');
  assert.equal(_holder('virtualization.vminterface', vmItf(1, 'a', { id: 9, name: 'VM' })).kind, 'vm');
  assert.equal(_holder('ipam.vlan', { id: 5, name: 'MGMT' }).kind, 'vlan');
  assert.equal(_holder('qualcosa.altro', { id: 5 }).kind, 'qualcosa.altro');
  assert.equal(_holder('dcim.interface', null), null);
});

test('un bundle vuoto, assurdo o assente non esplode e non inventa', () => {
  for (const x of [null, undefined, {}, { l2vpns: null, tunnels: 'boh' }, 42]) {
    const out = vpnToLinks(x, { siteIds: [1], siteOf });
    assert.deepEqual(out.links, []);
  }
});

test('la mappatura non muta il bundle che le è stato dato', () => {
  const nb = {
    l2vpns: [{ id: 1, name: 'V', type: { value: 'vpls' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', TN))],
  };
  const prima = JSON.stringify(nb);
  vpnToLinks(nb, { siteIds: [1], siteOf });
  assert.equal(JSON.stringify(nb), prima);
});
