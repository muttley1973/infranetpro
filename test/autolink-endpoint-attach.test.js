'use strict';
// ============================================================
//  ENDPOINT SU FDB — il livello 4 dell'auto-link, fissato PRIMA di spostarlo
// ============================================================
// `_autoDiscoverLinks` (src/app-autolink.js) è l'inferenza dei collegamenti L2. Il suo
// livello 4 prende ogni endpoint foglia (PC, stampante, UPS…) con un MAC noto, chiede a
// `_resolveEndpointSwitchPort` su quale porta di quale switch è appreso, e:
//   · se l'endpoint ha un cavo MANUALE, lo lascia stare e conta «manual-link»;
//   · se la porta è giusta, propone un cavo `MAC` con la confidenza della porta;
//   · se no, conta il MOTIVO — e se il motivo è «porta uplink» o «porta di transito» e
//     l'endpoint ha un cavo AUTO nato da un MAC (MAC, ARP-MAC, MAC+ARP), lo POTA.
//
// Nessuna prova guardava il livello dentro il Sync: `autolink-endpoint-confidence` prova il
// risolutore da solo, non cosa ne fa il ciclo. Queste fanno girare la funzione INTERA con un
// `fetch` finto che serve le tabelle FDB (la tecnica di autolink-dct e lag-non-si-inventa) e
// fissano l'esito finale — cavi, contatori, motivi — così spostare la DECISIONE in lib/ non
// può cambiare in silenzio ciò che il Sync produce.
//
// ⚠️ Il caso ⑫ è quello che conta di più: il ciclo NON è «decidi tutto, poi applica». La
// potatura di un endpoint riassegna `state.links`, e il risolutore dell'endpoint dopo rilegge
// quei cavi (`_isTransitPort` guarda i cavi della porta). Quindi il risultato dipende
// dall'ORDINE dei nodi. È un fatto di oggi, fissato com'è.
//
// ⚠️ I MAC «vicini» hanno prefissi di DUE caratteri (`d1`, `e1`): con un carattere solo
// `_normalizeFdbTable` li scarta e la porta sembrerebbe avere meno MAC di quanti ne ha.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

const mac = (pref, n) => `${pref}:${pref}:${pref}:${pref}:${pref}:${String(n).padStart(2, '0')}`;
const hosts = (pref, n) => Array.from({ length: n }, (_, i) => mac(pref, i + 1));
const sw = (id, n) => ({ id, type: 'switch', name: id.toUpperCase(), ports: 8, ip: `10.0.0.${n}`, snmpStatus: 'ok',
  integration: { driver: 'snmp-v2c', host: `10.0.0.${n}` } });
const pc = (id, m, extra) => Object.assign({ id, type: 'pc', name: id.toUpperCase(), ports: 1, mac: m }, extra || {});
const porta = (swId, k, ifName, extra) => [`${swId}-${k}`, Object.assign({ status: 'active', ifName }, extra || {})];
const apprese = (ifName, macs) => macs.map((m) => [m, ifName]);
const fdbDi = (...gruppi) => Object.fromEntries(gruppi.flat());
const cavo = (id, src, dst, extra) => Object.assign({ id, src, dst, autoLinked: true, confidence: 0.85, protocol: 'MAC' }, extra || {});
const manuale = (id, src, dst) => ({ id, src, dst });

const SW1 = sw('sw1', 1), SW2 = sw('sw2', 2);
const PA = mac('a1', 1), PB = mac('b1', 1);
const A = pc('pcA', PA), B = pc('pcB', PB);
const P1 = porta('sw1', 1, 'Gi1/1'), P2 = porta('sw1', 2, 'Gi1/2');
const F = (...g) => ({ sw1: fdbDi(...g) });
const UPLINK = hosts('d1', 4);                 // con PA fanno 5 MAC: oltre i 4, «porta uplink»

