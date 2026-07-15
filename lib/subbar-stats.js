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

  // Un pid porta ("<nodeId>-<n>", con nodeId che puo' contenere '-') -> il nodo.
  // Prefisso piu' lungo che e' un id noto (come pidToNode altrove).
  function _nodeOfPid(pid, byId) {
    const p = String(pid == null ? '' : pid).split('-');
    for (let i = p.length - 1; i >= 1; i--) {
      const c = p.slice(0, i).join('-');
      if (byId[c]) return byId[c];
    }
    return null;
  }

  // Cavi documentati che la vista Topologia NON puo' mostrare perche' il rack
  // coinvolto non e' stato piazzato sulla planimetria (rack.x assente). Senza
  // l'icona del rack sul piano non c'e' ne' la LINEA (serve rack piazzato ai due
  // capi, come rackPairEntry in lib/topo-lines.js) ne' il BADGE intra-rack (serve
  // comunque il rack sul piano) -> sono i cavi "silenziosi" che confondono
  // ("ci sono i cavi ma la topologia e' vuota", diagnosi 61ª). Solo i cavi fra
  // device RACK-MOUNTED (types[t].isRack) possono sparire cosi': floor↔floor e
  // misti floor↔rack hanno gia' una resa (linea/fanout) indipendente dai rack.
  // Ritorna null se non c'e' nulla di nascosto; altrimenti { hidden, racks:[nomi] }.
  function computeTopoHiddenCables(nodes, links, racks, types) {
    const T = (types && typeof types === 'object') ? types : {};
    const rackPlaced = Object.create(null);
    const rackName = Object.create(null);
    for (const r of (Array.isArray(racks) ? racks : [])) {
      if (!r || r.id == null) continue;
      rackPlaced[r.id] = r.x !== undefined && r.x !== null;
      rackName[r.id] = _str(r.name) || String(r.id);
    }
    const byId = Object.create(null);
    for (const n of (Array.isArray(nodes) ? nodes : [])) if (n && n.id != null) byId[n.id] = n;
    const _isRack = (n) => !!(n && T[n.type] && T[n.type].isRack);
    // Device rack-mounted "sul piano" solo se ha un rack E quel rack e' piazzato.
    const _onPlan = (n) => !!(n && n.rackId != null && rackPlaced[n.rackId]);

    let hidden = 0;
    const unplaced = new Set();
    for (const l of (Array.isArray(links) ? links : [])) {
      if (!l) continue;
      const sn = _nodeOfPid(l.src != null ? l.src : (l.a != null ? l.a : l.from), byId);
      const dn = _nodeOfPid(l.dst != null ? l.dst : (l.b != null ? l.b : l.to), byId);
      if (!sn || !dn) continue;
      if (!(_isRack(sn) && _isRack(dn))) continue;   // solo cavi tra device rack-mounted
      if (_onPlan(sn) && _onPlan(dn)) continue;       // entrambi sul piano -> linea o badge (mostrato)
      hidden++;
      if (!_onPlan(sn) && sn.rackId != null) unplaced.add(sn.rackId);
      if (!_onPlan(dn) && dn.rackId != null) unplaced.add(dn.rackId);
    }
    if (!hidden) return null;
    const ids = [...unplaced];
    return { hidden, rackIds: ids, racks: ids.map((id) => rackName[id] || String(id)) };
  }

  return { computeSubbarStats, computeTopoHiddenCables, _hasSnmp };
});
