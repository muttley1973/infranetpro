'use strict';
// ============================================================
// PORT DESCRIPTIONS — il conteggio «presa | testo» e da dove viene il testo.
//
// I casi NON sono inventati: sono i valori che il banco ha restituito il
// 03/10/2026 (7 apparati, handoff §123). Ogni stringa qui sotto è un `ifAlias`
// letto davvero, compresi quelli scomodi:
//   · VyOS riempie ifAlias da solo col nome dell'interfaccia (`eth1`);
//   · EXOS e pfSense con un nome logico (`MgmtPort`, `WAN`) che NON si può
//     riconoscere come «generato» senza enumerare vendor;
//   · Cisco/Arista tagliano a 64, EXOS/VyOS/MikroTik restituiscono 70;
//   · l'Aruba CX restituisce UTF-8 vero (`·`, U+00B7).
// Le invarianti che il modulo deve difendere:
//   ① il dichiarato vince sul misurato, e una porta conta UNA volta;
//   ② un alias uguale al nome dell'interfaccia NON è una descrizione;
//   ③ `inFormat` vuole il separatore E una presa prima — non una somiglianza;
//   ④ il separatore dichiarato non diventa mai un'espressione regolare.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const PD = require('../lib/port-descriptions.js');

// Valori REALI dal banco (03/10/2026).
const LAB = {
  pipe:        'PP1-14 | 203',                                                          // 12 B, intatto su 7/7
  cisco64:     'PP1-14 | 203 | 0123456789012345678901234567890123456789012345678',     // tagliato a 64
  full70:      'PP1-14 | 203 | 01234567890123456789012345678901234567890123456789|FINE', // intero su EXOS/VyOS/MikroTik
  arubaDot:    'PP1-14 · 203',                                                      // UTF-8 vero sull'Aruba
  consoleB7:   'PP1-14 B7 203',                                                          // storpiato dalla console web
  vyosAuto:    'eth1',
  exosMgmt:    'MgmtPort',
  pfsenseWan:  'WAN',
};

// ── portDescription: da dove viene il testo ────────────────────────────────
test('porta: il testo scritto a mano è «dichiarato»', () => {
  assert.deepEqual(PD.portDescription({ desc: LAB.pipe }), { text: LAB.pipe, source: 'declared' });
});

test('porta: l\'alias letto dall\'apparato è «misurato»', () => {
  assert.deepEqual(PD.portDescription({ alias: LAB.pipe, ifName: 'GigabitEthernet0/3' }),
    { text: LAB.pipe, source: 'measured' });
});

test('① il dichiarato vince sul misurato: l\'alias non si fonde e non si somma', () => {
  const r = PD.portDescription({ desc: 'B12 | stampante', alias: LAB.pipe, ifName: 'Gi0/1' });
  assert.deepEqual(r, { text: 'B12 | stampante', source: 'declared' });
});

test('② un alias UGUALE al nome dell\'interfaccia è il nome, non una descrizione (VyOS, misurato)', () => {
  assert.deepEqual(PD.portDescription({ alias: LAB.vyosAuto, ifName: 'eth1' }), { text: '', source: 'generated' });
  assert.deepEqual(PD.portDescription({ alias: '  eth1 ', ifName: 'eth1' }), { text: '', source: 'generated' },
    'gli spazi non cambiano chi è');
});

test('② generato vuol dire UGUALE al nome, non «che ci somiglia»: «eth1 uplink» su eth1 è una descrizione vera', () => {
  // Il confronto per inizio avrebbe cancellato proprio le descrizioni che iniziano col nome
  // della porta — le più comuni quando una persona scrive «Gi0/1 verso SW-CORE».
  assert.equal(PD.portDescription({ alias: 'eth1 uplink', ifName: 'eth1' }).source, 'measured');
  assert.equal(PD.portDescription({ alias: 'eth10', ifName: 'eth1' }).source, 'measured', 'eth10 non è eth1');
  assert.equal(PD.portDescription({ alias: 'Gi0/1 | 203', ifName: 'Gi0/1' }).source, 'measured');
});

test('② il nome dell\'interfaccia si pulisce dagli spazi come l\'alias', () => {
  assert.equal(PD.portDescription({ alias: 'eth1', ifName: ' eth1 ' }).source, 'generated');
});

