// ============================================================
// VM-NICS — le interfacce di rete virtuali di una VM (lettura PURA e tollerante)
// ============================================================
// Una VM può avere PIÙ vNIC: un firewall virtuale (pfSense/OPNsense) ha WAN +
// LAN + DMZ, un server ha spesso la NIC di produzione e quella di backup. Fino
// alla 77ª il record VM aveva UN SOLO indirizzo (`vm.ip/ip6/mac/vlan`), e il
// caso multi-scheda era schiacciato in una lista con virgole dentro `vm.vlan`.
// Da qui in avanti l'identità di rete della VM vive in `vm.nics[]`.
//
// ⚠️ Una vNIC NON è una porta fisica e NON ha un cavo. Si innesta su un
// port-group di un vSwitch, il cui uplink è la NIC fisica dell'host — che è già
// un device documentato e già cablato. Per questo qui non esiste nessun
// riferimento a porte, link o LED: la vNIC si "collega al resto" tramite i tre
// agganci che il progetto ha già — la VLAN (che alimenta il trunk derivato
// dell'uplink dell'host, lib/vlan-trunk.js), il MAC (che rende la VM
// documentata nel Drift, lib/drift-snapshot.js) e l'IP (che entra nell'audit
// IPAM). Da quale NIC fisica esca il traffico, con un vSwitch in teaming, lo
// decide la policy di bilanciamento: non è sapibile e non si dichiara
// (② no-invenzioni).
//
// LETTURA TOLLERANTE: `vmNics()` accetta sia la forma nuova sia i progetti
// vecchi coi campi piatti, e sintetizza in quel caso UNA vNIC implicita. Ciò
// permette a chi legge il JSON senza passare dalla UI (server, export, API,
// test) di vedere la stessa cosa. È lo stesso ripiego di `vm.snmp →
// vm.integration`: una sola implementazione, nessun secondo vocabolario.
//
// CAMPI di una vNIC — scelti per COINCIDERE con ciò che un'API di hypervisor
// restituisce, così un futuro driver (vSphere / Proxmox / Hyper-V) li popola
// senza cambiare forma:
//   id        identità stabile dentro la VM (non è un id di progetto)
//   name      etichetta dell'adattatore  · vSphere "Network adapter 1", Proxmox "net0"
//   portGroup port-group / bridge / vSwitch · vSphere port group, Proxmox bridge
//   vlan      VLAN del port-group (accetta la lista tollerante "20,30")
//   ip/ip6    indirizzi dichiarati
//   mac       MAC della vNIC
// Nessun campo "stato del link" o "sorgente del dato": non li consuma nessuno,
// e un campo che nessuno legge è solo un'invenzione in attesa.
//
// UMD-lite come le altre lib pure: <script> in netmapper.html PRIMA del bundle
// (global bare), in Node require(). Nessuna dipendenza, nessun DOM.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Campi di rete PIATTI del vecchio record VM. Restano leggibili per sempre
  // (progetti su disco, JSON importati), ma la UI li migra alla prima modifica.
  const VM_FLAT_NET_FIELDS = ['ip', 'ip6', 'mac', 'vlan'];

  // Campi ammessi su una vNIC: l'elenco è chiuso, così un import non porta
  // dentro chiavi che nessun motore legge.
  const VM_NIC_FIELDS = ['name', 'portGroup', 'vlan', 'ip', 'ip6', 'mac'];

  const _str = v => (v == null ? '' : String(v)).trim();

  /**
   * Le vNIC di una VM, in forma normalizzata.
   * Con `vm.nics[]` presente lo si usa; altrimenti, SE la VM ha almeno un campo
   * di rete piatto, si sintetizza una vNIC implicita (progetti pre-78ª). Una VM
   * senza nessun dato di rete ritorna [] — non si inventa una scheda che
   * l'utente non ha dichiarato.
   * @param {any} vm
   * @returns {Array<{id:string,name?:string,portGroup?:string,vlan?:string,ip?:string,ip6?:string,mac?:string}>}
   */
  function vmNics(vm) {
    if (!vm) return [];
    if (Array.isArray(vm.nics)) {
      const out = [];
      vm.nics.forEach((nic, i) => {
        if (!nic || typeof nic !== 'object') return;
        const o = { id: _str(nic.id) || ('nic' + (i + 1)) };
        for (const f of VM_NIC_FIELDS) { const v = _str(nic[f]); if (v) o[f] = v; }
        out.push(o);
      });
      return out;
    }
    const implicit = { id: 'nic1' };
    let any = false;
    for (const f of VM_FLAT_NET_FIELDS) { const v = _str(vm[f]); if (v) { implicit[f] = v; any = true; } }
    return any ? [implicit] : [];
  }

  /**
   * La vNIC "principale": la prima dichiarata. Serve dove un solo indirizzo ha
   * senso — l'host da interrogare via SNMP, l'URL della console di management,
   * il riepilogo di una riga. Non è un ruolo speciale nel modello: è solo
   * l'ordine in cui l'utente le ha messe.
   * @param {any} vm @returns {any|null}
   */
  function vmPrimaryNic(vm) {
    const list = vmNics(vm);
    return list.length ? list[0] : null;
  }

  /** Primo IPv4 dichiarato dalla VM (o ''), per i consumatori a valore singolo. */
  function vmPrimaryIp(vm) {
    for (const nic of vmNics(vm)) { if (nic.ip) return nic.ip; }
    return '';
  }

  /** Tutti i MAC dichiarati (grezzi, dedup case-insensitive: normalizza il chiamante). */
  function vmMacs(vm) {
    const seen = new Set(); const out = [];
    for (const nic of vmNics(vm)) {
      if (!nic.mac) continue;
      const k = nic.mac.toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(nic.mac);
    }
    return out;
  }

  /** Tutti gli IPv4 dichiarati, con la vNIC di provenienza (per etichettare le righe). */
  function vmIps(vm) {
    const out = [];
    for (const nic of vmNics(vm)) { if (nic.ip) out.push({ nicId: nic.id, name: nic.name || '', ip: nic.ip }); }
    return out;
  }

  /** Tutti gli IPv6 dichiarati (stessa forma di vmIps). */
  function vmIp6s(vm) {
    const out = [];
    for (const nic of vmNics(vm)) { if (nic.ip6) out.push({ nicId: nic.id, name: nic.name || '', ip6: nic.ip6 }); }
    return out;
  }

  /** Valori VLAN GREZZI di tutte le vNIC (il parsing tollerante è di vlan-trunk). */
  function vmVlanValues(vm) {
    const out = [];
    for (const nic of vmNics(vm)) { if (nic.vlan) out.push(nic.vlan); }
    return out;
  }

  /**
   * Forma migrata di una VM coi campi piatti: ritorna l'array `nics` da
   * assegnare. PURA — non muta la VM: la cancellazione dei campi piatti la fa
   * il chiamante (_migrateState), che è l'unico a sapere quando è lecito
   * scrivere sul modello.
   * @param {any} vm @returns {any[]|null} null se non c'è nulla da migrare
   */
  function migrateVmNics(vm) {
    if (!vm || Array.isArray(vm.nics)) return null;
    const nics = vmNics(vm);
    return nics.length ? nics : null;
  }

  /** Id vNIC libero dentro una VM (nic1, nic2, …): stabile e leggibile. */
  function nextVmNicId(vm) {
    const used = new Set(vmNics(vm).map(n => n.id));
    for (let i = 1; i <= 999; i++) { const id = 'nic' + i; if (!used.has(id)) return id; }
    return 'nic' + (used.size + 1);
  }

  return {
    vmNics, vmPrimaryNic, vmPrimaryIp, vmMacs, vmIps, vmIp6s, vmVlanValues,
    migrateVmNics, nextVmNicId, VM_NIC_FIELDS, VM_FLAT_NET_FIELDS,
  };
});
