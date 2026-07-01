'use strict';
// ============================================================
//  lib/subbar-stats.js — statistiche della sotto-header (PURO, "InfraNet calcola").
//
//  Riassume lo stato del progetto nei tre numeri che la barra mostra a destra:
//    - documentazione: quota di device INDIRIZZABILI (tipo con hasIP) che hanno
//      gia' un IP documentato -> completamento della documentazione d'indirizzamento;
//    - device: nodi reali (esclusi gli elementi strutturali, es. le stanze);
//    - salute SNMP: quanti dei device monitorati via SNMP rispondono "ok".
//
//  Zero invenzioni: usa SOLO campi gia' presenti sul nodo, con le STESSE
//  definizioni del resto dell'app:
//    - withIp = device con .ip valorizzato          (come lib/api-shape.js)
//    - "ha SNMP" = integration.driver ~ /^snmp/ + host|ip   (come src/app-drift.js)
//    - "ok" = node.snmpStatus === 'ok'              (come la spia di stato SNMP)
//  Nessun valore stimato.
//
//  UMD-lite: <script> in netmapper.html PRIMA del bundle -> global bare; in Node require().
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const _str = (v) => (v == null ? '' : String(v)).trim();

  // Un nodo "ha SNMP" se ha un driver d'integrazione snmp* e un host/ip a cui
  // rivolgersi: stessa condizione con cui src/app-drift.js decide chi interrogare.
  function _hasSnmp(n) {
    const integ = (n && n.integration) || {};
    return _str(integ.driver).indexOf('snmp') === 0 && !!_str(integ.host || (n && n.ip));
  }

  // Statistiche compatte per la sotto-header. `types` = catalogo TYPES (per sapere
  // quali tipi sono strutturali o indirizzabili); difensivo se assente/parziale.
  function computeSubbarStats(nodes, types) {
    const list = Array.isArray(nodes) ? nodes : [];
    const T = (types && typeof types === 'object') ? types : {};
    let devices = 0, addressable = 0, withIp = 0, snmpTotal = 0, snmpOk = 0, snmpDown = 0;
    for (const n of list) {
      if (!n || typeof n !== 'object') continue;
      const def = T[n.type] || {};
      if (def.isStructural) continue;           // stanze/aree: non sono device
      devices++;
      if (def.hasIP) {
        addressable++;
        if (_str(n.ip)) withIp++;
      }
      if (_hasSnmp(n)) {
        snmpTotal++;
        if (n.snmpStatus === 'ok') snmpOk++;
        else if (n.snmpStatus === 'err') snmpDown++;   // esplicitamente giu' (vs mai sondato)
      }
    }
    const docPct = addressable > 0 ? Math.round((withIp / addressable) * 100) : null;
    // Salute SNMP: 'ok' se tutti rispondono; 'err' (rosso) SOLO se c'e' un guasto
    // reale (snmpStatus==='err') e nessuno su; altrimenti 'warn' (ambra) — che
    // copre sia il misto sia il "configurato ma non ancora sondato" (mai rosso a
    // sproposito su un progetto appena aperto); 'none' se nessuno e' sotto SNMP.
    let snmpHealth;
    if (snmpTotal === 0) snmpHealth = 'none';
    else if (snmpOk === snmpTotal) snmpHealth = 'ok';
    else if (snmpOk === 0 && snmpDown > 0) snmpHealth = 'err';
    else snmpHealth = 'warn';
    return { devices, addressable, withIp, docPct, snmpTotal, snmpOk, snmpDown, snmpHealth };
  }

  return { computeSubbarStats, _hasSnmp };
});
