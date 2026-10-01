// ============================================================
// DIRECT CONNECTION THEOREM — quali switch sono collegati DIRETTAMENTE, dalle MAC table (UMD-lite)
// ============================================================
// Estratto da src/app-autolink.js (livello 5 di `_autoDiscoverLinks`), senza cambiarne la
// logica: prima viveva nel glue del frontend, dentro una funzione di mille righe che muta lo
// stato del progetto, e si poteva provare solo facendo girare tutto. Qui è una funzione pura
// su dati semplici; il glue la chiama nello stesso punto e ne fa dei candidati.
//
// Riferimento: Lowekamp et al., «Topology Discovery for Large Ethernet Networks», SIGCOMM 2001.
//
// Teorema: le porte x (su switch A) e y (su switch B) sono DIRETTAMENTE connesse se gli
// insiemi di MAC appresi dietro x e dietro y sono complementari — cioè non condividono alcun
// MAC, oltre ai MAC degli switch stessi. Se un terzo switch C fosse in mezzo, il suo MAC (e
// quelli dei suoi host) comparirebbe dietro entrambe le porte → intersezione non vuota →
// scartato. Funziona anche SENZA LLDP/CDP (caso tipico dei lab tipo PNETLab).
//
// Cosa serve per decidere una coppia: i MAC dei DUE switch (ifPhysAddress delle loro porte)
// e la FDB di entrambi. Uno switch di cui non si conoscono i MAC non entra nel confronto,
// e non impedisce agli altri di entrarci.
//
// ⚠️ Ingresso implicito, da sapere: `fdbCache` è la cache di sessione di TUTTI gli switch già
// interrogati, non solo di quelli di questo giro — una coppia può nascere con la tabella di
// uno switch letta in un Sync precedente. L'ordine delle coppie segue l'ordine delle chiavi
// di `fdbCache` (i<j), e conta: l'insieme dei candidati tiene il PRIMO a parità di confidenza.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @param {Object<string, {nodeId: string}>} macMap
   *        MAC (minuscolo) → proprietario: i MAC delle porte dei nodi del progetto.
   * @param {Object<string, Object<string, string>>} fdbCache
   *        id dello switch → { MAC → ifName della porta su cui è appreso }.
   * @returns {{a: string, b: string, ifA: string, ifB: string}[]}
   *          Coppie di switch collegati direttamente, con l'ifName della porta su ciascuno.
   */
  function directConnectionPairs(macMap, fdbCache) {
    // MAC di ogni nodo (dalle porte SNMP importate)
    const nodeMacs = {};
    for (const [mac, e] of Object.entries(macMap)) {
      (nodeMacs[e.nodeId] ??= new Set()).add(mac);
    }
    // Per ogni switch con FDB: ifName -> Set(MAC) appresi su quella porta
    const portMacs = {};
    for (const [swId, fdb] of Object.entries(fdbCache)) {
      const pm = portMacs[swId] = {};
      for (const [mac, ifn] of Object.entries(fdb)) {
        (pm[ifn] ??= new Set()).add(String(mac).toLowerCase());
      }
    }
    const pairs = [];
    const swIds = Object.keys(portMacs);
    for (let i = 0; i < swIds.length; i++) {
      for (let j = i + 1; j < swIds.length; j++) {
        const A = swIds[i], B = swIds[j];
        const macsA = nodeMacs[A], macsB = nodeMacs[B];
        if (!macsA?.size || !macsB?.size) continue; // servono i MAC dei due switch
        // porta x di A che "vede" un MAC di B, e porta y di B che vede un MAC di A
        const findPort = (pm, macs) => {
          for (const [ifn, set] of Object.entries(pm)) if ([...macs].some(m => set.has(m))) return ifn;
          return null;
        };
        const portX = findPort(portMacs[A], macsB);
        const portY = findPort(portMacs[B], macsA);
        if (!portX || !portY) continue;
        // Complementarità: nessun MAC comune dietro le due porte, esclusi i MAC degli
        // switch A e B stessi → garantisce assenza di switch in mezzo.
        const exclude = new Set([...macsA, ...macsB]);
        const Fby = portMacs[B][portY];
        const overlap = [...portMacs[A][portX]].some(m => !exclude.has(m) && Fby.has(m));
        if (overlap) continue;
        pairs.push({ a: A, b: B, ifA: portX, ifB: portY });
      }
    }
    return pairs;
  }

  return { directConnectionPairs };
});
