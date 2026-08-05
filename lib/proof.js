// ============================================================
// PROOF-STATE — stato di prova unificato (nodo → cavo → Truth Score)
// (UMD-lite, browser + Node · zero-dip · lingua-indipendente · puro)
// ============================================================
// Un unico "stato di prova" coerente per nodi e cavi, con un principio d'identita':
//
//   NON diciamo mai piu' di quello che sappiamo.
//   Un dichiarato non e' provato; una prova invecchia; un cavo DEDOTTO verso un
//   estremo che non risponde piu' e' un "fantasma" e va mostrato come tale — mai
//   nascosto, mai cancellato in silenzio. Ma il DICHIARATO e' legge: un cavo
//   confermato a mano NON diventa fantasma perche' il device tace (cablaggio
//   fisico != liveness); solo una CONTRADDIZIONE misurata (diverged) lo segnala.
//
// Puro e deterministico: il chiamante passa i record (link, proof degli estremi,
// segnali di realta'), la funzione non tocca stato, DOM ne' l'orologio (`now`
// iniettabile per i test). Nessuna stringa di UI qui: la lib CALCOLA, la glue
// RACCONTA. Vendor-neutral: il tier del cavo dipende dal protocollo di adiacenza,
// mai dal vendor.
//
// Spec: _local/notes/InfraNetPro_Spec_ProofStateUnificato_20260804.md
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOUR = 3600e3;
  const DAY = 864e5;

  // Soglie ritoccabili da qui (esportate per i test / la doc).
  const FRESH_H = 6;        // <=6h  -> lettura fresca (soglia unica con la Health lens, 2.3.0)
  const STALE_D = 7;        // 6h..7g -> in invecchiamento (freschezza 1.0 -> 0.6)
  const EXPIRE_D = 30;      // 7g..30g -> prova che scade (0.6 -> 0.0); oltre = scaduta
  const GHOST_CONF = 0.50;  // confidence efficace sotto la quale un DEDOTTO diventa fantasma

  const FRESH_MS = FRESH_H * HOUR;
  const STALE_MS = STALE_D * DAY;
  const EXPIRE_MS = EXPIRE_D * DAY;

  const DEFAULT_DERIVED_CONF = 0.80;  // confidence di ripiego per un dedotto senza valore

  // Gravita' crescente degli stati di prova di un NODO. Serve solo a scegliere il
  // "peggiore" fra i due estremi di un cavo (proven=migliore, diverged=peggiore).
  const _RANK = {
    proven: 0, declared: 1, derived: 1, stale: 2, unverified: 3, absent: 4, diverged: 5,
  };

  // --- Freschezza -----------------------------------------------------------
  // freshness(ageMs) -> [0,1]. Rampa a tratti (spec §4.1):
  //   <=6h -> 1.0 · 6h..7g -> lerp 1.0->0.6 · 7g..30g -> lerp 0.6->0.0 · oltre -> 0.
  // Eta' ignota (null/NaN) = NESSUNA prova fresca -> 0 (non inventiamo evidenza).
  // Eta' negativa (lastProvenAt nel futuro, clock skew) trattata come "adesso" = 1.0.
  function freshness(ageMs) {
    if (ageMs == null || !Number.isFinite(+ageMs)) return 0;
    const age = Math.max(0, +ageMs);
    if (age <= FRESH_MS) return 1.0;
    if (age <= STALE_MS) return 1.0 - 0.4 * (age - FRESH_MS) / (STALE_MS - FRESH_MS);
    if (age <= EXPIRE_MS) return 0.6 - 0.6 * (age - STALE_MS) / (EXPIRE_MS - STALE_MS);
    return 0.0;
  }

  function _now(now) { return (now != null) ? +now : Date.now(); }

  // Eta' in ms di un ISO rispetto a `now` (null se non parsabile).
  function _ageMs(iso, now) {
    const t = Date.parse(String(iso || ''));
    return Number.isFinite(t) ? (_now(now) - t) : null;
  }

  // Freschezza dell'ultima PROVA di un nodo (da proof.lastProvenAt).
  function nodeFreshness(proof, now) {
    return freshness(_ageMs(proof && proof.lastProvenAt, now));
  }

  // --- Confidence efficace del cavo dedotto (decadimento) -------------------
  // baseConf: un cavo MANUALE (!autoLinked) e' dichiarato -> 1.0; un dedotto vale
  // la sua confidence di scoperta (0.80..0.97).
  function baseConf(l) {
    if (!l) return 0;
    if (!l.autoLinked) return 1.0;
    const c = Number(l.confidence);
    return Number.isFinite(c) ? c : DEFAULT_DERIVED_CONF;
  }

  // La freschezza di un cavo e' quella del suo estremo PEGGIORE: un solo capo muto
  // basta a invecchiare l'inferenza.
  function endpointFreshness(srcProof, dstProof, now) {
    return Math.min(nodeFreshness(srcProof, now), nodeFreshness(dstProof, now));
  }

  // effConf = confidence di scoperta x freschezza dell'estremo peggiore.
  // Un LLDP 0.97 con estremo raggiunto ieri resta ~0.97; lo stesso con estremo
  // muto da 20 giorni scende (~0.30) -> fantasma.
  function effConf(l, srcProof, dstProof, now) {
    return baseConf(l) * endpointFreshness(srcProof, dstProof, now);
  }

  // --- Tier del cavo DEDOTTO (method-aware, vendor-neutral) -----------------
  // LLDP/CDP a confidence alta = adiacenza forte (tratteggio fitto); FDB/MAC/ARP =
  // inferenza debole (tratteggio rado). Chiave sul PROTOCOLLO, mai sul vendor.
  function cableTier(l) {
    const proto = String((l && l.protocol) || '').toUpperCase();
    const conf = Number(l && l.confidence) || 0;
    const strong = proto.indexOf('LLDP') >= 0 || proto.indexOf('CDP') >= 0;
    return (strong && conf >= 0.90) ? 'derived-strong' : 'derived-weak';
  }

  // Stato peggiore (rango piu' alto) fra due stati di nodo. Uno stato ignoto e'
  // neutro (rango di 'declared'): non lo consideriamo evidenza ne' contraddizione.
  function _worst(a, b) {
    const ra = (_RANK[a] == null) ? _RANK.declared : _RANK[a];
    const rb = (_RANK[b] == null) ? _RANK.declared : _RANK[b];
    return ra >= rb ? a : b;
  }

  // --- Stato di prova del CAVO (spec §4.3) ----------------------------------
  // Il cavo NON duplica lo stato: lo EREDITA dagli estremi + dalla propria natura.
  //
  //   1) MANUALE (declared) — controllato PER PRIMO, protetto. Il dichiarato e'
  //      legge: cablaggio fisico != liveness. Un estremo muto NON lo declassa;
  //      solo una CONTRADDIZIONE (diverged) -> 'declared-review'.
  //   2) DEDOTTO (derived) — l'inferenza dipende dall'evidenza: estremo non provato
  //      (absent/unverified/diverged) o confidence decaduta -> 'ghost'.
  //
  // Ritorna: 'declared' | 'declared-review' | 'ghost' | 'derived-strong' | 'derived-weak'.
  function cableProof(l, srcProof, dstProof, now) {
    const worst = _worst(srcProof && srcProof.status, dstProof && dstProof.status);
    // Miscablaggio: il vicino OSSERVATO su una porta contraddice QUESTO cavo
    // (lib/cable-reconcile.js scrive l.miscabled durante la Verifica). È una
    // contraddizione del cavo, non solo dell'estremo → conta come 'diverged'.
    const miscabled = !!(l && l.miscabled);

    // 1) DICHIARATO — legge, salvo contraddizione (estremo diverged O miscablaggio).
    if (!l || !l.autoLinked) {
      return (worst === 'diverged' || miscabled) ? 'declared-review' : 'declared';
    }

    // 2) DEDOTTO — dipende dall'evidenza; un miscablaggio è evidenza contraria.
    if (miscabled || worst === 'absent' || worst === 'unverified' || worst === 'diverged') return 'ghost';
    if (effConf(l, srcProof, dstProof, now) < GHOST_CONF) return 'ghost';
    return cableTier(l);
  }

  // --- Stato di prova del NODO da segnali di realta' (spec §6, §7.2) --------
  // Mappa PURA da segnali gia' osservati (dalla glue: Sync/Verifica/reachability)
  // allo stato persistente n.proof. Qui vivono le due regole d'onesta' verificabili:
  //   * "assente" SOLO con evidenza (absentEvidence, es. ARP-miss sul filo locale);
  //   * un remoto muto e' 'unverified' (grigio), MAI 'absent'.
  //
  // sig = {
  //   snmpOk:        bool  — SNMP ha risposto in QUESTA passata,
  //   reachable:     true|false|null — vivo via ping/arp/tcp (null = non tentato),
  //   diverged:      bool  — la realta' contraddice il documento (IP/VLAN/porta/identita'),
  //   absentEvidence:bool  — prova DURA di assenza (ARP-miss sul filo locale),
  //   attempted:     bool  — l'abbiamo interrogato (subnet nel raggio della passata),
  //   method:        'snmp'|'ping'|'arp'|'tcp'|null,
  //   prev:          <n.proof precedente> — per conservare lastProvenAt quando ora tace,
  // }
  // Ritorna un NUOVO oggetto proof (non muta `prev`). lastProvenAt si aggiorna solo
  // quando c'e' una prova FRESCA; altrimenti eredita quello di prev.
  function deriveNodeProof(sig, now) {
    sig = sig || {};
    const prev = sig.prev || {};
    const nowIso = new Date(_now(now)).toISOString();
    const prevProvenAt = prev.lastProvenAt || null;

    const proof = {
      status: 'declared',
      lastProvenAt: prevProvenAt,
      lastCheckedAt: prev.lastCheckedAt || null,
      method: sig.method || null,
      absentEvidence: false,
    };

    // Ogni tentativo (anche muto) aggiorna lastCheckedAt.
    const attempted = !!(sig.attempted || sig.snmpOk || sig.reachable != null || sig.absentEvidence || sig.diverged);
    if (attempted) proof.lastCheckedAt = nowIso;

    // Priorita': contraddizione > prova fresca > assenza provata > muto > invecchiato.
    if (sig.diverged) {
      proof.status = 'diverged';
      return proof;
    }
    if (sig.snmpOk || sig.reachable === true) {
      proof.status = 'proven';
      proof.lastProvenAt = nowIso;
      proof.method = sig.method || (sig.snmpOk ? 'snmp' : (proof.method || 'ping'));
      return proof;
    }
    if (sig.absentEvidence) {
      proof.status = 'absent';
      proof.absentEvidence = true;   // "assente" mai senza prova
      return proof;
    }
    if (attempted) {
      // Interrogato ma muto, senza evidenza dura -> incerto (il grigio), mai absent.
      proof.status = 'unverified';
      return proof;
    }
    // Non interrogato in questa passata: se avevamo una prova e s'e' invecchiata,
    // e' 'stale'; altrimenti resta com'era (o dichiarato).
    if (prevProvenAt) {
      proof.status = (nodeFreshness(prev, now) > 0) ? (prev.status || 'proven') : 'stale';
    } else {
      proof.status = prev.status || 'declared';
    }
    return proof;
  }

  // --- Truth Score — breakdown ONESTO, non un numero che nasconde (spec §4.4) -
  // Un manuale e' DICHIARATO, non PROVATO: collassare tutto in un'unica % mentirebbe.
  // Il punteggio e' una RIPARTIZIONE con un titolo ("Provato vero: proven/TOTAL %").
  const TRUTH_BUCKETS = ['proven', 'declared', 'toVerify', 'stale', 'diverged', 'absent'];

  // Bucket canonico di uno stato di prova (nodo o cavo). Sconosciuto -> 'declared'
  // (conservativo: non lo spacciamo per provato).
  function truthBucket(status) {
    switch (status) {
      case 'proven': return 'proven';
      case 'declared': return 'declared';
      case 'derived':
      case 'derived-strong':
      case 'derived-weak':
      case 'ghost':
      case 'unverified': return 'toVerify';
      case 'declared-review':
      case 'diverged': return 'diverged';
      case 'stale': return 'stale';
      case 'absent': return 'absent';
      default: return 'declared';
    }
  }

  const _DERIVED_STATUS = { 'derived': 1, 'derived-strong': 1, 'derived-weak': 1, 'ghost': 1 };

  // Percentuali intere che sommano ESATTAMENTE a 100 (largest-remainder), cosi' il
  // badge non legge mai 99% o 101%. Total 0 -> tutte 0.
  function _pct(parts, total) {
    const keys = Object.keys(parts);
    if (!(total > 0)) { const z = {}; keys.forEach(k => z[k] = 0); return z; }
    const raw = keys.map(k => ({ k, v: parts[k] / total * 100 }));
    const floor = raw.map(r => ({ k: r.k, f: Math.floor(r.v), rem: r.v - Math.floor(r.v) }));
    let used = floor.reduce((a, r) => a + r.f, 0);
    let left = Math.round(100 - used);
    floor.sort((a, b) => b.rem - a.rem);
    const out = {};
    floor.forEach((r, i) => { out[r.k] = r.f + (i < left ? 1 : 0); });
    return out;
  }

  // truthScore(elements, now) — ogni elemento = { status, w?, effConf? }.
  //   * DEDOTTI (derived*/ghost): pesano `w x effConf` in 'toVerify' — un'inferenza
  //     vale quanto la sua evidenza FRESCA. Il residuo `w x (1-effConf)` cade in
  //     'stale' (evidenza evaporata): cosi' i bucket sommano a TOTAL e il decadimento
  //     resta visibile invece di sparire. effConf assente -> 1 (nessun decadimento noto).
  //   * tutti gli altri: peso pieno `w` nel loro bucket.
  // Ritorna { proven, declared, toVerify, stale, diverged, absent, total, pct{...}, provenPct }.
  function truthScore(elements, now) {
    const acc = { proven: 0, declared: 0, toVerify: 0, stale: 0, diverged: 0, absent: 0 };
    let total = 0;
    for (const e of (elements || [])) {
      if (!e) continue;
      const w = Number.isFinite(+e.w) ? +e.w : 1;
      if (!(w > 0)) continue;
      total += w;
      const bucket = truthBucket(e.status);
      if (bucket === 'toVerify' && _DERIVED_STATUS[e.status]) {
        const ec = Number.isFinite(+e.effConf) ? Math.max(0, Math.min(1, +e.effConf)) : 1;
        acc.toVerify += w * ec;
        acc.stale += w * (1 - ec);
      } else {
        acc[bucket] += w;
      }
    }
    const pct = _pct(acc, total);
    return {
      proven: acc.proven, declared: acc.declared, toVerify: acc.toVerify,
      stale: acc.stale, diverged: acc.diverged, absent: acc.absent,
      total, pct, provenPct: pct.proven,
    };
  }

  return {
    // freschezza & decadimento
    freshness, nodeFreshness, baseConf, endpointFreshness, effConf,
    // cavo
    cableTier, cableProof,
    // nodo
    deriveNodeProof,
    // punteggio
    truthBucket, truthScore, TRUTH_BUCKETS,
    // soglie (per test / doc / glue)
    FRESH_H, STALE_D, EXPIRE_D, GHOST_CONF, DEFAULT_DERIVED_CONF,
  };
});
