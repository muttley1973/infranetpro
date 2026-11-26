// ============================================================
// TOLLERANZE DI SALUTE — la tabella di tutti gli apparati (finestra)
// ============================================================
// Si apre dal pannello del progetto («Tabella delle tolleranze»), da una riga di eccezione e dal pannello «Tolleranza» che si apre sulla
// riga che avvisa («Tutti gli apparati…»). Una riga per apparato: la lettura di adesso sta accanto ai numeri, cosi' si regola sapendo
// dove sta ogni apparato. La prima riga e' il progetto; sotto, DUE GRUPPI: «Con tolleranza propria» e «Come il progetto». Il gruppo
// dice quello che prima dicevano un'etichetta e una spunta su ogni riga, e l'azione per piu' apparati sta nell'intestazione del gruppo
// («Imposta per tutti…»). Un numero propria ha il bordo azzurro e il suo ↺ dentro il campo; uno che segue il progetto e' grigio.
// Cerca e filtri bastano anche con 500 apparati.
//
// ── Cosa NON fa, di proposito ──────────────────────────────────────────────────
//   • non scrive le tolleranze da se': lo fanno `applyHealthTolerances` / `clearHealthTolerances` / `setHealthThreshold` di
//     app-health.js, con la regola della libreria (un valore UGUALE a quello del progetto non e' un'eccezione) e UN passo di Annulla;
//   • non inventa una lettura: un apparato senza sensori dice «non pubblica sensori», uno mai letto «non letto»;
//   • non ridisegna tutto a ogni modifica: la riga si aggiorna SUL POSTO (il Tab, la ricerca e lo scorrimento restano). Se la modifica
//     cambia il suo gruppo la riga SI SPOSTA — e' lo stesso elemento, quindi il campo che aveva il fuoco lo riprende.
// La finestra e' in netmapper.html (`#tol-overlay`), le sue regole in styles/07-modals.css.

import { t, getLang } from './_bridge.js';
import { escapeHTML } from './app-util.js';
import { typeName } from './app-types.js';
import { registerClickActions, registerChangeActions, registerInputActions } from './app-delegation.js';
import { healthToleranceRows, applyHealthTolerances, clearHealthTolerances, setHealthThreshold, ensureHealthLoaded, healthRepaint } from './app-health.js';

const _num = (x) => Number(x).toLocaleString(getLang());
const _numS = (x) => Number(x).toLocaleString(getLang(), { maximumFractionDigits: 2 });
const $ = (id) => document.getElementById(id);
// I limiti dei campi: per l'apparato `ifmin` vale da 1 (ogni aumento), per il progetto da 2.
const LIM = { warn: { min: -50, max: 200 }, crit: { min: -50, max: 200 }, ifmin: { min: 1, max: 1000000000 } };
const LIM_PROJECT = { warn: LIM.warn, crit: LIM.crit, ifmin: { min: 2, max: 1000000000 } };
const KEY_LABEL = { warn: 'tol.t.c.warn', crit: 'tol.t.c.crit', ifmin: 'tol.t.c.err' };
const KEYS = ['warn', 'crit', 'ifmin'];

const _st = { q: '', chip: 'all', type: '', focus: null };
let _data = null;   // l'ultimo `healthToleranceRows()`

const _isOpen = () => { const ov = $('tol-overlay'); return !!(ov && ov.classList.contains('open')); };
const _isAlert = (r) => !!((r.temp && (r.temp.severity === 'crit' || r.temp.severity === 'warn')) || (r.ifs && r.ifs.grew > 0));
const _secEl = (kind) => document.querySelector('#tol-body .tol-sec[data-grp="' + kind + '"]');
const _secIds = (sec) => Array.from(sec.querySelectorAll('.tol-row')).map(x => x.dataset.nid);

