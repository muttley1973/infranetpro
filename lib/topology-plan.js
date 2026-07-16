// Costruzione del PIANO di topologia (TopologyPlan) — PURA e deterministica.
//
// Assembla i candidati GIÀ correlati (LLDP/CDP = T1, FDB = T2, ARP = T3) in un
// piano unico:
//   • deduplicato per COPPIA LOGICA, LAG-aware (due membri dello stesso LAG =
//     un solo link logico), coerente con _candLogicalMeta di app-autolink.js;
//   • riconciliato contro i link esistenti (manual-first: propone, non muta;
//     segnala i conflitti coi cavi manuali, non li sovrascrive);
//   • idempotente (stesso input → stesso output; ciò che è già applicato risulta
//     `exists`, non viene riproposto come `new`).
//
// NON esegue polling né correlazione: consuma l'output di lib/correlate.js
// (createCandidateSet.values() di buildNeighborCandidates + buildFdbCandidates).
// La materializzazione dei nodi inferiti (switch unmanaged) è la FASE 2:
// qui `inferredNodes` resta [] — il campo esiste per stabilità del contratto.
//
// Condivisa browser + test/server (UMD-lite come lib/correlate.js). Dipende solo
// da lib/netnames.js. Vendor-neutral: nessun OID/naming di un vendore specifico.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./netnames'));
  } else {
    Object.assign(root, factory(root)); // browser: netnames già su window
  }
})(typeof self !== 'undefined' ? self : this, function (nn) {
  'use strict';

  // _ifNameMeta serve solo ad assemblePlanInputs (esclude le interfacce LAG dalle
  // porte d'accesso). Fallback difensivo se netnames non è ancora presente.
  const _ifNameMeta = (nn && nn._ifNameMeta)
    ? nn._ifNameMeta
    : (s) => ({ raw: String(s || ''), lagToken: '' });

  // Firma canonica ordine-indipendente di una coppia (ref|ref).
  function pairSig(a, b) {
    return [String(a || ''), String(b || '')].sort().join('||');
  }

  // nodeId di una porta "nodeId-portNum" (il nodeId può contenere trattini →
  // si taglia sull'ULTIMO, come buildPortIndex in lib/correlate.js).
  function _nodeIdOfPort(pid) {
    const s = String(pid || '');
    const cut = s.lastIndexOf('-');
    return cut > 0 ? s.slice(0, cut) : s;
  }

  // Mappa portId -> { lagId, lagGroup } dal portIndex (buildPortIndex).
  function _portMetaMap(portIndex) {
    const m = {};
    const ports = (portIndex && portIndex.ports) || {};
    for (const nodeId of Object.keys(ports)) {
      for (const e of (ports[nodeId] || [])) {
        m[e.portId] = { lagId: e.lagId || 0, lagGroup: e.lagGroup || '' };
      }
    }
    return m;
  }

  // Riferimento LOGICO di una porta: se è membro di un LAG (gruppo snmp-lag-/
  // lldp-lag- o lagId>0) torna il ref del LAG dell'apparato, altrimenti la porta.
  // Rispecchia _logicalRefByPort di src/app-autolink.js: così il dedup del piano
  // coincide con quello del motore di auto-link (un LAG = un link logico).
  function _portLagRef(portId, meta) {
    const nodeId = _nodeIdOfPort(portId);
    const g = String((meta && meta.lagGroup) || '').trim();
    if (g && (g.indexOf('snmp-lag-') === 0 || g.indexOf('lldp-lag-') === 0)) {
      return { ref: `L:${nodeId}::${g}`, isLag: true };
    }
    const lid = parseInt((meta && meta.lagId) || 0, 10);
    if (lid > 0) {
      return { ref: `L:${nodeId}::snmp-lag-${nodeId}-${lid}`, isLag: true };
    }
    return { ref: `P:${portId}`, isLag: false };
  }

  // Chiave logica di una coppia porta↔porta (LAG-aware). Due candidati su membri
  // diversi dello stesso LAG collassano nella stessa chiave.
  function _logicalPairKey(src, dst, portMetaMap) {
    const s = _portLagRef(src, portMetaMap[src]);
    const d = _portLagRef(dst, portMetaMap[dst]);
    const sn = _nodeIdOfPort(src);
    const dn = _nodeIdOfPort(dst);
    if (s.isLag && d.isLag) return pairSig(s.ref, d.ref);
    if (s.isLag)            return pairSig(s.ref, `N:${dn}`);
    if (d.isLag)            return pairSig(`N:${sn}`, d.ref);
    return pairSig(s.ref, d.ref);
  }

  function _isTrusted(p) { return /^(LLDP|CDP)/i.test(String(p || '')); }

  // TIER dalla famiglia di evidenza (la più forte vince): LLDP/CDP → dorsale;
  // MAC/MAC+ARP → edge FDB; ARP-* → solo ARP (debole).
  function _tierFromEvidence(evArr) {
    const arr = (evArr || []).map(x => String(x || '').toUpperCase());
    if (arr.some(p => /^(LLDP|CDP)/.test(p))) return 'lldp';
    if (arr.some(p => /^MAC/.test(p)))        return 'fdb';   // MAC, MAC+ARP
    if (arr.some(p => /ARP/.test(p)))         return 'arp';   // ARP-MAC
    return 'fdb';
  }

  // Infra "da interrogare" di default = ha un driver SNMP configurato con host/ip.
  // Un device senza SNMP (switch dumb, .98 cieco) NON è "unreachable": è un nodo
  // cieco gestito dall'inferenza (FASE 2), non un poll fallito.
  function _defaultIsInfra(n) {
    const cfg = (n && n.integration) || {};
    const drv = String(cfg.driver || '');
    const host = String(cfg.host || (n && n.ip) || '').trim();
    return drv.indexOf('snmp') === 0 && !!host;
  }

  // ============================================================
  // inferUnmanagedNodes — FASE 2: switch/AP non gestito inferito (pure)
  // ============================================================

  // Tipi con SWITCH INTERNO a valle (pass-through): un telefono VoIP espone una
  // seconda porta per il PC → 2 MAC sulla porta d'accesso NON implicano uno
  // switch separato. Vendor-neutral (nomi-tipo InfraNet), sovrascrivibile.
  const DEFAULT_PASSTHROUGH = ['voip', 'phone', 'ip-phone', 'ipphone'];

  // MAC endpoint distinti da un elenco eterogeneo ({mac,type?,nodeId?} | "mac").
  function _distinctEndpointMacs(macs) {
    const seen = new Set();
    const out = [];
    for (const m of (macs || [])) {
      const mac = String((m && m.mac) || m || '').trim().toLowerCase();
      if (!mac || seen.has(mac)) continue;
      seen.add(mac);
      out.push({ mac, type: (m && m.type) || null, nodeId: (m && m.nodeId) || null, ip: (m && m.ip) || null });
    }
    return out;
  }

  // ── Classificazione del TIPO di intermediario nascosto (paletto ②: proposta,
  //    non fatto — sempre "da confermare") ────────────────────────────────────
  // Priorità: L3 (router) > OUI virtuale (hypervisor) > MAC randomizzato (AP) >
  // switch (default L2). Vendor-neutral: si basa su bit/OUI standard, non su brand.
  const _VIRTUAL_OUI = [   // prefissi MAC di hypervisor/VM noti
    '00:05:69', '00:0c:29', '00:1c:14', '00:50:56',  // VMware
    '00:15:5d',                                        // Hyper-V
    '52:54:00',                                        // KVM/QEMU
    '00:16:3e',                                        // Xen
    '08:00:27',                                        // VirtualBox
    '00:1c:42',                                        // Parallels
  ];
  function _normMac6(mac) { return String(mac || '').trim().toLowerCase().replace(/-/g, ':'); }
  function _isVirtualOui(mac) { const m = _normMac6(mac); return _VIRTUAL_OUI.some(p => m.startsWith(p)); }
  function _isRandomizedMac(mac) {
    const first = parseInt(_normMac6(mac).slice(0, 2), 16);
    return Number.isFinite(first) && (first & 0x02) === 0x02;   // locally-administered bit
  }
  function _subnet24(ip) { const m = String(ip || '').match(/^(\d+)\.(\d+)\.(\d+)\./); return m ? `${m[1]}.${m[2]}.${m[3]}` : ''; }

  /**
   * Deduce il TIPO del device multi-porta nascosto dietro una porta, dai segnali
   * sugli endpoint. Ritorna { type, signal } con type ∈ switch|ap|router|hypervisor.
   * È la proposta PIÙ PROBABILE, mai un fatto → il chiamante la marca "da confermare".
   * @param {Array} macs  - [{ mac, ip? }]
   * @param {string} srcIp - IP dello switch sorgente (per il confronto di subnet)
   */
  function classifyIntermediary(macs, srcIp) {
    const list = (macs || []).filter(Boolean);
    const n = list.length || 1;
    // ROUTER — un endpoint documentato in una subnet DIVERSA dallo switch = confine L3.
    const sSub = _subnet24(srcIp);
    if (sSub) {
      for (const m of list) { const iSub = _subnet24(m.ip); if (iSub && iSub !== sSub) return { type: 'router', signal: 'cross-subnet' }; }
    }
    // HYPERVISOR — maggioranza di MAC con OUI virtuale (VM dietro un vSwitch).
    if (list.filter(m => _isVirtualOui(m.mac)).length > n / 2) return { type: 'hypervisor', signal: 'virtual-oui' };
    // AP — maggioranza di MAC randomizzati/locally-administered (client wireless).
    if (list.filter(m => _isRandomizedMac(m.mac) && !_isVirtualOui(m.mac)).length > n / 2) return { type: 'ap', signal: 'randomized-mac' };
    return { type: 'switch', signal: 'default' };
  }

  /**
   * Inferisce i nodi "switch/AP non gestito" dalle porte d'accesso.
   *
   * Verità fisica: 1 porta = 1 cavo = 1 device → 2+ endpoint DISTINTI su una
   * porta d'accesso SENZA vicino LLDP ⟹ dietro c'è un apparato multi-porta
   * (switch dumb / iniettore PoE / mini-hub / AP), invisibile perché non
   * sorgente traffico. Type-aware: la coppia telefono-VoIP + altro resta diretta
   * (il telefono ha lo switch interno); ogni altra combinazione (2 camere, 2 PC,
   * 2 stampanti…) infersce. Confidenza ALTA sull'ESISTENZA dell'intermediario;
   * il TIPO resta da confermare → MAI auto-apply (T4, solo proposta review).
   *
   * @param {Array} portEndpoints - [{ portId, ifName, hasLldpNeighbor,
   *                                    macs:[{mac,type?,nodeId?}] }]
   * @param {Object} [opts] - { occupiedPorts?:Set, passthroughTypes?:string[] }
   * @returns {Array} inferredNodes
   */
  function inferUnmanagedNodes(portEndpoints, opts) {
    const o = opts || {};
    const occupied = (o.occupiedPorts instanceof Set) ? o.occupiedPorts : new Set();
    const passthrough = new Set((o.passthroughTypes || DEFAULT_PASSTHROUGH)
      .map(t => String(t || '').toLowerCase()));
    // Oltre questa soglia la porta è un SEGMENTO L2 CONDIVISO (uplink/switch grosso):
    // troppi MAC per indovinare un singolo apparato → lo risolve il pannello dedicato.
    const maxEndpoints = Number.isFinite(o.maxEndpoints) ? o.maxEndpoints : 4;
    const out = [];
    const seenPort = new Set();
    for (const pe of (portEndpoints || [])) {
      if (!pe || !pe.portId || seenPort.has(pe.portId)) continue;
      if (pe.hasLldpNeighbor) continue;        // apparato gestito noto → non inferire
      if (occupied.has(pe.portId)) continue;   // porta già occupata da un nodo reale
      const macs = _distinctEndpointMacs(pe.macs);
      const n = macs.length;
      // < 2 = collegamento diretto; > maxEndpoints = segmento L2 condiviso (pannello dedicato).
      if (n < 2 || n > maxEndpoints) continue;
      // Eccezione unica: coppia con un telefono VoIP (switch interno) → diretta.
      if (n === 2 && macs.some(m => passthrough.has(String(m.type || '').toLowerCase()))) continue;
      seenPort.add(pe.portId);
      const confidence = n >= 3 ? 0.88 : 0.82;
      // Tipo PROPOSTO dai segnali (switch di default) — sempre "da confermare".
      const cls = classifyIntermediary(macs, pe.srcIp);
      out.push({
        kind: 'unmanaged-switch',
        inferredType: cls.type,          // switch|ap|router|hypervisor (da confermare)
        typeSignal: cls.signal,          // perché: cross-subnet|virtual-oui|randomized-mac|default
        onUplinkPid: pe.portId,
        ifName: String(pe.ifName || ''),
        behindMacs: macs.map(m => m.mac),
        behindNodes: macs.map(m => m.nodeId).filter(Boolean),
        behindTypes: macs.map(m => m.type || null),
        confidence,
        reason: { code: 'inferred', vars: { count: n, port: pe.portId, ifName: String(pe.ifName || ''), type: cls.type } },
      });
    }
    return out;
  }

  /**
   * @typedef {Object} TopologyPlan
   * @property {Array}  links          - link del piano (dedup, tiered, riconciliati)
   * @property {Array}  inferredNodes  - switch/AP non gestiti inferiti (FASE 2)
   * @property {Array}  neighborNodes  - vicini LLDP/CDP materializzabili (FASE 5b)
   * @property {Array}  sharedSegments - porte a segmento condiviso (passthrough)
   * @property {Array}  unreachable    - id nodi infra non interrogabili
   * @property {Object} summary        - conteggi per tier/stato
   */

  /**
   * Costruisce il TopologyPlan dai candidati già correlati.
   *
   * @param {Object} inputs
   * @param {Array}  inputs.candidates    - [{ src, dst, confidence, protocol, sources?, corroborated? }]
   *                                        (concat di cset.values() su TUTTI i nodi infra)
   * @param {Object} inputs.portIndex     - buildPortIndex(state.ports, state.lagGroups)
   * @param {Array}  [inputs.nodes]       - state.nodes (per unreachable)
   * @param {Array}  [inputs.existingLinks] - state.links (reconcile manual-first)
   * @param {Array}  [inputs.sharedSegments] - da buildFdbCandidates (passthrough)
   * @param {Object} [inputs.opts]        - { isInfra?(node)->bool }
   * @returns {TopologyPlan}
   */
  function buildTopologyPlan(inputs) {
    const io = /** @type {any} */ (inputs || {});
    const candidates    = Array.isArray(io.candidates) ? io.candidates : [];
    const portIndex     = io.portIndex || { ports: {}, lagGroups: {} };
    const nodes         = Array.isArray(io.nodes) ? io.nodes : [];
    const existingLinks = Array.isArray(io.existingLinks) ? io.existingLinks : [];
    const sharedIn      = Array.isArray(io.sharedSegments) ? io.sharedSegments : [];
    const opts          = io.opts || {};
    const portMetaMap   = _portMetaMap(portIndex);

    // --- 1. Merge + dedup per coppia logica ---------------------------------
    const groups = new Map();
    for (const c of candidates) {
      if (!c || !c.src || !c.dst || c.src === c.dst) continue;
      const key = _logicalPairKey(c.src, c.dst, portMetaMap);
      const ev = (c.sources && c.sources.length) ? c.sources.slice() : [c.protocol || 'AUTO'];
      const conf = Number(c.confidence) || 0;
      let g = groups.get(key);
      if (!g) {
        groups.set(key, { key, src: c.src, dst: c.dst, confidence: conf,
                          protocol: c.protocol || 'AUTO', evidence: new Set(ev) });
      } else {
        for (const s of ev) g.evidence.add(s);
        if (conf > g.confidence) {
          g.confidence = conf; g.src = c.src; g.dst = c.dst; g.protocol = c.protocol || g.protocol;
        }
      }
    }

    // --- 2. Reconcile: chiavi esistenti + porte con link MANUALE -------------
    const existKeys = new Set();
    const manualByPort = new Map();
    for (const l of existingLinks) {
      if (!l || !l.src || !l.dst) continue;
      const k = _logicalPairKey(l.src, l.dst, portMetaMap);
      existKeys.add(k);
      if (!l.autoLinked) { manualByPort.set(l.src, k); manualByPort.set(l.dst, k); }
    }

    // --- 3. Materializza i link del piano -----------------------------------
    const links = [];
    for (const g of groups.values()) {
      const evArr = [...g.evidence];
      const tier = _tierFromEvidence(evArr);
      const corroborated = evArr.some(_isTrusted) && evArr.some(p => !_isTrusted(p));
      let status;
      if (existKeys.has(g.key)) {
        status = 'exists';
      } else {
        const mSrc = manualByPort.get(g.src);
        const mDst = manualByPort.get(g.dst);
        status = ((mSrc && mSrc !== g.key) || (mDst && mDst !== g.key)) ? 'conflict-manual' : 'new';
      }
      links.push({
        src: g.src, dst: g.dst,
        tier,
        confidence: Math.round(g.confidence * 1000) / 1000,
        evidence: evArr,
        corroborated,
        reason: { code: tier, vars: {
          protocol: g.protocol,
          srcNode: _nodeIdOfPort(g.src), dstNode: _nodeIdOfPort(g.dst),
          srcPort: g.src, dstPort: g.dst,
        } },
        status,
        logicalKey: g.key,
      });
    }
    // Ordine deterministico (idempotenza dell'output): confidenza desc, poi chiave.
    links.sort((a, b) =>
      b.confidence - a.confidence ||
      (a.logicalKey < b.logicalKey ? -1 : a.logicalKey > b.logicalKey ? 1 : 0));

    // --- 3b. Nodi inferiti (FASE 2) + soppressione link superati -------------
    const inferredNodes = inferUnmanagedNodes(io.portEndpoints, {
      occupiedPorts: opts.occupiedPorts,
      passthroughTypes: opts.passthroughTypes,
    });
    if (inferredNodes.length) {
      const uplinkBehind = new Map();
      for (const inf of inferredNodes) uplinkBehind.set(inf.onUplinkPid, new Set(inf.behindNodes));
      // Un endpoint DIETRO un nodo inferito non è cablato diretto alla porta
      // uplink: pende dallo switch inferito. Rimuovo quei link diretti — la
      // ricostruzione switch↔uplink + endpoint↔switch è compito dell'apply (FASE 5).
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i];
        const upSrc = uplinkBehind.get(l.src);
        const upDst = uplinkBehind.get(l.dst);
        if ((upSrc && upSrc.has(_nodeIdOfPort(l.dst))) ||
            (upDst && upDst.has(_nodeIdOfPort(l.src)))) {
          links.splice(i, 1);
        }
      }
    }

    // --- 4. sharedSegments deduplicati per porta (passthrough → FASE 2) ------
    const sharedSeen = new Set();
    const sharedSegments = [];
    for (const s of sharedIn) {
      if (!s || !s.portId || sharedSeen.has(s.portId)) continue;
      sharedSeen.add(s.portId);
      sharedSegments.push(s);
    }

    // --- 5. unreachable: infra che VOLEVAMO pollare ma è down ----------------
    const isInfra = typeof opts.isInfra === 'function' ? opts.isInfra : _defaultIsInfra;
    const unreachable = [];
    for (const n of nodes) {
      if (n && isInfra(n) && n.snmpStatus === 'err') unreachable.push(n.id);
    }

    // --- 5b. Vicini LLDP/CDP materializzabili (il gateway) ------------------
    // Un vicino annunciato non ancora documentato → nodo infra proponibile. Se la
    // porta locale ha già un cavo è "exists" (non ri-materializzo): manual-first.
    const portsWithLink = new Set();
    for (const l of existingLinks) {
      if (!l) continue;
      if (l.src) portsWithLink.add(l.src);
      if (l.dst) portsWithLink.add(l.dst);
    }
    const neighborNodes = (Array.isArray(io.neighborNodes) ? io.neighborNodes : [])
      .map(nn => Object.assign({}, nn, { status: portsWithLink.has(nn.onLocalPid) ? 'exists' : 'new' }));

    // --- 6. summary ---------------------------------------------------------
    const summary = { t1: 0, t2: 0, t3: 0, t4: inferredNodes.length,
                      neighbors: neighborNodes.filter(n => n.status === 'new').length,
                      total: links.length, new: 0, exists: 0, conflicts: 0 };
    for (const l of links) {
      if (l.tier === 'lldp') summary.t1++;
      else if (l.tier === 'fdb') summary.t2++;
      else if (l.tier === 'arp') summary.t3++;
      if (l.status === 'new') summary.new++;
      else if (l.status === 'exists') summary.exists++;
      else if (l.status === 'conflict-manual') summary.conflicts++;
    }

    return { links, inferredNodes, neighborNodes, sharedSegments, unreachable, summary };
  }

  // ============================================================
  // buildApplyOps — FASE 5: dal piano alle OPERAZIONI di apply (pure)
  // ============================================================
  /**
   * Decide COSA fare all'apply del piano, SENZA mutare: link da aggiungere, nodi
   * inferiti da materializzare, auto-link obsoleti da rimuovere (self-heal).
   * Manual-first (non tocca mai i cavi manuali) e idempotente (ri-eseguire = 0
   * operazioni: dedup vs stato vivo + uplink già materializzati). L'esecuzione
   * (creazione record, nodi, render) è del client.
   *
   * @param {Object} plan - TopologyPlan (da buildTopologyPlan)
   * @param {Object} ctx
   *   ctx.existingLinks  - state.links [{id, src, dst, autoLinked?}]
   *   ctx.portIndex      - buildPortIndex(...) (coppia logica LAG-aware)
   *   ctx.tiers          - { lldp,fdb,arp,inferred:bool } quali applicare (default tutti)
   *   ctx.materializedUplinks - Set<portId> uplink già dotati di switch inferito
   *   ctx.isLeafNode?(nodeId)->bool
   *   ctx.resolveEndpoint?(nodeId)->{ok,reason}  (per il self-heal transit)
   * @returns {{ addLinks:Array, materialize:Array, materializeNeighbors:Array, pruneLinkIds:Array }}
   */
  function buildApplyOps(plan, ctx) {
    const p = plan || {};
    const c = ctx || {};
    const existing = Array.isArray(c.existingLinks) ? c.existingLinks : [];
    const portMetaMap = _portMetaMap(c.portIndex || {});
    const tiers = c.tiers || { lldp: true, fdb: true, arp: true, inferred: true };
    const materialized = (c.materializedUplinks instanceof Set) ? c.materializedUplinks : new Set();
    const isLeaf = typeof c.isLeafNode === 'function' ? c.isLeafNode : () => false;
    const resolveEp = typeof c.resolveEndpoint === 'function' ? c.resolveEndpoint : null;

    // Stato vivo: chiavi coppia esistenti + porte con cavo MANUALE.
    const existKeys = new Set();
    const manualByPort = new Map();
    for (const l of existing) {
      if (!l || !l.src || !l.dst) continue;
      const k = _logicalPairKey(l.src, l.dst, portMetaMap);
      existKeys.add(k);
      if (!l.autoLinked) { manualByPort.set(l.src, k); manualByPort.set(l.dst, k); }
    }

    // 1. Link da aggiungere (tier selezionati, dedup vivo, manual-first).
    const addLinks = [];
    for (const l of (p.links || [])) {
      if (!l || !l.src || !l.dst || !tiers[l.tier]) continue;
      const k = _logicalPairKey(l.src, l.dst, portMetaMap);
      if (existKeys.has(k)) continue;                       // idempotente
      const mSrc = manualByPort.get(l.src), mDst = manualByPort.get(l.dst);
      if ((mSrc && mSrc !== k) || (mDst && mDst !== k)) continue;   // conflitto manuale → salta
      addLinks.push({ src: l.src, dst: l.dst, tier: l.tier, confidence: l.confidence });
    }

    // 2. Nodi inferiti da materializzare (idempotente vs uplink già fatti) +
    //    reroute-prune degli auto-link diretti endpoint↔uplink (ora passano dallo switch).
    const materialize = [];
    const pruneIds = new Set();
    if (tiers.inferred) {
      for (const inf of (p.inferredNodes || [])) {
        if (!inf || !inf.onUplinkPid || materialized.has(inf.onUplinkPid)) continue;
        const behindNodeIds = Array.isArray(inf.behindNodes) ? inf.behindNodes.slice() : [];
        materialize.push({ onUplinkPid: inf.onUplinkPid, behindNodeIds,
                           behindMacs: (inf.behindMacs || []).slice(), confidence: inf.confidence,
                           inferredType: inf.inferredType || 'switch', typeSignal: inf.typeSignal || 'default' });
        const behindSet = new Set(behindNodeIds);
        for (const l of existing) {
          if (!l || !l.autoLinked || !l.id) continue;
          if ((l.src === inf.onUplinkPid && behindSet.has(_nodeIdOfPort(l.dst))) ||
              (l.dst === inf.onUplinkPid && behindSet.has(_nodeIdOfPort(l.src)))) pruneIds.add(l.id);
        }
      }
    }

    // 3. Self-heal transit: auto-link il cui endpoint foglia ora risolve a un
    //    uplink/trunk (è DIETRO il collegamento) → cavo diretto sbagliato, rimuovi.
    if (resolveEp) {
      for (const l of existing) {
        if (!l || !l.autoLinked || !l.id || pruneIds.has(l.id)) continue;
        for (const end of [l.src, l.dst]) {
          const nid = _nodeIdOfPort(end);
          if (!isLeaf(nid)) continue;
          let r; try { r = resolveEp(nid); } catch (_) { r = null; }
          if (r && r.ok === false && (r.reason === 'port-uplink' || r.reason === 'port-trunk')) { pruneIds.add(l.id); break; }
        }
      }
    }

    // 4. Vicini LLDP/CDP da materializzare (T1, gated dal tier lldp). Idempotenza
    //    LIVE: salta se la porta locale ha già un cavo (non fidarsi del solo
    //    status del piano, che può essere stantio a un re-apply).
    const materializeNeighbors = [];
    if (tiers.lldp) {
      const occupiedLocal = new Set();
      for (const l of existing) {
        if (!l) continue;
        if (l.src) occupiedLocal.add(l.src);
        if (l.dst) occupiedLocal.add(l.dst);
      }
      for (const nn of (p.neighborNodes || [])) {
        if (!nn || !nn.onLocalPid || nn.status === 'exists' || occupiedLocal.has(nn.onLocalPid)) continue;
        materializeNeighbors.push(nn);
      }
    }

    return { addLinks, materialize, materializeNeighbors, pruneLinkIds: [...pruneIds] };
  }

  // ============================================================
  // assemblePlanInputs — FASE 3: da risultati poll → input del piano (pure)
  // ============================================================
  /**
   * Trasforma i risultati grezzi del polling (uno per nodo infra) negli input
   * di buildTopologyPlan, SENZA mutare nulla. È il cuore dell'orchestratore
   * poll→correla→piano: il chiamante fa il fetch di /api/topology per ogni nodo
   * infra (il server restituisce già suggestedLinks + suggestedSharedSegments) e
   * passa qui i payload. Vendor-neutral, testabile headless su dati reali.
   *
   * @param {Array} pollResults - [{ nodeId, fdbTable:{mac:ifName}, neighbors:[{localPort,…}],
   *                                 suggestedLinks?:[…], suggestedSharedSegments?:[…] }]
   * @param {Object} ctx
   *   ctx.findPort(nodeId, ifName) -> portId|null   (risoluzione porta, LAG-safe)
   *   ctx.macInfo(mac) -> { nodeId?, type? }|null    (nodo/tipo noto di un MAC)
   *   ctx.isVirtualMac?(mac) -> bool                 (scarta NIC virtuali Docker/VM)
   * @returns {{ candidates:Array, sharedSegments:Array, portEndpoints:Array, neighborNodes:Array }}
   */
  function assemblePlanInputs(pollResults, ctx) {
    const c = ctx || {};
    const findPort  = typeof c.findPort  === 'function' ? c.findPort  : () => null;
    const macInfo   = typeof c.macInfo   === 'function' ? c.macInfo   : () => null;
    const isVirtual = typeof c.isVirtualMac === 'function' ? c.isVirtualMac : () => false;
    const matchNeighbor = typeof c.matchNeighbor === 'function' ? c.matchNeighbor : () => null;

    const candidates = [];
    const sharedSegments = [];
    const portEndpoints = [];
    const neighborNodes = [];

    for (const r of (pollResults || [])) {
      if (!r || !r.nodeId) continue;
      for (const sl of (r.suggestedLinks || [])) if (sl) candidates.push(sl);
      for (const ss of (r.suggestedSharedSegments || [])) if (ss) sharedSegments.push(ss);

      // Porte con vicino LLDP/CDP (risolte a portId): sono dorsale nota → non
      // vi si materializza uno switch inferito. Inoltre un vicino LLDP/CDP
      // ANNUNCIATO che NON è ancora un nodo del progetto (es. il gateway visto
      // solo via chassis-MAC su una porta) è materializzabile: identità nota
      // (MAC/IP/hostname), confidenza T1 alta.
      const lldpPorts = new Set();
      for (const nb of (r.neighbors || [])) {
        if (!nb || !nb.localPort) continue;
        const p = findPort(r.nodeId, nb.localPort);
        if (!p) continue;
        lldpPorts.add(p);
        if (!/^(LLDP|CDP)/i.test(String(nb.protocol || 'LLDP'))) continue;
        if (matchNeighbor(nb)) continue;   // già nel progetto → sarà un cavo, non un doppione
        const remDev = String(nb.remoteDevice || '').trim();
        const isMacDev = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(remDev);
        neighborNodes.push({
          onLocalPid: p,
          mac: String(nb.remoteMac || (isMacDev ? remDev : '')).trim().toLowerCase(),
          ip: String(nb.remoteIP || '').trim(),
          hostname: isMacDev ? '' : remDev,
          protocol: nb.protocol || 'LLDP',
          confidence: /^CDP/i.test(String(nb.protocol || '')) ? 0.90 : 0.97,
        });
      }

      // FDB raggruppata per interfaccia → porte d'accesso con i loro endpoint.
      const byIf = {};
      for (const [mac, ifName] of Object.entries(r.fdbTable || {})) {
        const key = String(ifName || ''); if (!key) continue;
        (byIf[key] = byIf[key] || []).push(mac);
      }
      for (const ifName of Object.keys(byIf)) {
        // Interfaccia AGGREGATA (LAG/Po/ae/Eth-Trunk…) = uplink di transito, non
        // porta d'accesso: niente inferenza switch qui (vendor-neutral via lagToken).
        if (_ifNameMeta(ifName).lagToken) continue;
        const portId = findPort(r.nodeId, ifName);
        if (!portId) continue;
        const hasLldp = lldpPorts.has(portId);
        const macs = [];
        for (const macRaw of byIf[ifName]) {
          if (isVirtual(macRaw)) continue;
          const info = macInfo(macRaw) || {};
          macs.push({ mac: String(macRaw).trim().toLowerCase(), type: info.type || null, nodeId: info.nodeId || null, ip: info.ip || null });
        }
        if (macs.length) portEndpoints.push({ portId, ifName, hasLldpNeighbor: hasLldp, macs, srcIp: String(r.srcIp || '') });
      }
    }
    // Dedup vicini per MAC (o per porta locale se il MAC manca).
    const seenNb = new Set();
    const neighborNodesDedup = [];
    for (const nn of neighborNodes) {
      const key = nn.mac || ('pid:' + nn.onLocalPid);
      if (seenNb.has(key)) continue;
      seenNb.add(key);
      neighborNodesDedup.push(nn);
    }
    return { candidates, sharedSegments, portEndpoints, neighborNodes: neighborNodesDedup };
  }

  return {
    buildTopologyPlan,
    inferUnmanagedNodes,
    classifyIntermediary,
    assemblePlanInputs,
    buildApplyOps,
    // esportati per test / riuso
    pairSig,
    _nodeIdOfPort,
    _portLagRef,
    _logicalPairKey,
    _tierFromEvidence,
  };
});
