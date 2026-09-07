'use strict';
// ============================================================
// PORT INVENTORY — le porte che ESISTONO, e i cavi che puntano altrove.
//
// Le due invarianti che questo modulo deve difendere, e che nascono da una
// MISURA sul renderer, non da un'intuizione:
//   ① le SFP stanno DENTRO 1..portCount (sfpStartNum/sfpPrefix sono etichette),
//      quindi una porta numerata sopra il conteggio non è un uplink in fibra:
//      non esiste;
//   ② su una PDU i pid numerici sono le porte di RETE, non le porte dati —
//      misurarla col suo `n.ports` accuserebbe il cavo di gestione.
// E la disciplina: si accusa solo ciò che si sa leggere. Tutto il resto tace.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const PI = require('../lib/port-inventory.js');
const { frontPanelSfpGroups } = require('../lib/frontpanel.js');

const ids = new Set(['sw1', 'sw2', 'pdu1', 'nb-dev-100']);

// ── ① Il tetto ─────────────────────────────────────────────────────────────
test('tetto: il conteggio dichiarato vince sul default di tipo', () => {
  assert.equal(PI.numericPortCeiling({ type: 'switch', ports: 24 }, { typeDefaultPorts: 48 }), 24);
  assert.equal(PI.numericPortCeiling({ type: 'switch', ports: 0 }, { typeDefaultPorts: 48 }), 0);
  assert.equal(PI.numericPortCeiling({ type: 'switch' }, { typeDefaultPorts: 48 }), 48);
});

test('tetto: senza dichiarazione e senza default è NULL — «non lo so», non zero', () => {
  assert.equal(PI.numericPortCeiling({ type: 'switch' }, {}), null);
  assert.equal(PI.numericPortCeiling({ type: 'switch' }, { typeDefaultPorts: 'boh' }), null);
  assert.equal(PI.numericPortCeiling(null, null), null);
});

test('② PDU: il tetto è il numero di porte di RETE, non `n.ports`', () => {
  // Una PDU importata: 24 prese dichiarate in `ports`, UNA porta ethernet di
  // gestione. Il cavo di gestione sta su `pdu1-1`, ed è il cavo più legittimo
  // che ha: misurarla con 24 (o accusarla oltre 24) sarebbe due volte sbagliato.
  const pdu = { id: 'pdu1', type: 'pdu', ports: 24 };
  assert.equal(PI.numericPortCeiling(pdu, { typeDefaultPorts: 24, pduMgmtPorts: 1 }), 1);
  assert.equal(PI.numericPortCeiling(pdu, { typeDefaultPorts: 24, pduMgmtPorts: 0 }), 0);
  // Se il chiamante non sa dire quante porte di rete ha, si tace.
  assert.equal(PI.numericPortCeiling(pdu, { typeDefaultPorts: 24 }), null);
});

// ── Le famiglie di pid ─────────────────────────────────────────────────────
test('classifyPid: riconosce dati, mgmt, radio, logiche — e il resto è «altro»', () => {
  assert.deepEqual(PI.classifyPid('sw1-25', ids), { nodeId: 'sw1', family: 'data', num: 25 });
  assert.equal(PI.classifyPid('sw1-mgmt1', ids).family, 'mgmt');
  assert.equal(PI.classifyPid('sw1-radio2', ids).family, 'radio');
  assert.equal(PI.classifyPid('nb-dev-100-logical-77', ids).family, 'logical');
  assert.equal(PI.classifyPid('sw1-qualcosa', ids).family, 'other');
  assert.equal(PI.classifyPid('sw1', ids).family, 'other');
  // Un id nodo CON trattini si legge bene solo conoscendo i nodi (lib/port-id).
  assert.deepEqual(PI.classifyPid('nb-dev-100-3', ids), { nodeId: 'nb-dev-100', family: 'data', num: 3 });
});

// ── ① La misura che smentisce la nota vecchia ──────────────────────────────
test('① le SFP stanno DENTRO il conteggio: una porta sopra il tetto non è un uplink', () => {
  // Switch 28 porte: 24 dati + 4 SFP con numerazione «propria» (Te1..Te4).
  const sw = { id: 'sw1', type: 'switch', ports: 28, frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 1, sfpPrefix: 'Te' } };
  const gruppi = frontPanelSfpGroups(sw, 28, true);
  const numeriSfp = gruppi.flatMap(g => g.ports);
  assert.deepEqual(numeriSfp, [25, 26, 27, 28], 'le SFP sono le ULTIME porte dell\'intervallo');
  assert.ok(Math.max(...numeriSfp) <= 28, 'nessuna SFP è numerata sopra il conteggio');
  // Quindi il cavo sull\'uplink in fibra NON viene mai segnalato...
  const suSfp = PI.findOrphanPortRefs([{ src: 'sw1-28', dst: 'sw2-1' }], () => 28, ids);
  assert.deepEqual(suSfp, [], 'la Te4 è la porta 28: esiste');
  // ...e uno sopra il tetto sì, perché lì non c'è niente.
  const sopra = PI.findOrphanPortRefs([{ src: 'sw1-29', dst: 'sw2-1' }], (n) => (n === 'sw1' ? 28 : null), ids);
  assert.equal(sopra.length, 1);
  assert.equal(sopra[0].num, 29);
});

