// ============================================================
// CORE FRONTEND                       [modulo ESM, ex lib/app-core.js]
// API client, gestione progetti (CRUD + switch), modali, bootstrap _initApp.
// _modalOk/_modalCancel/API restano module-local. Stato app condiviso
// (currentProjectId, _history, _isDirty, state, ...) su window via win.*.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store, resetProjectRuntime } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { pushHistory, _invalidateIdx, logAudit, _clearDirty, dirtyEpoch, _migrateState, _updateHistoryBtns, _buildDefaultState, bindEventsOnce, _loadDefaultLocal } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderRackTabs, updateTransforms, _updateFloorToolbarVisibility, initPaletteUi } from './app-search-zoom-rack.js';   // ritiro ponte: funzioni rack/zoom/search (ex win.*)
import { _restoreTopoSession } from './app-topology-discover.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)
import { _startAutoMonitor } from './app-drift.js';   // monitoraggio automatico unificato: rearm dello scheduler al load progetto (ciclo benigno: solo a runtime)
import { createSnapshot } from './app-snapshots.js';   // snapshot su Salva manuale (ciclo benigno: solo a runtime)
import { registerClickActions, registerChangeActions } from './app-delegation.js';   // ASSE B: bottoni progetto (data-act) + selettore progetto (data-change)
import { loadDeviceTypes } from './app-device-types.js';   // boot catalogo device-type (import diretto: no win.*)

const API = '/api/projects';

// ⭐ La versione del progetto che questa scheda ha in mano, presa dall'ETag della
// risposta. La ripresentiamo a ogni Salva come `If-Match`: se sul server nel
// frattempo ha scritto qualcun altro, il salvataggio viene RIFIUTATO invece di
// sovrascrivere in silenzio. È metadato di trasporto, non documento: modulo-scoped,
// non nello store (e quindi non su window).
// ⚠️ Va aggiornata dopo OGNI risposta che tocca `<id>.json` — Salva, ma anche la
// RINOMINA, che riscrive il file. Dimenticarla lì produrrebbe un 409 contro sé
// stessi al primo Salva dopo un rinomina: la guardia accuserebbe l'unica sessione
// aperta, che è il modo classico di far disattivare una guardia.
let _projectEtag = null;
// ⚠️ SOLO sulle risposte riuscite. Anche il 409 porta un ETag — quello di chi ha
// scritto per ultimo — e adottarlo qui farebbe passare il salvataggio successivo
// senza chiedere niente a nessuno: la guardia si disinnescherebbe da sé, al primo
// caso che deve fermare. Chi decide di sovrascrivere prende quel valore dal corpo
// della risposta, esplicitamente.
const _captureEtag = (res) => {
    if (!res.ok) return;
    const t = res.headers.get('ETag');
    if (t) _projectEtag = t;
};
const _ifMatch = () => (_projectEtag ? { 'If-Match': _projectEtag } : {});

async function apiFetch(path, opts={}) {
    // `onResponse` non è un'opzione di fetch: si sfila prima, o finirebbe
    // nell'init della richiesta. Serve a leggere le INTESTAZIONI (l'ETag del
    // progetto) senza sporcare il corpo delle risposte, che è il DTO letto anche
    // dalla REST API v1.
    const { onResponse, ...init } = opts;
    const method=(init.method||'GET').toUpperCase();
    if(store._currentUser?.role==='viewer' && method!=='GET'){
        throw new Error(t('pnl.seg.viewerNotAllowed'));
    }
    try {
        const res = await fetch(path, {
            headers:{'Content-Type':'application/json'},
            ...init
        });
        // Prima del controllo sull'esito: anche un 409 porta l'ETag di chi ha
        // scritto per ultimo, ed è l'informazione che serve a decidere.
        if (typeof onResponse === 'function') onResponse(res);
        if (!res.ok) {
            const err = await res.json().catch(()=>({error:'Server error'}));
            const e = new Error(err.error || `HTTP ${res.status}`);
            e.status = res.status;      // chi chiama può distinguere i casi (409 = versione superata)
            e.payload = err;
            throw e;
        }
        return res.status === 204 ? null : res.json();
    } catch(e) {
        if (e instanceof TypeError) {
            document.getElementById('conn-banner').classList.add('show');
        }
        throw e;
    }
}

