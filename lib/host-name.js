// ============================================================
// HOST NAME — un nome di host «leggibile» o un blob generato da una macchina (puro)
// ============================================================
// La tabella Scopri sceglie il nome da mostrare fra modello, hostname e IP: un hostname che e'
// solo un UUID, un MAC o un seriale esadecimale non dice niente e va scartato in favore
// dell'IP. Ma la regola di prima — «gruppi esadecimali separati da trattini» — scartava
// anche nomi veri fatti di sillabe che per caso sono lettere a-f e cifre: `dc-01` (domain
// controller), `db-01`, `ad-02`, `fe-01`, `ac-1a`. Un amministratore che chiama cosi' i suoi
// server vedeva comparire l'IP al posto del nome che aveva scelto.
//
// LA REGOLA: e' un blob se la parte esadecimale e' LUNGA come un identificatore — un UUID
// (32 cifre), un MAC (12), un seriale — non se ha la forma di un nome corto. La soglia e'
// 12 cifre esadecimali in tutto (il MAC piu' corto che si scrive con i trattini), e ogni gruppo
// deve avere almeno 2 cifre: `dc-01` ha 4 cifre ed e' un nome; `5f2a9c1e-0b3d-4c8e-9a41-
// 7d6e2b1f3a90` ne ha 32 ed e' un UUID; `aa-bb-cc-dd-ee-ff` ne ha 12 ed e' un MAC.
//
// Puro: nessun DOM, nessun IO. Condiviso browser (import ESM) + test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_BLOB_HEX = 12;

  function isJunkHostName(h) {
    const s = String(h == null ? '' : h).trim().toLowerCase().replace(/\.local\.?$/, '').replace(/\.$/, '');
    if (!s) return true;
    // gruppi esadecimali (>= 2 cifre ciascuno) separati da trattini: UUID, MAC con trattini…
    if (/^[0-9a-f]{2,}(-[0-9a-f]{2,})+$/.test(s)) return s.replace(/-/g, '').length >= MIN_BLOB_HEX;
    if (/^[0-9a-f]{12,}$/.test(s)) return true;                  // blob esadecimale lungo
    // Hostname AUTO-GENERATO dal device: codice-brand corto + seriale/MAC esadecimale, senza
    // separatori/parole (HP «HPF4390962F234», Brother «BRW008077…», ESP). E' lo SCHEMA (poche
    // lettere + molti hex) a non essere leggibile, non un marchio specifico. «GS1900» (modello,
    // 4 cifre) e «DESKTOP-ABC123» (separatore) NON combaciano e restano.
    if (/^[a-z]{2,6}[0-9a-f]{8,}$/.test(s)) return true;
    return false;
  }

  return { isJunkHostName };
});
