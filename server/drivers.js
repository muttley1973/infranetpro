'use strict';
// ============================================================
//  Registry dei driver di polling (estratto da server.js).
// ============================================================
function loadDriver(name) {
  try { return require(`../drivers/${name}`); }
  catch (e) {
    // Un errore di caricamento (sintassi/dipendenza nel driver) NON deve restare muto:
    // altrimenti ogni voce DRIVERS diventa null e i chiamanti riportano il generico
    // "Driver non supportato", nascondendo la causa vera. Lo rendiamo visibile.
    console.error(`[drivers] impossibile caricare '${name}': ${(e && e.message) || e}`);
    return null;
  }
}

const DRIVERS = {
  'snmp-v1':  loadDriver('snmp'),
  'snmp-v2c': loadDriver('snmp'),
  'snmp-v3':  loadDriver('snmp'),
  // 'auto' = rilevamento unificato (v2c con community + v3 engineID senza creds).
  // Stesso modulo: la scelta delle versioni da provare è dentro probe().
  'auto':     loadDriver('snmp'),
};

module.exports = { loadDriver, DRIVERS };
