// ============================================================
// IPv6 — helper puri (UMD-lite, browser + Node)
// ============================================================
// Funzioni PURE per parsing/validazione/canonicalizzazione IPv6 e per l'estrazione
// del MAC da un Interface-ID EUI-64 (RFC 4291). Nessun accesso a DOM/state/global:
// input espliciti -> output, cosi' sono coperte da test (test/ipv6.test.js).
//
// Usi:
//  - lib/correlate.js: candidati vicini IPv6 (buildNdCandidates) e indice nodi;
//  - src/app-properties.js: validazione del campo IPv6 nel pannello Proprieta';
//  - drivers/snmp.js: decodifica dei byte indice della ipNetToPhysicalTable.
//
// Paletti: no-invenzioni (macFromEui64 ritorna null se l'IID NON e' EUI-64: MAI
// fabbricare un MAC da un indirizzo privacy/random) e vendor-neutral (matematica
// RFC, nessun quirk di prodotto).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Parsa una stringa IPv6 in 8 word da 16 bit (array di 8 interi 0-65535), oppure
  // null se non valida. Supporta la compressione '::' (una sola volta) e un IPv4
  // annidato in coda (::ffff:1.2.3.4). Un eventuale zone-id (%eth0, scope link-local)
  // viene rimosso: non fa parte dell'indirizzo. PRIVATA (non esportata): il generico
  // "parseIpv6" non deve finire su window.
  function parseIpv6(input) {
    let s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) return null;
    const pct = s.indexOf('%');
    if (pct >= 0) s = s.slice(0, pct);
    if (!s || !/^[0-9a-f:.]+$/.test(s)) return null;

    // Al massimo un '::'.
    const halves = s.split('::');
    if (halves.length > 2) return null;

    // Espande una lista di hextet separati da ':' in word da 16 bit; l'ultimo
    // token puo' essere un IPv4 dotted-quad (2 word). Ritorna null se malformata.
    function hextets(seg) {
      if (seg === '') return [];
      const toks = seg.split(':');
      const words = [];
      for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        if (tok === '') return null;                 // gruppo vuoto (es. ':' singolo iniziale/finale)
        if (tok.indexOf('.') >= 0) {
          if (i !== toks.length - 1) return null;     // IPv4 ammesso solo in ULTIMA posizione
          const q = tok.split('.');
          if (q.length !== 4) return null;
          const b = q.map(function (x) {
            if (!/^\d{1,3}$/.test(x)) return -1;
            const n = parseInt(x, 10);
            return (n >= 0 && n <= 255) ? n : -1;
          });
          if (b.some(function (x) { return x < 0; })) return null;
          words.push((b[0] << 8) | b[1]);
          words.push((b[2] << 8) | b[3]);
        } else {
          if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
          words.push(parseInt(tok, 16));
        }
      }
      return words;
    }

    let words;
    if (halves.length === 2) {
      const head = hextets(halves[0]);
      const tail = hextets(halves[1]);
      if (head === null || tail === null) return null;
      const missing = 8 - (head.length + tail.length);
      if (missing < 1) return null;                   // '::' deve valere >= 1 gruppo di zeri
      const zeros = [];
      for (let k = 0; k < missing; k++) zeros.push(0);
      words = head.concat(zeros, tail);
    } else {
      words = hextets(s);
      if (words === null) return null;
    }
    if (words.length !== 8) return null;
    return words;
  }

  // Vero se la stringa e' un IPv6 sintatticamente valido (accetta ::, ::1, fe80::,
  // ULA, global, con zone-id). Mai throw.
  function isValidIpv6(input) {
    return parseIpv6(input) !== null;
  }

  // Forma canonica RFC 5952: hex minuscolo, niente zeri iniziali per campo, la
  // PIU' LUNGA sequenza (>= 2) di campi zero compressa in '::' (prima sequenza in
  // caso di parita'). Ritorna null se input non valido. Nota: gli IPv4-mapped
  // vengono resi in hex puro (::ffff:c0a8:101), non in dotted-quad — deterministico
  // e sufficiente per gli usi interni (storage + decodifica SNMP).
  function canonicalizeIpv6(input) {
    const w = parseIpv6(input);
    if (!w) return null;
    let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (let i = 0; i < 8; i++) {
      if (w[i] === 0) {
        if (curStart < 0) { curStart = i; curLen = 1; } else { curLen++; }
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else {
        curStart = -1; curLen = 0;
      }
    }
    const fields = w.map(function (x) { return x.toString(16); });
    if (bestLen >= 2) {
      const before = fields.slice(0, bestStart).join(':');
      const after = fields.slice(bestStart + bestLen).join(':');
      return before + '::' + after;
    }
    return fields.join(':');
  }

  // 16 ottetti (Buffer o array) -> stringa IPv6 canonica. null se lunghezza != 16.
  // Usato per decodificare l'indirizzo dai byte dell'indice SNMP.
  function bytesToIpv6(bytes) {
    if (!bytes || bytes.length !== 16) return null;
    const groups = [];
    for (let i = 0; i < 16; i += 2) {
      const hi = bytes[i] & 0xff;
      const lo = bytes[i + 1] & 0xff;
      groups.push(((hi << 8) | lo).toString(16));
    }
    return canonicalizeIpv6(groups.join(':'));
  }

  // Byte dell'Interface-ID (ultimi 64 bit = word 4..7) come array di 8 ottetti.
  function _iidBytes(w) {
    const b = [];
    for (let i = 4; i < 8; i++) { b.push((w[i] >> 8) & 0xff, w[i] & 0xff); }
    return b;
  }

  // MAC (aa:bb:cc:dd:ee:ff) da un IPv6 il cui IID e' EUI-64 (RFC 4291): i byte
  // centrali dell'IID valgono 0xff,0xfe e il bit U/L (0x02) del 1o ottetto e'
  // invertito. Ritorna null se l'IID NON e' EUI-64 (privacy/random/manuale): in
  // quel caso NON esiste un MAC deducibile e inventarlo violerebbe il paletto
  // no-invenzioni. Vendor-neutral: pura aritmetica di bit.
  function macFromEui64(input) {
    const w = parseIpv6(input);
    if (!w) return null;
    const iid = _iidBytes(w);
    if (iid[3] !== 0xff || iid[4] !== 0xfe) return null;   // marcatore EUI-64 assente
    const mac = [iid[0] ^ 0x02, iid[1], iid[2], iid[5], iid[6], iid[7]];
    return mac.map(function (x) { return x.toString(16).padStart(2, '0'); }).join(':');
  }

  // Classe dell'indirizzo: 'unspecified' (::), 'loopback' (::1), 'multicast'
  // (ff00::/8), 'link-local' (fe80::/10), 'ula' (fc00::/7), 'global' (tutto il
  // resto). null se non valido.
  function ipv6Class(input) {
    const w = parseIpv6(input);
    if (!w) return null;
    if (w.every(function (x) { return x === 0; })) return 'unspecified';
    if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 &&
        w[4] === 0 && w[5] === 0 && w[6] === 0 && w[7] === 1) return 'loopback';
    const b0 = (w[0] >> 8) & 0xff;
    if (b0 === 0xff) return 'multicast';
    if ((w[0] & 0xffc0) === 0xfe80) return 'link-local';
    if ((b0 & 0xfe) === 0xfc) return 'ula';
    return 'global';
  }

  // Euristica SOFT (segnale BYOD, non prova): l'IID sembra privacy/random (RFC 4941/
  // 7217). Vero solo per indirizzi link-local/ula/global il cui IID NON e' EUI-64 e
  // NON e' quasi-vuoto (i manuali "…::1" / "…::abcd" hanno le word alte dell'IID a 0).
  // Conservativa per non etichettare da BYOD un indirizzo assegnato a mano.
  function isPrivacyIid(input) {
    const w = parseIpv6(input);
    if (!w) return false;
    const cls = ipv6Class(input);
    if (cls !== 'link-local' && cls !== 'global' && cls !== 'ula') return false;
    if (macFromEui64(input)) return false;                 // EUI-64 -> non privacy
    if (w[4] === 0 && w[5] === 0 && w[6] === 0) return false; // IID quasi-vuoto -> manuale/basso
    return true;
  }

  return { isValidIpv6, canonicalizeIpv6, bytesToIpv6, macFromEui64, ipv6Class, isPrivacyIid };
});
