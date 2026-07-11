// ============================================================
// LEASE DHCP — gestione multi-fonte persistita + aggancio alla Verifica
// ============================================================
// I lease DHCP danno il legame IP↔MAC su TUTTE le VLAN (il pezzo che l'ARP
// locale non vede dietro un firewall L3). Qui si GESTISCONO le fonti: ogni
// DHCP server (incolla/file = free, o pull live = driver-pack a pagamento) è
// una FONTE in state.dhcpSources (persistita nel progetto, una per server). Il
// set UNITO e dedup per-MAC alimenta il motore Verifica via store._dhcpLeases
// (cache derivata, ricalcolata da _dhcpSyncLeases). Si accumula da più server,
// si vede la tabella con freschezza, si toglie un lease/una fonte/tutto e si
// rilancia la Verifica. Parsing nel lib puro lib/dhcp-lease.js. La sezione live
// appare solo se il server ha driver installati (GET /api/dhcp-drivers).
import { expose, t, parseDhcpLeases } from './_bridge.js';
import { store } from './store.js';
import { _showToast, markDirty, _dhcpSyncLeases } from './app.js';
import { registerChangeActions, registerInputActions } from './app-delegation.js';   // ASSE B: event delegation (change/input)

// Etichette credenziali per-vendor (id → [campo, label]); combaciano coi driver
// server/dhcp-drivers/vendor/*. Solo per la UI del pull live (pack a pagamento).
const _DHCP_CREDS = {
    fortigate: [['token', 'API token']],
    panos: [['apikey', 'API key']],
    opnsense: [['key', 'API key'], ['secret', 'API secret']],
    mikrotik: [['user', 'Username'], ['pass', 'Password']],
};
const _FMT_LABEL = { 'isc': 'ISC dhcpd', 'dnsmasq': 'dnsmasq', 'kea-csv': 'Kea', 'csv': 'CSV' };
const _creds = id => _DHCP_CREDS[id] || [['token', 'API token']];

// Set "in staging": appena parsato (incolla o pull live), non ancora aggiunto
// come fonte. live = { vendor, host, port, label } se da pull live, null se incolla.
let _staged = { leases: [], format: '', live: null };
// Quando si rinnova una fonte live esistente, il prossimo "Aggiungi" la SOSTITUISCE.
let _refreshId = null;

