// ============================================================
// HOST-MERGE — N righe di scansione, UN apparato fisico (puro)
// ============================================================
// Un solo box con piu' NIC compare nello scan come N righe (una per IP che
// risponde, ognuna col SUO MAC). Questo pre-pass le fonde in un apparato solo,
// ma SOLO su chiavi AUTOREVOLI (campi MIB/mDNS standard), mai su indizi deboli.
//
// L'asse e' l'OPPOSTO del multihoming (UN MAC / molti IP, il drift macAtIps):
// qui e' MOLTI MAC / UN telaio. La chiave own-ip e' la vista a livello-apparato
// della stessa realta' che il motore di drift vede per-MAC (un soprainsieme,
// non una definizione rivale). Chiavi che fondono, in quest'ordine:
//   1 own-ip     l'ip di B e' nella ipAddressTable di A (IP-MIB, RFC 4293/1213)
//   2 serial     stesso entPhysicalSerialNum non vuoto (trim+case, come identity-reconcile)
//   3 engine-id  stesso snmpEngineID non vuoto
//   4 mdns-uuid  stesso UUID mDNS/SSDP (usn) non vuoto
//
// CORREZIONI GUIDATE DALLA STORIA (verificate contro il passato di InfraNet):
//   * MAI chiave sysName: un nome condiviso non e' un'identita' (lezione del
//     nome-corto-ambiguo, matchNodeByIdent). Nessuna chiave => righe separate.
//   * Il MAC non e' MAI una chiave qui (due NIC differiscono) — quindi questa
//     funzione non puo' riaprire il bug del MAC-next-hop condiviso (5707265):
//     quella guardia resta in _discFindExistingDevice, a valle di questo pre-pass.
//   * sysObjectID / sysDescr sono livello-MODELLO (box identici li condividono)
//     => mai una chiave.
//   * VETO DURO: due righe non si fondono mai se entrambi i serial (o entrambi
//     gli engineId) sono non vuoti e DIVERSI — il serial e' il discriminante
//     (identity-drift). Applicato ALL'ARCO, cosi' nessuna coppia contraddittoria
//     entra nel componente.
//   * Un componente che comunque accumula >=2 serial/engineId distinti non vuoti
//     (arrivati per TRANSITIVITA', non da un arco diretto) e' contraddittorio:
//     in dubbio ci si separa (nessun merge inventato).
//   * Confronti CANONICI: addrKey per gli IP, mai === grezzo.
//
// Puro: nessun DOM, nessun IO, nessuno store/window.

