// ============================================================
// STORICO (undo/redo) + DIRTY FLAG + AUDIT TRAIL  [modulo ESM, estratto da app.js]
// Split app.js #3. state/_history/_histIdx/_isDirty/selId/... sono window-globals
// (proxy store.js): letti/riassegnati bare, identico a prima (bundle IIFE non-strict).
// undo/redo restano FUORI da window (ESM-only via data-act, come da e2e); i 6 helper
// esposti mantengono la superficie window. app.js re-exporta tutti e 8 per gli import ESM.
// ============================================================
import { expose } from "./_bridge.js";
import { store } from "./store.js";   // currentProjectId per persistAuditEntries
import { _invalidateIdx } from "./app.js";   // ciclo benigno: uso solo a runtime
import { renderAll } from "./app-render-core.js";
import { saveProject } from "./app-core.js";   // ciclo benigno: solo a runtime (autosave debounced)
import { photo, outsidePhoto, rebuild, record, undo as _undoStep, redo as _redoStep, canUndo, canRedo } from "../lib/undo-history.js";   // il modello di annulla/ripeti (puro, provato a parte)
// Bare globals (no-undef OFF): _history/_histIdx/state/_isDirty/selId/selType/highPath
// (proxy store) - renderRackTabs/updateTransforms (window, app-search-zoom-rack) -
// appendAudit (lib/audit-log.js) - _currentUser (store).

// ── LA CONVENZIONE: pushHistory() PRIMA di modificare ────────────────────────────────────────────
// Chi sta per modificare il progetto chiama pushHistory() — «ricorda com'e' ora» — e POI modifica. La storia
// contiene quindi gli stati PRIMA delle operazioni, e lo stato di adesso non e' in nessun elenco finche' non
// serve (alla prima annulla, per il ripeti). Il modello sta in lib/undo-history.js, con i suoi test.
// ⚠️ Un chiamante che fotografasse DOPO la modifica rompe l'ordine: la foto e' lo stato nuovo, e annullare
// non toglie niente. (Il trascinamento lo faceva: ora fotografa quando il drag parte, v. app-pointer.js.)

// La foto dello stato com'e' ADESSO (lib/undo-history.js: `photo`).
// Ne restano fuori sfondo (base64, spesso >1 MB), giornale (append-only: la storia "chi/quando/cosa" sopravvive a
// annulla e ripeti) e VISTA (pan, zoom, scheda del rack): non sono operazioni, e annulla/ripeti li riagganciano
// SEMPRE dallo stato corrente. Con la vista dentro, un pan dopo un Ctrl+Z era «una modifica non registrata» e il
// Ctrl+Z dopo toglieva solo lui, buttando il ripeti.
function _snapshot() {
    return photo(state);
}

// «Dopo l'ultimo punto e' successo qualcosa»: serve SOLO ai pulsanti (a Ctrl+Z decide il confronto vero, in
// lib/undo-history.js). pushHistory() e markDirty() lo accendono; annulla e ripeti lo spengono.
let _pending = false;
let _restoring = false;   // dentro annulla/ripeti: il markDirty() che accende «Salva» non e' una modifica nuova

// Le cose fuori foto (sfondo, giornale, vista) di certi punti. Servono SOLO a un'operazione che SOSTITUISCE il
// progetto intero (importa JSON): li' lo sfondo e il giornale di adesso sono quelli del file importato, e annullare
// deve rimettere quelli di prima — non riagganciare i nuovi a un progetto che non e' il loro. Per ogni altro punto
// il progetto e' lo stesso e vale lo stato corrente. Chiave: la foto del punto (la stringa e' gia' nella storia).
const _outside = new Map();

// Fuori dalla mappa i punti che la storia non ha piu' (tetto, ripeti buttato, progetto cambiato): portano uno sfondo.
function _pruneOutside() {
    if (!_outside.size) return;
    for (const k of _outside.keys()) if (_history.indexOf(k) < 0) _outside.delete(k);
}

// Se il punto a cui si va ha con se' le sue cose fuori foto, anche lo stato che si LASCIA le porta via: ripeti
// (o annulla) di nuovo, e le ritrova.
function _carryOutside(leaving, target) {
    if (_outside.has(target)) _outside.set(leaving, outsidePhoto(state));
}

