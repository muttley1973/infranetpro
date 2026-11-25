// ============================================================
// SALUTE DEGLI APPARATI — interfacce e sensori: la lettura a ogni Sync, il sidecar, e le schede nel pannello dell'apparato
// ============================================================
// Ogni Sync, dopo la lettura principale, chiede a ogni apparato di rete che ha risposto lo stato e i contatori di
// errori/scarti/FCS di TUTTE le sue interfacce (`/api/poll-health`, un passo a parte). La lettura si manda al sidecar
// `history/<id>/health.json` e, confrontata con quella di prima, dice quanti errori sono arrivati nell'intervallo.
//
// ── Cosa NON fa, di proposito ──────────────────────────────────────────────────
//   • non scrive NIENTE nel documento (nessun campo nuovo, niente nello stato del client): la salute e' una misura, sta
//     fuori dal progetto come presenza e osservazioni. Quindi non pesa su salvataggio, snapshot, export, Annulla;
//   • non inventa soglie: un'interfaccia e' «in aumento» se un contatore e' SALITO fra le due letture, e basta;
//   • non conclude dove l'apparato tace: una colonna non pubblicata e' «non letta», mai zero; un apparato che non
//     pubblica nessun contatore dice «non si sa», non «niente errori»;
//   • non mostra un tasso al secondo: a distanza di ore non e' misurato, e' una media. Dice «N fra la lettura A e B».
// Nella STESSA lettura arrivano anche i SENSORI ambientali (temperatura, ventole, alimentatori, tensioni): standard
// prima, MIB del fornitore solo come ripiego. Un sensore assente non lascia nessuna riga («non disponibile», mai zero);
// la gravita' viene dall'apparato (il suo stato, i suoi limiti) e solo dove l'apparato tace da una soglia che l'UTENTE ha
// scritto nel progetto — marcata `user_default`, mai presentata come dato dell'apparato. Le soglie sono l'UNICA cosa di
// questo modulo che sta nel documento (`state.healthThresholds`: una dichiarazione, poche righe).
// La parte pura (colonne, scala, fusione, differenze, gravita') sta in lib/health-store.js; qui c'e' la chiamata e il disegno.
// Solo amministratori, come ogni rotta SNMP e come lo storico.
//
// Modulo quasi-FOGLIA: non importa app-properties.js (il pannello importa lui questo) e da app.js prende solo `markDirty` e
// `pushHistory` per scrivere le soglie, a runtime. Per ridisegnare il pannello a lettura arrivata si registra una funzione
// da fuori (`setHealthRepaint`).

import { t, getLang } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML, postJsonWithDeadline } from './app-util.js';
import { hasSnmpTarget, snmpTargetHost } from '../lib/snmp-target.js';
import { snmpReadBudgetMs } from '../lib/auto-monitor.js';
import { scaleDuration } from '../lib/port-live.js';
import { markDirty, pushHistory } from './app.js';   // solo per scrivere le soglie dell'utente (a runtime)
import { registerChangeActions } from './app-delegation.js';
import { healthReading, healthFold, healthDecodeFile, healthSummarizeIf, healthIfProvenance, healthSummarizeSensors, healthSanitizeThresholds, HEALTH_IF_COUNTERS } from '../lib/health-store.js';

const READ_URL = '/api/poll-health';
// Gli apparati di rete: sono quelli che hanno interfacce di cui l'amministratore risponde. Server e NAS hanno le
// loro (e gli errori di una scheda contano) ma il pannello e il Drift nascono per l'infrastruttura.
const HEALTH_IF_TYPES = ['switch', 'router', 'firewall', 'sdwan'];
const BATCH = 5;                 // come la lettura principale: quanti apparati insieme
const STALE_MS = 6 * 3600 * 1000;   // come `SNMP_STALE_HOURS`: una lettura piu' vecchia non e' lo stato di adesso
const LIST_MAX = 12;             // quante interfacce elencare nella scheda (le altre in una riga)
const SENSORS_MAX = 40;          // quanti sensori elencare nella scheda

