// ============================================================
// WIFI-VLAN-CHECK — coerenza PURA delle VLAN wireless (AP/SSID/client).
//
// Due controlli, da rete reale:
//  1) SSID-non-nel-trunk: una VLAN-SSID dell'AP NON è permessa sul trunk
//     dell'uplink cablato verso lo switch (la realtà SNMP del trunk la esclude)
//     → il client su quell'SSID non passa. È il mismatch più insidioso.
//  2) Client-VLAN-non-distribuita: un client ha una VLAN propria (manuale) che
//     non è tra quelle distribuite dall'AP a cui è associato.
//
// Puro: niente DOM/state/globali. Il glue raccoglie i descrittori e formatta
// i messaggi (i18n); qui solo il confronto. Condiviso browser + test (UMD-lite).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _vlan(v) { const n = parseInt(v, 10); return (n >= 1 && n <= 4094) ? n : null; }

  // input = {
  //   aps:     [{ id, name, ssids:[{ssid, vlan}], uplinkAllowed: number[]|null }],
  //   clients: [{ id, name, ap, clientVlan, poolVlans: number[] }],
  // }
  // → [{ kind, level, ap, ssid?, vlan, client? }]  (level sempre 'warn')
  function wifiVlanIssues(input) {
    const out = [];
    const i = input || {};
    for (const ap of (i.aps || [])) {
      // uplinkAllowed null = trunk non dichiarato da SNMP → niente da confrontare.
      if (!Array.isArray(ap.uplinkAllowed)) continue;
      const allowed = new Set(ap.uplinkAllowed.map(_vlan).filter(Boolean));
      for (const s of (ap.ssids || [])) {
        const v = _vlan(s && s.vlan);
        if (v && !allowed.has(v)) {
          out.push({ kind: 'ssid-not-in-trunk', level: 'warn', ap: ap.name, ssid: s.ssid, vlan: v });
        }
      }
    }
    for (const c of (i.clients || [])) {
      const v = _vlan(c && c.clientVlan);
      if (v && Array.isArray(c.poolVlans)) {
        const pool = new Set(c.poolVlans.map(_vlan).filter(Boolean));
        if (!pool.has(v)) out.push({ kind: 'client-vlan-not-distributed', level: 'warn', ap: c.ap, client: c.name, vlan: v });
      }
    }
    return out;
  }

  return { wifiVlanIssues };
});
