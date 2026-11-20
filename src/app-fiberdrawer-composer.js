// ============================================================
// IL COMPOSITORE DEL CASSETTO OTTICO — un modulo diverso per ogni slot, a trascinamento
//                                              [modulo ESM · UI; la logica sta in lib/fiber-slot.js]
// ============================================================
// Un cassetto a slot accetta, per ogni slot, un modulo diverso (LC quad/duplex, SC duplex, MPO…) o una lastra cieca.
// Gli slot nel rack sono troppo piccoli da colpire (8 px): qui si ingrandiscono, in una finestra. TRE gesti:
//   · trascinare un modulo della palette su uno slot (mouse e tocco, con pointer events: il drag HTML5 sul tablet e'
//     fragile);
//   · toccare un modulo (resta ATTIVO) e passare sugli slot per dipingere un tratto; la tastiera fa lo stesso con
//     Invio/Spazio su modulo e slot;
//   · «Tutti uguali a…».
// Si lavora su una BOZZA: niente cambia nel progetto finche' non si preme «Applica» (un solo passo di annulla).
// Le porte vengono dai moduli e si numerano di seguito: cambiare un modulo con piu' o meno porte RINUMERA le seguenti,
// e i cavi restano attaccati ai NUMERI. Per questo la finestra dice, PRIMA di applicare, quanti cavi cambiano porta
// fisica (avviso, non blocco: e' la realta' dei produttori, numerazione per fibra, modulo per modulo).
import { t } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML } from './app-util.js';
import { nodeById, pushHistory, markDirty } from './app.js';
import { renderAll } from './app-render-core.js';
import { renderProps } from './app-properties.js';
import { TYPES, _ensureNodeSpec } from './app-types.js';
import { registerClickActions, registerChangeActions } from './app-delegation.js';
import {
  FIBER_MODULES, FIBER_MAX_SLOTS, FIBER_ROW_SLOTS, FIBER_SLOT, fiberModulePlan, fiberCellSvg, fiberNodeLayout, fiberLayoutOfKeys,
  fiberPortCount, fiberCompositionStats, fiberCompositionRuns, fiberLayoutChanges, fiberRangesText, fiberComposeSet,
  fiberComposeResize, fiberComposeResult,
} from '../lib/fiber-slot.js';

// Il nome di un modulo: i connettori sono nomi propri (uguali in ogni lingua), la lastra e' una parola.
const _MOD_LABEL = {
  'lc-duplex': 'LC duplex', 'lc-quad': 'LC quad', 'sc': 'SC', 'sc-duplex': 'SC duplex', 'st': 'ST', 'fc': 'FC',
  'mpo-12': 'MTP/MPO-12', 'mpo-24': 'MTP/MPO-24',
};
export function fiberModuleLabel(key, plural) {
  if (key === 'blank') return t(plural ? 'fd.mod.blankN' : 'fd.mod.blank');
  return _MOD_LABEL[key] || String(key || '—');
}

/** I moduli a parole: «1–12 LC duplex · 13–16 MTP/MPO-12 · 23–24 vuoti». */
export function fiberRunsText(keys) {
  return fiberCompositionRuns(keys).map((r) => `${r.from === r.to ? r.from : r.from + '–' + r.to} ${fiberModuleLabel(r.key, r.to > r.from)}`).join(' · ');
}

// ── La bozza ────────────────────────────────────────────────────────────────────────────────────────────────────
let _d = null;   // { nid, keys, unit, start: 'chiavi|unita' (com'era all'apertura), armed }
const _sig = (keys, unit) => unit + '|' + keys.join(',');