test('② un alias uguale al nome ma con una descrizione SCRITTA resta dichiarato (non si perde il lavoro a mano)', () => {
  assert.deepEqual(PD.portDescription({ desc: 'eth1', alias: 'eth1', ifName: 'eth1' }),
    { text: 'eth1', source: 'declared' });
});

test('LIMITE DICHIARATO: `MgmtPort` (EXOS) e `WAN` (pfSense) NON si riconoscono come generati — contano come misurati', () => {
  // Non si indovina un nome «da agente» enumerando vendor. Non entrano nel formato (niente
  // separatore), quindi non gonfiano il numero che conta; ma contano fra le descrizioni.
  assert.equal(PD.portDescription({ alias: LAB.exosMgmt, ifName: 'Management' }).source, 'measured');
  assert.equal(PD.portDescription({ alias: LAB.pfsenseWan, ifName: 'em0' }).source, 'measured');
});

test('niente da dire: vuoto, spazi, assente, o un valore che non è un oggetto', () => {
  for (const p of [{}, { desc: '', alias: '' }, { desc: '   ', alias: '\t' }, { desc: null, alias: undefined }, null, undefined, 'x', 7]) {
    assert.deepEqual(PD.portDescription(p), { text: '', source: 'none' }, JSON.stringify(p));
  }
});

// ── parsePortDescription: il formato ───────────────────────────────────────
test('③ «presa | testo» è nel formato: la presa è il primo segmento, il resto è libero', () => {
  assert.deepEqual(PD.parsePortDescription(LAB.pipe), { inFormat: true, jack: 'PP1-14', note: '203' });
});

test('③ anche il testo tagliato a 64 e quello intero da 70 sono nel formato — la presa sta a sinistra', () => {
  const a = PD.parsePortDescription(LAB.cisco64);
  assert.equal(a.inFormat, true);
  assert.equal(a.jack, 'PP1-14');
  assert.ok(a.note.startsWith('203 | 0123'));
  const b = PD.parsePortDescription(LAB.full70);
  assert.equal(b.jack, 'PP1-14');
  assert.ok(b.note.endsWith('|FINE'), 'il testo lungo non si tronca qui: lo fa, o no, l\'apparato');
});

test('③ senza separatore NON è nel formato, anche se potrebbe essere una presa («PP1-14» da solo)', () => {
  for (const s of ['PP1-14', LAB.arubaDot, LAB.consoleB7, LAB.exosMgmt, LAB.pfsenseWan, LAB.vyosAuto]) {
    assert.equal(PD.parsePortDescription(s).inFormat, false, s);
  }
});

test('③ il separatore c\'è ma la presa no («| 203»): non è nel formato', () => {
  assert.deepEqual(PD.parsePortDescription('| 203'), { inFormat: false, jack: '', note: '' });
  assert.equal(PD.parsePortDescription('   |   ').inFormat, false);
});

test('③ la presa c\'è e il testo dopo no («PP1-14 |»): è nel formato, con nota vuota — tagliato, non sbagliato', () => {
  assert.deepEqual(PD.parsePortDescription('PP1-14 |'), { inFormat: true, jack: 'PP1-14', note: '' });
});

test('il primo separatore separa: gli altri restano nel testo libero', () => {
  assert.deepEqual(PD.parsePortDescription('A1 | B2 | C3'), { inFormat: true, jack: 'A1', note: 'B2 | C3' });
});

test('④ il separatore dichiarato è un TESTO, mai un\'espressione: `.` `*` `(` non fanno da jolly né rompono', () => {
  assert.equal(PD.parsePortDescription('PP1-14 . 203', { separator: '.' }).inFormat, true);
  assert.equal(PD.parsePortDescription('PP1-14 x 203', { separator: '.' }).inFormat, false, '«.» non vale «un carattere qualsiasi»');
  assert.doesNotThrow(() => PD.parsePortDescription('PP1-14 ( 203', { separator: '(' }));
  assert.equal(PD.parsePortDescription('PP1-14 ( 203', { separator: '(' }).inFormat, true);
  assert.equal(PD.parsePortDescription('PP1-14 ; 203', { separator: ' ; ' }).inFormat, true, 'il separatore si pulisce dagli spazi');
});

test('④ un separatore che non è una stringa non vuota ricade sul predefinito, non fa tacere il conteggio', () => {
  for (const sep of [undefined, null, '', '   ', 5, {}, []]) {
    assert.equal(PD.parsePortDescription(LAB.pipe, { separator: sep }).inFormat, true, String(sep));
  }
  assert.equal(PD.parsePortDescription(LAB.pipe, null).inFormat, true);
});

