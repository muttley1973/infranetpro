// ============================================================
// RIPRISTINO WAN — le schede del capitolo inter-sede del dossier
// (UMD-lite, Node + browser · lingua-indipendente · puro)
// ============================================================
// Il capitolo di carta che risponde a UNA domanda sola: **la linea è giù, o la
// sede è bruciata — cosa mi serve per rimetterla su?** Non è un riassunto della
// mappa: è l'elenco di ciò che nessuno si ricorda a memoria alle tre di notte —
// il codice del circuito da dettare al telefono, chi lo vende, su quale scatola
// si va a mettere le mani, l'indirizzo dell'altro capo, quali reti quel
// collegamento deve tornare a portare.
//
// ── Le scelte, e perché ───────────────────────────────────────────────────
//
//  ① **Qui non ci sono PAROLE.** Escono codici (`kind`, `role`, l'origine di un
//     fatto) e valori grezzi; chi stampa traduce. È la stessa divisione di
//     `lib/pdu-report.js`: la lib pura è l'unica fonte dei numeri, il glue
//     l'unica delle parole, e nessuno dei due tiene una seconda copia dell'altro.
//
//  ② **Ciò che manca si DICE, non si riempie.** Un campo non dichiarato esce
//     `null` e chi stampa ci mette un trattino. Mai uno zero, mai una lista
//     vuota al posto di un'assenza: a valle nessuno distinguerebbe più «non
//     c'è banda garantita nel contratto» da «la banda garantita è zero».
//     → [[ripiego-e-unaffermazione]]
//
//  ③ **Il buco è un DATO del capitolo, non un difetto da nascondere.** Una linea
//     senza codice circuito e un collegamento senza reti dichiarate sono
//     esattamente ciò che, la notte dell'incidente, fa perdere l'ora: si contano
//     in testata come la ripristinabilità conta gli apparati senza backup. Un
//     dossier che tace le proprie lacune è più pericoloso di uno che le stampa.
//
//  ④ **L'organizzazione viaggia insieme al rapporto, non ricopiata.** La mappa
//     si costruisce dalle stesse coordinate del pannello (`inter-site-layout`),
//     e quel modulo vuole l'organizzazione: gliela si passa TALE E QUALE
//     (`report.organization`), invece di ricomporne una versione rimasticata da
//     queste righe — che sarebbe la n-esima definizione doppia.
//     → [[definizioni-duplicate-motore-renderer]]
//
//  ⑤ **Un capo che non risolve lo dice.** `deviceRef` punta a un nodo dentro il
//     progetto-sede: se il progetto non si legge, o quel nodo non c'è più, la
//     scheda non deve restare bianca in quel punto — «apparato non trovato» è
//     un'informazione, il bianco è un dubbio. Sono i tre stati che il pannello
//     mostra a schermo, e sono gli stessi qui.
//
// ⚠️ `.js` e non `.ts`: il prodotto dichiara `engines: node >=16` e la CI gira su
//    18.x/20.x, dove un `.ts` è un SyntaxError. Vedi `lib/provenance.js`.

/** Da dove viene il nome dell'apparato a un capo del collegamento (⑤).
 *  `linked` risolto dal progetto · `typed` scritto a mano · `missing` il
 *  riferimento non risolve più · `unreadable` il progetto non si è potuto
 *  leggere · `none` non è stato dichiarato niente.
 *  @typedef {'linked'|'typed'|'missing'|'unreadable'|'none'} WanEndpointState */

/** Un fatto appiattito per la stampa: il valore e chi lo afferma. `null` intero
 *  quando il fatto non c'è — mai un valore finto con l'origine a `null` (②).
 *  @typedef {{value:*, origin:string|null, at:string|null}} FlatFact */

/** Una linea WAN, come la legge chi deve rimetterla in servizio.
 *  @typedef {{id:string, siteId:string, siteName:string, here:boolean,
 *             provider:string|null, serviceType:string|null, circuitId:string|null,
 *             cirMbps:number|null, slaRef:string|null,
 *             publicIps:FlatFact|null, wanIf:FlatFact|null}} WanLineRow */

/** Un capo di un collegamento: su quale scatola, e l'indirizzo dell'ALTRO capo.
 *  ⚠️ `peerIp` è l'indirizzo del peer VISTO DA questa sede, non l'indirizzo di
 *  questa sede: i due capi si incrociano, ed è la trappola del dominio.
 *  @typedef {{siteId:string, siteName:string, device:string|null,
 *             deviceState:WanEndpointState, peerIp:string|null}} WanLinkEnd */

