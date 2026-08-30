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
const { buildInterSiteAudit, interSiteAuditCounts,
  INTER_SITE_AUDIT_PROBLEMS, INTER_SITE_AUDIT_GAPS } = require('../lib/inter-site-audit.js');
const { factDeclared } = require('../lib/provenance.js');

const reach = (a, b) => factDeclared({ a, b });
const site = (id, role, subnets) => ({ id, name: id.toUpperCase(), role, subnets: subnets || [] });
const ipsec = (id, a, b, r) => ({ id, aSiteId: a, bSiteId: b, kind: 'ipsec', reach: r });

// Le tre sedi da cui InfraNet è nata: Milano hub, Roma e Napoli spoke.
const SANE = {
  id: 'org', name: 'Acme',
  sites: [
    site('mi', 'hub', ['10.1.0.0/24']),
    site('rm', 'spoke', ['10.2.0.0/24']),
    site('na', 'spoke', ['10.3.0.0/24']),
  ],
  // ㉑ Le tre linee dicono COME prendono l'indirizzo e a chi parlano. Senza,
  // «un modello coerente» resterebbe uno su cui un controllo non ha potuto
  // girare — che è una terza cosa, non un modello coerente.
  // ㉖ E dicono anche la banda e l'MTU. Stessa ragione della ㉑ qui sopra: da
  // quando esiste un controllo di plausibilità, tre linee che non dichiarano
  // nessun numero non sono «un modello coerente» — sono un modello su cui quel
  // controllo non ha potuto girare, che è la terza cosa.
  uplinks: [
    { id: 'u-mi', siteId: 'mi', publicIps: factDeclared(['203.0.113.1']), addressing: 'static', nextHop: '203.0.113.254', mtu: 1500, cirMbps: 200 },
    { id: 'u-rm', siteId: 'rm', publicIps: factDeclared(['203.0.113.2']), addressing: 'static', nextHop: '203.0.113.253', mtu: 1500, cirMbps: 100 },
    { id: 'u-na', siteId: 'na', publicIps: factDeclared(['203.0.113.3']), addressing: 'static', nextHop: '203.0.113.252', mtu: 1492, cirMbps: 100 },
  ],
  // ⑳ I due tunnel dicono su quali linee corrono, per lo stesso motivo: da quando
  // il controllo esiste, un modello che non lo dichiara è un modello su cui c'è
  // una domanda senza risposta. Ogni tunnel corre sulla linea dei suoi due capi,
  // che è il caso normale e non deve produrre niente.
  links: [
  // ㉖ E i due capi portano l'indirizzo dell'ALTRO: `endpointA.peerIp` è quello
  // che si digita SU mi, cioè l'indirizzo di rm. Scritti al contrario sarebbero
  // il difetto che `crossedPeerIps` cerca — qui sono giusti, e devono tacere.
    Object.assign(ipsec('mi-rm', 'mi', 'rm', reach(['10.1.0.0/24', '10.3.0.0/24'], ['10.2.0.0/24'])),
      { underlayUplinkIds: ['u-mi', 'u-rm'],
        endpointA: { peerIp: '203.0.113.2' }, endpointB: { peerIp: '203.0.113.1' } }),
    Object.assign(ipsec('mi-na', 'mi', 'na', reach(['10.1.0.0/24', '10.2.0.0/24'], ['10.3.0.0/24'])),
      { underlayUplinkIds: ['u-mi', 'u-na'],
        endpointA: { peerIp: '203.0.113.3' }, endpointB: { peerIp: '203.0.113.1' } }),
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

test('① con degli spoke e nessun hub, «spoke senza hub» NON gira (non è un via libera)', () => {
  const org = clone(SANE);
  org.sites[0].role = 'standalone';        // Milano smette di essere l'hub…
  const a = buildInterSiteAudit(org);      // …e Roma e Napoli restano spoke
  assert.deepStrictEqual(a.spokesWithoutHub, []);
  assert.ok(a.notChecked.some(n => n.check === 'spokesWithoutHub' && n.reason === 'no-hub'),
    'una lista vuota qui deve essere accompagnata dal perché');
});

test('⚠️ sedi tutte INDIPENDENTI: il controllo non gira e non si lamenta', () => {
  // Il caso vero che l'ha fatto vedere: quattro sedi, nessuna che si dichiari
  // spoke. Registrarsi fra i «non ho potuto» chiedeva al lettore di rimediare a
  // una domanda che non si era mai posta — «non ho potuto guardare» e «non c'era
  // niente da guardare» sono due cose diverse, e confonderle riempie di
  // rimproveri l'unica lista che deve restare credibile.
  const org = clone(SANE);
  org.sites.forEach(s => { s.role = 'standalone'; });
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.spokesWithoutHub, []);
  assert.ok(!a.notChecked.some(n => n.check === 'spokesWithoutHub'),
    'senza spoke non c\'è niente da controllare: niente lista, e nessuna nota');
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
  assert.deepStrictEqual(a.linksToUnknownSite, [{ linkId: 'orfano', missing: ['fantasma'] }]);
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

// ── ⑳ la linea su cui un collegamento dice di correre, contro le sue sedi ──
// Terza coppia di frasi che si contraddicono senza che nessuna delle due, presa
// da sola, sembri sbagliata: la linea appartiene a una sede, il collegamento a
// due, e nessuno confrontava le tre cose.

test('⭐ ⑳ una linea di una TERZA sede non può portare quel collegamento', () => {
  const org = clone(SANE);
  org.links[0].underlayUplinkIds = ['u-mi', 'u-na'];   // mi↔rm che corre su una linea di NAPOLI
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.underlaysNotAtEnds,
    [{ linkId: 'mi-rm', uplinkId: 'u-na', siteId: 'na' }]);
  // ⚠️ La linea GIUSTA dello stesso collegamento non viene accusata insieme.
  assert.strictEqual(a.underlaysNotAtEnds.length, 1);
});

test('⭐ ⑳ e una linea che non esiste affatto: stessa lista, `siteId` a null', () => {
  // Il caso vero è la linea cancellata dopo: la spunta resta nel file, il
  // pannello la mostra come «non più descritta» e la carta la stampa come «non
  // trovata». Mancava solo chi la CONTA fra le cose che non tornano.
  const org = clone(SANE);
  org.links[1].underlayUplinkIds = ['u-mi', 'u-sparita'];
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.underlaysNotAtEnds,
    [{ linkId: 'mi-na', uplinkId: 'u-sparita', siteId: null }]);
});

test('⑳ il caso normale — la linea di un capo — non produce niente', () => {
  const a = buildInterSiteAudit(SANE);
  assert.deepStrictEqual(a.underlaysNotAtEnds, []);
  assert.ok(!a.notChecked.some(n => n.check === 'underlaysNotAtEnds'),
    'il controllo ha potuto girare: non deve dichiararsi cieco');
});

test('⭐ ⑳ nessuno che lo dichiara ⇒ CIECO, non «va tutto bene»', () => {
  // È la disciplina ① applicata a un campo nuovo, e sull'archivio vero è il caso
  // di tutti e otto i collegamenti. Una lista vuota direbbe «ho guardato»: qui
  // non c'era niente da guardare, ed è un'informazione diversa — dice a chi
  // documenta che quella domanda esiste e non ha ancora una risposta.
  const org = clone(SANE);
  org.links.forEach(l => { delete l.underlayUplinkIds; });
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.underlaysNotAtEnds, []);
  assert.ok(a.notChecked.some(n => n.check === 'underlaysNotAtEnds' && n.reason === 'no-underlay'));
});