// ── il conteggio ────────────────────────────────────────────────────────────
// Il banco in miniatura: SW-ACC1 (vIOS), Aruba CX, VyOS, EXOS.
const BANCO = [
  { id: 'sw7', ports: [
    { pid: 'sw7-1', ifName: 'GigabitEthernet0/0', alias: 'Aruba-CX 1/1/1' },        // misurato, FUORI formato
    { pid: 'sw7-2', ifName: 'GigabitEthernet0/1' },                                    // niente
    { pid: 'sw7-4', ifName: 'GigabitEthernet0/3', alias: LAB.pipe },                   // misurato, nel formato
    { pid: 'sw7-8', ifName: 'GigabitEthernet1/3', alias: LAB.cisco64 },                // misurato, nel formato
  ] },
  { id: 'sw13', ports: [
    { pid: 'sw13-7', ifName: '1/1/7', alias: LAB.pipe },
    { pid: 'sw13-8', ifName: '1/1/8', alias: LAB.arubaDot },                           // UTF-8, FUORI formato
    { pid: 'sw13-9', ifName: '1/1/9' },
  ] },
  { id: 'rt5', ports: [
    { pid: 'rt5-1', ifName: 'eth0', alias: 'eth0' },                                   // generato
    { pid: 'rt5-2', ifName: 'eth1', alias: LAB.pipe },
    { pid: 'rt5-3', ifName: 'eth2', alias: 'eth2' },                                   // generato
  ] },
  { id: 'sw12', ports: [
    { pid: 'sw12-1', ifName: 'Management', alias: LAB.exosMgmt },                      // non riconosciuto come generato
  ] },
  { id: 'dich', ports: [
    { pid: 'dich-1', ifName: 'Gi0/1', desc: 'B12 | stampante', alias: LAB.pipe },      // dichiarato vince
    { pid: 'dich-2', desc: 'solo testo' },                                              // dichiarato, FUORI formato
  ] },
];

test('il banco: totali, e la somma dichiarato + misurato = descritte', () => {
  const c = PD.portDescriptionCensus(BANCO);
  assert.equal(c.ports, 13, 'tutte le porte passate, anche le senza testo');
  assert.equal(c.generated, 2, 'eth0 ed eth2 di VyOS: sono il nome, non una descrizione');
  assert.equal(c.described, 9, '13 porte − 2 generate − 2 vuote');
  assert.equal(c.declared, 2);
  assert.equal(c.measured, 7);
  assert.equal(c.declared + c.measured, c.described);
  assert.equal(c.inFormat, 5, 'sw7-4 · sw7-8 · sw13-7 · rt5-2 · dich-1');
  assert.ok(c.inFormat <= c.described);
});

test('il banco: una porta con desc E alias conta UNA volta, come dichiarata', () => {
  const c = PD.portDescriptionCensus(BANCO);
  const it = c.items.filter((x) => x.pid === 'dich-1');
  assert.equal(it.length, 1);
  assert.equal(it[0].source, 'declared');
  assert.equal(it[0].text, 'B12 | stampante');
  assert.equal(it[0].jack, 'B12');
});

test('il banco: l\'elenco porta i FUORI formato per primi, poi gli altri nell\'ordine di ingresso', () => {
  const c = PD.portDescriptionCensus(BANCO);
  assert.deepEqual(c.items.map((x) => x.pid),
    ['sw7-1', 'sw13-8', 'sw12-1', 'dich-2',        // fuori formato, in ordine di ingresso
     'sw7-4', 'sw7-8', 'sw13-7', 'rt5-2', 'dich-1'], 'nel formato, in ordine di ingresso');
  assert.equal(c.items.filter((x) => !x.inFormat).length, c.described - c.inFormat);
});

test('il banco: ogni voce dice QUALE porta è (ifName), anche quando manca', () => {
  const c = PD.portDescriptionCensus(BANCO);
  assert.equal(c.items.find((x) => x.pid === 'sw7-4').ifName, 'GigabitEthernet0/3');
  assert.equal(c.items.find((x) => x.pid === 'dich-2').ifName, '', 'una porta dichiarata a mano senza ifName: vuoto, non undefined');
});

