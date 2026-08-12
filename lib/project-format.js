(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const PROJECT_STATE_SCHEMA_VERSION = 1;
  const PORTABLE_EXPORT_FORMAT = 'infranet-project-export';

  function _clone(value) {
    try { return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {})); }
    catch (_) { return {}; }
  }

  function _redactBag(bag) {
    if (!bag || typeof bag !== 'object') return;
    for (const key of ['community', 'v3authPass', 'v3privPass']) {
      if (Object.prototype.hasOwnProperty.call(bag, key)) bag[key] = '';
    }
  }

  function _stripBackupRef(value) {
    if (typeof root.stripRefCreds === 'function') return root.stripRefCreds(value);
    const text = String(value == null ? '' : value).trim();
    return text
      .replace(/(:\/\/)[^/@\s]+:[^@\s]*@/, '$1')
      .replace(/^[A-Za-z0-9._-]+:(?:[^@\s\\/][^@\s\\]*)?@(?=[A-Za-z0-9.-]+[:/])/, '');
  }

  function sanitizePortableState(state) {
    const out = _clone(state);
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
        // L'export porta il DOCUMENTO, non le misure. La presenza (`node.proof`) è
        // una fotografia di un istante su UNA rete: chi apre questo file altrove
        // non deve ereditare i rossi di un impianto che non ha davanti — chiede la
        // propria Verifica. Si lavora su un clone: lo stato vivo non viene toccato.
        delete node.proof;
        _redactBag(node.integration);
        if (node.backup && typeof node.backup === 'object' && typeof node.backup.ref === 'string') {
          node.backup.ref = _stripBackupRef(node.backup.ref);
        }
        if (Array.isArray(node.vms)) {
          for (const vm of node.vms) {
            if (!vm || typeof vm !== 'object') continue;
            _redactBag(vm.integration);
            _redactBag(vm.snmp);
          }
        }
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
  };
});
