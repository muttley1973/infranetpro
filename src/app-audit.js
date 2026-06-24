// ============================================================
// AUDIT TRAIL — UI "Storia modifiche" (N2)   [modulo ESM, ex lib/app-audit.js]
// ============================================================
// Pannello che mostra il journal append-only state.auditLog (popolato da
// logAudit, vedi app.js) e ne consente filtro ed export CSV. La logica di
// formattazione/filtro/CSV vive nel modulo puro lib/audit-log.js.
// Riusa le classi overlay .drift-* (generiche modal/head/body).
//
// PRIMO modulo migrato a ESM (esbuild). Dipendenze (tutte dal ponte — i18n e
// audit-log sono lib <script>: NON importarli da ../lib o esbuild li ri-bundla,
// vedi _bridge.js):
//   • dal ponte:      t, getLang (i18n) · auditToCsv, auditActionLabel,
//                     ACTION_LABELS (audit-log)
//   • legacy (win.*): state, nodeById, getNodeDisplayName, escapeHTML  (app.js)
import { expose, t, getLang, auditToCsv, auditActionLabel, ACTION_LABELS } from './_bridge.js';   // (win non più necessario: stato via store)
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { nodeById, getNodeDisplayName } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)

let _auditFilter = '';

function openAuditLog(){ _auditFilter = ''; _renderAuditLog(); }
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
                '<button class="toolbar-btn" onclick="_closeAuditLog()" data-tip="' + _tA('common.close','Chiudi') + '"><i class="fas fa-times"></i></button></div>' +
              '<div class="audit-toolbar">' +
                '<input id="audit-filter" type="text" oninput="setAuditFilter(this.value)">' +
                '<button id="audit-export" class="toolbar-btn soft" onclick="exportAuditCsv()"><i class="fas fa-file-csv"></i> <span id="audit-export-lbl"></span></button>' +
              '</div>' +
              '<div class="drift-body"><div id="audit-list"></div></div>' +
            '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeAuditLog(); });
    }
    return ov;
}

// t() ora è importato e garantito: niente più guardia/fallback "senza i18n".
function _tA(key, fallback, vars){ return t(key, vars); }

// Etichetta azione tradotta (audit.act.<action>), con fallback al modulo puro.
function _auditActLabel(action){
    if(ACTION_LABELS && ACTION_LABELS[action]) return t('audit.act.' + action);
    return auditActionLabel(action) || (action || '');
}

// Aggiorna i testi statici del pannello (titolo/placeholder/export): rifatti a
// ogni apertura cosi' seguono un eventuale cambio lingua (shell creata una volta).
function _auditRefreshChrome(){
    const ti = document.getElementById('audit-title'); if(ti) ti.textContent = _tA('audit.title','Storia modifiche');
    const fi = document.getElementById('audit-filter'); if(fi) fi.placeholder = _tA('audit.filter','Filtra per dispositivo, utente o azione…');
    const ex = document.getElementById('audit-export'); if(ex) ex.setAttribute('data-tip', _tA('audit.exportTip','Scarica la storia in CSV'));
    const el = document.getElementById('audit-export-lbl'); if(el) el.textContent = _tA('audit.exportCsv','Esporta CSV');
}

function setAuditFilter(v){ _auditFilter = String(v || ''); _renderAuditList(); }

// Apre la "Storia" già filtrata su un dispositivo (usato dal pannello device).
function openAuditForNode(nodeId){
    const n = nodeById(nodeId);
    _renderAuditLog();
    const f = document.getElementById('audit-filter');
    const name = n ? (getNodeDisplayName(n) || n.name || n.id) : '';
    if(f && name){ f.value = name; setAuditFilter(name); }
}

const _AUDIT_ICONS = {
    'device-add':'fa-plus', 'device-remove':'fa-trash', 'device-rename':'fa-pen',
    'cable-add':'fa-link', 'cable-remove':'fa-link-slash', 'vlan-change':'fa-tag',
    'snmp-sync':'fa-network-wired', 'drift-apply':'fa-arrows-rotate',
    'project-create':'fa-folder-plus', 'project-rename':'fa-folder',
};

function _renderAuditLog(){
    const ov = _auditEnsureOverlay();
    ov.style.display = 'flex';
    _auditRefreshChrome();
    _renderAuditList();
}

function _renderAuditList(){
    const box = document.getElementById('audit-list');
    if(!box) return;
    const log = Array.isArray(store.state.auditLog) ? store.state.auditLog : [];
    const locale = getLang();
    const sysLbl = _tA('audit.system','sistema');
    const q = _auditFilter.trim().toLowerCase();
    // Riga ricercabile nella lingua corrente (azione tradotta + target/summary/utente).
    const _searchable = e => [_auditActLabel(e.action), e.target, e.summary, e.user].filter(Boolean).join(' ').toLowerCase();
    const rows = log.slice().reverse().filter(e => !q || _searchable(e).includes(q));   // newest-first
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

// Bridge legacy: pubblica l'API pubblica su window per gli handler inline
// dell'overlay (_closeAuditLog/setAuditFilter/exportAuditCsv) e per i chiamanti
// ancora-classic (openAuditLog dal menu, openAuditForNode dal pannello device).
expose({ openAuditLog, openAuditForNode, _closeAuditLog, setAuditFilter, exportAuditCsv });