async function loadProjectList() {
    const list = await apiFetch(API);
    const sel = document.getElementById('project-select');
    sel.innerHTML = '';
    list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.id === store.currentProjectId) opt.selected = true;
        sel.appendChild(opt);
    });
    // La sotto-header legge il nome del progetto DA QUESTA tendina, e qui la
    // tendina e' appena cambiata. Senza questa riga il breadcrumb restava indietro
    // di un passo: `switchProject` fa loadProject (che ridisegna tutto) e SOLO DOPO
    // ripopola la <select>, quindi all'avvio a freddo la barra leggeva un elenco
    // ancora vuoto e scriveva «Nessun progetto» con un progetto aperto — fino al
    // primo click, che ridisegnando la correggeva da sola. Bare global con guardia:
    // stesso idioma del resto del modulo, nessun import nuovo (niente cicli).
    if (typeof renderSubbar === 'function') renderSubbar();
    return list;
}

async function loadProject(id) {
    const proj = await apiFetch(`${API}/${id}`, { onResponse: _captureEtag });
    store.currentProjectId = proj.id;
    store.state = _migrateState(proj.state);
    resetProjectRuntime();
    if(typeof _restoreTopoSession === 'function') _restoreTopoSession();
    store._prefixOpen.clear(); store._netsBad='';
    _invalidateIdx();
    store._history=[]; store._histIdx=-1; _updateHistoryBtns();
    _clearDirty();
    _startAutoMonitor();   // rearm del monitoraggio automatico sul progetto caricato (stop+start idempotente)
    renderRackTabs(); updateTransforms(); renderAll();
    document.title = `InfraNet Pro — ${proj.name}`;
}

// Applica uno stato RIPRISTINATO (snapshot) al progetto CORRENTE, in memoria —
// stessa meccanica di loadProject/undo, ma senza fetch e conservando ciò che NON
// vive nello snapshot: il bgImage corrente (l'immagine di sfondo ha il suo
// «Rimuovi mappa», come per undo) e l'auditLog append-only (la storia
// «chi/quando/cosa» sopravvive al ripristino). Il chiamante persiste con saveProject.
export function applyRestoredState(snapState){
    const bg    = store.state && store.state.bgImage;
    const audit = store.state && store.state.auditLog;
    store.state = _migrateState(snapState);
    resetProjectRuntime();
    store.state.bgImage  = bg;      // non è nello snapshot: tieni quello corrente
    store.state.auditLog = audit;   // journal append-only: non si ripristina
    if(typeof _restoreTopoSession === 'function') _restoreTopoSession();
    store._prefixOpen.clear(); store._netsBad='';
    _invalidateIdx();
    store._history=[]; store._histIdx=-1; _updateHistoryBtns();   // l'undo riparte dallo stato ripristinato
    _startAutoMonitor();
    renderRackTabs(); updateTransforms(); renderAll();
}

export async function switchProject(id) {
    if (store._isDirty) {
        showConfirm(t('pnl.seg.unsavedChanges'),
            async () => { await loadProject(id); await loadProjectList(); },
            () => { document.getElementById('project-select').value = store.currentProjectId; }
        );
    } else {
        await loadProject(id);
        await loadProjectList();
    }
}

