// ============================================================
// LA VISTA GEOGRAFICA — dove cade ogni sede sulla carta, e ogni collegamento
// (UMD-lite, Node + browser · lingua-indipendente · puro · deterministico)
// ============================================================
// La seconda mappa inter-sede: quella dello SCHEMA (`lib/inter-site-layout.js`)
// dice come sono legate le sedi; questa dice DOVE sono. Qui non c'è SVG, non c'è
// DOM e non c'è una stringa di UI: solo coordinate. Lo schermo, il PDF e (domani)
// un fondo di confini disegnano la stessa carta perché leggono le stesse
// coordinate — è la difesa contro la definizione doppia motore↔renderer.
//
// ── Le scelte, e perché ───────────────────────────────────────────────────
//
//  ① **Deterministico, e senza fisica.** Stesse sedi → stesse coordinate, in Node
//     come nel browser. L'inquadratura è la scatola che contiene le sedi con un
//     punto, e non dipende dall'ordine in cui sono scritte.
//
//  ② **Proporzionata, e dice la scala.** Proiezione Web Mercator (la stessa di
//     ogni carta web): x è la longitudine, y il Mercatore della latitudine. La
//     barra della scala è misurata alla latitudine del centro, e dice un numero
//     TONDO di metri: una carta senza scala è un disegno, e una scala inventata
//     è peggio. Il test la prova con la distanza vera fra due punti.
//
//  ③ **Ciò che non si può disegnare si DICE.** Una sede senza punto non è sulla
//     carta, e non si piazza «dove capita»: finisce in `undrawable.sites`. Un
//     collegamento che ne tocca una, o che unisce due sedi sullo stesso punto,
//     finisce in `undrawable.links` con il MOTIVO (`unplaced`, `too-close`).
//
//  ④ **Il puntino è un punto, l'etichetta è un'altra cosa.** Le sedi dello schema
//     sono scatole larghe; sulla carta due sedi vicine si sovrapporrebbero. Qui
//     il segno della sede è un puntino nella sua posizione vera, e il nome sta in
//     un'etichetta che si scosta: prima accanto al puntino (E, O, NE, NO, SE, SO,
//     N, S), poi — se non c'è posto — a distanze crescenti, con un filo che la
//     lega al suo puntino. Greedy e DETERMINISTICO: nessuna etichetta tocca un'altra
//     né un puntino altrui.
//
//  ⑤ **Gli archi sono gli stessi dello schema.** La quadratica, l'apice per la
//     pastiglia e il ventaglio dei collegamenti doppi vengono da
//     `INTER_SITE_LAYOUT_ARCS`: una matematica sola.
//
//  ⑥ **Le etichette si misurano FUORI** (④ dello schema): chi disegna passa
//     `boxOf(siteId) → {w,h}`; senza, una misura dichiarata.
//
//  ⑦ **Limite dichiarato: l'antimeridiano.** Un'organizzazione a cavallo della
//     linea del cambio di data (Fiji, Alaska–Siberia) si disegna con il mondo
//     «aperto» a Greenwich: le sedi restano al loro posto ma la scatola le
//     comprende tutte, e l'inquadratura si allarga. Non si inventa una carta
//     avvolta.
//
//  ⑨ **Le etichette non coprono i collegamenti.** Un nome sopra la linea che lega la sede
//     nasconde ciò che la carta serve a mostrare: si cerca prima un posto che non attraversi
//     nessuna corda fra due puntini, e solo se non c'è si accetta di coprirne una.
//
//  ⑧ **Il fondo di confini non è qui.** `view` dice come passare da gradi a pixel
//     (`interSiteGeoProject`): chi aggiungerà una sagoma o delle tessere userà
//     QUELLA trasformazione, non ne ricalcolerà una.
//
// ⚠️ `.js` e non `.ts`: `engines >=16` e la CI su 18/20, dove un `.ts` è SyntaxError.

/** Una sede piazzata sulla carta: `InterSiteLayoutNode` più il suo punto.
 *  `x,y,w,h` sono dell'ETICHETTA (centro e misura); `px,py` del PUNTINO (`dotR` è il
 *  suo raggio); `leader` il filo che li lega, o `null` se l'etichetta gli è accanto.
 *  @typedef {{siteId:string, name:string, role:string, projectRef:string|null,
 *             subnets:number, uplinkIds:string[], angle:null, center:boolean,
 *             lat:number, lng:number, px:number, py:number, dotR:number,
 *             x:number, y:number, w:number, h:number, anchor:string,
 *             leader:{x1:number,y1:number,x2:number,y2:number}|null}} InterSiteGeoNode */

