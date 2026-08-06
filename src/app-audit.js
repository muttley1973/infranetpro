// ============================================================
// STORIA — pannello unificato (audit + storico ripristinabile)  [ESM]
// ============================================================
// Overlay a schede che raccoglie la "storia" del progetto in un solo posto:
//   • Modifiche  — il journal append-only state.auditLog (N2), con filtro + CSV
//   • Verifiche  — la timeline leggera (una riga per Verifica, Fase 3)
//   • Ripristino — le fotografie complete ripristinabili (Fase 4)
// Espande il vecchio overlay «Storia modifiche» (stessa shell .drift-*, stessa
// voce nel menu Report, stessa event-delegation) invece di aprire un pannello
// nuovo: audit e snapshot sono la stessa "storia" per l'utente, dati diversi.
//
// La logica dati/azioni degli snapshot vive in app-snapshots.js (create/restore/
// fetch); qui solo il DOM del pannello.
import { expose, t, getLang, auditToCsv, auditActionLabel, ACTION_LABELS } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML } from './app-util.js';
import { nodeById, getNodeDisplayName } from './app.js';
import { registerClickActions, registerInputActions } from './app-delegation.js';
import { closeReportMenu } from './app-auth.js';
import { fetchTimeline, fetchSnapshots, restoreSnapshot, createManualPoint } from './app-snapshots.js';

let _auditFilter = '';
let _activeTab = 'audit';   // 'audit' | 'timeline' | 'snapshots'

function openAuditLog(tab){ _auditFilter = ''; _activeTab = (tab === 'timeline' || tab === 'snapshots') ? tab : 'audit'; _renderStoria(); }
function _closeAuditLog(){ const ov = document.getElementById('audit-overlay'); if(ov) ov.style.display = 'none'; }

function _auditEnsureOverlay(){
    let ov = document.getElementById('audit-overlay');
    if(!ov){
        ov = document.createElement('div');
        ov.id = 'audit-overlay';
        ov.className = 'drift-overlay';
        ov.innerHTML =
            '<div class="drift-modal">' +
              '<div class="drift-head"><span><i class="fas fa-clock-rotate-left"></i> <span id="audit-title"></span></span>' +
                '<button class="toolbar-btn" data-act="audit-close" data-tip="' + _tA('common.close','Chiudi') + '"><i class="fas fa-times"></i></button></div>' +
              '<div class="storia-tabs" style="display:flex;gap:6px;padding:8px 12px 0">' +
                '<button class="toolbar-btn" data-act="storia-tab" data-tab="audit" id="storia-tab-audit"></button>' +
                '<button class="toolbar-btn" data-act="storia-tab" data-tab="timeline" id="storia-tab-timeline"></button>' +
                '<button class="toolbar-btn" data-act="storia-tab" data-tab="snapshots" id="storia-tab-snapshots"></button>' +
              '</div>' +
              '<div class="audit-toolbar" id="audit-toolbar">' +
                '<input id="audit-filter" type="text" data-input="audit-filter">' +
                '<button id="audit-export" class="toolbar-btn soft" data-act="audit-export"><i class="fas fa-file-csv"></i> <span id="audit-export-lbl"></span></button>' +
              '</div>' +
              '<div class="drift-body"><div id="storia-body"></div></div>' +
            '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeAuditLog(); });
    }
    return ov;
}

function _tA(key, fallback, vars){ return t(key, vars); }

function _auditActLabel(action){
    if(ACTION_LABELS && ACTION_LABELS[action]) return t('audit.act.' + action);
    return auditActionLabel(action) || (action || '');
}

// Chrome statico (titolo/tab/placeholder/export): rifatto a ogni apertura così segue la lingua.
function _auditRefreshChrome(){
    const ti = document.getElementById('audit-title'); if(ti) ti.textContent = _tA('storia.title','Storia');
    const ta = document.getElementById('storia-tab-audit');     if(ta) ta.innerHTML = '<i class="fas fa-pen-clip"></i> ' + escapeHTML(_tA('storia.tabChanges','Modifiche'));
    const tt = document.getElementById('storia-tab-timeline');  if(tt) tt.innerHTML = '<i class="fas fa-wave-square"></i> ' + escapeHTML(_tA('storia.tabTimeline','Verifiche'));
    const ts = document.getElementById('storia-tab-snapshots'); if(ts) ts.innerHTML = '<i class="fas fa-camera-retro"></i> ' + escapeHTML(_tA('storia.tabSnapshots','Ripristino'));
    const fi = document.getElementById('audit-filter'); if(fi) fi.placeholder = _tA('audit.filter','Filtra per dispositivo, utente o azione…');
    const ex = document.getElementById('audit-export'); if(ex) ex.setAttribute('data-tip', _tA('audit.exportTip','Scarica la storia in CSV'));
    const el = document.getElementById('audit-export-lbl'); if(el) el.textContent = _tA('audit.exportCsv','Esporta CSV');
}

