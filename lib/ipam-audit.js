// ============================================================
// IPAM AUDIT — igiene IPAM: IP duplicati + overlap di subnet (report puro)
// ============================================================
// Consistenza doc↔doc (NON doc↔realtà: quello è il Drift). Dati i prefissi IPAM
// dichiarati e i nodi documentati, segnala due misconfig che un IPAM reale pesca
// e che InfraNet finora non vedeva:
//   - duplicateIps[]:   lo STESSO indirizzo su >=2 nodi documentati (refuso o
//                       conflitto), IPv4 e IPv6, con l'IPv6 confrontato in forma
//                       canonica: due scritture dello stesso indirizzo sono UN
//                       indirizzo
//   - subnetOverlaps[]: due PREFISSI che si INTERSECANO (o sono la stessa rete)
//
// Funzione PURA, sola lettura: NON muta nulla (manual-first) e non inventa —
// tutto deriva dai campi già documentati dall'utente. Nessun DOM, nessun globale.
// UMD-lite: browser (window) + Node (module.exports), come lib/ipam.js.
//
// INPUT model = {
//   prefixes:  [ { cidr, vlan } ],                   // ipam.prefixes[] — l'autorità
//   nodes:     [ { id, name, ip, ip6 } ],            // nodi documentati (entrambe le famiglie)
//   parseCidr: fn(cidr) -> { family, network, broadcast, prefix, raw } | null  // iniettato (lib/cidr.js _parseCidrInfo)
// }
// OUTPUT {
//   duplicateIps:  [ { ip, nodes:[ { id, name } ] } ],                    // ordinati per IP
//   subnetOverlaps:[ { a:{cidr,vlan}, b:{cidr,vlan}, identical } ],       // ordinati per indirizzo, `a` prima di `b`
// }
(function (root, factory) {
  // `cidrLib` = lib/cidr.js: Node/bundle via require, browser via window (cidr.js
  // e' uno <script> caricato prima). Stessa convenzione di lib/correlate.js.
  const cidrLib = (typeof module !== 'undefined' && module.exports) ? require('./cidr.js') : root;
  const api = factory(cidrLib);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (cidrLib) {
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

  // L'intersezione fra due prefissi ha UNA definizione, in lib/cidr.js, e vale per
  // IPv4 e IPv6. Qui c'era il confronto fra interi a 32 bit: su un prefisso v6 quei
  // campi non esistono e i confronti su `undefined` davano `false` — nessun falso
  // positivo, ma per caso, non per scelta.
  function _rangesOverlap(a, b) {
    const f = cidrLib && cidrLib._cidrsOverlap;
    return typeof f === 'function' ? !!f(a, b) : false;
  }

  // L'identita' di un indirizzo ha UNA definizione, in lib/cidr.js: un IPv4 e' la
  // sua stringa, un IPv6 la sua forma canonica. Senza, "2001:DB8::10" e
  // "2001:db8:0:0:0:0:0:10" sullo stesso segmento passavano per due indirizzi
  // diversi, ed e' proprio il caso che questo audit deve pescare.
  function _key(addr) {
    const f = cidrLib && cidrLib.addrKey;
    return typeof f === 'function' ? f(addr) : String(addr == null ? '' : addr).trim();
  }

  // Stesso indirizzo (non vuoto) su >=2 nodi documentati. IPv4 E IPv6: un device
  // dual-stack ne dichiara due, e un IPv6 ricopiato su due apparati e' un conflitto
  // esattamente quanto un IPv4 — prima di qui nessuno lo guardava.
  // Un nodo che ripete lo stesso indirizzo su entrambi i campi non fa un duplicato
  // con se' stesso: la lista e' per NODO, non per campo.
  function findDuplicateIps(nodes) {
    const byIp = new Map();
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      const seen = new Set();
      for (const raw of [n && n.ip, n && n.ip6]) {
        const key = _key(raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // La chiave normalizza, ma cio' che si MOSTRA e' com'e' stato scritto
        // (manual-first): vince la prima scrittura incontrata.
        if (!byIp.has(key)) byIp.set(key, { ip: String(raw).trim(), nodes: [] });
        byIp.get(key).nodes.push({ id: n.id, name: n.name || n.id || '' });
      }
    }
    const out = [];
    for (const rec of byIp.values()) {
      if (rec.nodes.length >= 2) out.push(rec);
    }
    out.sort((x, y) => {
      const kx = _ipSortKey(x.ip), ky = _ipSortKey(y.ip);
      // Le famiglie non si mescolano: prima le v4 (chiave numerica), poi tutto il
      // resto in ordine di stringa. Scelta qualsiasi, ma STABILE.
      if (Number.isNaN(kx) || Number.isNaN(ky)) {
        if (Number.isNaN(kx) !== Number.isNaN(ky)) return Number.isNaN(kx) ? 1 : -1;
        return String(x.ip).localeCompare(String(y.ip));
      }
      return kx - ky;
    });
    return out;
  }

  // Ordine nello SPAZIO DEGLI INDIRIZZI: 10.0.0.0/8 prima di 192.168.1.0/24, e a
  // parità di rete il prefisso più largo prima del più stretto (/24 prima di /25).
  // Le famiglie non si mescolano: prima le v4, poi le v6 — una scelta qualsiasi, ma
  // STABILE, così due letture consecutive non si scambiano le righe.
  // Sta qui perché è l'ordine con cui si LEGGE un piano di indirizzamento — le
  // collisioni sono vicine nello spazio degli indirizzi, non nelle VLAN. Una
  // definizione sola, riusata da chi mostra l'elenco: la stessa regola in due strati
  // diverge, ed è sempre l'incompleta a vincere.
  function compareCidr(a, b) {
    if (!a || !b) return a ? -1 : (b ? 1 : 0);
    const fa = a.family || 4, fb = b.family || 4;
    if (fa !== fb) return fa - fb;
    if (fa === 6) {
      const wa = a.network6 || [], wb = b.network6 || [];
      for (let i = 0; i < 8; i++) { const d = (wa[i] || 0) - (wb[i] || 0); if (d) return d; }
      return a.prefix - b.prefix;
    }
    // `network` è unsigned a 32 bit: si confronta, non si sottrae (la differenza
    // fra due /8 lontane esce dal range dei signed).
    if (a.network !== b.network) return a.network < b.network ? -1 : 1;
    return a.prefix - b.prefix;
  }

  // Coppie di PREFISSI dichiarati che si sovrappongono. Prende `ipam.prefixes[]`,
  // non la vista per-VLAN: la sovrapposizione è un fatto dello spazio degli
  // indirizzi (L3), e la VLAN (L2) è un attributo FACOLTATIVO di ciascuno dei due.
  // Confrontare «il prefisso principale di ogni VLAN» rendeva invisibili sia le reti
  // senza VLAN (su un NetBox vero, la maggioranza) sia il secondo prefisso di una
  // VLAN dual-stack.
  // Due prefissi sulla STESSA VLAN non sono più esclusi a priori: v4+v6 è dual-stack
  // e non si interseca mai (ci pensa `_cidrsOverlap`, famiglie diverse), ma due v4
  // che si intersecano sulla stessa VLAN sono un conflitto vero.
  // `identical` = si sovrappongono e hanno lo stesso prefisso ⇒ sono la stessa rete.
  function findSubnetOverlaps(prefixes, parseCidr) {
    if (typeof parseCidr !== 'function') return [];
    const parsed = [];
    for (const p of (Array.isArray(prefixes) ? prefixes : [])) {
      if (!p) continue;
      const cidr = String(p.cidr == null ? '' : p.cidr).trim();
      if (!cidr) continue;
      const info = parseCidr(cidr);
      if (!info) continue;
      // `+null === 0`: il null resta null, o una rete senza VLAN diventa «VLAN 0».
      const vlan = (p.vlan == null || !Number.isFinite(+p.vlan)) ? null : +p.vlan;
      parsed.push({ cidr, vlan, info });
    }
    // Ordinati PRIMA del confronto: le coppie escono già in ordine di indirizzo e
    // `a` è sempre il prefisso che viene prima.
    parsed.sort((x, y) => compareCidr(x.info, y.info) || String(x.cidr).localeCompare(String(y.cidr)));
    const out = [];
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i], b = parsed[j];
        if (!_rangesOverlap(a.info, b.info)) continue;
        out.push({
          a: { cidr: a.cidr, vlan: a.vlan },
          b: { cidr: b.cidr, vlan: b.vlan },
          identical: a.info.prefix === b.info.prefix,
        });
      }
    }
    return out;
  }

  function buildIpamAudit(model) {
    model = model || {};
    return {
      duplicateIps: findDuplicateIps(model.nodes),
      subnetOverlaps: findSubnetOverlaps(model.prefixes, model.parseCidr),
    };
  }

  return { buildIpamAudit, findDuplicateIps, findSubnetOverlaps, compareCidr };
});
