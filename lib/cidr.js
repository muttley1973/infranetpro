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

  return { _parseIpv4Int, _parseCidrInfo, _ipInCidr, _intToIpv4, subnetInputToCidr };
});
