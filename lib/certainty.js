// NOTAZIONE UNICA DELLA CERTEZZA — un alfabeto, i motori intatti.
//
// Il rilievo che questo modulo chiude: chi guarda una riga ha UNA domanda —
// «quanto mi fido di questo?» — e riceve fino a cinque risposte in cinque
// alfabeti diversi. Sette insiemi di parole (proof · linkstate · temporal ·
// ov.prov · disc.conf · status · presenza) per la stessa domanda.
//
// ⛔ NON si fondono i motori. `lib/provenance.js` spiega, con ragione, che
//    hanno emivite legittimamente diverse: un dichiarato non invecchia, una
//    misura sì, e a ritmi che dipendono dalla grandezza misurata. Qui si
//    unifica l'ALFABETO — la parola e il grado — non il modello che ci sta
//    sotto. Ogni motore continua a calcolare quello che calcolava.
//
// ⚠️ E NON si decide un colore qui dentro. Il grado è semantico; la tinta la
//    dà il foglio di stile dai token (`.cty-<grade>`). È la stessa lezione dei
//    badge del cavo: il colore smette di essere deciso nel punto in cui si
//    disegna, se no non segue più il tema e nessun token lo conosce.
//
// Condiviso browser + test (UMD-lite), come gli altri `lib/*.js`.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // I CINQUE SEGNI. Ordine = dal più portante al meno, ed è l'ordine in cui
  // vanno letti in una legenda.
  //
  // ⭐ Non sono un'invenzione: quattro esistono già nell'app, sono le pastiglie
  //    di provenienza in fondo alla Panoramica (`.ov-d.p-*`). Il quinto,
  //    `contradicted`, viene dalla scala del verdetto che la 2.11.2 ha
  //    unificato sulle sei sezioni. Qui non si disegna niente di nuovo: si fa
  //    viaggiare un alfabeto che finora non usciva da una schermata sola.
  //
  // ⚠️ `absent` e `contradicted` sono DUE segni, non uno. Il documento di
  //    proposta ne aveva previsto uno solo («senza appoggio») per «nessuna
  //    evidenza O evidenza contraddetta»: la 2.11.2 ha stabilito il contrario
  //    separando il grigio «non so» dal rosso «guasto», perché un progetto mai
  //    sincronizzato non è un progetto rotto. `contradicted` chiede un
  //    intervento, `absent` chiede una lettura: fonderli riaprirebbe un
  //    difetto appena chiuso.
  // ⭐ SEI SEGNI, e le due assenze sono SIMMETRICHE alle due origini positive:
  //    «non dichiarato» è l'assenza di un DICHIARATO (manca la scrittura di una
  //    persona), «non risulta» è l'assenza di un MISURATO (manca una lettura).
  //    Chiedono cose diverse: la prima chiede a te di scrivere, la seconda chiede
  //    a una sonda di andare a guardare. Collassarle diceva a chi legge «il dato
  //    non c'è» senza dirgli chi deve muoversi.
  // ⚠️ Ma si DISEGNANO UGUALI — l'anello vuoto — perché sono entrambe assenze:
  //    a distinguerle è la PAROLA, non un sesto colore. È la regola che l'app si
  //    è già data in cima a 11-overview.css (il colore conferma, la parola porta
  //    il significato), applicata anche qui.
  const CERTAINTY_GRADES = ['measured', 'declared', 'derived', 'contradicted', 'undeclared', 'unread'];

  // Le MAPPE, un vocabolario per volta. La chiave a sinistra è quella che il
  // motore produce davvero (non la parola tradotta); il grado a destra è il
  // segno unico.
  //
  // ⚠️ Chi aggiunge una chiave a un motore DEVE aggiungerla qui: la guardia
  //    `test/certainty.test.js` DERIVA gli insiemi di chiavi dai sorgenti dei
  //    motori e va rossa su ogni chiave non mappata. Un elenco che si controlla
  //    da solo resterebbe verde e cieco al primo stato nuovo.
  const CERTAINTY_MAP = {
    // ── proof — gli stati di `cableProof` (lib/proof.js), come li nomina la
    //    mappa `_CABLE_PROOF_BADGE`.
    proof: {
      'derived-strong':  'measured',      // adiacenza forte: il protocollo di vicinato l'ha detto
      'declared':        'declared',      // asserito a mano, nessun claim di liveness
      'derived-weak':    'derived',       // inferenza debole/che invecchia
      'declared-review': 'contradicted',  // la realtà contraddice il cavo
      'declared-shut':   'contradicted',  // porta in shutdown: due dichiarazioni in conflitto
      // ⭐ DECISIONE DELL'UTENTE (04/09): «Fantasma» è ASSENZA, non contraddizione.
      //    È un'inferenza che ha PERSO l'evidenza che aveva — l'evidenza non
      //    dice il contrario, non c'è più. E fra le due assenze è `unread`:
      //    quello che manca è una LETTURA, non una tua dichiarazione.
      'ghost':           'unread',
    },

    // ── linkstate — `LINK_STATE_LABELS` (lib/linkstate.js).
    linkstate: {
      'discovered': 'measured',   // lo switch DICHIARA il vicino (LLDP/CDP)
      'manual':     'declared',   // creato/confermato dall'utente
      'ambiguous':  'derived',    // l'app HA DEDOTTO il vicino (MAC/ARP/FDB)
      // ⚠️ `lag` NON compare qui, e non è una dimenticanza: non è una
      //    certezza. Dice COSA È il link (membro di un bundle), non quanto ci
      //    fidiamo — lo stesso asse di TRUNK/ACCESS. È un campo che tiene due
      //    domande; `certaintyOf` lo segnala invece di inventargli un grado.
    },

    // ── temporal — i tier di `temporalConfidence` (lib/temporal-confidence.js).
    // ⚠️ Questo motore misura la FRESCHEZZA, non l'origine: mapparlo sui gradi
    //    è la conversione più lossy delle cinque, ed è dichiarata qui invece
    //    che nascosta. Chi ha bisogno del tier esatto continua a leggerlo dal
    //    motore: il grado è per il colpo d'occhio, non lo sostituisce.
    temporal: {
      'stable':      'measured',   // molti avvistamenti su un arco lungo
      'established': 'measured',
      'recurring':   'derived',    // rivisto, ma non abbastanza da reggere da solo
      'fresh':       'derived',    // visto una volta: è una misura, ma non conferma niente
      'stale':       'derived',    // letto, ma non di recente: non vale più come misura corrente
      'undated':     'unread',     // «senza data non conta come recente»: manca una lettura databile
    },

    // ── disc.conf NON è qui, ed è una CORREZIONE: vedi NOT_A_CERTAINTY.

    // ── ov.prov — la provenienza delle righe di Panoramica (lib/overview.js).
    //    È già l'alfabeto: qui la mappa è quasi un'identità, ed è il motivo per
    //    cui è questo il vocabolario di riferimento e non un altro.
    prov: {
      'declared':   'declared',
      // ⚠️ `declaredNet` NON è un grado in più: è `declared` scritto al femminile
      //    perché l'etichetta italiana accompagna «subnet» (`ov.prov.declaredNet`
      //    = «dichiarata»). Il fork è nato per la GRAMMATICA e ha reso la parola
      //    invisibile all'alfabeto: la Panoramica la disegnava con la pastiglia
      //    vecchia perché questa mappa non la conosceva. La notazione ha UNA
      //    parola per grado, quindi qui l'accordo si perde di proposito.
      'declaredNet': 'declared',
      'measured':   'measured',
      'derived':    'derived',
      // ⚠️ `none` è il DEFAULT di _row: una riga che non dichiara la provenienza.
      //    Nella Panoramica vuol dire «nessuno l'ha scritto» — ed è per questo che
      //    la riga `verify` ha smesso di usarlo: lì non manca una dichiarazione,
      //    manca una LETTURA, e l'etichetta «non dichiarato» era falsa.
      'none':       'undeclared',
      'undeclared': 'undeclared',
      'unread':     'unread',
    },
  };

  // Chiavi che un motore produce ma che NON rispondono alla domanda della
  // certezza. Vanno dichiarate: il silenzio non distinguerebbe «non è una
  // certezza» da «mi sono dimenticato di mapparla».
  const NOT_A_CERTAINTY = {
    linkstate: { 'lag': 'identity' },   // dice cos'è il link, non quanto ci fidiamo
    // ⚠️ CORREZIONE (04/09). Prima avevo mappato high→measured, mid/low→derived:
    //    è SBAGLIATO, e il codice della Scoperta lo dimostra. Il punteggio è un
    //    voto ADDITIVO su segnali eterogenei, e si arriva a «Alta» (≥70) anche
    //    senza SNMP e senza LLDP — NetBIOS 14 + SMB 20 + servizi 18 + hostname 12
    //    + MAC 12 + ping 10 = 86. Chiamarlo «Misurato» vorrebbe dire spacciare per
    //    lettura un mucchio di indizi deboli ben sommati.
    //    È la stessa lezione già scritta in lib/linkstate.js: la differenza è
    //    QUALITATIVA, non quantitativa — vincere lo score significa «ho indovinato
    //    con più certezza», non «me l'ha confermato l'apparato».
    //    Questi tre livelli rispondono a QUANTO FORTE, non a DA DOVE: sono un asse
    //    diverso, e il grado lo dà `certaintyForDiscovery` dai segnali veri.
    disc: { 'high': 'strength', 'mid': 'strength', 'low': 'strength' },
    // ⭐ La Panoramica scrive nella STESSA casella (`tag:`) due famiglie di parole:
    //    la provenienza di una voce — che è certezza, e prende la pastiglia — e il
    //    MOTIVO per cui quella voce è in lista, che risponde a un’altra domanda.
    //    Dichiararle qui è ciò che permette al renderer di decidere chiedendo al
    //    motore invece di tenere un elenco suo: `certaintyOf` rende un grado per le
    //    prime e niente per le seconde, e il confine sta in un posto solo.
    prov: {
      'noGateway':    'gap',           // manca una dichiarazione, non e' una lettura
      'noReading':    'gap',
      'snmpErr':      'reachability',  // l'apparato non risponde: dice se lo raggiungo
      'unverifiable': 'reachability',  // non lo interrogo affatto
      'stale':        'age',           // l'età della cosa, non della nostra conoscenza
      'dated':        'age',
      'mismatch':     'identity',      // seriale/modello diversi dal dichiarato
    },
  };

  /**
   * Il grado unico per una chiave di un motore.
   * @param {string} vocab  'proof' | 'linkstate' | 'temporal' | 'disc' | 'prov'
   * @param {string} key    la chiave che il motore produce
   * @returns {{grade:string|null, labelKey:string|null, axis:string}}
   *   `grade` null quando la chiave non è una certezza (`axis` dice quale
   *   asse è) oppure quando è sconosciuta (`axis` = 'unknown').
   */
  function certaintyOf(vocab, key) {
    const v = String(vocab || '');
    const k = String(key || '');
    const other = NOT_A_CERTAINTY[v] && NOT_A_CERTAINTY[v][k];
    if (other) return { grade: null, labelKey: null, axis: other };
    const table = CERTAINTY_MAP[v];
    const grade = table && Object.prototype.hasOwnProperty.call(table, k) ? table[k] : null;
    if (!grade) return { grade: null, labelKey: null, axis: 'unknown' };
    return { grade, labelKey: 'cty.' + grade, axis: 'certainty' };
  }

  /**
   * Il grado di un CAVO, che ha due motori a dirgli qualcosa.
   *
   * ⭐ La precedenza, con la sua ragione: `proof` e' un'affermazione DATATA —
   *    «all'ultima Verifica» — mentre `linkstate` dice come il cavo e' NATO.
   *    Quando la Verifica c'e' stata, e' lei la notizia piu' fresca e vince.
   *    Quando non c'e' stata (nessun nodo ha `proof`), come e' nato e' tutto
   *    quello che sappiamo, e allora parla `linkstate`.
   * ⚠️ Non e' una fusione dei due motori: nessuno dei due cambia di una virgola,
   *    e a chi guarda si dice SEMPRE quale dei due sta parlando (`source`), cosi'
   *    il dettaglio resta raggiungibile invece che perso.
   *
   * @param {string|null} proofState  stato di `cableProof`, o null se nessuna Verifica
   * @param {string|null} lsCertaintyKey  `certaintyKey` di `linkState` (MAI `key`:
   *   quello puo' valere 'lag', che non e' una certezza)
   * @returns {{grade:string|null, labelKey:string|null, source:string|null}}
   */
  function certaintyForCable(proofState, lsCertaintyKey) {
    const p = proofState ? certaintyOf('proof', proofState) : { grade: null };
    if (p.grade) return { grade: p.grade, labelKey: p.labelKey, source: 'proof' };
    const l = certaintyOf('linkstate', lsCertaintyKey);
    if (l.grade) return { grade: l.grade, labelKey: l.labelKey, source: 'linkstate' };
    return { grade: null, labelKey: null, source: null };
  }

  /**
   * Il grado di un CAMPO del pannello, dove la provenienza non si deduce: e'
   * gia' strutturale. In quei campi il valore SCRITTO da una persona e quello
   * LETTO da una scansione stanno in due posti diversi — nel pannello, `value`
   * e `placeholder` — e finora la differenza la raccontava un paragrafo.
   *
   * ⛔ NON accusa di contraddizione quando i due divergono, e non e' una
   *    dimenticanza: manual-first dice che il dichiarato e' legge, e accusare
   *    un apparato di essere stato sostituito chiede una misura CONFERMATA
   *    (`isConfirmedMeasure`, lib/proof.js) che questa funzione non ha. Il drift
   *    d'identita' lo dichiara chi ha l'evidenza; qui si direbbe solo «rosso»
   *    senza poterlo sostenere — cioe' un ripiego travestito da misura.
   *
   * @param {*} declared  il valore scritto da una persona (vuoto = non scritto)
   * @param {*} read      il valore letto da una scansione (vuoto = nessuna lettura)
   * @returns {{grade:string, labelKey:string, source:string|null}}
   */
  function certaintyForField(declared, read) {
    const pieno = (v) => v != null && String(v).trim() !== '';
    if (pieno(declared)) return { grade: 'declared', labelKey: 'cty.declared', source: 'typed' };
    if (pieno(read)) return { grade: 'measured', labelKey: 'cty.measured', source: 'read' };
    // ⚠️ Delle due assenze qui vale `undeclared`: in questo blocco OGNI campo è
    // scrivibile da te, quindi l'assenza che conta per chi guarda è «nessuno l'ha
    // scritto». (Il segno poi non si disegna affatto — vedi _ctyMark — ma il grado
    // deve restare vero lo stesso: un valore di comodo marcisce.)
    return { grade: 'undeclared', labelKey: 'cty.undeclared', source: null };
  }

  // ── presenza — le classi che nodePresenceClass mette sulla tile
  //    (lib/presence.js). ⭐ È LA SUPERFICIE CHE OGGI NON HA PAROLE AFFATTO:
  //    alone rosso, grigio desaturato, anello grigio. Qui il segno non sostituisce
  //    un vocabolario, gliene DÀ uno — ed è la regola che il file del render si è
  //    già scritta da sé per l'anello SNMP: «un anello colorato senza testo
  //    obbliga a chiedere cosa vuol dire (è successo)», applicata a quell'anello
  //    e non a questi tre.
  const PRESENCE = {
    // Sondato, e non risponde: il documento dice che c'è, la rete dice di no.
    'node-absent':          { grade: 'contradicted', reason: 'absent' },
    // Risponde, ma l'hai dichiarato fuori servizio: contraddizione al contrario.
    'node-status-conflict': { grade: 'contradicted', reason: 'conflict' },
    // Assente, e l'avevi DETTO tu: il silenzio è quello che ti aspettavi, e la
    // tua dichiarazione è ciò che lo spiega. Non è un guasto e non è un'incognita.
    'node-absent-expected': { grade: 'declared',     reason: 'absentExpected' },
    // La sonda non è arrivata fin lì: non è una notizia SULL'APPARATO.
    'node-unverified':      { grade: 'unread',       reason: 'unverified' },
  };

  /**
   * Il grado di presenza di un apparato, dalla classe che porta sulla tile.
   * ⚠️ Stringa VUOTA → nessun grado, e non è una dimenticanza: `nodePresenceClass`
   *    restituisce '' sia quando l'apparato ha risposto da poco sia quando non
   *    c'è niente da dire (nessun report, nessuna prova). Sono due cose diverse
   *    e la classe non le distingue: dedurne «Misurato» sarebbe inventare una
   *    lettura che nessuno ha fatto.
   * @param {string} presenceClass  es. ' node-absent' (lo spazio iniziale è tollerato)
   */
  function certaintyForPresence(presenceClass) {
    const k = String(presenceClass || '').trim();
    const m = Object.prototype.hasOwnProperty.call(PRESENCE, k) ? PRESENCE[k] : null;
    if (!m) return { grade: null, labelKey: null, reasonKey: null };
    return { grade: m.grade, labelKey: 'cty.' + m.grade, reasonKey: 'cty.pres.' + m.reason };
  }

  /**
   * Il grado di una riga di SCOPERTA. ⚠️ NON dal punteggio: dai SEGNALI.
   *
   * Un apparato è «Misurato» solo se qualcosa di autorevole ha parlato — ha
   * risposto a SNMP, oppure un vicino l'ha dichiarato via LLDP/CDP. Tutto il
   * resto (NetBIOS, SMB, servizi TCP, hostname, MAC, vendor, ping) sono
   * osservazioni SU di lui, non affermazioni DI lui: sommate bene fanno un
   * numero alto, non una lettura.
   *
   * ⛔ Due gradi soltanto, e non è una semplificazione: una riga di Scoperta
   *    esiste perché QUALCOSA l'ha vista, quindi nessuna delle due assenze capita
   *    mai. Tenere un terzo stato irraggiungibile è il modo più rapido per
   *    farlo marcire.
   *
   * @param {boolean} authoritative  SNMP ha risposto, o un vicino l'ha dichiarato
   */
  function certaintyForDiscovery(authoritative) {
    return authoritative
      ? { grade: 'measured', labelKey: 'cty.measured', source: 'authoritative' }
      : { grade: 'derived',  labelKey: 'cty.derived',  source: 'inference' };
  }

  /** Tutte le chiavi mappate di un vocabolario (per le legende e le guardie). */
  function certaintyKeys(vocab) {
    const table = CERTAINTY_MAP[String(vocab || '')];
    return table ? Object.keys(table) : [];
  }

  return {
    CERTAINTY_GRADES,
    CERTAINTY_MAP,
    NOT_A_CERTAINTY,
    certaintyOf,
    certaintyForCable,
    certaintyForField,
    certaintyForDiscovery,
    certaintyForPresence,
    PRESENCE_CLASSES: Object.keys(PRESENCE),
    certaintyKeys,
  };
});
