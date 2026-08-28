// ============================================================
// INTER-SEDE — il modello del layer multi-sede: sedi, uplink WAN, collegamenti
// (UMD-lite, Node + browser-VIA-BUNDLE · lingua-indipendente · puro)
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
// ⚠️ `.ts`: non caricabile con `<script src>`, arriva al browser SOLO dal bundle
//    `src/`. Vedi l'intestazione di `lib/provenance.ts`.

/** Il ruolo di una sede nella topologia dell'organizzazione. */
type SiteRole = 'hub' | 'spoke' | 'standalone';

/** La natura tecnica di un collegamento fra due sedi. Vocabolario CHIUSO. */
type InterSiteKind = 'ipsec' | 'mpls' | 'vpls' | 'sdwan' | 'directLink';

/** La forma d'insieme dei collegamenti. */
type InterSiteTopology = 'hub-and-spoke' | 'mesh';

/** Lo stato di un collegamento. Chi lo afferma lo dice l'envelope, non il valore. */
type InterSiteState = 'up' | 'down';

/** Le subnet raggiungibili a ciascun capo. Su un `ipsec` è l'encryption domain. */
interface InterSiteReach {
  /** subnet raggiungibili presso `aSiteId` (CIDR normalizzati, ordinati) */
  a: string[];
  /** subnet raggiungibili presso `bSiteId` */
  b: string[];
}

/** Una sede. Il suo L1/L2 vive nel progetto-sede referenziato, non qui. */
interface Site {
  id: string;
  name: string;
  role: SiteRole;
  /** riferimento al progetto-sede esistente (NON si fondono i progetti) */
  projectRef: string | null;
  address: string | null;
  /** le subnet che stanno IN questa sede (CIDR normalizzati, ordinati) */
  subnets: string[];
}

/** Il collegamento di una sede verso l'esterno. 1..N per sede. */
interface WanUplink {
  id: string;
  siteId: string;
  // ── dichiarati per costruzione (nessun apparato li conosce) ──
  provider: string | null;
  serviceType: string | null;
  circuitId: string | null;
  /** banda CONTRATTUALE in Mbps — mai `ifSpeed` */
  cirMbps: number | null;
  slaRef: string | null;
  // ── misurabili → envelope ──
  publicIp: Fact<string> | null;
  /** l'interfaccia del firewall/router che affaccia */
  wanIfRef: Fact<string> | null;
}

interface InterSiteEndpoint {
  deviceRef: string | null;
  peerIp: string | null;
}

interface InterSiteLinkCommon {
  id: string;
  aSiteId: string;
  bSiteId: string;
  kind: InterSiteKind;
  topology: InterSiteTopology | null;
  state: Fact<InterSiteState> | null;
  reach: Fact<InterSiteReach> | null;
}

interface IpsecLink extends InterSiteLinkCommon {
  kind: 'ipsec';
  endpointA: InterSiteEndpoint;
  endpointB: InterSiteEndpoint;
  phase1Name: string | null;
  ikeVersion: 1 | 2 | null;
}

interface CarrierLink extends InterSiteLinkCommon {
  kind: 'mpls' | 'vpls';
  vrf: string | null;
  service: string | null;
}

interface SdwanLink extends InterSiteLinkCommon {
  kind: 'sdwan';
  overlay: string | null;
  /** gli uplink che fanno da underlay (id di `WanUplink`) */
  underlayUplinkIds: string[];
}

interface DirectLink extends InterSiteLinkCommon {
  kind: 'directLink';
  media: string | null;
}

type InterSiteLink = IpsecLink | CarrierLink | SdwanLink | DirectLink;

