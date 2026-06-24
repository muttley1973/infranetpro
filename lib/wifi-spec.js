// ============================================================
// WIFI SPEC — validazioni Wi-Fi documentazione-grade (puro)
// ============================================================
// Non configura nulla: valida la COERENZA dei dati Wi-Fi documentati (banda /
// canale / sicurezza) e spiega il perché, come lib/cable-validate.js per i cavi.
// Modello "ibrido": gli attributi banda/canale/SSID/sicurezza vivono sulla RADIO
// dell'AP; l'associazione (l'onda) li eredita e aggiunge il segnale.
// Condiviso browser + test (UMD-lite), nessun DOM/state.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WIFI_BANDS = ['2.4', '5', '6'];
  const WIFI_SECURITY = ['open', 'wpa2-psk', 'wpa2-ent', 'wpa3-personal', 'wpa3-ent', 'owe'];
  // Standard 802.11 con le bande su cui operano. Wi-Fi 7 (802.11be) e' in
  // commercio dal 2024; Wi-Fi 8 (802.11bn) e' in bozza (finalizzazione ~2028),
  // incluso come voce futura. (id, etichetta, bande supportate)
  const WIFI_STANDARDS = [
    { id: 'wifi4', label: 'Wi-Fi 4 (802.11n)',          bands: ['2.4', '5'] },
    { id: 'wifi5', label: 'Wi-Fi 5 (802.11ac)',         bands: ['5'] },
    { id: 'wifi6', label: 'Wi-Fi 6 (802.11ax)',         bands: ['2.4', '5'] },
    { id: 'wifi6e', label: 'Wi-Fi 6E (802.11ax · 6 GHz)', bands: ['6'] },
    { id: 'wifi7', label: 'Wi-Fi 7 (802.11be)',         bands: ['2.4', '5', '6'] },
    // Wi-Fi 8 (802.11bn) ancora in bozza IEEE (~2028): da aggiungere quando uscirà.
  ];
  function _standard(id) { return WIFI_STANDARDS.find(s => s.id === id) || null; }
  function standardSupportsBand(id, band) {
    const s = _standard(id);
    return !s || !band ? true : s.bands.includes(String(band));
  }

  // Range inclusivo di canali con passo (helper per i 6 GHz).
  function _range(from, to, step) { const o = []; for (let c = from; c <= to; c += step) o.push(c); return o; }

  // Canali raggruppati per SOTTO-BANDA (UNII / 2.4), con etichetta e flag DFS.
  // È la sorgente di verità: channelsForBand() ne è la versione "piatta".
  function channelGroupsForBand(band) {
    if (band === '2.4') return [{ label: '2.4 GHz', channels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] }];
    if (band === '5') return [
      { label: 'UNII-1', channels: [36, 40, 44, 48] },
      { label: 'UNII-2A (DFS)', dfs: true, channels: [52, 56, 60, 64] },
      { label: 'UNII-2C (DFS)', dfs: true, channels: [100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144] },
      { label: 'UNII-3', channels: [149, 153, 157, 161, 165] },
    ];
    if (band === '6') return [
      { label: 'UNII-5', channels: _range(1, 93, 4) },
      { label: 'UNII-6', channels: _range(97, 113, 4) },
      { label: 'UNII-7', channels: _range(117, 185, 4) },
      { label: 'UNII-8', channels: _range(189, 233, 4) },
    ];
    return [];
  }

  // Lista piatta dei canali validi per banda (usata dalla validazione).
  function channelsForBand(band) {
    const out = [];
    for (const g of channelGroupsForBand(band)) for (const c of g.channels) out.push(c);
    return out;
  }

  function _securityIsWpa2OrOpen(sec) {
    return sec === 'open' || sec === 'wpa2-psk' || sec === 'wpa2-ent';
  }

  // Valida la coerenza dei dati Wi-Fi. Ritorna [{ level:'error'|'warn', code,
  // title, why }] — il "why" è EDUCATIVO (il perché, non solo il divieto).
  function validateWifi(cfg) {
    cfg = cfg || {};
    const band = cfg.band ? String(cfg.band) : '';
    // 'auto' (o vuoto) = selezione automatica del canale → niente check canale↔banda.
    const channel = (cfg.channel != null && cfg.channel !== '' && cfg.channel !== 'auto') ? Number(cfg.channel) : null;
    const security = cfg.security ? String(cfg.security) : '';
    const standard = cfg.standard ? String(cfg.standard) : '';
    const out = [];

    if (band && channel != null) {
      const valid = channelsForBand(band);
      if (valid.length && !valid.includes(channel)) {
        out.push({
          level: 'error', code: 'channel-band',
          title: `Canale ${channel} non valido per la banda ${band} GHz`,
          why: `Sui ${band} GHz i canali ammessi sono ${valid[0]}–${valid[valid.length - 1]}. Scegli un canale di quella banda.`,
        });
      }
    }

    // 6 GHz (Wi-Fi 6E/7): non esiste retrocompatibilità con Open/WPA2 — solo WPA3/OWE.
    if (band === '6' && security && _securityIsWpa2OrOpen(security)) {
      out.push({
        level: 'error', code: 'band6-security',
        title: '6 GHz richiede WPA3 o OWE',
        why: 'La banda 6 GHz non ammette Open/WPA2 per certificazione: usa WPA3 (Personal/Enterprise) o Enhanced Open (OWE).',
      });
    }

    if (security === 'open') {
      out.push({
        level: 'warn', code: 'open-network',
        title: 'Rete aperta (nessuna cifratura)',
        why: 'Il traffico viaggia in chiaro. Va bene solo per una guest isolata; altrimenti usa almeno WPA2-PSK (meglio WPA3).',
      });
    }

    // Standard ↔ banda: es. Wi-Fi 5 opera solo a 5 GHz; Wi-Fi 6E/7 servono per i 6 GHz.
    if (standard && band && !standardSupportsBand(standard, band)) {
      const s = _standard(standard);
      out.push({
        level: 'warn', code: 'standard-band',
        title: `${s ? s.label.replace(/ \(.*/, '') : standard} non opera sulla banda ${band} GHz`,
        why: `${s ? s.label : standard} supporta ${(s ? s.bands : []).map(b => b + ' GHz').join(' / ')}. Per i ${band} GHz serve uno standard compatibile.`,
      });
    }

    return out;
  }

  return { WIFI_BANDS, WIFI_SECURITY, WIFI_STANDARDS, channelsForBand, channelGroupsForBand, standardSupportsBand, validateWifi };
});
