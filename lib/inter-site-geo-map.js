// ============================================================
// LA MAPPA CON LE STRADE — cosa va sulla mappa, e dove
// (UMD-lite, Node + browser · lingua-indipendente · puro · deterministico)
// ============================================================
// La vista geografica del pannello multi-sede è una mappa VERA: Leaflet, con le
// tessere di OpenStreetMap servite dal nostro server (server/tiles.js). Leaflet sa
// disegnare e muovere la mappa; NON sa cosa metterci. Qui si decide: un cerchio per
// ogni sede con un punto, una linea per ogni collegamento fra due sedi piazzate,
// quali sedi e quali collegamenti restano fuori — e perché — e l'inquadratura.
// Niente DOM, niente Leaflet, niente stringhe di UI: solo coordinate in gradi.
//
// (La carta VETTORIALE per il PDF, che non ha tessere, è `lib/inter-site-geo.js`.)
//
//  ① **Un cerchio per ogni sede con un punto.** Una sede senza punto non si piazza
//     «dove capita»: finisce in `unplaced`, e la vista lo scrive sotto la mappa.
//  ② **Ciò che non si può disegnare si DICE.** Un collegamento che tocca una sede
//     senza punto (o inesistente) finisce in `cut` con `reason: 'unplaced'` e i
//     capi che mancano; uno fra due sedi sullo STESSO punto con `reason: 'same-point'`
//     — a nessuno zoom c'è una linea da tirare.
//  ③ **I collegamenti doppi non si sovrappongono.** Due o più collegamenti fra le
//     stesse sedi si aprono a ventaglio (curve di Bézier quadratiche campionate),
//     simmetrici rispetto alla corda. La coppia ha un verso CANONICO (id minore →
//     id maggiore): così il ventaglio sta nello stesso posto qualunque sia il capo
//     «A» scritto nel collegamento. A scala di mappa il ventaglio è proporzionale
//     alla lunghezza della corda: vicino, le linee si fondono (come sulla realtà).
//  ④ **L'inquadratura contiene tutte le sedi.** Con una sola — o con più sedi sullo
//     stesso punto — un riquadro di zero gradi non esiste: si dà un centro e uno zoom.
//  ⑤ **Deterministico.** Stesse sedi, stesso modello: l'ordine è quello dichiarato
//     nell'organizzazione. Sei decimali (~11 cm), niente code di virgola mobile.
//
// ⚠️ `.js` e non `.ts`: `engines >=16` e la CI su 18/20, dove un `.ts` è SyntaxError.

/** Un cerchio sulla mappa. @typedef {{siteId:string, name:string, role:string, lat:number, lng:number}} GeoMapMarker */
/** Una linea: `coords` sono `[lat, lng]` — due punti per una retta, di più per un arco del ventaglio.
 *  @typedef {{linkId:string, aSiteId:string, bSiteId:string, coords:[number,number][]}} GeoMapLine */