(function (root, factory) {
  const deps = (typeof module !== 'undefined' && module.exports)
    ? { cidr: require('./cidr.js') }
    : { cidr: root };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // Browser: cidr.js e' gia' uno <script> classico che auto-espone addrKey su
  // window; qui non serve esporre nulla di piu' del proprio api.
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  // Precedenza del mergeKey da riportare quando un componente e' nato da archi di
  // tipo diverso (es. own-ip + serial). Tutte autorevoli; l'ordine e' solo per
  // dare UN nome stabile alla fusione.
  const KEY_ORDER = ['own-ip', 'serial', 'engine-id', 'mdns-uuid'];

  function _arr(v) { return Array.isArray(v) ? v : []; }
  function _norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  function _addrKey(v) {
    const f = deps.cidr && deps.cidr.addrKey;
    if (typeof f === 'function') return f(v);
    return _norm(v);                      // degrado prudente se cidr.js manca
  }

  // Gli IP PROPRI di una riga (la sua ipAddressTable), canonicalizzati.
  function _ownIpSet(row) {
    const s = new Set();
    for (const ip of _arr(row && row.ownIps)) { const k = _addrKey(ip); if (k) s.add(k); }
    return s;
  }

  // Due valori d'identita' entrambi presenti e diversi = contraddizione.
  function _conflict(a, b) {
    const x = _norm(a), y = _norm(b);
    return x !== '' && y !== '' && x !== y;
  }
  function _hardConflict(A, B) {
    return _conflict(A.serialNumber, B.serialNumber) || _conflict(A.engineId, B.engineId);
  }

  // La chiave autorevole (in KEY_ORDER) che lega A e B, o '' se nessuna.
  function _edgeKey(A, B, ownA, ownB) {
    const ipA = _addrKey(A.ip), ipB = _addrKey(B.ip);
    if ((ipB && ownA.has(ipB)) || (ipA && ownB.has(ipA))) return 'own-ip';
    const sA = _norm(A.serialNumber); if (sA && sA === _norm(B.serialNumber)) return 'serial';
    const eA = _norm(A.engineId);     if (eA && eA === _norm(B.engineId))     return 'engine-id';
    const uA = _norm(A.usn);          if (uA && uA === _norm(B.usn))          return 'mdns-uuid';
    return '';
  }

  function _distinct(members, field) {
    const s = new Set();
    for (const m of members) { const v = _norm(m[field]); if (v) s.add(v); }
    return s;
  }
  function _incoherent(members) {
    return _distinct(members, 'serialNumber').size > 1 || _distinct(members, 'engineId').size > 1;
  }

  // Il capofila del gruppo: un responder SNMP e' un capo migliore di una NIC muta;
  // a parita' si tiene il primo in ordine d'ingresso (indice piu' basso).
  function _pickPrimary(members) {
    let best = members[0];
    for (const m of members) { if (!best.snmpReachable && m.snmpReachable) best = m; }
    return best;
  }

  function _singleton(row) {
    return { primary: row, members: [row], nics: [], mergeConfidence: null, mergeKey: null };
  }

  // rows: [{ ip, mac, hostname, snmpReachable, objectId, serialNumber, engineId, usn, ownIps }, ...]
  // -> { groups: [{ primary, members, nics:[{ip,mac}], mergeConfidence, mergeKey }] }
  function mergeSameChassis(rows /* , opts */) {
    const list = _arr(rows);
    const n = list.length;
    const own = list.map(_ownIpSet);

    // union-find con path-halving
    const parent = list.map((_, i) => i);
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function union(i, j) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }

    const pairKeys = [];                                   // {i, key} per il mergeKey del gruppo
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (_hardConflict(list[i], list[j])) continue;     // veto duro: nessun arco
        const key = _edgeKey(list[i], list[j], own[i], own[j]);
        if (!key) continue;
        union(i, j);
        pairKeys.push({ i, key });
      }
    }

    const byRoot = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(i);                               // indici in ordine crescente
    }
    const keysByRoot = new Map();
    for (const { i, key } of pairKeys) {
      const r = find(i);
      if (!keysByRoot.has(r)) keysByRoot.set(r, new Set());
      keysByRoot.get(r).add(key);
    }

    const groups = [];
    for (const [root, idxs] of byRoot) {
      const members = idxs.map(k => list[k]);
      if (members.length === 1) { groups.push(_singleton(members[0])); continue; }
      if (_incoherent(members)) {                          // contraddizione per transitivita' -> separati
        for (const m of members) groups.push(_singleton(m));
        continue;
      }
      const primary = _pickPrimary(members);
      const nics = members.filter(m => m !== primary).map(m => ({ ip: m.ip, mac: m.mac || '' }));
      const keys = keysByRoot.get(root) || new Set();
      const mergeKey = KEY_ORDER.find(k => keys.has(k)) || null;
      groups.push({ primary, members, nics, mergeConfidence: 'authoritative', mergeKey });
    }
    return { groups };
  }

  // Riduce le righe di scansione per la UI: ogni gruppo autorevole -> UNA riga (il
  // primario) che porta _foldedRows (le NIC fuse, righe INTERE per poterle poi
  // ri-dividere) e _mergeKey; i singoletti passano invariati, ordine preservato.
  // E' la vista di discovery della stessa fusione: la tabella mostra un badge e sa
  // annullarla (reversibile). NON e' un secondo motore: chiama mergeSameChassis.
  function foldScanRows(rows) {
    const list = _arr(rows);
    const out = [];
    let folds = 0;
    const groups = (mergeSameChassis(list).groups) || [];
    for (const g of groups) {
      const p = g.primary;
      const folded = (g.members || []).filter(m => m !== p);
      if (g.mergeConfidence === 'authoritative' && folded.length) {
        p._foldedRows = folded;
        p._mergeKey = g.mergeKey;
        folds++;
      }
      out.push(p);
    }
    return { rows: out, folds };
  }

  return { mergeSameChassis, foldScanRows };
});
