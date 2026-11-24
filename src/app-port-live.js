// ============================================================
// PORT LIVE — la card «Lettura dal vivo» nel pannello Proprieta' della PORTA
// ============================================================
// Si clicca la porta di uno switch e, in una fisarmonica come le altre del pannello, si vede COME STA
// ADESSO: traffico (byte, pacchetti, velocita' attuale), errori e scarti, da quanto tempo e' in questo stato.
// La lettura si fa quando la card e' aperta (e col pulsante «Aggiorna»): il server interroga SOLO quella
// porta via SNMP, due volte a ~3 s di distanza, e dalla differenza esce la velocita' attuale.
//
// ── Cosa NON fa, di proposito ──────────────────────────────────────────────────
//   • non salva niente nel progetto (nessun campo nuovo, nessuna misura che scade, niente nell'export):
//     i contatori cambiano ogni secondo e un numero salvato sembrerebbe attuale senza esserlo;
//   • non ripete la lettura da solo: non e' un monitor. Una lettura piu' recente di 15 s non si rifa;
//   • non inventa soglie: la riga diventa ambra solo se un contatore di errori e' SALITO fra le due letture;
//   • non conclude dove l'apparato tace: una colonna non pubblicata e' «non letta», mai zero.
// La parte pura (OID, differenze, velocita') sta in lib/port-live.js e ha i suoi test; qui c'e' solo il
// disegno e la chiamata. Solo amministratori, come ogni rotta SNMP (`/api/poll-port`).
//
// Modulo FOGLIA: non importa app.js, cosi' non allarga il ciclo dei moduli. Il nodo della porta lo ricorda
// al momento del disegno (`portLiveHtml`), perche' l'azione del pulsante riceve solo il `pid`.

import { t, getLang } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML, postJsonWithDeadline } from './app-util.js';
import { hasSnmpTarget, snmpTargetHost } from '../lib/snmp-target.js';
import { summarizePortLive, scaleBytes, scaleBits, scaleCount, scaleDuration } from '../lib/port-live.js';
import { registerClickActions } from './app-delegation.js';

const READ_URL = '/api/poll-port';
const GAP_MS = 3000;          // distanza fra le due letture: da qui la velocita' attuale
const FRESH_MS = 15000;       // una lettura piu' recente non si ripete da sola
const DEADLINE_MS = 30000;    // tetto lato client: il server ha i suoi (timeout SNMP × passaggi)
const AUTO_DELAY_MS = 250;    // chi scorre le porte non lancia una lettura per ognuna

// pid → { nodeId, status: 'idle'|'loading'|'ok'|'nf'|'err', at, summary, reason, error, name, seq }
const _state = new Map();
let _timer = null;

function _entry(pid) {
    let e = _state.get(pid);
    if (!e) { e = { nodeId: '', status: 'idle', at: 0, summary: null, reason: '', error: '', name: '', seq: 0 }; _state.set(pid, e); }
    return e;
}

const _isViewer = () => !!(store._currentUser && store._currentUser.role === 'viewer');
const _num = (x) => Number(x).toLocaleString(getLang(), { maximumFractionDigits: x >= 100 ? 0 : (x >= 10 ? 1 : 2) });
const _withUnit = (sc) => `${_num(sc.value)} ${sc.unit}`;
const _dur = (sec) => { const s = scaleDuration(sec); return t('portLive.dur.' + s.unit, { n: s.unit === 's' ? String(s.value) : _num(s.value) }); };
const _count = (n) => { const sc = scaleCount(n); return sc.unit ? `${_num(sc.value)} ${sc.unit}` : _num(sc.value); };
const _pct = (p) => `${Number(p).toLocaleString(getLang(), { maximumFractionDigits: p < 1 ? 2 : 1 })} %`;

// ── Disegno ─────────────────────────────────────────────────────────────────────
// Ogni valore passa da escapeHTML DENTRO il builder: cosi' lo scanner dell'escaping dimostra sicure sia le
// righe sia le unioni (nome della porta e del dispositivo arrivano dall'apparato).
// Funzioni con corpo a blocco e `return` di un template: e' la forma che lo scanner riconosce come BUILDER del corpus
// (le arrow a espressione no), e un builder riconosciuto rende provabili le righe che lo chiamano.
function _row(label, value, opts) {
    const o = opts || {};
    const sub = o.sub ? `<div class="pl-sub">${escapeHTML(o.sub)}</div>` : '';
    const tip = o.tip ? ` data-tip="${escapeHTML(o.tip)}"` : '';
    return `<div class="pl-item${o.warn ? ' warn' : ''}"${tip}><div class="pl-row"><span class="pl-k">${escapeHTML(label)}</span><span class="pl-v">${escapeHTML(value)}</span></div>${sub}</div>`;
}
function _note(text) {
    return `<div class="pl-note">${escapeHTML(text)}</div>`;
}

