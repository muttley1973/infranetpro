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
//   · MPO / MTP   → una bocca rettangolare VERTICALE che riempie quasi lo slot (~8,4 × 12,4 mm nel taglio da 9,91 × 13,46),
//                   con dentro la ferrula MT da 2,5 × 6,4 mm.
//
// Le misure dei primi due casi vengono dal disegno dell'utente (connettori ottici.svg, 20/11/2026), che li
// mostra nello STESSO rettangolo 192,31 × 290,6: due cerchi r 39,32 e un cerchio r 64,96. L'LC simplex NON e' nel
// disegno (stesso foro piccolo, al centro). L'MPO viene dal disegno quotato di un adattatore MPO/MTP in «SC footprint»
// (L-com FOA-993A: taglio 9,91 × 13,46 mm, corpo 9,4 × 13,0, bocca ~8,4 × 12,4, vista frontale VERTICALE), non dal disegno
// dell'utente: lo slot e' il taglio ruotato, quindi la bocca ne occupa il 85% × 92%. Le dimensioni della bocca sono lette
// dalle proporzioni del disegno (non quotate), quelle della ferrula MT (6,4 × 2,5) dalla IEC 61754-7.
//
// ⚠️ Questa lib decide SOLO come si disegna lo slot, mai quale connettore c'e': il connettore e' un campo
// dichiarato (`ppFiberConnector`). Non dichiarato o sconosciuto = slot NEUTRO, senza fori: non si indovina
// cosa c'e' montato (paletto ② no-invenzioni).
//
// ⚠️ NON E' IN SCALA, ED E' VOLUTO (deciso dall'utente il 20/11 dopo averlo misurato). Il rack e' in scala vera (1U = 29 px =
// 44,45 mm, circa 0,65 px/mm) ma lo slot standard e' disegnato 12,3 × 18,5 mm contro i ~9,6 × 13,3 mm del taglio SC simplex
// (1,25× e 1,4×) per poter leggere i fori; il quad ha l'altezza vera (~26 mm) e quindi il rapporto duplex : quad e' 1 : 1,37
// invece di 1 : 2; i 24 slot occupano 330 mm invece di oltre 400 perche' a destra sta la targhetta. Giuste restano le
// proporzioni DENTRO il tile (la distanza fra i due fori LC e' il 48% dell'altezza, come 6,25 mm su 13,1). Se un giorno si
// vuole la scala vera: tile 6,4 × 8,7 px (quad 6,4 × 17), rack da ingrandire per leggere i fori.
//
// Chi disegna prende la geometria da qui: i numeri stanno in un posto solo. Il rack dal vivo li legge dal CSS (le
// stesse proporzioni); il PDF e draw.io, che non hanno DOM, ricevono da `fiberFront` dove sta ogni slot, cella e foro
// dentro una scatola, e dipingono soltanto.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Il rettangolo dello slot e i suoi fori, nel sistema di coordinate del disegno (origine = vertice alto-sinistra).
  const FIBER_SLOT = Object.freeze({ w: 192.31, h: 290.6 });
  const CX = 96.15;              // centro orizzontale (l'SVG dell'utente: 96,15 e 95,73 — scarto di mano)
  const R_SMALL = 32;            // foro dell'LC (1,25 mm)
  const R_BIG = 52.9;            // foro dell'SC/ST/FC (2,5 mm): stesso rapporto 1,65 dell'LC
  const Y_SINGLE = 145.3;        // altezza del foro singolo: il CENTRO dello slot (290,6 / 2)

  const circle = (cx, cy, r) => Object.freeze({ t: 'c', cx, cy, r });
  const rect = (x, y, w, h, rx, fer) => Object.freeze({ t: 'r', x, y, w, h, rx, fer: !!fer });

  const HOLES = Object.freeze({
    blank: Object.freeze([]),
    lc1: Object.freeze([circle(CX, Y_SINGLE, R_SMALL)]),
    lc2: Object.freeze([circle(CX, 76.07, R_SMALL), circle(CX, 214.53, R_SMALL)]),
    big: Object.freeze([circle(CX, Y_SINGLE, R_BIG)]),
    mpo: Object.freeze([rect(25.15, 26.3, 142, 238, 16), rect(71.9, 76.2, 48.5, 138.2, 6, true)]),
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
  function fiberSlotPlan(connector, unit, boxTall) {
    const u = unit === 'single' ? 'single' : 'duplex';
    const c = own(CONNECTORS, connector) ? CONNECTORS[connector] : null;
    // `boxTall`: in un cassetto composto l'altezza dello slot e' UNA per tutti (la piu' alta presente): un LC duplex
    // accanto a un quad sta in una scatola alta, coi suoi fori al centro.
    const tall = !!(c && c.tall) || !!boxTall;
    const slotH = tall ? H_TALL : FIBER_SLOT.h;
    if (!c) return Object.freeze({ declared: false, unit: u, kind: 'blank', cells: 1, fibres: 0, tall, slotH, cellH: slotH });
    let kind, cells, fibres;
    if (c.n === 1) { kind = c.single; cells = 1; fibres = c.fibres || 1; }
    else if (u === 'single') { kind = c.single; cells = c.n; fibres = 1; }
    else { kind = c.pair; cells = c.n / 2; fibres = 2; }
    return Object.freeze({ declared: true, unit: u, kind, cells, fibres, tall, slotH, cellH: (slotH - (cells - 1) * FIBER_GAP) / cells });
  }

  // ── Il COMPOSITORE: un modulo per slot ─────────────────────────────────────────────────────────────────────────
  // Un cassetto a slot accetta, per ogni slot, un modulo diverso (LC quad/duplex, SC duplex, MPO...) o una lastra
  // cieca (HT 24 slot «LC Quad or Duplex», «unused slots are fitted with blanks»). La composizione sta in
  // `spec.fdSlots` = elenco di chiavi, una per slot; senza, il cassetto e' uniforme (il connettore dichiarato per
  // tutti gli slot, come prima). Le porte vengono dai moduli: ognuno ha `cells` porte (la lastra 0) e si numerano
  // di seguito, dall'alto e da sinistra; quindi cambiare un modulo con piu' o meno porte RINUMERA le seguenti.
  const EMPTY = 'blank';   // chiave del modulo «vuoto»: NON e' un valore di `ppFiberConnector`
  const FIBER_MODULES = Object.freeze(['lc-duplex', 'lc-quad', 'sc', 'sc-duplex', 'st', 'fc', 'mpo-12', 'mpo-24', EMPTY]);
  const FIBER_MAX_SLOTS = 288;   // 12 U da 24 slot: un progetto con un elenco enorme non diventa un frontale enorme

  /** Il piano di un MODULO (la chiave di `fdSlots`, o un connettore): come `fiberSlotPlan`, e per la lastra cieca
   *  {empty:true, kind:'empty', cells:0}: nessuna porta, nessun foro. */
  function fiberModulePlan(key, unit, boxTall) {
    if (key !== EMPTY) return fiberSlotPlan(key, unit, boxTall);
    const slotH = boxTall ? H_TALL : FIBER_SLOT.h;
    return Object.freeze({ declared: true, empty: true, unit: unit === 'single' ? 'single' : 'duplex', kind: 'empty', cells: 0, fibres: 0, tall: !!boxTall, slotH, cellH: slotH });
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
    if (!plan || plan.kind === 'blank') return HOLES.blank;   // (la lastra cieca, kind 'empty', non ha disegno: cade nell'ultimo ritorno)
    if (plan.cells === 1 && fiberSlotHoles(plan.kind).length) {
      // i disegni dell'utente: lo slot standard. In una scatola piu' alta (cassetto composto con un quad) i fori restano
      // alla stessa distanza fra loro, ma al CENTRO della scatola.
      const dy = r2((plan.cellH - FIBER_SLOT.h) / 2);
      return dy ? Object.freeze(fiberSlotHoles(plan.kind).map((hole) => Object.freeze(Object.assign({}, hole, hole.t === 'c' ? { cy: r2(hole.cy + dy) } : { y: r2(hole.y + dy) })))) : fiberSlotHoles(plan.kind);
    }
    const h = plan.cellH;
    if (plan.kind === 'lc1') return Object.freeze([circle(CX, r2(h * 0.5), r2(Math.min(R_SMALL, h * 0.32)))]);
    if (plan.kind === 'lc2') {
      const r = r2(Math.min(R_SMALL, h * 0.17));
      return Object.freeze([circle(CX, r2(h * 0.29), r), circle(CX, r2(h * 0.71), r)]);
    }
    if (plan.kind === 'big') return Object.freeze([circle(CX, r2(h * 0.5), r2(R_BIG))]);   // (in mezza cella dell'SC duplex il foro standard ci sta con margine)
    if (plan.kind === 'big2') {
      const r = r2(R_BIG);   // l'unico caso e' lo slot alto (SC duplex): il foro del disegno ci sta con margine, e un test lo prova
      return Object.freeze([circle(CX, r2(h * 0.28), r), circle(CX, r2(h * 0.72), r)]);
    }
    return fiberSlotHoles(plan.kind);
  }

  /** Come si dividono N slot in FILE: 24 a fila e una fila per ogni U, dall'alto → [[da, a), …] (indici di slot da 0).
   *  `null` = non si disegnano slot e vale il frontale generico: le file necessarie sono piu' delle U, o chi ha
   *  scelto il layout sequenziale/alternato ha chiesto due piani di LED. «Lineare» forza UNA fila. UN posto solo:
   *  lo usano sia il cassetto uniforme sia quello composto. */
  function fiberRowRanges(count, sizeU, baseLayout) {
    if (!(count > 0)) return null;
    if (baseLayout === 'sequential' || baseLayout === 'alternating') return null;
    const u = Number(sizeU) >= 1 ? Math.floor(Number(sizeU)) : 1;
    if (baseLayout === 'linear') return [[0, count]];
    const nRows = Math.ceil(count / FIBER_ROW_SLOTS);
    if (nRows > u) return null;
    const out = [];
    for (let r = 0; r < nRows; r++) out.push([r * FIBER_ROW_SLOTS, Math.min(count, (r + 1) * FIBER_ROW_SLOTS)]);
    return out;
  }

  /** Le FILE di un cassetto UNIFORME: per ogni fila l'elenco dei numeri di porta, dall'alto (v. `fiberRowRanges`). */
  function fiberSlotRows(plan, ports, sizeU, baseLayout) {
    const n = Math.floor(Number(ports));
    if (!(n > 0)) return null;
    const ranges = fiberRowRanges(Math.ceil(n / plan.cells), sizeU, baseLayout);
    if (!ranges) return null;
    return ranges.map(([a, b]) => {
      const row = [];
      for (let i = a * plan.cells + 1; i <= Math.min(n, b * plan.cells); i++) row.push(i);
      return row;
    });
  }

  const _keyOk = (k) => FIBER_MODULES.includes(k);
  const _connOf = (node) => { const s = (node && node.spec) || {}; return s.ppFiberConnector || (node && node.ppFiberConnector) || ''; };

  /** La composizione di un NODO (`spec.fdSlots`, o sul nodo nei progetti vecchi): l'elenco delle chiavi dei moduli,
   *  una per slot, oppure `null` se il cassetto e' uniforme (nessun elenco, o vuoto, o non e' un elenco). Una voce che
   *  non e' un modulo noto diventa il connettore dichiarato per il cassetto (o uno slot liscio, se non ce n'e'): non si
   *  indovina. L'elenco e' tagliato a FIBER_MAX_SLOTS. */
  function fiberNodeSlots(node) {
    const s = (node && node.spec) || {};
    const raw = s.fdSlots !== undefined ? s.fdSlots : (node && node.fdSlots);
    if (!Array.isArray(raw) || !raw.length) return null;
    const base = _connOf(node);
    return raw.slice(0, FIBER_MAX_SLOTS).map((k) => (_keyOk(k) ? k : base));
  }

  /** Le chiavi dei moduli di un cassetto UNIFORME con `ports` porte: tanti slot quanti ne servono, tutti col connettore. */
  function fiberUniformKeys(connector, unit, ports) {
    const n = Math.floor(Number(ports));
    if (!(n > 0)) return [];
    return new Array(Math.ceil(n / fiberSlotPlan(connector, unit).cells)).fill(connector || '');
  }

  /** Il LAYOUT di un elenco di moduli: uno slot per chiave, con il suo piano e i numeri delle sue porte (di seguito,
   *  fino a `ports`: oltre non ce ne sono). L'altezza e' una per tutti, la piu' alta presente. */
  function fiberLayoutOfKeys(keys, unit, ports) {
    const n = Math.max(0, Math.floor(Number(ports)) || 0);
    const u = unit === 'single' ? 'single' : 'duplex';
    const boxTall = keys.some((k) => fiberModulePlan(k, u).tall);
    let next = 1;
    const slots = keys.map((key) => {
      const plan = fiberModulePlan(key, u, boxTall);
      const nums = [];
      for (let c = 0; c < plan.cells && next <= n; c++) nums.push(next++);
      return { key, plan, ports: nums };
    });
    return { slots, tall: boxTall, unit: u };
  }

  /** Il layout di un NODO: la composizione se c'e', altrimenti il cassetto uniforme. `composed` dice quale. */
  function fiberNodeLayout(node, ports) {
    const s = (node && node.spec) || {};
    const unit = s.ppFiberPortUnit || (node && node.ppFiberPortUnit);
    const comp = fiberNodeSlots(node);
    const lay = fiberLayoutOfKeys(comp || fiberUniformKeys(_connOf(node), unit, ports), unit, ports);
    lay.composed = !!comp;
    return lay;
  }

  /** Le FILE di un layout: per ogni fila gli SLOT (con piano e porte), o `null` (v. `fiberRowRanges`). */
  function fiberLayoutRows(layout, sizeU, baseLayout) {
    const ranges = fiberRowRanges(layout.slots.length, sizeU, baseLayout);
    return ranges ? ranges.map(([a, b]) => layout.slots.slice(a, b)) : null;
  }

  /** Quante porte danno i moduli (la lastra cieca nessuna). */
  function fiberPortCount(keys, unit) {
    let n = 0;
    for (const k of keys) n += fiberModulePlan(k, unit).cells;
    return n;
  }

  /** Conti di una composizione: { slots, empty (lastre), ports, fibres }. Le fibre di un modulo senza connettore
   *  dichiarato non si sanno e valgono 0. */
  function fiberCompositionStats(keys, unit) {
    let ports = 0, fibres = 0, empty = 0;
    for (const k of keys) {
      const p = fiberModulePlan(k, unit);
      if (p.empty) empty++;   // (la lastra ha 0 porte e 0 fibre: il resto del conto non la sposta)
      ports += p.cells;
      fibres += p.cells * p.fibres;
    }
    return { slots: keys.length, empty, ports, fibres };
  }

  /** I tratti consecutivi dello stesso modulo, numerati da 1: [{ from, to, key }] — per dirlo a parole. */
  function fiberCompositionRuns(keys) {
    const runs = [];
    keys.forEach((k, i) => {
      const last = runs[runs.length - 1];
      if (last && last.key === k) last.to = i + 1; else runs.push({ from: i + 1, to: i + 1, key: k });
    });
    return runs;
  }

  /** Quali numeri di porta CAMBIANO posto passando da un layout all'altro: stessa porta = stesso slot, stessa cella,
   *  stesso modulo. Chi ha un cavo attaccato a uno di questi numeri lo ritrova su un'altra porta fisica (o su nessuna:
   *  oltre l'ultima). Ordinati, 1-based. */
  function fiberLayoutChanges(before, after) {
    const ids = (lay) => { const out = []; lay.slots.forEach((s, si) => s.ports.forEach((p, ci) => { out[p - 1] = si + '.' + ci + '.' + s.key; })); return out; };
    const a = ids(before), b = ids(after);
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i + 1);
    return out;
  }

  /** [2, 3, 4, 5, 8] → «2–5, 8»: numeri ordinati e senza doppioni, i consecutivi in un tratto (lingua-indipendente). */
  function fiberRangesText(nums) {
    const a = Array.from(new Set(nums.filter((x) => typeof x === 'number' && Number.isFinite(x)))).sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i < a.length;) {
      let j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
      out.push(j > i ? a[i] + '–' + a[j] : String(a[i]));
      i = j + 1;
    }
    return out.join(', ');
  }

  /** Mette il modulo `key` negli slot da `from` a `to` (1-based, estremi inclusi, in qualunque ordine) di una copia
   *  dell'elenco. Una chiave che non e' un modulo, o un tratto fuori dall'elenco, non cambia niente. */
  function fiberComposeSet(keys, from, to, key) {
    const out = keys.slice();
    if (!FIBER_MODULES.includes(key)) return out;
    const a = Math.max(1, Math.min(Number(from), Number(to))), b = Math.min(out.length, Math.max(Number(from), Number(to)));
    for (let i = a; i <= b; i++) out[i - 1] = key;
    return out;
  }

  /** Porta l'elenco a `count` slot (da 1 a FIBER_MAX_SLOTS): i nuovi hanno il modulo `fill`. */
  function fiberComposeResize(keys, count, fill) {
    const n = Math.max(1, Math.min(FIBER_MAX_SLOTS, Math.floor(Number(count)) || 1));
    const out = keys.slice(0, n);
    while (out.length < n) out.push(fill);
    return out;
  }

  /** Cosa scrivere nel nodo per una composizione: se TUTTI gli slot hanno lo stesso modulo (e non e' la lastra) il
   *  cassetto e' uniforme con quel connettore — `connector` — e non serve l'elenco; altrimenti `slots` e' l'elenco.
   *  `ports` e' sempre quello dei moduli. */
  function fiberComposeResult(keys, unit) {
    const ks = keys.slice(0, FIBER_MAX_SLOTS);
    const uniform = ks.length > 0 && ks[0] !== EMPTY && ks.every((k) => k === ks[0]);
    return { connector: uniform ? ks[0] : null, slots: uniform ? null : ks, ports: fiberPortCount(ks, unit) };
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
    return `<rect${h.fer ? ' class="fo-fer"' : ''} x="${Number(h.x)}" y="${Number(h.y)}" width="${Number(h.w)}" height="${Number(h.h)}" rx="${Number(h.rx)}"/>`;
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

  /** Le FILE di slot di un cassetto (v. `fiberLayoutRows`) a partire dal nodo e dalle due scelte che vengono dal
   *  frontale: quante porte (`portCount`) e quale layout di base (`baseLayout`), con le U del cassetto. UNA definizione:
   *  la usa il rack dal vivo e la usano i gemelli (PDF e draw.io). `null` = non si disegnano slot, vale il frontale
   *  generico. */
  function fiberDrawerRows(node, portCount, baseLayout, sizeU) {
    return fiberLayoutRows(fiberNodeLayout(node, portCount), sizeU, baseLayout);
  }

  // ── Il frontale fuori dal DOM: PDF e draw.io ───────────────────────────────────────────────────────────────────
  // Il rack dal vivo si dispone col CSS (slot da 8 px, 2 px fra uno e l'altro, 1 px fra le celle). Chi disegna senza
  // DOM ha bisogno dei NUMERI: dov'e' ogni slot, ogni cella e ogni foro, dentro una scatola data. Si calcolano qui,
  // una volta sola, con le stesse costanti dello slot (FIBER_SLOT, FIBER_GAP, i fori): i due gemelli dipingono e basta.
  const FRONT = Object.freeze({
    cap: 8,        // larghezza massima di uno slot: quella del rack dal vivo
    gapMin: 1.4,   // stacco minimo fra due slot
    gapMax: 2,     // stacco massimo: come il rack dal vivo (--port-gap), oltre il blocco si centra e basta
    pad: 0.9,      // aria sopra e sotto una fila
    numH: 4.4,     // altezza della striscia col numero, sotto lo slot
  });

  /** La geometria del frontale: `rows` = le file di slot (v. `fiberDrawerRows`), `box` = { x, y, w, h } l'area dove
   *  disegnare, `opt.hidden(porta)` = vero per una porta nascosta (un'interfaccia virtuale). Come il rack dal vivo, uno
   *  slot a UNA sola porta nascosta non c'e' (gli altri si stringono), una cella nascosta di un modulo resta vuota.
   *  Lo slot ha le proporzioni del disegno dell'utente; si stringe solo se nella scatola non entra. Il numero sotto lo
   *  slot (quello della prima porta) c'e' solo se non costringe a rimpicciolire gli slot di piu' di un quinto.
   *  → `null` se non c'e' niente da disegnare, altrimenti
   *  { k (scala: unita' del disegno → unita' della scatola), slotW, gap, numbers, numFs,
   *    rows: [[{ x, y, w, h, key, plate, cells: [{ x, y, w, h, port|null, holes }], num: { port, x, y, h }|null }]] }
   *  dove `holes` sono i fori gia' scalati e posizionati ({ t:'c', cx, cy, r } | { t:'r', x, y, w, h, rx, fer }). */
  function fiberFrontGeometry(rows, box, opt) {
    if (!Array.isArray(rows) || !rows.length || !box || !(box.w > 0) || !(box.h > 0)) return null;
    const o = Object.assign({}, FRONT, opt || {});
    const hidden = typeof o.hidden === 'function' ? o.hidden : () => false;
    const isPlate = (s) => !!(s.plan.empty || !s.ports.length);
    const vis = rows.map((row) => row.filter((s) => isPlate(s) || s.plan.cells > 1 || !hidden(s.ports[0])));
    const n = Math.max(0, ...vis.map((row) => row.length));
    if (!n) return null;
    const slotU = Math.max(...vis.map((row) => Math.max(0, ...row.map((s) => s.plan.slotH))));
    const rowH = box.h / vis.length;
    const kWide = Math.min((box.w - (n - 1) * o.gapMin) / n, o.cap) / FIBER_SLOT.w;
    const kBare = Math.min(kWide, (rowH - 2 * o.pad) / slotU);
    if (!(kBare > 0)) return null;
    const kNum = Math.min(kWide, (rowH - 2 * o.pad - o.numH) / slotU);
    const anyPort = vis.some((row) => row.some((s) => !isPlate(s)));
    const numbers = anyPort && kNum >= 0.8 * kBare;
    const k = numbers ? kNum : kBare;
    const slotW = k * FIBER_SLOT.w;
    // (lo spazio che avanza e' almeno `gapMin` per costruzione: la scala `kWide` lo ha gia' riservato)
    const gap = n > 1 ? Math.min(o.gapMax, (box.w - n * slotW) / (n - 1)) : 0;
    const total = n * slotW + (n - 1) * gap;
    const x0 = box.x + Math.max(0, (box.w - total) / 2);
    const blockH = slotU * k + (numbers ? o.numH : 0);
    return {
      k: r2(k), slotW: r2(slotW), gap: r2(gap), numbers, numFs: r2(Math.min(3.4, o.numH * 0.78)),
      rows: vis.map((row, ri) => {
        const y0 = box.y + ri * rowH + (rowH - blockH) / 2;
        return row.map((s, i) => {
          const x = x0 + i * (slotW + gap);
          const h = s.plan.slotH * k;
          const plate = isPlate(s);
          const cells = [];
          if (!plate) {
            for (let c = 0; c < s.plan.cells; c++) {
              const port = s.ports[c] !== undefined && !hidden(s.ports[c]) ? s.ports[c] : null;
              const cy = y0 + c * (s.plan.cellH + FIBER_GAP) * k;
              const holes = port === null ? [] : fiberCellHoles(s.plan).map((hole) => (hole.t === 'c'
                ? { t: 'c', cx: r2(x + hole.cx * k), cy: r2(cy + hole.cy * k), r: r2(hole.r * k) }
                : { t: 'r', x: r2(x + hole.x * k), y: r2(cy + hole.y * k), w: r2(hole.w * k), h: r2(hole.h * k), rx: r2(hole.rx * k), fer: hole.fer }));
              cells.push({ x: r2(x), y: r2(cy), w: r2(slotW), h: r2(s.plan.cellH * k), port, holes });
            }
          }
          return { x: r2(x), y: r2(y0), w: r2(slotW), h: r2(h), key: s.key, plate, cells,
            num: numbers && !plate ? { port: s.ports[0], x: r2(x + slotW / 2), y: r2(y0 + h), h: o.numH } : null };
        });
      }),
    };
  }

  /** Il frontale di un NODO cassetto, pronto da dipingere: le file (`fiberDrawerRows`) e la loro geometria dentro
   *  `opt.box`. `opt` = { portCount, baseLayout, sizeU, box, hidden }. `null` se il nodo non e' un cassetto, se non si
   *  disegnano slot (vale il frontale generico) o se nella scatola non c'e' niente da disegnare. */
  function fiberFront(node, opt) {
    const o = opt || {};
    if (!node || node.type !== 'fiberdrawer') return null;
    const rows = fiberDrawerRows(node, o.portCount, o.baseLayout, o.sizeU);
    return rows ? fiberFrontGeometry(rows, o.box, { hidden: o.hidden }) : null;
  }

  /** Un nodo che accetta SOLO fibra, col modo (classe) che dichiara: `{ mode }`, oppure `null` se non lo e'. UNA definizione,
   *  per chi deve confrontarlo con un cavo. Lo e' il cassetto ottico (sempre) e il patch panel dichiarato «fibra»; un
   *  patch panel «misto» ha anche porte in rame, «rame» o non dichiarato non dice niente — non si indovina. `mode` e' la
   *  chiave dichiarata (`sm-os2`, `mm-om4`…), `''` se nessuno l'ha dichiarata. I campi stanno in `spec`, o sul nodo nei
   *  progetti vecchi (la spec vince). */
  function fiberOnlyPanel(node) {
    if (!node) return null;
    const s = node.spec || {};
    const f = (k) => (s[k] !== undefined ? s[k] : node[k]);
    if (node.type === 'fiberdrawer' || (node.type === 'patchpanel' && f('ppMedia') === 'fiber')) return { mode: String(f('ppFiberMode') || '') };
    return null;
  }

  return { FIBER_SLOT, FIBER_GAP, FIBER_ROW_SLOTS, FIBER_MODULES, FIBER_MAX_SLOTS, fiberOnlyPanel, fiberRowRanges, fiberSlotPlan, fiberModulePlan, fiberNodePlan,
    fiberSlotKind, fiberSlotHoles, fiberCellHoles, fiberSlotSvg, fiberCellSvg, fiberSlotRows, fiberDrawerStats,
    fiberNodeSlots, fiberUniformKeys, fiberLayoutOfKeys, fiberNodeLayout, fiberLayoutRows, fiberPortCount,
    fiberCompositionStats, fiberCompositionRuns, fiberLayoutChanges, fiberRangesText, fiberComposeSet, fiberComposeResize, fiberComposeResult,
    fiberDrawerRows, fiberFrontGeometry, fiberFront };
});
