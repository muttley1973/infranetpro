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
  // ㉔ Un servizio L2 di NetBox è un TRASPORTO: è ciò SU CUI il collegamento
  // viaggia. L'asse lo dice la sorgente, non un indovinello.
  assert.equal(l.transport, 'vpls');
  assert.equal(l.tunnel, null, 'un servizio L2 non dice niente su cosa ci corra sopra');
  assert.equal(l.transportLabel, null, 'una natura vera non porta l\'etichetta di `other`');
  assert.equal(l.name, 'VPLS-VR-TN');
  assert.deepEqual([l.aNetboxSiteName, l.bNetboxSiteName], ['Verona HQ', 'Trento Filiale']);
  assert.deepEqual([l.aDeviceName, l.bDeviceName], ['VR-CORE-SW', 'TN-SW-01']);
});

test('① un tipo L2 che il nostro vocabolario non ha entra come `other`, col NOME NetBox', () => {
  // ⑲ EPL è un servizio Ethernet d'operatore: una famiglia che il nostro
  // vocabolario NON ha, e che schiacciata su VPWS direbbe una cosa per un'altra.
  const out = vpnToLinks({
    l2vpns: [{ id: 1, name: 'EPL-LAB', type: { value: 'epl', label: 'EPL' }, status: { value: 'active' } }],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'a', VR)), l2t(2, 1, itf(11, 'b', TN))],
  }, { siteIds: [1], siteOf });
  assert.equal(out.links[0].transport, 'other');
  assert.equal(out.links[0].transportLabel, 'EPL', 'che cos\'È');
  assert.equal(out.links[0].name, 'EPL-LAB', 'come si CHIAMA — e sono due cose diverse');
});

