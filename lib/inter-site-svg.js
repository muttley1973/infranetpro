// ============================================================
// LA MAPPA INTER-SEDE SU CARTA — SVG vettoriale, fondo bianco
// (UMD-lite, Node + browser · lingua-indipendente · puro · deterministico)
// ============================================================
// La stessa mappa del pannello, disegnata per essere STAMPATA. Le coordinate
// arrivano da `lib/inter-site-layout.js` — le identiche che usa il browser: due
// disegni, una geometria sola (④ del layout). Qui si decide soltanto con che
// inchiostro.
//
// ── Le scelte, e perché ───────────────────────────────────────────────────
//
//  ① **Non si esporta l'SVG dello SCHERMO, si ridisegna.** L'SVG del pannello è
//     vestito di CLASSI CSS (`org-node-box`, `org-edge-line`) e i colori stanno
//     nel foglio di stile, che in un PDF non c'è: passato a `svg-to-pdfkit`
//     uscirebbe un disegno di forme nere senza bordi. E siccome quelle classi
//     seguono il TEMA, un utente col tema scuro avrebbe consegnato al cliente
//     una pagina di testo chiaro su bianco. Qui ogni colore è un attributo, e
//     il fondo è un rettangolo bianco DICHIARATO: la pagina esce uguale a
//     chiunque la stampi, da qualunque tema.
//
//  ② **Vettoriale, mai un'immagine.** Niente rasterizzazione, niente `<image>`:
//     un dossier si legge anche ingrandito al 400% sul portatile in sala
//     macchine, e una mappa sgranata lì è una mappa che non si usa.
//
//  ③ **Le parole arrivano già scritte.** Questo modulo non traduce e non
//     compone frasi: riceve le righe di ogni riquadro e l'etichetta di ogni
//     arco. La lingua la sa chi stampa (①  di `lib/inter-site-report.js`).
//
//  ④ **Il testo si misura FUORI.** Un modulo puro non sa quanto è largo
//     «Fibra spenta · 2 reti» col font del PDF: chi disegna lo misura col suo
//     motore e lo passa al layout, che allarga i riquadri e le fessure. Qui si
//     riceve la larghezza già decisa e la si usa per la pastiglia.
//
//  ⑤ **Niente glifi fuori CP1252.** I font standard del PDF non sostituiscono
//     ciò che non sanno disegnare: lo disegnano SBAGLIATO. La stellina dell'hub
//     del pannello (★) sulla carta diventerebbe un simbolo a caso — al suo posto
//     va un'etichetta di testo, che chi stampa passa già tradotta.
//     ⚠️ Stessa trappola di `_pdfSafe` in `server/pdf-report.js`.
//
// ⚠️ `.js` e non `.ts`: il prodotto dichiara `engines: node >=16` e la CI gira su
//    18.x/20.x, dove un `.ts` è un SyntaxError. Vedi `lib/provenance.js`.

/** Una riga dentro il riquadro di una sede. `bold` solo per il nome.
 *  @typedef {{text:string, bold?:boolean, muted?:boolean}} MapBoxLine */

