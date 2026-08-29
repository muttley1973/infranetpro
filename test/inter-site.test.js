'use strict';
// ============================================================
// INTER-SEDE — test del modello multi-sede, Fase 0 (lib/inter-site.js).
//
// Le invarianti che questo modulo deve difendere:
//   ② no-invenzioni — un `kind` fuori vocabolario si RIFIUTA, non si corregge;
//      `reach` assente ≠ nessuna subnet; una subnet in due sedi resta ambigua;
//   ③ vendor-neutral — `reach` è UN concetto per tutti i `kind` (su un ipsec è
//      l'encryption domain), e nessun campo nomina un vendor;
//   · l'envelope sta SOLO sui campi misurabili (⚠️ cirMbps è contrattuale, mai ifSpeed);
//   · `state` non ha il valore 'declared': chi lo afferma è l'ORIGINE del fatto;
//   · le subnet si canonicalizzano con lib/cidr — mai confronti per stringa nuda;
//   · un dato reale e sbagliato (capo verso una sede inesistente) NON si nasconde.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const IS = require('../lib/inter-site.js');
const { factDeclared, factMeasured, factDerived } = require('../lib/provenance.js');

const {
  SITE_ROLES, INTER_SITE_KINDS, INTER_SITE_TOPOLOGIES, INTER_SITE_STATES,
  normalizeSubnets, normalizeSite, normalizeWanUplink, normalizeInterSiteLink,
  normalizeOrganization,
  linkSites, linkPeerSite, linkReach, linkReachAt,
  uplinksOfSite, linksOfSite, siteById,
  subnetSiteIndex, siteOfSubnet,
} = IS;

const AT = '2026-08-28T00:00:00.000Z';

const ipsec = (over) => Object.assign({
  id: 'l1', aSiteId: 'hq', bSiteId: 'rm', kind: 'ipsec',
}, over || {});

// ── Vocabolari chiusi ──────────────────────────────────────────────────────
test('i vocabolari sono chiusi e contengono esattamente ciò che è stato deciso', () => {
  assert.deepStrictEqual(SITE_ROLES, ['hub', 'spoke', 'standalone']);
  // ⑨ `other` in FONDO: la porta di servizio non sta fra le scelte precise.
  // ⑲ L'ordine È il contenuto: è quello che si legge nella tendina, e cambiarlo
  // per sbaglio riordinerebbe un menu senza che nessuno se ne accorga.
  assert.deepStrictEqual(INTER_SITE_KINDS, [
    'ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp',
    'mpls', 'vpls', 'vpws', 'vxlan', 'evpn',
    'sdwan', 'directLink', 'other',
  ]);
  assert.equal(INTER_SITE_KINDS[INTER_SITE_KINDS.length - 1], 'other', 'other in fondo');
  assert.deepStrictEqual(INTER_SITE_TOPOLOGIES, ['hub-and-spoke', 'mesh']);
  // ③ 'declared' NON è uno stato: è un'origine. Vedi la scelta ③ del modulo.
  assert.deepStrictEqual(INTER_SITE_STATES, ['up', 'down']);
});

// ── Subnet: canonicalizzazione, non confronto per stringa ──────────────────
test('le subnet si canonicalizzano con lib/cidr (host bits, netmask, spazi)', () => {
  assert.deepStrictEqual(
    normalizeSubnets(['10.1.0.5/24', ' 192.168.1.0/255.255.255.0 ', '2001:db8::/48']),
    ['10.1.0.0/24', '192.168.1.0/24', '2001:db8::/48']);
});

test('la stessa rete scritta in due modi è UNA subnet sola', () => {
  assert.deepStrictEqual(normalizeSubnets(['10.1.0.0/24', '10.1.0.7/24']), ['10.1.0.0/24']);
});

