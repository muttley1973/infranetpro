// ============================================================
// ANSIBLE-NETOS — deriva `ansible_network_os` dal vendor DOCUMENTATO
// ============================================================
// Mappa PURA vendor→ansible_network_os, usata dall'inventory dinamico Ansible
// (lib/api-shape.js) per far scegliere ai moduli di rete il comando giusto (es.
// il backup della running-config). Vendor-neutral e CONSERVATIVA: deriva SOLO da
// segnali già esposti (brand/model dichiarati + sysDescr misurato) e ritorna
// `null` quando il vendor è ignoto o ambiguo — MAI un default inventato (paletto
// ①): un network_os sbagliato manderebbe il comando errato all'apparato sbagliato.
//
// Valori = FQCN moderni delle collection Ansible (cisco.ios.ios, arista.eos.eos, …).
// Funzione PURA (zero IO/DOM). UMD-lite: <script> browser + require() in Node/test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _hay(model) {
    const m = (model && typeof model === 'object') ? model : {};
    return [m.brand, m.model, m.sysDescr].map(x => String(x == null ? '' : x)).join(' ').toLowerCase();
  }

  // Ritorna il valore `ansible_network_os` o `null` se non determinabile.
  // Ordine: prima i disambiguatori (Nexus vs IOS, cloud-managed), poi i vendor.
  function vendorToNetworkOs(model) {
    const m = (model && typeof model === 'object') ? model : {};
    // Una piattaforma DICHIARATA (NetBox `platform`: "Cisco IOS", slug `cisco-ios`,
    // "Junos"…) batte l'ipotesi ricavata dal brand: la prima è documentazione, la
    // seconda una deduzione da marca e modello.
    // ⚠️ Tre esiti, non due: `undefined` = la stringa non dice niente (si prova con
    // il brand), `null` = il vendor è riconosciuto ma NON si gestisce da CLI (Meraki
    // è cloud-managed). Senza questa distinzione una platform "Cisco Meraki" — che è
    // un veto esplicito — ricadrebbe sul brand "Cisco" e tornerebbe `cisco.ios.ios`,
    // cioè l'opposto di quanto dichiarato.
    const declared = _match(String(m.platform == null ? '' : m.platform).toLowerCase());
    if (declared !== undefined) return declared;
    const guessed = _match(_hay(model));
    return guessed === undefined ? null : guessed;
  }

  // string = network_os · null = riconosciuto ma non gestibile · undefined = muto.
  function _match(s) {
    if (!s.trim()) return undefined;

    // ── Famiglia Cisco: richiede un segnale Cisco esplicito (evita falsi da 'ios'
    // di Apple/iOS che NON è un device gestibile via network_cli). ──────────────
    const ciscoFamily = /cisco|catalyst|nexus|nx-?os|ios[- ]?xe|\bisr\b|\basr\b/.test(s);
    if (ciscoFamily) {
      if (/meraki/.test(s)) return null;                    // cloud-managed → niente backup network_cli
      if (/nexus|nx-?os|\bn[3579]k\b/.test(s)) return 'cisco.nxos.nxos';
      if (/\basa\b/.test(s)) return 'cisco.asa.asa';        // firewall ASA
      return 'cisco.ios.ios';                               // IOS / IOS-XE / Catalyst (caso modale)
    }

    if (/arista/.test(s)) return 'arista.eos.eos';
    if (/juniper|junos/.test(s)) return 'junipernetworks.junos.junos';
    if (/vyos/.test(s)) return 'vyos.vyos.vyos';
    if (/mikrotik|routeros/.test(s)) return 'community.routeros.routeros';
    if (/fortinet|fortios|fortigate/.test(s)) return 'fortinet.fortios.fortios';

    // Muto, non "gestibile da nessuno": chi chiama puo' provare l'altra fonte. Il
    // `null` di sopra (Meraki) e' un'altra cosa — li' il vendor si e' riconosciuto.
    return undefined;                                       // ignoto/ambiguo → no-invenzioni
  }

  return { vendorToNetworkOs };
});
