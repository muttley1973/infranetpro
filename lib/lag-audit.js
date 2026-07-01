// ============================================================
// LAG AUDIT — coerenza dei membri di un gruppo LAG (report puro)
// ============================================================
// Su un LAG (EtherChannel/bond) reale i link membri devono essere OMOGENEI:
// stessa velocità e stessa config di VLAN/nativa. Membri incoerenti NON
// aggregano sul ferro (LACP li scarta / il bundle resta a un solo link).
// InfraNet ha i dati (velocità e VLAN effettiva per porta) ma finora non
// avvisava: questa funzione pura li confronta e segnala i disallineamenti.
//
// Sola lettura, niente DOM/stato: input espliciti → output. Manual-first:
// non muta nulla, non deduce LACP active/passive (non modellato) — verifica
// solo la coerenza di ciò che l'utente ha già documentato.
//
// INPUT members = [ { num, speed, vlan } ]
//   speed → Mbps della porta (speedOvr ?? speed), null/undefined se ignota
//   vlan  → VLAN access/nativa effettiva della porta (_effPortVlan), null se ignota
// OUTPUT {
//   speedMismatch, vlanMismatch,   // true se >1 valore DISTINTO noto
//   speeds: [Mbps distinti, crescenti], vlans: [VID distinti, crescenti],
// }
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _num(v) {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function checkLagMembers(members) {
    const list = Array.isArray(members) ? members : [];
    const speeds = [];
    const vlans = [];
    for (const m of list) {
      const s = _num(m && m.speed);
      if (s != null && !speeds.includes(s)) speeds.push(s);
      const v = _num(m && m.vlan);
      if (v != null && !vlans.includes(v)) vlans.push(v);
    }
    speeds.sort((a, b) => a - b);
    vlans.sort((a, b) => a - b);
    return {
      speedMismatch: speeds.length > 1,
      vlanMismatch: vlans.length > 1,
      speeds,
      vlans,
    };
  }

  return { checkLagMembers };
});
