(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // 1 -> 2: la subnet smette di essere un campo della VLAN. `ipam.prefixes[]`
  // diventa l'autorita' e la VLAN un riferimento facoltativo (lib/ipam-model.js).
  // La migrazione e' a senso unico e idempotente, e gira al load in _migrateState:
  // un progetto in formato 1 si apre e si comporta identico, e si scrive in 2 al
  // primo salvataggio.
  const PROJECT_STATE_SCHEMA_VERSION = 2;
  const PORTABLE_EXPORT_FORMAT = 'infranet-project-export';

  function _clone(value) {
    try { return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {})); }
    catch (_) { return {}; }
  }

  // ⚠️ IL PAVIMENTO delle credenziali — scritto a mano APPOSTA.
  // Nel browser la classifica arriva da un `<script>` che `netmapper.html` carica
  // PRIMA di questo file: se un giorno qualcuno riordinasse i tag, `_schema` non
  // avrebbe `fieldsOfClass` e la redazione derivata non svuoterebbe NIENTE. Questi
  // tre si svuotano comunque. Non e' un ripiego che afferma qualcosa di falso:
  // garantisce un minimo, e si UNISCE alla classifica invece di sostituirla.
  // `test/project-schema.test.js` pretende che ognuno dei tre risulti `secret` nello
  // scope `integration`, cosi' il pavimento non puo' restare indietro in silenzio —
  // e' la stessa guardia che tiene allineato `DERIVED_VLAN_FIELDS`.
  const SECRET_FLOOR_FIELDS = ['community', 'v3authPass', 'v3privPass'];

  // I nomi delle credenziali si DICHIARANO in un posto solo (lib/project-schema.js,
  // scope `integration`). Qui si chiedono. Prima erano un elenco qui e un secondo
  // elenco identico in `server/routes/projects.js`, che adesso importa questa
  // funzione: un campo segreto nuovo si classifica una volta e sparisce da tutti e
  // due i posti — e dalle prove, che chiedono allo stesso schema.
  function _secretFields() {
    const declared = (_schema && typeof _schema.fieldsOfClass === 'function')
      ? _schema.fieldsOfClass('integration', 'secret') : [];
    if (!declared.length) return SECRET_FLOOR_FIELDS;
    return Array.from(new Set(declared.concat(SECRET_FLOOR_FIELDS)));
  }

  /** Svuota le credenziali di UN sacchetto (`node.integration`, `vm.integration`,
   *  il legacy `vm.snmp`). Svuota, non toglie: la forma resta, cosi' chi riapre vede
   *  che il campo esiste e va rimesso. Ritorna quanti ne ha svuotati. */
  function redactSecretBag(bag) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return 0;
    let blanked = 0;
    for (const key of _secretFields()) {
      if (Object.prototype.hasOwnProperty.call(bag, key)) { bag[key] = ''; blanked++; }
    }
    return blanked;
  }

  // La classifica dei campi (lib/project-schema.js): in Node si richiede, nel
  // browser arriva dal <script> che netmapper.html carica PRIMA di questo file.
  // ⚠️ Per questo `project-schema` è un `.js` e non un `.ts`: l'export portatile
  //    si costruisce LATO CLIENT (unico chiamante: export.js) e un `.ts` al
  //    browser arriva solo dal bundle `src/`. Motivazione per esteso in cima a
  //    lib/project-schema.js.
  const _schema = (typeof module !== 'undefined' && module.exports)
    ? require('./project-schema.js') : root;

  function _exportAction(scope, key) {
    return (_schema && typeof _schema.exportActionFor === 'function')
      ? _schema.exportActionFor(scope, key)
      : 'keep';   // classifica assente: non si butta via il campo di nessuno
  }

  // Applica la classifica a UN contenitore: toglie le misure/derivati/privati,
  // svuota le credenziali, lascia stare tutto il resto (compreso ciò che non è
  // classificato). Ritorna quanti campi ha tolto.
  function _applyFieldClasses(scope, bag) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return 0;
    let dropped = 0;
    for (const key of Object.keys(bag)) {
      const action = _exportAction(scope, key);
      if (action === 'drop') { delete bag[key]; dropped++; }
      else if (action === 'blank') redactSecretBag(bag[key]);
    }
    return dropped;
  }

  function _stripBackupRef(value) {
    if (typeof root.stripRefCreds === 'function') return root.stripRefCreds(value);
    const text = String(value == null ? '' : value).trim();
    return text
      .replace(/(:\/\/)[^/@\s]+:[^@\s]*@/, '$1')
      .replace(/^[A-Za-z0-9._-]+:(?:[^@\s\\/][^@\s\\]*)?@(?=[A-Za-z0-9.-]+[:/])/, '');
  }

  // L'export porta il DOCUMENTO, non le misure — e ora per COSTRUZIONE, non a
  // memoria. Prima era una blocklist: si elencava cosa togliere, e un campo
  // misurato nuovo usciva finché qualcuno non si ricordava di aggiungerlo alla
  // lista (è già successo). Il censimento del 28/08/2026 su 13 progetti veri ne
  // ha contati **41** che uscivano senza doverlo.
  //
  // Due strati, di proposito:
  //   ① IL PAVIMENTO — scritto qui a mano, esplicito, e indipendente dalla
  //      classifica. Se `lib/project-schema.js` un giorno non fosse caricato,
  //      l'export resterebbe comunque non-peggiore di com'era prima che la
  //      classifica esistesse. Una rete di sicurezza non è un ripiego: non
  //      afferma niente di falso, garantisce solo un minimo.
  //   ② LA CLASSIFICA — toglie tutto ciò che è `measure`/`derived`/`private` e
  //      svuota i `secret`, per ogni contenitore. Un campo NON classificato si
  //      TIENE: non si butta via il dato di qualcuno perché non era previsto.
  //      A rendere rumoroso il buco ci pensa `test/project-schema.test.js`.
  function sanitizePortableState(state) {
    const out = _clone(state);

    // ── ① Il pavimento ─────────────────────────────────────────────────────
    // Le osservazioni di scoperta seguono la presenza: sono ciò che ha visto la
    // rete di CHI esporta, non documentazione. Chi apre il file altrove parte dal
    // documento e misura la propria.
    delete out.discoveryHistory;
    stripDerivedVlan(out);   // e nemmeno i derivati: si ricalcolano al primo render
    // ⚠️ Il giornale delle modifiche esce anche per RISERVATEZZA, non solo per
    // coerenza: contiene gli username di chi ha lavorato al documento, e un export
    // finisce in mano a qualcun altro. La storia interna resta interna.
    delete out.auditLog;
    if (Array.isArray(out.nodes)) {
      for (const node of out.nodes) {
        if (!node || typeof node !== 'object') continue;
        // La presenza (`node.proof`) è una fotografia di un istante su UNA rete:
        // chi apre questo file altrove non deve ereditare i rossi di un impianto
        // che non ha davanti — chiede la propria Verifica. Si lavora su un clone:
        // lo stato vivo non viene toccato.
        delete node.proof;
        redactSecretBag(node.integration);
        if (node.backup && typeof node.backup === 'object' && typeof node.backup.ref === 'string') {
          node.backup.ref = _stripBackupRef(node.backup.ref);
        }
        // Le VM non hanno (ancora) una classifica propria: i loro campi restano,
        // e si tolgono solo le credenziali. Meglio un contenitore non ancora
        // classificato che una classifica inventata.
        if (Array.isArray(node.vms)) {
          for (const vm of node.vms) {
            if (!vm || typeof vm !== 'object') continue;
            redactSecretBag(vm.integration);
            redactSecretBag(vm.snmp);
          }
        }
      }
    }

    // ── ② La classifica ────────────────────────────────────────────────────
    _applyFieldClasses('state', out);
    if (Array.isArray(out.nodes)) {
      for (const node of out.nodes) {
        if (!node || typeof node !== 'object') continue;
        _applyFieldClasses('node', node);
        _applyFieldClasses('spec', node.spec);
      }
    }
    if (Array.isArray(out.links)) {
      for (const link of out.links) _applyFieldClasses('link', link);
    }
    if (out.ports && typeof out.ports === 'object' && !Array.isArray(out.ports)) {
      for (const pid of Object.keys(out.ports)) {
        const port = out.ports[pid];
        if (!port || typeof port !== 'object') continue;
        if (!_applyFieldClasses('port', port)) continue;
        // Stessa regola di `stripDerivedVlan`, e per lo stesso motivo: il record
        // si toglie SOLO se lo abbiamo svuotato noi. Due lettori usano la
        // PRESENZA della chiave e non il contenuto (`hasPorts` in
        // src/app-autolink.js e server/ai/context.js), quindi una porta che
        // conteneva solo misure non deve lasciare un guscio vuoto dietro di sé.
        if (!Object.keys(port).length) delete out.ports[pid];
      }
    }
    return out;
  }

  function createPortableProjectExport(state, meta) {
    const portableState = sanitizePortableState(state);
    const rawVersion = Number(portableState.schemaVersion);
    const schemaVersion = Number.isInteger(rawVersion) && rawVersion > 0
      ? rawVersion : PROJECT_STATE_SCHEMA_VERSION;
    const out = {
      format: PORTABLE_EXPORT_FORMAT,
      schemaVersion,
      exportedAt: new Date().toISOString(),
      state: portableState,
    };
    if (meta && meta.projectId != null && String(meta.projectId).trim()) out.projectId = String(meta.projectId);
    if (meta && meta.projectName != null && String(meta.projectName).trim()) out.projectName = String(meta.projectName).trim();
    return out;
  }

  function unwrapProjectState(payload) {
    if (payload && typeof payload === 'object' && payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)) {
      return payload.state;
    }
    return payload;
  }

  function isProjectState(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.nodes) && Array.isArray(value.racks));
  }

  // Campi che una versione precedente scriveva nel progetto e che non legge
  // NESSUNO: si tolgono all'apertura, cosi' il documento se ne libera al primo
  // salvataggio successivo (stessa meccanica di pruneDiscoveryHistory).
  //
  // ⚠️ Elenco CHIUSO e verificato, non un'euristica: prima di aggiungere una voce
  // si cercano i lettori in src/, lib/, server/, drivers/, index.html e modules/.
  // «Non lo legge nessuno OGGI» non basta: una chiave esterna verso il sistema
  // d'origine (source.deviceId, link.sourceCableId) serve al ri-allineamento anche
  // se nessuno la rilegge ancora, e resta.
  //
  // ── Cosa NON esce, e perché (censimento 2026-08-12, misurato) ────────
  // Dopo presenza / osservazioni / VLAN derivate / giornale, il peso residuo
  // della MISURA nel documento è tutto qui — e resta dov'è, per due ragioni
  // che non sono il peso:
  //
  // ① LETTORI INVISIBILI AL GREP. `modules/governance` è il modulo a pagamento,
  //    repo separato: `modules/governance/lib/asset-register.js` legge
  //    `snmpStatus`, `lastSeen`, `identityConfidence` e `ports[pid].mac` per il
  //    Registro asset. Un grep sul repo pubblico NON li vede. Stessa famiglia
  //    `ipHistory`/`firstSeen`/`identity*` (promemoria NIS2: «NON TOCCARE»).
  //    Prima di dichiarare morto un campo di identità o di stato: cercarlo
  //    anche in modules/.
  //
  // ② UN CAMPO CHE NON SA DI ESSERE UNA MISURA. `ports[pid].status` (~30 KB sui
  //    progetti veri, il pezzo più grosso rimasto) lo scrivono TRE sorgenti con
  //    tre significati diversi: l'utente che tira un cavo (app-pointer,
  //    app-cabling-editor, app-shared-segment → 'active' = dichiarazione),
  //    l'import NetBox (dcim-map: enabled/connected = dichiarazione del DCIM) e
  //    il poll SNMP (app-snmp, app-drift = misura vera). Idem `trunkVlans` e
  //    `isTrunk`. Spostarli in un sidecar butterebbe fuori dal documento anche
  //    le due dichiarazioni: non è un problema di peso ma di MODELLO — manca la
  //    provenienza per-campo. Finché non c'è, restano nel documento.
  //
  // `topoCache` è una misura (vicini LLDP/CDP) ma la legge la Panoramica
  // (lib/overview.js) e pesa 1,3 KB in tutto: un quinto sidecar non si ripaga.
  const OBSOLETE_PORT_FIELDS = [
    // 2.8.0 — l'import DCIM marcava ogni porta copper/fiber. Il tipo di media che
    // il render usa davvero viaggia in `mediaOptions` + `frontPanel`.
    'physicalKind',
  ];
  const OBSOLETE_NODE_FIELDS = [
    // Briciola di diagnostica della scoperta: si rileggeva solo da se' stessa.
    // Il «da dove viene questa identita'» mostrato all'utente e' `identitySource`.
    'lastDiscoveryMatch',
    // 2.8.2 — montaggio della PDU: InfraNet la disegna solo in ORIZZONTALE, e il
    // campo offriva «Verticale 0U» (per giunta come predefinito) promettendo un
    // montaggio che il render non sa fare. Tolto dal pannello, dal dossier e
    // dall'export: qui si toglie anche dai progetti che se lo portano dietro.
    'pduOrientation',
  ];

  // ── Propagazione VLAN: derivata, non documento ──────────────────────
  // `propagateVlans()` (src/app-vlan-autopoll.js) CANCELLA e ricalcola questi tre
  // campi a ogni render, partendo dalle VLAN dichiarate e dal grafo dei cavi, e
  // gira dentro `renderAll`. Nel file non servono: al primo disegno dopo il
  // caricamento sono già stati riscritti da zero.
  //
  // ⚠️ E non è solo peso. Il render CREA record di porta per gli estremi di cavo
  // che non ne hanno: misurato su una rete da 500 apparati, **159 record nuovi
  // contenenti il solo `vlanProp`** (751 → 910 porte, +5% di file). Senza questa
  // ripulitura, GUARDARE un progetto ne cambiava il contenuto salvato — un render
  // che scrive nel documento, la famiglia di bug più insidiosa che abbiamo.
  //
  // Il record si toglie SOLO se lo abbiamo svuotato noi: due lettori usano la
  // PRESENZA della chiave e non il contenuto — `hasPorts` in src/app-autolink.js
  // (salta l'inventario SNMP se il nodo ha già porte) e server/ai/context.js, che
  // enumera `state.ports` leggendolo dal file salvato.
  const DERIVED_VLAN_FIELDS = ['vlanProp', 'trunkProp', 'isTrunkProp'];

  function stripDerivedVlan(state) {
    if (!state || !state.ports || typeof state.ports !== 'object' || Array.isArray(state.ports)) return 0;
    let stripped = 0;
    for (const pid of Object.keys(state.ports)) {
      const port = state.ports[pid];
      if (!port || typeof port !== 'object') continue;
      let touched = false;
      for (const key of DERIVED_VLAN_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(port, key)) { delete port[key]; touched = true; }
      }
      if (!touched) continue;
      stripped++;
      if (!Object.keys(port).length) delete state.ports[pid];   // era solo derivato
    }
    return stripped;
  }

  function dropObsoleteFields(state) {
    if (!state || typeof state !== 'object') return 0;
    let dropped = 0;
    if (Array.isArray(state.nodes)) {
      for (const node of state.nodes) {
        if (!node || typeof node !== 'object') continue;
        // ⚠️ Un campo di apparato vive in DUE posti: sul nodo e in `node.spec`
        // (vedi [[spec-fields-custom-value]]). Ripulire solo il primo lascerebbe
        // meta' del morto in giro, e sarebbe la meta' che i lettori guardano.
        for (const bag of [node, node.spec]) {
          if (!bag || typeof bag !== 'object') continue;
          for (const key of OBSOLETE_NODE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(bag, key)) { delete bag[key]; dropped++; }
          }
        }
      }
    }
    if (state.ports && typeof state.ports === 'object' && !Array.isArray(state.ports)) {
      for (const pid of Object.keys(state.ports)) {
        const port = state.ports[pid];
        if (!port || typeof port !== 'object') continue;
        for (const key of OBSOLETE_PORT_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(port, key)) { delete port[key]; dropped++; }
        }
      }
    }
    return dropped;
  }

  function pruneProjectStateCaches(state) {
    if (!state || typeof state !== 'object') return state;
    const nodeIds = new Set(Array.isArray(state.nodes) ? state.nodes.map(node => String(node && node.id || '')) : []);
    if (state.topoCache && typeof state.topoCache === 'object' && !Array.isArray(state.topoCache)) {
      for (const id of Object.keys(state.topoCache)) if (!nodeIds.has(id)) delete state.topoCache[id];
    }
    return state;
  }

  return {
    PROJECT_STATE_SCHEMA_VERSION,
    PORTABLE_EXPORT_FORMAT,
    sanitizePortableState,
    createPortableProjectExport,
    unwrapProjectState,
    isProjectState,
    pruneProjectStateCaches,
    dropObsoleteFields,
    stripDerivedVlan,
    OBSOLETE_PORT_FIELDS,
    OBSOLETE_NODE_FIELDS,
    DERIVED_VLAN_FIELDS,
    redactSecretBag,
    SECRET_FLOOR_FIELDS,
  };
});
