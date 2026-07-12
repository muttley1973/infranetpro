// ============================================================
// DELEGATION — harness di event delegation (ritiro onclick inline, ASSE B)
// ------------------------------------------------------------
// Rimpiazza gli handler inline (onclick/onchange/oninput — che risolvono la fn
// su window via expose()) con un attributo `data-*` + UN listener delegato sul
// document per tipo di evento. Il registro mappa key -> funzione IMPORTATA
// (nessun window). Man mano che le superfici migrano, le funzioni escono da
// expose() e il ponte `window.*` si assottiglia verso la cancellazione di
// _bridge.js (fine ASSE B). Vedi [[frontend-architettura-stato]] · [[migrazione-esm-esbuild]].
//
// UN attributo per TIPO di evento, cosi' lo stesso elemento puo' portare in modo
// indipendente piu' azioni (es. una search box: input + focus + keydown):
//     click   -> data-act      (bottoni, voci di menu)
//     change  -> data-change    (select, checkbox, input file, number "committato")
//     input   -> data-input     (typing live su text/number/textarea)
//     focus   -> data-focus     (ripristino/azione al focus; usa `focusin` che fa bubbling)
//     keydown -> data-keydown    (navigazione da tastiera; la fn riceve l'evento)
//
// USO:  registerClickActions({  undo: () => undo() });
//       registerChangeActions({ 'rack-size': (el) => updateRackSize(el.value) });
//       registerInputActions({  'palette-filter': (el) => filterPaletteItems(el.value) });
//       registerFocusActions({  'global-search': (el) => handleSearchInput(el.value) });
//       registerKeydownActions({ 'global-search': (el, ev) => handleSearchKey(ev) });
//       initDelegation();   // UNA volta (in bindEventsOnce)
//   HTML/template:  <button data-act="undo">…</button>
//                   <select data-change="rack-size">…</select>
//                   <input  data-input="palette-filter">
//                   <input  data-input="global-search" data-focus="global-search" data-keydown="global-search">
// Gli eventuali argomenti si leggono dall'elemento DENTRO la funzione: fn(el, ev)
// riceve l'elemento (per el.value / el.checked / el.dataset.*) e l'evento.
// NB: `focus` non fa bubbling -> per la delegazione si aggancia `focusin` (che bubbling lo fa),
// tenendo pero' la chiave-tipo interna "focus".
//
// NB: questo modulo NON tocca window/_bridge — è il primo pezzo di codice
// frontend nato SENZA ponte (obiettivo finale della migrazione).
// ============================================================

// Un registro per tipo di evento + l'attributo HTML che ne porta la chiave.
const _reg = {
    click:   new Map(),
    change:  new Map(),
    input:   new Map(),
    focus:   new Map(),
    keydown: new Map(),
};
const _attr = {
    click:   'data-act',
    change:  'data-change',
    input:   'data-input',
    focus:   'data-focus',
    keydown: 'data-keydown',
};
// Nome dell'evento DOM realmente agganciato per tipo (focus -> focusin, che fa bubbling).
const _domEvent = {
    click:   'click',
    change:  'change',
    input:   'input',
    focus:   'focusin',
    keydown: 'keydown',
};

function _add(type, map) {
    const reg = _reg[type];
    for (const key of Object.keys(map)) {
        if (reg.has(key)) throw new Error('delegation: azione ' + type + ' duplicata "' + key + '"');
        reg.set(key, map[key]);
    }
}

/** Registra azioni click. map = { key: (el, ev) => void }. Errore se key duplicata. */
export function registerClickActions(map)  { _add('click', map); }
/** Registra azioni change (select/checkbox/file/number committato). Attributo data-change. */
export function registerChangeActions(map) { _add('change', map); }
/** Registra azioni input (typing live su text/number/textarea). Attributo data-input. */
export function registerInputActions(map)  { _add('input', map); }
/** Registra azioni focus (agganciate via `focusin`, che fa bubbling). Attributo data-focus. */
export function registerFocusActions(map)  { _add('focus', map); }
/** Registra azioni keydown (navigazione tastiera; la fn riceve l'evento). Attributo data-keydown. */
export function registerKeydownActions(map){ _add('keydown', map); }

// Dispatch PURO per tipo: risale da `target` al primo [attr] del tipo, guarda il
// registro, invoca fn(el, ev). Ritorna true se ha gestito.
function _dispatch(type, target, ev) {
    const attr = _attr[type];
    const el = (target && typeof target.closest === 'function') ? target.closest('[' + attr + ']') : null;
    if (!el) return false;
    const fn = _reg[type].get(el.getAttribute(attr));
    if (!fn) return false;
    fn(el, ev);
    return true;
}

// Esposti per test/diagnostica (uno per tipo).
export function dispatchClick(target, ev)   { return _dispatch('click', target, ev); }
export function dispatchChange(target, ev)  { return _dispatch('change', target, ev); }
export function dispatchInput(target, ev)   { return _dispatch('input', target, ev); }
export function dispatchFocus(target, ev)   { return _dispatch('focus', target, ev); }
export function dispatchKeydown(target, ev) { return _dispatch('keydown', target, ev); }

let _inited = false;
/** Aggancia UNA sola volta i listener delegati sul document (idempotente). */
export function initDelegation(root) {
    if (_inited) return;
    _inited = true;
    const r = root || (typeof document !== 'undefined' ? document : null);
    if (!r) return;
    // Un listener delegato per TIPO interno; il nome DOM viene da _domEvent (focus->focusin).
    for (const type of Object.keys(_reg)) {
        r.addEventListener(_domEvent[type], (ev) => _dispatch(type, ev.target, ev));
    }
}