let _pid = null;                 // il progetto a cui si riferisce quanto sta in memoria
let _file = null;                // il file com'e' sul server (tuple), o quello fuso in locale
let _decoded = null;             // _file aperto, ricalcolato solo quando _file cambia
let _loading = null;             // GET in volo
let _retryAt = 0;                // dopo un fallimento (es. non admin) non si richiede subito
let _repaint = null;

const _isViewer = () => !!(store._currentUser && store._currentUser.role === 'viewer');
const _eligible = (n) => !!n && HEALTH_IF_TYPES.includes(n.type) && hasSnmpTarget(n);

export function setHealthRepaint(fn) { _repaint = typeof fn === 'function' ? fn : null; }

// La memoria vale per UN progetto: se e' cambiato si riparte da zero.
function _sync() {
    if (_pid !== store.currentProjectId) { _pid = store.currentProjectId; _file = null; _decoded = null; _loading = null; _retryAt = 0; }
}
function _setFile(f) { _file = f; _decoded = null; }
function _dec() { if (!_decoded) _decoded = healthDecodeFile(_file); return _decoded; }

// Il file dal server, una volta. Un errore (viewer, rete) non si ripete a ogni disegno del pannello.
export function ensureHealthLoaded() {
    _sync();
    if (_file) return Promise.resolve(_file);
    if (_loading) return _loading;
    const pid = _pid;
    if (!pid || _isViewer() || typeof fetch !== 'function' || Date.now() < _retryAt) return Promise.resolve(null);
    _loading = fetch(`/api/projects/${encodeURIComponent(pid)}/history/health`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
            if (pid !== _pid) return null;
            if (j && j.health && typeof j.health === 'object') { _setFile(j.health); if (_repaint) _repaint(); return _file; }
            _retryAt = Date.now() + 30000;
            return null;
        })
        .catch(() => { _retryAt = Date.now() + 30000; return null; })
        .finally(() => { _loading = null; });
    return _loading;
}

// ── Lettura (chiamata dal Sync) ──────────────────────────────────────────────────
function _requestBody(n) {
    const cfg = n.integration || {};
    return JSON.stringify({
        driver: cfg.driver || 'snmp-v2c', host: snmpTargetHost(n), port: cfg.port || 161, timeout: cfg.timeout || 3,
        community: cfg.community || 'public',
        v3user: cfg.v3user || '', v3authProto: cfg.v3authProto || 'SHA', v3authPass: cfg.v3authPass || '',
        v3privProto: cfg.v3privProto || 'AES', v3privPass: cfg.v3privPass || '', v3secLevel: cfg.v3secLevel || 'authPriv',
        v3context: cfg.v3context || '',
    });
}

// Salva sul server le letture appena fatte. Best-effort come la presenza: se fallisce il Sync prosegue.
function _persist(put) {
    try {
        if (!_pid || typeof fetch !== 'function') return;
        fetch(`/api/projects/${encodeURIComponent(_pid)}/history/health`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(put),
        }).catch(() => {});
    } catch (_) { /* best-effort */ }
}

// Legge la salute degli apparati di rete fra `nodes`. Chi ha una lettura che non torna resta com'era: niente zero
// inventato al suo posto. Ritorna { ok, err }.
export async function pollHealthForNodes(nodes) {
    _sync();
    const out = { ok: 0, err: 0 };
    if (_isViewer() || typeof fetch !== 'function') return out;
    const targets = (nodes || []).filter(_eligible);
    if (!targets.length) return out;
    await ensureHealthLoaded();   // cosi' la lettura nuova scorre quella vecchia gia' qui, come fara' il server
    const put = { nodes: {} };
    const one = async (n) => {
        try {
            const r = await postJsonWithDeadline(READ_URL, _requestBody(n), snmpReadBudgetMs({ timeout: (n.integration && n.integration.timeout) || 3 }));
            // `sensors.rows` e' null quando il passo dei sensori non e' riuscito: la lib lo tiene «non letto», diverso da «nessuno».
            const rd = r && r.ok ? healthReading({ at: r.at, upCs: r.upCs, rows: r.rows, sensors: r.sensors ? r.sensors.rows : undefined }) : null;
            if (rd) { put.nodes[n.id] = rd; out.ok++; } else out.err++;
        } catch (_) { out.err++; }
    };
    for (let i = 0; i < targets.length; i += BATCH) await Promise.all(targets.slice(i, i + BATCH).map(one));
    if (Object.keys(put.nodes).length) {
        _setFile(healthFold(_file || { v: 1, nodes: {} }, put));
        _persist(put);
    }
    return out;
}

