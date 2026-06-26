// ============================================================
// LEASE DHCP — caricamento + aggancio alla Verifica (glue sottile)
// ============================================================
// I lease DHCP danno il legame IP↔MAC su TUTTE le VLAN (il pezzo che l'ARP
// locale non vede dietro un firewall L3). Qui si CARICANO soltanto — da file/
// incolla (free) o pull live dall'API del vendor (driver-pack a pagamento) — e
// si mettono in store._dhcpLeases: poi la Verifica (motore Drift/rinnovo IP) li
// usa come fonte, facendo presenza, cambio IP e non-documentati. Niente
// reconcile/apply separato. Parsing nel lib puro lib/dhcp-lease.js. La sezione
// live appare solo se il server ha driver installati (GET /api/dhcp-drivers).
import { expose, t, parseDhcpLeases } from './_bridge.js';
import { store } from './store.js';
import { _showToast } from './app.js';

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

// Lease caricati nell'overlay, in attesa di "Usa nella Verifica".
let _loadedLeases = [];

async function openDhcpImport() {
    document.getElementById('dhcp-textarea').value = '';
    document.getElementById('dhcp-summary').textContent = '';
    document.getElementById('dhcp-errors').textContent = '';
    document.getElementById('dhcp-use-btn').disabled = true;
    _loadedLeases = [];
    document.getElementById('dhcp-overlay').classList.add('open');
    await _populateDhcpVendors();   // i vendor live arrivano dal server (pack o no)
}

function closeDhcpImport() { document.getElementById('dhcp-overlay').classList.remove('open'); }

// Mostra la sezione "pull live" solo se il server ha driver installati (pack).
async function _populateDhcpVendors() {
    const section = document.getElementById('dhcp-live-section');
    let list = [];
    try { const r = await fetch('/api/dhcp-drivers'); const d = await r.json(); if (d && d.ok) list = d.drivers || []; } catch (_) { /* offline */ }
    if (!list.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    document.getElementById('dhcp-live-vendor').innerHTML = list.map(v => `<option value="${v.id}">${v.label}</option>`).join('');
    updateDhcpVendorFields();
}

function loadDhcpFile(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('dhcp-textarea').value = e.target.result; previewDhcp(); input.value = ''; };
    reader.readAsText(file);
}

// File/incolla → parse → lease pronti per la Verifica.
function previewDhcp() {
    const raw = (document.getElementById('dhcp-textarea').value || '').trim();
    if (!raw) { _setLoaded([], ''); return; }
    const parsed = parseDhcpLeases(raw, 'auto');
    _setLoaded(parsed.leases, _FMT_LABEL[parsed.format] || t('dhcp.fmtUnknown'));
}

// Stato "lease pronti" condiviso da file e pull live.
function _setLoaded(leases, fmtLabel) {
    _loadedLeases = leases || [];
    const sum = document.getElementById('dhcp-summary');
    const err = document.getElementById('dhcp-errors');
    document.getElementById('dhcp-use-btn').disabled = _loadedLeases.length === 0;
    if (!_loadedLeases.length) { sum.textContent = ''; err.textContent = fmtLabel ? t('dhcp.noLeases') : ''; return; }
    err.textContent = '';
    sum.textContent = t('dhcp.loaded', { fmt: fmtLabel, n: _loadedLeases.length });
}

function updateDhcpVendorFields() {
    const creds = _creds(document.getElementById('dhcp-live-vendor').value);
    document.getElementById('dhcp-cred1-label').textContent = creds[0][1];
    const wrap2 = document.getElementById('dhcp-cred2-wrap');
    if (creds[1]) { wrap2.style.display = 'inline-flex'; document.getElementById('dhcp-cred2-label').textContent = creds[1][1]; }
    else { wrap2.style.display = 'none'; document.getElementById('dhcp-live-cred2').value = ''; }
}

// Pull live (pack): il server interroga l'API del vendor → lease pronti.
async function fetchDhcpLive() {
    const sel = document.getElementById('dhcp-live-vendor');
    const vendor = sel.value;
    const creds = _creds(vendor);
    const host = (document.getElementById('dhcp-live-host').value || '').trim();
    const err = document.getElementById('dhcp-errors');
    if (!host) { _setLoaded([], ''); err.textContent = t('dhcp.hostRequired'); return; }
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
        if (!d || !d.ok) { _setLoaded([], ''); err.textContent = t('dhcp.fetchErr', { e: (d && d.error) || '?' }); return; }
        _setLoaded(d.leases || [], (sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].text) || vendor);
    } catch (e) { _setLoaded([], ''); err.textContent = t('dhcp.fetchErr', { e: String(e && e.message || e) }); }
    finally { btn.disabled = false; btn.innerHTML = prev; }
}

// "Usa nella Verifica": i lease diventano una fonte del motore Drift/rinnovo IP.
// Transitorio (non persistito nel progetto). La Verifica li applica al prossimo run.
function useDhcpLeases() {
    if (!_loadedLeases.length) return;
    store._dhcpLeases = _loadedLeases.slice();
    closeDhcpImport();
    _showToast(t('dhcp.feeding', { n: _loadedLeases.length }), 'ok', 4500);
}

// Handler inline dell'HTML (onclick="").
expose({ openDhcpImport, closeDhcpImport, loadDhcpFile, previewDhcp, fetchDhcpLive, updateDhcpVendorFields, useDhcpLeases });