test('② ciò che non è una subnet cade, non viene indovinato', () => {
  assert.deepStrictEqual(normalizeSubnets(['garbage', '', null, undefined, {}, '10.1.0.0/24']),
    ['10.1.0.0/24']);
  assert.deepStrictEqual(normalizeSubnets(null), []);
  assert.deepStrictEqual(normalizeSubnets('10.1.0.0/24'), [], 'una stringa non è una lista');
});

// ── Sede ───────────────────────────────────────────────────────────────────
test('una sede senza id o senza nome non entra', () => {
  assert.strictEqual(normalizeSite(null), null);
  assert.strictEqual(normalizeSite({ name: 'HQ' }), null);
  assert.strictEqual(normalizeSite({ id: 'hq' }), null);
  assert.strictEqual(normalizeSite({ id: '  ', name: 'HQ' }), null);
});

test('una sede normalizza ruolo, riferimento al progetto e subnet', () => {
  assert.deepStrictEqual(
    normalizeSite({ id: ' hq ', name: ' Milano ', role: 'hub', projectRef: 'p-1', subnets: ['10.1.0.9/24'] }),
    { id: 'hq', name: 'Milano', role: 'hub', projectRef: 'p-1', address: null, subnets: ['10.1.0.0/24'] });
});

test('② un ruolo fuori vocabolario non si corregge in silenzio: standalone', () => {
  assert.strictEqual(normalizeSite({ id: 'x', name: 'X', role: 'HUB' }).role, 'standalone');
  assert.strictEqual(normalizeSite({ id: 'x', name: 'X', role: 'primario' }).role, 'standalone');
});

test('① il progetto-sede è un RIFERIMENTO, non una copia', () => {
  const s = normalizeSite({ id: 'hq', name: 'Milano', projectRef: 'p-1' });
  assert.strictEqual(s.projectRef, 'p-1');
  assert.ok(!('project' in s) && !('nodes' in s), 'la sede non porta dentro il progetto');
});

// ── Uplink WAN ─────────────────────────────────────────────────────────────
test('un uplink senza sede non entra', () => {
  assert.strictEqual(normalizeWanUplink({ id: 'u1' }), null);
  assert.strictEqual(normalizeWanUplink({ siteId: 'hq' }), null);
});

test('④ i campi dichiarati-per-costruzione restano nudi, i misurabili sono envelope', () => {
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq',
    provider: 'Acme', serviceType: 'fiber', circuitId: 'CID-9', cirMbps: '100', slaRef: 'SLA-A',
    publicIps: factMeasured(['203.0.113.7'], AT),
    wanIfRef: factDeclared('wan1'),
  });
  // dichiarati: nudi — un envelope qui direbbe una cosa in più che non c'è
  assert.strictEqual(u.provider, 'Acme');
  assert.strictEqual(u.circuitId, 'CID-9');
  assert.strictEqual(u.slaRef, 'SLA-A');
  // ⚠️ banda CONTRATTUALE, non ifSpeed
  assert.strictEqual(u.cirMbps, 100);
  // misurabili: envelope intatto, con la sua origine
  assert.deepStrictEqual(u.publicIps, { origin: 'measured', value: ['203.0.113.7'], at: AT });
  assert.deepStrictEqual(u.wanIfRef, { origin: 'declared', value: 'wan1' });
});

test('② un valore NUDO su un campo misurabile non viene promosso a fatto', () => {
  const u = normalizeWanUplink({ id: 'u1', siteId: 'hq', publicIps: ['203.0.113.7'] });
  assert.strictEqual(u.publicIps, null, 'senza envelope non sappiamo da dove viene: null');
});

// ── ⑦ Gli indirizzi pubblici sono PIÙ DI UNO ───────────────────────────────
test('⑦ un uplink porta un BLOCCO instradato, l\'IPv6 e gli indirizzi dei nodi', () => {
  // I tre casi ordinari per cui un campo solo era falso: la /29 del contratto,
  // l'IPv6 sulla stessa linea, e la coppia in HA con il suo VIP.
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq',
    publicIps: factDeclared(['203.0.113.8/29', '2001:db8:1::1', '203.0.113.10', '203.0.113.11']),
  });
  assert.deepStrictEqual(u.publicIps.value,
    ['203.0.113.8/29', '2001:db8:1::1', '203.0.113.10', '203.0.113.11']);
});

