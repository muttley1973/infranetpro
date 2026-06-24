// ============================================================
// VLAN-TRUNK — derivazione PURA del trunk dalle "VLAN trasportate".
//
// Una connessione che trasporta più VLAN diventa un TRUNK e ci mette in
// automatico le VLAN trasportate. Niente concetto separato di "nativa": la
// nativa è la VLAN access che già propaga sul link; le VLAN EXTRA taggate sono
// quelle che i device agli estremi dichiarano (voce per il VoIP, VLAN-per-SSID
// per l'AP). Stesso identico meccanismo per voce e Wi-Fi.
//
//   carriedVlans(node)   → VLAN extra taggate dichiarate dal device
//   effLinkVlans(args)   → { mode, native, vlans[], carried[], derived }
//
// Manual-first: se l'utente ha impostato `trunkVlans` a mano, quello VINCE
// (derived=false). Altrimenti il trunk è DERIVATO (si auto-aggiorna, niente
// scrittura nel modello). Puro: niente DOM, niente globali.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // VLAN valida = intero 1..4094.
  function _toVlan(v) {
    const n = parseInt(v, 10);
    return (Number.isFinite(n) && n >= 1 && n <= 4094) ? n : null;
  }

  // Parser tollerante "10,20,100-200" → [10,20,100,…,200] (dedup, ordinato).
  /** @param {string|number[]|null|undefined} raw @returns {number[]} */
  function parseVlanList(raw) {
    if (Array.isArray(raw)) return uniqSort(raw.map(_toVlan).filter(Boolean));
    if (raw == null) return [];
    /** @type {number[]} */
    const out = [];
    String(raw).split(',').forEach(part => {
      part = part.trim();
      if (!part) return;
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        for (let v = Math.min(a, b); v <= Math.max(a, b) && v <= 4094; v++) { const t = _toVlan(v); if (t) out.push(t); }
      } else {
        const t = _toVlan(part);
        if (t) out.push(t);
      }
    });
    return uniqSort(out);
  }

  function uniqSort(arr) {
    return Array.from(new Set((arr || []).filter(v => v != null))).sort((a, b) => a - b);
  }

  // VLAN extra TAGGATE che un device serve sulle sue INTERFACCE (interface-agnostico,
  // come un device reale): le VLAN di TUTTI i SSID/BSS di OGNI sua radio + la VLAN
  // voce se VoIP. Non più type-specific: ap/router/firewall con Wi-Fi passano da `radios[]`.
  //   radios[].ssids[].vlan → VLAN dei BSS (multi-SSID, qualsiasi tipo)
  //   voip                  → + voiceVlan (se > 1: VLAN 1 = nessuna voce dedicata)
  /** @param {NetNode} node @returns {number[]} VLAN extra taggate (SSID dei BSS + voce VoIP) */
  function carriedVlans(node) {
    if (!node) return [];
    /** @type {number[]} */
    const out = [];
    if (Array.isArray(node.radios)) {
      for (const r of node.radios) {
        const list = (r && Array.isArray(r.ssids)) ? r.ssids : [];
        for (const s of list) { const v = s && _toVlan(s.vlan); if (v) out.push(v); }
      }
    }
    // Hypervisor/homelab: le VM dichiarano la VLAN del loro port-group (vNIC).
    // L'uplink dell'host porta quindi TUTTE le VLAN delle VM → trunk derivato,
    // stesso meccanismo dei BSS di un AP. `vm.vlan` accetta il parser tollerante
    // ("20,30") per le VM appliance multi-vNIC (firewall/router virtuali).
    if (Array.isArray(node.vms)) {
      for (const vm of node.vms) {
        if (!vm) continue;
        for (const v of parseVlanList(vm.vlan)) out.push(v);
      }
    }
    // voiceVlan è un campo `spec` (updateN lo sposta in node.spec e cancella il
    // top-level) → leggi da entrambi, altrimenti la voce impostata dalla UI non
    // verrebbe trasportata e l'uplink switch↔telefono resterebbe access.
    if (node.type === 'voip') {
      const v = _toVlan(node.voiceVlan != null ? node.voiceVlan : (node.spec && node.spec.voiceVlan));
      if (v && v > 1) out.push(v);
    }
    return uniqSort(out);
  }

  // Descrittore EFFETTIVO delle VLAN di un link.
  //   args = { manualMode, manualTrunkVlans, native, carried }
  // - manualTrunkVlans impostato → override manuale, vince (derived:false).
  // - altrimenti derivato: all = uniq(native ∪ carried); trunk se all.length>=2.
  /** @param {{manualMode?:string, manualTrunkVlans?:string|number[], native?:number|string, carried?:(number|string)[], snmpTrunk?:boolean}} args @returns {LinkVlanInfo} */
  function effLinkVlans(args) {
    const a = args || {};
    const native = _toVlan(a.native) || 1;
    const carried = uniqSort((a.carried || []).map(_toVlan).filter(Boolean));

    const manual = (a.manualTrunkVlans != null && String(a.manualTrunkVlans).trim() !== '')
      ? parseVlanList(a.manualTrunkVlans) : null;
    if (manual && manual.length) {
      return { mode: 'trunk', native, vlans: manual, carried, derived: false };
    }
    // Override esplicito ad ACCESS (l'utente ha forzato): vince sulla derivazione.
    if (a.manualMode === 'access') {
      return { mode: 'access', native, vlans: uniqSort([native]), carried, derived: false };
    }
    // Override manuale "trunk" senza lista esplicita: resta trunk ma senza VLAN.
    if (!carried.length && a.manualMode === 'trunk') {
      return { mode: 'trunk', native, vlans: uniqSort([native]), carried, derived: false };
    }
    // Derivato: nativa ∪ trasportate (voce/SSID/SNMP). È trunk se ≥2 VLAN OPPURE
    // se lo SNMP segnala la porta come trunk (anche con una sola VLAN allowed).
    const all = uniqSort([native, ...carried]);
    const isTrunk = all.length >= 2 || !!a.snmpTrunk;
    return { mode: isTrunk ? 'trunk' : 'access', native, vlans: all, carried, derived: true };
  }

  return { carriedVlans, effLinkVlans, parseVlanList };
});