/** Ciò che va SCRITTO sulla mappa — già in parole (③).
 *  @typedef {{nodeLines?:Record<string,MapBoxLine[]>, nodeTag?:Record<string,string>,
 *             edgeLabels?:Record<string,string>, edgeTone?:Record<string,string>,
 *             labelW?:Record<string,number>, here?:string|null}} MapContent */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(
    isNode ? require('./inter-site-layout.js') : root,
    isNode ? require('./xml-escape.js') : root,
    isNode ? require('./inter-site-geo.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (IL, X, GEO) {
  'use strict';

  /** L'inchiostro della mappa stampata: scuro su bianco, e nessun colore che
   *  sparisca in fotocopia. I toni degli archi sono gli stessi tre del pannello
   *  (su / giù / non pronunciato), perché è la stessa informazione. */
  const INTER_SITE_SVG_INK = {
    page: '#ffffff',
    boxFill: '#ffffff',
    boxStroke: '#94a3b8',
    boxStrokeHere: '#1d4ed8',
    name: '#0f172a',
    line: '#334155',
    muted: '#64748b',
    tag: '#475569',
    edge: '#475569',
    edgeUp: '#15803d',
    edgeDown: '#b91c1c',
    badgeFill: '#ffffff',
    badgeText: '#1e293b',
    // La carta geografica: il reticolo è un'ombra (non deve competere con i
    // collegamenti), il puntino è la sede, il filo la lega alla sua etichetta.
    grid: '#e2e8f0',
    gridText: '#94a3b8',
    dot: '#1e293b',
    leader: '#94a3b8',
    scale: '#334155',
  };

  /** La geometria del CONTENUTO di un riquadro (quella dei riquadri sta nel
   *  layout). Numeri di disegno, non di stile. */
  const INTER_SITE_SVG_GEOM = {
    padX: 11, padY: 10,     // imbottitura del riquadro
    nameH: 20, lineH: 15,   // passo verticale: prima riga (nome) e successive
    nameSize: 11, lineSize: 8.5, tagSize: 7.5, labelSize: 8,
    radius: 10,             // raccordo del riquadro
    badgePadX: 9, badgeH: 20, badgeR: 10,
    gridSize: 6.5, scaleSize: 7.5, geoLabelSize: 9, geoLabelR: 6,
  };

  // ⚠️ L'escape XML è quello CONDIVISO (`lib/xml-escape.js`), lo stesso che usa
  // l'export draw.io: un SVG è XML, e un nome di sede con una `&` dentro romperebbe
  // il file. Riscriverlo qui sarebbe la seconda copia della stessa funzione.
  const _esc = X.escapeXML;

  /** Un numero pronto per un attributo, senza code di virgola. */
  const _n = (v) => {
    const x = Math.round(Number(v) * 100) / 100;
    return Number.isFinite(x) ? x : 0;
  };

  /**
   * Gli archi, in SVG: lo stesso disegno per la mappa a schema e per la carta
   * geografica (il filo, il tono su/giù, il tratteggio, la pastiglia). Una definizione
   * sola: due copie dello stesso inchiostro divergono al primo ritocco.
   * @param {*} L il layout @param {{edgeLabels:Record<string,string>, edgeTone:Record<string,string>, labelW:Record<string,number>}} C
   * @param {Record<string,string>} ink @param {Record<string,number>} G @returns {string}
   */
  function _edgesSvg(L, C, ink, G) {
    const edgePath = IL.interSiteEdgePath;
    const edgeLabels = C.edgeLabels, edgeTone = C.edgeTone, labelW = C.labelW;
    return (L.edges || []).map(e => {
      const tono = edgeTone[e.linkId];
      const col = tono === 'up' ? ink.edgeUp : tono === 'down' ? ink.edgeDown : ink.edge;
      // ⚠️ Il tratteggio non è decorazione: è l'unico segno che sopravvive a una
      // fotocopia in bianco e nero, dove il rosso e il verde diventano lo stesso
      // grigio. Un collegamento giù si vede anche così.
      const dash = tono === 'down' ? ' stroke-dasharray="7,4"' : '';
      const testo = edgeLabels[e.linkId];
      let pastiglia = '';
      if (testo) {
        const w = Number(labelW[e.linkId]) || 0;
        const bw = w ? w + G.badgePadX * 2 : 0;
        pastiglia = (bw
          ? `<rect x="${_n(e.mx - bw / 2)}" y="${_n(e.my - G.badgeH / 2)}" width="${_n(bw)}" height="${_n(G.badgeH)}"`
            + ` rx="${_n(G.badgeR)}" fill="${_esc(ink.badgeFill)}" stroke="${_esc(col)}" stroke-width="0.8"/>`
          : '')
          + `<text x="${_n(e.mx)}" y="${_n(e.my)}" text-anchor="middle" dominant-baseline="middle"`
          + ` font-family="Helvetica" font-size="${_n(G.labelSize)}" fill="${_esc(ink.badgeText)}">${_esc(testo)}</text>`;
      }
      return `<path d="${edgePath(e)}" fill="none" stroke="${_esc(col)}" stroke-width="1.6" stroke-linecap="round"${dash}/>${pastiglia}`;
    }).join('');
  }

  /**
   * La mappa, in SVG, pronta da consegnare a `svg-to-pdfkit`.
   *
   * @param {*} layout l'uscita di `buildInterSiteLayout`
   * @param {MapContent} [content] cosa c'è scritto (③)
   * @param {{ink?:Record<string,string>, geom?:Record<string,number>}} [opts]
   * @returns {string} l'SVG completo, con `xmlns` e il fondo bianco
   */
  function buildInterSiteMapSvg(layout, content, opts) {
    const L = (layout && typeof layout === 'object') ? layout : null;
    const C = (content && typeof content === 'object') ? content : {};
    const O = (opts && typeof opts === 'object') ? opts : {};
    const ink = Object.assign({}, INTER_SITE_SVG_INK, O.ink || {});
    const G = Object.assign({}, INTER_SITE_SVG_GEOM, O.geom || {});
    const W = L ? _n(L.width) : 0;
    const H = L ? _n(L.height) : 0;
    // Una mappa senza sedi non è un disegno vuoto: non è un disegno. Chi stampa
    // deve poterlo capire da qui (stringa vuota) e scrivere lo stato vuoto a
    // parole, invece di incollare un rettangolo bianco che sembra un guasto.
    if (!L || !Array.isArray(L.nodes) || !L.nodes.length || !W || !H) return '';

    const nodeLines = C.nodeLines || {};
    const nodeTag = C.nodeTag || {};
    const edgeLabels = C.edgeLabels || {};
    const edgeTone = C.edgeTone || {};
    const labelW = C.labelW || {};
    const here = C.here == null ? null : String(C.here);

    const archi = _edgesSvg(L, { edgeLabels, edgeTone, labelW }, ink, G);

    const riquadri = (L.nodes || []).map(n => {
      const righe = Array.isArray(nodeLines[n.siteId]) ? nodeLines[n.siteId] : [{ text: n.name }];
      const mia = here != null && String(n.siteId) === here;
      const x0 = n.x - n.w / 2, y0 = n.y - n.h / 2;
      let y = y0 + G.padY + G.nameSize;
      const testi = righe.map((r, i) => {
        const bold = i === 0 || !!r.bold;
        const size = i === 0 ? G.nameSize : G.lineSize;
        const col = i === 0 ? ink.name : (r.muted ? ink.muted : ink.line);
        const el = `<text x="${_n(x0 + G.padX)}" y="${_n(y)}" font-family="Helvetica" font-size="${_n(size)}"`
          + (bold ? ' font-weight="bold"' : '') + ` fill="${_esc(col)}">${_esc(r.text)}</text>`;
        y += (i === 0 ? G.nameH : G.lineH);
        return el;
      }).join('');
      // ⑤ Il marcatore del ruolo è TESTO, non un simbolo: allineato a destra
      // sulla riga del nome, dove il pannello mette la stellina.
      const tag = nodeTag[n.siteId]
        ? `<text x="${_n(x0 + n.w - G.padX)}" y="${_n(y0 + G.padY + G.nameSize)}" text-anchor="end"`
          + ` font-family="Helvetica" font-size="${_n(G.tagSize)}" fill="${_esc(ink.tag)}">${_esc(nodeTag[n.siteId])}</text>`
        : '';
      return `<rect x="${_n(x0)}" y="${_n(y0)}" width="${_n(n.w)}" height="${_n(n.h)}" rx="${_n(G.radius)}"`
        + ` fill="${_esc(ink.boxFill)}" stroke="${_esc(mia ? ink.boxStrokeHere : ink.boxStroke)}"`
        + ` stroke-width="${mia ? 1.8 : 1}"/>${tag}${testi}`;
    }).join('');

    // ① Il fondo bianco è un rettangolo, non un'assenza: un SVG «trasparente»
    // stampato sopra qualunque cosa ci sia sotto non è una mappa consegnabile.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
      + `<rect x="0" y="0" width="${W}" height="${H}" fill="${_esc(ink.page)}"/>`
      + archi + riquadri
      + '</svg>';
  }

  /**
   * La CARTA geografica, in SVG, pronta da consegnare a `svg-to-pdfkit`.
   *
   * Stesse regole della mappa a schema (① vettoriale, fondo bianco DICHIARATO,
   * niente glifi fuori CP1252, parole già scritte da chi stampa), con i segni di
   * una carta: il reticolo dei gradi, la barra della scala, i puntini e i fili.
   * Le coordinate sono quelle di `buildInterSiteGeoLayout` — le identiche del
   * pannello — e gli archi sono gli stessi dello schema (`_edgesSvg`).
   *
   * Restituisce la stringa vuota se non c'è niente da disegnare: layout assente o
   * non geografico, o nessuna sede con un punto. Chi stampa scrive allora lo stato
   * vuoto a parole.
   *
   * @param {*} layout l'uscita di `buildInterSiteGeoLayout`
   * @param {MapContent} [content] `nodeLines[id][0].text` è il nome da scrivere; il resto come nello schema
   * @param {{ink?:Record<string,string>, geom?:Record<string,number>}} [opts]
   * @returns {string}
   */
  function buildInterSiteGeoMapSvg(layout, content, opts) {
    const L = (layout && typeof layout === 'object') ? layout : null;
    const C = (content && typeof content === 'object') ? content : {};
    const O = (opts && typeof opts === 'object') ? opts : {};
    const ink = Object.assign({}, INTER_SITE_SVG_INK, O.ink || {});
    const G = Object.assign({}, INTER_SITE_SVG_GEOM, O.geom || {});
    const W = L ? _n(L.width) : 0;
    const H = L ? _n(L.height) : 0;
    if (!L || L.layout !== 'geo' || !Array.isArray(L.nodes) || !L.nodes.length || !W || !H) return '';

    const nodeLines = C.nodeLines || {};
    const here = C.here == null ? null : String(C.here);
    const grat = L.graticule || { meridians: [], parallels: [] };

    // Il reticolo sta SOTTO a tutto: è lo sfondo che dice «questa è una carta».
    const reticolo = (grat.meridians || []).map(m =>
      `<line x1="${_n(m.x)}" y1="0" x2="${_n(m.x)}" y2="${H}" stroke="${_esc(ink.grid)}" stroke-width="0.6"/>`
      + (m.label === false ? '' : `<text x="${_n(m.x + 2)}" y="${_n(G.gridSize + 3)}" font-family="Helvetica" font-size="${_n(G.gridSize)}"`
      + ` fill="${_esc(ink.gridText)}">${_esc(GEO.interSiteGeoDegLabel(m.deg, 'lng'))}</text>`)
    ).join('') + (grat.parallels || []).map(p =>
      `<line x1="0" y1="${_n(p.y)}" x2="${W}" y2="${_n(p.y)}" stroke="${_esc(ink.grid)}" stroke-width="0.6"/>`
      + (p.label === false ? '' : `<text x="3" y="${_n(p.y - 2)}" font-family="Helvetica" font-size="${_n(G.gridSize)}"`
      + ` fill="${_esc(ink.gridText)}">${_esc(GEO.interSiteGeoDegLabel(p.deg, 'lat'))}</text>`)
    ).join('');

    const archi = _edgesSvg(L, { edgeLabels: C.edgeLabels || {}, edgeTone: C.edgeTone || {}, labelW: C.labelW || {} }, ink, G);

    const sedi = L.nodes.map(n => {
      const righe = Array.isArray(nodeLines[n.siteId]) ? nodeLines[n.siteId] : [{ text: n.name }];
      const nome = righe.length && righe[0] && righe[0].text != null ? righe[0].text : n.name;
      const mia = here != null && String(n.siteId) === here;
      const filo = n.leader
        ? `<line x1="${_n(n.leader.x1)}" y1="${_n(n.leader.y1)}" x2="${_n(n.leader.x2)}" y2="${_n(n.leader.y2)}"`
          + ` stroke="${_esc(ink.leader)}" stroke-width="0.8"/>`
        : '';
      const x0 = n.x - n.w / 2, y0 = n.y - n.h / 2;
      return filo
        + `<rect x="${_n(x0)}" y="${_n(y0)}" width="${_n(n.w)}" height="${_n(n.h)}" rx="${_n(G.geoLabelR)}"`
        + ` fill="${_esc(ink.boxFill)}" stroke="${_esc(mia ? ink.boxStrokeHere : ink.boxStroke)}" stroke-width="${mia ? 1.6 : 0.9}"/>`
        + `<text x="${_n(n.x)}" y="${_n(n.y)}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica"`
        + ` font-weight="bold" font-size="${_n(G.geoLabelSize)}" fill="${_esc(ink.name)}">${_esc(nome)}</text>`
        + `<circle cx="${_n(n.px)}" cy="${_n(n.py)}" r="${_n(n.dotR)}" fill="${_esc(ink.dot)}"`
        + ` stroke="${_esc(mia ? ink.boxStrokeHere : ink.page)}" stroke-width="${mia ? 2 : 1.2}"/>`;
    }).join('');

    // La barra della scala: un segno con i due tacchi e il suo numero tondo.
    const sb = L.scaleBar;
    const scala = sb
      ? `<g stroke="${_esc(ink.scale)}" stroke-width="1.2" fill="none">`
        + `<line x1="${_n(sb.x1)}" y1="${_n(sb.y)}" x2="${_n(sb.x2)}" y2="${_n(sb.y)}"/>`
        + `<line x1="${_n(sb.x1)}" y1="${_n(sb.y - 4)}" x2="${_n(sb.x1)}" y2="${_n(sb.y + 4)}"/>`
        + `<line x1="${_n(sb.x2)}" y1="${_n(sb.y - 4)}" x2="${_n(sb.x2)}" y2="${_n(sb.y + 4)}"/></g>`
        + `<text x="${_n(sb.x1)}" y="${_n(sb.y - 7)}" font-family="Helvetica" font-size="${_n(G.scaleSize)}"`
        + ` fill="${_esc(ink.scale)}">${_esc(GEO.interSiteGeoScaleLabel(sb.meters))}</text>`
      : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
      + `<rect x="0" y="0" width="${W}" height="${H}" fill="${_esc(ink.page)}"/>`
      + reticolo + archi + sedi + scala
      + '</svg>';
  }

  return { INTER_SITE_SVG_INK, INTER_SITE_SVG_GEOM, buildInterSiteMapSvg, buildInterSiteGeoMapSvg };
});
