'use strict';
// ============================================================
// AUDIT INTER-SEDE — test della diagnostica sul dichiarato (lib/inter-site-audit.js).
//
// Le invarianti che questo modulo deve difendere:
//   ① «ho guardato e va bene» ≠ «non ho potuto guardare» → `notChecked` con il perché;
//   ② «è sbagliato» ≠ «non è scritto» → liste separate, e i conteggi non li sommano;
//   · il TRANSITO è legittimo: in hub-and-spoke l'hub porta le reti di un terzo sito,
//     e questo NON deve produrre un falso positivo;
//   · un controllo cieco non riempie liste: tace e si registra.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { buildInterSiteAudit, interSiteAuditCounts } = require('../lib/inter-site-audit.js');
const { factDeclared } = require('../lib/provenance.js');

const reach = (a, b) => factDeclared({ a, b });
const site = (id, role, subnets) => ({ id, name: id.toUpperCase(), role, subnets: subnets || [] });
const ipsec = (id, a, b, r) => ({ id, aSiteId: a, bSiteId: b, kind: 'ipsec', reach: r });
/** Lo stesso collegamento, ma che si DICHIARA hub-and-spoke. */
const hs = (l) => Object.assign(l, { topology: 'hub-and-spoke' });

// Le tre sedi da cui InfraNet è nata: Milano hub, Roma e Napoli spoke.
const SANE = {
  id: 'org', name: 'Acme',
  sites: [
    site('mi', 'hub', ['10.1.0.0/24']),
    site('rm', 'spoke', ['10.2.0.0/24']),
    site('na', 'spoke', ['10.3.0.0/24']),
  ],
  uplinks: [
    { id: 'u-mi', siteId: 'mi', publicIps: factDeclared(['203.0.113.1']) },
    { id: 'u-rm', siteId: 'rm', publicIps: factDeclared(['203.0.113.2']) },
    { id: 'u-na', siteId: 'na', publicIps: factDeclared(['203.0.113.3']) },
  ],
  // I due tunnel DICHIARANO la loro forma, e concorda con i ruoli: senza,
  // «un modello coerente» resterebbe uno su cui un controllo non ha potuto
  // girare — che è una terza cosa, non un modello coerente.
  links: [
    hs(ipsec('mi-rm', 'mi', 'rm', reach(['10.1.0.0/24', '10.3.0.0/24'], ['10.2.0.0/24']))),
    hs(ipsec('mi-na', 'mi', 'na', reach(['10.1.0.0/24', '10.2.0.0/24'], ['10.3.0.0/24']))),
  ],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── Il caso sano: tutto tace, e ha guardato tutto ──────────────────────────
test('un modello coerente non produce NIENTE — e nemmeno un notChecked', () => {
  const a = buildInterSiteAudit(SANE);
  for (const [k, v] of Object.entries(a)) {
    assert.deepStrictEqual(v, [], `${k} doveva essere vuoto, invece: ${JSON.stringify(v)}`);
  }
  assert.deepStrictEqual(interSiteAuditCounts(a), { problems: 0, gaps: 0, notChecked: 0 });
});

test('⚠️ il TRANSITO via hub non è un falso positivo', () => {
  // Il collegamento Milano↔Roma porta, dal capo di Milano, ANCHE la rete di Napoli:
  // è esattamente come funziona un hub-and-spoke, e non deve segnalare niente.
  const a = buildInterSiteAudit(SANE);
  assert.deepStrictEqual(a.subnetsNowhere, []);
  assert.deepStrictEqual(a.subnetsNotCarried, []);
});

// ── ① notChecked: ciò che non si è potuto guardare ─────────────────────────
test('① senza sedi OGNI controllo si dichiara cieco (mai «nessun problema»)', () => {
  const a = buildInterSiteAudit({});
  const checks = Object.keys(a).filter(k => k !== 'notChecked');
  assert.strictEqual(a.notChecked.length, checks.length, 'un notChecked per ogni controllo');
  assert.ok(a.notChecked.every(n => n.reason === 'no-sites'));
  assert.deepStrictEqual(a.notChecked.map(n => n.check).sort(), checks.slice().sort());
});

test('① senza collegamenti i controlli che ne hanno bisogno si registrano', () => {
  const a = buildInterSiteAudit({ sites: [site('mi', 'hub', ['10.1.0.0/24'])] });
  const why = Object.fromEntries(a.notChecked.map(n => [n.check, n.reason]));
  assert.strictEqual(why.subnetsNowhere, 'no-links');
  assert.strictEqual(why.linksWithoutReach, 'no-links');
  assert.strictEqual(why.sitesWithoutLink, 'no-links');
  assert.strictEqual(why.subnetsNotCarried, 'no-links');
  assert.strictEqual(why.sitesWithoutUplink, 'no-uplinks');
  assert.strictEqual(why.uplinksWithoutPublicIp, 'no-uplinks');
});

test('① senza hub dichiarato, «spoke senza hub» NON gira (non è un via libera)', () => {
  const org = clone(SANE);
  org.sites.forEach(s => { s.role = 'standalone'; });
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.spokesWithoutHub, []);
  assert.ok(a.notChecked.some(n => n.check === 'spokesWithoutHub' && n.reason === 'no-hub'),
    'una lista vuota qui deve essere accompagnata dal perché');
});

