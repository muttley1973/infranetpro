'use strict';
// ============================================================
//  lib/snmp-silence.js — «non ha risposto a QUESTA chiave» non è «non parla SNMP».
//
//  Con SNMPv2c una community sbagliata NON produce un errore: l'agente scarta la
//  richiesta in silenzio e il probe va in timeout (RequestTimedOutError). Dal di
//  fuori è indistinguibile da un host che SNMP non ce l'ha — stessa riga, stesso
//  esito — e chi legge conclude «questo parco non è gestito» quando ha solo
//  bussato con la chiave sbagliata. È il fallimento di campo più comune di una
//  scansione, ed è muto per PROTOCOLLO, non per una scorciatoia del codice.
//  (SNMPv3 è un altro discorso: l'engineID si scopre senza credenziali, quindi la
//  discovery sa già dire «agente vivo, servono credenziali» → needsCredentials,
//  badge 🔑. Lì non serve questo motore e infatti non si intromette.)
//
//  ⚠️ Questo motore NON indovina il perché. Dice un FATTO — «silenzioso a questa
//  chiave» — e lo dice SOLO quando qualcosa di AUTOREVOLE ci autorizzava ad
//  aspettarci una risposta. Due autorità, nessuna delle quali è un'euristica:
//
//   · 'neighbor' — un apparato vicino l'ha DICHIARATO via LLDP/CDP. Un vicino xDP
//     è per definizione un apparato gestito, e l'annuncio è un'affermazione DI
//     lui fatta da chi lo vede su una porta adesso: non l'abbiamo dedotto noi.
//     È la stessa distinzione autorevole/osservato di _discAuthoritative e di
//     lib/linkstate.js — sommare indizi fa un numero alto, non una lettura.
//
//   · 'declared' — il progetto lo documenta GIÀ con un driver SNMP (declare-first):
//     che quell'apparato parli SNMP lo dice il DOCUMENTO, non una congettura sul
//     vendor. Qui però la vitalità SERVE: un apparato documentato e SPENTO è
//     assente, non silenzioso, e dirgli «chiave sbagliata» manderebbe qualcuno a
//     cercare una credenziale al posto di un alimentatore.
//
//  ⚠️ Fuori da queste due non si marca NIENTE. Un PC, una stampante o un NAS che
//  non rispondono a SNMP sono corretti così: un badge su ogni host muto sarebbe
//  rumore, e il rumore su un segnale lo cancella — il badge esiste per far
//  ripetere la scansione con l'altra community, non per decorare una tabella.
//
//  ⚠️ Vendor-neutral per COSTRUZIONE (paletto ③): nessun elenco di marche «da
//  rete». Un elenco del genere sarebbe una regola sul lab travestita da classe
//  generale, e si guasterebbe al primo apparato di un vendor che non ci sta.
//
//  Puro: zero IO, zero DOM, zero orologio. Convenzione UMD-lite del progetto.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);               // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const _proto = (r) => String((r && (r.viaProtocol || r.protocol)) || '').trim().toUpperCase();

  /** Una riga di scansione è SILENZIOSA ALLA CHIAVE USATA?
   *  @param {object} row  riga-risultato della discovery
   *  @param {object} [opts] { documentedDriver } = il driver che il PROGETTO
   *         documenta per questo apparato (es. 'snmp-v2c'), se lo si conosce.
   *  @returns {null | { why: 'neighbor'|'declared' }}
   */
  function snmpSilence(row, opts) {
    const r = (row && typeof row === 'object') ? row : null;
    if (!r) return null;
    if (r.snmpReachable) return null;        // ha risposto: non c'è niente da dire
    if (r.needsCredentials) return null;     // v3: la discovery lo dice già, e meglio

    // ① L'ha dichiarato un vicino. L'annuncio È la prova di esistenza: non serve
    // che risponda anche al ping — chi lo annuncia lo sta vedendo su una porta.
    const p = _proto(r);
    if (p === 'LLDP' || p === 'CDP' || r._via === 'lldp') return { why: 'neighbor' };

    // ② Lo dice il documento. Qui la vitalità serve (vedi testata).
    const driver = String((opts && opts.documentedDriver) || '').trim().toLowerCase();
    if (driver.indexOf('snmp') === 0 && (r.alive === true || r.pingReachable === true)) {
      return { why: 'declared' };
    }
    return null;
  }

  /** Quanti, in un elenco di righe. Il numero in cima alla tabella è il vero
   *  destinatario di questo motore: una riga sola si nota poco, «8 apparati non
   *  hanno risposto a questa chiave» fa ripetere la scansione con l'altra. */
  function countSnmpSilent(rows, driverOf) {
    const list = Array.isArray(rows) ? rows : [];
    const of = (typeof driverOf === 'function') ? driverOf : () => '';
    let n = 0;
    for (const r of list) if (snmpSilence(r, { documentedDriver: of(r) })) n++;
    return n;
  }

  return { snmpSilence, countSnmpSilent };
});
