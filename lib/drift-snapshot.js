// ============================================================
// DRIFT SNAPSHOT — costruzione PURA degli snapshot doc / realtà
// ============================================================
// Estrae le REGOLE di costruzione dei due snapshot che alimentano il diff
// engine (lib/drift-report.js), separandole dalla raccolta-dati da stato/DOM
// (che resta nel glue src/app-drift.js). Funzioni PURE: input espliciti →
// output JSON, nessun accesso a DOM/state/global. Tutto ciò che è impuro
// (etichette UI i18n, classificazione MAC virtuale/randomizzato, conteggio MAC
// per porta, staleness dei lease) è INIETTATO come callback — stesso pattern di
// computeIpamUsage (lib/ipam.js) che inietta parseCidr/ipInCidr. Condiviso
// browser + test (UMD-lite).
//
// ── buildDocSnapshot(model) → { ports, macs, deviceSigs, cables } ───────────
//   model = {
//     nodes, links, ports,                 // stato grezzo (array/mappa)
//     portLabel(pid)   -> string,           // etichetta porta (UI)
//     nodeLabel(node)  -> string,           // nome visualizzato del device
//     cableLabel(link) -> string,           // etichetta cavo (auto se assente)
//     normMac(mac)     -> string,           // normalizzazione MAC (lower)
//     isPassiveNoIp(node) -> bool           // passivo senza IP proprio → fuori audit presenza
//   }
//
// ── buildSnmpSnapshot(model) → snapshot REALTÀ per buildDriftReport ─────────
//   model = {
//     nodes, docPorts, ports,               // stato grezzo + le porte documentate da rispecchiare
//     fdb, vlanCache,                       // _topoFdbCache / _topoFdbVlanCache
//     reachable, arpTable,                  // sweep raggiungibilità + tabella ARP
//     leases, knownSigs, rejectedAutoLinks, // lease DHCP, firme note, link rifiutati
//     normMac, isVirtualMac, isRandomizedMac, isLeaseStale, countMacsPerPort,
//     fdbSeenLabel(sw, ifName) -> string,   // "visto su <switch> · <ifName>"
//     leaseSeenLabel(ip, hostname) -> string
//   }
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // primo valore non-null tra a, b, null (≡ a ?? b ?? null: mantiene '' e 0)
  function _pref(a, b) { return a != null ? a : (b != null ? b : null); }
  function _net24(ip) { const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\./.exec(String(ip || '')); return m ? m[1] : null; }

  // ── 1) Snapshot DOC ──────────────────────────────────────────────────
  function buildDocSnapshot(model) {
    const m = model || {};
    const nodes = m.nodes || [];
    const links = m.links || [];
    const portsState = m.ports || {};
    const portLabel = typeof m.portLabel === 'function' ? m.portLabel : (pid => String(pid));
    const nodeLabel = typeof m.nodeLabel === 'function' ? m.nodeLabel : (n => (n && (n.name || n.id)) || '');
    const cableLabel = typeof m.cableLabel === 'function' ? m.cableLabel : (l => (l && (l.label || l.id)) || '');
    const normMac = typeof m.normMac === 'function' ? m.normMac : (x => String(x == null ? '' : x).toLowerCase());
    const isPassiveNoIp = typeof m.isPassiveNoIp === 'function' ? m.isPassiveNoIp : (() => false);

    const ports = {};
    const linkPids = new Set();
    for (const l of links) { if (l && l.src) linkPids.add(l.src); if (l && l.dst) linkPids.add(l.dst); }
    for (const pid of linkPids) {
      const pi = portsState[pid] || {};
      ports[pid] = {
        label: portLabel(pid),
        status: _pref(pi.statusOvr, pi.status),
        speed: _pref(pi.speedOvr, pi.speed),
        duplex: pi.duplex != null ? pi.duplex : null,
        vlan: _pref(pi.vlanOvr, pi.vlan),
      };
    }
    const macs = [];
    const deviceSigs = [];
    for (const n of nodes) {
      // VM ospitate: MAC "noti" → fuori dai non-documentati. SOLO deviceSigs,
      // NON macs: una VM (magari spenta) non entra nell'audit di presenza.
      if (Array.isArray(n.vms)) for (const vm of n.vms) { if (vm && vm.mac) deviceSigs.push(normMac(vm.mac)); }
      if (!n.mac) continue;
      deviceSigs.push(normMac(n.mac));
      // I passivi SENZA IP proprio (prese a muro/patch panel/passacavi/quadri) non
      // hanno identità di rete verificabile → fuori dall'audit di presenza.
      if (isPassiveNoIp(n)) continue;
      macs.push({
        mac: n.mac,
        label: nodeLabel(n),
        nodeId: n.id,
        ip: ((n.integration && n.integration.host) || n.ip || '').trim(),
        ipManual: !!n.ipManual,
      });
    }
    for (const pid of Object.keys(portsState)) { const mm = portsState[pid] && portsState[pid].mac; if (mm) deviceSigs.push(normMac(mm)); }
    const cables = links.map(l => ({ id: l.id, label: cableLabel(l), src: l.src, dst: l.dst }));
    return { ports, macs, deviceSigs, cables };
  }

  // ── 2/3) Snapshot REALTÀ ─────────────────────────────────────────────
  function buildSnmpSnapshot(model) {
    const m = model || {};
    const nodes = m.nodes || [];
    const docPorts = m.docPorts || {};
    const portsState = m.ports || {};
    const fdb = (m.fdb && typeof m.fdb === 'object') ? m.fdb : {};
    const vlanCache = (m.vlanCache && typeof m.vlanCache === 'object') ? m.vlanCache : {};
    const reach = (m.reachable && typeof m.reachable === 'object') ? m.reachable : null;
    const arp = (m.arpTable && typeof m.arpTable === 'object') ? m.arpTable : null;
    const leases = Array.isArray(m.leases) ? m.leases : [];
    const knownSigs = m.knownSigs || [];
    const rejectedAutoLinks = m.rejectedAutoLinks || [];
    const normMac = typeof m.normMac === 'function' ? m.normMac : (x => String(x == null ? '' : x).toLowerCase());
    const isVirtualMac = typeof m.isVirtualMac === 'function' ? m.isVirtualMac : (() => false);
    const isRandomizedMac = typeof m.isRandomizedMac === 'function' ? m.isRandomizedMac : (() => false);
    const leaseStale = typeof m.isLeaseStale === 'function' ? m.isLeaseStale : (() => false);
    const countMacsPerPort = typeof m.countMacsPerPort === 'function' ? m.countMacsPerPort : (() => ({}));
    const fdbSeenLabel = typeof m.fdbSeenLabel === 'function' ? m.fdbSeenLabel : ((sw, ifName) => `${sw}${ifName ? ' · ' + ifName : ''}`);
    const leaseSeenLabel = typeof m.leaseSeenLabel === 'function' ? m.leaseSeenLabel : ((ip, hn) => `${ip}${hn ? ' · ' + hn : ''}`);

    const responded = {};
    for (const n of nodes) { if (n.snmpStatus === 'ok') responded[n.id] = true; }
    // Osservabilità: la sweep ha girato se ha trovato vivo almeno un host OPPURE
    // se c'è una tabella ARP non vuota (anch'essa una vista della rete).
    const reachabilityChecked = (!!reach && Object.values(reach).some(r => r && r.alive))
      || (!!arp && Object.keys(arp).length > 0);
    // Presenza multi-segnale: SNMP risposto OPPURE IP raggiunto dalla sweep.
    const presentNodeIds = {};
    for (const n of nodes) {
      if (n.snmpStatus === 'ok') { presentNodeIds[n.id] = true; continue; }
      if (reach) {
        const ip = ((n.integration || {}).host || n.ip || '').trim();
        if (ip && reach[ip] && reach[ip].alive) presentNodeIds[n.id] = true;
      }
    }
    // MAC→IP dalla tabella ARP completa del segmento (un MAC visto vivo a un IP è
    // presente; IP diverso dal documentato = cambio IP). Fallback ai soli IP
    // documentati raggiunti se non c'è ARP.
    const macAtIp = {};
    if (arp) {
      for (const ip of Object.keys(arp)) {
        const k = String(arp[ip] || '').toLowerCase();
        if (k && !macAtIp[k]) macAtIp[k] = ip;
      }
    } else if (reach) {
      for (const ip of Object.keys(reach)) {
        const info = reach[ip];
        if (info && info.alive && info.mac) {
          const k = String(info.mac).toLowerCase();
          if (k && !macAtIp[k]) macAtIp[k] = ip;
        }
      }
    }
    // /24 OSSERVATI dalla sweep (fix falso "assente" cross-subnet).
    const observedSubnets = new Set();
    if (arp) { for (const ip of Object.keys(arp)) { const n = _net24(ip); if (n) observedSubnets.add(n); } }
    if (reach) { for (const ip of Object.keys(reach)) { if (reach[ip] && reach[ip].alive) { const n = _net24(ip); if (n) observedSubnets.add(n); } } }
    const ports = {};
    for (const pid of Object.keys(docPorts)) {
      const pi = portsState[pid] || {};
      ports[pid] = { status: _pref(pi.status, null), speed: _pref(pi.speed, null), duplex: _pref(pi.duplex, null), vlan: _pref(pi.vlan, null) };
    }
    // Osservabilità L2: almeno una MAC-table (FDB) popolata? Senza, il motore non
    // dichiara nessuno "assente" (guardia macOrphan in drift-report.js).
    const fdbObserved = Object.values(fdb).some(tbl => tbl && Object.keys(tbl).length > 0);
    const observedMacs = [];
    for (const sw of Object.keys(fdb)) { for (const mac of Object.keys(fdb[sw] || {})) observedMacs.push(mac); }
    for (const pid of Object.keys(portsState)) { const mm = portsState[pid] && portsState[pid].mac; if (mm) observedMacs.push(mm); }
    const known = new Set(knownSigs);
    const observedDevices = [];
    const seen = new Set();
    for (const sw of Object.keys(fdb)) {
      const swFdb = fdb[sw] || {};
      const swVlan = vlanCache[sw] || {};
      // MAC per porta: un uplink affollato (AP/hub/guest) raccoglie tanti MAC su
      // una sola ifName → tutti endpoint, non infrastruttura.
      const macsPerIf = countMacsPerPort(swFdb) || {};
      for (const mac of Object.keys(swFdb)) {
        const ifName = swFdb[mac];
        const sig = normMac(mac);
        if (!sig || seen.has(sig) || known.has(sig) || isVirtualMac(mac)) continue;
        seen.add(sig);
        observedDevices.push({
          sig, mac,
          label: fdbSeenLabel(sw, ifName),
          vlan: (swVlan[mac] != null) ? swVlan[mac] : null,
          portMacCount: macsPerIf[ifName] || 0,
          consumer: isRandomizedMac(mac),
        });
      }
    }
    // rejectedAutoLinks → MAC delle porte coinvolte (un device rifiutato non riappare)
    const rejectedSigs = [];
    for (const psig of rejectedAutoLinks) {
      for (const pid of String(psig).split('||')) { const mm = portsState[pid] && portsState[pid].mac; if (mm) rejectedSigs.push(normMac(mm)); }
    }
    const portDownStreak = {};
    for (const pid of Object.keys(docPorts)) portDownStreak[pid] = (portsState[pid] && portsState[pid].downStreak) || 0;
    // ── Lease DHCP come FONTE (cross-VLAN) ───────────────────────────────
    // MAC→IP autorevole su TUTTE le VLAN (ciò che l'ARP locale non vede dietro un
    // firewall L3). G2: un lease scaduto/rilasciato non prova né presenza né IP.
    // G1: il lease prova la presenza del SUO MAC e dà l'IP corrente, ma NON marca
    // la subnet come "osservata" → un documentato senza lease resta non-verificabile.
    let leaseChecked = false;
    for (const l of leases) {
      const macLc = String((l && l.mac) || '').toLowerCase();
      const ip = String((l && l.ip) || '').trim();
      if (!macLc || !ip || leaseStale(l)) continue;
      if (!macAtIp[macLc]) macAtIp[macLc] = ip;   // ARP vivo ha priorità
      observedMacs.push(l.mac);                    // il MAC col lease è "visto"
      const sig = normMac(l.mac);
      if (sig && !known.has(sig) && !seen.has(sig)) {
        seen.add(sig);
        observedDevices.push({ sig, mac: l.mac, label: leaseSeenLabel(ip, l.hostname), vlan: (l && l.vlan != null) ? l.vlan : null, portMacCount: 0, consumer: false });
      }
      leaseChecked = true;
    }

    return {
      responded, ports, observedMacs, observedDevices, rejectedSigs, portDownStreak,
      fdbObserved, presentNodeIds, reachabilityChecked: reachabilityChecked || leaseChecked,
      macAtIp, observedSubnets: [...observedSubnets],
    };
  }

  return { buildDocSnapshot, buildSnmpSnapshot };
});