function _trafficGroup(s) {
    const tr = s.traffic;
    const rows = [];
    if (!tr || !tr.bits) {
        rows.push(_note(t('portLive.noTraffic')));
        return `<div class="pl-grp"><div class="pl-gt"><i class="fas fa-right-left"></i>${escapeHTML(t('portLive.traffic'))}</div>${rows.join('')}</div>`;
    }
    const rate = (bps, util) => (bps == null ? t('portLive.noRate')
        : `${_withUnit(scaleBits(bps))}${util != null ? ' · ' + _pct(util) : ''}`);
    const totals = (bytes, pkts) => (pkts != null
        ? t('portLive.totals', { bytes: _withUnit(scaleBytes(bytes)), pkts: _count(pkts) })
        : t('portLive.totalOnly', { bytes: _withUnit(scaleBytes(bytes)) }));
    rows.push(_row(t('portLive.rx'), '↓ ' + rate(tr.inBps, tr.inUtil), { sub: totals(tr.inBytes, tr.inPkts) }));
    rows.push(_row(t('portLive.tx'), '↑ ' + rate(tr.outBps, tr.outUtil), { sub: totals(tr.outBytes, tr.outPkts) }));
    if (s.uptimeSec != null) rows.push(_note(t('portLive.sinceStart', { dur: _dur(s.uptimeSec) })));
    if (tr.bits === 32) rows.push(_note(t('portLive.c32')));
    return `<div class="pl-grp"><div class="pl-gt"><i class="fas fa-right-left"></i>${escapeHTML(t('portLive.traffic'))}</div>${rows.join('')}</div>`;
}

function _errorsGroup(s) {
    const er = s.errors;
    const rows = [];
    if (!er || !er.answered) {
        rows.push(_note(t('portLive.noErrData')));
        return `<div class="pl-grp"><div class="pl-gt"><i class="fas fa-triangle-exclamation"></i>${escapeHTML(t('portLive.errors'))}</div>${rows.join('')}</div>`;
    }
    const grew = new Set(er.grew || []);
    const span = s.traffic && s.traffic.spanS != null ? String(Math.round(s.traffic.spanS)) : '';
    const rising = (keys) => {
        const n = keys.reduce((a, k) => a + (er.deltas && er.deltas[k] ? er.deltas[k] : 0), 0);
        return n > 0 ? t('portLive.rising', { n: _num(n), s: span }) : '';
    };
    const pairVal = (a, b) => `${_num(er[a] ?? 0)} / ${_num(er[b] ?? 0)}`;
    const risingOpts = (keys) => {
        const w = keys.some(k => grew.has(k));
        return { warn: w, sub: w ? rising(keys) : '', tip: w ? t('portLive.risingTip') : '' };
    };
    if (!er.any) {
        rows.push(_note(t('portLive.none')));
    } else {
        rows.push(_row(t('portLive.errPair'), pairVal('inErrors', 'outErrors'), risingOpts(['inErrors', 'outErrors'])));
        rows.push(_row(t('portLive.dropPair'), pairVal('inDiscards', 'outDiscards'), risingOpts(['inDiscards', 'outDiscards'])));
        for (const d of er.detail) {
            rows.push(_row(t('portLive.det.' + d.key), _num(d.value), risingOpts([d.key])));
        }
    }
    if (er.unknownProtos > 0) rows.push(_row(t('portLive.unknownProtos'), _num(er.unknownProtos)));
    if (s.pause && ((s.pause.in || 0) > 0 || (s.pause.out || 0) > 0)) {
        rows.push(_row(t('portLive.pause'), `${_num(s.pause.in ?? 0)} / ${_num(s.pause.out ?? 0)}`));
    }
    return `<div class="pl-grp"><div class="pl-gt"><i class="fas fa-triangle-exclamation"></i>${escapeHTML(t('portLive.errors'))}</div>${rows.join('')}</div>`;
}

