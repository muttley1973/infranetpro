'use strict';
// ============================================================
//  DIRECT CONNECTION THEOREM — il livello 5 dell'auto-link, fissato PRIMA di spostarlo
// ============================================================
// `_autoDiscoverLinks` (src/app-autolink.js) è l'inferenza dei collegamenti L2 e pesa un
// migliaio di righe nel glue del frontend. Il livello 5 (Lowekamp et al., SIGCOMM 2001)
// deduce un cavo switch↔switch dalle MAC table, anche senza LLDP/CDP: due porte sono
// collegate se gli insiemi di MAC appresi dietro l'una e dietro l'altra sono
// COMPLEMENTARI, cioè non condividono niente (esclusi i MAC dei due switch).
//
// Nessuna prova guardava questo livello: «FDB-DCT» compariva nei test solo come stringa
// in una lista di protocolli inferiti. Queste prove lo fanno girare DAVVERO, attraverso
// la funzione intera, con un `fetch` finto che serve le tabelle FDB — la stessa tecnica
// di test/lag-non-si-inventa.test.js — e fissano l'esito, così lo spostamento del
// livello in lib/ non può cambiare in silenzio ciò che il Sync produce.
//
// Misurate sul codice PRIMA dello spostamento (le attese qui sotto sono quelle misure,
// e ognuna è anche ragionata: il commento dice perché).
//
// ⚠️ Le porte portano ≥5 MAC dove serve isolare il livello 5: il livello 3 (FDB
// client) tace oltre i 4 MAC per porta, quindi l'unico candidato che resta è quello del
// teorema. Dove i MAC sono pochi (pareggio) la prova serve proprio a vedere chi arriva
// per primo.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

const mac = (pref, n) => `${pref}:${pref}:${pref}:${pref}:${pref}:${String(n).padStart(2, '0')}`;
const hosts = (pref, n) => Array.from({ length: n }, (_, i) => mac(pref, i + 1));
const sw = (id, m) => ({ id, mac: m, ifs: [1, 2, 3].map((k) => `Gi${id.slice(2)}/${k}`) });
const apprese = (ifName, macs) => macs.map((m) => [m, ifName]);
const fdbDi = (...gruppi) => Object.fromEntries(gruppi.flat());

const S1 = sw('sw1', mac('aa', 1));
const S2 = sw('sw2', mac('bb', 1));
const S3 = sw('sw3', mac('cc', 1));

/**
 * Costruisce un progetto con gli switch dati, serve `fdb[srcNodeId]` a `/api/topology`
 * ed esegue un giro di `_autoDiscoverLinks` per ogni elemento di `giri` (null = tutti).
 * `conMac`: la prima porta di ogni switch porta il MAC dello switch (ifPhysAddress);
 * uno switch con `senzaMac` non lo porta (un apparato che non lo espone).
 */
async function esegui({ switches, fdb, conMac = true, giri = [null] }) {
  const APP = loadApp(ROOT);
  const ctx = APP.ctx;
  ctx.fetch = (url, opts) => {
    let src = '';
    try { src = JSON.parse((opts && opts.body) || '{}').srcNodeId || ''; } catch (_) { /* corpo non JSON */ }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      ok: true, neighbors: [], fdbTable: fdb[src] || {}, arpTable: {},
    }) });
  };
  const nodes = switches.map((s, i) => ({ id: s.id, type: 'switch', name: s.id.toUpperCase(), ports: 8,
    ip: `10.0.0.${i + 1}`, snmpStatus: 'ok', integration: { driver: 'snmp-v2c', host: `10.0.0.${i + 1}` } }));
  const ports = {};
  for (const s of switches) {
    s.ifs.forEach((ifn, k) => {
      ports[`${s.id}-${k + 1}`] = Object.assign({ status: 'active', ifName: ifn }, (conMac && !s.senzaMac && k === 0) ? { mac: s.mac } : {});
    });
  }
  // Il progetto dimostrativo di `_buildDefaultState` porta già i suoi switch e i suoi cavi:
  // qui serve un foglio bianco, o si misurerebbe lui.
  run(ctx, `
    state = _buildDefaultState();
    state.nodes.length = 0; state.links.length = 0; state.ports = {}; state.racks.length = 0;
    state.lagGroups = {};
    state.nodes.push(...${JSON.stringify(nodes)});
    Object.assign(state.ports, ${JSON.stringify(ports)});
    if(typeof _invalidateIdx==='function') _invalidateIdx();
  `);
  let esito;
  for (const g of giri) {
    esito = JSON.parse(await run(ctx, `_autoDiscoverLinks(${JSON.stringify(g)}).then(r => JSON.stringify({
      created: r.created, byProto: r.diag.byProto,
      links: state.links.map(l => ({ src: l.src, dst: l.dst, protocol: l.protocol, conf: l.confidence }))
        .sort((a, b) => (a.src + a.dst) < (b.src + b.dst) ? -1 : 1),
    }))`));
  }
  return esito;
}

