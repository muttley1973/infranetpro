// Utility CIDR / IPv4 pure — condivise tra browser (IPAM in app.js) e test Node.
// UMD-lite: nel browser espone le funzioni come globali (window), in Node via
// module.exports. Nessuna dipendenza, nessuno stato, nessun DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // Browser: espone le funzioni come globali cosi' app.js le usa senza modifiche.
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // "192.168.1.10" -> intero unsigned 32 bit, oppure null se non valido.
  function _parseIpv4Int(ip) {
    const parts = String(ip || '').trim().split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(x => Number(x));
    if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
  }

  // "192.168.1.0/24" -> { raw, base, prefix, mask, network, broadcast } o null.
  function _parseCidrInfo(cidr) {
    const raw = String(cidr || '').trim();
    const m = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})$/);
    if (!m) return null;
    const base = _parseIpv4Int(m[1]);
    const prefix = Number(m[2]);
    if (base == null || prefix < 0 || prefix > 32) return null;
    const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    const network = (base & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    return { raw, base, prefix, mask, network, broadcast };
  }

  // true se ip appartiene alla rete descritta da cidrInfo (_parseCidrInfo).
  function _ipInCidr(ip, cidrInfo) {
    const v = _parseIpv4Int(ip);
    if (v == null || !cidrInfo) return false;
    return ((v & cidrInfo.mask) >>> 0) === cidrInfo.network;
  }

  return { _parseIpv4Int, _parseCidrInfo, _ipInCidr };
});