// Escape HTML minimale per i valori dinamici resi nella tabella (hostname dai
// lease = dato non fidato). I MAC/id usati negli onclick sono hex/generati → no quote.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function _ensureSources() {
    if (!store.state) return [];
    if (!Array.isArray(store.state.dhcpSources)) store.state.dhcpSources = [];
    return store.state.dhcpSources;
}
// Ogni mutazione delle fonti: ricalcola la cache derivata (store._dhcpLeases) e
// marca il progetto sporco (persistenza nel JSON al prossimo salvataggio).
function _commit() { _dhcpSyncLeases(); markDirty(); }
function _newId() { return 'dhcp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function _liveKey(live) { return 'live:' + live.vendor + '@' + live.host; }
function _fmtWhen(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString(); }
function _sourceLabel(st) {
    if (st.live) return `${st.live.label || st.live.vendor} · ${st.live.host}`;
    const sub = (st.leases[0] && st.leases[0].subnet) ? ` · ${st.leases[0].subnet}.x` : '';
    return `${st.format || '?'}${sub}`;
}

async function openDhcpImport() {
    _refreshId = null;
    _clearStaging();
    const err = document.getElementById('dhcp-errors'); if (err) err.textContent = '';
    document.getElementById('dhcp-overlay').classList.add('open');
    await _populateDhcpVendors();   // i vendor live arrivano dal server (pack o no)
    renderDhcpSources();
}
function closeDhcpImport() { document.getElementById('dhcp-overlay').classList.remove('open'); }

// Mostra la sezione "pull live" solo se il server ha driver installati (pack).
async function _populateDhcpVendors() {
    const section = document.getElementById('dhcp-live-section');
    let list = [];
    try { const r = await fetch('/api/dhcp-drivers'); const d = await r.json(); if (d && d.ok) list = d.drivers || []; } catch (_) { /* offline */ }
    if (!list.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    document.getElementById('dhcp-live-vendor').innerHTML = list.map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('');
    updateDhcpVendorFields();
}

function loadDhcpFile(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('dhcp-textarea').value = e.target.result; previewDhcp(); input.value = ''; };
    reader.readAsText(file);
}

// File/incolla → parse → staging (fonte di tipo "incolla", live=null).
function previewDhcp() {
    const raw = (document.getElementById('dhcp-textarea').value || '').trim();
    const err = document.getElementById('dhcp-errors'); if (err) err.textContent = '';
    if (!raw) { _stage([], '', null); return; }
    const parsed = parseDhcpLeases(raw, 'auto');
    if (!parsed.leases.length) { _stage([], '', null); if (err) err.textContent = t('dhcp.noLeases'); return; }
    _refreshId = null;   // un incolla manuale non rinnova una fonte live
    _stage(parsed.leases, _FMT_LABEL[parsed.format] || t('dhcp.fmtUnknown'), null);
}

function updateDhcpVendorFields() {
    const creds = _creds(document.getElementById('dhcp-live-vendor').value);
    document.getElementById('dhcp-cred1-label').textContent = creds[0][1];
    const wrap2 = document.getElementById('dhcp-cred2-wrap');
    if (creds[1]) { wrap2.style.display = 'inline-flex'; document.getElementById('dhcp-cred2-label').textContent = creds[1][1]; }
    else { wrap2.style.display = 'none'; document.getElementById('dhcp-live-cred2').value = ''; }
}

// Pull live (pack): il server interroga l'API del vendor → staging (fonte live).
async function fetchDhcpLive() {
    const sel = document.getElementById('dhcp-live-vendor');
    const vendor = sel.value;
    const vendorLabel = (sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].text) || vendor;
    const creds = _creds(vendor);
    const host = (document.getElementById('dhcp-live-host').value || '').trim();
    const err = document.getElementById('dhcp-errors');
    if (!host) { _stage([], '', null); err.textContent = t('dhcp.hostRequired'); return; }
    const cfg = { vendor, host, insecureTLS: document.getElementById('dhcp-live-insecure').checked };
    const port = parseInt(document.getElementById('dhcp-live-port').value, 10);
    if (Number.isFinite(port)) cfg.port = port;
    cfg[creds[0][0]] = document.getElementById('dhcp-live-cred1').value;
    if (creds[1]) cfg[creds[1][0]] = document.getElementById('dhcp-live-cred2').value;
    const btn = document.getElementById('dhcp-live-fetch');
    const prev = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${t('dhcp.fetching')}`;
    try {
        const r = await fetch('/api/dhcp-leases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
        const d = await r.json();
        if (!d || !d.ok) { _stage([], '', null); err.textContent = t('dhcp.fetchErr', { e: (d && d.error) || '?' }); return; }
        _stage(d.leases || [], vendorLabel, { vendor, host, port: Number.isFinite(port) ? port : '', label: vendorLabel });
    } catch (e) { _stage([], '', null); err.textContent = t('dhcp.fetchErr', { e: String(e && e.message || e) }); }
    finally { btn.disabled = false; btn.innerHTML = prev; }
}

// Stato "lease in staging" (condiviso da incolla e pull live).
function _stage(leases, fmtLabel, live) {
    _staged = { leases: leases || [], format: fmtLabel || '', live: live || null };
    const sum = document.getElementById('dhcp-summary');
    const btn = document.getElementById('dhcp-use-btn');
    if (btn) btn.disabled = _staged.leases.length === 0;
    if (sum) sum.textContent = _staged.leases.length ? t('dhcp.staged', { n: _staged.leases.length, fmt: fmtLabel }) : '';
}
function _clearStaging() {
    _staged = { leases: [], format: '', live: null };
    const ta = document.getElementById('dhcp-textarea'); if (ta) ta.value = '';
    const sum = document.getElementById('dhcp-summary'); if (sum) sum.textContent = '';
    const btn = document.getElementById('dhcp-use-btn'); if (btn) btn.disabled = true;
}

// "Aggiungi": il set in staging diventa una FONTE persistita (accumula). Una
// fonte live con lo stesso vendor@host (o quella in rinnovo) viene SOSTITUITA,
// gli incolla si sommano. Ricalcola la cache + salva.
function useDhcpLeases() {
    if (!_staged.leases.length) return;
    const srcs = _ensureSources();
    const now = new Date().toISOString();
    const live = _staged.live;
    const label = _sourceLabel(_staged);
    let target = null;
    if (_refreshId) target = srcs.find(s => s.id === _refreshId);
    if (!target && live) target = srcs.find(s => s.key === _liveKey(live));
    if (target) {
        target.label = label; target.format = _staged.format; target.live = live || null;
        target.key = live ? _liveKey(live) : (target.key || '');
        target.leases = _staged.leases.slice(); target.count = target.leases.length; target.importedAt = now;
    } else {
        srcs.push({
            id: _newId(), key: live ? _liveKey(live) : '', label, format: _staged.format,
            live: live || null, importedAt: now, count: _staged.leases.length, leases: _staged.leases.slice(),
        });
    }
    const n = _staged.leases.length;
    _refreshId = null;
    _commit();
    _clearStaging();
    renderDhcpSources();
    _showToast(t('dhcp.added', { n }), 'ok', 3500);
}

// Rinnova una fonte LIVE: ripopola il form (vendor/host/porta) e prepara la
// sostituzione. Le credenziali NON sono persistite → si reinseriscono.
function refreshDhcpSource(id) {
    const s = _ensureSources().find(x => x.id === id);
    if (!s || !s.live) return;
    const sel = document.getElementById('dhcp-live-vendor'); if (sel) sel.value = s.live.vendor;
    updateDhcpVendorFields();
    const h = document.getElementById('dhcp-live-host'); if (h) h.value = s.live.host || '';
    const p = document.getElementById('dhcp-live-port'); if (p) p.value = s.live.port || '';
    _refreshId = id;
    const err = document.getElementById('dhcp-errors'); if (err) err.textContent = t('dhcp.refreshHint');
    const c1 = document.getElementById('dhcp-live-cred1'); if (c1) c1.focus();
}

// Rimuove un'intera fonte (un DHCP server).
function removeDhcpSource(id) {
    const srcs = _ensureSources();
    const i = srcs.findIndex(x => x.id === id);
    if (i < 0) return;
    srcs.splice(i, 1);
    if (_refreshId === id) _refreshId = null;
    _commit();
    renderDhcpSources();
}

// Toglie un singolo lease (per MAC) da tutte le fonti; le fonti svuotate spariscono.
function deleteDhcpLease(mac) {
    const srcs = _ensureSources();
    for (const s of srcs) { if (Array.isArray(s.leases)) { s.leases = s.leases.filter(l => l.mac !== mac); s.count = s.leases.length; } }
    store.state.dhcpSources = srcs.filter(s => (s.leases || []).length);
    _commit();
    renderDhcpSources();
}

// Svuota tutte le fonti (con conferma).
function clearDhcpSources() {
    if (!_ensureSources().length) return;
    if (!window.confirm(t('dhcp.clearConfirm'))) return;
    store.state.dhcpSources = [];
    _refreshId = null;
    _commit();
    renderDhcpSources();
}

// "Verifica ora": chiude l'overlay e rilancia la Verifica documentazione con le
// fonti correnti (la cache è già aggiornata). Funziona per qualsiasi fonte.
function dhcpVerifyNow() {
    closeDhcpImport();
    if (typeof window.runDriftCheck === 'function') window.runDriftCheck();
}

function _syncClearBtn() {
    const b = document.getElementById('dhcp-clear-btn'); if (b) b.disabled = !_ensureSources().length;
    const v = document.getElementById('dhcp-verify-btn');
    if (v) v.disabled = !(Array.isArray(store._dhcpLeases) && store._dhcpLeases.length);
}

// Rende la tabella delle fonti in memoria (persistite). Stili inline, coerenti
// col resto dell'overlay. Ogni fonte è un <details> espandibile coi suoi lease.
function renderDhcpSources() {
    const host = document.getElementById('dhcp-sources');
    if (!host) return;
    const srcs = _ensureSources();
    const totalLeases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases.length : 0;
    const head = `<div style="display:flex;align-items:center;gap:8px;font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;border-top:1px solid var(--panel-border);padding-top:12px">
        <i class="fas fa-database"></i><span>${esc(t('dhcp.sources'))}</span>
        <span style="margin-left:auto;font-weight:500">${esc(t('dhcp.sourcesTotal', { m: totalLeases, s: srcs.length }))}</span></div>`;
    if (!srcs.length) {
        host.innerHTML = head + `<div style="font-size:0.75rem;color:var(--text-muted);padding:6px 2px">${esc(t('dhcp.noSources'))}</div>`;
        _syncClearBtn(); return;
    }
    const body = srcs.map(s => {
        const icon = s.live ? 'fa-cloud-arrow-down' : 'fa-file-lines';
        const refresh = s.live ? `<button title="${esc(t('dhcp.refreshSource'))}" onclick="event.preventDefault();refreshDhcpSource('${esc(s.id)}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 6px"><i class="fas fa-rotate"></i></button>` : '';
        const rmv = `<button title="${esc(t('dhcp.removeSource'))}" onclick="event.preventDefault();removeDhcpSource('${esc(s.id)}')" style="background:none;border:none;color:var(--fault-color);cursor:pointer;padding:2px 6px"><i class="fas fa-trash-can"></i></button>`;
        const rows = (s.leases || []).map(l => `<tr style="border-top:1px solid var(--panel-border)">
            <td style="padding:3px 6px;font-family:monospace;white-space:nowrap">${esc(l.mac)}</td>
            <td style="padding:3px 6px;white-space:nowrap">${esc(l.ip)}</td>
            <td style="padding:3px 6px;color:var(--text-muted)">${esc(l.hostname || '')}</td>
            <td style="padding:3px 6px;text-align:right"><button title="${esc(t('dhcp.delLease'))}" onclick="deleteDhcpLease('${esc(l.mac)}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer"><i class="fas fa-xmark"></i></button></td></tr>`).join('');
        return `<details style="border:1px solid var(--panel-border);border-radius:5px;margin-bottom:6px">
          <summary style="display:flex;align-items:center;gap:8px;padding:7px 9px;cursor:pointer;font-size:0.78rem">
            <i class="fas ${icon}" style="color:var(--accent-color)"></i>
            <span style="font-weight:600">${esc(s.label)}</span>
            <span style="color:var(--text-muted);font-weight:500">· ${esc(String(s.count))} · ${esc(t('dhcp.importedAt', { when: _fmtWhen(s.importedAt) }))}</span>
            <span style="margin-left:auto;display:inline-flex;gap:2px">${refresh}${rmv}</span>
          </summary>
          <div style="padding:0 4px 6px">
            <table style="width:100%;border-collapse:collapse;font-size:0.72rem">
              <thead><tr style="color:var(--text-muted);text-align:left">
                <th style="padding:3px 6px;font-weight:600">${esc(t('dhcp.thMac'))}</th>
                <th style="padding:3px 6px;font-weight:600">${esc(t('dhcp.thLeaseIp'))}</th>
                <th style="padding:3px 6px;font-weight:600">${esc(t('dhcp.thHost'))}</th>
                <th></th></tr></thead>
              <tbody>${rows}</tbody></table>
          </div>
        </details>`;
    }).join('');
    host.innerHTML = head + body;
    _syncClearBtn();
}

// Handler inline dell'HTML (onclick="").
expose({
    openDhcpImport, closeDhcpImport, fetchDhcpLive,
    useDhcpLeases, refreshDhcpSource, removeDhcpSource, deleteDhcpLease, clearDhcpSources, dhcpVerifyNow,
});

// ASSE B — superficie change/input del modale DHCP (fuori da expose): file-input +
// select vendor via data-change, textarea incolla-lease via data-input.
registerChangeActions({
    'dhcp-file':   (el) => loadDhcpFile(el),
    'dhcp-vendor': () => updateDhcpVendorFields(),
});
registerInputActions({
    'dhcp-preview': () => previewDhcp(),
});
