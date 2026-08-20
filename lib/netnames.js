// Normalizzazione nomi interfaccia, MAC e tabelle FDB — pure, vendor-neutral.
// Condivise tra browser (topologia/auto-link in app.js) e test Node.
// UMD-lite: globali nel browser (window), module.exports in Node.
// La forma canonica di un MAC la definisce lib/mac-class.js (una sola nel
// progetto): qui si delega, non si ri-normalizza. In Node arriva via require;
// nel browser mac-class è uno <script> classico che si auto-espone su window e
// si legge a CALL-TIME (come cidr.js con ipv6.js), quindi l'ordine dei tag non
// conta.
(function (root, factory) {
  const M = (typeof module !== 'undefined' && module.exports) ? require('./mac-class.js') : root;
  const api = factory(M);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  // id numerico LAG -> token canonico "lag:<n>"
  function _canonLagToken(id) {
    const n = parseInt(id, 10);
    return Number.isFinite(n) && n >= 0 ? `lag:${n}` : '';
  }

  // MAC in qualsiasi formato -> "aa:bb:cc:dd:ee:ff" oppure '' se non valido.
  // Alias storico di `macKey` (lib/mac.js): il nome resta perché mezzo progetto
  // lo importa, l'implementazione è una sola.
  function _normMacKey(mac) { return M.macKey(mac); }

  /**
   * Analizza un nome interfaccia per matching vendor-neutral (Cisco, Juniper,
   * Aruba CX, Huawei, Dell OS10, FortiGate, MikroTik). Ritorna metadati:
   *   { raw, compact, norm, numOnly, lagToken, isMac }
   */
  function _ifNameMeta(s) {
    const out = { raw: '', compact: '', norm: '', numOnly: '', lagToken: '', isMac: false };
    if (!s) return out;
    let n = String(s).trim().toLowerCase();
    if (!n) return out;
    if (/^([0-9a-f]{2}[:\-]){5}[0-9a-f]{2}$/.test(n)) {
      out.isMac = true;
      return out;
    }

    n = n
      .replace(/[()[\]]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s*:\s*/g, ':')
      .replace(/\s*\.\s*/g, '.')
      .trim();
    out.raw = n;

    let compact = n.replace(/\s+/g, '');
    compact = compact.replace(/([a-z0-9/_-]+)\.\d+$/, '$1'); // unità logiche: ge-0/0/0.0
    compact = compact.replace(/([a-z0-9/_-]+):\d+$/, '$1');  // breakout/channel: xe-0/0/0:0
    out.compact = compact;
    const flat = compact.replace(/-/g, '');

    const lagMatch = flat.match(/^(?:portchannel|po|lag|trk|ethtrunk|bundleether|bridgeaggregation|bond|bonding|team|aggregate|agg|ae|reth|bagg)(\d+)$/i);
    if (lagMatch) {
      out.lagToken = _canonLagToken(lagMatch[1]);
      out.norm = out.lagToken;
      out.numOnly = lagMatch[1];
      return out;
    }

    // ⚠️ Il sostantivo generico in coda — «Management Port», «Mgmt Interface» —
    // è DECORAZIONE, non identità: lo stesso agente che scrive così in ifDescr
    // annuncia poi «mgmt» via LLDP, e i due nomi non si agganciavano (misurato
    // il 2026-08-20: un vicino annunciato su quella porta non trovava nulla).
    // Si toglie solo per la prova di famiglia, mai da `flat`: su una porta
    // FISICA quel «port» è già gestito dal prefisso, e una «Port 1» deve restare
    // la porta 1 — non diventare una interfaccia di gestione.
    const flatMgmt = flat.replace(/(?:port|interface)(\d*)$/, '$1');
    const mgmtMatch = flatMgmt.match(/^(?:mgmt|management|oobm?|outofband|me|fxp|em)(\d+)?$/i);
    if (mgmtMatch) {
      const idx = mgmtMatch[1] || '0';
      out.norm = `mgmt:${idx}`;
      out.numOnly = idx;
      return out;
    }

    let phys = flat
      .replace(/^fourhundredgigabitethernet/, '')
      .replace(/^twohundredgigabitethernet/, '')
      .replace(/^hundredgigabitethernet/, '')
      .replace(/^fiftygigabitethernet/, '')
      .replace(/^fortygigabitethernet/, '')
      .replace(/^twentyfivegigabitethernet/, '')
      .replace(/^twopointfivegigabitethernet/, '')
      .replace(/^fivegigabitethernet/, '')
      .replace(/^tengigabitethernet/, '')
      .replace(/^gigabitethernet/, '')
      .replace(/^fastethernet/, '')
      .replace(/^xgigabitethernet/, '')
      .replace(/^twogigabitethernet/, '')
      .replace(/^hundredgige/, '')
      .replace(/^fortygige/, '')
      .replace(/^twentyfivegige/, '')
      .replace(/^twofivegige/, '')
      .replace(/^fivegige/, '')
      .replace(/^twopointfivegige/, '')
      .replace(/^ethernet/, '')
      .replace(/^port/, '')
      .replace(/^ether/, '')
      .replace(/^eth/, '')
      .replace(/^sfp-sfpplus/, '')
      .replace(/^sfpsfpplus/, '')
      .replace(/^sfpplus/, '')
      .replace(/^qsfpplus/, '')
      .replace(/^qsfp/, '')
      .replace(/^gi/, '')
      .replace(/^te/, '')
      .replace(/^hu/, '')
      .replace(/^fo/, '')
      .replace(/^twe/, '')
      .replace(/^tw/, '')
      .replace(/^fi/, '')
      .replace(/^fa/, '')
      .replace(/^ge(?=[0-9\/\-\.])/, '')
      .replace(/^xe(?=[0-9\/\-\.])/, '')
      .replace(/^et(?=[0-9\/\-\.])/, '')
      .replace(/^fe(?=[0-9\/\-\.])/, '');

    phys = phys.replace(/^[\-_]+/, '').replace(/[\-_]+/g, '/');
    out.norm = phys || compact;
    out.numOnly = out.norm.replace(/[^0-9\/]/g, '');
    return out;
  }

  // Nome interfaccia normalizzato (stringa) — '' se è un MAC.
  function _normIfName(s) {
    const meta = _ifNameMeta(s);
    return meta.isMac ? '' : meta.norm;
  }

  // FDB {mac -> ifName} normalizzata su chiavi MAC coerenti (_normMacKey).
  function _normalizeFdbTable(fdb) {
    const out = {};
    if (!fdb || typeof fdb !== 'object') return out;
    for (const [rawMac, ifName] of Object.entries(fdb)) {
      const k = _normMacKey(rawMac);
      if (!k) continue;
      if (!out[k]) out[k] = String(ifName || '').trim();
    }
    return out;
  }

  return { _canonLagToken, _normMacKey, _ifNameMeta, _normIfName, _normalizeFdbTable };
});
