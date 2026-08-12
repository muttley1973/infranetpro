// COSA DICHIARA IL DCIM — la vista in sola lettura di `node.source`.
//
// L'import NetBox riempie `node.source` (tenant, stato, ruolo, platform…) ma fino
// a oggi NESSUNA schermata lo leggeva: dato corretto e invisibile. Questo modulo
// decide COSA di quel blocco vale la pena mostrare a una persona, e in che ordine.
//
// ⚠️ Perché in sola lettura, e perché NON nelle note:
//   - `node.source` appartiene all'IMPORT, `node.notes` appartiene a TE. Travasare
//     il tenant nella prosa delle note significherebbe rileggerlo con una regex al
//     giro dopo — lo stesso difetto già eliminato con gli avvisi strutturati — e
//     riscrivendo verso NetBox se lo ritroverebbe nella `description`.
//   - Non serve un campo nuovo: il dato c'è già ed è già strutturato. Mancava solo
//     qualcuno che lo disegnasse.
// Chi vuole dichiarare un responsabile PROPRIO usa le note, che sono sue.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ordine di lettura umano: di chi è → com'è dichiarato → che mestiere fa → che NOS
  // monta. Gli slug tecnici (deviceTypeSlug/manufacturerSlug/catalogMatch) restano
  // fuori: servono a ri-agganciare il catalogo, non a farsi leggere.
  const SOURCE_FIELDS = [
    { key: 'tenant',       label: 'src.tenant' },
    { key: 'status',       label: 'src.status' },
    { key: 'roleSlug',     label: 'src.role' },
    { key: 'platformName', label: 'src.platform' },
  ];

  function _clean(v) {
    if (v == null) return '';
    const s = String(v).trim();
    return s;
  }

  // Le righe da mostrare: SOLO i campi che il DCIM ha davvero dichiarato. Un campo
  // assente non produce una riga con un trattino — l'assenza si mostra tacendo,
  // altrimenti un vuoto si legge come un dato.
  function sourceRows(node) {
    const src = node && node.source;
    if (!src || typeof src !== 'object') return [];
    const out = [];
    SOURCE_FIELDS.forEach(function (f) {
      const v = _clean(src[f.key]);
      if (v) out.push({ key: f.key, label: f.label, value: v });
    });
    return out;
  }

  /** C'è qualcosa da mostrare? Serve a non disegnare un'intestazione vuota. */
  function hasSource(node) {
    return sourceRows(node).length > 0;
  }

  /** Quanti apparati portano una dichiarazione DCIM, per campo. Per i conteggi. */
  function sourceCoverage(nodes) {
    const out = { total: 0, withAny: 0 };
    SOURCE_FIELDS.forEach(function (f) { out[f.key] = 0; });
    (Array.isArray(nodes) ? nodes : []).forEach(function (n) {
      if (!n) return;
      out.total++;
      const rows = sourceRows(n);
      if (rows.length) out.withAny++;
      rows.forEach(function (r) { out[r.key]++; });
    });
    return out;
  }

  return { SOURCE_FIELDS, sourceRows, hasSource, sourceCoverage };
});
