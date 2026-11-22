// ============================================================
// LA VISTA MULTISITO — cosa dice il tile, e come si segna un collegamento
// (UMD-lite, Node + browser · lingua-indipendente · puro · deterministico)
// ============================================================
// Quando il Multisito si accende, la mappa geografica prende il posto della
// planimetria e il tile che prima filtrava le VLAN filtra i TIPI DI CONNESSIONE.
// Il disegno (Leaflet, HTML) sta in `src/app-inter-site.js`; QUI sta ciò che si
// può provare senza un browser: a quale tipo appartiene un collegamento, che
// tratto gli spetta, e che numeri scrive il tile.
//
//  ① **Un collegamento ha UN tipo agli occhi del filtro, e vince il tunnel.**
//     Il modello ha due assi (trasporto e tunnel): «IPsec su MPLS» è l'IPsec che
//     si va a rimettere su, quindi si filtra come IPsec — la stessa scelta che
//     `_natureIcon` fa da sempre. Senza tunnel parla il trasporto; senza nessuno
//     dei due il tipo è «non dichiarato», e RESTA un tipo: un filtro che
//     nasconde in silenzio i collegamenti di cui nessuno ha scritto la natura è
//     un filtro che mente per omissione.
//  ② **Il tile elenca i tipi CHE CI SONO.** Non un menu fisso di cinque voci: una
//     pastiglia per ogni tipo presente nell'organizzazione, col suo conteggio. Un
//     tipo senza collegamenti non è un filtro, è rumore.
//  ③ **Il colore dice lo stato, il tratto dice il tipo.** Sono due domande, e due
//     canali: così il verde resta «su» per tutti, e il tipo non ruba un colore
//     che vuol già dire un'altra cosa (le VLAN restano sulla planimetria).
//  ④ **Gli accessi sono il testo che qualcuno ha scritto.** `serviceType` è testo
//     libero (lo riempie anche l'import, con le parole del NetBox di qualcun
//     altro): si raggruppa per testo normalizzato — minuscolo, spazi ridotti — e
//     NON per un vocabolario chiuso, che rifiuterebbe o correggerebbe parole
//     vere. Le linee senza tipo si contano a parte.
//
// ⚠️ `.js` e non `.ts`: `engines >=16` e la CI su 18/20, dove un `.ts` è SyntaxError.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /** I tunnel che il modello conosce. Duplicato volutamente corto di
   *  `INTER_SITE_TUNNELS` (che sta in `lib/inter-site.js`): qui servono solo i
   *  NOMI per decidere a quale asse appartiene una chiave, e li guarda un test. */
  const TUNNEL_KEYS = ['ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp', 'sdwan'];

  /** L'ordine delle pastiglie: i servizi d'operatore, poi il filo, poi i tunnel,
   *  poi ciò che non si sa. È l'ordine in cui un tecnico li nomina. */
  const KIND_ORDER = [
    'mpls', 'vpls', 'vpws', 'vxlan', 'evpn',
    'directLink',
    'ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp', 'sdwan', 'tunnelOther',
    'internet', 'transportOther',
    'undeclared',
  ];

  /** La chiave «linea senza tipo» fra gli accessi. */
  const ACCESS_NONE = '~none';

  /**
   * @param {any} link
   * @returns {string} una chiave di `KIND_ORDER`
   */
  function connectionKind(link) {
    const l = (link && typeof link === 'object') ? link : {};
    const tu = typeof l.tunnel === 'string' ? l.tunnel : '';
    if (tu && tu !== 'none') return tu === 'other' ? 'tunnelOther' : (TUNNEL_KEYS.indexOf(tu) >= 0 ? tu : 'tunnelOther');
    const tr = typeof l.transport === 'string' ? l.transport : '';
    if (tr) return tr === 'other' ? 'transportOther' : (KIND_ORDER.indexOf(tr) >= 0 ? tr : 'transportOther');
    return 'undeclared';
  }

  /** A quale asse del modello appartiene una chiave: serve a scegliere la parola. */
  function kindAxis(key) {
    if (key === 'undeclared') return 'none';
    if (key === 'tunnelOther' || TUNNEL_KEYS.indexOf(key) >= 0) return 'tunnel';
    return 'transport';
  }

  // I tratti. Il servizio d'operatore è pieno e spesso; il filo è un tratteggio
  // lungo; i tunnel sono tratteggi corti diversi fra loro; il WireGuard è un
  // punteggiato; ciò che non si sa è un punteggiato sottile. `dash` è null per il pieno.
  /** @type {Record<string, {dash:string|null, width:number, cap:'butt'|'round'}>} */
  const STYLE = {
    mpls: { dash: null, width: 3.6, cap: 'butt' },
    vpls: { dash: null, width: 3.6, cap: 'butt' },
    vpws: { dash: null, width: 3.6, cap: 'butt' },
    vxlan: { dash: null, width: 3.6, cap: 'butt' },
    evpn: { dash: null, width: 3.6, cap: 'butt' },
    directLink: { dash: '12 5', width: 3.2, cap: 'butt' },
    ipsec: { dash: '6 5', width: 2.4, cap: 'butt' },
    gre: { dash: '9 4', width: 2.4, cap: 'butt' },
    wireguard: { dash: '0.1 6', width: 3, cap: 'round' },
    openvpn: { dash: '3 3', width: 2.4, cap: 'butt' },
    l2tp: { dash: '9 3 2 3', width: 2.4, cap: 'butt' },
    sdwan: { dash: '15 4 3 4', width: 2.6, cap: 'butt' },
    tunnelOther: { dash: '2 5', width: 2.4, cap: 'round' },
    internet: { dash: null, width: 2, cap: 'butt' },
    transportOther: { dash: '2 5', width: 2.4, cap: 'round' },
    undeclared: { dash: '2 5', width: 2.4, cap: 'round' },
  };

  /** @param {string} key */
  function kindStyle(key) {
    return STYLE[key] || STYLE.undeclared;
  }

  /** Il testo di un accesso come CHIAVE: stesso testo scritto in due modi = stessa pastiglia. */
  function accessKey(serviceType) {
    return String(serviceType == null ? '' : serviceType).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  const _arr = (v) => (Array.isArray(v) ? v : []);

  /**
   * I numeri del tile.
   *
   * @param {any} org
   * @param {{hidden?:Record<string,boolean>, access?:string}} [opts]
   *   `hidden` = i tipi di collegamento spenti; `access` = l'accesso scelto ('' = nessuno)
   * @returns {{
   *   kinds: {key:string, n:number, hidden:boolean}[],
   *   accesses: {key:string, label:string, n:number}[],
   *   noAccess: number,
   *   hiddenLinks: number,
   *   visibleLinkIds: string[],
   *   accessSiteIds: string[]|null
   * }}
   */
  function buildTile(org, opts) {
    const o = (org && typeof org === 'object') ? org : {};
    const hidden = (opts && opts.hidden) || {};
    const access = (opts && typeof opts.access === 'string') ? opts.access : '';

    /** @type {Record<string, number>} */
    const perKind = Object.create(null);
    const visibleLinkIds = [];
    let hiddenLinks = 0;
    for (const l of _arr(o.links)) {
      if (!l || typeof l !== 'object') continue;
      const k = connectionKind(l);
      perKind[k] = (perKind[k] || 0) + 1;
      if (hidden[k]) hiddenLinks++; else visibleLinkIds.push(String(l.id));
    }
    const kinds = KIND_ORDER.filter(k => perKind[k]).map(k => ({ key: k, n: perKind[k], hidden: !!hidden[k] }));

    // Gli accessi si contano per SEDE (quante sedi ce l'hanno), non per linea: la
    // domanda che il tile aiuta è «quali sedi sono ancora su questo accesso?».
    const siteIds = new Set(_arr(o.sites).map(s => s && String(s.id)).filter(Boolean));
    /** @type {Record<string, {label:string, spell:Record<string,number>, sites:Set<string>}>} */
    const perAccess = Object.create(null);
    const noAccessSites = new Set();
    for (const u of _arr(o.uplinks)) {
      if (!u || typeof u !== 'object' || !siteIds.has(String(u.siteId))) continue;
      const k = accessKey(u.serviceType);
      if (!k) { noAccessSites.add(String(u.siteId)); continue; }
      const spelled = String(u.serviceType).trim().replace(/\s+/g, ' ');
      const e = perAccess[k] || (perAccess[k] = { label: spelled, spell: Object.create(null), sites: new Set() });
      e.spell[spelled] = (e.spell[spelled] || 0) + 1;
      e.sites.add(String(u.siteId));
    }
    const accesses = Object.keys(perAccess).map(k => {
      const e = perAccess[k];
      // Il nome mostrato è la grafia più usata; a parità, la prima in ordine.
      const label = Object.keys(e.spell).sort((a, b) => (e.spell[b] - e.spell[a]) || (a < b ? -1 : a > b ? 1 : 0))[0];
      return { key: k, label, n: e.sites.size };
    }).sort((a, b) => (b.n - a.n) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

    let accessSiteIds = null;
    if (access) {
      accessSiteIds = access === ACCESS_NONE
        ? Array.from(noAccessSites)
        : (perAccess[access] ? Array.from(perAccess[access].sites) : []);
    }
    return { kinds, accesses, noAccess: noAccessSites.size, hiddenLinks, visibleLinkIds, accessSiteIds };
  }

  return { connectionKind, kindAxis, kindStyle, accessKey, buildTile, ACCESS_NONE, KIND_ORDER };
});
