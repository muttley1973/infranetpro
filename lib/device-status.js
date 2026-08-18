// LO STATO OPERATIVO DICHIARATO — «questo apparato deve rispondere, oggi?»
//
// Un apparato che non risponde non e' automaticamente un guasto: puo' essere
// PIANIFICATO (non ancora installato), A MAGAZZINO, SPENTO di proposito o IN
// DISMISSIONE. Senza questo campo l'audit di presenza li tratta tutti come
// «in servizio» e produce un allarme che non e' un allarme — un rosso che chi
// legge impara a ignorare, e quel giorno il rosso vero passa inosservato.
//
// ── Le tre onesta' di questo modulo ────────────────────────────────────────
//
//  ① **La dichiarazione non tocca la misura.** `n.proof` resta quello che e':
//     se la rete non ha risposto, «assente» resta «assente». Qui si decide solo
//     COME SI LEGGE quell'assenza. Un campo dichiarato che cancella un dato
//     misurato sarebbe un interruttore per far sparire i problemi — e violerebbe
//     `docs/adr/measured-not-declared.md`.
//
//  ② **Quando dichiarazione e misura si contraddicono, nasce un rilievo, non un
//     silenzio.** Un apparato dichiarato spento che RISPONDE non e' una buona
//     notizia da nascondere: e' documentazione scaduta, ed e' esattamente
//     l'informazione per cui esiste questo strumento.
//
//  ③ **Ignoto non e' un verdetto** (paletto ②). Stato vuoto = non dichiarato:
//     `expectsPresence` torna `null` e nessuna lettura cambia. I progetti che
//     esistono oggi, che questo campo non ce l'hanno, si comportano come prima.
//
// ⚠️ VENDOR-NEUTRAL. Il vocabolario canonico e' di InfraNet, non di NetBox: e'
// il ciclo di vita di un bene, lo stesso in qualunque DCIM. La tabella degli
// alias e' APERTA e si allunga senza toccare ne' il vocabolario ne' i verdetti —
// e' la' che si aggancia una sorgente nuova, mai nel resto del file.
//
// PURO: zero DOM, zero IO, zero `window`. Le parole stanno in `lib/i18n.js`.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Il vocabolario canonico, in ordine di ciclo di vita. Chiuso: un valore fuori
  // da qui non entra nel documento (`normalizeStatus` lo scarta), altrimenti il
  // campo diventa testo libero e nessun motore puo' piu' ragionarci sopra.
  const STATUSES = ['planned', 'staged', 'inventory', 'active', 'failed', 'decommissioning', 'offline'];

  // L'UNICA domanda che questo campo serve a rispondere: deve rispondere sul filo?
  //   true  -> si': se tace, e' una notizia.
  //   false -> no: il silenzio e' coerente con cio' che hai dichiarato.
  // `failed` sta fra i `false` perche' un guasto GIA' DICHIARATO non e' una
  // scoperta: e' un fatto che conosci. Continua a comparire nei conteggi, ma non
  // deve ri-allarmare ogni verifica.
  const EXPECTS_PRESENCE = {
    planned: false,
    staged: false,
    inventory: false,
    active: true,
    failed: false,
    decommissioning: false,
    offline: false,
  };

  // Alias -> canonico. Tabella APERTA: ci si aggancia una sorgente nuova senza
  // toccare nient'altro. Sono qui i valori di NetBox, l'italiano che uno scrive a
  // mano, e le grafie con spazi/trattini che arrivano da un CSV.
  const ALIASES = {
    // NetBox (dcim.device.status)
    'active': 'active',
    'offline': 'offline',
    'planned': 'planned',
    'staged': 'staged',
    'failed': 'failed',
    'inventory': 'inventory',
    'decommissioning': 'decommissioning',
    // varianti d'uso comune
    'production': 'active',
    'in-service': 'active',
    'inservice': 'active',
    'spare': 'inventory',
    'stock': 'inventory',
    'stored': 'inventory',
    'retired': 'decommissioning',
    'decommissioned': 'decommissioning',
    'dismissed': 'decommissioning',
    'broken': 'failed',
    'faulty': 'failed',
    'down': 'offline',
    'powered-off': 'offline',
    'shutdown': 'offline',
    // italiano scritto a mano
    'attivo': 'active',
    'in-servizio': 'active',
    'produzione': 'active',
    'pianificato': 'planned',
    'previsto': 'planned',
    'preparato': 'staged',
    'pronto': 'staged',
    'magazzino': 'inventory',
    'scorta': 'inventory',
    'guasto': 'failed',
    'rotto': 'failed',
    'in-dismissione': 'decommissioning',
    'dismissione': 'decommissioning',
    'dismesso': 'decommissioning',
    'spento': 'offline',
    'fuori-servizio': 'offline',
  };

  function _key(v) {
    if (v == null) return '';
    // Un valore NetBox arriva come `{value, label}` o come stringa nuda.
    const raw = (typeof v === 'object') ? (v.value != null ? v.value : v.label) : v;
    return String(raw == null ? '' : raw).trim().toLowerCase().replace(/[\s_]+/g, '-');
  }

  /**
   * Riduce un valore qualunque al vocabolario canonico.
   * @param {*} v valore grezzo (stringa, oggetto NetBox `{value}`, null…)
   * @returns {string} uno di STATUSES, oppure '' se non dichiarato o non riconosciuto.
   *   ⚠️ Non riconosciuto torna '' e NON un valore di ripiego: inventare uno stato
   *   sarebbe peggio che non averlo (paletto ②).
   */
  function normalizeStatus(v) {
    const k = _key(v);
    if (!k) return '';
    return ALIASES[k] || '';
  }

  /**
   * Ci si aspetta che risponda sulla rete?
   * @returns {boolean|null} `null` = non dichiarato: nessun giudizio, nessun cambio
   *   di lettura. È il caso di ogni progetto scritto prima di questo campo.
   */
  function expectsPresence(status) {
    const s = normalizeStatus(status);
    if (!s) return null;
    return EXPECTS_PRESENCE[s] === true;
  }

  /** Lo stato è dichiarato e riconosciuto? (comodità per chi disegna) */
  function isDeclared(status) { return !!normalizeStatus(status); }

  /**
   * Un'assenza misurata su questo apparato deve suonare come allarme?
   * Falso SOLO quando lo stato dichiarato spiega il silenzio. Con stato assente
   * (null) resta `true`: si comporta come si è sempre comportato.
   */
  function alarmsOnAbsence(status) { return expectsPresence(status) !== false; }

  /**
   * Il rilievo che nasce dall'incontro fra ciò che hai dichiarato e ciò che la
   * rete ha risposto. Emette CODICI, mai prosa (le parole stanno in `lib/i18n.js`).
   *
   * @param {string} status      lo stato dichiarato sul nodo (`n.status`)
   * @param {string} proofStatus lo stato di prova MISURATO (`n.proof.status`)
   * @returns {{code:string, status:string}|null}
   *
   * Due esiti, e sono asimmetrici di proposito:
   *   • `status.absentAsDeclared`  — assente, e te lo aspettavi. Spiegazione, non allarme.
   *   • `status.aliveNotInService` — dichiarato fuori servizio ma RISPONDE. Questo è
   *     l'allarme vero: la documentazione mente, e finora nessuno poteva accorgersene.
   */
  function statusFinding(status, proofStatus) {
    const s = normalizeStatus(status);
    if (!s || EXPECTS_PRESENCE[s] === true) return null;   // non dichiarato, o in servizio: nulla da dire
    const p = String(proofStatus || '');
    if (p === 'proven') return { code: 'status.aliveNotInService', status: s };
    if (p === 'absent') return { code: 'status.absentAsDeclared', status: s };
    // 'unverified' / 'stale' / 'declared': non abbiamo misurato niente da confrontare.
    return null;
  }

  /**
   * Quanti apparati per stato. Serve ai conteggi della Panoramica.
   * `undeclared` è una voce a sé: non è uno stato, è l'assenza di dichiarazione, e
   * confonderla con «attivo» sarebbe la solita bugia per omissione.
   */
  function countByStatus(nodes) {
    const out = { total: 0, undeclared: 0 };
    STATUSES.forEach(function (s) { out[s] = 0; });
    (Array.isArray(nodes) ? nodes : []).forEach(function (n) {
      if (!n) return;
      out.total++;
      const s = normalizeStatus(n.status);
      if (s) out[s]++; else out.undeclared++;
    });
    return out;
  }

  return {
    STATUSES, EXPECTS_PRESENCE,
    normalizeStatus, expectsPresence, isDeclared, alarmsOnAbsence,
    statusFinding, countByStatus,
  };
});
