// ============================================================
// CORE FRONTEND                       [modulo ESM, ex lib/app-core.js]
// API client, gestione progetti (CRUD + switch), modali, bootstrap _initApp.
// _modalOk/_modalCancel/API restano module-local. Stato app condiviso
// (currentProjectId, _history, _isDirty, state, ...) su window via win.*.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { pushHistory, _invalidateIdx, logAudit } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderRackTabs, updateTransforms } from './app-search-zoom-rack.js';   // ritiro ponte: funzioni rack/zoom/search (ex win.*)

const API = '/api/projects';

async function apiFetch(path, opts={}) {
    const method=(opts.method||'GET').toUpperCase();
    if(store._currentUser?.role==='viewer' && method!=='GET'){
        throw new Error(t('pnl.seg.viewerNotAllowed'));
    }
    try {
        const res = await fetch(path, {
            headers:{'Content-Type':'application/json'},
            ...opts
        });
        if (!res.ok) {
            const err = await res.json().catch(()=>({error:'Server error'}));
            throw new Error(err.error || `HTTP ${res.status}`);
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
    return list;
}

async function loadProject(id) {
    const proj = await apiFetch(`${API}/${id}`);
    store.currentProjectId = proj.id;
    store.state = win._migrateState(proj.state);
    if(typeof win._restoreTopoSession === 'function') win._restoreTopoSession();
    store._vlanIpamOpen.clear();
    _invalidateIdx();
    win._history=[]; win._histIdx=-1; win._updateHistoryBtns();
    win._clearDirty();
    win._stopAutoPoll();
    if(store.state.autoPoll?.enabled) win._startAutoPoll();
    renderRackTabs(); updateTransforms(); renderAll();
    document.title = `InfraNet Pro — ${proj.name}`;
}

async function switchProject(id) {
    if (win._isDirty) {
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
        const defaultState = win._buildDefaultState();
        const proj = await apiFetch(API, {
            method:'POST',
            body: JSON.stringify({name: name.trim(), state: defaultState})
        });
        store.currentProjectId = proj.id;
        store.state = win._migrateState(proj.state);
        if(typeof win._restoreTopoSession === 'function') win._restoreTopoSession();
        store._vlanIpamOpen.clear();
        _invalidateIdx();
        win._history=[]; win._histIdx=-1; win._updateHistoryBtns();
        win._clearDirty();
        await loadProjectList();
        renderRackTabs(); updateTransforms(); renderAll();
        document.title = `InfraNet Pro — ${proj.name}`;
    });
}

async function renameProject() {
    const current = document.getElementById('project-select').selectedOptions[0]?.textContent || '';
    showPrompt(t('pnl.seg.newName'), current, async name => {
        if (!name || !name.trim()) return;
        await apiFetch(`${API}/${store.currentProjectId}`, {
            method:'PUT',
            body: JSON.stringify({name: name.trim()})
        });
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
            body: JSON.stringify({name: name.trim()})
        });
        store.currentProjectId = proj.id;
        store.state = win._migrateState(proj.state);
        if(typeof win._restoreTopoSession === 'function') win._restoreTopoSession();
        _invalidateIdx();
        win._history=[]; win._histIdx=-1; win._updateHistoryBtns();
        win._clearDirty();
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

async function saveProject() {
    if (!store.currentProjectId) return;
    if (store._snmpSyncing) return;
    try {
        await apiFetch(`${API}/${store.currentProjectId}`, {
            method:'PUT',
            body: JSON.stringify({state: store.state})
        });
        win._clearDirty();
        const icon  = document.getElementById('save-icon');
        const label = document.getElementById('save-label');
        if (icon)  icon.className  = 'fas fa-check';
        if (label) label.textContent = (typeof t==='function') ? t('save.saved') : ' Salvato ';
        setTimeout(() => {
            if (icon)  icon.className  = 'fas fa-floppy-disk';
            if (label) label.textContent = (typeof t==='function') ? t('save.label') : ' Salva ';
        }, 1800);
    } catch(e) {
        showAlert(t('msg.ui.saveFailed',{message: e.message}));
    }
}

async function _initApp() {
    win.bindEventsOnce();
    win.initPaletteUi();
    win._updateFloorToolbarVisibility();
    try {
        let list = await apiFetch(API);
        if (list.length === 0) {
            const proj = await apiFetch(API, {
                method:'POST',
                body: JSON.stringify({name:'Demo', state: win._buildDefaultState()})
            });
            list = [proj];
        }
        store.currentProjectId = list[0].id;
        if (typeof win.loadPanelSkinStore === 'function') await win.loadPanelSkinStore();
        await loadProject(store.currentProjectId);
        await loadProjectList();
    } catch(e) {
        console.warn('Server non disponibile:', e.message);
        win._loadDefaultLocal();
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
function showConfirm(msg, onOk, onCancel)  { _modalOk=onOk||null; _modalCancel=onCancel||null; _openModal('confirm', msg); }
function showPrompt(msg,  def, onOk, onC)  { _modalOk=onOk||null; _modalCancel=onC||null;      _openModal('prompt',  msg, def); }

expose({
    apiFetch, loadProjectList, loadProject, switchProject, newProject, renameProject,
    duplicateProject, deleteProject, saveProject, _initApp, modalResolve,
    showAlert, showConfirm, showPrompt,
});
