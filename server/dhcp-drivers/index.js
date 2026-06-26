'use strict';
// ============================================================
// DHCP DRIVER FRAMEWORK (Fase 2 — pull LIVE dall'API del vendor)
// ============================================================
// Gira LATO SERVER: il browser non raggiunge il firewall. Un POST
// /api/dhcp-leases passa { vendor, host, …credenziali } → il driver costruisce
// la richiesta, il framework fa l'HTTP(S), il driver estrae i lease e il lib
// puro li normalizza nello STESSO schema della Fase 1 → riconciliazione/preview
// identiche. Le credenziali NON sono persistite (uso singolo per la fetch).
//
// Ogni driver: { id, label, auth:[campi], buildRequest(cfg), parseLeases(body) }.
// buildRequest+parseLeases sono PURI/testabili; qui solo l'HTTP + la normalizzazione.
//
// Sicurezza: endpoint admin-gated (auth.requireAdmin) e server bound a 127.0.0.1
// (D6). È egress verso un host scelto dall'admin (come /api/poll SNMP): timeout
// e cap sulla risposta; `insecureTLS` per i cert self-signed dei firewall.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { normalizeLeaseRecords } = require('../../lib/dhcp-lease.js');

// I driver vendor LIVE sono il "driver-pack" a pagamento: vivono in ./vendor/
// (gitignored, fuori dal repo pubblico) e si caricano a runtime SE presenti —
// stesso meccanismo di plugins/oui/. Cartella assente/vuota → nessun driver
// live: l'open resta col solo import da file/incolla. Ogni file espone
// { id, label, auth, buildRequest, parseLeases }.
const DRIVERS = {};
(function _loadVendorDrivers() {
    const dir = path.join(__dirname, 'vendor');
    let files;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.js')); }
    catch { return; }   // cartella assente → pack non installato
    for (const f of files) {
        try {
            const d = require(path.join(dir, f));
            if (d && d.id && typeof d.buildRequest === 'function' && typeof d.parseLeases === 'function') DRIVERS[d.id] = d;
        } catch (e) { console.warn('[dhcp-drivers] driver ignorato ' + f + ': ' + e.message); }
    }
})();

// Descrittori per la UI (vendor + campi credenziali richiesti).
function listDrivers() {
    return Object.values(DRIVERS).map(d => ({ id: d.id, label: d.label, auth: d.auth }));
}

// Richiesta HTTP(S) minimale: timeout, cap 4 MB, opzione salta-TLS.
function _httpRequest({ protocol, host, port, method, path, headers, body, timeoutMs, insecureTLS }) {
    return new Promise((resolve, reject) => {
        const lib = protocol === 'http' ? http : https;
        const opts = { host, port, method: method || 'GET', path, headers: headers || {}, timeout: timeoutMs || 8000 };
        if (protocol !== 'http') opts.rejectUnauthorized = !insecureTLS;
        const req = lib.request(opts, res => {
            let data = ''; let size = 0;
            res.on('data', chunk => {
                size += chunk.length;
                if (size > 4 * 1024 * 1024) { req.destroy(); reject(new Error('response too large')); return; }
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode));
                else resolve(data);
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function fetchLeases(vendor, cfg) {
    const driver = DRIVERS[vendor];
    if (!driver) throw new Error('unknown vendor: ' + vendor);
    cfg = cfg || {};
    const host = String(cfg.host || '').trim();
    if (!host) throw new Error('host required');
    const spec = driver.buildRequest(cfg);
    const body = await _httpRequest({
        protocol: spec.protocol, host, port: spec.port,
        method: spec.method, path: spec.path, headers: spec.headers, body: spec.body,
        timeoutMs: cfg.timeoutMs || 8000,
        insecureTLS: !!cfg.insecureTLS,
    });
    const leases = normalizeLeaseRecords(driver.parseLeases(body));
    return { vendor, leases, count: leases.length };
}

module.exports = { DRIVERS, listDrivers, fetchLeases, _httpRequest };
