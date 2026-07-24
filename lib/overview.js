'use strict';
// ============================================================
//  lib/overview.js — i fatti della «Panoramica» (PURO, "InfraNet calcola").
//
//  Compone in TRE sezioni cio' che i motori gia' calcolano, nell'ordine in cui
//  ci si fanno le domande davanti a una rete documentata:
//    ① COMPLETO — il documento descrive tutto quello che c'e'?
//    ② VERO     — quello che c'e' scritto corrisponde ancora alla realta'?
//    ③ MARGINE  — quanto si puo' crescere senza comprare niente?
//
//  NON ricalcola nulla che esista gia': riceve gli output di lib/spare-ports.js,
//  lib/project-networks.js e il catalogo TYPES. E' composizione, non un motore
//  nuovo.
//
//  ZERO stringhe di interfaccia: ogni riga esce come CHIAVE + numeri + elenco.
//  Le parole le mette il renderer via i18n ("InfraNet calcola, l'app racconta"),
//  cosi' la stessa lib serve it/en e i test non dipendono dalla lingua.
//
//  PROVENIENZA su ogni riga (paletto ② no-invenzioni reso dato, non grafica):
//    'declared' l'ha scritto l'utente · 'measured' letto dall'apparato ·
//    'derived'  dedotto da altri segnali · 'none' il dato NON c'e'.
//  Una riga 'none' NON vale zero: vale "non lo sappiamo", e il renderer la
//  disegna tratteggiata. Zero e' un'affermazione, tratteggiato e' una domanda.
//
//  UMD-lite: in Node require(), nel browser global (ma oggi la importa solo
//  src/app-overview.js via ESM).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);               // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const _str = (v) => (v == null ? '' : String(v)).trim();
  const _arr = (v) => (Array.isArray(v) ? v : []);
  const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Indirizzabile = puo' avere un IP. Sugli ATTIVI (switch/router/hypervisor…)
  // il flag `hasIP` non c'e': l'indirizzo e' implicito in `isActive`. Stesso
  // predicato di lib/subbar-stats.js — contare il solo hasIP lascerebbe fuori
  // tutta l'infrastruttura.
  function _isAddressable(def) { const d = _obj(def); return !!(d.isActive || d.hasIP); }

  // Il nome "vero" e' quello che NON coincide con l'indirizzo: lo Scopri, quando
  // non trova un hostname, scrive l'IP dentro node.name (vedi lib/node-label.js).
  // Un nome che ripete l'indirizzo non e' documentazione, e' un segnaposto.
  function _hasRealName(n) {
    const nm = _str(n && n.name);
    if (!nm) return false;
    return nm !== _str(n && n.ip) && nm !== _str(n && n.ip6);
  }

  // L'identita' L2 di un apparato non vive solo in `node.mac`. Su un device
  // gestito via SNMP il MAC arriva PER INTERFACCIA (ifPhysAddress finisce sulle
  // porte, e sui LAG) e `node.mac` — che lo Scopri riempie via ARP — resta vuoto:
  // uno switch con 8 porte ha 8 MAC documentati e zero "MAC del device".
  // Contare il solo `node.mac` dichiarava mancante un dato che c'e' (rilevato
  // dall'utente sul suo progetto, 2026-07-23). `portMacNodeIds` = id dei nodi
  // con almeno un MAC su una porta/LAG, calcolato dal chiamante.
  function _macState(n, portMacIds) {
    if (_str(n && n.mac)) return 'node';
    if (portMacIds && portMacIds.has && portMacIds.has(n && n.id)) return 'ports';
    return 'none';
  }

  function _row(key, o) {
    const r = Object.assign({ key, value: null, total: null, prov: 'declared', tone: 'normal', items: [] }, o || {});
    // pct calcolata qui una volta sola: il renderer non fa aritmetica.
    r.pct = (r.total != null && r.total > 0 && typeof r.value === 'number')
      ? Math.round((r.value / r.total) * 100) : null;
    return r;
  }

  // Il titolo grande di una sezione: la PRIMA voce presente della lista di
  // priorita', cioe' la cosa su cui si agisce — non il totale piu' grande.
  // Deterministico di proposito: due progetti uguali danno lo stesso titolo.
  function _headline(rows, order) {
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const [key, pick] of order) {
      const r = byKey.get(key);
      if (r && pick(r)) return { key, value: r.value, total: r.total, gap: r.total != null ? r.total - r.value : null };
    }
    return null;
  }

  // ── ① COMPLETO ─────────────────────────────────────────────────────────────
  function _complete(m) {
    const types = _obj(m.types);
    const nodes = _arr(m.nodes);
    const addressable = [];
    for (const n of nodes) {
      const def = _obj(types[n && n.type]);
      if (def.isStructural) continue;
      if (_isAddressable(def)) addressable.push(n);
    }
    const item = (n) => ({ id: n.id, type: n.type, addr: _str(n.ip) || _str(n.ip6) });

    const portMacIds = (m.portMacNodeIds instanceof Set) ? m.portMacNodeIds : new Set(_arr(m.portMacNodeIds));
    const noAddr = addressable.filter((n) => !_str(n.ip) && !_str(n.ip6));
    const noName = addressable.filter((n) => !_hasRealName(n));
    const macState = addressable.map((n) => _macState(n, portMacIds));
    const noMac = addressable.filter((n, i) => macState[i] === 'none');
    const macFromPorts = macState.filter((s) => s === 'ports').length;

    const nets = _arr(m.networks);
    const declaredSubnets = Object.keys(_obj(m.ipamVlans))
      .filter((k) => _str(_obj(_obj(m.ipamVlans)[k]).subnet)).length;
    const vlansInUse = _arr(m.vlanIdsInUse);
    const vlanNames = _obj(m.vlanNames);
    const vlansNamed = vlansInUse.filter((v) => _str(vlanNames[String(v)])).length;

    const rows = [
      _row('addr', { value: addressable.length - noAddr.length, total: addressable.length, items: noAddr.map(item) }),
      _row('name', { value: addressable.length - noName.length, total: addressable.length, items: noName.map(item) }),
      _row('mac', {
        value: addressable.length - noMac.length, total: addressable.length,
        items: noMac.map(item), extra: { fromPorts: macFromPorts },
      }),
      // Un cavo creato dall'auto-link (LLDP/CDP/FDB) NON e' un cavo dichiarato:
      // e' una deduzione che l'utente non ha ancora confermato. Contarli insieme
      // faceva dire «17 documentati» a un progetto dove 15 su 17 erano dedotti
      // (Rete+Lab, 2026-07-23) — nella sezione che chiede se il documento e'
      // completo, e' proprio la distinzione che conta.
      // Le porte impegnate arrivano dallo STESSO report delle porte libere: contarle
      // altrove darebbe un numeratore su una popolazione diversa dal totale a fianco.
      _row('cables', { value: _arr(m.links).length, total: null,
        extra: {
          portsUsed: _num(_obj(_obj(m.spare).totals).used),
          auto: _arr(m.links).filter((l) => l && l.autoLinked).length,
          manual: _arr(m.links).filter((l) => l && !l.autoLinked).length,
        } }),
      _row('subnets', {
        value: declaredSubnets, total: null, prov: declaredSubnets ? 'declared' : 'none',
        extra: { observed: nets.length },
        items: nets.map((x) => ({ id: x.cidr || x.net, meta: _num(x.deviceCount) })),
      }),
      _row('vlanNames', {
        value: vlansNamed, total: vlansInUse.length,
        prov: (vlansInUse.length && !vlansNamed) ? 'none' : 'declared',
      }),
    ];
    return {
      rows,
      // Prima il buco piu' grave: senza indirizzo non si verifica nulla; senza
      // nome la planimetria e' una colonna di IP; senza MAC il device e' invisibile
      // al confronto con la realta'.
      headline: _headline(rows, [
        ['addr', (r) => r.total > 0 && r.value < r.total],
        ['name', (r) => r.total > 0 && r.value < r.total],
        ['mac', (r) => r.total > 0 && r.value < r.total],
        ['subnets', (r) => r.prov === 'none'],
        ['addr', () => true],
      ]),
    };
  }

  // ── ② VERO ─────────────────────────────────────────────────────────────────
  function _truth(m) {
    const types = _obj(m.types);
    const nodes = _arr(m.nodes);
    const addressable = nodes.filter((n) => {
      const def = _obj(types[n && n.type]);
      return !def.isStructural && _isAddressable(def);
    });
    const snmp = addressable.filter((n) => {
      const integ = _obj(n && n.integration);
      return _str(integ.driver).indexOf('snmp') === 0 && !!_str(integ.host || n.ip);
    });
    const unverifiable = addressable.filter((n) => snmp.indexOf(n) === -1);

    // Porte "sospette": libere sul documento ma che l'apparato vede attive.
    // E' l'unico confronto realta'↔documento disponibile SENZA una Verifica:
    // lo calcola gia' lib/spare-ports.js a ogni lettura SNMP.
    const spare = _obj(m.spare);
    const totals = _obj(spare.totals);
    const suspectByDevice = [];
    for (const rack of _arr(spare.racks)) {
      for (const d of _arr(rack.devices)) if (_num(d.suspect) > 0) suspectByDevice.push({ id: d.id, meta: _num(d.suspect) });
    }
    for (const d of _arr(spare.unracked)) if (_num(d.suspect) > 0) suspectByDevice.push({ id: d.id, meta: _num(d.suspect) });
    suspectByDevice.sort((a, b) => b.meta - a.meta || String(a.id).localeCompare(String(b.id)));

    // Vicini LLDP/CDP dalla cache di topologia, e chi non ha MAI risposto.
    const cache = _obj(m.topoCache);
    let neighbors = 0, withNeighbors = 0;
    const neverAnswered = [];
    for (const n of snmp) {
      const c = _obj(cache[n.id]);
      if (!c.ts) { neverAnswered.push({ id: n.id, type: n.type }); continue; }
      const k = _arr(c.neighbors).length;
      neighbors += k;
      if (k) withNeighbors++;
    }

    // LAG: la chiave dice da dove arriva (snmp-lag-… misurato · lldp-lag-… dedotto).
    const lagKeys = Object.keys(_obj(m.lagGroups));
    const lagMeasured = lagKeys.filter((k) => k.indexOf('snmp-') === 0).length;

    const sync = _obj(m.lastSyncResult);
    const lastAt = _num(m.lastSyncAt) || _num(sync.at) || 0;
    const now = _num(m.now) || 0;

    const rows = [
      _row('lastSync', {
        value: lastAt ? _num(sync.ok) : null, total: lastAt ? _num(sync.total) : null,
        prov: lastAt ? 'measured' : 'none', tone: lastAt ? 'normal' : 'muted',
        extra: { at: lastAt || null, ageMs: (lastAt && now) ? Math.max(0, now - lastAt) : null },
      }),
      _row('verifiable', {
        value: snmp.length, total: addressable.length, prov: 'derived',
        items: unverifiable.map((n) => ({ id: n.id, type: n.type, addr: _str(n.ip) || _str(n.ip6) })),
      }),
      _row('suspectPorts', {
        value: _num(totals.suspect), total: _num(totals.free), prov: 'measured',
        tone: _num(totals.suspect) > 0 ? 'alert' : 'normal', items: suspectByDevice,
      }),
      _row('neighbors', {
        value: neighbors, total: null, prov: 'measured',
        extra: { fromDevices: withNeighbors, neverAnswered: neverAnswered.length },
        items: neverAnswered,
      }),
      _row('lags', {
        value: lagKeys.length, total: null, prov: lagKeys.length ? 'derived' : 'none',
        extra: { measured: lagMeasured, derived: lagKeys.length - lagMeasured },
      }),
      // Fase 1: la Verifica resta fuori (e' un evento, non ancora stato salvato).
      // La riga esiste comunque, dichiarata come dato mancante: e' la lacuna che
      // la fase 2 riempira'.
      _row('verify', { value: null, total: null, prov: 'none', tone: 'muted' }),
    ];
    return {
      rows,
      headline: _headline(rows, [
        ['suspectPorts', (r) => r.value > 0],
        ['verifiable', (r) => r.total > 0 && r.value < r.total],
        ['lastSync', () => true],
      ]),
    };
  }

  // ── ③ MARGINE ──────────────────────────────────────────────────────────────
  function _margin(m) {
    const spare = _obj(m.spare);
    const totals = _obj(spare.totals);
    const free = _num(totals.free);
    const suspect = _num(totals.suspect);
    const sfpTotal = _num(m.sfpTotal);

    // Margine ONESTO: le porte libere meno quelle che l'apparato vede attive.
    // Contarle come disponibili sarebbe una promessa che la realta' smentisce.
    const freeHonest = Math.max(0, free - suspect);

    const racks = _arr(m.rackFill);
    const rackFree = racks.reduce((a, r) => a + _num(r.free), 0);
    // Il totale U del rack e' `sizeU` (default app-wide 42). Il glue costruiva
    // rackFill leggendo `r.units || r.u`, campi che sul rack NON esistono → il
    // denominatore cadeva SEMPRE a 42 (progetto 8: 126U dichiarate contro 78U
    // reali, 2026-07-23). Ora la riga porta gia' il campo giusto: vedi _rackFill.
    const rackTot = racks.reduce((a, r) => a + _num(r.sizeU), 0);

    const caps = _arr(m.caps);
    const switches = _arr(m.nodes).filter((n) => n && n.type === 'switch').length;
    const withPoe = caps.filter((c) => _obj(_obj(c).caps).poe).length;
    const poeHeadroom = caps.reduce((a, c) => {
      const p = _obj(_obj(c).caps).poe;
      return a + (p && p.headroomW != null ? _num(p.headroomW) : 0);
    }, 0);
    // ⚠️ Banda «fra gli armadi»: NON sommare i LAG. Un Port-channel fra due switch
    // vive su ENTRAMBI i capi, e sia il totale-flotta (somma) sia il per-device
    // `lagAggregateMbps` (Σ dei LAG del device) lo gonfiano. La risposta onesta e'
    // il SINGOLO collegamento aggregato PIU' CAPIENTE → max su `lags[].aggregateMbps`
    // (max{20G,20G}=20G, mai 40). Un MAX non raddoppia i due capi.
    let uplink = 0;
    const uplinkItems = [];
    for (const c of caps) {
        const p = _obj(_obj(c).caps).ports;
        for (const lag of _arr(p && p.lags)) {
            const mbps = _num(lag && lag.aggregateMbps);
            if (!mbps) continue;
            uplink = Math.max(uplink, mbps);
            uplinkItems.push({ id: _obj(c).id, meta: mbps });
        }
    }
    uplinkItems.sort((a, b) => b.meta - a.meta);

    const nets = _arr(m.networks);
    const declaredSubnets = Object.keys(_obj(m.ipamVlans))
      .filter((k) => _str(_obj(_obj(m.ipamVlans)[k]).subnet)).length;

    const rows = [
      _row('freePorts', { value: freeHonest, total: _num(totals.ports), extra: { raw: free, suspect } }),
      // sfpTotal === 0 NON significa "zero libere": significa che nessun apparato
      // dichiara porte in fibra. Distinzione voluta — vedi il commento in testa.
      _row('freeSfp', {
        value: sfpTotal ? _num(totals.freeSfp) : null, total: sfpTotal || null,
        prov: sfpTotal ? 'declared' : 'none',
        tone: (sfpTotal && !_num(totals.freeSfp)) ? 'alert' : 'normal',
      }),
      _row('rackU', { value: rackFree, total: rackTot, prov: rackTot ? 'declared' : 'none' }),
      _row('poe', {
        value: withPoe, total: switches || null, prov: withPoe ? 'declared' : 'none',
        extra: { headroomW: withPoe ? poeHeadroom : null },
      }),
      _row('uplink', {
        value: uplink || null, total: null, prov: uplink ? 'derived' : 'none',
        extra: { devices: uplinkItems.length }, items: uplinkItems,
      }),
      _row('ipFree', {
        value: null, total: null, prov: declaredSubnets ? 'declared' : 'none',
        extra: { observedNets: nets.length },
        items: nets.map((x) => ({ id: x.cidr || x.net, meta: _num(x.deviceCount) })),
      }),
    ];
    return {
      rows,
      headline: _headline(rows, [
        ['freeSfp', (r) => r.prov === 'declared' && r.value === 0],
        ['rackU', (r) => r.total > 0 && r.value === 0],
        ['freePorts', () => true],
      ]),
    };
  }

  // Riempimento dei rack, calcolato QUI (puro) e non nel glue: era una cucitura
  // non testata, ed e' proprio li' che il bug del denominatore e' vissuto. Il
  // campo VERO dell'altezza rack e' `sizeU` (default app-wide 42, vedi app.js:656);
  // `units`/`u` non esistono sul rack. `used` = somma dei sizeU dei device che
  // OCCUPANO U (solo i tipi isRack; un PC a muro non consuma unita').
  function _rackFill(racks, nodes, types) {
    const T = _obj(types);
    const ns = _arr(nodes);
    return _arr(racks).map((r) => {
      const sizeU = _num(r && r.sizeU) || 42;
      let used = 0;
      for (const n of ns) {
        if (n && n.rackId === (r && r.id) && _obj(T[n.type]).isRack) {
          used += _num(n.sizeU) || _num(_obj(T[n.type]).sizeU) || 1;
        }
      }
      return { id: r && r.id, sizeU, used, free: Math.max(0, sizeU - used) };
    });
  }

  /**
   * Fatti della Panoramica. `model` esplicito, nessuna lettura di stato globale:
   *   { nodes, links, types, ipamVlans, vlanIdsInUse, vlanNames, portMacNodeIds,
   *     spare (buildSpareReport), sfpTotal, networks (deriveProjectNetworks),
   *     caps, fleet (hw-capabilities), rackFill, topoCache, lagGroups,
   *     lastSyncAt, lastSyncResult, now }
   */
  function buildOverview(model) {
    const m = _obj(model);
    return { complete: _complete(m), truth: _truth(m), margin: _margin(m) };
  }

  return { buildOverview, _isAddressable, _hasRealName, _rackFill };
});