test('il banco: ogni voce dice DOVE sta — dispositivo, rack e porta (ifName, o il numero del pid)', () => {
  const c = PD.portDescriptionCensus([
    { id: 'sw7', name: 'SW-ACC1', rackName: 'Rack Lab', ports: [{ pid: 'sw7-4', ifName: 'GigabitEthernet0/3', alias: LAB.pipe }] },
    { id: 'sw9', ports: [{ pid: 'sw9-12', desc: 'B1 | x' }] },
  ]);
  assert.deepEqual([c.items[0].device, c.items[0].rack, c.items[0].port], ['SW-ACC1', 'Rack Lab', 'GigabitEthernet0/3']);
  assert.deepEqual([c.items[1].device, c.items[1].rack, c.items[1].port], ['sw9', '', '12'],
    'senza nome il dispositivo è il suo id, senza rack è vuoto, senza ifName la porta è il numero');
});

test('il banco: le descrizioni generate e le porte vuote NON compaiono nell\'elenco', () => {
  const c = PD.portDescriptionCensus(BANCO);
  const pids = c.items.map((x) => x.pid);
  for (const p of ['rt5-1', 'rt5-3', 'sw7-2', 'sw13-9']) assert.ok(!pids.includes(p), p);
});

test('il banco: il separatore dichiarato cambia il formato, non la popolazione', () => {
  const c = PD.portDescriptionCensus(BANCO, { separator: '·' });
  assert.equal(c.ports, 13);
  assert.equal(c.described, 9);
  assert.equal(c.inFormat, 1, 'solo l\'Aruba con `·` vero ha la presa prima del puntino');
});

test('nessuna descrizione in tutto il progetto: zero, e le porte restano contate', () => {
  const c = PD.portDescriptionCensus([{ id: 'a', ports: [{ pid: 'a-1' }, { pid: 'a-2', alias: '' }] }]);
  assert.deepEqual(c, { ports: 2, described: 0, inFormat: 0, declared: 0, measured: 0, generated: 0,
    jackEvaluable: false, jackKnown: 0, jackUnknown: 0, jackAmbiguous: 0, items: [] });
});

// ── il confronto con le prese del documento ─────────────────────────────────
// Le prese che il PROGETTO documenta, come le passa il glue: una presa a muro col suo nome,
// o la porta di un patch panel nel suo nome «pannello-numero».
const PRESE = [
  { label: 'PP1-14', where: 'Patch Panel PP1' },
  { label: 'PP1-15', where: 'Patch Panel PP1' },
  { label: 'B12', where: 'Presa a muro' },
  { label: '203', where: 'Presa a muro' },
];
const _con = (ports, jacks) => PD.portDescriptionCensus([{ id: 'sw1', name: 'SW1', ports }], { jacks });

test('chiave: maiuscole, spazi, punti, underscore e trattini diversi sono LA STESSA presa', () => {
  const k = PD.jackKey('PP1-14');
  for (const v of ['pp1-14', 'PP1 14', 'PP1.14', 'PP1_14', ' PP1 - 14 ', 'PP1 – 14', 'PP1 — 14', 'Pp1--14']) {
    assert.equal(PD.jackKey(v), k, JSON.stringify(v));
  }
});

test('chiave: la forma è ESATTA — «pp1-14», non una qualunque stringa uguale per tutte le grafie', () => {
  // Un'uguaglianza fra grafie diverse non basta: una chiave che da «PP1-14» facesse «pp1-1-4»
  // le renderebbe uguali fra loro e sbagliate tutte. Si pinna il valore.
  assert.equal(PD.jackKey('PP1-14'), 'pp1-14');
  assert.equal(PD.jackKey('PP1 14'), 'pp1-14');
  assert.equal(PD.jackKey('A - B - C'), 'a-b-c');
  assert.equal(PD.jackKey('B12'), 'b12');
});

test('chiave: separatori in testa e in coda non fanno parte della presa', () => {
  for (const v of ['-PP1-14', '_PP1-14', '.PP1-14', '  - PP1-14', 'PP1-14-', 'PP1-14.', 'PP1-14 - ', '--PP1--14--']) {
    assert.equal(PD.jackKey(v), 'pp1-14', JSON.stringify(v));
  }
});

test('chiave: ⭐ si TENGONO i separatori — «PP11-4» non è «PP1-14» (toglierli le farebbe collidere)', () => {
  assert.notEqual(PD.jackKey('PP11-4'), PD.jackKey('PP1-14'));
  assert.notEqual(PD.jackKey('PP114'), PD.jackKey('PP1-14'), 'e senza separatore è un\'altra presa');
});

