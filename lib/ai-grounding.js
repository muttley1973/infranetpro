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
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (test/route)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // IP host (4 ottetti) e MAC (`:` o `-`). Globali → riusati con lastIndex=0.
  const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const MAC_RE = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
  // Indirizzi "tecnici" benigni (maschere/jolly): mai segnalati come invenzione.
  const BENIGN_IPS = new Set(['0.0.0.0', '255.0.0.0', '255.255.0.0', '255.255.255.0', '255.255.255.255']);

  const _s = (v) => (v == null ? '' : String(v)).trim();
  const _normMac = (v) => _s(v).toLowerCase().replace(/-/g, ':');
  const _isMac = (m) => /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m);
  function _validIp(ip) {
    const p = String(ip).split('.');
    if (p.length !== 4) return false;
    return p.every((o) => { const n = Number(o); return o !== '' && /^\d+$/.test(o) && n >= 0 && n <= 255 && String(n) === o; });
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
    }
    for (const v of (Array.isArray(ctx.vlans) ? ctx.vlans : [])) {
      if (!v || typeof v !== 'object') continue;
      addVlan(v.id); addIp(v.gateway);
      const base = _s(v.subnet).split('/')[0]; if (base) addIp(base); // indirizzo di rete ≠ host inventato
    }
    const facts = (ctx.facts && typeof ctx.facts === 'object') ? ctx.facts : {};
    const drift = (facts.drift && typeof facts.drift === 'object') ? facts.drift : {};
    for (const k of ['absent', 'undocumented', 'ipChanged']) {
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
    const knownIps = new Set((Array.isArray(ent.ips) ? ent.ips : []).map(_s).filter(Boolean));
    const knownMacs = new Set((Array.isArray(ent.macs) ? ent.macs : []).map(_normMac).filter(_isMac));
    const knownVlans = new Set((Array.isArray(ent.vlans) ? ent.vlans : []).map(Number).filter(Number.isFinite));
    const devices = Array.isArray(ent.devices) ? ent.devices : [];
    if (!text) return { citations: [], unknownRefs: [] };
    const lower = text.toLowerCase();

    // ── Citazioni positive ──────────────────────────────────────────────────
    const citations = [];
    const citedDev = new Set();
    for (const d of devices) {
      if (!d) continue;
      const id = _s(d.id);
      if (!id || citedDev.has(id)) continue;
      const ip = _s(d.ip), mac = _normMac(d.mac), name = _s(d.name);
      let hit = false;
      if (ip && text.includes(ip)) hit = true;
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
    IP_RE.lastIndex = 0;
    while ((m = IP_RE.exec(text))) {
      const ip = m[0];
      if (!_validIp(ip)) continue;
      if (text[m.index + ip.length] === '/') continue; // CIDR = una RETE, non un host
      // OID SNMP ≠ IP: un numero puntato DENTRO una catena più lunga (≥5 gruppi, es.
      // il Printer-MIB 1.3.6.1.2.1.43.11…) non è un host → il regex 4-ottetti ne
      // ritaglierebbe spezzoni come 1.3.6.1 / 2.1.43.11. Lo riconosciamo se il match
      // è preceduto da '.' o prosegue con '.<cifra>'.
      const before = m.index > 0 ? text[m.index - 1] : '';
      const after = text[m.index + ip.length] || '';
      if (before === '.' || (after === '.' && /\d/.test(text[m.index + ip.length + 1] || ''))) continue;
      if (BENIGN_IPS.has(ip) || knownIps.has(ip)) continue;
      const key = 'ip:' + ip;
      if (seen.has(key)) continue;
      seen.add(key);
      unknownRefs.push({ kind: 'ip', value: ip });
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