test('① ⑲ ogni incapsulamento che il vocabolario ha diventa la sua natura', () => {
  const tun = (id, name, enc, label) => ({ id, name, status: { value: 'active' }, encapsulation: { value: enc, label } });
  const out = vpnToLinks({
    tunnels: [tun(1, 'T1', 'ipsec-tunnel', 'IPsec - Tunnel'), tun(2, 'T2', 'ipsec-transport', 'IPsec - Transport'),
      tun(3, 'T3', 'gre', 'GRE'), tun(4, 'T4', 'wireguard', 'WireGuard'),
      tun(5, 'T5', 'openvpn', 'OpenVPN'), tun(6, 'T6', 'l2tp', 'L2TP'),
      // I due che restano fuori: `ip-ip` è raro, `pptp` è morto. Entrano come
      // `other` con l'etichetta, che è il modo di dire «non lo so chiamare».
      tun(7, 'T7', 'ip-ip', 'IP-in-IP'), tun(8, 'T8', 'pptp', 'PPTP')],
    tunnelTerminations: [1, 2, 3, 4, 5, 6, 7, 8].flatMap(t => [tunt(t * 10, t, itf(10, 'a', VR), 'peer'), tunt(t * 10 + 1, t, itf(11, 'b', TN), 'peer')]),
  }, { siteIds: [1], siteOf });
  // ㉔ Un tunnel di NetBox finisce sull'asse TUNNEL, e il trasporto resta muto:
  // NetBox non dice su cosa quel tunnel corra, e inventarlo sarebbe proprio il
  // difetto che questo cambio esiste per togliere.
  assert.deepEqual(out.links.map(l => l.tunnel),
    ['ipsec', 'ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp', 'other', 'other']);
  assert.deepEqual(out.links.map(l => l.transport), new Array(8).fill(null));
  assert.deepEqual(out.links.slice(6).map(l => l.tunnelLabel), ['IP-in-IP', 'PPTP']);
  assert.deepEqual(out.links.slice(0, 6).map(l => l.tunnelLabel), [null, null, null, null, null, null],
    'con una natura vera l\'etichetta sarebbe la stessa cosa detta due volte');
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

test('㉒ il RUOLO delle terminazioni non diventa una forma sul collegamento', () => {
  // Prima di qui l'import leggeva hub+spoke sui due capi e scriveva
  // `topology: 'hub-and-spoke'` sul collegamento. È già un'interpretazione — la
  // forma d'insieme è una proprietà dell'INSIEME dei collegamenti di un
  // servizio, non di uno — e a valle serviva solo a un controllo che
  // confrontava quella parola con i ruoli delle SEDI, cioè a rincorrere una
  // copia. Il campo non c'è più, e questo banco tiene ferma la sua assenza.
  const base = (term) => vpnToLinks({
    tunnels: [{ id: 1, name: 'T', status: { value: 'active' }, encapsulation: { value: 'ipsec-tunnel' } }],
    tunnelTerminations: term,
  }, { siteIds: [1], siteOf }).links[0];
  const conRuoli = base([tunt(1, 1, itf(10, 'a', VR), 'hub'), tunt(2, 1, itf(11, 'b', TN), 'spoke')]);
  assert.equal(conRuoli.topology, undefined, 'nessuna forma dedotta sul singolo collegamento');
  // e il collegamento entra lo stesso, con tutto il resto: togliere un campo
  // non deve far cadere una riga (è la trappola del `case` mancante).
  assert.equal(conRuoli.tunnel, 'ipsec');
  assert.equal(conRuoli.name, 'T');
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

// ── ⑧ `reach`: le reti che il collegamento rende raggiungibili ───────────────
// Era il buco più grande dell'import: `reach` non lo riempiva NESSUNO, e due
// controlli dell'audit (`subnetsNowhere`, `subnetsNotCarried`) si dichiaravano
// ciechi con motivo `no-reach` su OGNI progetto importato — una copertura che
// valeva sempre zero. Adesso si legge dove l'archivio lo dichiara, e SOLO lì.

const vlan = (id, name) => ({ id, name, display: name });
const V_VR = vlan(300, 'VLAN300-VR'), V_TN = vlan(400, 'VLAN400-TN'), V_VR2 = vlan(301, 'VLAN301-VR');
const l2tv = (id, l2vpn, v) => ({ id, l2vpn: { id: l2vpn }, assigned_object_type: 'ipam.vlan', assigned_object: v });
// Le VLAN stanno in una sede come gli apparati; le reti le dichiarano i prefissi
// che le citano (in NetBox un prefisso porta il campo `vlan`).
const SEDI_VLAN = { 300: SEDI[171], 301: SEDI[171], 400: SEDI[172] };
const siteOfAll = (h) => h ? (h.kind === 'device' ? SEDI[h.id] || null
  : h.kind === 'vlan' ? SEDI_VLAN[h.id] || null : null) : null;
const RETI = { 300: ['10.30.0.0/24'], 301: ['10.31.0.0/24', '10.30.0.0/24'], 400: ['10.40.0.0/24', '10.41.0.0/24'] };
const netsOf = (h) => (h && h.kind === 'vlan' ? RETI[h.id] || null : null);
const vpls = (id, name) => ({ id, name, type: { value: 'vpls', label: 'VPLS' }, status: { value: 'active' } });

test('⑧ un servizio L2 appeso a una VLAN porta le reti che l\'archivio dichiara, al capo GIUSTO', () => {
  const out = vpnToLinks({
    l2vpns: [vpls(1, 'VPLS-VR-TN')],
    l2vpnTerminations: [l2tv(1, 1, V_VR), l2tv(2, 1, V_TN)],
  }, { siteIds: [1], siteOf: siteOfAll, netsOf });
  const l = out.links[0];
  // ⚠️ Le reti NON si incrociano, a differenza degli indirizzi (②): quelle di A
  // stanno presso A. Se si incrociassero, `linkReachAt` risponderebbe al
  // contrario e nessuno a valle potrebbe accorgersene — due liste plausibili
  // nei due campi sbagliati.
  assert.deepEqual([l.aNetboxSiteName, l.bNetboxSiteName], ['Verona HQ', 'Trento Filiale']);
  assert.deepEqual(l.aReach, ['10.30.0.0/24'], 'le reti di Verona stanno sul capo di Verona');
  assert.deepEqual(l.bReach, ['10.40.0.0/24', '10.41.0.0/24']);
});

test('⑧ due VLAN nella STESSA sede si UNISCONO, senza doppioni', () => {
  // Fermarsi al primo capo farebbe accusare le reti dell'altro di «non
  // trasportate»: un'accusa FALSA, che è l'errore peggiore di questo audit.
  const out = vpnToLinks({
    l2vpns: [vpls(1, 'VPLS-2VLAN')],
    l2vpnTerminations: [l2tv(1, 1, V_VR), l2tv(2, 1, V_VR2), l2tv(3, 1, V_TN)],
  }, { siteIds: [1], siteOf: siteOfAll, netsOf });
  assert.equal(out.links.length, 1, 'due VLAN in una sede restano DUE capi di UNA sede, non due sedi');
  // 10.30.0.0/24 è dichiarata da tutt'e due le VLAN: compare una volta sola.
  assert.deepEqual(out.links[0].aReach, ['10.30.0.0/24', '10.31.0.0/24']);
});

test('⑧ ⛔ un TUNNEL non porta reach: NetBox non modella l\'encryption domain', () => {
  // ⚠️ Questa è la guardia contro l'INVENZIONE, e vale più delle altre. Misurato
  // su NetBox 4.6.7 (OPTIONS su /api/vpn/tunnels/): i campi sono `encapsulation`,
  // `ipsec_profile`, `tunnel_id` — cifratura e incapsulamento — e NESSUNO parla
  // di reti protette. Dedurle dalle reti della sede sarebbe inventare il campo
  // perno di tutta la discovery. Resta vuoto, ed è la verità.
  const out = vpnToLinks({
    tunnels: [{ id: 1, name: 'IPSEC-VR-TN', status: { value: 'active' }, encapsulation: { value: 'ipsec-tunnel' } }],
    tunnelTerminations: [tunt(1, 1, itf(10, 'Gi0/1', VR), 'peer', '203.0.113.1/32'),
                         tunt(2, 1, itf(11, 'Gi0/1', TN), 'peer', '198.51.100.1/32')],
  }, { siteIds: [1], siteOf: siteOfAll, netsOf });
  const l = out.links[0];
  assert.equal(l.tunnel, 'ipsec', 'il tunnel entra: è solo `reach` che non si può sapere');
  assert.equal(l.aReach, null);
  assert.equal(l.bReach, null);
});

test('⑧ una VLAN senza prefissi dà `null`, non una lista vuota', () => {
  // «Non lo sappiamo» e «non ne raggiunge nessuna» sono due risposte diverse, e a
  // valle nessuno le rimette insieme (`linkReach` in lib/inter-site.js).
  const V_MUTA = vlan(999, 'VLAN-SENZA-PREFISSI');
  const out = vpnToLinks({
    l2vpns: [vpls(1, 'VPLS-MUTO')],
    l2vpnTerminations: [l2tv(1, 1, V_MUTA), l2tv(2, 1, V_TN)],
  }, { siteIds: [1],
       siteOf: (h) => (h && h.kind === 'vlan' ? (h.id === 999 ? SEDI[171] : SEDI_VLAN[h.id] || null) : null),
       netsOf });
  const l = out.links[0];
  assert.equal(l.aReach, null, 'nessuna rete dichiarata ⇒ null, mai []');
  assert.deepEqual(l.bReach, ['10.40.0.0/24', '10.41.0.0/24'], 'e l\'altro capo resta pieno');
});

test('⑧ senza `netsOf` il modulo non cambia comportamento (chiamanti vecchi)', () => {
  const out = vpnToLinks({
    l2vpns: [vpls(1, 'VPLS-VR-TN')],
    l2vpnTerminations: [l2tv(1, 1, V_VR), l2tv(2, 1, V_TN)],
  }, { siteIds: [1], siteOf: siteOfAll });
  assert.equal(out.links[0].aReach, null);
  assert.equal(out.links[0].bReach, null);
});

test('⑧ un capo su APPARATO non porta reach: l\'archivio non lo dichiara', () => {
  // Un'interfaccia ha degli indirizzi, ma l'indirizzo di un capo NON è la rete
  // che quel capo rende raggiungibile: sarebbe la stessa invenzione del tunnel,
  // travestita da lettura.
  const out = vpnToLinks({
    l2vpns: [vpls(1, 'VPLS-SU-PORTE')],
    l2vpnTerminations: [l2t(1, 1, itf(10, 'Gi1/0/23', VR)), l2t(2, 1, itf(11, 'Gi0/2', TN))],
  }, { siteIds: [1], siteOf: siteOfAll, netsOf });
  assert.equal(out.links[0].aReach, null);
  assert.equal(out.links[0].bReach, null);
});

// ── ⑧ `netsByVlan`: i prefissi di NetBox → le reti dichiarate per ogni VLAN ──
// ⚠️ Questa funzione si guasta in SILENZIO: se sbaglia, «nessuna rete» si legge
// identico all'onesto «l'archivio non lo dichiara» — cioè proprio la risposta
// che tutto questo lavoro doveva togliere di mezzo. Per questo non sta nella
// rotta, dove nessuna prova la raggiunge.
const { netsByVlan } = require('../lib/dcim-vpn.js');
const pfx = (id, prefix, vlanId, status) => ({
  id, prefix, vlan: vlanId == null ? null : { id: vlanId, vid: vlanId, name: 'V' + vlanId },
  status: status ? { value: status, label: status } : { value: 'active', label: 'Active' },
});

test('⑧ i prefissi si raggruppano per VLAN, e chi non ne ha una resta fuori', () => {
  const m = netsByVlan([
    pfx(1, '10.10.20.0/24', 201),
    pfx(2, '2001:db8:10::/64', 201),
    pfx(3, '10.20.120.0/24', 211),
    pfx(4, '192.168.99.0/24', null),   // rete di servizio senza VLAN: non è di nessuno
  ]);
  assert.deepEqual(m['201'], ['10.10.20.0/24', '2001:db8:10::/64'], 'IPv4 e IPv6 insieme: sono due reti dichiarate');
  assert.deepEqual(m['211'], ['10.20.120.0/24']);
  assert.equal(Object.keys(m).length, 2, 'un prefisso senza VLAN non inventa una chiave');
});

test('⑧ un prefisso `deprecated` non entra: è una dichiarazione RITIRATA', () => {
  // ⚠️ E solo quello. Un `container` è una FORMA di voce (una supernet), non uno
  // stato: chi l'ha appeso a quella VLAN l'ha appeso apposta, e toglierlo
  // vorrebbe dire decidere al posto suo.
  const m = netsByVlan([
    pfx(1, '10.10.0.0/16', 201, 'container'),
    pfx(2, '10.10.20.0/24', 201, 'active'),
    pfx(3, '10.10.99.0/24', 201, 'deprecated'),
    pfx(4, '10.10.98.0/24', 201, 'reserved'),
  ]);
  assert.deepEqual(m['201'], ['10.10.0.0/16', '10.10.20.0/24', '10.10.98.0/24']);
});

test('⑧ lo stesso prefisso scritto due volte sulla stessa VLAN compare una volta', () => {
  const m = netsByVlan([pfx(1, '10.10.20.0/24', 201), pfx(2, '10.10.20.0/24', 201)]);
  assert.deepEqual(m['201'], ['10.10.20.0/24']);
});

test('⑧ `netsByVlan` non ordina: ordina chi normalizza, e una volta sola', () => {
  // Due ordinamenti con due regole diverse sono il modo di non sapere più quale
  // vince. `normalizeSubnets` (lib/inter-site.js) ordina da sé, all'ingresso nel
  // modello.
  const m = netsByVlan([pfx(1, '10.30.0.0/24', 7), pfx(2, '10.10.0.0/24', 7)]);
  assert.deepEqual(m['7'], ['10.30.0.0/24', '10.10.0.0/24'], 'resta l\'ordine di NetBox');
});

test('⑧ una lista assurda, vuota o assente non esplode e non inventa', () => {
  // ⚠️ Si guardano le CHIAVI e non l'oggetto: la mappa nasce senza prototipo
  // (`Object.create(null)`), quindi `deepEqual` con un `{}` normale fallisce pur
  // essendo la stessa cosa. Il prototipo assente è voluto — le chiavi qui sono
  // dati che arrivano da fuori, e una mappa che risponde da sola a `toString` o a
  // `__proto__` è il modo classico di far dire a un lookup una cosa che non c'è.
  const vuoto = (v) => assert.deepEqual(Object.keys(netsByVlan(v)), []);
  vuoto(null); vuoto(undefined); vuoto([]); vuoto('niente');
  vuoto([null, 3, 'x', {}, { prefix: '10.0.0.0/8' }, { vlan: { id: 1 } }]);
  assert.equal(Object.getPrototypeOf(netsByVlan([])), null, 'nessun prototipo, di proposito');
});

test('⑧ la VLAN si legge sia come oggetto sia come id nudo', () => {
  // NetBox espande la chiave esterna in lettura; chi scrive manda l'id nudo. Il
  // mock fa la stessa cosa, quindi il lettore deve reggere tutt'e due.
  const m = netsByVlan([{ id: 1, prefix: '10.1.0.0/24', vlan: 55 }, pfx(2, '10.2.0.0/24', 55)]);
  assert.deepEqual(m['55'], ['10.1.0.0/24', '10.2.0.0/24']);
});
