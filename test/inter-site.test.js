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
  assert.deepStrictEqual(INTER_SITE_KINDS, ['ipsec', 'mpls', 'vpls', 'sdwan', 'directLink']);
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
    publicIp: factMeasured('203.0.113.7', AT),
    wanIfRef: factDeclared('wan1'),
  });
  // dichiarati: nudi — un envelope qui direbbe una cosa in più che non c'è
  assert.strictEqual(u.provider, 'Acme');
  assert.strictEqual(u.circuitId, 'CID-9');
  assert.strictEqual(u.slaRef, 'SLA-A');
  // ⚠️ banda CONTRATTUALE, non ifSpeed
  assert.strictEqual(u.cirMbps, 100);
  // misurabili: envelope intatto, con la sua origine
  assert.deepStrictEqual(u.publicIp, { origin: 'measured', value: '203.0.113.7', at: AT });
  assert.deepStrictEqual(u.wanIfRef, { origin: 'declared', value: 'wan1' });
});

test('② un valore NUDO su un campo misurabile non viene promosso a fatto', () => {
  const u = normalizeWanUplink({ id: 'u1', siteId: 'hq', publicIp: '203.0.113.7' });
  assert.strictEqual(u.publicIp, null, 'senza envelope non sappiamo da dove viene: null');
});

test('cirMbps non numerico è null, non 0 (0 Mbps sarebbe un\'affermazione)', () => {
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: 'cento' }).cirMbps, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: '' }).cirMbps, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: 0 }).cirMbps, 0);
});

// ── Collegamento inter-sede ────────────────────────────────────────────────
test('⑤ un kind fuori vocabolario si RIFIUTA, non si corregge', () => {
  assert.strictEqual(normalizeInterSiteLink(ipsec({ kind: 'wireguard' })), null);
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
  assert.deepStrictEqual(l.endpointA, { deviceRef: 'fw-hq', peerIp: '198.51.100.1' });
  assert.strictEqual(l.phase1Name, 'HQ-to-RM');
  assert.strictEqual(l.ikeVersion, 2);

  const m = normalizeInterSiteLink({ id: 'l2', aSiteId: 'hq', bSiteId: 'na', kind: 'mpls', vrf: 'CORP', service: 'L3VPN' });
  assert.strictEqual(m.vrf, 'CORP');
  assert.ok(!('endpointA' in m) && !('phase1Name' in m), 'niente campi ipsec su un mpls');

  const s = normalizeInterSiteLink({ id: 'l3', aSiteId: 'hq', bSiteId: 'na', kind: 'sdwan', overlay: 'ov1', underlayUplinkIds: ['u1', '', 'u2'] });
  assert.deepStrictEqual(s.underlayUplinkIds, ['u1', 'u2']);

  const d = normalizeInterSiteLink({ id: 'l4', aSiteId: 'hq', bSiteId: 'na', kind: 'directLink', media: 'fibra' });
  assert.strictEqual(d.media, 'fibra');
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
    { id: 'nope', aSiteId: 'hq', bSiteId: 'rm', kind: 'wireguard' },
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
