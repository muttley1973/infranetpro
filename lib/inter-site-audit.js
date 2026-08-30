// ============================================================
// AUDIT INTER-SEDE — coerenza del modello multi-sede, sul SOLO DICHIARATO
// (UMD-lite, Node + browser · lingua-indipendente · puro)
// ============================================================
// Fase 1 del piano `_local/notes/PIANO_multi-sede-wan-vpn.md`. Nessuna rete: qui
// si confronta ciò che è stato DICHIARATO con sé stesso, e si dice dove non torna.
// La discovery (Fase 2) e il drift (Fase 3) non c'entrano — questo modulo è utile
// da solo, il giorno in cui uno scrive le sue tre sedi a mano.
//
// ── Due cose che questo modulo si rifiuta di fare ─────────────────────────
//
//  ① **Non confonde «ho guardato e va bene» con «non ho potuto guardare».**
//     Ogni controllo che non ha potuto girare lascia il suo nome in `notChecked`
//     con il perché. Senza quel registro, una lista vuota direbbe due cose
//     diverse con la stessa faccia — ed è la stessa scelta già presa in
//     `lib/ipam-audit.js`, per lo stesso motivo. Un audit che tace su ciò che
//     non ha esaminato è un audit che mente per omissione.
//
//  ② **Non fonde «è sbagliato» con «non è scritto».** Un tunnel che trasporta
//     una rete che nessuna sede possiede è un ERRORE. Un uplink senza IP
//     pubblico è solo documentazione incompleta: non c'è niente di rotto, c'è
//     una domanda a cui non sai rispondere. Restano liste separate e ognuna col
//     suo nome, così chi RACCONTA (la glue) può dare loro un peso diverso —
//     qui si CALCOLA soltanto, e non c'è una sola stringa di UI.
//
// ── La sottigliezza che ha cambiato un controllo ──────────────────────────
// Il piano parlava di «encryption domain ASIMMETRICA fra i due capi». Con il
// modello di Fase 0 quel controllo **non è esprimibile**, e va detto invece che
// simulato: `reach` è UNA dichiarazione sola sul collegamento (`{a, b}`), non due
// dichiarazioni da confrontare. Due capi che si contraddicono si vedono solo
// quando si LEGGONO tutti e due i firewall — cioè in Fase 3, come drift.
// Quello che invece è esprimibile oggi, ed è la domanda vera dietro a quella, è:
// «il collegamento trasporta una rete che non risulta a NESSUNA sede?»
// (`subnetsNowhere`). Meglio un controllo che risponde di uno che finge.
//
// ⚠️ Il transito è LEGITTIMO: in hub-and-spoke il collegamento Milano↔Roma può
//    portare, dal capo di Milano, anche le reti di Napoli — perché Milano fa da
//    hub. Per questo NON si controlla che `reach.a` stia dentro le subnet della
//    sede A: sarebbe un falso positivo su ogni topologia hub-and-spoke reale.
//    Si controlla solo che la rete risulti a QUALCHE sede.

/** Un controllo che non ha potuto girare, e il perché.
 *  @typedef {{check:string, reason:string}} InterSiteNotChecked */

