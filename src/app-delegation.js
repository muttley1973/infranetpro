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
// indipendente un'azione click, change e input:
//     click  -> data-act      (bottoni, voci di menu)
//     change -> data-change    (select, checkbox, input file, number "committato")
//     input  -> data-input     (typing live su text/number/textarea)
//
// USO:  registerClickActions({  undo: () => undo() });
//       registerChangeActions({ 'rack-size': (el) => updateRackSize(el.value) });
//       registerInputActions({  'palette-filter': (el) => filterPaletteItems(el.value) });
//       initDelegation();   // UNA volta (in bindEventsOnce)
//   HTML/template:  <button data-act="undo">…</button>
//                   <select data-change="rack-size">…</select>
//                   <input  data-input="palette-filter">
// Gli eventuali argomenti si leggono dall'elemento DENTRO la funzione: fn(el, ev)
// riceve l'elemento (per el.value / el.checked / el.dataset.*) e l'evento.
//
// NB: questo modulo NON tocca window/_bridge — è il primo pezzo di codice
// frontend nato SENZA ponte (obiettivo finale della migrazione).
// ============================================================

// Un registro per tipo di evento + l'attributo HTML che ne porta la chiave.
const _reg = {
    click:  new Map(),
    change: new Map(),
    input:  new Map(),
};
const _attr = {
    click:  'data-act',
    change: 'data-change',
    input:  'data-input',
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
export function dispatchClick(target, ev)  { return _dispatch('click', target, ev); }
export function dispatchChange(target, ev) { return _dispatch('change', target, ev); }
export function dispatchInput(target, ev)  { return _dispatch('input', target, ev); }

let _inited = false;
/** Aggancia UNA sola volta i listener delegati sul document (idempotente). */
export function initDelegation(root) {
    if (_inited) return;
    _inited = true;
    const r = root || (typeof document !== 'undefined' ? document : null);
    if (!r) return;
    r.addEventListener('click',  (ev) => _dispatch('click',  ev.target, ev));
    r.addEventListener('change', (ev) => _dispatch('change', ev.target, ev));
    r.addEventListener('input',  (ev) => _dispatch('input',  ev.target, ev));
}
