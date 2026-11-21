// COSA DICHIARA IL DCIM — la vista in sola lettura di `node.source`.
//
// L'import NetBox riempie `node.source` (tenant, stato, ruolo, platform…) ma fino
// a oggi NESSUNA schermata lo leggeva: dato corretto e invisibile. Questo modulo
// decide COSA di quel blocco vale la pena mostrare a una persona, e in che ordine.
//
// ⚠️ Perché in sola lettura, e perché NON nelle note:
//   - `node.source` appartiene all'IMPORT, `node.notes` appartiene a TE. Travasare
//     il tenant nella prosa delle note significherebbe rileggerlo con una regex al
//     giro dopo — lo stesso difetto già eliminato con gli avvisi strutturati — e
//     riscrivendo verso NetBox se lo ritroverebbe nella `description`.
//   - Non serve un campo nuovo: il dato c'è già ed è già strutturato. Mancava solo
//     qualcuno che lo disegnasse.
// Chi vuole dichiarare un responsabile PROPRIO usa le note, che sono sue.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ordine di lettura umano: di chi è → com'è dichiarato → che mestiere fa → che NOS
  // monta. Gli slug tecnici (deviceTypeSlug/manufacturerSlug/catalogMatch) restano
  // fuori: servono a ri-agganciare il catalogo, non a farsi leggere.
  const SOURCE_FIELDS = [
    { key: 'tenant',       label: 'src.tenant' },
    { key: 'status',       label: 'src.status' },
    { key: 'roleSlug',     label: 'src.role' },
    { key: 'platformName', label: 'src.platform' },
  ];

  function _clean(v) {
    if (v == null) return '';
    const s = String(v).trim();
    return s;
  }

  // Le righe da mostrare: SOLO i campi che il DCIM ha davvero dichiarato. Un campo
  // assente non produce una riga con un trattino — l'assenza si mostra tacendo,
  // altrimenti un vuoto si legge come un dato.
  function _rows(src, fields) {
    if (!src || typeof src !== 'object') return [];
    const out = [];
    fields.forEach(function (f) {
      const v = _clean(src[f.key]);
      if (v) out.push({ key: f.key, label: f.label, value: v });
    });
    return out;
  }
  function sourceRows(node) { return _rows(node && node.source, SOURCE_FIELDS); }

  // Lo stesso per un SSID (BSS): la WLAN di NetBox porta di chi e' (tenant), a che gruppo appartiene, dove vale (ambito) e
  // una descrizione. Niente di tutto questo e' un campo che una persona compila nel pannello dell'SSID: appartiene
  // all'IMPORT, come il tenant di un apparato, e si legge soltanto.
  const SSID_SOURCE_FIELDS = [
    { key: 'tenant',      label: 'src.tenant' },
    { key: 'group',       label: 'src.group' },
    { key: 'scope',       label: 'src.scope' },
    { key: 'description', label: 'src.description' },
  ];
  function ssidSourceRows(bss) { return _rows(bss && bss.source, SSID_SOURCE_FIELDS); }

  // Lo stesso per una MACCHINA VIRTUALE (`vm.source`): di chi e', in che stato la dichiara NetBox (la sua parola, verbatim:
  // il ciclo di vita che i verdetti leggono sta in `vm.status`), in che cluster, e i dischi uno per uno. Sola lettura: nessun
  // motore ragiona su un disco singolo, ma chi apre la scheda deve poterlo vedere.
  const VM_SOURCE_FIELDS = [
    { key: 'tenant',  label: 'src.tenant' },
    { key: 'status',  label: 'src.status' },
    { key: 'cluster', label: 'src.cluster' },
  ];
  function _gb(n) { return (Math.round(n * 10) / 10) + ' GB'; }
  function vmSourceRows(vm) {
    const src = vm && vm.source;
    const out = _rows(src, VM_SOURCE_FIELDS);
    const disks = src && Array.isArray(src.disks) ? src.disks : [];
    const list = disks.map(function (d) {
      if (!d || typeof d !== 'object') return '';
      const name = _clean(d.name);
      const size = Number.isFinite(+d.sizeGb) && d.sizeGb !== null && d.sizeGb !== '' && +d.sizeGb > 0 ? _gb(+d.sizeGb) : '';
      return [name, size].filter(Boolean).join(' ');
    }).filter(Boolean);
    if (list.length) out.push({ key: 'disks', label: 'src.disks', value: list.join(' · ') });
    return out;
  }

  // Una SCHEDA virtuale: MTU, VRF, descrizione, interfaccia padre, bridge e — solo se falso — «disabilitata». Stesso
  // principio del resto: dato dichiarato, sola lettura, assente = si tace.
  const NIC_SOURCE_FIELDS = [
    { key: 'description', label: 'src.description' },
    { key: 'mtu',         label: 'src.mtu' },
    { key: 'vrf',         label: 'src.vrf' },
    { key: 'parent',      label: 'src.parent' },
    { key: 'bridge',      label: 'src.bridge' },
  ];
  function nicSourceRows(nic) {
    const src = nic && nic.source;
    const out = _rows(src, NIC_SOURCE_FIELDS);
    if (src && src.enabled === false) out.unshift({ key: 'enabled', label: 'src.enabled', value: 'disabled', valueKey: 'src.disabled' });
    return out;
  }

  /** C'è qualcosa da mostrare? Serve a non disegnare un'intestazione vuota. */
  function hasSource(node) {
    return sourceRows(node).length > 0;
  }

  /** Quanti apparati portano una dichiarazione DCIM, per campo. Per i conteggi. */
  function sourceCoverage(nodes) {
    const out = { total: 0, withAny: 0 };
    SOURCE_FIELDS.forEach(function (f) { out[f.key] = 0; });
    (Array.isArray(nodes) ? nodes : []).forEach(function (n) {
      if (!n) return;
      out.total++;
      const rows = sourceRows(n);
      if (rows.length) out.withAny++;
      rows.forEach(function (r) { out[r.key]++; });
    });
    return out;
  }

  return { SOURCE_FIELDS, SSID_SOURCE_FIELDS, VM_SOURCE_FIELDS, NIC_SOURCE_FIELDS, sourceRows, ssidSourceRows, vmSourceRows, nicSourceRows, hasSource, sourceCoverage };
});
