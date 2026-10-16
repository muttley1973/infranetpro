// ============================================================
// NEIGHBOR TYPE — che COSA è un vicino LLDP/CDP, dalle prove che annuncia (puro)
// ============================================================
// Un vicino annunciato e non ancora documentato nasceva SEMPRE come «switch da 24 porte
// in rack»: un access point, un telefono, un server diventavano uno switch, e lo
// scaffale si riempiva di apparati che non stanno in un rack. Eppure il vicino dice da
// solo che cosa è, in due punti che il driver non leggeva:
//   · le CAPABILITIES — LLDP lldpRemSysCapEnabled (BITS, 2 byte), CDP cdpCacheCapabilities
//     (maschera, 4 byte). Dicono la FUNZIONE: bridge, router, access point, telefono…
//   · la PIATTAFORMA — LLDP lldpRemSysDesc, CDP cdpCachePlatform. Dice il MODELLO, e
//     serve dove le capabilities non bastano (un router e uno switch L3 annunciano lo
//     stesso «bridge + router»).
//
// LA REGOLA: il tipo si sceglie sulle prove, nell'ordine in cui sono affidabili, e dove
// non ce n'è nessuna si resta sul default storico (switch) — che resta una DEDUZIONE da
// confermare, come prima. `via` dice da dove è venuta la scelta: nessun chiamante deve
// presentare come letto ciò che è stato indovinato.
//
//   1. parole inequivocabili della piattaforma («Access Point», «FortiGate», «IP Phone»)
//   2. capabilities (access point > telefono > router/bridge)
//   3. parole di piattaforma deboli (Linux ⇒ server)
//   4. default: switch
//
// Puro: nessun DOM, nessun IO. Condiviso browser (<script>) + server + test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Capabilities ────────────────────────────────────────────────────────────
  // Il valore viaggia come stringa esadecimale (JSON-friendly): il driver non
  // interpreta, passa i byte; l'interpretazione sta qui, in un posto solo.
  function _bytes(hex) {
    const h = String(hex == null ? '' : hex).replace(/[^0-9a-f]/gi, '');
    if (!h || h.length % 2) return [];
    const out = [];
    for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
    return out;
  }

  // LLDP-MIB LldpSystemCapabilitiesMap: BITS, bit 0 = MSB del primo byte.
  //   0 other · 1 repeater · 2 bridge · 3 wlanAccessPoint · 4 router · 5 telephone
  //   6 docsisCableDevice · 7 stationOnly
  function parseLldpCaps(hex) {
    const bytes = _bytes(hex);
    // BITS = UN ottetto (a volte due, col secondo — i bit 8-15 — riservato e a zero). Una lunghezza
    // diversa, o un secondo ottetto non nullo, non e' un valore di capabilities: e' testo («01 7»,
    // «00») che un agente o una registrazione ha reso leggibile. Letto come bit darebbe un access
    // point da un server: meglio NESSUNA prova (null) che una falsa. Misurato su registrazioni vere.
    if (!bytes.length || bytes.length > 2 || (bytes.length === 2 && bytes[1] !== 0)) return null;
    const b = bytes[0];
    return {
      other: !!(b & 0x80), repeater: !!(b & 0x40), bridge: !!(b & 0x20), ap: !!(b & 0x10),
      router: !!(b & 0x08), phone: !!(b & 0x04), docsis: !!(b & 0x02), station: !!(b & 0x01),
    };
  }

  // CISCO-CDP-MIB cdpCacheCapabilities: maschera big-endian.
  //   0x01 router · 0x02 transparent bridge · 0x04 source-route bridge · 0x08 switch
  //   0x10 host · 0x20 IGMP · 0x40 repeater
  function parseCdpCaps(hex) {
    const bytes = _bytes(hex);
    if (!bytes.length || bytes.length > 4) return null;   // cdpCacheCapabilities: SIZE (0..4)
    let v = 0;
    for (const x of bytes) v = (v * 256) + x;
    return {
      router: !!(v & 0x01), bridge: !!(v & 0x02) || !!(v & 0x04) || !!(v & 0x08),
      switch: !!(v & 0x08), host: !!(v & 0x10), repeater: !!(v & 0x40),
    };
  }

  // Le due famiglie, ridotte a un solo vocabolario.
  function parseNeighborCaps(protocol, hex) {
    const isCdp = /^CDP/i.test(String(protocol || ''));
    if (isCdp) {
      const c = parseCdpCaps(hex);
      return c && { router: c.router, bridge: c.bridge, ap: false, phone: false, host: c.host, repeater: c.repeater };
    }
    const c = parseLldpCaps(hex);
    return c && { router: c.router, bridge: c.bridge, ap: c.ap, phone: c.phone, host: c.station, repeater: c.repeater };
  }

  // ── Parole della piattaforma ────────────────────────────────────────────────
  // Solo parole che non si prestano a equivoci: una regola larga («switch» dentro
  // qualunque descrizione) rovina più identità di quante ne indovini. L'ordine conta.
  const PLATFORM_STRONG = [
    ['ap',       /\baccess[ -]?point\b|\bAIR-(?:[CL]?AP|AP)\w|\bunifi\s+(?:ap|u6|uap)|\bUAP-|\bwlan\s+ap\b|\bEAP\d{3}\b|\bwAP\b/i],
    ['voip',     /\bip[ -]?phone\b|\bvoip\s+phone\b|\bCP-\d{4}\b|\bPolycom\b|\bYealink\b|\bSIP-T\d+|\bGXP\d{4}\b|\bSPA\d{3}\b/i],
    ['printer',  /\bprinter\b|\blaserjet\b|\bofficejet\b|\bbizhub\b|\bimagerunner\b/i],
    ['webcam',   /\bip[ -]?camera\b|\bnetwork camera\b|\baxis\s?[pmq]\d{4}\b|\bhikvision\b|\bDS-2CD/i],
    ['wlanctrl', /\bwireless\s+lan\s+controller\b|\bAIR-CT\d|\bWLC\b/i],
    ['firewall', /\bfirewall\b|\bfortigate\b|\bfortios\b|\bAdaptive Security Appliance\b|\bASA\d{4}\b|\bPAN-OS\b|\bpfsense\b|\bopnsense\b|\bsonicwall\b|\bsonicos\b|\bwatchguard\b|\bJuniper\b.*\bSRX\d+/i],
    ['hypervisor', /\bVMware ESXi?\b|\bproxmox\b|\bXenServer\b/i],
  ];
  const PLATFORM_SWITCH = /\bcatalyst\b|\bWS-C\d|\bC9[2-6]\d{2}\b|\bC[23]\d{3}[A-Z]?\b|\bnexus\b|\bprocurve\b|\bArubaOS-?CX\b|\bJuniper\b.*\bEX\d{4}\b|\bswitch\b/i;
  const PLATFORM_ROUTER = /\brouteros\b|\bISR\d{3,4}\b|\bASR\d{3,4}\b|\bC8\d{3}\b|\bCSR1000V\b|\bcisco\s?[12]\d{3}\b|\brouter\b/i;
  const PLATFORM_SERVER = /\blinux\b|\bubuntu\b|\bdebian\b|\bcentos\b|\bred hat\b|\bfreebsd\b|\bwindows server\b|\bidrac\b|\bilo\b/i;
  const PLATFORM_PC     = /\bwindows\s?(?:10|11|7)\b|\bdarwin\b|\bmacos\b/i;

  /**
   * @param {Object} nb { protocol?, caps?:hex, platform?:string, name?:string }
   * @returns {{ type:string, via:'platform'|'caps'|'default' }}
   */
  function inferNeighborType(nb) {
    const o = (nb && typeof nb === 'object') ? nb : {};
    const platform = String(o.platform == null ? '' : o.platform).slice(0, 400);
    const caps = parseNeighborCaps(o.protocol, o.caps);

    for (const [type, re] of PLATFORM_STRONG) if (platform && re.test(platform)) return { type, via: 'platform' };

    if (caps) {
      // Un access point e un telefono contengono quasi sempre un piccolo bridge: la
      // funzione che li definisce vince, a meno che non sia anche un router.
      if (caps.ap && !caps.router) return { type: 'ap', via: 'caps' };
      if (caps.phone && !caps.router) return { type: 'voip', via: 'caps' };
      if (caps.router && !caps.bridge) return { type: 'router', via: 'caps' };
      if (caps.router && caps.bridge) {
        // «bridge + router» è sia uno switch L3 sia un router: lo decide il modello.
        if (platform && PLATFORM_ROUTER.test(platform) && !PLATFORM_SWITCH.test(platform)) return { type: 'router', via: 'platform' };
        if (platform && PLATFORM_SWITCH.test(platform)) return { type: 'switch', via: 'platform' };
        return { type: 'switch', via: 'default' };
      }
      if (caps.bridge || caps.repeater) return { type: 'switch', via: 'caps' };
      if (caps.host) {
        if (platform && PLATFORM_PC.test(platform) && !PLATFORM_SERVER.test(platform)) return { type: 'pc', via: 'platform' };
        if (platform && PLATFORM_SERVER.test(platform)) return { type: 'server', via: 'platform' };
        return { type: 'pc', via: 'caps' };
      }
    }

    if (platform) {
      if (PLATFORM_SWITCH.test(platform)) return { type: 'switch', via: 'platform' };
      if (PLATFORM_ROUTER.test(platform)) return { type: 'router', via: 'platform' };
      if (PLATFORM_SERVER.test(platform)) return { type: 'server', via: 'platform' };
      if (PLATFORM_PC.test(platform)) return { type: 'pc', via: 'platform' };
    }
    return { type: 'switch', via: 'default' };
  }

  // L'IP che un vicino dichiara di sé è un'identità solo se è un indirizzo di
  // management raggiungibile: 0.x, loopback, link-local e multicast/riservati non lo
  // sono. Il driver li scarta già per LLDP; qui si decide per tutti i protocolli.
  function usableNeighborIp(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip == null ? '' : ip).trim());
    if (!m) return '';
    const b = m.slice(1, 5).map(Number);
    if (b.some(x => x > 255)) return '';
    if (b[0] === 0 || b[0] === 127 || b[0] >= 224) return '';
    if (b[0] === 169 && b[1] === 254) return '';
    return b.join('.');
  }

  // Il giro di Sync prima elenca i vicini «apparato non nel documento» e POI ne crea il
  // nodo: se il riepilogo non tiene conto del secondo passo dice, nello stesso toast,
  // «3 vicini non agganciati (apparato non nel documento)» e «materializzati 3 nodi».
  // Qui si tolgono dall'elenco i vicini il cui apparato è nato nel giro, riconosciuti per
  // MAC, IP o nome annunciato; gli altri motivi (porta non risolta, nessuna identità)
  // restano — il nodo creato non li risolve. Ritorna elenco e conteggio per motivo.
  function dropMaterialized(unresolved, made) {
    const list = Array.isArray(unresolved) ? unresolved : [];
    const m = Array.isArray(made) ? made : [];
    const lc = x => String(x == null ? '' : x).trim().toLowerCase();
    const macs = new Set(m.map(x => lc(x && x.mac)).filter(Boolean));
    const ips  = new Set(m.map(x => lc(x && x.ip)).filter(Boolean));
    const names = new Set(m.map(x => lc(x && x.hostname)).filter(Boolean));
    const rest = list.filter(u => {
      if (!u || u.reason !== 'device-unknown') return true;
      const hit = macs.has(lc(u.remoteMac)) || ips.has(lc(u.remoteIP)) ||
                  names.has(lc(u.remoteDevice)) || macs.has(lc(u.remoteDevice));
      return !hit;
    });
    const reasons = {};
    for (const u of rest) { const r = String((u && u.reason) || 'unknown'); reasons[r] = (reasons[r] || 0) + 1; }
    return { unresolved: rest, reasons };
  }

  return { parseLldpCaps, parseCdpCaps, parseNeighborCaps, inferNeighborType, usableNeighborIp, dropMaterialized };
});
