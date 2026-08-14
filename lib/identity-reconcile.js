// ============================================================
// IDENTITY RECONCILE — l'identità hardware MISURATA e la sua età (puro)
// ============================================================
// `node.integration.inventory` è quello che l'ENTITY-MIB ha DETTO dell'apparato:
// marca, modello, matricola, firmware. È una MISURA, non una dichiarazione — e
// come ogni misura ha un'età, che finora nessuno teneva.
//
// Il campo aveva due stati soli («c'è» / «non c'è») e veniva riscritto a ogni
// poll con quello che arrivava, `null` compreso. Due danni opposti:
//   • una lettura che non porta identità (walk ENTITY-MIB troncata, agente che
//     l'ENTITY-MIB non ce l'ha) CANCELLAVA una misura buona presa mesi prima;
//   • al contrario, l'identità che sopravviveva non aveva data: a valle veniva
//     confrontata col dichiarato come se fosse appena letta, e da lì usciva
//     «apparato sostituito» — un'ACCUSA costruita su una misura vecchia.
// Gemello concettuale di lib/ports-reconcile.js (mai ridurre su walk parziale) e
// della guardia SNMP-M2 sull'ifOperStatus: assente non vuol dire contraddetto.
//
// Tre stati, non due:
//   1. RICONFERMATA  — questo poll l'ha misurata: `measuredAt` = ora, niente `stale`.
//   2. ULTIMO NOTO   — il poll è riuscito ma non ha portato identità: si TIENE la
//                      misura precedente con `stale: true` e la sua `measuredAt`
//                      originale. Sapere resta sapere; quello che si perde è il
//                      diritto di accusare.
//   3. NON RISULTA   — mai misurata: `null`.
//
// Chi ACCUSA (identity-drift nella Verifica, lente DR della Panoramica, capitolo
// ripristino del dossier) deve chiedere `isConfirmedMeasure`. Chi INFORMA (il
// modello da ricomprare, il firmware da riflashare, il pannello Proprietà) usa il
// valore comunque: per rimettere in piedi un apparato l'ultimo modello noto vale
// più del nulla, purché sia detto che è l'ultimo noto.
//
// Puro: nessun DOM, nessun IO, nessun accesso a store/window.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // I campi che DICONO CHI È l'apparato. `source`, `entities`, `entityIndex` e
  // compagnia descrivono da dove viene la lettura, non che cosa ha letto.
  const IDENTITY_FIELDS = ['brand', 'model', 'serialNumber', 'firmwareVer'];

  function _obj(x) { return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null; }

  // Un oggetto inventory che non valorizza NESSUNO dei campi d'identità non è una
  // misura d'identità: è un guscio (può capitare quando l'unica riga ENTITY-MIB
  // sopravvissuta porta solo un asset tag). Trattarlo come misura rimetterebbe in
  // scena il bug di partenza — una lettura vuota che cancella una buona.
  function hasIdentity(inv) {
    const o = _obj(inv);
    if (!o) return false;
    return IDENTITY_FIELDS.some(k => String(o[k] == null ? '' : o[k]).trim() !== '');
  }

  // Questa misura può portare peso? (= l'ultimo poll riuscito l'ha riconfermata)
  // Una misura non riconfermata si mostra, si stampa, si usa per ricomprare
  // l'apparato — ma non accusa nessuno di averlo sostituito.
  function isConfirmedMeasure(inv) {
    return hasIdentity(inv) && _obj(inv).stale !== true;
  }

  // Riconcilia la misura d'identità dopo un poll RIUSCITO.
  //   prev  : node.integration.inventory attuale (o null/undefined)
  //   fresh : l'inventory appena letto dal driver (o null: niente identità)
  //   at    : timestamp ISO di questo poll (facoltativo)
  // → il nuovo valore da assegnare (oggetto o null). Mai chiamata su poll FALLITO:
  //   lì non si è misurato né smentito nulla, e il campo non si tocca.
  function reconcileInventory(prev, fresh, at) {
    if (hasIdentity(fresh)) {
      const out = Object.assign({}, _obj(fresh));
      delete out.stale;                      // una misura fresca non è mai «ultimo noto»
      if (at) out.measuredAt = String(at);
      return out;
    }
    const p = _obj(prev);
    if (!hasIdentity(p)) return null;        // non c'era nulla e nulla è arrivato
    if (p.stale === true) return p;          // già degradata: nessun cambio, nessun churn
    return Object.assign({}, p, { stale: true });
  }

  return { IDENTITY_FIELDS, hasIdentity, isConfirmedMeasure, reconcileInventory };
});
