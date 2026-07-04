// Primitive PURE del motore di correlazione topologia.
// Condivise browser + test/server (UMD-lite).
// Dipende da lib/netnames.js per la normalizzazione nomi interfaccia e MAC.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./netnames'));
  } else {
    Object.assign(root, factory(root)); // browser: netnames già su window
  }
})(typeof self !== 'undefined' ? self : this, function (nn) {
  'use strict';

  const _normIfName    = nn._normIfName;
  const _ifNameMeta    = nn._ifNameMeta;
  const _normMacKey    = nn._normMacKey;
  const _canonLagToken = nn._canonLagToken;

  // ============================================================
  // Strutture di supporto (già presenti)
  // ============================================================

  // Firma canonica ordine-indipendente di una coppia (porta|nodo|ref).
  function pairSig(a, b) {
    return [String(a || ''), String(b || '')].sort().join('||');
  }

  // Protocolli "dichiarati" (lo switch annuncia il vicino) vs "inferiti"
  // (l'app deduce il vicino da FDB/ARP). Una label fusa tipo 'LLDP+MAC'
  // appartiene alla famiglia trusted del suo protocollo base.
  function _isTrustedProto(p) {
    return /^(LLDP|CDP)/i.test(String(p || ''));
  }
  function _trustedBase(p) {
    const m = String(p || '').toUpperCase().match(/^(LLDP|CDP)/);
    return m ? m[1] : '';
  }

  // Accumulatore candidati-link deduplicati: a parità di coppia tiene la
  // confidenza più alta e TRACCIA tutte le sorgenti di evidenza.
  //
  // GAP 1 — fusione multi-sorgente: se la stessa coppia porta-porta arriva
  // sia da un protocollo di vicinato (LLDP/CDP) sia da un'evidenza
  // indipendente FDB/ARP (MAC, ARP-MAC), le due sorgenti si corroborano:
  // confidence +0.02 (cap 0.99) e protocol 'LLDP+MAC' / 'CDP+MAC'.
  // Il boost viene applicato in values() (idempotente: aggiungere la stessa
  // evidenza N volte non cumula).
  /** @typedef {ReturnType<typeof createCandidateSet>} CandidateSet */
  function createCandidateSet() {
    const candidates = {};
    return {
      add(src, dst, confidence, protocol) {
        if (!src || !dst || src === dst) return;
        const key = pairSig(src, dst);
        const proto = protocol || 'AUTO';
        const ex = candidates[key];
        if (!ex) {
          candidates[key] = { src, dst, confidence, protocol: proto, sources: new Set([proto]) };
          return;
        }
        ex.sources.add(proto);
        if (confidence > ex.confidence) {
          ex.src = src; ex.dst = dst;
          ex.confidence = confidence;
          ex.protocol = proto;
        }
      },
      values() {
        return Object.values(candidates).map(c => {
          const srcs = Array.from(c.sources);
          const trusted = srcs.find(_isTrustedProto);
          const hasInferred = srcs.some(p => !_isTrustedProto(p));
          if (trusted && hasInferred) {
            return {
              src: c.src, dst: c.dst,
              confidence: Math.min(0.99, c.confidence + 0.02),
              protocol: `${_trustedBase(trusted)}+MAC`,
              sources: srcs,
              corroborated: true,
            };
          }
          return { src: c.src, dst: c.dst, confidence: c.confidence, protocol: c.protocol, sources: srcs };
        });
      },
      size()   { return Object.keys(candidates).length; },
    };
  }

  // ============================================================
  // matchNodeByIdent — lookup nodo per hostname/IP (pure)
  // ============================================================

  /**
   * Trova un nodo del progetto che corrisponde a hostname e/o IP.
   * Priorità: exact hostname > exact name > short-name (no dominio) > IP.
   *
   * @param {string} hostname
   * @param {string} ip
   * @param {Array}  nodes   - array dei nodi del progetto (state.nodes)
   * @returns {Object|null}
   */
  function matchNodeByIdent(hostname, ip, nodes) {
    if (!hostname && !ip) return null;
    const h   = String(hostname || '').toLowerCase().trim();
    const sH  = h.split('.')[0];
    const ip4 = String(ip || '').trim();
    let byShortName = null, byIp = null;
    for (const x of (nodes || [])) {
      const nh = String(x.hostname || '').toLowerCase();
      const nn_ = String(x.name || '').toLowerCase();
      if (h && nh === h) return x;                                    // P1
      if (h && nn_ === h) return x;                                   // P2
      if (sH && !byShortName &&
          (nh.split('.')[0] === sH || nn_.split('.')[0] === sH))
        byShortName = x;                                              // P3
      if (ip4 && !byIp &&
          (x.ip === ip4 || (x.integration?.host || '') === ip4))
        byIp = x;                                                     // P4
    }
    return byShortName || byIp || null;
  }

  // ============================================================
  // buildPortIndex — indice porte da state.ports (pure)
  // ============================================================

  /**
   * Costruisce un indice porte interrogabile da state.ports.
   *
   * @param {Object} ports      - state.ports  { [portId]: { ifName, alias, lagId, lagGroup, ... } }
   * @param {Object} lagGroups  - state.lagGroups (opzionale) { [groupId]: label }
   * @returns {{ ports: Object, lagGroups: Object }}
   *   ports: { [nodeId]: Array<{ portId, ifName, alias, lagId, lagGroup }> }
   */
  function buildPortIndex(ports, lagGroups) {
    const idx = {};
    for (const [pid, pi] of Object.entries(ports || {})) {
      const cut = pid.lastIndexOf('-');
      const nodeId = cut > 0 ? pid.slice(0, cut) : null;
      if (!nodeId) continue;
      (idx[nodeId] = idx[nodeId] || []).push({
        portId:   pid,
        ifName:   String(pi.ifName   || ''),
        alias:    String(pi.alias    || ''),
        lagId:    parseInt(pi.lagId  || 0, 10),
        lagGroup: String(pi.lagGroup || ''),
      });
    }
    return { ports: idx, lagGroups: lagGroups || {} };
  }

  // ============================================================
  // buildMacIndex — indice MAC→nodeId (pure)
  // ============================================================

  /**
   * Costruisce una mappa MAC normalizzato → nodeId
   * da: MAC dei nodi del progetto + MAC delle porte SNMP.
   *
   * @param {Array}  nodes  - state.nodes
   * @param {Object} ports  - state.ports
   * @returns {Object} { [normMac]: nodeId }
   */
  function buildMacIndex(nodes, ports) {
    const idx = {};
    for (const n of (nodes || [])) {
      const mac = _normMacKey(n.mac);
      if (mac) idx[mac] = n.id;
    }
    for (const [pid, pi] of Object.entries(ports || {})) {
      const mac = _normMacKey(pi.mac);
      if (!mac || idx[mac]) continue;
      const cut = pid.lastIndexOf('-');
      if (cut > 0) idx[mac] = pid.slice(0, cut);
    }
    return idx;
  }

  /**
   * Tutti i MAC noti di un nodo: il MAC chassis (node.mac / macAddress /
   * integration.mac) PIU' i MAC delle sue interfacce (ports[`${id}-N`].mac,
   * tipicamente popolati dal polling SNMP via ifPhysAddress). Serve a decidere
   * identita'/conflitti senza dipendere dal solo `node.mac` (spesso vuoto sui
   * device pollati). `normalize` iniettato per restare agnostici dal formato.
   *
   * @param {Object} node
   * @param {Object} ports     - state.ports
   * @param {Function} [normalize] - normalizzatore MAC (default: lowercase trim)
   * @returns {string[]} MAC normalizzati, non vuoti, deduplicati
   */
  function collectNodeMacs(node, ports, normalize) {
    const norm = typeof normalize === 'function' ? normalize : (x => String(x || '').trim().toLowerCase());
    if (!node) return [];
    const out = new Set();
    for (const v of [node.mac, node.macAddress, node.integration && node.integration.mac]) {
      const m = norm(v || ''); if (m) out.add(m);
    }
    const id = String(node.id || '');
    if (id && ports) {
      const pfx = id + '-';
      for (const pid of Object.keys(ports)) {
        if (pid.indexOf(pfx) !== 0) continue;
        const m = norm((ports[pid] && ports[pid].mac) || ''); if (m) out.add(m);
      }
    }
    return [...out];
  }

  /**
   * Costruisce una mappa MAC normalizzato -> { nodeId, portId }
   * usando i MAC delle porte note nel progetto.
   *
   * @param {Object} ports - state.ports
   * @returns {Object} { [normMac]: { nodeId, portId } }
   */
  function buildPortMacIndex(ports) {
    const idx = {};
    for (const [pid, pi] of Object.entries(ports || {})) {
      const mac = _normMacKey(pi.mac);
      if (!mac || mac === '00:00:00:00:00:00' || idx[mac]) continue;
      const cut = pid.lastIndexOf('-');
      if (cut <= 0) continue;
      idx[mac] = { nodeId: pid.slice(0, cut), portId: pid };
    }
    return idx;
  }

  function buildIpIndex(nodes) {
    const idx = {};
    for (const n of (nodes || [])) {
      const ip1 = String(n.ip || '').trim();
      const ip2 = String(n.integration?.host || '').trim();
      if (ip1 && !idx[ip1]) idx[ip1] = n;
      if (ip2 && !idx[ip2]) idx[ip2] = n;
    }
    return idx;
  }

  function isLeafEndpointNode(node) {
    if (!node) return false;
    if (node.isLeafEndpoint === true) return true;
    const ports = Number(node.ports || 0);
    if (ports !== 1) return false;
    if (node.isActive === true) return false;
    if (node.isPassive === true && node.type !== 'ups' && node.type !== 'pdu' && node.type !== 'ats') return false;
    return true;
  }

  // ============================================================
  // findPortByIfName — risoluzione porta per nome interfaccia (pure)
  // ============================================================

  /**
   * Trova l'ID porta di un nodo del progetto che corrisponde a ifName.
   * Algoritmo multi-livello: raw > compact > normalized > numOnly.
   * Versione pura di _findPortByIfName in app.js.
   *
   * @param {string} nodeId
   * @param {string} ifName    - nome interfaccia del vicino (es. "Gi0/1", "lag1")
   * @param {Object} portIndex - risultato di buildPortIndex()
   * @returns {string|null}    portId oppure null
   */
  function findPortByIfName(nodeId, ifName, portIndex) {
    if (!ifName || !nodeId) return null;
    const q = _ifNameMeta(ifName);
    if (q.isMac) return null;

    const entries = (portIndex.ports || portIndex)[nodeId] || [];
    const cand = [];

    for (const e of entries) {
      const mi = _ifNameMeta(e.ifName);
      const ma = _ifNameMeta(e.alias);
      let score = 0;
      // Livello 1 — exact / compact
      if (mi.raw    && mi.raw    === q.raw)    score = Math.max(score, 120);
      if (ma.raw    && ma.raw    === q.raw)    score = Math.max(score, 110);
      if (mi.compact && mi.compact === q.compact) score = Math.max(score, 108);
      if (ma.compact && ma.compact === q.compact) score = Math.max(score, 98);
      // Livello 2 — normalized vendor-neutral
      if (q.norm && mi.norm === q.norm) score = Math.max(score, q.lagToken ? 96 : 88);
      if (q.norm && ma.norm === q.norm) score = Math.max(score, q.lagToken ? 92 : 78);
      // Livello 3 — numeric-only (fallback debole)
      if (q.numOnly) {
        if (mi.numOnly === q.numOnly) score = Math.max(score, 40);
        if (ma.numOnly === q.numOnly) score = Math.max(score, 30);
      }
      if (score > 0) cand.push({ portId: e.portId, score });
    }

    // Fallback LAG: vicino annuncia aggregatore (po1/lag1/ae1…) ma nel progetto
    // esistono solo le porte membro → trova la prima porta col lagId corrispondente.
    if (!cand.length && q.lagToken) {
      const lgs = portIndex.lagGroups || {};
      const lagMatches = [];
      for (const e of entries) {
        const autoToken  = e.lagId > 0 ? _canonLagToken(e.lagId) : '';
        const labelToken = (e.lagGroup && lgs[e.lagGroup]) ? _normIfName(lgs[e.lagGroup]) : '';
        if ((autoToken && autoToken === q.lagToken) ||
            (labelToken && labelToken === q.lagToken)) {
          const portNum = parseInt(e.portId.split('-').slice(1).join('-'), 10) || 9999;
          lagMatches.push({ portId: e.portId, portNum });
        }
      }
      lagMatches.sort((a, b) => a.portNum - b.portNum);
      if (lagMatches.length) return lagMatches[0].portId;
    }

    if (!cand.length) return null;
    cand.sort((a, b) => b.score - a.score);
    const best = cand[0];
    const ties = cand.filter(c => c.score === best.score);
    if (best.score <= 40 && ties.length !== 1) return null; // fallback debole non univoco
    if (best.score > 40 && ties.length > 1)   return null; // match forte ambiguo
    return best.portId;
  }

  // ============================================================
  // buildNeighborCandidates — correlazione LLDP/CDP (pure)
  // ============================================================

  /**
   * Dato il payload neighbors di /api/topology per un nodo sorgente,
   * produce candidati-link porta-porta da vicini LLDP/CDP.
   * Pura: niente DOM, niente state globale. Testabile in Node.
   *
   * @param {string} srcNodeId   - ID del nodo sorgente nel progetto
   * @param {Array}  neighbors   - data.neighbors da /api/topology
   *   Ogni vicino: { remoteDevice, remoteIP, remoteMac, localPort, remotePort, protocol }
   * @param {Array}  nodes       - state.nodes del progetto
   * @param {Object} portIndex   - risultato di buildPortIndex(state.ports, state.lagGroups)
   * @param {Object} [macIndex]  - risultato di buildMacIndex(nodes, ports) — per fallback MAC
   * @returns {CandidateSet}
   */
  function buildNeighborCandidates(srcNodeId, neighbors, nodes, portIndex, macIndex) {
    const cset = createCandidateSet();
    const mac  = macIndex || {};
    const CONF_LLDP = 0.97;
    const CONF_CDP  = 0.90;

    for (const nb of (neighbors || [])) {
      // 1. Trova nodo remoto per hostname/IP
      let remNode = matchNodeByIdent(nb.remoteDevice, nb.remoteIP, nodes);

      // 2. Fallback MAC: alcuni device (es. Zyxel) annunciano solo chassis-id MAC
      if (!remNode) {
        const cands = [nb.remoteMac, nb.remoteDevice].map(_normMacKey).filter(Boolean);
        for (const m of cands) {
          const nid = mac[m];
          if (nid) { remNode = nodes.find(n => n.id === nid) || null; }
          if (!remNode) remNode = nodes.find(n => _normMacKey(n.mac) === m) || null;
          if (remNode) break;
        }
      }
      if (!remNode) continue;

      // 3. Risolvi porta locale
      const lp = findPortByIfName(srcNodeId, nb.localPort, portIndex);

      // 4. Risolvi porta remota; fallback: endpoint a porta singola
      let rp = findPortByIfName(remNode.id, nb.remotePort, portIndex);
      if (!rp) {
        const remPorts = remNode.ports !== undefined ? remNode.ports : 0;
        if (remPorts === 1) rp = `${remNode.id}-1`;
      }

      const conf = nb.protocol === 'LLDP' ? CONF_LLDP
                 : nb.protocol === 'CDP'  ? CONF_CDP
                 : 0.70;
      cset.add(lp, rp, conf, nb.protocol || 'LLDP');
    }

    return cset;
  }

  /**
   * Costruisce candidati topologici da FDB + ARP del nodo sorgente.
   * Replica in forma pura la parte stabile della correlazione lato client:
   * - FDB MAC->porta verso un'altra porta nota del progetto
   * - fallback ARP+FDB verso endpoint a porta singola
   * - hint shared-segment per porte con molti MAC appresi
   *
   * @param {string} srcNodeId
   * @param {Object} fdbTable       - { mac -> ifName }
   * @param {Object} arpTable       - { mac -> ip }
   * @param {Array}  nodes
   * @param {Object} portIndex
   * @param {Object} portMacIndex   - buildPortMacIndex(projectPorts)
   * @returns {{ cset: Object, sharedSegments: Array }}
   */
  function buildFdbCandidates(srcNodeId, fdbTable, arpTable, nodes, portIndex, portMacIndex, opts) {
    const cset = createCandidateSet();
    const ipIndex = buildIpIndex(nodes);
    const sharedSegments = [];
    const sharedSeen = new Set();
    const counts = {};
    const virtualCounts = {};

    // Optional MAC virtuality predicate: callers (the server route) can pass an
    // OuiEngine-backed `isVirtualMac(mac)` to filter out Docker veth, VMware /
    // Hyper-V / Xen / KVM virtual NICs that would otherwise create phantom
    // suggested links or spuriously inflate shared-segment counters.
    const isVirtualMac = (opts && typeof opts.isVirtualMac === 'function')
      ? opts.isVirtualMac : null;

    for (const [macRaw, ifName] of Object.entries(fdbTable || {})) {
      const key = String(ifName || '');
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
      if (isVirtualMac) {
        let virtualHit = false;
        try { virtualHit = !!isVirtualMac(macRaw); } catch (_) { virtualHit = false; }
        if (virtualHit) virtualCounts[key] = (virtualCounts[key] || 0) + 1;
      }
    }

    for (const [macRaw, ifName] of Object.entries(fdbTable || {})) {
      const mac = _normMacKey(macRaw);
      if (!mac) continue;
      const lp = findPortByIfName(srcNodeId, ifName, portIndex);
      if (!lp) continue;

      const learnedOnPort = counts[String(ifName || '')] || 0;
      // physicalLearned subtracts virtual MACs so a 50-Docker-MAC port stops
      // tripping the shared-segment heuristic when only 2 real MACs are there.
      const virtualOnPort = virtualCounts[String(ifName || '')] || 0;
      const physicalLearned = Math.max(0, learnedOnPort - virtualOnPort);
      const effectiveCount = isVirtualMac ? physicalLearned : learnedOnPort;
      if (effectiveCount > 4) {
        const key = `${lp}||${String(ifName || '')}`;
        if (!sharedSeen.has(key)) {
          sharedSeen.add(key);
          sharedSegments.push({
            portId: lp,
            ifName: String(ifName || ''),
            macCount: learnedOnPort,
            physicalMacCount: effectiveCount,
            virtualMacCount: virtualOnPort,
            reason: 'shared-segment',
          });
        }
      }

      // Skip suggested-link generation for virtual MACs: they shouldn't drive
      // any port-to-port link inference. Shared-segment evidence above is
      // preserved so the UI can still surface the count if useful.
      let macIsVirtual = false;
      if (isVirtualMac) {
        try { macIsVirtual = !!isVirtualMac(macRaw); } catch (_) { macIsVirtual = false; }
        if (macIsVirtual) continue;
      }

      // GAP 3 — porta shared-segment (>4 MAC fisici): dietro c'è quasi
      // certamente uno switch non gestito / AP / hub. OGNI inferenza
      // punto-punto da quella porta è un falso positivo strutturale (il
      // device non è collegato direttamente, è DIETRO il segmento).
      // Niente candidati: resta solo l'evidenza sharedSegments sopra,
      // che alimenta il workflow "Segmento L2 condiviso" dedicato.
      if (effectiveCount > 4) continue;

      // GAP 3 — soglie graduate per MAC appresi sulla porta:
      //   1 MAC   → 0.85 porta dedicata, collegamento diretto quasi certo
      //   2 MAC   → 0.80 daisy-chain tipico (telefono VoIP + PC)
      //   3-4 MAC → 0.68 sospetto mini-switch: sotto soglia auto-create (0.80)
      const confByCount = effectiveCount <= 1 ? 0.85
                        : effectiveCount === 2 ? 0.80
                        : 0.68;

      const ip = String((arpTable || {})[macRaw] || (arpTable || {})[mac] || '').trim();

      const portHit = portMacIndex?.[mac];
      if (portHit && portHit.nodeId !== srcNodeId && portHit.portId) {
        let conf = confByCount;
        let proto = 'MAC';
        // GAP 2 — cross-check bidirezionale: la stessa adiacenza è confermata
        // da TRE sorgenti indipendenti che convergono sullo stesso nodo:
        //   FDB (mac appreso sulla porta locale)
        //   ifPhysAddress remota (il mac È di una porta nota del progetto)
        //   ARP (il mac risolve a un IP che appartiene allo stesso nodo)
        if (ip) {
          const ipNode = ipIndex[ip] || null;
          if (ipNode && ipNode.id === portHit.nodeId) {
            conf = Math.min(0.93, conf + 0.05);
            proto = 'MAC+ARP';
          }
        }
        cset.add(lp, portHit.portId, conf, proto);
        continue;
      }

      if (!ip) continue;
      const remNode = ipIndex[ip] || null;
      if (!remNode || remNode.id === srcNodeId) continue;
      if (!isLeafEndpointNode(remNode)) continue;

      cset.add(lp, `${remNode.id}-1`, Math.max(0.5, confByCount - 0.01), 'ARP-MAC');
    }

    return { cset, sharedSegments };
  }

  // Un MAC unicast reale (non broadcast, non tutto-zero, non multicast): scarta
  // le entry ARP che non rappresentano un host (es. ff:ff:.. broadcast, gruppi).
  function _isRealUnicastMac(macKey) {
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(macKey)) return false;
    if (macKey === 'ff:ff:ff:ff:ff:ff' || macKey === '00:00:00:00:00:00') return false;
    return (parseInt(macKey.slice(0, 2), 16) & 0x01) === 0;   // bit multicast spento
  }

  // Candidati "solo ARP" da una ipNetToMediaTable SNMP (arpTable: { mac -> ip }).
  // Un host presente nell'ARP di uno switch/router SNMP ma che NON risponde a
  // ping/SNMP/LLDP (VPCS, host off-segment, IoT muto) va comunque proposto nello
  // Scopri: IP+MAC (e quindi il vendor via OUI) sono noti SENZA dipendere
  // dall'ICMP. PURA e vendor-neutral. Filtri anti-rumore: IP dentro la subnet
  // scansionata (scanSet), MAC unicast reale, non gia' noto (knownIps = trovati
  // via SNMP o gia' in coda). Il chiamante accumula in una Map per il dedup
  // cross-device. Ritorna [{ ip, mac, viaFrom }] (mac normalizzato aa:bb:..).
  function buildArpCandidates(arpTable, opts) {
    const o = opts || {};
    const scanSet  = o.scanSet  || null;   // Set<ip> ammessi (subnet scansionata)
    const knownIps = o.knownIps || null;   // Set<ip> gia' trovati/in coda
    const fromIp   = o.fromIp   || '';
    const out = [];
    if (!arpTable || typeof arpTable !== 'object') return out;
    for (const macRaw of Object.keys(arpTable)) {
      const ip = String(arpTable[macRaw] || '').trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
      if (scanSet  && !scanSet.has(ip)) continue;    // solo subnet scansionata
      if (knownIps && knownIps.has(ip)) continue;    // gia' noto (SNMP/visitato)
      const mac = _normMacKey(macRaw);
      if (!_isRealUnicastMac(mac)) continue;
      out.push({ ip, mac, viaFrom: fromIp });
    }
    return out;
  }

  // ============================================================
  // locateMacsOnEdge — macsuck: MAC scoperto -> porta di ACCESSO (pure)
  // ============================================================
  //
  // Data la FDB (MAC->ifName) di OGNI switch/router SNMP raccolto nel crawl,
  // localizza ogni MAC target sulla sua porta di ACCESSO (edge). Principio
  // canonico (netdisco "macsuck"): la porta edge e' quella dove il MAC e'
  // appreso INSIEME AL MINOR numero di altri MAC. Una porta di accesso vede
  // 1-2 MAC (il device, al piu' un telefono VoIP a valle); un uplink/trunk ne
  // vede decine (tutti i MAC dietro) → e' il PERCORSO verso il MAC, non il suo
  // bordo. Quindi tra tutti gli avvistamenti di un MAC si sceglie quello col
  // conteggio piu' basso, e si scartano del tutto gli avvistamenti su porte
  // troppo popolate (> edgeMax): li' il device NON e' collegato direttamente.
  //
  // PURA, vendor-neutral (FDB = BRIDGE-MIB dot1dTpFdb / Q-BRIDGE dot1qTpFdb,
  // standard). Niente IO/SNMP/DOM: il chiamante passa gli FDB gia' raccolti.
  //
  // @param {Array}  fdbBySwitch  [{ switchIp, switchName, fdbTable:{mac->ifName} }]
  // @param {Object} [opts]
  //   opts.targets      Set<normMac> — se presente, localizza SOLO questi MAC
  //   opts.edgeMax      number (default 4) — max MAC co-appresi per considerare
  //                     la porta un "bordo" (oltre = uplink/segmento condiviso)
  //   opts.isVirtualMac fn(mac)->bool — esclude NIC virtuali (Docker/VMware...)
  // @returns {Object} { [normMac]: { switchIp, switchName, ifName, macCount, ambiguous } }
  function locateMacsOnEdge(fdbBySwitch, opts) {
    const o = opts || {};
    const edgeMax = Number.isFinite(o.edgeMax) ? o.edgeMax : 4;
    const targets = (o.targets instanceof Set) ? o.targets : null;
    const isVirtualMac = (typeof o.isVirtualMac === 'function') ? o.isVirtualMac : null;

    // 1) Conteggio MAC per (switch|porta). I MAC virtuali NON gonfiano il
    //    conteggio (una porta con 30 veth Docker + 1 host reale resta "edge").
    const portCount = {};   // "switchIp|ifName" -> count fisici
    const seen = [];        // [{ switchIp, switchName, ifName, mac, macRaw, virt }]
    for (const sw of (fdbBySwitch || [])) {
      const table = sw && sw.fdbTable;
      if (!table || typeof table !== 'object') continue;
      const swIp = String(sw.switchIp || '');
      const swName = String(sw.switchName || '');
      for (const macRaw of Object.keys(table)) {
        const ifName = String(table[macRaw] || '');
        if (!ifName) continue;
        const mac = _normMacKey(macRaw);
        if (!mac) continue;
        let virt = false;
        if (isVirtualMac) { try { virt = !!isVirtualMac(macRaw); } catch (_) { virt = false; } }
        if (!virt) {
          const pkey = swIp + '|' + ifName;
          portCount[pkey] = (portCount[pkey] || 0) + 1;
        }
        seen.push({ switchIp: swIp, switchName: swName, ifName, mac, virt });
      }
    }

    // Una porta LAG/aggregata affollata e' un UPLINK, non un punto di attacco:
    // il MAC visto solo li' e' semplicemente "a monte". Riconoscimento nomi
    // vendor-neutral via _ifNameMeta (+ fallback regex per LAG1/Po1/ae0/Trk1...).
    const _isLagName = (ifName) => {
      const meta = _ifNameMeta(ifName);
      if (meta && meta.lagToken) return true;
      return /^(lag|po|port-?channel|ae|trk|bond|team)\s*\d/i.test(String(ifName || ''));
    };

    // 2) Raggruppa gli avvistamenti per MAC (solo target, solo non-virtuali).
    const byMac = {};
    for (const e of seen) {
      if (e.virt) continue;
      if (targets && !targets.has(e.mac)) continue;
      const count = portCount[e.switchIp + '|' + e.ifName] || 1;
      (byMac[e.mac] = byMac[e.mac] || []).push({
        switchIp: e.switchIp, switchName: e.switchName, ifName: e.ifName, count,
        isLag: _isLagName(e.ifName),
      });
    }

    // 3) Per ogni MAC scegli il punto di attacco piu' plausibile:
    //    - EDGE  : una porta con <= edgeMax MAC (collegamento diretto o quasi;
    //              una LAG con pochi MAC vale come edge, es. server dual-homed).
    //    - SHARED: se non c'e' un edge, la porta NON-LAG col minor numero di MAC
    //              (segmento condiviso: dietro un AP / switch non gestito su quella
    //              porta — il device pende da li', non e' cablato diretto).
    //    Una LAG affollata = uplink: se il MAC si vede SOLO li', non lo localizzo.
    const pick = (list) => {
      const s = list.slice().sort((a, b) => a.count - b.count);
      const best = s[0];
      const tied = s.some(x => x.count === best.count &&
        (x.switchIp !== best.switchIp || x.ifName !== best.ifName));
      return { best, tied };
    };
    const out = {};
    for (const mac of Object.keys(byMac)) {
      const sightings = byMac[mac];
      const edgeCands = sightings.filter(s => s.count <= edgeMax);
      let chosen = null, shared = false;
      if (edgeCands.length) {
        chosen = pick(edgeCands);
      } else {
        const sharedCands = sightings.filter(s => !s.isLag);
        if (sharedCands.length) { chosen = pick(sharedCands); shared = true; }
      }
      if (!chosen) continue;   // visto solo su un uplink LAG affollato → non localizzato
      const b = chosen.best;
      out[mac] = {
        switchIp: b.switchIp, switchName: b.switchName, ifName: b.ifName,
        macCount: b.count, edge: !shared, shared, ambiguous: chosen.tied,
      };
    }
    return out;
  }

  return {
    pairSig,
    createCandidateSet,
    matchNodeByIdent,
    buildPortIndex,
    buildMacIndex,
    collectNodeMacs,
    buildPortMacIndex,
    findPortByIfName,
    buildNeighborCandidates,
    buildFdbCandidates,
    buildArpCandidates,
    locateMacsOnEdge,
  };
});
