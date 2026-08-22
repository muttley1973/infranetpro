// ============================================================
// LAG AUDIT — coerenza dei membri di un gruppo LAG (report puro)
// ============================================================
// Su un LAG (EtherChannel/bond) reale i link membri devono essere OMOGENEI:
// stessa velocità e stessa config di VLAN/nativa. Membri incoerenti NON
// aggregano sul ferro (LACP li scarta / il bundle resta a un solo link).
// InfraNet ha i dati (velocità e VLAN effettiva per porta) ma finora non
// avvisava: questa funzione pura li confronta e segnala i disallineamenti.
//
// Sola lettura, niente DOM/stato: input espliciti → output. Manual-first:
// non muta nulla, non deduce LACP active/passive (non modellato) — verifica
// solo la coerenza di ciò che l'utente ha già documentato.
//
// INPUT members = [ { num, speed, vlan } ]
//   speed → Mbps della porta (speedOvr ?? speed), null/undefined se ignota
//   vlan  → VLAN access/nativa effettiva della porta (_effPortVlan), null se ignota
// OUTPUT {
//   speedMismatch, vlanMismatch,   // true se >1 valore DISTINTO noto
//   speeds: [Mbps distinti, crescenti], vlans: [VID distinti, crescenti],
// }
//
// `checkLagMembers` guarda COM'E' fatto ogni membro; `checkLagPlacement` guarda
// DOVE stanno e QUANTI sono — le due domande che restavano scoperte:
//   - un bundle con UN SOLO membro non aggrega niente: o la seconda porta non e'
//     ancora stata messa, o un membro e' caduto fuori dal bundle;
//   - membri su PIU' APPARATI funzionano solo se quegli apparati sono un unico
//     switch logico (stack, o MLAG/vPC/MC-LAG/IRF a seconda del vendor). Se non
//     lo sono, LACP non forma niente e mezzo uplink e' spento.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Numero "noto" e significativo, altrimenti null (= ignoto, escluso dal confronto).
  // 0 e i negativi NON sono valori reali: una velocità 0 significa porta DOWN /
  // ifSpeed non riportato, non "0 Mbps"; contarla darebbe un falso «velocità
  // eterogenee 0M, 1G». Stessa scelta di lib/hw-capabilities.js (_speedToMbps > 0).
  function _num(v) {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function checkLagMembers(members) {
    const list = Array.isArray(members) ? members : [];
    const speeds = [];
    const vlans = [];
    for (const m of list) {
      const s = _num(m && m.speed);
      if (s != null && !speeds.includes(s)) speeds.push(s);
      const v = _num(m && m.vlan);
      if (v != null && !vlans.includes(v)) vlans.push(v);
    }
    speeds.sort((a, b) => a - b);
    vlans.sort((a, b) => a - b);
    return {
      speedMismatch: speeds.length > 1,
      vlanMismatch: vlans.length > 1,
      speeds,
      vlans,
    };
  }

  /**
   * Dove stanno i membri, e quanti sono.
   *
   * @param {Array<{nodeId?:string}>} members i membri del bundle, con l'apparato
   *        che li ospita. Serve la lista COMPLETA del gruppo, non quella di un
   *        singolo apparato: e' proprio l'attraversamento che si vuole vedere.
   * @param {{oneChassis?:boolean|null}} [opts] `oneChassis` risponde alla domanda
   *        «quegli apparati sono un solo switch logico?» — true (stack o MLAG
   *        dichiarati), false (no), null/assente = non si sa.
   *
   * ⚠️ La risposta la da' il CHIAMANTE e non questa funzione, perche' «essere un
   * solo switch logico» e' gia' definito altrove (lib/stack.js,
   * `getLagCrossMemberInfo`) e due definizioni della stessa cosa divergono. Qui
   * si compone soltanto.
   *
   * ⚠️ E se non si sa, non si accusa: `crossChassis` resta false e `chassisUnknown`
   * dice perche'. Un LAG su due apparati POTREBBE essere un MLAG legittimo — e su
   * un core lo e' quasi sempre — quindi il silenzio e' l'unica risposta onesta
   * quando manca il dato, ma va detto che e' silenzio e non assoluzione.
   */
  function checkLagPlacement(members, opts) {
    const list = Array.isArray(members) ? members : [];
    const o = opts || {};
    const nodes = [];
    for (const m of list) {
      const id = (m && m.nodeId != null) ? String(m.nodeId) : '';
      if (id && !nodes.includes(id)) nodes.push(id);
    }
    const count = list.length;
    const crossDevice = nodes.length > 1;
    const noto = o.oneChassis === true || o.oneChassis === false;
    return {
      count,
      nodes,
      // Zero membri non e' un gruppo: e' un residuo, e non si segnala come «uno solo».
      singleMember: count === 1,
      crossDevice,
      crossChassis: crossDevice && o.oneChassis === false,
      chassisUnknown: crossDevice && !noto,
    };
  }

  // Coerenza CROSS-END di un LAG: confronta la modalita LACP dei due estremi.
  // a, b = 'active' | 'passive' | 'static' (qualunque altro/assente -> ignorato:
  // serve conoscere ENTRAMBI i lati per giudicare). Due fallimenti classici sul
  // ferro:
  //   - passivo + passivo         -> nessun lato inizia la negoziazione LACP,
  //                                  il bundle non si forma.
  //   - LACP (active/passive) vs statico (mode on) -> protocolli incompatibili,
  //                                  il lato LACP non riceve risposta.
  // Vanno bene: active+active, active+passive (uno inizia), statico+statico
  // (bundle statico, nessuna negoziazione). OUTPUT { issue } oppure null.
  function checkLagPair(a, b) {
    const norm = (v) => (v === 'active' || v === 'passive' || v === 'static') ? v : null;
    const x = norm(a), y = norm(b);
    if (!x || !y) return null;                       // serve conoscere entrambi i lati
    if (x === 'passive' && y === 'passive') return { issue: 'both-passive' };
    if ((x === 'static') !== (y === 'static')) return { issue: 'lacp-vs-static' };
    return null;
  }

  return { checkLagMembers, checkLagPlacement, checkLagPair };
});