test('① senza reach, i due controlli che la usano si dichiarano ciechi', () => {
  const org = clone(SANE);
  org.links.forEach(l => { delete l.reach; });
  const a = buildInterSiteAudit(org);
  const why = Object.fromEntries(a.notChecked.map(n => [n.check, n.reason]));
  assert.strictEqual(why.subnetsNowhere, 'no-reach');
  assert.strictEqual(why.subnetsNotCarried, 'no-reach');
  assert.deepStrictEqual(a.subnetsNowhere, []);
  assert.deepStrictEqual(a.subnetsNotCarried, []);
  // ma la LACUNA sì: i collegamenti non dicono cosa portano
  assert.deepStrictEqual(a.linksWithoutReach.map(x => x.linkId), ['mi-rm', 'mi-na']);
});

test('① senza subnet dichiarate, i controlli sulle reti si registrano', () => {
  const org = clone(SANE);
  org.sites.forEach(s => { s.subnets = []; });
  const a = buildInterSiteAudit(org);
  const why = Object.fromEntries(a.notChecked.map(n => [n.check, n.reason]));
  assert.strictEqual(why.subnetsAtTwoSites, 'no-site-subnets');
  assert.strictEqual(why.subnetsNowhere, 'no-site-subnets');
  assert.strictEqual(why.subnetsNotCarried, 'no-site-subnets');
});

// ── Incoerenze ─────────────────────────────────────────────────────────────
test('una rete trasportata che non risulta a NESSUNA sede', () => {
  const org = clone(SANE);
  org.links[0].reach = reach(['10.1.0.0/24'], ['10.2.0.0/24', '10.9.0.0/24']);
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.subnetsNowhere, [
    { subnet: '10.9.0.0/24', at: [{ linkId: 'mi-rm', siteId: 'rm' }] },
  ]);
});

test('la stessa rete sconosciuta su più collegamenti si raccoglie in UNA riga', () => {
  const org = clone(SANE);
  org.links[0].reach = reach(['10.9.0.0/24'], ['10.2.0.0/24']);
  org.links[1].reach = reach(['10.1.0.0/24'], ['10.3.0.0/24', '10.9.0.0/24']);
  const a = buildInterSiteAudit(org);
  assert.strictEqual(a.subnetsNowhere.length, 1);
  assert.strictEqual(a.subnetsNowhere[0].subnet, '10.9.0.0/24');
  assert.deepStrictEqual(a.subnetsNowhere[0].at, [
    { linkId: 'mi-rm', siteId: 'mi' }, { linkId: 'mi-na', siteId: 'na' },
  ]);
});

test('la rete sconosciuta si riconosce anche scritta in un\'altra forma valida', () => {
  const org = clone(SANE);
  org.links[0].reach = reach(['10.1.0.44/24'], ['10.2.0.0/255.255.255.0']); // stesse reti, altra scrittura
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.subnetsNowhere, [], 'la canonicalizzazione di Fase 0 le fa combaciare');
});

test('una rete dichiarata da DUE sedi (sovrapposizione)', () => {
  const org = clone(SANE);
  org.sites[1].subnets = ['10.1.0.0/24']; // Roma rivendica la rete di Milano
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.subnetsAtTwoSites, [{ subnet: '10.1.0.0/24', siteIds: ['mi', 'rm'] }]);
});

test('un capo che punta a una sede inesistente', () => {
  const org = clone(SANE);
  org.links.push(ipsec('orfano', 'mi', 'fantasma', reach(['10.1.0.0/24'], [])));
  org.uplinks.push({ id: 'u-x', siteId: 'fantasma', publicIps: factDeclared(['203.0.113.9']) });
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.linksToUnknownSite, [{ linkId: 'orfano', kind: 'ipsec', missing: ['fantasma'] }]);
  assert.deepStrictEqual(a.uplinksToUnknownSite, [{ uplinkId: 'u-x', siteId: 'fantasma' }]);
});

