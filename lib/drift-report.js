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
//   trustAbsentNodeIds: { [nodeId]: true }           // ASSENZA AFFIDABILE (un vivo non può sopprimerla): ARP-miss on-segment (Fase 1b, dal server). UNICO segnale-input che autorizza il "rosso"; l'engine vi AGGIUNGE la porta di accesso down da >=N sync (Fase 3, da portDownStreak+cables). Vuoto nel Sync → mai rosso.
//   macAtIp:         { [macLower]: ipVivo }           // MAC visto VIVO a un IP (ARP della sweep) → presenza per-MAC + cambio-IP (legacy: primo IP)
//   macAtIps:        { [macLower]: [ipVivi] }         // TUTTI gli IP vivi del MAC (alias/multihoming): cambio-IP solo se il doc-IP non è in nessuno
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

    // 3 — Documentati ASSENTI IN RETE (presenza "onesta", multi-segnale)
    // Un device documentato con MAC ha 3 esiti:
    //   🟢 presente   — QUALSIASI segnale positivo (un "sì" non si inventa): risposta
    //                  SNMP (responded) · MAC visto in rete (observedMacs: FDB switch /
    //                  ARP) · nodo confermato (presentNodeIds: ping/ARP/TCP/LLDP) · MAC
    //                  vivo a un IP (macAtIp/macAtIps → anche cambio-IP);
    //   🔴 assente    — SOLO con una PROVA AFFIDABILE che un host vivo NON può
    //                  sopprimere: trustAbsentNodeIds (ARP-miss sul segmento locale /
    //                  porta di accesso down / lease DHCP scaduto). "Non risponde" ≠
    //                  "è morto": un silenzio (SNMP muto, FDB invecchiata ~300s, ICMP
    //                  filtrato da Windows, IP remoto dietro un router) NON è una prova;
    //   ⚪ non-verif. — tutto il resto: nessun segnale positivo E nessuna prova di
    //                  assenza affidabile. È il caso più comune ed è onesto.
    // PRECONDIZIONE — OSSERVABILITÀ: se non si è osservato NULLA (né FDB popolato né
    // sweep eseguita) non si valuta nessuno (evita il falso "tutti assenti" a Sync
    // fallito). Backward-compat: flag assenti (undefined) ⇒ si procede.
    // Regola cardine Sync vs Verifica: nel Sync non c'è sweep → trustAbsentNodeIds è
    // vuoto → MAI rosso; ciò che non è positivamente visto resta grigio.
    const present = snmp.presentNodeIds || {};
    // Assenza AFFIDABILE per-nodeId — UNICO segnale che autorizza il rosso. Due fonti,
    // entrambe NON falsificabili da un host vivo:
    //  • Fase 1b: ARP-miss sul segmento LOCALE dopo il ping (snmp.trustAbsentNodeIds,
    //    calcolato dal server: solo on-segment, dove l'assenza di ARP È una prova);
    //  • Fase 3: porta di accesso switch DOWN da >= N sync (sotto). Lo switch è
    //    autorevole sul link della PROPRIA porta: un host vivo non può tenerla giù.
    //    Riusa portDownStreak (stessa soglia N del "cavo fantasma") → anti-flap incluso.
    const trustAbsent = Object.assign({}, snmp.trustAbsentNodeIds || {});
    {
      const _streak = snmp.portDownStreak || {};
      for (const c of (doc.cables || [])) {
        if (!c) continue;
        // Lo streak accerta solo porte SNMP di switch che RISPONDONO → la porta down è
        // sullo switch; il device ASSENTE è quello all'ALTRO capo del cavo. Positive-first
        // (più sotto) salva chi è comunque visto vivo (es. multihomed/LAG con un membro su).
        if ((_streak[c.src] || 0) >= N && c.dst) trustAbsent[_nodeOf(c.dst)] = true;
        if ((_streak[c.dst] || 0) >= N && c.src) trustAbsent[_nodeOf(c.src)] = true;
      }
    }
    const macAtIp = snmp.macAtIp || {};          // { macLower: ipVivo } (ARP dalla sweep, legacy: primo IP)
    const macAtIps = snmp.macAtIps || null;      // { macLower: [ipVivi] } — multihoming; fallback legacy se assente
    const haveObservability = (snmp.fdbObserved !== false) || (snmp.reachabilityChecked === true);
    const sweepRan = (snmp.reachabilityChecked === true);   // esposto in output per "Reti del progetto"
    if (haveObservability) {
      const seenMacs = new Set((snmp.observedMacs || []).map(m => String(m).toLowerCase()));
      for (const dm of (doc.macs || [])) {
        if (!dm) continue;                    // robustezza: tollera entry nulle in doc.macs
        const mac = String(dm.mac || '').toLowerCase();
        if (!mac) continue;
        // (1) MAC vivo in ARP = segnale PIÙ AUTORITATIVO (sappiamo a quale IP è):
        // presente, e se l'IP vivo ≠ documentato → CAMBIO INDIRIZZO (stesso MAC).
        // Va per primo: un device può essere "presente" e aver comunque cambiato IP.
        const liveIps = macAtIps ? (macAtIps[mac] || []) : (macAtIp[mac] ? [macAtIp[mac]] : []);
        if (liveIps.length) {
          // Stesso MAC vivo su 2+ IP = alias/multihoming legittimo, NON conflitto:
          // "cambio IP" solo se il documentato non è NESSUNO degli IP vivi.
          const docIpLive = dm.ip && liveIps.some(ip => String(ip) === String(dm.ip));
          if (dm.ip && !docIpLive) {
            out.ipChanged.push({ key: `ipchg:${mac}`, mac: dm.mac, label: dm.label || '', oldIp: dm.ip, newIp: liveIps[0], nodeId: dm.nodeId || '', manual: !!dm.ipManual });
          }
          continue;
        }
        // (2) Altri segnali di presenza (senza IP): SNMP risposto / ping / FDB
        if (dm.nodeId && (responded[dm.nodeId] || present[dm.nodeId])) continue;
        if (seenMacs.has(mac)) continue;
        // (3) Nessun segnale positivo. Rosso ("assente") SOLO con prova affidabile
        // (trustAbsent); altrimenti grigio ("non-verificabile"): non dichiariamo
        // morto ciò che tace ma potrebbe essere solo filtrato o uscito dall'FDB.
        if (dm.nodeId && trustAbsent[dm.nodeId]) {
          out.macOrphan.push({ key: `mac:${mac}`, mac: dm.mac, label: dm.label || '', nodeId: dm.nodeId || '' });
        } else {
          out.unverified.push({ key: `unver:${mac}`, mac: dm.mac, label: dm.label || '', nodeId: dm.nodeId || '', ip: dm.ip || '' });
        }
      }
      // (bis) Documentati CON IP ma SENZA MAC (infra/endpoint mai sincronizzati):
      // l'audit per-MAC sopra non li vede → presenza per-nodeId.
      //   • segnale di presenza (responded/present) → presente (salta);
      //   • prova di assenza affidabile (trustAbsent) → assente (rosso);
      //   • altrimenti → non-verificabile (grigio): SNMP muto o mai sondato non è
      //     una morte (no-invenzioni).
      for (const dn of (doc.ipOnly || [])) {
        if (!dn || !dn.nodeId) continue;
        if (responded[dn.nodeId] || present[dn.nodeId]) continue;
        if (trustAbsent[dn.nodeId]) {
          out.macOrphan.push({ key: `mac:node:${dn.nodeId}`, mac: '', label: dn.label || '', nodeId: dn.nodeId });
        } else {
          out.unverified.push({ key: `unver:node:${dn.nodeId}`, mac: '', label: dn.label || '', nodeId: dn.nodeId, ip: dn.ip || '' });
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
    // VLAN di management: l'OPPOSTO della guest. Un non-documentato lì è infra (o
    // un intruso), MAI rumore BYOD → si forza 'infra', si azzerano i segnali
    // endpoint e si marca onMgmt (segnale di sicurezza per la UI).
    const mgmtVlans = new Set((opts.mgmtVlans || []).map(v => String(v)));
    const epThreshold = Number.isFinite(opts.endpointPortThreshold) ? opts.endpointPortThreshold : 5;
    const seenSig = new Set();
    for (const od of (snmp.observedDevices || [])) {
      const sig = od.sig;
      if (!sig || known.has(sig) || rejected.has(sig) || seenSig.has(sig)) continue;
      seenSig.add(sig);
      const onMgmtVlan = od.vlan != null && mgmtVlans.has(String(od.vlan));
      const onGuestVlan = od.vlan != null && guestVlans.has(String(od.vlan));
      const onCrowdedPort = Number.isFinite(od.portMacCount) && od.portMacCount >= epThreshold;
      const onRandomMac = od.consumer === true;
      // Trasparenza "perché è nascosto": registriamo QUALI segnali sono scattati,
      // così la UI può etichettare ogni riga (VLAN guest / porta affollata / MAC
      // randomizzato). Nessun segnale → reasons vuoto → cls 'infra' (si mostra).
      // Sulla VLAN di management i segnali BYOD non si applicano: il device resta
      // SEMPRE 'infra' e va mostrato (onMgmt lo evidenzia come possibile intruso).
      const reasons = [];
      if (!onMgmtVlan) {
        if (onGuestVlan) reasons.push('guestVlan');
        if (onCrowdedPort) reasons.push('crowdedPort');
        if (onRandomMac) reasons.push('randomMac');
      }
      const cls = reasons.length ? 'endpoint' : 'infra';
      out.undocumented.push({
        key: `dev:${sig}`, sig, mac: od.mac, label: od.label || '',
        cls, vlan: od.vlan != null ? od.vlan : null,
        reasons, portMacCount: Number.isFinite(od.portMacCount) ? od.portMacCount : 0,
        onMgmt: onMgmtVlan,
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
    // Esposti per il layer di report ("Reti del progetto"): annotare ogni /24 con
    // l'esito presenza (la sweep ha osservato quella subnet?) e annidare i device
    // "non verificabili" sotto la loro rete invece di una sezione separata.
    out.sweepRan = sweepRan;
    out.observedSubnets = Array.isArray(snmp.observedSubnets) ? snmp.observedSubnets.slice() : [];
    return out;
  }

  // ── Tipo di esito per il BANNER della Verifica (separato dal conteggio righe).
  // 'discrepancies' = ci sono anomalie azionabili (drift/assenti/non-doc/ghost/IP).
  // 'blind'         = ZERO anomalie MA non si è verificato nulla (niente di
  //                   confermato presente e tutto "non verificabile": la sweep era
  //                   cieca su quelle reti). NON dichiarare "allineata" in questo
  //                   caso: sarebbe un falso "tutto a posto".
  // 'aligned'       = nessuna anomalia e c'è stata copertura reale (qualcosa è
  //                   stato davvero confrontato con la realtà).
  function driftBannerKind(counts) {
    const c = counts || {};
    const actionable = (c.stateDrift || 0) + (c.macOrphan || 0) + (c.undocumented || 0) + (c.ghostCable || 0) + (c.ipChanged || 0);
    if (actionable > 0) return 'discrepancies';
    if ((c.consistent || 0) === 0 && (c.unverified || 0) > 0) return 'blind';
    return 'aligned';
  }

  return { buildDriftReport, driftBannerKind };
});