function _record(snap, withOutside) {
    const r = record(_history, _histIdx, snap);
    _history = r.points; _histIdx = r.idx;
    if (withOutside) _outside.set(snap, outsidePhoto(state));
    _pending = true;
    _updateHistoryBtns();
}

/**
 * «Sto per modificare»: ricorda lo stato com'e' ora.
 * `{ withOutside:true }` solo per un'operazione che sostituisce il progetto intero (importa JSON): il punto si
 * porta dietro lo sfondo e il giornale di adesso, e l'annulla li rimette.
 */
export function pushHistory(opts) {
    _record(_snapshot(), !!(opts && opts.withOutside));
}

// La foto di adesso, da tenere in mano: per chi non sa ancora se l'operazione cambiera' qualcosa (il trascinamento:
// parte a 5 px, ma puo' finire dov'era, fuori dalla planimetria o rifiutato) e la registra solo se cambia davvero.
export function takeSnapshot() {
    return _snapshot();
}

/** «Prima di questa operazione lo stato era `snap`»: pushHistory() con una foto presa PRIMA (takeSnapshot). */
export function recordSnapshot(snap) {
    _record(snap, false);
}

// Rimette in piedi uno stato (annulla e ripeti): le cose fuori foto — sfondo, giornale, vista — si riagganciano
// dallo stato CORRENTE, tranne quelle di un punto che le porta con se' (v. _outside).
function _restoreSnapshot(snap) {
    const kept = _outside.get(snap);
    state = rebuild(snap, kept ? Object.assign({}, state, kept) : state);   // `kept` vince sulle cinque chiavi; l'ordine resta quello dello stato vivo
    _invalidateIdx();
    _resetSelection(); renderRackTabs(); updateTransforms(); renderAll();
}

// Lo stato di ADESSO, per il confronto che decide annulla e ripeti (lib/undo-history.js). Serializzare il progetto
// costa (centinaia di KB a 500 apparati) e a ogni pressione era il doppio di prima: se dopo l'ultimo punto non e'
// successo niente — _pending spento: lo accendono pushHistory() e markDirty(), e annulla/ripeti lo spengono — lo
// stato E' il punto, e non c'e' niente da serializzare. Con la storia vuota (idx -1) il punto non c'e': il modello
// ritorna null prima di guardare questo valore.
function _currentForCompare() {
    return _pending ? _snapshot() : _history[_histIdx];
}

// Il passo che annulla e ripeti hanno in comune: il modello ha deciso (r), qui si SPOSTA la storia e si rimette in
// piedi lo stato. cur e' lo stato che si lascia (serve a chi porta con se' sfondo e giornale).
function _moveTo(r, cur) {
    _history = r.points; _histIdx = r.idx;
    _carryOutside(cur, r.restore);
    _restoring = true;
    try {
        _restoreSnapshot(r.restore);
        // Lo stato ripristinato è DIVERSO da quello salvato: «Salva» si accende e
        // l'autosave riparte (smoke 06/09: Ctrl+S, Ctrl+Z, il bottone restava pulito).
        markDirty();
    } finally { _restoring = false; }
    _pending = false;
    _updateHistoryBtns();
}

export function undo() {
    const cur = _currentForCompare();
    const r = _undoStep(_history, _histIdx, cur);
    if (!r) { _pending = false; _updateHistoryBtns(); return; }      // niente prima: il pulsante non resta acceso a vuoto
    _moveTo(r, cur);
}

export function redo() {
    // Lo stato corrente va confrontato col punto: una modifica non registrata dopo l'annulla (un campo del pannello, un
    // giro silenzioso del monitor) la tiene da parte il modello, come fa undo(), invece di sovrascriverla.
    const cur = _currentForCompare();
    const r = _redoStep(_history, _histIdx, cur);
    if (!r) return;
    _moveTo(r, cur);
}

// La storia riparte da zero: un progetto caricato, creato, duplicato o ripristinato da un'istantanea non ha niente da
// annullare. Azzera ANCHE «dopo l'ultimo punto e' successo qualcosa» (prima restava quello del progetto di prima) e i
// punti che portavano uno sfondo.
export function resetHistory() {
    _history = []; _histIdx = -1;
    _pending = false;
    _outside.clear();
    _updateHistoryBtns();
}

