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
//   cables: [ { id, label, src, dst, autoLinked } ]             // cavi documentati (pid estremi); autoLinked=dedotto
// }
// snmp = {
//   responded:       { [nodeId]: true }            // device che ha risposto a QUESTO sync
//   ports:           { [pid]: { status, speed, duplex, vlan } }  // realta' rilevata
//   observedMacs:    [ mac ]                        // MAC visti in rete (FDB / ifPhysAddress / ARP)
//   fdbObserved:     bool?                           // c'è almeno un FDB popolato?
//   presentNodeIds:  { [nodeId]: true }              // nodi confermati presenti (ping/ARP/TCP/LLDP)
//   trustAbsentNodeIds: { [nodeId]: true }           // ASSENZA AFFIDABILE (un vivo non può sopprimerla): ARP-miss on-segment (Fase 1b, dal server). UNICO segnale-input che autorizza il "rosso"; l'engine vi AGGIUNGE la porta di accesso down da >=N sync (Fase 3, da portDownStreak+cables). Questo CAMPO è vuoto nel Sync (la via ARP-miss richiede lo sweep); ma la Fase 3 NON usa sweep → un Sync PUÒ produrre rosso via porta-down.
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
// { counts:{consistent,stateDrift,macOrphan,undocumented,ghostCable,ipChanged,unverified,identityDrift,identityFirmware},
//   consistent[], stateDrift[], macOrphan[], undocumented[], ghostCable[],
//   ipChanged[] ({mac,label,oldIp,newIp,nodeId,manual} — MAC documentato vivo a IP diverso; manual=IP fissato a mano),
//   unverified[] ({mac,label,nodeId,ip} — subnet fuori dalla portata della sweep: presenza NON confermata),
//   identityDrift[] ({nodeId,label,diffs:[{field,kind,doc,real}],identity,patch} — serial/model/firmware
//     dichiarati ≠ misurati ENTITY-MIB. kind 'identity' (serial/model = apparato sostituito, azionabile)
//     vs 'firmware' (versione cambiata, informativo). identity=true se almeno un diff 'identity') }
// Ogni riga ha `key` STABILE con fingerprint della condizione: se la realta'
// cambia, la chiave cambia → una riga "ignorata" riappare (semantica
// "ignora finche' la condizione non cambia").
(function (root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./port-id.js') : root,
    typeof module !== 'undefined' && module.exports ? require('./mac-class.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (pidApi, mc) {
  'use strict';

  // null/undefined/'' → null (campo "non documentato/non rilevato")
  function _v(x) { return (x === undefined || x === null || x === '') ? null : x; }
  // Elenco di VLAN → stringa canonica per il confronto e per la resa («10,20,99»).
  // Ordinata e deduplicata a monte (lib/vlan-trunk.js): qui basta unirla. null se
  // l'elenco non c'è — «non dichiarato» non è «elenco vuoto», e un lato assente
  // non produce mai una discrepanza (stessa regola di speed/duplex/vlan).
  function _vlanSet(a) { return (Array.isArray(a) && a.length) ? a.join(',') : null; }
  function _nodeOf(pid, knownNodeIds) {
    return pidApi && typeof pidApi.nodeIdOfPort === 'function'
      ? pidApi.nodeIdOfPort(pid, knownNodeIds)
      : String(pid);
  }

  function buildDriftReport(snmp, doc, ignores, opts) {
    snmp = snmp || {}; doc = doc || {}; opts = opts || {};
    // Soglia streak porta-down / cavo-fantasma: min 1 (con N=0 ogni streak 0>=0 farebbe
    // "maturare" TUTTI i cavi a fantasma — foot-gun da input degenere).
    const N = Math.max(1, Number.isFinite(opts.downStreakN) ? opts.downStreakN : 3);
    const ign = new Set(ignores || []);
    const responded = snmp.responded || {};
    const knownNodeIds = Object.keys(responded);
    const realPorts = snmp.ports || {};
    const docPorts = doc.ports || {};
    const out = { consistent: [], stateDrift: [], macOrphan: [], undocumented: [], ghostCable: [], shutCable: [], ipChanged: [], unverified: [], identityDrift: [] };

    // 1 & 2 — porte coerenti / discrepanze di stato
    for (const pid of Object.keys(docPorts)) {
      const dp = docPorts[pid] || {};
      if (!responded[_nodeOf(pid, knownNodeIds)]) continue;        // device muto → non valutabile, salta
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
      // VLAN TRASPORTATE di un trunk: dichiarate sul cavo, misurate sulla porta.
      // Il dichiarato continua a vincere ovunque (manual-first) — ma se la realtà
      // lo contraddice va DETTO, o il documento resta indietro in silenzio e la
      // fotografia continua a mostrare l'elenco di ieri come se fosse di oggi.
      // Confronto per INSIEME: l'ordine e la forma di scrittura non sono differenze.
      const dTrunk = _vlanSet(dp.trunkVlans), rTrunk = _vlanSet(rp.trunkVlans);
      if (dTrunk && rTrunk && dTrunk !== rTrunk) diffs.push({ field: 'trunkVlans', doc: dTrunk, real: rTrunk });

      if (diffs.length === 0) {
        out.consistent.push({ key: `ok:${pid}`, pid, label: dp.label || pid });
      } else {
        // fingerprint = valori REALI dei campi divergenti → ignore segue la condizione
        const fp = diffs.map(d => `${d.field}=${d.real}`).sort().join(';');
        out.stateDrift.push({
          key: `drift:${pid}:${fp}`, pid, label: dp.label || pid, diffs,
          // `linkId` viaggia col patch perché le VLAN trasportate si adottano sul
          // CAVO (è lì che vive la dichiarazione): scriverle sulla porta sarebbe
          // scrivere una misura, e il poll successivo la riscriverebbe comunque.
          patch: { pid, status: rStatus, speed: rSpeed, duplex: rDup, vlan: rVlan,
                   trunkVlans: rTrunk || null, linkId: dp.linkId || null },
        });
      }
    }

    // 2b — IDENTITÀ HARDWARE: serial/model/firmware dichiarati vs misurati (ENTITY-MIB).
    // Serial/model diverso = APPARATO SOSTITUITO (azionabile: RMA, furto, cavo sullo
    // switch sbagliato, errore di doc). Firmware diverso = solo VERSIONE cambiata
    // (informativo: si aggiorna a ogni patch, NON è un cambio d'identità → non allarma).
    // Confronto un campo SOLO se entrambi i lati sono non-vuoti (come speed/vlan sopra);
    // gate su responded (come le porte, riga sopra): un device muto ha inventory stantìa.
    const measuredIds = snmp.measuredIds || {};
    for (const di of (doc.identities || [])) {
      if (!di || !di.nodeId) continue;
      if (!responded[di.nodeId]) continue;
      const mi = measuredIds[di.nodeId];
      if (!mi) continue;
      const diffs = [];
      const _cmpId = (field, kind) => {
        const d = _v(di[field]), r = _v(mi[field]);
        // trim+case-insensitive: evita rumore di padding/maiuscole dell'ENTITY-MIB.
        if (d != null && r != null && String(d).trim().toLowerCase() !== String(r).trim().toLowerCase()) {
          diffs.push({ field, kind, doc: d, real: r });
        }
      };
      _cmpId('serialNumber', 'identity');
      _cmpId('model', 'identity');
      _cmpId('firmwareVer', 'firmware');
      if (diffs.length) {
        const identity = diffs.some(x => x.kind === 'identity');   // serial/model → azionabile
        // fingerprint sui valori REALI → una riga ignorata riappare se la realtà cambia
        const fp = diffs.map(x => `${x.field}=${x.real}`).sort().join(';');
        out.identityDrift.push({
          key: `iddrift:${di.nodeId}:${fp}`, nodeId: di.nodeId, label: di.label || di.nodeId,
          diffs, identity,
          patch: { nodeId: di.nodeId, serialNumber: _v(mi.serialNumber), model: _v(mi.model), firmwareVer: _v(mi.firmwareVer) },
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
    // Regola cardine Sync vs Verifica: nel Sync non c'è sweep → la via ARP-miss
    // (snmp.trustAbsentNodeIds) è disattiva; MA la Fase 3 porta-down (sotto) NON usa
    // lo sweep, quindi un Sync PUÒ produrre rosso via porta-down (portDownStreak matura
    // sync-dopo-sync). Ciò che è solo SILENZIOSO (né visto né porta-down) resta grigio.
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
    const aliveIps = new Set((snmp.aliveIps || []).map(String));  // IP direttamente vivi dalla sweep (DRIFT-M6)
    const releasedMacs = snmp.releasedMacs || {}; // { macLower: {ip,hostname} } — opt-in: lease RILASCIATO → sfumatura "probabilmente scollegato" sulla voce unverified (mai rosso)
    const haveObservability = (snmp.fdbObserved !== false) || (snmp.reachabilityChecked === true);
    const sweepRan = (snmp.reachabilityChecked === true);   // esposto in output per "Reti del progetto"
    if (haveObservability) {
      // F7: entrambi i lati del confronto usano LA chiave MAC (lib/mac-class), non
      // un lowercase nudo — che regge solo finché ogni produttore emette la forma
      // con i due punti. Con 'AA-BB-CC-…' (incolla ARP di Windows) o la forma
      // Cisco, il documentato non incontrava più il misurato: presenza e cambio-IP
      // fallivano in silenzio, e il device restava grigio per sempre.
      const seenMacs = new Set((snmp.observedMacs || []).map(m => mc.macKey(m)).filter(Boolean));
      for (const dm of (doc.macs || [])) {
        if (!dm) continue;                    // robustezza: tollera entry nulle in doc.macs
        const mac = mc.macKey(dm.mac || '');
        if (!mac) continue;
        // (1) MAC vivo in ARP = segnale PIÙ AUTORITATIVO (sappiamo a quale IP è):
        // presente, e se l'IP vivo ≠ documentato → CAMBIO INDIRIZZO (stesso MAC).
        // Va per primo: un device può essere "presente" e aver comunque cambiato IP.
        const liveIps = macAtIps ? (macAtIps[mac] || []) : (macAtIp[mac] ? [macAtIp[mac]] : []);
        if (liveIps.length) {
          // Stesso MAC vivo su 2+ IP = alias/multihoming legittimo, NON conflitto:
          // "cambio IP" solo se il documentato non è NESSUNO degli IP vivi.
          // DRIFT-M6: conta come "ancora vivo al doc-IP" anche il ping-positivo diretto
          // dalla sweep (aliveIps), non solo l'IP risolto via ARP (macAtIps): un device
          // dual-homed che risponde al suo doc-IP non ha "cambiato IP".
          const docIpLive = dm.ip && (liveIps.some(ip => String(ip) === String(dm.ip)) || aliveIps.has(String(dm.ip)));
          if (dm.ip && !docIpLive) {
            // Chiave con nodeId E nuovo-IP (fingerprint della condizione): senza nodeId
            // due nodi con lo STESSO MAC (VRRP/HSRP) avrebbero chiave identica e «applica»
            // agirebbe sempre sul primo; senza il nuovo-IP un «ignora» sopprimeva per
            // sempre anche il CAMBIO SUCCESSIVO verso un IP diverso (semantica: ignora
            // finché la condizione non cambia). Stessa regola delle altre categorie.
            out.ipChanged.push({ key: `ipchg:${dm.nodeId || mac}:${liveIps[0]}`, mac: dm.mac, label: dm.label || '', oldIp: dm.ip, newIp: liveIps[0], nodeId: dm.nodeId || '', manual: !!dm.ipManual });
          }
          continue;
        }
        // (2) Altri segnali di presenza (senza IP): SNMP risposto / ping / FDB
        if (dm.nodeId && (responded[dm.nodeId] || present[dm.nodeId])) continue;
        if (seenMacs.has(mac)) continue;
        // (2b) DRIFT-M6 simmetrico: il doc-IP risponde DIRETTAMENTE alla sweep (aliveIps)
        // pur senza MAC risolto in ARP → il device è PRESENTE. Senza questo, un host che
        // pinga ma il cui MAC non è nell'ARP poteva finire "assente" via porta-down.
        if (dm.ip && aliveIps.has(String(dm.ip))) continue;
        // (3) Nessun segnale positivo. Rosso ("assente") SOLO con prova affidabile
        // (trustAbsent); altrimenti grigio ("non-verificabile"): non dichiariamo
        // morto ciò che tace ma potrebbe essere solo filtrato o uscito dall'FDB.
        // Chiave con nodeId (come il ramo ipOnly): due nodi documentati che condividono
        // lo STESSO MAC (VRRP/HSRP, errore di doc) avrebbero altrimenti chiave identica
        // `mac:<mac>` → ignorarne uno ne nasconderebbe entrambi.
        if (dm.nodeId && trustAbsent[dm.nodeId]) {
          out.macOrphan.push({ key: `mac:${dm.nodeId}:${mac}`, mac: dm.mac, label: dm.label || '', nodeId: dm.nodeId || '' });
        } else {
          // Sfumatura DEBOLE (opt-in): se questo grigio ha un lease RILASCIATO, lo annoto
          // "probabilmente scollegato" — resta grigio (nessun promozione a rosso). releasedMacs
          // è vuoto se l'opt-in è OFF (gate nel snapshot), quindi qui è sempre sicuro.
          const rel = releasedMacs[mac];
          out.unverified.push({ key: `unver:${dm.nodeId}:${mac}`, mac: dm.mac, label: dm.label || '', nodeId: dm.nodeId || '', ip: dm.ip || (rel && rel.ip) || '', reason: rel ? 'leaseReleased' : undefined, hostname: rel ? rel.hostname : '' });
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
    // ⭐ Un MAC che l'ARP colloca all'INDIRIZZO di un apparato documentato non è un
    // device sconosciuto: è il MAC di quell'apparato, che il documento non ha mai
    // scritto. Non è un caso raro, è la REGOLA per l'infrastruttura: uno switch o un
    // router non espone un «MAC di device» da leggere via SNMP, quindi il nodo finisce
    // in `ipOnly` e la sua firma non può incontrare nessuna riga della FDB. Misurato al
    // banco: la SVI di SW-CORE (`10.10.99.1`, che è l'host documentato del nodo) veniva
    // accusata di non essere documentata a ogni Verifica. Un'accusa vera-ma-impossibile
    // da chiudere insegna a saltarle tutte: si riconcilia sull'identificatore che il
    // documento HA — l'indirizzo — invece che su quello che non ha.
    // `knownIps` li raccoglie tutti in un posto solo (lib/drift-snapshot): l'indirizzo
    // di gestione degli apparati senza MAC E i gateway dichiarati nel piano, che sono
    // le ALTRE interfacce degli stessi apparati.
    const docIpsNoMac = new Set();
    for (const ip of (doc.knownIps || [])) {
      const s = String(ip || '').trim();
      if (s) docIpsNoMac.add(s);
    }
    const seenSig = new Set();
    for (const od of (snmp.observedDevices || [])) {
      const sig = od.sig;
      if (!sig || known.has(sig) || rejected.has(sig) || seenSig.has(sig)) continue;
      // Gli IP vivi di questo MAC (tutti, non solo il primo: un apparato multihomed
      // risponde a piu' indirizzi e basta che UNO sia quello documentato).
      const odIps = macAtIps ? (macAtIps[sig] || []) : (macAtIp[sig] ? [macAtIp[sig]] : []);
      if (odIps.some(ip => docIpsNoMac.has(String(ip).trim()))) continue;
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

    // 5 — cavi fantasma: cavo DEDOTTO con porta down da >= N sync consecutivi.
    // SOLO i dedotti (autoLinked): un cavo MANUALE su una porta down non è un
    // «cavo fantasma» — è il NODO all'altro capo che è down (cablaggio != liveness).
    // Il rosso su quel device arriva già dal ramo presenza (macOrphan/trustAbsent);
    // il cavo dichiarato resta legge (allineato al Proof-State: `l.miscabled` a parte,
    // solo una contraddizione MISURATA lo tocca). Questo bucket alimenta anche
    // `l.portDown` del Proof-State: UNA fonte sola per «cavo dedotto senza evidenza».
    const streak = snmp.portDownStreak || {};
    const shutPorts = snmp.portAdminDown || {};
    for (const c of (doc.cables || [])) {
      if (!c.autoLinked) continue;
      // Porta SPENTA A MANO sotto un capo → mai «fantasma». Il fantasma dice
      // «l'evidenza che reggeva questa deduzione è evaporata»; qui non è evaporata,
      // è stata spenta — e un cavo non diventa immaginario perché qualcuno ha chiuso
      // la porta. Lo streak non avanza più su una porta chiusa (lib/port-state.js),
      // ma un progetto salvato PRIMA di quella regola porta ancora un valore alto:
      // questo cancello lo rende innocuo senza aspettare N verifiche nuove.
      if (shutPorts[c.src] || shutPorts[c.dst]) continue;
      const s = Math.max(streak[c.src] || 0, streak[c.dst] || 0);
      if (s >= N) out.ghostCable.push({ key: `ghost:${c.id}`, id: c.id, label: c.label || c.id, downStreak: s });
    }

    // 5-bis — cavi su porta SPENTA A MANO: cavo DICHIARATO con un estremo in
    // `shutdown` (ifAdminStatus=down). SOLO i dichiarati, ed e' il verso opposto del
    // bucket qui sopra: li' il cavo dedotto perde l'evidenza che lo reggeva, qui il
    // cavo c'e' (l'hai visto tu) ma qualcuno ha chiuso la porta — cioe' due
    // DICHIARAZIONI che si contraddicono, la tua e quella scritta sull'apparato.
    // Di solito vuol dire che quell'apparato e' stato dismesso e il documento non lo
    // sa ancora. Il DEDOTTO non entra qui e non entra nemmeno fra i fantasmi (vedi
    // sopra): non ha una dichiarazione tua da contraddire, e la porta chiusa non e'
    // la prova che il cavo non c'e' — e' la prova che nessuno sta guardando.
    const adminDown = snmp.portAdminDown || {};
    for (const c of (doc.cables || [])) {
      if (c.autoLinked) continue;
      const ends = [c.src, c.dst].filter(p => adminDown[p]);
      if (ends.length) out.shutCable.push({ key: `shut:${c.id}`, id: c.id, label: c.label || c.id, ports: ends });
    }

    // filtro ignore (la categoria "consistent" non e' ignorabile)
    for (const cat of ['stateDrift', 'macOrphan', 'undocumented', 'ghostCable', 'shutCable', 'ipChanged', 'unverified', 'identityDrift']) {
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
      shutCable: out.shutCable.length,
      ipChanged: out.ipChanged.length,
      unverified: out.unverified.length,
      // identità: serial/model (azionabile "apparato sostituito") contati a parte
      // dal solo-firmware (informativo, non entra nel banner delle anomalie).
      identityDrift: out.identityDrift.filter(r => r.identity).length,
      identityFirmware: out.identityDrift.filter(r => !r.identity).length,
    };
    // Esposti per il layer di report ("Reti del progetto"): annotare ogni /24 con
    // l'esito presenza (la sweep ha osservato quella subnet?) e annidare i device
    // "non verificabili" sotto la loro rete invece di una sezione separata.
    out.sweepRan = sweepRan;
    out.observedSubnets = Array.isArray(snmp.observedSubnets) ? snmp.observedSubnets.slice() : [];
    // Per il BANNER: distinguere "progetto vuoto" da "audit cieco". Nel caso cieco
    // (nessuna osservabilita': FDB non popolato E sweep non eseguita) il blocco 3 e'
    // saltato in blocco → i device documentati non finiscono NE' in unverified NE'
    // altrove: il conteggio non li vede, e senza questi due segnali il banner
    // dichiarava "allineata" su 487 device mai valutati (audit 2026-07-23).
    //   evaluated = c'e' stata osservabilita' per valutare la presenza;
    //   docCount  = quanti device documentati AVREBBERO dovuto essere valutati.
    out.evaluated = haveObservability;
    let docCount = 0;
    for (const dm of (doc.macs || [])) if (dm && String(dm.mac || '')) docCount++;
    for (const dn of (doc.ipOnly || [])) if (dn && dn.nodeId) docCount++;
    out.docCount = docCount;
    return out;
  }

  // ── Tipo di esito per il BANNER della Verifica (separato dal conteggio righe).
  // 'discrepancies' = ci sono anomalie azionabili (drift/assenti/non-doc/ghost/IP).
  // 'blind'         = ZERO anomalie MA non si è verificato nulla di reale. Due vie:
  //                   (a) la sweep ha girato ma era cieca su quelle reti → tutto
  //                       "non verificabile" (consistent 0, unverified > 0);
  //                   (b) l'audit NON ha osservato nulla (FDB vuoto E niente sweep):
  //                       i device documentati non finiscono nemmeno in unverified,
  //                       quindi i soli counts non bastano — serve il report, che
  //                       porta `evaluated:false` e `docCount>0`.
  //                   NON dichiarare "allineata" in nessuna delle due: sarebbe un
  //                   falso "tutto a posto" (487 device mai valutati → verde, prima).
  // 'aligned'       = nessuna anomalia e c'è stata copertura reale (qualcosa è
  //                   stato davvero confrontato con la realtà), oppure il progetto
  //                   e' GENUINAMENTE vuoto (docCount 0: niente da allarmare).
  // `report` (opzionale) = l'output di buildDriftReport; senza, ci si basa sui soli
  // counts (retro-compatibile: la via (b) resta silente, com'era prima del fix).
  function driftBannerKind(counts, report) {
    const c = counts || {};
    const r = report || {};
    const actionable = (c.stateDrift || 0) + (c.macOrphan || 0) + (c.undocumented || 0) + (c.ghostCable || 0) + (c.ipChanged || 0) + (c.identityDrift || 0);
    if (actionable > 0) return 'discrepancies';
    if ((c.consistent || 0) === 0 && (c.unverified || 0) > 0) return 'blind';                 // (a)
    if ((c.consistent || 0) === 0 && r.evaluated === false && (r.docCount || 0) > 0) return 'blind'; // (b)
    return 'aligned';
  }

  return { buildDriftReport, driftBannerKind };
});
