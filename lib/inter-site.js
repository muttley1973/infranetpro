// ============================================================
// INTER-SEDE — il modello del layer multi-sede: sedi, uplink WAN, collegamenti
// (UMD-lite, Node + browser · lingua-indipendente · puro)
// ============================================================
// Oggi «una sede = un progetto», e i progetti sono ISOLE: InfraNet sa tutto di
// cosa c'è dentro un edificio e niente di come gli edifici si parlano. Questo
// modulo è il livello SOPRA il progetto — l'organizzazione con le sue sedi, gli
// uplink verso l'esterno e i collegamenti che le legano.
//
// FASE 0: solo il MODELLO. Entità, normalizzazione, accessori neutri e l'indice
// subnet→sede. Nessuna diagnostica (è Fase 1), nessuna rete (è Fase 2).
// Piano: `_local/notes/PIANO_multi-sede-wan-vpn.md`.
//
// ── Le scelte, e perché ───────────────────────────────────────────────────
//
//  ① **I progetti-sede NON si fondono.** Una `Site` porta un `projectRef`: un
//     riferimento, non una copia. Il progetto-sede resta la fonte di verità del
//     suo L1/L2; qui si modella solo ciò che sta FRA le sedi.
//
//  ② **`reach` è UN concetto solo, per tutti i `kind`.** La domanda «quali
//     subnet questo collegamento rende raggiungibili da ciascun capo» è la stessa
//     per un IPsec, un MPLS o una fibra punto-punto — cambia solo come la si
//     legge dall'apparato. Su un `ipsec` `reach` È l'encryption domain (il campo
//     perno di tutta la discovery). Modellarla una volta sola, con nomi neutri
//     `a`/`b` legati a `aSiteId`/`bSiteId`, evita sia il gergo di un vendor
//     (paletto ③) sia il «locale/remoto», che dipende da dove stai guardando.
//
//  ③ **`state` non ha il valore `declared`.** Il piano lo prevedeva
//     (`declared|up|down`), ma con l'envelope sarebbe un concetto scritto due
//     volte: «chi lo dice» è l'ORIGINE del fatto, «cos'è» è il valore. Uno stato
//     dichiarato è `factDeclared('up')`; uno letto è `factMeasured('up', at)`.
//     Il vocabolario resta `up|down`, e `null` vuol dire «non pronunciato» —
//     che non è la stessa cosa di «giù».
//
//  ④ **Envelope SOLO sul misurabile.** `provider`, `circuitId`, `cirMbps`, `sla`
//     non sono leggibili da nessun apparato: sono dichiarazioni per costruzione,
//     e vestirle da fatto direbbe una cosa in più che non c'è. Un envelope su un
//     campo che non può che essere dichiarato è rumore, non informazione.
//     ⚠️ `cirMbps` è la banda CONTRATTUALE. Non è `ifSpeed`, che è la velocità
//        del link fisico: confonderle è la trappola nota di questo dominio.
//
//  ⑤ **Un `kind` sconosciuto non si normalizza: si rifiuta.** Meglio un
//     collegamento che non entra e si vede, di uno che entra come qualcos'altro
//     (paletto ②). Stessa scelta del vocabolario chiuso di `lib/source-ref.js`.
//
// ⚠️ `.js` e non `.ts`: il prodotto dichiara `engines: node >=16` e la CI gira su
//    18.x/20.x, dove un `.ts` è un SyntaxError. Vedi `lib/provenance.js`.

// ── I tipi, come `@typedef` JSDoc (`tsc` li controlla via checkJs) ────────

/** Il ruolo di una sede nella topologia dell'organizzazione.
 *  @typedef {'hub'|'spoke'|'standalone'} SiteRole */

/** La natura tecnica di un collegamento fra due sedi. Vocabolario CHIUSO.
 *  @typedef {'ipsec'|'mpls'|'vpls'|'sdwan'|'directLink'} InterSiteKind */

/** La forma d'insieme dei collegamenti.
 *  @typedef {'hub-and-spoke'|'mesh'} InterSiteTopology */

