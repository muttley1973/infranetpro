'use strict';
// ============================================================================
// La contraddizione fra i due capi smette di essere solo un colore
// ============================================================================
// Quando i due apparati di un cavo ACCESS dichiarano VLAN diverse con la stessa
// autorità, il modello non ne sceglie una: sceglierne una afferma il falso su
// metà del cavo, e scendere di gradino finirebbe sul pavimento — un numero
// plausibile al posto di una contraddizione vera. Il cavo resta NEUTRO.
//
// ⚠️ Ed è lì che stava il difetto: neutro è anche il trunk, e neutro è anche
// l'instradato. Il caso peggiore che il modello sappia riconoscere — l'unico in
// cui la rete NON funziona — era l'unico senza un nome: nessun reperto
// nell'elenco dei problemi del cavo, nessuna voce in legenda. Si vedeva solo
// aprendo quel cavo e leggendo una riga grigia.
//
// Due cose, quindi, e le prova tutte e due questo file: il pannello lo dice fra
// i PROBLEMI (livello error, come il suo gemello sul trunk `native-mismatch`), e
// la legenda della topologia spiega il neutro anche quando è una contesa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// Due switch (due capi ATTIVI, stessa autorità) e un cavo access fra loro. La
// contesa si crea con due `vlanOvr` diversi: due dichiarazioni a mano, il caso in
// cui nessuno dei due può prevalere sull'altro.
const SCENA = `
  state = _buildDefaultState();
  state.nodes = []; state.links = []; state.ports = {};
  state.ipam = { vlans:{}, prefixes:[], addresses:[] };
  state.vlanNames = {}; state.vlanColors = state.vlanColors || {};
  state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:4 });
  state.nodes.push({ id:'sw2', type:'switch', name:'SW-B', ports:4 });
  state.links.push({ id:'l1', src:'sw1-1', dst:'sw2-1' });
  state.ports['sw1-1'] = { vlanOvr: 20 };
  state.ports['sw2-1'] = { vlanOvr: 30 };
  if(typeof _invalidateIdx==='function') _invalidateIdx();
  propagateVlans();
`;

test('il modello riconosce la contesa e non sceglie', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    ${SCENA}
    const p = _linkPaintVlan(state.links[0]);
    return { kind: p.kind, vlan: p.vlan, ends: (p.ends || []).join(','), known: p.known };
  })()`);
  assert.equal(out.kind, 'conflict');
  assert.equal(out.vlan, null, 'non ne sceglie una: sarebbe falsa su metà del cavo');
  assert.equal(out.known, false);
  assert.equal(out.ends, '20,30', 'e i due numeri escono ORDINATI: lo stesso cavo si legge uguale da tutt\'e due i lati');
});

test('il pannello del cavo la elenca fra i PROBLEMI, non solo nel colore', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    ${SCENA}
    _propsExplicit = true; selType='link'; selId='l1'; renderProps();
    const html = document.getElementById('props-panel').innerHTML || '';
    // I reperti del cavo escono da validateCable → cableIssueTexts: si cerca il
    // TESTO reso, che è l'unica cosa che l'utente legge davvero.
    const titolo = t('cbl.vlan-ends-disagree.t');
    const i = html.indexOf(titolo);
    return {
      c_e: i >= 0,
      // I due numeri devono comparire nella spiegazione: «non concordano» da solo
      // manderebbe a cercare cosa, dove.
      numeri: i >= 0 && html.indexOf('20') >= 0 && html.indexOf('30') >= 0,
      // E il colore resta neutro: il reperto si AGGIUNGE, non sostituisce.
      neutro: _linkPaintLabel(state.links[0]).kind === 'conflict',
    };
  })()`);
  assert.equal(out.c_e, true, 'la contesa compare fra i problemi del cavo');
  assert.equal(out.numeri, true, 'e la riga porta i due numeri');
  assert.equal(out.neutro, true, 'il colore resta quello che era: il reperto si aggiunge');
});

test('la legenda spiega il neutro anche quando è una contesa — e solo se ce n\'è una', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    const voce = () => {
      _renderTopoLegend();
      const el = document.getElementById('topo-legend');
      return (el && el.innerHTML) || '';
    };
    ${SCENA}
    state.vlanColors[20] = '#00d4ff'; state.vlanColors[30] = '#39d353';
    const conContesa = voce();
    // Tolta la contraddizione (i due capi concordano), la voce deve sparire: una
    // legenda che spiega un colore assente insegna a non fidarsi della legenda.
    state.ports['sw2-1'] = { vlanOvr: 20 };
    if(typeof _invalidateLinkColor==='function') _invalidateLinkColor();
    propagateVlans();
    const senza = voce();
    const etichetta = t('legend.conflictLink');
    return { con: conContesa.indexOf(etichetta) >= 0, senza: senza.indexOf(etichetta) >= 0 };
  })()`);
  assert.equal(out.con, true, 'con un cavo conteso la legenda lo nomina');
  assert.equal(out.senza, false, 'senza, la voce non c\'è: niente colori spiegati e assenti');
});
