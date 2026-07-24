// ============================================================
// CABLE-LABELS — costruzione PURA delle righe etichetta cavo
// (P1.3 export etichette, sessione 23).
//
// Unica sorgente di verita' per CSV ed export PDF etichette: separa il
// "QUALI dati" (questa lib) dal "COME stamparli" (export.js per il CSV,
// server/label-sheet.js per il PDF). Niente duplicazione della mappatura
// link → riga; la logica e' testabile in Node.
//
// buildCableLabelRows(model) → [ rowDescriptor ]
//
//   row = {
//     id, label, from, to, color, lengthM (number|null), cableType,
//     vlan (number|null), vlanName, isPermanent (bool),
//     installedAt, installedBy, notes
//   }
//
// model: SOLO plain-data + helper iniettati (niente DOM, niente globali):
//   links[]
//   helpers: {
//     nodeByPortId(pid) → node|undefined,
//     cableAutoLabel(link) → string   (label calcolata se manca l.label),
//     linkVlan(link) → number,        (VLAN dominante; 1/0 = nessuna)
//     vlanNames: { [vlan]: name } | undefined,
//     roomName(node) → string         (nome stanza che contiene il node, '' se nessuna)
//   }
//
// Ricalca la logica gia' presente in export.js _buildPdfReportData (cavi).
// Condivisa browser + test (UMD-lite). NON muta il model.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // "sw-001-24" → "24" (la porta e' tutto cio' che segue il primo id-nodo).
  function _portSuffix(pid) {
    return String(pid == null ? '' : pid).split('-').slice(1).join('-');
  }

  function _endpointName(node, pid) {
    return `${node && node.name ? node.name : '?'} P${_portSuffix(pid)}`;
  }

  function buildCableLabelRows(model) {
    const m = model || {};
    const links = m.links || [];
    const h = m.helpers || {};
    const nodeByPortId = h.nodeByPortId || (() => undefined);
    const cableAutoLabel = h.cableAutoLabel || (() => '');
    const linkVlan = h.linkVlan || (() => 0);
    const vlanNames = h.vlanNames || {};
    const roomName = h.roomName || (() => '');

    return links.map(l => {
      const sn = nodeByPortId(l.src);
      const dn = nodeByPortId(l.dst);
      const vl = Number(linkVlan(l)) || 0;

      // Stanze degli estremi (nome): uniche, non vuote.
      const rooms = [...new Set([roomName(sn), roomName(dn)].filter(Boolean))];

      // lunghezza: lengthM ha priorita', fallback su length (modello legacy).
      const lenRaw = (l.lengthM != null) ? l.lengthM : l.length;
      const lenNum = Number(lenRaw);
      const lengthM = Number.isFinite(lenNum) ? lenNum : null;

      return {
        id:          l.id || '',
        // label: usato per stampare l'etichetta (fallback "da → a" se manca).
        // customLabel: SOLO l'etichetta assegnata a mano (vuota se assente) →
        // il CSV la usa per non duplicare le colonne da/a quando non c'e' label.
        label:       l.label || cableAutoLabel(l),
        customLabel: l.label || '',
        from:        _endpointName(sn, l.src),
        to:          _endpointName(dn, l.dst),
        color:       l.color || l.colorOvr || '',
        lengthM:     lengthM,
        cableType:   l.cableType || l.cableCategory || l.category || '',
        vlan:        vl > 1 ? vl : null,
        vlanName:    vl > 1 ? (vlanNames[vl] || '') : '',
        isPermanent: (l.isPermanent == null ? null : !!l.isPermanent),
        installedAt: l.installedAt || '',
        installedBy: l.installedBy || '',
        notes:       l.notes || '',
        room:        rooms.join(' / '),
      };
    });
  }

  return { buildCableLabelRows };
});