// ── Valori dei campi ─────────────────────────────────────────────────────────────────────────
function _ownVal(own, key) {
    const v = !own ? null : (key === 'ifmin' ? (own.ifErrors ? own.ifErrors.min : null) : (own.temperature ? own.temperature[key] : null));
    return v === null || v === undefined ? '' : String(v);
}
function _projVal(p, key) {
    const v = key === 'ifmin' ? (p.ifErrors ? p.ifErrors.min : null) : (p.temperature ? p.temperature[key] : null);
    return v === null || v === undefined ? '' : String(v);
}
// «seguono 60 · — · 10»: i numeri del progetto, per chi non ne ha di propri.
function _followText(project) {
    const v = (k) => _projVal(project, k) || '—';
    return t('tol.t.g.follow', { w: v('warn'), c: v('crit'), e: v('ifmin') });
}

// ── Celle ────────────────────────────────────────────────────────────────────────────────────
function _tempCellHtml(r) {
    if (r.temp) {
        const cls = r.temp.severity === 'crit' ? 'tol-c' : (r.temp.severity === 'warn' ? 'tol-w' : 'tol-ok');
        return `<span class="cty-mark cty-measured"></span> <span class="${escapeHTML(cls)}${r.stale ? ' tol-old' : ''}"${r.stale ? ` data-tip="${escapeHTML(t('tol.t.stale'))}"` : ''}>${escapeHTML(_numS(r.temp.value) + (r.temp.unit ? ' ' + r.temp.unit : ''))}</span>`;
    }
    return `<span class="tol-mu">${escapeHTML(r.at === null ? t('tol.t.noRead') : t('tol.t.noSensor'))}</span>`;
}
function _ifCellHtml(r) {
    const s = r.ifs;
    if (!s) return '<span class="tol-mu">—</span>';
    if (s.state === 'not_available') return `<span class="tol-mu">${escapeHTML(t('tol.t.if.na'))}</span>`;
    if (s.grew > 0) return `<span class="tol-w">${escapeHTML(t('tol.t.if.grew', { n: _num(s.grew) }))}</span>`;
    if (s.below > 0) return `<span class="tol-mu">${escapeHTML(t('tol.t.if.below', { n: _num(s.below) }))}</span>`;
    if (s.first) return `<span class="tol-mu">${escapeHTML(t('tol.t.if.first'))}</span>`;
    return `<span class="tol-ok">${escapeHTML(t('tol.t.if.none'))}</span>`;
}
function _inputHtml(cls, key, lim, value, place, act, nid, label) {
    const nd = nid ? ` data-nid="${escapeHTML(nid)}"` : '';
    return `<input type="number" class="${escapeHTML(cls)}" min="${escapeHTML(String(lim.min))}" max="${escapeHTML(String(lim.max))}" step="1" value="${escapeHTML(value)}" placeholder="${escapeHTML(place === '' ? '—' : place)}" data-change="${escapeHTML(act)}"${nd} data-key="${escapeHTML(key)}" aria-label="${escapeHTML(label)}">`;
}
// Un campo di un apparato: il numero, e dentro il suo ↺ (c'e' solo se il numero e' PROPRIO: toglierlo riporta il campo al progetto).
function _fieldHtml(r, project, key) {
    const val = _ownVal(r.own, key), own = val !== '';
    const back = t('tol.t.back');
    return `<span class="tol-fl${own ? ' own' : ''}">${_inputHtml('tol-in', key, LIM[key], val, _projVal(project, key), 'tol-cell', r.id, r.name + ' · ' + t(KEY_LABEL[key]))}<button type="button" class="tol-rs" data-act="tol-reset-field" data-nid="${escapeHTML(r.id)}" data-key="${escapeHTML(key)}" data-tip="${escapeHTML(back)}" aria-label="${escapeHTML(r.name + ' · ' + t(KEY_LABEL[key]) + ' · ' + back)}"${own ? '' : ' hidden'}><i class="fas fa-rotate-left"></i></button></span>`;
}

