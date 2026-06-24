// ============================================================
// WAVE PATH — collegamento wireless "a onda" (stile Packet Tracer)
// ============================================================
// Genera un path SVG a forma di sinusoide tra due punti, usato per rendere i
// collegamenti WIRELESS (link.wireless) distinguendoli a colpo d'occhio dai cavi
// fisici. Funzione PURA, nessun DOM/state: input coordinate → stringa path.
//
// Garanzia chiave: l'onda compie un numero INTERO di cicli, così l'offset
// perpendicolare è 0 esattamente agli estremi → il path parte e finisce sui due
// punti reali (nessuno scostamento dai connettori).
//
//   buildWavePath(x1,y1,x2,y2, { amplitude=6, wavelength=16, samplesPerWave=10 })
//   → "M x1 y1 L … L x2 y2"
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _r(n) { return Math.round(n * 100) / 100; }   // 2 decimali, path compatti

  function buildWavePath(x1, y1, x2, y2, opts) {
    opts = opts || {};
    const amplitude = opts.amplitude != null ? opts.amplitude : 6;
    const wavelength = opts.wavelength != null ? opts.wavelength : 28;   // onda morbida, bassa frequenza
    const samplesPerWave = opts.samplesPerWave != null ? opts.samplesPerWave : 10;

    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    // Segmento degenere o troppo corto per un'onda: linea dritta.
    if (len < 1e-6) return `M ${_r(x1)} ${_r(y1)} L ${_r(x2)} ${_r(y2)}`;

    // Numero intero di cicli → estremi puliti (offset 0 a t=0 e t=1).
    const waves = Math.max(1, Math.round(len / wavelength));
    const samples = Math.max(8, waves * samplesPerWave);

    // Versore perpendicolare (normale alla direzione del segmento).
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;

    let d = `M ${_r(x1)} ${_r(y1)}`;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;                       // 0..1 lungo il segmento
      const bx = x1 + dx * t, by = y1 + dy * t;    // punto base sulla retta
      const off = amplitude * Math.sin(2 * Math.PI * waves * t);  // 0 agli estremi
      d += ` L ${_r(bx + px * off)} ${_r(by + py * off)}`;
    }
    return d;
  }

  return { buildWavePath };
});
