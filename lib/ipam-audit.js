// ============================================================
// IPAM AUDIT — igiene IPAM: IP duplicati + overlap di subnet (report puro)
// ============================================================
// Consistenza doc↔doc (NON doc↔realtà: quello è il Drift). Dati i prefissi IPAM
// dichiarati e i nodi documentati, segnala due misconfig che un IPAM reale pesca
// e che InfraNet finora non vedeva:
//   - duplicateIps[]:   lo STESSO indirizzo su >=2 nodi documentati (refuso o
//                       conflitto), IPv4 e IPv6, con l'IPv6 confrontato in forma
//                       canonica: due scritture dello stesso indirizzo sono UN
//                       indirizzo
//   - subnetOverlaps[]: due PREFISSI che si INTERSECANO (o sono la stessa rete)
//   - addressesOutsidePlan[]: un indirizzo DOCUMENTATO che non cade in nessuna
//                       rete dichiarata. E' il declare-first applicato all'IPAM:
//                       il piano e' l'autorita', e un apparato che vive fuori dal
//                       piano o e' un errore di battitura, o e' una rete che
//                       nessuno ha mai scritto. In entrambi i casi si dice.
//
// Funzione PURA, sola lettura: NON muta nulla (manual-first) e non inventa —
// tutto deriva dai campi già documentati dall'utente. Nessun DOM, nessun globale.
// UMD-lite: browser (window) + Node (module.exports), come lib/ipam.js.
//
// INPUT model = {
//   prefixes:  [ { cidr, vlan, container?, status?, vrfId? } ],  // ipam.prefixes[] — l'autorità
//   nodes:     [ { id, name, ip, ip6 } ],            // nodi documentati (entrambe le famiglie)
//   parseCidr: fn(cidr) -> { family, network, broadcast, prefix, raw } | null  // iniettato (lib/cidr.js _parseCidrInfo)
//   vlanNames: { <vid>: nome },                     // il piano VLAN: dare un nome è dichiarare
//   vlansInUse:[ { vlan, where:[nomi] } ],           // VLAN viste nel documento (porte/trunk/SSID/VM)
//   siteNativeVlan: numero,                          // il pavimento: non si accusa
// }
// OUTPUT {
//   duplicateIps:  [ { ip, nodes:[ { id, name } ] } ],                    // ordinati per IP
//   subnetOverlaps:[ { a:{cidr,vlan}, b:{cidr,vlan}, identical } ],       // ordinati per indirizzo, `a` prima di `b`
//   subnetOverlapsExpected: [ { a, b, identical, reason } ],              // ci sono, non sono un errore
//   addressesOutsidePlan:   [ { ip, family, node:{id,name} } ],           // ordinati per indirizzo
//   vlansOutsidePlan:       [ { vlan, where:[nomi] } ],                  // ordinate per numero
//   notChecked:             [ { check, reason } ],                        // ⭐ vedi qui sotto
// }
//
// ⭐ `notChecked` esiste perche' «non ho potuto controllare» e «ho controllato e
// non c'e' niente» uscivano IDENTICI: una lista vuota. Se `parseCidr` non arriva,
// il classificatore delle sovrapposizioni ritorna zero conflitti — e il report
// scrive «nessun problema» su una verifica che non e' mai partita. E' l'opposto
// esatto della regola che questo progetto applica ovunque al grigio «non risulta»,
// e in un audit e' peggio che in un disegno: un audit che tace viene creduto.
// Ogni controllo che non ha potuto girare lascia qui il suo nome e il motivo.
// `status` e `vrfId` arrivano dall'import DCIM e finora non li leggeva nessuno: un
// contenitore che contiene le proprie reti, o lo stesso spazio in due VRF diverse,
// venivano accusati come conflitti. Sono la norma in un piano vero.
// ⚠️ E `container` è la stessa cosa DETTA DA TE: senza di lui una gerarchia scritta
// a mano non aveva modo di dichiararsi, e restava accusata per sempre di una
// sovrapposizione che era voluta. Vedi `isContainerPrefix`.
(function (root, factory) {
  // `cidrLib` = lib/cidr.js: Node/bundle via require, browser via window (cidr.js
  // e' uno <script> caricato prima). Stessa convenzione di lib/correlate.js.
  const cidrLib = (typeof module !== 'undefined' && module.exports) ? require('./cidr.js') : root;
  const api = factory(cidrLib);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (cidrLib) {
  'use strict';

  // Chiave numerica di un IPv4 per un ordinamento stabile "umano" (1.2.3.4 <
  // 1.2.3.40). Se non è un IPv4 valido → NaN (finisce in coda, ordine stringa).
  function _ipSortKey(ip) {
    const p = String(ip || '').trim().split('.');
    if (p.length !== 4) return NaN;
    let n = 0;
    for (const o of p) {
      const v = Number(o);
      if (!Number.isInteger(v) || v < 0 || v > 255) return NaN;
      n = (n * 256) + v;
    }
    return n;
  }

  // L'intersezione fra due prefissi ha UNA definizione, in lib/cidr.js, e vale per
  // IPv4 e IPv6. Qui c'era il confronto fra interi a 32 bit: su un prefisso v6 quei
  // campi non esistono e i confronti su `undefined` davano `false` — nessun falso
  // positivo, ma per caso, non per scelta.
  function _rangesOverlap(a, b) {
    const f = cidrLib && cidrLib._cidrsOverlap;
    return typeof f === 'function' ? !!f(a, b) : false;
  }

  // L'identita' di un indirizzo ha UNA definizione, in lib/cidr.js: un IPv4 e' la
  // sua stringa, un IPv6 la sua forma canonica. Senza, "2001:DB8::10" e
  // "2001:db8:0:0:0:0:0:10" sullo stesso segmento passavano per due indirizzi
  // diversi, ed e' proprio il caso che questo audit deve pescare.
  function _key(addr) {
    const f = cidrLib && cidrLib.addrKey;
    return typeof f === 'function' ? f(addr) : String(addr == null ? '' : addr).trim();
  }

  // Stesso indirizzo (non vuoto) su >=2 nodi documentati. IPv4 E IPv6: un device
  // dual-stack ne dichiara due, e un IPv6 ricopiato su due apparati e' un conflitto
  // esattamente quanto un IPv4 — prima di qui nessuno lo guardava.
  // Un nodo che ripete lo stesso indirizzo su entrambi i campi non fa un duplicato
  // con se' stesso: la lista e' per NODO, non per campo.
  // Un IPv6 link-local (fe80::/10) e' unico PER-LINK (RFC 4007): lo stesso fe80::1 su
  // due router in segmenti diversi e' legale, non un conflitto. L'app non modella il
  // "link" dall'ip6 di gestione, quindi non puo' dire se due nodi lo condividono →
  // fuori dall'audit duplicati. Definizione della classe in lib/cidr.js (una sola).
  function _isLinkLocal(addr) {
    const f = cidrLib && cidrLib.addrIsLinkLocalV6;
    return typeof f === 'function' ? !!f(addr) : false;
  }

  function findDuplicateIps(nodes) {
    const byIp = new Map();
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      const seen = new Set();
      for (const raw of [n && n.ip, n && n.ip6]) {
        if (_isLinkLocal(raw)) continue;
        const key = _key(raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // La chiave normalizza, ma cio' che si MOSTRA e' com'e' stato scritto
        // (manual-first): vince la prima scrittura incontrata.
        if (!byIp.has(key)) byIp.set(key, { ip: String(raw).trim(), nodes: [] });
        byIp.get(key).nodes.push({ id: n.id, name: n.name || n.id || '' });
      }
    }
    const out = [];
    for (const rec of byIp.values()) {
      if (rec.nodes.length >= 2) out.push(rec);
    }
    out.sort((x, y) => {
      const kx = _ipSortKey(x.ip), ky = _ipSortKey(y.ip);
      // Le famiglie non si mescolano: prima le v4 (chiave numerica), poi tutto il
      // resto in ordine di stringa. Scelta qualsiasi, ma STABILE.
      if (Number.isNaN(kx) || Number.isNaN(ky)) {
        if (Number.isNaN(kx) !== Number.isNaN(ky)) return Number.isNaN(kx) ? 1 : -1;
        return String(x.ip).localeCompare(String(y.ip));
      }
      return kx - ky;
    });
    return out;
  }

  // Ordine nello SPAZIO DEGLI INDIRIZZI: 10.0.0.0/8 prima di 192.168.1.0/24, e a
  // parità di rete il prefisso più largo prima del più stretto (/24 prima di /25).
  // Le famiglie non si mescolano: prima le v4, poi le v6 — una scelta qualsiasi, ma
  // STABILE, così due letture consecutive non si scambiano le righe.
  // Sta qui perché è l'ordine con cui si LEGGE un piano di indirizzamento — le
  // collisioni sono vicine nello spazio degli indirizzi, non nelle VLAN. Una
  // definizione sola, riusata da chi mostra l'elenco: la stessa regola in due strati
  // diverge, ed è sempre l'incompleta a vincere.
  function compareCidr(a, b) {
    if (!a || !b) return a ? -1 : (b ? 1 : 0);
    const fa = a.family || 4, fb = b.family || 4;
    if (fa !== fb) return fa - fb;
    if (fa === 6) {
      const wa = a.network6 || [], wb = b.network6 || [];
      for (let i = 0; i < 8; i++) { const d = (wa[i] || 0) - (wb[i] || 0); if (d) return d; }
      return a.prefix - b.prefix;
    }
    // `network` è unsigned a 32 bit: si confronta, non si sottrae (la differenza
    // fra due /8 lontane esce dal range dei signed).
    if (a.network !== b.network) return a.network < b.network ? -1 : 1;
    return a.prefix - b.prefix;
  }

  // Coppie di PREFISSI dichiarati che si sovrappongono. Prende `ipam.prefixes[]`,
  // non la vista per-VLAN: la sovrapposizione è un fatto dello spazio degli
  // indirizzi (L3), e la VLAN (L2) è un attributo FACOLTATIVO di ciascuno dei due.
  // Confrontare «il prefisso principale di ogni VLAN» rendeva invisibili sia le reti
  // senza VLAN (su un NetBox vero, la maggioranza) sia il secondo prefisso di una
  // VLAN dual-stack.
  // Due prefissi sulla STESSA VLAN non sono più esclusi a priori: v4+v6 è dual-stack
  // e non si interseca mai (ci pensa `_cidrsOverlap`, famiglie diverse), ma due v4
  // che si intersecano sulla stessa VLAN sono un conflitto vero.
  // `identical` = si sovrappongono e hanno lo stesso prefisso ⇒ sono la stessa rete.
  //
  // ⚠️ NON tutte le sovrapposizioni sono un errore, e due casi sono la NORMA in un
  // piano indirizzi vero (si vedono al primo import da un DCIM). `_expectedReason`
  // li riconosce e li tiene FUORI dall'accusa — restano contati a parte, perché un
  // conteggio che cala in silenzio è peggio di un conteggio sbagliato.
  //
  //   'hierarchy' — un prefisso CONTENITORE e le reti dichiarate dentro di lui. In
  //     un IPAM il contenitore serve esattamente a dire «questo spazio è suddiviso
  //     qua sotto»: accusarlo di sovrapporsi ai propri figli è come accusare un
  //     cassetto di occupare il posto delle cartelle che contiene.
  //   'vrf' — lo stesso spazio in due VRF DICHIARATE e diverse: sono due tabelle di
  //     routing separate, e la stessa 192.168.1.0/24 può viverci due volte senza che
  //     nessuno si confonda. Solo se ENTRAMBE sono note: se una manca non lo
  //     sappiamo, e il silenzio non si compra con l'ignoranza.
  //
  // ⚠️ In aritmetica CIDR due prefissi della stessa famiglia o sono disgiunti o uno
  // CONTIENE l'altro — la sovrapposizione parziale non esiste. Quindi «si
  // sovrappongono e hanno prefissi diversi» significa già «il più largo contiene il
  // più stretto»: basta guardare se il più largo è un contenitore.
  /**
   * «Questa rete è un CONTENITORE»: esiste per essere suddivisa, non per ospitare
   * apparati. UNA definizione per DUE sorgenti, ed è deliberato che stia qui e non
   * ricomposta in chi la usa — è così che due strati cominciano a rispondere
   * diverso alla stessa domanda.
   *
   * ⚠️ Prima lo diceva solo il DCIM (`status: 'container'`, vocabolario di NetBox),
   * e una gerarchia scritta A MANO non aveva nessun modo di dichiararsi: restava
   * accusata di sovrapporsi alle proprie sottoreti, a ogni apertura del report,
   * per sempre. Un avviso che non si può chiudere perché è vero-ma-voluto è il modo
   * più rapido per insegnare a chi legge a ignorare TUTTI gli avvisi.
   *
   * ⚠️ Manual-first, e in entrambi i versi: `container:true` dichiara, ma
   * `container:false` NEGA anche ciò che il DCIM afferma. Chi documenta ha visto la
   * rete; l'import ha letto un altro archivio. La chiave ASSENTE non è né l'uno né
   * l'altro: vuol dire «non l'ho detto io», e allora parla la sorgente.
   * @param {{container?:boolean, status?:any}|null|undefined} p
   */
  function isContainerPrefix(p) {
    if (!p) return false;
    if (p.container === true) return true;
    if (p.container === false) return false;
    // Normalizzato a minuscole: «Container» e «container» sono la stessa parola.
    return String(p.status == null ? '' : p.status).trim().toLowerCase() === 'container';
  }

  /**
   * Che cosa SALVARE quando l'interruttore del pannello passa a `checked`.
   *
   * L'interruttore mostra la RISPOSTA (`isContainerPrefix`), non il campo grezzo:
   * una rete importata come contenitore nasce già accesa. Quindi si conserva la
   * DIFFERENZA rispetto a ciò che dice la sorgente — d'accordo con lei non c'è
   * nessuna dichiarazione da tenere (`''`, e chi scrive toglie la chiave), in
   * disaccordo resta scritta. ⚠️ Senza questo, ogni rete che apri si porterebbe a
   * casa un `container:false` che non afferma niente: la stessa zavorra dei campi
   * che si pre-compilavano da soli.
   * @returns {boolean|''} il valore da scrivere, o '' per «togli la chiave»
   */
  function containerDeclarationFor(p, checked) {
    return (!!checked === isContainerPrefix({ status: p && p.status })) ? '' : !!checked;
  }

  function _expectedReason(a, b) {
    if (a.vrf != null && b.vrf != null && a.vrf !== b.vrf) return 'vrf';
    if (a.info.prefix !== b.info.prefix) {
      const wide = a.info.prefix <= b.info.prefix ? a : b;
      if (wide.container) return 'hierarchy';
    }
    return null;
  }

  // Un solo passaggio, due viste: la regola di cosa è un conflitto vive QUI e non
  // in due funzioni gemelle che col tempo divergono.
  function _classifyOverlaps(prefixes, parseCidr) {
    const empty = { conflicts: [], expected: [] };
    if (typeof parseCidr !== 'function') return empty;
    const parsed = [];
    for (const p of (Array.isArray(prefixes) ? prefixes : [])) {
      if (!p) continue;
      const cidr = String(p.cidr == null ? '' : p.cidr).trim();
      if (!cidr) continue;
      const info = parseCidr(cidr);
      if (!info) continue;
      // `+null === 0`: il null resta null, o una rete senza VLAN diventa «VLAN 0».
      const vlan = (p.vlan == null || !Number.isFinite(+p.vlan)) ? null : +p.vlan;
      // Dichiarato a mano oppure detto dal DCIM: la domanda è una, e la risposta
      // sta in `isContainerPrefix` — qui non si ricompone la regola.
      const container = isContainerPrefix(p);
      const vrf = (p.vrfId == null || p.vrfId === '') ? null : String(p.vrfId);
      parsed.push({ cidr, vlan, container, vrf, info });
    }
    // Ordinati PRIMA del confronto: le coppie escono già in ordine di indirizzo e
    // `a` è sempre il prefisso che viene prima.
    parsed.sort((x, y) => compareCidr(x.info, y.info) || String(x.cidr).localeCompare(String(y.cidr)));
    const conflicts = [], expected = [];
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i], b = parsed[j];
        if (!_rangesOverlap(a.info, b.info)) continue;
        const pair = {
          a: { cidr: a.cidr, vlan: a.vlan },
          b: { cidr: b.cidr, vlan: b.vlan },
          identical: a.info.prefix === b.info.prefix,
        };
        const reason = _expectedReason(a, b);
        if (reason) expected.push(Object.assign({ reason }, pair));
        else conflicts.push(pair);
      }
    }
    return { conflicts, expected };
  }

  /**
   * Indirizzi documentati che non cadono in NESSUNA rete dichiarata.
   *
   * Il piano IPAM e' l'autorita' (declare-first): se un apparato vive fuori da
   * tutte le reti che hai scritto, o l'indirizzo e' sbagliato o la rete non e'
   * mai stata dichiarata. Sono due conclusioni diverse e non sta a noi sceglierne
   * una — si nomina l'indirizzo e chi lo porta, e decide chi legge.
   *
   * ⚠️ Si giudica PER FAMIGLIA, e questa e' la guardia che tiene su tutto il
   * resto: se il piano non dichiara nemmeno una rete IPv6, allora ogni IPv6
   * documentato risulterebbe «fuori dal piano» — e non sarebbe una scoperta, solo
   * il rumore di un confronto contro il nulla. Nessuna rete di quella famiglia =
   * nessun giudizio su quella famiglia. Vale anche per l'IPv4: un progetto senza
   * reti dichiarate non accusa nessuno.
   *
   * ⚠️ Il link-local IPv6 resta fuori per la stessa ragione per cui e' fuori dai
   * duplicati: `fe80::/10` non appartiene a un piano di indirizzamento, esiste su
   * ogni interfaccia per conto suo (RFC 4291) e nessuno lo dichiara mai.
   */
  /**
   * Le VLAN che il PIANO dichiara.
   *
   * ⚠️ NON è `vlanColors`: quello è l'elenco di ogni VLAN mai VISTA, e ci finisce
   * da sola ogni VLAN letta via SNMP (`_ensureVlanColor`). Un elenco che si
   * riempie da solo non può fare da piano — confrontare l'uso con quello sarebbe
   * confrontare una cosa con se stessa, e uscirebbe sempre «tutto a posto».
   *
   * Dichiarare è un ATTO, e ne bastano due: darle un nome, o darle una rete.
   * Chi ha fatto l'uno o l'altro ha detto «questa VLAN esiste e so cos'è».
   * @returns {Set<number>}
   */
  function declaredVlans(prefixes, vlanNames) {
    const out = new Set();
    for (const p of (Array.isArray(prefixes) ? prefixes : [])) {
      if (!p || p.vlan == null || !Number.isFinite(+p.vlan)) continue;
      out.add(+p.vlan);
    }
    const names = (vlanNames && typeof vlanNames === 'object') ? vlanNames : {};
    for (const k of Object.keys(names)) {
      const v = +k;
      if (Number.isFinite(v) && String(names[k] == null ? '' : names[k]).trim()) out.add(v);
    }
    return out;
  }

  /**
   * Le VLAN che il documento USA DAVVERO, con il nome di chi le porta.
   *
   * ⚠️ Non è `vlanColors`: quello è l'elenco di ogni VLAN mai VISTA — ci finisce
   * da sola ogni VLAN letta via SNMP — e serviva a colorare, non a dichiarare.
   * Confrontare l'uso con quell'elenco vorrebbe dire confrontare una cosa con se
   * stessa, e uscirebbe «tutto a posto» su qualunque progetto.
   *
   * Si guarda dove le VLAN vivono per davvero, e le sorgenti sono TRE — dimenticarne
   * una non si vede a schermo, si vede solo qui:
   *   · le PORTE: misurata (`vlan`), dichiarata (`vlanOvr`), propagata (`vlanProp`),
   *     più le trasportate del trunk (`trunkVlans`) e quelle propagate lungo il run
   *     passivo (`trunkProp`);
   *   · i DEVICE: SSID delle radio, voce VoIP, vNIC delle VM — tutte e tre da
   *     `carriedVlans`, che è già l'unica definizione di «cosa trasporta questo
   *     apparato»;
   *   · i CAVI: il trunk scritto a mano sul collegamento, che non sta su nessuna
   *     delle due.
   *
   * Le funzioni arrivano iniettate come `parseCidr`: questa lib resta pura e non
   * sa niente né del DOM né di dove viva lo stato.
   * @returns {Array<{vlan:number, where:string[]}>} ordinate per numero
   */
  function collectVlansInUse(doc) {
    const d = doc || {};
    const carried = typeof d.carriedVlans === 'function' ? d.carriedVlans : () => [];
    const parseList = typeof d.parseVlanList === 'function' ? d.parseVlanList : () => [];
    const nodeOfPort = typeof d.nodeOfPort === 'function' ? d.nodeOfPort : () => null;
    const nameOf = typeof d.nameOf === 'function' ? d.nameOf : (n => (n && (n.name || n.id)) || '');

    const visto = new Map();
    const add = (v, dove) => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 4094) return;
      if (!visto.has(n)) visto.set(n, new Set());
      if (dove) visto.get(n).add(String(dove));
    };

    const ports = (d.ports && typeof d.ports === 'object') ? d.ports : {};
    for (const pid of Object.keys(ports)) {
      const pi = ports[pid] || {};
      const dove = nameOf(nodeOfPort(pid));
      add(pi.vlan, dove); add(pi.vlanOvr, dove); add(pi.vlanProp, dove);
      for (const v of parseList(pi.trunkVlans || [])) add(v, dove);
      if (Array.isArray(pi.trunkProp)) for (const v of pi.trunkProp) add(v, dove);
    }
    for (const n of (Array.isArray(d.nodes) ? d.nodes : [])) {
      const dove = nameOf(n);
      for (const v of carried(n)) add(v, dove);
    }
    for (const l of (Array.isArray(d.links) ? d.links : [])) {
      if (!l || !l.trunkVlans) continue;
      const dove = nameOf(nodeOfPort(l.src)) || nameOf(nodeOfPort(l.dst));
      for (const v of parseList(l.trunkVlans)) add(v, dove);
    }
    return Array.from(visto.entries())
      .map(([vlan, chi]) => ({ vlan, where: Array.from(chi).sort() }))
      .sort((a, b) => a.vlan - b.vlan);
  }

  /**
   * VLAN che il documento USA e di cui il piano non dice niente.
   *
   * È il declare-first applicato alle VLAN, gemello di `addressesOutsidePlan`: se
   * un cavo porta la VLAN 30 e nel piano la 30 non ha né un nome né una rete, o
   * qualcuno l'ha configurata senza scriverla, o l'ha scritta e non è più quella.
   * Le due conclusioni sono diverse e non sta a noi sceglierne una: si dice il
   * numero e dove si è visto.
   *
   * ⚠️ La guardia che tiene su tutto: se il piano non dichiara NEMMENO UNA VLAN,
   * nessun giudizio. Ogni VLAN in uso risulterebbe fuori dal piano, e non sarebbe
   * una scoperta — solo il rumore di un confronto contro il nulla, su ogni
   * progetto che non usa ancora la sezione VLAN. Identico al «nessuna rete di
   * quella famiglia, nessun giudizio su quella famiglia» qui sotto.
   *
   * ⚠️ La nativa di SITO non si accusa: è il pavimento, il posto dove finisce
   * tutto ciò che nessuno ha assegnato altrove (802.1Q). Chiedere di dichiarare
   * il pavimento sarebbe una riga su ogni progetto, e una riga che compare sempre
   * non la legge più nessuno.
   *
   * @param {Array<{vlan:number, where?:string[]}>} vlansInUse VLAN viste nel documento
   * @param {Set<number>|number[]} declared il piano
   * @param {number} siteNativeVlan il pavimento (default 1)
   * @returns {Array<{vlan:number, where:string[]}>} ordinate per numero
   */
  function findVlansOutsidePlan(vlansInUse, declared, siteNativeVlan) {
    const plan = (declared instanceof Set) ? declared : new Set((Array.isArray(declared) ? declared : []).map(Number));
    if (!plan.size) return [];
    const nat = Number.isFinite(+siteNativeVlan) ? +siteNativeVlan : 1;
    const out = [];
    for (const u of (Array.isArray(vlansInUse) ? vlansInUse : [])) {
      const v = u && +u.vlan;
      if (!Number.isFinite(v) || v < 1 || v > 4094) continue;
      if (v === nat || plan.has(v)) continue;
      const where = Array.isArray(u.where) ? u.where.filter(Boolean).map(String) : [];
      out.push({ vlan: v, where });
    }
    out.sort((a, b) => a.vlan - b.vlan);
    return out;
  }

  function findAddressesOutsidePlan(nodes, prefixes, parseCidr) {
    const inCidr = cidrLib && cidrLib._ipInCidr;
    const family = cidrLib && cidrLib.addrFamily;
    if (typeof parseCidr !== 'function' || typeof inCidr !== 'function' || typeof family !== 'function') return [];
    const reti = [];
    for (const p of (Array.isArray(prefixes) ? prefixes : [])) {
      const cidr = String(p && p.cidr == null ? '' : p.cidr).trim();
      if (!cidr) continue;
      const info = parseCidr(cidr);
      if (info) reti.push(info);
    }
    const famiglie = new Set(reti.map(r => r.family));
    const out = [];
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      const visti = new Set();
      for (const raw of [n && n.ip, n && n.ip6]) {
        const ip = String(raw == null ? '' : raw).trim();
        if (!ip || visti.has(ip)) continue;
        visti.add(ip);
        if (_isLinkLocal(ip)) continue;
        const fam = family(ip);
        // Famiglia non riconosciuta = non e' un indirizzo, e un campo scritto male
        // non e' «fuori dal piano»: e' un'altra faccenda, e non la si accusa qui.
        if (!fam || !famiglie.has(fam)) continue;
        let dentro = false;
        for (const r of reti) { if (r.family === fam && inCidr(ip, r)) { dentro = true; break; } }
        if (!dentro) out.push({ ip, family: fam, node: { id: n.id, name: n.name || n.id || '' } });
      }
    }
    out.sort((x, y) => {
      const kx = _ipSortKey(x.ip), ky = _ipSortKey(y.ip);
      if (Number.isNaN(kx) || Number.isNaN(ky)) {
        if (Number.isNaN(kx) !== Number.isNaN(ky)) return Number.isNaN(kx) ? 1 : -1;
        return String(x.ip).localeCompare(String(y.ip));
      }
      return kx - ky;
    });
    return out;
  }

  // Le sovrapposizioni da SEGNALARE: due reti che si pestano i piedi davvero.
  function findSubnetOverlaps(prefixes, parseCidr) {
    return _classifyOverlaps(prefixes, parseCidr).conflicts;
  }

  // Le sovrapposizioni ATTESE: ci sono, non sono un errore, e si dicono lo stesso.
  function findExpectedOverlaps(prefixes, parseCidr) {
    return _classifyOverlaps(prefixes, parseCidr).expected;
  }

  function buildIpamAudit(model) {
    model = model || {};
    // Una classificazione sola per entrambe le liste: due chiamate rifarebbero lo
    // stesso doppio ciclo, e soprattutto potrebbero un giorno rispondere diverso.
    const ov = _classifyOverlaps(model.prefixes, model.parseCidr);
    // ⭐ Ogni controllo che NON ha potuto girare lascia qui il suo nome. Una lista
    // vuota vuol dire «ho guardato»; senza questo registro voleva dire anche «non
    // ho guardato», e le due cose finivano nella stessa frase: «nessun problema».
    const notChecked = [];
    const hasParser = typeof model.parseCidr === 'function';
    const prefissi = (Array.isArray(model.prefixes) ? model.prefixes : [])
      .filter(p => p && String(p.cidr == null ? '' : p.cidr).trim());
    if (!hasParser) {
      notChecked.push({ check: 'subnetOverlaps', reason: 'no-parser' });
      notChecked.push({ check: 'addressesOutsidePlan', reason: 'no-parser' });
    } else if (!prefissi.length) {
      // Non e' un guasto: e' che non c'e' un piano con cui confrontare. Detto lo
      // stesso, o «nessun indirizzo fuori dal piano» suonerebbe come una conferma.
      notChecked.push({ check: 'addressesOutsidePlan', reason: 'no-plan' });
    }
    // L'identita' di un IPv6 dipende dalla forma canonica: senza `addrKey` il
    // confronto cade sulla stringa grezza e due scritture dello stesso indirizzo
    // smettono di essere un duplicato. Il controllo gira lo stesso, ma degradato,
    // e chi legge deve saperlo.
    if (!cidrLib || typeof cidrLib.addrKey !== 'function') notChecked.push({ check: 'duplicateIps', reason: 'no-canon' });
    // Le VLAN: stesso metro delle reti. Un piano che non dichiara nemmeno una VLAN
    // non è un piano contro cui misurare — e dirlo è l'unico modo per non far
    // passare «nessuna VLAN fuori dal piano» per una promozione.
    const piano = declaredVlans(model.prefixes, model.vlanNames);
    if (!piano.size) notChecked.push({ check: 'vlansOutsidePlan', reason: 'no-vlan-plan' });
    return {
      duplicateIps: findDuplicateIps(model.nodes),
      subnetOverlaps: ov.conflicts,
      subnetOverlapsExpected: ov.expected,
      addressesOutsidePlan: findAddressesOutsidePlan(model.nodes, model.prefixes, model.parseCidr),
      vlansOutsidePlan: findVlansOutsidePlan(model.vlansInUse, piano, model.siteNativeVlan),
      notChecked,
    };
  }

  return { buildIpamAudit, findDuplicateIps, findSubnetOverlaps, findExpectedOverlaps, findAddressesOutsidePlan, compareCidr, isContainerPrefix, containerDeclarationFor, declaredVlans, findVlansOutsidePlan, collectVlansInUse };
});
