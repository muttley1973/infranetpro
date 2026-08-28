'use strict';
// ============================================================================
//  lib/dcim-site-proposal.js — dopo l'import: questo progetto è una SEDE?
// ----------------------------------------------------------------------------
//  L'import DCIM crea un progetto e registra da quale sito NetBox nasce
//  (`state.source.dcim.sites`). Il layer multi-sede lega organizzazione e
//  progetto con `site.projectRef`. Fra le due cose non c'era niente: si
//  importava una sede e la mappa inter-sede continuava a non conoscerla, finché
//  qualcuno non la ricreava a mano — sapendo che quel passaggio esisteva.
//
//  Questo modulo decide COSA PROPORRE, e basta. Non scrive: risponde a una
//  domanda pura, così la si può provare senza server né DOM.
//
//  ── Le scelte, e perché ────────────────────────────────────────────────────
//
//   ① **Si propone, non si fa.** L'iscrizione all'organizzazione è una
//      dichiarazione dell'azienda: la scrive una persona, con un clic in più.
//      Un import che si aggiunge da solo alla mappa deciderebbe al posto suo
//      che quel progetto È una sede (paletto ①).
//
//   ② **Un progetto nato da PIÙ siti non si propone.** Il modello dice un sito
//      = un progetto; creare due sedi che puntano allo stesso progetto sarebbe
//      scrivere una cosa falsa, e sceglierne una sola sarebbe peggio. Si dice
//      che cosa è successo e come rifarlo — l'ambito nel wizard.
//
//   ③ **Un'omonima che punta ALTROVE non si tocca.** È lavoro di qualcuno:
//      sovrascrivere il suo `projectRef` cancellerebbe un legame dichiarato.
//      Si segnala e ci si ferma. Se invece l'omonima è LIBERA (nessun
//      progetto), si propone di collegarla — non di crearne una seconda con lo
//      stesso nome, che sarebbe la stessa sede scritta due volte.
//
//   ④ **Si riempie solo ciò che si SA:** il nome (lo dice NetBox) e il
//      riferimento al progetto (è un fatto). Ruolo `standalone` come ogni sede
//      nuova; indirizzo e subnet restano vuoti — le reti hanno già la loro
//      azione dedicata nel pannello, e farlo anche qui sarebbe la stessa
//      operazione definita in due posti.
//
//  UMD-lite: `<script>` in netmapper.html → global; in Node `require()`.
// ============================================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const _str = (v) => (v == null ? '' : String(v)).trim();
  /** Confronto di riferimenti-progetto: `projectRef` è testo nel modello e
   *  numero nella lista progetti — `'23' === 23` è falso. */
  const _sameRef = (a, b) => a != null && b != null && String(a) === String(b);

  /**
   * @param {{sites?:Array<{id?:string,name?:string,projectRef?:*}>}|null} org
   * @param {Array<{id?:*,name?:*}>|null} originSites  da `state.source.dcim.sites`
   * @param {*} projectId  il progetto appena creato
   * @returns {{kind:string, siteName?:string, existing?:object, sites?:Array}}
   *   kind: 'already' | 'multi' | 'none' | 'link' | 'create' | 'conflict'
   */
  function proposeSite(org, originSites, projectId) {
    const sites = (org && Array.isArray(org.sites)) ? org.sites : [];
    const origine = Array.isArray(originSites) ? originSites.filter(s => s && _str(s.name)) : [];

    // Già iscritto: la domanda non si pone più, e ripeterla sarebbe rumore.
    const legato = sites.find(s => s && _sameRef(s.projectRef, projectId));
    if (legato) return { kind: 'already', existing: legato, siteName: _str(legato.name) };

    if (!origine.length) return { kind: 'none' };
    if (origine.length > 1) return { kind: 'multi', sites: origine.map(s => _str(s.name)) };

    const nome = _str(origine[0].name);
    const omonima = sites.find(s => s && _str(s.name).toLowerCase() === nome.toLowerCase());
    if (omonima) {
      // ③ Libera → si collega. Occupata da un altro progetto → non si tocca.
      if (_str(omonima.projectRef)) return { kind: 'conflict', siteName: nome, existing: omonima };
      return { kind: 'link', siteName: nome, existing: omonima };
    }
    return { kind: 'create', siteName: nome };
  }

  /**
   * Applica la proposta e restituisce una COPIA dell'organizzazione. Non muta
   * l'originale: chi ha in mano l'org di partenza deve poterla ancora leggere
   * se il salvataggio fallisce.
   * @param {*} org @param {{kind:string,siteName?:string,existing?:object}} prop
   * @param {*} projectId @param {function():string} nuovoId
   */
  function applyProposal(org, prop, projectId, nuovoId) {
    const base = (org && typeof org === 'object') ? org : {};
    const out = Object.assign({}, base, { sites: (base.sites || []).map(s => Object.assign({}, s)) });
    if (!prop || (prop.kind !== 'create' && prop.kind !== 'link')) return out;

    if (prop.kind === 'link') {
      const s = out.sites.find(x => x && _str(x.name).toLowerCase() === _str(prop.siteName).toLowerCase());
      if (s) s.projectRef = String(projectId);
      return out;
    }
    out.sites.push({
      id: nuovoId(),
      name: _str(prop.siteName),
      role: 'standalone',
      projectRef: String(projectId),
      address: null,
      subnets: [],          // ④ le reti hanno la loro azione: qui non si indovina
    });
    return out;
  }

  return { proposeSite, applyProposal };
});
