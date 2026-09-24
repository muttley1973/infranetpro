'use strict';
// ============================================================
//  Panoramica — i LAG sanno chi sono i loro capi, e le liste si dividono
//  con le parole della notazione unica.
//
//  ① I CAPI DI UN LAG venivano letti dalla CHIAVE del gruppo (`snmp-lag-<nodo>-<n>`),
//     cioè da una targa. Funzionava finché la chiave conteneva un id di nodo: appena
//     il gruppo lo crea una persona, il capo non si risolve e la riga esce col nome
//     VUOTO. Misurato sul progetto del banco il 2026-09-24: sei righe su sedici.
//     Il fatto sta nelle PORTE — `ports[pid].lagGroup` — ed è da lì che si legge.
//
//  ② LE SCHEDE. Un LAG ha tre origini (misurato dall'apparato · dedotto dall'auto-link ·
//     dichiarato da una persona), e un cavo fino a cinque modi di essere saputo. Le
//     parole non sono nuove: sono i gradi di lib/certainty.js, gli stessi delle
//     pastiglie. ⚠️ Le due voci negative — «contraddetto» e «non risulta» (il
//     fantasma: un dedotto che ha perso l'evidenza) — vivono nello STATO DI PROVA,
//     che esiste solo dopo una Verifica: senza, le schede dei cavi sono tre e non
//     promettono niente che nessuno abbia guardato.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { buildOverview } = require('../lib/overview.js');
const { CERTAINTY_GRADES } = require('../lib/certainty.js');

const TYPES = { switch: { isActive: true, isRack: true }, pc: { hasIP: true, isFloor: true } };
const rowOf = (sec, key) => sec.rows.find((r) => r.key === key);
// ⚠️ `lastProvenAt` è una data ISO, non un numero: `lib/proof.js` la legge con
// `Date.parse`, e un epoch in millisecondi diventa NaN → freschezza 0 → OGNI cavo
// dedotto risulta fantasma. Un banco sbagliato così non fallisce: conferma.
const ADESSO = new Date().toISOString();

// Due switch e un PC. `proof` sui nodi = una Verifica è girata (senza, gli stati di
// prova non esistono affatto, ed è giusto così).
const NODI = (verificati) => [
    { id: 'sw1', type: 'switch', name: 'SW-CORE', ip: '10.0.0.1' },
    { id: 'sw2', type: 'switch', name: 'SW-ACC1', ip: '10.0.0.2' },
    { id: 'pc1', type: 'pc', name: 'PC1', ip: '10.0.0.50' },
].map((n) => (verificati ? Object.assign(n, { proof: { status: 'ok', lastProvenAt: ADESSO } }) : n));

// ── ① I capi arrivano dalle porte ─────────────────────────────────────────

test('i capi di un LAG si leggono dalle PORTE, anche se la chiave non dice niente', () => {
    const o = buildOverview({
        types: TYPES, nodes: NODI(false), links: [],
        // Una chiave scritta a mano: non contiene un id di nodo. Prima: capo VUOTO.
        lagGroups: { 'lag-swcore-po1': 'Port-channel1' },
        lagMembers: { 'lag-swcore-po1': ['sw1', 'sw2'] },
    });
    const it = rowOf(o.truth, 'lags').items[0];
    assert.equal(it.id, 'sw1', 'il primo capo è il nodo che possiede le porte');
    assert.equal(it.peer, 'sw2', 'e il secondo pure');
    assert.equal(it.meta, 'Port-channel1', 'il nome del bundle resta quello del gruppo');
    assert.ok(!it.tag, 'ha porte: nessun avviso');
});

test('un gruppo rimasto SENZA porte lo dice, invece di ricavarsi un capo dalla chiave', () => {
    const o = buildOverview({
        types: TYPES, nodes: NODI(false), links: [],
        lagGroups: { 'lldp-lag-sw1||sw2': 'Port-channel1' },   // la chiave i capi ce li avrebbe
        lagMembers: {},
    });
    const it = rowOf(o.truth, 'lags').items[0];
    assert.equal(it.id, null, 'nessuna porta, nessun capo: non è un LAG, è un residuo');
    assert.equal(it.tag, 'noMembers');
});

// ── ② Tre schede per i LAG ────────────────────────────────────────────────

