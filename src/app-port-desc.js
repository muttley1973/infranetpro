// ============================================================
// DESCRIZIONI DI PORTA — report (tabella + CSV)            [modulo ESM]
// ============================================================
// Quante porte portano una descrizione, quante nel formato «presa | testo», e se
// la presa nominata ESISTE nel progetto (lib/port-descriptions.js: il perché del
// formato, e cosa NON dice).
//
// Perché un REPORT e non una riga della Panoramica: la Panoramica ha un
// contratto di layout (sei riquadri per colonna, ognuno col suo verdetto) e la
// convenzione è FACOLTATIVA — «0 di 330» non è una lacuna del documento. Gli altri
// strumenti (LibreNMS, Observium, NetBox) tengono la descrizione dove sta la
// porta: in una TABELLA di porte, non in un indicatore di salute. Si apre come gli
// altri report assorbiti nella Dashboard: dal pulsante in fondo al dettaglio di
// una riga (qui «Cavi», che sono le porte che qualcuno ha attaccato a qualcosa).
//
// Sola lettura, manual-first: legge le STESSE porte del report «Porte libere»
// (`_spareBuildDevices`) e non scrive niente sugli apparati. L'adozione del testo letto NON sta
// qui: avviene da sola a ogni lettura SNMP (src/app-snmp.js, `adoptedDescription`), e il report la
// mostra soltanto — una descrizione uguale all'alias letto ha come origine «misurato».
// L'UNICA cosa che il report salva è il separatore, perché è una DICHIARAZIONE del progetto
// (`state.portDescSeparator`): il formato lo sceglie chi scrive le descrizioni,
// non lo indovina l'app.
//
// Il confronto dice se la presa esiste, non se è quella GIUSTA per quella porta
// (serve la catena porta → bretella → pannello → tratta → presa). Una presa nel
// progetto è: una presa a muro col suo nome, o la porta di un patch panel nel suo
// nome «pannello-numero» (col numero che il frontale mostra, offset compresi).
import { t } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML } from './app-util.js';
import { registerClickActions, registerChangeActions } from './app-delegation.js';
import { markDirty, getNodeDisplayName, getWallPortLabel } from './app.js';
import { portNumLabel } from './app-ports.js';
import { TYPES } from './app-types.js';
import { portDescriptionCensus } from '../lib/port-descriptions.js';
import { _spareBuildDevices } from './app-spare.js';

let _report = null;   // ultimo censimento calcolato (per l'export)
let _colW = null;     // larghezze scelte (px) per le colonne, in questa sessione; null = quelle di default

// Applica le larghezze scelte alla tabella (e le toglie quando si ripristina). Le colonne
// sono variabili CSS, non stili sulle celle: una sola riga da cambiare per tutte le righe.
function _applyCols() {
    const tb = document.querySelector('#portdesc-overlay .pd-table');
    if (!tb) return;
    if (_colW) { tb.style.setProperty('--pd-cols', _colW.map((w) => w + 'px').join(' ')); tb.classList.add('is-custom'); }
    else { tb.style.removeProperty('--pd-cols'); tb.classList.remove('is-custom'); }
}

// Trascinare il bordo di una colonna la ridimensiona. Alla prima presa si congelano le larghezze
// ATTUALI di tutte le colonne (quelle di default sono elastiche): da lì cambia solo quella che si
// trascina, e la tabella scorre in orizzontale se la somma supera la finestra.
function _onResizeStart(e) {
    const h = e.target.closest && e.target.closest('.pd-rs');
    if (!h) return;
    e.preventDefault();
    const cells = [...h.closest('.pd-row-head').children];
    const i = cells.indexOf(h.parentElement);
    if (!_colW) _colW = cells.map((c) => Math.round(c.getBoundingClientRect().width));
    const startX = e.clientX, startW = _colW[i];
    const move = (ev) => { _colW[i] = Math.max(48, Math.round(startW + ev.clientX - startX)); _applyCols(); };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
}

// Il separatore dichiarato dal progetto; assente = il predefinito `|`.
function _separator() {
    const s = store.state.portDescSeparator;
    return (typeof s === 'string' && s.trim()) ? s.trim() : '|';
}

