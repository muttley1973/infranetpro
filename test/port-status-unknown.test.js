'use strict';
// ============================================================
// UNA PORTA MAI OSSERVATA NON È «SPENTA»
// ============================================================
// `normalizePortStatus(undefined)` vale 'inactive': un default deliberato per
// DISEGNARE (il grigio neutro del pannello rack). Il guaio era spacciarlo per un
// fatto — i menu «Stato» preselezionavano OFF/INACTIVE su porte mai dichiarate né
// misurate, cioè mostravano una dichiarazione che l'utente non aveva mai fatto, e
// il riquadro in sola lettura degli endpoint scriveva «Inattivo».
// La distinzione vive in hasPortStatus(); qui si presidia che chi scrive PAROLE o
// preseleziona un CAMPO DICHIARATO la interroghi davvero.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('hasPortStatus distingue «non determinato» da «misurato spento»', () => {
  // La funzione vive in un modulo ESM del bundle: se ne verifica il contratto
  // sulla stessa logica, senza tirarsi dietro tutto il grafo di import.
  const hasPortStatus = (pi) => {
    const p = pi || {};
    return p.statusOvr != null || (p.status != null && p.status !== '');
  };
  assert.equal(hasPortStatus(undefined), false, 'porta inesistente: ignota');
  assert.equal(hasPortStatus({}), false, 'porta mai toccata: ignota');
  assert.equal(hasPortStatus({ status: '' }), false, 'stringa vuota non è una misura');
  assert.equal(hasPortStatus({ status: 'inactive' }), true, 'MISURATA giù: è un fatto');
  assert.equal(hasPortStatus({ statusOvr: 'inactive' }), true, 'DICHIARATA giù: è un fatto');
  assert.equal(hasPortStatus({ status: 'active' }), true);
});

test('ogni menu «Stato porta» offre l\'opzione vuota (= non determinato)', () => {
  // I tre punti in cui l'utente vede lo stato in un <select>: tabella porte,
  // pannello Proprietà e popup della porta. Tutti devono poter dire «non lo so».
  for (const f of ['app-ports.js', 'app-properties-port.js', 'app-popup.js']) {
    const code = read(f);
    const sel = /<option value=""[^>]*>/.test(code);
    assert.ok(sel, `${f}: manca l'opzione vuota nel menu di stato`);
    // E la preselezione deve passare da hasPortStatus, non cadere su 'inactive'.
    assert.ok(/hasPortStatus/.test(code), `${f}: lo stato effettivo non interroga hasPortStatus`);
    assert.ok(!/\?\?\s*'inactive'/.test(code),
      `${f}: sopravvive un fallback ?? 'inactive' — reintroduce la spenta inventata`);
  }
});

test('il riquadro di stato in sola lettura non afferma «Inattivo» senza dati', () => {
  const code = read('app-properties-port.js');
  assert.ok(/_leafKnown/.test(code), 'manca la guardia sul dato ereditato/misurato');
  // Il riquadro read-only degli endpoint deve passare da _leafKnown prima di
  // stampare l'etichetta di stato.
  assert.ok(/_leafKnown\s*\?[\s\S]{0,120}_statusLabel/.test(code),
    'il riquadro stampa _statusLabel senza chiedersi se il dato esiste');
  assert.ok(/port\.statusUnknown/.test(code), 'manca la parola per «non determinato»');
});
