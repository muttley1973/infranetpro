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
//     ⚠️ Ma un vocabolario chiuso che rifiuta casi VERI costringe a mentire —
//     a scegliere «directLink» per un ponte radio d'operatore, o a perdere la
//     riga. Per questo esiste `other`, che è la ⑨ qui sotto: la porta di
//     servizio, non un buco nel vocabolario.
//
//  ⑨ **`other` è ignoranza DICHIARATA, e non è la stessa cosa di una stringa
//     libera.** Un ponte radio fra due capannoni, un servizio d'operatore che
//     non è nessuno dei cinque: succede. Aprire `kind` a qualunque stringa
//     avrebbe rotto in silenzio le traduzioni, le icone e ogni futura logica
//     per-natura — e soprattutto avrebbe reso indistinguibile «è un IPsec» da
//     «non so come chiamarlo». Con `other` il software sa di NON sapere, e
//     `kindLabel` porta le parole di chi l'ha scritto. Nessun ramo di codice
//     ragiona su `other`: è un collegamento come gli altri, con un nome suo.
//
// ⚠️ `.js` e non `.ts`: il prodotto dichiara `engines: node >=16` e la CI gira su
//    18.x/20.x, dove un `.ts` è un SyntaxError. Vedi `lib/provenance.js`.

// ── I tipi, come `@typedef` JSDoc (`tsc` li controlla via checkJs) ────────

/** Il ruolo di una sede nella topologia dell'organizzazione.
 *  @typedef {'hub'|'spoke'|'standalone'} SiteRole */

/** La natura tecnica di un collegamento fra due sedi. Vocabolario CHIUSO —
 *  con `other` come porta di servizio DICHIARATA (⑨), mai come stringa libera.
 *  @typedef {'ipsec'|'gre'|'wireguard'|'openvpn'|'l2tp'
 *           |'mpls'|'vpls'|'vpws'|'vxlan'|'evpn'
 *           |'sdwan'|'directLink'|'other'} InterSiteKind */

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
 *
 *  ⑦ **`publicIps` è una LISTA, e non per completezza: perché uno solo è falso.**
 *  Un indirizzo pubblico per uplink non regge in almeno tre casi ordinari:
 *   · una linea business arriva quasi sempre con un **blocco instradato** (una
 *     /29, una /28): uno degli indirizzi sta sull'interfaccia WAN, gli altri
 *     servono le pubblicazioni in NAT 1:1 — sono tutti quella linea;
 *   · l'**IPv6** è un secondo indirizzo (o un prefisso delegato) sulla STESSA
 *     linea, non un uplink diverso;
 *   · una **coppia in HA** espone gli indirizzi dei due nodi più il VIP condiviso.
 *  Con un campo solo bisognava sceglierne uno e tacere gli altri, cioè
 *  documentare male apposta.
 *
 *  Ogni voce è un **indirizzo** (`203.0.113.10`, `2001:db8::1`) oppure un
 *  **blocco** (`203.0.113.8/29`): due cose diverse, che si scrivono diverse e
 *  restano distinte. ⚠️ Un indirizzo NON passa da `subnetInputToCidr`, che lo
 *  ridurrebbe alla sua rete — `203.0.113.10` diventerebbe `203.0.113.0/24`, che
 *  è un altro fatto, e per giunta più grande.
 *  @typedef {{id:string, siteId:string, provider:string|null, serviceType:string|null,
 *             circuitId:string|null, cirMbps:number|null, slaRef:string|null,
 *             publicIps:Fact<string[]>|null, wanIfRef:Fact<string>|null}} WanUplink */

/** Un capo del collegamento: su QUALE APPARATO sta, e l'indirizzo dell'altro capo.
 *
 *  ⑧ **Due campi, perché sono due cose diverse.** `deviceRef` è l'id di un nodo
 *  dentro il progetto della sede — un riferimento vero, come `projectRef`.
 *  `deviceName` è un nome scritto a mano, per l'apparato che nel progetto NON
 *  c'è: il CE di un MPLS è spesso la scatola dell'operatore, che nessuno ha
 *  documentato come nodo, e una sede può non avere ancora un progetto. Costringere
 *  a scegliere da un elenco avrebbe reso la mano un cittadino di seconda classe,
 *  che è esattamente il paletto ① al contrario.
 *
 *  ⚠️ **Si escludono a vicenda**, e la normalizzazione lo impone: se c'è il
 *  riferimento, il nome lo dà il progetto. Tenerli tutti e due vorrebbe dire due
 *  definizioni dello stesso nome, che divergono al primo rinomino — il bug che
 *  in questo progetto è già tornato dodici volte.
 *  @typedef {{deviceRef:string|null, deviceName:string|null,
 *             peerIp:string|null}} InterSiteEndpoint */

