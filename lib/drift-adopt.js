// ============================================================
// DRIFT ADOPT — "adotta i non documentati" (modello puro)
// ============================================================
// Dalla categoria Drift "In rete, non documentati" (MAC visti nelle FDB degli
// switch ma assenti dal progetto) costruisce le righe-candidato da mostrare in
// una schermata di selezione stile "Scopri": MAC + vendor (OUI) + VLAN + dove
// è stato visto + un tipo di default indovinato. Funzione PURA: helper iniettati
// (vendorOf, guessType) → output deterministico, nessun DOM/state. La creazione
// dei nodi e l'auto-link vivono nel glue (riusano _autoLinkEndpoint & co.).
//
// INPUT  rows = [ { key, sig, mac, label, cls, vlan, ip?, hostname? } ]   (driftReport.undocumented;
//        ip/hostname presenti SOLO per l'adozione da lease DHCP — il MAC FDB non li ha)
//        opts = { vendorOf(mac)->string, guessType(vendor)->type|'' }
// OUTPUT [ { key, mac, vendor, vlan, seenOn, cls, typeDefault, ip, hostname } ]
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // "vista su Sw1 · Gi0/3" → "Sw1 · Gi0/3" (toglie il prefisso ridondante)
  function _seenOn(label) {
    return String(label || '').replace(/^\s*vist[ao]\s+su\s*/i, '').trim();
  }

  function buildAdoptCandidates(rows, opts) {
    const list = Array.isArray(rows) ? rows : [];
    opts = opts || {};
    const vendorOf = typeof opts.vendorOf === 'function' ? opts.vendorOf : () => '';
    const guessType = typeof opts.guessType === 'function' ? opts.guessType : () => '';

    return list.map(r => {
      const mac = String(r.mac || '');
      const vendor = vendorOf(mac) || '';
      const cls = r.cls === 'endpoint' ? 'endpoint' : 'infra';
      // Tipo di default: prova l'euristica (vendor); in mancanza, fallback per
      // classe — endpoint→pc, infrastruttura→switch.
      const guessed = guessType(vendor) || '';
      const typeDefault = guessed || (cls === 'endpoint' ? 'pc' : 'switch');
      return {
        key: r.key,
        mac,
        vendor,
        vlan: r.vlan != null ? r.vlan : null,
        seenOn: _seenOn(r.label),
        cls,
        typeDefault,
        ip: String(r.ip || ''),            // valorizzato solo per i candidati da lease DHCP
        hostname: String(r.hostname || ''), // idem (nome dal lease) → nodo adottato documentato subito
      };
    });
  }

  return { buildAdoptCandidates };
});
