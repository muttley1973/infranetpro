// ============================================================
// CABLING — editor segmenti: primitive PURE di split/merge link
// (P1.5 "permanent link vs patch cord + chain segmenti").
//
// Modello: il percorso fisico multi-tappa e' rappresentato nel modo
// NATIVO dell'app — una catena di link reali attraverso porte
// pass-through (wallport / patchpanel / mediaconv, max 2 connessioni
// per porta). Con questa rappresentazione propagazione VLAN, trace,
// rendering e Percorso fisico inferito funzionano gia' senza modifiche.
//
//   splitLinkThrough : 1 link A↔B  →  2 link A↔M e M↔B (M = pass-through)
//   mergeLinksThrough: 2 link A↔M e M↔B  →  1 link A↔B ("togli tappa")
//
// Le funzioni NON mutano gli input e NON toccano stato globale:
// ritornano nuovi record. Il chiamante applica a state.links.
// Condivise browser + test (UMD-lite).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _clean(s) { return String(s == null ? '' : s).trim(); }

  // Conta i link che toccano una porta (per capacita': nel modello nativo
  // basta src/dst — i segments[] legacy non occupano capacita' fisica).
  /** @param {NetLink[]} links @param {string} pid @returns {number} */
  function portConnectionCount(links, pid) {
    const p = _clean(pid);
    if (!p) return 0;
    let n = 0;
    for (const l of (links || [])) {
      if (!l) continue;
      if (_clean(l.src) === p || _clean(l.dst) === p) n++;
    }
    return n;
  }

  // Campi documentali copiati su ENTRAMBI i tratti allo split.
  const COPY_BOTH = ['cableType', 'cableCategory', 'installedAt', 'installedBy', 'notes'];
  // Campi di rete copiati su entrambi (la catena fisica trasporta la stessa VLAN).
  const COPY_NET = ['vlan', 'mode', 'trunkVlans', 'colorOvr', 'color'];

  /**
   * Spezza un link in due tratti attraverso una porta pass-through.
   *
   * @param {NetLink} link    - record link esistente (NON mutato)
   * @param {string} midPid  - porta pass-through intermedia (es. 'pp1-5')
   * @param {Object} opts
   *   uid:            fn(prefix) → id univoco (obbligatoria)
   *   isPassThrough:  fn(pid) → bool — true se la porta appartiene a un
   *                   device pass-through (decide i default permanent/patch)
   *   linksForCapacity: array link correnti — se fornito, verifica che la
   *                   porta intermedia abbia capacita' (max 2 connessioni,
   *                   il link originale non conta perche' verra' sostituito)
   *   maxConn:        capacita' della porta intermedia (default 2)
   * @returns {{ok:true, links:[Object,Object]}|{ok:false, reason:string}}
   */
  function splitLinkThrough(link, midPid, opts) {
    const o = opts || {};
    const mid = _clean(midPid);
    const src = _clean(link && link.src);
    const dst = _clean(link && link.dst);
    if (!link || !src || !dst) return { ok: false, reason: 'invalid-link' };
    if (!mid) return { ok: false, reason: 'invalid-mid' };
    if (mid === src || mid === dst) return { ok: false, reason: 'mid-is-endpoint' };
    if (typeof o.uid !== 'function') return { ok: false, reason: 'missing-uid' };

    // Capacita' della porta intermedia: servono 2 slot liberi (entrano due
    // tratti). Il link originale non tocca mid per definizione (mid != src/dst).
    if (Array.isArray(o.linksForCapacity)) {
      const max = Number.isFinite(o.maxConn) ? o.maxConn : 2;
      const used = portConnectionCount(o.linksForCapacity, mid);
      if (used + 2 > max) return { ok: false, reason: 'mid-port-full' };
    }

    const isPT = typeof o.isPassThrough === 'function' ? o.isPassThrough : () => false;

    /** @type {Partial<NetLink>} */
    const base = {};
    for (const k of [...COPY_BOTH, ...COPY_NET]) {
      if (link[k] !== undefined && link[k] !== null && link[k] !== '') base[k] = link[k];
    }

    // Default MEMORIA 21.8: tratto fra DUE pass-through → permanent link
    // (posa fissa in canalina/muro); tratto verso un endpoint attivo →
    // patch cord. La porta intermedia e' pass-through per definizione.
    const mk = (from, to) => {
      /** @type {NetLink} */
      const rec = { id: o.uid('l'), src: from, dst: to, ...base };
      if (isPT(from) && isPT(to)) rec.isPermanent = true;
      // Instradare e' un atto MANUALE → i tratti risultanti sono manuali (niente
      // autoLinked/protocol/confidence ereditati): cosi' restano protetti dai
      // sync SNMP successivi (principio "manuale ha sempre priorita'").
      return rec;
    };

    // NOTA lunghezza: la lunghezza totale del vecchio cavo non e'
    // ripartibile automaticamente sui due tratti → non viene copiata.
    return { ok: true, links: [mk(src, mid), mk(mid, dst)] };
  }

  /**
   * Fonde due link che si incontrano su una porta pass-through ("togli tappa").
   *
   * @param {Object} a       - primo link (tocca midPid)
   * @param {Object} b       - secondo link (tocca midPid)
   * @param {string} midPid  - porta intermedia da rimuovere dal percorso
   * @param {Object} opts    - { uid: fn }
   * @returns {{ok:true, link:Object}|{ok:false, reason:string}}
   */
  function mergeLinksThrough(a, b, midPid, opts) {
    const o = opts || {};
    const mid = _clean(midPid);
    if (!a || !b || !mid) return { ok: false, reason: 'invalid-input' };
    if (typeof o.uid !== 'function') return { ok: false, reason: 'missing-uid' };

    const ends = (l) => [_clean(l.src), _clean(l.dst)];
    const [a1, a2] = ends(a);
    const [b1, b2] = ends(b);
    const outerA = a1 === mid ? a2 : a2 === mid ? a1 : '';
    const outerB = b1 === mid ? b2 : b2 === mid ? b1 : '';
    if (!outerA || !outerB) return { ok: false, reason: 'mid-not-shared' };
    if (outerA === outerB) return { ok: false, reason: 'degenerate-loop' };

    const rec = { id: o.uid('l'), src: outerA, dst: outerB };

    // Rete: preferisci i valori di a (la catena dovrebbe gia' concordare).
    for (const k of COPY_NET) {
      const v = a[k] !== undefined && a[k] !== null && a[k] !== '' ? a[k] : b[k];
      if (v !== undefined && v !== null && v !== '') rec[k] = v;
    }

    // cableType/categoria: tieni solo se i due tratti concordano.
    for (const k of ['cableType', 'cableCategory']) {
      const va = _clean(a[k]); const vb = _clean(b[k]);
      if (va && va === vb) rec[k] = a[k];
    }

    // Lunghezza: somma se entrambe note, altrimenti l'unica presente.
    const la = Number(a.lengthM ?? a.length);
    const lb = Number(b.lengthM ?? b.length);
    if (Number.isFinite(la) && Number.isFinite(lb)) rec.lengthM = la + lb;
    else if (Number.isFinite(la)) rec.lengthM = la;
    else if (Number.isFinite(lb)) rec.lengthM = lb;
    if (rec.lengthM != null) rec.length = rec.lengthM;

    // Permanent solo se ENTRAMBI i tratti erano permanent.
    if (a.isPermanent === true && b.isPermanent === true) rec.isPermanent = true;

    // Note: concatena (dedup banale).
    const na = _clean(a.notes); const nb = _clean(b.notes);
    if (na && nb && na !== nb) rec.notes = `${na} | ${nb}`;
    else if (na || nb) rec.notes = na || nb;

    // installedAt/By: tieni se concordano (altrimenti il dato non e' del
    // cavo risultante).
    for (const k of ['installedAt', 'installedBy']) {
      const va = _clean(a[k]); const vb = _clean(b[k]);
      if (va && va === vb) rec[k] = a[k];
    }

    // Il merge e' un atto manuale → record manuale (no autoLinked).
    return { ok: true, link: rec };
  }

  /**
   * Porte pass-through candidabili come tappa intermedia per un link.
   * Pura: il chiamante passa il predicato pass-through e la capacita'.
   *
   * @param {Object} params
   *   links:         array link correnti
   *   ports:         elenco pid candidabili (gia' filtrati per tipo dal caller)
   *   maxConnOf:     fn(pid) → capacita' porta (default () => 2)
   * @returns {Array<{pid:string, used:number, free:number}>} solo porte con >= 2 slot liberi
   */
  function eligibleMidPorts(params) {
    const p = params || {};
    const maxOf = typeof p.maxConnOf === 'function' ? p.maxConnOf : () => 2;
    const out = [];
    for (const pid of (p.ports || [])) {
      const used = portConnectionCount(p.links, pid);
      const max = maxOf(pid);
      const free = Math.max(0, max - used);
      if (free >= 2) out.push({ pid: _clean(pid), used, free });
    }
    return out;
  }

  // Regola di adiacenza cablaggio (TIA-568): un segmento diretto fra due
  // porte e' fisicamente valido tranne quando ENTRAMBE sono prese a muro.
  // Una presa a muro ha 1 lato work-area (endpoint) + 1 lato rack (patch
  // panel), mai presa↔presa. Pura: il chiamante passa i tipi delle porte.
  /** @param {string} typeA @param {string} typeB @returns {boolean} */
  function cablingAdjacencyValid(typeA, typeB) {
    if (typeA === 'wallport' && typeB === 'wallport') return false;
    return true;
  }

  // Livello gerarchico di un tipo nella catena di cablaggio strutturato
  // (TIA-568): 0 = endpoint work-area, 1 = presa a muro (telecom outlet),
  // 2 = cross-connect / horizontal (patch panel, media converter),
  // 3 = equipment attivo (switch/router/...). Tutto cio' che non e' mappato
  // e' trattato come equipment (3). Usato per impedire instradamenti che
  // violano l'ordine gerarchico (es. una presa fra patch panel e switch).
  const _HIER_LEVEL = {
    pc: 0, printer: 0, ap: 0, webcam: 0, iot: 0, tv: 0,
    projector: 0, badgereader: 0, doorctrl: 0, customfloor: 0,
    // VoIP (P1.5-bis): il telefono IP ha uno switch a 2 porte integrato
    // (PC-port + uplink). Livello INTERMEDIO fra endpoint(0) e presa(1) cosi'
    // canRouteThrough lo accetta come tappa nel daisy-chain
    //   PC → telefono → presa a muro → patch panel → switch.
    voip: 0.5,
    wallport: 1,
    patchpanel: 2, mediaconv: 2,
  };
  /** @param {string} type @returns {number} livello 0..3 (0.5 = VoIP) */
  function cablingHierLevel(type) {
    const l = _HIER_LEVEL[type];
    return l !== undefined ? l : 3;
  }

  // Una tappa pass-through di tipo typeM puo' essere inserita nel segmento
  // A↔B (tipi typeA, typeB) solo se sta GERARCHICAMENTE TRA i due estremi:
  //   min(livA, livB) < livM < max(livA, livB)
  // Eccezione cross-connect (backbone MDF/IDF): un patch panel puo' sempre
  // essere inserito fra un altro patch panel e un device di livello
  // superiore (es. patchpanel-IDF ↔ patchpanel-MDF ↔ switch), che la
  // strict-between escluderebbe per pari livello.
  /** @param {string} typeA @param {string} typeM @param {string} typeB @returns {boolean} */
  function canRouteThrough(typeA, typeM, typeB) {
    // pass-through 'port' instradabili: presa a muro, patch panel e telefono
    // VoIP (PC-port + uplink, P1.5-bis). I mediaconv ('device') restano esclusi.
    if (typeM !== 'wallport' && typeM !== 'patchpanel' && typeM !== 'voip') return false;
    const a = cablingHierLevel(typeA);
    const b = cablingHierLevel(typeB);
    const m = cablingHierLevel(typeM);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo < m && m < hi) return true;
    // cross-connect: patch panel fra un patch panel e l'equipment a valle
    if (typeM === 'patchpanel' && (typeA === 'patchpanel' || typeB === 'patchpanel') && hi > 2) return true;
    return false;
  }

  // Tipi di tappa pass-through che, PER GERARCHIA, possono stare tra A e B
  // (a prescindere dagli slot liberi). Sottoinsieme di patchpanel/wallport/voip.
  // Serve a spiegare all'utente PERCHÉ non ci sono porte instradabili: se vuoto,
  // i due capi sono allo stesso livello o adiacenti (nessuna tappa possibile);
  // altrimenti dice quale tipo serve (es. "patch panel" tra presa a muro e switch).
  /** @param {string} typeA @param {string} typeB @returns {string[]} */
  function validMidTypes(typeA, typeB) {
    /** @type {string[]} */
    const out = [];
    for (const m of ['patchpanel', 'wallport', 'voip']) {
      if (canRouteThrough(typeA, m, typeB)) out.push(m);
    }
    return out;
  }

  // Validazione INFORMATIVA (non bloccante) dell'intera catena fisica di un
  // cavo multi-tappa (P1.5-bis). La regola coppia/tappa (canRouteThrough) gia'
  // impedisce le tappe fuori posto durante l'editing; qui guardiamo la
  // STRUTTURA complessiva per segnalare con un badge ⚠ percorsi anomali
  // importati o costruiti a mano. Pura: riceve l'array ORDINATO dei tipi dei
  // nodi lungo il percorso (estremi inclusi). Ritorna { ok, warnings:[{code,msg}] }.
  /** @param {string[]} types @returns {{ok:boolean, warnings:{code:string,msg:string}[]}} */
  function validateCablingChain(types) {
    const t = (types || []).filter(Boolean);
    const warnings = [];
    if (t.length < 2) return { ok: true, warnings };
    const lv = t.map(cablingHierLevel);
    const n = lv.length;

    // 1. Catena troppo lunga (> 6 nodi): tipicamente un errore di modellazione
    //    o un percorso che andrebbe spezzato logicamente.
    if (n > 6) warnings.push({ code: 'too-long', msg: `Catena lunga: ${n} nodi (oltre 6).` });

    // 2. Apparato attivo (livello 3: switch/router/...) in posizione NON
    //    terminale: l'equipment chiude sempre la tratta, non la attraversa.
    for (let i = 1; i < n - 1; i++) {
      if (lv[i] >= 3) {
        warnings.push({ code: 'active-mid', msg: 'Apparato attivo in mezzo alla catena (dovrebbe essere terminale).' });
        break;
      }
    }

    // 3. Capi della catena: due endpoint work-area ai capi = manca l'apparato
    //    di rete (cablaggio strutturato senza switch in mezzo).
    //    NB: due apparati ATTIVI ai capi NON sono un'anomalia — trunk/uplink
    //    switch↔switch (anche attraverso patch panel: backbone MDF/IDF,
    //    TIA-568 "Cabling Subsystem 2/3" fra cross-connect) sono la norma, e
    //    ogni collegamento Ethernet termina comunque su due dispositivi attivi.
    //    (La vecchia regola 'both-active' segnalava a torto i trunk.)
    const a = lv[0], b = lv[n - 1];
    if (a === 0 && b === 0) warnings.push({ code: 'both-endpoints', msg: 'Entrambi i capi sono endpoint: manca un apparato di rete.' });

    // 3b. Catena INCOMPLETA: un capo è un device WORK-AREA (endpoint=0 o telefono
    //     VoIP=0.5) e l'ALTRO è una sola tappa pass-through (presa=1, patch/media
    //     converter=2). Significa che l'endpoint è cablato solo fino a una presa/
    //     patch e NON raggiunge alcun apparato di rete → run monco (es. il bug del
    //     telefono con uplink scollegato, o un PC cablato a una presa non patchata).
    //     NB: transito↔transito (presa↔patch = permanent link) e attivo↔attivo
    //     (backbone) NON sono incompleti → non si segnalano.
    const _workArea = lvl => lvl < 1;                 // endpoint (0) o VoIP (0.5)
    const _transit  = lvl => lvl === 1 || lvl === 2;  // presa / patch / media conv
    if ((_workArea(a) && _transit(b)) || (_transit(a) && _workArea(b))) {
      warnings.push({ code: 'incomplete-chain', msg: 'Catena incompleta: l’endpoint è cablato solo fino a una tappa pass-through (presa/patch) e non raggiunge alcun apparato di rete.' });
    }

    // 4. Forma della catena: il profilo dei livelli deve essere una "VALLE" —
    //    non-crescente fino al punto piu' basso, poi non-decrescente. Copre:
    //      - tratta orizzontale  PC→presa→patch→switch       (0,1,2,3: salita)
    //      - backbone fra attivi switch→pp→[pp]→switch       (3,2,[2],3: valle)
    //      - edge switch via cablaggio strutturato sw→wp→pp→sw (3,1,2,3: valle)
    //    Anomalo = un PICCO interno: il percorso SALE su una tappa passiva e
    //    poi RIDISCENDE (es. PC→patch panel→presa→switch: 0,2,1,3).
    let s = 1;
    while (s < n && lv[s] <= lv[s - 1]) s++;   // tratto non-crescente
    while (s < n && lv[s] >= lv[s - 1]) s++;   // tratto non-decrescente
    if (s !== n) warnings.push({ code: 'non-monotone', msg: 'Ordine gerarchico anomalo: il percorso risale e poi ridiscende (tappa fuori posto).' });

    return { ok: warnings.length === 0, warnings };
  }

  // Ambiguità "per catena" (P1.5-bis, resa chain-aware). Un cavo instradato
  // attraverso pass-through resta INFERITO finché ANCHE UN SOLO hop della sua
  // catena fisica è inferito; diventa confermato solo quando TUTTA la catena è
  // manuale. Cammina le componenti connesse dei link (adiacenza = stesso pid
  // pass-through condiviso; ci si ferma su endpoint/apparati attivi) e marca
  // TUTTI i link di una componente che contiene ≥1 link 'ambiguous'.
  // Pura: il chiamante inietta i predicati che dipendono dal catalogo/stato.
  //   links:            array {id, src, dst}
  //   isPassThroughPid: fn(pid) → bool (true se il pid è su un nodo pass-through)
  //   isAmbiguous:      fn(link) → bool
  // @returns {Set<string>} id-link la cui catena è (ancora) inferita
  function chainAmbiguousLinkIds(links, isPassThroughPid, isAmbiguous) {
    const list = Array.isArray(links) ? links : [];
    const isPT = typeof isPassThroughPid === 'function' ? isPassThroughPid : () => false;
    const isAmb = typeof isAmbiguous === 'function' ? isAmbiguous : () => false;
    const byPid = new Map();                  // pid → [link…] che lo toccano
    for (const l of list) {
      for (const p of [_clean(l && l.src), _clean(l && l.dst)]) {
        if (!p) continue;
        let arr = byPid.get(p); if (!arr) { arr = []; byPid.set(p, arr); }
        arr.push(l);
      }
    }
    const idToLink = new Map(list.map(l => [l && l.id, l]));
    const seen = new Set();
    const ambIds = new Set();
    for (const start of list) {
      if (!start || seen.has(start.id)) continue;
      const comp = [];
      const queue = [start.id];
      seen.add(start.id);
      while (queue.length) {
        const l = idToLink.get(queue.shift());
        if (!l) continue;
        comp.push(l);
        for (const p of [_clean(l.src), _clean(l.dst)]) {
          if (!p || !isPT(p)) continue;       // chain solo attraverso pass-through
          for (const other of (byPid.get(p) || [])) {
            if (other && !seen.has(other.id)) { seen.add(other.id); queue.push(other.id); }
          }
        }
      }
      if (comp.some(l => isAmb(l))) for (const l of comp) ambIds.add(l.id);
    }
    return ambIds;
  }

  // Colore VLAN "per catena" (P1.5-bis): un segmento senza VLAN colorata
  // EREDITA il colore VLAN dominante della sua catena fisica — es. il tratto
  // PC↔presa (untagged a valle) prende il colore del tratto presa↔switch che
  // arriva dalla sorgente VLAN. Robusto anche se la propagazione VLAN non ha
  // raggiunto le porte passive a valle. Pura: i predicati dipendono da TYPES/
  // stato e sono iniettati dal chiamante.
  //   links, isPassThroughPid (adiacenza catena), colorOf(link) → colore|null
  // @returns {Map<string,string>} link.id → colore VLAN della catena
  function chainVlanColorMap(links, isPassThroughPid, colorOf) {
    const list = Array.isArray(links) ? links : [];
    const isPT = typeof isPassThroughPid === 'function' ? isPassThroughPid : () => false;
    const colOf = typeof colorOf === 'function' ? colorOf : () => null;
    const byPid = new Map();
    for (const l of list) for (const p of [_clean(l && l.src), _clean(l && l.dst)]) {
      if (!p) continue;
      let a = byPid.get(p); if (!a) { a = []; byPid.set(p, a); } a.push(l);
    }
    const idToLink = new Map(list.map(l => [l && l.id, l]));
    const seen = new Set();
    const out = new Map();
    for (const start of list) {
      if (!start || seen.has(start.id)) continue;
      const comp = []; const queue = [start.id]; seen.add(start.id);
      while (queue.length) {
        const l = idToLink.get(queue.shift()); if (!l) continue; comp.push(l);
        for (const p of [_clean(l.src), _clean(l.dst)]) {
          if (!p || !isPT(p)) continue;
          for (const o of (byPid.get(p) || [])) if (o && !seen.has(o.id)) { seen.add(o.id); queue.push(o.id); }
        }
      }
      // colore dominante fra i membri (piu' frequente fra i non-null)
      const counts = new Map();
      for (const l of comp) { const c = colOf(l); if (c) counts.set(c, (counts.get(c) || 0) + 1); }
      if (!counts.size) continue;
      let best = null, bestN = -1;
      for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
      for (const l of comp) out.set(l.id, best);
    }
    return out;
  }

  return {
    splitLinkThrough, mergeLinksThrough, eligibleMidPorts,
    portConnectionCount, cablingAdjacencyValid, cablingHierLevel, canRouteThrough,
    validMidTypes, validateCablingChain, chainAmbiguousLinkIds, chainVlanColorMap,
  };
});
