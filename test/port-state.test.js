'use strict';
// ============================================================
// PORT-STATE — test della misura di porta (lib/port-state.js).
// Il punto della lib è che il grigio del LED raccontava tre storie diverse, e
// quella più importante non si vedeva affatto. Le invarianti da difendere sono
// quindi tutte sul CONFINE fra «misurato» e «non risulta»:
//   * `null` vuol dire NON RISULTA, mai «accesa»: un agente che non espone
//     ifAdminStatus non sta dicendo niente, e chi disegna deve poterlo distinguere;
//   * 'shut' batte 'no-link' — una porta in `shutdown` è ovviamente anche senza
//     link: dirlo sarebbe vero e inutile;
//   * la soglia anti-flap è >= N, non > N, e un N degenere non fa maturare tutto;
//   * manual-first: `statusOvr` (la parola dell'utente) spegne la misura nel
//     disegno — la contraddizione si discute nella Verifica, non in 7 px.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { DOWN_STREAK_N, portShade } = require('../lib/port-state.js');

test('soglia: DOWN_STREAK_N è la stessa del «cavo fantasma» (3)', () => {
  assert.equal(DOWN_STREAK_N, 3);
});

// ---- «non risulta» non è «accesa» ----------------------------------------
test('porta senza misure -> null (non risulta), non una porta sana', () => {
  assert.equal(portShade({}, DOWN_STREAK_N), null);
  assert.equal(portShade({ status: 'active', ifName: 'Gi0/1' }, DOWN_STREAK_N), null);
});

test('adminDown assente (agente che non espone ifAdminStatus) -> mai «shut»', () => {
  // Il caso reale: MIB non implementata o walk troncata. Il driver emette 0, il
  // client NON scrive il campo → qui non deve nascere una misura dal nulla.
  assert.equal(portShade({ adminDown: undefined }, DOWN_STREAK_N), null);
  assert.equal(portShade({ adminDown: false }, DOWN_STREAK_N), null);
});

test('input degeneri non inventano una misura', () => {
  assert.equal(portShade(null, DOWN_STREAK_N), null);
  assert.equal(portShade(undefined, DOWN_STREAK_N), null);
  assert.equal(portShade('Gi0/1', DOWN_STREAK_N), null);
});

// ---- shut ----------------------------------------------------------------
test('adminDown -> «shut»', () => {
  assert.equal(portShade({ adminDown: true }, DOWN_STREAK_N), 'shut');
});

test('«shut» batte «no-link»: una porta spenta a mano è ovviamente anche senza link', () => {
  assert.equal(portShade({ adminDown: true, downStreak: 12 }, DOWN_STREAK_N), 'shut');
});

// ---- no-link: soglia e anti-flap -----------------------------------------
test('no-link: uno streak sotto soglia è un blip, non un fatto', () => {
  assert.equal(portShade({ downStreak: 2 }, 3), null);
});

test('no-link: la soglia è >= N (matura ESATTAMENTE a N, non a N+1)', () => {
  assert.equal(portShade({ downStreak: 3 }, 3), 'no-link');
  assert.equal(portShade({ downStreak: 9 }, 3), 'no-link');
});

test('no-link: N degenere è clampato a 1 (uno streak 0 non fa maturare TUTTE le porte)', () => {
  // Stessa guardia di lib/drift-report.js: con N=0 ogni `0 >= 0` sarebbe vero, e
  // un rack intero diventerebbe grigio scuro per un input degenere.
  assert.equal(portShade({ downStreak: 0 }, 0), null);
  assert.equal(portShade({}, -5), null);
  assert.equal(portShade({ downStreak: 1 }, 0), 'no-link');
});

test('no-link: N non numerico ricade sulla soglia canonica, non su NaN', () => {
  assert.equal(portShade({ downStreak: 3 }, undefined), 'no-link');
  assert.equal(portShade({ downStreak: 2 }, 'tre'), null);
});

// ---- manual-first --------------------------------------------------------
test('manual-first: se l\'utente ha dichiarato lo stato, il LED è suo', () => {
  assert.equal(portShade({ adminDown: true, statusOvr: 'active' }, DOWN_STREAK_N), null);
  assert.equal(portShade({ downStreak: 5, statusOvr: 'inactive' }, 3), null);
});

test('manual-first: vale anche una dichiarazione che CONCORDA con la misura', () => {
  // Se l'utente ha detto la sua, il disegno è suo comunque — la regola non deve
  // dipendere dal contenuto della dichiarazione, o smette di essere una regola.
  assert.equal(portShade({ adminDown: true, statusOvr: 'inactive' }, DOWN_STREAK_N), null);
});

// ---- purezza -------------------------------------------------------------
test('la lib non muta il record di porta', () => {
  const pi = Object.freeze({ adminDown: true, downStreak: 7, status: 'inactive' });
  assert.equal(portShade(pi, DOWN_STREAK_N), 'shut');
  assert.equal(pi.adminDown, true);
  assert.equal(pi.downStreak, 7);
});

// ============================================================
// SCADENZA DELLE MISURE — forgetPortMeasure()
// ============================================================
// Il «nero che non scade»: `adminDown` lo scrive solo un poll riuscito, quindi se
// lo switch smette di rispondere nessuno lo tocca più e la porta resta spenta per
// sempre sulla fede di una lettura vecchia. Questi test blindano il rimedio — e
// soprattutto la simmetria fra le due misure, che devono dimenticarsi insieme.
const { forgetPortMeasure } = require('../lib/port-state.js');

