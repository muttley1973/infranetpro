// ============================================================
// VICINI NON PIU' RIFERITI — la memoria dei vicini LLDP/CDP, il sidecar, la scheda e l'ingresso del Drift
// ============================================================
// Ogni Sync completo legge dai dispositivi i vicini che dichiarano LLDP/CDP (la fase topologia) e li lascia in
// `store._topoNeighborsCache`, che si RISCRIVE a ogni giro. Qui si prende QUELLA cache (nessuna lettura SNMP in piu', nessun
// cambio alla scoperta o alla fusione), si manda al sidecar `history/<id>/neighbors.json` e si dice quali vicini noti non si sentono
// piu' da N letture sane di fila. La logica (cosa conta come silenzio, spostato, porta giu', apparato muto) e' in
// lib/neighbor-store.js e ha i suoi test; qui c'e' la raccolta e il disegno.
//
// ── Cosa NON fa, di proposito ──────────────────────────────────────────────────
//   • non scrive NIENTE nel documento (la cache di sessione resta `derived`, il sidecar e' una misura fuori dal progetto);
//   • non dice «cavo tolto» ne' «apparato guasto»: dice che un vicino non e' riferito (silenzio ≠ contraddizione, come
//     `detectMiscabling`); e' una riga INFORMATIVA, non una divergenza dal documento;
//   • non conta un silenzio dove la lettura non e' riuscita: entrano solo gli apparati riletti IN QUESTO giro (`ts` della cache);
//   • non rifa quello che gia' fanno le porte giu' e il cavo fantasma: una porta locale giu' non genera una riga;
//   • non guarda l'ARP: lo stato ARP lo pubblica un apparato su sei, e l'ARP mancante e' il lavoro del motore di presenza.
// Solo amministratori, come lo storico. Foglia: non importa app.js ne' app-properties.js; il pannello importa lui questo, e per
// ridisegnarsi a dati arrivati si registra una funzione da fuori (`setNeighborsRepaint`).

import { t, getLang } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML } from './app-util.js';
import { hasSnmpTarget } from '../lib/snmp-target.js';
import { neighborFold, neighborDecodeFile, neighborSanitizePut, neighborSummarize, NEIGHBOR_PROTOCOLS } from '../lib/neighbor-store.js';
import { ifOperOf, healthRowHtml, healthNoteHtml, healthMarkHtml } from './app-health.js';

const STALE_MS = 24 * 3600 * 1000;   // le letture dei vicini seguono i giri COMPLETI, piu' radi: oltre un giorno non e' lo stato di adesso
const LIST_MAX = 12;

let _pid = null, _file = null, _decoded = null, _loading = null, _retryAt = 0, _repaint = null;
const _isViewer = () => !!(store._currentUser && store._currentUser.role === 'viewer');
export function setNeighborsRepaint(fn) { _repaint = typeof fn === 'function' ? fn : null; }

function _sync() {
    if (_pid !== store.currentProjectId) { _pid = store.currentProjectId; _file = null; _decoded = null; _loading = null; _retryAt = 0; }
}
function _setFile(f) { _file = f; _decoded = null; }
function _dec() { if (!_decoded) _decoded = neighborDecodeFile(_file); return _decoded; }

export function ensureNeighborsLoaded() {
    _sync();
    if (_file) return Promise.resolve(_file);
    if (_loading) return _loading;
    const pid = _pid;
    if (!pid || _isViewer() || typeof fetch !== 'function' || Date.now() < _retryAt) return Promise.resolve(null);
    _loading = fetch(`/api/projects/${encodeURIComponent(pid)}/history/neighbors`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
            if (pid !== _pid) return null;
            if (j && j.neighbors && typeof j.neighbors === 'object') { _setFile(j.neighbors); if (_repaint) _repaint(); return _file; }
            _retryAt = Date.now() + 30000;
            return null;
        })
        .catch(() => { _retryAt = Date.now() + 30000; return null; })
        .finally(() => { _loading = null; });
    return _loading;
}

// Dopo la fase topologia di un Sync: registra i vicini degli apparati riletti DA `sinceMs` (l'inizio del giro). Un apparato la cui
// lettura non e' riuscita (o ha risposto un'altra unita' dello stesso cluster) NON ha una cache nuova, quindi non entra: nessun
// silenzio inventato. Ritorna quanti apparati ha registrato.
export async function recordNeighbors(sinceMs) {
    _sync();
    if (_isViewer() || typeof fetch !== 'function') return 0;
    const cache = store._topoNeighborsCache || {};
    const known = new Set((store.state.nodes || []).filter(n => n && n.id != null).map(n => n.id));
    const put = { nodes: {} };
    for (const id of Object.keys(cache)) {
        const e = cache[id];
        if (!e || typeof e.ts !== 'number' || e.ts < sinceMs || !known.has(id)) continue;
        put.nodes[id] = { at: e.ts, neighbors: Array.isArray(e.neighbors) ? e.neighbors : [] };
    }
    const clean = neighborSanitizePut(put);
    const n = Object.keys(clean.nodes).length;
    if (!n) return 0;
    await ensureNeighborsLoaded();   // per fondere sul file giusto; se manca, la fusione del server resta l'autorita'
    _setFile(neighborFold(_file || { v: 1, nodes: {} }, clean));
    try {
        if (_pid) {
            fetch(`/api/projects/${encodeURIComponent(_pid)}/history/neighbors`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(put),
            }).catch(() => {});
        }
    } catch (_) { /* best-effort */ }
    return n;
}

