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
// Tre esiti, e ognuno dice una cosa sola:
//   'vlan'   una VLAN sola si applica a questo cavo → il suo colore
//   'trunk'  ne porta piu' d'una → neutro, nessuna vince
//   'routed' il cavo INSTRADA: non sta in nessuna VLAN, nemmeno nella 1
//
// ⭐ «VLAN non dichiarata» NON e' fra gli esiti, perche' non e' uno stato che
// esiste nella commutazione: ogni porta di un bridge ha un PVID e, se nessuno
// l'ha configurato, quel PVID e' 1. E' lo standard 802.1Q, non la convenzione di
// un vendor — la VLAN 1 esiste sempre e non si cancella. Un cavo che commuta e
// di cui nessuno sa niente prende quindi la NATIVA DI SITO (1, o quella che la
// sede ha dichiarato), come ULTIMO gradino: sopra passano tutte le fonti che
// sanno qualcosa, e la provenienza dice che e' un default e non una misura.
//
// ⚠️ 'routed' invece resta, ed e' l'unico caso in cui una VLAN davvero non c'e':
// `no switchport` piu' un indirizzo toglie l'interfaccia dal dominio di
// commutazione. Non e' «una VLAN che non sappiamo»: e' nessuna VLAN. Prova
// vendor-neutral: quando fai `no switchport`, lo switch stesso si alloca una
// VLAN interna dalla extended range (1006-4094) — si rifiuta di usare la 1.
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
   * @property {string} kind       'vlan' | 'trunk' | 'routed'
   * @property {string} source     da dove viene la decisione (vedi SOURCES)
   * @property {boolean} known     scorciatoia per kind === 'vlan'
   * @property {number[]} vlans    tutte le VLAN che il cavo porta (per le pastiglie)
   */

  /** Le provenienze possibili, in ordine di autorevolezza decrescente. */
  const SOURCES = [
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

  function _out(vlan, source, kind, vlans) {
    return { vlan: kind === 'vlan' ? (vlan || null) : null, kind, source, known: kind === 'vlan', vlans };
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
    const tagged = vlans.filter(v => v > 1);
    const native = _v(a.native);
    const siteNative = _v(a.siteNative) || 1;   // il pavimento: 1 se la sede non ne dichiara un'altra
    const isTrunk = a.mode === 'trunk';

    // 1. Override manuale su capo ATTIVO — manual-first, prima di ogni misura.
    const ovr = (s.active && s.vlanOvr) || (d.active && d.vlanOvr) || null;
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
      const meas = auth.authoritativeVlan(s) || auth.authoritativeVlan(d) || null;
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
    // L'unico caso senza ambiguita' e' che ce ne sia UNA sola: allora non si sta
    // scegliendo, si sta constatando.
    if (tagged.length === 1) return _out(tagged[0], 'single-vlan', 'vlan', vlans);
    if (tagged.length === 0) {
      // Nessuna taggata: se la nativa e' nota, quella e' l'unica VLAN che passa.
      if (native) return _out(native, 'single-vlan', 'vlan', vlans);
      return _senzaVlan(s, d, vlans, siteNative);
    }
    // Piu' d'una: neutro. Le VLAN si mostrano TUTTE, nessuna diventa il colore.
    return _out(null, 'multi-vlan', 'trunk', vlans);
  }

  return { linkPaintVlan, PAINT_SOURCES: SOURCES };
});
