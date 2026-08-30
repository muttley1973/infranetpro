// Il capitolo WAN del dossier, lato dati (lib/inter-site-report.js).
//
// Il capitolo esiste per una notte sola: quella in cui la linea è giù. Quindi
// quello che si prova qui non è «esce un oggetto con i campi giusti», ma le tre
// promesse che lo rendono utile a quell'ora: ciò che manca si DICE invece di
// essere riempito, ciò che non si è potuto guardare non si accusa, e niente
// sparisce in silenzio — nemmeno un collegamento che punta a una sede che non
// c'è più.
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOrganization } = require('../lib/inter-site.js');
const { factDeclared, factMeasured } = require('../lib/provenance.js');
const { buildInterSiteWanReport } = require('../lib/inter-site-report.js');

/** Un'organizzazione minima ma vera: due sedi, due linee, due collegamenti. */
function orgBase(extra) {
  return normalizeOrganization(Object.assign({
    id: 'o', name: 'Prova',
    sites: [
      { id: 'mi', name: 'Milano', role: 'hub', projectRef: '17', address: 'Via A 1', subnets: ['10.10.0.0/16'] },
      { id: 'rm', name: 'Roma', role: 'spoke', projectRef: '18', subnets: ['10.20.0.0/16'] },
    ],
    uplinks: [
      { id: 'u1', siteId: 'mi', provider: 'Fastweb', serviceType: 'Fibra', circuitId: 'FW-1', cirMbps: 1000,
        slaRef: 'SLA-4H', publicIps: factDeclared(['203.0.113.10']), wanIfRef: factMeasured('Gi0/0/0', '2026-08-20T10:00:00Z') },
      { id: 'u2', siteId: 'rm', provider: null, serviceType: 'FTTC', circuitId: null, cirMbps: null },
    ],
    links: [
      { id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec', name: 'T1', state: factDeclared('up'),
        reach: factDeclared({ a: ['10.10.0.0/16'], b: ['10.20.0.0/16'] }),
        endpointA: { deviceRef: 'n1', peerIp: '198.51.100.2' },
        endpointB: { deviceName: 'RM-FW', peerIp: '198.51.100.1' } },
    ],
  }, extra || {}));
}

test('⭐ ① una linea senza codice circuito non sparisce: si CONTA in testata', () => {
  const R = buildInterSiteWanReport(orgBase());
  // È il numero che si detta al telefono quando la linea è giù. Sapere che manca
  // ADESSO è il solo modo di non scoprirlo quella notte.
  assert.equal(R.totals.linesNoCircuitId, 1);
  assert.equal(R.totals.linesNoProvider, 1);
  assert.equal(R.totals.lines, 2);
  assert.equal(R.totals.sites, 2);
  assert.equal(R.totals.sitesNoLine, 0);
});

test('② un campo non dichiarato resta null, mai zero', () => {
  const R = buildInterSiteWanReport(orgBase());
  const rm = R.lines.find(l => l.siteId === 'rm');
  // «Nessuna banda garantita nel contratto» e «banda garantita zero» sono due
  // cose diverse, e a valle nessuno le distinguerebbe più.
  assert.equal(rm.cirMbps, null);
  assert.equal(rm.circuitId, null);
  assert.equal(rm.provider, null);
  assert.equal(rm.publicIps, null, 'niente lista vuota al posto di un\'assenza');
  assert.equal(rm.wanIf, null);
});

test('③ un fatto porta con sé chi lo afferma e da quando', () => {
  const R = buildInterSiteWanReport(orgBase());
  const mi = R.lines.find(l => l.siteId === 'mi');
  assert.deepEqual(mi.publicIps.value, ['203.0.113.10']);
  assert.equal(mi.publicIps.origin, 'declared');
  assert.equal(mi.wanIf.value, 'Gi0/0/0');
  assert.equal(mi.wanIf.origin, 'measured');
  assert.ok(mi.wanIf.at, 'la data della misura arriva fino alla carta');
});

test('⭐ ④ i cinque esiti del capo: risolto, scritto a mano, non trovato, illeggibile, muto', () => {
  const org = orgBase({
    links: [
      { id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'gre',
        endpointA: { deviceRef: 'n1' }, endpointB: { deviceName: 'RM-FW' } },
      { id: 'l2', aSiteId: 'mi', bSiteId: 'rm', kind: 'gre',
        endpointA: { deviceRef: 'sparito' }, endpointB: {} },
    ],
  });
  const R = buildInterSiteWanReport(org, {
    deviceNameOf: (siteId, ref) => (ref === 'n1' ? 'MI-FW-01' : null),
  });
  assert.equal(R.links[0].a.device, 'MI-FW-01');
  assert.equal(R.links[0].a.deviceState, 'linked');
  assert.equal(R.links[0].b.device, 'RM-FW');
  assert.equal(R.links[0].b.deviceState, 'typed');
  assert.equal(R.links[1].a.deviceState, 'missing', 'guardato, e quel nodo non c\'è più');
  assert.equal(R.links[1].b.deviceState, 'none', 'nessuno ha dichiarato niente');

  // ⚠️ SENZA righello non si dice «non trovato»: non si è nemmeno guardato, e
  // accusare un progetto di aver perso un apparato sulla base di niente sarebbe
  // esattamente l'invenzione che questo prodotto non fa.
  const senza = buildInterSiteWanReport(org);
  assert.equal(senza.links[0].a.deviceState, 'unreadable');
  assert.equal(senza.links[0].b.deviceState, 'typed', 'un nome scritto a mano non ha bisogno di righelli');
});