/** Come passare dai gradi ai pixel: `x = ox + λ·s`, `y = oy − M(φ)·s`, con λ in
 *  radianti e M(φ) = ln tan(π/4 + φ/2). `w,h` è il foglio.
 *  @typedef {{s:number, ox:number, oy:number, w:number, h:number}} InterSiteGeoView */

/** @typedef {{px:number, meters:number, x1:number, x2:number, y:number}} InterSiteGeoScale */
/** Il reticolo. `label` dice se la linea porta il suo numero: una linea contro il bordo del foglio,
 *  o sopra la barra della scala, il numero lo taglierebbe o lo sovrapporrebbe, e allora si tace.
 *  @typedef {{step:number, meridians:{deg:number,x:number,label:boolean}[], parallels:{deg:number,y:number,label:boolean}[]}} InterSiteGeoGraticule */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(
    isNode ? require('./inter-site.js') : root,
    isNode ? require('./inter-site-layout.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (IS, IL) {
  'use strict';

  const A = IL.INTER_SITE_LAYOUT_ARCS;
  const R_EARTH = 6371008.8;                 // raggio medio, metri
  const MAX_LAT = 85.0511;                   // il limite del Mercatore: oltre, y va all'infinito
  const rad = (d) => d * Math.PI / 180;
  const deg = (r) => r * 180 / Math.PI;
  const _r2 = A.r2;

  /** Le misure del disegno: di GEOMETRIA, non di stile. */
  const INTER_SITE_GEO_DEFAULTS = {
    width: 900,         // larghezza del foglio
    minHeight: 340,     // un foglio più basso è un francobollo
    maxHeight: 620,     // e uno più alto non sta in una pagina
    pad: 70,            // margine: ci stanno le etichette dei puntini ai bordi
    dotR: 6,            // raggio del puntino
    dotGap: 6,          // aria fra puntino e etichetta
    labelW: 130,        // misura dell'etichetta senza righello (⑥)
    labelH: 26,
    minSpanDeg: 0.01,   // l'inquadratura non scende sotto ~1 km: una sede sola, o due sullo stesso punto
    scaleMin: 60,       // la barra della scala sta fra queste due larghezze, in pixel
    scaleMax: 150,
    gridGap: 90,        // distanza minima fra due linee del reticolo, in pixel
  };

  /** I passi del reticolo, in gradi: dal centinaio di metri al quarto di globo. */
  const GRID_STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 45];

  /** Il Mercatore di una latitudine (radianti), con la latitudine tenuta nei limiti. */
  /** @param {number} lat @returns {number} */
  function _merc(lat) {
    const c = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    return Math.log(Math.tan(Math.PI / 4 + rad(c) / 2));
  }
  /** L'inverso: dal Mercatore alla latitudine, in gradi. */
  /** @param {number} m @returns {number} */
  function _unmerc(m) { return deg(2 * Math.atan(Math.exp(m)) - Math.PI / 2); }

  /**
   * Dove cade un punto della Terra sul foglio, data la vista.
   * @param {InterSiteGeoView} view @param {number} lat @param {number} lng
   * @returns {{x:number, y:number}}
   */
  function interSiteGeoProject(view, lat, lng) {
    return { x: _r2(view.ox + rad(lng) * view.s), y: _r2(view.oy - _merc(lat) * view.s) };
  }

  /** `12°E`, `9°W`, `45.5°N`, `0°` — la notazione delle coordinate, che non ha lingua.
   *  ⚠️ Niente code di virgola mobile: `0.1 + 0.2` si scrive `0.3`. */
  /** @param {number} d @param {'lat'|'lng'} axis @returns {string} */
  function interSiteGeoDegLabel(d, axis) {
    const v = Math.round(Math.abs(d) * 1e6) / 1e6;
    if (v === 0) return '0°';
    const lettera = axis === 'lat' ? (d > 0 ? 'N' : 'S') : (d > 0 ? 'E' : 'W');
    return v + '°' + lettera;
  }

  /** `200 m`, `1 km`, `2000 km`. */
  /** @param {number} meters @returns {string} */
  function interSiteGeoScaleLabel(meters) {
    return meters >= 1000 ? (meters / 1000) + ' km' : meters + ' m';
  }

  /** Il più piccolo numero 1/2/5 × 10^k che sia ≥ `x`. */
  /** @param {number} x @returns {number} */
  function _niceUp(x) {
    const e = Math.pow(10, Math.floor(Math.log10(x)));
    for (const m of [1, 2, 5, 10]) if (m * e >= x - 1e-12) return m * e;
    return 10 * e;
  }

  /** Il numero rotondo di metri la cui barra sta fra `lo` e `hi` pixel, dato quanti
   *  metri vale un pixel. Si prende il più GRANDE che ci sta. */
  /** @param {number} mpp @param {number} lo @param {number} hi @returns {number} */
  function _scaleMeters(mpp, lo, hi) {
    let best = 0;
    for (let e = -1; e <= 8; e++) {
      for (const m of [1, 2, 5]) {
        const metri = m * Math.pow(10, e);
        const px = metri / mpp;
        if (px >= lo && px <= hi) best = metri;     // cresce con e: l'ultimo che ci sta è il più grande
      }
    }
    // Fuori da ogni finestra (non può succedere con i passi 1/2/5 e una finestra
    // larga più di 2,5×) si ripiega sul rotondo più vicino alla metà della finestra.
    return best || _niceUp(mpp * ((lo + hi) / 2));
  }

  /**
   * La carta, in coordinate.
   *
   * @param {unknown} rawOrg organizzazione grezza o normalizzata (`normalizeOrganization` è idempotente)
   * @param {Record<string,unknown>} [opts] misure (`INTER_SITE_GEO_DEFAULTS`) più il righello:
   *        `boxOf(siteId) → {w,h}` per le etichette e `labelOf(linkId) → {w,h}` per le pastiglie
   * @returns {any} un `InterSiteLayout` con `layout: 'geo'|'unplaced'|'empty'`, `view`,
   *          `scaleBar`, `graticule` e `nodes` di tipo `InterSiteGeoNode`
   */
  function buildInterSiteGeoLayout(rawOrg, opts) {
    const org = IS.normalizeOrganization(rawOrg);
    const o = (opts && typeof opts === 'object') ? opts : {};
    const D = INTER_SITE_GEO_DEFAULTS;
    const num = (v, d) => A.numOr(v, d);
    const W = Math.max(200, num(o.width, D.width));
    const pad = num(o.pad, D.pad);
    const dotR = Math.max(1, num(o.dotR, D.dotR));
    const dotGap = num(o.dotGap, D.dotGap);
    const minH = num(o.minHeight, D.minHeight);
    const maxH = Math.max(minH, num(o.maxHeight, D.maxHeight));
    const boxOf = typeof o.boxOf === 'function' ? o.boxOf : null;
    const labelOf = typeof o.labelOf === 'function' ? o.labelOf : null;
    const g = A.geom(o);

    const out = {
      layout: /** @type {'empty'|'unplaced'|'geo'} */ ('empty'), hubSiteId: null,
      width: 0, height: 0, ringR: 0,
      nodes: /** @type {InterSiteGeoNode[]} */ ([]), edges: /** @type {any[]} */ ([]),
      undrawable: {
        links: /** @type {{linkId:string, missing:string[], reason:string}[]} */ ([]),
        uplinks: /** @type {{uplinkId:string, siteId:string}[]} */ ([]),
        sites: /** @type {{siteId:string, name:string}[]} */ ([]),
      },
      view: /** @type {InterSiteGeoView} */ ({ s: 1, ox: 0, oy: 0, w: 0, h: 0 }),
      scaleBar: /** @type {InterSiteGeoScale|null} */ (null),
      graticule: /** @type {InterSiteGeoGraticule} */ ({ step: 0, meridians: [], parallels: [] }),
    };
    const sites = org.sites;
    if (!sites.length) { out.width = pad * 2; out.height = pad * 2; return out; }

    // ③ Gli uplink di una sede che non c'è non si disegnano: stessa regola dello schema.
    const siteIds = new Set(sites.map(s => s.id));
    for (const u of org.uplinks) if (!siteIds.has(u.siteId)) out.undrawable.uplinks.push({ uplinkId: u.id, siteId: u.siteId });

    const placed = sites.filter(s => s.geo);
    for (const s of sites) if (!s.geo) out.undrawable.sites.push({ siteId: s.id, name: s.name });
    if (!placed.length) {
      out.layout = 'unplaced'; out.width = pad * 2; out.height = pad * 2;
      return out;
    }
    out.layout = 'geo';
    const hubs = sites.filter(s => s.role === 'hub');
    out.hubSiteId = hubs.length === 1 ? hubs[0].id : null;

    // ── L'inquadratura: la scatola delle sedi con un punto ──────────────────
    const xs = placed.map(s => rad(s.geo.lng));
    const ys = placed.map(s => _merc(s.geo.lat));
    let minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    // ⑤ Un'inquadratura non è mai più piccola di `minSpanDeg`: con una sede sola, o
    // due sullo stesso punto, la scala andrebbe all'infinito. Si allarga attorno al centro.
    const minSpan = rad(num(o.minSpanDeg, D.minSpanDeg));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, minSpan), spanY = Math.max(maxY - minY, minSpan);
    minX = cx - spanX / 2; maxX = cx + spanX / 2; minY = cy - spanY / 2; maxY = cy + spanY / 2;

    const innerW = Math.max(1, W - pad * 2), innerH = Math.max(1, maxH - pad * 2);
    const s = Math.min(innerW / spanX, innerH / spanY);
    const H = Math.round(Math.max(minH, Math.min(maxH, spanY * s + pad * 2)) * 100) / 100;
    const view = {
      s,
      ox: (W - spanX * s) / 2 - minX * s,
      oy: (H - spanY * s) / 2 + maxY * s,
      w: W, h: H,
    };
    out.width = W; out.height = H;
    out.view = { s: view.s, ox: _r2(view.ox), oy: _r2(view.oy), w: W, h: H };
    // La vista che si CONSEGNA è arrotondata: chi proietta con lei deve ottenere i
    // numeri del layout, e i numeri del layout sono già arrotondati dalla stessa
    // funzione (`interSiteGeoProject` arrotonda ogni volta).

    // ── I puntini ───────────────────────────────────────────────────────────
    const dots = placed.map(site => {
      const p = interSiteGeoProject(out.view, site.geo.lat, site.geo.lng);
      return { site, px: p.x, py: p.y };
    });

    // ── Le etichette: greedy, deterministico (④) ────────────────────────────
    const margin = 3;                       // aria minima fra due etichette
    const edgeMargin = 4;                   // e fra un'etichetta e il bordo del foglio
    /** @type {{x:number,y:number,w:number,h:number}[]} */
    const taken = [];
    const hitRect = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
    const hitDot = (r, d) => d.px + dotR > r.x && d.px - dotR < r.x + r.w && d.py + dotR > r.y && d.py - dotR < r.y + r.h;
    const inside = (r) => r.x >= edgeMargin && r.y >= edgeMargin && r.x + r.w <= W - edgeMargin && r.y + r.h <= H - edgeMargin;

    // ⑨ **Le etichette non coprono i collegamenti.** Un nome sopra la linea che
    // lega la sede nasconde proprio ciò che la carta serve a mostrare. Gli archi
    // si calcolano dopo (dipendono dalle pastiglie), ma la corda fra i due
    // puntini è già nota: è lei l'ingombro da evitare.
    /** @type {Record<string, {px:number,py:number}>} */
    const dotOf = Object.create(null);
    for (const d of dots) dotOf[d.site.id] = d;
    /** @type {[number,number,number,number][]} */
    const chords = [];
    for (const l of org.links) {
      const a = dotOf[l.aSiteId], b = dotOf[l.bSiteId];
      if (a && b && a !== b) chords.push([a.px, a.py, b.px, b.py]);
    }
    /** Un segmento attraversa un rettangolo? (Liang–Barsky) */
    const segHitsRect = (c, r) => {
      let t0 = 0, t1 = 1;
      const dx = c[2] - c[0], dy = c[3] - c[1];
      for (const [p, q] of [[-dx, c[0] - r.x], [dx, r.x + r.w - c[0]], [-dy, c[1] - r.y], [dy, r.y + r.h - c[1]]]) {
        if (p === 0) { if (q < 0) return false; continue; }
        const t = q / p;
        if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
      return true;
    };

    // L'ordine in cui si provano i lati: prima accanto, in lettura (a destra), poi gli altri.
    const SIDES = [
      ['E', 1, 0], ['W', -1, 0], ['NE', 1, -1], ['NW', -1, -1], ['SE', 1, 1], ['SW', -1, 1], ['N', 0, -1], ['S', 0, 1],
    ];
    const boxFor = (name, px, py, w, h, dx, dy, off) => {
      const k = (dx !== 0 && dy !== 0) ? Math.SQRT1_2 : 1;      // in diagonale l'offset si divide fra i due assi
      const ox = off * k, oy = off * k;
      const x = dx > 0 ? px + ox : dx < 0 ? px - ox - w : px - w / 2;
      const y = dy > 0 ? py + oy : dy < 0 ? py - oy - h : py - h / 2;
      return { name, x, y, w, h };
    };

    for (const d of dots) {
      const m = boxOf ? boxOf(d.site.id) : null;
      const w = Math.max(1, num(m && m.w, D.labelW)), h = Math.max(1, num(m && m.h, D.labelH));
      let scelta = null, peggiore = null, minOverlap = Infinity, anello = 0;
      // Due giri: prima si cerca un posto che non copra neanche un collegamento (⑨),
      // e solo se non c'è si accetta di stare sopra una linea — meglio una linea
      // coperta che un'etichetta fuori posto o sopra un'altra.
      for (const conCorde of [true, false]) {
        // Anello 0 = accanto al puntino; poi a passi di un'etichetta, fino a 8 giri.
        for (let ring = 0; ring <= 8 && !scelta; ring++) {
          const off = dotR + dotGap + ring * (h + 4);
          for (const [name, dx, dy] of SIDES) {
            const r = boxFor(name, d.px, d.py, w, h, /** @type {number} */ (dx), /** @type {number} */ (dy), off);
            const libero = inside(r) && !taken.some(t => hitRect(r, t, margin)) && !dots.some(e => hitDot(r, e))
              && (!conCorde || !chords.some(c => segHitsRect(c, r)));
            if (libero) { scelta = r; anello = ring; break; }
            // Se proprio nulla sta, si tiene il meno peggio: quello che tocca meno etichette.
            const urti = taken.filter(t => hitRect(r, t, 0)).length + dots.filter(e => hitDot(r, e)).length + (inside(r) ? 0 : 5);
            if (urti < minOverlap) { minOverlap = urti; peggiore = r; }
          }
        }
        if (scelta) break;
      }
      const r = scelta || peggiore;
      taken.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      // ④ Il filo c'è solo se l'etichetta NON è accanto al suo puntino.
      let leader = null;
      if (scelta ? anello > 0 : true) {
        const nx = Math.max(r.x, Math.min(d.px, r.x + r.w)), ny = Math.max(r.y, Math.min(d.py, r.y + r.h));
        const len = Math.hypot(nx - d.px, ny - d.py);
        if (len > dotR + dotGap + 1) {
          const ux = (nx - d.px) / len, uy = (ny - d.py) / len;
          leader = { x1: _r2(d.px + ux * dotR), y1: _r2(d.py + uy * dotR), x2: _r2(nx), y2: _r2(ny) };
        }
      }
      out.nodes.push({
        siteId: d.site.id, name: d.site.name, role: d.site.role, projectRef: d.site.projectRef,
        subnets: d.site.subnets.length,
        uplinkIds: org.uplinks.filter(u => u.siteId === d.site.id).map(u => u.id),
        angle: null, center: false,
        lat: d.site.geo.lat, lng: d.site.geo.lng,
        px: d.px, py: d.py, dotR: _r2(dotR),
        x: _r2(r.x + r.w / 2), y: _r2(r.y + r.h / 2), w: _r2(r.w), h: _r2(r.h),
        anchor: r.name, leader,
      });
    }

    // ── Gli archi: da puntino a puntino, con il ventaglio dello schema (⑤) ───
    /** @type {Record<string, InterSiteGeoNode>} */
    const byId = Object.create(null);
    for (const n of out.nodes) byId[n.siteId] = n;
    const labelBox = (linkId) => {
      const m = labelOf ? labelOf(linkId) : null;
      const w = num(m && m.w, g.labelW), h = num(m && m.h, g.labelH);
      return { w: w > 0 ? w : 0, h: h > 0 ? h : 0 };
    };
    /** @type {Record<string, string[]>} */
    const groups = Object.create(null);
    for (const l of org.links) {
      if (!byId[l.aSiteId] || !byId[l.bSiteId]) continue;
      (groups[A.pairKey(l.aSiteId, l.bSiteId)] || (groups[A.pairKey(l.aSiteId, l.bSiteId)] = [])).push(l.id);
    }
    for (const l of org.links) {
      const a = byId[l.aSiteId], b = byId[l.bSiteId];
      if (!a || !b) {
        // ③ Manca un capo: o la sede non c'è, o non ha un punto. Si dice quale.
        out.undrawable.links.push({ linkId: l.id, missing: [!a ? l.aSiteId : null, !b ? l.bSiteId : null].filter(Boolean), reason: 'unplaced' });
        continue;
      }
      const dx = b.px - a.px, dy = b.py - a.py;
      const len = Math.hypot(dx, dy);
      // ⑤ Due puntini che si toccano: fra i due non resta filo da disegnare.
      if (len <= dotR * 2 + 1) { out.undrawable.links.push({ linkId: l.id, missing: [], reason: 'too-close' }); continue; }
      const ux = dx / len, uy = dy / len;
      const sib = groups[A.pairKey(l.aSiteId, l.bSiteId)];
      const idx = sib.indexOf(l.id);
      const bow = (idx - (sib.length - 1) / 2) * A.bowStep(sib, -uy, ux, g, labelBox);
      const p1 = { x: a.px + ux * dotR, y: a.py + uy * dotR };
      const p2 = { x: b.px - ux * dotR, y: b.py - uy * dotR };
      out.edges.push(A.edge(l, p1, p2, ux, uy, bow));
    }

    // ── La scala: metri per pixel alla latitudine del centro (②) ────────────
    const latC = _unmerc((minY + maxY) / 2);
    const mpp = R_EARTH * Math.cos(rad(latC)) / view.s;
    const meters = _scaleMeters(mpp, num(o.scaleMin, D.scaleMin), num(o.scaleMax, D.scaleMax));
    const barPx = meters / mpp;
    out.scaleBar = { px: _r2(barPx), meters, x1: 16, x2: _r2(16 + barPx), y: _r2(H - 16) };

    // ── Il reticolo: gradi tondi, a distanza leggibile ──────────────────────
    const gridGap = num(o.gridGap, D.gridGap);
    const cosC = Math.max(0.05, Math.cos(rad(latC)));
    let step = GRID_STEPS[GRID_STEPS.length - 1];
    for (const st of GRID_STEPS) {
      if (rad(st) * view.s >= gridGap && rad(st) * view.s / cosC >= gridGap) { step = st; break; }
    }
    out.graticule.step = step;
    const lngLo = deg((0 - view.ox) / view.s), lngHi = deg((W - view.ox) / view.s);
    for (let d = Math.ceil(lngLo / step - 1e-9) * step; d <= lngHi + 1e-9; d += step) {
      const dd = Math.round(d / step) * step;
      const x = _r2(view.ox + rad(dd) * view.s);
      if (x >= 0 && x <= W) out.graticule.meridians.push({ deg: Math.round(dd * 1e6) / 1e6, x, label: x <= W - 36 });
    }
    const latLo = _unmerc((view.oy - H) / view.s), latHi = _unmerc(view.oy / view.s);
    for (let d = Math.ceil(latLo / step - 1e-9) * step; d <= latHi + 1e-9; d += step) {
      const dd = Math.round(d / step) * step;
      const y = _r2(view.oy - _merc(dd) * view.s);
      if (y >= 0 && y <= H) out.graticule.parallels.push({ deg: Math.round(dd * 1e6) / 1e6, y, label: y >= 16 && y <= H - 36 });
    }
    return out;
  }

  return {
    INTER_SITE_GEO_DEFAULTS, buildInterSiteGeoLayout,
    interSiteGeoProject, interSiteGeoDegLabel, interSiteGeoScaleLabel,
  };
});