// ── Per il Drift ─────────────────────────────────────────────────────────────────
// Le interfacce che nell'ultimo intervallo hanno visto salire un contatore, una per riga, solo per gli apparati letti
// di recente. E' l'ingresso `snmp.ifHealth` di buildDriftReport.
export function healthDriftInput(nodes) {
    _sync();
    if (!_file) return [];
    const dec = _dec();
    const list = [];
    const now = Date.now();
    for (const n of (nodes || [])) {
        const slot = n && dec[n.id];
        if (!slot || !slot.cur || now - slot.cur.at > STALE_MS) continue;
        const s = healthSummarizeIf(slot.prev, slot.cur);
        if (s.state !== 'read') continue;
        for (const p of s.ports) {
            if (!p.grew.length) continue;
            // `oids`: da dove viene ogni contatore salito (source SNMP + OID), cosi' la riga dice COME lo sa.
            const oids = {};
            for (const k of p.grew) oids[k] = healthIfProvenance(k).oid;
            list.push({ nodeId: n.id, label: n.name || n.id, ifName: p.ifName, grew: p.grew.slice(), deltas: Object.assign({}, p.deltas), totals: Object.assign({}, p.totals),
                spanS: p.spanS, basis: p.basis, at: s.at, oids });
        }
    }
    return list;
}

// ── Disegno ──────────────────────────────────────────────────────────────────────
// Ogni valore passa da escapeHTML DENTRO il builder (i nomi delle interfacce arrivano dall'apparato). Funzioni con corpo
// a blocco e `return` di un template: e' la forma che lo scanner dell'escaping riconosce come builder del corpus.
const _num = (x) => Number(x).toLocaleString(getLang());
const _when = (ms) => new Date(ms).toLocaleString(getLang());
function _dur(sec) {
    const s = scaleDuration(sec);
    return t('portLive.dur.' + s.unit, { n: s.unit === 's' ? String(s.value) : _num(s.value) });
}
export function healthRowHtml(label, value, o) {
    const x = o || {};
    const sub = x.sub ? `<div class="pl-sub">${escapeHTML(x.sub)}</div>` : '';
    const tip = x.tip ? ` data-tip="${escapeHTML(x.tip)}"` : '';
    return `<div class="pl-item${x.crit ? ' crit' : (x.warn ? ' warn' : '')}"${tip}><div class="pl-row"><span class="pl-k">${escapeHTML(label)}</span><span class="pl-v">${escapeHTML(value)}</span></div>${sub}</div>`;
}
export function healthNoteHtml(text) {
    return `<div class="pl-note">${escapeHTML(text)}</div>`;
}
// Il segno dell'alfabeto unico della certezza (lib/certainty.js): misurato / dedotto / non letto.
export function healthMarkHtml(grade) {
    const tip = t('cty.' + grade) + ' — ' + t('cty.tip.' + grade);
    return `<span class="cty-mark cty-${escapeHTML(grade)}" data-tip="${escapeHTML(tip)}"></span>`;
}

