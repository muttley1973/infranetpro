// ============================================================
// COL-WIDTHS — larghezze di colonna trascinabili (logica PURA)
// ============================================================
// Nessun DOM, nessun localStorage: qui vivono solo le REGOLE (limiti, calcolo
// della nuova larghezza, forma del dato salvato). Il collegamento a tabella e
// storage sta in src/app-col-resize.js.
//
// Modello: una mappa { indiceColonna(1-based) → larghezza in px }. L'indice è
// 1-based perché è lo stesso di `nth-child` in CSS: chi legge il CSS e chi legge
// questo file parlano della stessa colonna senza conversioni a mente.
//
// ⚠️ Una colonna può restare ELASTICA (nessuna larghezza): assorbe lo spazio
// avanzato e non si trascina. Serve perché la tabella non abbia buchi quando la
// finestra è più larga della somma delle colonne.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Sotto i 32px l'intestazione non si legge più e la maniglia diventa
  // impossibile da agganciare; sopra i 640 si sta solo rompendo la tabella.
  const COL_MIN_PX = 32;
  const COL_MAX_PX = 640;

  function clampColWidth(px, opts) {
    opts = opts || {};
    const min = Number.isFinite(opts.min) ? opts.min : COL_MIN_PX;
    const max = Number.isFinite(opts.max) ? opts.max : COL_MAX_PX;
    const n = Math.round(Number(px));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  // Larghezza risultante da un trascinamento: la larghezza di partenza più lo
  // spostamento del puntatore, dentro i limiti. Separata dal DOM così il caso
  // «trascino a sinistra oltre il minimo» è verificabile senza un browser.
  function resizedWidth(startWidth, deltaPx, opts) {
    return clampColWidth(Number(startWidth) + Number(deltaPx), opts);
  }

  // Nome della variabile CSS di una colonna. Unico posto in cui si decide come
  // si chiama: il CSS la legge, il JS la scrive.
  function colVarName(index, prefix) {
    return '--' + (prefix || 'col') + '-' + Math.trunc(Number(index));
  }

  // Larghezza minima della tabella = somma delle colonne fisse + il pavimento
  // della colonna elastica. È ciò che fa comparire lo scorrimento orizzontale
  // quando l'utente allarga le colonne oltre lo spazio disponibile.
  function tableMinWidth(defaults, widths, elasticFloor) {
    const base = (defaults && typeof defaults === 'object') ? defaults : {};
    const over = (widths && typeof widths === 'object') ? widths : {};
    let sum = 0;
    for (const k of Object.keys(base)) {
      const v = Object.prototype.hasOwnProperty.call(over, k) ? over[k] : base[k];
      const n = Number(v);
      if (Number.isFinite(n)) sum += n;
    }
    const floor = Number(elasticFloor);
    return Math.round(sum + (Number.isFinite(floor) ? floor : 0));
  }

  // ── Forma del dato salvato ──────────────────────────────────────────
  // Difensiva in ENTRAMBE le direzioni: quello che si legge da uno storage è
  // testo scritto da chissà quale versione, e quello che si scrive deve poter
  // essere riletto da una versione futura senza sorprese. Chiavi non numeriche,
  // valori non numerici e larghezze fuori scala si scartano in silenzio: una
  // preferenza illeggibile non deve impedire di aprire una tabella.
  function parseColWidths(raw, opts) {
    let obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch (_) { return {}; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const k of Object.keys(obj)) {
      if (!/^\d+$/.test(k)) continue;
      const v = obj[k];
      // ⚠️ `Number(null)` e `Number('')` valgono 0, che è finito: senza questo
      // filtro un valore VUOTO diventerebbe una colonna larga il minimo invece
      // di essere ignorato, e una preferenza corrotta stringerebbe la tabella.
      if (typeof v !== 'number' && !(typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()))) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      out[k] = clampColWidth(n, opts);
    }
    return out;
  }

  function serializeColWidths(widths, opts) {
    return JSON.stringify(parseColWidths(widths, opts));
  }

  return {
    COL_MIN_PX, COL_MAX_PX,
    clampColWidth, resizedWidth, colVarName, tableMinWidth,
    parseColWidths, serializeColWidths,
  };
});
