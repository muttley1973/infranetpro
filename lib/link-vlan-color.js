// ============================================================
// LINK-VLAN-COLOR — «di che VLAN e' questo cavo», UNA risposta sola
// ============================================================
// Il colore di un cavo rispondeva alla domanda sbagliata: chiedeva la VLAN
// NATIVA e la dipingeva. Su un access la nativa E' tutta la verita'; su un
// TRUNK e' 1 legittimamente (la misura `vlanTrunkPortNativeVlan`) mentre le
// VLAN vere viaggiano taggate — quindi un lab intero usciva grigio «VLAN 1»
// pur non essendolo.
//
// ⭐ La regola che governa tutto: **su un trunk nessuna VLAN vince**. Tutte
// servono, e qualunque criterio che ne elegge una afferma una cosa falsa. Il
// controesempio che chiude la questione: un'interfaccia che fa gestione E
// VLAN 30 non ha una risposta — non e' che sia difficile da calcolare, non
// esiste. Quindi un trunk multi-VLAN non prende colore: resta neutro, e le
// VLAN che porta si vedono tutte insieme (pastiglie nel pannello), nessuna
// sopra le altre.
//
// Quattro esiti, e ognuno dice una cosa sola:
//   'vlan'     una VLAN sola si applica a questo cavo → il suo colore
//   'trunk'    ne porta piu' d'una → neutro, nessuna vince
//   'routed'   il cavo INSTRADA: non sta in nessuna VLAN, nemmeno nella 1
//   'conflict' i due capi dicono VLAN DIVERSE con la stessa autorita' → neutro
//
// ⭐ Il quarto e' arrivato per ultimo, e non descrive il cavo: descrive NOI. Gli
// altri tre dicono che cos'e' quel collegamento; questo dice che il documento si
// contraddice, e che quindi una risposta non c'e' finche' qualcuno non decide.
// Prima la scala prendeva il PRIMO capo che parlava e ne dipingeva la VLAN con
// `known: true` — su un cavo con 20 di qua e 30 di la' usciva «VLAN 20, impostata
// a mano», indistinguibile hex per hex dal caso in cui i due capi concordano. Sul
// ferro quel cavo non passa traffico: e' l'unico stato in cui il disegno era
// SICURO e la rete era rotta.
//
// ⭐ «VLAN non dichiarata» NON e' fra gli esiti, perche' non e' uno stato che
// esiste nella commutazione: ogni porta di un bridge ha un PVID e, se nessuno
// l'ha configurato, quel PVID e' 1. Un cavo che commuta e di cui nessuno sa
// niente prende quindi la NATIVA DI SITO (1, o quella che la sede ha dichiarato),
// come ULTIMO gradino: sopra passano tutte le fonti che sanno qualcosa, e la
// provenienza dice che e' un default e non una misura.
//
// ⚠️ Due affermazioni diverse, e non vanno schiacciate in una: STANDARD sono il
// PVID di default 1 (`dot1qPvid`, `DEFVAL { 1 }`, RFC 4363) e il range 1..4094
// (nel YANG che IEEE pubblica per l'802.1Q-2022, `typedef vlanid`). Che la VLAN 1
// «non si cancelli» e' invece un fatto MULTI-VENDOR, non una clausola dello
// standard: EXOS ha la VLAN «Default» con VID 1, Junos di fabbrica mette tutto in
// access sulla default, Aruba usa la 1 untagged.
//
// ⚠️ 'routed' invece resta, ed e' l'unico caso in cui una VLAN davvero non c'e':
// un'interfaccia instradata e' fuori dal dominio di commutazione, e non sta in
// nessuna VLAN — nemmeno nella 1. Non e' «una VLAN che non sappiamo»: e' nessuna
// VLAN. La 1 e' il pavimento del dominio di COMMUTAZIONE, non dell'universo.
// ⭐ Tre prove, su tre vendor, misurate sul banco il 21/08 — e servono tutte e tre,
// perche' chiudono il ragionamento dai due lati. Dove NON si commuta il pavimento
// non c'e': su Cisco un `no switchport` fa allocare allo switch stesso una VLAN
// interna dalla extended range 1006-4094 — si RIFIUTA di usare la 1; e sul MikroTik
// di bordo — zero bridge-port, nessuna tabella VLAN — la VLAN 1 non esiste affatto.
// Dove si commuta invece c'e' davvero: sull'Arista le porte mai configurate
// rispondono PVID 1 e la lista di appartenenza della VLAN 1 contiene ESATTAMENTE
// quelle (5 su 10) — e' un elenco di MEMBRI, non un complemento.
// ⚠️ Qui ce n'era UNA sola, e proprio quella che nomina la CLI di un vendor: chi
// leggeva solo il codice concludeva che il ragionamento fosse tarato su Cisco.
// Non era una prova sbagliata: era un ESTRATTO che aveva perso i due terzi che
// lo rendevano generale.
//
// Niente stato, niente DOM: la glue (`src/app-link-color.js`) raccoglie le
// letture e le passa qui. Questo modulo e' l'UNICO posto dove la domanda ha
// una risposta — prima era calcolata in otto punti che gia' divergevano.
// ============================================================
(function (root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./vlan-authority.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function (auth) {
  'use strict';

  /**
   * Un capo del cavo, gia' letto dalla glue.
   * @typedef {Object} PaintEnd
   * @property {boolean} [active]       il nodo e' ATTIVO (switch/router): puo' comandare sulla VLAN
   * @property {number[]} [deviceVlans] il mondo VLAN MISURATO dell'apparato: decide se ha titolo
   * @property {boolean} [ownsIp]       l'interfaccia possiede un indirizzo IP proprio
   * @property {boolean} [bridges]      l'apparato la dichiara porta del BRIDGE (veto su «instrada»)
   * @property {boolean} [declaredRouted] la porta e' DICHIARATA in modalita' L3 (manual-first)
   * @property {number}  [vlanOvr]      override manuale sulla porta
   * @property {number}  [vlan]         VLAN misurata (SNMP) sulla porta
   * @property {number}  [vlanProp]     VLAN propagata dallo switch a monte
   * @property {number[]} [subIfVlans]  VLAN delle sotto-interfacce AGGANCIATE a questa porta
   * @property {number}  [endpointVlan] VLAN del prefisso DICHIARATO che contiene l'IP del nodo
   * @property {boolean} [singleHomed]  il nodo ha UN SOLO cavo (→ l'IP parla di QUESTO cavo)
   */

  /**
   * Esito: che cosa rappresenta il cavo, e perche'.
   * @typedef {Object} PaintVlan
   * @property {number|null} vlan  VLAN da dipingere (solo se kind === 'vlan')
   * @property {'vlan'|'trunk'|'routed'|'conflict'} kind  gli esiti dichiarati in testa al file.
   *   ⚠️ Questo elenco ne portava TRE mentre la funzione ne rende quattro: `conflict` e' nato
   *   dopo, e il typedef non l'ha seguito. Da li' la svista e' arrivata fino al README, che
   *   annunciava «tre esiti e nient'altro» — un elenco duplicato si buca in silenzio, e chi
   *   documenta legge questa riga, non i `return`.
   * @property {string} source     da dove viene la decisione (vedi SOURCES)
   * @property {boolean} known     scorciatoia per kind === 'vlan'
   * @property {number[]} vlans    tutte le VLAN che il cavo porta (per le pastiglie)
   * @property {number[]} [ends]   solo su 'conflict': le due VLAN in contraddizione, ORDINATE
   * @property {string} [rung]     solo su 'conflict': il gradino su cui si contraddicono
   */

  /** Le provenienze possibili, in ordine di autorevolezza decrescente. */
  const SOURCES = [
    'ovr-routed',     // DICHIARATO «questa porta instrada»: la parola dell'utente, prima di tutto
    'ovr',            // override manuale su porta attiva — manual-first, autorita' massima
    'measured',       // VLAN misurata (SNMP) su porta attiva
    'prop',           // VLAN propagata dallo switch a monte
    'subif',          // sotto-interfaccia dot1Q agganciata alla porta cablata
    'declared-ip',    // prefisso DICHIARATO che contiene l'IP dell'endpoint mono-cablato
    'passive',        // residuo su porta passiva
    'untagged',       // un capo dice «1» ma non commuta VLAN: e' untagged, non «in VLAN 1»
    'site-native',    // PAVIMENTO: nessuno ha assegnato, quindi vale la nativa (1 di default)
    'single-vlan',    // il cavo porta UNA sola VLAN: nessuna ambiguita' da risolvere
    'multi-vlan',     // ne porta piu' d'una: nessuna vince
    'routed',         // ULTIMO: nessuna VLAN si applica perche' il cavo INSTRADA
    'ends-disagree',  // i due capi dicono VLAN diverse allo STESSO gradino: non si arbitra
    'undeclared',     // (storico) nessuna fonte: oggi cade sul pavimento, resta per compatibilita'
  ];

  /** VLAN valida = intero 1..4094. Tutto il resto e' assenza, non zero. */
  function _v(x) {
    const n = parseInt(x, 10);
    return (Number.isFinite(n) && n >= 1 && n <= 4094) ? n : null;
  }

  function _end(e) {
    const o = e || {};
    return {
      active: !!o.active,
      ownsIp: !!o.ownsIp,
      bridges: o.bridges,
      declaredRouted: o.declaredRouted === true,
      vlanOvr: _v(o.vlanOvr),
      vlan: _v(o.vlan),
      vlanProp: _v(o.vlanProp),
      deviceVlans: Array.isArray(o.deviceVlans) ? o.deviceVlans : [],
      subIfVlans: Array.isArray(o.subIfVlans) ? o.subIfVlans.map(_v).filter(Boolean) : [],
      endpointVlan: _v(o.endpointVlan),
      singleHomed: !!o.singleHomed,
    };
  }

  /**
   * Valore CONCORDE fra i due capi: se entrambi dicono qualcosa e dicono cose
   * DIVERSE non si arbitra — si passa oltre. Un capo solo che parla vale.
   */
  function _agree(a, b) {
    if (a && b) return a === b ? a : null;
    return a || b || null;
  }

  /** Unica VLAN fra le sotto-interfacce dei due capi; null se zero o in conflitto. */
  function _subIf(s, d) {
    const all = Array.from(new Set([].concat(s.subIfVlans, d.subIfVlans)));
    return all.length === 1 ? all[0] : null;
  }

  /**
   * ⚠️ `kind` porta l'ELENCO, non `string`: e' l'unico punto dove un esito nuovo entrerebbe
   * senza che nessuno se ne accorga, ed e' gia' successo una volta con `conflict`.
   * @param {number|null} vlan
   * @param {string} source
   * @param {'vlan'|'trunk'|'routed'|'conflict'} kind
   * @param {number[]} vlans
   * @returns {PaintVlan}
   */
  function _out(vlan, source, kind, vlans) {
    return { vlan: kind === 'vlan' ? (vlan || null) : null, kind, source, known: kind === 'vlan', vlans };
  }

  /**
   * I due capi parlano ENTRAMBI, allo stesso gradino, e dicono cose diverse.
   *
   * Non si sceglie e non si scende: scegliere afferma il falso su meta' del cavo,
   * e scendere di gradino finirebbe sul pavimento (la nativa di sito), cioe' su un
   * numero PLAUSIBILE al posto di una contraddizione REALE — la famiglia di difetti
   * da cui e' nato tutto questo modulo. Il cavo resta neutro come un trunk, ma per
   * un motivo suo, e il pannello lo dice a parole.
   *
   * ⚠️ La coppia esce ORDINATA: lo stesso cavo fisico deve leggersi uguale a
   * prescindere da quale capo e' finito in `src` quando e' stato disegnato.
   * @param {number} a @param {number} b
   * @param {string} rung il gradino su cui i due capi si contraddicono ('ovr'|'measured')
   * @param {number[]} vlans
   * @returns {PaintVlan}
   */
  function _contesa(a, b, rung, vlans) {
    const ends = [a, b].sort((x, y) => x - y);
    return { vlan: null, kind: 'conflict', source: 'ends-disagree', known: false, vlans, ends, rung };
  }

  /**
   * Nessuna fonte ha saputo dire la VLAN. Restano due mondi diversi:
   * chi INSTRADA e' fuori dal dominio di commutazione e una VLAN non ce l'ha —
   * e' un fatto, non manca niente; chi COMMUTA una VLAN ce l'ha per forza, e se
   * nessuno ne ha assegnata un'altra e' la nativa. Non e' una lacuna: e' il
   * default che ogni bridge applica per conto suo.
   */
  function _senzaVlan(s, d, vlans, siteNative) {
    if (auth.isRoutedPort(s) || auth.isRoutedPort(d)) return _out(null, 'routed', 'routed', vlans);
    // ⭐ IL PAVIMENTO. Un cavo che COMMUTA sta sempre in una VLAN: ogni porta di
    // un bridge ha un PVID e, se nessuno l'ha configurato, quel PVID e' 1. E' lo
    // standard, non una convenzione di un vendor — la VLAN 1 esiste sempre e non
    // si cancella. Quindi «non dichiarata» non e' uno stato della commutazione:
    // e' la nativa di SITO (1, o quella che la sede ha dichiarato).
    // ⚠️ Sta per ULTIMO: sopra di lui passano tutte le fonti che sanno qualcosa.
    // Un gradino piu' in alto coprirebbe una risposta vera con un numero
    // plausibile — la famiglia di difetti da cui e' nata tutta questa storia.
    return _out(siteNative || 1, 'site-native', 'vlan', vlans);
  }

  /**
   * Che cosa rappresenta questo cavo, e perche'.
   * @param {{mode?:string, native?:number, siteNative?:number, vlans?:number[], src?:PaintEnd, dst?:PaintEnd}} input
   * @returns {PaintVlan}
   */
  function linkPaintVlan(input) {
    const a = input || {};
    const s = _end(a.src), d = _end(a.dst);
    const vlans = Array.isArray(a.vlans) ? a.vlans.map(_v).filter(Boolean) : [];
    const native = _v(a.native);
    const siteNative = _v(a.siteNative) || 1;   // il pavimento: 1 se la sede non ne dichiara un'altra
    const isTrunk = a.mode === 'trunk';

    // 0. DICHIARATO «questa porta instrada». Sta sopra a tutto, override manuale
    //    compreso, e la ragione e' che le due dichiarazioni non parlano della stessa
    //    cosa: `vlanOvr` descrive il PVID di UNA PORTA, «instrada» descrive il CAVO —
    //    dice che quel rame non porta nessuna VLAN. Su un cavo solo, la frase che
    //    parla del cavo decide il cavo. (Sulla stessa porta le due non possono
    //    contraddirsi: scegliere L3 cancella `vlanOvr` — v. setPortMode in
    //    src/app-vlan-autopoll.js. La contraddizione possibile e' fra capi DIVERSI.)
    // ⚠️ NON si guarda sui trunk: un trunk per definizione commuta, e li' il campo
    //    VLAN e' la nativa. Dove la domanda non ha senso non si offre la risposta —
    //    infatti l'interfaccia non propone L3 quando la porta e' in trunk.
    if (!isTrunk && (s.declaredRouted || d.declaredRouted)) return _out(null, 'ovr-routed', 'routed', vlans);

    // 1. Override manuale su capo ATTIVO — manual-first, prima di ogni misura.
    const ovrS = s.active ? s.vlanOvr : null, ovrD = d.active ? d.vlanOvr : null;
    // ⚠️ La contraddizione si guarda SOLO sui cavi access, e per una ragione: su un
    // trunk `vlanOvr` e' la NATIVA, due native diverse hanno gia' il loro nome
    // (`native-mismatch`, lib/cable-validate.js) e il colore del trunk non deve
    // cambiare per questo. Qui il ramo trunk resta identico a prima, riga per riga.
    if (!isTrunk && ovrS && ovrD && ovrS !== ovrD) return _contesa(ovrS, ovrD, 'ovr', vlans);
    const ovr = ovrS || ovrD || null;
    if (ovr) return _out(ovr, 'ovr', 'vlan', vlans);

    // ⚠️ `routed` NON si guarda qui, ma in fondo. Possedere un indirizzo IP e'
    // normale per QUALSIASI host: la NIC di un router o di un controller wireless
    // ce l'ha sempre, e resta un endpoint dentro una VLAN. Misurato sul banco:
    // mettendo questo controllo in cima, il router VyOS e il WLC — che stanno su
    // porte access in VLAN 99 — uscivano «instradati». Il fatto che una porta
    // instradi conta solo quando NESSUNO sa dire la VLAN: li' distingue «non sta
    // in nessuna VLAN» da «non lo sappiamo». Se una VLAN si applica, si applica.

    if (!isTrunk) {
      // ---- CAVO ACCESS: una VLAN sola si applica, quindi si cerca QUALE ----
      // ⚠️ La misura vale se chi la fa ha TITOLO, e il titolo non e' «essere un
      // apparato attivo» ma «commutare VLAN» (`lib/vlan-authority.js`). Un
      // controller o uno switch il cui mondo VLAN e' `[1]` sta dicendo «sono
      // untagged», non «questo cavo e' in VLAN 1»: prendere quel numero per una
      // misura scavalcava la rete DICHIARATA — misurato sul banco, due cavi
      // uscivano 1 su una rete che dice 99. L'override manuale e' gia' stato
      // consumato sopra, quindi qui `authoritativeVlan` cade sulla misura.
      // ⚠️ Due MISURE che si contraddicono sono il caso vero: due switch che
      // pubblicano PVID diversi sulla stessa tratta. Vale solo fra chi ha TITOLO
      // (authoritativeVlan filtra gia' chi dice «1» senza commutare VLAN), quindi
      // uno switch e un PC non litigano mai — il PC non ha voce.
      const measS = auth.authoritativeVlan(s), measD = auth.authoritativeVlan(d);
      if (measS && measD && measS !== measD) return _contesa(measS, measD, 'measured', vlans);
      const meas = measS || measD || null;
      if (meas) return _out(meas, 'measured', 'vlan', vlans);
      const prop = s.vlanProp || d.vlanProp || null;
      if (prop) return _out(prop, 'prop', 'vlan', vlans);
      // Nessuno l'ha misurata: scendono le fonti DICHIARATE.
      const sub = _subIf(s, d);
      if (sub) return _out(sub, 'subif', 'vlan', vlans);
      // L'IP dell'endpoint vale solo se quell'apparato ha UN SOLO cavo: allora
      // il suo indirizzo parla per forza di QUESTO. Con piu' cavi direbbe di uno
      // qualsiasi, e non sapremmo quale.
      const sv = s.singleHomed ? s.endpointVlan : null;
      const dv = d.singleHomed ? d.endpointVlan : null;
      const ip = _agree(sv, dv);
      if (ip) return _out(ip, 'declared-ip', 'vlan', vlans);
      // Residuo su porta PASSIVA — e passiva davvero: un capo ATTIVO ha gia'
      // avuto la sua occasione sopra, e se non l'ha colta e' perche' non aveva
      // titolo. Ripescarlo qui rimetterebbe in gioco proprio l'affermazione che
      // e' stata scartata (il «1» di chi non commuta), un gradino piu' in basso.
      const passive = (!s.active && (s.vlanOvr || s.vlan)) || (!d.active && (d.vlanOvr || d.vlan)) || null;
      if (passive) return _out(passive, 'passive', 'vlan', vlans);
      // ULTIMA fonte, e la piu' debole: un capo attivo dichiara «1» senza avere
      // titolo (non commuta VLAN). Non e' una misura del cavo — dice «io sono
      // untagged» — ma nessun'altra fonte ha parlato, e su una rete piatta la 1
      // e' davvero l'unica VLAN che esiste. Sta QUI, dopo le dichiarazioni,
      // perche' e' proprio contro una rete DICHIARATA che non deve prevalere.
      const untagged = (s.active && s.vlan === 1) || (d.active && d.vlan === 1) ? 1 : null;
      if (untagged) return _out(untagged, 'untagged', 'vlan', vlans);
      return _senzaVlan(s, d, vlans, siteNative);
    }

    // ---- CAVO TRUNK: nessuna delle VLAN che porta vince sulle altre ----
    // ⚠️ La NATIVA conta come tutte le altre, VLAN 1 compresa. Si contavano le
    // VLAN filtrando via la 1, e un trunk con nativa 1 piu' una taggata passava
    // per «ne porta una sola»: ma sul filo ne passano DUE — l'untagged della
    // nativa attraversa lo stesso — e dipingerne una afferma che l'altra non c'e'.
    // Misurato: 3 cavi su 1.171, due uplink di AP (gestione untagged in 1 + SSID
    // taggato in 99) e un server. Il filtro era la pratica («non usare la 1»)
    // scambiata per una descrizione della rete.
    // ⚠️ Limite noto: una VLAN 1 POTATA dal trunk non attraversa davvero e noi la
    // contiamo lo stesso — ma l'errore porta a «neutro», che non afferma niente,
    // invece che a dipingere una VLAN sbagliata.
    if (vlans.length === 1) return _out(vlans[0], 'single-vlan', 'vlan', vlans);
    if (vlans.length === 0) {
      // Elenco vuoto: se la nativa e' nota, quella e' l'unica che puo' passare.
      if (native) return _out(native, 'single-vlan', 'vlan', [native]);
      return _senzaVlan(s, d, vlans, siteNative);
    }
    // Piu' d'una: neutro. Le VLAN si mostrano TUTTE, nessuna diventa il colore.
    return _out(null, 'multi-vlan', 'trunk', vlans);
  }

  return { linkPaintVlan, PAINT_SOURCES: SOURCES };
});
