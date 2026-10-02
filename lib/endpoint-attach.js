// ============================================================
// ENDPOINT SU FDB — cosa fare di un endpoint foglia dopo che il risolutore ha guardato le FDB
// ============================================================
// Estratto da src/app-autolink.js (livello 4 di `_autoDiscoverLinks`), senza cambiarne la
// logica: il ciclo mescolava la DECISIONE (manuale? porta giusta? cavo da potare?) con gli
// EFFETTI (contare i motivi, proporre il candidato, riassegnare `store.state.links`). Qui resta
// solo la decisione, pura; gli effetti restano nel glue, che li applica nello stesso punto.
//
// Il livello 4 prende ogni endpoint foglia (PC, stampante, UPS…) con un MAC noto. Dato il cavo
// che oggi tocca la porta dell'endpoint (`ex`, il primo della lista, o niente) e il risolutore
// `resolve` (`_resolveEndpointSwitchPort`, che legge le FDB e lo stato del progetto):
//   · cavo MANUALE → 'keep-manual'. Il risolutore NON viene interpellato: un cavo scritto da
//     una persona non si discute con la FDB.
//   · porta giusta → 'propose': cavo `MAC`, con la confidenza che il risolutore ha graduato.
//   · porta sbagliata → 'reject' col MOTIVO; e `prune` è true se il motivo dice «questo
//     endpoint non sta su QUESTA porta» (porta uplink, porta di transito) e il cavo che c'è è
//     un auto-link nato da un MAC (MAC, ARP-MAC, MAC+ARP). Un cavo LLDP, o MAC-WALLPORT (passa
//     per una presa a muro), non è una lettura di FDB e la FDB non lo contraddice. Gli altri
//     motivi (MAC assente, porta sconosciuta, ambiguità) non potano: manca l'evidenza, non è
//     che la porta sia sbagliata.
//
// ⚠️ `resolve` è una funzione, non un valore, di proposito: va chiamata SOLO se il cavo non è
// manuale, e va chiamata DOPO che il giro precedente ha potato — il risolutore rilegge i cavi
// del progetto (`_isTransitPort`), quindi la potatura di un endpoint cambia ciò che vede il
// successivo, e l'ordine dei nodi fa parte del risultato (test/autolink-endpoint-attach.test.js,
// caso ⑫). Chi chiama deve applicare la potatura PRIMA di passare al nodo dopo.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @param {{autoLinked?: boolean, protocol?: string}|undefined} ex
   *        Il cavo che tocca la porta dell'endpoint (il primo della lista), o undefined.
   * @param {() => {ok: boolean, swPid?: string, confidence?: number, reason?: string}} resolve
   *        Il risolutore: chiamato al più una volta, e mai se `ex` è un cavo manuale.
   * @returns {{action: 'keep-manual'}
   *         | {action: 'propose', swPid: string, confidence: number, protocol: 'MAC'}
   *         | {action: 'reject', reason: (string|undefined), prune: boolean}}
   */
  function endpointAttachDecision(ex, resolve) {
    if (ex && !ex.autoLinked) return { action: 'keep-manual' };
    const res = resolve();
    if (res.ok) return { action: 'propose', swPid: res.swPid, confidence: res.confidence, protocol: 'MAC' };
    const prune = !!((res.reason === 'port-uplink' || res.reason === 'port-trunk') && ex?.autoLinked && (ex.protocol === 'MAC' || ex.protocol === 'ARP-MAC' || ex.protocol === 'MAC+ARP'));
    return { action: 'reject', reason: res.reason, prune };
  }

  return { endpointAttachDecision };
});