/** @typedef {{linkId:string, reason:'unplaced'|'same-point', missing:string[]}} GeoMapCut */
/** L'inquadratura: `bounds` se le sedi occupano un'area, altrimenti `center` e `maxZoom`.
 *  @typedef {{bounds:{south:number,west:number,north:number,east:number}|null, center:[number,number], maxZoom:number}} GeoMapFit */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(isNode ? require('./inter-site.js') : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (IS) {
  'use strict';

  /** Quanto si apre un arco del ventaglio, in frazioni della corda (la freccia dell'arco). */
  const FAN = 0.08;
  /** Quanti segmenti per un arco. */
  const ARC_STEPS = 16;
  /** Lo zoom a cui si guarda una sede sola: una città, non il mondo e non un portone. */
  const SINGLE_ZOOM = 13;

  const _r6 = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };

  /**
   * @param {unknown} rawOrg organizzazione grezza o normalizzata (`normalizeOrganization` è idempotente)
   * @returns {{markers:GeoMapMarker[], lines:GeoMapLine[], unplaced:{siteId:string,name:string}[],
   *            cut:GeoMapCut[], fit:GeoMapFit|null}}
   */
  function buildGeoMapModel(rawOrg) {
    const org = IS.normalizeOrganization(rawOrg);
    /** @type {GeoMapMarker[]} */ const markers = [];
    /** @type {{siteId:string,name:string}[]} */ const unplaced = [];
    /** @type {Record<string, GeoMapMarker>} */ const byId = Object.create(null);
    for (const s of org.sites) {
      if (!s.geo) { unplaced.push({ siteId: s.id, name: s.name }); continue; }
      const k = { siteId: s.id, name: s.name, role: s.role, lat: s.geo.lat, lng: s.geo.lng };
      markers.push(k);
      byId[s.id] = k;
    }

    // ── I collegamenti: prima si contano per coppia (③), poi si disegnano ──────
    const keyOf = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
    /** @type {Record<string, string[]>} */ const groups = Object.create(null);
    for (const l of org.links) {
      if (!byId[l.aSiteId] || !byId[l.bSiteId]) continue;
      const k = keyOf(l.aSiteId, l.bSiteId);
      (groups[k] || (groups[k] = [])).push(l.id);
    }
    /** @type {GeoMapLine[]} */ const lines = [];
    /** @type {GeoMapCut[]} */ const cut = [];
    for (const l of org.links) {
      const A = byId[l.aSiteId], B = byId[l.bSiteId];
      if (!A || !B) {
        cut.push({ linkId: l.id, reason: 'unplaced', missing: [!A ? l.aSiteId : null, !B ? l.bSiteId : null].filter(/** @type {(x:any)=>x is string} */ (x) => x != null) });
        continue;
      }
      if (A.lat === B.lat && A.lng === B.lng) { cut.push({ linkId: l.id, reason: 'same-point', missing: [] }); continue; }
      const sib = groups[keyOf(l.aSiteId, l.bSiteId)];
      const n = sib.length;
      const idx = sib.indexOf(l.id);
      if (n === 1) {
        lines.push({ linkId: l.id, aSiteId: l.aSiteId, bSiteId: l.bSiteId, coords: [[A.lat, A.lng], [B.lat, B.lng]] });
        continue;
      }
      // Il verso CANONICO della coppia: l'arco `idx` sta dallo stesso lato qualunque sia il capo «A» scritto.
      const [P, Q] = l.aSiteId < l.bSiteId ? [A, B] : [B, A];
      const latM = (P.lat + Q.lat) / 2;
      const cosM = Math.max(0.05, Math.cos(latM * Math.PI / 180));
      const dx = (Q.lng - P.lng) * cosM, dy = Q.lat - P.lat;       // la corda in gradi «piatti»
      const len = Math.hypot(dx, dy) || 1;
      const apice = FAN * len * (idx - (n - 1) / 2);               // di quanto si scosta il punto di mezzo
      const ctrl = 2 * apice;                                       // il controllo si sposta del doppio (Bézier quadratica)
      const px = -dy / len, py = dx / len;                          // la normale alla corda
      const cLat = latM + py * ctrl, cLng = (P.lng + Q.lng) / 2 + (px * ctrl) / cosM;
      /** @type {[number,number][]} */ const coords = [];
      for (let i = 0; i <= ARC_STEPS; i++) {
        const t = i / ARC_STEPS, u = 1 - t;
        // Il controllo è lo stesso qualunque sia il capo «A»: una Bézier percorsa al contrario è la stessa curva.
        const lat = u * u * A.lat + 2 * u * t * cLat + t * t * B.lat;
        const lng = u * u * A.lng + 2 * u * t * cLng + t * t * B.lng;
        coords.push([_r6(lat), _r6(lng)]);
      }
      lines.push({ linkId: l.id, aSiteId: l.aSiteId, bSiteId: l.bSiteId, coords });
    }

    // ── L'inquadratura (④) ────────────────────────────────────────────────────
    /** @type {GeoMapFit|null} */ let fit = null;
    if (markers.length) {
      let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
      for (const k of markers) {
        if (k.lat < south) south = k.lat; if (k.lat > north) north = k.lat;
        if (k.lng < west) west = k.lng; if (k.lng > east) east = k.lng;
      }
      const centro = /** @type {[number,number]} */ ([_r6((south + north) / 2), _r6((west + east) / 2)]);
      fit = (south === north && west === east)
        ? { bounds: null, center: centro, maxZoom: SINGLE_ZOOM }
        : { bounds: { south, west, north, east }, center: centro, maxZoom: 15 };
    }
    return { markers, lines, unplaced, cut, fit };
  }

  /**
   * Le sedi VICINE SULLO SCHERMO diventano un cerchio solo con il numero (come in Prospix).
   *
   * ⑥ **Lo zoom decide, non i gradi.** Due sedi a trenta chilometri sono due cerchi a zoom
   * alto e uno solo a zoom basso: la distanza che conta è quella in PIXEL, che chi disegna
   * ha in mano (`latLngToContainerPoint`) e passa qui. Il raggruppamento si rifà a ogni zoom.
   * ⑦ **Greedy, misurato dalla PRIMA sede del gruppo, senza catene.** A vicina a B e B vicina a
   * C non fa un gruppo {A,B,C} se A e C sono lontane: sarebbe un cerchio che si allarga
   * strisciando lungo una fila di sedi. La soglia è STRETTA (`<`): a distanza esatta non si
   * raggruppa, e senza soglia (≤ 0) ogni sede sta per conto suo. L'ordine è quello dato.
   * Il gruppo sta alla MEDIA dei punti dei suoi membri (sei decimali).
   *
   * @param {unknown} items `{id, x, y, lat, lng}` — `x,y` in pixel sullo schermo
   * @param {number} thresholdPx
   * @returns {{ids:string[], lat:number, lng:number}[]}
   */
  function clusterMarkers(items, thresholdPx) {
    if (!Array.isArray(items)) return [];
    const soglia = Number(thresholdPx);
    /** @type {{ax:number, ay:number, ids:string[], sLat:number, sLng:number}[]} */
    const gruppi = [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const it = /** @type {Record<string,any>} */ (raw);
      if (![it.x, it.y, it.lat, it.lng].every(v => typeof v === 'number' && Number.isFinite(v))) continue;
      const g = Number.isFinite(soglia) && soglia > 0
        ? gruppi.find(y => Math.hypot(y.ax - it.x, y.ay - it.y) < soglia) : undefined;
      if (g) { g.ids.push(String(it.id)); g.sLat += it.lat; g.sLng += it.lng; }
      else gruppi.push({ ax: it.x, ay: it.y, ids: [String(it.id)], sLat: it.lat, sLng: it.lng });
    }
    return gruppi.map(g => ({ ids: g.ids, lat: _r6(g.sLat / g.ids.length), lng: _r6(g.sLng / g.ids.length) }));
  }

  return { buildGeoMapModel, clusterMarkers };
});