/**
 * Costruisce un progetto, serve `fdb[srcNodeId]` / `arp[srcNodeId]` a `/api/topology` ed esegue
 * UN giro di `_autoDiscoverLinks` sugli switch `giro`. Restituisce l'esito e lo stato finale.
 */
async function esegui({ nodes, ports = [], links = [], fdb = {}, arp = {}, giro = ['sw1'] }) {
  const APP = loadApp(ROOT);
  const ctx = APP.ctx;
  ctx.fetch = (url, opts) => {
    let src = '';
    try { src = JSON.parse((opts && opts.body) || '{}').srcNodeId || ''; } catch (_) { /* corpo non JSON */ }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      ok: true, neighbors: [], fdbTable: fdb[src] || {}, arpTable: arp[src] || {},
    }) });
  };
  // Il progetto dimostrativo di `_buildDefaultState` porta già i suoi switch e i suoi cavi:
  // qui serve un foglio bianco, o si misurerebbe lui.
  run(ctx, `
    state = _buildDefaultState();
    state.nodes.length = 0; state.links.length = 0; state.ports = {}; state.racks.length = 0;
    state.lagGroups = {};
    state.nodes.push(...${JSON.stringify(nodes)});
    Object.assign(state.ports, ${JSON.stringify(Object.fromEntries(ports))});
    state.links.push(...${JSON.stringify(links)});
    if(typeof _invalidateIdx==='function') _invalidateIdx();
  `);
  return JSON.parse(await run(ctx, `_autoDiscoverLinks(${JSON.stringify(giro)}).then(r => JSON.stringify({
    created: r.created, updated: r.updated, pruned: r.pruned, byProto: r.diag.byProto,
    reasons: r.diag.endpointReasons,
    links: state.links.map(l => ({ src: l.src, dst: l.dst, protocol: l.protocol || null, conf: l.confidence || null,
      auto: !!l.autoLinked }))
      .sort((a, b) => ((a.src + a.dst) < (b.src + b.dst) ? -1 : 1)),
  }))`));
}

const AUTO = (src, dst, protocol, conf) => ({ src, dst, protocol, conf, auto: true });
const MANUALE = (src, dst) => ({ src, dst, protocol: null, conf: null, auto: false });

// ── Il cavo nasce, con la confidenza della porta ─────────────────────────────

test('① un MAC solo sulla porta: cavo MAC a 0.85', async () => {
  const r = await esegui({ nodes: [SW1, A], ports: [P1], fdb: F(apprese('Gi1/1', [PA])) });
  assert.deepEqual(r.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.85)]);
  assert.equal(r.created, 1);
  assert.deepEqual(r.byProto, { MAC: 1 });
  assert.deepEqual(r.reasons, {}, 'niente da spiegare: l\'endpoint è stato collegato');
});

test('② due MAC (daisy-chain): ancora un cavo, a 0.80', async () => {
  const r = await esegui({ nodes: [SW1, A], ports: [P1], fdb: F(apprese('Gi1/1', [PA, ...hosts('d1', 1)])) });
  assert.deepEqual(r.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.8)]);
});

test('③ tre o quattro MAC: il candidato c\'è (0.68) ma è sotto soglia, nessun cavo', async () => {
  for (const n of [2, 3]) {
    const r = await esegui({ nodes: [SW1, A], ports: [P1], fdb: F(apprese('Gi1/1', [PA, ...hosts('d1', n)])) });
    assert.deepEqual(r.byProto, { MAC: 1 }, `${n + 1} MAC: il livello 4 propone`);
    assert.deepEqual(r.links, [], `${n + 1} MAC: sotto 0.80 il Sync non crea`);
    assert.equal(r.created, 0);
  }
});

// ── La porta non va bene: si conta il MOTIVO ─────────────────────────────────

test('④ cinque MAC sulla porta: «porta uplink», nessun candidato, nessun cavo', async () => {
  const r = await esegui({ nodes: [SW1, A], ports: [P1], fdb: F(apprese('Gi1/1', [PA, ...UPLINK])) });
  assert.deepEqual(r.reasons, { 'port-uplink': 1 });
  assert.deepEqual(r.byProto, {});
  assert.deepEqual(r.links, []);
  assert.equal(r.pruned, 0, 'niente da potare: non c\'era un cavo');
});