test('tre origini, tre schede, nell’ordine della notazione', () => {
    const o = buildOverview({
        types: TYPES, nodes: NODI(false), links: [],
        lagGroups: { 'snmp-lag-sw1-1': 'Po1', 'lldp-lag-sw1||sw2': 'Po2', 'lg-mio': 'Po3' },
        lagMembers: { 'snmp-lag-sw1-1': ['sw1'], 'lldp-lag-sw1||sw2': ['sw1', 'sw2'], 'lg-mio': ['sw2'] },
    });
    const r = rowOf(o.truth, 'lags');
    // ⚠️ L'ordine NON è quello di inserimento nel documento: le schede nascono
    // nell'ordine in cui i gruppi compaiono, e sul progetto del banco la prima
    // scheda aperta sarebbe stata «Dichiarato», cioè i sei gusci rimasti senza
    // porte. Vale l'ordine della notazione: prima il segno più portante.
    assert.deepEqual(r.items.map((i) => i.group), ['measured', 'declared', 'derived']);
    assert.deepEqual([r.extra.measured, r.extra.derived, r.extra.declared], [1, 1, 1],
        'un gruppo fatto a mano non è un dedotto: prima finiva contato lì');
    for (const it of r.items) {
        assert.ok(!it.tag, 'la scheda dice già l’origine: niente pastiglia che la ripete');
    }
});

// ── ③ Cinque schede per i cavi ────────────────────────────────────────────

const CAVI = [
    { id: 'l1', src: 'sw1-1', dst: 'sw2-1' },                                                          // dichiarato
    { id: 'l2', src: 'sw1-2', dst: 'sw2-2', autoLinked: true, protocol: 'LLDP', confidence: 0.95 },    // misurato
    { id: 'l3', src: 'sw1-3', dst: 'pc1-1', autoLinked: true, protocol: 'MAC', confidence: 0.7 },      // dedotto
    { id: 'l4', src: 'sw1-4', dst: 'pc1-2', autoLinked: true, protocol: 'MAC', confidence: 0.7, portDown: true },   // fantasma
    { id: 'l5', src: 'sw1-5', dst: 'sw2-5', miscabled: true },                                         // contraddetto
];
const gruppiDi = (o) => Object.fromEntries(rowOf(o.complete, 'cables').items.map((i) => [i.lid, i.group]));

test('dopo una Verifica: cinque schede, e le due che NON tornano vengono prima', () => {
    const g = gruppiDi(buildOverview({ types: TYPES, nodes: NODI(true), links: CAVI, spare: { totals: { used: 10 } } }));
    assert.equal(g.l1, 'declared', 'scritto da una persona, e niente lo contraddice');
    assert.equal(g.l2, 'measured', 'adiacenza LLDP confermata');
    assert.equal(g.l3, 'derived', 'inferenza dal MAC');
    assert.equal(g.l4, 'unread', 'il fantasma è un’ASSENZA di evidenza, non una contraddizione');
    assert.equal(g.l5, 'contradicted', 'la rete smentisce il cavo dichiarato');
});

test('il dettaglio elenca TUTTI i cavi, non i soli dedotti', () => {
    const r = rowOf(buildOverview({ types: TYPES, nodes: NODI(true), links: CAVI, spare: { totals: { used: 10 } } }).complete, 'cables');
    assert.equal(r.items.length, r.value, 'il numero grande e la lista contano la stessa cosa');
    assert.equal(r.items.length, 5);
});

test('l’ordine delle schede è quello della notazione, dal segno più portante al meno', () => {
    const items = rowOf(buildOverview({ types: TYPES, nodes: NODI(true), links: CAVI, spare: { totals: { used: 10 } } }).complete, 'cables').items;
    // ⚠️ Prima si controlla che una scheda CI SIA: senza questa riga la prova
    // passerebbe anche su una lista di voci senza gruppo — tutte a rango -1,
    // quindi «in ordine» — cioè sarebbe verde proprio sul codice che non divide.
    assert.ok(items.length && items.every((i) => CERTAINTY_GRADES.indexOf(i.group) >= 0),
        'ogni cavo sta in una scheda, e la scheda è un grado della notazione');
    const ranghi = items.map((i) => CERTAINTY_GRADES.indexOf(i.group));
    assert.deepEqual(ranghi.slice().sort((a, b) => a - b), ranghi, 'mai una scheda fuori ordine');
});

test('⚠️ SENZA Verifica restano tre schede: nessuno può dire fantasma di un cavo mai guardato', () => {
    const o = buildOverview({ types: TYPES, nodes: NODI(false), links: CAVI, spare: { totals: { used: 10 } } });
    const gruppi = new Set(rowOf(o.complete, 'cables').items.map((i) => i.group));
    assert.deepEqual([...gruppi].sort(), ['declared', 'derived', 'measured']);
    const g = gruppiDi(o);
    assert.equal(g.l4, 'derived', 'resta un dedotto: il fantasma è un esito della Verifica');
    assert.equal(g.l5, 'declared', 'e la contraddizione la scopre la Verifica, non la provenienza');
});

test('e la voce non ripete in pastiglia la parola della sua scheda', () => {
    const o = buildOverview({ types: TYPES, nodes: NODI(true), links: CAVI, spare: { totals: { used: 10 } } });
    for (const it of rowOf(o.complete, 'cables').items) {
        assert.ok(!it.proof, 'la scheda dice già come lo sappiamo: due volte era il difetto di prima');
    }
});
