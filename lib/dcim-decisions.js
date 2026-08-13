// ============================================================
// DECISIONI DI RICONCILIAZIONE — dall'anteprima import DCIM al pannello
// ============================================================
// Trasforma gli avvisi STRUTTURATI del mapper (report.issues, vedi lib/dcim-map.js)
// in ciò che l'utente deve davvero fare: un elenco di DECISIONI, non di eventi.
//
// La regola che governa tutto: **una riga = una decisione, mai un apparato**. Se
// tredici switch hanno lo stesso problema è UNA scelta applicata a tredici, non
// tredici avvisi identici — che è esattamente ciò che il pannello mostrava prima.
//
// Qui non esiste una sola stringa da leggere a schermo: questa libreria emette
// CODICI (`code`, `option`, `severity`) e i dati per comporre il testo. Le parole
// vivono in lib/i18n.js. È il confine che impedisce il ritorno del bug originale,
// dove il motore scriveva una frase e l'interfaccia la ri-parsava con una regex.
//
// ── INPUT ────────────────────────────────────────────────────────────────────
//   report = { issues:[{code,...}], counts:{devices,cables,vlans,racks,...},
//              issuesTotal?:number }
//   chosen = { 'ports.overTemplate': 'useNetbox', … }   // scelte dell'utente
//
// ── OUTPUT ───────────────────────────────────────────────────────────────────
//   { outcome:  { devices, cables, vlans, racks, costs:[{code,severity,n}] },
//     decisions:[ { code, severity:'choice', count, devices:[{id,name}], models:[],
//                   data:{}, options:[{id,isDefault}], chosen } ],
//     info:     [ { code, severity:'info'|'loss', count, devices:[], sample:[] } ] }
//
// `outcome` è il preventivo: cosa otterrò se premo Importa adesso. Va letto per
// primo — è l'unica cosa che chi importa legge davvero.
// Condiviso browser + test (UMD-lite).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Catalogo: per ogni codice, che tipo di riga è e — se è una decisione — quali
  // alternative esistono e qual è il default. Il default NON è una preferenza
  // estetica: è il comportamento che l'import ha sempre avuto, così chi preme
  // Importa senza toccare nulla ottiene esattamente ciò che otteneva prima.
  //
  //   severity 'choice' → l'utente sceglie, e la scelta cambia l'esito
  //            'loss'   → non c'è alternativa e QUALCOSA NON ENTRA nel progetto
  //            'info'   → un limite dichiarato, nessuna perdita di documentazione
  const CATALOG = {
    // Nessuna porta va persa in nessuno dei due rami: si sceglie la DISPOSIZIONE del
    // frontale, non il conteggio (vedi il commento nel mapper).
    'ports.overTemplate': {
      severity: 'choice',
      options: ['keepCatalog', 'genericPanel'],
      def: 'keepCatalog',
    },
    // Un apparato NetBox `planned`/`staged`/`failed`/`decommissioning` entra come
    // quello in produzione, e nel documento non si distingue piu'. Il default resta
    // il comportamento storico (entrano tutti) perche' chi documenta un rollout ha
    // TUTTO in `planned` e un import vuoto sarebbe incomprensibile; ma ora la scelta
    // c'e', e i nomi si vedono comunque.
    'device.statusNotActive': {
      severity: 'choice',
      options: ['importAll', 'skipNotActive'],
      def: 'importAll',
    },
    'catalog.unmatched': { severity: 'info' },
    'catalog.ambiguous': { severity: 'choice', options: ['keepAuto'], def: 'keepAuto' },
    'role.unmapped': { severity: 'info' },
    'cable.skipped': { severity: 'loss' },
    // Fuori perimetro per scelta di prodotto (alimentazione, console, circuiti WAN):
    // non è un guasto, ma va DETTO — altrimenti «0 cavi non risolti» si legge come
    // «il cablaggio è tutto qui», mentre più della metà può essere restata fuori.
    'cable.outOfScope': { severity: 'info' },
    // Componenti che InfraNet non modella fuori dai PDU: non c'e' alternativa da
    // offrire, ma qualcosa di dichiarato in NetBox resta fuori → 'loss', in cima.
    'ports.consoleSkipped': { severity: 'loss' },
    'ports.powerSkipped': { severity: 'loss' },
    // ⚠️ 'device.tenantSkipped' RIMOSSA (2.8.2): diceva «il tenant non viene
    // mostrato», vero fino alla 2.8.0. Da quando c'e' il riquadro «Dichiarato dal
    // DCIM» il tenant si vede come ruolo, stato e platform — che una riga non ce
    // l'hanno — e questa sezione dichiara LIMITI: tenerla significava stampare un
    // limite inesistente in cima a ogni import.
    'stack.nameConflict': { severity: 'info' },
    'vlan.collapsed': { severity: 'info' },
    // Le due righe sui prefissi dicono cosa ENTRA, non cosa resta fuori: fino alla
    // 2.8.x le reti senza VLAN sparivano e la seconda rete di una VLAN cancellava
    // la prima. Sono 'info' perche' ora non si perde niente e non c'e' da scegliere.
    'prefix.noVlan': { severity: 'info' },
    'prefix.multiPerVlan': { severity: 'info' },
    // Indirizzi dichiarati in NetBox ma agganciati a nessun apparato: non entrano
    // e non c'e' un'alternativa da offrire, ma «Indirizzi IP 0» accanto a
    // «Prefissi 90» si legge come un guasto. 'info' e non 'loss': non si perde
    // niente che InfraNet sappia documentare — un indirizzo senza apparato non ha
    // una casa nel modello. Si dichiara il confine, non una perdita.
    'ip.unassigned': { severity: 'info' },
    'pdu.outletsCapped': { severity: 'info' },
    'pdu.mgmtCapped': { severity: 'info' },
    'rack.missing': { severity: 'info' },
  };

  // Ordine di lettura: prima ciò che si perde, poi ciò che si sceglie, infine ciò
  // che informa e basta. Dentro lo stesso livello vince chi tocca più apparati.
  const SEV_RANK = { loss: 0, choice: 1, info: 2 };

  function _s(x) { return (x == null) ? '' : String(x); }
  function _n(x) { return Number.isFinite(+x) ? +x : 0; }

  function buildDecisions(report, chosen) {
    report = report || {};
    chosen = chosen || {};
    const issues = Array.isArray(report.issues) ? report.issues.filter(Boolean) : [];
    const counts = report.counts || {};

    // Raggruppa per codice conservando i dati che servono a scrivere la riga.
    const byCode = new Map();
    for (const issue of issues) {
      const code = _s(issue.code);
      if (!code) continue;
      let g = byCode.get(code);
      if (!g) {
        g = { code, count: 0, devices: [], models: [], roles: [], kinds: [], cables: [], sample: [], data: {}, _models: new Set(), _roles: new Set(), _kinds: new Set(), _seen: new Set(), _sample: new Set() };
        byCode.set(code, g);
      }
      g.count++;
      if (issue.deviceId != null && !g._seen.has(issue.deviceId)) {
        g._seen.add(issue.deviceId);
        // Il NOME, non l'id NetBox: chi decide deve riconoscere l'apparato. Se il
        // nome manca il mapper ha già scelto un ripiego leggibile.
        g.devices.push({ id: issue.deviceId, name: _s(issue.deviceName) || ('#' + issue.deviceId) });
      }
      if (issue.cableId != null) g.cables.push(issue.cableId);
      // Valori distinti: la riga dice «modelli: A, B», non li ripete N volte.
      const model = _s(issue.model);
      if (model && !g._models.has(model)) { g._models.add(model); g.models.push(model); }
      const role = _s(issue.role);
      if (role && !g._roles.has(role)) { g._roles.add(role); g.roles.push(role); }
      // Numeri di contesto (porte NetBox vs template, tetti PDU…): si tiene il primo
      // caso e si segnala se gli altri differiscono, così la riga non spaccia per
      // uniforme un gruppo che non lo è.
      const kind = _s(issue.kind);
      if (kind && !g._kinds.has(kind)) { g._kinds.add(kind); g.kinds.push(kind); }
      // ESEMPI. Il mapper li raccoglieva già (`prefix.noVlan` ne porta cinque) e la
      // forma della riga li dichiara qui sopra, ma nessuno li trasportava fin qui:
      // erano dato morto. «180 restano fuori» fa alzare un sopracciglio, «180
      // restano fuori, per esempio 10.0.5.7/24» si capisce in tre secondi.
      for (const s of (Array.isArray(issue.sample) ? issue.sample : [])) {
        const v = _s(s);
        if (v && !g._sample.has(v)) { g._sample.add(v); g.sample.push(v); }
      }
      for (const k of ['netbox', 'template', 'found', 'max', 'declared', 'kept', 'conflicts']) {
        if (issue[k] == null) continue;
        if (g.data[k] === undefined) g.data[k] = _n(issue[k]);
        else if (g.data[k] !== _n(issue[k])) g.data.mixed = true;
      }
    }

    const decisions = [];
    const info = [];
    const costs = [];
    for (const g of byCode.values()) {
      const spec = CATALOG[g.code] || { severity: 'info' };
      delete g._models; delete g._roles; delete g._kinds; delete g._seen; delete g._sample;
      const row = {
        code: g.code,
        severity: spec.severity,
        count: g.count,
        devices: g.devices,
        models: g.models,
        roles: g.roles,
        kinds: g.kinds,
        cables: g.cables,
        sample: g.sample,
        data: g.data,
      };
      if (spec.options && spec.options.length > 1) {
        const pick = spec.options.indexOf(_s(chosen[g.code])) >= 0 ? _s(chosen[g.code]) : spec.def;
        row.options = spec.options.map(id => ({ id, isDefault: id === spec.def }));
        row.chosen = pick;
        decisions.push(row);
      } else {
        info.push(row);
      }
      costs.push({ code: g.code, severity: spec.severity, n: g.count, chosen: row.chosen || null });
    }

    const bySeverity = (a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (b.count - a.count) || a.code.localeCompare(b.code);
    decisions.sort(bySeverity);
    info.sort(bySeverity);
    costs.sort(bySeverity);

    return {
      outcome: {
        devices: _n(counts.devices),
        cables: _n(counts.directLinks) + _n(counts.passThroughLinks),
        vlans: _n(counts.vlans),
        racks: _n(counts.racks),
        // Gli stack si contano nel preventivo perché sono l'unica entità che l'import
        // RICOSTRUISCE invece di copiare: 8 apparati sciolti o 4 stack di 2 sono due
        // documenti diversi, e chi importa deve vederlo prima di premere Importa.
        stacks: _n(counts.stacks),
        costs,
      },
      decisions,
      info,
      // L'elenco può arrivare cappato dalla route: dirlo è meglio che mostrare un
      // conteggio che non torna con quello che si vede.
      truncated: Number.isFinite(+report.issuesTotal) && +report.issuesTotal > issues.length,
    };
  }

  // Le sole scelte che il motore sa applicare. Serve al client per non spedire
  // chiavi inventate e alla route per non fidarsi del payload.
  function sanitizeDecisions(chosen) {
    const out = {};
    for (const code of Object.keys(chosen || {})) {
      const spec = CATALOG[code];
      if (!spec || !spec.options) continue;
      const value = _s(chosen[code]);
      if (spec.options.indexOf(value) >= 0 && value !== spec.def) out[code] = value;
    }
    return out;
  }

  return { buildDecisions, sanitizeDecisions, DECISION_CATALOG: CATALOG };
});