function _stateGroup(s) {
    const rows = [];
    if (s.oper) {
        let v = t('portLive.oper.' + s.oper);
        if (s.admin === 'down') v += ' · ' + t('portLive.adminDown');
        if (s.sinceSec != null) v += ' · ' + (s.sinceBoot ? t('portLive.sinceBoot') : t('portLive.since', { dur: _dur(s.sinceSec) }));
        rows.push(_row(t('portLive.link'), v));
    }
    const link = [];
    if (s.speedMbps != null) link.push(_withUnit(scaleBits(s.speedMbps * 1e6)));
    if (s.duplex) link.push(t('portLive.duplex.' + s.duplex));
    if (link.length) rows.push(_row(t('portLive.speed'), link.join(' · ')));
    if (s.mtu != null) rows.push(_row(t('portLive.mtu'), String(s.mtu)));
    if (!rows.length) return '';
    return `<div class="pl-grp"><div class="pl-gt"><i class="fas fa-plug"></i>${escapeHTML(t('portLive.state'))}</div>${rows.join('')}</div>`;
}

function _toolbar(e, busy) {
    const when = (e.status === 'ok' && e.at)
        ? t('portLive.when', { time: new Date(e.at).toLocaleTimeString(getLang()), s: e.summary && e.summary.traffic && e.summary.traffic.spanS != null ? String(Math.round(e.summary.traffic.spanS)) : '—' })
        : '';
    return `<div class="pl-bar"><button type="button" class="toolbar-btn" data-act="port-live-refresh" data-pid="${escapeHTML(e.pid || '')}"${busy ? ' disabled' : ''} data-tip="${escapeHTML(t('portLive.tip'))}" data-tip-wrap><i class="fas ${busy ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> ${escapeHTML(busy ? t('portLive.reading') : t('portLive.refresh'))}</button><span class="pl-when">${escapeHTML(when)}</span></div>`;
}

function _bodyHtml(pid, pi) {
    const e = _entry(pid);
    e.pid = pid;
    if (_isViewer()) return `<div class="pl-stack">${_note(t('portLive.adminOnly'))}</div>`;
    if (!pi || !String(pi.ifName || '').trim()) return `<div class="pl-stack">${_note(t('portLive.needName'))}</div>`;
    const busy = e.status === 'loading';
    const s = e.summary;
    if (s && s.answered && (e.status === 'ok' || busy)) {
        return `<div class="pl-stack">${_toolbar(e, busy)}${_trafficGroup(s)}${_errorsGroup(s)}${_stateGroup(s)}</div>`;
    }
    let msg = t('portLive.idle');
    if (s && !s.answered && (e.status === 'ok' || busy)) msg = t('portLive.silent');
    else if (e.status === 'nf') msg = t(e.reason === 'ambiguous' ? 'portLive.ambiguous' : 'portLive.notFound', { name: String(pi.ifName) });
    else if (e.status === 'err') msg = t('portLive.failed', { err: e.error || '?' });
    else if (busy) msg = t('portLive.reading');
    return `<div class="pl-stack">${_toolbar(e, busy)}${_note(msg)}</div>`;
}

// Il riassunto che resta visibile a fisarmonica CHIUSA.
function _previewHtml(pid, pi) {
    const e = _entry(pid);
    if (_isViewer() || !pi || !String(pi.ifName || '').trim()) return `<span class="props-collapsible-preview muted">—</span>`;
    if (e.status === 'loading') return `<span class="props-collapsible-preview muted">${escapeHTML(t('portLive.reading'))}</span>`;
    const tr = e.status === 'ok' && e.summary && e.summary.answered ? e.summary.traffic : null;
    if (tr && tr.inBps != null && tr.outBps != null) {
        const grew = e.summary.errors && e.summary.errors.grew && e.summary.errors.grew.length;
        return `<span class="props-collapsible-preview${grew ? ' pl-warn' : ''}">${escapeHTML(`↓ ${_withUnit(scaleBits(tr.inBps))}  ↑ ${_withUnit(scaleBits(tr.outBps))}`)}</span>`;
    }
    return `<span class="props-collapsible-preview muted">${escapeHTML(t('portLive.previewIdle'))}</span>`;
}

// La card per la porta `pid` del nodo `node` (null se l'apparato non si interroga con SNMP). `open` = lo stato
// della fisarmonica (lo decide il pannello, che lo ricorda come per le altre sezioni).
export function portLiveHtml(pid, node, pi, open) {
    if (!node || !hasSnmpTarget(node)) return '';
    // L'identita' di una lettura e' CHI e' stato interrogato (apparato, indirizzo, nome dell'interfaccia), non il
    // `pid`: «sw-1» esiste in mezzo mondo di progetti, e i numeri dello switch di un altro non sono i suoi. Se
    // l'identita' cambia la memoria riparte da zero e una lettura ancora in volo viene scartata (`seq`).
    const e = _entry(pid);
    const fp = `${node.id}|${snmpTargetHost(node)}|${String((pi && pi.ifName) || '').trim()}`;
    if (e.fp !== fp) { e.fp = fp; e.status = 'idle'; e.summary = null; e.at = 0; e.reason = ''; e.error = ''; e.name = ''; e.seq++; }
    e.nodeId = node.id;
    return `<details class="props-collapsible props-secondary pl-section" ${open ? 'open' : ''} data-toggle="props-section" data-section="port-live" data-pl-pid="${escapeHTML(pid)}"><summary class="props-collapsible-head"><span><i class="fas fa-gauge-high"></i> ${escapeHTML(t('portLive.title'))}</span>${_previewHtml(pid, pi)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-body" data-pl-body>${_bodyHtml(pid, pi)}</div></div></details>`;
}

