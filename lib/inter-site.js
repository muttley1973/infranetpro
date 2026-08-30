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

/** ㉔ **SU COSA viaggia.** Il mezzo che porta il collegamento fra le due sedi:
 *  la rete di un operatore, un servizio Ethernet, una fibra spenta, Internet.
 *  Vocabolario CHIUSO, con `other` come porta di servizio DICHIARATA (⑨).
 *  ⚠️ `internet` è un valore vero e non un ripiego: «questo tunnel esce da due
 *  linee internet» è una frase, e `null` — «non l'ho scritto» — è un'altra.
 *  @typedef {'internet'|'mpls'|'vpls'|'vpws'|'vxlan'|'evpn'
 *           |'directLink'|'other'} InterSiteTransport */

/** ㉔ **COSA ci corre sopra.** Il tunnel — che di solito, ma non sempre, porta
 *  anche la cifratura. Vocabolario CHIUSO.
 *  ⚠️ `none` vuol dire «guardato: non c'è nessun tunnel». Un MPLS in chiaro è
 *  una scelta e va potuta scrivere; `null` vuol dire «non l'ho scritto», che non
 *  è la stessa cosa — è la stessa distinzione di `state` (③).
 *  ⚠️ `gre` e `l2tp` stanno qui pur non cifrando niente: l'asse è «cosa corre
 *  sopra il trasporto», e un GRE ci corre esattamente come un IPsec. Chiamare
 *  l'asse «cifratura» avrebbe costretto a mentire su due voci su sei.
 *  ⚠️ E `sdwan` è un tunnel, non un trasporto: una SD-WAN È un overlay, cioè
 *  precisamente ciò che corre sopra a uno o più trasporti — ed è la ragione per
 *  cui `underlayUplinkIds` esiste.
 *  @typedef {'none'|'ipsec'|'gre'|'wireguard'|'openvpn'|'l2tp'
 *           |'sdwan'|'other'} InterSiteTunnel */

/** ㉒ **La forma d'insieme NON è un campo di un collegamento.** Hub-and-spoke o
 *  magliata è una proprietà dell'INSIEME dei collegamenti che compongono UN
 *  servizio: un singolo collegamento fra due sedi è punto-punto e basta, e
 *  chiamarlo «hub-and-spoke» è una frase sul disegno, non su di lui.
 *  Sull'archivio vero stava su 2 collegamenti su 8, e tutt'e due li aveva
 *  scritti l'import: NetBox dichiara un ruolo per ogni CAPO del tunnel
 *  (hub/spoke/peer) e l'import li schiacciava in una parola sul collegamento —
 *  che è già un'interpretazione, non una lettura. Il suo unico controllo d'audit
 *  confrontava poi quella parola con i ruoli delle SEDI: teneva d'occhio due
 *  frasi sulla stessa cosa scritte in due posti. Tolto il campo, sparisce la
 *  classe di difetto e sparisce il controllo che la rincorreva.
 *  ⚠️ Finché la forma la dice il RUOLO della sede (`hub`/`spoke`), che è già
 *  una definizione sola. Quando il modello avrà i SERVIZI multipunto — oggi si
 *  rifiutano — la topologia andrà lì, che è il suo posto.
 */

/** Lo stato di un collegamento. Chi lo afferma lo dice l'envelope, non il valore.
 *  @typedef {'up'|'down'} InterSiteState */