// Le prese che il PROGETTO documenta, come nomi (la chiave la fa la lib: una sola definizione).
function _knownJacks() {
    const out = [];
    for (const n of (store.state.nodes || [])) {
        if (!n) continue;
        if (n.type === 'wallport') {
            const label = getWallPortLabel(n);
            if (label) out.push({ label, where: getNodeDisplayName(n) || n.id });
        } else if (n.type === 'patchpanel') {
            const name = n.name || getNodeDisplayName(n);
            if (!name) continue;
            const count = (n.ports !== undefined) ? n.ports : ((TYPES.patchpanel || {}).ports || 0);
            for (let i = 1; i <= count; i++) {
                const pid = n.id + '-' + i;
                if ((store.state.ports[pid] || {}).hidden) continue;   // una porta nascosta non è una presa
                out.push({ label: name + '-' + portNumLabel(pid), where: getNodeDisplayName(n) || name });
            }
        }
    }
    return out;
}

function _compute() {
    _report = portDescriptionCensus(_spareBuildDevices(), { separator: _separator(), jacks: _knownJacks() });
    return _report;
}

function _ensureOverlay() {
    let ov = document.getElementById('portdesc-overlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'portdesc-overlay';
        ov.className = 'drift-overlay';   // riusa il guscio modale del Drift, come Porte libere e L3
        ov.innerHTML = `<div class="drift-modal"><div class="drift-head"><span><i class="fas fa-tag"></i> <span id="portdesc-title">${escapeHTML(t('report.portDescTitle'))}</span></span><button class="toolbar-btn" data-act="portdesc-close" data-tip="${escapeHTML(t('common.close'))}"><i class="fas fa-times"></i></button></div><div class="drift-body" id="portdesc-body"></div></div>`;
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) _close(); });
        // Il trascinamento non passa dalla delegation (non ha un `click`): ascoltatori sul guscio, locali al modulo.
        ov.addEventListener('pointerdown', _onResizeStart);
        ov.addEventListener('dblclick', (e) => { if (e.target.closest && e.target.closest('.pd-rs')) { _colW = null; _applyCols(); } });
    }
    return ov;
}
function _close() { const ov = document.getElementById('portdesc-overlay'); if (ov) ov.style.display = 'none'; }

// Da dove viene il testo, nelle parole della notazione unica dove esistono già:
// «dichiarato» (scritto da una persona) e «misurato» (letto dall'apparato).
const _srcLabel = (s) => t(s === 'declared' ? 'ov.prov.declared' : 'ov.prov.measured');
// L'esito del confronto, in parole. Vuoto = non valutabile, o la porta non nomina una presa.
const _jackLabel = (st) => (st ? t('pd.st.' + st) : '');