// Il riepilogo di UN apparato, con lo stato della porta locale preso dalla lettura delle interfacce dello stesso Sync.
function _summary(node) {
    if (!_file) return null;
    const slot = _dec()[node.id];
    if (!slot) return null;
    return { slot, sum: neighborSummarize(slot, { portState: (ifName) => ifOperOf(node.id, ifName) }) };
}

const _when = (ms) => new Date(ms).toLocaleString(getLang());
const _num = (n) => Number(n).toLocaleString(getLang());

function _bodyHtml(sum) {
    const lines = [];
    if (sum.deviceSilent) {
        lines.push(healthNoteHtml(t('nb.deviceSilent', { n: _num(sum.silentCount), when: _when(sum.lastHeardAt) })));
    } else {
        for (const g of sum.groups.slice(0, LIST_MAX)) {
            const via = g.protos.join('/') + (g.ports.length ? ' · ' + g.ports.join(', ') : '');
            const port = g.portState === 'up' ? t('nb.port.up') : t('nb.port.unknown');
            lines.push(healthRowHtml(g.remoteName || g.remoteId, g.localIf, { warn: true, sub: `${t('nb.lastHeard', { when: _when(g.lastAt), n: _num(g.misses) })} · ${port}`, tip: via }));
        }
        if (sum.groups.length > LIST_MAX) lines.push(healthNoteHtml(t('ifh.more', { n: _num(sum.groups.length - LIST_MAX) })));
    }
    lines.push(healthNoteHtml(t('nb.src')));
    return `<div class="pl-stack"><div class="pl-grp"><div class="pl-gt">${healthMarkHtml('derived')}${escapeHTML(t('nb.grp'))}</div>${lines.join('')}</div></div>`;
}

// La scheda «Vicini non riferiti»: compare SOLO se c'e' qualcosa da dire (un apparato con tutti i vicini che tacciono, o singoli
// vicini silenziosi). In una rete a posto non occupa il pannello. `open` = lo stato della fisarmonica, deciso dal pannello.
export function neighborsCardHtml(node, open) {
    if (!node || !hasSnmpTarget(node)) return '';
    _sync();
    if (!_file) { ensureNeighborsLoaded(); return ''; }
    const r = _summary(node);
    if (!r || (!r.sum.deviceSilent && !r.sum.groups.length)) return '';
    const sum = r.sum;
    const prev = sum.deviceSilent ? t('nb.prev.device') : t('nb.prev.n', { n: _num(sum.groups.length) });
    return `<details class="props-collapsible props-secondary pl-section" ${open ? 'open' : ''} data-toggle="props-section" data-section="neighbors-health" data-ifh-nid="${escapeHTML(node.id)}"><summary class="props-collapsible-head"><span><i class="fas fa-link-slash"></i> ${escapeHTML(t('nb.title'))}</span><span class="props-collapsible-preview pl-warn">${escapeHTML(prev)}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pl-body">${_bodyHtml(sum)}</div></div></details>`;
}

// Per il Drift: i vicini silenziosi (e gli apparati che non ne riferiscono piu') degli apparati letti di recente. Ingresso
// `snmp.neighborLost` di buildDriftReport. Ogni riga dice da quale protocollo, da quale OID e quando.
export function neighborDriftInput(nodes) {
    _sync();
    if (!_file) return [];
    const now = Date.now();
    const list = [];
    for (const n of (nodes || [])) {
        const r = n && _summary(n);
        if (!r || now - r.slot.at > STALE_MS) continue;
        const { sum } = r;
        const label = n.name || n.id;
        if (sum.deviceSilent) {
            list.push({ nodeId: n.id, label, kind: 'device', silentCount: sum.silentCount, lastAt: sum.lastHeardAt, at: r.slot.at, protos: ['LLDP', 'CDP'], oid: '' });
            continue;
        }
        for (const g of sum.groups) {
            list.push({ nodeId: n.id, label, kind: 'neighbor', localIf: g.localIf, remoteId: g.remoteId, remoteName: g.remoteName, ports: g.ports.slice(), protos: g.protos.slice(),
                firstAt: g.firstAt, lastAt: g.lastAt, misses: g.misses, portState: g.portState, at: r.slot.at, oid: NEIGHBOR_PROTOCOLS[g.protos[0]] ? NEIGHBOR_PROTOCOLS[g.protos[0]].oid : '' });
        }
    }
    return list;
}

// Solo per i test.
export function _neighborsReset() { _pid = null; _file = null; _decoded = null; _loading = null; _retryAt = 0; _repaint = null; }