const DUE = {
  sw1: fdbDi(apprese('Gi1/1', [S2.mac, ...hosts('d1', 4)])),
  sw2: fdbDi(apprese('Gi2/1', [S1.mac, ...hosts('d2', 4)])),
};

test('① due switch con MAC complementari: il teorema li collega, a 0.85, protocollo FDB-DCT', async () => {
  const r = await esegui({ switches: [S1, S2], fdb: DUE });
  assert.deepEqual(r.links, [{ src: 'sw1-1', dst: 'sw2-1', protocol: 'FDB-DCT', conf: 0.85 }]);
  assert.deepEqual(r.byProto, { 'FDB-DCT': 1 }, 'è l\'UNICO candidato: il livello 3 tace oltre i 4 MAC per porta');
});

test('② lo stesso host dietro ENTRAMBE le porte: c\'è qualcosa in mezzo, nessun cavo', async () => {
  const comune = mac('ee', 1);
  const r = await esegui({ switches: [S1, S2], fdb: {
    sw1: fdbDi(apprese('Gi1/1', [S2.mac, comune, ...hosts('d1', 3)])),
    sw2: fdbDi(apprese('Gi2/1', [S1.mac, comune, ...hosts('d2', 3)])),
  } });
  assert.deepEqual(r.links, [], 'un MAC visto da due lati non è dietro un cavo diretto');
  assert.deepEqual(r.byProto, {});
});

test('②b i MAC degli switch STESSI non contano come intersezione', async () => {
  // Dietro la porta di sw1 compare anche il MAC di sw1 (un'eco, un ritorno): lo vede anche
  // sw2, ma è il MAC di uno dei due capi, non di qualcosa IN MEZZO. Senza l'esclusione
  // dei MAC dei due switch, questo cavo vero verrebbe scartato.
  const r = await esegui({ switches: [S1, S2], fdb: {
    sw1: fdbDi(apprese('Gi1/1', [S2.mac, S1.mac, ...hosts('d1', 4)])),
    sw2: fdbDi(apprese('Gi2/1', [S1.mac, ...hosts('d2', 4)])),
  } });
  assert.deepEqual(r.links, [{ src: 'sw1-1', dst: 'sw2-1', protocol: 'FDB-DCT', conf: 0.85 }]);
});

test('③ catena sw1—sw2—sw3: i due cavi veri, e NON il falso sw1—sw3', async () => {
  // sw1 e sw3 si vedono (i MAC attraversano sw2) ma dietro le loro porte c'è lo STESSO
  // sw2: l'intersezione non è vuota, quindi non sono collegati direttamente.
  const r = await esegui({ switches: [S1, S2, S3], fdb: {
    sw1: fdbDi(apprese('Gi1/1', [S2.mac, S3.mac, ...hosts('d2', 4), ...hosts('d3', 4)])),
    sw2: fdbDi(apprese('Gi2/1', [S1.mac, ...hosts('d1', 4)]), apprese('Gi2/2', [S3.mac, ...hosts('d3', 4)])),
    sw3: fdbDi(apprese('Gi3/1', [S2.mac, S1.mac, ...hosts('d2', 4), ...hosts('d1', 4)])),
  } });
  assert.deepEqual(r.links, [
    { src: 'sw1-1', dst: 'sw2-1', protocol: 'FDB-DCT', conf: 0.85 },
    { src: 'sw2-2', dst: 'sw3-1', protocol: 'FDB-DCT', conf: 0.85 },
  ]);
});

test('④ senza i MAC degli switch il teorema non ha di che confrontare: nessun cavo', async () => {
  const r = await esegui({ switches: [S1, S2], fdb: DUE, conMac: false });
  assert.deepEqual(r.links, [], 'servono i MAC dei DUE switch (ifPhysAddress delle loro porte)');
});

