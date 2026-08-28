// ============================================================
// PROVENANCE — l'envelope: «questo valore, come facciamo a saperlo»
// (UMD-lite, Node + browser-VIA-BUNDLE · zero-dip · lingua-indipendente · puro)
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
// ── Nota sul `.ts` (è il primo modulo TypeScript vero del repo) ────────────
// I tipi qui sono AMBIENT-GLOBALI (file script, niente import/export al top
// level) come in `lib/types.d.ts`: `lib/inter-site.ts` usa `Fact<T>` senza
// importarlo. A runtime non cambia nulla — `node --test` fa type-stripping
// nativo (Node ≥22.18) ed esbuild lo compila gratis.
// ⚠️ UN VINCOLO VERO: un `.ts` NON può essere caricato da `<script src>`. I
//    moduli `lib/*.js` oggi arrivano al browser in due modi (script tag in
//    netmapper.html *oppure* import dal bundle `src/`); un `.ts` ha solo il
//    secondo. È coerente con la migrazione strangler — il codice nuovo passa
//    dal bundle — ma va saputo prima, non scoperto a schermo.
// ⚠️ Un `.ts` esce anche dal gate `eslint` (nessuna config lo aggancia) e da
//    `npm run check`. La guardia è `test/ts-gate.test.js`: rossa se un `.ts`
//    sotto `lib/` non è nel `tsconfig.json`, così non può esistere un sorgente
//    che non è controllato da NESSUN cancello.

/** I tre assi della provenienza. Chiusi di proposito. */
type FactOrigin = 'declared' | 'measured' | 'derived';

/**
 * Un valore con la sua provenienza. Discriminated union su `origin`: il
 * compilatore garantisce che `at` esista SOLO su un misurato e `from` SOLO su
 * un derivato — non c'è modo di leggere una data da una dichiarazione.
 */
type Fact<T> =
  | { origin: 'declared'; value: T }
  | { origin: 'measured'; value: T; at: string }
  | { origin: 'derived'; value: T; from: string };

/**
 * Quanto è vecchia una misura, detto a parole.
 * `undated` è la parola già in uso in `temporal-confidence.js` per «visto, ma
 * non si sa quando»: qui copre anche il dichiarato e il derivato, che non hanno
 * una data *per costruzione* — non è ignoranza, è che la domanda non si applica.
 */
type AgeTier = 'fresh' | 'aging' | 'stale' | 'expired' | 'undated';

/** Le soglie di una scala d'età. Vedi `AGE_SCALES`: si passa, non si assume. */
interface AgeScale {
  freshMs: number;
  staleMs: number;
  expireMs: number;
}

/** L'esito di `factStaleness`. `dated:false` ⇒ tier `undated`, età null. */
interface Staleness {
  tier: AgeTier;
  ageMs: number | null;
  ageDays: number | null;
  dated: boolean;
}

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
  const AGE_SCALES: { proof: AgeScale } = {
    proof: { freshMs: 6 * HOUR, staleMs: 7 * DAY, expireMs: 30 * DAY },
  };

  const _ORIGINS: Record<string, 1> = { declared: 1, measured: 1, derived: 1 };

  /**
   * ISO normalizzato di un istante, o `''` se non è databile.
   * ⚠️ NON ripiega su `Date.now()`: timbrare l'ora corrente su una misura di cui
   * non conosciamo l'istante sarebbe un'invenzione (paletto ②), e a valle nessuno
   * la distinguerebbe da una lettura fresca. Meglio dire «non datato».
   */
  function _iso(at: string | number | Date | null | undefined): string {
    if (at == null || at === '') return '';
    const ms = (at instanceof Date) ? at.getTime()
      : (typeof at === 'number') ? at
        : Date.parse(String(at));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  }

  function _now(now?: number | null): number {
    return (now != null && Number.isFinite(+now)) ? +now : Date.now();
  }

  // --- Costruttori ----------------------------------------------------------

  /** Un valore scritto da una persona (o importato come intended-state). */
  function factDeclared<T>(value: T): Fact<T> {
    return { origin: 'declared', value };
  }

  /**
   * Un valore letto da un apparato all'istante `at`.
   * Un `at` illeggibile NON blocca il fatto (la lettura è avvenuta davvero) ma
   * lo lascia `at:''` → `factStaleness` lo dirà `undated`, visibile a valle.
   */
  function factMeasured<T>(value: T, at: string | number | Date | null | undefined): Fact<T> {
    return { origin: 'measured', value, at: _iso(at) };
  }

  /** Un valore calcolato da altro; `from` nomina la sorgente del calcolo. */
  function factDerived<T>(value: T, from: string): Fact<T> {
    return { origin: 'derived', value, from: String(from == null ? '' : from) };
  }

  // --- Lettori --------------------------------------------------------------

  /**
   * È un envelope? Type guard.
   * Severo di proposito: un valore nudo NON è un fatto e non viene promosso a
   * `declared` per comodità. Un ripiego del genere sarebbe un'AFFERMAZIONE —
   * direbbe «l'ha dichiarato qualcuno» di un dato che non sappiamo da dove venga.
   */
  function isFact(x: unknown): x is Fact<unknown> {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
    const o = x as { origin?: unknown };
    return typeof o.origin === 'string' && _ORIGINS[o.origin] === 1;
  }

  /** L'asse di un fatto, o `null` se non è un fatto. */
  function factOrigin(f: unknown): FactOrigin | null {
    return isFact(f) ? (f as Fact<unknown>).origin : null;
  }

  /** Il valore dentro l'envelope; `undefined` se non è un fatto. */
  function factValue<T>(f: Fact<T> | unknown): T | undefined {
    return isFact(f) ? ((f as Fact<T>).value) : undefined;
  }

  /** L'istante della misura (ISO), o `null`: solo un misurato datato ne ha uno. */
  function factAt(f: unknown): string | null {
    if (!isFact(f)) return null;
    const fact = f as Fact<unknown>;
    return (fact.origin === 'measured' && fact.at) ? fact.at : null;
  }

  /** È una misura? (a prescindere dal fatto che sia datata) */
  function factIsMeasured(f: unknown): boolean {
    return factOrigin(f) === 'measured';
  }

  /**
   * Età in ms di un fatto, o `null` se non è databile.
   * Un `at` nel futuro (clock skew) vale 0, non un'età negativa — stessa scelta
   * già fatta in `proof.js`.
   */
  function factAgeMs(f: unknown, now?: number | null): number | null {
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
  function factStaleness(f: unknown, scale: AgeScale, now?: number | null): Staleness {
    const ageMs = factAgeMs(f, now);
    if (ageMs == null || !scale) {
      return { tier: 'undated', ageMs: null, ageDays: null, dated: false };
    }
    const tier: AgeTier =
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