function openPortDescReport() {
    const rep = _compute();
    const sep = _separator();
    const ov = _ensureOverlay();
    ov.style.display = 'flex';
    const esc = (s) => escapeHTML(String(s == null ? '' : s));
    const ttl = document.getElementById('portdesc-title'); if (ttl) ttl.textContent = t('report.portDescTitle');

    // Il confronto compare solo se ha senso: con il progetto senza prese documentate si dice
    // che NON si può fare, invece di scrivere «sconosciute» su tutte.
    let jackLine = '';
    if (rep.inFormat) {
        jackLine = rep.jackEvaluable
            ? ` · ${t('pd.jackSummary', { k: rep.jackKnown, u: rep.jackUnknown, a: rep.jackAmbiguous })}`
            : ` · <span data-tip="${esc(t('pd.jackNotEvaluableTip'))}">${t('pd.jackNotEvaluable')}</span>`;
    }
    const header = `<div class="spare-summary">
        <div class="spare-summary-hdr">
            <div class="spare-summary-big">${t('pd.summary', { f: `<b>${esc(rep.inFormat)}</b>`, d: rep.described, p: rep.ports, sep: esc(sep) })}</div>
            <label class="pd-sep" data-tip="${esc(t('pd.sepTip'))}">${t('pd.sepLabel')} <input type="text" id="portdesc-sep" maxlength="3" value="${esc(sep)}" data-change="portdesc-sep"></label>
            <button class="toolbar-btn" data-act="portdesc-export" data-tip="${esc(t('pd.csvTip'))}"><i class="fas fa-file-csv"></i> CSV</button>
        </div>
        <div class="spare-summary-sub">${t('pd.sub', { a: rep.declared, m: rep.measured })}${rep.generated ? ` · <span data-tip="${esc(t('pd.generatedTip'))}">${t('pd.generated', { n: rep.generated })}</span>` : ''}${jackLine}</div>
    </div>`;

    let body;
    if (!rep.ports) {
        body = `<div class="drift-empty">${t('pd.noPorts')}</div>`;
    } else if (!rep.described) {
        body = `<div class="drift-empty">${t('pd.empty')}</div>`;
    } else {
        // Prima ciò che si guarda (il censimento le ordina): le fuori formato, poi le prese sconosciute o ambigue.
        // Una maniglia sul bordo destro di ogni colonna tranne l'ultima: trascina = ridimensiona, doppio clic = ripristina.
        const rs = `<i class="pd-rs" title="${esc(t('pd.resizeTip'))}"></i>`;
        const head = `<div class="pd-row pd-row-head"><span>${t('pd.colDevice')}${rs}</span><span>${t('pd.colPort')}${rs}</span><span>${t('pd.colText')}${rs}</span><span>${t('pd.colJack')}${rs}</span><span title="${esc(t('pd.inDocTip'))}">${t('pd.colInDoc')}${rs}</span><span>${t('pd.colSource')}</span></div>`;
        const rows = rep.items.map((it) => {
            const st = it.jackState;
            const tip = st === 'known' ? it.jackWhere : (st ? t('pd.jack' + st.charAt(0).toUpperCase() + st.slice(1) + 'Tip') : '');
            // Una riga si APRE con un clic: il testo va a capo e si legge intero (nelle celle è tagliato a una riga).
            return `<div class="pd-row${it.inFormat ? '' : ' is-off'}" data-act="portdesc-row" role="button" aria-expanded="false" title="${esc(t('pd.rowTip'))}">
            <span class="pd-dev" title="${esc(it.rack ? it.rack + ' · ' + it.device : it.device)}">${esc(it.device)}</span>
            <span class="pd-port" title="${esc(it.port)}">${esc(it.port)}</span>
            <span class="pd-text" title="${esc(it.text)}">${esc(it.text)}</span>
            <span class="pd-jack">${it.inFormat ? esc(it.jack) : `<span class="pd-none" data-tip="${esc(t('pd.offFormatTip', { sep }))}">—</span>`}</span>
            <span class="pd-st${st === 'unknown' || st === 'ambiguous' ? ' pd-st-look' : ''}"${tip ? ` title="${esc(tip)}"` : ''}>${st ? esc(_jackLabel(st)) : '<span class="pd-none">—</span>'}</span>
            <span class="pd-src">${esc(_srcLabel(it.source))}</span>
        </div>`;
        }).join('');
        body = `<div class="pd-table${_colW ? ' is-custom' : ''}"${_colW ? ` style="--pd-cols:${esc(_colW.map((w) => w + 'px').join(' '))}"` : ''}>${head}${rows}</div>`;
    }
    document.getElementById('portdesc-body').innerHTML = header + body;
}

// ── Export CSV ────────────────────────────────────────────────────────
// Intestazioni nella lingua: un CSV si apre in Excel e lo legge una persona. Il testo
// va com'è, senza tagliarlo: la lunghezza che l'apparato ha concesso è un dato.
// L'esito del confronto è vuoto quando non c'è niente da confrontare (fuori formato, o
// progetto senza prese documentate): una cella vuota dice «non valutabile», mai «no».
function portDescExportCsv() {
    const rep = _report || _compute();
    const rows = [t('pd.csv.cols').split(';')];
    for (const it of rep.items) {
        rows.push([it.rack, it.device, it.port, it.text, _srcLabel(it.source), it.inFormat ? it.jack : '',
            it.inFormat ? it.note : '', t(it.inFormat ? 'pd.yes' : 'pd.no'), _jackLabel(it.jackState), it.jackWhere]);
    }
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `descrizioni-porte-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Il separatore è una DICHIARAZIONE del progetto: si salva con lui (markDirty). Vuoto o `|` =
// il predefinito, e il campo sparisce dal progetto invece di portarsi dietro un valore uguale.
function _setSeparator(el) {
    const v = String(el.value || '').trim();
    const cur = store.state.portDescSeparator;
    if (!v || v === '|') { if (cur !== undefined) { delete store.state.portDescSeparator; markDirty(); } }
    else if (v !== cur) { store.state.portDescSeparator = v; markDirty(); }
    openPortDescReport();
}

// Event delegation (ASSE B): niente handler inline. `overview-portdesc-report` è il
// pulsante in fondo al dettaglio della riga «Cavi» (_REPORT_CTA in app-overview.js).
registerClickActions({
    'portdesc-close': () => _close(),
    'portdesc-export': () => portDescExportCsv(),
    'overview-portdesc-report': () => openPortDescReport(),
    // Apre/chiude una riga: la classe fa andare a capo il testo (v. stili `.pd-row.is-open`).
    'portdesc-row': (el) => {
        const open = !el.classList.contains('is-open');
        el.classList.toggle('is-open', open);
        el.setAttribute('aria-expanded', String(open));
    },
});
registerChangeActions({
    'portdesc-sep': (el) => _setSeparator(el),
});
