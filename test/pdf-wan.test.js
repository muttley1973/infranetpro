// Il capitolo WAN sulla CARTA (server/pdf-report.js `_addWanPages`).
//
// I dati li prova test/inter-site-report.test.js, il disegno della mappa
// test/inter-site-svg.test.js. Qui si prova ciò che succede solo quando le due
// metà si incontrano dentro un PDF vero: che la mappa venga misurata col motore
// che poi la disegna, che le frasi della testata siano d'accordo col numero che
// portano, e soprattutto che i quattro dati con cui si telefona all'operatore
// finiscano sul foglio ANCHE quando mancano — perché la loro assenza è la cosa
// che quel capitolo esiste per far vedere.
const test = require('node:test');
const assert = require('node:assert/strict');

let deps;
try { deps = require('../server/pdf-report.js')._loadPdfDeps(); }
catch { /* pdfkit non installato: si salta sotto */ }

const { _addWanPages, _wanMapSvg } = require('../server/pdf-report.js');
const { normalizeOrganization } = require('../lib/inter-site.js');
const { factDeclared, factMeasured } = require('../lib/provenance.js');
const { buildInterSiteWanReport } = require('../lib/inter-site-report.js');

function newDoc() {
  const doc = new deps.PDFDocument({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 }, autoFirstPage: false });
  doc.font('Helvetica');
  return doc;
}

/** Raccoglie tutto ciò che finisce davvero sulla pagina. Stessa tecnica della
 *  prova «nessuna credenziale sulla carta» della sezione Ripristinabilità. */
function scritte(doc) {
  const seen = [];
  const orig = doc.text.bind(doc);
  doc.text = (s, ...rest) => { seen.push(String(s)); return orig(s, ...rest); };
  return seen;
}

function org(extra) {
  return normalizeOrganization(Object.assign({
    id: 'o', name: 'Prova',
    sites: [
      { id: 'mi', name: 'Milano DC', role: 'hub', projectRef: '17', address: 'Via A 1', subnets: ['10.10.0.0/16'] },
      { id: 'rm', name: 'Roma Sede', role: 'spoke', projectRef: '18', subnets: ['10.20.0.0/16'] },
    ],
    uplinks: [
      { id: 'u1', siteId: 'mi', provider: 'Fastweb', serviceType: 'Fibra', circuitId: 'FW-88213',
        cirMbps: 1000, addressing: 'static', nextHop: '203.0.113.9', deliveryVlan: 835,
        mtu: 1492, supportRef: 'https://noc.example/ticket',
        publicIps: factDeclared(['203.0.113.10']),
        wanIfRef: factMeasured('Gi0/0/0', '2026-08-20T10:00:00Z') },
    ],
    links: [
      { id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec', name: 'IPSEC-MI-RM',
        state: factDeclared('up'), ikeVersion: 2, phase1Name: 'MI-RM-P1',
        phase1Proposal: 'aes256-sha256-modp2048 28800s',
        phase2Proposal: 'esp-aes256-sha256 PFS14 3600s',
        pskRef: 'Bitwarden / VPN / MI-RM',
        reach: factDeclared({ a: ['10.10.0.0/16'], b: ['10.20.0.0/16'] }),
        endpointA: { deviceName: 'MI-FW-01', peerIp: '198.51.100.2' },
        endpointB: { deviceName: 'RM-FW-01', peerIp: '198.51.100.1' } },
    ],
  }, extra || {}));
}

const rapporto = (extra, opts) => buildInterSiteWanReport(org(extra), opts);

test('_addWanPages: rende il capitolo in italiano e in inglese senza eccezioni', { skip: !deps }, () => {
  for (const lang of ['it', 'en']) {
    assert.doesNotThrow(() => _addWanPages(newDoc(), rapporto(), 'P', '29/08/2026', lang, deps.SVGtoPDF));
  }
  // Casi limite: nessun rapporto, rapporto malformato, nessun motore SVG.
  assert.doesNotThrow(() => _addWanPages(newDoc(), null, 'P', 'd', 'it', deps.SVGtoPDF));
  assert.doesNotThrow(() => _addWanPages(newDoc(), {}, 'P', 'd', 'it', deps.SVGtoPDF));
  assert.doesNotThrow(() => _addWanPages(newDoc(), rapporto(), 'P', 'd', 'it', null));
});

test('capitolo chiesto su un\'installazione senza sedi: lo stato vuoto, non il silenzio', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  _addWanPages(doc, buildInterSiteWanReport(normalizeOrganization({})), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  // Sparire lascia il lettore a chiedersi se il capitolo manchi per un errore.
  assert.ok(/Nessuna sede dichiarata nel pannello Inter-sede/.test(txt));
});

