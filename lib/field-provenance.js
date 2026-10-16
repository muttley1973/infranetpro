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
//   3. Chi mostra chiede `fieldSource`: misurato se il campo e' marcato O se la lettura corrente lo
//      conferma (e' cosi' che i dati copiati prima delle marche guariscono); dichiarato altrimenti.
//   3b. Una lettura che trova nel campo lo stesso valore lo MARCA (confirmFromRead): il dato e' misurato
//      perche' il dispositivo lo dice, non perche' ricordiamo chi l'ha copiato.
//   3c. Un record NATO da una lettura marca i campi che porta pieni (markFilledFromRead).
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
//   measure   la lettura ha una controparte SEPARATA che scade (`operUp`): «è stato letto?» si chiede a lei
//   idPrefix  l'ID del valore dice chi l'ha scritto (i gruppi LAG: `snmp-lag-`, `lldp-lag-`, `nb-lag-`, `lg…`)
//   slot      il campo è della lettura: nessuna mano lo scrive, e il test elenca i SOLI file che possono farlo
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
  // Una marca su un campo CANCELLATO non conta: chi toglie un valore (una persona, un ripristino) non deve
  // ricordarsi di toglierne anche la marca — un campo vuoto non e' stato letto da nessuno.
  function isFromRead(rec, field) {
    const c = _obj(rec && rec[KEY]);
    return !!(c && c[field] === true && _filled(rec[field]));
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

  // Una lettura dice la STESSA cosa che il campo gia' contiene: il dispositivo la CONFERMA, e un valore che il
  // dispositivo conferma e' un valore misurato — anche se l'aveva scritto una persona, anche se a copiarlo e'
  // stata una versione dell'app che non teneva ancora la provenienza. E' cosi' che i dati vecchi guariscono al
  // Sync successivo, senza indovinarli. Ritorna true se ha marcato.
  function confirmFromRead(rec, field, read) {
    if (!rec || typeof rec !== 'object' || !sameReadValue(rec[field], read)) return false;
    markFromRead(rec, field);
    return true;
  }

  // Un nodo (o una porta) nato da una lettura: i campi che ha gia' PIENI li ha scritti la lettura. Si chiama
  // dopo aver costruito il record, una volta, con l'elenco dei campi a doppia natura che il record porta.
  function markFilledFromRead(rec, fields) {
    if (!rec || typeof rec !== 'object') return;
    for (const f of (fields || [])) if (_filled(rec[f])) markFromRead(rec, f);
  }

  // Da dove viene il valore che il campo MOSTRA: 'measured' | 'declared' | null (campo vuoto).
  //   · `read` e' la lettura CORRENTE dello stesso fatto, se ne esiste una (l'inventory ENTITY-MIB per
  //     modello/matricola/firmware, l'alias per la descrizione); senza, passa undefined.
  //   · uguale alla lettura → misurato: il dispositivo lo conferma, qualunque mano l'abbia scritto;
  //   · marcato, e la lettura non c'e' (spenta, stantia) → misurato: lo ha letto un apparato, e un apparato che
  //     tace non lo smentisce;
  //   · marcato, ma la lettura corrente dice ALTRO → dichiarato: l'apparato e' cambiato e la Verifica ne discute.
  //     `opts.lenient` lo tiene misurato: la marca vera e' il nome dato da UN'ALTRA fonte (l'OUI dice «Cisco»,
  //     l'ENTITY-MIB «Cisco Systems Inc»), e due fonti che scrivono lo stesso nome in modo diverso non si
  //     contraddicono;
  //   · ne' marcato ne' confermato → dichiarato.
  function fieldSource(rec, field, read, opts) {
    if (!rec || typeof rec !== 'object' || !_filled(rec[field])) return null;
    if (_filled(read) && sameReadValue(rec[field], read)) return 'measured';
    if (!isFromRead(rec, field)) return 'declared';
    if (_filled(read) && !(opts && opts.lenient)) return 'declared';
    return 'measured';
  }

  // Scrive il valore di una lettura SOPRA quello che c'era (la lettura riscrive: e' il suo campo) e ne
  // registra la provenienza. Un valore vuoto non e' una lettura: toglie la marca invece di metterla.
  function writeFromRead(rec, field, value) {
    if (!rec || typeof rec !== 'object') return;
    rec[field] = value;
    if (_filled(value)) markFromRead(rec, field); else forgetFromRead(rec, field);
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
      // Il lucchetto si chiude da solo quando una persona scrive il campo (`updateN`): la Verifica non lo contesta più.
      model:        { lock: 'modelManual', mark: true },
      serialNumber: { lock: 'serialNumberManual', mark: true },
      firmwareVer:  { lock: 'firmwareVerManual', mark: true },
      mac:          { mark: true },
    },
    port: {
      desc: { mark: true },
      ip:   { mark: true },
      // Le VLAN di un trunk le scrive anche una persona (l'editor del trunk): le due mani si distinguono col segno.
      trunkVlans: { mark: true },
      // `status` non e' una misura (lo seminano anche il cavo disegnato e l'import DCIM): la misura che scade
      // e' `operUp`/`adminDown`. Chi semina passa da seedPortActive/releasePortActive (lib/port-state.js), che
      // NON scavalcano una porta misurata; i soli scrittori grezzi sono la lettura e l'«Adotta» della Verifica.
      status: { override: 'statusOvr', measure: 'operUp', slot: ['app-snmp.js', 'app-drift.js'] },
      // Il campo base lo scrive la lettura (e l'«Adotta», che copia la misura); lo slot della persona e' `*Ovr`.
      // Nessun cavo e nessun import li semina: lo dice il censimento dei scrittori (test).
      vlan:  { override: 'vlanOvr',  slot: ['app-snmp.js', 'app-drift.js'] },
      speed: { override: 'speedOvr', slot: ['app-snmp.js', 'app-drift.js'] },
      // Campi che scrive la LETTURA (SNMP) o un'inferenza sulle letture (autolink: LLDP/FDB). Nessun pannello
      // li offre a una persona (il test lo deriva dai `data-pfield` dei template). L'import DCIM li semina in
      // un progetto NUOVO: e' un dato dichiarato dalla fonte, non una lettura.
      ifName:    { slot: ['app-snmp.js', 'app-autolink.js'] },
      mac:       { slot: ['app-snmp.js'] },
      isTrunk:   { slot: ['app-snmp.js', 'app-autolink.js'] },
      lagId:     { slot: ['app-snmp.js'] },
      logical:   { slot: ['app-snmp.js'] },
      parentPid: { slot: ['app-snmp.js'] },
      // La provenienza e' nell'ID del gruppo: `snmp-lag-` (misurato), `lldp-lag-` (inferito), `nb-lag-`
      // (dichiarato dal DCIM), e `lg…` per un LAG fatto a mano. Il codice di autolink si regge gia' su questo.
      lagGroup: { idPrefix: ['snmp-lag-', 'lldp-lag-', 'nb-lag-'] },
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
    sameReadValue, markFromRead, forgetFromRead, isFromRead, stillFromRead, fillFromRead, writeFromRead,
    confirmFromRead, markFilledFromRead, fieldSource,
    FIELD_PROVENANCE, provenanceFields, provenanceDebt,
  };
});