test('⑦ un INDIRIZZO non diventa la sua rete', () => {
  // La trappola vera: passare un indirizzo per `subnetInputToCidr` lo
  // trasformerebbe in `203.0.113.0/24` — un altro fatto, e molto più grande.
  const u = normalizeWanUplink({ id: 'u1', siteId: 'hq', publicIps: factDeclared(['203.0.113.10']) });
  assert.deepStrictEqual(u.publicIps.value, ['203.0.113.10']);
});

test('⑦ un blocco SÌ si canonicalizza come rete, e i doppioni cadono', () => {
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq',
    publicIps: factDeclared(['203.0.113.9/29', '203.0.113.8/29', 'non-un-indirizzo', '']),
  });
  assert.deepStrictEqual(u.publicIps.value, ['203.0.113.8/29'], 'stessa rete scritta in due modi = una');
});

test('⑦ l\'ORDINE dichiarato si conserva: il primo è l\'indirizzo dell\'interfaccia', () => {
  // A differenza delle subnet, che si ordinano: qui l'ordine è una convenzione
  // di chi scrive, e riordinare per fare pulizia la cancellerebbe in silenzio.
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq', publicIps: factDeclared(['203.0.113.90', '203.0.113.10']),
  });
  assert.deepStrictEqual(u.publicIps.value, ['203.0.113.90', '203.0.113.10']);
});

test('⑦ il vecchio campo singolare `publicIp` non si perde: diventa il primo della lista', () => {
  // Retro-compatibilità a senso unico, e l'origine e la data NON cambiano:
  // migrare la forma di un valore non deve cambiare ciò che si sa di lui.
  const u = normalizeWanUplink({ id: 'u1', siteId: 'hq', publicIp: factMeasured('203.0.113.7', AT) });
  assert.deepStrictEqual(u.publicIps, { origin: 'measured', value: ['203.0.113.7'], at: AT });
  assert.ok(!('publicIp' in u), 'il campo vecchio non sopravvive accanto al nuovo');
});

test('cirMbps non numerico è null, non 0 (0 Mbps sarebbe un\'affermazione)', () => {
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: 'cento' }).cirMbps, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: '' }).cirMbps, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: 0 }).cirMbps, 0);
});

// ── Collegamento inter-sede ────────────────────────────────────────────────
test('⑤ un kind fuori vocabolario si RIFIUTA, non si corregge', () => {
  // ⑲ `pptp` è un incapsulamento VERO di NetBox tenuto deliberatamente FUORI
  // dal nostro vocabolario: è l'esempio giusto di «rifiutato», non un nome
  // inventato che nessuno scriverebbe mai.
  assert.strictEqual(normalizeInterSiteLink(ipsec({ kind: 'pptp' })), null);
  assert.strictEqual(normalizeInterSiteLink(ipsec({ kind: 'IPSEC' })), null);
  assert.strictEqual(normalizeInterSiteLink(ipsec({ kind: undefined })), null);
});

test('un collegamento senza id o senza uno dei due capi non entra', () => {
  assert.strictEqual(normalizeInterSiteLink(ipsec({ id: '' })), null);
  assert.strictEqual(normalizeInterSiteLink(ipsec({ aSiteId: '' })), null);
  assert.strictEqual(normalizeInterSiteLink(ipsec({ bSiteId: '' })), null);
});

test('una sede non si collega a sé stessa: non è inter-sede', () => {
  assert.strictEqual(normalizeInterSiteLink(ipsec({ aSiteId: 'hq', bSiteId: 'hq' })), null);
});

