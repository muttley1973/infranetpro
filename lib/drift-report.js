// ============================================================
// DRIFT REPORT — diff engine puro (Reality Check / N1)
// ============================================================
// Confronta la DOCUMENTAZIONE con la REALTA' rilevata dal sync SNMP e
// produce un report strutturato in 5 categorie. Funzione PURA: nessun
// accesso a DOM/state/global — input espliciti → output JSON. La UI e
// l'orchestrazione (sync, snapshot, persistenza ignore/streak) vivono
// altrove (lib/app-drift.js). Condiviso browser + test (UMD-lite).
//
// ── SCHEMA INPUT ─────────────────────────────────────────────────────
// doc = {
//   ports:  { [pid]: { label, status, speed, duplex, vlan } }  // documentazione porta
//   macs:   [ { mac, label, nodeId?, ip?, ipManual? } ]         // MAC documentati; nodeId per "ha risposto", ip per il cambio-IP, ipManual = pin manuale
//   deviceSigs: [ sig ]                                         // firme dei device noti
//   cables: [ { id, label, src, dst } ]                         // cavi documentati (pid estremi)
// }
// snmp = {
//   responded:       { [nodeId]: true }            // device che ha risposto a QUESTO sync
//   ports:           { [pid]: { status, speed, duplex, vlan } }  // realta' rilevata
//   observedMacs:    [ mac ]                        // MAC visti in rete (FDB / ifPhysAddress / ARP)
//   fdbObserved:     bool?                           // c'è almeno un FDB popolato?
//   presentNodeIds:  { [nodeId]: true }              // nodi confermati presenti (ping/ARP/TCP/LLDP)
//   macAtIp:         { [macLower]: ipVivo }           // MAC visto VIVO a un IP (ARP della sweep) → presenza per-MAC + cambio-IP
//   observedSubnets: [ '10.0.1', '192.168.1' ]        // /24 OSSERVATI dalla sweep (ARP/ping): l'assenza è affidabile solo qui
//   reachabilityChecked: bool?                       // è stata eseguita la sweep di raggiungibilità?
//   (osservabilità per macOrphan = fdbObserved || reachabilityChecked; senza, niente "assenti")
//   observedDevices: [ { sig, mac, label } ]        // device/MAC visti, non documentati
//   rejectedSigs:    [ sig ]                         // rejectedAutoLinks (link gia' rifiutati)
//   portDownStreak:  { [pid]: N }                    // sync consecutivi con porta down (orchestratore)
// }
// ignores = [ key ]          // chiavi soppresse, persistite (Gate 0 dec.4)
// opts    = { downStreakN: 3 }  // soglia "cavo fantasma" (Gate 0 dec.6)
//
// ── OUTPUT ───────────────────────────────────────────────────────────
// { counts:{consistent,stateDrift,macOrphan,undocumented,ghostCable,ipChanged,unverified},
//   consistent[], stateDrift[], macOrphan[], undocumented[], ghostCable[],
//   ipChanged[] ({mac,label,oldIp,newIp,nodeId,manual} — MAC documentato vivo a IP diverso; manual=IP fissato a mano),
//   unverified[] ({mac,label,nodeId,ip} — subnet fuori dalla portata della sweep: presenza NON confermata) }
// Ogni riga ha `key` STABILE con fingerprint della condizione: se la realta'
// cambia, la chiave cambia → una riga "ignorata" riappare (semantica
// "ignora finche' la condizione non cambia").
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // null/undefined/'' → null (campo "non documentato/non rilevato")
  function _v(x) { return (x === undefined || x === null || x === '') ? null : x; }
  function _nodeOf(pid) {
    const s = String(pid);
    const cut = s.lastIndexOf('-');
    return cut > 0 ? s.slice(0, cut) : s;
  }

  function buildDriftReport(snmp, doc, ignores, opts) {
    snmp = snmp || {}; doc = doc || {}; opts = opts || {};
    const N = Number.isFinite(opts.downStreakN) ? opts.downStreakN : 3;
    const ign = new Set(ignores || []);
    const responded = snmp.responded || {};
    const realPorts = snmp.ports || {};
    const docPorts = doc.ports || {};
    const out = { consistent: [], stateDrift: [], macOrphan: [], undocumented: [], ghostCable: [], ipChanged: [], unverified: [] };

    // 1 & 2 — porte coerenti / discrepanze di stato
    for (const pid of Object.keys(docPorts)) {
      const dp = docPorts[pid] || {};
      if (!responded[_nodeOf(pid)]) continue;        // device muto → non valutabile, salta
      const rp = realPorts[pid] || {};
      const diffs = [];
      const dStatus = _v(dp.status), rStatus = _v(rp.status);
      // documentata attiva ma realta' non attiva (down/inactive/fault)
      if (dStatus === 'active' && rStatus && rStatus !== 'active') diffs.push({ field: 'status', doc: dStatus, real: rStatus });
      const dSpeed = _v(dp.speed), rSpeed = _v(rp.speed);
      if (dSpeed != null && rSpeed != null && String(dSpeed) !== String(rSpeed)) diffs.push({ field: 'speed', doc: dSpeed, real: rSpeed });
      const dDup = _v(dp.duplex), rDup = _v(rp.duplex);
      if (dDup != null && rDup != null && String(dDup) !== String(rDup)) diffs.push({ field: 'duplex', doc: dDup, real: rDup });
      const dVlan = _v(dp.vlan), rVlan = _v(rp.vlan);
      if (dVlan != null && rVlan != null && String(dVlan) !== String(rVlan)) diffs.push({ field: 'vlan', doc: dVlan, real: rVlan });

      if (diffs.length === 0) {
        out.consistent.push({ key: `ok:${pid}`, pid, label: dp.label || pid });
      } else {
        // fingerprint = valori REALI dei campi divergenti → ignore segue la condizione
        const fp = diffs.map(d => `${d.field}=${d.real}`).sort().join(';');
        out.stateDrift.push({
          key: `drift:${pid}:${fp}`, pid, label: dp.label || pid, diffs,
          patch: { pid, status: rStatus, speed: rSpeed, duplex: rDup, vlan: rVlan },
        });
      }
    }

    // 3 — Documentati ASSENTI IN RETE (audit di presenza MULTI-SEGNALE)
    // Un device documentato è "assente" SOLO se ha un MAC e NESSUN segnale di
    // presenza risponde. Segnali (basta UNO → presente):
    //   • risposta SNMP            → responded[nodeId]
    //   • MAC visto in rete        → observedMacs (FDB appreso da switch / ARP)
    //   • nodo confermato presente → presentNodeIds[nodeId] (ping ICMP, ARP, TCP,
    //                                vicino LLDP/CDP — raccolti dall'orchestratore)
    // PRECONDIZIONE — OSSERVABILITÀ: per affermare un'assenza serve aver davvero
    // osservato la rete: o un FDB popolato (fdbObserved) O una sweep di
    // raggiungibilità eseguita (reachabilityChecked). Senza nessuno dei due NON
    // si dichiara nessuno assente (evita il falso "tutti assenti" quando non si
    // osserva nulla). Backward-compat: flag assenti (undefined) ⇒ si procede.
    const present = snmp.presentNodeIds || {};
    const macAtIp = snmp.macAtIp || {};          // { macLower: ipVivo } (ARP dalla sweep)
    const haveObservability = (snmp.fdbObserved !== false) || (snmp.reachabilityChecked === true);
    // Osservabilità PER-DEVICE (fix falso "assente" cross-subnet): un device senza
    // alcun segnale è "assente" solo se avevamo davvero modo di vederlo. La sweep
    // ARP/ping è limitata ai segmenti che il server raggiunge: se l'unica
    // osservabilità è la sweep e la subnet del device NON è tra quelle osservate,
    // NON possiamo onestamente dichiararlo assente → bucket "unverified". La
    // visibilità L2 via FDB (fdbObserved) vede i MAC su tutte le VLAN → resta affidabile.
    const fdbCoversL2 = (snmp.fdbObserved === true);
    const sweepRan = (snmp.reachabilityChecked === true);
    const observedNets = (sweepRan && Array.isArray(snmp.observedSubnets)) ? new Set(snmp.observedSubnets) : null;
    const _net24 = ip => { const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\./.exec(String(ip || '')); return m ? m[1] : null; };
    function _observable(dm) {
      if (fdbCoversL2) return true;          // FDB vede i MAC su tutte le VLAN
      if (!observedNets) return true;        // niente info per-subnet → comportamento storico (back-compat)
      const net = _net24(dm.ip);
      if (!net) return true;                 // IP del device ignoto → non possiamo affermare la cecità
      return observedNets.has(net);          // la sweep ha raggiunto questa subnet?
    }
    if (haveObservability) {
      const seenMacs = new Set((snmp.observedMacs || []).map(m => String(m).toLowerCase()));
      for (const dm of (doc.macs || [])) {
        if (!dm) continue;                    // robustezza: tollera entry nulle in doc.macs
        const mac = String(dm.mac || '').toLowerCase();
        if (!mac) continue;
        // (1) MAC vivo in ARP = segnale PIÙ AUTORITATIVO (sappiamo a quale IP è):
        // presente, e se l'IP vivo ≠ documentato → CAMBIO INDIRIZZO (stesso MAC).
        // Va per primo: un device può essere "presente" e aver comunque cambiato IP.
        const liveIp = macAtIp[mac];
        if (liveIp) {
          if (dm.ip && String(liveIp) !== String(dm.ip)) {
            out.ipChanged.push({ key: `ipchg:${mac}`, mac: dm.mac, label: dm.label || '', oldIp: dm.ip, newIp: liveIp, nodeId: dm.nodeId || '', manual: !!dm.ipManual });
          }
          continue;
        }
        // (2) Altri segnali di presenza (senza IP): SNMP risposto / ping / FDB
        if (dm.nodeId && (responded[dm.nodeId] || present[dm.nodeId])) continue;
        if (seenMacs.has(mac)) continue;
        // (3) Nessun segnale di presenza. Assente solo se OSSERVABILE; se la sweep
        // era cieca sulla sua subnet (e nessun FDB a coprire il L2) → "non
        // verificabile", non assente: non mentiamo su ciò che non abbiamo visto.
        if (_observable(dm)) {
          out.macOrphan.push({ key: `mac:${mac}`, mac: dm.mac, label: dm.label || '', nodeId: dm.nodeId || '' });
        } else {
          out.unverified.push({ key: `unver:${mac}`, mac: dm.mac, label: dm.label || '', nodeId: dm.nodeId || '', ip: dm.ip || '' });
        }
      }
    }

    // 4 — device visti in rete ma non documentati (esclude noti + rejectedAutoLinks).
    // Ogni riga e' classificata cls:'infra'|'endpoint'. "endpoint" = rumore tipico
    // della rete (telefoni/BYOD su VLAN guest, dietro un uplink AP affollato, o
    // vendor consumer): la UI lo collassa, ma resta nei dati e ignorabile come prima.
    // Segnali (in OR), tutti opzionali → in assenza la riga resta 'infra':
    //   - od.vlan ∈ opts.guestVlans          (VLAN-first, segnale primario)
    //   - od.portMacCount >= soglia           (uplink affollato = AP/hub/guest)
    //   - od.consumer === true                (OUI consumer, telefono/BYOD)
    const known = new Set(doc.deviceSigs || []);
    const rejected = new Set(snmp.rejectedSigs || []);
    const guestVlans = new Set((opts.guestVlans || []).map(v => String(v)));
    const epThreshold = Number.isFinite(opts.endpointPortThreshold) ? opts.endpointPortThreshold : 5;
    const seenSig = new Set();
    for (const od of (snmp.observedDevices || [])) {
      const sig = od.sig;
      if (!sig || known.has(sig) || rejected.has(sig) || seenSig.has(sig)) continue;
      seenSig.add(sig);
      const onGuestVlan = od.vlan != null && guestVlans.has(String(od.vlan));
      const onCrowdedPort = Number.isFinite(od.portMacCount) && od.portMacCount >= epThreshold;
      const onRandomMac = od.consumer === true;
      // Trasparenza "perché è nascosto": registriamo QUALI segnali sono scattati,
      // così la UI può etichettare ogni riga (VLAN guest / porta affollata / MAC
      // randomizzato). Nessun segnale → reasons vuoto → cls 'infra' (si mostra).
      const reasons = [];
      if (onGuestVlan) reasons.push('guestVlan');
      if (onCrowdedPort) reasons.push('crowdedPort');
      if (onRandomMac) reasons.push('randomMac');
      const cls = reasons.length ? 'endpoint' : 'infra';
      out.undocumented.push({
        key: `dev:${sig}`, sig, mac: od.mac, label: od.label || '',
        cls, vlan: od.vlan != null ? od.vlan : null,
        reasons, portMacCount: Number.isFinite(od.portMacCount) ? od.portMacCount : 0,
      });
    }

    // 5 — cavi fantasma: porta down da >= N sync consecutivi
    const streak = snmp.portDownStreak || {};
    for (const c of (doc.cables || [])) {
      const s = Math.max(streak[c.src] || 0, streak[c.dst] || 0);
      if (s >= N) out.ghostCable.push({ key: `ghost:${c.id}`, id: c.id, label: c.label || c.id, downStreak: s });
    }

    // filtro ignore (la categoria "consistent" non e' ignorabile)
    for (const cat of ['stateDrift', 'macOrphan', 'undocumented', 'ghostCable', 'ipChanged', 'unverified']) {
      out[cat] = out[cat].filter(r => !ign.has(r.key));
    }

    out.counts = {
      consistent: out.consistent.length,
      stateDrift: out.stateDrift.length,
      macOrphan: out.macOrphan.length,
      // "undocumented" = solo i candidati infrastruttura (azionabili); il rumore
      // endpoint/guest e' contato a parte e mostrato collassato dalla UI.
      undocumented: out.undocumented.filter(r => r.cls !== 'endpoint').length,
      undocumentedEndpoint: out.undocumented.filter(r => r.cls === 'endpoint').length,
      ghostCable: out.ghostCable.length,
      ipChanged: out.ipChanged.length,
      unverified: out.unverified.length,
    };
    return out;
  }

  return { buildDriftReport };
});
