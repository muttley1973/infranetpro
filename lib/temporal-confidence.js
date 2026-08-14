// ============================================================
// TEMPORAL CONFIDENCE — "visto N volte" come SCORE (UMD-lite, browser + Node)
// ============================================================
// Le observation di discovery portano già count / ts(firstSeen) / lastSeen, ma
// finora erano write-only: nessuno le leggeva in uno score. Qui diventano un
// segnale di prima classe.
//
//   Un endpoint visto PIU' VOLTE, su PIU' giorni, e' piu' "reale" di uno visto
//   una volta sola; uno non piu' visto da tempo DECADE.
//
// Deterministico e vendor-neutral: nessun quirk di prodotto, solo l'aritmetica di
// quante volte (seen) e da quanto (span/age). E' ADVISORY (manual-first): informa
// una decisione umana (es. "cosa c'e' dietro questa porta?"), non la prende. Puro:
// il chiamante passa i record, la funzione non tocca stato ne' DOM ne' l'orologio
// (now iniettabile per i test).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MS_PER_DAY = 864e5;

  // Soglie ritoccabili da qui (esportate per i test / la doc).
  const STALE_DAYS = 30;         // non visto da oltre → tier 'stale' + score dimezzato
  const GONE_DAYS = 60;          // non visto da MOLTO → score fortemente penalizzato
  const STABLE_SEEN = 5;         // avvistamenti minimi per 'stable'
  const STABLE_SPAN_DAYS = 14;   // arco temporale minimo per 'stable'
  // Avvistamenti SENZA data: non si sa QUANDO. Non potendo decadere, prendevano lo
  // stesso punteggio di una vista di stamattina — «visto 8 volte» senza data dava
  // 0.80 esattamente come una vista ieri, mentre la stessa a 400 giorni dà 0.26.
  // Era ottimismo sul dato assente (paletto ②): se non sappiamo, non regaliamo
  // freschezza. Stesso fattore di `stale`, perché un'età ignota può benissimo
  // essere vecchia — ma NON si afferma `stale:true`, che sarebbe un'altra
  // invenzione: si dice «età ignota» e lo si porta fuori (tier + ageUnknown).
  const UNDATED_FACTOR = 0.55;

  function _num(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }

  // aggregateObservations(records) — piega piu' record dello STESSO entity (es. lo
  // stesso MAC su porte/fonti diverse) in { seen, firstSeen, lastSeen }.
  //   seen      = somma dei count (ogni record.count = quante volte quella tupla e'
  //               stata vista, ~ una per passata di Sync)
  //   firstSeen = min(ts) · lastSeen = max(lastSeen||ts)
  function aggregateObservations(records) {
    let seen = 0, first = Infinity, last = -Infinity;
    for (const r of (records || [])) {
      if (!r) continue;
      seen += Math.max(1, _num(r.count) || 1);
      const f = Date.parse(r.firstSeen || r.ts || r.lastSeen || '');
      const l = Date.parse(r.lastSeen || r.ts || r.firstSeen || '');
      if (Number.isFinite(f)) first = Math.min(first, f);
      if (Number.isFinite(l)) last = Math.max(last, l);
    }
    return {
      seen,
      firstSeen: Number.isFinite(first) ? new Date(first).toISOString() : '',
      lastSeen: Number.isFinite(last) ? new Date(last).toISOString() : '',
    };
  }

  // temporalConfidence({seen, firstSeen, lastSeen}, now?) →
  //   { score, tier, seen, spanDays, ageDays, stale }
  //   score ∈ [0,1] · tier ∈ 'fresh' | 'recurring' | 'established' | 'stable' | 'stale'
  //   spanDays = arco prima↔ultima vista · ageDays = da quanto non si vede (null se ignoto)
  function temporalConfidence(obs, now) {
    obs = obs || {};
    const nowMs = (now != null) ? +now : Date.now();
    const seen = Math.max(0, _num(obs.seen));
    const first = Date.parse(obs.firstSeen || obs.ts || '');
    const last = Date.parse(obs.lastSeen || obs.ts || '');
    const hasLast = Number.isFinite(last);

    const spanDays = (Number.isFinite(first) && hasLast && last >= first)
      ? (last - first) / MS_PER_DAY : 0;
    const ageDays = hasLast ? Math.max(0, (nowMs - last) / MS_PER_DAY) : null;
    const stale = (ageDays != null) && ageDays > STALE_DAYS;
    // Visto, ma non si sa quando: l'assenza della data è essa stessa un'informazione
    // (in meno) e va detta, non ignorata. Con 0 avvistamenti non c'è nulla da datare.
    const ageUnknown = seen > 0 && !hasLast;

    // Ripetizione: ladder saturante su seen (0 avvistamenti = 0).
    let rep;
    if (seen <= 0) rep = 0;
    else if (seen === 1) rep = 0.20;
    else if (seen <= 2) rep = 0.40;
    else if (seen <= 4) rep = 0.60;
    else if (seen <= 9) rep = 0.80;
    else rep = 0.92;

    // Persistenza nel tempo: bonus per un arco prima↔ultima ampio (non un singolo Sync).
    // Gate su seen>0: senza avvistamenti non c'è persistenza da premiare — altrimenti
    // lo spanBonus trapelerebbe nello score contraddicendo l'invariante "0 avvistamenti
    // = 0" (uno span può esistere anche con seen 0 da record malformati/aggregati vuoti).
    let spanBonus = 0;
    if (seen > 0) {
      if (spanDays >= STABLE_SPAN_DAYS) spanBonus = 0.08;
      else if (spanDays >= 7) spanBonus = 0.05;
      else if (spanDays >= 1) spanBonus = 0.02;
    }

    let score = rep + spanBonus;
    // Decadimento: un dato non piu' visto perde forza. Un dato SENZA data non può
    // decadere col tempo, e proprio per questo non deve nemmeno godere della piena
    // fiducia: l'ignoranza sull'età pesa quanto un mese di silenzio.
    if (ageDays != null && ageDays > GONE_DAYS) score *= 0.30;
    else if (stale) score *= 0.55;
    else if (ageUnknown) score *= UNDATED_FACTOR;
    score = Math.max(0, Math.min(1, score));

    // Tier: 'stale' scavalca tutto (non visto di recente e' rilevante per il DR), e
    // 'undated' subito dopo — «non so quando» è un'informazione da mostrare, non un
    // dettaglio da nascondere dietro a un tier che suonerebbe rassicurante.
    let tier;
    if (seen <= 0) tier = 'fresh';
    else if (stale) tier = 'stale';
    else if (ageUnknown) tier = 'undated';
    else if (seen >= STABLE_SEEN && spanDays >= STABLE_SPAN_DAYS) tier = 'stable';
    else if (seen >= 3 || spanDays >= 7) tier = 'established';
    else if (seen >= 2) tier = 'recurring';
    else tier = 'fresh';

    return {
      score: Math.round(score * 100) / 100,
      tier,
      seen,
      spanDays: Math.round(spanDays * 10) / 10,
      ageDays: (ageDays != null) ? Math.round(ageDays * 10) / 10 : null,
      stale,
      ageUnknown,
    };
  }

  return {
    aggregateObservations, temporalConfidence,
    STALE_DAYS, GONE_DAYS, STABLE_SEEN, STABLE_SPAN_DAYS, UNDATED_FACTOR,
  };
});