/** Ciò che ogni collegamento ha, qualunque sia il `kind`.
 *  ⑥ **I due capi sono COMUNI, non roba da IPsec.** Stavano solo su `ipsec`, e
 *  la domanda che ci sta dietro — «su quale scatola vado a mettere le mani?» —
 *  non è una domanda sulla crittografia: su un MPLS o un VPLS il capo è il CE,
 *  che è un apparato tuo, in rack, con delle porte, e che va documentato esatta-
 *  mente come gli altri. Lo stesso ragionamento di `reach` (②): una domanda che
 *  è la stessa per tutti i `kind` si modella una volta sola.
 *
 *  ⑩ **Anche CHI lo vende e con quale CODICE sono comuni.** Stessa lezione della
 *  ⑥, trovata dallo stesso metodo — un NetBox vero. Un MPLS, un VPLS, una fibra
 *  spenta e perfino l'underlay di un SD-WAN si comprano da un operatore e hanno
 *  un codice sul contratto: è **il** numero che si detta al telefono quando la
 *  linea è giù, ed è la stessa domanda per ogni `kind`. Senza, un circuito
 *  inter-sede letto dal DCIM entrava perdendo per strada le due cose che lo
 *  identificano. Su un IPsec sopra due linee internet restano `null`, e va bene:
 *  «non c'è un operatore» è una risposta.
 *  ⚠️ Sono DICHIARAZIONI per costruzione, come `provider`/`circuitId` di
 *  `WanUplink` (④): niente envelope: nessun apparato le può leggere.
 *
 *  ⑪ **E COME SI CHIAMA.** Terza volta che la stessa lezione si presenta, e la
 *  terza fonte è di nuovo un archivio vero: in NetBox un servizio L2VPN e un
 *  tunnel hanno un `name` — «VPLS-MI-RM», «IPSEC-HQ-DR» — ed è il nome con cui
 *  quel collegamento viene chiamato in riunione e cercato sull'apparato. Prima
 *  non aveva dove andare: `phase1Name` è il nome della phase 1 (una cosa da
 *  IPsec), `service` è il servizio dell'operatore, `kindLabel` dice la NATURA
 *  («GRE»), non il nome. Un GRE importato arrivava quindi anonimo, e due tunnel
 *  fra le stesse due sedi diventavano indistinguibili — anche per chi deve
 *  decidere se sono la stessa riga.
 *  ⚠️ Il nome NON sostituisce `kindLabel`: «GRE-LAB» è come si chiama, «GRE» è
 *  che cos'è, e la mappa disegna la seconda.
 *  @typedef {{id:string, aSiteId:string, bSiteId:string, kind:InterSiteKind,
 *             name:string|null, topology:InterSiteTopology|null, state:Fact<InterSiteState>|null,
 *             reach:Fact<InterSiteReach>|null, provider:string|null, circuitId:string|null,
 *             endpointA:InterSiteEndpoint, endpointB:InterSiteEndpoint}} InterSiteLinkCommon */

/** Un collegamento fra due sedi. Unione discriminata su `kind`: ogni variante
 *  porta i suoi campi propri e SOLO quelli. `phase1Name` e `ikeVersion` restano
 *  di IPsec perché sono davvero suoi — a differenza dei due capi.
 *  @typedef {InterSiteLinkCommon & {kind:'ipsec', phase1Name:string|null,
 *             ikeVersion:1|2|null}} IpsecLink */
/** ⑲ I tunnel diversi da IPsec portano SOLO ciò che è comune — e i due capi,
 *  dove stanno gli indirizzi dei peer, comuni lo sono. Non è una mancanza: la
 *  fase 1 e la versione IKE sono di IPsec, e chiederle su un GRE sarebbe
 *  chiedere un dato che non esiste.
 *  @typedef {InterSiteLinkCommon & {kind:'gre'|'wireguard'|'openvpn'|'l2tp'}} TunnelLink */