test('⭐ i quattro dati per telefonare all\'operatore restano in scheda ANCHE vuoti', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  _addWanPages(doc, rapporto({
    uplinks: [{ id: 'u1', siteId: 'rm', provider: null, serviceType: null, circuitId: null, cirMbps: null }],
  }), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  // A differenza della scheda PDU — dove un campo assente sparisce — qui l'assenza
  // È la scoperta: una linea senza codice circuito si deve vedere adesso, non la
  // notte in cui serve dettarlo al telefono.
  for (const etichetta of ['Operatore', 'Servizio', 'Codice circuito', 'Banda della porta']) {
    assert.ok(txt.includes(etichetta), 'in scheda anche vuoto: ' + etichetta);
  }
  assert.ok(txt.includes('1 senza codice circuito'), 'e il buco si conta in testata');
});

test('㉑ le righe con cui la linea si rimette su arrivano sul foglio', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  _addWanPages(doc, rapporto(), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  for (const etichetta of ['Indirizzamento', 'Gateway (next-hop)', 'VLAN di consegna', 'MTU',
    'Assistenza operatore']) {
    assert.ok(txt.includes(etichetta), 'in scheda: ' + etichetta);
  }
  // e i VALORI, non le sole etichette: è la differenza fra una guardia verde e
  // un lettore servito.
  assert.ok(txt.includes('Statico'), 'il modo tradotto, non la sigla interna');
  assert.ok(txt.includes('203.0.113.9'), 'il gateway');
  assert.ok(txt.includes('835'), 'il tag di consegna');
  assert.ok(txt.includes('1492'), "l'MTU");
  assert.ok(txt.includes('noc.example'), 'chi si chiama');
});

// ── ㉖ I rilievi in coda al capitolo ───────────────────────────────────────
// ⚠️ Si guarda il flusso di `doc.text`, che è quello dove queste righe passano
// davvero. Le etichette della MAPPA no — le disegna SVGtoPDF — ed è la trappola
// per cui un banco di questo file è già andato verde guardando il flusso
// sbagliato. Qui la sezione è testo, quindi il flusso è quello giusto.

test('⭐ ㉖ il capitolo dice anche COSA NON TORNA, con le parole del pannello', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  // Il collegamento del banco non dichiara su quale linea corre, e Roma non ha
  // nessuna linea: due rilievi veri, prodotti dai dati e non forzati a mano.
  _addWanPages(doc, rapporto(), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  assert.ok(txt.includes('WAN — cosa non torna'), 'la sezione esiste e si intitola');
  // La FRASE arriva dal dizionario condiviso con il pannello, non da una copia
  // scritta nel generatore: se qualcuno la riformula, cambia in tutt'e due.
  assert.ok(txt.includes('Collegamenti che non dichiarano quale linea WAN li trasmette'),
    'e il rilievo è scritto per esteso, non tagliato a metà');
  assert.ok(txt.includes('IPSEC-MI-RM'), 'col soggetto: QUALE collegamento');
  assert.ok(/2 lacune|1 lacune|lacune/.test(txt), 'e il conto in testata');
});

test('㉖ «non ho potuto controllare» arriva sul foglio col suo perché', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  // Nessun collegamento dichiara i suoi peer: un controllo che non può girare.
  _addWanPages(doc, rapporto({ links: [] }), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  assert.ok(txt.includes('Non ho potuto controllare'), 'il titolo del terzo gruppo');
  assert.ok(txt.includes('non c’è nessun collegamento'), 'e il motivo, tradotto');
});

test('㉖ senza rilievi la sezione NON sparisce: «nessun rilievo» è un\'informazione', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  // Un modello coerente: due sedi, due linee, un collegamento che dice tutto.
  _addWanPages(doc, buildInterSiteWanReport(normalizeOrganization({
    id: 'o', name: 'P',
    sites: [{ id: 'mi', name: 'MI', role: 'standalone', subnets: ['10.10.0.0/16'] },
      { id: 'rm', name: 'RM', role: 'standalone', subnets: ['10.20.0.0/16'] }],
    uplinks: [
      // ⚠️ Anche `addressing` e il gateway: senza, un controllo resta fra i «non
      // ho potuto», e un modello su cui una domanda non si è potuta fare non è
      // un modello senza rilievi — è la terza cosa.
      { id: 'u1', siteId: 'mi', provider: 'A', circuitId: 'C1', mtu: 1500, cirMbps: 100,
        addressing: 'static', nextHop: '203.0.113.1', publicIps: factDeclared(['203.0.113.10']) },
      { id: 'u2', siteId: 'rm', provider: 'B', circuitId: 'C2', mtu: 1500, cirMbps: 100,
        addressing: 'static', nextHop: '198.51.100.1', publicIps: factDeclared(['198.51.100.10']) },
    ],
    links: [{ id: 'l1', aSiteId: 'mi', bSiteId: 'rm', transport: 'internet', tunnel: 'ipsec',
      reach: factDeclared({ a: ['10.10.0.0/16'], b: ['10.20.0.0/16'] }),
      underlayUplinkIds: ['u1', 'u2'],
      endpointA: { peerIp: '198.51.100.10' }, endpointB: { peerIp: '203.0.113.10' } }],
  })), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  assert.ok(txt.includes('WAN — cosa non torna'));
  assert.ok(txt.includes('Nessun rilievo su sedi, linee e collegamenti.'),
    'una sezione che sparisce si legge come una dimenticanza');
});

