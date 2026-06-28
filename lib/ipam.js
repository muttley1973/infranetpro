// ============================================================
// IPAM USAGE — occupazione reale di una subnet (report puro)
// ============================================================
// Dato il CIDR dichiarato di una VLAN (IPAM-lite), gli IP dei nodi DOCUMENTATI
// e gli IP dei lease DHCP ATTIVI, calcola l'occupazione: quanti indirizzi sono
// usati / liberi e la ripartizione "documentati" vs "solo DHCP" (visti sul filo
// ma non documentati → candidati Adotta). Funzione PURA, sola lettura.
//
// Manual-first: la subnet la dichiara l'utente, i lease la ARRICCHISCONO. Lo
// staleness dei lease lo filtra il chiamante (isLeaseStale in lib/dhcp-lease.js):
// qui arrivano solo IP attivi.
//
// Conteggio "opzione A" (realtà sul filo): usedCount = documentati + solo-DHCP.
// Un IP che è SIA documentato SIA con lease conta UNA volta (sotto "documentati").
//
// INPUT model = {
//   subnet:        '192.168.20.0/24',     // CIDR dichiarato (vuoto/non valido → capacity 0)
//   gateway:       '192.168.20.1',        // opz: il gateway dichiarato è un indirizzo occupato
//   documentedIps: ['192.168.20.10', …],  // IP dei nodi (qualunque VLAN: filtrati per CIDR)
//   leaseIps:      ['192.168.20.45', …],   // IP dei lease ATTIVI in cache (già de-stale, dedup interno)
//   parseCidr:     fn(subnet) -> cidr|null, // iniettato (lib/cidr.js _parseCidrInfo)
//   ipInCidr:      fn(ip, cidr) -> bool      // iniettato (lib/cidr.js _ipInCidr)
// }
// OUTPUT {
//   cidr, capacity, gatewayOk,
//   usedCount, documentedCount, dhcpOnlyCount, freeCount, pct,
//   leaseInCidr,        // n. lease distinti che cadono nel CIDR (per decidere se mostrare la fonte "DHCP")
//   dhcpOnly: [ip…]     // IP visti SOLO via lease (per la fase Adotta)
// }
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Indirizzi host assegnabili in una rete: totali − 2 (network + broadcast),
  // tranne /31 (link punto-punto, 2 usabili: RFC 3021) e /32 (1 host singolo).
  function _hostCapacity(cidr) {
    if (!cidr) return 0;
    const span = ((cidr.broadcast - cidr.network) >>> 0) + 1; // totali, incl. network+broadcast
    if (cidr.prefix >= 31) return span;
    return Math.max(span - 2, 0);
  }

  function computeIpamUsage(model) {
    model = model || {};
    const parseCidr = typeof model.parseCidr === 'function' ? model.parseCidr : function () { return null; };
    const ipInCidr = typeof model.ipInCidr === 'function' ? model.ipInCidr : function () { return false; };

    const cidr = parseCidr(model.subnet || '') || null;
    const capacity = _hostCapacity(cidr);
    const gw = String(model.gateway || '').trim();
    const gatewayOk = (!gw || !cidr) ? true : ipInCidr(gw, cidr);

    // Set "dichiarati": IP dei nodi documentati che cadono nel CIDR + il gateway
    // dichiarato (è comunque un indirizzo occupato).
    const declared = new Set();
    if (cidr) {
      const docs = Array.isArray(model.documentedIps) ? model.documentedIps : [];
      for (const ip of docs) {
        const s = String(ip == null ? '' : ip).trim();
        if (s && ipInCidr(s, cidr)) declared.add(s);
      }
      if (gw && gatewayOk) declared.add(gw);
    }

    // Lease attivi nel CIDR; "solo DHCP" = visti via lease ma non dichiarati.
    const dhcpOnly = [];
    const leaseSeen = new Set();
    if (cidr) {
      const leases = Array.isArray(model.leaseIps) ? model.leaseIps : [];
      for (const ip of leases) {
        const s = String(ip == null ? '' : ip).trim();
        if (!s || leaseSeen.has(s) || !ipInCidr(s, cidr)) continue;
        leaseSeen.add(s);
        if (!declared.has(s)) dhcpOnly.push(s);
      }
    }

    const documentedCount = declared.size;
    const dhcpOnlyCount = dhcpOnly.length;
    const usedCount = documentedCount + dhcpOnlyCount; // opzione A: realtà sul filo
    const freeCount = capacity ? Math.max(capacity - usedCount, 0) : 0;
    const pct = capacity ? Math.round((usedCount / capacity) * 100) : 0;

    return {
      cidr, capacity, gatewayOk,
      usedCount, documentedCount, dhcpOnlyCount, freeCount, pct,
      leaseInCidr: leaseSeen.size,
      dhcpOnly,
    };
  }

  return { computeIpamUsage, _hostCapacity };
});
