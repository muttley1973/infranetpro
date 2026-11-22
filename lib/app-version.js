// ============================================================
// APP-VERSION — la versione sotto il logo, e dove porta il clic
// (UMD-lite, browser + Node · puro · vendor-neutral)
// ============================================================
// Sotto il logo della testata sta la versione dell'app, e il clic porta alla storia
// delle modifiche su GitHub. La versione NON e' scritta nella pagina: la dice il server
// (`/api/auth/me`, dal `package.json`), cosi' non e' un quinto posto da ricordare al
// rilascio — i quattro che ci sono (package.json, lock x2, login.html) restano i soli.
//
// Un numero che non e' un numero di versione non finisce nella testata: `versionLabel`
// restituisce '' e l'etichetta resta nascosta. Succede con un server piu' vecchio della
// pagina (non manda ancora il campo) — meglio niente che «vundefined».

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // La storia delle modifiche: il CHANGELOG del ramo principale, che esiste sempre
  // (la pagina di una Release esiste solo dopo che l'utente l'ha pubblicata).
  // ⚠️ Lo stesso indirizzo sta, scritto, nell'`href` di `#app-version` in netmapper.html
  // (un link che funziona anche se lo script non parte): `test/app-version.test.js` li
  // pretende uguali.
  const CHANGELOG_URL = 'https://github.com/muttley1973/infranetpro/blob/main/CHANGELOG.md';

  const SEMVER = /^\d+\.\d+\.\d+$/;

  /** @param {unknown} v la versione come la manda il server («2.13.1»)
   *  @returns {string} «v2.13.1», oppure '' se non e' un numero x.y.z */
  function versionLabel(v) {
    return (typeof v === 'string' && SEMVER.test(v)) ? 'v' + v : '';
  }

  return { CHANGELOG_URL, versionLabel };
});