async function newProject() {
    showPrompt(t('pnl.seg.newProjectName'), t('pnl.seg.newProjectDefault'), async name => {
        if (!name || !name.trim()) return;
        const defaultState = _buildDefaultState();
        const proj = await apiFetch(API, {
            method:'POST',
            body: JSON.stringify({name: name.trim(), state: defaultState}),
            onResponse: _captureEtag,
        });
        store.currentProjectId = proj.id;
        store.state = _migrateState(proj.state);
        resetProjectRuntime();
        if(typeof _restoreTopoSession === 'function') _restoreTopoSession();
        store._prefixOpen.clear(); store._netsBad='';
        _invalidateIdx();
        store._history=[]; store._histIdx=-1; _updateHistoryBtns();
        _clearDirty();
        await loadProjectList();
        renderRackTabs(); updateTransforms(); renderAll();
        document.title = `InfraNet Pro — ${proj.name}`;
    });
}

async function renameProject() {
    const current = document.getElementById('project-select').selectedOptions[0]?.textContent || '';
    showPrompt(t('pnl.seg.newName'), current, async name => {
        if (!name || !name.trim()) return;
        // ⚠️ Anche la rinomina presenta la versione, e non per simmetria: senza
        // `If-Match` una rinomina RIUSCITA rinfrescherebbe la versione di una
        // sessione rimasta indietro, e il Salva successivo sovrascriverebbe il
        // lavoro altrui senza che nessuno chieda niente — la rinomina farebbe da
        // lavanderia alla guardia. E poiché adesso può fallire, il fallimento si
        // DICE: prima un errore qui non lo vedeva nessuno (la callback rifiutava
        // e basta), e una rinomina che non ha funzionato in silenzio è peggio di
        // una che non c'era.
        try {
            await apiFetch(`${API}/${store.currentProjectId}`, {
                method:'PUT',
                headers: { 'Content-Type':'application/json', ..._ifMatch() },
                body: JSON.stringify({name: name.trim()}),
                onResponse: _captureEtag,   // la rinomina riscrive il file: versione nuova
            });
        } catch (e) {
            showAlert(t('msg.ui.saveFailed', { message: e.message }));
            return;
        }
        await loadProjectList();
        document.title = `InfraNet Pro — ${name.trim()}`;
        if(typeof logAudit === 'function') logAudit('project-rename', { target:name.trim(), summary:current?((typeof t==='function')?t('audit.wasNamed',{name:current}):`era «${current}»`):'' });
    });
}

async function duplicateProject() {
    const current = document.getElementById('project-select').selectedOptions[0]?.textContent || '';
    showPrompt(t('pnl.seg.copyName'), current + t('pnl.seg.copySuffix'), async name => {
        if (!name || !name.trim()) return;
        const proj = await apiFetch(`${API}/${store.currentProjectId}/copy`, {
            method:'POST',
            body: JSON.stringify({name: name.trim()}),
            onResponse: _captureEtag,   // da qui in poi la scheda lavora sulla COPIA
        });
        store.currentProjectId = proj.id;
        store.state = _migrateState(proj.state);
        resetProjectRuntime();
        if(typeof _restoreTopoSession === 'function') _restoreTopoSession();
        _invalidateIdx();
        store._history=[]; store._histIdx=-1; _updateHistoryBtns();
        _clearDirty();
        await loadProjectList();
        renderRackTabs(); updateTransforms(); renderAll();
        document.title = `InfraNet Pro — ${proj.name}`;
    });
}

async function deleteProject() {
    const list = await apiFetch(API);
    if (list.length <= 1) { showAlert(t('msg.ui.cannotDeleteLastProject')); return; }
    const name = document.getElementById('project-select').selectedOptions[0]?.textContent || '';
    showConfirm(t('pnl.seg.deleteProjectConfirm',{name:name}), async () => {
        await apiFetch(`${API}/${store.currentProjectId}`, {method:'DELETE'});
        const remaining = await apiFetch(API);
        store.currentProjectId = remaining[0].id;
        await loadProject(store.currentProjectId);
        await loadProjectList();
    });
}