/** L'esito dell'audit. Liste per nome, come in `ipam-audit`; la glue racconta.
 *  Le prime SETTE sono INCOERENZE (qualcosa non torna), le altre cinque LACUNE
 *  (niente è rotto, ma non sai rispondere) — e `notChecked` è la terza cosa,
 *  che non è nessuna delle due.
 *  ⚠️ In `underlaysNotAtEnds` un `siteId` a `null` NON è un dato mancante: è il
 *  secondo dei due modi di sbagliare — la linea dichiarata non esiste proprio,
 *  invece di esistere alla sede sbagliata.
 *  @typedef {{
 *   subnetsNowhere: {subnet:string, at:{linkId:string, siteId:string}[]}[],
 *   subnetsAtTwoSites: {subnet:string, siteIds:string[]}[],
 *   linksToUnknownSite: {linkId:string, missing:string[]}[],
 *   uplinksToUnknownSite: {uplinkId:string, siteId:string}[],
 *   spokesWithoutHub: {siteId:string}[],
 *   underlaysNotAtEnds: {linkId:string, uplinkId:string, siteId:string|null}[],
 *   subnetsNotCarried: {subnet:string, siteId:string}[],
 *   linksWithoutReach: {linkId:string}[],
 *   sitesWithoutLink: {siteId:string}[],
 *   sitesWithoutUplink: {siteId:string}[],
 *   uplinksWithoutPublicIp: {uplinkId:string, siteId:string}[],
 *   staticUplinksWithoutNextHop: {uplinkId:string, siteId:string}[],
 *   notChecked: InterSiteNotChecked[]
 *  }} InterSiteAudit */

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

  const _sortedKeys = (o) => Object.keys(o).sort();

  /**
   * L'audit del modello inter-sede, sul solo dichiarato.
   * Accetta un'organizzazione grezza o già normalizzata: `normalizeOrganization`
   * è idempotente, quindi il chiamante non deve ricordarsi di quale delle due ha.
   */
  /** @param {unknown} rawOrg @returns {InterSiteAudit} */
  function buildInterSiteAudit(rawOrg) {
    const org = IS.normalizeOrganization(rawOrg);
    /** @type {{id:string, role:string, subnets:string[]}[]} */
    const sites = org.sites;
    /** @type {{id:string, aSiteId:string, bSiteId:string, reach:unknown,
     *          underlayUplinkIds:string[]}[]} */
    const links = org.links;
    /** @type {{id:string, siteId:string, publicIps:unknown,
     *          addressing:string|null, nextHop:string|null}[]} */
    const uplinks = org.uplinks;

    /** @type {InterSiteNotChecked[]} */
    const notChecked = [];
    const siteIds = new Set(sites.map(s => s.id));

    // Cosa c'è abbastanza per guardare. Ogni «no» qui sotto diventa una riga in
    // `notChecked`: è la differenza fra «ho guardato» e «non ho potuto».
    const anySite = sites.length > 0;
    const anyLink = links.length > 0;
    const anyUplink = uplinks.length > 0;
    const anySiteSubnet = sites.some(s => s.subnets.length > 0);
    const anyReach = links.some(l => {
      const r = IS.linkReach(l);
      return r.a.length > 0 || r.b.length > 0;
    });
    const anyHub = sites.some(s => s.role === 'hub');
    const anySpoke = sites.some(s => s.role === 'spoke');

    /** @type {InterSiteAudit} */
    const audit = {
      subnetsNowhere: [], subnetsAtTwoSites: [], linksToUnknownSite: [],
      uplinksToUnknownSite: [], spokesWithoutHub: [],
      underlaysNotAtEnds: [],
      subnetsNotCarried: [], linksWithoutReach: [], sitesWithoutLink: [],
      sitesWithoutUplink: [], uplinksWithoutPublicIp: [], staticUplinksWithoutNextHop: [],
      notChecked,
    };

    if (!anySite) {
      // Senza sedi non c'è un modello multi-sede: ogni controllo è cieco, e dire
      // «nessun problema» sarebbe la bugia più grossa possibile.
      for (const c of Object.keys(audit)) {
        if (c !== 'notChecked') notChecked.push({ check: c, reason: 'no-sites' });
      }
      return audit;
    }

    // ── subnet dichiarata da due sedi (sovrapposizione) ────────────────────
    if (!anySiteSubnet) {
      notChecked.push({ check: 'subnetsAtTwoSites', reason: 'no-site-subnets' });
    } else {
      /** @type {Record<string,string[]>} */
      const idx = IS.subnetSiteIndex(org);
      for (const subnet of _sortedKeys(idx)) {
        if (idx[subnet].length > 1) audit.subnetsAtTwoSites.push({ subnet, siteIds: idx[subnet].slice() });
      }
    }

    // ── capi che puntano a una sede inesistente ────────────────────────────
    // Strutturale: non serve altro che l'elenco delle sedi, quindi gira sempre.
    for (const l of links) {
      const missing = [l.aSiteId, l.bSiteId].filter(id => !siteIds.has(id));
      if (missing.length) audit.linksToUnknownSite.push({ linkId: l.id, missing });
    }
    for (const u of uplinks) {
      if (!siteIds.has(u.siteId)) audit.uplinksToUnknownSite.push({ uplinkId: u.id, siteId: u.siteId });
    }

    // ── collegamenti che non dicono cosa trasportano ───────────────────────
    if (!anyLink) {
      notChecked.push({ check: 'linksWithoutReach', reason: 'no-links' });
    } else {
      for (const l of links) {
        const r = IS.linkReach(l);
        if (!r.a.length && !r.b.length) audit.linksWithoutReach.push({ linkId: l.id });
      }
    }

    // ── una rete trasportata che non risulta a NESSUNA sede ────────────────
    // Il controllo che sostituisce l'«encryption domain asimmetrica» del piano
    // (vedi l'intestazione). Cieco senza reach o senza subnet dichiarate.
    if (!anyLink) notChecked.push({ check: 'subnetsNowhere', reason: 'no-links' });
    else if (!anyReach) notChecked.push({ check: 'subnetsNowhere', reason: 'no-reach' });
    else if (!anySiteSubnet) notChecked.push({ check: 'subnetsNowhere', reason: 'no-site-subnets' });
    else {
      const known = new Set();
      for (const s of sites) for (const n of s.subnets) known.add(n);
      /** @type {Record<string, {linkId:string, siteId:string}[]>} */
      const hits = Object.create(null);
      for (const l of links) {
        const r = IS.linkReach(l);
        for (const [end, siteId] of [['a', l.aSiteId], ['b', l.bSiteId]]) {
          for (const n of /** @type {Record<string,string[]>} */ (r)[end]) {
            if (known.has(n)) continue;
            if (!hits[n]) hits[n] = [];
            hits[n].push({ linkId: l.id, siteId });
          }
        }
      }
      for (const subnet of _sortedKeys(hits)) audit.subnetsNowhere.push({ subnet, at: hits[subnet] });
    }

    // ── una rete di una sede che nessuno dei SUOI collegamenti trasporta ───
    // «Esiste a Roma, ma nessun tunnel la porta: da fuori non la raggiunge
    // nessuno.» Cieco senza reach: senza, ogni rete risulterebbe non trasportata
    // e l'elenco sarebbe una copia dell'inventario, non una scoperta.
    if (!anySiteSubnet) notChecked.push({ check: 'subnetsNotCarried', reason: 'no-site-subnets' });
    else if (!anyLink) notChecked.push({ check: 'subnetsNotCarried', reason: 'no-links' });
    else if (!anyReach) notChecked.push({ check: 'subnetsNotCarried', reason: 'no-reach' });
    else {
      for (const s of sites) {
        const carried = new Set();
        for (const l of IS.linksOfSite(org, s.id)) {
          for (const n of IS.linkReachAt(l, s.id)) carried.add(n);
        }
        // Una sede senza collegamenti finisce in `sitesWithoutLink`: ripetere qui
        // ogni sua subnet sarebbe lo stesso fatto detto due volte, più forte.
        if (!IS.linksOfSite(org, s.id).length) continue;
        for (const n of s.subnets) {
          if (!carried.has(n)) audit.subnetsNotCarried.push({ subnet: n, siteId: s.id });
        }
      }
    }

    // ── uno `spoke` che non tocca nessun `hub` ─────────────────────────────
    // Contraddizione fra la topologia DICHIARATA e i collegamenti DICHIARATI.
    //
    // ⚠️ **Senza nessuno spoke non c'è niente da controllare, e non è cecità.**
    // Su un'organizzazione di sedi tutte indipendenti — quattro sedi, nessuna
    // che si dichiari spoke — questo controllo si registrava fra i «non ho
    // potuto», e chiedeva al lettore di rimediare a una domanda che non si era
    // mai posta. «Non ho potuto guardare» e «non c'era niente da guardare» sono
    // due cose diverse, ed è tutto il senso di `notChecked`: metterci anche la
    // seconda lo trasforma in una lista di rimproveri, e allora nessuno la legge
    // più — che è il modo in cui si perde anche la prima.
    // ⚠️ L'ordine conta: `anySpoke` PRIMA di `anyHub`. Il contrario direbbe
    // «manca un hub» a chi non ha spoke, cioè accuserebbe di un'incompletezza
    // una documentazione completa.
    if (!anySpoke) { /* nessuna sede si dichiara spoke: la domanda non esiste */ }
    else if (!anyHub) notChecked.push({ check: 'spokesWithoutHub', reason: 'no-hub' });
    else if (!anyLink) notChecked.push({ check: 'spokesWithoutHub', reason: 'no-links' });
    else {
      const hubs = new Set(sites.filter(s => s.role === 'hub').map(s => s.id));
      for (const s of sites) {
        if (s.role !== 'spoke') continue;
        const toHub = IS.linksOfSite(org, s.id)
          .some((l) => hubs.has(IS.linkPeerSite(l, s.id)));
        if (!toHub) audit.spokesWithoutHub.push({ siteId: s.id });
      }
    }

    // ── una linea dichiarata che NON può essere di quel collegamento ───────
    // ⑳ Un collegamento dice su quali linee WAN corre. Quella dichiarazione può
    // essere falsa in due modi, e sono tutt'e due contraddizioni fra cose
    // DICHIARATE: la linea sta a una sede che non è nessuno dei due capi (una
    // linea di Torino non porta un Milano↔Roma), oppure la linea non esiste
    // affatto — cancellata dopo, o mai esistita. Una lista sola, e `siteId` dice
    // quale dei due: la riparazione è la stessa, togliere quella spunta.
    //
    // ⚠️ Serve anche se il pannello offre solo le linee dei due capi, perché il
    // pannello non è l'unica strada: il file si scrive a mano, torna da un
    // backup, e i capi di un collegamento si possono cambiare DOPO aver spuntato
    // le linee — quello è il caso vero, e nessuno ripassa a controllare. Sulla
    // carta poi è invisibile: la scheda di ripristino stampa «operatore ·
    // codice» senza la sede, quindi una linea sbagliata si legge esattamente
    // come una giusta. È il posto peggiore in cui lasciare una cosa falsa.
    //
    // ⚠️ Si guardano solo i collegamenti con TUTT'E DUE i capi esistenti. Con un
    // capo rotto il difetto è già detto da `linksToUnknownSite`, e finché resta
    // lì nessuno può dire a quale sede quella linea dovrebbe appartenere:
    // accusare due volte lo stesso guasto lo fa sembrare due guasti.
    const conUnderlay = links.filter(l => (l.underlayUplinkIds || []).length);
    if (!anyLink) notChecked.push({ check: 'underlaysNotAtEnds', reason: 'no-links' });
    else if (!conUnderlay.length) notChecked.push({ check: 'underlaysNotAtEnds', reason: 'no-underlay' });
    else {
      const sedeDiUplink = new Map(uplinks.map(u => [u.id, u.siteId]));
      for (const l of conUnderlay) {
        if (!siteIds.has(l.aSiteId) || !siteIds.has(l.bSiteId)) continue;
        for (const uplinkId of l.underlayUplinkIds) {
          const dove = sedeDiUplink.has(uplinkId) ? sedeDiUplink.get(uplinkId) : null;
          if (dove === l.aSiteId || dove === l.bSiteId) continue;
          audit.underlaysNotAtEnds.push({ linkId: l.id, uplinkId, siteId: dove });
        }
      }
    }

    // ── lacune di documentazione ───────────────────────────────────────────
    if (!anyLink) {
      notChecked.push({ check: 'sitesWithoutLink', reason: 'no-links' });
    } else {
      for (const s of sites) {
        if (!IS.linksOfSite(org, s.id).length) audit.sitesWithoutLink.push({ siteId: s.id });
      }
    }

    if (!anyUplink) {
      notChecked.push({ check: 'sitesWithoutUplink', reason: 'no-uplinks' });
      notChecked.push({ check: 'uplinksWithoutPublicIp', reason: 'no-uplinks' });
      notChecked.push({ check: 'staticUplinksWithoutNextHop', reason: 'no-uplinks' });
    } else {
      for (const s of sites) {
        if (!IS.uplinksOfSite(org, s.id).length) audit.sitesWithoutUplink.push({ siteId: s.id });
      }
      for (const u of uplinks) {
        // Un envelope c'è o non c'è: un IP pubblico «vuoto» non esiste, perché
        // `normalizeWanUplink` rifiuta un valore nudo (② no-invenzioni).
        // ⚠️ Ora la lacuna è «NESSUN indirizzo», non «meno di uno»: un uplink con
        // un blocco /29 e il suo IPv6 ne dichiara parecchi ed è documentato bene.
        // Quanti ne servano non lo sa nessuno — dipende dal contratto — quindi
        // non si conta, si guarda solo se la lista è vuota.
        const ips = prov.isFact(u.publicIps) ? prov.factValue(u.publicIps) : null;
        if (!ips || !ips.length) audit.uplinksWithoutPublicIp.push({ uplinkId: u.id, siteId: u.siteId });
      }

      // ── una linea STATICA senza next-hop: non si rialza dal documento ────
      // ㉑ È la lacuna che i campi nuovi rendono visibile, ed è la ragione per
      // cui esistono. Con un indirizzo e nessun gateway la scheda di ripristino
      // sembra piena e non basta: chi riconfigura il router alle tre di notte
      // arriva in fondo alla pagina e gli manca l'unica riga che gli serve.
      //
      // ⚠️ Si guarda SOLO chi si dichiara `static`. Su DHCP e PPPoE il gateway
      // lo dà la linea: chiederlo lì vorrebbe dire accusare una documentazione
      // giusta.
      // ⚠️ E solo su chi lo DICHIARA: `addressing` vuoto vuol dire «non l'ho
      // ancora scritto», non «statico». Un ripiego che accusa è un ripiego che
      // afferma — e allora ogni linea appena creata comincerebbe in colpa.
      const statiche = uplinks.filter(u => u.addressing === 'static');
      if (!statiche.length) notChecked.push({ check: 'staticUplinksWithoutNextHop', reason: 'no-static-uplink' });
      else {
        for (const u of statiche) {
          if (!u.nextHop) audit.staticUplinksWithoutNextHop.push({ uplinkId: u.id, siteId: u.siteId });
        }
      }
    }

    return audit;
  }

  /**
   * Quante incoerenze e quante lacune, senza doverle contare a mano ogni volta.
   * ⚠️ NON somma `notChecked`: un controllo non eseguito non è un problema
   *    trovato **né** un problema assente, e infilarlo in un totale lo
   *    trasformerebbe in una delle due cose.
   */
  /** @param {InterSiteAudit} audit @returns {{problems:number, gaps:number, notChecked:number}} */
  function interSiteAuditCounts(audit) {
    const PROBLEMS = ['subnetsNowhere', 'subnetsAtTwoSites', 'linksToUnknownSite',
      'uplinksToUnknownSite', 'spokesWithoutHub', 'underlaysNotAtEnds'];
    // ㉑ `staticUplinksWithoutNextHop` è una LACUNA, non un'incoerenza: niente si
    // contraddice: manca una riga. Metterla fra i problemi direbbe che qualcuno
    // ha scritto una cosa falsa, e non è vero.
    const GAPS = ['subnetsNotCarried', 'linksWithoutReach', 'sitesWithoutLink',
      'sitesWithoutUplink', 'uplinksWithoutPublicIp', 'staticUplinksWithoutNextHop'];
    const bag = /** @type {Record<string, unknown[]>} */ (/** @type {unknown} */ (audit));
    const n = (keys) => keys.reduce((acc, k) => acc + ((bag[k] || []).length), 0);
    return {
      problems: n(PROBLEMS),
      gaps: n(GAPS),
      notChecked: (audit && audit.notChecked ? audit.notChecked.length : 0),
    };
  }

  return { buildInterSiteAudit, interSiteAuditCounts };
});
