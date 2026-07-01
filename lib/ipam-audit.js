// ============================================================
// IPAM AUDIT — igiene IPAM: IP duplicati + overlap di subnet (report puro)
// ============================================================
// Consistenza doc↔doc (NON doc↔realtà: quello è il Drift). Data la palette VLAN
// con le subnet IPAM dichiarate e i nodi documentati, segnala due misconfig che
// un IPAM reale pesca e che InfraNet finora non vedeva:
//   - duplicateIps[]:   lo STESSO IP su >=2 nodi documentati (refuso o conflitto)
//   - subnetOverlaps[]: due VLAN con CIDR che si INTERSECANO (o identici)
//
// Funzione PURA, sola lettura: NON muta nulla (manual-first) e non inventa —
// tutto deriva dai campi già documentati dall'utente. Nessun DOM, nessun globale.
// UMD-lite: browser (window) + Node (module.exports), come lib/ipam.js.
//
// INPUT model = {
//   vlans:     [ { vid, name } ],                    // palette VLAN
//   ipamByVid: { '<vid>': { subnet } },              // CIDR dichiarato per VLAN
//   nodes:     [ { id, name, ip } ],                 // nodi documentati
//   parseCidr: fn(subnet) -> { network, broadcast, prefix, raw } | null  // iniettato (lib/cidr.js _parseCidrInfo)
// }
// OUTPUT {
//   duplicateIps:  [ { ip, nodes:[ { id, name } ] } ],                    // ordinati per IP
//   subnetOverlaps:[ { vidA, vidB, subnetA, subnetB, identical } ],       // vidA < vidB
// }
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Chiave numerica di un IPv4 per un ordinamento stabile "umano" (1.2.3.4 <
  // 1.2.3.40). Se non è un IPv4 valido → NaN (finisce in coda, ordine stringa).
  function _ipSortKey(ip) {
    const p = String(ip || '').trim().split('.');
    if (p.length !== 4) return NaN;
    let n = 0;
    for (const o of p) {
      const v = Number(o);
      if (!Number.isInteger(v) || v < 0 || v > 255) return NaN;
      n = (n * 256) + v;
    }
    return n;
  }

  // Due range CIDR [network..broadcast] si intersecano? (interi unsigned già
  // normalizzati da _parseCidrInfo). La containment (una /25 dentro una /24) è
  // un caso di intersezione, quindi viene catturata correttamente.
  function _rangesOverlap(a, b) {
    return a.network <= b.broadcast && b.network <= a.broadcast;
  }

  // Stesso IP (non vuoto) su >=2 nodi documentati.
  function findDuplicateIps(nodes) {
    const byIp = new Map();
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      const ip = String(n && n.ip != null ? n.ip : '').trim();
      if (!ip) continue;
      if (!byIp.has(ip)) byIp.set(ip, []);
      byIp.get(ip).push({ id: n.id, name: n.name || n.id || '' });
    }
    const out = [];
    for (const [ip, list] of byIp) {
      if (list.length >= 2) out.push({ ip, nodes: list });
    }
    out.sort((x, y) => {
      const kx = _ipSortKey(x.ip), ky = _ipSortKey(y.ip);
      if (Number.isNaN(kx) || Number.isNaN(ky)) return String(x.ip).localeCompare(String(y.ip));
      return kx - ky;
    });
    return out;
  }

  // Coppie di VLAN i cui CIDR dichiarati si sovrappongono. `identical` = stesso
  // network+broadcast (stessa identica subnet su due VLAN).
  function findSubnetOverlaps(vlans, ipamByVid, parseCidr) {
    if (typeof parseCidr !== 'function') return [];
    const ipam = ipamByVid || {};
    // Solo le VLAN con un CIDR valido dichiarato.
    const parsed = [];
    for (const v of (Array.isArray(vlans) ? vlans : [])) {
      if (!v || v.vid == null) continue;
      const subnet = String((ipam[String(v.vid)] || {}).subnet || '').trim();
      if (!subnet) continue;
      const cidr = parseCidr(subnet);
      if (!cidr) continue;
      parsed.push({ vid: Number(v.vid), subnet, cidr });
    }
    const out = [];
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i], b = parsed[j];
        if (a.vid === b.vid) continue;
        if (!_rangesOverlap(a.cidr, b.cidr)) continue;
        const lo = a.vid <= b.vid ? a : b;
        const hi = a.vid <= b.vid ? b : a;
        out.push({
          vidA: lo.vid, vidB: hi.vid,
          subnetA: lo.subnet, subnetB: hi.subnet,
          identical: a.cidr.network === b.cidr.network && a.cidr.broadcast === b.cidr.broadcast,
        });
      }
    }
    out.sort((x, y) => (x.vidA - y.vidA) || (x.vidB - y.vidB));
    return out;
  }

  function buildIpamAudit(model) {
    model = model || {};
    return {
      duplicateIps: findDuplicateIps(model.nodes),
      subnetOverlaps: findSubnetOverlaps(model.vlans, model.ipamByVid, model.parseCidr),
    };
  }

  return { buildIpamAudit, findDuplicateIps, findSubnetOverlaps };
});
