// ============================================================
// UNDO HISTORY — il modello di «annulla / ripeti» (puro)
// ============================================================
// La CONVENZIONE dell'app, scritta da chi ha aggiunto le operazioni una dopo l'altra: ogni operazione
// chiama pushHistory() PRIMA di modificare il progetto — «sto per fare una cosa, ricorda com'e' ora» — e poi
// modifica. Quindi la storia contiene gli stati PRIMA delle operazioni; lo stato di ADESSO (dopo l'ultima
// operazione) non e' ancora in nessun elenco.
//
// Fino a questo giro `undo()` era scritto per la convenzione opposta (foto DOPO ogni operazione, piu' una foto
// iniziale che il caricamento di un progetto non faceva: parte da storia vuota). Provato con la tastiera
// vera in un Chrome vero: dopo il caricamento la PRIMA operazione non si annullava mai; con piu' operazioni
// il primo Ctrl+Z ne saltava una; e Ctrl+Y non poteva tornare all'ultimo stato, perche' nessuno l'aveva
// mai fotografato (annullare e ripetere ti faceva PERDERE l'ultima operazione). I test controllavano solo
// che undo() accendesse «Salva» e, nell'e2e, una storia finta a due stati: nessuno faceva un'operazione
// vera e poi Ctrl+Z.
//
// IL MODELLO — un elenco di punti `points` (stringhe: le foto) e un indice `idx`:
//   · points[0..idx] sono i punti DA CUI si puo' tornare indietro; points[idx] e' lo stato prima
//     dell'ultima operazione (o, dopo un annulla, lo stato in cui si e' tornati);
//   · points[idx+1..] sono i punti del «ripeti» (gli stati da cui si e' tornati).
//   · lo stato corrente puo' essere gia' points[idx] (appena ripristinato) oppure DIVERSO: e' il caso normale
//     dopo un'operazione, e il corrente va allora tenuto da parte PRIMA di tornare indietro, o il ripeti non
//     avrebbe dove tornare. Non basta una bandierina: modifiche che nessuno ha registrato (un campo del
//     pannello, un giro di Sync) fanno lo stesso, e si distinguono solo confrontando.
// Funzioni PURE: ricevono l'elenco e l'indice e ne ritornano di nuovi (mai modificati sul posto), cosi'
// chi le usa sostituisce `_history` e `_histIdx` insieme e non resta mai a meta'.
// UMD-lite come le altre lib: <script> nel browser, require() in Node. Nessuna dipendenza, nessun DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Quanti punti si tengono. Una foto e' tutto il progetto serializzato: a 500 apparati pesa centinaia di KB.
  const CAP = 60;

  // ── La FOTO: che cosa ne resta fuori ────────────────────────────────────────
  // Una foto e' il progetto serializzato MENO queste chiavi. Non sono operazioni sul progetto, sono cose che annulla
  // e ripeti devono lasciare dove sono:
  //  · bgImage: base64, spesso > 1 MB — ha il proprio pulsante «Rimuovi mappa»;
  //  · auditLog: append-only, la storia «chi/quando/cosa» sopravvive a annulla e ripeti;
  //  · floorView, rackView, currentRack: DOVE STAI GUARDANDO (pan, zoom, scheda del rack). Viaggiano col progetto
  //    (un pan vero chiama markDirty), ma guardare non e' un'operazione: se stessero nella foto, un pan o un cambio
  //    di scheda dopo un Ctrl+Z sarebbe «una modifica non registrata», e il Ctrl+Z dopo toglierebbe SOLO la vista
  //    e butterebbe il ripeti (undo() mette il corrente dopo il punto e tronca il resto).
  const OUTSIDE_PHOTO = ['bgImage', 'auditLog', 'floorView', 'rackView', 'currentRack'];

  /**
   * La foto di uno stato: il progetto serializzato senza le chiavi di OUTSIDE_PHOTO. Non muta `state` (copia
   * superficiale delle sole chiavi tenute: l'ordine non cambia, quindi due foto dello stesso documento sono la
   * stessa stringa).
   * @param {object} state
   * @returns {string}
   */
  function photo(state) {
    const doc = {};
    for (const k of Object.keys(state)) if (OUTSIDE_PHOTO.indexOf(k) < 0) doc[k] = state[k];
    return JSON.stringify(doc);
  }

  /**
   * Le chiavi fuori foto di uno stato, da riattaccare a un altro: serve a chi sostituisce il progetto INTERO
   * (importa JSON) e vuole che l'annulla le riporti com'erano. Le viste sono copie (si muovono sul posto);
   * sfondo e giornale restano riferimenti (pesano, e il giornale e' append-only).
   */
  function outsidePhoto(state) {
    const s = state || {};
    return {
      bgImage: s.bgImage,
      auditLog: s.auditLog,
      floorView: s.floorView ? Object.assign({}, s.floorView) : undefined,
      rackView: s.rackView ? Object.assign({}, s.rackView) : undefined,
      currentRack: s.currentRack,
    };
  }

  /**
   * Rimette in piedi una foto: la parse e vi riattacca le chiavi fuori foto da `source` (di norma lo stato
   * CORRENTE: la vista non torna indietro con l'operazione). Il rack mostrato deve esistere nel progetto
   * ripristinato (annullare «aggiungi rack» o «elimina rack» lo cambia): altrimenti si apre il primo, o nessuno.
   * L'ordine delle chiavi e' quello di `source` (lo stato vivo): un annulla non rimescola il file che si salva dopo,
   * e due serializzazioni dello stesso progetto restano la stessa stringa.
   * @param {string} snap
   * @param {object} [source] stato da cui prendere le chiavi fuori foto (anche un outsidePhoto: le cinque chiavi)
   * @returns {object}
   */
  function rebuild(snap, source) {
    const parsed = JSON.parse(snap);
    const src = source || {};
    const racks = Array.isArray(parsed.racks) ? parsed.racks : [];
    const outside = {
      bgImage: src.bgImage,
      auditLog: src.auditLog,
      floorView: src.floorView ? Object.assign({}, src.floorView) : { x: 0, y: 0, zoom: 1 },
      rackView: src.rackView ? Object.assign({}, src.rackView) : { zoom: 1 },
      currentRack: racks.some(r => r && r.id === src.currentRack) ? src.currentRack : (racks.length ? racks[0].id : null),
    };
    const s = {};
    for (const k of Object.keys(src)) {                       // prima nell'ordine dello stato vivo…
      if (k in outside) s[k] = outside[k];
      else if (k in parsed) s[k] = parsed[k];
    }
    for (const k of Object.keys(parsed)) if (!(k in s)) s[k] = parsed[k];        // …poi quel che la foto ha in piu'
    for (const k of OUTSIDE_PHOTO) if (!(k in s)) s[k] = outside[k];             // …e le cinque che mancassero
    return s;
  }

  /**
   * «Sto per modificare»: ricorda lo stato com'e' ORA come punto da cui tornare.
   * Butta il «ripeti» (una operazione nuova non ha piu' il futuro di prima, come in ogni editor) e non registra
   * due volte lo stesso stato: due pushHistory() di fila senza modifiche in mezzo, o uno subito dopo un annulla
   * (il corrente e' gia' points[idx]), sono UN punto solo — altrimenti servirebbero due Ctrl+Z per un passo.
   * @param {string[]} points
   * @param {number} idx
   * @param {string} snap  lo stato adesso, serializzato
   * @returns {{points: string[], idx: number}}
   */
  function record(points, idx, snap) {
    const p = (Array.isArray(points) ? points : []).slice(0, idx + 1);
    let i = idx;
    if (p[i] !== snap) {
      p.push(snap);
      if (p.length > CAP) p.shift();
      i = p.length - 1;
    }
    return { points: p, idx: i };
  }

  /**
   * Annulla. `cur` e' lo stato adesso. Ritorna null se non c'e' niente da annullare, altrimenti
   * { points, idx, restore }: lo stato da ripristinare e la storia aggiornata.
   *  · se il corrente DIFFERISCE da points[idx] (dopo un'operazione, o una modifica non registrata) si torna a
   *    points[idx] e il corrente si mette DOPO, per il ripeti;
   *  · altrimenti si fa un passo indietro.
   */
  function undo(points, idx, cur) {
    if (!Array.isArray(points) || idx < 0 || idx >= points.length) return null;
    if (cur !== points[idx]) {
      const p = points.slice(0, idx + 1);
      p.push(cur);
      return { points: p, idx, restore: points[idx] };
    }
    if (idx === 0) return null;
    return { points, idx: idx - 1, restore: points[idx - 1] };
  }

  /**
   * Ripeti: ritorna null se non c'e' un «dopo», altrimenti { points, idx, restore }.
   * `cur` (lo stato adesso) e' facoltativo ma l'app lo passa SEMPRE: se differisce da points[idx] c'e' una modifica
   * che nessuno ha registrato dopo l'annulla (un campo del pannello, un giro silenzioso del monitor) e ripetere la
   * sovrascriverebbe senza dirlo — undo() la conserva, e redo() deve fare altrettanto. La si inserisce come punto
   * subito dopo points[idx]: il ripeti procede, e un Ctrl+Z dopo il ripeti torna a lei prima che al punto di prima.
   */
  function redo(points, idx, cur) {
    if (!Array.isArray(points) || idx + 1 >= points.length) return null;
    if (cur !== undefined && cur !== points[idx]) {
      const p = points.slice(0, idx + 1);
      p.push(cur);
      for (let i = idx + 1; i < points.length; i++) p.push(points[i]);
      let i = idx + 2;                       // il punto da ripristinare, ora spostato di uno
      if (p.length > CAP) { p.shift(); i--; }
      return { points: p, idx: i, restore: points[idx + 1] };
    }
    return { points, idx: idx + 1, restore: points[idx + 1] };
  }

  /**
   * Il pulsante «annulla» e' acceso? `pending` = «dopo l'ultimo punto e' successo qualcosa»: senza, a idx 0 non c'e'
   * niente prima. Serve solo ai pulsanti (a Ctrl+Z decide il confronto vero, in undo()).
   */
  function canUndo(points, idx, pending) {
    return Array.isArray(points) && idx >= 0 && idx < points.length && (!!pending || idx > 0);
  }

  /** Il pulsante «ripeti» e' acceso? */
  function canRedo(points, idx) {
    return Array.isArray(points) && idx + 1 < points.length;
  }

  // ── La tastiera ─────────────────────────────────────────────────────────────
  /**
   * Che cosa chiede questa combinazione di tasti: 'undo', 'redo' o null.
   * La lettera si confronta in MINUSCOLO: con Maiusc (Ctrl+Maiusc+Z) o col Bloc Maiusc il browser dice 'Z', e il
   * confronto con 'z' non scattava mai — il ripeti con Ctrl+Maiusc+Z non ha mai funzionato su una tastiera vera
   * (i test lo davano per buono perche' simulavano il tasto come 'z' minuscolo anche con Maiusc premuto).
   * Ctrl+Y ripete. Con Alt premuto non e' nostro (AltGr, che su molte tastiere e' Ctrl+Alt, scrive lettere).
   * @param {{ctrlKey?:boolean, metaKey?:boolean, shiftKey?:boolean, altKey?:boolean, key?:string}} e
   */
  function shortcutAction(e) {
    if (!e || typeof e !== 'object') return null;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
    const k = String(e.key == null ? '' : e.key).toLowerCase();
    if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (k === 'y') return 'redo';
    return null;
  }

  // Tipi di <input> in cui NON si scrive testo: li' Ctrl+Z non e' del campo, e l'annulla e' quello del progetto.
  // I campi data/ora (garanzia, fine vita...) si compilano a segmenti o dal calendario: il browser non ha una storia
  // di testo da annullare, e con il fuoco li' il Ctrl+Z restava senza effetto invece di annullare il progetto.
  const NON_TEXT_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color', 'hidden',
    'date', 'time', 'month', 'week', 'datetime-local']);

  /**
   * L'elemento col fuoco e' un posto dove si SCRIVE (campo di testo, area di testo, contenteditable)?
   * Li' Ctrl+Z annulla cio' che hai digitato, ed e' il browser a farlo: l'app non deve intercettarlo (prima lo
   * bloccava ovunque, e con passi in storia annullava il progetto al posto del testo). Un campo di sola lettura
   * o disabilitato non si puo' modificare: non ha niente da annullare, il tasto torna all'app.
   * @param {{tagName?:string, type?:string, readOnly?:boolean, disabled?:boolean, isContentEditable?:boolean}|null} el
   */
  function isTextEditingTarget(el) {
    if (!el || typeof el !== 'object') return false;
    if (el.disabled || el.readOnly) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return !NON_TEXT_INPUT.has(String(el.type || 'text').toLowerCase());
    return !!el.isContentEditable;
  }

  return { CAP, OUTSIDE_PHOTO, photo, outsidePhoto, rebuild, record, undo, redo, canUndo, canRedo, shortcutAction, isTextEditingTarget };
});