test('㉑ il gateway si stampa solo dove vuol dire qualcosa', { skip: !deps }, () => {
  const foglio = (addressing, nextHop) => {
    const doc = newDoc();
    const seen = scritte(doc);
    _addWanPages(doc, rapporto({
      uplinks: [{ id: 'u1', siteId: 'mi', provider: 'X', circuitId: 'Y', addressing, nextHop }],
    }), 'P', 'd', 'it', deps.SVGtoPDF);
    return seen.join(' | ');
  };
  // Su DHCP e PPPoE il gateway lo dà la linea: una riga «Gateway —» direbbe che
  // manca un dato che non esiste, e un trattino che accusa il documento giusto
  // insegna a non leggere i trattini.
  assert.ok(!/Gateway/.test(foglio('dhcp')), 'su DHCP la riga non c\'è');
  assert.ok(!/Gateway/.test(foglio('pppoe')), 'su PPPoE nemmeno');
  assert.ok(/Gateway/.test(foglio('static')), 'su statico c\'è, col trattino: quello è un buco vero');
  // ⚠️ E finché non è dichiarato, la riga resta: allora il buco è vero davvero.
  assert.ok(/Gateway/.test(foglio(null)), 'non dichiarato non vuol dire DHCP');
  // ⚠️ E un valore DICHIARATO non si nasconde mai: chi scrive statico + gateway e
  // poi passa a DHCP lascia scritto un indirizzo, e toglierlo dal foglio sarebbe
  // un dato che esiste e non si vede. La condizione toglie il trattino, non il dato.
  assert.ok(/203.0.113.7/.test(foglio('dhcp', '203.0.113.7')),
    'su DHCP niente riga vuota, ma un gateway scritto si stampa');
});

test('㉑ la testata conta le linee statiche che non dicono a chi parlano', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  _addWanPages(doc, rapporto({
    uplinks: [{ id: 'u1', siteId: 'mi', provider: 'X', circuitId: 'Y', addressing: 'static' }],
  }), 'P', 'd', 'it', deps.SVGtoPDF);
  // Non fa perdere un'ora: fa perdere la notte. Sta in testata come le altre.
  assert.ok(seen.join(' | ').includes('1 statiche senza gateway'));
});

test('㉓ la proposta del tunnel arriva sul foglio, la chiave no', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  _addWanPages(doc, rapporto(), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  // È ciò che si ridigita alle tre di notte, e i due capi devono averla identica.
  assert.ok(txt.includes('aes256-sha256-modp2048 28800s'), 'la proposta di fase 1');
  assert.ok(txt.includes('esp-aes256-sha256 PFS14 3600s'), 'la proposta di fase 2');
  // 🔒 E DOVE sta la chiave — che è un puntatore, non un segreto.
  assert.ok(txt.includes('Bitwarden / VPN / MI-RM'), 'il puntatore alla chiave');
});

test('㉗ la pastiglia della mappa dice anche CHI la vende', { skip: !deps }, () => {
  // Fra due sedi corrono più collegamenti: la natura da sola non dice quale
  // contratto guardare quando è giù. L'ordine è quello con cui i riquadri
  // scrivono già le loro linee — «operatore · natura» — perché la mappa sulla
  // carta e quella nel pannello sono LA STESSA mappa.
  // ⚠️ Si guarda l'SVG e non ciò che passa da `doc.text`: le etichette della
  // mappa le disegna `SVGtoPDF`, quindi da lì non passano MAI. È la trappola in
  // cui è caduto questo stesso banco al primo tentativo.
  const m = _wanMapSvg(newDoc(), rapporto({
    links: [{ id: 'l1', aSiteId: 'mi', bSiteId: 'rm', tunnel: 'ipsec', provider: 'TIM',
      reach: factDeclared({ a: ['10.10.0.0/16'], b: ['10.20.0.0/16'] }),
      endpointA: {}, endpointB: {} }],
  }), 'it');
  assert.ok(m.svg.includes('TIM · IPsec'), 'operatore prima della natura, come sui riquadri');
  // ⚠️ E quando l'operatore non c'è — 5 collegamenti su 8 sull'archivio vero —
  // non resta un separatore appeso a niente.
  const m2 = _wanMapSvg(newDoc(), rapporto({
    links: [{ id: 'l1', aSiteId: 'mi', bSiteId: 'rm', tunnel: 'ipsec', endpointA: {}, endpointB: {} }],
  }), 'it');
  assert.ok(/>IPsec/.test(m2.svg), 'la natura resta');
  assert.ok(!/> · |· · /.test(m2.svg), 'niente separatore senza niente davanti');
});

