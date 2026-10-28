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
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./mac-class.js') : root,
    typeof module !== 'undefined' && module.exports ? require('./cidr.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function (/** @type {any} */ mc, /** @type {any} */ cidrApi) {
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

  // ── «Questa macchina è già documentata come VM?» ───────────────────────────
  // Gli indici che dicono «esiste già?» (Scopri, il crawl, l'adozione dalla Verifica) leggevano i NODI e
  // le loro porte, non `node.vms[]`: una macchina che avevi già messo sotto il suo host tornava «Nuova»,
  // l'import le creava un tile accanto alla VM, e l'IPAM — che le VM le conta — accusava lo stesso IP su
  // due apparati. La Verifica, intanto, i MAC delle VM li contava già (deviceSigs): due definizioni di
  // «apparato noto». Qui ce n'è una sola, e la usano tutti.
  //
  // IDENTITÀ, nell'ordine in cui è affidabile (la stessa scala dei nodi, `_discFindExistingDevice`):
  //   1. MAC — di QUALUNQUE vNIC;
  //   2. nome — uguale, senza badare alle maiuscole;
  //   3. IP — di qualunque vNIC, v4 e v6.
  // Il nome e l'IP valgono SOLO se il MAC non li smentisce: se la riga ha un MAC e la VM ne ha altri, ma
  // nessuno è quello, è un'altra macchina (IP riusato, apparato sostituito) e non si fonde — è il caso che
  // l'audit IPAM deve poter segnalare come conflitto vero. Se un MAC manca da una delle due parti (il caso
  // cross-subnet: l'ARP si ferma al router), basta il resto.
  // Il NOME da solo è la prova più debole, e anche l'IP la smentisce: se la riga porta un indirizzo e la VM ne ha
  // di suoi, ma nessuno è quello, è un'altra macchina con lo stesso nome (un server fisico «SRV01» accanto alla VM
  // «SRV01») e non la si scarta come «già documentata». Se invece niente la smentisce e niente la conferma (la VM
  // ha solo il nome), il match resta ma dice `weak`: chi lo mostra lo dice («solo per nome»).
  // Una chiave VUOTA non è un'identità: «nessun MAC» e «nessun MAC» non combaciano.
  //
  // UNA FUNZIONE per tutti — `findVmForRow(index, riga)`: prende la riga INTERA come la porta chi chiede (Scopri,
  // il crawl, l'adozione dalla Verifica, il vicino LLDP/CDP, il tile che si assorbe) e ne ricava da sé MAC, nomi
  // e indirizzi. Prima ognuno decideva quali campi consultare, e ognuno ne dimenticava uno: l'adozione cercava
  // per solo MAC, il crawl non guardava `integration.host`, l'assorbimento non guardava il nome.
  //
  // Le chiavi sono quelle del progetto, mai la stringa grezza: il MAC come `macKey` (lib/mac-class.js), l'IP
  // come `addrKey` (lib/cidr.js: un IPv6 è la sua forma canonica, un IPv4 senza zeri iniziali).
  // Un indirizzo scritto con la lunghezza del prefisso (`10.0.0.5/24`, come lo scrive chi copia da un router) è
  // lo stesso indirizzo: la lunghezza si toglie prima di fare la chiave, o non combacerebbe mai.
  const _bare = v => _str(v).replace(/\/\d{1,3}$/, '');
  // Le due chiavi sono quelle del progetto, UNA definizione ciascuna: `macKey` (lib/mac-class.js) e `addrKey`
  // (lib/cidr.js). Qui c'erano due copie piu' povere (`_mac12`, e un ripiego `toLowerCase()` che in Node, senza il
  // globale, confrontava un IPv6 per stringa): ora si leggono dalle lib — require() in Node, globali caricati
  // prima in netmapper.html (cidr.js e mac-class.js stanno sopra questo file).
  const _macKey = v => mc.macKey(v);
  const _addrKey = v => cidrApi.addrKey(v);

  /**
   * Indice d'identità delle VM di un elenco di nodi (sola lettura).
   * @param {any[]} nodes  i nodi del progetto: ogni host porta le sue `vms[]`
   */
  function buildVmIdentityIndex(nodes) {
    const k = { mac: _macKey, addr: _addrKey };
    const byMac = new Map(), byIp = new Map(), byName = new Map();
    const put = (map, key, rec) => {
      if (!key) return;                                   // una chiave vuota non è un'identità
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rec);
    };
    let size = 0;
    for (const host of (Array.isArray(nodes) ? nodes : [])) {
      if (!host || typeof host !== 'object' || !Array.isArray(host.vms)) continue;
      for (const vm of host.vms) {
        if (!vm || typeof vm !== 'object') continue;
        const rec = { host, vm, macs: new Set(), ips: new Set() };
        for (const m of vmMacs(vm)) { const key = k.mac(m); if (key) rec.macs.add(key); }
        for (const e of vmIps(vm)) { const key = k.addr(_bare(e.ip)); if (key) rec.ips.add(key); }
        for (const e of vmIp6s(vm)) { const key = k.addr(_bare(e.ip6)); if (key) rec.ips.add(key); }
        size++;
        for (const key of rec.macs) put(byMac, key, rec);
        for (const key of rec.ips) put(byIp, key, rec);
        for (const nm of new Set([_str(vm.name).toLowerCase(), _str(vm.hostname).toLowerCase()])) put(byName, nm, rec);
      }
    }
    return { byMac, byIp, byName, keys: k, size };
  }

  /**
   * La VM che è QUESTA macchina, se c'è. Basso livello: chi ha una RIGA usa `findVmForRow`.
   * @param {ReturnType<typeof buildVmIdentityIndex>} index
   * @param {{mac?:string, name?:string, names?:string[], ips?:string[]}} probe  ciò che si sa della macchina
   * @param {{only?:'mac'}} [opts]  `only:'mac'`: cerca solo per MAC (il primo passo di chi poi guarda i nodi). Un MAC di
   *   next-hop (gateway, VRRP) non identifica: chi lo sa lo toglie dalla riga PRIMA di chiedere (v. _discFindExistingDevice)
   * @returns {{host:any, vm:any, by:'mac'|'name'|'ip', weak?:boolean}|null}  `weak`: trovata per solo nome, nessun
   *   MAC o indirizzo la conferma (e nessuno la smentisce)
   */
  function findVmByIdentity(index, probe, opts) {
    if (!index || !(index.byMac instanceof Map) || !index.size) return null;
    const k = index.keys;
    const p = (probe && typeof probe === 'object') ? probe : {};
    const mac = k.mac(p.mac);

    if (mac && index.byMac.has(mac)) {
      const rec = index.byMac.get(mac)[0];
      return { host: rec.host, vm: rec.vm, by: 'mac' };
    }
    if (opts && opts.only === 'mac') return null;
    // il MAC della riga, se c'è, deve essere uno di quelli della VM (o la VM non ne ha): altrimenti è un'altra macchina
    const agrees = rec => !mac || rec.macs.size === 0 || rec.macs.has(mac);

    // gli indirizzi della riga, come chiavi (una chiave vuota non è un indirizzo)
    const ipKeys = [];
    for (const raw of (Array.isArray(p.ips) ? p.ips : [])) { const key = k.addr(_bare(raw)); if (key && ipKeys.indexOf(key) < 0) ipKeys.push(key); }
    // l'indirizzo della riga smentisce la VM se la VM ne ha di suoi e nessuno è uno di quelli della riga
    const ipContradicts = rec => ipKeys.length > 0 && rec.ips.size > 0 && !ipKeys.some(key => rec.ips.has(key));

    const names = [];
    for (const raw of [p.name].concat(Array.isArray(p.names) ? p.names : [])) { const nm = _str(raw).toLowerCase(); if (nm && names.indexOf(nm) < 0) names.push(nm); }
    for (const nm of names) {
      if (!index.byName.has(nm)) continue;
      const rec = index.byName.get(nm).find(r => agrees(r) && !ipContradicts(r));
      if (rec) {
        const confirmed = (mac && rec.macs.has(mac)) || ipKeys.some(key => rec.ips.has(key));
        return { host: rec.host, vm: rec.vm, by: 'name', weak: !confirmed };
      }
    }
    for (const key of ipKeys) {
      if (!index.byIp.has(key)) continue;
      const rec = index.byIp.get(key).find(agrees);
      if (rec) return { host: rec.host, vm: rec.vm, by: 'ip' };
    }
    return null;
  }

  /**
   * Che cosa si sa di una macchina, ricavato dalla RIGA intera: il MAC, i nomi (hostname, nome NetBIOS, nome) e
   * gli indirizzi (ip, ip6, l'ultimo visto, l'host di gestione SNMP). È l'UNICO posto che decide quali campi di una
   * riga contano per «è già una VM?»: una riga di Scopri/crawl, un candidato dell'adozione, un vicino LLDP/CDP e
   * un nodo da assorbire hanno forme diverse, e tutte passano di qui.
   * @param {any} row
   * @returns {{mac:string, names:string[], ips:string[]}}
   */
  function probeOfRow(row) {
    const r = (row && typeof row === 'object') ? row : {};
    const integ = (r.integration && typeof r.integration === 'object') ? r.integration : {};
    return {
      mac: _str(r.mac),
      names: [r.hostname, r.netbiosName, r.name].map(_str).filter(Boolean),
      ips: [r.ip, r.ip6, r.currentIp, integ.host].map(_str).filter(Boolean),
    };
  }

  /**
   * «Questa macchina è già documentata come VM?» — UNA risposta, per tutti. Prende la riga intera.
   * @param {ReturnType<typeof buildVmIdentityIndex>} index
   * @param {any} row  mac, hostname/netbiosName/name, ip/ip6/currentIp, integration.host
   * @param {{only?:'mac'}} [opts]
   * @returns {{host:any, vm:any, by:'mac'|'name'|'ip', weak?:boolean}|null}
   */
  function findVmForRow(index, row, opts) {
    return findVmByIdentity(index, probeOfRow(row), opts);
  }

  return {
    vmNics, vmPrimaryNic, vmPrimaryIp, vmMacs, vmIps, vmIp6s, vmVlanValues,
    buildVmIdentityIndex, findVmByIdentity, probeOfRow, findVmForRow,
    migrateVmNics, nextVmNicId, VM_NIC_FIELDS, VM_FLAT_NET_FIELDS,
  };
});