test('⑳ senza collegamenti il controllo si dichiara cieco per QUEL motivo', () => {
  const org = clone(SANE);
  org.links = [];
  const a = buildInterSiteAudit(org);
  assert.ok(a.notChecked.some(n => n.check === 'underlaysNotAtEnds' && n.reason === 'no-links'));
});

test('⭐ ⑳ un capo che punta a una sede inesistente NON viene accusato due volte', () => {
  // Il difetto è già detto da `linksToUnknownSite`, e finché quel capo è rotto
  // nessuno può dire a quale sede la linea dovrebbe appartenere. Due righe per
  // un guasto solo lo fanno sembrare due guasti.
  const org = clone(SANE);
  org.links[0].bSiteId = 'sede-che-non-ce';
  org.links[0].underlayUplinkIds = ['u-na'];
  const a = buildInterSiteAudit(org);
  assert.strictEqual(a.linksToUnknownSite.length, 1);
  assert.deepStrictEqual(a.underlaysNotAtEnds, []);
});

test('⑳ è un-INCOERENZA, non una lacuna: entra nel conto giusto', () => {
  const org = clone(SANE);
  org.links[0].underlayUplinkIds = ['u-na'];
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

// ── ㉑ una linea STATICA che non dice a chi parla ──────────────────────────
// Non è una contraddizione: è una riga che manca. Ma è LA riga — con
// l'indirizzo e senza il gateway la scheda di ripristino sembra piena, e chi
// riconfigura il router alle tre di notte se ne accorge in fondo alla pagina.

test('㉑ una linea statica senza gateway è una LACUNA, e dice quale linea', () => {
  const org = clone(SANE);
  delete org.uplinks[1].nextHop;
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.staticUplinksWithoutNextHop, [{ uplinkId: 'u-rm', siteId: 'rm' }]);
  const c = interSiteAuditCounts(a);
  assert.strictEqual(c.problems, 0, 'niente si contraddice: manca una riga');
  assert.strictEqual(c.gaps, 1);
});

test('㉑ su DHCP e PPPoE il gateway lo dà la linea: non si accusa', () => {
  const org = clone(SANE);
  org.uplinks[1].addressing = 'dhcp'; delete org.uplinks[1].nextHop;
  org.uplinks[2].addressing = 'pppoe'; delete org.uplinks[2].nextHop;
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.staticUplinksWithoutNextHop, [],
    'accusare qui vorrebbe dire segnalare una documentazione giusta');
});

