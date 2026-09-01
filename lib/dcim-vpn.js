'use strict';
// ============================================================================
//  lib/dcim-vpn.js — i SERVIZI L2 e i TUNNEL di NetBox → i collegamenti fra sedi
// ----------------------------------------------------------------------------
//  I `circuits/` di NetBox (lib/dcim-wan.js) sono le linee che una sede compra
//  dall'operatore. Ma ciò che LEGA due sedi vive altrove: nell'applicazione
//  `vpn/`, che modella i servizi **L2VPN** (VPLS, VXLAN, EVPN, E-Line…) e i
//  **tunnel** (IPsec, GRE, WireGuard…). Leggere solo i circuiti significava
//  portare a casa gli uplink e lasciare indietro proprio i collegamenti — che
//  sono metà della domanda del layer multi-sede.
//
//  Come il modulo dei circuiti: PURO. Trasforma in CANDIDATI, non scrive, e non
//  conosce l'organizzazione InfraNet.
//
//  ── Le scelte, e perché ────────────────────────────────────────────────────
//
//   ① **Qui la natura SI PUÒ dedurre, e la differenza non è di comodo.** Il tipo
//      di un circuito è testo libero dell'istanza («MPLS», «Fibra spenta»), e
//      riconoscerlo per stringa funzionerebbe su un archivio solo — per questo
//      un circuito fra due sedi entra come `other`. Qui invece `l2vpn.type` e
//      `tunnel.encapsulation` sono VOCABOLARI CHIUSI di NetBox: `vpls` vuol dire
//      VPLS in ogni installazione del mondo, e `ipsec-tunnel` vuol dire IPsec.
//      Mappare un vocabolario chiuso su un altro vocabolario chiuso è una
//      traduzione, non un indovinello — e il paletto ③ (vendor-neutral) è
//      rispettato proprio perché non si guarda come l'ha chiamato l'utente.
//      Tutto ciò che nel nostro vocabolario NON esiste (VXLAN, EVPN, GRE,
//      WireGuard, E-Line…) entra come `other` con l'ETICHETTA di NetBox: il
//      software sa di non sapere e non perde il nome (⑨ di `lib/inter-site.js`).
//
//   ② ⚠️ **`outside_ip` e `peerIp` si INCROCIANO.** In NetBox `outside_ip` è
//      l'indirizzo esterno DI QUEL capo; nel nostro modello `endpointA.peerIp` è
//      l'indirizzo dell'ALTRO capo — è l'indirizzo che si scrive nella
//      configurazione del tunnel su A. Assegnare a ciascun capo il proprio
//      `outside_ip` sarebbe esattamente al contrario, e a valle nessuno potrebbe
//      accorgersene: due indirizzi plausibili nei due campi sbagliati.
//
//   ③ **Solo ciò che è ATTIVO.** Come per i circuiti: un `planned` o un
//      `decommissioning` entrerebbe indistinguibile da un collegamento in
//      esercizio. Si dicono con il loro stato, e chi li vuole li scrive a mano.
//      ⚠️ Un tunnel `disabled` NON diventa `state: down`: «disattivato in
//      documentazione» è una decisione, non una misura, e i due si leggerebbero
//      uguali.
//
//   ④ **Esattamente DUE sedi, o non è un collegamento.** Un L2VPN multipunto fra
//      tre sedi è un servizio solo, e spezzarlo in tre coppie inventerebbe
//      adiacenze che nessuno ha dichiarato — la stessa ragione per cui la nuvola
//      MPLS resta fatta di uplink (④ di `lib/dcim-wan.js`). Si rifiuta dicendo
//      quante sedi tocca.
//
//   ⑤ **Il RUOLO di una terminazione non si legge più.** Serviva a dedurre una
//      forma d'insieme (`hub-and-spoke`) e a scriverla sul singolo collegamento:
//      ma la forma è una proprietà dell'INSIEME dei collegamenti di un servizio,
//      non di uno, e quel campo non esiste più (㉒ di `lib/inter-site.js`).
//      Resta scritto in NetBox, dove è al suo posto: è una proprietà del capo.
//
//   ⑥ **Il nome ha il suo campo; l'identificativo no, e si dice.** Il `name` di
//      un L2VPN o di un tunnel va in `link.name` (⑪ di `lib/inter-site.js`), che
//      vale per ogni natura. NON va in `service` (quello è il servizio
//      dell'OPERATORE, che NetBox non conosce per un L2VPN) né in `phase1Name`
//      (quello è il nome della phase 1 sull'apparato): due campi in cui il nome
//      «ci starebbe» sono due campi che comincerebbero a mentire. L'identificativo
//      (VNI / VC-ID) non ha casa: comporre «nome (1001)» sarebbe inventare un
//      formato che poi nessuno sa rileggere. Resta fuori, e viene DETTO.
//
//   ⑧ **`reach` si legge SOLO dove NetBox lo dichiara — e sono pochi posti.**
//      «Quali reti questo collegamento rende raggiungibili a ciascun capo» è la
//      domanda perno del layer multi-sede, ed è anche quella che l'import lasciava
//      sempre vuota: due controlli dell'audit (`subnetsNowhere`, `subnetsNotCarried`)
//      si dichiaravano ciechi con motivo `no-reach` su OGNI progetto importato.
//      ⚠️ Il motivo non era una dimenticanza, ed è stato MISURATO sull'archivio vero
//      (NetBox 4.6.7, `OPTIONS` sui tre endpoint): un `tunnel` ha `encapsulation`,
//      `ipsec_profile`, `tunnel_id` — parametri di cifratura e incapsulamento — e
//      **nessun campo per le reti protette**; un `circuit` ha `cid`, `commit_rate`,
//      le due terminazioni — e **nessun campo per le reti trasportate**. Su un IPsec
//      l'encryption domain in NetBox NON C'È: dedurlo dalle reti della sede sarebbe
//      inventare (paletto ②), e sarebbe inventare la cosa più delicata del modello.
//      ⚠️ L'unica catena che ESISTE è quella dei servizi L2: una terminazione L2VPN
//      può essere appesa a una `ipam.vlan`, e un prefisso NetBox porta il campo
//      `vlan`. Là la risposta è scritta, in due oggetti invece che in uno, e leggerla
//      è una lettura — non un indovinello. Il modulo resta PURO: riceve `netsOf`,
//      come riceve `siteOf` (⑦).
//      ⚠️ Le reti si UNISCONO su tutti i capi di quella sede, non si prende il primo:
//      un VPLS che termina su due VLAN a Milano rende raggiungibili le reti di
//      entrambe, e fermarsi alla prima farebbe accusare le altre di «non trasportate»
//      — un'accusa falsa, che è l'errore peggiore che questo audit possa fare.
//      ⚠️ Nessuna rete ⇒ `null`, MAI `[]`: un `reach` assente è «non lo sappiamo»,
//      una lista vuota sarebbe «non ne raggiunge nessuna» (vedi `linkReach` in
//      `lib/inter-site.js`). Sono due risposte diverse e a valle nessuno le rimette
//      insieme.
//
//   ⑦ **Dove sta un capo lo sa solo chi ha l'archivio in mano.** Una terminazione
//      punta a un'interfaccia, a un'interfaccia di VM o a una VLAN; risalire da
//      lì al SITO richiede altre letture. Il modulo non legge: riceve `siteOf`
//      (iniezione di dipendenza, come il righello della mappa) e resta puro.
//
//  UMD-lite: `<script>` in netmapper.html → global; in Node `require()`.
// ============================================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** @param {unknown} v @returns {string|null} */
  function _str(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  }
  const _lc = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const _list = (v) => (Array.isArray(v) ? v : []);

  /** L'indirizzo senza la maschera. Non è una canonicalizzazione (quella ha già
   *  una definizione sola, `addrKey` in `lib/cidr.js`, e riscriverla qui sarebbe
   *  la tredicesima definizione doppia): è togliere ciò che non appartiene al
   *  concetto «indirizzo dell'altro capo». */
  /** @param {unknown} v @returns {string|null} */
  function _indirizzo(v) {
    const s = _str(v);
    if (!s) return null;
    const i = s.indexOf('/');
    return _str(i >= 0 ? s.slice(0, i) : s);
  }

  /** Un campo a scelta di NetBox: `{value,label}` in lettura, stringa nuda in
   *  scrittura. Torna sempre la coppia, così chi mappa ha il valore e chi
   *  ripiega su `other` ha le parole. */
  function _choice(v) {
    if (v && typeof v === 'object') return { value: _lc(v.value), label: _str(v.label) || _str(v.value) };
    return { value: _lc(v), label: _str(v) };
  }

  /**
   * ① Il vocabolario CHIUSO di NetBox → il nostro, altrettanto chiuso.
   * Ciò che non ha un corrispondente NON viene arrotondato al vicino più
   * somigliante: diventa `other`, che è il modo in cui il software dichiara di
   * non sapere invece di dire una cosa per un'altra.
   */
  const L2VPN_KIND = {
    vpls: 'vpls', vpws: 'vpws', vxlan: 'vxlan',
    // ⑲ Le quattro forme di EVPN dicono tutte EVPN: il piano di controllo è
    // quello, e quale trasporto ci stia sotto (MPLS, VXLAN, PBB) è un'altra
    // domanda, che questo modello non fa. È la stessa perdita, già accettata,
    // della coppia `ipsec-tunnel`/`ipsec-transport` qui sotto.
    'vxlan-evpn': 'evpn', 'mpls-evpn': 'evpn', 'pbb-evpn': 'evpn', 'evpn-vpws': 'evpn',
  };
  const TUNNEL_KIND = {
    'ipsec-tunnel': 'ipsec', 'ipsec-transport': 'ipsec',
    gre: 'gre', wireguard: 'wireguard', openvpn: 'openvpn', l2tp: 'l2tp',
  };

  /** L'oggetto a cui una terminazione è appesa, in forma neutra: che cosa è, chi
   *  è, e — se è una porta — su quale apparato sta. */
  /** @param {string} tipo @param {*} obj */
  function _holder(tipo, obj) {
    const t = _lc(tipo);
    if (!obj || typeof obj !== 'object') return null;
    if (t === 'dcim.interface') {
      const dev = obj.device || null;
      return { kind: 'device', id: dev && dev.id, name: _str(dev && (dev.name || dev.display)), ifaceName: _str(obj.name) };
    }
    if (t === 'virtualization.vminterface') {
      const vm = obj.virtual_machine || obj.virtualMachine || null;
      return { kind: 'vm', id: vm && vm.id, name: _str(vm && (vm.name || vm.display)), ifaceName: _str(obj.name) };
    }
    if (t === 'ipam.vlan') {
      return { kind: 'vlan', id: obj.id, name: _str(obj.name || obj.display), ifaceName: null };
    }
    return { kind: _lc(tipo) || 'unknown', id: obj.id, name: _str(obj.name || obj.display), ifaceName: null };
  }

  /** I due capi di un servizio → le due sedi distinte che tocca, con l'apparato.
   *  @returns {{sedi:Array, capi:Array, fuori:number}} */
  function _capi(terminazioni, siteOf) {
    const capi = [];
    const perSede = new Map();
    let fuori = 0;
    for (const t of terminazioni) {
      if (!t.holder) { fuori++; continue; }
      const sede = siteOf(t.holder);
      if (!sede || sede.id == null) { fuori++; continue; }
      const k = String(sede.id);
      if (!perSede.has(k)) perSede.set(k, { site: sede, capo: t });
      capi.push({ ...t, site: sede });
    }
    return { sedi: [...perSede.values()], capi, fuori };
  }

  /**
   * I servizi L2 e i tunnel di NetBox → candidati «collegamento fra sedi».
   *
   * @param {{l2vpns?:Array, l2vpnTerminations?:Array, tunnels?:Array,
   *          tunnelTerminations?:Array, truncated?:boolean}} nb
   * @param {{siteIds?:Array, siteOf?:function, netsOf?:function}} [opts]
   *        `siteOf(holder)` → la sede NetBox di un capo (⑦).
   *        `netsOf(holder)` → le reti che l'archivio DICHIARA per quel capo (⑧):
   *        oggi solo una `ipam.vlan` ne ha, tramite i prefissi che la citano.
   *        `siteIds`: l'ambito, ricontrollato riga per
   *        riga — ⚠️ NetBox ignora un filtro che non conosce e risponde con
   *        TUTTO (misurato anche su `vpn/`: un filtro inventato torna tutto).
   * @returns {{links:Array, notes:Array, scopeHeld:boolean}}
   */
  function vpnToLinks(nb, opts) {
    const o = (nb && typeof nb === 'object') ? nb : {};
    const wanted = new Set(_list(opts && opts.siteIds).filter(x => x != null).map(String));
    const siteOf = (opts && typeof opts.siteOf === 'function') ? opts.siteOf : () => null;
    const netsOf = (opts && typeof opts.netsOf === 'function') ? opts.netsOf : () => null;
    const links = [];
    const notes = [];
    const nonAttivi = [];
    let fuoriAmbito = 0;
    let capiIrrisolti = 0;

    /** Le terminazioni per servizio, in forma neutra. */
    const _perServizio = (righe, chiaveServizio, campoOggetto, campoTipo) => {
      const m = new Map();
      for (const t of _list(righe)) {
        if (!t) continue;
        const s = t[chiaveServizio];
        const sid = s && (typeof s === 'object' ? s.id : s);
        if (sid == null) continue;
        const holder = _holder(t[campoTipo], t[campoOggetto]);
        const arr = m.get(String(sid)) || [];
        arr.push({
          holder,
          // ⚠️ Il RUOLO della terminazione (hub/spoke/peer) non si legge più:
          // serviva solo a dedurre una forma d'insieme sul singolo collegamento,
          // e quel campo non c'è più (㉒ di `lib/inter-site.js`). Resta scritto
          // in NetBox, dove è al suo posto: è una proprietà del capo.
          // ⚠️ In NetBox è un oggetto IPAM, quindi arriva con la maschera
          // (`203.0.113.1/32`). Il capo di un tunnel è un INDIRIZZO: la maschera
          // qui non dice niente e si trascinerebbe in un campo che si copia a
          // mano dentro una configurazione.
          outsideIp: _indirizzo(t.outside_ip && (t.outside_ip.address || t.outside_ip.display)),
        });
        m.set(String(sid), arr);
      }
      return m;
    };
    // ⚠️ Due nomi per la stessa cosa: una terminazione L2VPN appende il suo
    // oggetto a `assigned_object`, una di tunnel a `termination`. Non è un
    // capriccio di NetBox — sono due modelli diversi — ma qui si legge lo stesso
    // concetto, quindi il nome del campo è un PARAMETRO e non due funzioni.
    const termL2 = _perServizio(o.l2vpnTerminations, 'l2vpn', 'assigned_object', 'assigned_object_type');
    const termTun = _perServizio(o.tunnelTerminations, 'tunnel', 'termination', 'termination_type');

    /** Il pezzo comune ai due: due sedi, due capi, e le ragioni per cui no. */
    const _componi = (servizio, etichetta, stato, termini, kind, kindLabel, identifier) => {
      // ⚠️ `capi` non si legge più: serviva solo alla forma d'insieme dedotta
      // dai ruoli delle terminazioni, e quel campo non esiste più (㉒ di
      // `lib/inter-site.js`). I due capi che servono stanno dentro `sedi`.
      const { sedi, capi, fuori } = _capi(termini, siteOf);

      // ⚠️ L'AMBITO si guarda PER PRIMO, prima ancora dello stato. Leggendo le
      // linee di Trento non si deve sentir parlare di un tunnel pianificato che
      // tocca solo Verona: sarebbe la risposta a una domanda che nessuno ha
      // fatto, e per giunta su una sede che non si stava guardando. Stessa
      // sequenza dei circuiti (`lib/dcim-wan.js`).
      if (wanted.size && !sedi.some(s => wanted.has(String(s.site.id)))) { fuoriAmbito++; return; }
      if (fuori) capiIrrisolti += fuori;
      if (stato && stato !== 'active') { nonAttivi.push({ name: etichetta, status: stato }); return; }

      if (sedi.length === 1) {
        // ⚠️ «Tutti i capi in una sede sola» si può dire SOLO se sono stati
        // collocati tutti. Con un capo che non si è potuto ricondurre a una
        // sede, chiamarlo «servizio interno all'edificio» è una cosa FALSA
        // detta con sicurezza: quel capo esiste, non sappiamo dov'è.
        if (fuori) notes.push({ code: 'vpn.noSite', name: etichetta });
        else notes.push({ code: 'vpn.oneSite', name: etichetta, site: sedi[0].site.name });
        return;
      }
      if (sedi.length > 2) {
        // ④ Multipunto: un servizio solo, non N coppie.
        notes.push({ code: 'vpn.multipoint', name: etichetta, n: sedi.length, sites: sedi.map(s => s.site.name).slice(0, 4) });
        return;
      }
      if (sedi.length < 2) {
        notes.push({ code: 'vpn.noSite', name: etichetta });
        return;
      }

      const A = sedi[0], B = sedi[1];
      // ⑧ Le reti dichiarate presso una sede: UNIONE su tutti i capi che stanno lì,
      // in ordine di prima apparizione e senza doppioni. `null` se non ce n'è
      // nessuna — e non `[]`, che direbbe un'altra cosa.
      const _reteDi = (siteId) => {
        const viste = new Set();
        for (const c of capi) {
          if (!c.site || String(c.site.id) !== String(siteId)) continue;
          for (const n of _list(netsOf(c.holder))) {
            const v = _str(n);
            if (v) viste.add(v);
          }
        }
        return viste.size ? [...viste] : null;
      };
      links.push({
        aNetboxSiteId: A.site.id, aNetboxSiteName: A.site.name,
        bNetboxSiteId: B.site.id, bNetboxSiteName: B.site.name,
        // ㉔ L'ASSE lo dice la SORGENTE, e non c'è niente da indovinare: in
        // NetBox un `l2vpn` è ciò SU CUI il collegamento viaggia, un `tunnel' è
        // ciò che ci corre SOPRA. Sono due modelli separati con due vocabolari
        // chiusi, e l'import li leggeva già da due posti — poi li schiacciava
        // in un campo solo, e la metà che non entrava spariva.
        transport: servizio === 'l2vpn' ? kind : null,
        tunnel: servizio === 'l2vpn' ? null : kind,
        // ⑪ Il nome è quello del servizio, per OGNI natura. Non finisce in
        // `phase1Name` né in `service`: quelli sono altre due cose, e infilarci
        // il nome perché «ci sta» è come nasce un campo che mente.
        name: etichetta,
        transportLabel: (servizio === 'l2vpn' && kind === 'other') ? kindLabel : null,
        tunnelLabel: (servizio !== 'l2vpn' && kind === 'other') ? kindLabel : null,
        provider: null,
        circuitId: null,
        aDeviceName: A.capo.holder && A.capo.holder.name,
        bDeviceName: B.capo.holder && B.capo.holder.name,
        // ② Gli indirizzi si INCROCIANO: il peer di A è l'esterno di B.
        aPeerIp: B.capo.outsideIp || null,
        bPeerIp: A.capo.outsideIp || null,
        // ⑧ Le reti raggiungibili a ciascun capo, quando l'archivio le dichiara.
        // ⚠️ Qui NON si incrociano (a differenza degli indirizzi, ②): le reti di A
        // sono quelle che si raggiungono DA B passando di qui, cioè quelle che stanno
        // presso A — che è esattamente come le legge `linkReachAt`.
        aReach: _reteDi(A.site.id),
        bReach: _reteDi(B.site.id),
        source: servizio,
      });
      // ⑥ La nota sull'identificativo si dice SOLO se il collegamento è
      // entrato: parlare del VNI di un servizio che non è nemmeno diventato una
      // riga è rumore su una cosa che non c'è.
      if (identifier != null && _str(identifier)) {
        notes.push({ code: 'vpn.identifierNoField', name: etichetta, id: String(identifier) });
      }
    };

    // ── I servizi L2 ────────────────────────────────────────────────────────
    for (const l2 of _list(o.l2vpns)) {
      if (!l2 || l2.id == null) continue;
      const nome = _str(l2.name) || _str(l2.display);
      const stato = _choice(l2.status).value;
      const tipo = _choice(l2.type);
      const kind = L2VPN_KIND[tipo.value] || 'other';
      // ⑥ `service` resta VUOTO: è il servizio dell'OPERATORE, e NetBox non lo
      // conosce per un L2VPN. Il nome ha il suo campo (⑪); l'identificativo
      // (VNI / VC-ID) non ne ha uno, e si dice invece di comporlo dentro un altro.
      _componi('l2vpn', nome, stato, termL2.get(String(l2.id)) || [], kind, tipo.label || tipo.value, l2.identifier);
    }

    // ── I tunnel ────────────────────────────────────────────────────────────
    for (const tu of _list(o.tunnels)) {
      if (!tu || tu.id == null) continue;
      const nome = _str(tu.name) || _str(tu.display);
      const stato = _choice(tu.status).value;
      const inc = _choice(tu.encapsulation);
      const kind = TUNNEL_KIND[inc.value] || 'other';
      // ⚠️ `phase1Name` resta VUOTO: è il nome della phase 1 sull'apparato, e il
      // nome del tunnel in NetBox non è quello. Somigliarsi non è esserlo.
      _componi('tunnel', nome, stato, termTun.get(String(tu.id)) || [], kind, inc.label || inc.value, null);
    }

    if (nonAttivi.length) notes.push({ code: 'vpn.notActive', n: nonAttivi.length, rows: nonAttivi.slice(0, 20) });
    if (capiIrrisolti) notes.push({ code: 'vpn.endpointNoSite', n: capiIrrisolti });
    if (fuoriAmbito) notes.push({ code: 'vpn.outOfScope', n: fuoriAmbito });
    if (o.truncated) notes.push({ code: 'vpn.truncated' });

    return { links, notes, scopeHeld: fuoriAmbito === 0 };
  }

  /**
   * ⑧ I prefissi di NetBox → le reti dichiarate per ogni VLAN, pronte per
   * `netsOf`. Vive QUI e non nella rotta perche il suo modo di guastarsi e lo
   * ZERO SILENZIOSO: se sbaglia, «nessuna rete» si legge identico all onesto
   * «l archivio non lo dichiara» — cioe la risposta che questo lavoro doveva
   * togliere di mezzo. Una funzione che puo mentire cosi va dove ci sono le prove.
   *
   * ⚠️ Si salta il `deprecated`, e SOLO quello: e l unico stato con cui
   * l archivio RITIRA una propria affermazione, e ripeterlo come «raggiungibile»
   * vorrebbe dire citare una dichiarazione revocata. Un `container` invece resta:
   * e una FORMA di voce (una supernet), non uno stato, e chi l ha appesa a quella
   * VLAN l ha appesa apposta.
   * ⚠️ L ordine di NetBox si conserva: chi normalizza (`normalizeSubnets` in
   * `lib/inter-site.js`) ordina da se, e ordinare due volte con due regole
   * diverse e il modo di non sapere piu quale delle due vince.
   *
   * @param {Array} prefissi Le righe di `/api/ipam/prefixes/`.
   * @returns {Record<string,string[]>} idVlan → reti, senza chiave se non ne ha.
   */
  function netsByVlan(prefissi) {
    const out = Object.create(null);
    for (const p of _list(prefissi)) {
      if (!p || typeof p !== 'object') continue;
      const vid = p.vlan && typeof p.vlan === 'object' ? p.vlan.id : p.vlan;
      const rete = _str(p.prefix);
      if (vid == null || !rete) continue;
      const stato = _choice(p.status).value;
      if (stato === 'deprecated') continue;
      const k = String(vid);
      const arr = out[k] || (out[k] = []);
      if (arr.indexOf(rete) < 0) arr.push(rete);
    }
    return out;
  }

  return { vpnToLinks, netsByVlan, _holder, L2VPN_KIND, TUNNEL_KIND };
});