function _node() { return _d ? nodeById(_d.nid) : null; }
function _ports(n) { return n.ports !== undefined ? n.ports : (TYPES.fiberdrawer && TYPES.fiberdrawer.ports); }
function _unitOf(n) { const s = n.spec || {}; return (s.ppFiberPortUnit || n.ppFiberPortUnit) === 'single' ? 'single' : 'duplex'; }
function _sizeU(n) { return Math.max(1, Math.floor(Number(n.sizeU !== undefined ? n.sizeU : (TYPES.fiberdrawer && TYPES.fiberdrawer.sizeU))) || 1); }
// Quanti slot si possono avere: 24 per U (oltre, il frontale e' semplificato); una composizione gia' piu' lunga si puo' tenere.
function _maxSlots(n) { return Math.min(FIBER_MAX_SLOTS, Math.max(FIBER_ROW_SLOTS * _sizeU(n), _d ? _d.keys.length : 0)); }

// ── Il disegno ──────────────────────────────────────────────────────────────────────────────────────────────────
// Un modulo come nel rack, ingrandito: le celle impilate, ognuna coi suoi fori (stessa geometria: lib/fiber-slot.js).
const _cellHtml = (p) => `<div class="fdc-cell">${fiberCellSvg(p)}</div>`;   // (i fori: solo numeri, dalla lib)
function _moduleBox(key, unit, boxTall) {
  const p = fiberModulePlan(key, unit, boxTall);
  let cells = '';
  if (p.empty) cells = '<div class="fdc-cell fdc-cell-empty"></div>';
  else for (let c = 0; c < p.cells; c++) cells += _cellHtml(p);
  return `<span class="fdc-box fdc-k-${escapeHTML(key)}" style="aspect-ratio:${Number(FIBER_SLOT.w)}/${Number(p.slotH)}"><span class="fdc-cells">${cells}</span></span>`;
}

function _paletteHtml() {
  return FIBER_MODULES.map((k) => `<button type="button" class="fdc-mod${_d.armed === k ? ' on' : ''}" data-act="fdc-mod" data-k="${escapeHTML(k)}" aria-pressed="${_d.armed === k ? 'true' : 'false'}" data-tip="${escapeHTML(fiberModuleLabel(k))}">${_moduleBox(k, _d.unit, false)}<span class="fdc-lbl">${escapeHTML(fiberModuleLabel(k))}</span></button>`).join('');
}

function _stripHtml() {
  const lay = fiberLayoutOfKeys(_d.keys, _d.unit, fiberPortCount(_d.keys, _d.unit));
  let html = '';
  for (let a = 0; a < lay.slots.length; a += FIBER_ROW_SLOTS) {
    html += '<div class="fdc-row">';
    lay.slots.slice(a, a + FIBER_ROW_SLOTS).forEach((s, j) => {
      const i = a + j;
      const name = fiberModuleLabel(s.key);
      const tip = s.ports.length ? t('fd.cmp.slotTipPorts', { n: i + 1, name, ports: fiberRangesText(s.ports) }) : t('fd.cmp.slotTip', { n: i + 1, name });
      html += `<div class="fdc-col" data-i="${Number(i)}"><button type="button" class="fdc-slot" data-act="fdc-slot" title="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}">${_moduleBox(s.key, _d.unit, lay.tall)}</button><span class="fdc-n">${Number(i + 1)}</span></div>`;
    });
    html += '</div>';
  }
  return html;
}

function _toolsHtml(n) {
  const multi = fiberPortCount(_d.keys, 'duplex') !== fiberPortCount(_d.keys, 'single');   // l'unita' conta solo se c'e' un modulo con piu' connettori
  const all = `<option value="">${escapeHTML(t('fd.cmp.allEqual'))}</option>` + FIBER_MODULES.map((k) => `<option value="${escapeHTML(k)}">${escapeHTML(fiberModuleLabel(k))}</option>`).join('');
  const unit = multi ? `<label class="fdc-tool"><span>${escapeHTML(t('f.fiberPortUnit'))}</span><select data-change="fdc-unit"><option value="duplex"${_d.unit === 'duplex' ? ' selected' : ''}>${escapeHTML(t('o.fiberUnitDuplex'))}</option><option value="single"${_d.unit === 'single' ? ' selected' : ''}>${escapeHTML(t('o.fiberUnitSingle'))}</option></select></label>` : '';
  return `<label class="fdc-tool"><span>${escapeHTML(t('fd.cmp.slotCount'))}</span><input type="number" min="1" max="${Number(_maxSlots(n))}" value="${Number(_d.keys.length)}" data-change="fdc-count"></label>
<label class="fdc-tool"><select data-change="fdc-all" aria-label="${escapeHTML(t('fd.cmp.allEqual'))}">${all}</select></label>${unit}`;
}