test('⑤ …e un cavo AUTO nato da un MAC su quella porta viene POTATO (MAC, ARP-MAC, MAC+ARP)', async () => {
  for (const protocol of ['MAC', 'ARP-MAC', 'MAC+ARP']) {
    const r = await esegui({ nodes: [SW1, A], ports: [P1], links: [cavo('l1', 'sw1-1', 'pcA-1', { protocol })],
      fdb: F(apprese('Gi1/1', [PA, ...UPLINK])) });
    assert.deepEqual(r.links, [], `${protocol}: il cavo non vale più`);
    assert.equal(r.pruned, 1, `${protocol}: è la potatura del livello 4`);
    assert.deepEqual(r.reasons, { 'port-uplink': 1 });
  }
});

test('⑥ …ma un cavo AUTO di altra origine (LLDP, MAC-WALLPORT, INFERRED) NON si pota', async () => {
  // La potatura riguarda solo i cavi nati da un MAC appreso: un cavo LLDP è una misura di un
  // altro tipo, e MAC-WALLPORT passa per una presa a muro — la FDB non lo contraddice.
  for (const [protocol, conf] of [['LLDP', 0.97], ['MAC-WALLPORT', 0.85], ['INFERRED', 0.85]]) {
    const r = await esegui({ nodes: [SW1, A], ports: [P1], links: [cavo('l1', 'sw1-1', 'pcA-1', { protocol, confidence: conf })],
      fdb: F(apprese('Gi1/1', [PA, ...UPLINK])) });
    assert.deepEqual(r.links, [AUTO('pcA-1', 'sw1-1', protocol, conf)], `${protocol}: resta`);
    assert.equal(r.pruned, 0, protocol);
    assert.deepEqual(r.reasons, { 'port-uplink': 1 }, `${protocol}: il motivo si conta lo stesso`);
  }
});

test('⑦ un cavo MANUALE non si tocca mai: si conta «manual-link», anche su una porta uplink', async () => {
  const solo = await esegui({ nodes: [SW1, A], ports: [P1], links: [manuale('l1', 'sw1-1', 'pcA-1')],
    fdb: F(apprese('Gi1/1', [PA])) });
  assert.deepEqual(solo.links, [MANUALE('pcA-1', 'sw1-1')]);
  assert.deepEqual(solo.reasons, { 'manual-link': 1 });
  assert.deepEqual(solo.byProto, {}, 'il risolutore non viene nemmeno interpellato');

  const uplink = await esegui({ nodes: [SW1, A], ports: [P1], links: [manuale('l1', 'sw1-1', 'pcA-1')],
    fdb: F(apprese('Gi1/1', [PA, ...UPLINK])) });
  assert.deepEqual(uplink.links, [MANUALE('pcA-1', 'sw1-1')], 'la potatura non arriva a un cavo manuale');
  assert.deepEqual(uplink.reasons, { 'manual-link': 1 }, 'e il motivo NON è port-uplink: il manuale chiude prima');
  assert.equal(uplink.pruned, 0);
});

