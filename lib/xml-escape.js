// ============================================================
// ESCAPE XML — una definizione sola, per tutti i formati XML che usciamo
// (UMD-lite, Node + browser · puro)
// ============================================================
// L'HTML ha il suo escaper e sta in `src/app-util.js`. L'XML è un altro
// concetto — cinque caratteri, entità XML (`&apos;`, non `&#39;`) — e finché
// esisteva un formato solo (`.drawio`) poteva stare dentro quel modulo. Con il
// secondo (l'SVG della mappa inter-sede nel dossier) sarebbero diventate due
// copie identiche della stessa funzione: e in questo repo il difetto che è
// tornato dodici volte è esattamente questo — due definizioni dello stesso
// concetto, che divergono al primo ritocco e la meno completa vince.
// → [[definizioni-duplicate-motore-renderer]]
//
// ⚠️ NON è intercambiabile con `escapeHTML`: sono contesti diversi, e questo
//    file esiste per tenerli distinti, non per unificarli.
// ⚠️ `.js` e non `.ts`: `engines: node >=16` e la CI gira su 18.x/20.x, dove un
//    `.ts` è un SyntaxError. Vedi `lib/provenance.js`.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /** I cinque caratteri, tutti e cinque. Un escape parziale è peggio di nessun
   *  escape: dà l'impressione che il problema sia stato affrontato.
   *  ⚠️ `&` per primo, o si ri-escaperebbero le entità appena scritte. */
  /** @param {unknown} s @returns {string} */
  function escapeXML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  return { escapeXML };
});
