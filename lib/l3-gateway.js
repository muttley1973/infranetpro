// ============================================================
// L3 GATEWAY (lite) — chi instrada ogni RETE (report puro)
// ============================================================
// Promuove il "gateway" da semplice stringa IP (IPAM-lite) a RELAZIONE rete →
// device che la instrada. Funzione PURA, sola lettura, manual-first: l'aggancio
// automatico per IP e' solo un SUGGERIMENTO, la scelta esplicita (gatewayNodeId)
// vince sempre e non viene mai sovrascritta.
//
// UNA RIGA PER PREFISSO, non per VLAN. Fino alla 2.8.x il report ciclava le VLAN
// e leggeva il loro prefisso PRINCIPALE (`primaryPrefixForVlan` = il primo IPv4):
// due categorie di reti non arrivavano mai al report, e nessuno le verificava.
//   • il secondo prefisso di una VLAN dual-stack — cioe' TUTTI i gateway IPv6:
//     una VLAN con 192.168.20.0/24 e 2001:db8:0:20::/64 dichiarava «1 rete,
//     nessun problema» mentre il gateway v6 non lo guardava nessuno;
//   • le reti senza VLAN, che su un NetBox vero sono la maggioranza del piano
//     (51 prefissi su 90 misurati) e che una vista per-VLAN non puo' raggiungere.
// Il prefisso e' l'autorita' (v. lib/ipam-model.js) e questo report ne segue la
// forma. Una VLAN senza alcuna rete resta comunque in elenco, con la rete vuota:
// farla sparire da un report che prima la elencava sarebbe una perdita muta.
//
// Resta PER-VLAN una cosa sola, perche' per-VLAN lo e' davvero: il legame con
// l'interfaccia SVI del router (`gatewayNodeId`). Una VLAN dual-stack ha DUE
// indirizzi di gateway ma UNA sola SVI, quindi il binding esplicito vale per
// tutti i prefissi di quella VLAN. Da qui `byVlan`, la vista per-VLAN DERIVATA
// dalle righe (non un secondo posto dove il dato vive) per i lettori che sono
// per-VLAN per natura: la card VLAN del pannello Proprieta'.
//
// INPUT  model = {
//   prefixes:  [ { cidr, vlan, gateway, dns, name } ],  // l'AUTORITA' (ipam.prefixes[])
//   vlans:     [ { vid, name, color } ],                // palette: nome/colore + le VLAN senza rete
//   ipamByVid: { '<vid>': { gatewayNodeId } },          // cio' che e' davvero per-VLAN
//   nodes:     [ { id, name, ip, ip6, type } ],         // tutti i nodi (per la risoluzione)
//   usageByCidr: { '<cidr>': <numero IP usati> },        // opzionale (riepilogo IPAM), chiave = il cidr COME DICHIARATO
//   parseCidr:   fn(cidr) -> info|null,                  // iniettato (lib/cidr.js _parseCidrInfo)
//   ipInCidr:    fn(ip, info) -> bool,                   // iniettato (lib/cidr.js _ipInCidr)
//   compareCidr: fn(infoA, infoB) -> number              // opzionale, iniettato (lib/ipam-audit.js)
// }
//
// STATO per riga:
//   'bound'  → device scelto a mano sulla VLAN (gatewayNodeId) e trovato
//   'auto'   → nessuna scelta esplicita, ma il gateway IP combacia con un device
//   'orphan' → c'e' un gateway IP ma non corrisponde a nessun device documentato
//              (oppure il binding esplicito punta a un device cancellato)
//   'none'   → nessun gateway configurato
//
// OUTPUT { rows[], byVlan{}, l3NodeIds[], l3Devices[], totals }
(function (root, factory) {
  // `cidrLib` = lib/cidr.js: in Node via require, nel browser e' uno <script>
  // caricato PRIMA di questo (v. netmapper.html), quindi si legge da root. Da li'
  // arrivano `addrKey` (identita' di un indirizzo: v4 esatto, v6 canonico) e
  // `addrFamily` — una definizione sola, condivisa con lib/ipam-audit.js. Lettura
  // a CALL-TIME: se mancassero, il confronto fra indirizzi v6 degrada al testo
  // minuscolo — nessun aggancio inventato, al massimo uno mancato.
  const cidrLib = (typeof module !== 'undefined' && module.exports) ? require('./cidr.js') : root;
  const api = factory(cidrLib);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (cidrLib) {
  'use strict';

  function _str(x) { return String(x == null ? '' : x).trim(); }

  function _intToIp(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  function _addrFamily(addr) {
    const f = cidrLib && cidrLib.addrFamily;
    return typeof f === 'function' ? f(addr) : null;
  }

  function _addrKey(addr) {
    const f = cidrLib && cidrLib.addrKey;
    if (typeof f === 'function') return f(addr);
    return _str(addr).toLowerCase();
  }

  // Quale device DOCUMENTATO risponde a un indirizzo. Esportata perche' la stessa
  // domanda la fa anche il pannello, accanto all'indirizzo del gateway: due
  // implementazioni della stessa ricerca divergerebbero alla prima modifica di
  // «qual e' l'IP di un device».
  // Guarda l'IPv4 E l'IPv6 del nodo: un device dual-stack e' lo stesso apparato da
  // tutte e due le parti, e cercarlo solo per IPv4 rendeva ogni gateway v6 «orfano».
  function findNodeByIp(nodes, ip) {
    const want = _addrKey(ip);
    if (!want) return null;
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      if (_addrKey(n.ip) === want) return n;
      if (_addrKey(n.ip6) === want) return n;
    }
    return null;
  }

  // Ordine di lettura del piano: lo SPAZIO DEGLI INDIRIZZI (stessa regola
  // dell'elenco «Reti» e delle coppie in conflitto — `compareCidr` iniettato), e
  // in coda le VLAN che una rete non ce l'hanno, per numero. Senza comparatore si
  // ripiega sulla stringa: un ordine qualsiasi ma STABILE, mai righe che ballano
  // fra due letture.
  function _sortRows(rows, compareCidr) {
    const cmp = typeof compareCidr === 'function' ? compareCidr : null;
    return rows.sort((a, b) => {
      if (!a.cidr || !b.cidr) {
        if (a.cidr || b.cidr) return a.cidr ? -1 : 1;      // le reti prima, le VLAN nude dopo
        return (a.vid == null ? 0 : a.vid) - (b.vid == null ? 0 : b.vid);
      }
      if (cmp && a._info && b._info) {
        const d = cmp(a._info, b._info);
        if (d) return d;
      }
      return String(a.cidr).localeCompare(String(b.cidr));
    });
  }

  function buildL3Report(model) {
    model = model || {};
    const prefixes = Array.isArray(model.prefixes) ? model.prefixes.filter(Boolean) : [];
    const vlans = Array.isArray(model.vlans) ? model.vlans : [];
    const ipamByVid = model.ipamByVid || {};
    const nodes = Array.isArray(model.nodes) ? model.nodes : [];
    const usageByCidr = model.usageByCidr || {};
    const parseCidr = typeof model.parseCidr === 'function' ? model.parseCidr : () => null;
    const ipInCidr = typeof model.ipInCidr === 'function' ? model.ipInCidr : () => true;

    const nodesById = new Map();
    for (const n of nodes) nodesById.set(String(n.id), n);

    // Nome e colore della VLAN, dalla palette. Una VLAN citata da un prefisso ma
    // fuori palette non ha colore: e' un fatto, non un difetto da riempire.
    const vlanMeta = new Map();
    for (const v of vlans) {
      const vid = +v.vid;
      if (!Number.isFinite(vid)) continue;
      vlanMeta.set(vid, { name: _str(v.name), color: _str(v.color) });
    }

    // `+null === 0`: il null va escluso PRIMA della conversione numerica, o una
    // rete senza VLAN diventa «VLAN 0».
    const _vidOf = (p) => (p.vlan == null || !Number.isFinite(+p.vlan)) ? null : +p.vlan;

    const rows = [];
    const withNet = new Set();          // le VLAN che almeno una rete ce l'hanno
    const _addRow = (row) => { rows.push(row); };

    for (const p of prefixes) {
      const cidr = _str(p.cidr);
      if (!cidr) continue;                            // un prefisso senza indirizzo non e' una rete
      const vid = _vidOf(p);
      if (vid != null) withNet.add(vid);
      const meta = (vid != null && vlanMeta.get(vid)) || { name: '', color: '' };
      const entry = (vid != null && ipamByVid[String(vid)]) || {};
      const gateway = _str(p.gateway);
      const dns = _str(p.dns);
      const explicitId = entry.gatewayNodeId ? String(entry.gatewayNodeId) : '';

      const info = parseCidr(cidr);
      const cidrValid = !!info;

      // Risoluzione device: esplicito vince. L'auto-match per IP scatta SOLO se
      // non c'e' alcun binding esplicito: un binding stantio (device cancellato)
      // resta un problema da mostrare, non lo rimpiazziamo in silenzio.
      const explicitNode = explicitId ? (nodesById.get(explicitId) || null) : null;
      const autoNode = (!explicitId && gateway) ? findNodeByIp(nodes, gateway) : null;
      const node = explicitNode || autoNode;

      let status;
      if (explicitNode) status = 'bound';
      else if (autoNode) status = 'auto';
      else if (gateway || explicitId) status = 'orphan';   // IP scritto o binding stantio, ma nessun device
      else status = 'none';

      // Famiglia PRIMA del contenimento: un gateway IPv4 su una rete IPv6 non e'
      // «fuori dalla subnet» (che si corregge cambiando l'ultimo ottetto), e'
      // l'indirizzo sbagliato nel campo sbagliato.
      const gwFamily = gateway ? _addrFamily(gateway) : null;
      const familyMismatch = !!(gateway && info && gwFamily && gwFamily !== info.family);
      const inSubnet = (gateway && info && !familyMismatch) ? !!ipInCidr(gateway, info) : true;
      // Il gateway non puo' essere il network o il broadcast address (eccetto /31 e
      // /32, dove gli estremi sono host validi — RFC 3021). Solo IPv4: su IPv6 non
      // esiste un broadcast e `network`/`broadcast` sull'oggetto v6 non esistono
      // proprio (v. lib/cidr.js). Prima il caso v6 era escluso per COINCIDENZA —
      // l'aritmetica su campi assenti dava "0.0.0.0", che nessuno scrive come
      // gateway — ed e' esattamente il tipo di guardia che smette di funzionare
      // appena qualcuno tocca il parser.
      const gwReserved = !!(gateway && info && info.family === 4 && inSubnet && info.prefix <= 30 &&
        (gateway === _intToIp(info.network) || gateway === _intToIp(info.broadcast)));

      const warnings = [];
      if (!gateway) warnings.push('noGateway');
      if (!cidrValid) warnings.push('invalidCidr');
      if (explicitId && !explicitNode) warnings.push('staleBinding');
      else if (gateway && !node) warnings.push('orphanGateway');
      if (familyMismatch) warnings.push('gatewayFamilyMismatch');
      else if (gateway && info && !inSubnet) warnings.push('gatewayOutOfSubnet');
      if (gwReserved) warnings.push('gatewayReserved');

      _addRow({
        cidr,
        family: info ? info.family : null,
        vid,
        // Il nome della RETE se c'e' (il DCIM lo porta), altrimenti quello della
        // VLAN: due prefissi della stessa VLAN che si chiamassero uguale non si
        // distinguerebbero, e il nome proprio della rete e' il piu' specifico.
        name: _str(p.name) || meta.name,
        color: meta.color,
        cidrValid,
        gateway,
        dns,
        status,
        nodeId: node ? node.id : null,
        nodeName: node ? (node.name || node.id) : null,
        inSubnet,
        usedCount: +usageByCidr[cidr] || 0,
        warnings,
        _info: info,
      });
    }

    // Le VLAN che una rete non ce l'hanno: restano in elenco, dichiarate come tali.
    // Non hanno un gateway da verificare (l'indirizzo sta sul prefisso), quindi
    // nemmeno un `noGateway`: non manca il gateway, manca la rete.
    for (const v of vlans) {
      const vid = +v.vid;
      if (!Number.isFinite(vid) || withNet.has(vid)) continue;
      const meta = vlanMeta.get(vid) || { name: '', color: '' };
      const entry = ipamByVid[String(vid)] || {};
      const explicitId = entry.gatewayNodeId ? String(entry.gatewayNodeId) : '';
      const explicitNode = explicitId ? (nodesById.get(explicitId) || null) : null;
      const warnings = [];
      if (explicitId && !explicitNode) warnings.push('staleBinding');
      _addRow({
        cidr: '', family: null, vid,
        name: meta.name, color: meta.color,
        cidrValid: true, gateway: '', dns: '',
        status: explicitNode ? 'bound' : (explicitId ? 'orphan' : 'none'),
        nodeId: explicitNode ? explicitNode.id : null,
        nodeName: explicitNode ? (explicitNode.name || explicitNode.id) : null,
        inSubnet: true,
        usedCount: 0,
        warnings,
        _info: null,
      });
    }

    _sortRows(rows, model.compareCidr);
    for (const r of rows) delete r._info;             // il parsato era per l'ordinamento, non e' output

    // I device che instradano, raccolti DOPO l'ordinamento: le reti sotto ogni
    // apparato escono nello stesso ordine del report, non in quello in cui i
    // prefissi capitavano nel file.
    // nodeId → { id, name, nets:[ {vid,cidr,name,gateway} ] }
    const l3Map = new Map();
    for (const r of rows) {
      if (r.nodeId == null) continue;
      const key = String(r.nodeId);
      if (!l3Map.has(key)) l3Map.set(key, { id: r.nodeId, name: r.nodeName || String(r.nodeId), nets: [] });
      l3Map.get(key).nets.push({ vid: r.vid, cidr: r.cidr, name: r.name, gateway: r.gateway });
    }

    // Vista per-VLAN DERIVATA: una VLAN ha UNA sola SVI anche quando porta due
    // indirizzi, quindi «chi instrada la VLAN» e' una domanda sola. Lo stato e' il
    // MIGLIORE fra le sue reti (un binding esplicito vale per tutte; un solo
    // aggancio automatico basta a dire che qualcuno la instrada), e l'indirizzo
    // citato e' quello che l'aggancio l'ha prodotto — o la riga affermerebbe un
    // legame senza dire da dove viene.
    const RANK = { bound: 3, auto: 2, orphan: 1, none: 0 };
    const byVlan = {};
    for (const r of rows) {
      if (r.vid == null) continue;
      const k = String(r.vid);
      const cur = byVlan[k];
      if (!cur) {
        byVlan[k] = {
          vid: r.vid, name: r.name, color: r.color,
          status: r.status, nodeId: r.nodeId, nodeName: r.nodeName,
          gateway: r.gateway, warnings: r.warnings.slice(), nets: r.cidr ? [r.cidr] : [],
        };
        continue;
      }
      if (r.cidr) cur.nets.push(r.cidr);
      for (const w of r.warnings) if (!cur.warnings.includes(w)) cur.warnings.push(w);
      if (RANK[r.status] > RANK[cur.status]) {
        cur.status = r.status; cur.nodeId = r.nodeId; cur.nodeName = r.nodeName; cur.gateway = r.gateway;
      }
    }

    const l3Devices = [...l3Map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const l3NodeIds = l3Devices.map(d => d.id);

    const netRows = rows.filter(r => !!r.cidr);
    const has = (r, w) => r.warnings.includes(w);
    const totals = {
      nets: netRows.length,
      vlans: Object.keys(byVlan).length,
      withGateway: netRows.filter(r => r.nodeId).length,
      orphan: netRows.filter(r => has(r, 'orphanGateway') || has(r, 'staleBinding')).length,
      noGateway: netRows.filter(r => has(r, 'noGateway')).length,
      outOfSubnet: netRows.filter(r => has(r, 'gatewayOutOfSubnet')).length,
      familyMismatch: netRows.filter(r => has(r, 'gatewayFamilyMismatch')).length,
      reservedGateway: netRows.filter(r => has(r, 'gatewayReserved')).length,
      l3Devices: l3Devices.length,
    };

    return { rows, byVlan, l3NodeIds, l3Devices, totals };
  }

  return { buildL3Report, findNodeByIp };
});
