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
//   'vlan'       una VLAN sola si applica a questo cavo → il suo colore
//   'trunk'      ne porta piu' d'una → neutro, nessuna vince
//   'routed'     il cavo INSTRADA: non sta in nessuna VLAN, nemmeno nella 1
//   'undeclared' commuta, quindi una VLAN ce l'ha di sicuro — non la sappiamo
//
// ⚠️ La differenza fra 'routed' e 'undeclared' non e' una sfumatura: la prima
// e' un FATTO definitivo (una porta di livello 3 non appartiene a una VLAN, e
// la VLAN 1 e' il default dei soli port COMMUTATI), la seconda e' una LACUNA
// nostra, chiudibile dichiarando la VLAN a mano. Confonderle significa non
// sapere quale delle due va segnalata all'utente.
//
// Niente stato, niente DOM: la glue (`src/app-link-color.js`) raccoglie le
// letture e le passa qui. Questo modulo e' l'UNICO posto dove la domanda ha
// una risposta — prima era calcolata in otto punti che gia' divergevano.
// ============================================================
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Un capo del cavo, gia' letto dalla glue.
   * @typedef {Object} PaintEnd
   * @property {boolean} [active]       il nodo e' ATTIVO (switch/router): comanda sulla VLAN
   * @property {boolean} [routed]       l'interfaccia possiede un IP proprio → instrada
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
   * @property {string} kind       'vlan' | 'trunk' | 'routed' | 'undeclared'
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
    'single-vlan',    // il cavo porta UNA sola VLAN: nessuna ambiguita' da risolvere
    'multi-vlan',     // ne porta piu' d'una: nessuna vince
    'routed',         // ULTIMO: nessuna VLAN si applica perche' il cavo INSTRADA
    'undeclared',     // ULTIMO: commuta (quindi una VLAN c'e'), ma nessuno la dichiara
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
      routed: !!o.routed,
      vlanOvr: _v(o.vlanOvr),
      vlan: _v(o.vlan),
      vlanProp: _v(o.vlanProp),
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
   * Nessuna VLAN si applica: resta da dire PERCHE', e i due motivi sono
   * diversi in natura. Se un capo INSTRADA (possiede un indirizzo e non
   * commuta) allora una VLAN non c'e' e non ci sara': e' un fatto, non manca
   * niente. Altrimenti il cavo commuta, quindi una VLAN esiste per forza — la
   * 1 se nessuno ne ha detta un'altra — e non saperla e' una LACUNA nostra,
   * chiudibile dichiarandola. Il primo non si segnala, il secondo si'.
   */
  function _senzaVlan(s, d, vlans) {
    if (s.routed || d.routed) return _out(null, 'routed', 'routed', vlans);
    return _out(null, 'undeclared', 'undeclared', vlans);
  }

  /**
   * Che cosa rappresenta questo cavo, e perche'.
   * @param {{mode?:string, native?:number, vlans?:number[], src?:PaintEnd, dst?:PaintEnd}} input
   * @returns {PaintVlan}
   */
  function linkPaintVlan(input) {
    const a = input || {};
    const s = _end(a.src), d = _end(a.dst);
    const vlans = Array.isArray(a.vlans) ? a.vlans.map(_v).filter(Boolean) : [];
    const tagged = vlans.filter(v => v > 1);
    const native = _v(a.native);
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
      const meas = (s.active && s.vlan) || (d.active && d.vlan) || null;
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
      const passive = s.vlanOvr || d.vlanOvr || s.vlan || d.vlan || null;
      if (passive) return _out(passive, 'passive', 'vlan', vlans);
      return _senzaVlan(s, d, vlans);
    }

    // ---- CAVO TRUNK: nessuna delle VLAN che porta vince sulle altre ----
    // L'unico caso senza ambiguita' e' che ce ne sia UNA sola: allora non si sta
    // scegliendo, si sta constatando.
    if (tagged.length === 1) return _out(tagged[0], 'single-vlan', 'vlan', vlans);
    if (tagged.length === 0) {
      // Nessuna taggata: se la nativa e' nota, quella e' l'unica VLAN che passa.
      if (native) return _out(native, 'single-vlan', 'vlan', vlans);
      return _senzaVlan(s, d, vlans);
    }
    // Piu' d'una: neutro. Le VLAN si mostrano TUTTE, nessuna diventa il colore.
    return _out(null, 'multi-vlan', 'trunk', vlans);
  }

  return { linkPaintVlan, PAINT_SOURCES: SOURCES };
});
