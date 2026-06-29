'use strict';
// ============================================================
//  lib/onboarding.js — copilota di onboarding: il «prossimo passo» (spec §4d).
//
//  PURO (zero DOM/IO, ADR D4). «InfraNet calcola, l'AI racconta»: qui InfraNet
//  CALCOLA, da un riassunto compatto dello stato progetto, qual è il passo più
//  utile da fare ORA — con REGOLE DETERMINISTICHE, non con il modello. La UI lo
//  mostra come chip «prossimo passo» (testo i18n + azione); l'assistente lo può
//  raccontare. Manual-first assoluto: il chip GUIDA (illumina il bottone vero o
//  semina una domanda), non applica mai nulla da solo.
//
//  Input `summary` (costruito client-side da src/app-ai.js, tutto opzionale):
//    { devices, withIp, snmp, vlans, verified,
//      drift: { absent, undocumented, ipChanged },   // conteggi dal Drift vivo
//      gaps:  { noSubnet, noGateway } }               // conteggi dai buchi IPAM
//
//  Output `nextStep(summary)`:
//    { id, target, askKey, data }
//      id      = chiave i18n del messaggio (onboard.<id>) + identità del passo
//      target  = selettore CSS del bottone REALE da illuminare (spotlight) | null
//      askKey  = chiave i18n della domanda da seminare nell'assistente | null
//      data    = variabili per l'interpolazione i18n (conteggi)
//  La UI mostra «Mostrami» (spotlight target) se c'è target, altrimenti «Chiedi»
//  (semina askKey) se c'è askKey; `allGood`/`empty`→`discover` non hanno askKey.
//
//  Convenzione UMD-lite: <script> in netmapper.html (assegna a window) PRIMA del
//  bundle → il glue lo usa come global bare; in Node (test) lo si require().
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Conteggio robusto: numero finito ≥0, qualsiasi altra cosa → 0.
  function _num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Costruttore del passo (forma stabile, valori normalizzati).
  function _step(id, target, askKey, data) {
    return { id, target: target || null, askKey: askKey || null, data: data || {} };
  }

  // Il cuore: dato il riassunto dello stato progetto, il passo più utile ORA.
  // Priorità = il «viaggio» di onboarding (spec §4d): tela vuota → scopri →
  // verifica → semina i buchi (subnet/gateway) → adotta i non-doc → manutieni.
  // Ordine deterministico: la prima regola che scatta vince.
  function nextStep(summary) {
    const s = (summary && typeof summary === 'object') ? summary : {};
    const devices = _num(s.devices);
    const verified = !!s.verified;
    const d = (s.drift && typeof s.drift === 'object') ? s.drift : {};
    const g = (s.gaps && typeof s.gaps === 'object') ? s.gaps : {};

    // 1) Rete vuota → parti dalla scoperta (bottone reale «Scopri»).
    if (devices <= 0) return _step('discover', '#btn-discover', null, {});

    // 2) Documentata ma mai verificata → lancia «Verifica».
    if (!verified) return _step('verify', '#btn-drift', null, { devices });

    // 3) VLAN senza subnet → l'IPAM è cieco lì: dichiara la subnet.
    if (_num(g.noSubnet) > 0) return _step('vlanSubnet', null, 'onboard.askVlanSubnet', { n: _num(g.noSubnet) });

    // 4) VLAN senza gateway → manca il default gateway.
    if (_num(g.noGateway) > 0) return _step('vlanGateway', null, 'onboard.askVlanGateway', { n: _num(g.noGateway) });

    // 5) Non-documentati visti dalla Verifica → proponi l'adozione.
    if (_num(d.undocumented) > 0) return _step('adopt', null, 'onboard.askAdopt', { n: _num(d.undocumented) });

    // 6) Device documentati ma ASSENTI dall'ultima Verifica.
    if (_num(d.absent) > 0) return _step('absent', null, 'onboard.askAbsent', { n: _num(d.absent) });

    // 7) Cambi IP da riconciliare.
    if (_num(d.ipChanged) > 0) return _step('ipChanged', null, 'onboard.askIpChanged', { n: _num(d.ipChanged) });

    // 8) Tutto in ordine: documentata e verificata, nessun buco aperto.
    return _step('allGood', null, null, {});
  }

  return { nextStep, _num, _step };
});