test('chiave: niente da confrontare → stringa vuota (mai una chiave che combacia con tutto)', () => {
  for (const v of ['', '   ', '---', ' . _ ', null, undefined]) assert.equal(PD.jackKey(v), '', JSON.stringify(v));
});

test('confronto: la presa esiste (una sola) → known, e dice DOVE', () => {
  const c = _con([{ pid: 'sw1-1', ifName: 'Gi0/1', alias: 'PP1-14 | 203' }], PRESE);
  assert.equal(c.jackEvaluable, true);
  assert.equal(c.items[0].jackState, 'known');
  assert.equal(c.items[0].jackWhere, 'Patch Panel PP1');
  assert.deepEqual([c.jackKnown, c.jackUnknown, c.jackAmbiguous], [1, 0, 0]);
});

test('confronto: scritta in un altro modo ma è la stessa presa («pp1 14») → known', () => {
  assert.equal(_con([{ pid: 'sw1-1', alias: 'pp1 14 | stampante' }], PRESE).items[0].jackState, 'known');
});

test('confronto: nessuna presa con quel nome → unknown; due con lo stesso nome → ambiguous', () => {
  const doppie = PRESE.concat([{ label: 'b12', where: 'Altro piano' }]);
  const c = _con([
    { pid: 'sw1-1', alias: 'PP9-99 | x' },
    { pid: 'sw1-2', alias: 'B12 | y' },
  ], doppie);
  assert.equal(c.items.find((x) => x.pid === 'sw1-1').jackState, 'unknown');
  const amb = c.items.find((x) => x.pid === 'sw1-2');
  assert.equal(amb.jackState, 'ambiguous');
  assert.equal(amb.jackWhere, 'Presa a muro · Altro piano', 'nomina TUTTE le candidate');
  assert.deepEqual([c.jackKnown, c.jackUnknown, c.jackAmbiguous], [0, 1, 1]);
});

test('confronto: ⭐ NESSUNA presa documentata → NON VALUTABILE, non «tutte sconosciute»', () => {
  for (const jacks of [undefined, null, [], [null, 5, {}], [{ label: '   ' }], 'boh', {}, { label: 'B12' }, 42]) {
    const c = _con([{ pid: 'sw1-1', alias: 'PP1-14 | 203' }], jacks);
    assert.equal(c.jackEvaluable, false, JSON.stringify(jacks));
    assert.equal(c.items[0].jackState, '', 'nessun esito inventato');
    assert.deepEqual([c.jackKnown, c.jackUnknown, c.jackAmbiguous], [0, 0, 0]);
  }
});

test('confronto: solo le porte NEL formato hanno un esito (una fuori formato non nomina una presa)', () => {
  const c = _con([
    { pid: 'sw1-1', alias: 'PP1-14' },              // potrebbe essere una presa, ma non ha il separatore
    { pid: 'sw1-2', alias: 'MgmtPort' },
    { pid: 'sw1-3', alias: 'PP1-14 | 203' },
  ], PRESE);
  assert.deepEqual(c.items.map((x) => [x.pid, x.jackState]).sort(), [['sw1-1', ''], ['sw1-2', ''], ['sw1-3', 'known']]);
  assert.equal(c.jackKnown + c.jackUnknown + c.jackAmbiguous, c.inFormat, 'gli esiti sommano alle porte nel formato');
});

test('confronto: l\'ordine mette per prime le fuori formato, poi sconosciute e ambigue, e in coda le note', () => {
  const c = _con([
    { pid: 'a-1', alias: 'PP1-14 | ok' },             // known
    { pid: 'a-2', alias: 'PP9-99 | no' },             // unknown
    { pid: 'a-3', alias: 'solo testo' },              // fuori formato
    { pid: 'a-4', alias: 'B12 | ok' },                // known
  ], PRESE);
  assert.deepEqual(c.items.map((x) => x.pid), ['a-3', 'a-2', 'a-1', 'a-4']);
});

