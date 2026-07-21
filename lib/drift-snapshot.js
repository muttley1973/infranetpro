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
// ── buildDocSnapshot(model) → { ports, macs, ipOnly, deviceSigs, cables } ────
//    ipOnly = documentati CON IP ma SENZA MAC ({nodeId,label,ip,hasSnmp}):
//    audit di presenza per-nodeId (non per-MAC) in buildDriftReport.
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
//     snmpArp,                              // { macLower: ip4 } ARP dei router/switch L3 (Fase 2): presenza VIVA cross-subnet → macAtIp/observedMacs (verde) + observedSubnets
//     snmpNd,                               // { macLower: ip6 } Neighbor Discovery IPv6 dei router/switch L3 (ND discovery): presenza VIVA cross-subnet → SOLO observedMacs (verde per-MAC). NON alimenta macAtIp/observedSubnets (vedi blocco consumo)
//     leases, knownSigs, rejectedAutoLinks, // lease DHCP, firme note, link rifiutati
//     leaseReleasedHint,                    // bool opt-in: se true, un lease `state==='released'` → releasedMacs (sfumatura debole "probabilmente scollegato"; MAI da expiry, MAI rosso)
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
    // Documentati CON IP ma SENZA MAC (infra/endpoint mai sincronizzati con
    // successo): audit di presenza SEPARATO, per-nodeId (SNMP risposto / sweep),
    // non per-MAC. Senza questo restavano a colori pieni anche se irraggiungibili.
    const ipOnly = [];
    const deviceSigs = [];
    for (const n of nodes) {
      // VM ospitate: MAC "noti" → fuori dai non-documentati. SOLO deviceSigs,
      // NON macs: una VM (magari spenta) non entra nell'audit di presenza.
      if (Array.isArray(n.vms)) for (const vm of n.vms) { if (vm && vm.mac) deviceSigs.push(normMac(vm.mac)); }
      const ip = ((n.integration && n.integration.host) || n.ip || '').trim();
      if (!n.mac) {
        // Senza MAC ma con IP e non-passivo → nell'audit per-nodeId.
        if (ip && !isPassiveNoIp(n)) {
          const drv = String((n.integration && n.integration.driver) || '');
          ipOnly.push({ nodeId: n.id, label: nodeLabel(n), ip, hasSnmp: drv.indexOf('snmp') === 0 });
        }
        continue;
      }
      deviceSigs.push(normMac(n.mac));
      // I passivi SENZA IP proprio (prese a muro/patch panel/passacavi/quadri) non
      // hanno identità di rete verificabile → fuori dall'audit di presenza.
      if (isPassiveNoIp(n)) continue;
      macs.push({
        mac: n.mac,
        label: nodeLabel(n),
        nodeId: n.id,
        ip,
        ipManual: !!n.ipManual,
      });
    }
    for (const pid of Object.keys(portsState)) { const mm = portsState[pid] && portsState[pid].mac; if (mm) deviceSigs.push(normMac(mm)); }
    const cables = links.map(l => ({ id: l.id, label: cableLabel(l), src: l.src, dst: l.dst }));
    return { ports, macs, ipOnly, deviceSigs, cables };
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
    const snmpArp = (m.snmpArp && typeof m.snmpArp === 'object') ? m.snmpArp : null;   // Fase 2: ARP router/switch L3 (mac→ip4)
    const snmpNd  = (m.snmpNd  && typeof m.snmpNd  === 'object') ? m.snmpNd  : null;   // ND discovery: Neighbor Discovery IPv6 router/switch L3 (mac→ip6)
    const leases = Array.isArray(m.leases) ? m.leases : [];
    const leaseReleasedHint = m.leaseReleasedHint === true;   // opt-in: lease RILASCIATO = sfumatura debole "probabilmente scollegato" (mai da expiry, mai rosso)
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
    // Assenza AFFIDABILE per-nodeId (presenza "onesta"): SOLO se la sweep ha provato
    // che l'IP documentato è sul FILO locale e non risponde più all'ARP dopo il ping
    // (`reach[ip].absent === true`, calcolato lato server). È l'unico segnale che
    // autorizza il "rosso" a valle (drift-report); qualunque altro silenzio (SNMP
    // muto, FDB invecchiata, ICMP filtrato, IP remoto) resta "non-verificato" (grigio).
    // Nel Sync NON c'è sweep → reach assente → trustAbsentNodeIds vuoto → mai rosso.
    const trustAbsentNodeIds = {};
    if (reach) {
      for (const n of nodes) {
        const ip = ((n.integration || {}).host || n.ip || '').trim();
        if (ip && reach[ip] && reach[ip].absent === true) trustAbsentNodeIds[n.id] = true;
      }
    }
    // MAC→IP dalla tabella ARP completa del segmento (un MAC visto vivo a un IP è
    // presente; IP diverso dal documentato = cambio IP). Fallback ai soli IP
    // documentati raggiunti se non c'è ARP.
    // Un MAC può essere vivo su PIÙ IP contemporaneamente (alias eth0:1, dual-IP
    // di NAS/stampanti, multihoming): macAtIps li conserva TUTTI — il cambio-IP va
    // dichiarato solo se il documentato non è in nessuno. macAtIp (primo visto)
    // resta per compatibilità col contratto storico.
    const macAtIp = {};
    const macAtIps = {};
    const releasedMacs = {};   // { macLower: {ip, hostname} } — solo se leaseReleasedHint: lease RILASCIATO (sfumatura debole per drift-report)
    const _addLive = (mac, ip) => {
      const k = String(mac || '').toLowerCase();
      if (!k || !ip) return;
      if (!macAtIp[k]) macAtIp[k] = ip;
      if (!macAtIps[k]) macAtIps[k] = [];
      if (macAtIps[k].indexOf(ip) < 0) macAtIps[k].push(ip);
    };
    if (arp) {
      for (const ip of Object.keys(arp)) _addLive(arp[ip], ip);
    } else if (reach) {
      for (const ip of Object.keys(reach)) {
        const info = reach[ip];
        if (info && info.alive && info.mac) _addLive(info.mac, ip);
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
      if (!macLc || !ip) continue;
      // Segnale DEBOLE opt-in: un lease RILASCIATO (il device ha mandato DHCPRELEASE, gesto
      // deliberato "me ne vado") è un INDIZIO, mai una prova. SOLO `state==='released'`, MAI da
      // `expiry` (un file lease importato vecchio marcherebbe di massa). NON tocca la presenza
      // (resta grigio, mai rosso): drift-report lo usa solo per annotare la voce unverified.
      // Il device è già stato dedup-ato per-MAC a monte → `released` = il suo lease più corrente.
      if (leaseReleasedHint && l && l.state === 'released') releasedMacs[macLc] = { ip, hostname: (l.hostname || '') };
      if (leaseStale(l)) continue;   // scaduto/rilasciato/declinato/free → nessun segnale di presenza
      // ARP vivo ha priorità: il lease riempie solo i MAC senza segnale vivo.
      if (!macAtIp[macLc]) macAtIp[macLc] = ip;
      if (!macAtIps[macLc]) macAtIps[macLc] = [ip];
      observedMacs.push(l.mac);                    // il MAC col lease è "visto"
      const sig = normMac(l.mac);
      if (sig && !known.has(sig) && !seen.has(sig)) {
        seen.add(sig);
        observedDevices.push({ sig, mac: l.mac, label: leaseSeenLabel(ip, l.hostname), vlan: (l && l.vlan != null) ? l.vlan : null, portMacCount: 0, consumer: false });
      }
      leaseChecked = true;
    }

    // ── ARP dei router/switch L3 come FONTE cross-subnet (Fase 2, presenza onesta) ──
    // La ipNetToMedia/ipNetToPhysicalTable di un router prova che gli host sulle sue
    // VLAN sono VIVI (adiacenza L3) → verde SENZA che il server li pinghi, anche dietro
    // un firewall. Alimenta: presenza per-MAC (macAtIp/macAtIps → verde, e cambio-IP se
    // l'IP del router ≠ documentato), "visto in rete" (observedMacs) e marca la /24 come
    // OSSERVATA (a differenza del lease G1: qui il router RAGGIUNGE davvero quel segmento
    // → in Verifica la sua VLAN risulta "coperta"). NON marca reachabilityChecked (non è
    // una probe attiva; in Sync observedSubnets resta inerte, gate su sweepRan) e NON crea
    // non-documentati (resta questione di discovery). L'ARP vivo dello sweep ha priorità.
    if (snmpArp) {
      for (const mac of Object.keys(snmpArp)) {
        const ip = String(snmpArp[mac] || '').trim();
        if (!ip) continue;
        _addLive(mac, ip);                                  // presenza per-MAC (gap-fill: lo sweep vivo vince)
        observedMacs.push(mac);                             // il MAC è "visto in rete" → presente
        const nt = _net24(ip);
        if (nt) observedSubnets.add(nt);                    // la VLAN dietro il router è osservata
      }
    }

    // ── Neighbor Discovery IPv6 dei router/switch L3 (ND discovery, presenza onesta) ──
    // La ipNetToPhysicalTable IPv6 (vicini ND) di un router prova che un MAC è un vicino
    // VIVO dietro di lui → verde cross-subnet SENZA pingarlo, anche per un host IPv6-only
    // o il cui ARP IPv4 è invecchiato (li coglie dove la Fase 2 no). Gemello di snmpArp
    // ma PRESENCE-ONLY, di proposito: alimenta SOLO observedMacs (verde per-MAC). NON
    // chiama _addLive/macAtIps — un IPv6 di ND NON deve entrare nel rilevamento cambio-IP:
    // (1) cross-family, marcherebbe un nodo documentato con IPv4 come "cambio IP" verso un
    //     ip6 (drift-report confronta il doc-IP con la lista degli IP vivi del MAC);
    // (2) il cambio dell'ip6 PROPRIO è già gestito, in modo autorevole e col lucchetto,
    //     dalla ipAddressTable del device stesso (66ª) — l'ND del router è un segnale
    //     debole. E NON tocca observedSubnets: un /64 IPv6 non è una /24 (_net24 è IPv4).
    if (snmpNd) {
      for (const mac of Object.keys(snmpNd)) observedMacs.push(mac);   // vicino ND vivo → "visto in rete" → presente (verde)
    }

    return {
      responded, ports, observedMacs, observedDevices, rejectedSigs, portDownStreak,
      fdbObserved, presentNodeIds, trustAbsentNodeIds, reachabilityChecked: reachabilityChecked || leaseChecked,
      macAtIp, macAtIps, observedSubnets: [...observedSubnets], releasedMacs,
    };
  }

  return { buildDocSnapshot, buildSnmpSnapshot };
});
