// ============================================================
// PDU REPORT — righe "Alimentazione / PDU" per il report PDF e il dossier
// ============================================================
// Logica PURA: dai nodi PDU (già ridotti a una whitelist dal chiamante, senza
// segreti) alle righe delle due tabelle del capitolo. Nessun DOM, nessuno stato,
// nessun accesso a TYPES. Condivisa server (pdf-report) + test.
//
// Perché sta QUI e non nel client come le altre sezioni: costruire queste righe
// richiede gli helper di `lib/pdu-layout.js` (stato presa, connessione, modalità
// di gestione), che nel browser vivono SOLO dentro il bundle ESM — non sono
// globali come handoff/drawio-export, quindi `export.js` (script classico) non
// potrebbe chiamarli. Il client manda i dati, il server compone: una sola
// implementazione, testabile a tavolino.
//
// ── DUE TABELLE, come il resto del report ────────────────────────────────
//   1. Riepilogo   → una riga per PDU (dov'è, che tipo è, quante prese, gestione)
//   2. Prese       → una riga per presa (stato, apparato alimentato, provenienza)
//
// ── ONESTÀ DEI NUMERI (paletto no-invenzioni) ────────────────────────────
// Un campo mancante resta `null` e a stampa diventa '—': non è uno zero. Uno zero
// afferma «misurato zero», `null` dice «non dichiarato». Vale per corrente, fasi,
// tipo e IP di gestione. I conteggi delle prese invece sono SEMPRE calcolabili
// (le prese o ci sono o non ci sono) e restano numeri.
(function (root, factory) {
  const api = factory(
    (typeof module !== 'undefined' && module.exports) ? require('./pdu-layout.js') : root,
    (typeof module !== 'undefined' && module.exports) ? require('./power-groups.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (L, G) {
  'use strict';

  const _s = (x) => (x == null ? '' : String(x));
  const _trim = (x) => _s(x).trim();
  // Numero dichiarato: `null` se assente/illeggibile (mai 0 di comodo).
  function _num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Etichetta stampabile di una presa: l'etichetta dichiarata se c'è, altrimenti
  // il numero progressivo. NetBox porta spesso nomi veri ("Outlet 1", "C13-3").
  function outletLabel(outlet, index) {
    const o = outlet && typeof outlet === 'object' ? outlet : {};
    return _trim(o.name) || _trim(o.label) || String(index + 1);
  }

  // Provenienza della connessione: 'manual' (scelta a mano, manual-first),
  // 'imported' (arrivata dal DCIM), oppure '' se la presa non alimenta nulla.
  // Serve al lettore per sapere di chi è la parola: è la stessa distinzione che
  // l'app mostra a schermo, non un'etichetta nuova.
  function connectionSource(conn) {
    const c = conn && typeof conn === 'object' ? conn : {};
    if (c.manual) return 'manual';
    if (c.imported) return 'imported';
    return '';
  }

  // ── Una riga per PDU ────────────────────────────────────────────────────
  function pduSummaryRow(node) {
    const n = node && typeof node === 'object' ? node : {};
    const outlets = Array.isArray(n.powerOutlets) ? n.powerOutlets : [];
    // Totale prese: quelle davvero documentate, altrimenti il conteggio dichiarato.
    // Un PDU senza elenco prese ma con `pduOutletCount` è comunque descritto.
    const declared = _num(L.nodeField(n, 'pduOutletCount'));
    const total = outlets.length || (declared != null ? declared : 0);

    let active = 0, fault = 0, powered = 0;
    for (const o of outlets) {
      const st = L.pduOutletStatusState(o);
      if (st === 'active') active++;
      else if (st === 'fault') fault++;
      if (L.pduOutletConnection(o).connected) powered++;
    }
    // "Libere" = prese non attive e senza nulla attaccato. Su un PDU senza elenco
    // prese non lo sappiamo: resta null (non «tutte libere»).
    const free = outlets.length ? outlets.filter(o =>
      L.pduOutletStatusState(o) !== 'active' && !L.pduOutletConnection(o).connected).length : null;

    const intg = n.integration && typeof n.integration === 'object' ? n.integration : {};
    const inv = intg.inventory && typeof intg.inventory === 'object' ? intg.inventory : {};
    const bkp = n.backup && typeof n.backup === 'object' ? n.backup : {};
    // Alimentazione IN INGRESSO: da dove arriva la corrente. È la prima cosa che
    // serve per rimettere in servizio una PDU sostituita.
    const feeds = (Array.isArray(n.pduPowerPorts) ? n.pduPowerPorts : [])
      .map(p => {
        const o = p && typeof p === 'object' ? p : {};
        const peer = o.connectedTo && typeof o.connectedTo === 'object' ? o.connectedTo : {};
        return {
          name: _trim(o.name) || _trim(o.label) || null,
          type: _trim(o.type) || null,
          source: _trim(peer.deviceName) || _trim(o.connectedDeviceName) || null,
          sourcePort: _trim(peer.name) || _trim(peer.portName) || _trim(o.connectedPortName) || null,
        };
      });

    return {
      id: _s(n.id),
      name: _trim(n.name) || _s(n.id),
      rackName: _trim(n.rackName) || null,
      rackU: _num(n.rackU),
      sizeU: _num(n.sizeU),
      brand: _trim(n.brand) || null,
      model: _trim(n.model) || null,
      // Identità: il DICHIARATO ha la precedenza sulla misura (manual-first), ma la
      // misura ENTITY-MIB copre il buco quando nessuno ha scritto la matricola.
      serial: _trim(n.serialNumber) || _trim(inv.serialNumber) || null,
      firmware: _trim(n.firmwareVer) || _trim(inv.firmwareVer) || null,
      assetTag: _trim(n.assetTag) || null,
      warrantyUntil: _trim(n.warrantyUntil) || null,
      mac: _trim(n.mac) || null,
      notes: _trim(n.notes) || null,
      driver: _trim(intg.driver) || null,
      // Puntatore al backup: DOVE vive la configurazione. Mai il config, mai le
      // credenziali — `ref` è già validato credential-free a monte.
      backupRef: _trim(bkp.ref) || null,
      backupMethod: _trim(bkp.method) || null,
      backupAt: _trim(bkp.at) || null,
      feeds,
      sensorPorts: L.pduAuxiliaryPortCount(n, 'pduSensorPorts', 2),
      usbPorts: L.pduAuxiliaryPortCount(n, 'pduUsbPorts', 3),
      expansionPorts: L.pduAuxiliaryPortCount(n, 'pduExpansionPorts', 2),
      pduType: _trim(L.nodeField(n, 'pduType')) || null,
      phase: _trim(L.nodeField(n, 'pduPhase')) || null,
      currentA: _num(L.nodeField(n, 'pduCurrentA')),
      // ⚠️ Niente `orientation`: InfraNet monta la PDU solo in orizzontale, e il
      // dossier non deve dichiarare un montaggio che l'app non sa rappresentare.
      mgmtMode: L.pduManagementMode(n),
      ethernetPorts: L.pduManagementPortCount(n),
      serialPorts: L.pduSerialPortCount(n),
      ip: _trim((n.integration && n.integration.host) || n.ip) || null,
      outletsTotal: total,
      outletsActive: active,
      outletsFault: fault,
      outletsPowered: powered,
      outletsFree: free,
      // Un PDU importato senza elenco prese non è «un PDU da 0 prese»: lo diciamo
      // al lettore invece di stampare una riga di zeri che sembrano una misura.
      outletsDetailed: outlets.length > 0,
      // I GRUPPI dichiarati, con quante prese contengono. Un gruppo vuoto entra
      // lo stesso: e' stato dichiarato, e chi legge deve sapere che esiste ed e'
      // ancora da riempire — nasconderlo lo farebbe sembrare mai creato.
      groups: G.powerGroupView(n, outlets).groups.map(g => ({
        name: g.name, switching: g.switching, backup: g.backup, outlets: g.outlets.length,
      })),
    };
  }

  // ── Una riga per presa ──────────────────────────────────────────────────
  function pduOutletRows(node) {
    const n = node && typeof node === 'object' ? node : {};
    const outlets = Array.isArray(n.powerOutlets) ? n.powerOutlets : [];
    const pduName = _trim(n.name) || _s(n.id);
    return outlets.map((o, i) => {
      const conn = L.pduOutletConnection(o);
      return {
        pduId: _s(n.id),
        pduName,
        label: outletLabel(o, i),
        status: L.pduOutletStatusState(o),
        // Stato grezzo dichiarato dalla fonte (es. "enabled"): utile in consegna
        // perché mostra la parola originale accanto alla nostra classificazione.
        rawStatus: _trim(L.outletStatusText(o)) || null,
        deviceName: _trim(conn.deviceName) || null,
        portName: _trim(conn.portName) || null,
        source: connectionSource(conn),
        // GRUPPO della presa: su carta e' la meta' che serve davvero — dice chi
        // resta acceso quando manca la corrente. Solo il nome: i due assi stanno
        // nella scheda del gruppo, ripeterli su ogni presa sarebbe rumore.
        group: (function () { const g = G.groupOfOutlet(n, o); return g ? g.name : null; })(),
      };
    });
  }

  // ── Capitolo completo ───────────────────────────────────────────────────
  // input.pdus = nodi PDU già ridotti alla whitelist dal chiamante.
  function buildPduReport(input) {
    const list = Array.isArray(input && input.pdus) ? input.pdus.filter(Boolean) : [];
    // Ordine di lettura: per rack, poi per unità (dall'alto), poi per nome — lo
    // stesso ordine con cui si guarda un armadio davanti agli occhi.
    const summary = list.map(pduSummaryRow).sort((a, b) =>
      _s(a.rackName).localeCompare(_s(b.rackName), undefined, { sensitivity: 'base' })
      || (b.rackU == null ? -1 : a.rackU == null ? 1 : b.rackU - a.rackU)
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const byId = new Map(summary.map((r, i) => [r.id, i]));
    const outlets = list
      .flatMap(pduOutletRows)
      .sort((a, b) => (byId.get(a.pduId) ?? 0) - (byId.get(b.pduId) ?? 0));

    const totals = {
      pdus: summary.length,
      outlets: outlets.length,
      active: outlets.filter(o => o.status === 'active').length,
      fault: outlets.filter(o => o.status === 'fault').length,
      powered: outlets.filter(o => o.deviceName).length,
    };
    // Capacità residua: ha senso solo sui PDU con l'elenco prese documentato.
    const detailed = summary.filter(s => s.outletsDetailed);
    totals.free = detailed.length
      ? detailed.reduce((acc, s) => acc + (s.outletsFree || 0), 0) : null;

    return { summary, outlets, totals };
  }

  return { buildPduReport, pduSummaryRow, pduOutletRows, outletLabel, connectionSource };
});
