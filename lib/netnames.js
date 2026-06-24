// Normalizzazione nomi interfaccia, MAC e tabelle FDB — pure, vendor-neutral.
// Condivise tra browser (topologia/auto-link in app.js) e test Node.
// UMD-lite: globali nel browser (window), module.exports in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // id numerico LAG -> token canonico "lag:<n>"
  function _canonLagToken(id) {
    const n = parseInt(id, 10);
    return Number.isFinite(n) && n >= 0 ? `lag:${n}` : '';
  }

  // MAC in qualsiasi formato -> "aa:bb:cc:dd:ee:ff" oppure '' se non valido.
  function _normMacKey(mac) {
    const m = String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (m.length !== 12) return '';
    return m.match(/.{2}/g).join(':');
  }

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

    const mgmtMatch = flat.match(/^(?:mgmt|management|oobm?|outofband|me|fxp|em)(\d+)?$/i);
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