/** ⑲ I servizi: `vrf` e `service` valgono per tutti e cinque. L'identificativo
 *  numerico (VNI, VC-ID) NON c'è, e si dice invece di infilarlo in `service`.
 *  @typedef {InterSiteLinkCommon & {kind:'mpls'|'vpls'|'vpws'|'vxlan'|'evpn',
 *             vrf:string|null, service:string|null}} CarrierLink */
/** @typedef {InterSiteLinkCommon & {kind:'sdwan', overlay:string|null,
 *             underlayUplinkIds:string[]}} SdwanLink */
/** @typedef {InterSiteLinkCommon & {kind:'directLink', media:string|null}} DirectLink */
/** ⑨ La porta di servizio: il software sa di NON sapere, e le parole le mette
 *  chi documenta in `kindLabel`. Nessun ramo di codice ragiona su questo `kind`.
 *  @typedef {InterSiteLinkCommon & {kind:'other', kindLabel:string|null}} OtherLink */
/** @typedef {IpsecLink|TunnelLink|CarrierLink|SdwanLink|DirectLink|OtherLink} InterSiteLink */

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
  // ⚠️  sta in FONDO apposta: la UI elenca in quest'ordine, e la porta di
  // servizio non deve stare fra le scelte precise.
  /**
   * ⑲ **Le nature di un collegamento fra sedi.** Erano cinque, ed erano poche:
   * quasi tutto ciò che un archivio DCIM contiene finiva in `other` con
   * un'etichetta — cioè in «il software sa di non sapere» anche dove sapeva.
   *
   * Ogni voce esiste perché corrisponde a un valore dei due vocabolari CHIUSI
   * di NetBox — `tunnel.encapsulation` (8 valori) e `l2vpn.type` (14) — e non
   * perché suoni bene: sono i termini con cui la cosa si chiama sulla console
   * di chi la configura.
   *   · tunnel        ipsec · gre · wireguard · openvpn · l2tp
   *   · servizi       mpls · vpls · vpws · vxlan · evpn
   *   · architettura  sdwan
   *   · fisico        directLink (fibra spenta, ponte radio)
   *
   * ⚠️ Restano FUORI, e restano `other` con la loro etichetta: `ip-ip` e `pptp`
   * (il primo raro, il secondo morto), e i servizi Ethernet d'operatore
   * (`epl`, `evpl`, `ep-lan`, `ep-tree`…) con `spb`, che sono una famiglia a sé
   * — schiacciarli su `vpws` sarebbe dire una cosa per un'altra.
   *
   * ⚠️ L'ordine è quello della tendina: prima i tunnel, poi i servizi, poi ciò
   * che non è né l'uno né l'altro. `other` in fondo, dov'è giusto che stia.
   */
  const INTER_SITE_KINDS = [
    'ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp',
    'mpls', 'vpls', 'vpws', 'vxlan', 'evpn',
    'sdwan', 'directLink', 'other',
  ];
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

  /** Un numero che MISURA qualcosa: finito e maggiore di zero.
   *
   *  ⑩ **Zero e i negativi non sono valori bassi: non sono banda.** Una linea da
   *  0 Mbps non esiste, e una da -100 nemmeno. Finché entravano nel modello
   *  arrivavano fino alla scheda di ripristino travestiti da dato — cioè nel
   *  posto dove qualcuno legge alle tre di notte e crede a quello che c'è
   *  scritto. `lib/dcim-wan.js` questa guardia ce l'ha da sempre (`_cirMbps`:
   *  `n <= 0 → null`): qui non si inventa una regola nuova, si fa dire al
   *  percorso A MANO la stessa cosa che l'import dice già.
   *  ⚠️ Nessun tetto massimo, di proposito: 400G esiste e 800G arriva, e un
   *  limite scelto oggi rifiuterebbe domani una linea vera (paletto ③). Una
   *  banda enorme è implausibile, non impossibile — è materia dell'audit, che
   *  segnala senza distruggere, non della normalizzazione, che scarta.
   *  @param {unknown} v @returns {number|null} */
  function _posNum(v) {
    const n = _num(v);
    return n !== null && n > 0 ? n : null;
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

  /**
   * Gli indirizzi pubblici di un uplink (⑦). Ogni voce è un INDIRIZZO o un
   * BLOCCO, e le due strade sono diverse apposta: un blocco si canonicalizza
   * come rete, un indirizzo come indirizzo. Mandare un indirizzo dentro
   * `subnetInputToCidr` lo trasformerebbe nella sua /24 — un altro fatto, e più
   * grande di quello scritto.
   *
   * ⚠️ **L'ordine dichiarato si CONSERVA**, a differenza di `normalizeSubnets`
   * che ordina. Qui l'ordine porta significato: il primo indirizzo è, per
   * convenzione di chi lo scrive, quello dell'interfaccia WAN. Riordinarli per
   * fare pulizia cancellerebbe quella convenzione senza dirlo. Si toglie solo
   * ciò che non è un indirizzo né un blocco, e i doppioni.
   */
  /** @param {unknown} v @returns {string[]} */
  function normalizePublicAddrs(v) {
    /** @type {string[]} */
    const out = [];
    for (const raw of _list(v)) {
      const s = _str(raw);
      if (!s) continue;
      const k = s.indexOf('/') >= 0
        ? cidr.subnetInputToCidr(s)
        : (cidr.addrFamily(s) ? cidr.addrKey(s) : null);
      if (k && out.indexOf(k) < 0) out.push(k);
    }
    return out;
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

  /** Un fatto che porta UN valore → lo stesso fatto che ne porta una lista di
   *  uno. Serve solo alla retro-compatibilità di `publicIp` → `publicIps`:
   *  l'origine e la data non cambiano, cambia la forma del valore. */
  /** @param {unknown} f @returns {unknown} */
  function _asList(f) {
    const o = /** @type {Record<string,unknown>} */ (f);
    return Object.assign({}, o, { value: [prov.factValue(f)] });
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

  /** ⑧ Il riferimento vince sul nome scritto a mano: se il nodo c'è, il suo nome
   *  lo dice il progetto, e una copia qui sarebbe una seconda definizione. */
  /** @param {unknown} v @returns {InterSiteEndpoint} */
  function _endpoint(v) {
    const o = (v && typeof v === 'object') ? /** @type {Record<string,unknown>} */ (v) : {};
    const ref = _str(o.deviceRef);
    return { deviceRef: ref, deviceName: ref ? null : _str(o.deviceName), peerIp: _str(o.peerIp) };
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
      cirMbps: _posNum(o.cirMbps),
      slaRef: _str(o.slaRef),
      // Retro-compatibilità con il campo SINGOLARE `publicIp` (⑦): un dato già
      // scritto non si perde perché il modello si è allargato — diventa il primo
      // elemento della lista. A senso unico e idempotente, come `migrateIpam`.
      publicIps: _factOfNormalized(
        prov.isFact(o.publicIps) ? o.publicIps : (prov.isFact(o.publicIp) ? _asList(o.publicIp) : o.publicIps),
        normalizePublicAddrs),
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
      // ⑩ Operatore e codice del circuito: comuni come i capi, e per lo stesso
      // motivo — la domanda non cambia con la natura del collegamento.
      provider: _str(o.provider),
      circuitId: _str(o.circuitId),
      // ⑪ E come si chiama: «GRE-LAB» è il nome, «GRE» è la natura.
      name: _str(o.name),
      // ⑥ I due capi valgono per ogni `kind`: anche un MPLS o una fibra arrivano
      // su un apparato preciso, ed è la cosa che si va a cercare per prima.
      endpointA: _endpoint(o.endpointA),
      endpointB: _endpoint(o.endpointB),
    };

    switch (/** @type {InterSiteKind} */ (o.kind)) {
      case 'ipsec': {
        const ike = _num(o.ikeVersion);
        return {
          ...common,
          kind: 'ipsec',
          phase1Name: _str(o.phase1Name),
          ikeVersion: (ike === 1 || ike === 2) ? ike : null,
        };
      }
      case 'mpls':
      case 'vpls':
      case 'vpws':
      case 'vxlan':
      case 'evpn':
        return {
          ...common,
          kind: /** @type {'mpls'|'vpls'|'vpws'|'vxlan'|'evpn'} */ (o.kind),
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
      case 'other':
        // ⑨ `kindLabel` può essere vuoto: «non so come chiamarlo» è già
        // un'informazione, e obbligare a scrivere qualcosa produrrebbe
        // etichette-riempitivo invece di un onesto silenzio.
        return {
          ...common,
          kind: 'other',
          kindLabel: _str(o.kindLabel),
        };
    }
    // ⚠️ ⑲ Qui NON si torna `null`. Il `kind` fuori vocabolario è già stato
    // respinto in cima (`_has`), quindi arrivare in fondo allo switch vuol dire
    // una cosa sola: una natura VERA che non porta campi propri — i tunnel
    // diversi da IPsec, che hanno solo i due capi, comuni a tutti.
    // Prima qui c'era `return null`, e con le nature nuove il collegamento
    // spariva: la natura era nel vocabolario, il normalizzatore non lo sapeva, e
    // il documento perdeva una riga senza dire niente. Due elenchi della stessa
    // cosa in due posti — la famiglia di difetti che qui è già tornata dodici
    // volte. Ora chi aggiunge una natura senza campi non deve toccare niente.
    return { ...common, kind: /** @type {'gre'|'wireguard'|'openvpn'|'l2tp'} */ (o.kind) };
  }

  /** Una lista dove ogni `id` compare UNA volta sola; vince il primo.
   *
   *  ⑪ **Un id ripetuto non è un doppione: è un'identità che non identifica.**
   *  Tutto ciò che sta a valle indicizza per id — la mappa tiene una casella per
   *  sede, il capitolo del dossier cerca l'apparato nel progetto della sede,
   *  `siteById` risponde con la prima che trova. Due sedi con lo stesso id
   *  entravano tutt'e due nel modello e poi la mappa ne disegnava UNA: la
   *  seconda spariva dallo schermo restando nei conti, e nessuno lo diceva. È la
   *  stessa forma del `case` mancante nello `switch` delle nature — un dato che
   *  esiste e non si vede.
   *  Togliere la seconda QUI la fa contare da `writeOrganization` (④ dello
   *  store, `dropped`): sparisce lo stesso, ma detto. Vince la prima perché è
   *  quella che si legge in cima al file, e perché è l'unica scelta che non
   *  dipende dall'ordine in cui il chiamante ha messo le righe.
   *  @template {{id:string}} T @param {T[]} lista @returns {T[]} */
  function _uniqueById(lista) {
    const visti = new Set();
    return lista.filter((x) => {
      if (visti.has(x.id)) return false;
      visti.add(x.id);
      return true;
    });
  }

  /**
   * L'organizzazione intera. Ciò che non normalizza CADE, e cade in silenzio solo
   * qui: chi vuole sapere cosa è stato scartato confronta le lunghezze (lo store
   * lo fa, e la UI lo dice come lista di decisioni).
   * ⚠️ Un uplink o un collegamento che punta a una sede inesistente NON viene
   *    tolto: è un dato reale e sbagliato, e nasconderlo sarebbe peggio che
   *    mostrarlo. Quello lo racconta l'audit.
   */
  /** @param {unknown} raw @returns {Organization} */
  function normalizeOrganization(raw) {
    const o = (raw && typeof raw === 'object') ? /** @type {Record<string,unknown>} */ (raw) : {};
    return {
      id: _id(o.id),
      name: _str(o.name) || '',
      sites: /** @type {Site[]} */ (_uniqueById(_list(o.sites).map(normalizeSite).filter(Boolean))),
      uplinks: /** @type {WanUplink[]} */ (_uniqueById(_list(o.uplinks).map(normalizeWanUplink).filter(Boolean))),
      links: /** @type {InterSiteLink[]} */ (_uniqueById(_list(o.links).map(normalizeInterSiteLink).filter(Boolean))),
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
    normalizeSubnets, normalizePublicAddrs, normalizeSite, normalizeWanUplink, normalizeInterSiteLink,
    normalizeOrganization,
    // accessori neutri
    linkSites, linkPeerSite, linkReach, linkReachAt,
    uplinksOfSite, linksOfSite, siteById,
    // subnet → sede
    subnetSiteIndex, siteOfSubnet,
  };
});