/** Un collegamento fra due sedi, con tutto ciò che serve a ricostruirlo.
 *  @typedef {{id:string, name:string|null, kind:string, kindLabel:string|null,
 *             topology:string|null, state:FlatFact|null,
 *             provider:string|null, circuitId:string|null,
 *             vrf:string|null, service:string|null, overlay:string|null,
 *             media:string|null, phase1Name:string|null, ikeVersion:number|null,
 *             underlay:{uplinkId:string, provider:string|null, circuitId:string|null,
 *                       found:boolean}[],
 *             reach:FlatFact|null, a:WanLinkEnd, b:WanLinkEnd,
 *             drawable:boolean, missingSites:string[], here:boolean}} WanLinkRow */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(
    isNode ? require('./inter-site.js') : root,
    isNode ? require('./provenance.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (IS, prov) {
  'use strict';

  const _s = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };

  /** Un fatto appiattito, o `null` se il fatto non c'è (②). `valueOf` estrae il
   *  valore dal fatto: su `reach` è un oggetto, su `publicIps` una lista. */
  /** @param {*} f @param {(v:*)=>*} [pick] @returns {FlatFact|null} */
  function _flat(f, pick) {
    if (!prov.isFact(f)) return null;
    const v = prov.factValue(f);
    const out = pick ? pick(v) : v;
    if (out == null) return null;
    return { value: out, origin: prov.factOrigin(f), at: prov.factAt(f) || null };
  }

  /**
   * Il nome dell'apparato a un capo, e da dove viene (⑤).
   *
   * `deviceNameOf(siteId, deviceRef)` è il righello iniettato da chi ha i
   * progetti in mano: una stringa se il nodo c'è, `null` se il progetto si è
   * letto ma quel nodo non c'è più, `undefined` se non si è potuto leggere.
   * Senza righello ogni riferimento resta `unreadable`: dire «non trovato»
   * quando non si è nemmeno guardato sarebbe un'accusa inventata.
   */
  /** @param {*} ep @param {string} siteId @param {*} deviceNameOf @returns {{device:string|null, deviceState:WanEndpointState}} */
  function _endpointDevice(ep, siteId, deviceNameOf) {
    const e = ep || {};
    const ref = _s(e.deviceRef);
    if (ref) {
      if (typeof deviceNameOf !== 'function') return { device: null, deviceState: 'unreadable' };
      const nome = deviceNameOf(siteId, ref);
      if (nome === undefined) return { device: null, deviceState: 'unreadable' };
      const n = _s(nome);
      return n ? { device: n, deviceState: 'linked' } : { device: null, deviceState: 'missing' };
    }
    const scritto = _s(e.deviceName);
    if (scritto) return { device: scritto, deviceState: 'typed' };
    return { device: null, deviceState: 'none' };
  }

  /**
   * Il capitolo «WAN» del dossier, a partire dall'organizzazione NORMALIZZATA.
   *
   * `opts.projectRef` è il progetto per cui si sta stampando il dossier: la sede
   * che lo referenzia si marca `here`. Non cambia cosa esce — la WAN si
   * ripristina guardandola intera, e la linea dell'altra sede è la metà che
   * manca a capire perché questa non passa — ma dice a chi legge dov'è.
   *
   * @param {*} org l'organizzazione, già passata da `normalizeOrganization`
   * @param {{projectRef?:*, deviceNameOf?:(siteId:string, ref:string)=>(string|null|undefined)}} [opts]
   */
  function buildInterSiteWanReport(org, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const organization = (org && typeof org === 'object') ? org : { id: '', name: '', sites: [], uplinks: [], links: [] };
    const sitesIn = Array.isArray(organization.sites) ? organization.sites : [];
    const uplinksIn = Array.isArray(organization.uplinks) ? organization.uplinks : [];
    const linksIn = Array.isArray(organization.links) ? organization.links : [];
    const here = _s(o.projectRef);
    const deviceNameOf = o.deviceNameOf;

    /** @type {Record<string,*>} */
    const perId = Object.create(null);
    for (const s of sitesIn) perId[s.id] = s;
    const nomeSede = (id) => (perId[id] ? perId[id].name : null);

    const sites = sitesIn.map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      address: _s(s.address),
      projectRef: _s(s.projectRef),
      subnets: Array.isArray(s.subnets) ? s.subnets.slice() : [],
      uplinks: IS.uplinksOfSite(organization, s.id).length,
      links: IS.linksOfSite(organization, s.id).length,
      here: !!(here && _s(s.projectRef) === here),
    }));

    const lines = uplinksIn.map(u => ({
      id: u.id,
      siteId: u.siteId,
      siteName: nomeSede(u.siteId),
      here: !!(here && perId[u.siteId] && _s(perId[u.siteId].projectRef) === here),
      provider: _s(u.provider),
      serviceType: _s(u.serviceType),
      circuitId: _s(u.circuitId),
      cirMbps: (typeof u.cirMbps === 'number' && Number.isFinite(u.cirMbps)) ? u.cirMbps : null,
      slaRef: _s(u.slaRef),
      // ⑦ Gli indirizzi pubblici sono una LISTA perché uno solo è falso (un
      // blocco instradato, l'IPv6, una coppia in HA). Si stampano tutti.
      publicIps: _flat(u.publicIps, (v) => (Array.isArray(v) && v.length ? v.slice() : null)),
      wanIf: _flat(u.wanIfRef, (v) => _s(v)),
    }));

    /** @type {Record<string,*>} */
    const uplinkById = Object.create(null);
    for (const u of uplinksIn) uplinkById[u.id] = u;

    const links = linksIn.map(l => {
      const mancanti = [];
      if (!perId[l.aSiteId]) mancanti.push(l.aSiteId);
      if (!perId[l.bSiteId]) mancanti.push(l.bSiteId);
      const capo = (ep, siteId) => Object.assign(
        { siteId, siteName: nomeSede(siteId), peerIp: _s(ep && ep.peerIp) },
        _endpointDevice(ep, siteId, deviceNameOf)
      );
      return {
        id: l.id,
        name: _s(l.name),
        kind: l.kind,
        // ⑨ `other` è ignoranza DICHIARATA: l'etichetta di chi ha documentato è
        // l'unica cosa che dice che cos'è quel collegamento, e sulla carta vale
        // più del codice.
        kindLabel: _s(l.kindLabel),
        topology: _s(l.topology),
        state: _flat(l.state),
        provider: _s(l.provider),
        circuitId: _s(l.circuitId),
        vrf: _s(l.vrf),
        service: _s(l.service),
        overlay: _s(l.overlay),
        media: _s(l.media),
        phase1Name: _s(l.phase1Name),
        ikeVersion: (l.ikeVersion === 1 || l.ikeVersion === 2) ? l.ikeVersion : null,
        // ⑳ Le linee su cui il collegamento CORRE — per ogni natura, non più
        // solo sotto un overlay SD-WAN: è la metà che mancava per rispondere a
        // «è giù questa linea, cosa cade con lei». Un id che non risolve resta
        // in elenco marcato `found:false` — sparire lascerebbe credere che il
        // collegamento poggi su una linea in meno di quante ne dichiara.
        underlay: (Array.isArray(l.underlayUplinkIds) ? l.underlayUplinkIds : []).map(id => {
          const u = uplinkById[id];
          return {
            uplinkId: id,
            provider: u ? _s(u.provider) : null,
            circuitId: u ? _s(u.circuitId) : null,
            found: !!u,
          };
        }),
        // ② Su un IPsec `reach` È l'encryption domain: senza, il tunnel si
        // rialza e non passa niente. Un `reach` assente resta `null`.
        reach: _flat(l.reach, (v) => {
          const a = (v && Array.isArray(v.a)) ? v.a.slice() : [];
          const b = (v && Array.isArray(v.b)) ? v.b.slice() : [];
          return (a.length || b.length) ? { a, b } : null;
        }),
        a: capo(l.endpointA, l.aSiteId),
        b: capo(l.endpointB, l.bSiteId),
        drawable: !mancanti.length,
        missingSites: mancanti,
        here: !!(here && ((perId[l.aSiteId] && _s(perId[l.aSiteId].projectRef) === here)
          || (perId[l.bSiteId] && _s(perId[l.bSiteId].projectRef) === here))),
      };
    });

    // ③ I buchi, contati. Sono le tre domande che alle tre di notte non hanno
    // risposta: a chi telefono, che numero gli detto, e cosa deve tornare a
    // passare di là.
    const totals = {
      sites: sites.length,
      lines: lines.length,
      links: links.length,
      sitesNoLine: sites.filter(s => !s.uplinks).length,
      linesNoCircuitId: lines.filter(l => !l.circuitId).length,
      linesNoProvider: lines.filter(l => !l.provider).length,
      linksNoReach: links.filter(l => !l.reach).length,
      linksUndrawable: links.filter(l => !l.drawable).length,
    };

    return {
      // ④ L'input, non una sua copia: chi disegna la mappa lo passa a
      // `buildInterSiteLayout` e ottiene le STESSE coordinate del pannello.
      organization,
      name: _s(organization.name),
      here,
      totals,
      sites,
      lines,
      links,
    };
  }

  return { buildInterSiteWanReport };
});
