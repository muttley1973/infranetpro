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
//  ④ **Le etichette NON sono misurate QUI — ma il righello si può passare.** Un
//     modulo puro non sa quanto è largo un testo con il font del browser. Chi
//     disegna lo sa: passa `boxOf(siteId) → {w,h}` (nel browser lo misura col
//     canvas, l'export PDF col suo motore) e la geometria si adatta. Senza
//     righello si ricade su una scatola di misura fissa e dichiarata. È
//     iniezione di dipendenza, non un DOM che entra in un modulo puro.
//
//  ⑤ **Gli archi doppi si scostano.** Due sedi legate da due collegamenti (il
//     caso reale: MPLS primario + IPsec di backup) darebbero due rette
//     sovrapposte, cioè un collegamento invisibile. Ogni coppia di sedi ha il suo
//     ventaglio di archi, simmetrico rispetto alla corda.
//
//  ⑥ **Mezzo passo di rotazione con un numero PARI di sedi.** Senza, due di loro
//     finiscono sull'asse verticale e la mappa diventa alta e stretta: proprio il
//     caso più comune — un hub e due filiali — sprecherebbe tutta la larghezza
//     del foglio su cui si legge.
//
//  ⑩ **La sede è un RETTANGOLO, e gli uplink stanno DENTRO.** Erano monconi che
//     uscivano verso il fuori, e la domanda di chi guardava era «ma l'operatore
//     non sta al capo del collegamento?». Sta: un uplink appartiene alla SEDE
//     (`wanUplink.siteId`), e la sede è il capo del collegamento — quindi si
//     disegna dentro il suo riquadro, che è esattamente ciò che il modello dice.
//     ⛔ **Ciò che NON si può fare è appoggiare l'operatore SULL'ARCO** quando
//     nessuno l'ha detto, come se quella linea portasse quel tunnel: con due
//     linee in una sede e niente di dichiarato, «quale delle due porta l'IPsec»
//     non lo sa nessuno, e disegnarlo sarebbe inventare con la faccia di un fatto.
//     ⚠️ Il motivo NON è più «il modello non ce l'ha»: da ⑳ ogni collegamento,
//     di qualunque natura, porta `underlayUplinkIds`. Dove è DICHIARATO, la
//     relazione arco↔linea è un fatto e si potrebbe disegnare — è lavoro non
//     fatto, non lavoro impossibile. Dove è vuoto il divieto resta intero.
//     Il nodo porta `uplinkIds` in ordine dichiarato; il contenuto del riquadro
//     lo compone chi disegna, che è l'unico a sapere in che lingua parla.
//
// ⚠️ `.js` e non `.ts`: il prodotto dichiara `engines: node >=16` e la CI gira su
//    18.x/20.x, dove un `.ts` è un SyntaxError. Vedi `lib/provenance.js`.

/** La forma d'insieme applicata, e il perché è visibile a chi racconta.
 *  `empty` nessuna sede · `single` una sola (al centro) · `hub` un hub dichiarato
 *  al centro · `ring` tutte in cerchio (zero hub, o più d'uno).
 *  @typedef {'empty'|'single'|'hub'|'ring'} InterSiteLayoutKind */

/** Una sede piazzata. `x,y` è il CENTRO del riquadro, `w,h` la sua misura;
 *  `angle` è la posizione sull'anello in radianti (il centro ha `angle: null`).
 *  `uplinkIds` sono i suoi uplink in ordine dichiarato (⑩): stanno dentro.
 *  @typedef {{siteId:string, name:string, role:string, projectRef:string|null,
 *             subnets:number, uplinkIds:string[],
 *             x:number, y:number, w:number, h:number,
 *             angle:number|null, center:boolean}} InterSiteLayoutNode */

/** Un collegamento disegnato. `x1,y1`→`x2,y2` sono già rifilati al BORDO dei due
 *  rettangoli; `cx,cy` è il punto di controllo di una quadratica (uguale al punto
 *  medio quando `bow` è 0, cioè quando l'arco è una retta); `mx,my` è l'apice,
 *  dove va l'etichetta.
 *  @typedef {{linkId:string, aSiteId:string, bSiteId:string, kind:string,
 *             x1:number, y1:number, x2:number, y2:number,
 *             cx:number, cy:number, mx:number, my:number, bow:number}} InterSiteLayoutEdge */

