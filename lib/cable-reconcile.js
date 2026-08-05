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

  return { detectMiscabling };
});