/** Il contenitore sopra i progetti-sede. */
interface Organization {
  id: string;
  name: string;
  sites: Site[];
  uplinks: WanUplink[];
  links: InterSiteLink[];
}

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(
    isNode ? require('./cidr.js') : root,
    isNode ? require('./provenance.ts') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (cidr: any, prov: any) {
  'use strict';

  // Vocabolari CHIUSI: un valore fuori lista non viene corretto, viene rifiutato.
  const SITE_ROLES: SiteRole[] = ['hub', 'spoke', 'standalone'];
  const INTER_SITE_KINDS: InterSiteKind[] = ['ipsec', 'mpls', 'vpls', 'sdwan', 'directLink'];
  const INTER_SITE_TOPOLOGIES: InterSiteTopology[] = ['hub-and-spoke', 'mesh'];
  const INTER_SITE_STATES: InterSiteState[] = ['up', 'down'];

  const _has = (list: readonly string[], v: unknown): boolean =>
    typeof v === 'string' && list.indexOf(v) >= 0;

  function _str(v: unknown): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  }

  function _id(v: unknown): string {
    const s = _str(v);
    return s == null ? '' : s;
  }

  function _num(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function _list(v: unknown): unknown[] {
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
  function normalizeSubnets(v: unknown): string[] {
    const out: string[] = [];
    for (const raw of _list(v)) {
      const c = cidr.subnetInputToCidr(raw);
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    return out.sort();
  }

  /** Un envelope che porta un valore già normalizzato, o `null` se non è un fatto. */
  function _factOfNormalized<T>(f: unknown, normalize: (v: unknown) => T): Fact<T> | null {
    if (!prov.isFact(f)) return null;
    const value = normalize(prov.factValue(f));
    const origin = prov.factOrigin(f);
    if (origin === 'measured') return prov.factMeasured(value, prov.factAt(f));
    if (origin === 'derived') return prov.factDerived(value, (f as { from?: string }).from || '');
    return prov.factDeclared(value);
  }

  function _stateFact(f: unknown): Fact<InterSiteState> | null {
    if (!prov.isFact(f)) return null;
    const v = prov.factValue(f);
    if (!_has(INTER_SITE_STATES, v)) return null;   // ⑤ niente stato inventato
    return f as Fact<InterSiteState>;
  }

  function _reachFact(f: unknown): Fact<InterSiteReach> | null {
    return _factOfNormalized<InterSiteReach>(f, (v) => {
      const o = (v && typeof v === 'object') ? v as { a?: unknown; b?: unknown } : {};
      return { a: normalizeSubnets(o.a), b: normalizeSubnets(o.b) };
    });
  }

  function _endpoint(v: unknown): InterSiteEndpoint {
    const o = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
    return { deviceRef: _str(o.deviceRef), peerIp: _str(o.peerIp) };
  }

  // --- Normalizzatori -------------------------------------------------------

  /** Una sede, o `null` se le manca l'identità (id) o il nome. */
  function normalizeSite(raw: unknown): Site | null {
    const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : null;
    if (!o) return null;
    const id = _id(o.id);
    const name = _str(o.name);
    if (!id || !name) return null;
    return {
      id,
      name,
      role: _has(SITE_ROLES, o.role) ? o.role as SiteRole : 'standalone',
      projectRef: _str(o.projectRef),
      address: _str(o.address),
      subnets: normalizeSubnets(o.subnets),
    };
  }

  /** Un uplink WAN, o `null` se non è agganciato a una sede. */
  function normalizeWanUplink(raw: unknown): WanUplink | null {
    const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : null;
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
      publicIp: _factOfNormalized<string>(o.publicIp, (v) => _id(v)),
      wanIfRef: _factOfNormalized<string>(o.wanIfRef, (v) => _id(v)),
    };
  }

  /**
   * Un collegamento fra due sedi, o `null` se manca l'identità, un capo, o se il
   * `kind` è fuori vocabolario (⑤). Un collegamento di una sede con sé stessa è
   * rifiutato: non è un collegamento inter-sede.
   */
  function normalizeInterSiteLink(raw: unknown): InterSiteLink | null {
    const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : null;
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
      topology: _has(INTER_SITE_TOPOLOGIES, o.topology) ? o.topology as InterSiteTopology : null,
      state: _stateFact(o.state),
      reach: _reachFact(o.reach),
    };

    switch (o.kind as InterSiteKind) {
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
          kind: o.kind as 'mpls' | 'vpls',
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
  function normalizeOrganization(raw: unknown): Organization {
    const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    return {
      id: _id(o.id),
      name: _str(o.name) || '',
      sites: _list(o.sites).map(normalizeSite).filter(Boolean) as Site[],
      uplinks: _list(o.uplinks).map(normalizeWanUplink).filter(Boolean) as WanUplink[],
      links: _list(o.links).map(normalizeInterSiteLink).filter(Boolean) as InterSiteLink[],
    };
  }

  // --- Accessori neutri (l'unico posto che conosce la forma dell'unione) -----

  /** I due capi di un collegamento, nell'ordine `a`, `b`. */
  function linkSites(link: InterSiteLink | null): string[] {
    return link ? [link.aSiteId, link.bSiteId] : [];
  }

  /** L'altro capo rispetto a `siteId`, o `null` se il collegamento non lo tocca. */
  function linkPeerSite(link: InterSiteLink | null, siteId: string): string | null {
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
  function linkReach(link: InterSiteLink | null): InterSiteReach {
    const f = link && link.reach;
    const v = prov.isFact(f) ? prov.factValue(f) as InterSiteReach : null;
    return { a: (v && v.a) || [], b: (v && v.b) || [] };
  }

  /** Le subnet che il collegamento rende raggiungibili PRESSO `siteId`. */
  function linkReachAt(link: InterSiteLink | null, siteId: string): string[] {
    if (!link) return [];
    const r = linkReach(link);
    const id = _id(siteId);
    if (link.aSiteId === id) return r.a;
    if (link.bSiteId === id) return r.b;
    return [];
  }

  function uplinksOfSite(org: Organization | null, siteId: string): WanUplink[] {
    const id = _id(siteId);
    return ((org && org.uplinks) || []).filter(u => u.siteId === id);
  }

  function linksOfSite(org: Organization | null, siteId: string): InterSiteLink[] {
    const id = _id(siteId);
    return ((org && org.links) || []).filter(l => l.aSiteId === id || l.bSiteId === id);
  }

  function siteById(org: Organization | null, siteId: string): Site | null {
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
  function subnetSiteIndex(org: Organization | null): Record<string, string[]> {
    const idx: Record<string, string[]> = Object.create(null);
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
  function siteOfSubnet(org: Organization | null, subnet: unknown): string | null {
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
