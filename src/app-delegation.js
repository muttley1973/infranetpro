// ============================================================
// DELEGATION — harness di event delegation (ritiro onclick inline, ASSE B)
// ------------------------------------------------------------
// Rimpiazza gli onclick="foo(args)" inline (che risolvono `foo` su window via
// expose()) con `data-act="key"` + UN listener delegato sul document. Il registro
// mappa key -> funzione IMPORTATA (nessun window). Man mano che le superfici
// migrano a data-act, le funzioni escono da expose() e il ponte `window.*` si
// assottiglia verso la cancellazione di _bridge.js (fine ASSE B).
// Vedi [[frontend-architettura-stato]] · [[migrazione-esm-esbuild]].
//
// USO:  registerClickActions({ undo: () => undo(), redo: () => redo() });
//       initDelegation();
//   HTML/template:  <button data-act="undo">…</button>
// Gli eventuali argomenti si leggono da data-* sull'elemento (es. data-pid)
// DENTRO la funzione registrata: fn(el, ev) riceve l'elemento e l'evento.
//
// NB: questo modulo NON tocca window/_bridge — è il primo pezzo di codice
// frontend nato SENZA ponte (obiettivo finale della migrazione).
// ============================================================

const _click = new Map();

/** Registra azioni click. map = { key: (el, ev) => void }. Errore se key duplicata. */
export function registerClickActions(map) {
    for (const key of Object.keys(map)) {
        if (_click.has(key)) throw new Error('delegation: azione click duplicata "' + key + '"');
        _click.set(key, map[key]);
    }
}

// Dispatch PURO (risale da `target` al primo [data-act], guarda il registro,
// invoca fn(el, ev)). Ritorna true se ha gestito. Esposto per test/diagnostica.
export function dispatchClick(target, ev) {
    const el = (target && typeof target.closest === 'function') ? target.closest('[data-act]') : null;
    if (!el) return false;
    const fn = _click.get(el.getAttribute('data-act'));
    if (!fn) return false;
    fn(el, ev);
    return true;
}

let _inited = false;
/** Aggancia UNA sola volta il listener delegato sul document (idempotente). */
export function initDelegation(root) {
    if (_inited) return;
    _inited = true;
    const r = root || (typeof document !== 'undefined' ? document : null);
    if (r) r.addEventListener('click', (ev) => { dispatchClick(ev.target, ev); });
}
