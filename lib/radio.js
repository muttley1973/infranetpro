// ============================================================
// RADIO — logica PURA delle interfacce radio (Wi-Fi) di un device.
//
// Un device può esporre fino a 8 interfacce radio. Ogni radio è un endpoint
// di connessione POLIMORFICO: il tipo di link emerge dagli estremi —
//   radio ↔ radio          → associazione WIRELESS (onda)
//   radio ↔ porta di rete  → CAVO normale
// (prima bastava un solo capo radio per forzare wireless: ora servono ENTRAMBI).
//
// Pid stabile (back-compat con i link salvati): la radio #0 mantiene il pid
// storico `${id}-radio`; le successive sono `${id}-radio2` … `${id}-radio8`.
//
// Layout perimetrale: 8 ancore attorno al tile — prima i 4 angoli, poi i 4
// centri-lato: ['tr','tl','br','bl','tc','bc','lc','rc'].
//
// Condivisa browser + test (UMD-lite). Niente DOM, niente globali: solo dati.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_RADIOS = 8;
  // Ordine di assegnazione delle ancore: 4 angoli, poi 4 centri-lato.
  const ANCHOR_ORDER = ['tr', 'tl', 'br', 'bl', 'tc', 'bc', 'lc', 'rc'];
  // Campi di configurazione di una singola radio (oltre a id/label). Usato dalla
  // migrazione legacy wifiCfg→radio; `ssid`/`security` poi scendono nei BSS.
  const RADIO_CFG_FIELDS = ['ssid', 'band', 'channel', 'security', 'standard'];
  // Modello a DUE LIVELLI (come un AP reale):
  //   radios[i]        = radio FISICA → campi PHY (banda/canale/standard, è l'ancora)
  //   radios[i].ssids[] = lista di BSS LOGICI {id,ssid,vlan,security} (multi-SSID)
  // Una radio fisica trasmette molti SSID; il client si associa a UN BSS (link.bss).
  const RADIO_PHYS_FIELDS = ['label', 'band', 'channel', 'standard', 'bx', 'by'];
  const SSID_FIELDS = ['ssid', 'vlan', 'security'];

  // id BSS stabile (sopravvive a riordini/cancellazioni: il link lo referenzia).
  let _ssidSeq = 0;
  function _ssidId() { return 's' + Date.now().toString(36) + (_ssidSeq++).toString(36); }

  // I BSS di una radio (tollera radio senza la chiave: stazione/legacy non migrato).
  /** @param {Radio} [radio] @returns {Ssid[]} */
  function radioSsids(radio) {
    return (radio && Array.isArray(radio.ssids)) ? radio.ssids : [];
  }

  // Pid della radio idx-esima (0-based). idx 0 → suffisso storico `-radio`.
  function radioPid(nodeId, idx) {
    const i = Math.max(0, parseInt(idx, 10) || 0);
    return i === 0 ? `${nodeId}-radio` : `${nodeId}-radio${i + 1}`;
  }

  // Scompone un pid radio → { nodeId, idx } | null. `-radio` = idx 0,
  // `-radioN` (N≥2) = idx N-1. Tollera nodeId con trattini interni.
  function parseRadioPid(pid) {
    const s = String(pid == null ? '' : pid);
    const m = s.match(/^(.*)-radio(\d*)$/);
    if (!m) return null;
    const nodeId = m[1];
    if (!nodeId) return null;
    const n = m[2] === '' ? 1 : parseInt(m[2], 10);
    if (!(n >= 1)) return null;            // `-radio1` non è un pid valido (lo è `-radio`)
    if (m[2] !== '' && n < 2) return null;
    return { nodeId, idx: n === 1 && m[2] === '' ? 0 : n - 1 };
  }

  // Tipo di connessione dai due estremi. Le porte radio si collegano SOLO ad
  // altre porte radio (associazione wireless = tipologia a sé). Mischiare una
  // radio con una porta di rete NON è ammesso → 'invalid' (il chiamante blocca).
  //   radio ↔ radio        → 'wireless'
  //   rete  ↔ rete         → 'cable'
  //   radio ↔ rete (mix)   → 'invalid'
  function linkKind(srcIsRadio, dstIsRadio) {
    if (srcIsRadio && dstIsRadio) return 'wireless';
    if (!srcIsRadio && !dstIsRadio) return 'cable';
    return 'invalid';
  }

  // Numero di interfacce radio "effettive" del nodo (clamp 0..8).
  function radioCount(node) {
    if (!node) return 0;
    const r = node.radios;
    if (Array.isArray(r)) return Math.min(r.length, MAX_RADIOS);
    return 0;
  }

  // Le chiavi-ancora per `count` radio, nell'ordine di assegnazione.
  function radioAnchorSlots(count) {
    const c = Math.max(0, Math.min(MAX_RADIOS, parseInt(count, 10) || 0));
    return ANCHOR_ORDER.slice(0, c);
  }

  // Vettore d'angolo (dx,dy ∈ {-1,0,1}) dell'ancora perimetrale della radio
  // idx-esima, dato il numero totale di radio del device. Serve a chi disegna
  // (overlay/popup) per far partire l'onda dall'ancora giusta del tile.
  // null se idx fuori range. (-1,-1)=alto-sx … (1,0)=centro-destra.
  const ANCHOR_VEC = {
    tr: [1, -1], tl: [-1, -1], br: [1, 1], bl: [-1, 1],
    tc: [0, -1], bc: [0, 1], lc: [-1, 0], rc: [1, 0],
  };
  function radioAnchorVector(idx, count) {
    const slot = radioAnchorSlots(count)[idx];
    return (slot && ANCHOR_VEC[slot]) ? ANCHOR_VEC[slot].slice() : null;
  }

  // Porta il nodo a `count` interfacce radio: crea voci vuote o tronca in coda.
  // Idempotente. Ritorna l'array `radios` aggiornato (muta `node`).
  function setRadioCount(node, count) {
    if (!node) return [];
    const c = Math.max(0, Math.min(MAX_RADIOS, parseInt(count, 10) || 0));
    if (!Array.isArray(node.radios)) node.radios = [];
    while (node.radios.length < c) node.radios.push({});
    if (node.radios.length > c) node.radios.length = c;
    if (node.radios.length === 0) delete node.radios;
    return node.radios || [];
  }

  // Migrazione legacy → `node.radios`. Idempotente e PURA (muta solo `node`).
  // Se `radios` già presente non tocca nulla. Altrimenti, da `wifiCfg`/`wifi`
  // (modello a singola radio) costruisce una sola interfaccia; gli AP senza
  // alcun dato Wi-Fi partono comunque con 1 radio (erano wireless per natura).
  function migrateNodeRadios(node, opts) {
    if (!node || Array.isArray(node.radios)) return node;
    const o = opts || {};
    const hasCfg = node.wifiCfg && typeof node.wifiCfg === 'object' && Object.keys(node.wifiCfg).length;
    const wifiOn = (node.wifi !== undefined && node.wifi !== null) ? !!node.wifi : !!o.defaultOn;
    if (hasCfg || wifiOn) {
      const cfg = {};
      if (hasCfg) for (const f of RADIO_CFG_FIELDS) if (node.wifiCfg[f] !== undefined) cfg[f] = node.wifiCfg[f];
      node.radios = [cfg];
    }
    return node;
  }

  // Migrazione al modello a due livelli: i campi ssid/vlan/security che stavano
  // sulla radio scendono in un BSS dentro `radios[i].ssids[]`. Idempotente e PURA
  // (salta le radio che hanno già `ssids`). I campi PHY (banda/canale/standard)
  // restano sulla radio. Va eseguita DOPO migrateNodeRadios (che porta wifiCfg→radio).
  /** @param {NetNode} node @returns {NetNode} */
  function migrateRadioSsids(node) {
    if (!node || !Array.isArray(node.radios)) return node;
    node.radios.forEach(r => {
      if (!r || typeof r !== 'object' || Array.isArray(r.ssids)) return;
      const bss = {};
      for (const f of SSID_FIELDS) if (r[f] != null) { bss[f] = r[f]; delete r[f]; }
      if (Object.keys(bss).length) r.ssids = [Object.assign({ id: _ssidId() }, bss)];
    });
    return node;
  }

  // Pool dei BSS "serventi" di un device: TUTTI i SSID di TUTTE le radio, con la
  // loro VLAN e l'indice di radio fisica. → [{ radioIdx, id, ssid, vlan|null, band }].
  // È ciò che un AP DISTRIBUISCE: chip "VLAN distribuite" + menu SSID del client.
  /** @param {NetNode} node @returns {{radioIdx:number,id:string,ssid:string,vlan:number|null,band:string|null}[]} */
  function apSsidList(node) {
    if (!node || !Array.isArray(node.radios)) return [];
    /** @type {{radioIdx:number,id:string,ssid:string,vlan:number|null,band:string|null}[]} */
    const out = [];
    node.radios.forEach((r, radioIdx) => {
      radioSsids(r).forEach(s => {
        if (s && s.ssid != null && String(s.ssid).trim() !== '') {
          const v = parseInt(String(s.vlan), 10);
          out.push({ radioIdx, id: s.id, ssid: String(s.ssid), vlan: (v >= 1 && v <= 4094) ? v : null, band: r.band || null });
        }
      });
    });
    return out;
  }

  // Risolve un BSS per id su tutto il device → { radioIdx, id, ssid, vlan, security,
  // band, channel, standard } | null. Usato dalla propagazione (link.bss→vlan) e dalla UI.
  /** @param {NetNode} node @param {string} id @returns {(Ssid & {radioIdx:number, band?:string, channel?:number|string, standard?:string})|null} */
  function ssidById(node, id) {
    if (!node || !Array.isArray(node.radios) || id == null) return null;
    for (let radioIdx = 0; radioIdx < node.radios.length; radioIdx++) {
      const r = node.radios[radioIdx];
      for (const s of radioSsids(r)) {
        if (s && s.id === id) return { radioIdx, id: s.id, ssid: s.ssid, vlan: s.vlan, security: s.security, band: r.band, channel: r.channel, standard: r.standard };
      }
    }
    return null;
  }

  // Config EFFETTIVA di un'associazione: campi PHY della radio + il BSS scelto
  // (per id `bssId`; in mancanza, il primo BSS con SSID, poi il primo BSS). Così il
  // client eredita banda/canale/sicurezza della radio e ssid/vlan del suo BSS.
  /** @param {Radio} radio @param {string} [bssId] @returns {Object|null} PHY radio + BSS scelto */
  function effBssCfg(radio, bssId) {
    if (!radio) return null;
    /** @type {Object} */
    const out = {};
    for (const f of RADIO_PHYS_FIELDS) if (radio[f] != null) out[f] = radio[f];
    const list = radioSsids(radio);
    let bss = (bssId != null) ? list.find(s => s && s.id === bssId) : null;
    if (!bss) bss = list.find(s => s && s.ssid) || list[0] || null;
    if (bss) { for (const f of SSID_FIELDS) if (bss[f] != null) out[f] = bss[f]; out.id = bss.id; }
    return out;
  }

  // Quale config eredita un link wireless. `radiosLookup(pid)` ritorna { node, radio }
  // (radio = node.radios[idx]) o null. Preferisce l'estremo che SERVE SSID (ha BSS):
  // ne risolve il BSS via `link.bss` (effBssCfg); fallback al primo estremo radio.
  /** @param {NetLink} link @param {(pid:string)=>({node:NetNode,radio:Radio}|null)} radiosLookup @returns {{node:NetNode, cfg:Object}|null} */
  function inheritRadioCfgForLink(link, radiosLookup) {
    if (!link || typeof radiosLookup !== 'function') return null;
    let first = null;
    for (const pid of [link.src, link.dst]) {
      const info = radiosLookup(pid);
      if (!info || !info.radio) continue;
      if (!first) first = info;
      if (radioSsids(info.radio).length) return { node: info.node, cfg: effBssCfg(info.radio, link.bss) };   // lato serving
    }
    return first ? { node: first.node, cfg: effBssCfg(first.radio, link.bss) } : null;
  }

  return {
    MAX_RADIOS, ANCHOR_ORDER, RADIO_CFG_FIELDS, RADIO_PHYS_FIELDS, SSID_FIELDS,
    radioPid, parseRadioPid, linkKind, radioCount,
    radioAnchorSlots, radioAnchorVector, setRadioCount, migrateNodeRadios, inheritRadioCfgForLink,
    apSsidList, radioSsids, migrateRadioSsids, ssidById, effBssCfg, newSsidId: _ssidId,
  };
});