/** Come l'interfaccia WAN prende il suo indirizzo. Vocabolario CHIUSO (⑤): un
 *  modo fuori lista non si corregge, si rifiuta. `null` = non dichiarato, che
 *  non è la stessa cosa di «statico».
 *  @typedef {'static'|'dhcp'|'pppoe'} WanAddressing */

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
 *  ㉑ **La scheda di una linea è una CHECKLIST DI RIPRISTINO, non un'anagrafica.**
 *  Questo capitolo esiste per una notte sola — quella in cui la linea è giù — e
 *  ogni campo deve rispondere a una domanda che si fa QUELLA notte. I primi
 *  quattro rispondono a «chi me l'ha venduta e cosa ho comprato». Mancava tutto
 *  ciò che serve a RIMETTERLA SU, che è il resto della notte:
 *   · `addressing` — statico, DHCP o PPPoE. È la prima domanda davanti a un
 *     router da riconfigurare, e decide quali altri campi vogliono dire qualcosa.
 *   · `nextHop` — il gateway. Senza, una linea statica NON si rialza dal
 *     documento: hai l'indirizzo e non sai a chi parlare. È il buco più grosso
 *     che questa scheda aveva.
 *   · `deliveryVlan` — il tag con cui l'operatore consegna. È il guasto classico
 *     «la porta è su, il cavo è giusto, e non passa niente».
 *   · `mtu` — 1492 su PPPoE, più basso sotto un tunnel. È il guasto «funziona
 *     tutto tranne i pacchetti grandi», che senza questo numero si cerca per ore.
 *   · `supportRef` — chi si chiama. 🔒 Ci passa `validateBackupRef`: un portale
 *     con `utente:password@` dentro è un segreto, e i segreti qui non entrano —
 *     stessa regola, e stesso codice, di `node.backup.ref`.
 *
 *  ⚠️ **La MASCHERA non è fra questi, ed è una scelta.** Il blocco instradato sta
 *  già in `publicIps` (⑦), che è una lista apposta per portare l'indirizzo
 *  dell'interfaccia E la rete che ti hanno dato. Un campo `netmask` sarebbe una
 *  seconda definizione dello stesso fatto: la famiglia di difetti che in questo
 *  codice è già tornata dodici volte.
 *  ⚠️ E nemmeno il clamp dell'MSS, che pure si scrive accanto all'MTU: quello
 *  non è una proprietà della LINEA, è una regola di chi la termina — la stessa
 *  linea consegnata a un altro firewall avrebbe un altro clamp. Sta sulla
 *  scatola, non sul contratto, e metterlo qui direbbe che appartiene a chi la
 *  vende.
 *  ⚠️ E non c'è il tag esterno del QinQ. Non lo porta nessuno degli archivi che
 *  abbiamo guardato, e un campo quasi sempre vuoto insegna a leggere la scheda
 *  come rumore. Quando un archivio vero lo mostrerà avrà il suo campo — è il
 *  metodo che qui ha già funzionato quattro volte.
 *  ⚠️ **Non li riempie nessun import** (paletto ②): un next-hop e un tag di
 *  consegna NetBox non li ha, e dedurli dall'interfaccia WAN sarebbe una
 *  corrispondenza, non un'identità. Si dichiarano a mano, come `reach`.
 *  ⛔ `slaRef` non c'è più: testo libero, **zero su sette** sull'archivio vero.
 *  Un «riferimento» che nessuno scrive non è un dato, è una casella. Al suo
 *  posto un numero su cui si può decidere e un contatto che si può comporre.
 *  @typedef {{id:string, siteId:string, provider:string|null, serviceType:string|null,
 *             circuitId:string|null, cirMbps:number|null,
 *             addressing:WanAddressing|null, nextHop:string|null,
 *             deliveryVlan:number|null, mtu:number|null,
 *             supportRef:string|null,
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
 *
 *  ⑳ **E SU QUALE LINEA CORRE.** Quarta volta che la stessa lezione si presenta,
 *  e stavolta il campo c'era già: `underlayUplinkIds` viveva nel solo `sdwan`,
 *  dove la parola «underlay» lo aveva fatto sembrare un concetto da SD-WAN. Non
 *  lo è. Un IPsec ESCE da una linea, un MPLS e un VPLS ci vengono CONSEGNATI
 *  sopra, una fibra spenta comprata da un operatore idem: «se cade la linea di
 *  Milano, cosa cade con lei» è la stessa domanda per ogni `kind`, ed è LA
 *  domanda del capitolo che si chiama ripristino. Recintata in una natura sola,
 *  teneva le due metà del dossier — le linee di qua, i collegamenti di là —
 *  senza una relazione fra loro.
 *  ⚠️ È una lista PIATTA, non due liste per capo, e non perde niente: ogni
 *  uplink porta il suo `siteId`, quindi un id dice già a quale dei due capi
 *  appartiene. Due liste direbbero la stessa cosa due volte, e al primo
 *  disallineamento si contraddirebbero.
 *  ⚠️ Vuota vuol dire «non dichiarato», non «non corre su niente» — e su un
 *  collegamento diretto fra due edifici il vuoto è la risposta GIUSTA: quel
 *  collegamento È la linea.
 *  ⚠️ Non la deduce nessun import (paletto ②). Far combaciare `peerIp` con un
 *  `publicIps` dichiarato sarebbe una CORRISPONDENZA, non un'identità: un NAT
 *  davanti al router la rompe, l'indirizzo del peer è quello dell'ALTRO capo, e
 *  sull'archivio vero non ne combacia nemmeno una. Si dichiara a mano.
 *  @typedef {{id:string, aSiteId:string, bSiteId:string,
 *             transport:InterSiteTransport|null, tunnel:InterSiteTunnel|null,
 *             name:string|null, state:Fact<InterSiteState>|null,
 *             reach:Fact<InterSiteReach>|null, provider:string|null, circuitId:string|null,
 *             underlayUplinkIds:string[],
 *             endpointA:InterSiteEndpoint, endpointB:InterSiteEndpoint}} InterSiteLinkCommon */

/** Un collegamento fra due sedi. Unione discriminata su `kind`: ogni variante
 *  porta i suoi campi propri e SOLO quelli. `phase1Name` e `ikeVersion` restano
 *  di IPsec perché sono davvero suoi — a differenza dei due capi.
 *  ㉓ **E la PROPOSTA, che è ciò che si ridigita davvero.** Un tunnel non si
 *  rialza con il nome della fase 1 e la versione di IKE: si rialza con i due
 *  insiemi di parametri che i due capi devono avere IDENTICI — cifratura,
 *  integrità, gruppo Diffie-Hellman e durata per la fase 1; cifratura,
 *  integrità, PFS e durata per la fase 2. Sbagliarne uno solo dà un tunnel che
 *  non sale e un log che non dice quale: è l'ora persa tipica di questo lavoro.
 *  ⚠️ **Due stringhe, non dodici campi.** Ogni piattaforma scrive la proposta a
 *  modo suo — `aes256-sha256-modp2048`, `AES256/SHA256/DH14/28800`, un nome di
 *  profilo — e spezzarla in campi obbligherebbe a normalizzare fra vendor, cioè
 *  a decidere che cosa vuol dire «DH14» su una scatola che non lo scrive così
 *  (paletto ③). Qui si COPIA quello che la console mostra, e si ridigita uguale.
 *  ⚠️ La PFS non ha un campo suo: sta nella proposta di fase 2, dov'è scritta su
 *  ogni apparato. Un campo separato sarebbe la stessa cosa detta due volte, e al
 *  primo disallineamento le due direbbero il contrario.
 *  🔒 `pskRef` è **dove sta** la chiave — la voce del password manager, il
 *  percorso nel vault — e MAI la chiave. Ci passa la stessa guardia di
 *  `node.backup.ref`: InfraNet è un registro, non un deposito di segreti, e
 *  questo documento si stampa e si manda in giro.
 *  @typedef {{phase1Name?:string|null, ikeVersion?:1|2|null,
 *             phase1Proposal?:string|null, phase2Proposal?:string|null,
 *             pskRef?:string|null}} IpsecFields */
/** ⑲ I servizi d'operatore: `vrf` e `service` valgono per tutti e cinque.
 *  L'identificativo numerico (VNI, VC-ID) NON c'è, e si dice invece di
 *  infilarlo in `service`.
 *  @typedef {{vrf?:string|null, service?:string|null}} CarrierFields */
/** ㉔ Ciò che è di UNA natura sola, per asse. Non è più un'unione discriminata:
 *  con due assi le varianti sarebbero il PRODOTTO dei due vocabolari, e nessuna
 *  direbbe niente di più di «i campi dell'MPLS più quelli dell'IPsec». La
 *  regola resta dove conta, cioè a RUNTIME: il normalizzatore mette un campo
 *  solo se il suo asse lo chiama, quindi chiedere la versione IKE a una fibra
 *  spenta è impossibile esattamente come prima.
 *  @typedef {InterSiteLinkCommon & IpsecFields & CarrierFields & {
 *             media?:string|null, overlay?:string|null,
 *             transportLabel?:string|null, tunnelLabel?:string|null}} InterSiteLink */

/** Il contenitore sopra i progetti-sede.
 *  @typedef {{id:string, name:string, sites:Site[], uplinks:WanUplink[],
 *             links:InterSiteLink[]}} Organization */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(
    isNode ? require('./cidr.js') : root,
    isNode ? require('./provenance.js') : root,
    isNode ? require('./backup-ref.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (cidr, prov, refs) {
  'use strict';

  // Vocabolari CHIUSI: un valore fuori lista non viene corretto, viene rifiutato.
  /** @type {SiteRole[]} */
  const SITE_ROLES = ['hub', 'spoke', 'standalone'];
  /**
   * ㉔ **I due assi, che erano un campo solo.** `kind` metteva nella stessa
   * tendina «MPLS» e «IPsec», e sono risposte a due domande diverse: un IPsec
   * corre sopra Internet oppure sopra un MPLS, e con un campo solo dichiararne
   * uno CANCELLAVA l'altro. Sull'archivio vero un tunnel fra due sedi entrava
   * come `ipsec` e il circuito che lo portava spariva.
   *
   * Non è una divisione inventata qui: è quella che fa NetBox, che tiene i
   * servizi in `l2vpn.type` e i tunnel in `tunnel.encapsulation` — due modelli
   * separati, due vocabolari chiusi. L'import li leggeva già da due posti e poi
   * li schiacciava in uno; adesso non li schiaccia più.
   *
   * ⚠️ L'ordine è quello della tendina, e `other` in fondo: la porta di servizio
   * non sta fra le scelte precise.
   * ⚠️ Restano FUORI da entrambi, e restano `other` con la loro etichetta:
   * `ip-ip` e `pptp`, e i servizi Ethernet d'operatore (`epl`, `evpl`,
   * `ep-lan`, `ep-tree`…) con `spb` — schiacciarli su `vpws` sarebbe dire una
   * cosa per un'altra.
   */
  /** @type {InterSiteTransport[]} */
  const INTER_SITE_TRANSPORTS = [
    'internet',
    'mpls', 'vpls', 'vpws', 'vxlan', 'evpn',
    'directLink',
    'other',
  ];
  /** @type {InterSiteTunnel[]} */
  const INTER_SITE_TUNNELS = [
    'none',
    'ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp',
    'sdwan',
    'other',
  ];
  /** I servizi d'operatore: gli unici trasporti che hanno una VRF e un nome di
   *  servizio. Un elenco solo, per chi normalizza e per chi disegna. */
  const CARRIER_TRANSPORTS = ['mpls', 'vpls', 'vpws', 'vxlan', 'evpn'];

  /**
   * ㉔ Da `kind` (un campo solo) ai due assi. A senso unico e idempotente, come
   * `publicIp` → `publicIps`: un documento scritto prima non si perde perché il
   * modello ha imparato a distinguere due domande.
   *
   * ⚠️ **L'asse che il vecchio campo NON nominava resta `null`, non un valore di
   * comodo.** Un `kind: 'ipsec'` diceva «c'è un IPsec» e non diceva su cosa
   * corresse: scrivere `transport: 'internet'` sarebbe inventare — quel tunnel
   * poteva benissimo correre sopra l'MPLS aziendale, ed è esattamente il caso
   * che questo cambio esiste per rendere scrivibile. Dall'altro lato uguale: un
   * `mpls` non dichiarava «nessun tunnel», non aveva modo di dirlo.
   */
  /** @type {Record<string, 'transport'|'tunnel'>} */
  const _KIND_ASSE = {
    ipsec: 'tunnel', gre: 'tunnel', wireguard: 'tunnel', openvpn: 'tunnel',
    l2tp: 'tunnel', sdwan: 'tunnel',
    mpls: 'transport', vpls: 'transport', vpws: 'transport', vxlan: 'transport',
    evpn: 'transport', directLink: 'transport', other: 'transport',
  };

  /** @type {InterSiteState[]} */
  const INTER_SITE_STATES = ['up', 'down'];

  /**
   * ㉕ **I tipi di accesso che si comprano davvero, come SUGGERIMENTO.**
   * `serviceType` resta testo LIBERO e non diventa un vocabolario chiuso, per
   * una ragione misurata: lo riempie anche l'import, con le parole dell'istanza
   * NetBox di qualcun altro — 7 su 7 sull'archivio vero, e diceva «MPLS»,
   * «FTTH», «FWA». Un elenco chiuso avrebbe rifiutato quelle parole, o le
   * avrebbe corrette: due modi diversi di rovinare un dato vero. Qui si offre
   * la tendina e si lascia scrivere.
   * ⚠️ Sono TECNOLOGIE, mai nomi commerciali (paletto ③): «FTTH» vale per
   * chiunque la venda, «Fibra Business XYZ» vale per un operatore solo — e
   * domani per nessuno, perché i nomi commerciali cambiano ogni due anni.
   * ⚠️ L'ordine è quello della tendina, e non è alfabetico: prima ciò che si
   * trova in una sede su due, poi le linee da contratto business, poi i ripieghi.
   */
  const WAN_SERVICE_TYPES = [
    'ftth', 'fttc', 'fwa', 'xdsl', 'sdsl',
    'dedicatedFiber', 'darkFiber', 'carrierEthernet', 'mpls',
    'mobile', 'satellite',
  ];
  /** ㉑ I tre modi in cui una WAN prende l'indirizzo. Tre e non di più: sono i
   *  tre che cambiano cosa si digita sul router. `unnumbered` e le varianti di
   *  un vendore stanno fuori finché un archivio vero non le mostra (paletto ③).
   *  @type {WanAddressing[]} */
  const WAN_ADDRESSING = ['static', 'dhcp', 'pppoe'];

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

  /** Un intero POSITIVO. `_posNum` accetterebbe 1500.5, che non è un MTU e non
   *  è una VLAN: sono cose che si contano, non che si misurano.
   *  @param {unknown} v @returns {number|null} */
  function _posInt(v) {
    const n = _posNum(v);
    return n !== null && Number.isInteger(n) ? n : null;
  }

  /** ㉑ Un identificatore di VLAN: intero 1..4094. Lo 0 e il 4095 non sono
   *  «bassi» o «alti», sono RISERVATI dallo standard — una consegna non può
   *  arrivare su quei tag, e accettarli scriverebbe sulla scheda di ripristino
   *  un numero che nessuno può configurare.
   *  ⚠️ Nessun tetto sull'MTU, invece, e per la stessa ragione di `cirMbps`: i
   *  jumbo frame arrivano a 9216 su alcune piattaforme e più in là su altre, e
   *  un limite scelto oggi rifiuterebbe domani una consegna vera. Un MTU
   *  implausibile è materia dell'audit, che segnala; non della normalizzazione,
   *  che scarta.
   *  @param {unknown} v @returns {number|null} */
  function _vlanId(v) {
    const n = _posInt(v);
    return n !== null && n <= 4094 ? n : null;
  }

  /** ⑦ Un INDIRIZZO, mai una rete. `subnetInputToCidr` ridurrebbe `203.0.113.1`
   *  alla sua /24 — un altro fatto, e più grande di quello scritto. È la stessa
   *  trappola degli indirizzi pubblici, e da qui in poi la definizione è UNA.
   *  @param {unknown} v @returns {string|null} */
  function _addr(v) {
    const s = _str(v);
    if (!s) return null;
    return cidr.addrFamily(s) ? cidr.addrKey(s) : null;
  }

  /** ㉑ 🔒 Un puntatore a CHI si chiama, ripulito dai segreti: un portale scritto
   *  `https://utente:password@noc.example` è una credenziale, e in un documento
   *  che si stampa e si manda in giro non ci entra. La guardia non si riscrive
   *  qui — è `lib/backup-ref.js`, la stessa che protegge `node.backup.ref`:
   *  credenziali → si butta il valore, caratteri di controllo → si tolgono,
   *  troppo lungo → si taglia.
   *  @param {unknown} v @returns {string|null} */
  function _supportRef(v) {
    const r = refs.validateBackupRef(v);
    return _str(r.reason === 'credentials' ? '' : r.value);
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
      const k = s.indexOf('/') >= 0 ? cidr.subnetInputToCidr(s) : _addr(s);
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
      // ㉑ Come si rimette su questa linea. Vedi il typedef: sei domande della
      // notte in cui è giù, e nessuna la sa un import.
      addressing: _has(WAN_ADDRESSING, o.addressing) ? /** @type {WanAddressing} */ (o.addressing) : null,
      nextHop: _addr(o.nextHop),
      deliveryVlan: _vlanId(o.deliveryVlan),
      mtu: _posInt(o.mtu),
      supportRef: _supportRef(o.supportRef),
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
    // ㉔ **I DUE ASSI.** Si leggono per primi perché tutto il resto dipende da loro.
    //
    // ⚠️ **Un valore fuori vocabolario diventa `null`, e non fa cadere la riga.**
    // Con `kind` il rifiuto (⑤) aveva un motivo preciso: quel campo DISCRIMINAVA
    // l'unione, e una natura ignota lasciava un oggetto senza forma. Ora i due
    // assi sono facoltativi come `role`, `state` o `addressing`, e buttare via un
    // collegamento intero — i due capi, le reti raggiungibili, le linee spuntate
    // — per una parola storta sarebbe una cura peggiore del male. Si perde UNA
    // parola, e si vede: a schermo e sulla carta resta «non dichiarato».
    let transport = _has(INTER_SITE_TRANSPORTS, o.transport)
      ? /** @type {InterSiteTransport} */ (o.transport) : null;
    let tunnel = _has(INTER_SITE_TUNNELS, o.tunnel)
      ? /** @type {InterSiteTunnel} */ (o.tunnel) : null;
    // La migrazione da `kind` scatta SOLO se nessuno dei due assi è già scritto,
    // così rileggere un documento già migrato non lo tocca.
    if (transport === null && tunnel === null) {
      const asse = _KIND_ASSE[String(o.kind)];
      if (asse === 'transport') transport = /** @type {InterSiteTransport} */ (o.kind);
      else if (asse === 'tunnel') tunnel = /** @type {InterSiteTunnel} */ (o.kind);
    }

    const common = {
      id,
      aSiteId,
      bSiteId,
      transport,
      tunnel,
      state: _stateFact(o.state),
      reach: _reachFact(o.reach),
      // ⑩ Operatore e codice del circuito: comuni come i capi, e per lo stesso
      // motivo — la domanda non cambia con la natura del collegamento.
      provider: _str(o.provider),
      circuitId: _str(o.circuitId),
      // ⑪ E come si chiama: «GRE-LAB» è il nome, «GRE» è la natura.
      name: _str(o.name),
      // ⑳ E su quali linee corre. Era del solo `sdwan`, ed è la domanda del
      // ripristino: vale per ogni natura.
      // ⚠️ Gli id ripetuti si contano UNA volta. Non è un dato che si perde:
      // la stessa linea due volte è la stessa linea, e sulla scheda di
      // ripristino comparirebbe due volte facendo credere a due accessi.
      underlayUplinkIds: _uniqueStr(_list(o.underlayUplinkIds).map(_id).filter(Boolean)),
      // ⑥ I due capi valgono per ogni natura: anche un MPLS o una fibra arrivano
      // su un apparato preciso, ed è la cosa che si va a cercare per prima.
      endpointA: _endpoint(o.endpointA),
      endpointB: _endpoint(o.endpointB),
    };

    // ㉔ I campi propri seguono il loro ASSE, e ci sono solo dove vogliono dire
    // qualcosa. Niente `switch`: la trappola del `case` mancante (⑲), che faceva
    // sparire un collegamento in silenzio, qui non ha più dove annidarsi.
    /** @type {Record<string, unknown>} */
    const l = common;

    // ── ciò che è del TRASPORTO ──────────────────────────────────────────
    if (CARRIER_TRANSPORTS.indexOf(String(transport)) >= 0) {
      l.vrf = _str(o.vrf);
      l.service = _str(o.service);
    }
    if (transport === 'directLink') l.media = _str(o.media);
    // ⑨ L'etichetta di `other` può restare vuota: «non so come chiamarlo» è già
    // un'informazione, e obbligare a scrivere qualcosa produce etichette
    // riempitivo invece di un onesto silenzio.
    // ⚠️ Il vecchio `kindLabel` finisce QUI, sul trasporto: un `kind: 'other'`
    // era una cosa che PORTA il collegamento — un servizio d'operatore che il
    // vocabolario non nomina, un ponte radio — non un tunnel che ci corre sopra.
    if (transport === 'other') l.transportLabel = _str(o.transportLabel) || _str(o.kindLabel);

    // ── ciò che è del TUNNEL ─────────────────────────────────────────────
    if (tunnel === 'ipsec') {
      const ike = _num(o.ikeVersion);
      l.phase1Name = _str(o.phase1Name);
      l.ikeVersion = (ike === 1 || ike === 2) ? ike : null;
      // ㉓ Le due proposte come le scrive l'apparato, e dove sta la chiave.
      l.phase1Proposal = _str(o.phase1Proposal);
      l.phase2Proposal = _str(o.phase2Proposal);
      l.pskRef = _supportRef(o.pskRef);
    }
    // ㉔ L'overlay resta dell'SD-WAN, che ora sta fra i tunnel: è il nome della
    // rete logica che la sua console mostra, e su un IPsec non vuol dire niente.
    if (tunnel === 'sdwan') l.overlay = _str(o.overlay);
    if (tunnel === 'other') l.tunnelLabel = _str(o.tunnelLabel);

    return /** @type {InterSiteLink} */ (/** @type {unknown} */ (l));
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

  /** Lo stesso, per una lista di RIFERIMENTI (⑳): l'ordine dichiarato resta,
   *  e la prima occorrenza vince. */
  /** @param {string[]} lista @returns {string[]} */
  function _uniqueStr(lista) {
    const visti = new Set();
    return lista.filter((x) => {
      if (visti.has(x)) return false;
      visti.add(x);
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
    SITE_ROLES, INTER_SITE_STATES, WAN_ADDRESSING, WAN_SERVICE_TYPES,
    INTER_SITE_TRANSPORTS, INTER_SITE_TUNNELS, CARRIER_TRANSPORTS,
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
