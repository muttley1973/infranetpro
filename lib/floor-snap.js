// FLOOR SNAP — l'aggancio alla griglia della planimetria, in un posto solo.
//
// L'interruttore «Griglia» del pannello Planimetria non e' cosmetico: il manuale
// promette che «puoi nasconderla — e con essa lo snap diventa libero al pixel».
// Prima questa regola viveva solo nel drag di src/app-pointer.js, mentre gli altri
// punti che appoggiano qualcosa sulla mappa («Piazza su planimetria», il segmento
// condiviso, i rack piazzati dalla sotto-barra) arrotondavano a 20px in proprio,
// senza mai guardare gridHidden: la griglia spariva per gli occhi ma non per le
// mani. Stesso concetto in piu' strati = strati che divergono, quindi la regola
// sta qui e la usano tutti.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Passo della griglia, in px di planimetria. NON e' il passo con cui la griglia
  // viene DISEGNATA (background-size in styles/04-floor-rack.css): il disegno e'
  // una scelta grafica, questo e' il comportamento. Chi cambia l'uno guardi l'altro.
  const FLOOR_SNAP_STEP = 20;

  // Coordinata agganciata: al passo se la griglia e' visibile, al pixel se e'
  // nascosta. I valori non finiti (canvas non ancora misurato, zoom 0) tornano 0
  // invece di propagare NaN dentro node.x/node.y e rompere il render.
  function snapFloor(v, gridHidden) {
    const n = +v;
    if (!Number.isFinite(n)) return 0;
    if (gridHidden) return Math.round(n);
    return Math.round(n / FLOOR_SNAP_STEP) * FLOOR_SNAP_STEP;
  }

  // Comodita' per chi aggancia un punto intero (quasi tutti i chiamanti).
  function snapFloorPoint(x, y, gridHidden) {
    return { x: snapFloor(x, gridHidden), y: snapFloor(y, gridHidden) };
  }

  return { FLOOR_SNAP_STEP, snapFloor, snapFloorPoint };
});
