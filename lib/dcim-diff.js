// ============================================================
//  RI-LETTURA DEL DCIM — che cosa è cambiato da quando hai importato
// ============================================================
// L'import crea SEMPRE un progetto nuovo: è la sua garanzia (non c'è merge, non
// c'è clobber, non si perde niente). Il rovescio è che quando NetBox cambia
// l'unico modo di riportarlo dentro era una fotocopia nuova, che butta via il
// lavoro fatto a mano — posizioni sul piano, cavi dichiarati, nomi corretti. Per
// uno strumento manual-first è il buco più grosso dell'integrazione.
//
// Questo modulo è la prima metà della risposta, e la sola che serve davvero
// prima di decidere qualunque cosa: **non scrive niente, DICE**. Confronta ciò
// che NetBox dichiara adesso con ciò che il documento dichiara, e restituisce
// righe. Chi legge decide — a mano, come sempre.
//
// ── Le tre onestà, che sono il motivo per cui questo file esiste ────────────
//
//  ① **Un apparato scritto a mano non "manca dal DCIM".** Ha `source.deviceId`
//     solo chi è arrivato dall'import: chi non ce l'ha non è affare di NetBox, e
//     stamparlo fra le differenze accuserebbe l'utente del proprio lavoro. Si
//     conta a parte e si dichiara.
//
//  ② **Si confronta solo il DICHIARATO, mai il MISURATO.** L'import scrive nome,
//     tipo, marca, modello, matricola, posizione. Non scrive `snmpStatus`, non
//     scrive `proof`, non scrive dove hai messo l'icona sul pavimento. Mettere a
//     confronto una misura con una dichiarazione produce differenze che non
//     significano niente — è lo stesso errore per cui `platform` non tocca il
//     firmware ([[identity-drift]]).
//
//  ③ **«Diverso» non vuol dire «sbagliato», e non si sa CHI ha cambiato.** Senza
//     una data su ogni campo nessuno può dire se hai corretto tu il nome o se
//     l'ha cambiato NetBox. La riga mostra i due valori e tace sulla colpa; dove
//     il documento porta un flag `*Manual` lo si dice, perché quello sì è un
//     fatto: quel valore l'hai scritto tu.
//
// Condiviso browser + test (UMD-lite), funzione PURA: nessun accesso a rete,
// disco o `window`.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _s(x) { return (x == null) ? '' : String(x); }

  // I campi che l'import DICHIARA su un apparato, e nient'altro. Aggiungerne uno
  // qui è una decisione: deve essere scritto dal mapper (altrimenti il confronto
  // accusa il documento di avere qualcosa che NetBox non ha mai avuto) e non deve
  // essere una misura (paletto ② in testa al file).
  //
  // `manualFlag` è il campo che, quando è vero, dice che quel valore l'ha scritto
  // l'utente: non cambia il verdetto — la differenza c'è comunque — ma la riga può
  // dirlo, ed è l'unica cosa che si sa davvero su chi ha cambiato cosa.
  const DEVICE_FIELDS = [
    { key: 'name', manualFlag: 'nameManual' },
    { key: 'type', manualFlag: 'typeManual' },
    { key: 'placement' },
    { key: 'brand' },
    { key: 'model' },
    { key: 'serialNumber' },
    { key: 'ip' },
    { key: 'rackU' },
    { key: 'sizeU' },
  ];

  const PREFIX_FIELDS = [{ key: 'cidr' }, { key: 'vlan' }, { key: 'status' }, { key: 'description' }];

  function _nodesByDeviceId(state) {
    const out = new Map();
    let handmade = 0;
    for (const n of (state && Array.isArray(state.nodes) ? state.nodes : [])) {
      const id = n && n.source && n.source.deviceId;
      // ① Nessun id NetBox = scritto a mano. Non entra nel confronto, si conta.
      if (id == null) { handmade++; continue; }
      out.set(_s(id), n);
    }
    return { byId: out, handmade };
  }

  function _rackNameById(state) {
    const out = new Map();
    for (const r of (state && Array.isArray(state.racks) ? state.racks : [])) {
      if (r && r.id != null) out.set(_s(r.id), _s(r.name));
    }
    return out;
  }

  // Confronto di UN campo. Ritorna null se sono uguali. Il confronto è per
  // stringa dopo la normalizzazione a stringa: i valori qui sono nomi, marche,
  // modelli e numeri piccoli, mai indirizzi o MAC — quelli hanno le loro chiavi
  // (`addrKey`, `macKey`) e non compaiono in questa lista.
  function _cmpField(spec, dcimNode, docNode) {
    const a = _s(dcimNode ? dcimNode[spec.key] : '');
    const b = _s(docNode ? docNode[spec.key] : '');
    if (a === b) return null;
    // Un campo che NetBox non dichiara affatto non è una differenza: è silenzio.
    // Accusare il documento di «avere un valore che il DCIM non ha» ogni volta
    // che NetBox tace riempirebbe il pannello di righe che non chiedono niente.
    if (!a) return null;
    const row = { field: spec.key, dcim: a, doc: b };
    if (spec.manualFlag && docNode && docNode[spec.manualFlag]) row.manual = true;
    return row;
  }

  /**
   * diffAgainstProject(imported, current) → report
   *  imported = lo `state` prodotto ADESSO da netboxToState (la fotografia nuova)
   *  current  = lo `state` del progetto aperto (il documento)
   *
   * Ritorna { counts, devices:{added,removed,changed}, prefixes:{…}, vlans:{…},
   *           racks:{…}, handmade }
   * Nessun campo di questo oggetto viene mai SCRITTO nel documento: è una lettura.
   */
  function diffAgainstProject(imported, current) {
    const dcim = imported || {};
    const doc = current || {};

    const dcimNodes = _nodesByDeviceId(dcim).byId;
    const docSide = _nodesByDeviceId(doc);
    const docNodes = docSide.byId;
    const dcimRacks = _rackNameById(dcim);
    const docRacks = _rackNameById(doc);

    const devices = { added: [], removed: [], changed: [] };
    for (const [id, n] of dcimNodes) {
      const cur = docNodes.get(id);
      if (!cur) { devices.added.push({ id, name: _s(n.name) || ('#' + id) }); continue; }
      const fields = [];
      for (const spec of DEVICE_FIELDS) {
        const row = _cmpField(spec, n, cur);
        if (row) fields.push(row);
      }
      // Il rack si confronta per NOME, non per id: gli id sono generati
      // dall'import e non hanno alcun significato fra due letture diverse.
      const rDcim = _s(dcimRacks.get(_s(n.rackId)));
      const rDoc = _s(docRacks.get(_s(cur.rackId)));
      if (rDcim && rDcim !== rDoc) fields.push({ field: 'rack', dcim: rDcim, doc: rDoc });
      if (fields.length) devices.changed.push({ id, name: _s(cur.name) || _s(n.name) || ('#' + id), fields });
    }
    for (const [id, n] of docNodes) {
      if (!dcimNodes.has(id)) devices.removed.push({ id, name: _s(n.name) || ('#' + id) });
    }

    // ── Prefissi ────────────────────────────────────────────────────────────
    // Identità = l'id NetBox, che il mapper scrive già sulla riga (`prefix.id`).
    // Una rete scritta a mano non ce l'ha: stessa regola degli apparati.
    const pIndex = (state) => {
      const out = new Map();
      let handmade = 0;
      for (const p of (state && state.ipam && Array.isArray(state.ipam.prefixes) ? state.ipam.prefixes : [])) {
        if (!p) continue;
        if (p.source !== 'dcim' || p.id == null) { handmade++; continue; }
        out.set(_s(p.id), p);
      }
      return { byId: out, handmade };
    };
    const dcimPfx = pIndex(dcim).byId;
    const docPfxSide = pIndex(doc);
    const docPfx = docPfxSide.byId;
    const prefixes = { added: [], removed: [], changed: [] };
    for (const [id, p] of dcimPfx) {
      const cur = docPfx.get(id);
      if (!cur) { prefixes.added.push({ id, name: _s(p.cidr) }); continue; }
      const fields = [];
      for (const spec of PREFIX_FIELDS) {
        const row = _cmpField(spec, p, cur);
        if (row) fields.push(row);
      }
      if (fields.length) prefixes.changed.push({ id, name: _s(cur.cidr) || _s(p.cidr), fields });
    }
    for (const [id, p] of docPfx) {
      if (!dcimPfx.has(id)) prefixes.removed.push({ id, name: _s(p.cidr) });
    }

    // ── VLAN ────────────────────────────────────────────────────────────────
    // Qui l'identità è il vid, che è l'identità VERA di una VLAN e non un id
    // generato: due letture dello stesso NetBox la ritrovano sempre.
    const vlanNames = (state) => (state && state.vlanNames && typeof state.vlanNames === 'object') ? state.vlanNames : {};
    const dcimVlans = vlanNames(dcim), docVlans = vlanNames(doc);
    const vlans = { added: [], removed: [], changed: [] };
    for (const vid of Object.keys(dcimVlans)) {
      if (!(vid in docVlans)) { vlans.added.push({ id: vid, name: 'VLAN ' + vid + ' · ' + _s(dcimVlans[vid]) }); continue; }
      if (_s(dcimVlans[vid]) !== _s(docVlans[vid])) {
        vlans.changed.push({ id: vid, name: 'VLAN ' + vid,
          fields: [{ field: 'name', dcim: _s(dcimVlans[vid]), doc: _s(docVlans[vid]) }] });
      }
    }
    for (const vid of Object.keys(docVlans)) {
      if (!(vid in dcimVlans)) vlans.removed.push({ id: vid, name: 'VLAN ' + vid + ' · ' + _s(docVlans[vid]) });
    }

    // ── Rack ────────────────────────────────────────────────────────────────
    // Per NOME, come sopra: l'id di un rack importato lo genera l'import.
    const rackByName = (state) => {
      const out = new Map();
      for (const r of (state && Array.isArray(state.racks) ? state.racks : [])) {
        if (r && _s(r.name)) out.set(_s(r.name), r);
      }
      return out;
    };
    const dcimR = rackByName(dcim), docR = rackByName(doc);
    const racks = { added: [], removed: [], changed: [] };
    for (const [name, r] of dcimR) {
      const cur = docR.get(name);
      if (!cur) { racks.added.push({ id: name, name }); continue; }
      const a = _s(r.sizeU), b = _s(cur.sizeU);
      if (a && a !== b) racks.changed.push({ id: name, name, fields: [{ field: 'sizeU', dcim: a, doc: b }] });
    }
    for (const [name] of docR) {
      if (!dcimR.has(name)) racks.removed.push({ id: name, name });
    }

    const groups = { devices, prefixes, vlans, racks };
    const counts = { added: 0, removed: 0, changed: 0 };
    for (const g of Object.values(groups)) {
      counts.added += g.added.length;
      counts.removed += g.removed.length;
      counts.changed += g.changed.length;
    }
    return Object.assign({
      counts,
      // ① Ciò che è TUO: apparati e reti che nel DCIM non sono mai esistiti. Non
      // è una differenza, è il lavoro fatto a mano — e va detto proprio perché
      // un ri-allineamento fatto male è ciò che lo cancellerebbe.
      handmade: { devices: docSide.handmade, prefixes: docPfxSide.handmade },
      // Nessuna differenza è comunque un ESITO, non un pannello vuoto.
      clean: counts.added === 0 && counts.removed === 0 && counts.changed === 0,
    }, groups);
  }

  return { diffAgainstProject, DEVICE_FIELDS, PREFIX_FIELDS };
});
