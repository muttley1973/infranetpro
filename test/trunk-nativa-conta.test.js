'use strict';
// ============================================================================
// Un trunk porta la sua NATIVA come tutte le altre — VLAN 1 compresa
// ============================================================================
// La decisione contava le VLAN di un trunk filtrando via la 1: un trunk con
// nativa 1 e una VLAN taggata risultava «ne porta una sola» e prendeva quel
// colore. Ma sul filo ne passano DUE — l'untagged della nativa attraversa lo
// stesso — quindi dipingerne una afferma che l'altra non c'è.
//
// Misurato sui progetti veri prima di cambiare: **3 cavi su 1.171**, e sono
// proprio il caso di manuale — due uplink di access point che portano la
// gestione untagged in VLAN 1 e l'SSID taggato in 99, più un server con la
// nativa 1 e la 20 taggata. Dipinti 99 e 20: la metà non taggata spariva.
//
// ⚠️ Il filtro era una scorciatoia allineata alla pratica (non usare la VLAN 1,
// potarla dai trunk), non una descrizione della rete. Toglierlo rende la regola
// senza eccezioni: **più di una VLAN ⇒ neutro**, chiunque esse siano.
//
// ⚠️ Limite noto e accettato: se la VLAN 1 è stata POTATA dal trunk
// (`switchport trunk allowed vlan` che la esclude) allora non attraversa davvero,
// e noi la contiamo lo stesso. L'errore però va nella direzione giusta — porta a
// «neutro», che non afferma niente, invece che a dipingere una VLAN sbagliata.
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkPaintVlan } = require('../lib/link-vlan-color.js');

const paint = (o) => linkPaintVlan(o);

test('uplink di AP: gestione untagged in 1 + SSID taggato in 99 ⇒ NEUTRO', () => {
  // Il caso misurato nel progetto 11, due volte.
  const r = paint({ mode: 'trunk', native: 1, vlans: [1, 99], src: { active: true }, dst: { active: true } });
  assert.equal(r.kind, 'trunk');
  assert.equal(r.vlan, null, 'dipingere 99 direbbe che la gestione non passa di lì');
  assert.deepEqual(r.vlans, [1, 99], 'e le mostra tutte e due');
});

test('la nativa non è un caso speciale: 1 conta quanto 99', () => {
  const conUno  = paint({ mode: 'trunk', native: 1,  vlans: [1, 30],  src: {}, dst: {} });
  const senzaUno = paint({ mode: 'trunk', native: 99, vlans: [99, 30], src: {}, dst: {} });
  assert.equal(conUno.kind, senzaUno.kind, 'due VLAN sono due VLAN, qualunque sia la nativa');
  assert.equal(conUno.source, 'multi-vlan');
});

test('un trunk che porta DAVVERO una VLAN sola tiene il suo colore', () => {
  // La regola dell'utente resta: lì non si sceglie, si constata.
  assert.equal(paint({ mode: 'trunk', native: 20, vlans: [20], src: {}, dst: {} }).vlan, 20);
  assert.equal(paint({ mode: 'trunk', native: 1,  vlans: [1],  src: {}, dst: {} }).vlan, 1);
});

test('e se l’elenco è vuoto, resta la nativa: è l’unica che può passare', () => {
  const r = paint({ mode: 'trunk', native: 50, vlans: [], src: { active: true }, dst: {} });
  assert.equal(r.vlan, 50);
  assert.equal(r.source, 'single-vlan');
});

test('l’etichetta conta le VLAN come le conta la decisione', () => {
  // ⚠️ Anche il testo «Trunk — N VLAN» filtrava la 1: su [1,99] avrebbe scritto
  // «1 VLAN, nessuna prevale», che si contraddice da sé nella stessa riga.
  const r = paint({ mode: 'trunk', native: 1, vlans: [1, 99], src: {}, dst: {} });
  assert.equal(r.vlans.length, 2, 'la decisione ne vede due…');
  // (il testo lo compone la glue: qui si pinna il dato su cui lo compone)
});
