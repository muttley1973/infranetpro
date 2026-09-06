// ============================================================
//  lib/mgmt-url.js — un URL di management è un'AZIONE, non un testo.
//
//  `node.mgmtUrl` è un campo libero: entra dal pannello, da un progetto
//  importato, dall'API. L'escaping lo rende innocuo come TESTO, ma il bottone
//  «Apri» lo USA: lo mette in un <a href> e, per gli schemi non http, in un
//  iframe nascosto che delega all'handler del sistema (PuTTY, mRemoteNG…).
//  Un `javascript:` lì dentro gira nell'origin dell'app con la sessione di
//  chi clicca (smoke 06/09, riprodotto). Qui si decide lo SCHEMA: solo quelli
//  della lista protocolli più http/https; javascript/data/vbscript/blob/file/
//  about mai, qualunque lista arrivi (la lista è personalizzabile dall'utente).
//
//  Puro, condiviso browser/test (stesso UMD degli altri moduli lib/).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Schemi che non sono MAI un management URL: eseguono o leggono, non aprono. */
  const MGMT_URL_DANGEROUS_SCHEMES = /^(javascript|data|vbscript|blob|file|about)$/i;

  /** Schema dell'URL in minuscolo senza «:», '' se non c'è (RFC 3986 §3.1). */
  function mgmtUrlScheme(url) {
    const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(String(url == null ? '' : url));
    return m ? m[1].toLowerCase() : '';
  }

  /**
   * true se `url` ha uno schema ammesso. `allowedSchemes` è una lista di schemi
   * o prefissi come 'ssh://' (la forma della lista protocolli); senza lista
   * passa qualunque schema non pericoloso. Senza schema → false: un URL di
   * management senza schema non apre niente, non è «un po' valido».
   */
  function isSafeMgmtUrl(url, allowedSchemes) {
    const scheme = mgmtUrlScheme(url);
    if (!scheme || MGMT_URL_DANGEROUS_SCHEMES.test(scheme)) return false;
    if (!Array.isArray(allowedSchemes)) return true;
    return allowedSchemes.some(s => String(s || '').replace(/:.*$/, '').trim().toLowerCase() === scheme);
  }

  return { mgmtUrlScheme, isSafeMgmtUrl, MGMT_URL_DANGEROUS_SCHEMES };
});
