'use strict';
// ============================================================
//  lib/verify-trend.js — «questa rete la stiamo conoscendo meglio, o stiamo
//  solo guardando?» (Principio di design ③, primo MUST)
//
//  Il principio dice: rendere MISURABILE se la quota di «confermato» cresce nel
//  tempo o resta stagnante per un dato ambiente — perché il rischio non è
//  tecnico ma commerciale: un cliente che vede una coda ferma conclude che il
//  tool ha SPOSTATO il lavoro, non l'ha ridotto.
//
//  Il dato c'era già: `projects/history/<id>/timeline.jsonl` scrive una riga per
//  Verifica (server/routes/history.js), con i bucket del Drift Report e la
//  dimensione della rete. Qui non si raccoglie niente: si LEGGE.
//
//  ── TRE UNIVERSI, TRE RAPPORTI ────────────────────────────────────────────
//  ⚠️ Il difetto che questo modulo esiste per NON commettere: i bucket non
//  vivono nello stesso mondo.
//     consistent / stateDrift ............ per PORTA   (la chiave è `ok:${pid}`)
//     macOrphan / unverified / ipChanged /
//       identityDrift ..................... per APPARATO
//     ghostCable / shutCable ............. per CAVO
//  Una «% confermato» sola li somma, cioè divide porte per apparati: il numero
//  si muoverebbe col rapporto porte/device della rete invece che con la
//  conoscenza che ne abbiamo. Sarebbe una metrica che cambia quando compri uno
//  switch. Quindi: tre serie separate, ognuna col suo denominatore DICHIARATO.
//
//  ── LE QUATTRO REGOLE CHE LA TENGONO ONESTA ───────────────────────────────
//  ① GUARDARE MENO NON DEVE MIGLIORARE IL VOTO. `unverified` (subnet fuori dalla
//     portata della sweep) sta nel DENOMINATORE della presenza, non fuori. Se lo
//     si esclude, restringere la scansione fa salire la percentuale: sarebbe il
//     modo più facile di far crescere questa metrica senza migliorare niente.
//     E la quota di non-conferma che è CECITÀ NOSTRA esce a parte, perché è la
//     differenza fra «quell'apparato non c'è» e «non l'ho guardato».
//  ② DUE STRUMENTI NON SI CONFRONTANO. Un poll automatico orario e una Verifica
//     manuale completa non misurano la stessa cosa: si confrontano righe con lo
//     stesso `verify`.
//  ③ SE LA RETE CAMBIA, LA SERIE SI SPEZZA. Un salto di `totals.nodes` oltre
//     soglia vuol dire che l'ambiente non è più quello: confrontare due reti
//     diverse è un errore di categoria, non un dato rumoroso. Si dichiara la
//     rottura e si confronta solo il tratto dopo.
//  ④ UNA VERIFICA CIECA NON È UNA VERIFICA ANDATA MALE: NON È AVVENUTA. Le righe
//     `blind` (zero confermati e qualcosa di non verificabile — la stessa
//     nozione di driftBannerKind) escono dalla tendenza ed entrano nella
//     copertura. Tenerle dentro farebbe crollare la curva per un motivo che non
//     riguarda la rete.
//
//  ⚠️ E «stagna» da solo non è azionabile: il verdetto porta sempre il PERCHÉ,
//  derivato dal bucket che pesa di più sulla coda. «La coda non cala: 40
//  non-documentati non sono mai stati decisi» è una frase su cui si agisce.
//
//  ⚠️ I perché escono come CODICI, non come frasi: `{ code, ...dati }`. Un motore
//  puro che restituisse prosa italiana la sputerebbe tale e quale dentro
//  un'interfaccia inglese — ed è una rottura che nessun cancello di parità i18n
//  vede, perché la stringa non nasce da una chiave. Chi rende (la scheda
//  «Verifiche», la sonda) traduce; qui si dice solo COSA è successo.
//
//  Puro: zero IO, zero DOM, zero orologio. UMD-lite. Il chiamante passa le righe.
// ============================================================
(function (root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./drift-report.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (drift) {
  'use strict';

  // La coda azionabile ha UNA definizione sola, e vive nel Drift Report: qui si
  // usa quella. Ricalcolarla vorrebbe dire due verità sullo stesso numero.
  const _actionable = drift && typeof drift.driftActionable === 'function'
    ? drift.driftActionable
    : null;

  const MIN_CAMPIONI = 3;          // sotto, una tendenza non è una tendenza
  // La serie si spezza quando l'ambiente è UN ALTRO, e servono due condizioni
  // insieme. Solo la relativa è troppo sensibile in basso: su una rete da 38
  // nodi il 10% sono quattro apparati, cioè il normale andirivieni di un mese —
  // e la serie si spezzava da sola, misurato sul progetto 10. Solo l'assoluta
  // sarebbe cieca in alto: cinque nodi su cinquecento non sono niente.
  const SALTO_RETE = 0.10;         // ±10% di nodi…
  const SALTO_MIN_NODI = 5;        // …E almeno 5 apparati: sotto, è andirivieni
  const BANDA_MORTA = 0.02;        // ±2 punti: sotto, è rumore, non movimento

  const _n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const _pct = (num, den) => (den > 0 ? num / den : null);

  // Una riga è CIECA con la stessa regola del banner: zero confermati e qualcosa
  // che non si è potuto verificare. Non si reinventa il criterio.
  function _cieca(c) {
    return _n(c.consistent) === 0 && _n(c.unverified) > 0;
  }

  // ── Le tre quote di UNA riga ────────────────────────────────────────────
  function quoteDiUnaRiga(riga) {
    const c = (riga && riga.counts) || {};
    const t = (riga && riga.totals) || {};
    const nodi = _n(t.nodes);

    // PORTE — il solo universo che ha sia il positivo sia il negativo registrati.
    const porteViste = _n(c.consistent) + _n(c.stateDrift);
    const porte = _pct(_n(c.consistent), porteViste);

    // APPARATI — qui il bucket POSITIVO non esiste nella riga: il Drift Report
    // registra solo chi NON è confermato. Quindi non si inventa un «confermati»:
    // si misura la quota NON confermata sul parco documentato, che è un numero
    // vero e si legge al contrario. ⚠️ `unverified` è dentro: vedi regola ①.
    // ⚠️ Le PARTI escono insieme alla quota, da una somma sola: la percentuale e
    // la barra che la disegna devono venire dallo stesso conto, o il giorno che
    // una delle due cambia il pannello racconta due storie.
    //   misurati    = l'abbiamo guardato e non torna (assente, IP cambiato, sostituito)
    //   nonVisti    = non l'abbiamo guardato (subnet fuori dalla portata della sweep)
    // La differenza fra le due e' il cuore di questo pannello, e in una barra si
    // legge in un colpo d'occhio come in nessun numero.
    const misurati = _n(c.macOrphan) + _n(c.ipChanged) + _n(c.identityDrift);
    const nonVisti = _n(c.unverified);
    const nonConfermati = misurati + nonVisti;
    const presenza = nodi > 0 ? _pct(nodi - nonConfermati, nodi) : null;
    const parti = nodi > 0
      ? { confermati: Math.max(0, nodi - nonConfermati), misurati, nonVisti, totale: nodi }
      : null;

    // CECITÀ — quanta parte del PARCO non è stata guardata. È il guardiano della
    // regola ①: se sale, una presenza che sale può venire da lì.
    // ⚠️ Il denominatore è il parco, NON la non-conferma, e la differenza l'ha
    // trovata il disegno guardato sul caso vero: come quota della non-conferma
    // la cecità SALE da sola quando si sistemano gli assenti (stessi 3 non
    // guardati, ma su 5 mancanti invece che su 25), e una rete che migliora
    // davvero si vedeva rispondere «prima recupera la copertura». Una metrica
    // che punisce il miglioramento è peggio di nessuna metrica. Sul parco
    // invece si muove solo quando si guarda DAVVERO meno, che è ciò che deve
    // sorvegliare — e «13 su 43 non guardati» si legge, «72% della
    // non-conferma» no.
    const cecita = _pct(nonVisti, nodi);

    // CODA — elementi che aspettano una decisione umana (definizione del Drift).
    // ⚠️ In superficie si chiama «divergenze»: è la parola che la scheda «Verifiche»
    // usa già per ogni riga, ed è lo stesso numero. Qui il campo resta `coda` — un
    // identificatore non è testo che qualcuno legge — ma chi rende usi quella.
    const coda = _actionable ? _actionable(c) : null;

    return { at: riga && riga.at, verify: riga && riga.verify, nodi, porte, presenza, cecita, coda, parti, counts: c };
  }

  // ── Selezione delle righe confrontabili, con il MOTIVO di ogni scarto ───
  // ⚠️ Si scarta DICHIARANDO: una riga sparita in silenzio da una serie è la
  // stessa bugia di un arco sparito da una topologia.
  function _selezione(righe, opts) {
    const o = opts || {};
    const tutte = (Array.isArray(righe) ? righe : []).filter(r => r && typeof r === 'object');
    const ordinate = tutte.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const scartate = [];
    if (!ordinate.length) return { usate: [], scartate, modo: null, rottura: null };

    // ② Un solo strumento: di default quello dell'ULTIMA riga (è la misura che
    // l'utente ha appena fatto, quindi quella che sta guardando).
    const modo = o.verify || ordinate[ordinate.length - 1].verify || 'manual';
    let vive = [];
    for (const r of ordinate) {
      if ((r.verify || 'manual') !== modo) { scartate.push({ at: r.at, perche: 'strumento diverso (' + (r.verify || 'manual') + ')' }); continue; }
      if (_cieca(r.counts || {})) { scartate.push({ at: r.at, perche: 'Verifica cieca: non è andata male, non è avvenuta' }); continue; }
      vive.push(r);
    }

    // ③ La rete cambia → la serie si spezza. Si tiene il tratto FINALE, quello
    // che descrive l'ambiente di adesso.
    let rottura = null;
    for (let i = vive.length - 1; i > 0; i--) {
      const a = _n((vive[i - 1].totals || {}).nodes), b = _n((vive[i].totals || {}).nodes);
      const scarto = Math.abs(b - a);
      const minNodi = (o.saltoMinNodi != null) ? o.saltoMinNodi : SALTO_MIN_NODI;
      if (a > 0 && scarto >= minNodi && scarto / a > (o.saltoRete != null ? o.saltoRete : SALTO_RETE)) {
        rottura = { at: vive[i].at, da: a, a: b };
        for (const r of vive.slice(0, i)) scartate.push({ at: r.at, perche: 'prima del cambio di rete (' + a + ' → ' + b + ' nodi)' });
        vive = vive.slice(i);
        break;
      }
    }
    return { usate: vive, scartate, modo, rottura };
  }

  // ⚠️ DUE segnali, non uno, e ognuno dice UNA cosa sola:
  //   verso    = dove va il NUMERO (su / giu / fermo)
  //   verdetto = se questo è un BENE (migliora / stagna / peggiora)
  // Sono separati perché su metà di queste serie scendere è un bene, e un verbo
  // solo li confonde. La prima versione diceva «cresce» per una cecità SCESA dal
  // 77,8% al 72,2% — cioè il contrario del vero, accanto alla riga che avverte
  // «se sale, il resto non vuol dire niente». Una metrica che il lettore capisce
  // al rovescio è peggio di nessuna metrica: l'ha trovata la sonda al primo giro
  // sui dati veri, non le prove sui dati finti.
  function _verdettoSerie(serie, banda, versoBuono) {
    const punti = serie.filter(v => v != null);
    if (punti.length < 2) return { delta: null, verso: null, verdetto: 'non-confrontabile' };
    const delta = punti[punti.length - 1] - punti[0];
    if (Math.abs(delta) < banda) return { delta, verso: 'fermo', verdetto: 'stagna' };
    const verso = delta > 0 ? 'su' : 'giu';
    return { delta, verso, verdetto: (verso === versoBuono) ? 'migliora' : 'peggiora' };
  }

  // Il bucket che pesa di più sulla coda: è il PERCHÉ di una stagnazione.
  function _bucketDominante(usate) {
    const somma = {};
    for (const r of usate) {
      const c = r.counts || {};
      for (const k of ['stateDrift', 'macOrphan', 'undocumented', 'ghostCable', 'ipChanged', 'identityDrift']) {
        somma[k] = (somma[k] || 0) + _n(c[k]);
      }
    }
    let top = null;
    for (const k of Object.keys(somma)) if (somma[k] > 0 && (!top || somma[k] > somma[top])) top = k;
    return top ? { bucket: top, totale: somma[top] } : null;
  }

  /** La tendenza di un ambiente, da N righe di timeline.
   *  @param {Array} righe  righe di `timeline.jsonl` (ordine qualsiasi)
   *  @param {object} [opts] { verify, saltoRete, bandaMorta, minCampioni }
   */
  function trendVerifiche(righe, opts) {
    const o = opts || {};
    const banda = (o.bandaMorta != null) ? o.bandaMorta : BANDA_MORTA;
    const minC = (o.minCampioni != null) ? o.minCampioni : MIN_CAMPIONI;
    const { usate, scartate, modo, rottura } = _selezione(righe, o);
    const quote = usate.map(quoteDiUnaRiga);
    const perche = [];

    const out = {
      campioni: quote.length,
      // «Dove sono adesso»: l'ultima misura confrontabile. Le serie dicono dove si
      // va, questa dice da dove. Sono due domande diverse e vogliono due forme.
      ultima: quote.length ? quote[quote.length - 1] : null,
      strumento: modo,
      finestra: quote.length ? { da: quote[0].at, a: quote[quote.length - 1].at } : null,
      rottura,
      scartate,
      porte: Object.assign({ serie: quote.map(q => q.porte) }, _verdettoSerie(quote.map(q => q.porte), banda, 'su')),
      presenza: Object.assign({ serie: quote.map(q => q.presenza) }, _verdettoSerie(quote.map(q => q.presenza), banda, 'su')),
      cecita: Object.assign({ serie: quote.map(q => q.cecita) }, _verdettoSerie(quote.map(q => q.cecita), banda, 'giu')),
      coda: Object.assign({ serie: quote.map(q => q.coda) }, _verdettoSerie(quote.map(q => q.coda), 0.5, 'giu')),
      verdetto: 'non-confrontabile',
      perche,
    };

    // ⚠️ L'ordine dei cancelli è il messaggio: prima si dice se il confronto vale,
    // e solo dopo che cosa dice. Un verdetto dato su basi che non reggono è
    // peggio di nessun verdetto, perché ha la stessa faccia di uno buono.
    if (quote.length < minC) {
      perche.push({ code: 'pochiCampioni', min: minC, n: quote.length });
      return out;
    }
    if (out.cecita.verdetto === 'peggiora') {
      perche.push({ code: 'cecitaCresciuta' });
      return out;
    }

    // Il verdetto d'insieme lo detta la PRESENZA (è la domanda del principio),
    // con la coda a fare da contrappeso: conoscere meglio e non smaltire niente
    // resta una stagnazione dal punto di vista di chi paga.
    if (out.presenza.verdetto === 'migliora' && out.coda.verdetto !== 'peggiora') out.verdetto = 'migliora';
    else if (out.presenza.verdetto === 'peggiora') out.verdetto = 'peggiora';
    else out.verdetto = 'stagna';

    if (out.verdetto !== 'migliora') {
      const dom = _bucketDominante(usate);
      if (dom) perche.push({ code: 'codaFerma', bucket: dom.bucket, totale: dom.totale, campioni: quote.length });
      else perche.push({ code: 'codaVuota' });
    }
    if (rottura) perche.push({ code: 'serieSpezzata', at: rottura.at, da: rottura.da, a: rottura.a });
    return out;
  }

  return { trendVerifiche, quoteDiUnaRiga, MIN_CAMPIONI, SALTO_RETE, SALTO_MIN_NODI, BANDA_MORTA };
});
