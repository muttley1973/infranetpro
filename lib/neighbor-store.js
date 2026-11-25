// ============================================================
// NEIGHBOR STORE — i vicini LLDP/CDP che NON si sentono piu': righe piatte, fusione, riepilogo (pura)
// ============================================================
// Ogni Sync (nella sua fase topologia) legge dai dispositivi i vicini che dichiarano LLDP/CDP: `store._topoNeighborsCache` li tiene,
// ma si RISCRIVE a ogni giro e non ricorda quello prima. Questo modulo e' la memoria che manca: tiene, per ogni apparato, la tabella
// dei vicini che ha riferito (quando li ha sentiti la prima e l'ultima volta, e per quante letture sane di fila NON li ha sentiti), e
// dice quali sono «silenziosi». Nessuna lettura SNMP nuova, nessun cambio alla scoperta o alla fusione: si consuma una cache che c'e' gia'.
//
// ── Cosa dice, e cosa NON dice (paletti ② niente invenzioni, ④ misurato≠dichiarato) ──────────────────
//   • dice «il vicino X sulla porta Y non e' riferito dal [data], da N letture; la porta e' su». NON dice «cavo tolto» e NON dice
//     «apparato guasto»: una voce LLDP scade dopo il suo TTL e un apparato puo' tacere per mille ragioni. «Silenzio ≠ contraddizione»
//     (la stessa regola di `detectMiscabling`): e' un fatto da guardare, non un guasto;
//   • una lettura che NON e' riuscita (apparato muto, in failover, errore) non conta: i «mancati» crescono solo su letture SANE;
//   • N letture sane di fila (anti-flap, come il cavo fantasma): una voce che salta una lettura non e' sparita;
//   • se il vicino e' ancora sentito su un'altra porta dello STESSO apparato non e' sparito: si e' spostato;
//   • se la porta locale e' giu' non si ripete qui cio' che dicono gia' le porte giu' e il cavo fantasma;
//   • se un apparato smette di riferire TUTTI i suoi vicini insieme (LLDP spento, apparato riavviato) e' UN fatto, non N righe;
//   • senza una lettura precedente non c'e' niente da confrontare: il primo giro non produce mai «sparito».
// ARP: fuori di proposito. Lo stato dell'ARP (RFC 4293) lo pubblica un apparato su sei nel lab e l'IPv4 classico non ha eta'; l'ARP
// MANCANTE e' gia' il lavoro del motore di presenza. Un secondo conto direbbe due verita' sullo stesso numero.
//
// ── Forma: righe SCALARI e PIATTE, nel sidecar `history/<id>/neighbors.json` ─────────────────────────
// Come la salute (lib/health-store.js) e per la stessa ragione: e' una misura che cresce con la rete, fuori dal documento e dietro
// `historyStore`; una riga = una riga di tabella (`NEIGHBOR_COLUMNS` e' l'elenco UNICO e sara' lo schema SQL). Sul disco sono tuple.
//
// UMD-lite come le altre lib pure. Nessun DOM, nessun IO.
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./health-store.js') : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node (server, test)
  if (typeof window !== 'undefined') Object.assign(window, api);               // browser (bundle)
})(typeof self !== 'undefined' ? self : this, function (HS) {
  'use strict';

  const C = HS.healthClean;
  const NEIGHBOR_FILE_VERSION = 1;
  const NEIGHBOR_COLUMNS = ['localIf', 'proto', 'remoteId', 'remoteName', 'remotePort', 'firstAt', 'lastAt', 'misses'];
  // Quante letture SANE di fila senza sentire il vicino prima di dirlo silenzioso (come DOWN_STREAK_N del cavo fantasma).
  const NEIGHBOR_SILENCE_READS = 3;
  // I due protocolli che si leggono e DA DOVE (MIB e radice): la provenienza che ogni riga del Drift deve poter dire.
  const NEIGHBOR_PROTOCOLS = {
    LLDP: { mib: 'LLDP-MIB', oid: '1.0.8802.1.1.2.1.4.1' },
    CDP:  { mib: 'CISCO-CDP-MIB', oid: '1.3.6.1.4.1.9.9.23.1.2.1' },
  };
  const MAX_ROWS_PER_NODE = 512;
  const MAX_NODES_PER_PUT = 1000;
  const MAX_NODES_IN_FILE = 5000;
  const MAX_MISSES = 1000000;
  const MAX_AGE_MS = 90 * 24 * 3600 * 1000;   // un vicino non sentito da 90 giorni non e' piu' una domanda: cade

  const _text = (v) => C.name(v);
  const _lower = (v) => _text(v).toLowerCase();

  // Un vicino come lo tiene la cache di sessione (`{localPort, remoteDevice, remotePort, remoteMac, remoteIP, protocol}`) → la forma
  // che si salva. L'IDENTITA' del vicino e' il suo MAC (chassis) se c'e', altrimenti il nome che dichiara, altrimenti il suo IP:
  // il nome puo' cambiare, il MAC no. Senza nessuno dei tre non si sa CHI sia e non lo si registra (non si inventa una riga).
  function neighborObserved(nb) {
    if (!nb || typeof nb !== 'object') return null;
    const proto = String(nb.protocol || '').toUpperCase();
    if (!NEIGHBOR_PROTOCOLS[proto]) return null;
    const localIf = _text(nb.localPort);
    if (!localIf) return null;
    const remoteId = _lower(nb.remoteMac) || _lower(nb.remoteDevice) || _lower(nb.remoteIP);
    if (!remoteId) return null;
    return { localIf, proto, remoteId, remoteName: _text(nb.remoteDevice), remotePort: _text(nb.remotePort) };
  }
  // La chiave di una riga: porta locale + protocollo + chi + porta remota. La porta remota ne fa parte: lo STESSO apparato puo' comparire
  // due volte sulla stessa porta locale con due porte remote diverse (sotto-interfacce), e sono due voci, non una.
  function neighborKey(r) { return [r.localIf, r.proto, r.remoteId, r.remotePort].map(x => String(x).toLowerCase()).join('|'); }

  function _row(r) {
    if (!r || typeof r !== 'object') return null;
    const proto = String(r.proto || '').toUpperCase();
    const localIf = _text(r.localIf), remoteId = _lower(r.remoteId);
    if (!NEIGHBOR_PROTOCOLS[proto] || !localIf || !remoteId) return null;
    const lastAt = C.int(r.lastAt, 1, Number.MAX_SAFE_INTEGER);
    const firstAt = C.int(r.firstAt, 1, Number.MAX_SAFE_INTEGER);
    if (lastAt === null || firstAt === null) return null;
    return { localIf, proto, remoteId, remoteName: _text(r.remoteName), remotePort: _text(r.remotePort), firstAt, lastAt, misses: C.int(r.misses, 0, MAX_MISSES) || 0 };
  }

  // ── Codifica sul disco ───────────────────────────────────────────────────────────────────
  function _encode(slot) { return { at: slot.at, r: slot.rows.map(row => NEIGHBOR_COLUMNS.map(c => row[c])) }; }
  function _decode(enc) {
    if (!enc || typeof enc !== 'object' || !Array.isArray(enc.r)) return null;
    const at = C.int(enc.at, 1, Number.MAX_SAFE_INTEGER);
    if (at === null) return null;
    const rows = [];
    for (const tup of enc.r) {
      if (!Array.isArray(tup)) continue;
      const o = {};
      NEIGHBOR_COLUMNS.forEach((c, i) => { o[c] = tup[i] === undefined ? null : tup[i]; });
      const row = _row(o);
      if (row) rows.push(row);
    }
    return { at, rows };
  }

  // ── La PUT: «questo apparato, a questo istante, con una lettura SANA, ha riferito questi vicini» ────────────
  function neighborSanitizePut(body) {
    const out = { nodes: {} };
    const src = body && typeof body === 'object' && body.nodes && typeof body.nodes === 'object' ? body.nodes : {};
    let n = 0;
    for (const id of Object.keys(src)) {
      if (n >= MAX_NODES_PER_PUT) break;
      if (!C.ID_RE.test(id)) continue;
      const e = src[id];
      const at = e && typeof e === 'object' ? C.int(e.at, 1, Number.MAX_SAFE_INTEGER) : null;
      if (at === null || !Array.isArray(e.neighbors)) continue;   // senza istante o senza elenco (anche vuoto) non e' una lettura
      const list = [], seen = new Set();
      for (const nb of e.neighbors) {
        if (list.length >= MAX_ROWS_PER_NODE) break;
        const o = neighborObserved(nb);
        if (!o) continue;
        const k = neighborKey(o);
        if (seen.has(k)) continue;   // la stessa voce due volte nella stessa lettura e' una voce
        seen.add(k); list.push(o);
      }
      out.nodes[id] = { at, neighbors: list };
      n++;
    }
    return out;
  }

  // ── La fusione ───────────────────────────────────────────────────────────────────────────
  // Per ogni apparato della PUT: chi e' riferito si aggiorna (`lastAt`, mancati a 0); chi era noto e ORA non e' riferito prende un
  // mancato in piu'. Idempotente: la stessa lettura (o una piu' vecchia) non conta due volte — altrimenti rimandarla farebbe
  // «sparire» un vicino. Un apparato NON presente nella PUT non si tocca: una lettura non riuscita non e' un silenzio.
  function neighborFold(file, put, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const out = { v: NEIGHBOR_FILE_VERSION, nodes: {} };
    const old = file && typeof file === 'object' && file.nodes && typeof file.nodes === 'object' ? file.nodes : {};
    for (const id of Object.keys(old)) {
      if (!C.ID_RE.test(id)) continue;
      const slot = _decode(old[id]);
      if (!slot) continue;
      slot.rows = slot.rows.filter(r => now - r.lastAt <= MAX_AGE_MS);
      if (slot.rows.length || now - slot.at <= MAX_AGE_MS) out.nodes[id] = slot;
    }
    const inc = put && put.nodes ? put.nodes : {};
    for (const id of Object.keys(inc)) {
      const read = inc[id];
      const slot = out.nodes[id];
      if (slot && read.at <= slot.at) continue;   // stessa lettura o piu' vecchia
      const prev = new Map((slot ? slot.rows : []).map(r => [neighborKey(r), r]));
      const seen = new Set();
      const rows = [];
      for (const o of read.neighbors) {
        const k = neighborKey(o);
        seen.add(k);
        const p = prev.get(k);
        rows.push(p ? Object.assign({}, p, { remoteName: o.remoteName || p.remoteName, lastAt: read.at, misses: 0 })
                    : Object.assign({}, o, { firstAt: read.at, lastAt: read.at, misses: 0 }));
      }
      for (const [k, p] of prev) if (!seen.has(k)) rows.push(Object.assign({}, p, { misses: Math.min(p.misses + 1, MAX_MISSES) }));
      // tetto: restano prima i sentiti adesso, poi i piu' recenti
      rows.sort((a, b) => (a.misses === 0 ? 0 : 1) - (b.misses === 0 ? 0 : 1) || b.lastAt - a.lastAt);
      out.nodes[id] = { at: read.at, rows: rows.slice(0, MAX_ROWS_PER_NODE).filter(r => now - r.lastAt <= MAX_AGE_MS) };
    }
    const ids = Object.keys(out.nodes);
    if (ids.length > MAX_NODES_IN_FILE) {
      ids.sort((a, b) => out.nodes[b].at - out.nodes[a].at);
      for (const id of ids.slice(MAX_NODES_IN_FILE)) delete out.nodes[id];
    }
    // sul disco: tuple
    const enc = { v: NEIGHBOR_FILE_VERSION, nodes: {} };
    for (const id of Object.keys(out.nodes)) enc.nodes[id] = _encode(out.nodes[id]);
    return enc;
  }

  // File (dal disco) → { id: { at, rows } } con le righe in oggetti. Tollera qualunque cosa.
  function neighborDecodeFile(file) {
    const out = {};
    const nodes = file && typeof file === 'object' && file.nodes && typeof file.nodes === 'object' ? file.nodes : {};
    for (const id of Object.keys(nodes)) {
      if (!C.ID_RE.test(id)) continue;
      const slot = _decode(nodes[id]);
      if (slot) out[id] = slot;
    }
    return out;
  }
  // Le righe PIATTE (apparato in ogni riga): la tabella che un database avrebbe.
  function neighborFlatRows(file) {
    const rows = [];
    const dec = neighborDecodeFile(file);
    for (const node of Object.keys(dec)) for (const r of dec[node].rows) rows.push(Object.assign({ node, readAt: dec[node].at }, r));
    return rows;
  }

  // ── Il riepilogo di UN apparato ──────────────────────────────────────────────────────────
  // opts.silence = quante letture di fila (default NEIGHBOR_SILENCE_READS); opts.portState(localIf) = 'up' | 'down' | null (non si sa).
  // Ritorna { at, present, deviceSilent, silentCount, groups:[{localIf, remoteId, remoteName, protos, ports, firstAt, lastAt, misses, portState}], counts }.
  // I gruppi sono per (porta locale, vicino): lo stesso vicino riferito da LLDP E da CDP, o con piu' porte remote, e' UNA riga.
  function neighborSummarize(slot, opts) {
    const o = opts || {};
    const silence = Number.isFinite(o.silence) && o.silence >= 1 ? o.silence : NEIGHBOR_SILENCE_READS;
    const out = { at: slot ? slot.at : null, present: 0, deviceSilent: false, silentCount: 0, lastHeardAt: null, groups: [], counts: { present: 0, silent: 0, stillHeard: 0, linkDown: 0 } };
    if (!slot || !Array.isArray(slot.rows) || !slot.rows.length) return out;
    const rows = slot.rows;
    const heard = rows.filter(r => r.misses === 0);
    out.present = out.counts.present = heard.length;
    const silent = rows.filter(r => r.misses >= silence);
    out.counts.silent = silent.length;
    // Tutti i vicini noti zitti insieme: l'apparato non riferisce piu' vicini (LLDP spento, apparato riavviato). UN fatto.
    if (silent.length > 0 && silent.length === rows.length) {
      out.deviceSilent = true;
      out.silentCount = silent.length;
      out.lastHeardAt = Math.max(...silent.map(r => r.lastAt));
      return out;
    }
    const heardIds = new Set(heard.map(r => r.remoteId));
    const by = new Map();
    for (const r of silent) {
      if (heardIds.has(r.remoteId)) { out.counts.stillHeard++; continue; }   // lo sente ancora (un'altra porta, un altro protocollo)
      const ps = typeof o.portState === 'function' ? o.portState(r.localIf) : null;
      if (ps === 'down') { out.counts.linkDown++; continue; }                // la porta e' giu': lo dicono gia' le porte giu' e il cavo fantasma
      const k = `${r.localIf.toLowerCase()}|${r.remoteId}`;
      let g = by.get(k);
      if (!g) { g = { localIf: r.localIf, remoteId: r.remoteId, remoteName: r.remoteName, protos: [], ports: [], firstAt: r.firstAt, lastAt: r.lastAt, misses: r.misses, portState: ps === 'up' ? 'up' : 'unknown' }; by.set(k, g); }
      if (!g.protos.includes(r.proto)) g.protos.push(r.proto);
      if (r.remotePort && !g.ports.includes(r.remotePort)) g.ports.push(r.remotePort);
      if (!g.remoteName && r.remoteName) g.remoteName = r.remoteName;
      g.firstAt = Math.min(g.firstAt, r.firstAt); g.lastAt = Math.max(g.lastAt, r.lastAt); g.misses = Math.min(g.misses, r.misses);
    }
    out.groups = [...by.values()].sort((a, b) => b.lastAt - a.lastAt || a.localIf.localeCompare(b.localIf));
    return out;
  }

  return {
    NEIGHBOR_FILE_VERSION, NEIGHBOR_COLUMNS, NEIGHBOR_SILENCE_READS, NEIGHBOR_PROTOCOLS,
    neighborObserved, neighborKey, neighborSanitizePut, neighborFold, neighborDecodeFile, neighborFlatRows, neighborSummarize,
  };
});