/** Lo stato di un collegamento. Chi lo afferma lo dice l'envelope, non il valore.
 *  @typedef {'up'|'down'} InterSiteState */

/** Le subnet raggiungibili a ciascun capo — su un `ipsec` è l'encryption domain.
 *  `a` = raggiungibili presso `aSiteId`, `b` presso `bSiteId` (CIDR canonici, ordinati).
 *  @typedef {{a:string[], b:string[]}} InterSiteReach */

/** Una sede. Il suo L1/L2 vive nel progetto-sede referenziato, non qui.
 *  `projectRef` è un RIFERIMENTO al progetto esistente: i progetti non si fondono.
 *  `subnets` sono le reti che stanno IN questa sede (CIDR canonici, ordinati).
 *  @typedef {{id:string, name:string, role:SiteRole, projectRef:string|null,
 *             address:string|null, subnets:string[]}} Site */

/** Il collegamento di una sede verso l'esterno. 1..N per sede.
 *  I primi cinque campi sono dichiarati PER COSTRUZIONE (nessun apparato li
 *  conosce) e restano nudi; gli ultimi due sono misurabili e portano l'envelope.
 *  ⚠️ `cirMbps` è la banda CONTRATTUALE — mai `ifSpeed`.
 *  @typedef {{id:string, siteId:string, provider:string|null, serviceType:string|null,
 *             circuitId:string|null, cirMbps:number|null, slaRef:string|null,
 *             publicIp:Fact<string>|null, wanIfRef:Fact<string>|null}} WanUplink */

/** Un capo di un tunnel: quale apparato, e l'IP del peer.
 *  @typedef {{deviceRef:string|null, peerIp:string|null}} InterSiteEndpoint */

/** Ciò che ogni collegamento ha, qualunque sia il `kind`.
 *  @typedef {{id:string, aSiteId:string, bSiteId:string, kind:InterSiteKind,
 *             topology:InterSiteTopology|null, state:Fact<InterSiteState>|null,
 *             reach:Fact<InterSiteReach>|null}} InterSiteLinkCommon */

/** Un collegamento fra due sedi. Unione discriminata su `kind`: ogni variante
 *  porta i suoi campi propri e SOLO quelli.
 *  @typedef {InterSiteLinkCommon & {kind:'ipsec', endpointA:InterSiteEndpoint,
 *             endpointB:InterSiteEndpoint, phase1Name:string|null,
 *             ikeVersion:1|2|null}} IpsecLink */
/** @typedef {InterSiteLinkCommon & {kind:'mpls'|'vpls', vrf:string|null,
 *             service:string|null}} CarrierLink */
/** @typedef {InterSiteLinkCommon & {kind:'sdwan', overlay:string|null,
 *             underlayUplinkIds:string[]}} SdwanLink */
/** @typedef {InterSiteLinkCommon & {kind:'directLink', media:string|null}} DirectLink */
/** @typedef {IpsecLink|CarrierLink|SdwanLink|DirectLink} InterSiteLink */