test('④b uno switch senza MAC noto, in mezzo agli altri, non ferma il confronto fra gli altri due', async () => {
  // sw3 viene PRIMA di sw2 nell'ordine delle tabelle: la coppia sw1—sw3 non ha i MAC di sw3
  // e va saltata, e il ciclo deve proseguire con sw1—sw2. Se quel salto diventasse
  // un'eccezione, il confronto si fermerebbe per tutte le coppie rimaste.
  const muto = Object.assign(sw('sw3', mac('cc', 1)), { senzaMac: true });
  const r = await esegui({ switches: [S1, muto, S2], fdb: {
    sw1: fdbDi(apprese('Gi1/1', [S2.mac, ...hosts('d1', 4)])),
    sw3: fdbDi(apprese('Gi3/1', hosts('d3', 5))),
    sw2: fdbDi(apprese('Gi2/1', [S1.mac, ...hosts('d2', 4)])),
  } });
  assert.deepEqual(r.links, [{ src: 'sw1-1', dst: 'sw2-1', protocol: 'FDB-DCT', conf: 0.85 }]);
});

test('⑤ pareggio a 0.85 col livello 3: resta il protocollo arrivato PER PRIMO (MAC)', async () => {
  // Un MAC per porta: il livello 3 propone la coppia a 0.85 con protocollo MAC, poi il
  // teorema la propone di nuovo a 0.85. L'insieme dei candidati sostituisce solo con una
  // confidenza STRETTAMENTE maggiore, quindi l'ordine dei livelli decide l'etichetta:
  // spostare il livello 5 prima del 3 la cambierebbe in FDB-DCT.
  const r = await esegui({ switches: [S1, S2], fdb: {
    sw1: fdbDi(apprese('Gi1/1', [S2.mac])),
    sw2: fdbDi(apprese('Gi2/1', [S1.mac])),
  } });
  assert.deepEqual(r.links, [{ src: 'sw1-1', dst: 'sw2-1', protocol: 'MAC', conf: 0.85 }]);
  assert.deepEqual(r.byProto, { MAC: 1 });
});

test('⑥ un ifName che il progetto non conosce non diventa un cavo', async () => {
  const r = await esegui({ switches: [S1, S2], fdb: {
    sw1: fdbDi(apprese('Foo9/9', [S2.mac, ...hosts('d1', 4)])),
    sw2: fdbDi(apprese('Gi2/1', [S1.mac, ...hosts('d2', 4)])),
  } });
  assert.deepEqual(r.links, [], 'il teorema trova la coppia ma non sa a quale porta del progetto appartiene');
});

test('⑦ usa anche la cache FDB di un giro PRECEDENTE (switch non interrogato ora)', async () => {
  // L'ingresso del teorema è `store._topoFdbCache`, che sopravvive fra un Sync e l'altro:
  // sw2 interrogato prima, sw1 dopo — il cavo nasce al secondo giro, con la tabella di sw2
  // letta dalla cache.
  const dopo = await esegui({ switches: [S1, S2], fdb: DUE, giri: [['sw2'], ['sw1']] });
  assert.deepEqual(dopo.links, [{ src: 'sw1-1', dst: 'sw2-1', protocol: 'FDB-DCT', conf: 0.85 }]);
});

test('⑧ …e senza quella cache, con un solo switch interrogato, non c\'è niente da confrontare', async () => {
  const solo = await esegui({ switches: [S1, S2], fdb: DUE, giri: [['sw1']] });
  assert.deepEqual(solo.links, []);
});

// ============================================================
//  La funzione pura (lib/direct-connection.js), sui suoi dati
// ============================================================
// Le prove sopra la fanno girare dentro `_autoDiscoverLinks`; queste la guardano da sola,
// così un cambio alla sua logica si vede senza montare un progetto intero.
const { directConnectionPairs } = require('../lib/direct-connection.js');

const MM = (...voci) => Object.fromEntries(voci.map(([m, nodeId]) => [m, { nodeId }]));
const A1 = mac('aa', 1), B1 = mac('bb', 1), C1 = mac('cc', 1);
const profondoCongelato = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object') profondoCongelato(v); });
  return Object.freeze(o);
};

test('P1 due switch con MAC complementari → una coppia, con l\'ifName di ciascuno', () => {
  const r = directConnectionPairs(MM([A1, 'sw1'], [B1, 'sw2']), {
    sw1: { [B1]: 'Gi1/1', [mac('d1', 1)]: 'Gi1/1' },
    sw2: { [A1]: 'Gi2/1', [mac('d2', 1)]: 'Gi2/1' },
  });
  assert.deepEqual(r, [{ a: 'sw1', b: 'sw2', ifA: 'Gi1/1', ifB: 'Gi2/1' }]);
});

test('P2 un MAC dietro entrambe le porte → nessuna coppia', () => {
  const r = directConnectionPairs(MM([A1, 'sw1'], [B1, 'sw2']), {
    sw1: { [B1]: 'Gi1/1', [mac('ee', 1)]: 'Gi1/1' },
    sw2: { [A1]: 'Gi2/1', [mac('ee', 1)]: 'Gi2/1' },
  });
  assert.deepEqual(r, []);
});

