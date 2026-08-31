// ============================================================
// SNAPSHOT RIPRISTINABILI — logica client (Fase 4)
// ============================================================
// Crea/legge/ripristina le "fotografie complete" dello stato (gzip lato server,
// FUORI dal JSON di progetto). Nessun DOM del pannello qui: la UI vive in
// app-audit.js (pannello «Storia», scheda Ripristina), che importa queste funzioni.
//
// Il RESTORE riusa la meccanica esistente: applyRestoredState (app-core, gemella di
// loadProject/undo) + saveProject. Prima di ogni ripristino crea un pre-restore
// automatico (rete di sicurezza). "Rileva, non adotta" non c'entra: qui è un gesto
// umano esplicito, con conferma.
import { store } from './store.js';
import { t } from './_bridge.js';
import { applyRestoredState, saveProject, showConfirm } from './app-core.js';
import { logAudit, markDirty, _showToast } from './app.js';

const _histBase = () => `/api/projects/${store.currentProjectId}/history`;

// Payload snapshot = stato corrente SENZA bgImage e auditLog (come pushHistory):
// il bgImage vive nell'asset sidecar (ha il suo «Rimuovi mappa»), l'auditLog è
// append-only e sopravvive al ripristino. Shallow clone: l'originale non si tocca.
function _snapPayloadState(){
    const s = Object.assign({}, store.state);
    delete s.bgImage;
    delete s.auditLog;
    return s;
}

// Crea uno snapshot col motivo dato. Best-effort: ritorna il record o null.
export async function createSnapshot(label, reason){
    if(!store.currentProjectId) return null;
    try {
        const r = await fetch(`${_histBase()}/snapshots`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ label: label||'', reason: reason||'manual', state: _snapPayloadState() }),
        });
        if(!r.ok) return null;
        const d = await r.json();
        return (d && d.snapshot) || null;
    } catch(_){ return null; }
}

export async function fetchSnapshots(){
    if(!store.currentProjectId) return [];
    try { const r = await fetch(`${_histBase()}/snapshots`); if(!r.ok) return []; const d = await r.json(); return (d && d.snapshots) || []; }
    catch(_){ return []; }
}

export async function fetchTimeline(limit){
    if(!store.currentProjectId) return [];
    try { const r = await fetch(`${_histBase()}/timeline${limit?`?limit=${limit}`:''}`); if(!r.ok) return []; const d = await r.json(); return (d && d.entries) || []; }
    catch(_){ return []; }
}

// Crea un "punto" on-demand (senza etichetta → soggetto ad assottigliamento).
// Toast (visibile anche sopra i modali) + onDone(rec) per l'avviso inline nel pannello.
export async function createManualPoint(onDone){
    const rec = await createSnapshot('', 'on-demand');
    if(_showToast) _showToast(rec ? t('snap.pointCreated') : t('snap.pointFailed'), rec ? 'ok' : 'err');
    if(typeof onDone === 'function') onDone(rec);
    return rec;
}

// Ripristina uno snapshot: conferma → crea un pre-restore del corrente → carica lo
// snapshot → persiste. onDone() rinfresca il pannello.
export function restoreSnapshot(sid, meta, onDone){
    if(!sid || !store.currentProjectId) return;
    const when = (meta && meta.at) ? meta.at : '';
    showConfirm(t('snap.restoreConfirm', { when }), async () => {
        try {
            await createSnapshot('', 'pre-restore');   // rete di sicurezza: com'era PRIMA
            const r = await fetch(`${_histBase()}/snapshots/${encodeURIComponent(sid)}`);
            const d = r.ok ? await r.json() : null;
            if(!d || !d.state){ if(_showToast) _showToast(t('snap.restoreFailed'), 'err'); if(typeof onDone === 'function') onDone(false); return; }
            applyRestoredState(d.state);
            if(typeof logAudit === 'function') logAudit('restore', { summary: t('snap.restoredSummary', { when }) });
            markDirty();
            await saveProject({ noSnapshot: true });   // niente snapshot 'save': il pre-restore l'abbiamo già fatto
            if(_showToast) _showToast(t('snap.restoreDone', { when }), 'ok');
            if(typeof onDone === 'function') onDone(true);
        } catch(_){
            if(_showToast) _showToast(t('snap.restoreFailed'), 'err');
            if(typeof onDone === 'function') onDone(false);
        }
    });
}
