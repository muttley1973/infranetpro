// ============================================================
// TOPO-LINES — costruzione PURA della lista linee della topologia
// (hardening rendering, sessione 22).
//
// Separa il "COSA disegnare" (questa lib: dati → descrittori) dal "COME"
// (lib/app-topology-overlay.js: descrittori → SVG + eventi). Le 3 passate del
// pairMap (LLDP/CDP, rack-rack manuali, floor-floor manuali), la risoluzione
// colore, il fan-out floor↔rack e i badge alert intra-rack diventano una
// funzione pura TESTABILE: un test "nessun link disegnato due volte" avrebbe
// prevenuto il bug del doppio cavo (sessione 21, passata-4 vs fan-out).
//
// buildTopoLines(model) → { pairs, fanout, rackAlerts }
//
//   pairs[]      linee aggregate rack↔rack e floor↔floor (gia' filtrate per
//                VLAN, con colore risolto, conteggio, ambiguita' per catena)
//   fanout[]     linee floor↔rack (una per LINK, per ogni rack piazzato;
//                emphasized/interactive solo per rack corrente/hover)
//   rackAlerts[] rack piazzati con cavi intra-rack inferiti (badge "!")
//
// model: SOLO plain-data + helper iniettati (niente DOM, niente globali):
//   nodes, links, racks, types (TYPES), topoData ({nodes,edges}|null),
//   currentRack, hoverRackId, filterVlan, vlanColors,
//   trunkOnly (toggle legenda: evidenzia i trunk → le linee non-trunk escono
//   con trunkDim=true e il renderer le attenua),
//   highPathIds (Set), selectedLinkId,
//   helpers: { portNodeId, portDisplayName, linkVlan, linkMatchesVlanFilter,
//              rackPairMatchesVlan, isAmbiguousLink, chainAmbiguousIds (Set|null),
//              chainColors (Map|null), findPortByIfName, findProjectLinkByPorts }
//
// Condivisa browser + test (UMD-lite). NON muta il model.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GREY = '#8b949e';

  // Spessore linea coppia in funzione del numero di link aggregati.
  function _pairWidth(count) { return Math.min(0.9 + count * 0.3, 3); }

  function buildTopoLines(model) {
    const m = model || {};
    const nodes = m.nodes || [];
    const links = m.links || [];
    const racks = m.racks || [];
    const types = m.types || {};
    const vlanColors = m.vlanColors || {};
    const H = m.helpers || {};
    const portNodeId = H.portNodeId || (pid => String(pid || '').split('-')[0]);
    const portName = H.portDisplayName || (pid => String(pid || ''));
    const linkVlan = typeof H.linkVlan === 'function' ? H.linkVlan : () => 1;
    const linkMatchesFilter = typeof H.linkMatchesVlanFilter === 'function' ? H.linkMatchesVlanFilter : () => true;
    const rackPairMatches = typeof H.rackPairMatchesVlan === 'function' ? H.rackPairMatchesVlan : () => true;
    const isAmb = typeof H.isAmbiguousLink === 'function' ? H.isAmbiguousLink : () => false;
    const chainAmb = H.chainAmbiguousIds || null;     // Set<linkId> | null
    const chainCol = H.chainColors || null;           // Map<linkId,color> | null
    const findPortByIfName = typeof H.findPortByIfName === 'function' ? H.findPortByIfName : () => '';
    const findProjectLink = typeof H.findProjectLinkByPorts === 'function' ? H.findProjectLinkByPorts : () => null;
    // Trunk effettivo (anche derivato da voce/SSID). Fallback: link.mode === 'trunk'.
    const linkIsTrunk = typeof H.linkIsTrunk === 'function' ? H.linkIsTrunk : (lk => lk && lk.mode === 'trunk');
    const linkTrunkVlans = typeof H.linkTrunkVlans === 'function' ? H.linkTrunkVlans : (lk => (lk && lk.trunkVlans) || '');

    // Indici O(1) (perf: prima erano scan lineari O(n) dentro loop → il fanout era
    // O(rack×link×nodi), cubico sulle reti grandi; ~4s a 1920 nodi). First-wins come
    // lo scan originale (guardia !has). Output invariato (golden).
    const _nodeMap = new Map(); for (const n of nodes) if (n && !_nodeMap.has(n.id)) _nodeMap.set(n.id, n);
    const _rackMap = new Map(); for (const r of racks) if (r && !_rackMap.has(r.id)) _rackMap.set(r.id, r);
    const _linkMap = new Map(); for (const l of links) if (l && !_linkMap.has(l.id)) _linkMap.set(l.id, l);
    const nodeById = id => _nodeMap.get(id) || null;
    const rackById = id => _rackMap.get(id) || null;
    const linkById = id => _linkMap.get(id) || null;
    // Nodi per rack (tutti i tipi), in ordine di `nodes` (preserva l'ordine dei filter
    // originali). Usato dalla conferma rack-rack (passata 1) e dal fanout.
    const _nodesByRack = new Map();
    for (const n of nodes) {
      if (!n || n.rackId == null) continue;
      let a = _nodesByRack.get(n.rackId); if (!a) { a = []; _nodesByRack.set(n.rackId, a); }
      a.push(n);
    }

    // ---- pairMap: key → entry aggregata ------------------------------------
    const pairMap = new Map();

    function rackPairEntry(rA, rB) {
      if (!rA || !rB || rA.id === rB.id) return null;
      if (rA.x === undefined || rB.x === undefined) return null;
      const sorted = [rA, rB].sort((a, b) => a.id.localeCompare(b.id));
      const key = sorted.map(r => r.id).join('|');
      if (!pairMap.has(key)) pairMap.set(key, {
        sx: sorted[0].x, sy: sorted[0].y, dx: sorted[1].x, dy: sorted[1].y,
        rackAId: sorted[0].id, rackBId: sorted[1].id,
        srcName: sorted[0].name || sorted[0].id, dstName: sorted[1].name || sorted[1].id,
        protocols: new Set(), confirmed: false, edgeList: [], vlanCounts: {}
      });
      return pairMap.get(key);
    }

    function floorPairEntry(sn, dn) {
      if (sn.x === undefined || dn.x === undefined) return null;
      const sorted = [sn, dn].sort((a, b) => a.id.localeCompare(b.id));
      const key = sorted.map(n => n.id).join('|');
      if (!pairMap.has(key)) pairMap.set(key, {
        sx: sorted[0].x, sy: sorted[0].y, dx: sorted[1].x, dy: sorted[1].y,
        rackAId: null, rackBId: null,
        srcName: sorted[0].name || sorted[0].label || sorted[0].id,
        dstName: sorted[1].name || sorted[1].label || sorted[1].id,
        // vlanCounts SEMPRE inizializzato: nell'overlay originale la entry
        // floor-floor di passata 1 ne era priva → TypeError latente quando la
        // stessa coppia riceveva poi un cavo manuale con VLAN>1 (passata 3).
        protocols: new Set(), confirmed: false, edgeList: [], vlanCounts: {}
      });
      return pairMap.get(key);
    }

    function accumulateVlan(entry, link) {
      const vl = linkVlan(link);
      if (vl > 1) entry.vlanCounts[vl] = (entry.vlanCounts[vl] || 0) + 1;
      else if (vl === 1) entry.hasVlan1 = true;
    }

    // ---- PASSATA 1: link scoperti via LLDP/CDP (topoData) -------------------
    if (m.topoData) {
      const tNodes = m.topoData.nodes || [];
      const tEdges = m.topoData.edges || [];
      // Indice O(1) dei nodi topo (prima `tNodes.find` per ogni edge = O(edge×nodi)).
      const _tNodeMap = new Map(); for (const x of tNodes) if (x && !_tNodeMap.has(x.id)) _tNodeMap.set(x.id, x);
      for (const e of tEdges) {
        const srcTopo = _tNodeMap.get(e.src);
        const dstTopo = _tNodeMap.get(e.dst);
        if (!srcTopo?.nodeId || !dstTopo?.nodeId) continue;
        const sn = nodeById(srcTopo.nodeId);
        const dn = nodeById(dstTopo.nodeId);
        if (!sn || !dn) continue;
        const sp = findPortByIfName(srcTopo.nodeId, e.srcPort);
        const dp = findPortByIfName(dstTopo.nodeId, e.dstPort);
        const projectLink = findProjectLink(sp, dp);

        let entry = null;
        if (types[sn.type]?.isRack && types[dn.type]?.isRack) {
          entry = rackPairEntry(rackById(sn.rackId), rackById(dn.rackId));
        } else if (types[sn.type]?.isFloor && types[dn.type]?.isFloor) {
          entry = floorPairEntry(sn, dn);
        }
        if (!entry) continue;
        entry.protocols.add(e.protocol || 'LLDP');
        if (projectLink) entry.confirmed = true;
        entry.edgeList.push({
          srcPort: sp ? portName(sp) : (e.srcPort || '?'),
          dstPort: dp ? portName(dp) : (e.dstPort || '?'),
          protocol: e.protocol || 'LLDP',
          linkId: projectLink?.id || '',
          srcPid: sp || '',
          dstPid: dp || ''
        });
      }

      // Conferma delle coppie rack-rack scoperte: c'e' un cavo del progetto
      // fra QUALSIASI device dei due rack?
      for (const [, p] of pairMap) {
        if (!p.rackAId) continue; // floor pair — skip
        const rANids = new Set((_nodesByRack.get(p.rackAId) || []).map(n => n.id));
        const rBNids = new Set((_nodesByRack.get(p.rackBId) || []).map(n => n.id));
        p.confirmed = links.some(l => {
          const ls = portNodeId(l.src), ld = portNodeId(l.dst);
          return (rANids.has(ls) && rBNids.has(ld)) || (rBNids.has(ls) && rANids.has(ld));
        });
      }
    }

    // ---- PASSATA 2: cavi manuali rack↔rack (cross-rack) ---------------------
    for (const link of links) {
      const sn = nodeById(portNodeId(link.src));
      const dn = nodeById(portNodeId(link.dst));
      if (!sn || !dn) continue;
      if (!(types[sn.type]?.isRack && types[dn.type]?.isRack)) continue;
      if (sn.rackId === dn.rackId) continue;
      const entry = rackPairEntry(rackById(sn.rackId), rackById(dn.rackId));
      if (!entry) continue;
      entry.confirmed = true;
      entry.protocols.add('Manual');
      if (!entry.edgeList.some(e => e.linkId === link.id)) {
        entry.edgeList.push({
          srcPort: portName(link.src), dstPort: portName(link.dst),
          protocol: 'Manual', linkId: link.id, srcPid: link.src, dstPid: link.dst
        });
      }
      accumulateVlan(entry, link);
    }

    // ---- PASSATA 3: cavi manuali floor↔floor --------------------------------
    for (const link of links) {
      const sn = nodeById(portNodeId(link.src));
      const dn = nodeById(portNodeId(link.dst));
      if (!sn || !dn) continue;
      const sFloor = types[sn.type]?.isFloor && !types[sn.type]?.isStructural;
      const dFloor = types[dn.type]?.isFloor && !types[dn.type]?.isStructural;
      if (!sFloor || !dFloor) continue;
      const entry = floorPairEntry(sn, dn);
      if (!entry) continue;
      entry.confirmed = true;
      entry.protocols.add('Manual');
      if (!entry.edgeList.some(e => e.linkId === link.id)) {
        entry.edgeList.push({
          srcPort: portName(link.src), dstPort: portName(link.dst),
          protocol: 'Manual', linkId: link.id, srcPid: link.src, dstPid: link.dst
        });
      }
      accumulateVlan(entry, link);
    }

    // NOTA: i cavi MISTI floor↔rack NON entrano nel pairMap — sono SOLO fanout
    // (una passata che li metteva anche qui li raddoppiava: bug sessione 21).

    // ---- Risoluzione colore per coppia --------------------------------------
    // Priorita': VLAN dominante (>1) → colore manuale (colorOvr) → colore
    // catena → colore VLAN 1 (coerenza col floor) → grigio.
    for (const [, p] of pairMap) {
      const ve = Object.entries(p.vlanCounts || {}).sort((a, b) => +b[1] - +a[1]);
      p.vlanColor = ve.length && vlanColors[+ve[0][0]] ? vlanColors[+ve[0][0]] : null;
      if (!p.vlanColor) {
        for (const e of (p.edgeList || [])) {
          const lk = e.linkId && linkById(e.linkId);
          const c = lk && (lk.colorOvr || lk.color);
          if (c) { p.manualColor = c; break; }
        }
        if (p.hasVlan1 && vlanColors[1]) p.vlan1Color = vlanColors[1];
      }
    }

    // ---- pairs[]: filtro VLAN + ambiguita' + colore finale -------------------
    const highIds = m.highPathIds || new Set();          // link evidenziati (percorso fisico / selezione)
    const onPath = lid => !!lid && (highIds.has(lid) || m.selectedLinkId === lid);
    const pairs = [];
    for (const [key, p] of pairMap) {
      if (m.filterVlan) {
        if (p.rackAId && p.rackBId && !rackPairMatches(p.rackAId, p.rackBId)) continue;
        if (!p.rackAId) {
          const ok = p.edgeList.some(e => {
            if (!e.linkId) return false;
            const lk = linkById(e.linkId);
            return lk && linkMatchesFilter(lk);
          });
          if (!ok) continue;
        }
      }
      // Ambiguita' per-catena (chain-aware) con fallback per-link.
      let ambiguous = false;
      if (chainAmb) {
        for (const e of p.edgeList) { if (e.linkId && chainAmb.has(e.linkId)) { ambiguous = true; break; } }
      } else {
        for (const e of p.edgeList) {
          if (!e.linkId) continue;
          const lk = linkById(e.linkId);
          if (lk && isAmb(lk)) { ambiguous = true; break; }
        }
      }
      let chainColor = null;
      if (chainCol) for (const e of p.edgeList) {
        if (e.linkId && chainCol.has(e.linkId)) { chainColor = chainCol.get(e.linkId); break; }
      }
      const kind = (p.rackAId && p.rackBId) ? 'rack-rack' : 'floor-floor';
      const [nodeAId, nodeBId] = kind === 'floor-floor' ? key.split('|') : [null, null];
      // Trunk: la coppia contiene almeno un link documentato in modalita' trunk.
      // (Gli edge LLDP senza link di progetto non possono saperlo → false.)
      let hasTrunk = false, wireless = false;
      for (const e of p.edgeList) {
        const lk = e.linkId && linkById(e.linkId);
        if (lk && linkIsTrunk(lk)) hasTrunk = true;
        if (lk && lk.wireless) wireless = true;   // coppia wireless → resa "a onda"
      }
      pairs.push({
        key, kind,
        rackAId: p.rackAId, rackBId: p.rackBId, nodeAId, nodeBId,
        sx: p.sx, sy: p.sy, dx: p.dx, dy: p.dy,
        srcName: p.srcName, dstName: p.dstName,
        protocol: p.protocols.has('CDP') ? 'CDP' : p.protocols.has('LLDP') ? 'LLDP' : 'Manual',
        confirmed: p.confirmed, ambiguous, wireless,
        color: p.vlanColor || p.manualColor || chainColor || p.vlan1Color || GREY,
        count: p.edgeList.length,
        width: _pairWidth(p.edgeList.length),
        edges: p.edgeList,
        hasTrunk,
        trunkDim: !!m.trunkOnly && !hasTrunk,   // toggle attivo → attenua le non-trunk
        selected: p.edgeList.some(e => onPath(e.linkId)),   // su percorso fisico / selezione
      });
    }

    // ---- fanout[]: cavi floor↔rack, per ogni rack piazzato -------------------
    const fanout = [];
    for (const r of racks) {
      if (!r || r.x === undefined) continue;
      const emphasized = (r.id === m.currentRack) || (r.id === m.hoverRackId);
      const rackNids = new Set((_nodesByRack.get(r.id) || []).filter(n => types[n.type]?.isRack).map(n => n.id));
      for (const link of links) {
        const sNid = portNodeId(link.src), dNid = portNodeId(link.dst);
        const sn = nodeById(sNid), dn = nodeById(dNid);
        if (!sn || !dn) continue;
        let rackNode, floorNode, rPortId, fPortId;
        if (rackNids.has(sNid) && types[dn.type]?.isFloor && !types[dn.type]?.isStructural) {
          rackNode = sn; floorNode = dn; rPortId = link.src; fPortId = link.dst;
        } else if (rackNids.has(dNid) && types[sn.type]?.isFloor && !types[sn.type]?.isStructural) {
          rackNode = dn; floorNode = sn; rPortId = link.dst; fPortId = link.src;
        } else continue;
        if (floorNode.x === undefined || floorNode.y === undefined) continue;
        if (m.filterVlan && !linkMatchesFilter(link)) continue;
        const vl = linkVlan(link);
        fanout.push({
          kind: 'fanout', rackId: r.id, wireless: !!link.wireless,
          emphasized, interactive: emphasized,
          opacity: emphasized ? 0.78 : 0.38,
          width: emphasized ? 1.8 : 1.2,
          linkId: link.id, floorNodeId: floorNode.id, rackNodeId: rackNode.id,
          fx: floorNode.x, fy: floorNode.y, rx: r.x, ry: r.y,
          rPortId, fPortId,
          rPortName: portName(rPortId),
          fPortName: portName(fPortId) || floorNode.name || types[floorNode.type]?.name || floorNode.type,
          color: link.colorOvr || vlanColors[vl] || '#6e7681',
          ambiguous: isAmb(link),
          selected: highIds.has(link.id) || (m.selectedLinkId === link.id),
          srcName: rackNode.name || rackNode.hostname || types[rackNode.type]?.name || rackNode.type,
          dstName: floorNode.name || types[floorNode.type]?.name || floorNode.type,
          nodeTypeName: types[floorNode.type]?.name || floorNode.type,
          mode: linkIsTrunk(link) ? 'trunk' : 'access',
          vlan: vl,
          trunkVlans: linkTrunkVlans(link),
          trunkDim: !!m.trunkOnly && !linkIsTrunk(link),   // toggle attivo → attenua le non-trunk
        });
      }
    }

    // ---- rackAlerts[]: cavi intra-rack inferiti → badge "!" sul rack ---------
    const rackAlerts = [];
    const alerted = new Set();
    for (const link of links) {
      if (!isAmb(link)) continue;
      const sn = nodeById(portNodeId(link.src));
      const dn = nodeById(portNodeId(link.dst));
      if (!sn || !dn) continue;
      if (!types[sn.type]?.isRack || !types[dn.type]?.isRack) continue;
      if (sn.rackId && sn.rackId === dn.rackId && !alerted.has(sn.rackId)) {
        const rk = rackById(sn.rackId);
        if (rk && rk.x !== undefined) {
          alerted.add(rk.id);
          rackAlerts.push({ rackId: rk.id, x: rk.x, y: rk.y, name: rk.name || rk.id });
        }
      }
    }

    // Toggle "WLAN" (legenda): nasconde tutte le connessioni wireless (onde),
    // sia coppie floor↔floor sia fan-out. Filtro in place → vale per ogni return.
    if (m.hideWireless) {
      for (let i = pairs.length - 1; i >= 0; i--) if (pairs[i].wireless) pairs.splice(i, 1);
      for (let i = fanout.length - 1; i >= 0; i--) if (fanout[i].wireless) fanout.splice(i, 1);
    }

    // Percorso fisico (doppio click su un cavo): mostra SOLO i segmenti del
    // percorso, evidenziati. Le linee dell'overlay sanno disegnare rack↔presa
    // (fanout) e presa↔endpoint (coppia floor-floor): cosi' tutto il run resta
    // visibile in topologia, anche il tratto lato-rack che nei cavi reali
    // finirebbe solo nel viewport del rack.
    if (m.physicalTrace && highIds.size) {
      return {
        pairs: pairs.filter(p => p.selected),
        fanout: fanout.filter(f => f.selected),
        rackAlerts: [],
      };
    }

    // Toggle "Endpoint" (legenda): nasconde SOLO l'ultimo spezzone verso il
    // device endpoint (presa↔endpoint o endpoint↔rack) e lascia tutto il resto
    // (presa↔patch↔switch, backbone rack↔rack). "Endpoint" = device floor CON IP
    // (anche pass-through, es. VoIP) — presa/patch/mediaconv (conduit senza IP)
    // restano visibili come confine "fino alla wall-port".
    //
    // Vale ANCHE col filtro VLAN attivo: il toggle comanda comunque (ENDPOINT ON =
    // percorso completo fino al device; ENDPOINT OFF = ferma alla wall-port). Il
    // filtro NON forza il nascondi-endpoint, così selezionando una VLAN con
    // ENDPOINT attivo si vede tutto il percorso fino al device.
    if (m.hideEndpoints) {
      const isEndpointType = t => {
        const d = types[t];
        if (!d || !d.isFloor || d.isStructural) return false;
        // Endpoint = device terminale CON IP, anche se ha un pass-through (es. il
        // VoIP con il PC in cascata, passThrough:'port'): per "fino alle wall-port"
        // va nascosto come gli altri device. I conduit PURI (presa/patch/mediaconv)
        // non hanno IP e restano visibili come confine della vista filtrata.
        if (d.hasIP) return true;
        return d.passThrough !== 'port' && d.passThrough !== 'device';
      };
      const isEndpointId = id => { const n = nodeById(id); return !!(n && isEndpointType(n.type)); };
      return {
        pairs: pairs.filter(p => !(p.kind === 'floor-floor' && (isEndpointId(p.nodeAId) || isEndpointId(p.nodeBId)))),
        fanout: fanout.filter(f => !isEndpointId(f.floorNodeId)),
        rackAlerts,
      };
    }

    return { pairs, fanout, rackAlerts };
  }

  return { buildTopoLines };
});