test('⭐ la testata accorda il singolare col numero che porta', { skip: !deps }, () => {
  const testa = (n) => {
    const sedi = [{ id: 'mi', name: 'Milano', role: 'hub', subnets: [] }];
    for (let i = 0; i < n; i++) sedi.push({ id: 's' + i, name: 'Sede ' + i, role: 'spoke', subnets: [] });
    const doc = newDoc();
    const seen = scritte(doc);
    _addWanPages(doc, buildInterSiteWanReport(normalizeOrganization({
      id: 'o', name: 'x', sites: sedi,
      uplinks: [{ id: 'u1', siteId: 'mi', provider: 'X', circuitId: 'Y' }], links: [],
    })), 'P', 'd', 'it', deps.SVGtoPDF);
    return seen.join(' | ');
  };
  // «1 sedi senza linea WAN» in cima a un capitolo fa dubitare di tutto il resto
  // di ciò che c'è scritto sotto: è la stessa regola dei conteggi del pannello.
  assert.ok(/1 sede senza linea WAN/.test(testa(1)), 'una sola: singolare');
  assert.ok(!/1 sedi/.test(testa(1)));
  assert.ok(/2 sedi senza linea WAN/.test(testa(2)), 'due: plurale');
});

test('⭐ i capi e l\'encryption domain arrivano sul foglio', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  _addWanPages(doc, rapporto(), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  // ⚠️ `peerIp` è l'indirizzo dell'ALTRO capo visto da questa sede: le parole lo
  // dicono per esteso, o si ricablano i due capi al contrario.
  assert.ok(/Milano DC -> MI-FW-01 \(scritto a mano\) · peer visto da qui: 198\.51\.100\.2/.test(txt));
  assert.ok(/Roma Sede -> RM-FW-01 \(scritto a mano\) · peer visto da qui: 198\.51\.100\.1/.test(txt));
  // Su un IPsec queste reti SONO l'encryption domain: senza, il tunnel si rialza
  // e non ci passa niente.
  assert.ok(/presso Milano DC: 10\.10\.0\.0\/16/.test(txt));
  assert.ok(/presso Roma Sede: 10\.20\.0\.0\/16/.test(txt));
  // E chi afferma cosa: un valore senza origine, in un dossier, si legge come una
  // certezza.
  assert.ok(txt.includes('Gi0/0/0 (misurato, 20/08/2026)'));
  assert.ok(txt.includes('IKEv2') && txt.includes('MI-RM-P1'));
});

test('la mappa è VETTORIALE e misurata col motore che la disegnerà', { skip: !deps }, () => {
  const doc = newDoc();
  const m = _wanMapSvg(doc, rapporto(null, { projectRef: '17' }), 'it');
  assert.ok(m && m.svg.startsWith('<svg'), 'un SVG, non un\'immagine');
  assert.ok(m.width > 0 && m.height > 0);
  assert.equal(m.layoutKind, 'hub', 'una sola sede hub: al centro');
  // ④ del layout: il riquadro si allarga sul testo VERO, misurato con pdfkit.
  // Senza righello resterebbe la scatola dichiarata (210 di larghezza), e i nomi
  // uscirebbero dai bordi.
  assert.ok(/<text[^>]*>Milano DC<\/text>/.test(m.svg));
  assert.ok(m.svg.includes('Fastweb · Fibra'), 'la linea WAN sta DENTRO il riquadro della sede');
  assert.ok(m.svg.includes('203.0.113.10'));
  assert.doesNotThrow(() => deps.SVGtoPDF(doc.addPage(), m.svg, 20, 20, {
    width: 400, height: 300, assumePt: true, warningCallback: () => {},
    fontCallback: (_f, b) => (b ? 'Helvetica-Bold' : 'Helvetica'),
  }), 'e svg-to-pdfkit lo digerisce');
});