// «+3 errori in · +12 scarti in»
function _deltaText(p) {
    return HEALTH_IF_COUNTERS.filter(k => p.deltas && p.deltas[k] > 0).map(k => '+' + _num(p.deltas[k]) + ' ' + t('ifh.short.' + k)).join(' · ');
}
function _totalsText(p) {
    return HEALTH_IF_COUNTERS.filter(k => p.deltas && p.deltas[k] > 0 && p.totals[k] !== null).map(k => _num(p.totals[k]) + ' ' + t('ifh.short.' + k)).join(' · ');
}
// Quante interfacce NON si sono potute confrontare, e perche'.
function _skippedText(s) {
    const by = {};
    for (const p of s.ports) if (p.status !== 'ok') by[p.status] = (by[p.status] || 0) + 1;
    const why = Object.keys(by).map(k => t('ifh.st.' + k) + ' (' + _num(by[k]) + ')').join(', ');
    const n = Object.keys(by).reduce((a, k) => a + by[k], 0);
    return n ? t('ifh.skipped', { n: _num(n), why }) : '';
}

function _previewHtml(s, slot) {
    if (s.state === 'not_available') return `<span class="props-collapsible-preview muted">${escapeHTML(t('ifh.prev.na'))}</span>`;
    if (s.counts.grew > 0) return `<span class="props-collapsible-preview pl-warn">${escapeHTML(t('ifh.prev.grew', { n: _num(s.counts.grew) }))}</span>`;
    if (!slot.prev || s.counts.noBaseline === s.counts.ports) return `<span class="props-collapsible-preview muted">${escapeHTML(t('ifh.prev.first'))}</span>`;
    if (s.counts.rebooted === s.counts.ports) return `<span class="props-collapsible-preview muted">${escapeHTML(t('ifh.prev.rebooted'))}</span>`;
    return `<span class="props-collapsible-preview">${escapeHTML(t('ifh.prev.none'))}</span>`;
}

function _bodyHtml(s, slot) {
    if (s.state === 'not_available') {
        return `<div class="pl-stack"><div class="pl-grp"><div class="pl-gt">${healthMarkHtml('unread')}${escapeHTML(t('ifh.grp'))}</div>${healthNoteHtml(t('ifh.na'))}</div></div>`;
    }
    const rows = [];
    rows.push(healthNoteHtml(t('ifh.readAt', { when: _when(slot.cur.at) })));
    const first = s.ports.find(p => p.spanS !== null);
    if (slot.prev && first) {
        rows.push(healthNoteHtml(t('ifh.compare', { when: _when(slot.prev.at), span: _dur(first.spanS), basis: t('ifh.basis.' + first.basis) })));
    }
    const grew = s.ports.filter(p => p.grew.length).sort((a, b) => {
        const sum = (p) => HEALTH_IF_COUNTERS.reduce((x, k) => x + (p.deltas[k] || 0), 0);
        return sum(b) - sum(a);
    });
    if (grew.length) {
        for (const p of grew.slice(0, LIST_MAX)) {
            rows.push(healthRowHtml(p.ifName, _deltaText(p), { warn: true, sub: t('ifh.total', { list: _totalsText(p) }), tip: t('ifh.tipDelta') }));
        }
        if (grew.length > LIST_MAX) rows.push(healthNoteHtml(t('ifh.more', { n: _num(grew.length - LIST_MAX) })));
    } else if (s.counts.noBaseline === s.counts.ports) {
        rows.push(healthNoteHtml(t('ifh.firstRead', { n: _num(s.counts.ports) })));
    } else {
        rows.push(healthNoteHtml(t('ifh.noneGrew', { n: _num(s.ports.filter(p => p.status === 'ok').length) })));
    }
    const skipped = s.counts.noBaseline === s.counts.ports ? '' : _skippedText(s);
    if (skipped) rows.push(healthNoteHtml(skipped));
    // Il segno dice COME si sa: le differenze sono calcolate (dedotte da due misure), i totali sono letti.
    const mark = grew.length ? healthMarkHtml('derived') : healthMarkHtml('measured');
    return `<div class="pl-stack"><div class="pl-grp"><div class="pl-gt">${mark}${escapeHTML(t('ifh.grp'))}</div>${rows.join('')}${healthNoteHtml(t('ifh.src'))}</div></div>`;
}

