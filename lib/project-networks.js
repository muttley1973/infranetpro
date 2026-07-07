// ============================================================
// PROJECT-NETWORKS — estrazione PURA delle /24 presenti nel progetto
// ============================================================
// "Se nel progetto ci sono device di subnet diverse, estrapola le network da
// contattare dai device già presenti (e dai lease DHCP)". Da qui il workflow
// (verifica presenza → SNMP → LLDP/CDP → topologia) sa QUALI reti toccare e in
// che stato sono, senza che l'utente digiti i CIDR a mano.
//
// deriveProjectNetworks({ nodes, leases }) → { networks: [ ... ] }
//   Ogni network (una /24):
//     { net:'192.168.1', cidr:'192.168.1.0/24',
//       deviceCount, leaseCount, ips:[...],
//       snmpSources:[{ id, ip, type, driver, reachable }],   // device SNMP su quella /24
//       snmpReachable, snmpUnreachable,                       // conteggi
//       reachableSwitch, blockedSwitch,                       // sorgente L2 (switch) raggiungibile? bloccata?
//       status: 'covered' | 'blocked' | 'open' }
//   status (per il workflow):
//     covered  = c'è ≥1 SWITCH SNMP raggiungibile → topologia L2 ricostruibile
//     blocked  = c'è uno switch SNMP ma NESSUNO raggiungibile (creds/errore) → azione utente
//     open     = nessuno switch SNMP raggiungibile → serve uno scan / verifica presenza
//               (può avere router/host SNMP o solo lease → presenza sì, topologia no)
//
// Regola cardine: NON contatta nulla e NON inventa — deriva SOLO ciò che è già
// documentato. Il "contattare" (sweep/scan) resta un'azione esplicita a valle
// (manual-first · anti-IDS). Vendor-neutral. Condivisa browser + test (UMD-lite).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _net24(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
    if (!m) return null;
    for (let i = 1; i <= 4; i++) if (+m[i] > 255) return null;
    return `${m[1]}.${m[2]}.${m[3]}`;
  }

  function _nodeIp(n) {
    return (((n && n.integration && n.integration.host) || (n && n.ip) || '')).toString().trim();
  }
  function _nodeDriver(n) {
    return String((n && n.integration && n.integration.driver) || '').toLowerCase();
  }

  function deriveProjectNetworks(model) {
    const nodes = (model && Array.isArray(model.nodes)) ? model.nodes : [];
    const leases = (model && Array.isArray(model.leases)) ? model.leases : [];

    const map = new Map();   // net → record accumulatore
    const ensure = net => {
      let r = map.get(net);
      if (!r) { r = { net, cidr: net + '.0/24', deviceCount: 0, leaseCount: 0, ips: new Set(), snmpSources: [] }; map.set(net, r); }
      return r;
    };

    for (const n of nodes) {
      const ip = _nodeIp(n);
      const net = _net24(ip);
      if (!net) continue;
      const r = ensure(net);
      r.deviceCount++;
      r.ips.add(ip);
      const drv = _nodeDriver(n);
      if (drv.startsWith('snmp')) {
        r.snmpSources.push({
          id: n.id, ip, type: String(n.type || ''), driver: drv,
          reachable: n.snmpStatus === 'ok',
        });
      }
    }

    for (const l of leases) {
      const net = _net24(l && l.ip);
      if (!net) continue;
      const r = ensure(net);
      r.leaseCount++;
      r.ips.add(String(l.ip).trim());
    }

    // Tipi che forniscono una FDB bridge (sorgente L2 per la topologia). Vendor-neutral:
    // uno switch (e, in alcuni casi, un firewall/wlanctrl che fa bridging) impara i MAC;
    // un router puro no. La lista resta conservativa: `switch` è il segnale forte.
    const L2_TYPES = new Set(['switch']);

    const networks = [];
    for (const r of map.values()) {
      const snmpReachable = r.snmpSources.filter(s => s.reachable).length;
      const snmpUnreachable = r.snmpSources.length - snmpReachable;
      const switchSrc = r.snmpSources.filter(s => L2_TYPES.has(s.type));
      const reachableSwitch = switchSrc.some(s => s.reachable);
      const blockedSwitch = !reachableSwitch && switchSrc.length > 0;
      const status = reachableSwitch ? 'covered' : (blockedSwitch ? 'blocked' : 'open');
      networks.push({
        net: r.net, cidr: r.cidr,
        deviceCount: r.deviceCount, leaseCount: r.leaseCount,
        ips: [...r.ips].sort(),
        snmpSources: r.snmpSources,
        snmpReachable, snmpUnreachable,
        reachableSwitch, blockedSwitch,
        status,
      });
    }
    // Ordina: prima le reti con più device, poi per /24 crescente (stabile).
    networks.sort((a, b) => b.deviceCount - a.deviceCount || a.net.localeCompare(b.net, 'en'));
    return { networks };
  }

  return { deriveProjectNetworks, _net24ForTest: _net24 };
});
