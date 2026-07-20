// ============================================================
// DHCP LEASE PARSER — puro (no DOM/state)
// ============================================================
// Parsa le tabelle dei lease DHCP da più formati in un elenco NORMALIZZATO
// { mac, ip, hostname, expiry, state, subnet, vlan? }. Strategia "formati, non
// marche": 4 parser — ISC dhcpd · dnsmasq · Kea CSV memfile · CSV generico —
// coprono la maggior parte dei server (pfSense/OPNsense/Sophos/Linux/MikroTik/
// Ubiquiti + qualsiasi export, incl. Windows `Get-DhcpServerv4Lease`). Le API
// live dei vendor (FortiGate/PAN-OS/…) sono un layer separato (driver) che
// produce lo STESSO schema. Condiviso browser + test (UMD-lite). Manual-first:
// qui SOLO parsing; il match per-MAC sui nodi e l'applicazione degli IP (con
// guardia ipManual) vivono nel glue.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  function _validIp(s) {
    const m = IPV4.exec(String(s == null ? '' : s).trim());
    if (!m) return '';
    for (let i = 1; i <= 4; i++) if (+m[i] > 255) return '';
    return m.slice(1, 5).join('.');
  }
  // MAC → canonico UPPER colon-sep (come src/app-util normalizeMacAddress);
  // '' se non sono 12 esadecimali → record scartato (per il match serve un MAC vero).
  function _normMac(v) {
    const hex = String(v == null ? '' : v).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
  }
  function _net24(ip) {
    const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\./.exec(String(ip || ''));
    return m ? m[1] : '';
  }
  // epoch (secondi) → ISO; null se 0/non valido (es. lease "infinito").
  function _epochToIso(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(n * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Stringa data generica → ISO (epoch o data parsabile), null altrimenti.
  function _anyDateToIso(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    if (/^\d{9,}$/.test(s)) return _epochToIso(s);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // ── ISC dhcpd (dhcpd.leases) ─────────────────────────────────────────
  function _iscState(s) {
    s = (s || '').toLowerCase();
    return (s === 'active' || s === 'free' || s === 'expired' || s === 'released') ? s : (s || '');
  }
  function _iscEnds(s) { // "2026/06/26 22:00:00" (UTC in ISC) → ISO
    const m = /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(s || '');
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function _parseIsc(text) {
    const out = [];
    const re = /lease\s+(\d+\.\d+\.\d+\.\d+)\s*\{([\s\S]*?)\}/g;
    let m;
    while ((m = re.exec(text))) {
      const ip = _validIp(m[1]); if (!ip) continue;
      const body = m[2];
      const mac = _normMac((/hardware\s+ethernet\s+([0-9a-fA-F:]+)/.exec(body) || [])[1]);
      if (!mac) continue;   // niente MAC (es. abandoned) → non utile al match
      const hn = (/client-hostname\s+"([^"]*)"/.exec(body) || [])[1] || '';
      const st = (/binding\s+state\s+(\w+)/.exec(body) || [])[1] || '';
      const ends = (/\bends\s+\d+\s+([\d/]+\s+[\d:]+)/.exec(body) || [])[1] || '';
      out.push({ mac, ip, hostname: hn, state: _iscState(st), expiry: _iscEnds(ends), subnet: _net24(ip) });
    }
    return out;
  }

  // ── dnsmasq (dnsmasq.leases) ─────────────────────────────────────────
  // "<expiry-epoch> <mac> <ip> <hostname> <client-id>"  (expiry 0 = infinito)
  function _parseDnsmasq(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || /^(duid\b|#)/i.test(t)) continue;
      const p = t.split(/\s+/);
      if (p.length < 4) continue;
      const mac = _normMac(p[1]); const ip = _validIp(p[2]);
      if (!mac || !ip) continue;
      const hn = (p[3] && p[3] !== '*') ? p[3] : '';
      out.push({ mac, ip, hostname: hn, state: 'active', expiry: _epochToIso(p[0]), subnet: _net24(ip) });
    }
    return out;
  }

  // ── Kea CSV memfile ──────────────────────────────────────────────────
  function _keaState(s) { // 0 default(attivo) · 1 declined · 2 expired-reclaimed
    if (s === '0' || s === '' || s == null) return 'active';
    if (s === '1') return 'declined';
    if (s === '2') return 'expired';
    return String(s);
  }
  function _parseKea(text) {
    const rows = _csvRows(text);
    if (!rows.length) return [];
    const h = rows[0].map(c => c.toLowerCase());
    const iA = h.indexOf('address'), iM = h.indexOf('hwaddr');
    if (iA < 0 || iM < 0) return [];
    const iH = h.indexOf('hostname'), iE = h.indexOf('expire'), iS = h.indexOf('state'), iSub = h.indexOf('subnet_id');
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r]; if (!c.length) continue;
      const mac = _normMac(c[iM]); const ip = _validIp(c[iA]);
      if (!mac || !ip) continue;
      const rec = { mac, ip, hostname: iH >= 0 ? (c[iH] || '') : '', state: _keaState(iS >= 0 ? c[iS] : ''), expiry: iE >= 0 ? _epochToIso(c[iE]) : null, subnet: _net24(ip) };
      if (iSub >= 0 && c[iSub] != null && String(c[iSub]).trim() !== '') { const v = parseInt(c[iSub], 10); if (Number.isFinite(v)) rec.subnetId = v; }
      out.push(rec);
    }
    return out;
  }

  // ── CSV generico (header flessibile: copre export Windows/MikroTik/ecc.) ─
  function _parseCsv(text) {
    const rows = _csvRows(text);
    if (rows.length < 2) return [];
    const h = rows[0].map(c => c.toLowerCase().trim());
    const find = (...names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
    const iIp = find('ip', 'address', 'ipaddress', 'ip address', 'ip_address');
    const iM = find('mac', 'hwaddr', 'hardware', 'macaddress', 'mac address', 'mac_address', 'physicaladdress', 'physical address', 'clientid', 'client id', 'client-id');
    const iH = find('hostname', 'host', 'name', 'client-hostname', 'clienthostname', 'device', 'devicename');
    const iV = find('vlan', 'vlanid', 'vlan id', 'vlan_id');
    const iE = find('expiry', 'expires', 'expire', 'lease expiry', 'leaseexpirytime', 'expiretime', 'expiration');
    if (iIp < 0 || iM < 0) return [];
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r]; if (!c.length) continue;
      const mac = _normMac(c[iM]); const ip = _validIp(c[iIp]);
      if (!mac || !ip) continue;
      const rec = { mac, ip, hostname: iH >= 0 ? (c[iH] || '').trim() : '', state: 'active', expiry: iE >= 0 ? _anyDateToIso(c[iE]) : null, subnet: _net24(ip) };
      if (iV >= 0 && c[iV] != null && String(c[iV]).trim() !== '') { const v = parseInt(c[iV], 10); if (Number.isFinite(v)) rec.vlan = v; }
      out.push(rec);
    }
    return out;
  }

  // CSV → righe (parsing con virgolette base), saltando vuote e commenti #.
  function _csvRows(text) {
    const rows = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      rows.push(_csvSplit(t));
    }
    return rows;
  }
  function _csvSplit(line) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  // ── auto-detect del formato dalla firma del testo ────────────────────
  function detectLeaseFormat(text) {
    const s = String(text || '');
    if (/lease\s+\d+\.\d+\.\d+\.\d+\s*\{/.test(s)) return 'isc';
    if (/^\s*\d{9,}\s+[0-9a-fA-F]{2}([:-][0-9a-fA-F]{2}){5}\s+\d+\.\d+\.\d+\.\d+/m.test(s)) return 'dnsmasq';
    const firstData = (s.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || '').toLowerCase();
    if (firstData.includes('hwaddr') && firstData.includes('address')) return 'kea-csv';
    if (firstData.includes(',')
      && /(^|,)\s*(ip|address|ipaddress|ip address)\s*(,|$)/.test(firstData)
      && /(mac|hwaddr|hardware|physical|clientid|client id|client-id)/.test(firstData)) return 'csv';
    return 'unknown';
  }

  // ── entrypoint ───────────────────────────────────────────────────────
  // Ritorna { format, leases:[…], count, parsed }. `parsed` = righe valide
  // prima del dedup; `count` = dopo il dedup per-MAC.
  function parseDhcpLeases(text, format) {
    const fmt = (!format || format === 'auto') ? detectLeaseFormat(text) : format;
    let leases = [];
    if (fmt === 'isc') leases = _parseIsc(text);
    else if (fmt === 'dnsmasq') leases = _parseDnsmasq(text);
    else if (fmt === 'kea-csv') leases = _parseKea(text);
    else if (fmt === 'csv') leases = _parseCsv(text);
    const deduped = _dedupeByMac(leases);
    return { format: fmt, leases: deduped, count: deduped.length, parsed: leases.length };
  }

  // Dedup per MAC (identità = MAC): tiene il lease "più corrente".
  // Rank: expiry datata = il suo timestamp; expiry NULL = lease INFINITO
  // (ISC `ends never`, dnsmasq epoch 0, riserva statica) = +∞, il PIÙ
  // autorevole — purché non sia in uno stato morto. Prima del fix il null
  // valeva epoch 0 e perdeva contro qualunque lease storico datato, anche
  // scaduto da anni → il device con lease statico perdeva presenza e IP.
  const _DEAD_LEASE_STATES = { expired: 1, released: 1, declined: 1, free: 1 };
  function _leaseRank(l) {
    if (l && l.expiry) { const t = Date.parse(l.expiry); return Number.isFinite(t) ? t : 0; }
    return _DEAD_LEASE_STATES[(l && l.state) || ''] ? 0 : Infinity;
  }
  function _dedupeByMac(leases) {
    const byMac = new Map();
    for (const l of (leases || [])) {
      const prev = byMac.get(l.mac);
      if (!prev) { byMac.set(l.mac, l); continue; }
      if (_leaseRank(l) >= _leaseRank(prev)) byMac.set(l.mac, l);
    }
    return [...byMac.values()];
  }

  // Normalizza record STRUTTURATI (es. da un driver API vendor) nello stesso
  // schema dei parser testuali: mac UPPER colon-sep, ip validato, scartando gli
  // invalidi, dedup per-MAC. Converge i due percorsi (file/incolla ↔ API live).
  function normalizeLeaseRecords(records) {
    const out = [];
    for (const r of (records || [])) {
      const mac = _normMac(r && r.mac);
      const ip = _validIp(r && r.ip);
      if (!mac || !ip) continue;
      const rec = {
        mac, ip,
        hostname: (r.hostname != null ? String(r.hostname) : '').trim(),
        state: r.state || 'active',
        expiry: r.expiry != null ? _anyDateToIso(r.expiry) : null,
        subnet: _net24(ip),
      };
      if (r.vlan != null && String(r.vlan).trim() !== '') { const v = parseInt(r.vlan, 10); if (Number.isFinite(v)) rec.vlan = v; }
      out.push(rec);
    }
    return _dedupeByMac(out);
  }

  // ── riconciliazione coi nodi documentati (pura, manual-first) ────────
  // Confronta i lease (per-MAC) con i nodi del progetto. Identità = MAC. NON
  // muta nulla: ritorna un diff che il glue mostra in preview e applica.
  //   updates    → IP cambiato e IP NON fissato a mano (ipManual falsy): applicabile
  //   manualHold → IP cambiato ma fissato a mano (ipManual): solo revisione umana
  //   confirmed  → l'IP del lease combacia con la doc
  //   unmatched  → MAC non documentato (candidato "Adotta")
  function reconcileDhcpLeases(leases, nodes) {
    const byMac = new Map();
    for (const n of (nodes || [])) {
      const mac = _normMac(n && n.mac);
      if (mac && !byMac.has(mac)) byMac.set(mac, n);
    }
    const out = { updates: [], manualHold: [], confirmed: [], unmatched: [] };
    for (const l of (leases || [])) {
      // Le chiavi di byMac sono normalizzate (_normMac dei MAC dei nodi): normalizziamo
      // anche il MAC del lease nel lookup. In produzione i lease arrivano già
      // normalizzati dai parser (parseDhcpLeases/normalizeLeaseRecords), ma così il
      // match è robusto a qualsiasi chiamante (case/separatori diversi).
      const n = byMac.get(_normMac(l.mac));
      if (!n) { out.unmatched.push({ mac: l.mac, ip: l.ip, hostname: l.hostname || '' }); continue; }
      const name = n.name || n.id || '';
      const docIp = String(n.ip || '').trim();
      if (docIp && docIp === l.ip) { out.confirmed.push({ nodeId: n.id, name, mac: l.mac, ip: l.ip }); continue; }
      const row = { nodeId: n.id, name, mac: l.mac, oldIp: docIp, newIp: l.ip, hostname: l.hostname || '' };
      if (n.ipManual) out.manualHold.push(row); else out.updates.push(row);
    }
    return out;
  }

  // Un lease NON è una sonda di presenza eterna: se è scaduto / rilasciato /
  // declinato / free, oppure la sua `expiry` è nel passato, non occupa più l'IP
  // né prova presenza. Criterio G2, condiviso dal motore Drift (app-drift.js) e
  // dall'occupazione IPAM (app.js → lib/ipam.js). `now` iniettabile per i test.
  function isLeaseStale(lease, now) {
    if (!lease) return false;
    const st = lease.state;
    if (st === 'expired' || st === 'released' || st === 'declined' || st === 'free') return true;
    if (lease.expiry) {
      const e = Date.parse(lease.expiry);
      const ref = Number.isFinite(now) ? now : Date.now();
      if (Number.isFinite(e) && e < ref) return true;
    }
    return false;
  }

  return { parseDhcpLeases, detectLeaseFormat, reconcileDhcpLeases, normalizeLeaseRecords, isLeaseStale };
});