test('㉑ un indirizzamento MAI SCRITTO non è «statico»: non accusa, e lo dice', () => {
  // Un ripiego che accusa è un ripiego che afferma: ogni linea appena creata
  // comincerebbe in colpa per un campo che nessuno ha ancora compilato.
  const org = clone(SANE);
  for (const u of org.uplinks) { delete u.addressing; delete u.nextHop; }
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.staticUplinksWithoutNextHop, []);
  assert.ok(a.notChecked.some(n => n.check === 'staticUplinksWithoutNextHop' && n.reason === 'no-static-uplink'),
    'una lista vuota deve dire PERCHÉ è vuota');
});

test('㉑ senza nessuna linea WAN il controllo si dichiara cieco', () => {
  const org = clone(SANE);
  org.uplinks = [];
  const a = buildInterSiteAudit(org);
  assert.ok(a.notChecked.some(n => n.check === 'staticUplinksWithoutNextHop' && n.reason === 'no-uplinks'));
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

// ── ㉖ Le guardie del ripristino ───────────────────────────────────────────
// Prima di queste, un'organizzazione con nove cose sbagliate usciva dall'audit
// con «problems: 0, gaps: 0, notChecked: 0» — cioè con un'assoluzione piena.

test('un collegamento che non dice su quale LINEA corre è una lacuna', () => {
  const org = clone(SANE);
  delete org.links[0].underlayUplinkIds;
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.linksWithoutUnderlay, [{ linkId: 'mi-rm' }]);
  assert.strictEqual(interSiteAuditCounts(a).problems, 0,
    'non contraddice niente: manca una riga, e una lacuna non è un\'incoerenza');
});

test('⚠️ un `directLink` senza linee sotto NON si accusa: quel collegamento È la linea', () => {
  const org = clone(SANE);
  org.links[0].transport = 'directLink';
  org.links[0].underlayUplinkIds = [];
  assert.deepStrictEqual(buildInterSiteAudit(org).linksWithoutUnderlay, []);
});

test('senza NESSUNA linea in tutta l\'organizzazione la domanda non esiste: si registra', () => {
  const org = clone(SANE);
  org.uplinks = [];
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.linksWithoutUnderlay, [], 'accusare tutti sarebbe una lista di rimproveri');
  assert.ok(a.notChecked.some(c => c.check === 'linksWithoutUnderlay' && c.reason === 'no-uplinks'));
});

test('una linea dichiarata a un capo solo: l\'altro capo resta cieco', () => {
  const org = clone(SANE);
  org.links[0].underlayUplinkIds = ['u-mi'];
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.underlaysAtOneEndOnly, [{ linkId: 'mi-rm', siteId: 'rm' }]);
  assert.deepStrictEqual(a.underlaysNotAtEnds, [],
    'la linea esiste e sta a un capo: non è quel difetto');
});

test('⚠️ se le linee sono TUTTE altrove il guasto è uno, non due', () => {
  const org = clone(SANE);
  org.links[0].underlayUplinkIds = ['u-na'];
  const a = buildInterSiteAudit(org);
  assert.strictEqual(a.underlaysNotAtEnds.length, 1);
  assert.deepStrictEqual(a.underlaysAtOneEndOnly, [],
    'accusare due volte lo stesso guasto lo fa sembrare due guasti');
});

