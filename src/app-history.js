// ============================================================
// STORICO (undo/redo) + DIRTY FLAG + AUDIT TRAIL  [modulo ESM, estratto da app.js]
// Split app.js #3. state/_history/_histIdx/_isDirty/selId/... sono window-globals
// (proxy store.js): letti/riassegnati bare, identico a prima (bundle IIFE non-strict).
// undo/redo restano FUORI da window (ESM-only via data-act, come da e2e); i 6 helper
// esposti mantengono la superficie window. app.js re-exporta tutti e 8 per gli import ESM.
// ============================================================
import { expose } from "./_bridge.js";
import { _invalidateIdx } from "./app.js";   // ciclo benigno: uso solo a runtime
import { renderAll } from "./app-render-core.js";
import { saveProject } from "./app-core.js";   // ciclo benigno: solo a runtime (autosave debounced)
// Bare globals (no-undef OFF): _history/_histIdx/state/_isDirty/selId/selType/highPath
// (proxy store) - renderRackTabs/updateTransforms (window, app-search-zoom-rack) -
// appendAudit (lib/audit-log.js) - _currentUser (store).

export function pushHistory() {
    _history = _history.slice(0, _histIdx+1);
    // bgImage è base64 (spesso >1 MB): escluso dagli snapshot per non saturare la RAM.
    // Undo/redo riagganciano sempre il bgImage corrente — l'immagine di sfondo
    // non è un'operazione annullabile (ha il proprio pulsante "Rimuovi mappa").
    // auditLog è append-only: escluso dagli snapshot così l'undo non lo riscrive
    // (la storia "chi/quando/cosa" sopravvive a undo/redo).
    const bg = state.bgImage;
    const audit = state.auditLog;
    state.bgImage = null;
    state.auditLog = undefined;
    _history.push(JSON.stringify(state));
    state.bgImage = bg;
    state.auditLog = audit;
    if (_history.length > 60) _history.shift(); else _histIdx++;
    _updateHistoryBtns();
}

export function undo() {
    if (_histIdx <= 0) return;
    const bg = state.bgImage;                  // preserva il background corrente
    const audit = state.auditLog;              // append-only: non si annulla
    state = JSON.parse(_history[--_histIdx]);
    state.bgImage = bg;                        // riaggancia (non è in snapshot)
    state.auditLog = audit;
    _invalidateIdx();
    _resetSelection(); renderRackTabs(); updateTransforms(); renderAll();
    _updateHistoryBtns();
}

export function redo() {
    if (_histIdx >= _history.length-1) return;
    const bg = state.bgImage;                  // preserva il background corrente
    const audit = state.auditLog;              // append-only: non si annulla
    state = JSON.parse(_history[++_histIdx]);
    state.bgImage = bg;                        // riaggancia (non è in snapshot)
    state.auditLog = audit;
    _invalidateIdx();
    _resetSelection(); renderRackTabs(); updateTransforms(); renderAll();
    _updateHistoryBtns();
}

export function _updateHistoryBtns() {
    document.getElementById('btn-undo').disabled = _histIdx <= 0;
    document.getElementById('btn-redo').disabled = _histIdx >= _history.length-1;
}

export function _resetSelection() { selId=null; selType=null; highPath.clear(); }

// ============================================================
// DIRTY FLAG (sostituisce saveState)
// ============================================================
export function markDirty() {
    _invalidateIdx();
    _isDirty = true;
    const dot = document.getElementById('save-dot');
    const btn = document.getElementById('btn-save');
    if (dot) dot.style.display = 'inline-block';
    if (btn) { btn.classList.add('save-dirty'); btn.classList.remove('primary'); }
    _scheduleAutosave();
}

// ── AUTOSAVE (debounce-on-dirty) ─────────────────────────────────────
// Ogni markDirty ri-arma un timer; alla quiete (debounce) salva UNA volta,
// in silenzio (saveProject{quiet}). Copre sia gli edit umani sia i dati
// freschi (Sync/Verifica). "Guardare non sporca": i cambi di sola VISTA non
// chiamano markDirty → non innescano autosave. Opt-in: default OFF
// (autoPoll.autosave) per non scrivere su disco durante golden/test.
let _autosaveTimer = null;
export function _scheduleAutosave() {
    if (!state.autoPoll || !state.autoPoll.autosave) return;   // opt-in, default OFF
    clearTimeout(_autosaveTimer);
    const wait = (state.autoPoll.autosaveDebounceMs | 0) || 10000;   // coalescing raffiche
    _autosaveTimer = setTimeout(() => {
        _autosaveTimer = null;
        if (!_isDirty) return;             // niente da salvare (già salvato o pulito)
        saveProject({ quiet: true });      // salta da sé se _snmpSyncing / nessun progetto
    }, wait);
}

export function _clearDirty() {
    _isDirty = false;
    const dot = document.getElementById('save-dot');
    const btn = document.getElementById('btn-save');
    if (dot) dot.style.display = 'none';
    if (btn) { btn.classList.remove('save-dirty'); btn.classList.add('primary'); }
}

// ── Audit trail (N2): journal append-only "chi / quando / cosa" ──────
// Registra solo eventi STRUTTURALI (device/cavi/VLAN/sync/doc), non ogni
// micro-edit (per quello c'è l'undo). auditLog è escluso dagli snapshot di
// undo (sopravvive a undo/redo).
// ⚠️ Il tetto NON si scrive qui: lo decide AUDIT_CAP_DEFAULT in
// lib/audit-log.js, ed è l'unico posto. Qui c'era un 1000 a mano, cioè una
// seconda definizione dello stesso numero che vinceva sulla prima.
export function logAudit(action, info){
    info = info || {};
    if(typeof appendAudit !== 'function') return;
    if(!Array.isArray(state.auditLog)) state.auditLog = [];
    const user = (typeof _currentUser === 'object' && _currentUser && _currentUser.username) ? _currentUser.username : 'sistema';
    appendAudit(state.auditLog, { user, action, target: info.target, summary: info.summary });
    markDirty();
}

// Superficie window invariata (i 6 erano nell expose() di app.js). undo/redo NO:
// restano ESM-only (data-act), come asserito dagli e2e.
expose({ pushHistory, _updateHistoryBtns, _resetSelection, markDirty, _clearDirty, logAudit });
