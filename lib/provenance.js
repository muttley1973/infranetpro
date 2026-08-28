// ============================================================
// PROVENANCE — l'envelope: «questo valore, come facciamo a saperlo»
// (UMD-lite, Node + browser · zero-dip · lingua-indipendente · puro)
// ============================================================
// Un valore, in InfraNet, non è mai solo un valore. È sempre una di tre cose, e
// confonderle è il modo in cui un tool di documentazione comincia a mentire:
//
//   DICHIARATO — l'ha scritto una persona. È legge (paletto ①), e NON invecchia:
//                una decisione non scade perché è passato un mese.
//   MISURATO   — l'abbiamo letto da un apparato, in un istante preciso (`at`).
//                Invecchia, e il suo peso dipende da quanto è vecchio.
//   DERIVATO   — l'abbiamo calcolato da altro. `from` dice da cosa, così la
//                catena resta ispezionabile e non diventa un'affermazione nuda.
//
// Questi sono ASSI, non stati. I quattro motori di stato esistenti (`proof.js`,
// `temporal-confidence.js`, `identity-reconcile.js`, la presenza) tengono le loro
// etichette di dominio: qui non si riscrive nessuno di loro. Questo modulo dà
// la LINGUA con cui i fatti NUOVI nascono già raccontabili (Cambio 2C del piano
// `_local/notes/PIANO_debito-strutturale-e-typescript.md`), e converge in avanti.
//
// ── Cosa questo modulo NON è ──────────────────────────────────────────────
//
//  · NON è `lib/source-ref.js`. Quello risponde a «quale oggetto DI LÀ è questo»
//    (identità stabile verso un DCIM: `srcIf: 1000`). Questo risponde a «come
//    facciamo a saperlo». Si COMPONGONO: un valore importato da NetBox è
//    `declared` (è intended-state, qualcuno l'ha dichiarato) e *quale* oggetto
//    NetBox sia lo dice `source-ref` — che ha già deciso (scelta ④) che il
//    sistema d'origine è dichiarato una volta sola sul progetto. Per questo qui
//    NON esiste una quarta origine `imported`: sarebbe la stessa cosa detta in
//    due posti, cioè il bug-classe più caro della storia del progetto.
//
//  · NON è una regola d'età unica. Il piano prevedeva «UNA regola d'età, oggi
//    sparsa»: verificandolo, è FALSO ed era bene non implementarlo alla lettera.
//    `proof.js` (6h / 7g / 30g) misura «quanto è fresca la PROVA che un apparato
//    è vivo»; `temporal-confidence.js` (30g / 60g) misura «quanto mi fido di un
//    AVVISTAMENTO ripetuto». Sono due domande diverse con emivite legittimamente
//    diverse — fonderle romperebbe entrambi i motori. Quello che si unifica è la
//    FORMA della risposta (`Staleness`), non le soglie: la scala è un PARAMETRO
//    obbligatorio, mai un default silenzioso.
//
// ── Perché questo file è `.js` e non `.ts` ────────────────────────────────
// Era nato `.ts`: Node ≥22.18 toglie i tipi da solo ed esbuild li compila gratis,
// quindi in locale girava. **Ma il prodotto dichiara `engines: node >=16` e la CI
// gira su 18.x e 20.x**, dove il loader CommonJS non conosce l'estensione `.ts` e
// la manda al gestore `.js`: il file viene letto come JavaScript e i tipi sono un
// SyntaxError. Un sorgente `.ts` avrebbe quindi alzato il Node minimo di un
// prodotto self-hosted — un prezzo che nessuno ha chiesto di pagare.
// Non si è perso niente se non l'estensione: `tsc` controlla i tipi esattamente
// come prima (questo file è nella lista `include` del `tsconfig`), e in più un
// `.js` lo coprono anche ESLint e `npm run check`, che un `.ts` non coprivano.
// La guardia che impedisce il ritorno è `test/ts-gate.test.js`.
//
// ── Dove stanno i tipi ────────────────────────────────────────────────────
// `Fact<T>`, `FactOrigin`, `AgeTier`, `AgeScale` e `Staleness` sono dichiarati in
// `lib/types.d.ts`, dove il repo tiene i tipi di dominio CONDIVISI — non qui.
// Il motivo è pratico: li usa anche `lib/inter-site.js`, e un `@typedef` scritto
// dentro un modulo non è visibile agli altri file. La spiegazione di cosa
// significano sta lì, accanto alla dichiarazione, dove la trova chi legge il tipo.