test('confronto: anche le AMBIGUE salgono, insieme alle sconosciute (sono da guardare quanto loro)', () => {
  const c = _con([
    { pid: 'a-1', alias: 'PP1-14 | ok' },                              // known
    { pid: 'a-2', alias: 'B12 | doppia' },                             // ambiguous (due prese si chiamano B12)
    { pid: 'a-3', alias: 'PP1-15 | ok' },                              // known
  ], PRESE.concat([{ label: 'b12', where: 'Altro piano' }]));
  assert.deepEqual(c.items.map((x) => x.pid), ['a-2', 'a-1', 'a-3']);
});

test('confronto: la lista delle prese non muta, e voci storte non rompono', () => {
  const jacks = Object.freeze(PRESE.map((j) => Object.freeze({ ...j })));
  assert.doesNotThrow(() => _con([{ pid: 'a-1', alias: 'PP1-14 | x' }], jacks));
  assert.doesNotThrow(() => _con([{ pid: 'a-1', alias: 'PP1-14 | x' }], [null, undefined, 7, 'x', { label: 5 }, { where: 'solo dove' }]));
});

test('confronto: senza `where` la presa nominata è la sua etichetta', () => {
  const c = _con([{ pid: 'a-1', alias: 'B12 | x' }], [{ label: 'B12' }]);
  assert.equal(c.items[0].jackWhere, 'B12');
});

test('input storto: non lancia, e salta ciò che non è leggibile', () => {
  for (const x of [undefined, null, 5, 'x', {}, [], [null, undefined, 5], [{ id: 'a' }], [{ id: 'a', ports: 'no' }],
    [{ id: 'a', ports: [null, 7, 'x'] }]]) {
    assert.doesNotThrow(() => PD.portDescriptionCensus(x), JSON.stringify(x));
    const c = PD.portDescriptionCensus(x);
    assert.equal(c.described, 0);
    assert.equal(c.ports, 0, 'una voce che non è una porta non si conta come porta: ' + JSON.stringify(x));
    assert.deepEqual(c.items, []);
  }
});

test('non muta l\'ingresso', () => {
  const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const frozen = deepFreeze(JSON.parse(JSON.stringify(BANCO)));
  assert.doesNotThrow(() => PD.portDescriptionCensus(frozen));
});

test('il glifo non ASCII dell\'Aruba arriva com\'è (U+00B7), non va in `\\u00b7` né perso', () => {
  const c = PD.portDescriptionCensus([{ id: 'sw13', ports: [{ pid: 'sw13-8', ifName: '1/1/8', alias: LAB.arubaDot }] }]);
  assert.equal(c.items[0].text.charCodeAt(7), 0xb7);
});

test('chiave: la stessa lettera accentata scritta in due forme Unicode è la stessa presa', () => {
  const composta = 'Caf' + String.fromCharCode(0xe9) + '-1';
  const scomposta = 'Cafe' + String.fromCharCode(0x301) + '-1';
  assert.notEqual(composta, scomposta, 'le due stringhe sono diverse byte per byte');
  assert.equal(PD.jackKey(composta), PD.jackKey(scomposta));
});

// ── l'adozione AUTOMATICA: cosa diventa la Descrizione dopo una lettura ─────
const AD = (port, prev, next) => PD.adoptedDescription(port, prev, next);

test('adozione automatica: una descrizione VUOTA si riempie col testo letto', () => {
  assert.equal(AD({ ifName: 'Gi0/3' }, undefined, 'PP1-14 | 203'), 'PP1-14 | 203');
  assert.equal(AD({ desc: '', ifName: 'Gi0/3' }, '', 'PP1-14 | 203'), 'PP1-14 | 203');
  assert.equal(AD({ desc: '   ', ifName: 'Gi0/3' }, undefined, '  PP1-14 | 203  '), 'PP1-14 | 203', 'ripulita dagli spazi');
});

test('adozione automatica: ⭐ una descrizione scritta da una PERSONA non si tocca mai', () => {
  // La descrizione è diversa dall'alias di prima: l'ha scritta o modificata qualcuno.
  assert.equal(AD({ desc: 'B12 | stampante', ifName: 'Gi0/3' }, undefined, 'PP1-14 | 203'), undefined, 'nessuna lettura precedente');
  assert.equal(AD({ desc: 'B12 | stampante', ifName: 'Gi0/3' }, 'PP1-14 | 203', 'PP9-99 | 7'), undefined, 'ha cambiato il testo a mano');
  assert.equal(AD({ desc: 'B12 | stampante', ifName: 'Gi0/3' }, 'B12 | altro', 'PP1-14 | 203'), undefined);
});

