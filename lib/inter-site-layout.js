// ============================================================
// LAYOUT INTER-SEDE — dove va disegnata ogni sede, e ogni collegamento
// (UMD-lite, Node + browser · lingua-indipendente · puro · deterministico)
// ============================================================
// Fase 1 del piano `_local/notes/PIANO_multi-sede-wan-vpn.md`: la MAPPA. Qui non
// c'è SVG, non c'è DOM e non c'è una stringa di UI — solo coordinate. Il
// renderer del browser e l'esportatore (PDF / draw.io) consumano QUESTO, e
// disegnano la stessa mappa perché leggono le stesse coordinate: è la difesa
// contro la definizione doppia motore↔renderer, il bug che in questo progetto è
// già tornato dodici volte.
//
// ── Le scelte, e perché ───────────────────────────────────────────────────
//
//  ① **Deterministico, e senza fisica.** Stesso input → stesse coordinate, in
//     Node come nel browser. Niente force-directed: un grafo che si assesta a
//     ogni apertura è una mappa che non si può confrontare con quella di ieri né
//     stampare due volte uguale. L'ordine di partenza è quello DICHIARATO in
//     `org.sites`: è l'ordine in cui l'utente le ha scritte, non un'invenzione.
//
//  ② **La forma la decide il RUOLO, che è dichiarato.** Una sola sede marcata
//     `hub` → hub al centro e le altre in cerchio. Zero hub, o più d'uno → tutte
//     in cerchio. Con due hub, metterli entrambi «al centro» sarebbe una scelta
//     inventata (quale dei due?): l'anello è la risposta onesta, e `layout` dice
//     quale delle due si è applicata così che la UI possa spiegarlo.
//
//  ③ **Ciò che non si può disegnare si DICE.** `normalizeOrganization` tiene di
//     proposito i collegamenti che puntano a una sede inesistente («un dato reale
//     e sbagliato»): qui non possono avere due capi, e finiscono in `undrawable`
//     con il nome di ciò che manca. Una mappa a cui sparisce un tunnel senza
//     dirlo è peggio di una mappa che ne mostra il buco. Stessa disciplina di
//     `notChecked` in `lib/inter-site-audit.js`.
//
//  ④ **Le etichette NON sono misurate.** Un modulo puro non può sapere quanto è
//     largo un testo con il font del browser (e in questo progetto misurare il
//     testo è già una trappola nota). Qui si restituisce l'ANCORA dell'etichetta
//     e un margine generoso attorno al disegno; l'ingombro reale lo gestisce chi
//     disegna, con `text-anchor` e il viewBox.
//
//  ⑤ **Gli archi doppi si scostano.** Due sedi legate da due collegamenti (il
//     caso reale: MPLS primario + IPsec di backup) darebbero due rette
//     sovrapposte, cioè un collegamento invisibile. Ogni coppia di sedi ha il suo
//     ventaglio di archi, simmetrico rispetto alla corda.
//
// ⚠️ `.js` e non `.ts`: `engines: node >=16` e la CI gira su 18.x/20.x, dove un
//    `.ts` è un SyntaxError. Vedi `lib/provenance.js`.

/** La forma d'insieme applicata, e il perché è visibile a chi racconta.
 *  `empty` nessuna sede · `single` una sola (al centro) · `hub` un hub dichiarato
 *  al centro · `ring` tutte in cerchio (zero hub, o più d'uno).
 *  @typedef {'empty'|'single'|'hub'|'ring'} InterSiteLayoutKind */

/** Una sede piazzata. `r` è il raggio del cerchio, `angle` la sua posizione
 *  sull'anello in radianti (il centro ha `angle: null`).
 *  @typedef {{siteId:string, name:string, role:string, projectRef:string|null,
 *             subnets:number, x:number, y:number, r:number,
 *             angle:number|null, center:boolean}} InterSiteLayoutNode */

/** Un collegamento disegnato. `x1,y1`→`x2,y2` sono già rifilati al bordo dei due
 *  cerchi; `cx,cy` è il punto di controllo di una quadratica (uguale al punto
 *  medio quando `bow` è 0, cioè quando l'arco è una retta); `mx,my` è l'apice,
 *  dove va l'etichetta.
 *  @typedef {{linkId:string, aSiteId:string, bSiteId:string, kind:string,
 *             x1:number, y1:number, x2:number, y2:number,
 *             cx:number, cy:number, mx:number, my:number, bow:number}} InterSiteLayoutEdge */