test('ogni kind porta i suoi campi propri, e solo quelli', () => {
  const l = normalizeInterSiteLink(ipsec({
    endpointA: { deviceRef: 'fw-hq', peerIp: '198.51.100.1' },
    endpointB: { deviceRef: 'fw-rm', peerIp: '198.51.100.2' },
    phase1Name: 'HQ-to-RM', ikeVersion: 2,
  }));
  assert.strictEqual(l.kind, 'ipsec');
  assert.deepStrictEqual(l.endpointA, { deviceRef: 'fw-hq', deviceName: null, peerIp: '198.51.100.1' });
  assert.strictEqual(l.phase1Name, 'HQ-to-RM');
  assert.strictEqual(l.ikeVersion, 2);

  const m = normalizeInterSiteLink({ id: 'l2', aSiteId: 'hq', bSiteId: 'na', kind: 'mpls', vrf: 'CORP', service: 'L3VPN' });
  assert.strictEqual(m.vrf, 'CORP');
  assert.ok(!('phase1Name' in m) && !('ikeVersion' in m), 'niente campi ipsec su un mpls');

  const s = normalizeInterSiteLink({ id: 'l3', aSiteId: 'hq', bSiteId: 'na', kind: 'sdwan', overlay: 'ov1', underlayUplinkIds: ['u1', '', 'u2'] });
  assert.deepStrictEqual(s.underlayUplinkIds, ['u1', 'u2']);

  const d = normalizeInterSiteLink({ id: 'l4', aSiteId: 'hq', bSiteId: 'na', kind: 'directLink', media: 'fibra' });
  assert.strictEqual(d.media, 'fibra');
});

test('⑥ i due capi valgono per OGNI kind, non solo per l\'IPsec', () => {
  // «Su quale apparato arriva questo collegamento» non è una domanda sulla
  // crittografia: su un MPLS o un VPLS il capo è il CE, che sta in un rack e ha
  // delle porte come tutti gli altri. Quando i capi vivevano solo su `ipsec`, la
  // domanda era inesprimibile proprio sui collegamenti d'operatore — cioè su
  // quelli dove serve di più, perché la scatola spesso non l'hai configurata tu.
  for (const kind of ['mpls', 'vpls', 'sdwan', 'directLink']) {
    const l = normalizeInterSiteLink({
      id: 'l-' + kind, aSiteId: 'hq', bSiteId: 'na', kind,
      endpointA: { deviceRef: 'ce-hq', peerIp: '10.255.0.1' },
      endpointB: { deviceRef: 'ce-na', peerIp: null },
    });
    assert.deepStrictEqual(l.endpointA, { deviceRef: 'ce-hq', deviceName: null, peerIp: '10.255.0.1' }, kind);
    assert.deepStrictEqual(l.endpointB, { deviceRef: 'ce-na', deviceName: null, peerIp: null }, kind);
  }
});

test('⑥ un collegamento senza capi dichiarati porta due capi VUOTI, non l\'assenza del campo', () => {
  // La forma è sempre la stessa: chi legge non deve difendersi da `undefined`,
  // e «non l'ho detto» si vede come `null` dentro un capo che c'è.
  const l = normalizeInterSiteLink({ id: 'x', aSiteId: 'hq', bSiteId: 'na', kind: 'vpls' });
  assert.deepStrictEqual(l.endpointA, { deviceRef: null, deviceName: null, peerIp: null });
  assert.deepStrictEqual(l.endpointB, { deviceRef: null, deviceName: null, peerIp: null });
});

// ── ⑨ La porta di servizio: `other` + le parole di chi documenta ───────────
test('⑨ un collegamento che non è nessuno dei cinque si documenta come `other`', () => {
  // Il caso vero: un ponte radio d'operatore, o un servizio che non rientra
  // nelle cinque nature. Prima bisognava mentire (scegliere «directLink») o
  // perdere la riga; adesso il software sa di NON sapere, e le parole le mette
  // chi documenta.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'other', kindLabel: 'FWA punto-punto',
  });
  assert.strictEqual(l.kind, 'other');
  assert.strictEqual(l.kindLabel, 'FWA punto-punto');
});

