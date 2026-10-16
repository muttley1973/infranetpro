// ============================================================
// FIELD PROVENANCE — da DOVE viene il valore di un campo a doppia natura (puro)
// ============================================================
// Molti campi del progetto sono scrivibili da DUE mani: una persona nel pannello e una
// lettura (Sync SNMP, Discovery, Verifica) che li riempie quando sono vuoti. Una volta
// copiato, il valore sta nello stesso campo di uno scritto a mano e non dice più da dove
// viene — e tutto ciò che sta a valle lo prende per dichiarato. Tre difetti trovati in un
// giorno (16/10) avevano questa radice: il punto «Dichiarato — scritto da una persona» su
// un modello copiato dall'ENTITY-MIB, le «libere ma attive» costruite sullo `status` che
// scrive anche il disegno di un cavo, il falso «coerente» di una porta confrontata con sé
// stessa.
//
// LA REGOLA, che questo file e test/field-provenance.test.js tengono in piedi:
//
//   1. Chi scrive in un campo a doppia natura PER CONTO DI UNA LETTURA ne registra la
//      provenienza: `rec.copiedFromRead[campo] = true` (markFromRead / fillFromRead).
//   2. OGNI scrittura di una persona la cancella (forgetFromRead) — non serve sapere
//      quale campo è iscritto: toglierla da un campo che non l'aveva non fa niente.
//   3. Chi mostra o confronta chiede la provenienza (isFromRead / stillFromRead) e non la
//      deduce dall'uguaglianza dei valori.
//   4. Un campo che una lettura scrive e che una persona può scrivere sta nel REGISTRO qui
//      sotto, con il suo meccanismo. Un campo nuovo che una lettura comincia a scrivere e
//      che nel registro non c'è fa ARROSSIRE il test: la regola non è una cortesia.
//
// I meccanismi sono quattro, e ogni campo ne ha almeno uno:
//   mark      il segno qui sopra — per i campi senza un'altra via
//   lock      il lucchetto `<campo>Manual`: «l'ha deciso una persona, non riscrivetelo»
//   override  uno slot SEPARATO per la persona (`vlanOvr`, `statusOvr`…): la lettura ha il suo
//   shadow    la lettura si tiene ACCANTO al dichiarato (`ip6Real`, `portsMeasured`)
//   flag      il campo è esso stesso un flag di decisione (`typeManual`)
// e `debt`: un campo che una lettura riscrive a ogni giro e che una persona può seminare, e a
// cui nessun meccanismo è stato ancora dato. Il debito è ESPLICITO e si può solo ridurre
// (il tetto sta nel test): è così che «la regola, non l'eccezione» non resta una frase.
//
// Puro: nessun DOM, nessun IO, nessun accesso a store/window. Condiviso browser + test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'copiedFromRead';

  function _obj(x) { return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null; }
  function _filled(v) { return v != null && String(v).trim() !== ''; }

  // Lo STESSO valore, per chi confronta un'identità: pieno da entrambe le parti,
  // trim + maiuscole (il padding dell'ENTITY-MIB non è una differenza). Una definizione sola.
  function sameReadValue(a, b) {
    return _filled(a) && _filled(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  // Il valore ATTUALE di `field` è stato scritto per conto di una lettura.
  function markFromRead(rec, field) {
    if (!rec || typeof rec !== 'object') return;
    if (!_obj(rec[KEY])) rec[KEY] = {};
    rec[KEY][field] = true;
  }

  // Una persona ci ha scritto sopra (o l'ha svuotato). Un oggetto vuoto non si persiste:
  // se era l'ultima marca, sparisce anche lui. Su un campo che non l'aveva: nessun effetto.
  function forgetFromRead(rec, field) {
    const c = _obj(rec && rec[KEY]);
    if (!c) return;
    delete c[field];
    if (!Object.keys(c).length) delete rec[KEY];
  }

  // Solo la provenienza: il campo è marcato? (Per i campi che non hanno una lettura
  // separata con cui confrontarsi.)
  function isFromRead(rec, field) {
    const c = _obj(rec && rec[KEY]);
    return !!(c && c[field] === true);
  }

  // Marcato E ancora uguale alla lettura corrente: la copia non è cambiata e la lettura
  // la conferma. Se l'apparato viene sostituito e la lettura cambia, risponde falso.
  function stillFromRead(rec, field, read) {
    return isFromRead(rec, field) && sameReadValue(rec[field], read);
  }

  // Riempie un campo VUOTO con un valore letto e ne registra la provenienza. Manual-first:
  // un campo già pieno non si tocca. `canFill` (facoltativo) è una condizione in più (la
  // marca ha il suo lucchetto). Un valore vuoto non scrive niente — nemmeno una chiave ''.
  // Ritorna true se ha scritto.
  function fillFromRead(rec, field, value, canFill) {
    if (!rec || typeof rec !== 'object' || !_filled(value)) return false;
    if (canFill === false || _filled(rec[field])) return false;
    rec[field] = value;
    markFromRead(rec, field);
    return true;
  }

  // ── Il REGISTRO ─────────────────────────────────────────────────────────────
  // Ogni campo `document` (lo scrive anche una persona, vedi lib/project-schema.js) che una
  // lettura scrive. Il perché di ciascuno sta accanto; i nomi dei flag sono letterali.
  const FIELD_PROVENANCE = {
    node: {
      hostname:     { lock: 'hostnameManual' },
      ip:           { lock: 'ipManual' },
      ip6:          { lock: 'ip6Manual', shadow: 'ip6Real' },
      name:         { lock: 'nameManual' },
      type:         { lock: 'typeManual' },
      typeManual:   { flag: true },
      ports:        { lock: 'portsManual', shadow: 'portsMeasured' },
      brand:        { lock: 'brandManual', mark: true },
      model:        { mark: true },
      serialNumber: { mark: true },
      firmwareVer:  { mark: true },
      mac:          { mark: true },
    },
    port: {
      desc: { mark: true },
      ip:   { mark: true },
      // Lo slot dichiarato di questi tre è `*Ovr`: la lettura scrive il campo base e la
      // persona il proprio. Il campo base però lo SEMINA anche chi disegna un cavo.
      vlan:  { override: 'vlanOvr',  debt: 'seminato dal disegno di un cavo e dall\'import; l\'SNMP lo riscrive a ogni giro' },
      speed: { override: 'speedOvr', debt: 'seminato dall\'import; l\'SNMP lo riscrive a ogni giro' },
      // `status` non è una misura: lo scrivono anche il cavo disegnato, l'editor di cablaggio e
      // l'import DCIM. La misura è `operUp`.
      status: { override: 'statusOvr', debt: 'seminato dal cavo disegnato e dall\'import; la misura è operUp' },
      ifName:       { debt: 'lo riscrive l\'SNMP a ogni giro; nessun pannello lo scrive, ma l\'import sì' },
      mac:          { debt: 'lo riscrive l\'SNMP; l\'import DCIM lo semina' },
      isTrunk:      { debt: 'misura dell\'SNMP, seminabile da un trunk dichiarato' },
      trunkVlans:   { debt: 'misura dell\'SNMP, seminabile da un trunk dichiarato' },
      lagId:        { debt: 'misura dell\'SNMP' },
      lagGroup:     { debt: 'il prefisso `snmp-lag-` dell\'id distingue il gruppo automatico dal manuale' },
      logical:      { debt: 'lo scrive la lettura delle sottointerfacce e l\'import DCIM' },
      parentPid:    { debt: 'lo scrive la lettura delle sottointerfacce' },
    },
  };

  // I campi di uno scope che usano il segno `copiedFromRead`.
  function provenanceFields(scope) {
    const s = _obj(FIELD_PROVENANCE[scope]) || {};
    return Object.keys(s).filter(k => s[k].mark === true);
  }

  // I campi di uno scope con un debito dichiarato e nessun meccanismo vero.
  function provenanceDebt(scope) {
    const s = _obj(FIELD_PROVENANCE[scope]) || {};
    return Object.keys(s).filter(k => s[k].debt && !s[k].mark && !s[k].lock && !s[k].flag);
  }

  return {
    sameReadValue, markFromRead, forgetFromRead, isFromRead, stillFromRead, fillFromRead,
    FIELD_PROVENANCE, provenanceFields, provenanceDebt,
  };
});
