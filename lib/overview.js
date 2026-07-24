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

  // Da un id composito (`<nodeId>-<indice>` di una porta, o un token che finisce
  // con l'indice) ricava l'id NODO: il prefisso piu' lungo che e' un nodo vero.
  // Gli id nodo possono contenere trattini (`n-5`), quindi non basta tagliare
  // all'ultimo '-'. Ritorna null se nessun prefisso e' un nodo noto — cosi' il
  // renderer mostra testo grezzo invece di un finto link.
  function _nodeIdOf(token, nodeIds) {
    const s = _str(token);
    if (!s || !(nodeIds && nodeIds.has)) return null;
    if (nodeIds.has(s)) return s;
    let i = s.lastIndexOf('-');
    while (i > 0) {
      const cand = s.slice(0, i);
      if (nodeIds.has(cand)) return cand;
      i = s.lastIndexOf('-', i - 1);
    }
    return null;
  }

  // Chiave MAC robusta al formato: tiene solo gli esadecimali, cosi'
  // 'd4:1a:..' / 'd4-1a-..' / 'd41a..' danno la stessa chiave a 12 cifre.
  // '' se non e' un MAC (evita falsi match su sysName corti). La mappa
  // MAC→nodo la costruisce il chiamante con la STESSA normalizzazione.
  function _macKey(v) {
    const h = _str(v).toLowerCase().replace(/[^0-9a-f]/g, '');
    return h.length === 12 ? h : '';
  }

  // Host UTILIZZABILI di un CIDR: 2^(32-prefix) meno rete e broadcast
  // (/31 = 2 punto-punto RFC 3021, /32 = 1). Prefisso assente → /24, la stessa
  // assunzione con cui deriveProjectNetworks raggruppa gli indirizzi osservati:
  // per questo il conteggio dei liberi e' DEDOTTO, non dichiarato.
  function _usableHosts(cidr) {
    const m = /\/(\d{1,2})\s*$/.exec(_str(cidr));
    let p = m ? Number(m[1]) : 24;
    if (!Number.isFinite(p) || p < 0 || p > 32) p = 24;
    if (p >= 31) return p === 31 ? 2 : 1;
    return Math.pow(2, 32 - p) - 2;
  }

  // Indirizzabile = puo' avere un IP. Sugli ATTIVI (switch/router/hypervisor…)
  // il flag `hasIP` non c'e': l'indirizzo e' implicito in `isActive`. Stesso
  // predicato di lib/subbar-stats.js — contare il solo hasIP lascerebbe fuori
  // tutta l'infrastruttura.
  function _isAddressable(def) { const d = _obj(def); return !!(d.isActive || d.hasIP); }

  // Il nome "vero" e' quello che NON coincide con l'indirizzo: lo Scopri, quando
  // non trova un hostname, scrive l'IP dentro node.name (vedi lib/node-label.js).
  // Un nome che ripete l'indirizzo non e' documentazione, e' un segnaposto.
  function _hasRealName(n) {
    const ip = _str(n && n.ip);
    const ip6 = _str(n && n.ip6);
    const nm = _str(n && n.name);
    if (nm && nm !== ip && nm !== ip6) return true;
    // Un hostname PINNATO A MANO (hostnameManual) e' un atto deliberato di
    // denominazione: vale come nome proprio anche se node.name mostra ancora
    // l'IP (il campo Hostname aggiorna hostname+hostnameManual, non name —
    // app-properties.js). Solo il MANUALE: il node.hostname grezzo (auto da
    // sysName/discovery) puo' essere un blob, e se e' leggibile e' gia' finito
    // in node.name via _discDisplayName. Non-vuoto e diverso dall'indirizzo.
    const hn = _str(n && n.hostname);
    if (n && n.hostnameManual && hn && hn !== ip && hn !== ip6) return true;
    return false;
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

  // Salute della sezione (dato per lo «strato colpo d'occhio»): un livello
  // ok/warn/bad + un conteggio. Le PAROLE le mette il glue (i18n); qui solo la
  // classificazione, coerente coi toni dei singoli riquadri.
  //   COMPLETO → giallo se una dimensione (indirizzo/nome/mac/subnet/VLAN) ha un
  //     buco; mai rosso: l'incompletezza e' un'attivita', non un guasto.
  //   VERO → rosso se non c'e' MAI stata una lettura (si vola alla cieca); giallo
  //     se letto ma con discrepanze (porte sospette) o device non verificabili;
  //     verde se letto e coerente. La riga «Verifica completa» e' un segnaposto
  //     di Fase 2 (sempre 'none'): NON deve tingere di rosso ogni progetto.
  //   MARGINE → giallo se una risorsa chiave e' esaurita (0 porte libere, rack
  //     pieno); i dati assenti (PoE/SFP non dichiarati) non abbassano il livello.
  function _sectionHealth(key, rows) {
    const by = new Map(_arr(rows).map((r) => [r && r.key, r]));
    const gapOf = (r) => (r && r.total != null && typeof r.value === 'number') ? r.total - r.value : 0;
    const hasGap = (r) => !!r && (r.prov === 'none' || (r.total != null && typeof r.value === 'number' && r.value < r.total));
    if (key === 'complete') {
      const issues = ['addr', 'name', 'mac', 'subnets', 'vlanNames'].filter((k) => hasGap(by.get(k))).length;
      return { level: issues ? 'warn' : 'ok', issues };
    }
    if (key === 'truth') {
      const lastSync = by.get('lastSync');
      const suspect = _num(by.get('suspectPorts') && by.get('suspectPorts').value);
      const unverifiable = gapOf(by.get('verifiable'));
      if (!lastSync || lastSync.prov === 'none') return { level: 'bad', issues: 0 };
      if (suspect > 0 || unverifiable > 0) return { level: 'warn', issues: suspect };
      return { level: 'ok', issues: 0 };
    }
    const freePorts = by.get('freePorts');
    const rackU = by.get('rackU');
    const portsOut = !!freePorts && typeof freePorts.value === 'number' && freePorts.value === 0 && _num(freePorts.total) > 0;
    const rackFull = !!rackU && rackU.prov !== 'none' && _num(rackU.value) === 0 && _num(rackU.total) > 0;
    const tight = (portsOut ? 1 : 0) + (rackFull ? 1 : 0);
    return { level: tight ? 'warn' : 'ok', issues: tight };
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

    const nodeIds = new Set(nodes.map((n) => _str(n && n.id)).filter(Boolean));
    const links = _arr(m.links);
    const derivedLinks = links.filter((l) => l && l.autoLinked);

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
      _row('cables', { value: links.length, total: null,
        extra: {
          portsUsed: _num(_obj(_obj(m.spare).totals).used),
          auto: derivedLinks.length,
          manual: links.length - derivedLinks.length,
        },
        // I cavi DEDOTTI (auto-link da LLDP/CDP/FDB) sono i «da verificare»: una
        // buona ipotesi che l'utente non ha ancora confermato. Il click li elenca,
        // i due capi risolti a nome dal renderer (id/peer = nodo di ciascun estremo).
        items: derivedLinks.map((l) => ({ id: _nodeIdOf(l.src, nodeIds), peer: _nodeIdOf(l.dst, nodeIds) })),
      }),
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
      health: _sectionHealth('complete', rows),
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
    // `items` = le ADIACENZE (device → vicino), cosi' il numero grande e la lista
    // che si apre parlano della stessa cosa. Prima il click mostrava i "mai
    // risposto" mentre il numero contava i vicini: 15 in cima, 1 sotto — la
    // domanda dell'utente «poi ne esce solo 1?» (2026-07-24).
    const nodeIds = new Set(nodes.map((n) => _str(n && n.id)).filter(Boolean));
    // MAC→id nodo (chiave esadecimale): alcuni vicini LLDP/CDP si annunciano solo
    // col chassis-id MAC. Se quel MAC e' di un device del progetto, lo mostriamo
    // a NOME (peer cliccabile) invece che come stringa esadecimale.
    const macToNode = _obj(m.macToNode);
    const cache = _obj(m.topoCache);
    let neighbors = 0, withNeighbors = 0;
    const neverAnswered = [];
    const neighborItems = [];
    for (const n of snmp) {
      const c = _obj(cache[n.id]);
      if (!c.ts) { neverAnswered.push({ id: n.id, type: n.type }); continue; }
      const adj = _arr(c.neighbors);
      neighbors += adj.length;
      if (adj.length) withNeighbors++;
      for (const nb of adj) {
        const remote = _str(nb && nb.remoteDevice) || _str(nb && nb.remoteIP);
        const port = _str(nb && nb.remotePort);
        const mk = _macKey(_str(nb && nb.remoteMac) || _str(nb && nb.remoteDevice));
        const peer = mk ? (macToNode[mk] || null) : null;
        if (peer) neighborItems.push({ id: n.id, peer, meta: port });
        else neighborItems.push({ id: n.id, meta: remote ? (port ? remote + ' · ' + port : remote) : port });
      }
    }

    // LAG: la chiave dice da dove arriva (snmp-lag-… misurato · lldp-lag-… dedotto)
    // e codifica i capi (snmp-lag-<nodo>-<idx> · lldp-lag-<a>||<b>).
    const lagGroups = _obj(m.lagGroups);
    const lagKeys = Object.keys(lagGroups);
    const lagMeasured = lagKeys.filter((k) => k.indexOf('snmp-') === 0).length;
    const lagItems = lagKeys.map((k) => {
      const measured = k.indexOf('snmp-') === 0;
      const body = k.replace(/^snmp-lag-/, '').replace(/^lldp-lag-/, '');
      let a, b = null;   // a assegnata in entrambi i rami; b resta null senza '||'
      if (body.indexOf('||') !== -1) { const p = body.split('||'); a = _nodeIdOf(p[0], nodeIds); b = _nodeIdOf(p[1], nodeIds); }
      else { a = _nodeIdOf(body, nodeIds); }
      const nm = lagGroups[k];
      return { id: a, peer: b, meta: _str(typeof nm === 'string' ? nm : (nm && nm.name)), tag: measured ? 'measured' : 'derived' };
    });

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
        items: neighborItems,
      }),
      _row('lags', {
        value: lagKeys.length, total: null, prov: lagKeys.length ? 'derived' : 'none',
        extra: { measured: lagMeasured, derived: lagKeys.length - lagMeasured },
        items: lagItems,
      }),
      // Fase 1: la Verifica resta fuori (e' un evento, non ancora stato salvato).
      // La riga esiste comunque, dichiarata come dato mancante: e' la lacuna che
      // la fase 2 riempira'.
      _row('verify', { value: null, total: null, prov: 'none', tone: 'muted' }),
    ];
    return {
      rows,
      health: _sectionHealth('truth', rows),
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

    // Per-device: libere / totali, per il dettaglio cliccabile di «Porte libere»,
    // DISTINTI in rack e fuori rack (il report li separa gia': racks[] vs unracked[]).
    // Piu' libere in cima dentro ogni gruppo; prima i device in rack, poi i liberi.
    const _byFree = (a, b) => _num(b.free) - _num(a.free) || String(a && a.id).localeCompare(String(b && b.id));
    const rackDevs = [];
    for (const rack of _arr(spare.racks)) for (const d of _arr(rack.devices)) rackDevs.push(d);
    rackDevs.sort(_byFree);
    const looseDevs = _arr(spare.unracked).slice().sort(_byFree);
    const _spareItem = (group) => (d) => ({ id: d.id, meta: _num(d.free), of: _num(d.total), group });
    const freePortItems = rackDevs.map(_spareItem('rack')).concat(looseDevs.map(_spareItem('loose')));

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

    // Indirizzi LIBERI per subnet = host utilizzabili del prefisso meno gli IP
    // occupati. Prima la riga mostrava gli USATI (deviceCount) sotto l'etichetta
    // «liberi»: misura giusta, etichetta sbagliata (rilevato 2026-07-24). Il /24
    // e' assunto (lo stesso di deriveProjectNetworks) → prov 'derived', e il
    // verdetto lo dichiara. Occupati = IP distinti nella subnet (fallback deviceCount).
    const _freeOf = (net) => {
      const used = _arr(net && net.ips).length || _num(net && net.deviceCount);
      return Math.max(0, _usableHosts(net && (net.cidr || net.net)) - used);
    };
    const ipFreeTotal = nets.reduce((a, x) => a + _freeOf(x), 0);

    const rows = [
      _row('freePorts', { value: freeHonest, total: _num(totals.ports), extra: { raw: free, suspect },
        // Il click mostra, per ogni device, le libere sul totale (es. 19 di 24 →
        // 5 usate), raggruppate «in rack» / «fuori rack». meta = libere, of = totali.
        items: freePortItems }),
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
        value: nets.length ? ipFreeTotal : null, total: null,
        prov: nets.length ? 'derived' : 'none',
        extra: { observedNets: nets.length },
        // meta = liberi, of = utilizzabili del prefisso (dal CIDR): il renderer
        // li mostra come «liberi di utilizzabili» (es. 234 di 254).
        items: nets.map((x) => ({ id: x.cidr || x.net, meta: _freeOf(x), of: _usableHosts(x.cidr || x.net) })),
      }),
    ];
    return {
      rows,
      health: _sectionHealth('margin', rows),
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