/** Il contenitore sopra i progetti-sede.
 *  @typedef {{id:string, name:string, sites:Site[], uplinks:WanUplink[],
 *             links:InterSiteLink[]}} Organization */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(
    isNode ? require('./cidr.js') : root,
    isNode ? require('./provenance.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (cidr, prov) {
  'use strict';

  // Vocabolari CHIUSI: un valore fuori lista non viene corretto, viene rifiutato.
  /** @type {SiteRole[]} */
  const SITE_ROLES = ['hub', 'spoke', 'standalone'];
  /** @type {InterSiteKind[]} */
  const INTER_SITE_KINDS = ['ipsec', 'mpls', 'vpls', 'sdwan', 'directLink'];
  /** @type {InterSiteTopology[]} */
  const INTER_SITE_TOPOLOGIES = ['hub-and-spoke', 'mesh'];
  /** @type {InterSiteState[]} */
  const INTER_SITE_STATES = ['up', 'down'];

  const _has = (list, v) => typeof v === 'string' && list.indexOf(v) >= 0;

  /** @param {unknown} v @returns {string|null} */
  function _str(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  }

  /** @param {unknown} v @returns {string} */
  function _id(v) {
    const s = _str(v);
    return s == null ? '' : s;
  }

  /** @param {unknown} v @returns {number|null} */
  function _num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** @param {unknown} v @returns {unknown[]} */
  function _list(v) {
    return Array.isArray(v) ? v : [];
  }

  /**
   * Una lista di subnet → CIDR canonici, ordinati e senza doppioni.
   * La normalizzazione la fa `subnetInputToCidr` (lib/cidr): è LA definizione, e
   * qui non se ne scrive una seconda. Ciò che non è una subnet cade — non viene
   * indovinato. Canonicalizzare qui è ciò che rende confrontabili due capi di un
   * tunnel (base del drift di Fase 3): senza, «10.1.0.0/24» e «10.1.0.5/24»
   * sarebbero due cose diverse pur essendo la stessa rete.
   */
  /** @param {unknown} v @returns {string[]} */
  function normalizeSubnets(v) {
    /** @type {string[]} */
    const out = [];
    for (const raw of _list(v)) {
      const c = cidr.subnetInputToCidr(raw);
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    return out.sort();
  }

  /** Un envelope che porta un valore già normalizzato, o `null` se non è un fatto. */
  /** @template T @param {unknown} f @param {(v:unknown)=>T} normalize @returns {Fact<T>|null} */
  function _factOfNormalized(f, normalize) {
    if (!prov.isFact(f)) return null;
    const value = normalize(prov.factValue(f));
    const origin = prov.factOrigin(f);
    if (origin === 'measured') return prov.factMeasured(value, prov.factAt(f));
    if (origin === 'derived') return prov.factDerived(value, /** @type {{from?:string}} */ (f).from || '');
    return prov.factDeclared(value);
  }

  /** @param {unknown} f @returns {Fact<InterSiteState>|null} */
  function _stateFact(f) {
    if (!prov.isFact(f)) return null;
    const v = prov.factValue(f);
    if (!_has(INTER_SITE_STATES, v)) return null;   // ⑤ niente stato inventato
    return /** @type {Fact<InterSiteState>} */ (f);
  }

  /** @param {unknown} f @returns {Fact<InterSiteReach>|null} */
  function _reachFact(f) {
    return _factOfNormalized(f, (v) => {
      const o = (v && typeof v === 'object') ? /** @type {{a?:unknown, b?:unknown}} */ (v) : {};
      return { a: normalizeSubnets(o.a), b: normalizeSubnets(o.b) };
    });
  }

  /** @param {unknown} v @returns {InterSiteEndpoint} */
  function _endpoint(v) {
    const o = (v && typeof v === 'object') ? /** @type {Record<string,unknown>} */ (v) : {};
    return { deviceRef: _str(o.deviceRef), peerIp: _str(o.peerIp) };
  }

  // --- Normalizzatori -------------------------------------------------------

  /** Una sede, o `null` se le manca l'identità (id) o il nome. */
  /** @param {unknown} raw @returns {Site|null} */
  function normalizeSite(raw) {
    const o = (raw && typeof raw === 'object') ? /** @type {Record<string,unknown>} */ (raw) : null;
    if (!o) return null;
    const id = _id(o.id);
    const name = _str(o.name);
    if (!id || !name) return null;
    return {
      id,
      name,
      role: _has(SITE_ROLES, o.role) ? /** @type {SiteRole} */ (o.role) : 'standalone',
      projectRef: _str(o.projectRef),
      address: _str(o.address),
      subnets: normalizeSubnets(o.subnets),
    };
  }

  /** Un uplink WAN, o `null` se non è agganciato a una sede. */
  /** @param {unknown} raw @returns {WanUplink|null} */
  function normalizeWanUplink(raw) {
    const o = (raw && typeof raw === 'object') ? /** @type {Record<string,unknown>} */ (raw) : null;
    if (!o) return null;
    const id = _id(o.id);
    const siteId = _id(o.siteId);
    if (!id || !siteId) return null;
    return {
      id,
      siteId,
      provider: _str(o.provider),
      serviceType: _str(o.serviceType),
      circuitId: _str(o.circuitId),
      cirMbps: _num(o.cirMbps),
      slaRef: _str(o.slaRef),
      publicIp: _factOfNormalized(o.publicIp, (v) => _id(v)),
      wanIfRef: _factOfNormalized(o.wanIfRef, (v) => _id(v)),
    };
  }

  /**
   * Un collegamento fra due sedi, o `null` se manca l'identità, un capo, o se il
   * `kind` è fuori vocabolario (⑤). Un collegamento di una sede con sé stessa è
   * rifiutato: non è un collegamento inter-sede.
   */
  /** @param {unknown} raw @returns {InterSiteLink|null} */
  function normalizeInterSiteLink(raw) {
    const o = (raw && typeof raw === 'object') ? /** @type {Record<string,unknown>} */ (raw) : null;
    if (!o) return null;
    const id = _id(o.id);
    const aSiteId = _id(o.aSiteId);
    const bSiteId = _id(o.bSiteId);
    if (!id || !aSiteId || !bSiteId || aSiteId === bSiteId) return null;
    if (!_has(INTER_SITE_KINDS, o.kind)) return null;

    const common = {
      id,
      aSiteId,
      bSiteId,
      topology: _has(INTER_SITE_TOPOLOGIES, o.topology) ? /** @type {InterSiteTopology} */ (o.topology) : null,
      state: _stateFact(o.state),
      reach: _reachFact(o.reach),
    };

    switch (/** @type {InterSiteKind} */ (o.kind)) {
      case 'ipsec': {
        const ike = _num(o.ikeVersion);
        return {
          ...common,
          kind: 'ipsec',
          endpointA: _endpoint(o.endpointA),
          endpointB: _endpoint(o.endpointB),
          phase1Name: _str(o.phase1Name),
          ikeVersion: (ike === 1 || ike === 2) ? ike : null,
        };
      }
      case 'mpls':
      case 'vpls':
        return {
          ...common,
          kind: /** @type {'mpls'|'vpls'} */ (o.kind),
          vrf: _str(o.vrf),
          service: _str(o.service),
        };
      case 'sdwan':
        return {
          ...common,
          kind: 'sdwan',
          overlay: _str(o.overlay),
          underlayUplinkIds: _list(o.underlayUplinkIds).map(_id).filter(Boolean),
        };
      case 'directLink':
        return {
          ...common,
          kind: 'directLink',
          media: _str(o.media),
        };
    }
    return null;
  }

  /**
   * L'organizzazione intera. Ciò che non normalizza CADE, e cade in silenzio solo
   * qui: chi vuole sapere cosa è stato scartato confronta le lunghezze (Fase 1
   * lo dirà a schermo come lista di decisioni).
   * ⚠️ Un uplink o un collegamento che punta a una sede inesistente NON viene
   *    tolto: è un dato reale e sbagliato, e nasconderlo sarebbe peggio che
   *    mostrarlo. La diagnostica è Fase 1.
   */
  /** @param {unknown} raw @returns {Organization} */
  function normalizeOrganization(raw) {
    const o = (raw && typeof raw === 'object') ? /** @type {Record<string,unknown>} */ (raw) : {};
    return {
      id: _id(o.id),
      name: _str(o.name) || '',
      sites: /** @type {Site[]} */ (_list(o.sites).map(normalizeSite).filter(Boolean)),
      uplinks: /** @type {WanUplink[]} */ (_list(o.uplinks).map(normalizeWanUplink).filter(Boolean)),
      links: /** @type {InterSiteLink[]} */ (_list(o.links).map(normalizeInterSiteLink).filter(Boolean)),
    };
  }

  // --- Accessori neutri (l'unico posto che conosce la forma dell'unione) -----

  /** I due capi di un collegamento, nell'ordine `a`, `b`. */
  /** @param {InterSiteLink|null} link @returns {string[]} */
  function linkSites(link) {
    return link ? [link.aSiteId, link.bSiteId] : [];
  }

  /** L'altro capo rispetto a `siteId`, o `null` se il collegamento non lo tocca. */
  /** @param {InterSiteLink|null} link @param {string} siteId @returns {string|null} */
  function linkPeerSite(link, siteId) {
    if (!link) return null;
    const id = _id(siteId);
    if (link.aSiteId === id) return link.bSiteId;
    if (link.bSiteId === id) return link.aSiteId;
    return null;
  }

  /**
   * Le subnet che il collegamento rende raggiungibili a ciascun capo — la stessa
   * domanda per ogni `kind` (②). Un `reach` assente NON è una lista vuota di
   * subnet: è «non lo sappiamo». Chi ha bisogno di distinguerlo guarda `link.reach`.
   */
  /** @param {InterSiteLink|null} link @returns {InterSiteReach} */
  function linkReach(link) {
    const f = link && link.reach;
    const v = prov.isFact(f) ? /** @type {InterSiteReach} */ (prov.factValue(f)) : null;
    return { a: (v && v.a) || [], b: (v && v.b) || [] };
  }

  /** Le subnet che il collegamento rende raggiungibili PRESSO `siteId`. */
  /** @param {InterSiteLink|null} link @param {string} siteId @returns {string[]} */
  function linkReachAt(link, siteId) {
    if (!link) return [];
    const r = linkReach(link);
    const id = _id(siteId);
    if (link.aSiteId === id) return r.a;
    if (link.bSiteId === id) return r.b;
    return [];
  }

  /** @param {Organization|null} org @param {string} siteId @returns {WanUplink[]} */
  function uplinksOfSite(org, siteId) {
    const id = _id(siteId);
    return ((org && org.uplinks) || []).filter(u => u.siteId === id);
  }

  /** @param {Organization|null} org @param {string} siteId @returns {InterSiteLink[]} */
  function linksOfSite(org, siteId) {
    const id = _id(siteId);
    return ((org && org.links) || []).filter(l => l.aSiteId === id || l.bSiteId === id);
  }

  /** @param {Organization|null} org @param {string} siteId @returns {Site|null} */
  function siteById(org, siteId) {
    const id = _id(siteId);
    return ((org && org.sites) || []).find(s => s.id === id) || null;
  }

  // --- Subnet → sede --------------------------------------------------------

  /**
   * L'indice `CIDR → [siteId…]`. La chiave è il CIDR canonico di `lib/cidr`, mai
   * una stringa nuda (in questo progetto il confronto per stringa è vietato).
   * Una subnet con PIÙ sedi resta con più sedi: è una sovrapposizione reale, e
   * sceglierne una sarebbe inventare. Fase 1 la segnalerà.
   */
  /** @param {Organization|null} org @returns {Record<string,string[]>} */
  function subnetSiteIndex(org) {
    /** @type {Record<string,string[]>} */
    const idx = Object.create(null);
    for (const s of ((org && org.sites) || [])) {
      for (const net of s.subnets) {
        if (!idx[net]) idx[net] = [];
        if (idx[net].indexOf(s.id) < 0) idx[net].push(s.id);
      }
    }
    return idx;
  }

  /**
   * La sede di una subnet — solo se è UNA sola.
   * Zero sedi → `null` (non sappiamo). Più sedi → `null` (ambiguo): risolvere
   * un'ambiguità scegliendo la prima sarebbe un ripiego, cioè un'affermazione.
   * Chi vuole vedere l'ambiguità usa `subnetSiteIndex`.
   */
  /** @param {Organization|null} org @param {unknown} subnet @returns {string|null} */
  function siteOfSubnet(org, subnet) {
    const key = cidr.subnetInputToCidr(subnet);
    if (!key) return null;
    const hit = subnetSiteIndex(org)[key];
    return (hit && hit.length === 1) ? hit[0] : null;
  }

  return {
    // vocabolari
    SITE_ROLES, INTER_SITE_KINDS, INTER_SITE_TOPOLOGIES, INTER_SITE_STATES,
    // normalizzazione
    normalizeSubnets, normalizeSite, normalizeWanUplink, normalizeInterSiteLink,
    normalizeOrganization,
    // accessori neutri
    linkSites, linkPeerSite, linkReach, linkReachAt,
    uplinksOfSite, linksOfSite, siteById,
    // subnet → sede
    subnetSiteIndex, siteOfSubnet,
  };
});
