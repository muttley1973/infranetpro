'use strict';
// ============================================================
//  lib/device-patterns.js — tabelle REGEX CANONICHE per tipo device (PURO, UMD-lite).
//
//  Unica fonte dei pattern vendor/modello -> tipo, condivisa dal classificatore
//  AUTOREVOLE (engine/fusion-scorer.js) e dal fallback client
//  (src/app-discovery-classify.js `_guessType`/`_discSanitizeDeviceClass`), cosi'
//  le due copie non divergono piu' (B3). Complementa lib/device-signatures.js
//  (tabella OID->tipo): li' i sysObjectID, qui i pattern testuali.
//
//  I pattern sono ESTRATTI VERBATIM dal FusionScorer (comportamento invariato:
//  lo garantisce tests/classify-golden.test.js). Il consumatore "a somma"
//  (fusion) li pesa; quelli "first-match" (client) li valutano in ordine.
//
//  INVARIANTE — vendor identita' != tipo: un sostantivo-tipo generico
//  (gateway/router/switch/firewall) dentro un NOME AZIENDA non decide il tipo
//  (VENDOR_TYPE_NOUN_RE lo rimuove prima). I token di BRAND reali restano.
//
//  ALLINEAMENTO TASSONOMIA — i tipi InfraNet mappano ~1:1 sul vocabolario
//  standard-de-facto di Nmap ("Device Type", nmap-os-db). Cross-walk (le CHIAVI
//  interne NON cambiano — romperebbe i progetti salvati; e' solo il riferimento):
//    router->router · switch->switch · firewall->firewall · ap->WAP · wlanctrl->WAP(controller)
//    nas->storage-misc · printer->printer · webcam->webcam · voip->VoIP phone/adapter
//    ups/pdu->power-device · tv->media device · sdwan->router(WAN) · server->general purpose
//    hypervisor->general purpose(virt) · pc->general purpose · mobile->phone · iot->specialized
//  (una tassonomia non e' copyrightabile: i NOMI si possono rispecchiare; i DATI
//  Nmap sono NPSL e NON embeddabili -> mai importati.)
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SWITCH_WORDS_RE = /switch|gs\d{3,4}|xgs\d{3,4}|catalyst|nexus|procurve|comware|ios[_-]?l2|l2iol/;
  // Guard NEGATIVO per il voto 'switch': la parola "switch" nel testo ma NON uno
  // switch di RETE — KVM switch (console) e transfer switch (ATS/STS). Solo
  // parole-funzione, zero brand (vendor-neutral); i tipi veri votano con le loro
  // regex (KVM_RE / ATS_RE sotto).
  const NOT_A_NET_SWITCH_RE = /\bkvm\b|kvm[- ]?over[- ]?ip|transfer[- ]?switch|automatic[- ]?transfer|static[- ]?transfer/;
  const ROUTER_WORDS_RE = /router|gateway|junos|mikrotik|vyos|openwrt|edgerouter|zywall|usg|fritz|web-based configurator/;
  const NET_VENDOR_GW_RE = /zyxel|tp-link|netgear|d-link|mikrotik|ubiquiti|huawei|avm|fritz/;
  const PRINTER_RE = /officejet|laserjet|deskjet|pagewide|designjet|colorlaserjet|printer|printserver|\bhp.*print|print.*hp|epson|xerox|ricoh|kyocera|jetdirect|imagerunner|imageclass|ecosys|taskalfa|bizhub|lexmark|brother/;
  const WEBCAM_RE = /reolink|hikvision|dahua|vivotek|hanwha|uniview|axis.*camera|bosch.*security|\bcctv\b|ip.?camera|\bnvr\b|\bdvr\b|onvif/;
  const NAS_RE = /\bnas\b|synology|sinology|qnap|lacie|truenas|freenas|netapp|readynas|buffalo|drobo|iomega|wd\s*my\s*cloud|seagate\s*nas|asustor|terramaster|openmediavault/;
  const FIREWALL_RE = /fortigate|fortinet|pfsense|opnsense|firewall|sonicwall|watchguard|checkpoint|palo\s?alto|pan-os|panorama|\basa\b|sophos.*utm|sophos.*firewall|stormshield|barracuda.*firewall/;
  const AP_RE = /\baironet\b|air-ap[0-9]|unifi.*ap|\buap-|ruckus|zoneflex|unleashed|aruba.*iap|aruba.*rap|\biap-[0-9]|\brap-[0-9]|meraki\s*mr|access point|\bap\b|omada.*ap|eap[0-9]{3,4}|wlan controller/;
  // Wireless LAN Controller (WLC) — ruolo distinto dall'AP, dal descr/modello del
  // device stesso, cross-vendor (Cisco AireOS "Cisco Controller"/AIR-CT, Catalyst
  // 9800, Aruba "mobility controller"). Vendor-neutral: e' la FUNZIONE, non un brand.
  const WLANCTRL_RE = /wireless\s*lan\s*controller|wlan\s*controller|wireless\s*controller|mobility\s*controller|\bwlc\b|\bwism\b|air-?ct[0-9]|cisco\s*controller|aire-?os|catalyst\s*9800|\bc9800/;
  const PDU_RE = /\bpdu\b|power.?distribution|raritan|servertech|\bgeist\b/;
  const UPS_RE = /\bups\b|\bapc\b|powerware|cyberpower|riello|liebert|vertiv/;
  const VOIP_RE = /polycom|yealink|grandstream|\bsnom\b|\bmitel\b|\baastra\b|sip.*phone|voip.*phone/;
  const IOT_EMBED_RE = /keil-eweb|embedded web|webrelay|modbus|plc|eaton corporation/;
  const ROUTER_VENDOR_RE = /mikrotik|routeros|edgerouter|edgeos|unifi gateway|\busg\b|\budm\b|dream machine|tp-link.*router|netgear.*router|d-link.*router|draytek|fritz!box|fritzbox|openwrt|vyos/;
  const SWITCH_VENDOR_RE = /aruba|comware|procurve|cx\s*[0-9]{4}|ex[0-9]{3,4}|qfx[0-9]{3,4}|nexus|catalyst|brocade|icx[0-9]{4}|extreme.*switch|dell.*powerconnect|dell.*n[0-9]{4}|d-link.*switch|tp-link.*switch|netgear.*switch/;
  const JUNIPER_FIREWALL_RE = /juniper.*srx|\bsrx[0-9]{3,4}\b/;
  const JUNIPER_ROUTER_RE = /juniper.*(?:mx|ptx|acx)|\bmx[0-9]{3,4}\b|\bptx[0-9]{3,4}\b|\bacx[0-9]{3,4}\b/;
  // ── Nuovi apparati distinti (riconciliazione tassonomia 2026-07-22) ─────────
  // Funzione dichiarata PRIMA, brand solo come recall additivo su testo MISURATO
  // (sysDescr/banner annunciati dal device). Brand multi-prodotto bare ESCLUSI
  // (vendor != tipo): raritan resta in PDU_RE, epson in PRINTER_RE, avocent/
  // lantronix/digi solo via linee-prodotto.
  // ATS/STS: transfer switch di alimentazione (il guard NOT_A_NET_SWITCH evita 'switch').
  const ATS_RE = /\bats\b|transfer[- ]?switch|automatic[- ]?transfer|static[- ]?transfer/;
  // NVR/DVR/XVR: videoregistratore di rete (aggregatore, non endpoint webcam).
  const NVR_RE = /\bnvr\b|\bdvr\b|\bxvr\b|network video recorder|digital video recorder/;
  // VPN concentrator/head-end. NIENTE token bare "vpn" (ogni router/firewall lo
  // cita) e NIENTE \basa\b (un ASA e' un firewall, resta in FIREWALL_RE).
  const VPNCON_RE = /vpn.{0,12}concentrator|anyconnect|pulse ?secure|ivanti ?connect/;
  // Centralino IP (appliance o software cross-hardware: Asterisk/FreePBX/3CX…),
  // distinto dal telefono voip endpoint. UCM6xxx = linea PBX Grandstream.
  const PBX_RE = /asterisk|freepbx|fusionpbx|\b3cx\b|issabel|elastix|yeastar|sangoma|\bucm6\d{3}\b|ip.?pbx|\bpbx\b/;
  // Console/serial server (out-of-band mgmt): funzione o linee-prodotto (IOLAN=
  // Perle, SLC=Lantronix, ACS=Avocent, CM/Passport=Digi).
  const CONSOLESVR_RE = /opengear|console ?server|serial ?console|\biolan\b|lantronix ?slc|avocent ?acs|digi ?(?:cm|passport)/;
  // Proiettore: funzione o protocollo standard PJLink (JBMIA). Brand bare esclusi
  // (epson fa stampanti, benq monitor…).
  const PROJECTOR_RE = /\bprojector\b|proiettore|pj-?link/;
  // KVM switch/over-IP. NIENTE \bkvm\b bare in positivo: collide con QEMU/KVM
  // (hostname "kvm-host-01" di un hypervisor); il bare resta solo nel guard.
  const KVM_RE = /kvm.{0,8}switch|kvm[- ]?over[- ]?ip|ip[- ]?kvm|\baten\b|dominion ?kx|switchview|autoview/;
  // Controller di accesso/varchi. "door controller" (non "access control": match
  // su "Access Control List" di uno switch; ne' "access controller": e' il nome
  // dei WLC Huawei) + modelli/brand single-purpose.
  const DOORCTRL_RE = /door ?controller|\bvertx\b|axis ?a1001|\bpaxton\b|net2 ?plus|\bsuprema\b|biostar/;
  const HYPERVISOR_RE = /vmware\s*esx|esxi|proxmox|hyper.?v|xcp-ng|xenserver|nutanix|\bahv\b/;
  const SERVER_VIRT_RE = /windows server|truenas scale|pnetlab|eve-ng|unetlab|openstack|kubernetes|k8s|docker/;
  const SERVER_LINUX_RE = /ubuntu server|debian|centos|red\s?hat|fedora|suse|freebsd|rocky linux|alma linux|oracle linux/;
  const APPLIANCE_RE = /washing ?machine|\bwasher\b|tumble ?dryer|\bdryer\b|dishwasher|refrigerator|\bfridge\b|freezer|\boven\b|microwave|cooktop|range ?hood|cooker ?hood|air ?conditioner|air ?con\b|\bhvac\b|heat ?pump|thermostat|\bboiler\b|water ?heater|dehumidifier|humidifier|air ?purifier|robot ?vacuum|\bvacuum\b|coffee ?machine|lavatrice|asciugatrice|lavastoviglie|frigo(?:rifero)?|congelatore|\bforno\b|microonde|\bcappa\b|condizionatore|climatizzatore|caldaia|scaldabagno|scaldacqua|aspirapolvere|deumidificatore|umidificatore|purificatore|macchina ?caff/;
  const SMART_HOME_RE = /thinq|smartthings|smart ?life|\btuya\b|tasmota|sonoff|\bshelly\b|esphome|espressif|home ?assistant|homekit|\bmatter\b|zigbee|z-?wave|miele@?home|home ?connect|\bhon\b|electrolux|whirlpool|gorenje|miele|\bbeko\b|smart ?plug|smart ?bulb|smart ?(?:light )?switch|smart ?lock|doorbell|\bsensor\b|daikin|azurewave/;
  const TV_SIGNAL_RE = /lg ?webos|\bwebos\b|tizen|android ?tv|google ?tv|\btvos\b|fire ?tv|firetv|\broku\b|\bvidaa\b|netcast|\bbravia\b|\boled\b|\bqled\b|nanocell|the ?frame|smart ?tv|\btelevision\b|televisore/;
  const MEDIA_PLAYER_RE = /nvidia ?shield|\bshield\b|apple ?tv|mi ?box|fire ?stick|firestick|dlna ?renderer|miracast/;
  const PC_OS_RE = /vmware\s*esx|esxi|proxmox|hyper.?v|windows server|nas|synology|qnap|truenas|freenas|samba server/;
  const PC_HOSTNAME_RE = /^desktop-|^win[0-9-]|^win-|workstation|laptop|notebook/i;
  const PC_VENDOR_RE = /hewlett packard|dell|lenovo|intel|apple|parallels|microsoft|asus|acer|toshiba|pcs systemtechnik|vmware/;
  // Sostantivi-tipo GENERICI ("false friend") rimossi dal NOME AZIENDA del vendor
  // prima del testo di classificazione (guardrail vendor != tipo). global+i.
  const VENDOR_TYPE_NOUN_RE = /\b(?:gateway|router|switch|firewall)\b/gi;

  return {
    SWITCH_WORDS_RE, NOT_A_NET_SWITCH_RE, ROUTER_WORDS_RE, NET_VENDOR_GW_RE, PRINTER_RE, WEBCAM_RE, NAS_RE,
    FIREWALL_RE, AP_RE, WLANCTRL_RE, PDU_RE, UPS_RE, VOIP_RE, IOT_EMBED_RE,
    ATS_RE, NVR_RE, VPNCON_RE, PBX_RE, CONSOLESVR_RE, PROJECTOR_RE, KVM_RE, DOORCTRL_RE,
    ROUTER_VENDOR_RE, SWITCH_VENDOR_RE, JUNIPER_FIREWALL_RE, JUNIPER_ROUTER_RE,
    HYPERVISOR_RE, SERVER_VIRT_RE, SERVER_LINUX_RE, APPLIANCE_RE, SMART_HOME_RE,
    TV_SIGNAL_RE, MEDIA_PLAYER_RE, PC_OS_RE, PC_HOSTNAME_RE, PC_VENDOR_RE,
    VENDOR_TYPE_NOUN_RE,
  };
});
