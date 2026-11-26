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
import { registerChangeActions, registerClickActions, registerInputActions } from './app-delegation.js';
import { healthReading, healthFold, healthDecodeFile, healthSummarizeIf, healthIfProvenance, healthSummarizeSensors, healthSanitizeThresholds, healthThresholdsFor, healthThresholdsClearNode, healthThresholdsApply, healthScaleModel, healthSensorSeverity, HEALTH_IF_COUNTERS } from '../lib/health-store.js';

const READ_URL = '/api/poll-health';
// Gli apparati di rete: sono quelli che hanno interfacce di cui l'amministratore risponde. Server e NAS hanno le
// loro (e gli errori di una scheda contano) ma il pannello e il Drift nascono per l'infrastruttura.
const HEALTH_IF_TYPES = ['switch', 'router', 'firewall', 'sdwan'];
const BATCH = 5;                 // come la lettura principale: quanti apparati insieme
const STALE_MS = 6 * 3600 * 1000;   // come `SNMP_STALE_HOURS`: una lettura piu' vecchia non e' lo stato di adesso
const LIST_MAX = 12;             // quante interfacce elencare nella scheda (le altre in una riga)
const SENSORS_MAX = 40;          // quanti sensori elencare nella scheda
const SENSORS_PER_KIND = 6;      // ...di cui, di quelli senza gravita', al massimo tanti per tipo (temperatura, ventole, tensioni…)

let _pid = null;                 // il progetto a cui si riferisce quanto sta in memoria
let _file = null;                // il file com'e' sul server (tuple), o quello fuso in locale
let _decoded = null;             // _file aperto, ricalcolato solo quando _file cambia
let _loading = null;             // GET in volo
let _retryAt = 0;                // dopo un fallimento (es. non admin) non si richiede subito
let _repaint = null;

const _isViewer = () => !!(store._currentUser && store._currentUser.role === 'viewer');
const _eligible = (n) => !!n && HEALTH_IF_TYPES.includes(n.type) && hasSnmpTarget(n);

export function setHealthRepaint(fn) { _repaint = typeof fn === 'function' ? fn : null; }
// Ridisegna il pannello (chi ha cambiato le tolleranze fuori dal pannello, come la tabella, lo chiede alla chiusura).
export function healthRepaint() { if (_repaint) _repaint(); }

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
        const s = healthSummarizeIf(slot.prev, slot.cur, _thrFor(n.id));   // la soglia sugli errori e' dell'UTENTE (nel progetto, o la sua per quell'apparato)
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
// Il segno della certezza SENZA suggerimento proprio: il grado lo dice il suggerimento della riga che lo porta (due suggerimenti
// uno dentro l'altro si sovrapporrebbero).
function _markDotHtml(grade) {
    return `<span class="cty-mark cty-${escapeHTML(grade)}"></span>`;
}
// Una riga: nome e valore, e — solo dove servono — il segno (`mark`), il suggerimento lungo che va a capo (`wrap`) e il clic che
// porta alla porta (`pid`).
export function healthRowHtml(label, value, o) {
    const x = o || {};
    const sub = x.sub ? `<div class="pl-sub">${escapeHTML(x.sub)}</div>` : '';
    const tip = x.tip ? ` data-tip="${escapeHTML(x.tip)}"${x.wrap ? ' data-tip-wrap' : ''}` : '';
    const go = x.pid ? ` data-act="ifh-open-port" data-pid="${escapeHTML(x.pid)}"` : '';
    const dot = x.mark ? ` ${_markDotHtml(x.mark)}` : '';
    // il bottone che apre il pannello «Tolleranza» su QUESTA riga (temperatura o interfaccia): `x.tol` = { nid, kind, key, on }
    const tb = x.tol ? `<button type="button" class="tol-btn${x.tol.on ? ' on' : ''}" data-act="tolp-toggle" data-nid="${escapeHTML(x.tol.nid)}" data-kind="${escapeHTML(x.tol.kind)}" data-key="${escapeHTML(x.tol.key)}" data-tip="${escapeHTML(t('tol.btn'))}" aria-label="${escapeHTML(t('tol.btn'))}" aria-expanded="${x.tol.on ? 'true' : 'false'}"><i class="fas fa-sliders"></i></button>` : '';
    return `<div class="pl-item${x.crit ? ' crit' : (x.warn ? ' warn' : (x.ok ? ' ok' : ''))}"${tip}${go}><div class="pl-row"><span class="pl-k">${escapeHTML(label)}${dot}</span><span class="pl-v">${escapeHTML(value)}</span>${tb}</div>${sub}</div>`;
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
    if (s.counts.below > 0) return `<span class="props-collapsible-preview muted">${escapeHTML(t('ifh.prev.below', { n: _num(s.counts.below) }))}</span>`;
    if (!slot.prev || s.counts.noBaseline === s.counts.ports) return `<span class="props-collapsible-preview muted">${escapeHTML(t('ifh.prev.first'))}</span>`;
    if (s.counts.rebooted === s.counts.ports) return `<span class="props-collapsible-preview muted">${escapeHTML(t('ifh.prev.rebooted'))}</span>`;
    return `<span class="props-collapsible-preview">${escapeHTML(t('ifh.prev.none'))}</span>`;
}

