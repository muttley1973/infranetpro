// ============================================================
// LAG RECONCILE — igiene dei cavi-membro LAG (puro, chirurgico)
// ============================================================
// Un LAG (LACP 802.3ad / EtherChannel statico) aggrega piu' link fisici tra DUE
// apparati ATTIVI. Due errori tipici dell'inferenza automatica (LLDP/CDP/FDB):
//   1) marca come "LAG" un cavo che tocca un device PASSIVO o PASS-THROUGH
//      (patch panel, presa a muro, VoIP, media converter): quelli non aggregano,
//      al piu' TRASPORTANO un membro -> il tag LAG e' spurio;
//   2) posa piu' cavi-membro auto sulla STESSA porta attiva (perche' il MAC del
//      LAG appare su piu' porte del bundle) -> una porta attiva finisce con 2 cavi.
//
// Questo modulo corregge SOLO questi due casi, in modo manual-first:
//   - stripLagOnPassive: toglie il tag LAG (non il cavo) ai link con un capo non
//     eleggibile a LAG;
//   - reconcileLagMemberConflicts: quando piu' cavi-membro AUTO si contendono una
//     porta ATTIVA, ne tiene UNO (manuale batte auto; tra auto vince il piu'
//     affidabile: LLDP/CDP > MAC/ARP/FDB). NON tocca cavi non-LAG (segmenti
//     condivisi, es. 2 telecamere su una porta), cavi manuali, ne' porte
//     pass-through (VoIP/patch panel).
//
// Sola logica, niente DOM/IO: il chiamante passa un resolver typeOfPort(pid).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Un TIPO puo' essere capo di un LAG solo se termina l'aggregazione: apparato
  // attivo, NON passivo e NON pass-through.
  function isLagEligibleType(def) {
    return !!(def && !def.isPassive && !def.passThrough);
  }

  function _isLagMember(l) {
    return !!(l && (l.lagLogicalKey || l.lagMemberPair));
  }

  // Trust per la contesa membro-LAG su una porta attiva:
  //   manuale (l'utente l'ha posato) > LLDP/CDP (vicino dichiarato) > MAC/ARP/FDB (inferito).
  function _lagTrust(l) {
    if (!l) return -1;
    if (!l.autoLinked) return 100;
    const pr = String(l.protocol || '').toUpperCase();
    if (pr.includes('LLDP') || pr.includes('CDP')) return 60;
    return 20 + (typeof l.confidence === 'number' ? l.confidence : 0);
  }

  // Rimuove i tag LAG dai link con almeno un capo NON eleggibile. Muta i link in
  // place (toglie SOLO i campi lag*, il cavo resta). Ritorna il numero ripuliti.
  function stripLagOnPassive(links, typeOfPort) {
    let n = 0;
    for (const l of (Array.isArray(links) ? links : [])) {
      if (!l || (!l.lagLogicalKey && !l.lagMemberPair && !Array.isArray(l.lagMembers))) continue;
      if (isLagEligibleType(typeOfPort(l.src)) && isLagEligibleType(typeOfPort(l.dst))) continue;
      delete l.lagLogicalKey; delete l.lagMemberPair; delete l.lagMembers;
      n++;
    }
    return n;
  }

  // Riconcilia i cavi-membro LAG auto in conflitto su una stessa porta ATTIVA.
  // opts.typeOfPort(pid) -> typeDef|null. Ritorna { keep:[link], dropped:[link] }
  // (nuovi array; non muta l'input). Solo cavi-membro AUTO possono essere scartati.
  function reconcileLagMemberConflicts(links, opts) {
    const ls = Array.isArray(links) ? links.slice() : [];
    const typeOfPort = (opts && opts.typeOfPort) || (() => null);
    const eligible = pid => isLagEligibleType(typeOfPort(pid));
    const dropped = new Set();

    // Indicizza i link per porta ATTIVA (le pass-through/passive sono esenti: una
    // presa/patch/VoIP puo' avere piu' connessioni legittime).
    const byPort = new Map();
    for (const l of ls) {
      if (!l || !l.src || !l.dst) continue;
      for (const pid of [l.src, l.dst]) {
        if (!eligible(pid)) continue;
        if (!byPort.has(pid)) byPort.set(pid, []);
        byPort.get(pid).push(l);
      }
    }

    // Pass 1 (manual-first): su una porta attiva con un cavo MANUALE, ogni cavo-
    // membro LAG AUTO che la contende perde.
    for (const arr of byPort.values()) {
      const live = arr.filter(l => !dropped.has(l));
      if (live.length < 2) continue;
      if (!live.some(l => !l.autoLinked)) continue;   // nessun manuale in gioco
      for (const l of live) if (l.autoLinked && _isLagMember(l)) dropped.add(l);
    }
    // Pass 2: tra piu' cavi-membro LAG AUTO ancora vivi sulla stessa porta attiva,
    // tieni il piu' affidabile.
    for (const arr of byPort.values()) {
      const live = arr.filter(l => !dropped.has(l) && l.autoLinked && _isLagMember(l));
      if (live.length < 2) continue;
      live.sort((a, b) => _lagTrust(b) - _lagTrust(a));
      for (let i = 1; i < live.length; i++) dropped.add(live[i]);
    }
    return { keep: ls.filter(l => !dropped.has(l)), dropped: ls.filter(l => dropped.has(l)) };
  }

  // Ricostruisce lagMembers[] per ogni link a partire dai membri SOPRAVVISSUTI dello
  // stesso lagLogicalKey (evita riferimenti a cavi scartati). Muta i link in place.
  function rebuildLagMembers(links, pairSig) {
    const _sig = (typeof pairSig === 'function') ? pairSig : (a, b) => [String(a || ''), String(b || '')].sort().join('||');
    const byKey = Object.create(null);
    for (const l of (Array.isArray(links) ? links : [])) {
      if (!l || !l.lagLogicalKey) continue;
      (byKey[l.lagLogicalKey] ??= new Set()).add(_sig(l.src, l.dst));
    }
    for (const l of (Array.isArray(links) ? links : [])) {
      if (!l || !l.lagLogicalKey) continue;
      l.lagMembers = Array.from(byKey[l.lagLogicalKey] || []);
      if (!l.lagMemberPair) l.lagMemberPair = _sig(l.src, l.dst);
    }
  }

  return { isLagEligibleType, stripLagOnPassive, reconcileLagMemberConflicts, rebuildLagMembers };
});
