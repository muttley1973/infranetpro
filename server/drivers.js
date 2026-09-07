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

// ⚠️ Prototipo NULLO, non `{}`. Il nome del driver arriva dal body della richiesta e
// il registro si interroga con `DRIVERS[nome]`: con un oggetto letterale
// `DRIVERS['constructor']` (o 'toString', 'valueOf', '__proto__'…) risponde con un
// membro di Object.prototype, che è TRUTHY — quindi supera il `if (!drv)` di ogni
// rotta e fallisce piu' avanti. Misurato: `POST /api/poll {driver:'constructor'}`
// rispondeva «drv.poll is not a function» invece di «Driver non supportato», e in
// /api/crawl il finto driver entrava nel motore. Senza prototipo, un nome che non
// abbiamo messo noi vale `undefined`, che è la risposta giusta.
const DRIVERS = Object.assign(Object.create(null), {
  'snmp-v1':  loadDriver('snmp'),
  'snmp-v2c': loadDriver('snmp'),
  'snmp-v3':  loadDriver('snmp'),
  // 'auto' = rilevamento unificato (v2c con community + v3 engineID senza creds).
  // Stesso modulo: la scelta delle versioni da provare è dentro probe().
  'auto':     loadDriver('snmp'),
});

module.exports = { loadDriver, DRIVERS };