test('uno spoke che non tocca nessun hub', () => {
  const org = clone(SANE);
  org.links = [org.links[0]];           // resta solo Milano↔Roma: Napoli è orfana
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.spokesWithoutHub, [{ siteId: 'na' }]);
});

test('uno spoke collegato solo a un altro spoke non conta come agganciato', () => {
  const org = clone(SANE);
  org.links = [ipsec('rm-na', 'rm', 'na', reach(['10.2.0.0/24'], ['10.3.0.0/24']))];
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.spokesWithoutHub.map(x => x.siteId), ['rm', 'na']);
});

// ── ⑮ la topologia del collegamento contro i ruoli dei suoi capi ───────────
// Due frasi sulla stessa cosa, scritte in due posti. Nessuna delle due, da
// sola, sembra sbagliata: è per questo che serve un controllo.

test('⑮ un hub-and-spoke fra due SPOKE: una delle due frasi è falsa', () => {
  const org = clone(SANE);
  org.links.push(hs(ipsec('rm-na', 'rm', 'na', reach(['10.2.0.0/24'], ['10.3.0.0/24']))));
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.linkTopologyVsRoles, [{ linkId: 'rm-na', kind: 'ipsec', role: 'spoke' }]);
});

test('⑮ un hub-and-spoke fra due HUB: due centri non fanno un centro', () => {
  const org = clone(SANE);
  org.sites[2].role = 'hub';                       // na diventa il secondo datacenter
  org.links[1] = hs(org.links[1]);                 // e mi-na si dichiara hub-and-spoke
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.linkTopologyVsRoles.map(x => [x.linkId, x.role]), [['mi-na', 'hub']]);
});

test('⑮ un hub e uno spoke: non c-è niente da dire', () => {
  const a = buildInterSiteAudit(SANE);   // SANE dichiara già hub-and-spoke
  assert.deepStrictEqual(a.linkTopologyVsRoles, []);
  assert.ok(!a.notChecked.some(n => n.check === 'linkTopologyVsRoles'),
    'il controllo ha potuto girare: non deve dichiararsi cieco');
});

test('⑮ su una MAGLIA i ruoli non c-entrano, e non si inventa una contraddizione', () => {
  const org = clone(SANE);
  org.links.forEach(l => { delete l.topology; });   // nessuno si dichiara hub-and-spoke
  org.links.push(Object.assign(ipsec('rm-na', 'rm', 'na', reach(['10.2.0.0/24'], ['10.3.0.0/24'])), { topology: 'mesh' }));
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.linkTopologyVsRoles, []);
  // e lo dice: nessun collegamento si dichiara hub-and-spoke, quindi è cieco
  assert.ok(a.notChecked.some(n => n.check === 'linkTopologyVsRoles' && n.reason === 'no-topology'));
});

test('⑮ un capo `standalone` NON accusa: è anche il ripiego di un ruolo mai scritto', () => {
  const org = clone(SANE);
  org.sites.push(site('bz', 'standalone', ['10.4.0.0/24']));
  org.links = [hs(ipsec('mi-bz', 'mi', 'bz', reach(['10.1.0.0/24'], ['10.4.0.0/24'])))];
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.linkTopologyVsRoles, []);
  assert.ok(a.notChecked.some(n => n.check === 'linkTopologyVsRoles' && n.reason === 'no-roles'),
    'una lista vuota qui deve dire PERCHÉ è vuota');
});

test('⑮ senza collegamenti il controllo si dichiara cieco per quel motivo', () => {
  const org = clone(SANE);
  org.links = [];
  const a = buildInterSiteAudit(org);
  assert.ok(a.notChecked.some(n => n.check === 'linkTopologyVsRoles' && n.reason === 'no-links'));
});

test('⑮ è un-INCOERENZA, non una lacuna: entra nel conto giusto', () => {
  const org = clone(SANE);
  org.links.push(hs(ipsec('rm-na', 'rm', 'na', reach(['10.2.0.0/24'], ['10.3.0.0/24']))));
  const prima = interSiteAuditCounts(buildInterSiteAudit(SANE));
  const dopo = interSiteAuditCounts(buildInterSiteAudit(org));
  assert.strictEqual(dopo.problems, prima.problems + 1);
  assert.strictEqual(dopo.gaps, prima.gaps);
});

