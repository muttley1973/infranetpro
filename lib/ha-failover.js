// ============================================================
// HA FAILOVER — la lettura fatta a questo indirizzo e' di un'ALTRA unita' dello stesso gruppo? (puro)
// ============================================================
// Dopo un failover l'indirizzo del cluster risponde con l'altra unita': i suoi vicini LLDP, la sua FDB e la sua
// ARP sono dell'altra unita', non del nodo che il documento tiene su quell'indirizzo. Credere a quella lettura
// per quel nodo disegnava un SECONDO cavo sulla stessa porta (visto sul banco il 03/11 e il 15/11/2026: il
// cavo del firewall B verso la porta dello switch dove e' attaccato il firewall A).
//
// Qui si decide SOLO se la lettura e' di un'altra unita' — con la stessa regola che la Verifica usa per dire
// «failover» e non «apparato sostituito» (`explainSerialMismatch`, lib/ha-pair.js: una definizione sola) — e
// solo quando e' dimostrato:
//   · la misura d'identita' e' RICONFERMATA dall'ultimo poll (una misura vecchia non decide);
//   · la serie documentata non e' BLOCCATA dall'utente (il lucchetto dice «non contestarla»);
//   · la serie che risponde e' quella di un membro dello stesso cluster, letto dal dispositivo o dichiarato.
// Un apparato SOSTITUITO (una serie che nessun compagno ha) NON e' un'altra unita' del gruppo: la sua lettura
// resta del nodo, che e' quello che l'utente puo' decidere di aggiornare. Cosa farne sta nel glue dell'auto-link.
(function (root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./ha-pair.js') : root,
    typeof module !== 'undefined' && module.exports ? require('./identity-reconcile.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (haApi, idApi) {
  'use strict';

  /**
   * `node`  = il nodo che il documento tiene su quell'indirizzo (con `integration.inventory` e, se letto,
   *           `integration.cluster`); `nodes` = tutti i nodi (per i compagni dichiarati);
   * `labelOf(n)` = nome da mostrare (facoltativo); `fresh` = { inventory, cluster } della lettura appena arrivata.
   * → la spiegazione (`{source, docName?, realName?, …}`) se la lettura e' di un'altra unita', altrimenti null.
   */
  function answeredByHaPartner(node, nodes, labelOf, fresh) {
    if (!node || typeof node !== 'object') return null;
    const integ = node.integration || {};
    // `fresh` = { inventory, cluster } della lettura APPENA arrivata, non ancora scritta sul nodo: chi decide
    // cosa scrivere (applyPollResult) deve chiederlo su quella, non sulla misura del giro prima. Se c'e', vale
    // da sola: una lettura senza identita' non decide (e non ci si ricade sulla misura vecchia).
    const inv = fresh && fresh.inventory !== undefined ? fresh.inventory : integ.inventory;
    const cluster = fresh && fresh.cluster ? fresh.cluster : integ.cluster;
    if (!inv || !idApi.isConfirmedMeasure(inv)) return null;
    if (idApi.isIdentityLocked(node, 'serialNumber')) return null;
    const declared = String(node.serialNumber == null ? '' : node.serialNumber).trim();
    const measured = String(inv.serialNumber == null ? '' : inv.serialNumber).trim();
    if (!declared || !measured) return null;
    const label = typeof labelOf === 'function' ? labelOf : (n => (n && (n.name || n.id)) || '');
    return haApi.explainSerialMismatch({
      declared, measured,
      cluster,
      partners: haApi.getDeclaredPartnerSerials(nodes, node, label),
      docLabel: label(node),
    });
  }

  return { answeredByHaPartner };
});