test('⑧ porta di TRANSITO (trunk, uplink di rack, LAG, interfaccia aggregata): «port-trunk», e si pota', async () => {
  const casi = [
    ['porta trunk', porta('sw1', 1, 'Gi1/1', { isTrunk: true }), 'Gi1/1'],
    ['uplink di rack', porta('sw1', 1, 'Gi1/1', { sharedSegmentRole: 'rackuplink' }), 'Gi1/1'],
    ['gruppo LAG SNMP', porta('sw1', 1, 'Gi1/1', { lagGroup: 'snmp-lag-sw1-1' }), 'Gi1/1'],
    ['interfaccia aggregata (Po1) che il progetto non modella', P1, 'Po1'],
  ];
  for (const [nome, p, ifName] of casi) {
    const con = await esegui({ nodes: [SW1, A], ports: [p], links: [cavo('l1', 'sw1-1', 'pcA-1')],
      fdb: F(apprese(ifName, [PA])) });
    assert.deepEqual(con.links, [], `${nome}: il cavo auto viene potato`);
    assert.equal(con.pruned, 1, nome);
    assert.deepEqual(con.reasons, { 'port-trunk': 1 }, nome);
    const senza = await esegui({ nodes: [SW1, A], ports: [p], fdb: F(apprese(ifName, [PA])) });
    assert.deepEqual(senza.reasons, { 'port-trunk': 1 }, `${nome}: senza cavo si conta solo il motivo`);
    assert.deepEqual(senza.links, []);
    assert.equal(senza.pruned, 0);
  }
});

test('⑨ MAC assente dalla FDB, o porta che il progetto non conosce: si conta, e il cavo auto RESTA', async () => {
  // Non è che la porta sia sbagliata: manca l'evidenza. Potare qui sarebbe cancellare un
  // cavo perché lo switch non risponde.
  const assente = await esegui({ nodes: [SW1, A], ports: [P1], links: [cavo('l1', 'sw1-1', 'pcA-1')],
    fdb: F(apprese('Gi1/1', [PB])) });
  assert.deepEqual(assente.reasons, { 'mac-not-in-fdb': 1 });
  assert.deepEqual(assente.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.85)]);
  assert.equal(assente.pruned, 0);

  const ignota = await esegui({ nodes: [SW1, A], ports: [P1], links: [cavo('l1', 'sw1-1', 'pcA-1')],
    fdb: F(apprese('Foo9/9', [PA])) });
  assert.deepEqual(ignota.reasons, { 'port-not-found': 1 });
  assert.deepEqual(ignota.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.85)]);
  assert.equal(ignota.pruned, 0);
});

test('⑩ un apparato che non è un endpoint foglia, e un endpoint senza MAC, il livello non li guarda', async () => {
  const server = Object.assign(pc('srv', mac('e1', 1)), { type: 'server', ports: 4 });
  const r = await esegui({ nodes: [SW1, server, pc('nomac', ''), A], ports: [P1],
    fdb: F(apprese('Gi1/1', [mac('e1', 1), PA])) });
  assert.deepEqual(r.reasons, {}, 'né «no-mac» né altro: sono scartati prima di contare');
  assert.deepEqual(r.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.8)], 'il server conta come MAC vicino sulla porta (2 MAC → 0.80)');
});

// ── Più di uno switch vede lo stesso MAC ────────────────────────────────────

test('⑪ due switch vedono lo stesso endpoint: ambiguo se i punteggi sono vicini, altrimenti vince il migliore', async () => {
  const base = { nodes: [SW1, SW2, A], ports: [P1, porta('sw2', 1, 'Gi2/1')], giro: ['sw1', 'sw2'] };
  const pari = await esegui({ ...base, fdb: { sw1: fdbDi(apprese('Gi1/1', [PA])), sw2: fdbDi(apprese('Gi2/1', [PA])) } });
  assert.deepEqual(pari.reasons, { 'mac-multi-switch': 1 });
  assert.deepEqual(pari.links, []);
  const vicino = await esegui({ ...base, fdb: { sw1: fdbDi(apprese('Gi1/1', [PA])), sw2: fdbDi(apprese('Gi2/1', [PA, ...hosts('d1', 5)])) } });
  assert.deepEqual(vicino.reasons, { 'mac-multi-switch': 1 }, 'un solo punto di scarto: ancora ambiguo');
  const lontano = await esegui({ ...base, fdb: { sw1: fdbDi(apprese('Gi1/1', [PA])), sw2: fdbDi(apprese('Gi2/1', [PA, ...hosts('d1', 30)])) } });
  assert.deepEqual(lontano.reasons, {});
  assert.deepEqual(lontano.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.85)], 'sw2 ha troppi MAC: l\'endpoint è su sw1');
});