test('scadenza: il nero si dimentica, non si eterna', () => {
  const pi = { ifName: 'Gi0/3', status: 'active', adminDown: true };
  assert.equal(forgetPortMeasure(pi), true);
  assert.equal('adminDown' in pi, false, 'il campo va TOLTO, non messo a false');
  assert.equal(portShade(pi, DOWN_STREAK_N), null, 'e la porta torna al grigio neutro');
});

test('scadenza: le due misure si dimenticano INSIEME (stessa fonte, stessa scadenza)', () => {
  const pi = { adminDown: true, downStreak: 9 };
  forgetPortMeasure(pi);
  assert.equal('adminDown' in pi, false);
  assert.equal(pi.downStreak, 0);
  assert.equal(portShade(pi, DOWN_STREAK_N), null);
});

test('scadenza: `adminDown` cancellato, non messo a false — «non risulta» ≠ «è su»', () => {
  // Se restasse `false` diremmo «lo switch la dà accesa», che è una misura che non
  // abbiamo. La differenza si vede all'export e in ogni futuro lettore del campo.
  const pi = { adminDown: false };
  forgetPortMeasure(pi);
  assert.equal('adminDown' in pi, false);
});

test('scadenza: non tocca il resto del record di porta', () => {
  const pi = { ifName: 'Gi0/3', status: 'active', vlan: 20, mac: 'aa:bb:cc:dd:ee:ff', adminDown: true, downStreak: 4 };
  forgetPortMeasure(pi);
  assert.deepEqual(pi, { ifName: 'Gi0/3', status: 'active', vlan: 20, mac: 'aa:bb:cc:dd:ee:ff', downStreak: 0 });
});

test('scadenza: niente da dimenticare -> false (il chiamante non sporca il documento)', () => {
  assert.equal(forgetPortMeasure({ ifName: 'Gi0/1', status: 'active' }), false);
  assert.equal(forgetPortMeasure({ downStreak: 0 }), false);
});

test('scadenza: input degeneri non esplodono', () => {
  assert.equal(forgetPortMeasure(null), false);
  assert.equal(forgetPortMeasure(undefined), false);
  assert.equal(forgetPortMeasure('Gi0/1'), false);
});

// ── nextDownStreak: cosa vale come PROVA sul cavo ────────────────────────────
const { nextDownStreak } = require('../lib/port-state.js');

// Regressione dal vivo (2026-08-14): l'utente spegne le porte 1-2 del Zyxel, fa
// qualche Verifica, poi le RIACCENDE — e restano grigio scuro «senza link», come
// se avessimo osservato il cavo mentre la porta era chiusa. Non l'avevamo
// osservato: guardavamo una decisione. Stesso streak alimentava il «fantasma», e
// un cavo dedotto su quella porta spariva dal disegno (35% + tratteggio rado).
test('streak: una porta in shutdown NON accumula (non è una prova sul cavo)', () => {
  assert.equal(nextDownStreak({ adminDown: true, status: 'inactive', downStreak: 7 }), 0);
  assert.equal(nextDownStreak({ adminDown: true, status: 'inactive' }), 0);
});

test('streak: senza link avanza di uno, con link riparte da zero', () => {
  assert.equal(nextDownStreak({ status: 'inactive' }), 1);
  assert.equal(nextDownStreak({ status: 'inactive', downStreak: 2 }), 3);
  assert.equal(nextDownStreak({ status: 'active', downStreak: 9 }), 0);
  assert.equal(nextDownStreak({ status: 'inactive', adminDown: false, downStreak: 1 }), 2,
    'admin UP misurato non blocca il conteggio: lì la porta la stiamo guardando davvero');
});

test('streak: riaperta la porta, il grigio scuro va RI-guadagnato', () => {
  // La porta chiusa non matura; alla riapertura app-snmp azzera lo streak (la
  // transizione true→false), quindi servono N verifiche vere per il «no-link».
  let pi = { adminDown: true, status: 'inactive', downStreak: 0 };
  for (let i = 0; i < 5; i++) pi.downStreak = nextDownStreak(pi);
  assert.equal(pi.downStreak, 0, 'cinque verifiche da spenta non hanno insegnato nulla');
  assert.equal(portShade(pi, DOWN_STREAK_N), 'shut');
  pi.adminDown = false;                                   // riaccesa
  assert.equal(portShade(pi, DOWN_STREAK_N), null, 'torna al grigio neutro, non al grigio scuro');
  pi.downStreak = nextDownStreak(pi); pi.downStreak = nextDownStreak(pi);
  assert.equal(portShade(pi, DOWN_STREAK_N), null, 'a due verifiche non ci si crede ancora');
  pi.downStreak = nextDownStreak(pi);
  assert.equal(portShade(pi, DOWN_STREAK_N), 'no-link', 'alla terza, misurata sul serio');
});

test('streak: input degeneri non esplodono', () => {
  assert.equal(nextDownStreak(null), 0);
  assert.equal(nextDownStreak(undefined), 0);
  assert.equal(nextDownStreak('Gi0/1'), 0);
  assert.equal(nextDownStreak({ status: 'inactive', downStreak: 'tanti' }), 1);
});