// Quanti cavi cambiano porta fisica se si applica la bozza: lo dice la lib (porte che cambiano posto) e qui si
// contano i cavi che stanno su quei numeri.
function _impact(n) {
  const before = fiberNodeLayout(n, _ports(n));
  const after = fiberLayoutOfKeys(_d.keys, _d.unit, fiberPortCount(_d.keys, _d.unit));
  const moved = fiberLayoutChanges(before, after);
  const set = new Set(moved.map((p) => `${n.id}-${p}`));
  const touched = new Set();
  let cables = 0;
  for (const l of (store.state.links || [])) {
    if (!l) continue;
    const a = set.has(l.src), b = set.has(l.dst);
    if (!a && !b) continue;
    cables++;
    if (a) touched.add(l.src);
    if (b) touched.add(l.dst);
  }
  const pre = `${n.id}-`;
  return { moved, cables, cabledPorts: Array.from(touched).map((pid) => Number(String(pid).slice(pre.length))) };
}

function _refresh(full) {
  const n = _node();
  if (!n) { _close(); return; }
  const $ = (id) => document.getElementById(id);
  if (full) $('fdc-tools').innerHTML = _toolsHtml(n);
  $('fdc-pal').innerHTML = _paletteHtml();
  $('fdc-strip').innerHTML = _stripHtml();
  const st = fiberCompositionStats(_d.keys, _d.unit);
  const empty = st.empty ? t('pnl.fd.summaryEmpty', { ports: st.ports, slots: st.slots, empty: st.empty, fibres: st.fibres }) : t('pnl.fd.summary', { ports: st.ports, slots: st.slots, fibres: st.fibres });
  $('fdc-sum').innerHTML = `<div class="fdc-words">${escapeHTML(t('fd.cmp.slots'))}: ${escapeHTML(fiberRunsText(_d.keys))}</div><div class="fdc-stats">${escapeHTML(empty)}</div>`;
  const imp = _impact(n);
  const warn = $('fdc-warn');
  let msg, cls = 'fdc-warn';
  if (!imp.moved.length) msg = t('fd.cmp.same');
  else if (imp.cables) { msg = t('fd.cmp.cables', { n: imp.cables, ports: fiberRangesText(imp.cabledPorts) }); cls += ' fdc-warn-on'; }
  else msg = t('fd.cmp.shifts', { ports: fiberRangesText(imp.moved) });
  if (_d.keys.length > FIBER_ROW_SLOTS * _sizeU(n)) msg += ' ' + t('fd.cmp.overflow', { max: FIBER_ROW_SLOTS * _sizeU(n), u: _sizeU(n) });
  warn.className = cls;
  warn.textContent = msg;
  const apply = $('fdc-apply');
  if (apply) apply.disabled = _sig(_d.keys, _d.unit) === _d.start;
  const hint = $('fdc-hint');
  if (hint) hint.textContent = _d.armed ? t('fd.cmp.armed', { name: fiberModuleLabel(_d.armed) }) : t('fd.cmp.hint');
}