// ── L'ordine dei nodi fa parte del risultato ────────────────────────────────

test('⑫ la potatura di un endpoint cambia ciò che vede il SUCCESSIVO: l\'ordine dei nodi conta', async () => {
  // Il cavo di pcA sulla porta Gi1/1 è in modalità trunk, quindi `_isTransitPort` dice che la
  // porta è di transito finché quel cavo esiste. pcA e pcB sono appresi entrambi su Gi1/1.
  //   · A prima di B: pcA vede la porta di transito → «port-trunk» e il suo cavo viene
  //     POTATO; ora pcB guarda la porta senza quel cavo, non è più di transito → si collega.
  //   · B prima di A: pcB guarda la porta quando il cavo c'è ancora → «port-trunk»; poi
  //     pcA, potato. Nessun cavo nasce.
  // Un ciclo «decidi tutto, poi applica» darebbe lo stesso esito in entrambi gli ordini, e
  // sarebbe una modifica del comportamento.
  const comune = { ports: [P1], links: [cavo('l1', 'sw1-1', 'pcA-1', { mode: 'trunk' })], fdb: F(apprese('Gi1/1', [PA, PB])) };
  const ab = await esegui({ ...comune, nodes: [SW1, A, B] });
  assert.deepEqual(ab.links, [AUTO('pcB-1', 'sw1-1', 'MAC', 0.8)]);
  assert.deepEqual(ab.reasons, { 'port-trunk': 1 });
  assert.equal(ab.pruned, 1);
  assert.equal(ab.created, 1);

  const ba = await esegui({ ...comune, nodes: [SW1, B, A] });
  assert.deepEqual(ba.links, []);
  assert.deepEqual(ba.reasons, { 'port-trunk': 2 });
  assert.equal(ba.pruned, 1);
  assert.equal(ba.created, 0);
});

// ── Più cavi sullo stesso endpoint: conta il PRIMO che tocca la porta ────────

test('⑬ il cavo che decide è il PRIMO della lista che tocca la porta dell\'endpoint', async () => {
  // auto poi manuale: il primo è auto, quindi il livello non si ferma al manuale — e il
  // passaggio finale, dopo, tiene il manuale e toglie il resto.
  const autoPoi = await esegui({ nodes: [SW1, A], ports: [P1, P2],
    links: [cavo('l1', 'sw1-2', 'pcA-1'), manuale('l2', 'sw1-3', 'pcA-1')], fdb: F(apprese('Gi1/1', [PA])) });
  assert.deepEqual(autoPoi.reasons, {});
  assert.equal(autoPoi.created, 1);
  assert.deepEqual(autoPoi.links, [MANUALE('pcA-1', 'sw1-3')]);

  // manuale poi auto: il primo è il manuale, e il livello conta «manual-link» e passa oltre.
  const manualePoi = await esegui({ nodes: [SW1, A], ports: [P1, P2],
    links: [manuale('l2', 'sw1-3', 'pcA-1'), cavo('l1', 'sw1-2', 'pcA-1')], fdb: F(apprese('Gi1/1', [PA])) });
  assert.deepEqual(manualePoi.reasons, { 'manual-link': 1 });
  assert.equal(manualePoi.created, 0);
  assert.deepEqual(manualePoi.links, [MANUALE('pcA-1', 'sw1-3')]);

  // due cavi auto su porta uplink: si pota SOLO il primo (quello che il livello ha trovato).
  const due = await esegui({ nodes: [SW1, A], ports: [P1, P2],
    links: [cavo('l1', 'sw1-2', 'pcA-1'), cavo('l3', 'sw1-3', 'pcA-1')], fdb: F(apprese('Gi1/1', [PA, ...UPLINK])) });
  assert.equal(due.pruned, 1);
  assert.deepEqual(due.links, [AUTO('pcA-1', 'sw1-3', 'MAC', 0.85)]);
});