// Solo i fatti: le interfacce salite, una riga ciascuna (nome, valore, il segno «dedotto»), e lo stato quando non c'e' niente da
// elencare. Il COME si sa passando sulla riga (intervallo, orari, totali, da quale MIB/OID): scritto in paragrafi riempiva la scheda
// di frasi. Fa eccezione una lettura VECCHIA: l'orario si dice a vista, perche' non e' lo stato di adesso.
function _bodyHtml(s, slot, node) {
    if (s.state === 'not_available') {
        return `<div class="pl-stack"><div class="pl-grp"><div class="pl-gt">${healthMarkHtml('unread')}${escapeHTML(t('ifh.grp'))}</div>${healthNoteHtml(t('ifh.na'))}</div></div>`;
    }
    const rows = [];
    if (Date.now() - slot.cur.at > STALE_MS) rows.push(healthNoteHtml(t('ifh.readAt', { when: _when(slot.cur.at) })));
    const grew = s.ports.filter(p => p.grew.length).sort((a, b) => {
        const sum = (p) => HEALTH_IF_COUNTERS.reduce((x, k) => x + (p.deltas[k] || 0), 0);
        return sum(b) - sum(a);
    });
    if (grew.length) {
        for (const p of grew.slice(0, LIST_MAX)) {
            rows.push(healthRowHtml(p.ifName, _deltaText(p), { warn: true, mark: 'derived', wrap: true, pid: _pidOf(node, p.ifName), tip: _ifTip(s, slot, p), tol: { nid: node.id, kind: 'err', key: p.ifName, on: _tolpIs(node.id, 'err', p.ifName) } }));
            rows.push(_tolpBuild(node, 'err', p.ifName));
        }
        if (grew.length > LIST_MAX) rows.push(healthNoteHtml(t('ifh.more', { n: _num(grew.length - LIST_MAX) })));
    } else if (s.counts.noBaseline === s.counts.ports) {
        rows.push(healthNoteHtml(t('ifh.firstRead', { n: _num(s.counts.ports) })));
    } else if (s.counts.below === 0) {
        // «Nessuna ha visto errori nuovi» e' vero SOLO se non ce n'e' neppure sotto la soglia: con interfacce salite sotto soglia
        // lo dice la nota qui sotto (ifh.below), e questa frase non si scrive.
        rows.push(healthNoteHtml(t('ifh.noneGrew', { n: _num(s.ports.filter(p => p.status === 'ok').length) })));
    }
    // Le interfacce che sono salite MA sotto la soglia dell'utente non si elencano, e la scheda lo dice: non fa sembrare che non
    // sia cambiato niente.
    if (s.counts.below > 0) rows.push(healthNoteHtml(t('ifh.below', { n: _num(s.counts.below), min: _num(s.min) })));
    const skipped = s.counts.noBaseline === s.counts.ports ? '' : _skippedText(s);
    if (skipped) rows.push(healthNoteHtml(skipped));
    return `<div class="pl-stack"><div class="pl-grp">${rows.join('')}</div></div>`;
}

// Il pid della porta di `node` che ha quel nome d'interfaccia (come abbina le porte tutta l'app: minuscole, spazi tagliati), o null.
function _pidOf(node, ifName) {
    const want = String(ifName == null ? '' : ifName).trim().toLowerCase();
    if (!node || !want) return null;
    const ports = (store.state && store.state.ports) || {};
    const prefix = node.id + '-';
    for (const pid of Object.keys(ports)) {
        if (pid.startsWith(prefix) && String((ports[pid] && ports[pid].ifName) || '').trim().toLowerCase() === want) return pid;
    }
    return null;
}
function _sentence(s) { return /[.!?]$/.test(s) ? s : s + '.'; }
// Il suggerimento delle righe «dedotte» (le differenze): COME si sa, in una frase per pezzo — chi lo dice, il confronto, l'orario, i
// totali, da quali contatori. E' tutto cio' che prima stava scritto in paragrafi sotto il titolo.
function _ifTip(s, slot, p) {
    const bits = [t('cty.derived') + ' — ' + t('ifh.tipDelta')];
    if (slot.prev && p.spanS !== null) bits.push(t('ifh.compare', { when: _when(slot.prev.at), span: _dur(p.spanS), basis: t('ifh.basis.' + p.basis) }));
    bits.push(t('ifh.readAt', { when: _when(slot.cur.at) }));
    const tot = _totalsText(p);
    if (tot) bits.push(t('ifh.total', { list: tot }));
    if (p.below) bits.push(t('ifh.port.belowTip', { min: _num(s.min) }));
    bits.push(t('ifh.src'));
    return bits.map(_sentence).join(' ');
}

// La scheda per `node` (stringa vuota se non e' un apparato di rete, se non ha una lettura, o se i dati non sono ancora
// arrivati: in quel caso li chiede e ridisegna da sola). `open` = lo stato della fisarmonica, deciso dal pannello.
export function ifHealthCardHtml(node, open) {
    if (!_eligible(node)) return '';
    _tolpForNode(node.id);
    _sync();
    if (!_file) { ensureHealthLoaded(); return ''; }
    const slot = _dec()[node.id];
    if (!slot || !slot.cur) return '';
    const s = healthSummarizeIf(slot.prev, slot.cur, _thrFor(node.id));
    return `<details class="props-collapsible props-secondary pl-section" ${open ? 'open' : ''} data-toggle="props-section" data-section="if-health" data-ifh-nid="${escapeHTML(node.id)}"><summary class="props-collapsible-head"><span><i class="fas fa-heart-pulse"></i> ${escapeHTML(t('ifh.title'))}</span>${_previewHtml(s, slot)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-body">${_bodyHtml(s, slot, node)}</div></div></details>`;
}

// ── Il pannello della PORTA ──────────────────────────────────────────────────────
// La lettura di UNA interfaccia: l'apparato (di rete, con una lettura non vecchia), il nome dell'interfaccia, e un aumento fra le
// due letture (anche sotto la soglia dell'utente: nel pannello della porta non si nasconde niente). Una porta pulita non ha righe.
function _portFacts(node, ifName) {
    if (!_eligible(node) || ifName == null || String(ifName).trim() === '') return null;
    _sync();
    if (!_file) { ensureHealthLoaded(); return null; }
    const slot = _dec()[node.id];
    if (!slot || !slot.cur || Date.now() - slot.cur.at > STALE_MS) return null;   // una lettura vecchia non e' lo stato di adesso
    const s = healthSummarizeIf(slot.prev, slot.cur, _thrFor(node.id));
    if (s.state !== 'read') return null;
    const want = String(ifName).trim().toLowerCase();
    const p = s.ports.find(x => String(x.ifName).trim().toLowerCase() === want);
    if (!p || p.status !== 'ok' || (!p.grew.length && !p.below)) return null;
    return { s, slot, p };
}