function setAuditFilter(v){ _auditFilter = String(v || ''); if(_activeTab === 'audit') _renderAuditList(); }

function openAuditForNode(nodeId){
    const n = nodeById(nodeId);
    _activeTab = 'audit';
    _renderStoria();
    const f = document.getElementById('audit-filter');
    const name = n ? (getNodeDisplayName(n) || n.name || n.id) : '';
    if(f && name){ f.value = name; setAuditFilter(name); }
}

const _AUDIT_ICONS = {
    'device-add':'fa-plus', 'device-remove':'fa-trash', 'device-rename':'fa-pen',
    'cable-add':'fa-link', 'cable-remove':'fa-link-slash', 'vlan-change':'fa-tag',
    'snmp-sync':'fa-network-wired', 'drift-apply':'fa-arrows-rotate', 'restore':'fa-clock-rotate-left',
    'project-create':'fa-folder-plus', 'project-rename':'fa-folder',
};

// ── Shell + routing schede ───────────────────────────────────────────
function _renderStoria(){
    const ov = _auditEnsureOverlay();
    ov.style.display = 'flex';
    _auditRefreshChrome();
    _setActiveTabUi();
    _renderActiveTab();
}
function _setActiveTabUi(){
    ['audit','timeline','snapshots'].forEach(tab=>{
        const b = document.getElementById('storia-tab-' + tab);
        if(b) b.classList.toggle('primary', tab === _activeTab);
    });
    const tb = document.getElementById('audit-toolbar');
    if(tb) tb.style.display = (_activeTab === 'audit') ? '' : 'none';   // filtro/CSV solo per Modifiche
}
function _setTab(tab){
    _activeTab = (tab === 'timeline' || tab === 'snapshots') ? tab : 'audit';
    _setActiveTabUi();
    _renderActiveTab();
}
function _renderActiveTab(){
    if(_activeTab === 'timeline')      _renderTimelineTab();
    else if(_activeTab === 'snapshots') _renderSnapshotsTab();
    else _renderAuditList();
}

function _fmtWhen(at){
    if(!at) return '';
    try { return new Date(String(at).replace(' ', 'T')).toLocaleString(getLang()); } catch(_){ return String(at); }
}

// ── Scheda MODIFICHE (audit journal) ─────────────────────────────────
function _renderAuditList(){
    const box = document.getElementById('storia-body');
    if(!box) return;
    const log = Array.isArray(store.state.auditLog) ? store.state.auditLog : [];
    const locale = getLang();
    const sysLbl = _tA('audit.system','sistema');
    const q = _auditFilter.trim().toLowerCase();
    const _searchable = e => [_auditActLabel(e.action), e.target, e.summary, e.user].filter(Boolean).join(' ').toLowerCase();
    const rows = log.slice().reverse().filter(e => !q || _searchable(e).includes(q));
    if(!log.length){ box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('audit.empty','Nessuna modifica registrata. La storia parte da ora.'))}</div>`; return; }
    if(!rows.length){ box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('audit.noResults','Nessun risultato per il filtro.'))}</div>`; return; }
    box.innerHTML = rows.map(e => {
        let when = e.ts; try { when = new Date(e.ts).toLocaleString(locale); } catch(_){}
        const ic = _AUDIT_ICONS[e.action] || 'fa-circle';
        const tgt = e.target ? ` <b>«${escapeHTML(e.target)}»</b>` : '';
        const sum = e.summary ? ` <span class="audit-sum">${escapeHTML(e.summary)}</span>` : '';
        return `<div class="audit-row">
            <i class="fas ${ic} audit-ic"></i>
            <div class="audit-main"><span class="audit-act">${escapeHTML(_auditActLabel(e.action))}</span>${tgt}${sum}
              <div class="audit-meta">${escapeHTML(when)} · ${escapeHTML(e.user || sysLbl)}</div></div>
        </div>`;
    }).join('');
}

