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

// Quante voci di giornale si disegnano in una volta. Non è un tetto sui DATI
// (quello è AUDIT_CAP_DEFAULT, in lib/audit-log.js, ed è 10.000): è quanto ne
// entra in una lista che resta scorrevole. Chi cerca più indietro usa il filtro
// o il CSV.
const _AUDIT_VIEW_MAX = 500;

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
    // ⚠️ Il giornale arriva fino ad AUDIT_CAP_DEFAULT (10.000): disegnarlo tutto
    // vorrebbe dire 10.000 righe in un solo innerHTML. Si mostra la finestra più
    // recente e si dice quante ne restano — il filtro qui sopra continua a
    // cercare su TUTTO il giornale, e il CSV lo esporta intero.
    const shown = rows.slice(0, _AUDIT_VIEW_MAX);
    const capped = rows.length > shown.length
        ? `<div class="drift-empty">${escapeHTML(_tA('audit.capped','', { n: shown.length, tot: rows.length }))}</div>`
        : '';
    box.innerHTML = capped + shown.map(e => {
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
// ⚠️ «Divergenze» ha UNA definizione e vive nel Drift Report. Questa riga ne
// teneva una seconda: ci metteva il rumore endpoint e lasciava fuori gli
// apparati ASSENTI, i cavi fantasma e i cambi IP — cioè poteva dire «nessuna
// divergenza» con venti apparati mancanti. Misurata sulle 183 righe di timeline
// di questa macchina: ZERO casi, era latente. Allineata prima che smetta di esserlo.
function _tlPrimary(c){
    if(typeof driftActionable === 'function') return driftActionable(c);
    c = c || {}; return (c.undocumented|0) + (c.stateDrift|0) + (c.identityDrift|0);
}

// ── La TENDENZA in testa alla scheda (Principio di design ③) ─────────
// Un elenco di fotografie non dice se stai migliorando: lo dice la lettura
// d'insieme. Il giudizio sta tutto in lib/verify-trend.js (puro, con le sue
// prove); qui c'è solo la resa.
//
// DUE FORME, perché sono DUE domande:
//   · la BARRA dice «dove sono»: com'è composta l'ultima Verifica. È la sola
//     che mostra la differenza fra «l'ho guardato e non torna» e «non l'ho
//     guardato» — il cuore di questo pannello, che in un numero non si vede.
//   · le SPARKLINE dicono «dove vado»: la FORMA della serie. Un «da → a» butta
//     via tutto quello che sta in mezzo, e «migliora o è ferma» è esattamente
//     una domanda sulla forma.
//
// ⚠️ Due segnali distinti, e non vanno fusi: la FRECCIA dice dove va il numero,
// la PAROLA se è un bene. Su metà di queste serie scendere è un bene, e un
// segnale solo diceva «cresce» su una cecità SCESA — cioè il contrario.
// ⚠️ COLORE. Si usano i token di STATO del prodotto (--active-color,
// --idle-color, --inactive-color), non un verde e un ambra nuovi: gli stessi
// concetti hanno già un colore in questa app, e dargliene un secondo qui
// sarebbe una seconda grammatica visiva per le stesse cose. Quei token hanno
// anche la loro variante per il tema chiaro, dove il contrasto sulla superficie
// passa (misurato ≥3:1; il `var(--ok,#3fb950)` usato altrove sta a 2,1:1).
// ⚠️ Il validatore di palette dà i due colori portanti a ΔE 3,8-5,6 per un
// occhio protanope/deuteranope: sotto la soglia in cui il colore può bastare da
// solo. Per questo OGNI segmento della barra porta il suo NUMERO e la sua
// parola: la barra si legge senza percepire un colore. È la stessa regola per
// cui uno stato, in questo prodotto, non è mai solo una pastiglia colorata.
// ⚠️ Niente stile in linea (due cancelli del progetto l'hanno bocciato, e
// avevano ragione): corpi e colori stanno in 09-user-theme.css sui token.
// ⚠️ Se il motore non è caricato la scheda resta quella di prima: una funzione
// assente non deve togliere l'elenco a chi lo stava guardando.
const _TL_VERD = { migliora:'storia.tl.better', peggiora:'storia.tl.worse', stagna:'storia.tl.flat', 'non-confrontabile':'storia.tl.noCompare' };
const _TL_CLS = { migliora:'better', peggiora:'worse', stagna:'flat', 'non-confrontabile':'none' };
const _TL_ARROW = { su:'↗', giu:'↘', fermo:'→' };
function _tlVerdLabel(v){ return _tA(_TL_VERD[v] || 'storia.tl.noCompare', String(v || '')); }
function _tlPctFmt(v){ return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
function _tlNumFmt(v){ return v == null ? '—' : String(v); }
function _tlWhy(p){
    const k = 'storia.tl.why.' + (p && p.code);
    const s = _tA(k, '', p || {});
    return (s && s !== k) ? s : '';
}

// Sparkline: la FORMA di una serie breve, senza assi né griglia — a questa
// dimensione un asse è rumore, e il valore esatto sta già nella colonna accanto.
// Linea di 2px, ultimo punto marcato: è il «adesso», e l'occhio lo cerca lì.
// Eredita il colore dalla riga (currentColor), quindi porta il MERITO, non la
// direzione. Meno di due punti: niente disegno, perché una tendenza non c'è.
const _TL_SPARK_W = 112, _TL_SPARK_H = 20, _TL_SPARK_MAX = 32;
function _tlSparkline(serie){
    let v = (serie || []).filter(x => x != null);
    if(v.length < 2) return '';
    // ⚠️ Oltre un punto ogni ~3 px la linea diventa un pelo e la FORMA sparisce,
    // che è l'unica cosa per cui la sparkline esiste. È successo al primo giro sul
    // progetto vero, passato a 87 campioni. Si assottiglia a passo costante
    // TENENDO PRIMO E ULTIMO: sono gli stessi due che il verdetto confronta, e un
    // disegno che finisse su un punto diverso da quello del giudizio racconterebbe
    // un'altra storia.
    if(v.length > _TL_SPARK_MAX){
        const passo = (v.length - 1) / (_TL_SPARK_MAX - 1);
        const giu = [];
        for(let i = 0; i < _TL_SPARK_MAX; i++) giu.push(v[Math.round(i * passo)]);
        giu[giu.length - 1] = v[v.length - 1];
        v = giu;
    }
    const min = Math.min(...v), max = Math.max(...v), amp = (max - min) || 1;
    const dx = _TL_SPARK_W / (v.length - 1);
    const y = (x) => (_TL_SPARK_H - 2) - ((x - min) / amp) * (_TL_SPARK_H - 4);
    const punti = v.map((x, i) => (i * dx).toFixed(1) + ',' + y(x).toFixed(1)).join(' ');
    const ux = ((v.length - 1) * dx).toFixed(1), uy = y(v[v.length - 1]).toFixed(1);
    return '<svg class="tl-spark" viewBox="0 0 ' + escapeHTML(String(_TL_SPARK_W)) + ' '
        + escapeHTML(String(_TL_SPARK_H)) + '" width="' + escapeHTML(String(_TL_SPARK_W))
        + '" height="' + escapeHTML(String(_TL_SPARK_H)) + '" aria-hidden="true" focusable="false">'
        + '<polyline points="' + escapeHTML(punti) + '"></polyline>'
        + '<circle cx="' + escapeHTML(ux) + '" cy="' + escapeHTML(uy) + '" r="2"></circle></svg>';
}

// Barra di proporzione: l'ultima Verifica, in tre parti che sommano al parco.
// Ogni segmento porta il suo numero: il colore non è mai l'unico portatore.
function _tlBarra(u){
    if(!u || !u.parti || !u.parti.totale) return '';
    const p = u.parti;
    const seg = (cls, n, chiave, fallback) => {
        if(!n) return '';
        const q = (n / p.totale) * 100;
        return '<span class="tl-seg ' + escapeHTML(cls) + '" style="flex:' + escapeHTML(q.toFixed(2)) + '"'
            + ' title="' + escapeHTML(_tA(chiave, fallback) + ': ' + n) + '"></span>';
    };
    const voce = (cls, n, chiave, fallback) => n
        ? '<span class="tl-key"><i class="tl-dot ' + escapeHTML(cls) + '"></i>'
          + escapeHTML(String(n)) + ' ' + escapeHTML(_tA(chiave, fallback)) + '</span>'
        : '';
    return '<div class="tl-bar">'
        + seg('ok', p.confermati, 'storia.tl.partConfirmed', 'coerenti')
        + seg('bad', p.misurati, 'storia.tl.partMeasured', 'disallineati')
        + seg('unk', p.nonVisti, 'storia.tl.partUnseen', 'non guardati')
        + '</div><div class="tl-keys">'
        + voce('ok', p.confermati, 'storia.tl.partConfirmed', 'coerenti')
        + voce('bad', p.misurati, 'storia.tl.partMeasured', 'disallineati')
        + voce('unk', p.nonVisti, 'storia.tl.partUnseen', 'non guardati')
        + '</div>';
}

// ⚠️ «divergenze», non «coda»: è la parola che questa stessa scheda usa tre righe
// più sotto per ogni Verifica («{n} divergenze»), ed è lo STESSO numero da quando
// _tlPrimary chiama driftActionable. Due parole per un numero solo, a tre righe di
// distanza, e infatti la prima persona che l'ha letto ha dovuto chiedere cosa
// fosse. (Nel motore il campo resta "coda" e i codici pure: sono identificatori,
// non testo che qualcuno legge.)
function _tlSerieRow(nome, s, fmt, tip){
    const punti = (s.serie || []).filter(x => x != null);
    const val = punti.length ? (fmt(punti[0]) + ' → ' + fmt(punti[punti.length - 1])) : '—';
    return '<div class="tl-row ' + escapeHTML(_TL_CLS[s.verdetto] || 'none') + '"'
        + (tip ? ' title="' + escapeHTML(tip) + '"' : '') + '>'
        + '<span class="tl-arrow">' + escapeHTML(_TL_ARROW[s.verso] || '·') + '</span>'
        + '<span class="tl-name">' + escapeHTML(nome) + '</span>'
        + _tlSparkline(s.serie)
        + '<span class="tl-val">' + escapeHTML(val) + '</span>'
        + '<span class="tl-verd">' + escapeHTML(_tlVerdLabel(s.verdetto)) + '</span>'
        + '</div>';
}

function _tlTrendHtml(rows){
    if(typeof trendVerifiche !== 'function') return '';
    let t; try{ t = trendVerifiche(rows); }catch(_){ return ''; }
    if(!t || !t.campioni) return '';
    const modo = _tA(t.strumento === 'auto' ? 'storia.tl.modeAuto' : 'storia.tl.modeManual', String(t.strumento || ''));
    const righe = _tlSerieRow(_tA('storia.tl.presence','apparati coerenti'), t.presenza, _tlPctFmt)
        + _tlSerieRow(_tA('storia.tl.blind','apparati non verificabili'), t.cecita, _tlPctFmt)
        + _tlSerieRow(_tA('storia.tl.ports','porte coerenti'), t.porte, _tlPctFmt)
        + _tlSerieRow(_tA('storia.tl.queue','disallineamenti aperti'), t.coda, _tlNumFmt,
            _tA('storia.tl.queueTip', ''));
    const perche = (t.perche || []).map(_tlWhy).filter(Boolean)
        .map(s => '<div class="tl-why">' + escapeHTML(s) + '</div>').join('');
    return '<div class="tl-trend">'
        + '<div class="tl-head ' + escapeHTML(_TL_CLS[t.verdetto] || 'none') + '">'
        + '<strong class="tl-verdetto">' + escapeHTML(_tlVerdLabel(t.verdetto)) + '</strong>'
        + '<span class="tl-samples">'
        + escapeHTML(_tA('storia.tl.samples','{n} Verifiche confrontabili · {mode}', { n: t.campioni, mode: modo })) + '</span>'
        + '</div>' + _tlBarra(t.ultima) + righe + perche + '</div>';
}


async function _renderTimelineTab(){
    const box = document.getElementById('storia-body'); if(!box) return;
    box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('common.loading','Carico…'))}</div>`;
    const rows = await fetchTimeline(500);
    if(_activeTab !== 'timeline') return;
    if(!rows.length){ box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('storia.tlEmpty','Nessuna verifica registrata. La linea del tempo parte dalla prossima Verifica.'))}</div>`; return; }
    const testa = _tlTrendHtml(rows);
    box.innerHTML = testa + rows.slice().reverse().map(e => {
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
// Avviso inline DENTRO il pannello «Storia» (il toast, alzato sopra i modali, resta
// complementare): conferma del punto creato / ripristino, visibile senza uscire dal modale.
function _snapNotice(n){
    if(!n || !n.msg) return '';
    const ok = n.type !== 'err';
    const col = ok ? '#3fb950' : '#f85149';
    return `<div style="margin:0 0 10px;padding:8px 12px;border-radius:8px;font-size:.85rem;display:flex;align-items:center;gap:8px;background:${ok?'rgba(63,185,80,.14)':'rgba(248,81,73,.14)'};border:1px solid ${col};color:var(--text-main,#e6edf3)"><i class="fas ${ok?'fa-circle-check':'fa-circle-exclamation'}" style="color:${col}"></i> ${escapeHTML(n.msg)}</div>`;
}
async function _renderSnapshotsTab(notice){
    const box = document.getElementById('storia-body'); if(!box) return;
    box.innerHTML = `<div class="drift-empty">${escapeHTML(_tA('common.loading','Carico…'))}</div>`;
    const rows = await fetchSnapshots();
    if(_activeTab !== 'snapshots') return;
    const head = `${_snapNotice(notice)}<div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
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
    'snap-create':  () => createManualPoint((rec) => { if(_activeTab === 'snapshots') _renderSnapshotsTab(rec ? { type:'ok', msg: t('snap.pointCreated') } : { type:'err', msg: t('snap.pointFailed') }); }),
    'snap-restore': (el) => { const at = el.dataset.at; restoreSnapshot(el.dataset.sid, { at }, (ok) => { if(_activeTab === 'snapshots') _renderSnapshotsTab(ok ? { type:'ok', msg: t('snap.restoreDone', { when: at }) } : { type:'err', msg: t('snap.restoreFailed') }); }); },
});
registerInputActions({
    'audit-filter': (el) => setAuditFilter(el.value),
});

// Voce "Storia" del menu Report (apre il pannello «Storia»; le schede Verifiche/Ripristino
// sono lì dentro). L'entry point era anche nel popover Automazioni: rimosso su richiesta.
registerClickActions({
    'report-audit': () => { openAuditLog(); closeReportMenu(); },
});
