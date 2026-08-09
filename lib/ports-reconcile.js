// ============================================================
// PORTS RECONCILE — conteggio porte dichiarato vs misura SNMP (puro)
// ============================================================
// Il numero di porte di un apparato ha DUE fonti: quello che hai DICHIARATO a mano
// (il layout che disegni) e quello che l'SNMP MISURA (il numero di interfacce che
// il device espone). Storicamente la misura, se piu' alta del dichiarato, alzava
// `n.ports` in silenzio: additivo, quindi in apparenza innocuo, ma un 24 diventato
// 28 senza che nessuno lo dica non e' piu' il numero che hai scritto — e la
// Panoramica lo conta come denominatore «dichiarato».
//
// Manual-first (gemello di ip6Manual/ip6Real, hostnameManual, typeManual):
//   • SENZA pin (`portsManual` assente) → comportamento storico: la misura piu'
//     alta ALZA `n.ports`, e il valore dichiarato finisce in ombra in `portsReal`
//     (il pannello lo segnala come «avevi dichiarato N»). Una sostituzione hardware
//     vera resta cosi' rappresentabile senza gesti.
//   • CON pin (`portsManual` true) → il conteggio dichiarato e' LEGGE: `n.ports`
//     NON si alza. La misura piu' alta diventa una PROPOSTA in `portsMeasured`
//     (gemello di `ip6Real`): il pannello mostra «SNMP ha rilevato N — Adotta
//     porte rilevate» e sei tu a decidere. Nessun campo tri-valore nuovo: si
//     riusa il pattern esistente (`ports` effettivo + un campo-ombra dedicato).
//
// Invariante d'onesta' condiviso ai due rami: **mai ridurre** su walk parziale —
// si agisce solo quando la misura SUPERA il dichiarato (una risposta SNMP che
// vede meno interfacce non cancella porte che hai documentato).
//
// `portsReal` e `portsMeasured` sono volutamente DUE campi distinti con significati
// opposti (ombra-del-dichiarato non-pinnato ↔ misura-non-adottata pinnato), per
// non sovraccaricare un solo campo di due sensi (anti definizioni-duplicate).
//
// Puro: nessun DOM, nessun IO, nessun accesso a store/window. Ritorna un delta
// {ports, portsReal, portsMeasured} (con `null` = «cancella il campo») oppure
// `null` = «nessuna misura, non toccare il nodo». Il chiamante lo applica.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Riconcilia il conteggio porte dichiarato con la misura SNMP.
  //   declared : n.ports attuale (0/undefined = non dichiarato)
  //   measured : numero di interfacce fisiche misurate dall'SNMP
  //   pinned   : !!n.portsManual (conteggio fissato a mano)
  // → { ports, portsReal, portsMeasured } dove null = cancella il campo,
  //   oppure null quando non c'e' misura (il nodo resta intatto).
  function reconcilePortCount(opts) {
    const declared = (opts && opts.declared) | 0;
    const measured = (opts && opts.measured) | 0;
    const pinned = !!(opts && opts.pinned);
    if (!(measured > 0)) return null;            // nessuna misura utile → non toccare
    if (pinned) {
      // Conteggio dichiarato = legge: tieni `ports`, la misura piu' alta e' proposta.
      return { ports: declared, portsReal: null, portsMeasured: (measured > declared ? measured : null) };
    }
    // Non pinnato = comportamento storico: alza il conteggio, ombra del dichiarato.
    return {
      ports: (measured > declared ? measured : declared),
      portsReal: (measured > declared && declared ? declared : null),
      portsMeasured: null
    };
  }

  return { reconcilePortCount };
});