test('⑤ le reti raggiungibili sono l\'encryption domain: ci sono o è null, mai una lista finta', () => {
  const R = buildInterSiteWanReport(orgBase());
  assert.deepEqual(R.links[0].reach.value.a, ['10.10.0.0/16']);
  assert.deepEqual(R.links[0].reach.value.b, ['10.20.0.0/16']);

  const muto = buildInterSiteWanReport(orgBase({
    links: [{ id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec' }],
  }));
  assert.equal(muto.links[0].reach, null);
  assert.equal(muto.totals.linksNoReach, 1);
});

test('⭐ ⑥ un collegamento verso una sede che non esiste NON si perde', () => {
  const R = buildInterSiteWanReport(orgBase({
    links: [{ id: 'l9', aSiteId: 'mi', bSiteId: 'ba', kind: 'other', kindLabel: 'FWA punto-punto' }],
  }));
  // Sulla mappa non si può disegnare (③ del layout). Sulla carta si legge lo
  // stesso, col nome di ciò che manca: sparire da tutt'e due lo cancellerebbe.
  assert.equal(R.links.length, 1);
  assert.equal(R.links[0].drawable, false);
  assert.deepEqual(R.links[0].missingSites, ['ba']);
  assert.equal(R.totals.linksUndrawable, 1);
  // ⑨ `other` è ignoranza DICHIARATA: l'etichetta di chi documenta arriva intera.
  assert.equal(R.links[0].kindLabel, 'FWA punto-punto');
});

test('⑦ l\'underlay di un SD-WAN: un id che non risolve resta in elenco, marcato', () => {
  const R = buildInterSiteWanReport(orgBase({
    links: [{ id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'sdwan', underlayUplinkIds: ['u1', 'u-sparito'] }],
  }));
  const u = R.links[0].underlay;
  assert.equal(u.length, 2, 'sparire farebbe credere a una linea in meno di quelle dichiarate');
  assert.equal(u[0].found, true);
  assert.equal(u[0].provider, 'Fastweb');
  assert.equal(u[0].circuitId, 'FW-1');
  assert.equal(u[1].found, false);
  assert.equal(u[1].uplinkId, 'u-sparito');
});

test('⭐ ⑳ e non solo di un SD-WAN: la linea sotto un IPsec arriva sulla carta', () => {
  // È LA domanda del capitolo: «è giù la Fastweb di Milano — quali collegamenti
  // cadono con lei?». Finché le linee sotto vivevano nel solo `sdwan`, il
  // dossier teneva le due metà separate senza una relazione, e la risposta non
  // era deducibile nemmeno leggendolo tutto.
  // ⚠️ `orgBase` NORMALIZZA: questa prova passa dal modello, che è il punto dove
  // il campo veniva buttato via. Su un oggetto grezzo sarebbe verde da sempre.
  const R = buildInterSiteWanReport(orgBase({
    links: [{ id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec', name: 'T1',
      underlayUplinkIds: ['u1', 'u2'] }],
  }));
  const u = R.links[0].underlay;
  assert.equal(u.length, 2);
  assert.equal(u[0].provider, 'Fastweb');
  assert.equal(u[0].circuitId, 'FW-1');
  assert.equal(u[1].found, true, 'la seconda linea non ha operatore, ma esiste');
});

test('⑧ la sede del progetto che si sta stampando è marcata, e con lei le sue righe', () => {
  const R = buildInterSiteWanReport(orgBase(), { projectRef: '17' });
  assert.equal(R.here, '17');
  assert.equal(R.sites.find(s => s.id === 'mi').here, true);
  assert.equal(R.sites.find(s => s.id === 'rm').here, false);
  assert.equal(R.lines.find(l => l.siteId === 'mi').here, true);
  assert.equal(R.links[0].here, true, 'un collegamento che tocca questa sede la riguarda');

  // Nessun progetto in mano: nessuno è «qui», e non si sceglie una sede a caso.
  const senza = buildInterSiteWanReport(orgBase());
  assert.equal(senza.here, null);
  assert.ok(senza.sites.every(s => !s.here));
});

test('⑨ l\'organizzazione viaggia col rapporto: la mappa nasce dalle STESSE coordinate', () => {
  const org = orgBase();
  const R = buildInterSiteWanReport(org);
  // Non una copia rimasticata: il riferimento. Chi disegna lo passa al modulo
  // del layout e ottiene la mappa identica a quella del pannello.
  assert.equal(R.organization, org);
});

test('⑩ un\'organizzazione vuota non è un errore: è un capitolo senza niente da dire', () => {
  for (const vuota of [null, undefined, {}, normalizeOrganization({})]) {
    const R = buildInterSiteWanReport(vuota);
    assert.deepEqual(R.sites, []);
    assert.deepEqual(R.lines, []);
    assert.deepEqual(R.links, []);
    assert.equal(R.totals.sites, 0);
  }
});

test('⑪ una sede senza linee WAN si conta: è la domanda «da dove esce questa sede?»', () => {
  const R = buildInterSiteWanReport(orgBase({
    sites: [
      { id: 'mi', name: 'Milano', role: 'hub', projectRef: '17', subnets: [] },
      { id: 'to', name: 'Torino', role: 'spoke', subnets: [] },
    ],
    uplinks: [{ id: 'u1', siteId: 'mi', provider: 'Fastweb', circuitId: 'FW-1' }],
    links: [],
  }));
  assert.equal(R.totals.sitesNoLine, 1);
  assert.equal(R.sites.find(s => s.id === 'to').uplinks, 0);
  assert.equal(R.sites.find(s => s.id === 'mi').uplinks, 1);
});
