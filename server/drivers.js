'use strict';
// ============================================================
//  Registry dei driver di polling (estratto da server.js).
// ============================================================
function loadDriver(name) {
  try { return require(`../drivers/${name}`); }
  catch (_) { return null; }
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