// Le righe di salute di UNA porta, nel suo pannello: «Errori +21 errori in · +3 FCS» (DEDOTTO: la differenza fra due letture) e
// «Dall'avvio 171 errori in · 11 FCS» (MISURATO: i totali). Solo i fatti, senza frasi: il come lo dice il suggerimento della riga.
// Ambra se la soglia dell'utente (o l'assenza di una) segnala l'interfaccia, spenta se e' salita sotto la soglia.
export function ifHealthPortHtml(node, ifName) {
    const f = _portFacts(node, ifName);
    if (!f) return '';
    const { s, slot, p } = f;
    const total = [t('cty.measured') + ' — ' + t('ifh.total', { list: _totalsText(p) }), t('ifh.readAt', { when: _when(slot.cur.at) }), t('ifh.src')].map(_sentence).join(' ');
    return `<div class="pl-stack if-health-port" data-ifh-port="${escapeHTML(p.ifName)}"><div class="pl-grp">${healthRowHtml(t('ifh.port.errors'), _deltaText(p), { warn: p.grew.length > 0, mark: 'derived', wrap: true, tip: _ifTip(s, slot, p), tol: { nid: node.id, kind: 'err', key: p.ifName, on: _tolpIs(node.id, 'err', p.ifName) } })}${_tolpBuild(node, 'err', p.ifName)}${healthRowHtml(t('ifh.port.sinceBoot'), _totalsText(p), { mark: 'measured', wrap: true, tip: total })}</div></div>`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// SENSORI AMBIENTALI — la scheda, le soglie dell'utente, l'ingresso del Drift
// ═════════════════════════════════════════════════════════════════════════════════════════
const _thrAll = () => healthSanitizeThresholds(store.state && store.state.healthThresholds);   // quelle del progetto + le eccezioni degli apparati
const _thrFor = (nodeId) => healthThresholdsFor(store.state && store.state.healthThresholds, nodeId);   // quelle che valgono PER UN apparato
// C'e' almeno un apparato che ha pubblicato almeno un sensore?
const _anySensors = () => Object.values(_dec()).some(s => s.cur && Array.isArray(s.cur.sensors) && s.cur.sensors.length > 0);
// C'e' almeno un apparato con una lettura d'interfacce (cioe' qualcosa a cui applicare la soglia sugli errori)?
const _anyInterfaces = () => Object.values(_dec()).some(s => s.cur && Array.isArray(s.cur.rows) && s.cur.rows.length > 0);

// Le tolleranze dell'UTENTE (`state.healthThresholds`, nel progetto: una dichiarazione). Valgono solo dove l'apparato non dichiara una
// gravita' sua, e dove valgono la riga lo dice (`user_default`). Un testo che non e' una soglia valida la CANCELLA, non la inventa.
function _store(next) {
    if (next.temperature || next.ifErrors || next.nodes) store.state.healthThresholds = next; else delete store.state.healthThresholds;
}
function _knownIds() { return new Set((store.state.nodes || []).filter(n => n && n.id != null).map(n => String(n.id))); }

// Applica una modifica al PROGETTO (`scope` 'project') o a UNO o PIU' apparati (`scope` 'node', `nodeIds`): `fields` = { warn?, crit?, ifmin? },
// solo le chiavi presenti. UN solo passo di Annulla per tutta la modifica, e nessuno (ne' un salvataggio) se non cambia niente. La
// regola e' quella di `healthThresholdsApply` (lib), la stessa con cui il pannello «Tolleranza» annuncia l'effetto prima di scrivere.
// Gli apparati che non ci sono piu' perdono la loro eccezione. Ritorna true se ha cambiato.
export function applyHealthTolerances(scope, nodeIds, fields) {
    const before = JSON.stringify(_thrAll());
    const known = _knownIds();
    let next = _thrAll();
    if (scope === 'project') next = healthThresholdsApply(next, 'project', null, fields, known);
    else for (const id of (nodeIds || [])) next = healthThresholdsApply(next, 'node', id, fields, known);
    if (JSON.stringify(next) === before) return false;
    pushHistory();
    _store(next);
    markDirty();
    return true;
}
// Toglie le eccezioni di UNO o PIU' apparati («torna al progetto»), con un solo passo di Annulla.
export function clearHealthTolerances(nodeIds) {
    const before = JSON.stringify(_thrAll());
    const known = _knownIds();
    let next = _thrAll();
    for (const id of (nodeIds || [])) next = healthThresholdsClearNode(next, id, known);
    if (JSON.stringify(next) === before) return false;
    pushHistory();
    _store(next);
    markDirty();
    return true;
}
// Un campo del progetto (`key` = 'warn' | 'crit' | 'ifmin'). Si ridisegna SEMPRE il pannello: un testo che non e' una soglia (o «1» negli
// errori) cancella il campo, e il campo deve tornare a mostrare quello che e' stato tenuto, non quello che si era scritto.
export function setHealthThreshold(key, text) {
    if (key !== 'warn' && key !== 'crit' && key !== 'ifmin') return;
    applyHealthTolerances('project', null, { [key]: text });
    if (_repaint) _repaint();
}
registerChangeActions({ 'health-thr': (el) => setHealthThreshold(el.dataset.key, el.value) });
registerClickActions({
    // «torna al progetto» sulla riga di un'eccezione, nel pannello del progetto: si ridisegna (la riga sparisce)
    'health-thr-node-reset': (el) => { if (clearHealthTolerances([el.dataset.nid]) && _repaint) _repaint(); },
});

// ── Gli apparati a cui si applicano le tolleranze ──────────────────────────────────────────────
// Un apparato ENTRA se ha una lettura con qualcosa a cui applicare una soglia (un sensore di temperatura, delle interfacce) o se ha gia'
// una tolleranza propria (una gia' scritta si mostra sempre: va potuta cambiare o togliere). Versione LEGGERA, senza riepiloghi: il
// pannello del progetto ne ha bisogno a ogni disegno. La tabella ne chiede i dettagli (`healthToleranceRows`).
function _tolDevices() {
    const dec = _file ? _dec() : {};
    const own = _thrAll().nodes || {};
    const list = [];
    for (const n of (store.state.nodes || [])) {
        if (!n || n.id == null) continue;
        const id = String(n.id);
        const o = Object.prototype.hasOwnProperty.call(own, id) ? own[id] : null;
        const cur = dec[id] && dec[id].cur;
        const hasTemp = !!(cur && Array.isArray(cur.sensors) && cur.sensors.some(s => s.kind === 'temperature'));
        const hasIf = !!(cur && Array.isArray(cur.rows) && cur.rows.length > 0);
        if (!hasTemp && !hasIf && !o) continue;
        list.push({ n, id, own: o });
    }
    return list;
}

// I dati della TABELLA: per ogni apparato il nome, la sua tolleranza propria, quella che VALE, e la lettura di adesso (il sensore piu'
// caldo, e come stanno le interfacce con la sua tolleranza). Solo dati: il disegno e' di `src/app-tolerances.js`.
export function healthToleranceRows() {
    _sync();
    if (!_file) ensureHealthLoaded();
    const project = _thrAll(), dec = _file ? _dec() : {}, now = Date.now();
    const out = [];
    for (const d of _tolDevices()) {
        const slot = dec[d.id], cur = slot && slot.cur;
        const thr = _thrFor(d.id);
        let temp = null, ifs = null;
        if (cur && Array.isArray(cur.sensors)) {
            const hot = healthSummarizeSensors(cur, thr).items.filter(i => i.kind === 'temperature' && i.value !== null).sort((a, b) => b.value - a.value)[0];
            if (hot) temp = { value: hot.value, unit: hot.unit, severity: hot.severity, source: hot.source, label: hot.label };
        }
        if (cur && Array.isArray(cur.rows) && cur.rows.length) {
            const s = healthSummarizeIf(slot.prev, cur, thr);
            ifs = { state: s.state, grew: s.counts.grew, below: s.counts.below, first: s.state === 'read' && s.counts.noBaseline === s.counts.ports };
        }
        out.push({ id: d.id, name: String(d.n.name || d.id), type: d.n.type, ip: d.n.ip || '', own: d.own, eff: thr, temp, ifs, at: cur ? cur.at : null, stale: !!(cur && now - cur.at > STALE_MS) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, getLang(), { numeric: true, sensitivity: 'base' }) || (a.id < b.id ? -1 : 1));
    return { rows: out, project };
}

// ── Il pannello del PROGETTO: «Tolleranze» ─────────────────────────────────────────────────────
// I tre numeri di partenza, una riga ciascuno con l'unita'; la spiegazione sta nel «?» di ogni voce (non in due paragrafi). Sotto,
// le ECCEZIONI (poche: un apparato che fa eccezione), con il valore scritto in chiaro e il ritorno al progetto; e il bottone che apre
// la TABELLA di tutti gli apparati (src/app-tolerances.js), dove si rivede e si imposta tutto.
function _tolFieldRowHtml(key, label, sub, tip, val, unit, lim) {
    const sb = sub ? `<small>${escapeHTML(sub)}</small>` : '';
    return `<div class="tol-fr"><div class="tol-lb">${escapeHTML(label)}<span class="tol-info" data-tip="${escapeHTML(tip)}" data-tip-wrap>?</span>${sb}</div><input type="number" class="tol-in" min="${escapeHTML(String(lim.min))}" max="${escapeHTML(String(lim.max))}" step="1" value="${escapeHTML(val === null ? '' : String(val))}" placeholder="—" data-change="health-thr" data-key="${escapeHTML(key)}" aria-label="${escapeHTML(label)}"><span class="tol-un">${escapeHTML(unit)}</span></div>`;
}
// «avviso 45 · critica 55 °C · errori da 1 (ogni aumento)»: la tolleranza propria di un apparato, in chiaro.
function _tolSummaryText(own) {
    const bits = [];
    const tm = own && own.temperature;
    if (tm) {
        const tp = [];
        if (tm.warn !== null) tp.push(t('tol.sum.warn', { n: String(tm.warn) }));
        if (tm.crit !== null) tp.push(t('tol.sum.crit', { n: String(tm.crit) }));
        bits.push(tp.join(' · ') + ' °C');
    }
    if (own && own.ifErrors) bits.push(own.ifErrors.min === 1 ? t('tol.sum.errAll') : t('tol.sum.err', { n: _num(own.ifErrors.min) }));
    return bits.join(' · ');
}
export { _tolSummaryText as healthToleranceSummary };
function _tolExceptionsHtml(ids, byId, nDev) {
    const chunks = ids.map((id) => {
        const n = byId.get(id);
        const nm = String((n && n.name) || id);
        const reset = t('tol.reset');
        return `<div class="tol-ex"><button type="button" class="tol-ex-main" data-act="tol-open" data-nid="${escapeHTML(id)}" data-tip="${escapeHTML(t('tol.openRow'))}"><b>${escapeHTML(nm)}</b><small>${escapeHTML(_tolSummaryText(_thrAll().nodes[id]))}</small></button><button type="button" class="tol-ex-reset" data-act="health-thr-node-reset" data-nid="${escapeHTML(id)}" data-tip="${escapeHTML(reset)}" aria-label="${escapeHTML(reset)}"><i class="fas fa-rotate-left"></i></button></div>`;
    });
    return `<div class="tol-ex-h"><span>${escapeHTML(t('tol.exc.title', { n: _num(ids.length) }))}</span><span class="tol-mu">${escapeHTML(t('tol.exc.of', { n: _num(nDev) }))}</span></div>${chunks.join('')}`;
}
function _topPrevBits(all, nOwn) {
    const th = all.temperature, em = all.ifErrors ? all.ifErrors.min : null, bits = [];
    // Le eccezioni per prime: sono lo scarto dal predefinito, e se la riga e' stretta e il riassunto si taglia, si taglia in fondo (non in mezzo
    // a «eccezioni:»). Un numero non dichiarato non si scrive: «critica —» non diceva niente.
    if (nOwn) bits.push(t('ifh.dev.topN', { n: _num(nOwn) }));
    if (th && th.warn !== null) bits.push(t('ifh.thr.prevW', { n: String(th.warn) }));
    if (th && th.crit !== null) bits.push(t('ifh.thr.prevC', { n: String(th.crit) }));
    if (em !== null) bits.push(t('ifh.thr.prevErr', { n: _num(em) }));
    return bits;
}
export function healthThresholdsSectionHtml(open) {
    const all = _thrAll();
    const th = all.temperature || { warn: null, crit: null };
    const em = all.ifErrors ? all.ifErrors.min : null;
    const tset = th.warn !== null || th.crit !== null;
    const eset = em !== null;
    _sync();
    if (!_file) ensureHealthLoaded();
    const showTemp = tset || (!!_file && _anySensors());
    const showErr = eset || (!!_file && _anyInterfaces());
    const devs = _tolDevices();
    if (!showTemp && !showErr && !devs.length) return '';
    const byId = new Map(devs.map(d => [d.id, d.n]));
    const ownIds = devs.filter(d => d.own).map(d => d.id).sort((a, b) => String((byId.get(a) || {}).name || a).localeCompare(String((byId.get(b) || {}).name || b), getLang(), { numeric: true, sensitivity: 'base' }));
    const bits = _topPrevBits(all, ownIds.length);
    const preview = bits.length ? bits.join(' · ') : t('ifh.thr.none');
    const fields = [];
    if (showTemp) {
        fields.push(_tolFieldRowHtml('warn', t('tol.row.warn'), '', t('tol.tip.warn'), th.warn, '°C', { min: -50, max: 200 }));
        fields.push(_tolFieldRowHtml('crit', t('tol.row.crit'), '', t('tol.tip.crit'), th.crit, '°C', { min: -50, max: 200 }));
    }
    if (showErr) fields.push(_tolFieldRowHtml('ifmin', t('tol.row.err'), t('tol.row.errSub'), t('tol.tip.err'), em, t('tol.unit.more'), { min: 2, max: 1000000000 }));
    const grp = fields.length ? `<div class="pl-grp tol-grp">${fields.join('')}</div>` : '';
    const exc = ownIds.length ? _tolExceptionsHtml(ownIds, byId, devs.length) : '';
    const open2 = devs.length ? `<button type="button" class="toolbar-btn primary tol-open-btn" data-act="tol-open"><i class="fas fa-table-list"></i> ${escapeHTML(t('tol.openTable', { n: _num(devs.length) }))}</button>` : '';
    return `<details class="props-collapsible props-primary" ${open ? 'open' : ''} data-toggle="props-section" data-section="floor-health"><summary class="props-collapsible-head"><span><i class="fas fa-sliders"></i> ${escapeHTML(t('ifh.thr.title'))}</span><span class="props-collapsible-preview${bits.length ? '' : ' muted'}" data-ifh-prev="top">${escapeHTML(preview)}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-note">${escapeHTML(t('tol.intro'))}</div>${grp}${exc}${open2}</div></details>`;
}

const _numS = (x) => Number(x).toLocaleString(getLang(), { maximumFractionDigits: 2 });
function _senValue(it) {
    if (it.value === null) {
        // Solo-stato (alimentatore, ventola senza giri): il valore non c'e' per costruzione, e il valore della riga E' lo stato che dice
        // l'apparato («ok», «critico»…), colorato come ogni altro. Se non lo dice, «—»: non si inventa un «ok».
        if (it.unit) return t('ifh.sen.nd');
        // le due gravita' note si scrivono come nella sottoriga di una temperatura: CRITICO / ATTENZIONE, in maiuscolo
        if (it.state === 'critical') return t('ifh.sen.row.crit');
        if (it.state === 'warning') return t('ifh.sen.row.warn');
        return it.state && it.state !== 'unknown' ? t('ifh.sen.state.' + it.state) : '—';
    }
    const num = _numS(it.value) + (it.unit ? ' ' + it.unit : '');
    // la parola della gravita' sta PRIMA del numero, sulla stessa riga: «ATTENZIONE 48 °C»
    return it.severity ? t('ifh.sen.row.' + it.severity) + ' ' + num : num;
}
// Lo stato che colora la riga: la gravita' (dell'apparato o di una soglia tua) se c'e', altrimenti «ok» SOLO se l'apparato dice «ok».
// Un sensore di cui l'apparato non dice niente resta neutro: il verde e' un'affermazione.
function _senTone(it) {
    if (it.severity === 'crit') return 'crit';
    if (it.severity === 'warn') return 'warn';
    return it.state === 'ok' ? 'ok' : '';
}
// Cosa dice la riga sotto il valore: perche' (il limite superato o la parola dell'apparato) e i suoi limiti. La parola della gravita'
// (ATTENZIONE / CRITICO) sta nel valore, prima del numero; DA CHI viene (l'apparato o una soglia tua) non si scrive sulla riga: sta nel
// suggerimento. Su una temperatura senza altro da dire, sotto non resta niente.
function _senSub(it) {
    const parts = [];
    const soloStato = it.value === null && !it.unit;
    if (it.severity) {
        if (it.why === 'limit') {
            const lim = (it.limHi !== null && it.value > it.limHi) ? it.limHi : it.limLo;
            parts.push(t('ifh.sen.why.limit', { lim: _numS(lim) }));
        } else if (it.why === 'state' && it.state !== 'warning' && it.state !== 'critical' && !soloStato) {
            parts.push(t('ifh.sen.state.' + it.state));   // shutdown / non funziona: la parola dell'apparato, non solo «critico»
        }
    } else if (it.state !== 'ok' && it.state !== 'unknown' && !soloStato) {
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
// Quali sensori elencare: TUTTI quelli con una gravita' (fino al tetto), e degli altri al massimo SENSORS_PER_KIND per tipo, nell'ordine
// del riepilogo (temperatura: i piu' caldi). Senza il limite per tipo, uno switch con 226 sensori riempiva i 40 posti con le correnti
// dei moduli ottici e le temperature, le ventole e gli alimentatori dell'apparato finivano in «altri N».
function _senShown(items) {
    const shown = [], per = {};
    for (const it of items) {
        if (shown.length >= SENSORS_MAX) break;
        if (it.severity) { shown.push(it); continue; }
        per[it.kind] = (per[it.kind] || 0) + 1;
        if (per[it.kind] <= SENSORS_PER_KIND) shown.push(it);
    }
    return shown;
}
// Solo i fatti: un sensore per riga (nome, segno «misurato», valore colorato per stato). Il COME si sa passando sulla riga (da quale MIB
// e OID, quando, e chi decide la gravita'); niente titolo e niente frase finale. Fa eccezione una lettura VECCHIA: l'orario si dice a
// vista, perche' non e' lo stato di adesso.
function _senBodyHtml(sum, slot, node) {
    if (sum.state === 'not_available') {
        return `<div class="pl-stack"><div class="pl-grp"><div class="pl-gt">${healthMarkHtml('unread')}${escapeHTML(t('ifh.sen.grp'))}</div>${healthNoteHtml(t('ifh.sen.na'))}</div></div>`;
    }
    const lines = [];
    if (Date.now() - slot.cur.at > STALE_MS) lines.push(healthNoteHtml(t('ifh.readAt', { when: _when(slot.cur.at) })));
    const shown = _senShown(sum.items);
    for (const it of shown) {
        const tone = _senTone(it);
        const tip = [t('cty.measured') + ' — ' + t('ifh.sen.prov', { mib: it.mib || '?', oid: it.oid || '?' }), it.severity ? t('ifh.sen.tip.sev', { src: t('ifh.sen.src.' + it.source) }) : '', t('ifh.readAt', { when: _when(slot.cur.at) }), t('ifh.sen.src')].filter(Boolean).map(_sentence).join(' ');
        const tol = it.kind === 'temperature' && it.value !== null ? { nid: node.id, kind: 'temp', key: it.sid, on: _tolpIs(node.id, 'temp', it.sid) } : null;
        lines.push(healthRowHtml(it.label, _senValue(it), { crit: tone === 'crit', warn: tone === 'warn', ok: tone === 'ok', mark: 'measured', wrap: true, sub: _senSub(it), tip, tol }));
        if (tol) lines.push(_tolpBuild(node, 'temp', it.sid));
    }
    if (shown.length < sum.items.length) lines.push(healthNoteHtml(t('ifh.more', { n: _num(sum.items.length - shown.length) })));
    return `<div class="pl-stack"><div class="pl-grp">${lines.join('')}</div></div>`;
}

// La scheda «Sensori» dell'apparato (vuota se la lettura non ha il passo dei sensori: «non letti» non e' «nessuno»).
export function sensorsCardHtml(node, open) {
    if (!_eligible(node)) return '';
    _tolpForNode(node.id);
    _sync();
    if (!_file) { ensureHealthLoaded(); return ''; }
    const slot = _dec()[node.id];
    if (!slot || !slot.cur) return '';
    const sum = healthSummarizeSensors(slot.cur, _thrFor(node.id));
    if (sum.state === 'not_read') return '';
    return `<details class="props-collapsible props-secondary pl-section" ${open ? 'open' : ''} data-toggle="props-section" data-section="sensors-health" data-ifh-nid="${escapeHTML(node.id)}"><summary class="props-collapsible-head"><span><i class="fas fa-temperature-half"></i> ${escapeHTML(t('ifh.sen.title'))}</span>${_senPreviewHtml(sum)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-body">${_senBodyHtml(sum, slot, node)}</div></div></details>`;
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
    const dec = _dec(), now = Date.now(), list = [];
    for (const n of (nodes || [])) {
        const slot = n && dec[n.id];
        if (!slot || !slot.cur || now - slot.cur.at > STALE_MS) continue;
        const sum = healthSummarizeSensors(slot.cur, _thrFor(n.id));
        if (sum.state !== 'read') continue;
        for (const it of sum.items) {
            if (!it.severity) continue;
            list.push({ nodeId: n.id, label: n.name || n.id, sid: it.sid, sensor: it.label, kind: it.kind, value: it.value, unit: it.unit, state: it.state,
                severity: it.severity, severitySource: it.source, why: it.why, limLo: it.limLo, limHi: it.limHi, mib: it.mib, oid: it.oid, at: sum.at });
        }
    }
    return list;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// IL PANNELLO «TOLLERANZA» — si apre sulla riga che avvisa (temperatura, interfaccia) e regola la tolleranza DA LI'
// ═════════════════════════════════════════════════════════════════════════════════════════
// Il problema si vede sulla scheda dell'apparato («avviso — soglia tua»): da li' si regola, senza tornare al progetto e cercare la riga.
// Il pannello mostra la lettura di adesso su una SCALA (dove cade rispetto alle tolleranze), scrive l'EFFETTO prima di applicare (calcolato
// con la STESSA funzione che poi scrive: `healthThresholdsApply`, cosi' non puo' divergere) e chiede la PORTATA: solo questo apparato
// (predefinita) o tutto il progetto. Una sola riga aperta alla volta. La bozza (numeri e portata) sta qui, cosi' un ridisegno del
// pannello (un Sync che finisce) non la perde.
let _tolp = null;   // { nid, kind: 'temp' | 'err', key, scope: 'node' | 'project', draft: { warn, crit, ifmin } }
const _tolpIs = (nid, kind, key) => !!(_tolp && _tolp.nid === String(nid) && _tolp.kind === kind && _tolp.key === key);
const _tolStr = (v) => (v === null || v === undefined ? '' : String(v));
// Cambiando apparato la bozza non lo segue: chi disegna le schede di un altro apparato la chiude.
function _tolpForNode(nid) { if (_tolp && _tolp.nid !== String(nid)) _tolp = null; }

// Il contesto della riga aperta: l'apparato, la sua lettura e la riga (sensore o interfaccia). null se la lettura non c'e' piu'.
function _tolpCtx() {
    if (!_tolp || !_file) return null;
    const node = (store.state.nodes || []).find(n => n && String(n.id) === _tolp.nid);
    const slot = node ? _dec()[node.id] : null;
    if (!node || !slot || !slot.cur) return null;
    if (_tolp.kind === 'temp') {
        const row = (slot.cur.sensors || []).find(s => s.sid === _tolp.key);
        return row ? { node, slot, row } : null;
    }
    const s = healthSummarizeIf(slot.prev, slot.cur, _thrFor(node.id));
    const p = s.state === 'read' ? s.ports.find(x => x.ifName === _tolp.key) : null;
    return p ? { node, slot, p } : null;
}
// Le tolleranze come sarebbero DOPO aver applicato la bozza (la funzione della libreria che poi scrive).
function _tolpHypo(ctx) {
    const d = _tolp.draft;
    const fields = _tolp.kind === 'temp' ? { warn: d.warn, crit: d.crit } : { ifmin: d.ifmin };
    return _tolp.scope === 'project'
        ? healthThresholdsApply(store.state.healthThresholds, 'project', null, fields, _knownIds())
        : healthThresholdsApply(store.state.healthThresholds, 'node', ctx.node.id, fields, _knownIds());
}
// L'effetto, a parole: cosa cambia per QUESTO apparato (portata «solo lui») o per quanti apparati (portata «progetto»).
function _tolpEffectText(ctx) {
    const name = String(ctx.node.name || ctx.node.id);
    const hyp = _tolpHypo(ctx);
    const dec = _dec();
    if (_tolp.kind === 'temp') {
        if (_tolp.scope === 'project') {
            let n = 0, m = 0;
            for (const d of _tolDevices()) {
                const temps = ((dec[d.id] && dec[d.id].cur && dec[d.id].cur.sensors) || []).filter(s => s.kind === 'temperature');
                if (!temps.length || (d.own && d.own.temperature)) continue;   // chi ha una temperatura propria non e' toccato dal progetto
                n++;
                const thr = healthThresholdsFor(hyp, d.id);
                if (temps.some(s => healthSensorSeverity(s, thr).severity)) m++;
            }
            return t('tol.fx.project', { n: _num(n), m: _num(m) });
        }
        if (ctx.row.value === null) return t('tol.fx.noValue', { name });
        const word = (sv) => t('tol.fx.state.' + (sv || 'ok'));
        const before = healthSensorSeverity(ctx.row, _thrFor(ctx.node.id)).severity;
        const after = healthSensorSeverity(ctx.row, healthThresholdsFor(hyp, ctx.node.id)).severity;
        return (before === after ? t('tol.fx.same', { name, state: word(after) }) : t('tol.fx.change', { name, was: word(before), now: word(after) })) + ' ' + t('tol.fx.others');
    }
    if (_tolp.scope === 'project') {
        let n = 0;
        for (const d of _tolDevices()) { const cur = dec[d.id] && dec[d.id].cur; if (cur && Array.isArray(cur.rows) && cur.rows.length && !(d.own && d.own.ifErrors)) n++; }
        return t('tol.fx.if.projectN', { n: _num(n) });
    }
    const max = HEALTH_IF_COUNTERS.reduce((mx, k) => Math.max(mx, ctx.p.deltas && ctx.p.deltas[k] > 0 ? ctx.p.deltas[k] : 0), 0);
    const aft = healthThresholdsFor(hyp, ctx.node.id).ifErrors;
    const min = aft ? aft.min : 1;
    const par = { name: ctx.p.ifName, max: _num(max), min: _num(min) };
    const msg = min <= 1 ? t('tol.fx.if.all', par) : (max >= min ? t('tol.fx.if.shown', par) : t('tol.fx.if.hidden', par));
    return msg + ' ' + t('tol.fx.others');
}
function _tolpFxHtml(ctx) {
    return `<b>${escapeHTML(t('tol.fx.label'))}</b> ${escapeHTML(_tolpEffectText(ctx))}`;
}
// La SCALA della temperatura: zone (a posto, avviso, critica) e segni (ora, avviso, critica, progetto), tutte percentuali della libreria.
const _tolPc = (n) => escapeHTML(String(Math.round(n * 10) / 10));
function _tolpBarHtml(ctx) {
    const hyp = _tolpHypo(ctx);
    const after = healthThresholdsFor(hyp, ctx.node.id).temperature || { warn: null, crit: null };
    const pr = _thrAll().temperature;
    const m = healthScaleModel({ value: ctx.row.value, warn: after.warn, crit: after.crit, projectWarn: pr ? pr.warn : null });
    const zones = m.zones.map(z => `<span class="tolp-z ${escapeHTML(z.kind)}" style="left:${_tolPc(z.from)}%;width:${_tolPc(z.to - z.from)}%"></span>`);
    const marks = m.marks.map((k) => {
        if (k.kind === 'now') return `<span class="tolp-mk now" style="left:${_tolPc(k.at)}%"></span><span class="tolp-lb top now" style="left:${_tolPc(k.at)}%">${escapeHTML(t('tol.p.markNow', { v: _numS(k.value) }))}</span>`;
        if (k.kind === 'project') return `<span class="tolp-mk proj" style="left:${_tolPc(k.at)}%"></span><span class="tolp-lb top" style="left:${_tolPc(Math.min(k.at + 9, 90))}%">${escapeHTML(t('tol.p.markProject', { v: _numS(k.value) }))}</span>`;
        return `<span class="tolp-lb bot" style="left:${_tolPc(k.at)}%">${escapeHTML(_numS(k.value))}</span>`;
    });
    return `<div class="tolp-bar" role="img" aria-label="${escapeHTML(t('tol.p.scale'))}">${zones.join('')}${marks.join('')}</div>`;
}
function _tolpFieldHtml(field, label, lim, place, val) {
    return `<div><label class="tolp-fl">${escapeHTML(label)}</label><input type="number" class="tol-in tolp-in" min="${escapeHTML(String(lim.min))}" max="${escapeHTML(String(lim.max))}" step="1" value="${escapeHTML(val)}" placeholder="${escapeHTML(place === '' ? '—' : place)}" data-input="tolp-input" data-field="${escapeHTML(field)}" aria-label="${escapeHTML(label)}"></div>`;
}
// «Vuoto = come il progetto (avviso 60, critica —)»
function _tolpInheritText() {
    const pj = _thrAll();
    if (_tolp.kind === 'temp') {
        const tm = pj.temperature || { warn: null, crit: null };
        return t('tol.p.inherit', { value: t('tol.sum.warn', { n: tm.warn === null ? '—' : String(tm.warn) }) + ', ' + t('tol.sum.crit', { n: tm.crit === null ? '—' : String(tm.crit) }) });
    }
    return t('tol.p.inherit', { value: pj.ifErrors ? t('tol.sum.err', { n: _num(pj.ifErrors.min) }) : t('tol.p.inheritNone') });
}
// La riga della lettura di adesso («CPU · ora 48 °C ● letta alle 15:42», colorata per gravita').
function _tolpNowHtml(ctx) {
    const when = new Date(ctx.slot.cur.at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
    if (_tolp.kind === 'temp') {
        const sev = healthSensorSeverity(ctx.row, _thrFor(ctx.node.id)).severity;
        const tone = sev === 'crit' ? 'c' : (sev === 'warn' ? 'w' : 'g');
        const val = ctx.row.value === null ? '—' : _numS(ctx.row.value) + (ctx.row.unit ? ' ' + ctx.row.unit : '');
        return `<div class="tolp-now ${escapeHTML(tone)}">${escapeHTML(t('tol.p.nowTemp', { label: ctx.row.label, value: val }))} ${_markDotHtml('measured')} <small>${escapeHTML(t('tol.p.readAt', { when }))}</small></div>`;
    }
    return `<div class="tolp-now w">${escapeHTML(t('tol.p.nowIf', { label: ctx.p.ifName, value: _deltaText(ctx.p) || '—' }))} ${_markDotHtml('derived')} <small>${escapeHTML(t('tol.p.readAt', { when }))}</small></div>`;
}
// I campi: avviso e critica per la temperatura, «errori da» per l'interfaccia. Il segnaposto e' il valore del progetto.
function _tolpFieldsHtml() {
    const d = _tolp.draft, pj = _thrAll();
    if (_tolp.kind === 'temp') {
        const tm = pj.temperature || { warn: null, crit: null };
        return `<div class="tolp-row2">${_tolpFieldHtml('warn', t('tol.p.warn'), { min: -50, max: 200 }, _tolStr(tm.warn), d.warn)}${_tolpFieldHtml('crit', t('tol.p.crit'), { min: -50, max: 200 }, _tolStr(tm.crit), d.crit)}</div>`;
    }
    return `<div class="tolp-row2">${_tolpFieldHtml('ifmin', t('tol.p.errMin'), { min: _tolp.scope === 'project' ? 2 : 1, max: 1000000000 }, _tolStr(pj.ifErrors ? pj.ifErrors.min : null), d.ifmin)}</div>`;
}
function _tolpBarWrapHtml(ctx) {
    if (_tolp.kind !== 'temp' || ctx.row.value === null) return '';
    return `<div data-tolp-bar>${_tolpBarHtml(ctx)}</div>`;
}
// La portata: «Solo SW-CORE» / «Tutto il progetto».
function _tolpSegHtml(name) {
    const nodeOn = _tolp.scope === 'node';
    return `<div class="tolp-seg" role="group" aria-label="${escapeHTML(t('tol.p.scope'))}"><button type="button" class="${nodeOn ? 'on' : ''}" aria-pressed="${nodeOn ? 'true' : 'false'}" data-act="tolp-scope" data-scope="node">${escapeHTML(t('tol.p.scopeNode', { name }))}</button><button type="button" class="${nodeOn ? '' : 'on'}" aria-pressed="${nodeOn ? 'false' : 'true'}" data-act="tolp-scope" data-scope="project">${escapeHTML(t('tol.p.scopeProject'))}</button></div>`;
}
// Il pannello intero (vuoto se la lettura della riga non c'e' piu').
function _tolpBuild(node, kind, key) {
    if (node && !_tolpIs(node.id, kind, key)) return '';   // chiamato da una riga: il pannello e' solo sotto QUELLA riga
    const ctx = _tolpCtx();
    if (!ctx) return '';
    const name = String(ctx.node.name || ctx.node.id);
    return `<div class="tolp" data-tolp><div class="tolp-h"><span>${escapeHTML(t('tol.p.title', { name }))}</span><button type="button" class="tolp-x" data-act="tolp-close" aria-label="${escapeHTML(t('tol.p.close'))}"><i class="fas fa-times"></i></button></div>${_tolpNowHtml(ctx)}${_tolpBarWrapHtml(ctx)}${_tolpFieldsHtml()}<div class="tolp-mu">${escapeHTML(_tolpInheritText())}</div><div class="tolp-fl" style="margin-top:8px">${escapeHTML(t('tol.p.scope'))}</div>${_tolpSegHtml(name)}<div class="tolp-fx" data-tolp-fx>${_tolpFxHtml(ctx)}</div><div class="tolp-foot"><button type="button" class="toolbar-btn primary" data-act="tolp-apply">${escapeHTML(t('tol.p.apply'))}</button><button type="button" class="toolbar-btn" data-act="tolp-close">${escapeHTML(t('tol.p.cancel'))}</button><button type="button" class="tolp-all" data-act="tol-open" data-nid="${escapeHTML(ctx.node.id)}">${escapeHTML(t('tol.p.all'))}</button></div></div>`;
}
// Mentre si scrive: si riscrivono solo l'effetto e la scala (i campi, e il fuoco, restano).
function _tolpLive(el) {
    const ctx = _tolpCtx(), root = el.closest('[data-tolp]');
    if (!ctx || !root) return;
    const fx = root.querySelector('[data-tolp-fx]'); if (fx) fx.innerHTML = _tolpFxHtml(ctx);
    const bar = root.querySelector('[data-tolp-bar]'); if (bar && _tolp.kind === 'temp') bar.innerHTML = _tolpBarHtml(ctx);
}
registerClickActions({
    'tolp-toggle': (el) => {
        const nid = el.dataset.nid, kind = el.dataset.kind, key = el.dataset.key;
        if (_tolpIs(nid, kind, key)) _tolp = null;
        else {
            const eff = _thrFor(nid);
            _tolp = { nid: String(nid), kind, key, scope: 'node', draft: { warn: _tolStr(eff.temperature ? eff.temperature.warn : null), crit: _tolStr(eff.temperature ? eff.temperature.crit : null), ifmin: _tolStr(eff.ifErrors ? eff.ifErrors.min : null) } };
        }
        if (_repaint) _repaint();
    },
    'tolp-close': () => { _tolp = null; if (_repaint) _repaint(); },
    // la portata cambia anche il segnaposto, il limite del campo e l'effetto: si riscrive il pannello (la bozza sta in `_tolp`)
    'tolp-scope': (el) => {
        if (!_tolp) return;
        _tolp.scope = el.dataset.scope === 'project' ? 'project' : 'node';
        const root = el.closest('[data-tolp]');
        if (root) root.outerHTML = _tolpBuild();
    },
    'tolp-apply': () => {
        if (!_tolp) return;
        const d = _tolp.draft;
        const fields = _tolp.kind === 'temp' ? { warn: d.warn, crit: d.crit } : { ifmin: d.ifmin };
        applyHealthTolerances(_tolp.scope, _tolp.scope === 'node' ? [_tolp.nid] : null, fields);
        _tolp = null;
        if (_repaint) _repaint();
    },
});
registerInputActions({
    'tolp-input': (el) => {
        if (!_tolp || !(el.dataset.field in _tolp.draft)) return;
        _tolp.draft[el.dataset.field] = el.value;
        _tolpLive(el);
    },
});

// Solo per i test: ripulisce la memoria.
export function _healthReset() { _pid = null; _file = null; _decoded = null; _loading = null; _retryAt = 0; _repaint = null; }
// Solo per i test: mette in memoria un file.
export function _healthSetFile(f, pid) { _pid = pid === undefined ? store.currentProjectId : pid; _setFile(f); }
