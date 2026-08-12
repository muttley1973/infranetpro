// ============================================================
// DISCOVERY-HISTORY — sfoltimento PURO della cronologia di discovery + utility FDB.
//
// Estratto dal god-file src/app-autolink.js: la logica di aging/cap della
// cronologia osservazioni (state.discoveryHistory.observations) e la
// normalizzazione della mappa VLAN-per-MAC sono PURE (nessuno stato globale,
// nessun DOM) → vivono qui come lib testabile via require(), e l'app le legge
// dal ponte window (golden-rule lib-script: NON importarle nel bundle).
//
//   pruneDiscoveryHistory(list)         → aging (lastSeen/ts) + tetto rigido, in place
//   normalizeFdbVlan(fv, normMac)       → { macKey: vlanId } deduplicato
//
// Le observation sono OGGI write-only (la "reinforce link nel tempo" è futura),
// quindi si sfoltiscono senza rischi funzionali per non gonfiare il JSON salvato.
// ============================================================
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else Object.assign(root, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Due regole, con due mestieri diversi. **L'invecchiamento è quella vera**: un
  // avvistamento non più visto da 90 giorni non dice più niente sulla rete di
  // oggi. Il tetto sul NUMERO è solo un fermo contro la crescita infinita.
  //
  // ⚠️ Era 1000, e il motivo scritto qui era «~200KB nel peggiore dei casi»: il
  // peso nel FILE DI PROGETTO. Da 2.8.1 le osservazioni vivono nel sidecar
  // `history/<id>/observations.json`, quindi quell'argomento non vale più — e
  // nel frattempo mordeva per primo, cancellando storia buona. Un'osservazione è
  // un ENDPOINT VISTO (mac|ip|switch|porta|ifName|fonte), non un apparato
  // documentato: su un progetto reale da 6 nodi ce n'erano già **204**. Al tetto
  // di prodotto (~500 apparati) 1000 si esaurisce in una scansione, e a cadere
  // sono le più VECCHIE — cioè proprio il `firstSeen` su cui
  // `lib/temporal-confidence.js` costruisce il punteggio: il tetto tarpava la
  // funzione che ci si appoggia.
  const DISCOVERY_HISTORY_MAX = 10000;
  const DISCOVERY_HISTORY_MAX_AGE_DAYS = 90;

  const MS_PER_DAY = 864e5;

  // Sfoltisce la cronologia IN PLACE (mantiene il riferimento dell'array, che i
  // chiamanti tengono): 1) aging per lastSeen/ts, 2) tetto rigido, che sacrifica
  // le osservazioni viste meno di recente.
  // opts = { max, maxAgeDays, now } per i test; di default usa le costanti + Date.now().
  function pruneDiscoveryHistory(list, opts) {
    if (!Array.isArray(list)) return list;
    opts = opts || {};
    const max = opts.max != null ? opts.max : DISCOVERY_HISTORY_MAX;
    const maxAgeDays = opts.maxAgeDays != null ? opts.maxAgeDays : DISCOVERY_HISTORY_MAX_AGE_DAYS;
    const now = opts.now != null ? opts.now : Date.now();
    const cutoff = now - maxAgeDays * MS_PER_DAY;
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      const rec = list[r];
      const ts = Date.parse((rec && (rec.lastSeen || rec.ts)) || '');
      // tieni le recenti e quelle senza data valida (non perdere record legacy)
      if (!Number.isFinite(ts) || ts >= cutoff) list[w++] = rec;
    }
    list.length = w;
    if (list.length <= max) return list;

    // ⚠️ Qui c'era `splice(0, len - max)`, cioè «via le prime della lista». Ma
    // l'elenco NON è ordinato per data: un'osservazione già nota si aggiorna sul
    // posto (count++, lastSeen), quindi l'ordine è quello del PRIMO avvistamento.
    // Tagliare dalla testa toglieva le osservazioni conosciute da più tempo — che,
    // avendo già superato il filtro dei 90 giorni, sono le più consolidate: count
    // alto e firstSeen lontano, cioè esattamente ciò che `lib/temporal-confidence.js`
    // trasforma in punteggio. Era il lato sbagliato, e non era una decisione: era
    // la scrittura più comoda.
    //
    // Si sacrifica invece chi non si vede da PIÙ TEMPO. Un record senza data
    // valida cade per primo: l'aging lo protegge (mancanza di data non è prova di
    // obsolescenza), ma quando si è costretti a scegliere è quello che non porta
    // nessuna evidenza temporale. A parità di `lastSeen` decide l'ordine di
    // arrivo, così il taglio resta deterministico.
    const seenMs = (rec) => {
      const t = Date.parse((rec && (rec.lastSeen || rec.ts)) || '');
      return Number.isFinite(t) ? t : -Infinity;   // senza data = il più sacrificabile
    };
    const doomed = new Set(
      list.map((rec, i) => i)
        .sort((a, b) => (seenMs(list[a]) - seenMs(list[b])) || (a - b))
        .slice(0, list.length - max)
    );
    let k = 0;
    for (let r = 0; r < list.length; r++) if (!doomed.has(r)) list[k++] = list[r];
    list.length = k;      // l'ordine dei superstiti resta quello di prima
    return list;
  }

  // Normalizza la mappa VLAN-per-MAC del driver { rawMac: vlanId } usando la
  // STESSA chiave dell'app (normMac, tipicamente win._normMacKey), così i lookup
  // nel Drift Report combaciano con la cache FDB. normMac è iniettato per restare
  // PURI; fallback = lowercase semplice (compatibile col vecchio comportamento).
  function normalizeFdbVlan(fv, normMac) {
    const out = {};
    if (!fv || typeof fv !== 'object') return out;
    const norm = (typeof normMac === 'function') ? normMac : (m => String(m || '').toLowerCase());
    for (const [rawMac, vlan] of Object.entries(fv)) {
      const k = norm(rawMac);
      if (!k) continue;
      const v = parseInt(vlan, 10);
      if (Number.isFinite(v) && out[k] === undefined) out[k] = v;
    }
    return out;
  }

  // ── Le osservazioni vivono FUORI dal documento ──────────────────────
  // Un'osservazione è una MISURA («questo MAC l'ho visto su questa porta, N volte,
  // dal … al …»): la scrive la rete, non l'utente. Stava nel `<id>.json` e su un
  // progetto con pochi apparati arrivava a pesarne il 96%. Da qui in poi vive nel
  // sidecar `history/<id>/observations.json`, come la presenza e la timeline.

  const _MAXLEN = 128;
  function _iso(v) { const s = String(v == null ? '' : v); return Number.isFinite(Date.parse(s)) ? s : null; }
  function _ms(v) { const t = Date.parse(String(v == null ? '' : v)); return Number.isFinite(t) ? t : 0; }
  function _listOf(src) {
    if (Array.isArray(src)) return src;
    if (src && typeof src === 'object' && Array.isArray(src.observations)) return src.observations;
    return [];
  }

  // Identità di un'osservazione: la STESSA chiave che usa
  // `_recordDiscoveryObservation` per riconoscere «questa l'ho già vista».
  function observationKey(o) {
    return [o && o.mac, o && o.ip, o && o.switchId, o && o.portId, o && o.ifName, o && o.source]
      .map(v => String(v == null ? '' : v)).join('|');
  }

  // Un record ripulito, o null. Serve almeno un MAC o un IP: senza, non identifica
  // niente. ⚠️ Il MAC NON si ri-normalizza qui: la chiave la fa `win._normMacKey`
  // lato app, e una seconda normalizzazione diversa spaccherebbe gli appaiamenti.
  // I cinque campi testuali si emettono SEMPRE (anche vuoti), come fa lo scrittore:
  // un round-trip non deve cambiare la forma del record sotto i lettori.
  function sanitizeObservation(o) {
    if (!o || typeof o !== 'object') return null;
    const mac = String(o.mac == null ? '' : o.mac).trim().slice(0, _MAXLEN);
    const ip = String(o.ip == null ? '' : o.ip).trim().slice(0, _MAXLEN);
    if (!mac && !ip) return null;
    const out = { mac, ip };
    const ts = _iso(o.ts), lastSeen = _iso(o.lastSeen);
    if (ts) out.ts = ts;
    if (lastSeen) out.lastSeen = lastSeen;
    const count = Math.floor(Number(o.count));
    out.count = (Number.isFinite(count) && count > 0) ? count : 1;
    for (const k of ['switchId', 'switchName', 'portId', 'ifName', 'source']) {
      out[k] = String(o[k] == null ? '' : o[k]).trim().slice(0, _MAXLEN);
    }
    const conf = Number(o.confidence);
    out.confidence = Number.isFinite(conf) ? conf : 0;
    return out;
  }

  // Fonde due elenchi tenendo, per ogni osservazione, la storia PIÙ LARGA:
  // il primo avvistamento più antico, l'ultimo più recente, il conteggio e la
  // confidenza maggiori.
  //
  // ⚠️ Il conteggio si prende col MASSIMO, NON si somma. Fondere due volte la
  // stessa lista (un secondo Salva senza nuove scoperte) non deve gonfiare la
  // storia: `lib/temporal-confidence.js` dà punteggio a «quante volte», e un
  // numero inflazionato diventerebbe una certezza inventata.
  function foldObservations(base, incoming) {
    const out = [];
    const byKey = new Map();
    for (const src of [base, incoming]) {
      for (const raw of _listOf(src)) {
        const o = sanitizeObservation(raw);
        if (!o) continue;
        const prev = byKey.get(observationKey(o));
        if (!prev) { byKey.set(observationKey(o), o); out.push(o); continue; }
        if (_ms(o.lastSeen) > _ms(prev.lastSeen)) prev.lastSeen = o.lastSeen;
        if (o.ts && (!prev.ts || _ms(o.ts) < _ms(prev.ts))) prev.ts = o.ts;
        if (o.count > prev.count) prev.count = o.count;
        if (o.confidence > prev.confidence) prev.confidence = o.confidence;
      }
    }
    pruneDiscoveryHistory(out);   // aging + tetto sull'unione
    return { observations: out };
  }

  // Rimette nello stato ciò che è stato salvato, unito a quello che lo stato già
  // porta (i progetti vecchi se lo trascinano dentro): IN PLACE. Ritorna quante
  // osservazioni ha lo stato dopo la fusione.
  function mergeObservations(state, saved) {
    if (!state || typeof state !== 'object') return 0;
    const folded = foldObservations(saved, state.discoveryHistory);
    state.discoveryHistory = folded;
    return folded.observations.length;
  }

  // Toglie le osservazioni dallo stato che sta per essere scritto sul disco.
  // Ritorna quante ne sono uscite.
  function stripObservations(state) {
    if (!state || typeof state !== 'object') return 0;
    const n = _listOf(state.discoveryHistory).length;
    delete state.discoveryHistory;
    return n;
  }

  return {
    pruneDiscoveryHistory, normalizeFdbVlan,
    observationKey, sanitizeObservation, foldObservations, mergeObservations, stripObservations,
    DISCOVERY_HISTORY_MAX, DISCOVERY_HISTORY_MAX_AGE_DAYS,
  };
});
