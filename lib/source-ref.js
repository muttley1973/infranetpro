// IL RIFERIMENTO ALL'OGGETTO D'ORIGINE — «questo, di qua, è quello, di là»
//
// Un documento importato da un DCIM contiene oggetti che ESISTONO ANCHE ALTROVE.
// Riconoscerli al giro dopo — per dire cosa è cambiato, e un giorno per scrivere
// all'indietro — richiede un'identità stabile. Il nome non lo è: si corregge. L'IP
// nemmeno: si sposta. E `ifName` è una STRINGA, cioè la classe di confronto che in
// questo progetto è vietata ovunque (`addrKey`, `segmentKey`, `macKey`).
//
// ── Le quattro scelte, e perché ────────────────────────────────────────────
//
//  ① **Un CAMPO, mai dentro l'id.** `nb-dev-42` sembra un riferimento e non lo è:
//     gli id InfraNet si riscrivono — lo smoke enterprise-500 ha già rotto i LAG
//     esattamente così — e un'identità che vive dentro una stringa muore col
//     primo rename.
//
//  ② **Il TIPO sta nel NOME del campo**, non in un valore accanto. È una scelta di
//     PESO, presa su una misura: la forma leggibile `{objectType:'dcim.interface',
//     objectId:1000}` costa **57 byte per porta** e su 40 apparati da 48 porte
//     faceva crescere il documento del **141%** — più che raddoppiarlo. `srcIf:1000`
//     ne costa **13**, e non perde niente: il tipo resta esplicito, solo scritto
//     una volta nel nome invece che ripetuto in ogni oggetto.
//
//  ③ **Le chiavi le conosce SOLO questo file.** Chi legge chiama `refOf(obj)` e
//     riceve sempre la stessa forma `{objectType, objectId}`: nessun chiamante sa
//     che di sotto c'è `srcIf` o `srcFront`. Senza questa regola la compattezza
//     diventerebbe il solito concetto sparso in due strati.
//
//  ④ **Niente `system`.** Il sistema d'origine è dichiarato UNA volta, sul progetto
//     (`state.source.dcim.system`). Se un giorno servisse un secondo sistema nello
//     stesso documento, il posto dove aggiungerlo è questo file, e solo questo.
//
// PURO: zero DOM, zero IO, zero `window`.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // La tabella, e non ce n'è un'altra: nome del campo → tipo d'oggetto nel DCIM.
  // L'ORDINE conta: è la precedenza di `refOf` quando un oggetto ne porta più d'uno
  // (uno slot di patch panel porta front E rear — di là sono due oggetti, e il
  // front è quello che lo identifica).
  const FIELDS = [
    ['srcDevice', 'dcim.device'],
    ['srcIf', 'dcim.interface'],
    ['srcFront', 'dcim.frontport'],
    ['srcRear', 'dcim.rearport'],
    ['srcOutlet', 'dcim.poweroutlet'],
    ['srcRack', 'dcim.rack'],
    ['srcCable', 'dcim.cable'],
    ['srcVlan', 'ipam.vlan'],
    ['srcPrefix', 'ipam.prefix'],
    ['srcAddr', 'ipam.ipaddress'],
  ];
  // Il vocabolario, per chi scrive. Chiuso di proposito: un `objectType` inventato
  // produrrebbe un riferimento che non punta a niente, e nessuno se ne accorgerebbe
  // finché non fallisce una scrittura.
  const OBJECT_TYPES = {
    device: 'dcim.device', interface: 'dcim.interface', frontPort: 'dcim.frontport',
    rearPort: 'dcim.rearport', powerOutlet: 'dcim.poweroutlet', rack: 'dcim.rack',
    cable: 'dcim.cable', vlan: 'ipam.vlan', prefix: 'ipam.prefix', address: 'ipam.ipaddress',
  };
  const _FIELD_OF = new Map(FIELDS.map(([f, t]) => [t, f]));

  function _id(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Costruisce il riferimento nella forma che vedono i chiamanti. Torna `null`
   * quando manca l'id o il tipo non è dei nostri: un riferimento a metà è peggio di
   * nessuno, perché sembra un aggancio e non lo è.
   * @returns {{objectType:string,objectId:number}|null}
   */
  function makeRef(objectType, objectId) {
    if (!_FIELD_OF.has(objectType)) return null;
    const n = _id(objectId);
    return n == null ? null : { objectType, objectId: n };
  }

  /**
   * Scrive il riferimento sull'oggetto, nel campo compatto che gli spetta.
   * ⚠️ È l'UNICO modo di scriverlo: nessun chiamante deve conoscere i nomi dei campi.
   * @returns {boolean} falso se non c'era niente di valido da scrivere (e allora
   *   NON si scrive: meglio un oggetto senza riferimento che con uno finto).
   */
  function setRef(obj, objectType, objectId) {
    if (!obj || typeof obj !== 'object') return false;
    const ref = makeRef(objectType, objectId);
    if (!ref) return false;
    obj[_FIELD_OF.get(ref.objectType)] = ref.objectId;
    return true;
  }

  /** Il riferimento PRINCIPALE di un oggetto (precedenza = ordine di FIELDS), o `null`. */
  function refOf(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const [field, type] of FIELDS) {
      const n = _id(obj[field]);
      if (n != null) return { objectType: type, objectId: n };
    }
    return null;
  }

  /** TUTTI i riferimenti di un oggetto: uno slot di patch panel ne ha due. */
  function refsOf(obj) {
    const out = [];
    if (!obj || typeof obj !== 'object') return out;
    for (const [field, type] of FIELDS) {
      const n = _id(obj[field]);
      if (n != null) out.push({ objectType: type, objectId: n });
    }
    return out;
  }

  /** Il riferimento di un TIPO preciso, se l'oggetto ce l'ha. */
  function refOfType(obj, objectType) {
    const field = _FIELD_OF.get(objectType);
    if (!field || !obj || typeof obj !== 'object') return null;
    const n = _id(obj[field]);
    return n == null ? null : { objectType, objectId: n };
  }

  /** Chiave testuale del riferimento — per Map/Set. `''` se non è valido. */
  function refKey(ref) {
    const r = ref && ref.objectType ? makeRef(ref.objectType, ref.objectId) : null;
    return r ? (r.objectType + '#' + r.objectId) : '';
  }

  /** Due riferimenti puntano allo stesso oggetto? Due `null` NON sono «lo stesso». */
  function sameRef(a, b) {
    const ka = refKey(a);
    return !!ka && ka === refKey(b);
  }

  /**
   * Indicizza per riferimento una collezione del documento.
   * ⚠️ Chi non ha un riferimento resta FUORI: è lavoro tuo, non roba del DCIM, e
   * confonderlo con un oggetto importato è il modo in cui un confronto finisce per
   * accusarti del tuo stesso lavoro.
   */
  function indexByRef(items) {
    const out = new Map();
    for (const it of (Array.isArray(items) ? items : [])) {
      const k = refKey(refOf(it));
      if (k) out.set(k, it);
    }
    return out;
  }

  /** I nomi dei campi: serve SOLO a chi deve ripulire o ispezionare il documento. */
  const REF_FIELDS = FIELDS.map(([f]) => f);

  return { OBJECT_TYPES, REF_FIELDS, makeRef, setRef, refOf, refsOf, refOfType, refKey, sameRef, indexByRef };
});