// ── Righe e gruppi ───────────────────────────────────────────────────────────────────────────
function _rowHtml(r, project) {
    const cells = KEYS.map(k => _fieldHtml(r, project, k));
    const sub = [typeName(r.type), r.ip].filter(Boolean).join(' · ');
    return `<div class="tol-g tol-row" data-nid="${escapeHTML(r.id)}"><div class="tol-nm"><b>${escapeHTML(r.name)}</b><small>${escapeHTML(sub)}</small></div><span class="tol-c-temp">${_tempCellHtml(r)}</span><span class="tol-c-if">${_ifCellHtml(r)}</span>${cells.join('')}</div>`;
}
function _projectRowHtml() {
    const cells = KEYS.map(k => _inputHtml('tol-in', k, LIM_PROJECT[k], _projVal(_data.project, k), '', 'tol-proj', '', t('tol.t.project') + ' · ' + t(KEY_LABEL[k])));
    return `<div class="tol-g tol-pj"><div class="tol-nm"><b>${escapeHTML(t('tol.t.project'))}</b><small>${escapeHTML(t('tol.t.projectSub'))}</small></div><span></span><span></span>${cells.join('')}</div>`;
}
function _headHtml() {
    return `<div class="tol-g tol-th"><span>${escapeHTML(t('tol.t.c.dev'))}</span><span>${escapeHTML(t('tol.t.c.temp'))}</span><span>${escapeHTML(t('tol.t.c.if'))}</span><span class="tol-r">${escapeHTML(t('tol.t.c.warn'))}</span><span class="tol-r">${escapeHTML(t('tol.t.c.crit'))}</span><span class="tol-r">${escapeHTML(t('tol.t.c.err'))}</span></div>`;
}
function _formFieldHtml(key) {
    const lim = LIM[key];
    return `<label class="tol-sfl"><span>${escapeHTML(t(KEY_LABEL[key]))}</span><input type="number" class="tol-in tol-gin" min="${escapeHTML(String(lim.min))}" max="${escapeHTML(String(lim.max))}" step="1" placeholder="—" data-key="${escapeHTML(key)}"></label>`;
}
// Il modulo «Imposta per tutti…»: nascosto finche' non lo si apre dall'intestazione. Scrive SOLO i campi riempiti.
function _formHtml(kind, n) {
    const fields = KEYS.map(k => _formFieldHtml(k));
    return `<div class="tol-sform" hidden><b>${escapeHTML(t('tol.t.set'))}</b>${fields.join('')}<button type="button" class="toolbar-btn primary" data-act="tol-grp-apply" data-grp="${escapeHTML(kind)}">${escapeHTML(t('tol.t.applyN', { n: _num(n) }))}</button><button type="button" class="toolbar-btn" data-act="tol-grp-cancel" data-grp="${escapeHTML(kind)}">${escapeHTML(t('tol.t.cancel'))}</button></div>`;
}
function _followHtml() {
    return `<span class="tol-sf" data-tol-follow>${escapeHTML(_followText(_data.project))}</span>`;
}
function _backAllHtml(n) {
    return `<button type="button" class="tol-sl" data-act="tol-grp-back" data-grp="own" data-tol-needs${n ? '' : ' hidden'}>${escapeHTML(t('tol.t.g.backAll'))}</button>`;
}
function _groupHtml(kind, devs) {
    const n = devs.length;
    const items = devs.map(r => _rowHtml(r, _data.project));
    const follow = kind === 'proj' ? _followHtml() : '';
    const back = kind === 'own' ? _backAllHtml(n) : '';
    return `<section class="tol-sec" data-grp="${escapeHTML(kind)}"><div class="tol-sh"><i class="tol-sdot${kind === 'own' ? '' : ' q'}"></i><b>${escapeHTML(t('tol.t.g.' + kind))}</b><span class="tol-sn" data-tol-n>${escapeHTML(t('tol.t.g.n', { n: _num(n) }))}</span>${follow}<span class="tol-sls"><button type="button" class="tol-sl" data-act="tol-grp-set" data-grp="${escapeHTML(kind)}" data-tol-needs${n ? '' : ' hidden'}>${escapeHTML(t('tol.t.g.setAll', { n: _num(n) }))}</button>${back}</span></div>${_formHtml(kind, n)}<div class="tol-sempty"${n ? ' hidden' : ''}>${escapeHTML(t('tol.t.g.empty.' + kind))}</div><div class="tol-srows">${items.join('')}</div></section>`;
}