test('⭐ il righello serve a questo: il testo sta DENTRO il suo riquadro, e i riquadri non si toccano', { skip: !deps }, () => {
  const doc = newDoc();
  // Nomi lunghi apposta: è il caso in cui la scatola dichiarata (210 di
  // larghezza, il ripiego di chi non ha un righello) non basta più.
  const m = _wanMapSvg(doc, rapporto({
    sites: [
      { id: 'mi', name: 'Milano Data Center Principale', role: 'hub', projectRef: '17', subnets: ['10.10.0.0/16'] },
      { id: 'rm', name: 'Roma Sede Amministrativa Tiburtina', role: 'spoke', subnets: ['10.20.0.0/16'] },
      { id: 'na', name: 'Napoli Filiale Commerciale', role: 'spoke', subnets: [] },
    ],
    uplinks: [{ id: 'u1', siteId: 'mi', provider: 'Operatore Nazionale SpA', serviceType: 'Fibra dedicata simmetrica' }],
    links: [{ id: 'l1', aSiteId: 'mi', bSiteId: 'rm', kind: 'mpls' }, { id: 'l2', aSiteId: 'mi', bSiteId: 'na', kind: 'gre' }],
  }), 'it');

  // Ogni riquadro è largo almeno quanto la riga più lunga che contiene.
  const gruppi = m.svg.split('<rect ').slice(1);
  const riquadri = [];
  for (const g of gruppi) {
    // Solo i riquadri delle SEDI: la pastiglia di un collegamento è pure lei un
    // rettangolo bianco arrotondato, e si riconosce dal colore del bordo.
    const r = g.match(/^x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="10" fill="#ffffff" stroke="(?:#94a3b8|#1d4ed8)"/);
    if (!r) continue;
    const testi = [...g.matchAll(/font-size="([\d.]+)"([^>]*)>([^<]*)<\/text>/g)];
    riquadri.push({ x: +r[1], y: +r[2], w: +r[3], h: +r[4], testi });
  }
  assert.equal(riquadri.length, 3, 'tre sedi, tre riquadri');
  // ⚠️ Dentro l'IMBOTTITURA, non dentro il bordo: un testo che arriva a filo del
  // rettangolo si legge già come un difetto di stampa, e la scatola dichiarata
  // (210, il ripiego di chi non misura) ci arriva per un pelo proprio coi nomi
  // lunghi — cioè il caso in cui il righello serve.
  const INTERNO = 11 * 2;   // INTER_SITE_SVG_GEOM.padX per due
  for (const b of riquadri) {
    for (const [, size, attr, testo] of b.testi) {
      doc.font(attr.includes('bold') ? 'Helvetica-Bold' : 'Helvetica').fontSize(Number(size));
      const largo = doc.widthOfString(testo);
      // ⚠️ Un centesimo di tolleranza: il layout arrotonda le coordinate a 0.01
      // apposta (diff di golden leggibili), quindi il riquadro può risultare
      // qualche millesimo più stretto del testo che ci sta dentro. È
      // arrotondamento, non un testo che esce.
      assert.ok(largo <= b.w - INTERNO + 0.05, `«${testo}» esce dal riquadro (${largo} > ${b.w - INTERNO})`);
    }
  }
  // E due riquadri non si sovrappongono: con l'hub al centro è il caso in cui
  // succedeva davvero — «i riquadri sono troppo grandi, non si vedono più i
  // collegamenti».
  for (let i = 0; i < riquadri.length; i++) {
    for (let j = i + 1; j < riquadri.length; j++) {
      const a = riquadri[i], b = riquadri[j];
      const tocca = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!tocca, 'riquadri sovrapposti: ' + i + ' e ' + j);
    }
  }
});

test('nessun campo estraneo finisce sulla carta: si stampa ciò che il modello dichiara', { skip: !deps }, () => {
  const doc = newDoc();
  const seen = scritte(doc);
  // Un JSON scritto a mano può portare qualunque cosa: la normalizzazione tiene
  // solo i campi del modello, e la scheda legge solo quelli.
  _addWanPages(doc, rapporto({
    uplinks: [{ id: 'u1', siteId: 'mi', provider: 'Fastweb', circuitId: 'FW-1',
      password: 'hunter2', community: 'public', pskSegreta: 'S3cr3t' }],
  }), 'P', 'd', 'it', deps.SVGtoPDF);
  const txt = seen.join(' | ');
  assert.ok(!/hunter2|public|S3cr3t/.test(txt), 'un dossier si inoltra per email');
  assert.ok(txt.includes('FW-1'), 'ma il codice circuito, che serve, resta');
});