// ── Con l'ARP, e quando l'endpoint si è spostato ────────────────────────────

test('⑭ con ARP il cavo resta MAC; se la porta dell\'endpoint ha il MAC documentato, vince MAC+ARP (livello 3, per primo)', async () => {
  const ip = { ip: '10.0.1.5' };
  const arp = { sw1: { [PA]: '10.0.1.5' } };
  // Il MAC dell'endpoint è nell'FDB e nell'ARP, ma la porta `pcA-1` non lo dichiara: il
  // livello 3 non lo riconosce (nessun `remEntry`) e il cavo lo propone il livello 4.
  const senza = await esegui({ nodes: [SW1, pc('pcA', PA, ip)], ports: [P1], fdb: F(apprese('Gi1/1', [PA])), arp });
  assert.deepEqual(senza.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.85)]);
  // Se la porta dell'endpoint porta il MAC, è il livello 3 a proporre — a 0.90, MAC+ARP — e
  // il livello 4 propone la stessa coppia a 0.85: più bassa, quindi non sostituisce.
  const con = await esegui({ nodes: [SW1, pc('pcA', PA, ip)], ports: [P1, ['pcA-1', { mac: PA }]], fdb: F(apprese('Gi1/1', [PA])), arp });
  assert.deepEqual(con.links, [AUTO('pcA-1', 'sw1-1', 'MAC+ARP', 0.9)]);
  assert.deepEqual(con.byProto, { 'MAC+ARP': 1 });
});

test('⑮ l\'endpoint si è spostato: il cavo nuovo nasce e quello vecchio RESTA (fatto di oggi)', async () => {
  // Il livello 4 propone il cavo sulla porta dove il MAC è appreso adesso; non toglie quello
  // sulla porta di prima, perché «la porta di prima» non è un motivo che il livello conosca.
  // Fissato com'è: se un giorno si decide di togliere il vecchio, è una modifica voluta.
  const r = await esegui({ nodes: [SW1, A], ports: [P1, P2], links: [cavo('l1', 'sw1-2', 'pcA-1')],
    fdb: F(apprese('Gi1/1', [PA])) });
  assert.deepEqual(r.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.85), AUTO('pcA-1', 'sw1-2', 'MAC', 0.85)]);
  assert.equal(r.created, 1);
});

test('⑯ più endpoint nello stesso giro: ognuno col suo cavo, ognuno con la sua potatura', async () => {
  const due = await esegui({ nodes: [SW1, A, B], ports: [P1, P2],
    fdb: F(apprese('Gi1/1', [PA]), apprese('Gi1/2', [PB])) });
  assert.deepEqual(due.links, [AUTO('pcA-1', 'sw1-1', 'MAC', 0.85), AUTO('pcB-1', 'sw1-2', 'MAC', 0.85)]);
  assert.equal(due.created, 2);

  const potati = await esegui({ nodes: [SW1, A, B], ports: [P1, P2],
    links: [cavo('l1', 'sw1-1', 'pcA-1'), cavo('l2', 'sw1-2', 'pcB-1')],
    fdb: F(apprese('Gi1/1', [PA, ...UPLINK]), apprese('Gi1/2', [PB, ...hosts('e1', 4)])) });
  assert.deepEqual(potati.links, []);
  assert.equal(potati.pruned, 2, 'il contatore somma le potature di tutti gli endpoint');
  assert.deepEqual(potati.reasons, { 'port-uplink': 2 });
});

// ============================================================
//  La funzione pura (lib/endpoint-attach.js), sui suoi dati
// ============================================================
// Le prove sopra la fanno girare dentro `_autoDiscoverLinks`; queste la guardano da sola, così un
// cambio alla regola di decisione si vede senza montare un progetto intero.
const { endpointAttachDecision } = require('../lib/endpoint-attach.js');