// ── La finestra ─────────────────────────────────────────────────────────────────────────────────────────────────
function _ensureOverlay() {
  let ov = document.getElementById('fdcomp-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'fdcomp-overlay';
    ov.className = 'drift-overlay';   // il guscio modale del Drift: stesso a11y (focus-trap, Esc)
    ov.innerHTML = `<div class="drift-modal fdc-modal"><div class="drift-head"><span><i class="fas fa-table-cells"></i> <span id="fdcomp-title"></span></span><button class="toolbar-btn" data-act="fdc-close" data-tip="${escapeHTML(t('common.close'))}"><i class="fas fa-times"></i></button></div><div class="drift-body" id="fdcomp-body"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) _close(); });
  }
  return ov;
}

function _close() {
  _d = null; _drag = null; _paint = false;
  const ov = document.getElementById('fdcomp-overlay');
  if (ov) ov.style.display = 'none';
  const g = document.getElementById('fdc-ghost');
  if (g) g.style.display = 'none';
}

/** Apre il compositore sul cassetto `nid`: parte da com'e' adesso (uniforme = tutti gli slot col suo connettore). */
export function openFiberComposer(nid) {
  const n = nodeById(nid);
  if (!n || n.type !== 'fiberdrawer') return;
  const lay = fiberNodeLayout(n, _ports(n));
  const keys = lay.slots.map((s) => s.key);
  // Serve un punto di partenza dichiarato: tutti i moduli devono essere moduli (non si compone su un connettore ignoto).
  if (!keys.length || keys.some((k) => !FIBER_MODULES.includes(k))) return;
  const unit = _unitOf(n);
  _d = { nid: n.id, keys, unit, start: _sig(keys, unit), armed: null };
  const ov = _ensureOverlay();
  document.getElementById('fdcomp-title').textContent = t('fd.cmp.title');
  document.getElementById('fdcomp-body').innerHTML = `<div class="fdc">
<p class="fdc-hint" id="fdc-hint"></p>
<div class="fdc-pal" id="fdc-pal"></div>
<div class="fdc-strip" id="fdc-strip"></div>
<div class="fdc-tools" id="fdc-tools"></div>
<div class="fdc-sum" id="fdc-sum"></div>
<div class="fdc-warn" id="fdc-warn" role="status"></div>
<div class="fdc-foot"><button type="button" class="toolbar-btn" data-act="fdc-close">${escapeHTML(t('fd.cmp.cancel'))}</button><button type="button" class="toolbar-btn fdc-apply" id="fdc-apply" data-act="fdc-apply">${escapeHTML(t('fd.cmp.apply'))}</button></div>
<div class="fdc-ghost" id="fdc-ghost"></div></div>`;
  ov.style.display = 'flex';
  _refresh(true);
}

function _apply() {
  const n = _node();
  if (!n) { _close(); return; }   // («Applica» e' spento finche' la bozza e' uguale al progetto: qui c'e' sempre qualcosa da scrivere)
  const res = fiberComposeResult(_d.keys, _d.unit);
  pushHistory();   // «sto per modificare»: un solo passo di annulla per tutta la composizione
  const spec = _ensureNodeSpec(n);
  // Tutti gli slot uguali = cassetto uniforme con quel connettore (niente elenco); altrimenti l'elenco, e il
  // connettore dichiarato resta com'era (e' il modulo di partenza).
  if (res.connector) { spec.ppFiberConnector = res.connector; delete spec.fdSlots; delete n.ppFiberConnector; }
  else spec.fdSlots = res.slots;
  delete n.fdSlots;
  if (_d.unit !== _unitOf(n)) { spec.ppFiberPortUnit = _d.unit; delete n.ppFiberPortUnit; }
  n.ports = res.ports;      // le porte vengono dai moduli
  n.portsManual = true;     // e restano un valore deciso da una persona (l'SNMP non lo alza in silenzio)
  _close();
  markDirty(); renderAll(); renderProps();
}

// ── I gesti ─────────────────────────────────────────────────────────────────────────────────────────────────────
let _drag = null;          // { k, x, y, moved }: un modulo della palette preso col puntatore
let _paint = false;        // dipingere: modulo attivo + puntatore premuto sullo strip
let _suppressClick = false;

function _slotAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const col = el && el.closest ? el.closest('#fdc-strip [data-i]') : null;
  return col ? Number(col.dataset.i) : -1;
}
function _setSlot(i, key) {
  if (!_d || i < 0 || i >= _d.keys.length || _d.keys[i] === key) return;
  _d.keys = fiberComposeSet(_d.keys, i + 1, i + 1, key);
  _refresh(true);
}
function _highlight(i) {
  document.querySelectorAll('#fdc-strip .fdc-col').forEach((c) => c.classList.toggle('fdc-over', Number(c.dataset.i) === i));
}
function _ghost(show, ev, key) {
  const g = document.getElementById('fdc-ghost');
  if (!g) return;
  if (!show) { g.style.display = 'none'; return; }
  if (key !== undefined) g.innerHTML = _moduleBox(key, _d.unit, false);
  g.style.display = 'block';
  g.style.left = (ev.clientX - 15) + 'px';
  g.style.top = (ev.clientY - 23) + 'px';
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (ev) => {
    if (!_d || (ev.button !== undefined && ev.button > 0)) return;
    const t0 = ev.target;
    const mod = t0 && t0.closest ? t0.closest('#fdcomp-overlay .fdc-mod') : null;
    if (mod) { _drag = { k: mod.dataset.k, x: ev.clientX, y: ev.clientY, moved: false }; ev.preventDefault(); return; }
    if (_d.armed) {
      const i = _slotAt(ev.clientX, ev.clientY);
      if (i >= 0) { _paint = true; _setSlot(i, _d.armed); ev.preventDefault(); }
    }
  });
  document.addEventListener('pointermove', (ev) => {
    if (!_d) return;
    if (_drag) {
      if (!_drag.moved && Math.abs(ev.clientX - _drag.x) + Math.abs(ev.clientY - _drag.y) > 5) { _drag.moved = true; _ghost(true, ev, _drag.k); }
      if (_drag.moved) { _ghost(true, ev); _highlight(_slotAt(ev.clientX, ev.clientY)); }
    } else if (_paint && _d.armed) {
      const i = _slotAt(ev.clientX, ev.clientY);
      if (i >= 0) _setSlot(i, _d.armed);
    }
  });
  const end = (ev, cancel) => {
    if (_drag) {
      if (_drag.moved) {
        if (!cancel && _d) { const i = _slotAt(ev.clientX, ev.clientY); if (i >= 0) _setSlot(i, _drag.k); }
        _ghost(false); _highlight(-1);
        _suppressClick = true; setTimeout(() => { _suppressClick = false; }, 0);   // il click che segue un trascinamento non e' un «attiva»
      }
      _drag = null;
    }
    _paint = false;
  };
  document.addEventListener('pointerup', (ev) => end(ev, false));
  document.addEventListener('pointercancel', (ev) => end(ev, true));
}

// ── Le azioni ───────────────────────────────────────────────────────────────────────────────────────────────────
registerClickActions({
  'fd-compose': (el) => openFiberComposer(el.dataset.nid),
  'fdc-close': () => _close(),
  'fdc-apply': () => _apply(),
  // Toccare un modulo lo rende ATTIVO (dipinge gli slot); toccarlo ancora lo toglie. Anche con la tastiera.
  'fdc-mod': (el) => {
    if (!_d || _suppressClick) return;
    _d.armed = _d.armed === el.dataset.k ? null : el.dataset.k;
    _refresh(false);
  },
  // Con il mouse/tocco lo slot si dipinge gia' al pressione (pointerdown); qui la tastiera (Invio/Spazio fanno un click).
  // Per il puntatore il click che segue ri-applica lo stesso modulo allo stesso slot: non cambia niente.
  'fdc-slot': (el) => {
    if (!_d) return;   // (senza modulo attivo `_setSlot` non mette niente: la lib rifiuta una chiave che non e' un modulo)
    const col = el.closest('[data-i]');
    if (col) _setSlot(Number(col.dataset.i), _d.armed);
  },
});
registerChangeActions({
  'fdc-count': (el) => { if (!_d) return; const n = _node(); if (!n) return; _d.keys = fiberComposeResize(_d.keys, Math.min(Number(el.value) || 1, _maxSlots(n)), _d.keys[_d.keys.length - 1]); _refresh(true); },
  'fdc-all': (el) => { if (!_d || !el.value) return; _d.keys = fiberComposeSet(_d.keys, 1, _d.keys.length, el.value); _refresh(true); },
  'fdc-unit': (el) => { if (!_d) return; _d.unit = el.value === 'single' ? 'single' : 'duplex'; _refresh(true); },
});