// ── Scheda VERIFICHE (timeline leggera, Fase 3) ──────────────────────
function _tlPrimary(c){ c = c || {}; return (c.undocumented|0) + (c.undocumentedEndpoint|0) + (c.stateDrift|0) + (c.identityDrift|0); }
async function _renderTimelineTab(){
    const box = document.getElementById('storia-body'); if(!box) return;
    box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('common.loading','Carico…'))}</div>`;
    const rows = await fetchTimeline(500);
    if(_activeTab !== 'timeline') return;
    if(!rows.length){ box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('storia.tlEmpty','Nessuna verifica registrata. La linea del tempo parte dalla prossima Verifica.'))}</div>`; return; }
    box.innerHTML = rows.slice().reverse().map(e => {
        const p = _tlPrimary(e.counts);
        const chg = p > 0
            ? `<span class="audit-sum" style="color:var(--warn,#d29922)">${escapeHTML(_tA('storia.tlChanges','{n} divergenze',{n:p}))}</span>`
            : `<span class="audit-sum" style="color:var(--ok,#3fb950)">${escapeHTML(_tA('storia.tlClean','nessuna divergenza'))}</span>`;
        const vic = e.verify === 'auto' ? 'fa-robot' : 'fa-user';
        const tot = e.totals || {};
        return `<div class="audit-row">
            <i class="fas ${vic} audit-ic"></i>
            <div class="audit-main"><span class="audit-act">${escapeHTML(_fmtWhen(e.at))}</span> ${chg}
              <div class="audit-meta">${escapeHTML(e.by || '')} · ${escapeHTML(_tA('storia.tlSize','{n} nodi · {c} cavi',{n:tot.nodes||0,c:tot.cables||0}))}</div></div>
        </div>`;
    }).join('');
}

// ── Scheda RIPRISTINO (snapshot completi, Fase 4) ────────────────────
const _SNAP_REASONS = ['on-demand','pre-restore','save','manual','daily','pre-import','pre-adopt','pre-delete'];
function _reasonLabel(r){ return _SNAP_REASONS.includes(r) ? _tA('storia.reason.' + r) : (r || '—'); }
async function _renderSnapshotsTab(){
    const box = document.getElementById('storia-body'); if(!box) return;
    box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('common.loading','Carico…'))}</div>`;
    const rows = await fetchSnapshots();
    if(_activeTab !== 'snapshots') return;
    const head = `<div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="toolbar-btn primary" data-act="snap-create"><i class="fas fa-camera"></i> ${escapeHTML(_tA('storia.snapCreate','Crea punto di ripristino'))}</button>
        <span class="autom-desc" style="margin:0">${escapeHTML(_tA('storia.snapHint','Le fotografie vivono fuori dal file di progetto. Ripristinare crea prima un punto di sicurezza.'))}</span></div>`;
    if(!rows.length){ box.innerHTML = head + `<div class="drift-empty">${escapeHTML(_tA('storia.snapEmpty','Nessuna fotografia salvata. Crea un punto, oppure ne nasce uno prima delle operazioni rischiose.'))}</div>`; return; }
    const list = rows.slice().reverse().map(m => {
        const kb = Math.max(1, Math.round((m.sizeGz || 0) / 1024));
        const badge = m.label
            ? `<span class="vm-dev-role src">${escapeHTML(m.label)}</span>`
            : `<span class="vm-dev-role cap">${escapeHTML(_reasonLabel(m.reason))}</span>`;
        return `<div class="audit-row" style="display:flex;align-items:center">
            <i class="fas fa-camera audit-ic"></i>
            <div class="audit-main" style="flex:1"><span class="audit-act">${escapeHTML(_fmtWhen(m.at))}</span> ${badge}
              <div class="audit-meta">${escapeHTML(m.by || '')} · ${kb} KB</div></div>
            <button class="toolbar-btn" style="margin-left:auto" data-act="snap-restore" data-sid="${escapeHTML(m.id)}" data-at="${escapeHTML(m.at || '')}"><i class="fas fa-rotate-left"></i> ${escapeHTML(_tA('storia.restore','Ripristina'))}</button>
        </div>`;
    }).join('');
    box.innerHTML = head + list;
}

function exportAuditCsv(){
    const csv = auditToCsv(store.state.auditLog || []);
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const pname = (document.getElementById('project-select') && document.getElementById('project-select').selectedOptions[0] && document.getElementById('project-select').selectedOptions[0].textContent) || 'progetto';
    a.href = url;
    a.download = `storia-${String(pname).trim().replace(/[^\w.-]+/g,'_')}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

expose({ openAuditForNode });

// ── Event delegation ─────────────────────────────────────────────────
registerClickActions({
    'audit-close':  () => _closeAuditLog(),
    'audit-export': () => exportAuditCsv(),
    'storia-tab':   (el) => _setTab(el.dataset.tab),
    'snap-create':  () => createManualPoint(() => { if(_activeTab === 'snapshots') _renderSnapshotsTab(); }),
    'snap-restore': (el) => restoreSnapshot(el.dataset.sid, { at: el.dataset.at }, () => { if(_activeTab === 'snapshots') _renderSnapshotsTab(); }),
});
registerInputActions({
    'audit-filter': (el) => setAuditFilter(el.value),
});

// Voce "Storia" del menu Report + bottone "Storico/ripristina…" del popover Automazioni.
registerClickActions({
    'report-audit': () => { openAuditLog(); closeReportMenu(); },
    'history-open': () => openAuditLog('snapshots'),
});