// opts.quiet: salvataggio SILENZIOSO (autosave) — nessuna animazione «Salvato»,
// nessun alert in caso di errore (il dirty resta e riproverà al prossimo markDirty).
export async function saveProject(opts = {}) {   // ASSE B: importata da app.js (scorciatoia Ctrl+S), non più su window
    if (!store.currentProjectId) return;
    if (store._snmpSyncing) return;
    // ⭐ L'epoca si legge PRIMA di serializzare: da questa riga in poi ciò che
    // l'utente tocca non entra nel corpo che sta per partire, e quindi non è
    // coperto da questo salvataggio. La si ripresenta a `_clearDirty` alla
    // risposta, che spegnerà il pallino solo se nel frattempo non è cambiato
    // niente. Prima il pallino si spegneva sempre, e una modifica fatta durante
    // il salvataggio spariva mentre l'interfaccia diceva «salvato».
    const epoca = dirtyEpoch();
    try {
        await apiFetch(`${API}/${store.currentProjectId}`, {
            method:'PUT',
            headers: { 'Content-Type':'application/json', ..._ifMatch() },
            body: JSON.stringify({state: store.state}),
            onResponse: _captureEtag,
        });
        _clearDirty(epoca);
        // Snapshot completo su Salva MANUALE (non autosave, non ripristino), con throttle:
        // così una raffica di salvataggi non riempie lo storico (l'assottigliamento fa il resto).
        if (!opts.quiet && !opts.noSnapshot) _maybeSnapshotOnSave();
        if (opts.quiet) return;   // autosave: persiste e basta, niente feedback visivo
        const icon  = document.getElementById('save-icon');
        const label = document.getElementById('save-label');
        if (icon)  icon.className  = 'fas fa-check';
        if (label) label.textContent = (typeof t==='function') ? t('save.saved') : ' Salvato ';
        setTimeout(() => {
            if (icon)  icon.className  = 'fas fa-floppy-disk';
            if (label) label.textContent = (typeof t==='function') ? t('save.label') : ' Salva ';
        }, 1800);
    } catch(e) {
        // 409: sul server c'è una versione più recente della nostra. Non è un
        // errore di rete né un guasto — è un'altra persona che ha salvato.
        if (e && e.status === 409) { _progettoSuperato(e, opts); return; }
        // Autosave silenzioso: non rubare lo schermo con un alert; _isDirty resta
        // true (non abbiamo raggiunto _clearDirty) → il prossimo edit riprova.
        if (opts.quiet) { console.warn('[autosave] salvataggio fallito:', e && e.message); return; }
        showAlert(t('msg.ui.saveFailed',{message: e.message}));
    }
}

/**
 * Il documento sul server è cambiato dopo che l'abbiamo aperto.
 * Qui non si decide al posto di nessuno: sovrascrivere perderebbe il lavoro
 * dell'altra sessione, ricaricare perderebbe quello di questa. In entrambi i casi
 * il pallino resta acceso — non abbiamo salvato — finché l'utente non sceglie.
 */
function _progettoSuperato(err, opts) {
    const quando = (err.payload && err.payload.updated_at) || '';
    if (opts.quiet) {
        // Autosave: il pallino sta già dicendo che c'è da salvare, e un modale
        // comparso da solo mentre si lavora è il modo di far spegnere l'autosave.
        console.warn('[autosave] il progetto è cambiato in un\'altra sessione:', quando);
        return;
    }
    showConfirm(t('msg.ui.projectChangedElsewhere', { when: quando }), () => {
        // «Salva lo stesso»: si riparte dalla versione che c'è ADESSO sul server,
        // presa dal corpo del 409. Così la forzatura è una decisione presa su un
        // numero letto un attimo fa, non un salvataggio cieco.
        const attuale = err.payload && err.payload.etag;
        if (attuale) _projectEtag = attuale;
        saveProject(opts);
    });
}

