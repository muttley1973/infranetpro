// ============================================================
// DEVICE-MODEL-KIND — di che TIPO è un modello del catalogo CC0, e quali modelli propone «Applica modello»
// (UMD-lite, browser + Node · puro · nessun I/O)
// ============================================================
// La libreria NetBox dà il MODELLO, non il TIPO: nessun campo di ruolo (v. `roleOf` in tools/import-device-types.js,
// che ne ricava uno per segnale strutturale: prese elettriche, porte seriali, radio, densità di porte). Quel ruolo
// separa UPS/PDU, NAS, console server e punti di accesso da «apparato di rete», ma non dice se l'apparato di rete è
// uno switch, un router o un firewall: per quello c'è solo il NOME, e il nome non basta sempre.
//
// ⚠️ Per questo `networkKind` è PRUDENTE: decide solo dove il nome porta un segnale che non può essere altro (la
// parola «firewall», una famiglia nota, un marchio che fa solo quel mestiere). Tutto il resto resta `null`, cioè
// «non so»: e un modello che non si sa classificare si propone a TUTTI i tipi di rete, mai a nessuno. Un elenco che
// nasconde per errore il modello giusto è peggio di uno che ne mostra uno di troppo; e comunque «Mostra tutti i
// modelli» li ridà tutti. La classificazione serve SOLO a restringere i suggerimenti: non scrive niente nel progetto.
//
// Una definizione sola: la usa il generatore del catalogo (che scrive `role` in ogni modello) e nessun altro punto.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [tipo, marchio (regex sul nome del produttore) o null, modello (regex)] — il primo che combacia vince, quindi
  // le eccezioni stanno PRIMA della regola larga (un «Cloud Router Switch» è uno switch, non un router; un
  // MikroTik RB260 è uno switch anche se «RB» è la sigla delle RouterBOARD).
  const RULES = [
    // ── eccezioni ──
    ['switch', null, /\brouter[- ]?switch\b/i],
    ['switch', /mikrotik/i, /^(crs|css|rb2[56]0)/i],
    // ── firewall ──
    ['firewall', null, /\bfirewall\b|\bngfw\b|\butm\b|\bsecurity appliance\b/i],
    ['firewall', /fortinet/i, /^forti(gate|wifi)\b|^f[gw][a-z]?-?\d/i],
    ['firewall', /cisco/i, /^(asa[- ]?\d|firepower|ftdv?\b|secure firewall)/i],
    ['firewall', null, /\bmeraki mx ?\d/i],
    ['firewall', /palo ?alto/i, /^pa-?\d/i],
    ['firewall', /juniper/i, /^v?srx ?\d/i],
    ['firewall', /sonicwall/i, /^(tz|nsa|nssp|nsv)[ -]?\d/i],
    ['firewall', /watchguard/i, /^(firebox|xtm|t\d{2}|m\d{3,4})\b/i],
    ['firewall', /sophos/i, /^(xgs?|sg|xstream)[ -]?\d/i],
    ['firewall', /zyxel/i, /^(zywall|usg|atp|vpn)[ -]?\d?/i],
    ['firewall', /huawei/i, /^(usg|eudemon)/i],
    ['firewall', /yamaha/i, /^fwx/i],
    ['firewall', /check ?point|stormshield|netgate|hillstone|deciso|endian|gateprotect/i, /./],
    // ── router ──
    ['router', null, /\brouter\b/i],
    ['router', /cisco/i, /^(isr[- ]?\d|asr[- ]?\d|csr[- ]?\d|c8\d{2,3}\b|catalyst 8\d{3}|ncs[- ]?\d|ir ?\d{3,4}|8\d{3}-)/i],
    ['router', /juniper/i, /^(mx ?\d|ptx|acx|vmx)/i],
    ['router', /mikrotik/i, /^(rb|ccr|hex|rbd|l009)/i],
    ['router', /ubiquiti/i, /^(edgerouter|er-?\d|udr\b|unifi dream router)/i],
    ['router', /huawei/i, /^(ne\d{2}|ar\d{3,4})/i],
    ['router', /hp|h3c|hewlett/i, /(msr|hsr)[- ]?\d/i],
    ['router', /yamaha/i, /^rtx/i],
    ['router', /eltex/i, /^esr/i],
    ['router', /tp-?link/i, /^(archer|er\d{3}|tl-r\d)/i],
    ['router', /cradlepoint|peplink|teltonika|draytek/i, /./],
    // ── switch ──
    ['switch', null, /switch/i],
    ['switch', /cisco/i, /^(catalyst|nexus|ws-c|c9[2-9]\d{2}|c1[0-3]\d{2}|cbs|sg\d{3}|sf\d{3}|ie-?\d|n9k|n\dk)/i],
    ['switch', null, /\bmeraki ms ?\d/i],
    ['switch', /arista/i, /^(dcs|ccs)-/i],
    ['switch', /juniper/i, /^(ex ?\d|qfx)/i],
    ['switch', /ubiquiti/i, /^(usw|us-|unifi switch)/i],
    ['switch', /hp|hewlett|aruba/i, /^(aruba )?(2[5-9]\d{2}|3\d{3}|5[0-4]\d{2}|6[0-4]\d{2}|8\d{3}|cx ?\d)|procurve|^officeconnect|flexnetwork \d{4}|^hp \d{4}/i],
    ['switch', /huawei/i, /^(s\d{4}|ce\d{4})/i],
    ['switch', /ruckus|brocade/i, /^(icx|vdx|fcx)/i],
    ['switch', /extreme/i, /^(fabricengine|x\d{3}|5[0-9]{3}|7[0-9]{3}|vsp|ers|summit)/i],
    ['switch', /allied telesis/i, /^(x\d{3}|gs\d|ie\d|sbx|at-)/i],
    ['switch', /lancom/i, /^(gs|xs)-\d/i],
    ['switch', /eltex/i, /^mes\d/i],
    ['switch', /yamaha/i, /^swx/i],
    ['switch', /supermicro/i, /^sse-/i],
    ['switch', /mellanox/i, /^(sx|sn)\d/i],
    ['switch', /^fs$|datto|hikvision/i, /^(s\d{4}|n\d{4}|dsw|ds-3e)/i],
    ['switch', /edgecore|datacom|d-link|netgear|tp-link|zyxel|dell|alcatel|rockwell|moxa|hirschmann|siemens/i, /^(as\d|dm\d|dgs|des|dxs|dms|gs\d|xgs|ges|es\d|ms\d|m4|xs\d|tl-s|t\d{4}|sg\d|n\d{4}|s\d{4}|z\d{4}|powerswitch|powerconnect|\d{4}|os\d{4}|stratix|eds-|scalance)/i],
    // ── né switch, né router, né firewall: server, storage, controllori industriali (restano visibili dove il tipo non si restringe) ──
    ['other', /netapp|cohesity|seagate|quantum|overland|xfusion|pure storage|nimble|infinidat|supermicro/i, /./],
    ['other', /lenovo/i, /thinksystem|system x|thinkagile|^sr\d{3}\b/i],
    ['other', /dell/i, /^(poweredge|powervault|powerscale|powerstore|unity|isilon)/i],
    ['other', /hp|hewlett/i, /apollo|proliant|synergy|storeonce|p2000|\bmsa\b|simplivity|3par|superdome|primera|alletra|chassis/i],
    ['other', /cisco/i, /^ucs/i],
    ['other', /huawei/i, /^(\d{4}h|taishan|fusionserver)/i],
    ['other', /rockwell/i, /logix|i\/o|compact 5000|point ?i\/o|flex ?i\/o|powerflex|kinetix/i],
  ];

  /** 'firewall' | 'router' | 'switch' | 'other' (server, storage, controllore: non è un apparato di rete) | null (non so).
   *  Solo per un modello che il ruolo strutturale ha lasciato fra gli apparati di rete: chi chiama sa che lo è. */
  function networkKind(brand, model) {
    const b = String(brand == null ? '' : brand);
    let m = String(model == null ? '' : model).trim();
    // «HPE HPE Apollo», «Cisco Cisco WS-C2950»: il modello che ripete il marchio si legge senza la ripetizione.
    const first = b.split(/\s+/)[0];
    if (first && m.toLowerCase().startsWith(first.toLowerCase() + ' ')) m = m.slice(first.length + 1);
    // Si legge il MODELLO (e il marchio solo dove la regola lo chiede): un marchio che ha «switch» nel nome non fa
    // di ogni suo modello uno switch. Un modello vuoto non combacia con niente.
    for (const [kind, brandRx, modelRx] of RULES) {
      if (modelRx.test(m) && (!brandRx || brandRx.test(b))) return kind;
    }
    return null;
  }

  // I ruoli che il catalogo porta in `role` (scritti dal generatore): quelli di roleOf e, per l'apparato di rete, il tipo.
  const NETWORK_ROLES = Object.freeze(['switch', 'router', 'firewall', 'other', 'network', 'chassis']);
  // Tutti i valori che `role` puo' avere nel catalogo: quelli di rete e quelli del ruolo strutturale (roleOf).
  const ALL_ROLES = Object.freeze(NETWORK_ROLES.concat(['power', 'nas', 'console', 'ap']));

  // Quale ELENCO di modelli propone «Applica modello» per un tipo di dispositivo: il nome dell'elenco, o null = tutti
  // (un tipo per cui il catalogo non ha una classe propria non si restringe: non si nasconde ciò che non si sa).
  const LIST_OF_TYPE = Object.freeze({
    switch: 'switch', router: 'router', firewall: 'firewall',
    ups: 'power', pdu: 'power', ats: 'power',
    nas: 'nas',
    consolesvr: 'console',
    wlanctrl: 'ap',
  });

  /** L'elenco per un tipo di dispositivo ('switch', 'router', 'firewall', 'power', 'nas', 'console', 'ap'), o null. */
  function modelListFor(nodeType) {
    return Object.prototype.hasOwnProperty.call(LIST_OF_TYPE, nodeType) ? LIST_OF_TYPE[nodeType] : null;
  }

  /** Il modello `entry` sta nell'elenco `list`? Un modello senza `role` (catalogo vecchio) o di rete non classificato sta
   *  in TUTTI gli elenchi di rete: non si nasconde ciò che non si sa. Gli altri ruoli stanno solo nel proprio. */
  function modelInList(entry, list) {
    const role = entry && typeof entry.role === 'string' ? entry.role : '';
    if (!role) return true;
    if (list === 'switch' || list === 'router' || list === 'firewall') {
      if (role === list) return true;
      return role === 'network' || role === 'chassis';
    }
    return role === list;
  }

  return { networkKind, modelListFor, modelInList, NETWORK_ROLES, ALL_ROLES };
});