/** Ciò che non è disegnabile, con il nome di ciò che manca (③).
 *  @typedef {{links:{linkId:string, missing:string[]}[],
 *             uplinks:{uplinkId:string, siteId:string}[]}} InterSiteUndrawable */

/** La mappa, in coordinate. `width`/`height` sono il viewBox già traslato in
 *  modo che il disegno parta da `pad`.
 *  @typedef {{layout:InterSiteLayoutKind, hubSiteId:string|null,
 *             width:number, height:number, ringR:number,
 *             nodes:InterSiteLayoutNode[], edges:InterSiteLayoutEdge[],
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
    nodeW: 210,         // larghezza del riquadro-sede senza righello (④)
    nodeH: 84,          // altezza    "        "        "
    minRingR: 150,      // raggio minimo dell'anello (con poche sedi non si stringe)
    nodeGap: 56,        // spazio minimo fra due riquadri vicini sull'anello
    // ⑫ Lo spazio che la PASTIGLIA di un collegamento occupa fra due sedi. Zero
    // di default: un modulo puro non sa quanto è larga «Fibra spenta · 2 reti»
    // con il font di chi disegna, e chi disegna lo misura e lo passa (④).
    // Sono DUE numeri e non uno perché una pastiglia è larga e bassa: riservarle
    // in altezza la sua larghezza farebbe una mappa alta il triplo del necessario.
    labelW: 0,          // quanto larga dev'essere la fessura fra due riquadri
    labelH: 0,          // e quanto alta
    bowStep: 34,        // scostamento MINIMO fra archi della stessa coppia (⑤, ⑰)
    labelGap: 10,       // ⑰ il respiro fra due pastiglie affiancate della stessa coppia
    pad: 40,            // margine attorno al disegno (chi disegna può ritagliare meglio)
  };

  const TAU = Math.PI * 2;
  const START_ANGLE = -Math.PI / 2;   // si parte in alto, e si gira in senso orario

  /** Arrotonda a 0.01: coordinate stabili e confrontabili fra Node e browser,
   *  senza code di virgola che rendono illeggibile un diff di golden. */
  const _r2 = (n) => Math.round(n * 100) / 100;

  /** Un numero, o il default.
   *  ⚠️ `null`, `undefined` e `''` vanno esclusi PRIMA della conversione:
   *  `Number(null)` è **0**, che è finito — quindi un valore assente sarebbe
   *  diventato «zero», e un riquadro largo zero. È la stessa trappola
   *  `+null === 0` già annotata in `lib/ipam-model.js`. */
  /** @param {unknown} v @param {number} dflt @returns {number} */
  function _numOr(v, dflt) {
    if (v == null || v === '') return dflt;
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
      nodeW: _numOr(o.nodeW, D.nodeW),
      nodeH: _numOr(o.nodeH, D.nodeH),
      minRingR: _numOr(o.minRingR, D.minRingR),
      nodeGap: _numOr(o.nodeGap, D.nodeGap),
      labelW: _numOr(o.labelW, D.labelW),
      labelH: _numOr(o.labelH, D.labelH),
      bowStep: _numOr(o.bowStep, D.bowStep),
      labelGap: _numOr(o.labelGap, D.labelGap),
      pad: _numOr(o.pad, D.pad),
    };
  }

  /** La fessura fra due riquadri, per asse: mai meno dello spazio minimo, e
   *  abbastanza da far stare la pastiglia del collegamento (⑫). */
  /** @param {{nodeGap:number, labelW:number, labelH:number}} g */
  const _gapX = (g) => Math.max(g.nodeGap, g.labelW);
  /** @param {{nodeGap:number, labelW:number, labelH:number}} g */
  const _gapY = (g) => Math.max(g.nodeGap, g.labelH);

  /**
   * Il raggio dell'anello: abbastanza grande perché due riquadri VICINI non si
   * tocchino. La corda fra due vicini su `n` posizioni è `2·R·sin(π/n)`, e deve
   * valere almeno la larghezza del riquadro più largo più lo spazio: da lì il
   * raggio. Sotto una soglia non si stringe oltre, altrimenti con due sedi la
   * mappa diventerebbe un francobollo.
   * ⚠️ Si usa la LARGHEZZA e non l'altezza perché i riquadri sono più larghi che
   *    alti: è la misura che decide davvero se si sovrappongono.
   */
  /** @param {number} n @param {number} maxW
   *  @param {{nodeGap:number, minRingR:number, labelW:number, labelH:number}} g */
  function _ringRadius(n, maxW, g) {
    if (n <= 1) return 0;
    // La corda fra due vicini è già una stima al caso peggiore (usa la larghezza
    // massima qualunque sia la direzione): la pastiglia entra con lo stesso
    // criterio, perché anche due vicini sull'anello possono essere collegati.
    const corda = maxW + _gapX(g);
    return Math.max(g.minRingR, corda / (2 * Math.sin(Math.PI / n)));
  }

  /**
   * ⑪ **A che distanza due riquadri smettono di sovrapporsi, lungo `ang`.**
   *
   * Il raggio dell'anello sopra guarda solo i riquadri VICINI FRA LORO. Con un
   * hub però al centro c'è un terzo riquadro, e nessuno guardava quello: con le
   * misure vere (300×140 a schermo) l'hub e le sue filiali si sovrapponevano di
   * 122 px e l'arco spariva sotto — segnalato così: «i riquadri sono troppo
   * grandi, non si vedono più i collegamenti». Il difetto è nato con i riquadri
   * (⑩): finché la sede era un puntino il centro non ingombrava.
   *
   * Due rettangoli allineati agli assi NON si toccano se basta UNO dei due assi
   * a separarli — `|dx| ≥ (w1+w2)/2` **oppure** `|dy| ≥ (h1+h2)/2`. Da qui la
   * distanza minima fra i centri lungo `ang`: si prende il MINORE dei due
   * requisiti, perché ne basta uno.
   * ⚠️ Non la somma dei due «raggi» del rettangolo lungo `ang`: è la formula che
   *    viene in mente per prima, ed è SBAGLIATA — con un riquadro largo-basso e
   *    uno stretto-alto a 45° li lascia sovrapposti.
   */
  /** @param {{w:number,h:number}} a @param {{w:number,h:number}} b
   *  @param {number} ang @param {number} gapX @param {number} gapY @returns {number} */
  function _clearance(a, b, ang, gapX, gapY) {
    const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
    const rx = c === 0 ? Infinity : ((a.w + b.w) / 2 + gapX) / c;
    const ry = s === 0 ? Infinity : ((a.h + b.h) / 2 + gapY) / s;
    return Math.min(rx, ry);       // coseno e seno non sono mai nulli insieme
  }

  /**
   * ⑰ **Quanto devono stare larghi due archi della stessa coppia di sedi.**
   *
   * Era una costante (`bowStep`), e la costante non guarda le etichette: con due
   * collegamenti fra le stesse due sedi le pastiglie stanno affiancate lungo la
   * NORMALE alla corda, e 34 px bastano solo finché sono strette. Su una corda
   * quasi verticale la normale è quasi orizzontale, e lì 34 px separano due
   * parole larghe 170 e 50: si sovrapponevano, ed è così che è stato segnalato.
   *
   * Il passo diventa una MISURA: la distanza a cui, lungo la normale, ogni
   * coppia di pastiglie del gruppo smette di toccarsi — la stessa formula del
   * raggio dell'anello (⑪), che è il test di separazione per asse e non la somma
   * dei raggi. Si guardano TUTTE le coppie, non solo le vicine, dividendo per
   * quante posizioni le separano: con spaziatura uniforme la prima e la terza
   * distano due passi, e una pastiglia stretta in mezzo non deve poter chiudere
   * le due larghe addosso l'una all'altra.
   *
   * ⚠️ Non SCENDE mai sotto `bowStep`: due archi vanno distinti anche quando le
   * loro etichette sono minuscole, o non ci sono ancora. E senza righello (primo
   * giro, o export che non misura) le misure sono zero e resta la costante: non
   * si inventa una larghezza per un font che non si conosce (④).
   */
  /** @param {string[]} sib @param {number} nx @param {number} ny
   *  @param {{bowStep:number, labelGap:number, labelW:number, labelH:number}} g
   *  @param {(id:string) => {w:number,h:number}} labelBox @returns {number} */
  function _bowStep(sib, nx, ny, g, labelBox) {
    if (sib.length < 2) return g.bowStep;
    const ang = Math.atan2(ny, nx);
    let step = g.bowStep;
    for (let i = 0; i < sib.length; i++) {
      const a = labelBox(sib[i]);
      if (!a.w && !a.h) continue;
      for (let j = i + 1; j < sib.length; j++) {
        const b = labelBox(sib[j]);
        if (!b.w && !b.h) continue;
        step = Math.max(step, _clearance(a, b, ang, g.labelGap, g.labelGap) / (j - i));
      }
    }
    return step;
  }

  /**
   * Dove un raggio uscente dal centro di un rettangolo ne attraversa il bordo.
   * Serve a far partire gli archi dal BORDO del riquadro invece che dal centro:
   * sotto un riquadro pieno di testo, una linea che parte dal centro ci passa
   * sopra. Si scala la direzione fino al primo dei due lati che incontra.
   */
  /** @param {number} cx @param {number} cy @param {number} w @param {number} h
   *  @param {number} ux @param {number} uy @returns {{x:number, y:number}} */
  function _rectEdge(cx, cy, w, h, ux, uy) {
    const hw = w / 2, hh = h / 2;
    const tx = ux === 0 ? Infinity : hw / Math.abs(ux);
    const ty = uy === 0 ? Infinity : hh / Math.abs(uy);
    const t = Math.min(tx, ty);
    if (!Number.isFinite(t)) return { x: cx, y: cy };
    return { x: cx + ux * t, y: cy + uy * t };
  }

  /** Firma ordine-indipendente di una coppia di sedi (per il ventaglio ⑤).
   *  Il separatore è un NUL: in un id di sede non può comparire, quindi due
   *  coppie diverse non possono collidere. ⚠️ Si scrive come sequenza di ESCAPE,
   *  mai come byte crudo — un NUL vero rende il sorgente invisibile a `grep`. */
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
   * @param {Record<string,unknown>} [opts] misure di geometria
   *        (vedi `INTER_SITE_LAYOUT_DEFAULTS`) più, opzionale, il righello:
   *        `boxOf(siteId) → {w,h}` con la misura VERA del riquadro (④).
   * @returns {InterSiteLayout}
   */
  function buildInterSiteLayout(rawOrg, opts) {
    const org = IS.normalizeOrganization(rawOrg);
    const g = _geom(opts);
    const boxOf = (opts && typeof opts.boxOf === 'function') ? opts.boxOf : null;
    // ⑰ Il righello della singola PASTIGLIA. `labelW`/`labelH` dicono quanto
    // spazio riservare fra due riquadri e sono un massimo; qui serve la misura
    // di OGNUNA, perché due pastiglie affiancate si scansano in base alle loro
    // larghezze vere: «Collegamento diretto» e «IPsec» non chiedono lo stesso.
    const labelOf = (opts && typeof opts.labelOf === 'function') ? opts.labelOf : null;
    const _labelBox = (linkId) => {
      const m = labelOf ? labelOf(linkId) : null;
      const w = _numOr(m && m.w, g.labelW), h = _numOr(m && m.h, g.labelH);
      return { w: w > 0 ? w : 0, h: h > 0 ? h : 0 };
    };
    const sites = org.sites;

    /** @type {InterSiteLayout} */
    const out = {
      layout: 'empty', hubSiteId: null,
      width: 0, height: 0, ringR: 0,
      nodes: [], edges: [],
      undrawable: { links: [], uplinks: [] },
    };
    if (!sites.length) {
      out.width = g.pad * 2; out.height = g.pad * 2;
      return out;
    }

    // ⑩ Gli uplink di ogni sede, in ordine dichiarato: stanno DENTRO il riquadro,
    // e uno che punta a una sede inesistente non si disegna e si dice (③).
    /** @type {Record<string, string[]>} */
    const upBySite = Object.create(null);
    const siteIds = new Set(sites.map(s => s.id));
    for (const u of org.uplinks) {
      if (!siteIds.has(u.siteId)) { out.undrawable.uplinks.push({ uplinkId: u.id, siteId: u.siteId }); continue; }
      (upBySite[u.siteId] || (upBySite[u.siteId] = [])).push(u.id);
    }

    // La misura di ogni riquadro: quella VERA se chi disegna ha passato il
    // righello, altrimenti quella dichiarata nei default (④).
    /** @type {Record<string, {w:number, h:number}>} */
    const box = Object.create(null);
    for (const s of sites) {
      const m = boxOf ? boxOf(s.id) : null;
      box[s.id] = {
        w: Math.max(1, _numOr(m && m.w, g.nodeW)),
        h: Math.max(1, _numOr(m && m.h, g.nodeH)),
      };
    }

    // ── ② La forma la decide il ruolo dichiarato ────────────────────────────
    const hubs = sites.filter(s => s.role === 'hub');
    const hub = (hubs.length === 1) ? hubs[0] : null;
    const ring = hub ? sites.filter(s => s.id !== hub.id) : sites.slice();

    out.layout = (sites.length === 1) ? 'single' : (hub ? 'hub' : 'ring');
    out.hubSiteId = hub ? hub.id : null;

    const maxW = sites.reduce((m, s) => Math.max(m, box[s.id].w), 0);

    // Gli ANGOLI dipendono solo da quante sedi ci sono sull'anello, non dal
    // raggio: si calcolano prima, così il raggio può tenerne conto (⑪).
    // ⑥ mezzo passo con un numero pari: le sedi stanno larghe invece che lunghe.
    /** @type {number[]} */
    const angles = [];
    if (!(ring.length === 1 && !hub)) {
      const step = TAU / ring.length;
      const first = START_ANGLE + (ring.length % 2 === 0 ? step / 2 : 0);
      for (let i = 0; i < ring.length; i++) angles.push(first + i * step);
    }

    let ringR = _ringRadius(ring.length, maxW, g);
    // ⑪ Con un hub c'è un riquadro AL CENTRO, e le filiali devono stargli fuori.
    if (hub) {
      for (let i = 0; i < ring.length; i++) {
        ringR = Math.max(ringR, _clearance(box[hub.id], box[ring[i].id], angles[i], _gapX(g), _gapY(g)));
      }
    }
    out.ringR = _r2(ringR);

    /** @param {typeof sites[0]} s @param {number} x @param {number} y @param {number|null} angle */
    const _node = (s, x, y, angle) => ({
      siteId: s.id, name: s.name, role: s.role, projectRef: s.projectRef,
      subnets: s.subnets.length,
      uplinkIds: (upBySite[s.id] || []).slice(),
      x: _r2(x), y: _r2(y), w: _r2(box[s.id].w), h: _r2(box[s.id].h),
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
      ring.forEach((s, i) => {
        const a = angles[i];
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

      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const bow = (idx - (sib.length - 1) / 2) * _bowStep(sib, -uy, ux, g, _labelBox);
      const p1 = _rectEdge(A.x, A.y, A.w, A.h, ux, uy);
      const p2 = _rectEdge(B.x, B.y, B.w, B.h, -ux, -uy);
      // Normale alla corda: l'apice di una quadratica sta a metà fra corda e
      // controllo, quindi il controllo si sposta del DOPPIO dello scostamento.
      const nx = -uy, ny = ux;
      const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;

      out.edges.push({
        linkId: l.id, aSiteId: l.aSiteId, bSiteId: l.bSiteId, kind: l.kind,
        x1: _r2(p1.x), y1: _r2(p1.y), x2: _r2(p2.x), y2: _r2(p2.y),
        cx: _r2(midX + nx * bow * 2), cy: _r2(midY + ny * bow * 2),
        mx: _r2(midX + nx * bow), my: _r2(midY + ny * bow),
        bow: _r2(bow),
      });
    }

    // ── Ingombro e traslazione ─────────────────────────────────────────────
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const _see = (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const n of out.nodes) {
      _see(n.x - n.w / 2, n.y - n.h / 2);
      _see(n.x + n.w / 2, n.y + n.h / 2);
    }
    for (const e of out.edges) { _see(e.mx, e.my); _see(e.cx, e.cy); }

    const ox = g.pad - minX, oy = g.pad - minY;
    for (const n of out.nodes) { n.x = _r2(n.x + ox); n.y = _r2(n.y + oy); }
    for (const e of out.edges) {
      e.x1 = _r2(e.x1 + ox); e.y1 = _r2(e.y1 + oy);
      e.x2 = _r2(e.x2 + ox); e.y2 = _r2(e.y2 + oy);
      e.cx = _r2(e.cx + ox); e.cy = _r2(e.cy + oy);
      e.mx = _r2(e.mx + ox); e.my = _r2(e.my + oy);
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
