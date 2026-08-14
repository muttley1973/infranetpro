// ============================================================
// PORT-STATE — quanto e' «spenta» una porta, in una parola sola
// (UMD-lite, browser + Node · puro · lingua-indipendente · vendor-neutral)
// ============================================================
// Il rack ha quattro colori per le porte (verde/rosso/ambra/grigio) e il grigio
// raccontava tre storie diverse: «l'ho misurata giu'», «non l'ho mai misurata» e
// «e' vuota». La piu' importante — qualcuno l'ha chiusa APPOSTA — non si vedeva
// affatto, perche' `ifAdminStatus` non veniva nemmeno letto: c'era solo
// `ifOperStatus`, che risponde a un'altra domanda.
//
// Qui si separano i due fatti, e la differenza conta:
//   · admin down = una DECISIONE, scritta sull'apparato da una persona;
//   · oper down  = un SINTOMO (device spento, NIC morta, SFP sfilato, cavo tolto
//                  — non sappiamo quale).
// Il primo e' piu' forte del secondo, e nel rack diventano una scala MONOCROMA
// (quasi nero → grigio scuro → grigio) invece di nuovi colori: verde, rosso e
// ambra dicono gia' altro, e una quinta tinta li avrebbe fatti litigare.
//
// La regola vive qui e non nei due renderer (frontale generato + skin vettoriale)
// perche' una skin non puo' raccontare una verita' diversa dal disegno accanto:
// e' la classe di bug che ci costa di piu' — lo stesso concetto in due strati che
// col tempo divergono.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Verifiche consecutive con la porta giu' prima di crederci — anti-flap: un blip
  // non e' un fatto. UNICO punto di verita': la stessa soglia la usa la regola del
  // «cavo fantasma» (lib/drift-report.js, via `opts.downStreakN`). Un numero uguale
  // scritto in due posti prima o poi diventa diverso.
  const DOWN_STREAK_N = 3;

  // portShade(pi, n) -> 'shut' | 'no-link' | null
  //
  //   'shut'    — ifAdminStatus = down: spenta a mano. Batte 'no-link' perche' una
  //               porta in `shutdown` e' ovviamente anche senza link: dirlo sarebbe
  //               vero e inutile.
  //   'no-link' — nessun link da >= n verifiche consecutive.
  //   null      — non risulta niente. Che NON vuol dire «accesa»: un agente che non
  //               espone ifAdminStatus non sta dicendo che la porta e' su, non sta
  //               dicendo niente. Per questo `adminDown` si confronta con `=== true`
  //               e non per verita'/falsita' del campo.
  //
  // Entrano SOLO misure: `adminDown` (scritto dal solo poll SNMP) e `downStreak`
  // (accumulato in app-drift per le sole porte con `ifName` su nodi che hanno
  // RISPOSTO — senza quel doppio cancello sarebbe un'opinione). `status` NO: quel
  // campo ha tre scrittori con tre significati (l'utente che tira un cavo, l'import
  // DCIM, il poll), quindi non e' una misura.
  //
  // MANUAL-FIRST: se l'utente ha dichiarato lo stato della porta (`statusOvr`), il
  // LED e' suo e nessuna misura glielo riscrive sotto. Non e' nascondere la
  // contraddizione: e' che il posto dove si discutono dichiarato-contro-misurato e'
  // la Verifica, non un pixel da 7 px.
  function portShade(pi, n) {
    if (!pi || typeof pi !== 'object') return null;
    if (pi.statusOvr != null) return null;
    if (pi.adminDown === true) return 'shut';
    const N = Math.max(1, Number.isFinite(+n) ? +n : DOWN_STREAK_N);
    return ((Number(pi.downStreak) || 0) >= N) ? 'no-link' : null;
  }

  // forgetPortMeasure(pi) — la SCADENZA delle due misure, gemella di portShade().
  //
  // Le scrive solo un poll RIUSCITO: `adminDown` in app-snmp, `downStreak` in
  // app-drift. Quando lo switch smette di rispondere nessuno le tocca piu', e una
  // porta continuerebbe a dirsi «spenta a mano» sulla fede di una lettura vecchia di
  // settimane — un nero che non scade. Un'affermazione forte non puo' sopravvivere
  // alla prova che la reggeva: se non lo sappiamo piu', si torna al grigio neutro
  // («non risulta»), che e' esattamente cio' che sappiamo.
  //
  // Le due si dimenticano INSIEME perche' hanno la stessa fonte e la stessa data di
  // scadenza; separarle vorrebbe dire due regole che col tempo divergono.
  // Muta il record in loco (e' un campo di stato del progetto, non un valore puro):
  // ritorna true se qualcosa e' stato dimenticato davvero.
  function forgetPortMeasure(pi) {
    if (!pi || typeof pi !== 'object') return false;
    let forgotten = false;
    if (pi.downStreak) { pi.downStreak = 0; forgotten = true; }
    if (Object.prototype.hasOwnProperty.call(pi, 'adminDown')) { delete pi.adminDown; forgotten = true; }
    return forgotten;
  }

  return { DOWN_STREAK_N, portShade, forgetPortMeasure };
});
