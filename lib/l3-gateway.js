// ============================================================
// L3 GATEWAY (lite) — chi instrada ogni VLAN (report puro)
// ============================================================
// Promuove il "gateway" della VLAN da semplice stringa IP (IPAM-lite) a
// RELAZIONE VLAN → device che la instrada. Funzione PURA: dato l'elenco VLAN,
// le voci IPAM e i nodi, risolve per ogni VLAN il device-gateway e ne calcola
// lo stato. Sola lettura, manual-first: l'aggancio automatico per IP è solo un
// SUGGERIMENTO, la scelta esplicita (gatewayNodeId) vince sempre e non viene
// mai sovrascritta.
//
// INPUT  model = {
//   vlans:   [ { vid, name, color } ],            // palette VLAN (ordine libero)
//   ipamByVid: { '<vid>': { subnet, gateway, dns, gatewayNodeId } },
//   nodes:   [ { id, name, ip, type } ],          // tutti i nodi (per la risoluzione)
//   usageByVid: { '<vid>': <numero IP usati> },    // opzionale (riepilogo IPAM)
//   parseCidr: fn(subnet) -> cidr|null,            // iniettato (lib/cidr.js)
//   ipInCidr:  fn(ip, cidr) -> bool                // iniettato (lib/cidr.js)
// }
//
// STATO per VLAN:
//   'bound'  → device scelto a mano (gatewayNodeId) e trovato
//   'auto'   → nessuna scelta esplicita, ma il gateway IP combacia con un device
//   'orphan' → c'è un gateway IP ma non corrisponde a nessun device documentato
//              (oppure il binding esplicito punta a un device cancellato)
//   'none'   → nessun gateway configurato
//
// OUTPUT { rows[], l3NodeIds[], l3Devices[], totals }
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _sameIp(a, b) {
    const x = String(a == null ? '' : a).trim();
    const y = String(b == null ? '' : b).trim();
    return x !== '' && x === y;
  }

  function _findNodeByIp(nodes, ip) {
    if (!ip) return null;
    for (const n of nodes) if (_sameIp(n.ip, ip)) return n;
    return null;
  }

  function buildL3Report(model) {
    model = model || {};
    const vlans = Array.isArray(model.vlans) ? model.vlans : [];
    const ipamByVid = model.ipamByVid || {};
    const nodes = Array.isArray(model.nodes) ? model.nodes : [];
    const usageByVid = model.usageByVid || {};
    const parseCidr = typeof model.parseCidr === 'function' ? model.parseCidr : () => null;
    const ipInCidr = typeof model.ipInCidr === 'function' ? model.ipInCidr : () => true;

    const nodesById = new Map();
    for (const n of nodes) nodesById.set(String(n.id), n);

    const rows = [];
    // nodeId → { id, name, vlans:[ {vid,name,gateway} ] }  (i device che instradano)
    const l3Map = new Map();

    const sorted = [...vlans].sort((a, b) => (+a.vid || 0) - (+b.vid || 0));
    for (const v of sorted) {
      const vid = +v.vid;
      const entry = ipamByVid[String(vid)] || {};
      const subnet = String(entry.subnet || '').trim();
      const gateway = String(entry.gateway || '').trim();
      const dns = String(entry.dns || '').trim();
      const explicitId = entry.gatewayNodeId ? String(entry.gatewayNodeId) : '';

      const cidr = subnet ? parseCidr(subnet) : null;
      const cidrValid = !subnet || !!cidr;

      // Risoluzione device: esplicito vince. L'auto-match per IP scatta SOLO se
      // non c'è alcun binding esplicito: un binding stantio (device cancellato)
      // resta un problema da mostrare, non lo rimpiazziamo in silenzio.
      const explicitNode = explicitId ? (nodesById.get(explicitId) || null) : null;
      const autoNode = (!explicitId && gateway) ? _findNodeByIp(nodes, gateway) : null;
      const node = explicitNode || autoNode;

      let status;
      if (explicitNode) status = 'bound';
      else if (autoNode) status = 'auto';
      else if (gateway || explicitId) status = 'orphan';   // IP scritto o binding stantio, ma nessun device
      else status = 'none';

      const inSubnet = (gateway && cidr) ? !!ipInCidr(gateway, cidr) : true;

      const warnings = [];
      if (subnet && !gateway) warnings.push('noGateway');
      if (subnet && !cidr) warnings.push('invalidCidr');
      if (explicitId && !explicitNode) warnings.push('staleBinding');
      else if (gateway && !node) warnings.push('orphanGateway');
      if (gateway && cidr && !inSubnet) warnings.push('gatewayOutOfSubnet');

      const row = {
        vid,
        name: v.name || '',
        color: v.color || '',
        subnet,
        cidrValid,
        gateway,
        dns,
        status,
        nodeId: node ? node.id : null,
        nodeName: node ? (node.name || node.id) : null,
        inSubnet,
        usedCount: +usageByVid[String(vid)] || 0,
        warnings,
      };
      rows.push(row);

      if (node) {
        const key = String(node.id);
        if (!l3Map.has(key)) l3Map.set(key, { id: node.id, name: node.name || node.id, vlans: [] });
        l3Map.get(key).vlans.push({ vid, name: row.name, gateway });
      }
    }

    const l3Devices = [...l3Map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const l3NodeIds = l3Devices.map(d => d.id);

    const totals = {
      vlans: rows.length,
      withGateway: rows.filter(r => r.nodeId).length,
      orphan: rows.filter(r => r.warnings.includes('orphanGateway') || r.warnings.includes('staleBinding')).length,
      noGateway: rows.filter(r => r.warnings.includes('noGateway')).length,
      outOfSubnet: rows.filter(r => r.warnings.includes('gatewayOutOfSubnet')).length,
      l3Devices: l3Devices.length,
    };

    return { rows, l3NodeIds, l3Devices, totals };
  }

  return { buildL3Report };
});
