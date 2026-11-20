// ============================================================
// FIBER-SLOT — lo slot di un cassetto ottico: un rettangolo VERTICALE con i fori dei connettori
// (UMD-lite, browser + Node · puro · lingua-indipendente · vendor-neutral)
// ============================================================
// In un cassetto ottico da 19" a 1U gli slot sono affiancati, tutti della stessa misura (l'ingombro di un
// adattatore SC simplex: in un cassetto da 24 slot ci stanno 24 SC, oppure 24 LC duplex = 48 fibre). Cio'
// che cambia e' il connettore montato, e si riconosce dai FORI:
//   · LC duplex   → due fori piccoli, uno sopra l'altro (due ferruli da 1,25 mm);
//   · SC, ST, FC  → un foro grande (un ferrulo da 2,5 mm: i tre lo condividono, FOA «connector ID»);
//   · LC simplex  → un foro piccolo;
//   · MPO / MTP   → un'apertura rettangolare, orizzontale (una ferrula MT porta le fibre in FILA).
//
// Le misure dei primi due casi vengono dal disegno dell'utente (connettori ottici.svg, 20/11/2026), che li
// mostra nello STESSO rettangolo 192,31 × 290,6: due cerchi r 39,32 e un cerchio r 64,96. Gli altri due
// (LC simplex, MPO) NON sono nel disegno: li ho derivati da quelli — stesso foro piccolo, stessa altezza
// del foro grande — e vanno guardati dall'utente.
//
// ⚠️ Questa lib decide SOLO come si disegna lo slot, mai quale connettore c'e': il connettore e' un campo
// dichiarato (`ppFiberConnector`). Non dichiarato o sconosciuto = slot NEUTRO, senza fori: non si indovina
// cosa c'e' montato (paletto ② no-invenzioni).
//
// Chi disegna (il rack dal vivo oggi; PDF e draw.io sono i gemelli da allineare) prende la geometria da qui:
// i numeri stanno in un posto solo.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Il rettangolo dello slot e i suoi fori, nel sistema di coordinate del disegno (origine = vertice alto-sinistra).
  const FIBER_SLOT = Object.freeze({ w: 192.31, h: 290.6 });
  const CX = 96.15;              // centro orizzontale (l'SVG dell'utente: 96,15 e 95,73 — scarto di mano)
  const R_SMALL = 39.32;         // foro dell'LC (1,25 mm)
  const R_BIG = 64.96;           // foro dell'SC/ST/FC (2,5 mm)
  const Y_SINGLE = 135.89;       // altezza del foro singolo (quello grande nel disegno)

  const circle = (cx, cy, r) => Object.freeze({ t: 'c', cx, cy, r });
  const rect = (x, y, w, h, rx) => Object.freeze({ t: 'r', x, y, w, h, rx });

  const HOLES = Object.freeze({
    blank: Object.freeze([]),
    lc1: Object.freeze([circle(CX, Y_SINGLE, R_SMALL)]),
    lc2: Object.freeze([circle(CX, 70.09, R_SMALL), circle(CX, 208.55, R_SMALL)]),
    big: Object.freeze([circle(CX, Y_SINGLE, R_BIG)]),
    mpo: Object.freeze([rect(31.15, 98.89, 130, 74, 9)]),
  });

  // Il modulo con 4 LC (quad) ha l'ingombro di un SC DUPLEX: piu' alto dello slot standard (le misure sono in unita'
  // dello stesso disegno: 396,63 = 16,5 px quando la larghezza e' 8 px). Fra due celle di uno slot c'e' 1 px (24,04).
  const H_TALL = 396.63;
  const FIBER_GAP = 24.04;
  // Quanti slot sta in una FILA del rack, alla scala di oggi (24 slot = 216 px, la larghezza utile del telaio). Una
  // fila per ogni U del cassetto: a 2U ne entrano 48, a 3U 72.
  const FIBER_ROW_SLOTS = 24;

  // Valore di `ppFiberConnector` → cosa e'. `lc` = quanti LC ha il modulo (la porta si conta poi a scelta: un duplex
  // o un singolo connettore); gli altri hanno UN foro e `fibres` fibre per porta. Un connettore fuori elenco NON ha disegno.
  // `n` = connettori del modulo; `single` = disegno di UN connettore; `pair` = disegno di due (solo se n > 1); `fibres` =
  // fibre per porta quando la porta e' il connettore intero (MPO); `tall` = ingombro alto (SC duplex footprint: il quad e
  // l'SC duplex). Il modulo con piu' connettori si conta a scelta dell'utente: un duplex o un connettore singolo.
  const CONNECTORS = Object.freeze({
    'lc-simplex': Object.freeze({ n: 1, single: 'lc1' }),
    'lc-duplex': Object.freeze({ n: 2, single: 'lc1', pair: 'lc2' }),
    'lc-quad': Object.freeze({ n: 4, single: 'lc1', pair: 'lc2', tall: true }),
    'sc': Object.freeze({ n: 1, single: 'big' }),
    'sc-duplex': Object.freeze({ n: 2, single: 'big', pair: 'big2', tall: true }),
    'st': Object.freeze({ n: 1, single: 'big' }),
    'fc': Object.freeze({ n: 1, single: 'big' }),
    'mpo-12': Object.freeze({ n: 1, single: 'mpo', fibres: 12 }),
    'mpo-24': Object.freeze({ n: 1, single: 'mpo', fibres: 24 }),
  });
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

  /** Il piano di uno slot: connettore + «una porta e'…» ('duplex', il modello di InfraNet, o 'single' = un singolo connettore)
   *  → { declared, unit, kind (disegno di OGNI cella), cells (porte per slot), fibres (per porta, 0 = ignote), tall,
   *  slotH, cellH }. L'unita' non dichiarata o ignota e' il duplex; un connettore non dichiarato o ignoto e' uno slot
   *  liscio (`blank`), perche' non si indovina cosa c'e' montato. */
  function fiberSlotPlan(connector, unit) {
    const u = unit === 'single' ? 'single' : 'duplex';
    const c = own(CONNECTORS, connector) ? CONNECTORS[connector] : null;
    if (!c) return Object.freeze({ declared: false, unit: u, kind: 'blank', cells: 1, fibres: 0, tall: false, slotH: FIBER_SLOT.h, cellH: FIBER_SLOT.h });
    let kind, cells, fibres;
    if (c.n === 1) { kind = c.single; cells = 1; fibres = c.fibres || 1; }
    else if (u === 'single') { kind = c.single; cells = c.n; fibres = 1; }
    else { kind = c.pair; cells = c.n / 2; fibres = 2; }
    const tall = !!c.tall;
    const slotH = tall ? H_TALL : FIBER_SLOT.h;
    return Object.freeze({ declared: true, unit: u, kind, cells, fibres, tall, slotH, cellH: (slotH - (cells - 1) * FIBER_GAP) / cells });
  }

  /** Il piano di un NODO: connettore e unita' stanno in `spec` (i campi del pannello Proprieta') o, nei progetti
   *  vecchi, sul nodo; ognuno dei due si legge per conto suo e `spec` vince. */
  function fiberNodePlan(node) {
    const s = (node && node.spec) || {};
    return fiberSlotPlan(s.ppFiberConnector || (node && node.ppFiberConnector), s.ppFiberPortUnit || (node && node.ppFiberPortUnit));
  }

  /** Quale disegno ha lo slot per questo connettore (con la porta duplex): 'lc1' | 'lc2' | 'big' | 'mpo', o 'blank'. */
  function fiberSlotKind(connector) {
    return fiberSlotPlan(connector).kind;
  }

  /** I fori di un disegno: [{ t:'c', cx, cy, r } | { t:'r', x, y, w, h, rx }]. Un tipo ignoto = nessun foro. */
  function fiberSlotHoles(kind) {
    return Object.prototype.hasOwnProperty.call(HOLES, kind) ? HOLES[kind] : HOLES.blank;
  }

  const r2 = (x) => Number(x.toFixed(2));

  /** I fori di UNA CELLA del piano. Con una cella sola e' lo slot del disegno dell'utente (misure sue); con piu' celle
   *  i fori si scalano nella cella, centrati in verticale: l'LC non supera mai il foro del disegno. */
  function fiberCellHoles(plan) {
    if (!plan || plan.kind === 'blank') return HOLES.blank;
    if (plan.cells === 1 && fiberSlotHoles(plan.kind).length) return fiberSlotHoles(plan.kind);   // i disegni dell'utente: solo lo slot standard
    const h = plan.cellH;
    if (plan.kind === 'lc1') return Object.freeze([circle(CX, r2(h * 0.5), r2(Math.min(R_SMALL, h * 0.32)))]);
    if (plan.kind === 'lc2') {
      const r = r2(Math.min(R_SMALL, h * 0.17));
      return Object.freeze([circle(CX, r2(h * 0.29), r), circle(CX, r2(h * 0.71), r)]);
    }
    if (plan.kind === 'big') return Object.freeze([circle(CX, r2(h * 0.5), r2(Math.min(R_BIG, h * 0.32)))]);
    if (plan.kind === 'big2') {
      const r = r2(R_BIG);   // l'unico caso e' lo slot alto (SC duplex): il foro del disegno ci sta con margine, e un test lo prova
      return Object.freeze([circle(CX, r2(h * 0.28), r), circle(CX, r2(h * 0.72), r)]);
    }
    return fiberSlotHoles(plan.kind);
  }

  /** Le FILE di uno slot-drawer: per ogni fila l'elenco dei numeri di porta, dall'alto, 24 slot a fila e una fila per
   *  ogni U. `null` = non si disegnano slot e vale il frontale generico: le file necessarie sono piu' delle U, o chi
   *  ha scelto il layout sequenziale/alternato ha chiesto due piani di LED. «Lineare» forza UNA fila. */
  function fiberSlotRows(plan, ports, sizeU, baseLayout) {
    const n = Math.floor(Number(ports));
    if (!(n > 0)) return null;
    if (baseLayout === 'sequential' || baseLayout === 'alternating') return null;
    const u = Number(sizeU) >= 1 ? Math.floor(Number(sizeU)) : 1;
    const slots = Math.ceil(n / plan.cells);
    let perRow, nRows;
    if (baseLayout === 'linear') { perRow = slots; nRows = 1; }
    else {
      nRows = Math.ceil(slots / FIBER_ROW_SLOTS);
      if (nRows > u) return null;
      perRow = FIBER_ROW_SLOTS;
    }
    const rows = [];
    for (let r = 0; r < nRows; r++) {
      const first = r * perRow * plan.cells + 1;
      const last = Math.min(n, (r + 1) * perRow * plan.cells);
      const row = [];
      for (let i = first; i <= last; i++) row.push(i);
      rows.push(row);
    }
    return rows;
  }

  /** Conti derivati per chi legge: { slots, fibres }. `null` se il connettore non e' dichiarato (non si dice quante
   *  fibre) o se il numero di porte non e' un numero. */
  function fiberDrawerStats(connector, unit, ports) {
    const p = fiberSlotPlan(connector, unit);
    const n = Number(ports);
    if (!p.declared || !Number.isFinite(n)) return null;
    const m = Math.max(0, Math.floor(n));
    return { slots: Math.ceil(m / p.cells), fibres: m * p.fibres };
  }

  // Un foro come elemento SVG. `Number()` su ogni valore: se un giorno un foro portasse una stringa, ne uscirebbe
  // NaN e non markup — e lo scanner dell'escaping (tools/html-escape-scan.js) lo puo' dimostrare.
  function holeSvg(h) {
    if (h.t === 'c') return `<circle cx="${Number(h.cx)}" cy="${Number(h.cy)}" r="${Number(h.r)}"/>`;
    return `<rect x="${Number(h.x)}" y="${Number(h.y)}" width="${Number(h.w)}" height="${Number(h.h)}" rx="${Number(h.rx)}"/>`;
  }

  /** Il disegno dei fori di UNA CELLA del piano come <svg> da mettere DENTRO la cella ('' se non c'e' niente da
   *  disegnare). Il viewBox ha l'altezza della cella: i fori restano tondi qualunque sia la forma. Solo numeri,
   *  tutti passati da Number(): nessun testo che arrivi da fuori puo' finire nel markup. */
  function fiberCellSvg(plan) {
    const holes = fiberCellHoles(plan);
    if (!holes.length) return '';
    return `<svg class="fo-svg" viewBox="0 0 ${Number(FIBER_SLOT.w)} ${Number(r2(plan.cellH))}" aria-hidden="true" focusable="false">${holes.map(holeSvg).join('')}</svg>`;
  }

  /** Il disegno dei fori di uno slot intero (standard, una cella sola) come <svg>. */
  function fiberSlotSvg(kind) {
    return fiberCellSvg({ kind, cells: 1, cellH: FIBER_SLOT.h });
  }

  return { FIBER_SLOT, FIBER_GAP, FIBER_ROW_SLOTS, fiberSlotPlan, fiberNodePlan, fiberSlotKind, fiberSlotHoles, fiberCellHoles,
    fiberSlotSvg, fiberCellSvg, fiberSlotRows, fiberDrawerStats };
});
