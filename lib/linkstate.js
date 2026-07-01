// Stato esplicito di un link di topologia, DERIVATO dai campi gia' presenti
// (autoLinked, confidence, protocol, lag*) — nessun nuovo stato memorizzato,
// quindi sempre coerente e reversibile. Condiviso browser + test (UMD-lite).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Regola di classificazione semantica (non numerica):
  //
  //   LLDP, CDP                 → "discovered" (lo switch DICHIARA il vicino)
  //   MAC, ARP-MAC, FDB-SEGMENT,
  //   MAC-WALLPORT              → "ambiguous"  (l'app HA DEDOTTO il vicino)
  //
  // La differenza e' qualitativa, non quantitativa: anche un MAC score 8/8
  // (confidence 0.92) resta una INFERENZA dell'app, non una conferma del
  // protocollo di vicinato. Vincere lo score significa solo "ho indovinato
  // con piu' certezza" — non "lo switch me l'ha confermato".
  //
  // AMBIGUOUS_BELOW (0.90) resta come fallback per link legacy senza protocol.
  const TRUSTED_PROTOCOLS = new Set(['LLDP', 'CDP']);
  const AMBIGUOUS_BELOW = 0.90; // solo fallback per link legacy

  const LABELS = {
    manual:     'Manuale',
    lag:        'LAG',
    discovered: 'Scoperto',
    ambiguous:  'Inferito · da verificare',
  };

  // Ritorna { key, label, confidence, protocol } per un oggetto link.
  function linkState(link) {
    const l = link || {};
    const confidence = (typeof l.confidence === 'number') ? l.confidence : null;
    const protocol = String(l.protocol || '').trim();
    const protoUpper = protocol.toUpperCase();
    let key;
    if (!l.autoLinked) {
      key = 'manual';                              // creato/confermato dall'utente
    } else if (l.lagLogicalKey || l.lagMemberPair) {
      key = 'lag';                                 // membro di un bundle LAG
    } else if (protocol && TRUSTED_PROTOCOLS.has(protoUpper.split('+')[0])) {
      key = 'discovered';                          // vicino dichiarato (LLDP/CDP), incluse
                                                   // label fuse 'LLDP+MAC'/'CDP+MAC' (GAP 1:
                                                   // il MAC corrobora, non degrada)
    } else if (protocol) {
      key = 'ambiguous';                           // inferito (MAC*, MAC+ARP, ARP-MAC, FDB-SEGMENT)
    } else if (confidence != null && confidence < AMBIGUOUS_BELOW) {
      key = 'ambiguous';                           // legacy: niente protocol, conf bassa
    } else {
      key = 'discovered';                          // legacy: niente protocol, conf alta
    }
    // i18n: risolve a call-time via t() globale (browser); fallback IT in Node/test.
    const label = (typeof t === 'function') ? t('linkstate.' + key) : LABELS[key];
    return { key, label, confidence, protocol };
  }

  return { linkState, AMBIGUOUS_BELOW, TRUSTED_PROTOCOLS, LINK_STATE_LABELS: LABELS };
});
