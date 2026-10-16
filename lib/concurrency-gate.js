'use strict';
// ============================================================
// CONCURRENCY GATE — quanti lavori pesanti alla volta, e quanti in coda (Node, puro)
// ============================================================
// Un confronto bcrypt a costo 12 vale ~340 ms di CPU (misurati). `bcrypt.compare` è asincrono e
// cede il controllo fra una fetta e l'altra, quindi UN login non ferma il server — ma il
// costo in CPU resta, e si SOMMA: cento login in volo sono ~34 secondi di lavoro che il
// processo (uno solo, JavaScript a un filo) deve fare prima di rispondere a qualunque altra
// richiesta, anche del monitoraggio, anche di chi è già dentro. Il limite per IP (15 min,
// 100 tentativi) non basta: calcola il budget di un indirizzo, non quanti arrivano NELLO
// STESSO istante, e chi ha più indirizzi (o dietro un proxy che li nasconde) non lo vede.
//
// Il cancello fa tre cose, in quest'ordine:
//   1. fino a `max` lavori partono subito;
//   2. gli altri aspettano in coda, al più `queue` e al più `waitMs`;
//   3. oltre, si dice NO subito (`acquire()` → null): rifiutare costa nulla, accettare e
//      poi non riuscire a servire costa a tutti. Chi chiama risponde 503 con `Retry-After`.
//
// Perché una coda e non solo un tetto: un picco breve (un ufficio che apre alle 9:00) deve
// passare, solo un po' più lento; il rifiuto serve per il flusso che NON finisce.
// ============================================================

function createGate(opts) {
  const o = opts || {};
  const max = Math.max(1, Number.isFinite(o.max) ? Math.floor(o.max) : 2);
  const queue = Math.max(0, Number.isFinite(o.queue) ? Math.floor(o.queue) : 8);
  const waitMs = Math.max(0, Number.isFinite(o.waitMs) ? o.waitMs : 5000);

  let active = 0;
  const waiting = [];   // { resolve, timer }
  let rejected = 0;

  function _release() {
    active--;
    _pump();
  }
  function _pump() {
    while (active < max && waiting.length) {
      const w = waiting.shift();
      if (w.timer) clearTimeout(w.timer);
      active++;
      w.resolve(_makeRelease());
    }
  }
  function _makeRelease() {
    let done = false;
    return () => { if (done) return; done = true; _release(); };   // idempotente: un doppio release non libera due posti
  }

  /**
   * @returns {Promise<Function>|null} una funzione `release()` da chiamare a lavoro finito
   *   (nel `finally`), oppure null se il cancello è saturo. Il null può arrivare subito
   *   (coda piena) o dopo `waitMs` (la coda non si è mossa in tempo).
   */
  function acquire() {
    if (active < max) { active++; return Promise.resolve(_makeRelease()); }
    if (waiting.length >= queue) { rejected++; return Promise.resolve(null); }
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      if (waitMs > 0) {
        w.timer = setTimeout(() => {
          const i = waiting.indexOf(w);
          if (i >= 0) { waiting.splice(i, 1); rejected++; resolve(null); }
        }, waitMs);
      }
      waiting.push(w);
    });
  }

  function stats() { return { active, waiting: waiting.length, rejected, max, queue, waitMs }; }

  return { acquire, stats };
}

module.exports = { createGate };
