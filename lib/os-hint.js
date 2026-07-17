// ============================================================
// OS HINT dal TTL — helper puro (UMD-lite, browser + Node)
// ============================================================
// "Poor man's fingerprint" ispirato a nmap: il TTL iniziale di un pacchetto è
// distinto per famiglia di OS, quindi il TTL osservato dà un indizio OS a COSTO
// ZERO (il valore è già nell'output del ping). Gli OS partono da TTL iniziali noti:
//   64  → Linux/Unix/macOS/Android/iOS/BSD
//   128 → Windows
//   255 → apparati di rete / Solaris (router/switch/stampanti/embedded)
// Il TTL cala di 1 per ogni hop, perciò si arrotonda al primo iniziale >= osservato.
// AFFIDABILE on-segment (0-1 hop, come nello sweep di una /24); off-segment il
// decremento può falsare → è un segnale a PESO BASSO, mai autorevole (manual-first).
// Vendor-neutral: nessun quirk di prodotto, solo l'aritmetica del TTL.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // TTL osservato -> { initialTtl, osFamily, label, hops } oppure null se non valido.
  // osFamily: 'unix' | 'windows' | 'netdev'.
  function ttlOsHint(observedTtl) {
    const t = parseInt(observedTtl, 10);
    if (!Number.isFinite(t) || t <= 0 || t > 255) return null;
    let initialTtl, osFamily, label;
    if (t <= 64)       { initialTtl = 64;  osFamily = 'unix';    label = 'Linux/Unix/macOS/Android/IoT'; }
    else if (t <= 128) { initialTtl = 128; osFamily = 'windows'; label = 'Windows'; }
    else               { initialTtl = 255; osFamily = 'netdev';  label = 'Apparato di rete/embedded'; }
    return { initialTtl, osFamily, label, hops: initialTtl - t };
  }

  // Estrae il TTL numerico dall'output di `ping` (qualunque OS/lingua: "TTL=64",
  // "ttl=64", "ttl:64"). null se assente. Puro: il chiamante passa lo stdout.
  function parseTtl(pingOutput) {
    const m = /ttl[=:]\s*(\d+)/i.exec(String(pingOutput == null ? '' : pingOutput));
    if (!m) return null;
    const t = parseInt(m[1], 10);
    return (Number.isFinite(t) && t > 0 && t <= 255) ? t : null;
  }

  return { ttlOsHint, parseTtl };
});
