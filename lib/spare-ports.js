// ============================================================
// SPARE PORTS — capacità libera / porte disponibili (report puro)
// ============================================================
// Funzione PURA: data la lista dei device con le loro porte "collegabili"
// (access + SFP/uplink; mgmt/hidden gia' escluse a monte), aggrega la capacità
// LIBERA per device, per rack e totale. "libera" = senza cavo documentato;
// "sospetta" = libera sulla carta ma SNMP la vede attiva (cross-check realtà↔doc,
// coerente col Drift). Nessun accesso a DOM/state: input espliciti → output.
// Condiviso browser + test (UMD-lite). Sola lettura: non modifica nulla.
//
// INPUT  devices = [ { id, name, rackId, ports: [ { pid, kind, cabled, activeSnmp } ] } ]
//   kind: 'access' | 'sfp'   (le mgmt/hidden non vanno incluse)
//   cabled: true se la porta ha un cavo documentato
//   activeSnmp: true se SNMP la vede operativamente attiva (per il cross-check)
// OUTPUT { totals, racks[], unracked[], freePids[], suspectPids[] }
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _emptyTotals() {
    return { devices: 0, ports: 0, used: 0, free: 0, freeAccess: 0, freeSfp: 0, suspect: 0 };
  }
  function _accum(t, d) {
    t.devices += 1; t.ports += d.total; t.used += d.used; t.free += d.free;
    t.freeAccess += d.freeAccess; t.freeSfp += d.freeSfp; t.suspect += d.suspect;
  }

  // Riassunto capacità di UN device.
  function _deviceSummary(dev) {
    const ports = Array.isArray(dev.ports) ? dev.ports : [];
    const freePorts = [];
    let used = 0, freeAccess = 0, freeSfp = 0, suspect = 0;
    for (const p of ports) {
      if (p.cabled) { used += 1; continue; }
      const kind = p.kind === 'sfp' ? 'sfp' : 'access';
      const isSuspect = !!p.activeSnmp;
      freePorts.push({ pid: p.pid, kind, suspect: isSuspect });
      if (kind === 'sfp') freeSfp += 1; else freeAccess += 1;
      if (isSuspect) suspect += 1;
    }
    const free = freeAccess + freeSfp;
    return {
      id: dev.id, name: dev.name || dev.id, rackId: dev.rackId || null,
      total: ports.length, used, free, freeAccess, freeSfp, suspect, freePorts,
    };
  }

  function buildSpareReport(devices) {
    const list = Array.isArray(devices) ? devices : [];
    const totals = _emptyTotals();
    const rackMap = new Map();   // rackId → { rackId, name, totals, devices[] }
    const unracked = [];
    const freePids = [];
    const suspectPids = [];

    for (const dev of list) {
      const d = _deviceSummary(dev);
      // ignora device senza porte collegabili (es. solo mgmt) per non sporcare il report
      if (d.total === 0) continue;
      _accum(totals, d);
      for (const fp of d.freePorts) { freePids.push(fp.pid); if (fp.suspect) suspectPids.push(fp.pid); }
      if (d.rackId) {
        if (!rackMap.has(d.rackId)) rackMap.set(d.rackId, { rackId: d.rackId, name: dev.rackName || d.rackId, totals: _emptyTotals(), devices: [] });
        const r = rackMap.get(d.rackId);
        _accum(r.totals, d);
        r.devices.push(d);
      } else {
        unracked.push(d);
      }
    }

    // device piu' "pieno" prima dentro ogni rack? No: ordina per nome (stabile/leggibile).
    const racks = [...rackMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    for (const r of racks) r.devices.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    unracked.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return { totals, racks, unracked, freePids, suspectPids };
  }

  return { buildSpareReport };
});