test('⭐ un MTU e una banda fuori dal plausibile si SEGNALANO, e il numero resta scritto', () => {
  const org = clone(SANE);
  org.uplinks[0].mtu = 150000;
  org.uplinks[1].cirMbps = 4000000;
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.uplinksImplausible, [
    { uplinkId: 'u-mi', siteId: 'mi', field: 'mtu', value: 150000 },
    { uplinkId: 'u-rm', siteId: 'rm', field: 'cirMbps', value: 4000000 },
  ]);
  // La promessa del modello per esteso: «segnala senza distruggere».
  const IS = require('../lib/inter-site.js');
  assert.strictEqual(IS.normalizeOrganization(org).uplinks[0].mtu, 150000);
});

test('un MTU BASSO è implausibile quanto uno alto (sotto 1280 l\'IPv6 non passa)', () => {
  const org = clone(SANE);
  org.uplinks[0].mtu = 576;
  assert.deepStrictEqual(buildInterSiteAudit(org).uplinksImplausible,
    [{ uplinkId: 'u-mi', siteId: 'mi', field: 'mtu', value: 576 }]);
});

test('nessun numero dichiarato: il controllo non ha potuto girare, e lo dice', () => {
  const org = clone(SANE);
  for (const u of org.uplinks) { delete u.mtu; delete u.cirMbps; }
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.uplinksImplausible, []);
  assert.ok(a.notChecked.some(c => c.check === 'uplinksImplausible' && c.reason === 'no-numbers'));
});

test('⭐ i due capi incrociati: il peer «visto da mi» è un indirizzo di mi', () => {
  const org = clone(SANE);
  org.links[0].endpointA.peerIp = '203.0.113.1';
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.crossedPeerIps,
    [{ linkId: 'mi-rm', end: 'a', siteId: 'mi', addr: '203.0.113.1' }]);
  assert.ok(INTER_SITE_AUDIT_PROBLEMS.includes('crossedPeerIps'),
    'è una contraddizione fra due cose dichiarate, non una lacuna');
});

test('⚠️ il confronto guarda anche DENTRO un blocco dichiarato', () => {
  const org = clone(SANE);
  org.uplinks[0].publicIps = factDeclared(['203.0.113.8/29']);
  org.links[0].endpointA.peerIp = '203.0.113.11';
  assert.deepStrictEqual(buildInterSiteAudit(org).crossedPeerIps.map(x => x.addr),
    ['203.0.113.11']);
});

test('un peer scritto giusto non produce niente', () => {
  assert.deepStrictEqual(buildInterSiteAudit(SANE).crossedPeerIps, []);
});

test('nessun peer dichiarato: si registra invece di assolvere', () => {
  const org = clone(SANE);
  for (const l of org.links) { delete l.endpointA; delete l.endpointB; }
  const a = buildInterSiteAudit(org);
  assert.deepStrictEqual(a.crossedPeerIps, []);
  assert.ok(a.notChecked.some(c => c.check === 'crossedPeerIps' && c.reason === 'no-peer-ip'));
});

// ── ㉖ Il cancello che tiene insieme le due definizioni ────────────────────
// La classificazione era scritta due volte — qui e nel pannello — e coincideva
// per abitudine. Un controllo fuori da entrambi gli elenchi sarebbe calcolato e
// mai disegnato: esiste, e non lo vede nessuno.
test('⭐ ogni lista dell\'audit sta in ESATTAMENTE uno dei due gruppi', () => {
  const chiavi = Object.keys(buildInterSiteAudit({})).filter(k => k !== 'notChecked');
  for (const k of chiavi) {
    const dove = [INTER_SITE_AUDIT_PROBLEMS.indexOf(k) >= 0, INTER_SITE_AUDIT_GAPS.indexOf(k) >= 0]
      .filter(Boolean).length;
    assert.strictEqual(dove, 1, `${k} sta in ${dove} gruppi invece che in 1: il pannello non lo disegnerebbe`);
  }
  for (const k of INTER_SITE_AUDIT_PROBLEMS.concat(INTER_SITE_AUDIT_GAPS)) {
    assert.ok(chiavi.indexOf(k) >= 0, `${k} è classificato, ma l'audit non lo produce`);
  }
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