// ── Filtri ───────────────────────────────────────────────────────────────────────────────────
function _match(r) {
    if (_st.type && r.type !== _st.type) return false;
    if (_st.q && !r.name.toLowerCase().includes(_st.q) && !String(r.ip).toLowerCase().includes(_st.q)) return false;
    if (_st.chip === 'own') return !!r.own;
    if (_st.chip === 'alert') return _isAlert(r);
    if (_st.chip === 'unread') return r.at === null;
    return true;
}
function _chipsHtml(devs) {
    const n = { all: devs.length, own: devs.filter(r => r.own).length, alert: devs.filter(_isAlert).length, unread: devs.filter(r => r.at === null).length };
    const chunks = ['all', 'own', 'alert', 'unread'].map(k => `<button type="button" class="tol-chip${_st.chip === k ? ' on' : ''}" data-act="tol-chip" data-chip="${escapeHTML(k)}" aria-pressed="${_st.chip === k ? 'true' : 'false'}">${escapeHTML(t('tol.t.' + k))}<i>${escapeHTML(_num(n[k]))}</i></button>`);
    return chunks.join('');
}
function _typeOptionsHtml(devs) {
    const kinds = [...new Set(devs.map(r => r.type).filter(Boolean))].sort((a, b) => typeName(a).localeCompare(typeName(b), getLang()));
    const opts = kinds.map(k => `<option value="${escapeHTML(k)}"${_st.type === k ? ' selected' : ''}>${escapeHTML(typeName(k))}</option>`);
    return `<option value="">${escapeHTML(t('tol.t.allTypes'))}</option>${opts.join('')}`;
}

