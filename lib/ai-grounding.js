'use strict';
// ============================================================
//  lib/ai-grounding.js — controllo a valle ANTI-INVENZIONE (paletto #2).
//
//  PURO (zero DOM/IO, ADR D4). Confronta le entità citate nel testo della
//  risposta del modello con quelle REALI del contesto (= ciò che il modello ha
//  davvero ricevuto). Spec §7: «un controllo a valle che confronta IP/MAC/nomi
//  citati nella risposta con quelli reali nel contesto».
//
//  Due funzioni, una coppia client/server:
//   • extractEntities(context) → digest compatto {devices, vlans, ips, macs} dal
//     contesto §8b. Lo calcola IL SERVER (server/routes/ai.js) sul contesto che
//     ha appena assemblato e lo restituisce al client insieme alla risposta →
//     il controllo gira su ciò che il modello ha visto DAVVERO (rispetta scope).
//   • checkGrounding(answer, entities) → { citations, unknownRefs }:
//       - citations  = device/VLAN del contesto effettivamente nominati nella
//         risposta → in UI diventano chip cliccabili (saltano al nodo sulla mappa).
//       - unknownRefs = IP/MAC presenti nella risposta ma ASSENTI dal contesto →
//         chip ⚠ «riferimento non trovato»: possibile invenzione.
//
//  Scelta di precisione: NON segnaliamo nomi-device inventati (il testo libero
//  genererebbe troppi falsi positivi). La garanzia «niente invenzioni» la diamo
//  sugli identificatori FORTI e verificabili — IP e MAC. «InfraNet calcola,
//  l'AI racconta»: qui verifichiamo che il racconto non aggiunga indirizzi finti.
//
//  Convenzione UMD-lite del progetto: caricato come <script> in netmapper.html
//  (assegna a window) PRIMA del bundle → il glue lo usa come global bare; in Node
//  (test + route) lo si require(). I consumatori NON lo importano nel bundle.
//
//  ⚠️ UNA dipendenza, e pura: lib/cidr.js, per `addrKey`. Gli indirizzi NON si
//  confrontano per stringa (regola del progetto), e qui si confrontavano in tre
//  punti — vedi `_ipKey`. In netmapper.html cidr.js e' caricato PRIMA (riga 1158
//  contro 1209), e comunque si legge a call-time: senza di lui la chiave degrada
//  alla stringa, che e' il comportamento di ieri, non un risultato inventato.
// ============================================================
(function (root, factory) {
  // `cidrLib` = lib/cidr.js: Node/bundle via require, browser via window. Stessa
  // convenzione di lib/ipam-audit.js e lib/correlate.js.
  const cidrLib = (typeof module !== 'undefined' && module.exports) ? require('./cidr.js') : root;
  const api = factory(cidrLib);
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (test/route)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function (cidrLib) {
  'use strict';

  // IP host (4 ottetti) e MAC (`:` o `-`). Globali → riusati con lastIndex=0.
  const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const MAC_RE = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
  // Indirizzi "tecnici" benigni (maschere/jolly): mai segnalati come invenzione.
  const BENIGN_IPS = new Set(['0.0.0.0', '255.0.0.0', '255.255.0.0', '255.255.255.0', '255.255.255.255']);

  const _s = (v) => (v == null ? '' : String(v)).trim();
  const _normMac = (v) => _s(v).toLowerCase().replace(/-/g, ':');
  const _isMac = (m) => /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m);
  // Che cosa e' un IPv4 lo dice lib/cidr.js, e UNA volta sola. Qui c'era una
  // definizione sua, piu' STRETTA: `String(n) === o` rifiutava gli zeri iniziali,
  // che cidr.js accetta DI PROPOSITO (e' scritto in `addrKey`, con una prova (F1)
  // che lo pinna). Conseguenza misurata: '192.168.001.005' veniva scartato e il
  // ciclo faceva `continue` — quindi un indirizzo nostro non veniva citato E un
  // indirizzo inventato non veniva segnalato. Il buco stava nel paletto #2.
  function _validIp(ip) {
    const f = cidrLib && cidrLib._parseIpv4Int;
    if (typeof f === 'function') return f(ip) != null;
    const p = String(ip).split('.');
    if (p.length !== 4) return false;
    return p.every((o) => { const n = Number(o); return o !== '' && /^\d+$/.test(o) && n >= 0 && n <= 255 && String(n) === o; });
  }
  // ⚠️ Mai confronti per STRINGA sugli indirizzi: la chiave sta in lib/cidr.js.
  // Senza cidr.js degrada alla stringa, che e' il comportamento di prima.
  function _ipKey(ip) {
    const f = cidrLib && cidrLib.addrKey;
    return typeof f === 'function' ? f(ip) : _s(ip);
  }

  // Match "parola intera" case-insensitive: evita che un nome corto (es. "AP")
  // matchi dentro un'altra parola ("APPLE"). Confini = non alfanumerici.
  function _wordHit(haystackLower, needleLower) {
    if (!needleLower) return false;
    let from = 0, i;
    while ((i = haystackLower.indexOf(needleLower, from)) !== -1) {
      const before = i === 0 ? '' : haystackLower[i - 1];
      const after = haystackLower[i + needleLower.length] || '';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
      from = i + 1;
    }
    return false;
  }

  // Digest delle entità note dal contesto §8b. Niente segreti: sono gli stessi
  // dati GIÀ sanitizzati del contesto (id/nome/ip/mac/vlan), solo riorganizzati.
  function extractEntities(context) {
    const ctx = (context && typeof context === 'object') ? context : {};
    const devices = [];
    const ips = new Set();
    const macs = new Set();
    const vlans = new Set();
    const addIp = (v) => { const s = _s(v); if (s && _validIp(s)) ips.add(s); };
    const addMac = (v) => { const m = _normMac(v); if (_isMac(m)) macs.add(m); };
    const addVlan = (v) => { const n = Number(v); if (Number.isFinite(n)) vlans.add(n); };

    for (const d of (Array.isArray(ctx.devices) ? ctx.devices : [])) {
      if (!d || typeof d !== 'object') continue;
      const id = _s(d.id), name = _s(d.name), ip = _s(d.ip), mac = _normMac(d.mac);
      devices.push({ id: id || null, name: name || null, ip: ip || null, mac: _isMac(mac) ? mac : null });
      addIp(ip); addMac(mac); addVlan(d.vlan);
      // Indirizzi che NON stanno sul nodo ma sono comunque nel contesto: le
      // interfacce L3 (l'IP di un router vive sulla porta) e le VM documentate
      // sull'host. Se restassero fuori dal digest, il modello che cita il lato
      // WAN — un dato che gli abbiamo dato noi — verrebbe accusato di
      // inventarselo: il controllo anti-invenzione deve conoscere TUTTO ciò che
      // è uscito, altrimenti punisce le risposte giuste.
      const ports = (d.ports && typeof d.ports === 'object') ? d.ports : {};
      for (const p of (Array.isArray(ports.list) ? ports.list : [])) {
        if (!p || typeof p !== 'object') continue;
        addIp(p.ip); addVlan(p.vlan);
      }
      for (const vm of (Array.isArray(d.vms) ? d.vms : [])) {
        if (!vm || typeof vm !== 'object') continue;
        addIp(vm.ip); addMac(vm.mac); addVlan(vm.vlan);
      }
    }
    for (const v of (Array.isArray(ctx.vlans) ? ctx.vlans : [])) {
      if (!v || typeof v !== 'object') continue;
      addVlan(v.id); addIp(v.gateway);
      const base = _s(v.subnet).split('/')[0]; if (base) addIp(base); // indirizzo di rete ≠ host inventato
    }
    // Reti dichiarate (prefissi): gateway e indirizzo di rete. Una rete senza
    // VLAN esiste solo qui — senza questo giro il suo gateway risultava «non
    // trovato» pur essendo documentato.
    for (const n of (Array.isArray(ctx.networks) ? ctx.networks : [])) {
      if (!n || typeof n !== 'object') continue;
      addVlan(n.vlan); addIp(n.gateway);
      const base = _s(n.cidr).split('/')[0]; if (base) addIp(base);
    }
    const facts = (ctx.facts && typeof ctx.facts === 'object') ? ctx.facts : {};
    const drift = (facts.drift && typeof facts.drift === 'object') ? facts.drift : {};
    // ⚠️ 'unverified' è entrato nel contesto DOPO questo elenco, e l'elenco non lo
    // sapeva: un indirizzo che gli abbiamo dato NOI (presenza non verificabile,
    // la sweep non copriva la subnet) tornava «riferimento non trovato» addosso al
    // modello che lo citava correttamente. È esattamente il caso da cui mette in
    // guardia il commento qui sopra, una categoria più tardi: il controllo
    // anti-invenzione deve conoscere TUTTO ciò che è uscito.
    for (const k of ['absent', 'undocumented', 'ipChanged', 'unverified']) {
      for (const e of (Array.isArray(drift[k]) ? drift[k] : [])) {
        if (!e || typeof e !== 'object') continue;
        addIp(e.ip); addIp(e.from); addIp(e.to); addMac(e.mac); addVlan(e.vlan);
      }
    }
    for (const e of (Array.isArray(facts.ipam) ? facts.ipam : [])) {
      if (!e || typeof e !== 'object') continue;
      addIp(e.nextFree); addVlan(e.vlan);
    }
    return { devices, vlans: [...vlans], ips: [...ips], macs: [...macs] };
  }

  // Confronta la risposta col digest. NON modifica nulla; ritorna i due elenchi.
  function checkGrounding(answer, entities) {
    const text = _s(answer);
    const ent = (entities && typeof entities === 'object') ? entities : {};
    const knownIps = new Set((Array.isArray(ent.ips) ? ent.ips : []).map(_s).filter(Boolean).map(_ipKey));
    const knownMacs = new Set((Array.isArray(ent.macs) ? ent.macs : []).map(_normMac).filter(_isMac));
    const knownVlans = new Set((Array.isArray(ent.vlans) ? ent.vlans : []).map(Number).filter(Number.isFinite));
    const devices = Array.isArray(ent.devices) ? ent.devices : [];
    if (!text) return { citations: [], unknownRefs: [] };
    const lower = text.toLowerCase();

    // ── Gli indirizzi IPv4 che la risposta NOMINA, cercati UNA volta ─────────
    // Questa scansione serve a DUE domande: quali device sono citati, e quali
    // indirizzi sono inventati. Prima erano due confronti diversi sullo stesso
    // testo, e solo uno dei due sapeva scartare OID e CIDR — cioe' la citazione
    // poteva agganciare uno spezzone di OID che la segnalazione scartava.
    const textIps = [];                 // { ip: come l'ha scritto il modello, key }
    const textIpKeys = new Set();
    {
      let im;
      IP_RE.lastIndex = 0;
      while ((im = IP_RE.exec(text))) {
        const ip = im[0];
        if (!_validIp(ip)) continue;
        if (text[im.index + ip.length] === '/') continue; // CIDR = una RETE, non un host
        // OID SNMP ≠ IP: un numero puntato DENTRO una catena più lunga (≥5 gruppi, es.
        // il Printer-MIB 1.3.6.1.2.1.43.11…) non è un host → il regex 4-ottetti ne
        // ritaglierebbe spezzoni come 1.3.6.1 / 2.1.43.11. Lo riconosciamo se il match
        // è preceduto da '.' o prosegue con '.<cifra>'.
        const before = im.index > 0 ? text[im.index - 1] : '';
        const after = text[im.index + ip.length] || '';
        if (before === '.' || (after === '.' && /\d/.test(text[im.index + ip.length + 1] || ''))) continue;
        const k = _ipKey(ip);
        textIps.push({ ip, key: k });
        textIpKeys.add(k);
      }
    }

    // ── Citazioni positive ──────────────────────────────────────────────────
    const citations = [];
    const citedDev = new Set();
    for (const d of devices) {
      if (!d) continue;
      const id = _s(d.id);
      if (!id || citedDev.has(id)) continue;
      const ip = _s(d.ip), mac = _normMac(d.mac), name = _s(d.name);
      let hit = false;
      // ⚠️ Era `text.includes(ip)`, che cita per PREFISSO: '10.0.0.1' e' vero
      // dentro '10.0.0.100', e il chip saltava a un ALTRO nodo. E' lo stesso
      // difetto che `_wordHit` qui sotto risolve per i NOMI, non risolto per gli
      // indirizzi. I MAC restano `includes`: hanno lunghezza fissa, quindi un MAC
      // valido non puo' essere prefisso proprio di un altro.
      if (ip && textIpKeys.has(_ipKey(ip))) hit = true;
      else if (_isMac(mac) && lower.includes(mac)) hit = true;
      else if (name && name.length >= 2 && _wordHit(lower, name.toLowerCase())) hit = true;
      if (hit) { citations.push({ kind: 'device', id, name: name || id }); citedDev.add(id); }
    }
    // VLAN: pattern «VLAN <n>» il cui numero è nel contesto.
    const citedVlan = new Set();
    const VLAN_RE = /vlan[\s#:]*?(\d{1,4})/gi;
    let vm;
    while ((vm = VLAN_RE.exec(text))) {
      const n = Number(vm[1]);
      if (Number.isFinite(n) && knownVlans.has(n) && !citedVlan.has(n)) {
        citations.push({ kind: 'vlan', vlan: n }); citedVlan.add(n);
      }
    }

    // ── Riferimenti sconosciuti (possibile invenzione): IP/MAC non nel contesto ─
    const unknownRefs = [];
    const seen = new Set();
    let m;
    // `BENIGN_IPS` tiene maschere in forma canonica, quindi il confronto per
    // chiave le riconosce anche scritte '255.255.255.000'.
    for (const t of textIps) {
      if (BENIGN_IPS.has(t.key) || knownIps.has(t.key)) continue;
      const key = 'ip:' + t.key;
      if (seen.has(key)) continue;
      seen.add(key);
      unknownRefs.push({ kind: 'ip', value: t.ip });
    }
    MAC_RE.lastIndex = 0;
    while ((m = MAC_RE.exec(text))) {
      const mac = _normMac(m[0]);
      if (!_isMac(mac) || knownMacs.has(mac)) continue;
      const key = 'mac:' + mac;
      if (seen.has(key)) continue;
      seen.add(key);
      unknownRefs.push({ kind: 'mac', value: m[0] });
    }

    return { citations, unknownRefs };
  }

  return { extractEntities, checkGrounding };
});