export function _updateHistoryBtns() {
    _pruneOutside();   // passa di qui ogni volta che la storia cambia o si azzera (carica/crea/ripristina un progetto)
    const u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo');
    if (u) u.disabled = !canUndo(_history, _histIdx, _pending);
    if (r) r.disabled = !canRedo(_history, _histIdx);
}

export function _resetSelection() { selId=null; selType=null; highPath.clear(); }

// ============================================================
// DIRTY FLAG (sostituisce saveState)
// ============================================================
// ⭐ Quante volte il documento è stato sporcato. Non è un contatore statistico: è
// il modo di distinguere «il salvataggio ha coperto tutto» da «nel frattempo è
// arrivata un'altra modifica». Il corpo del PUT viene serializzato PRIMA della
// richiesta, quindi ciò che l'utente tocca mentre la richiesta è in volo NON è in
// quel corpo — e spegnere il segnale al ritorno diceva «salvato» di una modifica
// che sul disco non c'era. Vive qui, modulo-scoped: non è stato del documento e
// non ha ragione di stare su window.
let _dirtyEpoch = 0;

/** L'epoca corrente: chi sta per salvare la prende ORA e la ripresenta a cose fatte. */
export function dirtyEpoch() { return _dirtyEpoch; }

/** Il documento ha modifiche non salvate? Lettura pura del segnale — la usa la
 *  guardia `beforeunload` per avvisare prima di chiudere la scheda. */
export function isDirty() { return !!_isDirty; }

export function markDirty() {
    _invalidateIdx();
    if (!_restoring && !_pending) { _pending = true; _updateHistoryBtns(); }   // una modifica dopo l'ultimo punto: ora si puo' annullare
    _isDirty = true;
    _dirtyEpoch++;
    const btn = document.getElementById('btn-save');
    if (btn) btn.classList.add('save-dirty');
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

/**
 * Spegne il segnale «da salvare» — che dal 01/09 è il riempimento ambra del
 * bottone, non piu' un pallino a lato: era dello stesso colore del riempimento
 * (quindi invisibile) e allargava il bottone di 14px nel solo stato sporco.
 * @param {number} [epoca] Se passata, spegne SOLO se da allora non è arrivata
 *   nessuna nuova modifica. Chi carica/crea/duplica un progetto la omette: lì il
 *   documento è nuovo di zecca e pulito per costruzione, senza niente da
 *   confrontare. Chi SALVA la passa sempre, perché fra la partenza della
 *   richiesta e la sua risposta l'utente continua a lavorare.
 */
export function _clearDirty(epoca) {
    if (epoca !== undefined && epoca !== _dirtyEpoch) return;   // sporcato DOPO: resta sporco
    _isDirty = false;
    const btn = document.getElementById('btn-save');
    if (btn) btn.classList.remove('save-dirty');
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
    return state.auditLog[state.auditLog.length - 1];   // la voce appena scritta: chi la vuole mandare subito al server la riceve
}

// Le voci di un GIRO (oggi il Sync, anche quello del monitoraggio automatico) vanno sul disco SUBITO:
// la voce di una persona viaggia col Salva, ma nessuno salva il giro dell'ora, e con l'autosave spento
// (il default) la riga moriva con la pagina — e la scheda Modifiche si fermava all'ultimo Salva.
// Il server accetta solo le azioni di giro (`RUN_ACTIONS`, lib/audit-log.js) e fonde senza
// duplicati, quindi la stessa voce che arriva anche col Salva non raddoppia.
// Best-effort come presenza e timeline: se fallisce la riga resta in memoria e va su disco al Salva.
export function persistAuditEntries(entries){
    try {
        const list = (entries || []).filter(Boolean);
        if(!store.currentProjectId || !list.length) return;
        fetch(`/api/projects/${store.currentProjectId}/history/audit`, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ entries: list }),
        }).catch(()=>{});
    } catch(_){ /* best-effort */ }
}

// Superficie window invariata (i 6 erano nell expose() di app.js). undo/redo NO:
// restano ESM-only (data-act), come asserito dagli e2e.
expose({ pushHistory, _updateHistoryBtns, _resetSelection, markDirty, _clearDirty, logAudit });
