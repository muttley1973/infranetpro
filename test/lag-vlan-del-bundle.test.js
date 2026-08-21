'use strict';
// ============================================================================
// La VLAN di un LAG si dichiara una volta, sul bundle
// ============================================================================
// Su un apparato vero un Port-channel si configura una volta sola e i membri
// ereditano; membri discordi non aggregano affatto, ed è esattamente ciò che
// `checkLagMembers` avvisa. Prima l'unico modo di dirlo qui era ripeterlo su
// ogni porta — misurato: VLAN 20 su una porta di due lasciava l'altra sul
// pavimento (1) e faceva scattare l'avviso di incoerenza per un lavoro che il
// ferro fa da sé.
//
// La dichiarazione appartiene al bundle e viene scritta su OGNI membro, perché
// nessun altro strato deve imparare che cos'è un LAG — e perché l'avviso deve
// restare RAGGIUNGIBILE: se più tardi qualcuno cambia una porta a mano, quella
// resta una configurazione sbagliata da segnalare, non un dettaglio da nascondere.
//
// ⛔ La strada scartata (fissata qui sotto, così nessuno la riapre per sbaglio):
// far ereditare la VLAN dentro `propagateVlans` a un membro «vuoto». Sarebbe un
// numero scritto su una porta che nessuno ha dichiarato — la classe di difetto
// chiusa in questa stessa versione — e zittirebbe l'avviso.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (lag-vlan)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Uno switch a 4 porte, le prime due in un LAG. `extra` è ciò che si prova.
const scenario = (extra) => `(() => {
  state = _buildDefaultState();
  state.nodes = []; state.links = []; state.ports = {};
  state.nodes.push({ id:'sw', type:'switch', name:'SW', ports:4 });
  state.ports['sw-1'] = { lagGroup:'lgX' };
  state.ports['sw-2'] = { lagGroup:'lgX' };
  state.ports['sw-3'] = {};                       // fuori dal bundle: non si tocca
  state.lagGroups = { lgX:'LAG 1' };
  if(typeof _invalidateIdx==='function') _invalidateIdx();
  ${extra}
  if(typeof _invalidateIdx==='function') _invalidateIdx();
  propagateVlans();
  const pi = (p) => state.ports[p] || {};
  const membri = ['sw-1','sw-2'].map(p => ({ ovr: pi(p).vlanOvr, eff: _effPortVlan(p) }));
  const audit = checkLagMembers(membri.map((m,i) => ({ num:i+1, speed:1000, vlan:m.eff })));
  return {
    ovr:   membri.map(m => m.ovr === undefined ? null : m.ovr),
    eff:   membri.map(m => m.eff),
    fuori: pi('sw-3').vlanOvr === undefined ? null : pi('sw-3').vlanOvr,
    mismatch: audit.vlanMismatch,
    vlans: Array.from(audit.vlans || []),
  };
})()`;

test('dichiarata una volta, arriva a tutti i membri', () => {
  const o = run(APP.ctx, scenario(`setLagVlan('lgX', 20);`));
  assert.deepEqual(Array.from(o.ovr), [20, 20], 'ogni porta del bundle porta la dichiarazione');
  assert.deepEqual(Array.from(o.eff), [20, 20], 'e la VLAN efficace è quella su entrambe');
  assert.equal(o.mismatch, false, 'il bundle è coerente: era il punto');
});

test('una porta fuori dal bundle non viene toccata', () => {
  const o = run(APP.ctx, scenario(`setLagVlan('lgX', 20);`));
  assert.equal(o.fuori, null, 'la porta 3 non è del LAG e resta senza dichiarazione');
});

test('svuotare toglie la dichiarazione, e non ci scrive 1', () => {
  // «nessuna dichiarazione» e «dichiarata VLAN 1» sono due stati diversi: il
  // primo lascia parlare misura, propagazione e pavimento; il secondo li scavalca.
  const o = run(APP.ctx, scenario(`setLagVlan('lgX', 20); setLagVlan('lgX', '');`));
  assert.deepEqual(Array.from(o.ovr), [null, null], 'il campo sparisce invece di valere 1');
  assert.deepEqual(Array.from(o.eff), [1, 1], 'e la VLAN efficace torna al pavimento di sito');
});

test('un valore fuori scala non scrive niente', () => {
  for (const v of ['0', '4095', 'x', '-3']) {
    const o = run(APP.ctx, scenario(`setLagVlan('lgX', 20); setLagVlan('lgX', ${JSON.stringify(v)});`));
    assert.deepEqual(Array.from(o.ovr), [null, null], `«${v}» non è una VLAN: toglie, non scrive`);
  }
  const buono = run(APP.ctx, scenario(`setLagVlan('lgX', '4094');`));
  assert.deepEqual(Array.from(buono.ovr), [4094, 4094], 'il limite alto è ammesso');
});

test('⚠ l’avviso di incoerenza resta RAGGIUNGIBILE dopo una modifica a mano', () => {
  // La ragione per cui la VLAN si scrive sui membri invece di essere ereditata:
  // se il bundle la nascondesse, questa configurazione sbagliata sparirebbe.
  const o = run(APP.ctx, scenario(`setLagVlan('lgX', 20); state.ports['sw-2'].vlanOvr = 30;`));
  assert.deepEqual(Array.from(o.eff), [20, 30]);
  assert.equal(o.mismatch, true, 'due membri in due VLAN: è un errore, e si deve vedere');
  assert.deepEqual(Array.from(o.vlans), [20, 30]);
});

test('un gid che non esiste non fa danni', () => {
  const o = run(APP.ctx, scenario(`setLagVlan('lgNONE', 20); setLagVlan('', 20);`));
  assert.deepEqual(Array.from(o.ovr), [null, null], 'nessun membro, nessuna scrittura');
});

test('⛔ propagateVlans NON eredita fra membri: la dichiarazione è del bundle', () => {
  // Controprova della strada scartata. Se un giorno qualcuno la implementasse là
  // dentro, questo test lo direbbe subito — e con lui l'avviso qui sopra morirebbe.
  const o = run(APP.ctx, scenario(`state.ports['sw-1'].vlanOvr = 20;`));
  assert.deepEqual(Array.from(o.eff), [20, 1],
    'una porta dichiarata non regala la sua VLAN alla sorella: quella resta sul pavimento');
  assert.equal(o.mismatch, true, 'ed è proprio la situazione che l’avviso deve scoprire');
});
