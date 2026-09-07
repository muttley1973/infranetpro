// ============================================================
// USER TEXT — la forma di una stringa che l'utente SCEGLIE.
// ============================================================
// Nome di un progetto, di una sede, di una skin; etichetta di un token. Sono
// dichiarazioni: il contenuto è suo e non si giudica. Ma la FORMA sì, e per due
// ragioni misurate, non immaginate (sonda dell'08/09):
//
//  ① **Nessun tetto.** Un nome da 2 MB veniva scritto per intero: 2 048 KB di
//     file di progetto, 4 096 KB di `organization.json`, 2 048 KB di
//     `api-tokens.json` — per un campo che a schermo sta in una riga. Da lì quel
//     nome torna in ogni elenco, in ogni PDF e nel nome del file scaricato.
//
//  ② **Nessuna igiene.** `\r\n`, NUL e le sequenze ESC entravano tali e quali.
//     È esattamente ciò che il validatore del puntatore backup RIFIUTA da sempre
//     (`lib/backup-ref.js`, motivo 'charset': «eviterebbero il quoting quando
//     l'AI cuce il valore nel playbook») e ciò che si toglie dai nomi NetBIOS
//     letti dalla rete. La stessa regola mancava sul lato più ovvio — quello che
//     l'utente digita — ed è la forma classica della regola applicata a metà.
//     ⚠️ Un a-capo dentro un nome non è un carattere: in un inventario Ansible è
//     una riga nuova, in un CSV una colonna nuova, in un log una voce nuova.
//
// Il contenuto NON si tocca: niente maiuscole «giuste», niente accenti tolti,
// niente parole vietate. Si tolgono i caratteri che non si possono rappresentare
// e si mette un tetto — il resto è dell'utente (paletto ①, manual-first).
//
// PURA, senza DOM né IO. UMD-lite: require() in Node/test, global nel browser.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 200 caratteri. Misurato sul vero: i nomi di progetto stanno sotto i 40, un
  // nome di sede sotto i 30, un'etichetta token sotto i 25. Duecento è largo
  // cinque volte il caso peggiore visto — non dice di no a nessuno — e toglie
  // l'ordine di grandezza in cui un campo diventa un file.
  var USER_TEXT_MAX = 200;

  /** Caratteri di controllo: sotto lo spazio (NUL, TAB, CR, LF, ESC…) e DEL.
   *  Confronto numerico e non regex, per non lasciare byte strani nel sorgente
   *  (⚠️ un NUL crudo in un file lo rende invisibile a `grep` e a git). */
  function _isCtrl(code) { return code < 0x20 || code === 0x7f; }

  /**
   * La stringa come si può scrivere su disco: senza caratteri di controllo,
   * senza spazi ai bordi, non più lunga di `max`.
   * Ritorna sempre una STRINGA (mai null/undefined): chi chiama scrive un campo.
   */
  function cleanUserText(v, max) {
    var limite = (typeof max === 'number' && max > 0) ? Math.floor(max) : USER_TEXT_MAX;
    var s = (v == null) ? '' : String(v);
    var out = '';
    for (var i = 0; i < s.length && out.length < limite; i++) {
      var c = s.charCodeAt(i);
      if (!_isCtrl(c)) out += s[i];
    }
    return out.trim();
  }

  /** Come sopra, ma dice anche COSA ha dovuto togliere: serve a chi vuole
   *  avvisare l'utente invece di correggerlo in silenzio. */
  function inspectUserText(v, max) {
    var s = (v == null) ? '' : String(v);
    var pulita = cleanUserText(s, max);
    var limite = (typeof max === 'number' && max > 0) ? Math.floor(max) : USER_TEXT_MAX;
    var controlli = false;
    for (var i = 0; i < s.length; i++) if (_isCtrl(s.charCodeAt(i))) { controlli = true; break; }
    return { value: pulita, hadControls: controlli, wasTooLong: s.length > limite };
  }

  return { cleanUserText, inspectUserText, USER_TEXT_MAX };
});