test('⑨ `other` è un collegamento come gli altri: capi, reach e stato ci sono tutti', () => {
  // Nessun ramo di codice ragiona su `other`: se perdesse i campi comuni,
  // sarebbe una seconda classe di collegamento invece di un nome mancante.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'other',
    state: factDeclared('up'), reach: factDeclared({ a: ['10.1.0.0/24'], b: [] }),
    endpointA: { deviceName: 'antenna tetto' },
  });
  assert.deepStrictEqual(linkReachAt(l, 'hq'), ['10.1.0.0/24']);
  assert.strictEqual(l.endpointA.deviceName, 'antenna tetto');
  assert.strictEqual(l.state.value, 'up');
});

test('⑩ operatore e codice del circuito valgono per OGNI kind, e restano nudi', () => {
  // Stessa lezione della ⑥: una domanda che è la stessa per tutte le nature si
  // modella una volta sola. Senza, un circuito inter-sede letto dal DCIM entrava
  // perdendo per strada le due cose che lo identificano.
  for (const kind of ['ipsec', 'mpls', 'vpls', 'sdwan', 'directLink', 'other']) {
    const l = normalizeInterSiteLink({
      id: 'l', aSiteId: 'a', bSiteId: 'b', kind,
      provider: '  CenturyLink ', circuitId: 'DEOW4921',
    });
    assert.strictEqual(l.provider, 'CenturyLink', kind + ': lo spazio in più non è un operatore diverso');
    assert.strictEqual(l.circuitId, 'DEOW4921', kind);
  }
  // ④ Sono DICHIARAZIONI per costruzione: nessun envelope, come sull'uplink.
  const nudo = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' });
  assert.strictEqual(nudo.provider, null, '«non c\'è un operatore» è una risposta');
  assert.strictEqual(nudo.circuitId, null);
});

test('⑪ un collegamento ha un NOME, e non è la sua natura', () => {
  // Un GRE letto da NetBox si chiama «GRE-LAB» ed È un GRE: due fatti diversi,
  // due campi. Prima il nome non aveva dove andare e andava perso — e due
  // tunnel fra le stesse due sedi diventavano indistinguibili.
  const l = normalizeInterSiteLink({
    id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'other',
    name: '  GRE-LAB ', kindLabel: 'GRE',
  });
  assert.strictEqual(l.name, 'GRE-LAB');
  assert.strictEqual(l.kindLabel, 'GRE');
  // Vale per OGNI natura, non solo per `other`.
  for (const kind of ['ipsec', 'mpls', 'vpls', 'sdwan', 'directLink']) {
    assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind, name: 'X' }).name, 'X', kind);
  }
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' }).name, null);
});

test('⑨ l\'etichetta può mancare: «non so come chiamarlo» è già un\'informazione', () => {
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'other' }).kindLabel, null);
});

test('⑨ la porta di servizio NON apre il vocabolario: un kind inventato resta rifiutato', () => {
  // È la differenza fra `other` e una stringa libera: quest'ultima avrebbe rotto
  // in silenzio traduzioni, icone e ogni futura logica per-natura.
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'eolo' }), null);
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'Other' }), null);
});

// ── ⑧ L'apparato di un capo: riferimento OPPURE nome scritto a mano ────────
test('⑧ un apparato che nel progetto non c\'è si può scrivere a mano', () => {
  // Il caso vero: il CE di un MPLS è spesso la scatola dell'operatore, che
  // nessuno ha documentato come nodo. Obbligare a sceglierlo da un elenco
  // avrebbe reso impossibile documentare proprio il collegamento d'operatore.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'mpls',
    endpointA: { deviceName: 'CE Fastweb (rack 2)' },
  });
  assert.deepStrictEqual(l.endpointA, { deviceRef: null, deviceName: 'CE Fastweb (rack 2)', peerIp: null });
});