// ── Disegno ──────────────────────────────────────────────────────────────────────────────────
function _renderSub() {
    const el = $('tol-sub');
    if (!el || !_data) return;
    const devs = _data.rows, o = devs.filter(r => r.own).length;
    const at = devs.reduce((m, r) => (r.at !== null && r.at > m ? r.at : m), 0);
    el.textContent = at ? t('tol.t.sub', { n: _num(devs.length), o: _num(o), when: new Date(at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }) }) : t('tol.t.subNoRead', { n: _num(devs.length), o: _num(o) });
}
function _renderTools() {
    const devs = _data.rows;
    const chips = $('tol-chips'); if (chips) chips.innerHTML = _chipsHtml(devs);
    const sel = $('tol-type'); if (sel) sel.innerHTML = _typeOptionsHtml(devs);
    _renderSub();
}
function _renderBody() {
    const el = $('tol-body');
    if (!el || !_data) return;
    if (!_data.rows.length) { el.innerHTML = `<div class="tol-empty">${escapeHTML(t('tol.t.noDevices'))}</div>`; return; }
    const shown = _data.rows.filter(_match);
    const groups = shown.length ? `${_groupHtml('own', shown.filter(r => r.own))}${_groupHtml('proj', shown.filter(r => !r.own))}` : `<div class="tol-empty">${escapeHTML(t('tol.t.empty'))}</div>`;
    el.innerHTML = `${_headHtml()}${_projectRowHtml()}${groups}`;
    if (_st.focus) {
        const row = Array.from(el.querySelectorAll('.tol-row')).find(x => x.dataset.nid === _st.focus);
        if (row) { row.classList.add('focus'); if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' }); _st.focus = null; }
    }
}
function _renderAll() {
    _data = healthToleranceRows();
    _renderTools();
    _renderBody();
}
// Dopo una modifica i conti dei gruppi si rileggono dalle righe che CI SONO (non dai dati): sono quelle mostrate dai filtri.
function _renderGroups() {
    if (!_data) return;
    for (const kind of ['own', 'proj']) {
        const sec = _secEl(kind);
        if (!sec) continue;
        const n = sec.querySelectorAll('.tol-row').length;
        const cnt = sec.querySelector('[data-tol-n]'); if (cnt) cnt.textContent = t('tol.t.g.n', { n: _num(n) });
        const em = sec.querySelector('.tol-sempty'); if (em) em.hidden = n > 0;
        for (const b of sec.querySelectorAll('[data-tol-needs]')) b.hidden = n === 0;
        const setb = sec.querySelector('[data-act="tol-grp-set"]'); if (setb) setb.textContent = t('tol.t.g.setAll', { n: _num(n) });
        const ap = sec.querySelector('[data-act="tol-grp-apply"]'); if (ap) ap.textContent = t('tol.t.applyN', { n: _num(n) });
        const form = sec.querySelector('.tol-sform'); if (form && n === 0) form.hidden = true;
        const fo = sec.querySelector('[data-tol-follow]'); if (fo) fo.textContent = _followText(_data.project);
    }
}

// Dopo una modifica: si aggiornano SUL POSTO le celle di lettura, i campi (propri o no, e il ↺) e i segnaposto (il numero in grigio e'
// quello del progetto, e cambia se cambia il progetto). Un campo che ha il fuoco non si tocca, tranne quello appena scritto.
function _patchRow(el, r, project) {
    const set = (sel, html) => { const c = el.querySelector(sel); if (c) c.innerHTML = html; };
    set('.tol-c-temp', _tempCellHtml(r));
    set('.tol-c-if', _ifCellHtml(r));
    for (const w of el.querySelectorAll('.tol-fl')) {
        const inp = w.querySelector('input.tol-in');
        if (!inp) continue;
        const k = inp.dataset.key, own = _ownVal(r.own, k) !== '';
        w.classList.toggle('own', own);
        const rs = w.querySelector('.tol-rs'); if (rs) rs.hidden = !own;
        inp.placeholder = _projVal(project, k) === '' ? '—' : _projVal(project, k);
        if (document.activeElement !== inp) inp.value = _ownVal(r.own, k);
    }
}
// Se la modifica cambia il gruppo dell'apparato, la riga si sposta nell'altro (al suo posto, in ordine). E' lo STESSO elemento.
function _placeRow(el, r, order) {
    const kind = r.own ? 'own' : 'proj';
    const from = el.closest('.tol-sec'), dest = _secEl(kind);
    if (!from || !dest || from === dest) return false;
    const box = dest.querySelector('.tol-srows');
    const at = order.get(r.id);
    const next = Array.from(box.children).find(x => order.get(x.dataset.nid) > at) || null;
    box.insertBefore(el, next);
    return true;
}
function _patchAll(justEdited) {
    const act = document.activeElement;
    _data = healthToleranceRows();
    const byId = new Map(_data.rows.map(r => [r.id, r]));
    const order = new Map(_data.rows.map((r, i) => [r.id, i]));
    const body = $('tol-body');
    if (!body) return;
    let moved = null;
    for (const el of body.querySelectorAll('.tol-row')) {
        const r = byId.get(el.dataset.nid);
        if (!r) continue;
        _patchRow(el, r, _data.project);
        if (_placeRow(el, r, order)) moved = el;
    }
    const pj = body.querySelector('.tol-pj');
    if (pj) for (const inp of pj.querySelectorAll('input.tol-in')) if (document.activeElement !== inp) inp.value = _projVal(_data.project, inp.dataset.key);
    if (justEdited && justEdited.classList && justEdited.classList.contains('tol-in')) {
        const row = justEdited.closest('.tol-row'), k = justEdited.dataset.key;
        if (row) { const r = byId.get(row.dataset.nid); if (r) justEdited.value = _ownVal(r.own, k); }
        else justEdited.value = _projVal(_data.project, k);   // un campo di un apparato che non esiste piu' e' gia' sparito; qui e' la riga del progetto
    }
    _renderGroups();
    _renderTools();
    if (moved) {
        // spostare un elemento gli toglie il fuoco: chi stava scrivendo (o passava col Tab) lo ritrova dov'era
        if (act && act !== document.body && typeof act.focus === 'function' && document.body.contains(act) && document.activeElement !== act) act.focus({ preventScroll: true });
        if (typeof moved.scrollIntoView === 'function') moved.scrollIntoView({ block: 'nearest' });
    }
}

// ── Apertura e chiusura ──────────────────────────────────────────────────────────────────────
export function openTolerances(nodeId) {
    const ov = $('tol-overlay');
    if (!ov) return;
    _st.q = ''; _st.chip = 'all'; _st.type = ''; _st.focus = nodeId || null;
    const q = $('tol-q'); if (q) q.value = '';
    ov.classList.add('open');
    _renderAll();
    const had = _data.rows.length > 0;
    // i dati possono arrivare dopo (la lettura si carica al primo bisogno): solo allora si ridisegna una seconda volta
    ensureHealthLoaded().then(() => { if (_isOpen() && !had) _renderAll(); });
}
export function closeTolerances() {
    const ov = $('tol-overlay');
    if (!ov || !ov.classList.contains('open')) return;
    ov.classList.remove('open');
    healthRepaint();   // il pannello del progetto e la scheda dell'apparato mostrano cio' che e' cambiato
}

// ── Azioni ───────────────────────────────────────────────────────────────────────────────────
// Il modulo «Imposta per tutti…» di UN gruppo: se ne apre uno alla volta.
function _openForm(kind) {
    const mine = _secEl(kind), f = mine && mine.querySelector('.tol-sform');
    const wasOpen = !!(f && !f.hidden);
    for (const sec of document.querySelectorAll('#tol-body .tol-sec')) {
        const other = sec.querySelector('.tol-sform');
        if (other) other.hidden = true;
    }
    if (!f || wasOpen) return;   // un secondo clic sullo stesso bottone lo richiude
    f.hidden = false;
    const first = f.querySelector('input');
    if (first) first.focus();
}
registerClickActions({
    'tol-open': (el) => openTolerances(el.dataset.nid || null),
    'tol-close': () => closeTolerances(),
    'tol-backdrop': (el, ev) => { if (ev.target === el) closeTolerances(); },
    'tol-chip': (el) => { _st.chip = el.dataset.chip || 'all'; _renderTools(); _renderBody(); },
    // il ↺ dentro un campo: svuota QUEL campo dell'apparato (torna al progetto), gli altri restano
    'tol-reset-field': (el) => { applyHealthTolerances('node', [el.dataset.nid], { [el.dataset.key]: '' }); _patchAll(); },
    'tol-grp-set': (el) => _openForm(el.dataset.grp),
    'tol-grp-cancel': (el) => {
        const sec = _secEl(el.dataset.grp), f = sec && sec.querySelector('.tol-sform');
        if (!f) return;
        f.hidden = true;
        for (const inp of f.querySelectorAll('.tol-gin')) inp.value = '';   // annullare = non resta niente di scritto per la prossima volta
    },
    // «Applica a N»: i campi RIEMPITI, per tutti gli apparati del gruppo; vuoto = non si tocca
    'tol-grp-apply': (el) => {
        const sec = _secEl(el.dataset.grp);
        if (!sec) return;
        const fields = {};
        for (const inp of sec.querySelectorAll('.tol-gin')) if (inp.value.trim() !== '') fields[inp.dataset.key] = inp.value;
        if (!Object.keys(fields).length) return;
        const ids = _secIds(sec);
        if (ids.length) applyHealthTolerances('node', ids, fields);
        for (const inp of sec.querySelectorAll('.tol-gin')) inp.value = '';
        const f = sec.querySelector('.tol-sform'); if (f) f.hidden = true;
        _patchAll();
    },
    // «Tutti tornano al progetto»: nel gruppo delle eccezioni, tutte le righe mostrate
    'tol-grp-back': (el) => {
        const sec = _secEl(el.dataset.grp);
        if (!sec) return;
        clearHealthTolerances(_secIds(sec));
        _patchAll();
    },
});
registerChangeActions({
    // un campo di UN apparato: la regola e' della libreria (un valore uguale a quello del progetto non e' un'eccezione)
    'tol-cell': (el) => { applyHealthTolerances('node', [el.dataset.nid], { [el.dataset.key]: el.value }); _patchAll(el); },
    // un campo del PROGETTO: cambia anche il segnaposto di tutte le righe
    'tol-proj': (el) => { setHealthThreshold(el.dataset.key, el.value); _patchAll(el); },
    'tol-type': (el) => { _st.type = el.value || ''; _renderBody(); },
});
registerInputActions({
    // la ricerca nasconde le righe SENZA ridisegnare le caselle di testo: il campo non perde il fuoco
    'tol-search': (el) => { _st.q = String(el.value || '').trim().toLowerCase(); _renderBody(); },
});

// Solo per i test.
export function _tolerancesReset() { _data = null; _st.q = ''; _st.chip = 'all'; _st.type = ''; _st.focus = null; }