// Throttle degli snapshot su Salva: al massimo uno ogni 10 minuti (best-effort).
let _lastSaveSnapAt = 0;
const _SAVE_SNAP_THROTTLE_MS = 10 * 60 * 1000;
function _maybeSnapshotOnSave(){
    const now = Date.now();
    if(now - _lastSaveSnapAt < _SAVE_SNAP_THROTTLE_MS) return;
    _lastSaveSnapAt = now;
    createSnapshot('', 'save');   // fire-and-forget: non blocca il salvataggio
}

async function _initApp() {
    bindEventsOnce();
    initPaletteUi();
    _updateFloorToolbarVisibility();
    try {
        let list = await apiFetch(API);
        if (list.length === 0) {
            const proj = await apiFetch(API, {
                method:'POST',
                body: JSON.stringify({name:'Demo', state: _buildDefaultState()})
            });
            list = [proj];
        }
        store.currentProjectId = list[0].id;
        if (typeof win.loadPanelSkinStore === 'function') await win.loadPanelSkinStore();
        await loadDeviceTypes();   // import diretto (no win.*): catalogo device-type
        await loadProject(store.currentProjectId);
        await loadProjectList();
    } catch(e) {
        console.warn('Server non disponibile:', e.message);
        _loadDefaultLocal();
        pushHistory();
        renderRackTabs(); updateTransforms(); renderAll();
    }
}

let _modalOk=null, _modalCancel=null;

function _openModal(type, msg, defaultVal) {
    document.getElementById('modal-msg').textContent  = msg;
    const inp    = document.getElementById('modal-input');
    const cancel = document.getElementById('modal-cancel');
    inp.style.display    = type==='prompt'  ? 'block' : 'none';
    cancel.style.display = type!=='alert'   ? 'inline-flex' : 'none';
    if (type==='prompt') { inp.value = defaultVal||''; setTimeout(()=>inp.focus(),60); }
    document.getElementById('modal-overlay').classList.add('open');
}

function modalResolve(ok) {
    const inp = document.getElementById('modal-input');
    document.getElementById('modal-overlay').classList.remove('open');
    const cb = ok ? _modalOk : _modalCancel;
    _modalOk=_modalCancel=null;
    if (cb) cb(ok && inp.style.display!=='none' ? inp.value : ok);
}

export function showAlert(msg,   cb)              { _modalOk=cb||null; _modalCancel=null; _openModal('alert',   msg); }
export function showConfirm(msg, onOk, onCancel)  { _modalOk=onOk||null; _modalCancel=onCancel||null; _openModal('confirm', msg); }
export function showPrompt(msg,  def, onOk, onC)  { _modalOk=onOk||null; _modalCancel=onC||null;      _openModal('prompt',  msg, def); }

expose({
    apiFetch, loadProjectList, loadProject, _initApp, modalResolve,
    showAlert, showConfirm, showPrompt,
});

// ── ASSE B (ritiro onclick inline): superficie BOTTONI PROGETTO della toolbar ──
// newProject/renameProject/duplicateProject/deleteProject/saveProject non sono più
// su window: i bottoni della toolbar le chiamano via `data-act` (event delegation).
// saveProject è anche importata da app.js per la scorciatoia Ctrl+S.
registerClickActions({
    // Coda ASSE B (netmapper.html static): modale generico prompt/confirm (#modal-box).
    'modal-resolve':     (el) => modalResolve(el.dataset.val === '1'),
    'project-new':       () => newProject(),
    'project-rename':    () => renameProject(),
    'project-duplicate': () => duplicateProject(),
    'project-delete':    () => deleteProject(),
    'project-save':      () => saveProject(),
});

// ASSE B — selettore progetto: onchange inline -> data-change (event delegation).
// switchProject esce da expose(): l'elemento porta data-change, la fn legge el.value.
registerChangeActions({
    'project-select': (el) => switchProject(parseInt(el.value)),
});