// ── Lettura ─────────────────────────────────────────────────────────────────────
function _card(pid) {
    if (typeof document === 'undefined') return null;
    return Array.from(document.querySelectorAll('details[data-section="port-live"]')).find(el => el.dataset.plPid === pid) || null;
}

// Ridisegna SOLO la card (corpo e riassunto): il resto del pannello ha campi che qualcuno sta forse scrivendo.
function _paint(pid) {
    const card = _card(pid);
    if (!card) return;
    const pi = store.state.ports[pid] || {};
    const body = card.querySelector('[data-pl-body]');
    if (body) body.innerHTML = _bodyHtml(pid, pi);
    const prev = card.querySelector('summary .props-collapsible-preview');
    if (prev) prev.outerHTML = _previewHtml(pid, pi);
}

function _requestBody(node, ifName) {
    const cfg = node.integration || {};
    return JSON.stringify({
        driver: cfg.driver || 'snmp-v2c', host: snmpTargetHost(node), port: cfg.port || 161, timeout: cfg.timeout || 3,
        community: cfg.community || 'public',
        v3user: cfg.v3user || '', v3authProto: cfg.v3authProto || 'SHA', v3authPass: cfg.v3authPass || '',
        v3privProto: cfg.v3privProto || 'AES', v3privPass: cfg.v3privPass || '', v3secLevel: cfg.v3secLevel || 'authPriv',
        v3context: cfg.v3context || '',
        ifName, gapMs: GAP_MS,
    });
}

async function _read(pid) {
    const e = _entry(pid);
    if (e.status === 'loading' || _isViewer() || typeof fetch !== 'function') return;
    const node = (store.state.nodes || []).find(n => n && n.id === e.nodeId);
    const pi = store.state.ports[pid] || {};
    const ifName = String(pi.ifName || '').trim();
    if (!node || !ifName || !hasSnmpTarget(node)) return;
    const seq = ++e.seq;
    e.status = 'loading';
    _paint(pid);
    try {
        const r = await postJsonWithDeadline(READ_URL, _requestBody(node, ifName), DEADLINE_MS);
        if (seq !== e.seq) return;
        if (!r || !r.ok) { e.status = 'err'; e.error = (r && r.error) || ''; }
        else if (!r.found) { e.status = 'nf'; e.reason = r.reason || 'not-found'; }
        else { e.status = 'ok'; e.summary = summarizePortLive(r.samples); e.at = Date.now(); e.name = r.ifName || ifName; }
    } catch (err) {
        if (seq !== e.seq) return;
        e.status = 'err';
        e.error = err && err.deadline ? t('portLive.deadline') : String((err && err.message) || err);
    }
    _paint(pid);
}

// Lettura automatica all'apertura della card o al disegno del pannello con la card aperta. Un colpo solo per
// chi scorre le porte (l'ultima vince) e mai se ce n'e' una recente: non e' un monitor.
function _schedule(pid) {
    clearTimeout(_timer);
    _timer = setTimeout(() => {
        if (store.selId !== pid) return;
        const e = _entry(pid);
        if (e.status === 'loading' || (e.status === 'ok' && Date.now() - e.at < FRESH_MS)) return;
        _read(pid);
    }, AUTO_DELAY_MS);
}

// Chiamata dal pannello DOPO aver scritto l'HTML: collega la card (se c'e') alla lettura automatica.
export function bindPortLive(panel) {
    const card = panel && typeof panel.querySelector === 'function' ? panel.querySelector('details[data-section="port-live"]') : null;
    if (!card) return;
    const pid = card.dataset.plPid;
    if (card.open) _schedule(pid);
    card.addEventListener('toggle', () => { if (card.open) _schedule(pid); });
}

registerClickActions({
    'port-live-refresh': (el) => { _read(el.dataset.pid); },
});

// Solo per i test: ripulisce la memoria delle letture.
export function _portLiveReset() { _state.clear(); clearTimeout(_timer); }