(function () {
  'use strict';

  const HOUR = 3600e3;
  const DAY = 864e5;

  /**
   * Le scale d'età note. Non è un catalogo aperto: ogni voce deve corrispondere
   * a un motore reale che quelle soglie le usa davvero.
   *
   * `proof` — le soglie di `lib/proof.js` (FRESH_H 6h · STALE_D 7g · EXPIRE_D 30g),
   * l'unica rampa d'età con una spec scritta. Sono RIPETUTE qui, e una ripetizione
   * in questo progetto è un debito: la guardia che la tiene onesta è in
   * `test/provenance.test.js`, che confronta questi numeri con quelli esportati da
   * `proof.js` e diventa rossa se divergono. Stesso cricchetto delle 3 copie
   * dell'hex del colore cavo. Non si importa `proof.js` perché questo modulo è
   * zero-dip di proposito: è la fondazione, non può dipendere da chi la userà.
   *
   * ⚠️ `temporal-confidence.js` (30g/60g) NON è qui: misura un'altra domanda
   *    (vedi l'intestazione). Entrerà quando 2B unificherà la lingua al bordo,
   *    non prima — registrarla ora senza un consumatore sarebbe make-work.
   */
  /** @type {{proof: AgeScale}} */
  const AGE_SCALES = {
    proof: { freshMs: 6 * HOUR, staleMs: 7 * DAY, expireMs: 30 * DAY },
  };

  /** @type {Record<string, 1>} */
  const _ORIGINS = { declared: 1, measured: 1, derived: 1 };

  /**
   * ISO normalizzato di un istante, o `''` se non è databile.
   * ⚠️ NON ripiega su `Date.now()`: timbrare l'ora corrente su una misura di cui
   * non conosciamo l'istante sarebbe un'invenzione (paletto ②), e a valle nessuno
   * la distinguerebbe da una lettura fresca. Meglio dire «non datato».
   */
  /** @param {string|number|Date|null|undefined} at @returns {string} */
  function _iso(at) {
    if (at == null || at === '') return '';
    const ms = (at instanceof Date) ? at.getTime()
      : (typeof at === 'number') ? at
        : Date.parse(String(at));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  }

  /** @param {number|null} [now] @returns {number} */
  function _now(now) {
    return (now != null && Number.isFinite(+now)) ? +now : Date.now();
  }

  // --- Costruttori ----------------------------------------------------------

  /** Un valore scritto da una persona (o importato come intended-state). */
  /** @template T @param {T} value @returns {Fact<T>} */
  function factDeclared(value) {
    return { origin: 'declared', value };
  }

  /**
   * Un valore letto da un apparato all'istante `at`.
   * Un `at` illeggibile NON blocca il fatto (la lettura è avvenuta davvero) ma
   * lo lascia `at:''` → `factStaleness` lo dirà `undated`, visibile a valle.
   */
  /** @template T @param {T} value @param {string|number|Date|null|undefined} at @returns {Fact<T>} */
  function factMeasured(value, at) {
    return { origin: 'measured', value, at: _iso(at) };
  }

  /** Un valore calcolato da altro; `from` nomina la sorgente del calcolo. */
  /** @template T @param {T} value @param {string} from @returns {Fact<T>} */
  function factDerived(value, from) {
    return { origin: 'derived', value, from: String(from == null ? '' : from) };
  }

  // --- Lettori --------------------------------------------------------------

  /**
   * È un envelope? Type guard.
   * Severo di proposito: un valore nudo NON è un fatto e non viene promosso a
   * `declared` per comodità. Un ripiego del genere sarebbe un'AFFERMAZIONE —
   * direbbe «l'ha dichiarato qualcuno» di un dato che non sappiamo da dove venga.
   */
  /** @param {unknown} x @returns {boolean} */
  function isFact(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
    /** @type {{origin?: unknown}} */
    const o = /** @type {any} */ (x);
    return typeof o.origin === 'string' && _ORIGINS[o.origin] === 1;
  }

  /** L'asse di un fatto, o `null` se non è un fatto. */
  /** @param {unknown} f @returns {FactOrigin|null} */
  function factOrigin(f) {
    return isFact(f) ? /** @type {Fact<unknown>} */ (f).origin : null;
  }

  /** Il valore dentro l'envelope; `undefined` se non è un fatto. */
  /** @template T @param {Fact<T>|unknown} f @returns {T|undefined} */
  function factValue(f) {
    return isFact(f) ? /** @type {Fact<T>} */ (f).value : undefined;
  }

  /** L'istante della misura (ISO), o `null`: solo un misurato datato ne ha uno. */
  /** @param {unknown} f @returns {string|null} */
  function factAt(f) {
    if (!isFact(f)) return null;
    const fact = /** @type {Fact<unknown>} */ (f);
    return (fact.origin === 'measured' && fact.at) ? fact.at : null;
  }

  /** È una misura? (a prescindere dal fatto che sia datata) */
  /** @param {unknown} f @returns {boolean} */
  function factIsMeasured(f) {
    return factOrigin(f) === 'measured';
  }

  /**
   * Età in ms di un fatto, o `null` se non è databile.
   * Un `at` nel futuro (clock skew) vale 0, non un'età negativa — stessa scelta
   * già fatta in `proof.js`.
   */
  /** @param {unknown} f @param {number|null} [now] @returns {number|null} */
  function factAgeMs(f, now) {
    const at = factAt(f);
    if (!at) return null;
    const t = Date.parse(at);
    return Number.isFinite(t) ? Math.max(0, _now(now) - t) : null;
  }

  /**
   * Quanto è vecchio un fatto, nella scala data.
   * `scale` è OBBLIGATORIA: non esiste una scala giusta per tutti (vedi
   * l'intestazione), e un default silenzioso qui sarebbe il ripiego peggiore.
   */
  /** @param {unknown} f @param {AgeScale} scale @param {number|null} [now] @returns {Staleness} */
  function factStaleness(f, scale, now) {
    const ageMs = factAgeMs(f, now);
    if (ageMs == null || !scale) {
      return { tier: 'undated', ageMs: null, ageDays: null, dated: false };
    }
    /** @type {AgeTier} */
    const tier =
      (ageMs <= scale.freshMs) ? 'fresh'
        : (ageMs <= scale.staleMs) ? 'aging'
          : (ageMs <= scale.expireMs) ? 'stale'
            : 'expired';
    return {
      tier,
      ageMs,
      ageDays: Math.round((ageMs / DAY) * 10) / 10,
      dated: true,
    };
  }

  const api = {
    // costruttori
    factDeclared, factMeasured, factDerived,
    // lettori
    isFact, factOrigin, factValue, factAt, factIsMeasured,
    // età
    factAgeMs, factStaleness, AGE_SCALES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})();
