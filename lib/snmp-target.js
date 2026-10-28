// ============================================================
// SNMP-TARGET — «questo apparato si interroga con SNMP?», in UN posto solo
// ============================================================
// Due domande diverse, che il codice si faceva da solo in una dozzina di punti:
//
//   isSnmpDriver(driver)     il driver d'integrazione è uno SNMP (snmp-v1 / snmp-v2c /
//                            snmp-v3)? Basta il driver: serve a chi guarda COME è
//                            configurato un apparato (il chip «SNMP» sul tile, la
//                            chiave con cui ripetere una scansione).
//   hasSnmpTarget(node)      l'apparato ha un accesso SNMP USABILE, cioè il driver E un
//                            indirizzo a cui rivolgersi? È la domanda che decide chi
//                            interrogare (Sync, Verifica, auto-link, Topologia) e il
//                            denominatore di «N di N rispondono».
//
// L'indirizzo è UNO solo: `integration.host` se scritto, altrimenti l'IP del nodo,
// tagliati degli spazi (`snmpTargetHost`). È la stessa espressione che i poller
// scrivevano a mano a ogni chiamata — `(cfg.host || n.ip || '').trim()` — e che i
// filtri ricopiavano per decidere se un nodo fosse interrogabile: se le due copie
// divergono, un nodo risulta «da interrogare» e poi non ha un host.
//
// ⚠️ Perché non si ricopia (misurato prima di scriverla, sul codice di 2.11.19):
//   • il conteggio della sotto-header (`subbar-stats`) NON faceva la minuscola, l'API
//     v1 sì: con un driver `SNMP-V2C` l'app diceva «0 apparati SNMP» e l'API
//     `snmp: true` — e il server (`drivers/snmp.js`) accetta il driver in qualunque
//     maiuscola, quindi l'apparato si interrogava davvero;
//   • un host fatto di soli spazi: l'API ripiegava sull'IP del nodo, l'app no, e il
//     poller (che usa `host || ip` e poi taglia) non ha un indirizzo da interrogare;
//   • due commenti, in `lib/overview.js` e `lib/subbar-stats.js`, dicevano «una
//     definizione sola» sopra due funzioni identiche. Un commento non è una guardia:
//     la guardia è `test/snmp-target-unica-definizione.test.js`.
//
// UMD-lite come le altre lib pure: <script> in netmapper.html PRIMA di chi la usa
// (global bare), in Node require(), nel bundle `import`. Nessuna dipendenza, nessun DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);               // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const _s = (v) => (v == null ? '' : String(v)).trim();

  /** Il driver è uno SNMP? Senza badare a maiuscole e spazi: il server li accetta così. */
  function isSnmpDriver(driver) {
    return _s(driver).toLowerCase().indexOf('snmp') === 0;
  }

  /** L'apparato è configurato con un driver SNMP (con o senza indirizzo). */
  function hasSnmpDriver(node) {
    return isSnmpDriver(node && node.integration && node.integration.driver);
  }

  /** A chi si rivolge il poller: `integration.host`, altrimenti l'IP del nodo (o `ip`,
   *  se il chiamante ne ha già risolto uno migliore). '' se non c'è nessun indirizzo. */
  function snmpTargetHost(node, ip) {
    const integ = (node && node.integration) || {};
    // `ip` conta solo se è una stringa: così un `.filter(hasSnmpTarget)` che passa
    // l'indice come secondo argomento non viene scambiato per un indirizzo.
    return _s(integ.host || (typeof ip === 'string' ? ip : node && node.ip));
  }

  /** Accesso SNMP usabile: driver SNMP E un indirizzo a cui rivolgersi. */
  function hasSnmpTarget(node, ip) {
    return hasSnmpDriver(node) && snmpTargetHost(node, ip) !== '';
  }

  return { isSnmpDriver, hasSnmpDriver, snmpTargetHost, hasSnmpTarget };
});
