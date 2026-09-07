// ============================================================
// PORT INVENTORY — quali porte ESISTONO su un apparato, e quali cavi puntano a
// una porta che non c'è (più).
// ============================================================
// Il caso che lo fa esistere: si abbassa il numero di porte di uno switch da 48
// a 24 e i cavi sulle porte 25-48 RESTANO nel documento. Non si vedono — il
// renderer non ha un'ancora dove disegnarli — ma ci sono: contati nei totali,
// stampati nel dossier, esportati. Un cavo invisibile è peggio di un cavo
// sbagliato, perché nessuno può correggerlo.
//
// ⚠️ QUI NON SI CANCELLA NIENTE. Questo modulo RICONOSCE, non pota: la potatura
// automatica di ciò che «sembra fuori range» è esattamente il fix affrettato che
// perde cavi veri. Chi consuma dice all'utente cosa ha trovato, e decide lui.
//
// ── Le famiglie di pid, MISURATE sul renderer (src/app-render-core.js) ──────
//   `<id>-<n>`        porte dati, 1..portCount
//   `<id>-mgmt<n>`    porte di gestione, FUORI dall'intervallo dati
//   `<id>-radio<n>`   radio wireless
//   `<id>-logical-…`  interfacce logiche (import DCIM)
//
// ⚠️ **Le SFP NON hanno una numerazione propria.** È la trappola che era scritta
// al contrario nelle note: `frontPanelSfpGroups` (lib/frontpanel.js) ricava le
// porte SFP come le ULTIME dell'intervallo `1..portCount`, e `sfpStartNum` /
// `sfpPrefix` cambiano soltanto l'ETICHETTA (Te1, Hu49, xe-0/2/0). Il pid resta
// `<id>-25`. Quindi una porta numerata SOPRA il conteggio non è un uplink in
// fibra: non esiste.
//
// ⚠️ **La trappola vera è la PDU.** Lì i pid numerici `<id>-1..k` sono le sue
// porte di RETE (k = `pduManagementPortCount`), mentre `n.ports` conta le porte
// dati/frontali — un'altra cosa. Misurare una PDU col suo `n.ports` accuserebbe
// il cavo di gestione, che è il cavo più legittimo che ha.
//
// ── La disciplina: si accusa solo ciò che si sa leggere ─────────────────────
// Un pid con suffisso non numerico (mgmt, radio, logical, o una forma che non
// conosciamo) non viene MAI segnalato: non sappiamo quante ne esistono, e
// «non lo so» non è «non c'è». Stessa cosa per un nodo di cui il chiamante non
// sa dire il tetto: si tace. Un accusatore che non sa leggere accusa a caso.
//
// PURO: nessun DOM, nessun IO, nessuna dipendenza dal catalogo TYPES (il tetto
// di tipo lo passa il chiamante, come `mgmtEligible` in lib/frontpanel.js).
// UMD-lite: require() in Node/test, global nel browser.
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory(isNode ? require('./port-id.js') : root);
  if (isNode) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (portId) {
  'use strict';

  const _int = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  /**
   * Il tetto dei pid NUMERICI di un apparato — quante porte `<id>-<n>` esistono.
   * `null` = non lo sappiamo (e allora non si giudica).
   *
   * Il chiamante passa i due numeri che vengono dal catalogo e dal modello PDU,
   * che questa lib non conosce:
   *   · `typeDefaultPorts` = TYPES[node.type]?.ports
   *   · `pduMgmtPorts`     = pduManagementPortCount(node)   (solo per le PDU)
   * La REGOLA — quale dei due vale — sta qui, dove si può provare.
   */
  function numericPortCeiling(node, opts) {
    const n = (node && typeof node === 'object') ? node : {};
    const o = (opts && typeof opts === 'object') ? opts : {};
    // La PDU misura sul suo conteggio di porte di RETE: `n.ports` lì conta le
    // porte dati/frontali, che non usano questi pid.
    if (n.type === 'pdu') {
      const k = _int(o.pduMgmtPorts);
      return k === null ? null : Math.max(0, k);
    }
    const declared = _int(n.ports);
    if (declared !== null) return Math.max(0, declared);
    const fallback = _int(o.typeDefaultPorts);
    return fallback === null ? null : Math.max(0, fallback);
  }

  /**
   * Che cos'è un pid: `{ nodeId, family, num }`.
   * family: 'data' (suffisso numerico) · 'mgmt' · 'radio' · 'logical' · 'other'.
   * `num` è valorizzato solo per 'data'. Un pid senza suffisso → family 'other'.
   */
  function classifyPid(pid, knownNodeIds) {
    const raw = String(pid == null ? '' : pid);
    const nodeId = portId.nodeIdOfPort(raw, knownNodeIds);
    const suffix = portId.portSuffix(raw, knownNodeIds);
    if (!suffix) return { nodeId, family: 'other', num: null };
    if (/^\d+$/.test(suffix)) return { nodeId, family: 'data', num: parseInt(suffix, 10) };
    if (/^mgmt\d*$/i.test(suffix)) return { nodeId, family: 'mgmt', num: null };
    if (/^radio\d*$/i.test(suffix)) return { nodeId, family: 'radio', num: null };
    if (/^logical-/i.test(suffix)) return { nodeId, family: 'logical', num: null };
    return { nodeId, family: 'other', num: null };
  }

  /**
   * I capi di cavo che puntano a una porta dati inesistente.
   *
   * `links`        = [{ src, dst, ... }] — si guardano i due capi separatamente:
   *                  un cavo può essere orfano da un lato solo, ed è il caso
   *                  normale (si è ridotto UN apparato).
   * `ceilingOf`    = (nodeId) → number | null. `null` = «non lo so» → si tace.
   * `knownNodeIds` = Set/array/oggetto degli id nodo, per leggere i pid dei nodi
   *                  con trattini nell'id (lib/port-id.js).
   *
   * Ritorna `[{ pid, nodeId, num, ceiling, end:'src'|'dst', index }]`, ordinato
   * come i link. `index` è la posizione nell'array: chi consuma può risalire al
   * cavo senza che questa lib inventi un id che i link non hanno.
   */
  function findOrphanPortRefs(links, ceilingOf, knownNodeIds) {
    const out = [];
    const list = Array.isArray(links) ? links : [];
    const tetto = typeof ceilingOf === 'function' ? ceilingOf : () => null;
    // Un tetto si chiede UNA volta per nodo: su un documento grande la stessa
    // domanda tornerebbe una volta per capo di cavo.
    const cache = new Map();
    const ceilingCached = (nodeId) => {
      if (!cache.has(nodeId)) cache.set(nodeId, tetto(nodeId));
      return cache.get(nodeId);
    };
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (!l) continue;
      for (const end of ['src', 'dst']) {
        const pid = l[end];
        if (!pid) continue;
        const ref = classifyPid(pid, knownNodeIds);
        if (ref.family !== 'data') continue;          // non si accusa ciò che non si sa leggere
        const ceiling = ceilingCached(ref.nodeId);
        if (ceiling === null || ceiling === undefined) continue;   // «non lo so» ≠ «non c'è»
        if (ref.num >= 1 && ref.num <= ceiling) continue;
        out.push({ pid: String(pid), nodeId: ref.nodeId, num: ref.num, ceiling, end, index: i });
      }
    }
    return out;
  }

  /**
   * Quanti cavi resterebbero orfani portando UN apparato a `nextCount` porte.
   * Serve al momento in cui il danno si crea — l'utente abbassa il conteggio —
   * quindi guarda un nodo solo e non ha bisogno di tetti per gli altri.
   * Ritorna `{ count, ports:[numeri di porta], refs:[…] }` (`ports` ordinati e
   * senza doppioni: due capi sulla stessa porta sono una porta sola).
   */
  function orphansIfPortCount(nodeId, nextCount, links, knownNodeIds) {
    const max = _int(nextCount);
    const id = String(nodeId == null ? '' : nodeId);
    if (!id || max === null) return { count: 0, ports: [], refs: [] };
    const refs = findOrphanPortRefs(links, (n) => (n === id ? Math.max(0, max) : null), knownNodeIds);
    const ports = [];
    for (const r of refs) if (!ports.includes(r.num)) ports.push(r.num);
    ports.sort((a, b) => a - b);
    return { count: refs.length, ports, refs };
  }

  return { numericPortCeiling, classifyPid, findOrphanPortRefs, orphansIfPortCount };
});
