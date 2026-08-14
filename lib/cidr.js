// Utility CIDR — condivise tra browser (IPAM in app.js) e test Node.
// UMD-lite: nel browser espone le funzioni come globali (window), in Node via
// module.exports. Nessuno stato, nessun DOM.
//
// IPv4 e IPv6. L'espansione di un IPv6 in 8 word NON viene riscritta qui: arriva
// da lib/ipv6.js (`_parseIpv6Words`), che e' l'unica definizione nel progetto —
// stessa convenzione di lib/correlate.js. In Node/bundle si risolve via require;
// nel browser cidr.js e' uno <script> classico e ipv6.js arriva col bundle (il suo
// UMD si auto-espone su window), quindi si legge a CALL-TIME, non al caricamento.
// Se ipv6.js non fosse disponibile, l'IPv6 degrada a "non riconosciuto" (null) —
// mai a un risultato inventato.
(function (root, factory) {
  const v6 = (typeof module !== 'undefined' && module.exports) ? require('./ipv6.js') : root;
  const api = factory(v6);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // Browser: espone le funzioni come globali cosi' app.js le usa senza modifiche.
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (v6) {
  'use strict';

  // "192.168.1.10" -> intero unsigned 32 bit, oppure null se non valido.
  function _parseIpv4Int(ip) {
    const parts = String(ip || '').trim().split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(x => Number(x));
    if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
  }

  // 8 word da 16 bit di un IPv6, o null. Delega a lib/ipv6.js (v. testata).
  function _words6(ip) {
    const f = v6 && v6._parseIpv6Words;
    return typeof f === 'function' ? f(ip) : null;
  }

  // Azzera i bit oltre il prefisso: indirizzo -> indirizzo di RETE (word a 16 bit).
  function _maskWords6(w, prefix) {
    const out = w.slice();
    for (let i = 0; i < 8; i++) {
      const before = i * 16;                                  // bit gia' coperti dalle word precedenti
      if (prefix >= before + 16) continue;                     // word interamente dentro il prefisso
      if (prefix <= before) { out[i] = 0; continue; }           // word interamente fuori
      const keep = prefix - before;                            // 1..15 bit alti da tenere
      out[i] = w[i] & ((0xffff << (16 - keep)) & 0xffff);
    }
    return out;
  }

  function _sameWords6(a, b) {
    for (let i = 0; i < 8; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // 8 word -> forma canonica RFC 5952 ("2001:db8:0:14::"), o '' se ipv6.js manca.
  function _words6ToString(w) {
    const f = v6 && v6.canonicalizeIpv6;
    if (typeof f !== 'function') return '';
    return f(w.map(x => x.toString(16)).join(':')) || '';
  }

  // "192.168.1.0/24"    -> { raw, family:4, base, prefix, mask, network, broadcast }
  // "2001:db8:0:14::/64"-> { raw, family:6, prefix, network6:[8 word] }
  // null se non e' un CIDR.
  //
  // Sull'oggetto v6 NON esistono `network`/`broadcast`/`mask`: sono interi a 32 bit
  // e su 128 bit non hanno senso. Chi fa aritmetica su quei campi deve guardare
  // `family` PRIMA — non e' una svista, e' il punto: su una /64 non si conta la
  // capacita' (2^64 indirizzi), si contano gli indirizzi VISTI.
  function _parseCidrInfo(cidr) {
    const raw = String(cidr || '').trim();
    const m = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})$/);
    if (m) {
      const base = _parseIpv4Int(m[1]);
      const prefix = Number(m[2]);
      if (base == null || prefix < 0 || prefix > 32) return null;
      const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
      const network = (base & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;
      return { raw, family: 4, base, prefix, mask, network, broadcast };
    }
    // IPv6: si richiede almeno un ':' cosi' un IPv4 con prefisso fuori range
    // ("192.168.1.0/33") resta null invece di scivolare in questo ramo.
    const m6 = raw.match(/^([0-9a-fA-F:.%\w-]+)\s*\/\s*(\d{1,3})$/);
    if (!m6 || m6[1].indexOf(':') < 0) return null;
    const prefix6 = Number(m6[2]);
    if (prefix6 < 0 || prefix6 > 128) return null;
    const w = _words6(m6[1]);
    if (!w) return null;
    return { raw, family: 6, prefix: prefix6, network6: _maskWords6(w, prefix6) };
  }

  // true se ip appartiene alla rete descritta da cidrInfo (_parseCidrInfo).
  // Le famiglie non si mescolano: un IPv4 non sta mai dentro un prefisso IPv6.
  function _ipInCidr(ip, cidrInfo) {
    if (!cidrInfo) return false;
    if (cidrInfo.family === 6) {
      const w = _words6(ip);
      if (!w) return false;
      return _sameWords6(_maskWords6(w, cidrInfo.prefix), cidrInfo.network6);
    }
    const v = _parseIpv4Int(ip);
    if (v == null) return false;
    return ((v & cidrInfo.mask) >>> 0) === cidrInfo.network;
  }

  // Due prefissi si INTERSECANO? (contenimento incluso: una /25 dentro una /24 e'
  // un caso di intersezione). Famiglie diverse non si intersecano mai — un /24 IPv4
  // e un /64 IPv6 sulla stessa VLAN sono dual-stack, non un conflitto.
  // Regola unica per tutte e due le famiglie: si intersecano se la rete del piu'
  // SPECIFICO cade dentro il piu' largo.
  function _cidrsOverlap(a, b) {
    if (!a || !b) return false;
    const fa = a.family || 4, fb = b.family || 4;
    if (fa !== fb) return false;
    const wide = a.prefix <= b.prefix ? a : b;
    const narrow = a.prefix <= b.prefix ? b : a;
    if (fa === 6) return _sameWords6(_maskWords6(narrow.network6, wide.prefix), wide.network6);
    return ((narrow.network & wide.mask) >>> 0) === wide.network;
  }

  // Famiglia di un INDIRIZZO (non di un prefisso): 4, 6 o null se non riconosciuto.
  // Riconoscimento per FORMA — la validita' vera la stabiliscono _parseIpv4Int e
  // _words6. Serve dove «di che specie e' questa stringa» e' gia' la risposta:
  // distinguere un gateway fuori dalla subnet (si corregge l'ultimo ottetto) da un
  // gateway di un'altra famiglia (e' l'indirizzo sbagliato nel campo sbagliato).
  function addrFamily(addr) {
    const s = String(addr == null ? '' : addr).trim();
    if (!s) return null;
    if (s.indexOf(':') >= 0) return _words6(s) ? 6 : null;
    return _parseIpv4Int(s) != null ? 4 : null;
  }

  // CHIAVE D'IDENTITA' di un indirizzo: due stringhe hanno la stessa chiave quando
  // sono lo STESSO indirizzo. Un IPv4 e' la sua stringa; un IPv6 e' la sua forma
  // CANONICA (RFC 5952), perche' "2001:DB8:0:20:0:0:0:1" e "2001:db8:0:20::1" sono
  // lo stesso indirizzo scritto in due modi — e col confronto testuale il gateway
  // v6 di un router non agganciava mai il router, e lo stesso indirizzo su due
  // apparati non risultava mai duplicato.
  // Sta QUI, con l'aritmetica degli indirizzi, e non nei due motori che la usano
  // (l3-gateway.js, ipam-audit.js): la stessa regola scritta in due strati diverge
  // al primo ritocco, ed e' sempre l'incompleta a vincere.
  // Cio' che non si riconosce fa da chiave a se' stesso: niente collassi fra
  // stringhe diverse.
  function addrKey(addr) {
    const s = String(addr == null ? '' : addr).trim();
    if (!s) return s;
    if (s.indexOf(':') < 0) {
      // IPv4: la chiave e' la forma CANONICA (via intero), non la stringa cruda —
      // il validatore accetta gli zeri iniziali (decimali: Number('001')===1), quindi
      // "192.168.001.005" e "192.168.1.5" sono lo STESSO indirizzo e devono avere la
      // stessa chiave (senza, contavano due volte e un duplicato v4 sfuggiva). Cio'
      // che NON e' un IPv4 fa da chiave a se stesso: niente collassi fra stringhe diverse.
      const n = _parseIpv4Int(s);
      return n == null ? s : _intToIpv4(n);
    }
    const f = v6 && v6.canonicalizeIpv6;
    return (typeof f === 'function' ? f(s) : null) || s.toLowerCase();
  }

  // Un IPv6 link-local (fe80::/10)? L'unicita' di un link-local e' PER-LINK (RFC 4007):
  // lo stesso fe80::1 su due apparati in segmenti diversi NON e' un duplicato. Sta qui,
  // con l'identita' degli indirizzi, perche' l'audit duplicati (lib/ipam-audit.js) deve
  // poterlo escludere senza reimplementare la classe dell'indirizzo. '' se ipv6.js manca.
  function addrIsLinkLocalV6(addr) {
    const f = v6 && v6.ipv6Class;
    return typeof f === 'function' && f(String(addr == null ? '' : addr).trim()) === 'link-local';
  }

  // intero unsigned 32 bit -> "a.b.c.d".
  function _intToIpv4(n) {
    const v = (n >>> 0);
    return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
  }

  // Normalizza un input di scansione ("Scopri") nella subnet CIDR da DICHIARARE nel
  // pannello VLAN, cosi' la stessa cosa non si digita due volte. Accetta le forme
  // che l'utente scrive per uno scan:
  //   "192.168.10.0/24"  -> "192.168.10.0/24"  (CIDR, normalizzato all'indirizzo di rete)
  //   "192.168.10.20/24" -> "192.168.10.0/24"  (idem: azzera la parte host)
  //   "10.0.0.0/16"      -> "10.0.0.0/16"       (qualsiasi prefisso, rispettato)
  //   "192.168.10.1-254" -> "192.168.10.0/24"   (range dentro una /24 -> la sua /24)
  //   "192.168.10.50-99" -> "192.168.10.0/24"   (sotto-range -> la /24 che lo contiene)
  //   "192.168.10.7"     -> "192.168.10.0/24"   (IP singolo -> la sua /24)
  //   "2001:db8:0:14::/64"  -> "2001:db8:0:14::/64"   (CIDR v6, forma canonica)
  //   "2001:db8:0:14::5/64" -> "2001:db8:0:14::/64"   (idem: azzera l'interface-id)
  //   "2001:db8:0:14::5"    -> "2001:db8:0:14::/64"   (IPv6 nudo -> la sua /64)
  // Ritorna '' se non parsabile (niente da dichiarare). Puro, nessuna invenzione:
  // un range senza prefisso esplicito si assume /24 (il caso LAN tipico), e un IPv6
  // nudo /64 (la dimensione di segmento che SLAAC impone, RFC 4291).
  function subnetInputToCidr(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    const info = _parseCidrInfo(s);
    if (info && info.family === 6) {
      const net = _words6ToString(info.network6);
      return net ? net + '/' + info.prefix : '';
    }
    if (info) return _intToIpv4(info.network) + '/' + info.prefix;
    // range "a.b.c.X-Y" o IP singolo: prendo la parte-IP prima di '-' o '/'.
    const base = s.split('-')[0].split('/')[0].trim();
    const v = _parseIpv4Int(base);
    if (v != null) {
      const net24 = (v & 0xffffff00) >>> 0;
      return _intToIpv4(net24) + '/24';
    }
    const w = _words6(s);
    if (w) {
      const net = _words6ToString(_maskWords6(w, 64));
      return net ? net + '/64' : '';
    }
    return '';
  }

  // ── IL SEGMENTO DI UN INDIRIZZO — una sola definizione ─────────────────────
  // (audit 2026-08-13, debito D2.) «Che segmento è questo indirizzo?» era
  // ri-scritta in cinque punti come «i primi tre ottetti», cioè una /24 assunta,
  // e in due di quei punti l'assunzione DECIDEVA un verdetto: se la sweep ha
  // coperto quella subnet (assenza affidabile = rosso, oppure grigio) e se un IP
  // è on-segment per il collector. Su un piano fatto di /25 dentro una /24, o di
  // /22, quella decisione è sbagliata per costruzione — mentre la maschera VERA
  // è dichiarata in `ipam.prefixes[]`.
  //
  // Qui l'assunzione resta, ma in UN posto solo e dichiarata: il prefisso
  // DICHIARATO che contiene l'indirizzo vince sempre (il più specifico, come per
  // la VLAN di un IP); solo se nessuno lo contiene si ricade sulla convenzione
  // storica — /24 per IPv4 (chiave `a.b.c`, la forma che tutti i chiamanti già
  // si scambiano) e /64 per IPv6.
  //
  //   segmentKey('10.0.1.7')                            -> '10.0.1'
  //   segmentKey('10.0.1.7', [{cidr:'10.0.0.0/22'}])    -> '10.0.0.0/22'
  //   segmentKey('2001:db8:0:14::5')                    -> '2001:db8:0:14::/64'
  //   segmentKey('mela')                                -> ''
  //
  // Due indirizzi sono nello stesso segmento se hanno la stessa chiave — purché
  // calcolata con LO STESSO elenco di prefissi (chi produce e chi consuma la
  // chiave deve usare la stessa lista, altrimenti si confrontano due mondi).
  function segmentKey(addr, prefixes) {
    const s = String(addr == null ? '' : addr).trim();
    if (!s) return '';
    const list = Array.isArray(prefixes) ? prefixes : [];
    let best = '', bestLen = -1;
    for (const p of list) {
      const cidr = p && (typeof p === 'string' ? p : p.cidr);
      if (!cidr) continue;
      const info = _parseCidrInfo(cidr);
      if (!info || !_ipInCidr(s, info) || info.prefix <= bestLen) continue;
      best = (info.family === 6 ? _words6ToString(info.network6) : _intToIpv4(info.network)) + '/' + info.prefix;
      bestLen = info.prefix;
    }
    if (best) return best;                       // il DICHIARATO batte l'assunzione
    const v4 = _parseIpv4Int(s);
    if (v4 != null) {
      const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\./.exec(s);
      return m ? m[1] : '';                      // assunzione /24: chiave storica `a.b.c`
    }
    const w = _words6(s);
    if (w) {
      const net = _words6ToString(_maskWords6(w, 64));
      return net ? net + '/64' : '';             // assunzione /64 (RFC 4291)
    }
    return '';
  }

  return { _parseIpv4Int, _parseCidrInfo, _ipInCidr, _cidrsOverlap, _intToIpv4, subnetInputToCidr,
           addrFamily, addrKey, addrIsLinkLocalV6, segmentKey };
});