/** Un uplink WAN: un moncone che esce dalla sede verso l'esterno.
 *  @typedef {{uplinkId:string, siteId:string, x1:number, y1:number,
 *             x2:number, y2:number, angle:number}} InterSiteLayoutUplink */

/** Ciò che non è disegnabile, con il nome di ciò che manca (③).
 *  @typedef {{links:{linkId:string, missing:string[]}[],
 *             uplinks:{uplinkId:string, siteId:string}[]}} InterSiteUndrawable */

/** La mappa, in coordinate. `width`/`height` sono il viewBox già traslato in
 *  modo che il disegno parta da `pad`.
 *  @typedef {{layout:InterSiteLayoutKind, hubSiteId:string|null,
 *             width:number, height:number, ringR:number,
 *             nodes:InterSiteLayoutNode[], edges:InterSiteLayoutEdge[],
 *             uplinks:InterSiteLayoutUplink[],
 *             undrawable:InterSiteUndrawable}} InterSiteLayout */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(isNode ? require('./inter-site.js') : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : globalThis, function (IS) {
  'use strict';

  /** Le misure del disegno. Sono numeri di GEOMETRIA, non di stile: il colore, lo
   *  spessore e il font stanno nel CSS di chi disegna, non qui. */
  const INTER_SITE_LAYOUT_DEFAULTS = {
    nodeR: 34,          // raggio del cerchio-sede
    minRingR: 130,      // raggio minimo dell'anello (con poche sedi non si stringe)
    nodeGap: 34,        // spazio minimo fra due cerchi vicini sull'anello
    bowStep: 30,        // scostamento fra archi della stessa coppia (⑤)
    uplinkLen: 52,      // lunghezza del moncone di un uplink
    uplinkSpread: 0.44, // apertura del ventaglio fra uplink della stessa sede (rad)
    pad: 96,            // margine attorno al disegno, per le etichette non misurate (④)
  };

  const TAU = Math.PI * 2;
  const START_ANGLE = -Math.PI / 2;   // si parte in alto, e si gira in senso orario

  /** Arrotonda a 0.01: coordinate stabili e confrontabili fra Node e browser,
   *  senza code di virgola che rendono illeggibile un diff di golden. */
  const _r2 = (n) => Math.round(n * 100) / 100;

  /** @param {unknown} v @param {number} dflt @returns {number} */
  function _numOr(v, dflt) {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }

  /** Le misure effettive: i default, sovrascritti solo da valori finiti. Scritte
   *  una per una e non in ciclo: così l'elenco delle opzioni che esistono davvero
   *  è leggibile qui, e un nome sbagliato in `opts` non passa inosservato. */
  /** @param {Record<string,unknown>|null|undefined} opts */
  function _geom(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const D = INTER_SITE_LAYOUT_DEFAULTS;
    return {
      nodeR: _numOr(o.nodeR, D.nodeR),
      minRingR: _numOr(o.minRingR, D.minRingR),
      nodeGap: _numOr(o.nodeGap, D.nodeGap),
      bowStep: _numOr(o.bowStep, D.bowStep),
      uplinkLen: _numOr(o.uplinkLen, D.uplinkLen),
      uplinkSpread: _numOr(o.uplinkSpread, D.uplinkSpread),
      pad: _numOr(o.pad, D.pad),
    };
  }

  /**
   * Il raggio dell'anello: abbastanza grande perché `n` cerchi ci stiano senza
   * toccarsi. La circonferenza deve reggere `n` volte (diametro + spazio), da cui
   * `r = n·(2R+gap) / 2π`; sotto una certa soglia non si stringe oltre, altrimenti
   * con due sedi la mappa diventerebbe un puntino.
   */
  /** @param {number} n @param {{nodeR:number, nodeGap:number, minRingR:number}} g */
  function _ringRadius(n, g) {
    if (n <= 1) return 0;
    return Math.max(g.minRingR, (n * (2 * g.nodeR + g.nodeGap)) / TAU);
  }

  /** Firma ordine-indipendente di una coppia di sedi (per il ventaglio ⑤). */
  /** @param {string} a @param {string} b @returns {string} */
  function _pairKey(a, b) {
    return a < b ? a + '\u0000' + b : b + '\u0000' + a;
  }

  /**
   * La mappa inter-sede, in coordinate.
   *
   * Accetta un'organizzazione grezza o già normalizzata: `normalizeOrganization`
   * è idempotente, e passare per lei qui significa che il layout non può mai
   * ricevere una forma a metà (⑤ di `lib/inter-site.js`: un `kind` fuori
   * vocabolario non arriva nemmeno a essere disegnato).
   *
   * @param {unknown} rawOrg
   * @param {Record<string,unknown>} [opts] misure di geometria (vedi `INTER_SITE_LAYOUT_DEFAULTS`)
   * @returns {InterSiteLayout}
   */
  function buildInterSiteLayout(rawOrg, opts) {
    const org = IS.normalizeOrganization(rawOrg);
    const g = _geom(opts);
    const sites = org.sites;

    /** @type {InterSiteLayout} */
    const out = {
      layout: 'empty', hubSiteId: null,
      width: 0, height: 0, ringR: 0,
      nodes: [], edges: [], uplinks: [],
      undrawable: { links: [], uplinks: [] },
    };
    if (!sites.length) {
      out.width = g.pad * 2; out.height = g.pad * 2;
      return out;
    }

    // ── ② La forma la decide il ruolo dichiarato ────────────────────────────
    const hubs = sites.filter(s => s.role === 'hub');
    const hub = (hubs.length === 1) ? hubs[0] : null;
    const ring = hub ? sites.filter(s => s.id !== hub.id) : sites.slice();

    out.layout = (sites.length === 1) ? 'single' : (hub ? 'hub' : 'ring');
    out.hubSiteId = hub ? hub.id : null;

    // Con un solo hub e nessuno spoke la mappa è una sede sola: `ringR` resta 0 e
    // il centro è l'unico punto — nessun caso speciale in più.
    const ringR = _ringRadius(ring.length, g);
    out.ringR = _r2(ringR);

    /** @param {typeof sites[0]} s @param {number} x @param {number} y @param {number|null} angle */
    const _node = (s, x, y, angle) => ({
      siteId: s.id, name: s.name, role: s.role, projectRef: s.projectRef,
      subnets: s.subnets.length,
      x: _r2(x), y: _r2(y), r: g.nodeR,
      angle: angle == null ? null : _r2(angle),
      center: angle == null,
    });

    // Origine provvisoria (0,0): si trasla tutto alla fine, quando si conosce
    // l'ingombro reale. Piazzare prima e traslare dopo tiene la trigonometria in
    // un posto solo.
    if (hub) out.nodes.push(_node(hub, 0, 0, null));
    if (ring.length === 1 && !hub) {
      out.nodes.push(_node(ring[0], 0, 0, null));      // sede unica: al centro
    } else {
      // ⑥ Con un numero PARI di sedi si ruota di mezzo passo. Senza, due di loro
      // finiscono sull'asse verticale (in cima e in fondo) e la mappa diventa
      // alta e stretta: proprio il caso più comune — un hub e due filiali —
      // sprecherebbe tutta la larghezza del foglio su cui si legge. Mezzo passo
      // non cambia né l'ordine né la distanza fra le sedi: le fa solo stare
      // larghe invece che lunghe.
      const step = TAU / ring.length;
      const first = START_ANGLE + (ring.length % 2 === 0 ? step / 2 : 0);
      ring.forEach((s, i) => {
        const a = first + i * step;
        out.nodes.push(_node(s, Math.cos(a) * ringR, Math.sin(a) * ringR, a));
      });
    }

    /** @type {Record<string, InterSiteLayoutNode>} */
    const byId = Object.create(null);
    for (const n of out.nodes) byId[n.siteId] = n;

    // ── ⑤ Il ventaglio degli archi: prima si contano, poi si scostano ───────
    /** @type {Record<string, string[]>} */
    const groups = Object.create(null);
    for (const l of org.links) {
      if (!byId[l.aSiteId] || !byId[l.bSiteId]) continue;   // ③, gestito sotto
      const k = _pairKey(l.aSiteId, l.bSiteId);
      (groups[k] || (groups[k] = [])).push(l.id);
    }

    for (const l of org.links) {
      const A = byId[l.aSiteId];
      const B = byId[l.bSiteId];
      if (!A || !B) {
        const missing = [];
        if (!A) missing.push(l.aSiteId);
        if (!B) missing.push(l.bSiteId);
        out.undrawable.links.push({ linkId: l.id, missing });
        continue;
      }
      const k = _pairKey(l.aSiteId, l.bSiteId);
      const sib = groups[k];
      const idx = sib.indexOf(l.id);
      const bow = (idx - (sib.length - 1) / 2) * g.bowStep;

      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // Rifilo ai bordi dei cerchi lungo la corda: l'arco parte dal bordo, non dal
      // centro, così l'etichetta del nodo non ci finisce sotto.
      const x1 = A.x + ux * A.r, y1 = A.y + uy * A.r;
      const x2 = B.x - ux * B.r, y2 = B.y - uy * B.r;
      // Normale alla corda: l'apice di una quadratica sta a metà fra corda e
      // controllo, quindi il controllo si sposta del DOPPIO dello scostamento.
      const nx = -uy, ny = ux;
      const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;

      out.edges.push({
        linkId: l.id, aSiteId: l.aSiteId, bSiteId: l.bSiteId, kind: l.kind,
        x1: _r2(x1), y1: _r2(y1), x2: _r2(x2), y2: _r2(y2),
        cx: _r2(midX + nx * bow * 2), cy: _r2(midY + ny * bow * 2),
        mx: _r2(midX + nx * bow), my: _r2(midY + ny * bow),
        bow: _r2(bow),
      });
    }

    // ── Gli uplink: monconi che escono dalla sede verso il FUORI ────────────
    // Fuori = lontano dal centro dell'anello. Per una sede al centro «fuori» non
    // è definito: si punta in alto, che è la direzione libera per costruzione
    // (l'anello parte da lì solo se ci sono spoke, e in quel caso il primo spoke
    // è più lontano del moncone).
    /** @type {Record<string, string[]>} */
    const upBySite = Object.create(null);
    for (const u of org.uplinks) {
      if (!byId[u.siteId]) { out.undrawable.uplinks.push({ uplinkId: u.id, siteId: u.siteId }); continue; }
      (upBySite[u.siteId] || (upBySite[u.siteId] = [])).push(u.id);
    }
    for (const u of org.uplinks) {
      const N = byId[u.siteId];
      if (!N) continue;
      const sib = upBySite[u.siteId];
      const idx = sib.indexOf(u.id);
      const base = (N.angle == null) ? START_ANGLE : N.angle;
      const a = base + (idx - (sib.length - 1) / 2) * g.uplinkSpread;
      const ux = Math.cos(a), uy = Math.sin(a);
      out.uplinks.push({
        uplinkId: u.id, siteId: u.siteId,
        x1: _r2(N.x + ux * N.r), y1: _r2(N.y + uy * N.r),
        x2: _r2(N.x + ux * (N.r + g.uplinkLen)), y2: _r2(N.y + uy * (N.r + g.uplinkLen)),
        angle: _r2(a),
      });
    }

    // ── Ingombro e traslazione ─────────────────────────────────────────────
    // ④ Le etichette non sono misurate: il margine `pad` è il loro spazio, ed è
    // volutamente generoso. Chi disegna resta padrone del viewBox.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const _see = (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const n of out.nodes) { _see(n.x - n.r, n.y - n.r); _see(n.x + n.r, n.y + n.r); }
    for (const e of out.edges) { _see(e.mx, e.my); _see(e.cx, e.cy); }
    for (const u of out.uplinks) _see(u.x2, u.y2);

    const ox = g.pad - minX, oy = g.pad - minY;
    for (const n of out.nodes) { n.x = _r2(n.x + ox); n.y = _r2(n.y + oy); }
    for (const e of out.edges) {
      e.x1 = _r2(e.x1 + ox); e.y1 = _r2(e.y1 + oy);
      e.x2 = _r2(e.x2 + ox); e.y2 = _r2(e.y2 + oy);
      e.cx = _r2(e.cx + ox); e.cy = _r2(e.cy + oy);
      e.mx = _r2(e.mx + ox); e.my = _r2(e.my + oy);
    }
    for (const u of out.uplinks) {
      u.x1 = _r2(u.x1 + ox); u.y1 = _r2(u.y1 + oy);
      u.x2 = _r2(u.x2 + ox); u.y2 = _r2(u.y2 + oy);
    }
    out.width = _r2(maxX - minX + g.pad * 2);
    out.height = _r2(maxY - minY + g.pad * 2);

    return out;
  }

  /**
   * Il `d` di un `<path>` per un arco: una retta quando non è scostato, una
   * quadratica quando lo è. Sta QUI e non nel renderer perché la stessa stringa
   * serve identica all'SVG del browser e a quello dell'export (definizione unica).
   */
  /** @param {InterSiteLayoutEdge} e @returns {string} */
  function interSiteEdgePath(e) {
    if (!e) return '';
    return e.bow === 0
      ? `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`
      : `M ${e.x1} ${e.y1} Q ${e.cx} ${e.cy} ${e.x2} ${e.y2}`;
  }

  return { INTER_SITE_LAYOUT_DEFAULTS, buildInterSiteLayout, interSiteEdgePath };
});