/** Un risolutore finto che conta le chiamate. */
const risolutore = (esito) => { const f = () => { f.chiamate++; return esito; }; f.chiamate = 0; return f; };
const OK = { ok: true, swPid: 'sw1-1', confidence: 0.85 };
const NO = (reason) => ({ ok: false, reason });

test('P1 cavo manuale → resta com\'è, e il risolutore NON viene interpellato', () => {
  const ris = risolutore(OK);
  assert.deepEqual(endpointAttachDecision({ id: 'l1', src: 'sw1-1', dst: 'pcA-1' }, ris), { action: 'keep-manual' });
  assert.equal(ris.chiamate, 0, 'un cavo scritto da una persona non si discute con la FDB');
  // «manuale» è l'assenza di `autoLinked`, non un valore: anche `false` lo è.
  assert.deepEqual(endpointAttachDecision({ autoLinked: false }, ris), { action: 'keep-manual' });
  assert.equal(ris.chiamate, 0);
});

test('P2 porta giusta → un candidato MAC con la porta e la confidenza del risolutore', () => {
  const ris = risolutore({ ok: true, swPid: 'sw9-4', confidence: 0.8 });
  assert.deepEqual(endpointAttachDecision(undefined, ris), { action: 'propose', swPid: 'sw9-4', confidence: 0.8, protocol: 'MAC' });
  assert.equal(ris.chiamate, 1, 'si interpella il risolutore una volta sola');
  // anche con un cavo auto già presente: il candidato lo aggiorna, la decisione non cambia
  assert.deepEqual(endpointAttachDecision({ autoLinked: true, protocol: 'LLDP' }, risolutore(OK)),
    { action: 'propose', swPid: 'sw1-1', confidence: 0.85, protocol: 'MAC' });
});

test('P3 porta sbagliata, senza cavo → solo il motivo, mai una potatura', () => {
  for (const reason of ['port-uplink', 'port-trunk', 'mac-not-in-fdb', 'port-not-found', 'mac-multi-switch']) {
    assert.deepEqual(endpointAttachDecision(undefined, risolutore(NO(reason))), { action: 'reject', reason, prune: false }, reason);
  }
});

test('P4 si pota solo con un motivo di PORTA e un cavo auto nato da un MAC', () => {
  const protocolli = ['MAC', 'ARP-MAC', 'MAC+ARP', 'LLDP', 'CDP', 'MAC-WALLPORT', 'INFERRED', 'MAC-UPLINK', 'FDB-DCT', undefined];
  const nati = new Set(['MAC', 'ARP-MAC', 'MAC+ARP']);
  for (const reason of ['port-uplink', 'port-trunk']) {
    for (const protocol of protocolli) {
      const d = endpointAttachDecision({ autoLinked: true, protocol }, risolutore(NO(reason)));
      assert.equal(d.prune, nati.has(protocol), `${reason} con cavo ${protocol}`);
    }
  }
  // un motivo di assenza di evidenza, o di ambiguità, non pota mai — nemmeno un cavo MAC
  for (const reason of ['mac-not-in-fdb', 'port-not-found', 'mac-multi-switch', 'no-mac', undefined]) {
    const d = endpointAttachDecision({ autoLinked: true, protocol: 'MAC' }, risolutore(NO(reason)));
    assert.equal(d.prune, false, String(reason));
  }
});

test('P5 il motivo passa com\'è, anche se manca: è il chiamante a decidere se contarlo', () => {
  assert.deepEqual(endpointAttachDecision(undefined, risolutore({ ok: false })), { action: 'reject', reason: undefined, prune: false });
});

test('P6 non tocca il cavo che riceve', () => {
  const ex = Object.freeze({ id: 'l1', src: 'sw1-1', dst: 'pcA-1', autoLinked: true, protocol: 'MAC' });
  assert.doesNotThrow(() => endpointAttachDecision(ex, risolutore(NO('port-uplink'))));
  assert.doesNotThrow(() => endpointAttachDecision(ex, risolutore(OK)));
});
