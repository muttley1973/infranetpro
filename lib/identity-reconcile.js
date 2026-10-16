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
  // La provenienza di una copia (markFromRead…) vive in lib/field-provenance.js, caricato PRIMA
  // di questo file: qui si usa, non si ridefinisce.
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./field-provenance.js') : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (FP) {
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

  // ── La COPIA nel documento e la sua provenienza ───────────────────────────────
  // Il Sync riempie marca/modello/matricola/firmware VUOTI copiando la lettura nei
  // campi `node.<campo>`, gli stessi in cui scrive una persona. Senza una traccia,
  // dopo la copia «l'ha scritto Tizio» e «l'ha letto l'apparato» sono la stessa cosa,
  // e il segno del pannello (lib/certainty.js) diceva «Scritto da una persona: non
  // invecchia» su un valore che nessuno aveva digitato.
  //
  // `node.copiedFromRead[campo] = true` vuol dire: il valore ATTUALE di quel campo è
  // stato copiato da una lettura e nessuno ci ha scritto sopra da allora. La modifica
  // a mano lo cancella (updateN), e il segno dice «Misurato» solo finché il campo è
  // marcato E coincide ancora con la lettura corrente (`copiedStillRead`): se
  // l'apparato viene sostituito il copiato torna «Dichiarato» e la Verifica accusa.
  // È una MISURA nel senso dell'export: la lettura a cui rimanda nel documento
  // portabile non c'è più, quindi non ci va nemmeno la traccia (lib/project-schema.js).
  // Le primitive sono quelle generiche di lib/field-provenance.js (la regola vale per TUTTI i campi a
  // doppia natura, non solo per queste quattro); i nomi d'identità restano perché li usano già il
  // pannello, la Verifica e i test. «Stesso valore» ha UNA definizione, là.
  const sameIdentityValue = FP.sameReadValue;
  const markCopiedFromRead = FP.markFromRead;
  const forgetCopiedFromRead = FP.forgetFromRead;
  const copiedStillRead = FP.stillFromRead;

  function _filled(v) { return v != null && String(v).trim() !== ''; }

  // ── Il LUCCHETTO: «questo valore l'ho deciso io» ──────────────────────────────
  // Modello, matricola e firmware li confronta la Verifica con quelli letti
  // dall'ENTITY-MIB, e uno scarto diventava «apparato sostituito» a OGNI scansione —
  // anche quando una persona li aveva scritti apposta così (il nome commerciale al
  // posto della sigla dell'MIB, il firmware che ha messo lei). Scrivere a mano il
  // campo chiude il suo lucchetto (src/app.js `updateN`), svuotarlo lo riapre, e chi
  // accusa non confronta un campo bloccato. Il lucchetto dice CHI DECIDE; la marca
  // `copiedFromRead` e il punto del pannello dicono DA DOVE VIENE il valore: due assi,
  // un campo può avere tutte e due (bloccato E confermato dall'apparato).
  // La marca (`brand`) ha il suo `brandManual`, che la lettura rispetta ma la Verifica
  // non confronta, quindi non passa di qui. Una definizione sola: la usano la Verifica,
  // la lente DR della Panoramica e il dossier.
  const IDENTITY_LOCKS = { model: 'modelManual', serialNumber: 'serialNumberManual', firmwareVer: 'firmwareVerManual' };
  // Il nome del lucchetto di un campo, o null se non ne ha uno (nemmeno `constructor`: solo chiavi proprie).
  function identityLockFlag(field) {
    return Object.prototype.hasOwnProperty.call(IDENTITY_LOCKS, field) ? IDENTITY_LOCKS[field] : null;
  }
  function isIdentityLocked(node, field) {
    const k = identityLockFlag(field);
    return !!(k && node && typeof node === 'object' && node[k]);
  }

  // Riempie i campi d'identità VUOTI del nodo dalla lettura e ne registra la
  // provenienza. Manual-first, come sempre: un campo già pieno non si tocca, né uno
  // bloccato. La marca ha le sue regole (non si riscrive con `brandManual`, e la marca
  // di DEFAULT del catalogo è un'ipotesi che la lettura può sostituire). Ritorna i
  // campi scritti.
  function fillIdentityFromRead(node, inv, defBrand) {
    const written = [];
    const o = _obj(inv);
    if (!o || !node || typeof node !== 'object') return written;
    const brandNow = String(node.brand == null ? '' : node.brand).trim();
    const canFillBrand = !node.brandManual && (!brandNow || brandNow === String(defBrand == null ? '' : defBrand).trim());
    for (const f of IDENTITY_FIELDS) {
      if (f === 'brand') {
        // La marca può SOSTITUIRE il default del catalogo (un'ipotesi), non solo riempire un vuoto.
        if (canFillBrand && _filled(o.brand)) { node.brand = o.brand; FP.markFromRead(node, 'brand'); written.push('brand'); }
      } else if (FP.fillFromRead(node, f, o[f], !isIdentityLocked(node, f))) {
        written.push(f);
      }
      // Il campo c'era gia' e l'apparato dice la stessa cosa: confermato, quindi misurato (e guarisce il dato
      // copiato da una versione che non teneva la provenienza). Non e' una scrittura: non entra in `written`.
      if (!written.includes(f)) FP.confirmFromRead(node, f, o[f]);
    }
    return written;
  }

  // «Adotta» dalla Verifica: l'utente conferma che l'apparato è stato sostituito e
  // chiede di allineare il documento alla misura. È una copia dalla lettura a tutti
  // gli effetti — e una decisione esplicita, ma il VALORE resta quello letto.
  // Un campo BLOCCATO non si adotta: la riga del pannello può essere più vecchia del
  // lucchetto, e chi ha deciso un valore lo sblocca prima di farselo riscrivere.
  const ADOPTABLE = ['serialNumber', 'model', 'firmwareVer'];
  function adoptIdentityFromRead(node, patch) {
    const p = _obj(patch);
    if (!p || !node || typeof node !== 'object') return;
    for (const f of ADOPTABLE) {
      if (p[f] == null || isIdentityLocked(node, f)) continue;
      node[f] = p[f];
      if (_filled(p[f])) markCopiedFromRead(node, f); else forgetCopiedFromRead(node, f);
    }
  }

  return {
    IDENTITY_FIELDS, IDENTITY_LOCKS, identityLockFlag, isIdentityLocked, hasIdentity, isConfirmedMeasure, reconcileInventory,
    sameIdentityValue, markCopiedFromRead, forgetCopiedFromRead, copiedStillRead,
    fillIdentityFromRead, adoptIdentityFromRead,
  };
});