// ── I cavi orfani ──────────────────────────────────────────────────────────
test('trova i capi che puntano a una porta inesistente, uno per capo', () => {
  const links = [
    { src: 'sw1-1', dst: 'sw2-1' },      // ok da tutt'e due i lati
    { src: 'sw1-40', dst: 'sw2-2' },     // orfano a sinistra
    { src: 'sw2-3', dst: 'sw1-48' },     // orfano a destra
    { src: 'sw1-30', dst: 'sw1-31' },    // orfano DUE volte: è un cavo, sono due capi
  ];
  const tetti = { sw1: 24, sw2: 24 };
  const refs = PI.findOrphanPortRefs(links, (n) => (n in tetti ? tetti[n] : null), ids);
  assert.equal(refs.length, 4);
  assert.deepEqual(refs.map(r => r.pid), ['sw1-40', 'sw1-48', 'sw1-30', 'sw1-31']);
  assert.deepEqual(refs.map(r => r.end), ['src', 'dst', 'src', 'dst']);
  assert.deepEqual(refs.map(r => r.index), [1, 2, 3, 3]);
  assert.equal(refs[0].ceiling, 24, 'porta con sé il tetto che ha violato');
});

test('la porta 0 e i numeri negativi sono fuori quanto quelli sopra il tetto', () => {
  const refs = PI.findOrphanPortRefs([{ src: 'sw1-0', dst: 'sw2-1' }], () => 24, ids);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].num, 0);
});

// ── La disciplina: si tace su ciò che non si sa leggere ────────────────────
test('mgmt, radio e logiche non si segnalano MAI: non sappiamo quante ne esistono', () => {
  // Il capo di destra è sempre la porta 1 di sw2, che col tetto a 1 esiste: così
  // l'unico giudizio possibile riguarda il capo di SINISTRA, che è il caso.
  const links = [
    { src: 'sw1-mgmt1', dst: 'sw2-1' },
    { src: 'sw1-radio8', dst: 'sw2-1' },
    { src: 'nb-dev-100-logical-77', dst: 'sw2-1' },
    { src: 'sw1-strana', dst: 'sw2-1' },
  ];
  assert.deepEqual(PI.findOrphanPortRefs(links, () => 1, ids), [],
    'anche col tetto a 1, nessuna di queste famiglie viene accusata');
});

test('un nodo di cui non sappiamo il tetto non viene accusato', () => {
  const refs = PI.findOrphanPortRefs([{ src: 'sw1-99', dst: 'sw2-99' }], (n) => (n === 'sw1' ? 24 : null), ids);
  assert.deepEqual(refs.map(r => r.pid), ['sw1-99'], 'sw2 non ha un tetto noto: si tace');
});

test('un capo mancante o un link nullo non fanno rumore', () => {
  assert.deepEqual(PI.findOrphanPortRefs([null, {}, { src: '', dst: null }], () => 0, ids), []);
  assert.deepEqual(PI.findOrphanPortRefs(null, () => 0, ids), []);
});

// ── La domanda al momento del danno ────────────────────────────────────────
test('orphansIfPortCount: cosa resterebbe scollegato PRIMA di abbassare il conteggio', () => {
  const links = [
    { src: 'sw1-1', dst: 'sw2-1' },
    { src: 'sw1-25', dst: 'sw2-2' },
    { src: 'sw1-48', dst: 'sw2-3' },
    { src: 'sw1-25', dst: 'sw2-4' },     // stessa porta, secondo cavo
    { src: 'sw2-40', dst: 'sw2-41' },    // un ALTRO apparato: non è affare di questa domanda
  ];
  const r = PI.orphansIfPortCount('sw1', 24, links, ids);
  assert.equal(r.count, 3, 'tre capi di cavo');
  assert.deepEqual(r.ports, [25, 48], 'ma due porte: due cavi sulla stessa porta sono una porta sola');
  const nessuno = PI.orphansIfPortCount('sw1', 48, links, ids);
  assert.equal(nessuno.count, 0, 'portandolo a 48 non resta scollegato niente');
});

test('orphansIfPortCount: un conteggio non numerico non è una domanda', () => {
  const links = [{ src: 'sw1-25', dst: 'sw2-1' }];
  assert.equal(PI.orphansIfPortCount('sw1', 'boh', links, ids).count, 0);
  assert.equal(PI.orphansIfPortCount('', 24, links, ids).count, 0);
});