test('P3 i MAC dei due switch stessi non contano come intersezione', () => {
  const r = directConnectionPairs(MM([A1, 'sw1'], [B1, 'sw2']), {
    sw1: { [B1]: 'Gi1/1', [A1]: 'Gi1/1' },       // l'eco del MAC di sw1 dietro la sua stessa porta
    sw2: { [A1]: 'Gi2/1' },
  });
  assert.equal(r.length, 1);
});

test('P4 catena di tre switch → le due coppie vere, nell\'ordine delle tabelle, mai la terza', () => {
  const r = directConnectionPairs(MM([A1, 'sw1'], [B1, 'sw2'], [C1, 'sw3']), {
    sw1: { [B1]: 'Gi1/1', [C1]: 'Gi1/1' },
    sw2: { [A1]: 'Gi2/1', [C1]: 'Gi2/2' },
    sw3: { [B1]: 'Gi3/1', [A1]: 'Gi3/1' },
  });
  assert.deepEqual(r, [
    { a: 'sw1', b: 'sw2', ifA: 'Gi1/1', ifB: 'Gi2/1' },
    { a: 'sw2', b: 'sw3', ifA: 'Gi2/2', ifB: 'Gi3/1' },
  ]);
});

test('P5 uno switch di cui non si conoscono i MAC viene saltato, gli altri restano', () => {
  const r = directConnectionPairs(MM([A1, 'sw1'], [B1, 'sw2']), {
    sw1: { [B1]: 'Gi1/1' },
    sw3: { [mac('d3', 1)]: 'Gi3/1' },            // sw3 non ha MAC in macMap
    sw2: { [A1]: 'Gi2/1' },
  });
  assert.deepEqual(r, [{ a: 'sw1', b: 'sw2', ifA: 'Gi1/1', ifB: 'Gi2/1' }]);
});

test('P6 il MAC di una FDB si legge in minuscolo, come le chiavi di macMap', () => {
  const r = directConnectionPairs(MM([A1, 'sw1'], [B1, 'sw2']), {
    sw1: { [B1.toUpperCase()]: 'Gi1/1' },
    sw2: { [A1.toUpperCase()]: 'Gi2/1' },
  });
  assert.equal(r.length, 1);
});

test('P7 l\'ordine delle coppie e dei capi segue quello delle chiavi di fdbCache', () => {
  // Conta: l'insieme dei candidati tiene il PRIMO a parità di confidenza, e quale capo sta
  // in `a` decide quale porta è `src` del cavo.
  const fdb = { sw2: { [A1]: 'Gi2/1' }, sw1: { [B1]: 'Gi1/1' } };
  const r = directConnectionPairs(MM([A1, 'sw1'], [B1, 'sw2']), fdb);
  assert.deepEqual(r, [{ a: 'sw2', b: 'sw1', ifA: 'Gi2/1', ifB: 'Gi1/1' }]);
});

test('P8 se due porte vedono lo stesso switch (due suoi MAC) vince la PRIMA letta', () => {
  // sw2 ha due MAC, appresi da sw1 su due porte diverse: la porta scelta è la prima nell'ordine
  // della tabella, e con l'ordine opposto cambia. È un fatto di oggi, fissato.
  const B2 = mac('bb', 2);
  const mm = MM([A1, 'sw1'], [B1, 'sw2'], [B2, 'sw2']);
  const r = directConnectionPairs(mm, { sw1: { [B1]: 'Gi1/1', [B2]: 'Gi1/2' }, sw2: { [A1]: 'Gi2/1' } });
  assert.equal(r[0].ifA, 'Gi1/1');
  const r2 = directConnectionPairs(mm, { sw1: { [B2]: 'Gi1/2', [B1]: 'Gi1/1' }, sw2: { [A1]: 'Gi2/1' } });
  assert.equal(r2[0].ifA, 'Gi1/2');
});

test('P9 non tocca i suoi ingressi, e con ingressi vuoti non produce niente', () => {
  const macMap = profondoCongelato(MM([A1, 'sw1'], [B1, 'sw2']));
  const fdb = profondoCongelato({ sw1: { [B1]: 'Gi1/1' }, sw2: { [A1]: 'Gi2/1' } });
  assert.doesNotThrow(() => directConnectionPairs(macMap, fdb));   // in strict mode, scrivere su un oggetto congelato lancia
  assert.deepEqual(directConnectionPairs({}, {}), []);
  assert.deepEqual(directConnectionPairs(MM([A1, 'sw1']), {}), []);
});
