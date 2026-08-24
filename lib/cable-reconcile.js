// ============================================================
// CABLE RECONCILE — miscablaggio per-porta (vicino osservato ≠ cavo dichiarato)
// (UMD-lite, browser + Node · puro · zero-dip · vendor-neutral)
// ============================================================
// Confronta il VICINO osservato (LLDP/CDP) su una porta col capo DICHIARATO del
// cavo. Un cavo la cui porta annuncia un ALTRO apparato NOTO è contraddetto dalla
// realtà → miscablaggio: per un cavo MANUALE diventa 'declared-review' (la realtà
// contraddice QUESTO cavo, non solo l'estremo); per un DEDOTTO è evidenza che
// contraddice l'inferenza. È il `declared-review` "vero" dello spec Proof-State,
// oltre al drift di IP/identità del nodo.
//
// Onestà (nessun falso positivo — gli stessi paletti del resto del progetto):
//   * SILENZIO ≠ contraddizione: porta senza vicino annunciato → niente;
//   * vicino non risolto a un nodo NOTO → skip (potrebbe essere lo stesso, mal-risolto);
//   * si confronta SOLO quando il capo dichiarato è un apparato ATTIVO (parla LLDP):
//     verso un PASSIVO (patch panel / presa a muro) l'LLDP TRANSITA e vede il device
//     a valle — non è un miscablaggio del segmento passivo, è la catena documentata;
//   * porta con più vicini DISTINTI (LAG/hub) → la glue la esclude a monte (ambigua);
//   * i link WIRELESS non hanno vicino LLDP di cavo → esclusi.
//
// Puro: il chiamante (glue) risolve i vicini a nodeId e passa mappe piatte; qui solo
// il confronto. Spec: _local/notes/InfraNetPro_Spec_ProofStateUnificato_20260804.md
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // detectMiscabling(links, observedByPort, ownerByPort, activeNodes)
  //   observedByPort[pid] = id del nodo NOTO visto come vicino su quella porta (o assente)
  //   ownerByPort[pid]    = id del nodo che POSSIEDE quella porta
  //   activeNodes         = Set (o oggetto) degli id dei nodi ATTIVI (LLDP/CDP-capaci)
  // → { [linkId]: { end, observed, declared } }   (solo i cavi contraddetti)
  function detectMiscabling(links, observedByPort, ownerByPort, activeNodes) {
    const out = {};
    observedByPort = observedByPort || {};
    ownerByPort = ownerByPort || {};
    const isActive = (id) => !!(id != null && activeNodes &&
      (typeof activeNodes.has === 'function' ? activeNodes.has(id) : activeNodes[id]));
    for (const l of (links || [])) {
      if (!l || l.id == null || !l.src || !l.dst || l.wireless) continue;
      const declSrc = ownerByPort[l.src], declDst = ownerByPort[l.dst];
      const obsOnSrc = observedByPort[l.src], obsOnDst = observedByPort[l.dst];
      // La porta src vede un nodo noto DIVERSO dal capo dichiarato dst (dst ATTIVO).
      if (obsOnSrc && declDst && isActive(declDst) && obsOnSrc !== declDst) {
        out[l.id] = { end: l.src, observed: obsOnSrc, declared: declDst };
      // Simmetrico: la porta dst vede un nodo noto diverso dal capo dichiarato src.
      } else if (obsOnDst && declSrc && isActive(declSrc) && obsOnDst !== declSrc) {
        out[l.id] = { end: l.dst, observed: obsOnDst, declared: declSrc };
      }
    }
    return out;
  }

  // detectPortConflicts(links, ownerByPort, passThroughNodes)
  //   ownerByPort[pid]  = id del nodo che POSSIEDE la porta
  //   passThroughNodes  = Set/oggetto degli id dei nodi PASSANTI (patch panel, presa
  //                       a muro, telefono VoIP, media converter): su di loro il rame
  //                       CONTINUA, quindi due cavi sulla stessa porta sono la CATENA,
  //                       non un conflitto — esenti.
  // Una porta fisica (di un apparato NON passante) termina UN cavo solo: se ≥2 cavi
  // non-wireless la citano, è un conflitto strutturale — il segnale a MONTE del
  // miscablaggio, e non serve alcuna misura per vederlo.
  // → { [portId]: [linkId, …] }   (solo le porte in conflitto)
  function detectPortConflicts(links, ownerByPort, passThroughNodes) {
    ownerByPort = ownerByPort || {};
    const isPass = (id) => !!(id != null && passThroughNodes &&
      (typeof passThroughNodes.has === 'function' ? passThroughNodes.has(id) : passThroughNodes[id]));
    const tally = {};
    for (const l of (links || [])) {
      if (!l || l.id == null || !l.src || !l.dst || l.wireless) continue;
      for (const pid of [l.src, l.dst]) {
        if (isPass(ownerByPort[pid])) continue;          // porta passante → esente
        (tally[pid] || (tally[pid] = [])).push(l.id);
      }
    }
    const out = {};
    for (const pid in tally) {
      const ids = [...new Set(tally[pid])];              // un self-loop cita 2 volte: dedup
      if (ids.length >= 2) out[pid] = ids;
    }
    return out;
  }

  // miscabledLabels(observed, declared, infoOf) — le due etichette del messaggio di
  // miscablaggio, DISAMBIGUATE quando i due capi hanno lo stesso nome (omonimia): il
  // confronto a monte è per ID, ma il nome può collidere e rendere «annuncia X, non X».
  // infoOf(id) → { name, ip, type } (o null). Ripiego a scalare: IP → tipo → id.
  function miscabledLabels(observed, declared, infoOf) {
    const of = typeof infoOf === 'function' ? infoOf : function () { return null; };
    const o = of(observed) || {}, d = of(declared) || {};
    let obs = o.name || String(observed == null ? '' : observed);
    let decl = d.name || String(declared == null ? '' : declared);
    if (obs === decl) {
      if (o.ip && d.ip && o.ip !== d.ip) { obs += ' (' + o.ip + ')'; decl += ' (' + d.ip + ')'; }
      else if (o.type && d.type && o.type !== d.type) { obs += ' (' + o.type + ')'; decl += ' (' + d.type + ')'; }
      else if (observed !== declared) { obs += ' #' + observed; decl += ' #' + declared; }
    }
    return { obs: obs, decl: decl };
  }

  return { detectMiscabling, detectPortConflicts, miscabledLabels };
});
