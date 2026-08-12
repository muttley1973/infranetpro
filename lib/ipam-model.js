// ============================================================
// IPAM MODEL — il prefisso e' un oggetto di primo livello
// ============================================================
// Fino alla 2.8.x la subnet era un CAMPO della VLAN: `ipam.vlans[<vid>].subnet`.
// Una sola subnet per VLAN, solo IPv4, e nessun posto dove mettere una rete che
// una VLAN non ce l'ha. Conseguenze misurate su un NetBox vero: 51 prefissi su 90
// non hanno VLAN e sparivano dall'app; e una VLAN dual-stack perdeva uno dei due
// prefissi in silenzio (assegnazione secca dentro un ciclo).
//
// Qui il modello e' quello di ogni IPAM di riferimento: `ipam.prefixes[]` e'
// l'autorita', la VLAN e' un riferimento FACOLTATIVO (`vlan: null` = rete senza
// VLAN). `ipam.vlans[<vid>]` sopravvive per cio' che e' davvero PER-VLAN e non
// per-prefisso: il legame con l'interfaccia SVI del router (`gatewayNodeId`) e i
// metadati che l'import DCIM legge dalla VLAN (nome, descrizione, stato, sito,
// tenant).
//
//   prefix = {
//     cidr:'192.168.20.0/24',   // chiave logica (v4 o v6)
//     vlan: 20 | null,          // riferimento FACOLTATIVO alla VLAN
//     gateway, dns,             // stanno nel prefisso: una VLAN dual-stack ha due gateway
//     name?, description?, status?,
//     id?, vrfId?, tenantId?,   // riferimenti OPACHI del DCIM: non li interpretiamo, li conserviamo
//     source?                   // 'manual' | 'dcim' — provenienza, come nel resto dell'app
//   }
//
// Funzioni PURE sullo stato passato: nessun DOM, nessun globale, nessuna resa.
// UMD-lite come lib/cidr.js, da cui prende il parsing (una definizione sola).
(function (root, factory) {
  const cidrLib = (typeof module !== 'undefined' && module.exports) ? require('./cidr.js') : root;
  const api = factory(cidrLib);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (cidrLib) {
  'use strict';

  const _parse = (s) => {
    const f = cidrLib && cidrLib._parseCidrInfo;
    return typeof f === 'function' ? f(s) : null;
  };

  function _str(x) { return String(x == null ? '' : x).trim(); }

  // Chiave di confronto fra CIDR. Due scritture dello stesso prefisso
  // ("2001:DB8::/64" e "2001:db8:0:0::/64") sono lo stesso prefisso: la chiave e'
  // la forma NORMALIZZATA, ma quello che si mostra resta cio' che e' stato scritto
  // (manual-first). Un CIDR non parsabile fa da chiave a se stesso, minuscolo:
  // niente collassi fra stringhe diverse.
  function prefixKey(cidr) {
    const s = _str(cidr);
    if (!s) return '';
    const f = cidrLib && cidrLib.subnetInputToCidr;
    const norm = typeof f === 'function' ? f(s) : '';
    return (norm || s).toLowerCase();
  }

  // Garantisce la forma { prefixes:[], vlans:{} } senza toccare cio' che c'e'.
  function ensureIpam(state) {
    if (!state || typeof state !== 'object') return { prefixes: [], vlans: {} };
    if (!state.ipam || typeof state.ipam !== 'object') state.ipam = {};
    if (!Array.isArray(state.ipam.prefixes)) state.ipam.prefixes = [];
    if (!state.ipam.vlans || typeof state.ipam.vlans !== 'object') state.ipam.vlans = {};
    return state.ipam;
  }

  function prefixesOf(state) {
    const ipam = (state && state.ipam) || null;
    return Array.isArray(ipam && ipam.prefixes) ? ipam.prefixes.filter(Boolean) : [];
  }

  // I prefissi di una VLAN. `+null === 0`: il null va escluso PRIMA della
  // conversione numerica, o una rete senza VLAN diventa «VLAN 0».
  function prefixesForVlan(state, vid) {
    if (vid == null || !Number.isFinite(+vid)) return [];
    const want = +vid;
    return prefixesOf(state).filter(p => p.vlan != null && +p.vlan === want);
  }

  function prefixesWithoutVlan(state) {
    return prefixesOf(state).filter(p => p.vlan == null);
  }

  // Il prefisso che contiene un indirizzo. Vince il PIU' SPECIFICO (/25 batte /24):
  // e' la regola di ogni tabella di routing, e con le subnet annidate e' l'unica
  // risposta giusta. null se nessuno lo contiene.
  function prefixForIp(state, ip) {
    const addr = _str(ip);
    if (!addr) return null;
    const f = cidrLib && cidrLib._ipInCidr;
    if (typeof f !== 'function') return null;
    let best = null, bestLen = -1;
    for (const p of prefixesOf(state)) {
      const info = _parse(p.cidr);
      if (!info || !f(addr, info)) continue;
      if (info.prefix > bestLen) { best = p; bestLen = info.prefix; }
    }
    return best;
  }

  // Trova la RIGA (non una copia) di un CIDR gia' dichiarato, o null.
  function findPrefix(state, cidr) {
    const key = prefixKey(cidr);
    if (!key) return null;
    return prefixesOf(state).find(p => prefixKey(p.cidr) === key) || null;
  }

  // Crea o aggiorna. I campi assenti dalla patch NON vengono azzerati: chi
  // aggiorna il gateway non deve perdere la descrizione arrivata dal DCIM.
  // Un campo passato a stringa vuota, invece, cancella: e' l'utente che svuota
  // la casella. Ritorna la riga.
  function upsertPrefix(state, patch) {
    const ipam = ensureIpam(state);
    const cidr = _str(patch && patch.cidr);
    if (!cidr) return null;
    let row = findPrefix(state, cidr);
    if (!row) { row = { cidr, vlan: null }; ipam.prefixes.push(row); }
    for (const k of Object.keys(patch || {})) {
      if (k === 'cidr') { row.cidr = cidr; continue; }
      const v = patch[k];
      if (v === undefined) continue;
      if (v === '' || v === null) {
        if (k === 'vlan') row.vlan = null; else delete row[k];
      } else {
        row[k] = v;
      }
    }
    if (row.vlan === undefined) row.vlan = null;
    return row;
  }

  function removePrefix(state, cidr) {
    const ipam = ensureIpam(state);
    const key = prefixKey(cidr);
    if (!key) return false;
    const before = ipam.prefixes.length;
    ipam.prefixes = ipam.prefixes.filter(p => !p || prefixKey(p.cidr) !== key);
    return ipam.prefixes.length !== before;
  }

  // ------------------------------------------------------------
  // Migrazione — a senso unico e IDEMPOTENTE
  // ------------------------------------------------------------
  // Due cose, entrambe rieseguibili senza effetto:
  //  1. le righe gia' in `ipam.prefixes[]` (le scriveva l'import DCIM dalla 2.8.0)
  //     usavano il campo `prefix`: diventa `cidr`, il nome del modello;
  //  2. `subnet`/`gateway`/`dns` escono da `ipam.vlans[<vid>]` e diventano un
  //     prefisso con `vlan: <vid>`.
  //
  // `ipam.vlans` NON viene cancellato: oltre a quei tre campi contiene
  // `gatewayNodeId` (il legame manuale con l'SVI, che e' per-VLAN e non
  // per-prefisso) e i metadati VLAN dell'import DCIM (name/description/status/
  // siteId/tenantId). Cancellarlo li perderebbe tutti.
  //
  // Se un CIDR e' gia' fra i prefissi (import DCIM che aveva copiato la stessa
  // subnet in tutti e due i posti) si FONDE, non si duplica: il dato gia' nel
  // prefisso vince, la VLAN riempie solo i buchi.
  function migrateIpam(state) {
    if (!state || typeof state !== 'object') return state;
    const ipam = ensureIpam(state);

    for (const p of ipam.prefixes) {
      if (!p || typeof p !== 'object') continue;
      if (!p.cidr && p.prefix) { p.cidr = _str(p.prefix); delete p.prefix; }
      if (p.vlan === undefined) p.vlan = null;
    }

    for (const key of Object.keys(ipam.vlans)) {
      const entry = ipam.vlans[key];
      if (!entry || typeof entry !== 'object') continue;
      const cidr = _str(entry.subnet);
      // Senza subnet non esiste un prefisso a cui attaccare gateway e DNS. Si
      // LASCIANO dove sono: cancellarli sarebbe distruggere un dato dichiarato
      // dall'utente per fare ordine, e fare ordine non e' una ragione sufficiente.
      // La voce resta com'e' ed e' rimigrabile il giorno che la subnet arriva.
      if (!cidr) continue;
      const vid = Number.isFinite(+key) ? +key : null;
      let row = findPrefix(state, cidr);
      if (!row) { row = { cidr, vlan: vid }; ipam.prefixes.push(row); }
      if (row.vlan == null && vid != null) row.vlan = vid;
      if (!row.gateway && _str(entry.gateway)) row.gateway = _str(entry.gateway);
      if (!row.dns && _str(entry.dns)) row.dns = _str(entry.dns);
      delete entry.subnet;
      delete entry.gateway;
      delete entry.dns;
    }
    return state;
  }

  return { ensureIpam, prefixesOf, prefixesForVlan, prefixesWithoutVlan,
           prefixForIp, findPrefix, upsertPrefix, removePrefix, migrateIpam, prefixKey };
});
