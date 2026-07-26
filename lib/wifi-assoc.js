// ============================================================
// WIFI-ASSOC — logica PURA per la scoperta delle ASSOCIAZIONI WIRELESS dalla FDB.
//
// Idea vendor-neutral: un MAC appreso nella forwarding table (FDB) di un apparato
// su una sua interfaccia WIRELESS = un client ASSOCIATO via onda a quell'apparato.
// Funziona anche (soprattutto) per l'apparato TUTT'UNO (router+AP+switch): la sua
// FDB contiene già i client wireless, appresi sulle interfacce radio invece che
// sulle porte ethernet — basta distinguere il TIPO di interfaccia.
//
// Segnale AUTOREVOLE = IF-MIB ifType = ieee80211(71) (registro IANA, standard).
// Fallback = pattern sul nome (vendor-neutral): wlan/wifi/ath/ra/wlp/radio/802.11…
// NIENTE OID vendor, NIENTE hardcoded sul lab. → paletto ③ vendor-neutral.
//
// Condivisa server (require) + browser (global) + bundle (import). Niente DOM,
// niente IO, niente globali: solo dati. Stesso pattern UMD-lite di lib/radio.js.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // IANA ifType ieee80211 = 71 (IF-MIB 1.3.6.1.2.1.2.2.1.3). Se una FDB apprende un
  // MAC su un'interfaccia di questo tipo, quel MAC è associato via radio, non cablato.
  const IFTYPE_IEEE80211 = 71;

  // Fallback per-NOME, VENDOR-NEUTRAL, per i device che non espongono ifType=71 sulle
  // radio (o dove la FDB porta solo il nome). Token wireless ESPLICITI. Due deliberate
  // ESCLUSIONI per evitare falsi positivi:
  //   • NIENTE band "2.4G/5G/6G": "…G" collide con le VELOCITÀ ethernet (1G/10G/40G).
  //   • NIENTE "wan/lan/vlan": non sono radio.
  // Coperti: wlan0 · wl0 · wifi0 · wi-fi · ath0 (Atheros) · ra0/rai0 (Ralink/MediaTek)
  //   · wlp2s0 (Linux predictable) · radio0 / Dot11Radio0 (Cisco) · apcli0 · wds0 · 802.11.
  // La guardia iniziale `(?:^|[^a-z0-9])` è ESSENZIALE: impedisce match interni tipo
  // "came**ra0**" o "inf**ra0**" (il token deve iniziare a bordo, non dentro una parola).
  const WIFI_NAME_RE = /(?:^|[^a-z0-9])(?:wlan|wifi|wi-fi|wlp|ath|rai?|apcli|wds|dot11|802\.?11|wl)\d|(?:^|[^a-z])(?:wireless|wlan|wifi|wi-fi|radio)(?:\d|[^a-z0-9]|$)/i;

  // Un'interfaccia è wireless? ifType=71 è autorevole; altrimenti pattern sul nome.
  // @param {string} ifName @param {number|string} [ifType] @returns {boolean}
  function isWirelessInterface(ifName, ifType) {
    if (Number(ifType) === IFTYPE_IEEE80211) return true;
    const s = String(ifName == null ? '' : ifName);
    if (!s) return false;
    return WIFI_NAME_RE.test(s);
  }

  // Solo un MAC UNICAST può essere un client reale. Scarta broadcast (ff:ff…),
  // multicast (bit I/G del 1º ottetto = 1: es. 01:00:5e…) e MAC nulli (ARP incompleto).
  // Necessario perché la tabella vicini/ARP di un AP contiene anche broadcast/multicast/
  // link-local sull'interfaccia radio (misurato dal vivo su un hotspot Windows).
  // @param {string} mac @returns {boolean}
  function isUnicastMac(mac) {
    const s = String(mac == null ? '' : mac).toLowerCase();
    if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(s)) return false;
    if (s === '00:00:00:00:00:00' || s === 'ff:ff:ff:ff:ff:ff') return false;
    return (parseInt(s.slice(0, 2), 16) & 1) === 0;   // I/G bit = 0 → unicast
  }

  // Dato un elenco (ifName -> ifType) di un device, restituisce i NOMI delle sue
  // interfacce wireless. Usato dal server per emettere `wifiIfs` nella risposta
  // topologia (paletto: una sola fonte di verità per il predicato).
  // @param {Object<string,number>} ifTypeByName @returns {string[]}
  function wirelessIfNames(ifTypeByName) {
    const out = [];
    for (const [name, type] of Object.entries(ifTypeByName || {})) {
      if (isWirelessInterface(name, type)) out.push(name);
    }
    return out;
  }

  // Partiziona la FDB di UN device in associazioni wireless vs apprendimenti cablati.
  //   fdb          = { mac -> ifName }          (una FDB device, già normalizzata)
  //   wifiIfs      = string[] | Set             (ifName wireless noti dal server) [opz]
  //   ifTypeByName = { ifName -> ifType }       (fallback locale per il predicato)   [opz]
  //   fdbVlan      = { mac -> vlanId }          (VLAN-per-MAC, per il match BSS)      [opz]
  // Un MAC è "wireless" se il suo ifName è in wifiIfs OPPURE isWirelessInterface(nome,tipo).
  // @returns {{ wireless: {mac,ifName,vlan}[], wired: {mac,ifName,vlan}[] }}
  function classifyFdbAssociations(opts) {
    const o = opts || {};
    const fdb = o.fdb || {};
    const wifiSet = (o.wifiIfs instanceof Set)
      ? o.wifiIfs
      : new Set((Array.isArray(o.wifiIfs) ? o.wifiIfs : []).map(x => String(x)));
    const types = o.ifTypeByName || {};
    const vl = o.fdbVlan || {};
    const wireless = [];
    const wired = [];
    for (const [mac, ifName] of Object.entries(fdb)) {
      const nm = String(ifName == null ? '' : ifName);
      const v = (vl[mac] != null) ? vl[mac] : null;
      const rec = { mac, ifName: nm, vlan: v };
      if (wifiSet.has(nm) || isWirelessInterface(nm, types[nm])) wireless.push(rec);
      else wired.push(rec);
    }
    return { wireless, wired };
  }

  // Unifica i client wireless di un device da DUE segnali, deduplicati per MAC:
  //   • FDB (L2): un MAC appreso su un'interfaccia radio (via classifyFdbAssociations);
  //   • VICINO L3 (ARP/ND): un MAC il cui vicino è su un'interfaccia radio (wifiNeighborMacs,
  //     già pre-filtrato dal driver). Universale (Windows/Linux/SoftAP), dove la FDB bridge
  //     non è esposta via SNMP.
  // La FDB (L2, più diretta) VINCE sul vicino L3 a parità di MAC. Ogni voce porta `source`
  // ('fdb'|'neighbor') così il chiamante può etichettare il link e pesarne la confidenza.
  //   fdb          = { mac -> ifName }          (FDB del device, già normalizzata) [opz]
  //   wifiIfs      = string[]                    (ifName wireless noti dal server)  [opz]
  //   wifiNeighborMacs = string[]               (MAC-vicini su radio, dal driver)  [opz]
  //   fdbVlan      = { mac -> vlanId }           (VLAN-per-MAC, per il match BSS)   [opz]
  // @returns {{mac:string, vlan:(number|null), source:'fdb'|'neighbor'}[]}
  function collectWirelessClients(opts) {
    const o = opts || {};
    const vl = o.fdbVlan || {};
    const key = m => String(m == null ? '' : m).toLowerCase();
    const byMac = new Map();
    const { wireless } = classifyFdbAssociations({ fdb: o.fdb, wifiIfs: o.wifiIfs, ifTypeByName: o.ifTypeByName, fdbVlan: vl });
    for (const w of wireless) {
      const k = key(w.mac);
      if (!byMac.has(k)) byMac.set(k, { mac: w.mac, vlan: w.vlan, source: 'fdb' });
    }
    for (const mac of (Array.isArray(o.wifiNeighborMacs) ? o.wifiNeighborMacs : [])) {
      if (!isUnicastMac(mac)) continue;                  // scarta broadcast/multicast/null (rumore ARP)
      const k = key(mac);
      if (byMac.has(k)) continue;                        // la FDB L2 ha priorità sul vicino L3
      byMac.set(k, { mac, vlan: (vl[mac] != null ? vl[mac] : null), source: 'neighbor' });
    }
    return [...byMac.values()];
  }

  // Sceglie il BSS servente sull'AP per un client associato, per MATCH VLAN (no-invenzioni:
  // se la VLAN non disambigua UN solo BSS, NON si indovina l'SSID → bssId null e l'utente
  // lo sceglie dal pannello del client, esattamente come nel flusso di disegno manuale).
  //   apSsidList = [{radioIdx,id,ssid,vlan,band}]  (da lib/radio.js apSsidList(apNode))
  //   vlan       = number|null                      (VLAN del client dalla FDB)
  // Ritorna sempre { radioIdx, bssId } (radioIdx = radio-ancora dell'AP a cui agganciare
  // l'onda; bssId può essere null). Precondizione del chiamante: l'AP HA almeno 1 radio.
  // @returns {{ radioIdx:number, bssId:(string|null) }}
  function resolveClientAssoc(opts) {
    const o = opts || {};
    const list = Array.isArray(o.apSsidList) ? o.apSsidList : [];
    const vlan = (o.vlan != null) ? o.vlan : null;
    if (!list.length) return { radioIdx: 0, bssId: null };  // AP senza SSID nominati → onda senza BSS
    if (vlan != null) {
      const byV = list.filter(s => s && s.vlan === vlan);
      if (byV.length === 1) return { radioIdx: byV[0].radioIdx || 0, bssId: byV[0].id };
      // 0 match o >1 stesso VLAN → ambiguo: non indovinare l'SSID (cade sotto).
    }
    if (list.length === 1) return { radioIdx: list[0].radioIdx || 0, bssId: list[0].id };
    // Più BSS e VLAN non risolutiva: aggancia alla radio del 1º BSS, BSS da scegliere a mano.
    return { radioIdx: list[0].radioIdx || 0, bssId: null };
  }

  return {
    IFTYPE_IEEE80211,
    isWirelessInterface,
    isUnicastMac,
    wirelessIfNames,
    classifyFdbAssociations,
    collectWirelessClients,
    resolveClientAssoc,
  };
});