test('adozione automatica: una COPIA del dispositivo segue il dispositivo quando questo cambia testo', () => {
  assert.equal(AD({ desc: 'PP1-14 | 203', ifName: 'Gi0/3' }, 'PP1-14 | 203', 'PP1-15 | 204'), 'PP1-15 | 204');
  assert.equal(AD({ desc: 'PP1-14 | 203', ifName: 'Gi0/3' }, '  PP1-14 | 203  ', 'PP1-15 | 204'), 'PP1-15 | 204',
    'l\'alias di prima, anche con gli spazi con cui era stato memorizzato, è comunque quello copiato');
});

test('adozione automatica: se il testo non cambia non c\'è niente da scrivere', () => {
  assert.equal(AD({ desc: 'PP1-14 | 203', ifName: 'Gi0/3' }, 'PP1-14 | 203', 'PP1-14 | 203'), undefined);
  assert.equal(AD({ desc: 'PP1-14 | 203', ifName: 'Gi0/3' }, undefined, 'PP1-14 | 203'), undefined, 'già uguale: lascia stare');
});

test('adozione automatica: ⭐ un alias vuoto o assente NON cancella la descrizione (un timeout non è un testo tolto)', () => {
  for (const next of ['', '   ', undefined, null]) {
    assert.equal(AD({ desc: 'PP1-14 | 203', ifName: 'Gi0/3' }, 'PP1-14 | 203', next), undefined, JSON.stringify(next));
    assert.equal(AD({ ifName: 'Gi0/3' }, undefined, next), undefined);
  }
});

test('adozione automatica: un alias uguale al NOME dell\'interfaccia non è una descrizione (VyOS)', () => {
  assert.equal(AD({ ifName: 'eth1' }, undefined, 'eth1'), undefined);
  assert.equal(AD({ ifName: ' eth1 ' }, undefined, 'eth1'), undefined, 'gli spazi non cambiano chi è');
  assert.equal(AD({ ifName: 'eth1' }, undefined, 'eth1 uplink'), 'eth1 uplink', 'ma «eth1 uplink» sì');
});

test('adozione automatica: il testo tagliato dall\'apparato si adotta TAGLIATO', () => {
  const lungo = 'PP1-14 | 203 | 0123456789012345678901234567890123456789012345678';
  assert.equal(AD({ ifName: 'Gi1/3' }, undefined, lungo), lungo);
});

test('adozione automatica: ingressi storti non lanciano e non decidono niente', () => {
  for (const port of [undefined, null, 5, 'x', []]) assert.equal(AD(port, undefined, 'PP1-14 | 203'), 'PP1-14 | 203', 'una porta senza dati equivale a vuota');
  assert.doesNotThrow(() => AD({ desc: 7, ifName: {} }, {}, 9));
});

test('adozione automatica: non muta la porta', () => {
  const port = Object.freeze({ desc: '', ifName: 'Gi0/3' });
  assert.doesNotThrow(() => AD(port, undefined, 'PP1-14 | 203'));
});

test('origine: una descrizione UGUALE all\'alias è una copia del dispositivo → «misurato»', () => {
  assert.deepEqual(PD.portDescription({ desc: 'PP1-14 | 203', alias: 'PP1-14 | 203', ifName: 'Gi0/3' }),
    { text: 'PP1-14 | 203', source: 'measured' });
});

test('origine: una descrizione DIVERSA dall\'alias resta «dichiarato» (e vince)', () => {
  assert.deepEqual(PD.portDescription({ desc: 'B12 | stampante', alias: 'PP1-14 | 203', ifName: 'Gi0/3' }),
    { text: 'B12 | stampante', source: 'declared' });
});

test('origine: ⭐ uguale a un alias GENERATO (il nome) resta «dichiarato» — scrivere «eth1» su eth1 l\'ha fatto una persona', () => {
  assert.equal(PD.portDescription({ desc: 'eth1', alias: 'eth1', ifName: 'eth1' }).source, 'declared');
});

test('origine: dopo l\'adozione automatica il censimento conta la porta UNA volta, come misurata', () => {
  const c = PD.portDescriptionCensus([{ id: 'sw1', ports: [{ pid: 'sw1-1', ifName: 'Gi0/1', desc: 'PP1-14 | 203', alias: 'PP1-14 | 203' }] }]);
  assert.deepEqual([c.described, c.declared, c.measured, c.inFormat], [1, 0, 1, 1]);
});
