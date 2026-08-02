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

  // `sfp` = porte in fibra DICHIARATE (libere + cablate), accanto a `freeSfp` che
  // conta solo le libere. Senza il denominatore, «0 SFP» non si distingue da
  // «nessuna fibra dichiarata»: due fatti diversi che nel PDF finivano nello
  // stesso zero, mentre la Panoramica li separa già (riga `freeSfp`, prov 'none').
  // `freeBySpeed` = quante porte LIBERE per ogni velocita' nota, e `freeNoSpeed`
  // quante non ne hanno nessuna. Servono alla colonna Espansione: «120 porte
  // libere» non dice quanto puoi crescere finche' non sai se sono 1G o 10G. Le
  // due grandezze restano SEPARATE apposta — una porta senza velocita' non e' una
  // porta lenta, e' una porta di cui nessuno ha scritto la velocita'.
  function _emptyTotals() {
    return { devices: 0, ports: 0, used: 0, free: 0, freeAccess: 0, freeSfp: 0, sfp: 0, suspect: 0,
             freeBySpeed: {}, freeNoSpeed: 0 };
  }
  function _accum(t, d) {
    t.devices += 1; t.ports += d.total; t.used += d.used; t.free += d.free;
    t.freeAccess += d.freeAccess; t.freeSfp += d.freeSfp; t.sfp += d.sfp; t.suspect += d.suspect;
    t.freeNoSpeed += d.freeNoSpeed;
    for (const k of Object.keys(d.freeBySpeed)) t.freeBySpeed[k] = (t.freeBySpeed[k] || 0) + d.freeBySpeed[k];
  }

  // Riassunto capacità di UN device.
  function _deviceSummary(dev) {
    const ports = Array.isArray(dev.ports) ? dev.ports : [];
    const freePorts = [];
    let used = 0, freeAccess = 0, freeSfp = 0, sfp = 0, suspect = 0, freeNoSpeed = 0;
    const freeBySpeed = {};
    for (const p of ports) {
      const kind = p.kind === 'sfp' ? 'sfp' : 'access';
      if (kind === 'sfp') sfp += 1;              // dichiarata in fibra, cablata o no
      if (p.cabled) { used += 1; continue; }
      const isSuspect = !!p.activeSnmp;
      freePorts.push({ pid: p.pid, kind, suspect: isSuspect });
      if (kind === 'sfp') freeSfp += 1; else freeAccess += 1;
      if (isSuspect) suspect += 1;
      // Velocita' della porta libera: solo se e' un numero positivo. Zero e null
      // finiscono entrambi in `freeNoSpeed` — un link a 0 Mbps non esiste, e' il
      // modo in cui SNMP dice «non lo so» su una porta giu'.
      const mbps = Number(p.speed);
      if (Number.isFinite(mbps) && mbps > 0) freeBySpeed[mbps] = (freeBySpeed[mbps] || 0) + 1;
      else freeNoSpeed += 1;
    }
    const free = freeAccess + freeSfp;
    return {
      id: dev.id, name: dev.name || dev.id, rackId: dev.rackId || null,
      total: ports.length, used, free, freeAccess, freeSfp, sfp, suspect, freePorts,
      freeBySpeed, freeNoSpeed,
    };
  }

  // CLASSE DI CAPACITÀ dal TIPO del device. Lo switch è l'unica "capacità di rete"
  // vera — la porta dove attacchi un NUOVO device; tutto il resto (patch panel,
  // router/firewall, appliance con più porte: NVR/KVM/console-server/NAS…) ha porte
  // libere ma NON risponde alla domanda «dove collego», quindi va contato a parte
  // (classe 'other'). Regola generale, non un elenco di vendor.
  function _capClass(type) { return type === 'switch' ? 'switch' : 'other'; }

  function buildSpareReport(devices) {
    const list = Array.isArray(devices) ? devices : [];
    const totals = _emptyTotals();
    // Ripartizione per classe di capacità: la testata mostra gli SWITCH (capacità
    // di rete vera), il resto — patch panel/appliance — resta contato ma a parte.
    const byClass = { switch: _emptyTotals(), other: _emptyTotals() };
    const rackMap = new Map();   // rackId → { rackId, name, totals, devices[] }
    const unracked = [];
    const freePids = [];
    const suspectPids = [];

    for (const dev of list) {
      const d = _deviceSummary(dev);
      // ignora device senza porte collegabili (es. solo mgmt) per non sporcare il report
      if (d.total === 0) continue;
      d.capClass = _capClass(dev && dev.type);
      _accum(totals, d);
      _accum(byClass[d.capClass], d);
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

    return { totals, byClass, racks, unracked, freePids, suspectPids };
  }

  return { buildSpareReport };
});
