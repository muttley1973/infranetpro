// ============================================================
// MAC CLASSIFICATION — helper puri (UMD-lite, browser + Node)
// ============================================================
// Piccole funzioni PURE estratte da lib/app-drift.js (che e' DOM-coupled e non
// testabile headless): classificazione MAC e conteggio MAC-per-porta usati dal
// filtro "rumore endpoint" del Drift Report. Nessun accesso a DOM/state/global:
// input espliciti -> output, cosi' sono coperte da test (test/mac-class.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // MAC -> hex puro (minuscolo, senza separatori). Robusto a ':' '-' '.' e spazi.
  function _hex(mac) { return String(mac == null ? '' : mac).toLowerCase().replace(/[^0-9a-f]/g, ''); }

  // Prefissi OUI delle NIC virtuali (container/hypervisor): non sono "device"
  // reali da segnalare. Docker, VMware, Hyper-V, Xen, KVM/QEMU, VirtualBox...
  const VIRTUAL_MAC_PREFIXES = ['0242', '000569', '000c29', '001c14', '005056', '00155d', '00163e', '525400', '080027'];
  function isVirtualMac(mac) {
    const h = _hex(mac);
    return VIRTUAL_MAC_PREFIXES.some(p => h.startsWith(p));
  }

  // MAC randomizzato / locally-administered: bit 0x02 del primo ottetto settato.
  // iOS/Android lo usano per privacy sul WiFi -> dispositivo personale (telefono/
  // BYOD), mai infrastruttura. Segnale vendor-independent.
  function isRandomizedMac(mac) {
    const h = _hex(mac);
    if (h.length < 2) return false;
    const b0 = parseInt(h.slice(0, 2), 16);
    return Number.isFinite(b0) && (b0 & 0x02) === 0x02;
  }

  // Conteggio MAC per porta a partire dalla FDB di UNO switch ({ mac: ifName }).
  // Una porta che raccoglie tanti MAC = uplink AP/hub/segmento utenti.
  function countMacsPerPort(fdbForSwitch) {
    const out = {};
    if (!fdbForSwitch || typeof fdbForSwitch !== 'object') return out;
    for (const ifName of Object.values(fdbForSwitch)) {
      if (ifName == null || ifName === '') continue;
      out[ifName] = (out[ifName] || 0) + 1;
    }
    return out;
  }

  return { VIRTUAL_MAC_PREFIXES, isVirtualMac, isRandomizedMac, countMacsPerPort };
});
