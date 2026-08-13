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

  // La lista che l'utente scrive nel campo a chip: prefissi separati da virgola.
  // Funzione di LETTURA DELL'INPUT, non di modello: non tocca lo stato, non scrive
  // niente, dice solo cosa ha capito e cosa no.
  //   parseNetworkList('192.168.20.0/24, 2001:db8::/64') -> { ok:[…], bad:[] }
  // Normalizza con `subnetInputToCidr` — la stessa regola di «Scopri», non una
  // seconda: azzera la parte host, un IPv4 nudo diventa la sua /24, un IPv6 nudo
  // la sua /64. Dedup sulla chiave normalizzata (`prefixKey`): due scritture dello
  // stesso prefisso sono un prefisso solo, e vince la prima.
  // Cio' che non si parsa finisce in `bad` INTERO, come e' stato scritto: chi
  // chiama lo rimette nel campo in rosso. Un campo che ingoia in silenzio e'
  // peggio del bottone che ha sostituito.
  function parseNetworkList(raw) {
    const ok = [], bad = [], seen = new Set();
    const norm = cidrLib && cidrLib.subnetInputToCidr;
    for (const piece of String(raw == null ? '' : raw).split(',')) {
      const s = piece.trim();
      if (!s) continue;                                   // virgole vuote: niente da dichiarare
      const cidr = typeof norm === 'function' ? norm(s) : '';
      if (!cidr) { bad.push(s); continue; }
      const key = prefixKey(cidr);
      if (seen.has(key)) continue;
      seen.add(key);
      ok.push(cidr);
    }
    return { ok, bad };
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

  // Il prefisso PRINCIPALE di una VLAN: il primo IPv4, altrimenti il primo.
  // Serve a due categorie di lettori, e a nessun'altra:
  //  - quelli per-VLAN PER NATURA — l'interfaccia SVI del router e' una per VLAN,
  //    non una per prefisso;
  //  - quelli che espongono un solo campo `subnet` verso l'esterno (DTO REST,
  //    export) e che non possono cambiare forma senza rompere chi li legge.
  // NON e' il modello. Chi deve vedere una VLAN dual-stack usa prefixesForVlan.
  function primaryPrefixForVlan(state, vid) {
    const rows = prefixesForVlan(state, vid);
    if (!rows.length) return null;
    for (const p of rows) {
      const info = _parse(p.cidr);
      if (info && info.family === 4) return p;
    }
    return rows[0];
  }

  // Vista per-VLAN, DERIVATA dall'autorita' a ogni chiamata: NON un secondo posto
  // dove il dato vive. `subnet`/`gateway`/`dns` vengono dal prefisso principale, il
  // resto (gatewayNodeId, metadati DCIM) dal record della VLAN, che e' l'unico
  // posto dove quei campi esistono.
  function vlanIpamView(state, vid) {
    const ipam = (state && state.ipam) || {};
    const rec = (ipam.vlans && ipam.vlans[String(vid)]) || null;
    const out = rec ? Object.assign({}, rec) : {};
    const p = primaryPrefixForVlan(state, vid);
    if (p) {
      out.subnet = p.cidr;
      if (p.gateway) out.gateway = p.gateway;
      if (p.dns) out.dns = p.dns;
    }
    return out;
  }

  // La stessa vista per ogni VLAN nominata, nella forma `{ '<vid>': view }` che i
  // motori ricevevano gia' come `state.ipam.vlans`. Le chiavi sono l'unione fra i
  // record VLAN e le VLAN referenziate dai prefissi: un prefisso dichiarato su una
  // VLAN che non ha un record deve comunque comparire.
  function ipamByVidView(state) {
    const ipam = (state && state.ipam) || {};
    const ids = new Set(Object.keys((ipam.vlans && typeof ipam.vlans === 'object') ? ipam.vlans : {}));
    for (const p of prefixesOf(state)) if (p.vlan != null) ids.add(String(p.vlan));
    const out = {};
    for (const vid of ids) out[vid] = vlanIpamView(state, vid);
    return out;
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
      // `+'' === 0` e Number.isFinite(0) e' true: una chiave VLAN vuota (progetto
      // malformato) diventerebbe «VLAN 0», la stessa trappola +null===0 gia' chiusa
      // altrove. La chiave vuota → nessuna VLAN, il prefisso resta senza vlan.
      const vid = (String(key).trim() !== '' && Number.isFinite(+key)) ? +key : null;
      const cidr = _str(entry.subnet);
      let row = cidr ? findPrefix(state, cidr) : null;
      if (cidr && !row) { row = { cidr, vlan: vid }; ipam.prefixes.push(row); }
      // Nessuna subnet propria, ma un prefisso gia' dichiarato su questa VLAN: un
      // gateway o un DNS rimasti orfani (scritti quando la subnet non c'era) hanno
      // finalmente una casa. E' la stessa regola, applicata al momento giusto.
      if (!row && vid != null) row = primaryPrefixForVlan(state, vid);
      // Ancora niente prefisso: si LASCIA tutto dov'e'. Cancellare un valore scritto
      // a mano per fare ordine nel modello non e' uno scambio accettabile.
      if (!row) continue;
      if (row.vlan == null && vid != null) row.vlan = vid;
      if (!row.gateway && _str(entry.gateway)) row.gateway = _str(entry.gateway);
      if (!row.dns && _str(entry.dns)) row.dns = _str(entry.dns);
      delete entry.subnet;
      delete entry.gateway;
      delete entry.dns;
      // Una voce che conteneva SOLO quei tre campi non ha piu' niente da dire: la
      // VLAN resta viva nella palette e nei prefissi che la citano.
      if (!Object.keys(entry).length) delete ipam.vlans[key];
    }
    return state;
  }

  return { ensureIpam, prefixesOf, prefixesForVlan, prefixesWithoutVlan,
           primaryPrefixForVlan, vlanIpamView, ipamByVidView,
           prefixForIp, findPrefix, upsertPrefix, removePrefix, migrateIpam, prefixKey,
           parseNetworkList };
});