test('⑧ riferimento e nome a mano si ESCLUDONO: se c\'è il nodo, il nome lo dà il progetto', () => {
  // Tenerli tutti e due sarebbe una seconda definizione dello stesso nome, che
  // diverge al primo rinomino del nodo.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'ipsec',
    endpointA: { deviceRef: 'n_abc', deviceName: 'un nome vecchio' },
  });
  assert.strictEqual(l.endpointA.deviceRef, 'n_abc');
  assert.strictEqual(l.endpointA.deviceName, null, 'il riferimento vince, il nome copiato cade');
});

test('ikeVersion accetta solo 1 o 2', () => {
  const ike = (v) => normalizeInterSiteLink(ipsec({ ikeVersion: v })).ikeVersion;
  assert.strictEqual(ike(1), 1);
  assert.strictEqual(ike('2'), 2);
  assert.strictEqual(ike(3), null);
  assert.strictEqual(ike('ikev2'), null);
});

// ── state: il valore dice COSA, l'envelope dice CHI lo afferma ─────────────
test('③ uno stato dichiarato e uno misurato hanno lo STESSO valore, origine diversa', () => {
  const dec = normalizeInterSiteLink(ipsec({ state: factDeclared('up') }));
  const mea = normalizeInterSiteLink(ipsec({ state: factMeasured('up', AT) }));
  assert.deepStrictEqual(dec.state, { origin: 'declared', value: 'up' });
  assert.deepStrictEqual(mea.state, { origin: 'measured', value: 'up', at: AT });
});

test('② uno stato fuori vocabolario, o nudo, non entra', () => {
  for (const bad of [factDeclared('flapping'), factDeclared('declared'), 'up', null, factDeclared(null)]) {
    assert.strictEqual(normalizeInterSiteLink(ipsec({ state: bad })).state, null);
  }
});

test('`state` assente ≠ giù: è «non pronunciato»', () => {
  assert.strictEqual(normalizeInterSiteLink(ipsec({})).state, null);
});

// ── reach: UN concetto per tutti i kind ────────────────────────────────────
test('② reach canonicalizza le subnet dei due capi, mantenendo l\'origine', () => {
  const l = normalizeInterSiteLink(ipsec({
    reach: factMeasured({ a: ['10.1.0.9/24', '10.1.0.0/24'], b: ['10.2.0.0/255.255.255.0'] }, AT),
  }));
  assert.deepStrictEqual(l.reach, {
    origin: 'measured', at: AT,
    value: { a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] },
  });
});

test('③ reach è lo stesso concetto su ogni kind (su un ipsec È l\'encryption domain)', () => {
  const r = factDeclared({ a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] });
  for (const kind of INTER_SITE_KINDS) {
    const l = normalizeInterSiteLink({ id: 'l', aSiteId: 'hq', bSiteId: 'rm', kind, reach: r });
    assert.deepStrictEqual(linkReach(l), { a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] },
      `reach deve leggersi allo stesso modo su ${kind}`);
  }
});

test('② reach ASSENTE non è «nessuna subnet»: la distinzione resta leggibile', () => {
  const l = normalizeInterSiteLink(ipsec({}));
  assert.strictEqual(l.reach, null, 'il campo dice «non lo sappiamo»');
  assert.deepStrictEqual(linkReach(l), { a: [], b: [] }, 'l\'accessore dà una forma usabile');
});

test('reach preserva anche l\'origine `derived`', () => {
  const l = normalizeInterSiteLink(ipsec({ reach: factDerived({ a: ['10.1.0.0/24'], b: [] }, 'inetCidrRouteTable') }));
  assert.strictEqual(l.reach.origin, 'derived');
  assert.strictEqual(l.reach.from, 'inetCidrRouteTable');
});

