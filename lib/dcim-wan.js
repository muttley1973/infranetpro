'use strict';
// ============================================================================
//  lib/dcim-wan.js — i CIRCUITI di NetBox → le linee WAN dell'organizzazione
// ----------------------------------------------------------------------------
//  Il layer multi-sede sapeva descrivere gli uplink WAN e i collegamenti fra le
//  sedi, ma nessuno li sapeva LEGGERE: si riempivano solo a mano. NetBox li
//  modella nella sua applicazione `circuits/`, che l'import non apriva affatto —
//  così una sede importata bene arrivava con zero linee, e la mappa inter-sede
//  sembrava ferma sulle sedi inserite prima.
//
//  Questo modulo fa UNA cosa: trasformare i circuiti in CANDIDATI. Non scrive,
//  non conosce l'organizzazione, non sa quali sedi esistano in InfraNet — così
//  si prova senza server, senza DOM e senza NetBox.
//
//  ── Le scelte, e perché ────────────────────────────────────────────────────
//
//   ① **`commit_rate` è l'unica banda che diventa `cirMbps`, e va diviso.**
//      NetBox la tiene in **kbps**; il modello la vuole in Mbps. Sulla stessa
//      terminazione c'è anche `port_speed`, ed è la trappola classica del
//      dominio: quella è la velocità della PORTA (l'`ifSpeed`), non la banda
//      contrattuale. Usarla come ripiego quando `commit_rate` manca scriverebbe
//      «100 Mbps garantiti» sopra una FTTH best-effort. Se manca, resta `null`
//      e lo si dice — un ripiego qui è un'affermazione falsa.
//
//   ② **Solo i circuiti ATTIVI diventano candidati.** Un `WanUplink` non ha un
//      campo stato: importare un circuito `planned` o `decommissioned` lo
//      renderebbe indistinguibile da una linea in esercizio, cioè affermerebbe
//      una cosa falsa senza poterla qualificare. Non si scartano in silenzio:
//      finiscono in `notes` con il loro stato, e chi li vuole li scrive a mano.
//
//   ③ **Un capo su una SEDE, l'altro no → è un uplink. Due sedi → è un
//      collegamento.** È la sola distinzione che i dati sostengono: NetBox dice
//      dove finisce il circuito, e non c'è niente da indovinare.
//
//   ④ **La NUVOLA d'operatore non diventa un collegamento.** Tredici circuiti
//      su ventinove, in un NetBox vero, finiscono su una `provider-network`
//      («Level3 MPLS»): sono sedi sulla stessa nuvola MPLS, non coppie di sedi
//      collegate. Trasformarle in adiacenze produrrebbe N·(N-1)/2 collegamenti
//      che nessuno ha dichiarato. Restano uplink, e il nome della nuvola viaggia
//      in `cloud` per essere DETTO — il modello non la sa rappresentare, e
//      questo si dichiara invece di simularlo.
//
//   ⑤ **Il `transport` di un collegamento non si deduce dal tipo di circuito.** Il
//      tipo in NetBox è testo libero dell'istanza («MPLS», «Dark Fiber», ma
//      anche «Fibra spenta» o «Collegamento di backup»): riconoscerlo per
//      stringa funzionerebbe su QUESTO archivio e su nessun altro — paletto ③.
//      Si usa `other` con `transportLabel` = le parole di chi ha documentato (scelta
//      ⑨ di `lib/inter-site.js`): il software sa di non sapere, e non perde il
//      nome. Cambiarlo in `mpls` è una tendina, e la decisione resta di chi sa.
//
//   ⑥ **L'apparato di un capo si passa per NOME, non per riferimento.** Il cavo
//      che dalla terminazione va all'interfaccia dice quale porta di quale
//      apparato è il capo WAN (`link_peers`). Il nome diventa un riferimento
//      solo se combacia con UN apparato del progetto di quella sede, e quella
//      regola è già scritta una volta sola nel pannello: qui si passa il nome e
//      basta, invece di scriverne una seconda copia che diverge.
//
//   ⑦ **Due forme di terminazione, non una.** Fino a NetBox 4.1 la terminazione
//      portava `site` e `provider_network` come campi propri; dalla 4.2 sono
//      diventati `termination_type` + `termination` (la stessa riorganizzazione
//      che aveva già spostato i MAC e l'ambito dei prefissi). Si leggono
//      entrambe: un archivio non si aggiorna perché noi abbiamo scritto il
//      lettore ieri.
//
//  UMD-lite: `<script>` in netmapper.html → global; in Node `require()`.
// ============================================================================
(function (root, factory) {
  // ⑱ Il vocabolario delle nature NON si riscrive qui: arriva da
  // `lib/inter-site.js`, che è dove vive. Una seconda copia di quell'elenco è
  // la definizione duplicata che in questo codice è già divergiuta dodici volte.
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const api = factory(isNode ? require('./inter-site.js') : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (IS) {
  'use strict';

  /** @param {unknown} v @returns {string|null} */
  function _str(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  }
  const _lc = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const _list = (v) => (Array.isArray(v) ? v : []);

  /** Il valore di un campo che NetBox serve ora nudo, ora come `{value,label}`. */
  function _enum(v) {
    if (v && typeof v === 'object') return _lc(v.value !== undefined ? v.value : v.label);
    return _lc(v);
  }

  /** Il nome di un oggetto annidato di NetBox (`name`, o `display` per chi non
   *  ha un nome proprio — le `provider-network` lo hanno, le sedi anche). */
  function _name(o) {
    if (!o || typeof o !== 'object') return null;
    return _str(o.name) || _str(o.display);
  }

  /** Lo SLUG di un oggetto NetBox. Per il tipo di circuito è l'identità: il
   *  nome si rinomina («MPLS» → «MPLS L3VPN»), lo slug no. */
  function _slug(o) {
    if (!o || typeof o !== 'object') return null;
    return _str(o.slug);
  }

  /** Un termine ridotto al suo nocciolo: minuscolo e senza punteggiatura. */
  const _token = (s) => String(s == null ? '' : s).toLowerCase().replace(/[-_\s]/g, '');

  /**
   * ⑱ **Le nature che uno slug può NOMINARE.** Costruita una volta dal
   * vocabolario vero. `other` è escluso di proposito: una natura «dichiarata»
   * che vale quanto il non aver dichiarato niente confonderebbe, a valle, «l'ha
   * detto NetBox» con «non lo sa nessuno».
   */
  const TRANSPORT_TOKEN = (() => {
    /** @type {Record<string,string>} */
    const m = Object.create(null);
    const nature = (IS && IS.INTER_SITE_TRANSPORTS) || [];
    for (const k of nature) { if (k !== 'other') m[_token(k)] = k; }
    return m;
  })();

  /**
   * ⑱ **La natura di un circuito, quando lo slug del tipo È già una natura.**
   *
   * Il tipo di un circuito è testo libero dell'istanza, quindi la natura non si
   * può DEDURRE dal nome: riconoscere «MPLS» per stringa funzionerebbe su un
   * archivio inglese e su nessun altro (paletto ③). Ma c'è un caso in cui non si
   * deduce niente — quando lo slug **è** una delle nostre nature. `mpls` non
   * somiglia a MPLS: `mpls` È `mpls`. È identità, non traduzione, e far
   * dichiarare a mano che `mpls` vuol dire MPLS sarebbe far compilare un modulo
   * per riscrivere la stessa parola.
   *
   * Il confronto ignora trattini, spazi bassi e maiuscole, e non è
   * un ammorbidimento: lo slug lo costruisce NetBox, e da «SD-WAN» tira fuori
   * `sd-wan` — la stessa parola con la punteggiatura del suo generatore. Si
   * confronta il termine, non la sua ortografia.
   *
   * ⚠️ Tutto il resto resta `other` con l'etichetta: `dark-fiber`, `internet`,
   * `fibra-spenta` non sono nature del nostro vocabolario, e avvicinarle alla più
   * somigliante sarebbe dire una cosa per un'altra. Chi documenta le corregge
   * sulla riga del collegamento, dove la tendina c'è già.
   */
  /** @param {string|null} slug @returns {string} */
  function _transportDaSlug(slug) {
    if (!slug) return 'other';
    return TRANSPORT_TOKEN[_token(slug)] || 'other';
  }

  /**
   * Che cosa c'è all'altro capo di questa terminazione, nelle DUE forme che
   * NetBox ha usato (⑦).
   * @returns {{what:'site'|'cloud'|'other'|'none', id:*, name:string|null, type:string|null}}
   */
  function _termTarget(t) {
    if (!t || typeof t !== 'object') return { what: 'none', id: null, name: null, type: null };
    // ⑦ Forma 4.2+: il tipo è dichiarato, l'oggetto arriva risolto in `termination`.
    const tt = _lc(t.termination_type || t.terminationType);
    if (tt) {
      const obj = t.termination || null;
      const id = (t.termination_id != null ? t.termination_id : (obj && obj.id));
      if (tt === 'dcim.site') return { what: 'site', id, name: _name(obj), type: tt };
      if (tt === 'circuits.providernetwork') return { what: 'cloud', id, name: _name(obj), type: tt };
      // Regione, gruppo di siti, ubicazione: NetBox li ammette, e non sono una
      // sede. Non si arrotondano alla sede più vicina — si dicono.
      return { what: 'other', id, name: _name(obj), type: tt };
    }
    // Forma ≤ 4.1: due campi distinti sulla terminazione.
    if (t.site) return { what: 'site', id: t.site.id, name: _name(t.site), type: 'dcim.site' };
    const pn = t.provider_network || t.providerNetwork;
    if (pn) return { what: 'cloud', id: pn.id, name: _name(pn), type: 'circuits.providernetwork' };
    return { what: 'none', id: null, name: null, type: null };
  }

  /** La porta WAN: il cavo dalla terminazione arriva su un'interfaccia, e quella
   *  interfaccia sta su un apparato. Solo `dcim.interface`: un capo su un
   *  pannello di permutazione non dice quale apparato è, e indovinarlo no. */
  function _wanPort(t) {
    if (!t) return null;
    if (_lc(t.link_peers_type || t.linkPeersType) !== 'dcim.interface') return null;
    const peer = _list(t.link_peers || t.linkPeers)[0];
    if (!peer) return null;
    const dev = _name(peer.device);
    const itf = _str(peer.name) || _str(peer.display);
    if (!dev && !itf) return null;
    return { deviceName: dev, ifaceName: itf };
  }

  /** La porta WAN come la scrive una persona: `MI-RTR-01/GigabitEthernet0/0/1`.
   *
   *  ⑥ **Il modello vuole UNA stringa, e questo modulo possiede la forma.** Il
   *  campo `wanIfRef` dell'uplink è un riferimento scritto — «su quale scatola e
   *  su quale porta arriva questa linea» — e comporlo qui, accanto a `_wanPort`
   *  che ne produce i pezzi, è ciò che impedisce a chi consuma di inventarsi un
   *  formato suo. La barra è la convenzione già in uso nel repo per «apparato +
   *  porta» (`lib/drawio-export.js`), non una scelta nuova.
   *  ⚠️ Un capo solo si scrive da solo: un'interfaccia senza apparato, o un
   *  apparato di cui NetBox non dà l'interfaccia, restano un riferimento
   *  parziale ma vero. Cucirci accanto un pezzo che non c'è sarebbe inventarlo.
   *  @param {{deviceName?:string|null, ifaceName?:string|null}|null} porta
   *  @returns {string|null} */
  function wanPortLabel(porta) {
    if (!porta) return null;
    const dev = _str(porta.deviceName);
    const itf = _str(porta.ifaceName);
    if (dev && itf) return dev + '/' + itf;
    return dev || itf || null;
  }

  /** kbps → Mbps (①). `null` resta `null`: nessun ripiego su `port_speed`. */
  function _cirMbps(kbps) {
    const n = Number(kbps);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round((n / 1000) * 1000) / 1000;
  }

  /**
   * I circuiti di NetBox → candidati per il layer multi-sede.
   *
   * @param {{circuits?:Array, circuitTerminations?:Array, truncated?:boolean}} nb
   * @param {{siteIds?:Array}} [opts] gli id dei siti NetBox in ambito. Presenti →
   *   ⚠️ **cintura**: NetBox IGNORA un filtro di query che non conosce e
   *   risponde con TUTTO l'archivio (misurato: un filtro inventato torna 29
   *   circuiti su 29). Qui si ricontrolla riga per riga invece di fidarsi.
   * @returns {{uplinks:Array, links:Array, notes:Array, types:Array, scopeHeld:boolean}}
   */
  function circuitsToWan(nb, opts) {
    const o = (nb && typeof nb === 'object') ? nb : {};
    const wanted = new Set(_list(opts && opts.siteIds).filter(x => x != null).map(String));
    // Il CENSIMENTO dei tipi di circuito incontrati: quanti circuiti per tipo,
    // quanti di quelli sono diventati un collegamento fra sedi, e in che natura.
    // È il verbale di ciò che ⑱ decide da sé, e senza quello la decisione
    // sarebbe invisibile a chi legge l'esito.
    /** @type {Map<string,{slug:string|null, name:string|null, n:number, nLinks:number, transport:string}>} */
    const tipi = new Map();
    const uplinks = [];
    const links = [];
    const notes = [];
    const nonAttivi = [];
    const nuvole = [];
    let senzaCir = 0;
    let fuoriAmbito = 0;

    // Le terminazioni lette a parte battono quelle annidate nel circuito: solo
    // loro portano il cavo e quindi la porta WAN (⑥). Quelle annidate restano
    // il ripiego per chi legge il solo elenco dei circuiti.
    const perCircuito = new Map();
    for (const t of _list(o.circuitTerminations)) {
      if (!t || t.id == null) continue;
      const cid = t.circuit && t.circuit.id;
      if (cid == null) continue;
      const side = _lc(t.term_side || t.termSide) === 'z' ? 'z' : 'a';
      const cur = perCircuito.get(String(cid)) || {};
      cur[side] = t;
      perCircuito.set(String(cid), cur);
    }

    for (const c of _list(o.circuits)) {
      if (!c || c.id == null) continue;
      const cid = _str(c.cid) || _str(c.display);
      const lette = perCircuito.get(String(c.id)) || {};
      const tA = lette.a || c.termination_a || c.terminationA || null;
      const tZ = lette.z || c.termination_z || c.terminationZ || null;
      const A = _termTarget(tA);
      const Z = _termTarget(tZ);

      // Cintura d'ambito (⚠️ vedi il commento su `opts.siteIds`).
      if (wanted.size) {
        const tocca = (x) => x.what === 'site' && x.id != null && wanted.has(String(x.id));
        if (!tocca(A) && !tocca(Z)) { fuoriAmbito++; continue; }
      }

      // ② Uno stato che non è «attivo» non entra: il modello non saprebbe dirlo.
      const stato = _enum(c.status);
      if (stato && stato !== 'active') {
        nonAttivi.push({ circuitId: cid, status: stato });
        continue;
      }

      const provider = _name(c.provider);
      const tipo = _name(c.type) || _name(c.circuit_type);
      const tipoSlug = _slug(c.type) || _slug(c.circuit_type);
      const transport = _transportDaSlug(tipoSlug);
      // ⚠️ `nLinks` si conta a parte, e non è un doppione di `n`: la natura si
      // decide SOLO per un collegamento fra due sedi. Su una linea WAN il tipo
      // finisce tale e quale in `serviceType` e nessuno sceglie niente, quindi
      // scrivere «letto come MPLS» accanto a dodici uplink racconterebbe una
      // decisione mai presa. Chi legge l'esito ha bisogno dei due numeri.
      let voce = null;
      if (tipoSlug || tipo) {
        const k = tipoSlug || ('~' + tipo);
        voce = tipi.get(k);
        if (voce) voce.n++;
        else { voce = { slug: tipoSlug, name: tipo, n: 1, nLinks: 0, transport }; tipi.set(k, voce); }
      }
      const cir = _cirMbps(c.commit_rate !== undefined ? c.commit_rate : c.commitRate);

      const capiSede = [A, Z].filter(x => x.what === 'site' && x.id != null);
      const nonSede = [A, Z].filter(x => x.what === 'other');
      for (const x of nonSede) notes.push({ code: 'wan.terminationNotSite', circuitId: cid, type: x.type, name: x.name });

      if (capiSede.length === 2) {
        if (String(capiSede[0].id) === String(capiSede[1].id)) {
          // Un circuito con i due capi nello stesso sito non è inter-sede, e
          // nemmeno un uplink: si dice, non si arrotonda.
          notes.push({ code: 'wan.sameSite', circuitId: cid, site: capiSede[0].name });
          continue;
        }
        const portA = _wanPort(tA);
        const portZ = _wanPort(tZ);
        if (voce) voce.nLinks++;
        links.push({
          aNetboxSiteId: capiSede[0].id, aNetboxSiteName: capiSede[0].name,
          bNetboxSiteId: capiSede[1].id, bNetboxSiteName: capiSede[1].name,
          // ⑤ La natura NON si deduce dal nome del tipo, che è testo libero.
          // O lo SLUG è già una delle nostre nature (⑱: identità, non lettura del
          // nome), o resta `other` — e allora il nome del tipo diventa
          // l'etichetta, che è l'unica cosa che quel circuito aveva da dire di sé.
          transport,
          transportLabel: transport === 'other' ? tipo : null,
          provider,
          circuitId: cid,
          aDeviceName: portA && portA.deviceName,       // ⑥ nome, non riferimento
          bDeviceName: portZ && portZ.deviceName,
        });
        continue;
      }

      if (capiSede.length === 1) {
        const sede = capiSede[0];
        const altro = (A === sede) ? Z : A;
        const porta = _wanPort(A === sede ? tA : tZ);
        if (altro.what === 'cloud' && altro.name && nuvole.indexOf(altro.name) < 0) nuvole.push(altro.name);
        // ⚠️ Si conta SOLO qui: la banda garantita è un campo dell'uplink, e un
        // collegamento fra sedi non ce l'ha. Contarlo anche là direbbe «resta
        // vuoto» di un campo che non esiste — un avviso che non si può togliere.
        if (cir == null) senzaCir++;
        uplinks.push({
          netboxSiteId: sede.id,
          netboxSiteName: sede.name,
          provider,
          serviceType: tipo,
          circuitId: cid,
          cirMbps: cir,
          // ④ la nuvola si DICE, perché il modello non la sa tenere
          cloud: altro.what === 'cloud' ? altro.name : null,
          wanPort: porta,
          // La stessa porta, già scritta come la vuole il modello (`wanIfRef`):
          // i pezzi restano in `wanPort` per chi deve ragionarci, la stringa
          // serve a chi la deve solo mettere in un campo — e nasce QUI, così
          // non se la compone ciascuno a modo suo.
          wanIf: wanPortLabel(porta),
        });
        continue;
      }

      // Nessun capo su una sede: non è una linea di nessuna sede. Con l'ambito
      // attivo non ci si arriva (la cintura l'ha già tolto); senza, capita.
      notes.push({ code: 'wan.noSite', circuitId: cid });
    }

    if (nonAttivi.length) notes.push({ code: 'wan.notActive', n: nonAttivi.length, rows: nonAttivi.slice(0, 20) });
    if (nuvole.length) notes.push({ code: 'wan.cloudNotModelled', clouds: nuvole });
    if (senzaCir) notes.push({ code: 'wan.cirMissing', n: senzaCir });
    if (fuoriAmbito) notes.push({ code: 'wan.outOfScope', n: fuoriAmbito });
    if (o.truncated) notes.push({ code: 'wan.truncated' });

    return {
      uplinks,
      links,
      notes,
      // ⑱ I tipi di circuito incontrati: quanti circuiti ciascuno, quanti di
      // quelli sono diventati un collegamento fra sedi, e in che natura. È il
      // verbale di una decisione che il software prende da sé — senza, resta
      // invisibile. Ordinato per nome: chi lo legge deve trovare la riga
      // dov'era ieri, e due letture uguali devono dare lo stesso elenco.
      types: Array.from(tipi.values()).sort((a, b) =>
        String(a.name || a.slug || '').localeCompare(String(b.name || b.slug || ''))),
      // Il filtro d'ambito ha davvero morso? `false` vuol dire che la cintura ha
      // dovuto scartare righe che NetBox non avrebbe dovuto mandare.
      scopeHeld: fuoriAmbito === 0,
    };
  }

  return { circuitsToWan, wanPortLabel, _termTarget, _wanPort, _cirMbps, _transportDaSlug, TRANSPORT_TOKEN };
});