// La scheda per `node` (stringa vuota se non e' un apparato di rete, se non ha una lettura, o se i dati non sono ancora
// arrivati: in quel caso li chiede e ridisegna da sola). `open` = lo stato della fisarmonica, deciso dal pannello.
export function ifHealthCardHtml(node, open) {
    if (!_eligible(node)) return '';
    _sync();
    if (!_file) { ensureHealthLoaded(); return ''; }
    const slot = _dec()[node.id];
    if (!slot || !slot.cur) return '';
    const s = healthSummarizeIf(slot.prev, slot.cur);
    return `<details class="props-collapsible props-secondary pl-section" ${open ? 'open' : ''} data-toggle="props-section" data-section="if-health" data-ifh-nid="${escapeHTML(node.id)}"><summary class="props-collapsible-head"><span><i class="fas fa-heart-pulse"></i> ${escapeHTML(t('ifh.title'))}</span>${_previewHtml(s, slot)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-body">${_bodyHtml(s, slot)}</div></div></details>`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// SENSORI AMBIENTALI — la scheda, le soglie dell'utente, l'ingresso del Drift
// ═════════════════════════════════════════════════════════════════════════════════════════
const _thr = () => healthSanitizeThresholds(store.state && store.state.healthThresholds);
// C'e' almeno un apparato che ha pubblicato almeno un sensore?
const _anySensors = () => Object.values(_dec()).some(s => s.cur && Array.isArray(s.cur.sensors) && s.cur.sensors.length > 0);

// Le soglie dell'UTENTE (`state.healthThresholds`, nel progetto: una dichiarazione). Valgono solo dove l'apparato non dichiara una
// gravita' sua, e dove valgono la riga lo dice (`user_default`). Un testo che non e' una soglia valida la CANCELLA, non la inventa.
export function setHealthThreshold(key, text) {
    if (key !== 'warn' && key !== 'crit') return;
    const cur = _thr().temperature || { warn: null, crit: null };
    const next = healthSanitizeThresholds({ temperature: Object.assign({}, cur, { [key]: text }) });
    pushHistory();
    if (next.temperature) store.state.healthThresholds = next; else delete store.state.healthThresholds;
    markDirty();
    if (_repaint) _repaint();
}
registerChangeActions({ 'health-thr': (el) => setHealthThreshold(el.dataset.key, el.value) });

// La sezione «Soglie di salute» del pannello del PROGETTO (due numeri: temperatura, avviso e critica).
export function healthThresholdsSectionHtml(open) {
    const th = _thr().temperature || { warn: null, crit: null };
    const val = (n) => (n === null ? '' : String(n));
    const set = th.warn !== null || th.crit !== null;
    // La sezione serve SOLO dove c'e' qualcosa a cui applicarla: se nessun apparato ha mai pubblicato un sensore (una rete di
    // sole macchine virtuali, un progetto mai sincronizzato) una soglia sulla temperatura non ha oggetto e il pannello del
    // progetto non si riempie di un campo morto. Se la soglia c'e' gia' scritta si mostra sempre: va potuta cambiare o togliere.
    if (!set) {
        _sync();
        if (!_file) { ensureHealthLoaded(); return ''; }
        if (!_anySensors()) return '';
    }
    const preview = set
        ? t('ifh.thr.prev', { warn: th.warn === null ? '—' : String(th.warn), crit: th.crit === null ? '—' : String(th.crit) })
        : t('ifh.thr.none');
    return `<details class="props-collapsible props-secondary" ${open ? 'open' : ''} data-toggle="props-section" data-section="floor-health"><summary class="props-collapsible-head"><span><i class="fas fa-temperature-half"></i> ${escapeHTML(t('ifh.thr.title'))}</span><span class="props-collapsible-preview${set ? '' : ' muted'}">${escapeHTML(preview)}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-note">${escapeHTML(t('ifh.thr.note'))}</div><div class="prop-row2"><div class="prop-group"><label>${escapeHTML(t('ifh.thr.warn'))}</label><input type="number" min="-50" max="200" step="1" value="${escapeHTML(val(th.warn))}" placeholder="—" data-change="health-thr" data-key="warn"></div><div class="prop-group"><label>${escapeHTML(t('ifh.thr.crit'))}</label><input type="number" min="-50" max="200" step="1" value="${escapeHTML(val(th.crit))}" placeholder="—" data-change="health-thr" data-key="crit"></div></div></div></details>`;
}

const _numS = (x) => Number(x).toLocaleString(getLang(), { maximumFractionDigits: 2 });
function _senValue(it) {
    if (it.value === null) return it.unit ? t('ifh.sen.nd') : '—';   // solo-stato (alimentatore, ventola senza giri): il valore non c'e' per costruzione
    return _numS(it.value) + (it.unit ? ' ' + it.unit : '');
}
// Cosa dice la riga sotto il valore: la gravita' E DA CHI VIENE, lo stato dell'apparato, i suoi limiti.
function _senSub(it) {
    const parts = [];
    if (it.severity) {
        parts.push(t('ifh.sen.sev.' + it.severity) + ' — ' + t('ifh.sen.src.' + it.source));
        if (it.why === 'limit') {
            const lim = (it.limHi !== null && it.value > it.limHi) ? it.limHi : it.limLo;
            parts.push(t('ifh.sen.why.limit', { lim: _numS(lim) }));
        } else if (it.why === 'state' && it.state !== 'warning' && it.state !== 'critical') {
            parts.push(t('ifh.sen.state.' + it.state));   // shutdown / non funziona: la parola dell'apparato, non solo «critico»
        }
    } else if (it.state !== 'ok' && it.state !== 'unknown') {
        parts.push(t('ifh.sen.state.' + it.state));
    }
    if (it.limLo !== null || it.limHi !== null) {
        parts.push(t('ifh.sen.limits', { lo: it.limLo === null ? '—' : _numS(it.limLo), hi: it.limHi === null ? '—' : _numS(it.limHi) }));
    }
    return parts.join(' · ');
}
function _senPreviewHtml(sum) {
    if (sum.state === 'not_available') return `<span class="props-collapsible-preview muted">${escapeHTML(t('ifh.sen.prev.na'))}</span>`;
    if (sum.counts.crit > 0) return `<span class="props-collapsible-preview pl-crit">${escapeHTML(t('ifh.sen.prev.crit', { n: _num(sum.counts.crit) }))}</span>`;
    if (sum.counts.warn > 0) return `<span class="props-collapsible-preview pl-warn">${escapeHTML(t('ifh.sen.prev.warn', { n: _num(sum.counts.warn) }))}</span>`;
    return `<span class="props-collapsible-preview">${escapeHTML(t('ifh.sen.prev.ok', { n: _num(sum.counts.total) }))}</span>`;
}
function _senBodyHtml(sum, slot) {
    if (sum.state === 'not_available') {
        return `<div class="pl-stack"><div class="pl-grp"><div class="pl-gt">${healthMarkHtml('unread')}${escapeHTML(t('ifh.sen.grp'))}</div>${healthNoteHtml(t('ifh.sen.na'))}</div></div>`;
    }
    const lines = [];
    lines.push(healthNoteHtml(t('ifh.readAt', { when: _when(slot.cur.at) })));
    for (const it of sum.items.slice(0, SENSORS_MAX)) {
        const tip = t('ifh.sen.prov', { mib: it.mib || '?', oid: it.oid || '?' });
        lines.push(healthRowHtml(it.label, _senValue(it), { crit: it.severity === 'crit', warn: it.severity === 'warn', sub: _senSub(it), tip }));
    }
    if (sum.items.length > SENSORS_MAX) lines.push(healthNoteHtml(t('ifh.more', { n: _num(sum.items.length - SENSORS_MAX) })));
    lines.push(healthNoteHtml(t('ifh.sen.src')));
    return `<div class="pl-stack"><div class="pl-grp"><div class="pl-gt">${healthMarkHtml('measured')}${escapeHTML(t('ifh.sen.grp'))}</div>${lines.join('')}</div></div>`;
}

// La scheda «Sensori» dell'apparato (vuota se la lettura non ha il passo dei sensori: «non letti» non e' «nessuno»).
export function sensorsCardHtml(node, open) {
    if (!_eligible(node)) return '';
    _sync();
    if (!_file) { ensureHealthLoaded(); return ''; }
    const slot = _dec()[node.id];
    if (!slot || !slot.cur) return '';
    const sum = healthSummarizeSensors(slot.cur, _thr());
    if (sum.state === 'not_read') return '';
    return `<details class="props-collapsible props-secondary pl-section" ${open ? 'open' : ''} data-toggle="props-section" data-section="sensors-health" data-ifh-nid="${escapeHTML(node.id)}"><summary class="props-collapsible-head"><span><i class="fas fa-temperature-half"></i> ${escapeHTML(t('ifh.sen.title'))}</span>${_senPreviewHtml(sum)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-body">${_senBodyHtml(sum, slot)}</div></div></details>`;
}

// Lo stato della porta locale di un apparato, dalla lettura delle interfacce (la stessa Sync): 'up' | 'down' | null (non si sa).
// Serve ai vicini: un vicino silenzioso su una porta GIU' lo dicono gia' le porte giu' e il cavo fantasma. Una lettura vecchia
// non e' lo stato di adesso: oltre la soglia di freschezza non si sa.
export function ifOperOf(nodeId, ifName) {
    _sync();
    if (!_file) return null;
    const slot = _dec()[nodeId];
    if (!slot || !slot.cur || Date.now() - slot.cur.at > STALE_MS) return null;
    const want = String(ifName == null ? '' : ifName).trim().toLowerCase();
    const row = slot.cur.rows.find(r => r.ifName.toLowerCase() === want);
    if (!row || row.oper === null) return null;
    if (row.oper === 1) return 'up';
    return (row.oper === 2 || row.oper === 6 || row.oper === 7) ? 'down' : null;   // down, notPresent, lowerLayerDown; testing/dormant/unknown: non si sa
}

// Per il Drift: i sensori con una gravita' (dell'apparato o dell'utente), solo per gli apparati letti di recente. Ingresso
// `snmp.sensorHealth` di buildDriftReport. La riga porta da DOVE viene la gravita' e da quale OID il valore.
export function healthSensorDriftInput(nodes) {
    _sync();
    if (!_file) return [];
    const dec = _dec(), thr = _thr(), now = Date.now(), list = [];
    for (const n of (nodes || [])) {
        const slot = n && dec[n.id];
        if (!slot || !slot.cur || now - slot.cur.at > STALE_MS) continue;
        const sum = healthSummarizeSensors(slot.cur, thr);
        if (sum.state !== 'read') continue;
        for (const it of sum.items) {
            if (!it.severity) continue;
            list.push({ nodeId: n.id, label: n.name || n.id, sid: it.sid, sensor: it.label, kind: it.kind, value: it.value, unit: it.unit, state: it.state,
                severity: it.severity, severitySource: it.source, why: it.why, limLo: it.limLo, limHi: it.limHi, mib: it.mib, oid: it.oid, at: sum.at });
        }
    }
    return list;
}

// Solo per i test: ripulisce la memoria.
export function _healthReset() { _pid = null; _file = null; _decoded = null; _loading = null; _retryAt = 0; _repaint = null; }
// Solo per i test: mette in memoria un file.
export function _healthSetFile(f, pid) { _pid = pid === undefined ? store.currentProjectId : pid; _setFile(f); }
