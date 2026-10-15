// ============================================================
// SNMP SYNC AUDIT — la riga che la Storia scrive dopo un Sync (pura)
// ============================================================
// La riga diceva «18/18 dispositivi · tutti raggiungibili». Era vera per quello che il
// Sync fa — legge via SNMP gli apparati che hanno un'integrazione SNMP — ma scritta come
// se parlasse del progetto: in un progetto da 47 apparati i «18» erano gli unici che il
// Sync interroga, e gli altri 29 (PC, telecamere, TV, IoT…) non li tocca mai. La loro
// raggiungibilita' la dice la Verifica, col suo controllo di raggiungibilita'. Leggere
// «tutti raggiungibili» a nove giorni di distanza, mentre meta' del lab era spenta, era
// leggere una frase vera su un sottoinsieme come se fosse una frase sul tutto.
//
// Regole della riga ora:
//   • il bersaglio dice COSA e' stato letto: «18/18 apparati SNMP letti»;
//   • l'esito parla di LETTURE («nessun errore di lettura»), non di raggiungibilita';
//   • se ci sono apparati che il Sync non legge, lo dice accanto: «25 senza SNMP, non letti».
//     Sono gli apparati veri: stanze e passivi puri di cablaggio (prese, patch panel) non
//     contano, perche' un «non letto» su una presa a muro e' rumore.
//
// Le righe GIA' scritte non cambiano: il registro e' append-only e conserva il testo di
// quando fu scritto.
//
// Puro: nessun DOM, nessun IO. `stats` e' il risultato di computeSubbarStats
// (lib/subbar-stats.js), che e' gia' LA definizione di «apparato» e di «passivo»: non se ne
// scrive una seconda qui. `t` e' la funzione di traduzione, passata dal chiamante.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // r     : { ok, err, total } — letture riuscite, fallite, bersagli SNMP del giro
  // stats : { devices, passive, snmpTotal } da computeSubbarStats, oppure null
  // t     : (chiave, variabili) → stringa
  // → { target, summary } per logAudit
  function describeSnmpSync(r, stats, t) {
    const ok = (r && r.ok) | 0;
    const err = (r && r.err) | 0;
    const total = (r && r.total) | 0;
    // Gli apparati che il Sync non legge: tutti meno i passivi puri meno i bersagli SNMP.
    // `stats` assente (libreria non caricata) = non si sa, e allora non si dice.
    const notRead = stats
      ? Math.max(0, ((stats.devices | 0) - (stats.passive | 0) - (stats.snmpTotal | 0)))
      : 0;
    const parts = [err ? t('audit.snmpErrors', { n: err }) : t('audit.snmpAllOk')];
    if (notRead > 0) parts.push(t('audit.snmpNotRead', { n: notRead }));
    return { target: t('audit.snmpDevices', { ok, total }), summary: parts.join(' · ') };
  }

  return { describeSnmpSync };
});