// ── Accessori neutri ───────────────────────────────────────────────────────
test('linkSites, linkPeerSite e linkReachAt rispondono per capo, non per «locale/remoto»', () => {
  const l = normalizeInterSiteLink(ipsec({
    reach: factDeclared({ a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] }),
  }));
  assert.deepStrictEqual(linkSites(l), ['hq', 'rm']);
  assert.strictEqual(linkPeerSite(l, 'hq'), 'rm');
  assert.strictEqual(linkPeerSite(l, 'rm'), 'hq');
  assert.strictEqual(linkPeerSite(l, 'na'), null, 'una sede non toccata non ha un «altro capo»');
  assert.deepStrictEqual(linkReachAt(l, 'hq'), ['10.1.0.0/24']);
  assert.deepStrictEqual(linkReachAt(l, 'rm'), ['10.2.0.0/24']);
  assert.deepStrictEqual(linkReachAt(l, 'na'), []);
});

test('gli accessori reggono il null senza esplodere', () => {
  assert.deepStrictEqual(linkSites(null), []);
  assert.strictEqual(linkPeerSite(null, 'hq'), null);
  assert.deepStrictEqual(linkReach(null), { a: [], b: [] });
  assert.deepStrictEqual(linkReachAt(null, 'hq'), []);
  assert.deepStrictEqual(uplinksOfSite(null, 'hq'), []);
  assert.deepStrictEqual(linksOfSite(null, 'hq'), []);
  assert.strictEqual(siteById(null, 'hq'), null);
  assert.deepStrictEqual(Object.keys(subnetSiteIndex(null)), []);
  assert.strictEqual(siteOfSubnet(null, '10.1.0.0/24'), null);
});

// ── Organizzazione: le 3 sedi da cui è nata InfraNet ───────────────────────
const ORG = {
  id: 'org-1', name: 'Acme',
  sites: [
    { id: 'hq', name: 'Milano', role: 'hub', projectRef: 'p-mi', subnets: ['10.1.0.0/24'] },
    { id: 'rm', name: 'Roma', role: 'spoke', projectRef: 'p-rm', subnets: ['10.2.0.0/24'] },
    { id: 'na', name: 'Napoli', role: 'spoke', projectRef: 'p-na', subnets: ['10.3.0.0/24'] },
    { name: 'senza id' },
  ],
  uplinks: [
    { id: 'u-hq', siteId: 'hq', provider: 'Acme Fiber', cirMbps: 200 },
    { id: 'u-rm', siteId: 'rm', provider: 'Acme Fiber', cirMbps: 100 },
    { siteId: 'na' },
  ],
  links: [
    { id: 'hq-rm', aSiteId: 'hq', bSiteId: 'rm', kind: 'ipsec', topology: 'hub-and-spoke', state: factMeasured('up', AT), reach: factDeclared({ a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] }) },
    { id: 'hq-na', aSiteId: 'hq', bSiteId: 'na', kind: 'ipsec', topology: 'hub-and-spoke', state: factDeclared('up') },
    { id: 'nope', aSiteId: 'hq', bSiteId: 'rm', kind: 'pptp' },
  ],
};

test('l\'organizzazione normalizza le tre liste e scarta ciò che non è modellabile', () => {
  const org = normalizeOrganization(ORG);
  assert.strictEqual(org.name, 'Acme');
  assert.deepStrictEqual(org.sites.map(s => s.id), ['hq', 'rm', 'na']);
  assert.deepStrictEqual(org.uplinks.map(u => u.id), ['u-hq', 'u-rm']);
  assert.deepStrictEqual(org.links.map(l => l.id), ['hq-rm', 'hq-na']);
});

test('normalizeOrganization su un input vuoto o assurdo dà un\'organizzazione vuota', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.deepStrictEqual(normalizeOrganization(bad), { id: '', name: '', sites: [], uplinks: [], links: [] });
  }
});