// ── Lacune ─────────────────────────────────────────────────────────────────
test('una rete di una sede che nessuno dei SUOI collegamenti trasporta', () => {
  const org = clone(SANE);
  org.sites[1].subnets = ['10.2.0.0/24', '10.20.0.0/24']; // Roma ne ha due, il tunnel ne porta una
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.subnetsNotCarried, [{ subnet: '10.20.0.0/24', siteId: 'rm' }]);
});

test('una sede SENZA collegamenti non ripete ogni sua rete: lo dice una volta', () => {
  const org = clone(SANE);
  org.links = [org.links[0]];   // Napoli resta senza collegamenti
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.sitesWithoutLink, [{ siteId: 'na' }]);
  assert.deepStrictEqual(a.subnetsNotCarried, [], 'lo stesso fatto detto due volte suonerebbe più grave');
});

test('un uplink senza IP pubblico, e una sede senza uplink', () => {
  const org = clone(SANE);
  delete org.uplinks[0].publicIps;   // Milano non dichiara l'IP
  org.uplinks.splice(2, 1);         // Napoli non ha uplink
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.uplinksWithoutPublicIp, [{ uplinkId: 'u-mi', siteId: 'mi' }]);
  assert.deepStrictEqual(a.sitesWithoutUplink, [{ siteId: 'na' }]);
});

test('② un IP pubblico NUDO non conta come dichiarato', () => {
  const org = clone(SANE);
  org.uplinks[0].publicIps = ['203.0.113.1']; // senza envelope: non sappiamo da dove viene
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.uplinksWithoutPublicIp, [{ uplinkId: 'u-mi', siteId: 'mi' }]);
});

// ── ② i conteggi non fondono le tre categorie ──────────────────────────────
test('② incoerenze, lacune e non-esaminati si contano SEPARATAMENTE', () => {
  const org = clone(SANE);
  // Roma rivendica la rete di Milano AL POSTO della sua: due guasti, non uno —
  // la sovrapposizione, e la 10.2.0.0/24 che i tunnel portano ancora ma che ora
  // non risulta più a nessuna sede. I controlli si compongono, ed è giusto così.
  org.sites[1].subnets = ['10.1.0.0/24'];
  delete org.uplinks[0].publicIps;           // 1 lacuna
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.subnetsAtTwoSites, [{ subnet: '10.1.0.0/24', siteIds: ['mi', 'rm'] }]);
  assert.deepStrictEqual(a.subnetsNowhere.map(x => x.subnet), ['10.2.0.0/24']);
  const c = interSiteAuditCounts(a);
  assert.strictEqual(c.problems, 2);
  assert.ok(c.gaps >= 1);
  assert.strictEqual(c.notChecked, 0);
});

test('② un controllo NON eseguito non entra né in problems né in gaps', () => {
  const c = interSiteAuditCounts(buildInterSiteAudit({}));
  assert.strictEqual(c.problems, 0, 'cieco non vuol dire rotto');
  assert.strictEqual(c.gaps, 0, 'e non vuol dire nemmeno incompleto');
  assert.ok(c.notChecked > 0, 'ma non è nemmeno «tutto a posto»');
});

test('interSiteAuditCounts regge un input degenere', () => {
  assert.deepStrictEqual(interSiteAuditCounts({}), { problems: 0, gaps: 0, notChecked: 0 });
});

// ── Purezza & determinismo ─────────────────────────────────────────────────
test('l\'audit non muta l\'organizzazione che riceve', () => {
  const before = JSON.stringify(SANE);
  buildInterSiteAudit(SANE);
  assert.strictEqual(JSON.stringify(SANE), before);
});

test('due giri sullo stesso input danno lo stesso risultato (ordine stabile)', () => {
  const org = clone(SANE);
  org.links[0].reach = reach(['10.9.0.0/24', '10.8.0.0/24'], ['10.2.0.0/24']);
  org.sites[1].subnets = ['10.2.0.0/24', '10.1.0.0/24'];
  const a = JSON.stringify(buildInterSiteAudit(org));
  const b = JSON.stringify(buildInterSiteAudit(clone(org)));
  assert.strictEqual(a, b);
  // le reti sconosciute escono ordinate, non nell'ordine in cui capitano
  assert.deepStrictEqual(buildInterSiteAudit(org).subnetsNowhere.map(x => x.subnet),
    ['10.8.0.0/24', '10.9.0.0/24']);
});

test('accetta un\'organizzazione grezza (normalizeOrganization è idempotente)', () => {
  const IS = require('../lib/inter-site.js');
  const grezza = buildInterSiteAudit(SANE);
  const normalizzata = buildInterSiteAudit(IS.normalizeOrganization(SANE));
  assert.deepStrictEqual(normalizzata, grezza);
});
