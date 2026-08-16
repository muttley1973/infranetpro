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
// ⚠️ Terza popolazione, dalla 2.9.2: le PRENOTAZIONI. Un piano indirizzi dichiara
// anche indirizzi che non stanno addosso a nessun apparato — riservati, futuri,
// avanzi di una migrazione. Non sono sul filo e non sono apparati, ma NON SONO
// LIBERI: contarli fuori significava suggerire come «prossimo IP libero» un
// indirizzo che qualcuno aveva già impegnato (misurato su un piano importato da
// NetBox: .1–.30 prenotati, suggerimento .1). Entrano in `usedCount` perché la
// domanda a cui quel numero risponde è «quanti posso ancora darne via», e restano
// contate a parte (`reservedCount`) perché la ripartizione non deve mentire su
// che cosa si è visto e che cosa è soltanto scritto.
//
// INPUT model = {
//   subnet:        '192.168.20.0/24',     // CIDR dichiarato (vuoto/non valido → capacity 0)
//   gateway:       '192.168.20.1',        // opz: il gateway dichiarato è un indirizzo occupato
//   documentedIps: ['192.168.20.10', …],  // IP dei nodi (qualunque VLAN: filtrati per CIDR)
//   leaseIps:      ['192.168.20.45', …],   // IP dei lease ATTIVI in cache (già de-stale, dedup interno)
//   reservedIps:   ['192.168.20.240', …],  // opz: prenotati nel piano (nessun apparato), dedup interno
//   parseCidr:     fn(subnet) -> cidr|null, // iniettato (lib/cidr.js _parseCidrInfo)
//   ipInCidr:      fn(ip, cidr) -> bool      // iniettato (lib/cidr.js _ipInCidr)
// }
// OUTPUT {
//   cidr, capacity, gatewayOk,
//   usedCount, documentedCount, dhcpOnlyCount, reservedCount, freeCount, pct,
//   leaseInCidr,        // n. lease distinti che cadono nel CIDR (per decidere se mostrare la fonte "DHCP")
//   dhcpOnly: [ip…],    // IP visti SOLO via lease (per la fase Adotta)
//   nextFree            // primo host LIBERO nel CIDR (string) o null — il «prossimo IP» suggerito
// }
(function (root, factory) {
  // `cidrLib` = lib/cidr.js, per `addrKey`: l'identita' di un indirizzo (v4 alla
  // lettera, v6 canonico). Node via require, browser da root (cidr.js e' uno
  // <script> caricato prima). Letta a CALL-TIME come altrove.
  const cidrLib = (typeof module !== 'undefined' && module.exports) ? require('./cidr.js') : root;
  const api = factory(cidrLib);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (cidrLib) {
  'use strict';

  // Due scritture dello stesso IPv6 sono UN indirizzo occupato, non due. Senza
  // questo, il gateway dichiarato sul prefisso ("2001:DB8:0:20:0:0:0:1") e l'ip6
  // del router che lo tiene ("2001:db8:0:20::1") contavano separatamente, e una
  // /64 con due apparati dentro dichiarava tre indirizzi usati.
  // Su IPv4 la chiave E' la stringa: il comportamento non cambia di una virgola.
  function _key(addr) {
    const f = cidrLib && cidrLib.addrKey;
    return typeof f === 'function' ? f(addr) : String(addr == null ? '' : addr).trim();
  }

  // Indirizzi host assegnabili in una rete: totali − 2 (network + broadcast),
  // tranne /31 (link punto-punto, 2 usabili: RFC 3021) e /32 (1 host singolo).
  function _hostCapacity(cidr) {
    if (!cidr) return 0;
    // IPv6: una /64 ha 2^64 indirizzi. Non esiste una "capacita'" da mostrare e non
    // serve: l'occupazione di un prefisso v6 sono gli indirizzi VISTI, non una
    // percentuale di riempimento. Zero qui = il chiamante mostra i conteggi e tace
    // su liberi/percentuale (v. computeIpamUsage). Senza questa riga l'aritmetica a
    // 32 bit su campi assenti restituirebbe 1, che sarebbe una bugia plausibile.
    if (cidr.family === 6) return 0;
    const span = ((cidr.broadcast - cidr.network) >>> 0) + 1; // totali, incl. network+broadcast
    if (cidr.prefix >= 31) return span;
    return Math.max(span - 2, 0);
  }

  function _intToIp(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  // Primo host ASSEGNABILE non occupato (string) o null. Range = [network+1,
  // broadcast-1], tranne /31 e /32 (network/broadcast inclusi). Break al primo
  // libero → veloce nel caso comune; cap di sicurezza su subnet enormi quasi-piene.
  function _firstFreeHost(cidr, used) {
    if (!cidr) return null;
    const wide = cidr.prefix >= 31;
    const lo = (wide ? cidr.network : (cidr.network + 1)) >>> 0;
    const hi = (wide ? cidr.broadcast : (cidr.broadcast - 1)) >>> 0;
    if (hi < lo) return null;
    const CAP = 1 << 20;
    let scanned = 0;
    for (let n = lo; n <= hi; n++) {
      const ip = _intToIp(n >>> 0);
      if (!used.has(ip)) return ip;
      if (++scanned >= CAP) break;
    }
    return null;
  }

  function computeIpamUsage(model) {
    model = model || {};
    const parseCidr = typeof model.parseCidr === 'function' ? model.parseCidr : function () { return null; };
    const ipInCidr = typeof model.ipInCidr === 'function' ? model.ipInCidr : function () { return false; };

    const cidr = parseCidr(model.subnet || '') || null;
    const capacity = _hostCapacity(cidr);
    const gw = String(model.gateway || '').trim();
    const gatewayOk = (!gw || !cidr) ? true : ipInCidr(gw, cidr);
    // Il gateway non può essere il network/broadcast address (eccetto /31 e /32,
    // RFC 3021): flag informativo — i conteggi restano invariati (il clamp al
    // 100% copre già il caso), la segnalazione la fa il report L3.
    const gatewayIsReserved = !!(gw && cidr && gatewayOk && cidr.family !== 6 && cidr.prefix <= 30 &&
      (gw === _intToIp(cidr.network) || gw === _intToIp(cidr.broadcast)));

    // Set "dichiarati": IP dei nodi documentati che cadono nel CIDR + il gateway
    // dichiarato (è comunque un indirizzo occupato). Le chiavi sono IDENTITA' di
    // indirizzo, non stringhe: v. `_key`.
    const declared = new Set();
    if (cidr) {
      const docs = Array.isArray(model.documentedIps) ? model.documentedIps : [];
      for (const ip of docs) {
        const s = String(ip == null ? '' : ip).trim();
        if (s && ipInCidr(s, cidr)) declared.add(_key(s));
      }
      if (gw && gatewayOk) declared.add(_key(gw));
    }

    // Lease attivi nel CIDR; "solo DHCP" = visti via lease ma non dichiarati.
    const dhcpOnly = [];
    const leaseSeen = new Set();
    if (cidr) {
      const leases = Array.isArray(model.leaseIps) ? model.leaseIps : [];
      for (const ip of leases) {
        const s = String(ip == null ? '' : ip).trim();
        const k = _key(s);
        if (!s || leaseSeen.has(k) || !ipInCidr(s, cidr)) continue;
        leaseSeen.add(k);
        // In `dhcpOnly` va l'indirizzo COM'E' STATO VISTO: serve ad appaiare il
        // lease nel flusso Adotta, e una forma normalizzata non lo ritroverebbe.
        if (!declared.has(k)) dhcpOnly.push(s);
      }
    }

    // Prenotati "puri": nel CIDR, e non già contati come documentati o come lease.
    // Un indirizzo prenotato SU CUI c'è davvero un apparato non è una terza cosa —
    // è quell'apparato, e conta una volta sola, dove si vede.
    const reservedOnly = new Set();
    if (cidr) {
      const rows = Array.isArray(model.reservedIps) ? model.reservedIps : [];
      for (const ip of rows) {
        const s = String(ip == null ? '' : ip).trim();
        if (!s || !ipInCidr(s, cidr)) continue;
        const k = _key(s);
        if (declared.has(k) || leaseSeen.has(k)) continue;
        reservedOnly.add(k);
      }
    }

    const documentedCount = declared.size;
    const dhcpOnlyCount = dhcpOnly.length;
    const reservedCount = reservedOnly.size;
    // Opzione A (realtà sul filo) PIÙ ciò che il piano ha già impegnato: quello
    // che questo numero deve dire è quanti indirizzi restano da dare via.
    const usedCount = documentedCount + dhcpOnlyCount + reservedCount;
    // Senza capacità (CIDR assente o non valido) NON esiste un numero di liberi né
    // una percentuale: `null`, non `0`. Oggi ogni chiamante è già gated su
    // `usage.cidr`/`u.capacity`, quindi lo zero non si vedeva — ma «0 liberi»
    // significa «rete piena», ed è la peggiore delle risposte da lasciare pronta
    // per il prossimo consumatore che si dimentica il gate.
    const freeCount = capacity ? Math.max(capacity - usedCount, 0) : null;
    // Clamp a 100%: documentare per errore rete/broadcast (contati fra gli usati
    // via ipInCidr ma esclusi dalla capacità HOST) poteva far superare il 100%.
    const pct = capacity ? Math.min(100, Math.round((usedCount / capacity) * 100)) : null;

    // «Prossimo IP libero» suggerito: il primo host non documentato né in lease
    // (il gateway è già in `declared`). null se non c'è CIDR o la rete è piena.
    let nextFree = null;
    if (cidr && freeCount > 0) {
      const used = new Set(declared);
      for (const ip of leaseSeen) used.add(ip);
      for (const ip of reservedOnly) used.add(ip);
      nextFree = _firstFreeHost(cidr, used);
    }

    return {
      cidr, capacity, gatewayOk, gatewayIsReserved,
      usedCount, documentedCount, dhcpOnlyCount, reservedCount, freeCount, pct,
      leaseInCidr: leaseSeen.size,
      dhcpOnly, nextFree,
    };
  }

  return { computeIpamUsage, _hostCapacity };
});