test('un capo verso una sede INESISTENTE non viene nascosto (è un dato reale e sbagliato)', () => {
  const org = normalizeOrganization({
    sites: [{ id: 'hq', name: 'Milano' }],
    links: [{ id: 'orfano', aSiteId: 'hq', bSiteId: 'fantasma', kind: 'ipsec' }],
    uplinks: [{ id: 'u', siteId: 'fantasma' }],
  });
  assert.strictEqual(org.links.length, 1, 'il collegamento resta: la diagnostica è Fase 1');
  assert.strictEqual(org.uplinks.length, 1);
  assert.strictEqual(siteById(org, 'fantasma'), null);
});

test('uplinksOfSite e linksOfSite filtrano per sede, i collegamenti da entrambi i capi', () => {
  const org = normalizeOrganization(ORG);
  assert.deepStrictEqual(uplinksOfSite(org, 'hq').map(u => u.id), ['u-hq']);
  assert.deepStrictEqual(uplinksOfSite(org, 'na'), []);
  assert.deepStrictEqual(linksOfSite(org, 'hq').map(l => l.id), ['hq-rm', 'hq-na'], 'l\'hub li tocca entrambi');
  assert.deepStrictEqual(linksOfSite(org, 'rm').map(l => l.id), ['hq-rm'], 'lo spoke è il capo B');
  assert.strictEqual(siteById(org, 'rm').name, 'Roma');
});

// ── Subnet → sede ──────────────────────────────────────────────────────────
test('l\'indice subnet→sede usa il CIDR canonico come chiave', () => {
  const org = normalizeOrganization(ORG);
  const idx = subnetSiteIndex(org);
  assert.deepStrictEqual(Object.assign({}, idx), {
    '10.1.0.0/24': ['hq'], '10.2.0.0/24': ['rm'], '10.3.0.0/24': ['na'],
  });
  // L'indice è SENZA PROTOTIPO di proposito: è una tabella costruita da dati, e
  // una chiave `__proto__`/`constructor` in un oggetto normale non si comporta
  // come una chiave. Qui le chiavi sono CIDR canonici, quindi la difesa è
  // teorica — ma il costo è zero e la regola resta vera anche domani.
  assert.strictEqual(Object.getPrototypeOf(idx), null);
});

test('siteOfSubnet trova la sede scrivendo la subnet in QUALSIASI forma valida', () => {
  const org = normalizeOrganization(ORG);
  for (const form of ['10.2.0.0/24', '10.2.0.44/24', ' 10.2.0.0/255.255.255.0 ']) {
    assert.strictEqual(siteOfSubnet(org, form), 'rm', `doveva risolvere ${form}`);
  }
  assert.strictEqual(siteOfSubnet(org, '10.9.0.0/24'), null, 'una subnet che non sta da nessuna parte');
  assert.strictEqual(siteOfSubnet(org, 'garbage'), null);
});

test('② una subnet in DUE sedi resta ambigua: nessuno sceglie per te', () => {
  const org = normalizeOrganization({
    sites: [
      { id: 'hq', name: 'Milano', subnets: ['10.1.0.0/24'] },
      { id: 'rm', name: 'Roma', subnets: ['10.1.0.0/24'] },
    ],
  });
  assert.deepStrictEqual(subnetSiteIndex(org)['10.1.0.0/24'], ['hq', 'rm'], 'la sovrapposizione si VEDE');
  assert.strictEqual(siteOfSubnet(org, '10.1.0.0/24'), null, 'scegliere la prima sarebbe un ripiego');
});

// ── Purezza & persistenza ──────────────────────────────────────────────────
test('la normalizzazione non muta l\'input', () => {
  const before = JSON.stringify(ORG);
  normalizeOrganization(ORG);
  assert.strictEqual(JSON.stringify(ORG), before);
});

test('un\'organizzazione normalizzata è stabile al giro JSON e ri-normalizzabile', () => {
  const once = normalizeOrganization(ORG);
  const twice = normalizeOrganization(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice, once, 'normalizzare due volte deve dare lo stesso risultato');
});
