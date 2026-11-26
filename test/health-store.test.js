'use strict';
// ============================================================
// HEALTH STORE — salute delle interfacce: forma, fusione e differenze
// ============================================================
// Ogni caso sta qui perche' una versione sbagliata direbbe una cosa FALSA ma plausibile:
//   • un contatore non letto che diventa zero;
//   • un reboot o un `clear counters` letti come «nessun errore nuovo» (o, peggio, come un giro di Counter32);
//   • la stessa lettura rimandata due volte che cancella la differenza;
//   • un client ostile che gonfia il file o ci scrive dentro un nome di chiave.
// Le letture sono SINTETICHE (scritte a mano nel test, non catturate da un apparato).
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../lib/port-live.js');
const H = require('../lib/health-store.js');

// Una riga di interfaccia completa; `o` sovrascrive.
function row(ifName, o) {
  return Object.assign({ ifName, oper: 1, admin: 1, inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0, fcs: 0, disc: 0 }, o || {});
}
function reading(at, upCs, rows) { return { at, upCs, rows }; }
const T0 = 1_700_000_000_000;
const HOUR = 3600 * 1000;

// ── Le colonne ───────────────────────────────────────────────────────────────
test('colonne: gli OID NON sono ricopiati, vengono da lib/port-live.js', () => {
  assert.equal(H.HEALTH_IF_OIDS.inErrors, PL.PORT_COLUMNS.inErrors);
  assert.equal(H.HEALTH_IF_OIDS.outErrors, PL.PORT_COLUMNS.outErrors);
  assert.equal(H.HEALTH_IF_OIDS.inDiscards, PL.PORT_COLUMNS.inDiscards);
  assert.equal(H.HEALTH_IF_OIDS.outDiscards, PL.PORT_COLUMNS.outDiscards);
  assert.equal(H.HEALTH_IF_OIDS.fcs, PL.PORT_COLUMNS.fcs);
  assert.equal(H.HEALTH_IF_OIDS.disc, PL.PORT_COLUMNS.discontinuity);
  assert.equal(H.HEALTH_IF_OIDS.oper, PL.PORT_COLUMNS.oper);
  assert.equal(H.HEALTH_IF_OIDS.admin, PL.PORT_COLUMNS.admin);
});

test('colonne: gli OID sono quelli di IF-MIB / EtherLike-MIB (e basta)', () => {
  assert.equal(H.HEALTH_IF_OIDS.oper, '1.3.6.1.2.1.2.2.1.8');
  assert.equal(H.HEALTH_IF_OIDS.admin, '1.3.6.1.2.1.2.2.1.7');
  assert.equal(H.HEALTH_IF_OIDS.inErrors, '1.3.6.1.2.1.2.2.1.14');
  assert.equal(H.HEALTH_IF_OIDS.outErrors, '1.3.6.1.2.1.2.2.1.20');
  assert.equal(H.HEALTH_IF_OIDS.inDiscards, '1.3.6.1.2.1.2.2.1.13');
  assert.equal(H.HEALTH_IF_OIDS.outDiscards, '1.3.6.1.2.1.2.2.1.19');
  assert.equal(H.HEALTH_IF_OIDS.fcs, '1.3.6.1.2.1.10.7.2.1.3');
  assert.equal(H.HEALTH_IF_OIDS.disc, '1.3.6.1.2.1.31.1.1.1.19');
  assert.equal(H.HEALTH_IF_NAME_OID, '1.3.6.1.2.1.31.1.1.1.1');
});

test('colonne: ogni colonna di dato ha la sua provenienza (source + MIB + OID)', () => {
  for (const c of H.HEALTH_IF_COLUMNS) {
    const p = H.healthIfProvenance(c);
    assert.ok(p, 'provenienza per ' + c);
    assert.equal(p.source, 'snmp');
    assert.match(p.oid, /^1\.3\.6\.1\./);
    assert.ok(p.mib);
  }
  assert.equal(H.healthIfProvenance('fcs').mib, 'EtherLike-MIB');
  assert.equal(H.healthIfProvenance('inErrors').mib, 'IF-MIB');
  assert.equal(H.healthIfProvenance('nonEsiste'), null);
});

// ── La forma di una lettura ──────────────────────────────────────────────────
test('lettura: una colonna non letta resta null, MAI zero', () => {
  const r = H.healthReading(reading(T0, 100, [{ ifName: 'Gi1/0/1', oper: 1, inErrors: 5 }]));
  assert.equal(r.rows[0].inErrors, 5);
  assert.equal(r.rows[0].outErrors, null);
  assert.equal(r.rows[0].fcs, null);
  assert.equal(r.rows[0].disc, null);
  assert.equal(r.rows[0].admin, null);
});

test('lettura: valori che non sono quelli che lo standard ammette diventano null', () => {
  const r = H.healthReading(reading(T0, 100, [{ ifName: 'x', oper: 99, admin: 0, inErrors: -1, outErrors: 1.5, inDiscards: 'abc', outDiscards: NaN, fcs: Infinity }]));
  const x = r.rows[0];
  for (const k of ['oper', 'admin', 'inErrors', 'outErrors', 'inDiscards', 'outDiscards', 'fcs']) assert.equal(x[k], null, k);
});

test('lettura: un array o un booleano NON diventano 0 o 1 (Number([]) vale 0: un contatore «letto a zero» che nessuno ha letto)', () => {
  const r = H.healthReading(reading(T0, 100, [{ ifName: 'p', oper: true, admin: [], inErrors: [], outErrors: [5], inDiscards: {}, outDiscards: false, fcs: true, disc: '  ' }]));
  const x = r.rows[0];
  for (const k of ['oper', 'admin', 'inErrors', 'outErrors', 'inDiscards', 'outDiscards', 'fcs', 'disc']) assert.equal(x[k], null, k);
  assert.equal(H.healthReading({ at: [], rows: [] }), null, 'nemmeno un istante []');
  assert.equal(H.healthReading({ at: true, rows: [] }), null);
});

test('lettura: senza istante o senza nome non e\' una lettura / una riga', () => {
  assert.equal(H.healthReading({ rows: [] }), null);
  assert.equal(H.healthReading(null), null);
  assert.equal(H.healthReading(reading(0, 1, [])), null);
  const r = H.healthReading(reading(T0, 1, [{ ifName: '   ' }, { ifName: '' }, null, 'x', row('ok')]));
  assert.deepEqual(r.rows.map(x => x.ifName), ['ok']);
});

test('lettura: il nome perde i caratteri di controllo e ha un tetto', () => {
  const r = H.healthReading(reading(T0, 1, [row('Gi1/0/1\u0000\u0007'), row('a'.repeat(500))]));
  assert.equal(r.rows[0].ifName, 'Gi1/0/1');
  assert.equal(r.rows[1].ifName.length, 128);
});

test('lettura: un tetto di righe per apparato', () => {
  const rows = []; for (let i = 0; i < 6000; i++) rows.push(row('p' + i));
  assert.equal(H.healthReading(reading(T0, 1, rows)).rows.length, 4096);
});

// ── La PUT ───────────────────────────────────────────────────────────────────
test('PUT: un id che non e\' un id d\'app non entra (finirebbe in una chiave e in un attributo)', () => {
  const put = H.healthSanitizePut({ nodes: {
    'sw-1': reading(T0, 1, [row('a')]),
    '<img src=x onerror=1>': reading(T0, 1, [row('a')]),
    '__proto__': reading(T0, 1, [row('a')]),
    'a b': reading(T0, 1, [row('a')]),
    '': reading(T0, 1, [row('a')]),
  } });
  assert.deepEqual(Object.keys(put.nodes), ['sw-1']);
});

test('PUT: corpo che non e\' un oggetto → nessun apparato, nessuna eccezione', () => {
  for (const b of [null, undefined, 5, 'x', [], { nodes: null }, { nodes: 'x' }]) assert.deepEqual(H.healthSanitizePut(b), { nodes: {} });
});

test('PUT: un tetto sul numero di apparati', () => {
  const nodes = {}; for (let i = 0; i < 1500; i++) nodes['n' + i] = reading(T0, 1, [row('a')]);
  assert.equal(Object.keys(H.healthSanitizePut({ nodes }).nodes).length, 1000);
});

// ── Codifica sul disco ───────────────────────────────────────────────────────
test('disco: andata e ritorno senza perdere niente, null compresi', () => {
  const rd = H.healthReading(reading(T0, 4242, [row('Gi1/0/1', { inErrors: 7, fcs: null, disc: null }), { ifName: 'Gi1/0/2' }]));
  const file = H.healthFold(null, { nodes: { 'sw-1': rd } }, T0);
  const dec = H.healthDecodeFile(file);
  assert.deepEqual(dec['sw-1'].cur, rd);
  assert.equal(dec['sw-1'].prev, null);
});

test('disco: le righe sono TUPLE, nell\'ordine di HEALTH_IF_COLUMNS', () => {
  const file = H.healthFold(null, { nodes: { a: H.healthReading(reading(T0, 1, [row('p', { inErrors: 3 })])) } }, T0);
  const tup = file.nodes.a.cur.r[0];
  assert.ok(Array.isArray(tup));
  assert.equal(tup.length, H.HEALTH_IF_COLUMNS.length);
  assert.equal(tup[0], 'p');
  assert.equal(tup[H.HEALTH_IF_COLUMNS.indexOf('inErrors')], 3);
});

test('disco: un file illeggibile o strano non rompe la lettura', () => {
  for (const f of [null, undefined, 5, 'x', [], {}, { nodes: null }, { nodes: { a: null } }, { nodes: { a: { cur: { at: 'x', r: 5 } } } }]) {
    assert.deepEqual(H.healthDecodeFile(f), {});
  }
});

test('disco: una tupla corta si legge con null nelle colonne mancanti (mai zero)', () => {
  const dec = H.healthDecodeFile({ nodes: { a: { cur: { at: T0, upCs: 1, r: [['p', 1]] }, prev: null } } });
  assert.equal(dec.a.cur.rows[0].oper, 1);
  assert.equal(dec.a.cur.rows[0].inErrors, null);
});

// ── La fusione ───────────────────────────────────────────────────────────────
const L1 = H.healthReading(reading(T0, 1000, [row('p', { inErrors: 1 })]));
const L2 = H.healthReading(reading(T0 + HOUR, 361000, [row('p', { inErrors: 4 })]));
const L3 = H.healthReading(reading(T0 + 2 * HOUR, 721000, [row('p', { inErrors: 9 })]));

test('fusione: la prima lettura e\' «ora», senza «prima»', () => {
  const f = H.healthFold(null, { nodes: { a: L1 } }, T0 + HOUR);
  const d = H.healthDecodeFile(f);
  assert.equal(d.a.cur.rows[0].inErrors, 1);
  assert.equal(d.a.prev, null);
});

test('fusione: la seconda lettura fa scorrere la prima in «prima»', () => {
  let f = H.healthFold(null, { nodes: { a: L1 } }, T0);
  f = H.healthFold(f, { nodes: { a: L2 } }, T0 + HOUR);
  const d = H.healthDecodeFile(f);
  assert.equal(d.a.cur.rows[0].inErrors, 4);
  assert.equal(d.a.prev.rows[0].inErrors, 1);
  f = H.healthFold(f, { nodes: { a: L3 } }, T0 + 2 * HOUR);
  const d3 = H.healthDecodeFile(f);
  assert.equal(d3.a.cur.rows[0].inErrors, 9);
  assert.equal(d3.a.prev.rows[0].inErrors, 4, 'la piu\' vecchia esce, non si accumula una serie');
});

test('fusione: la STESSA lettura rimandata due volte non cancella la differenza', () => {
  let f = H.healthFold(null, { nodes: { a: L1 } }, T0);
  f = H.healthFold(f, { nodes: { a: L2 } }, T0 + HOUR);
  const again = H.healthFold(f, { nodes: { a: L2 } }, T0 + HOUR);
  assert.deepEqual(again, f);
  assert.equal(H.healthDecodeFile(again).a.prev.rows[0].inErrors, 1);
});

test('fusione: una lettura PIU\' VECCHIA (client rimasto indietro) non sposta niente', () => {
  let f = H.healthFold(null, { nodes: { a: L2 } }, T0 + HOUR);
  f = H.healthFold(f, { nodes: { a: L1 } }, T0 + HOUR);
  const d = H.healthDecodeFile(f);
  assert.equal(d.a.cur.rows[0].inErrors, 4);
  assert.equal(d.a.prev, null);
});

test('fusione: un apparato non toccato dalla PUT resta com\'era', () => {
  let f = H.healthFold(null, { nodes: { a: L1, b: L1 } }, T0);
  f = H.healthFold(f, { nodes: { a: L2 } }, T0 + HOUR);
  const d = H.healthDecodeFile(f);
  assert.equal(d.b.cur.rows[0].inErrors, 1);
  assert.equal(d.b.prev, null);
});

test('fusione: ritorna un file NUOVO, non muta quello di prima', () => {
  const f0 = H.healthFold(null, { nodes: { a: L1 } }, T0);
  const snap = JSON.stringify(f0);
  H.healthFold(f0, { nodes: { a: L2 } }, T0 + HOUR);
  assert.equal(JSON.stringify(f0), snap);
});

test('fusione: una lettura non rinnovata da 90 giorni cade (l\'apparato non c\'e\' piu\')', () => {
  const f0 = H.healthFold(null, { nodes: { vecchio: L1 } }, T0);
  const f1 = H.healthFold(f0, { nodes: {} }, T0 + 91 * 24 * HOUR);
  assert.deepEqual(Object.keys(f1.nodes), []);
  const f2 = H.healthFold(f0, { nodes: {} }, T0 + 89 * 24 * HOUR);
  assert.deepEqual(Object.keys(f2.nodes), ['vecchio']);
});

test('fusione: un tetto sul numero di apparati nel file, cadono i letti da piu\' tempo', () => {
  const nodes = {};
  for (let i = 0; i < 5200; i++) nodes['n' + i] = H.healthReading(reading(T0 + i, 1, [row('p')]));
  let f = null;
  for (let off = 0; off < 5200; off += 1000) {
    const part = {}; for (let i = off; i < Math.min(off + 1000, 5200); i++) part['n' + i] = nodes['n' + i];
    f = H.healthFold(f, { nodes: part }, T0 + 5200);
  }
  assert.equal(Object.keys(f.nodes).length, 5000);
  assert.ok(f.nodes.n5199, 'il piu\' recente resta');
  assert.ok(!f.nodes.n0, 'il piu\' vecchio cade');
});

test('fusione: id ostili gia\' nel file non sopravvivono', () => {
  const f = H.healthFold({ nodes: { '<b>': { cur: { at: T0, upCs: 1, r: [['p']] } } } }, { nodes: {} }, T0);
  assert.deepEqual(Object.keys(f.nodes), []);
});

// ── Le righe piatte (la tabella che un database avrebbe) ─────────────────────
test('righe piatte: una per interfaccia e per lettura, con apparato e istante in ogni riga', () => {
  let f = H.healthFold(null, { nodes: { a: L1 } }, T0);
  f = H.healthFold(f, { nodes: { a: L2 } }, T0 + HOUR);
  const flat = H.healthFlatRows(f);
  assert.equal(flat.length, 2);
  for (const r of flat) {
    for (const c of ['node', 'reading', 'at', 'upCs'].concat(H.HEALTH_IF_COLUMNS)) assert.ok(c in r, c);
    for (const v of Object.values(r)) assert.ok(v === null || ['string', 'number'].includes(typeof v), 'solo scalari');
  }
  assert.deepEqual(flat.map(r => r.reading).sort(), ['cur', 'prev']);
});

// ── Le differenze ────────────────────────────────────────────────────────────
function summ(prevRows, curRows, o) {
  o = o || {};
  const prev = prevRows ? H.healthReading(reading(T0, o.prevUp === undefined ? 100000 : o.prevUp, prevRows)) : null;
  const cur = H.healthReading(reading(T0 + HOUR, o.curUp === undefined ? 460000 : o.curUp, curRows));
  return H.healthSummarizeIf(prev, cur);
}
const portOf = (s, name) => s.ports.find(p => p.ifName === name);

test('differenze: contatori saliti → delta, «grew» e intervallo dal tempo DELL\'APPARATO', () => {
  const s = summ([row('p', { inErrors: 10, outDiscards: 5 })], [row('p', { inErrors: 14, outDiscards: 5, fcs: 0 })]);
  const p = portOf(s, 'p');
  assert.equal(p.status, 'ok');
  assert.equal(p.deltas.inErrors, 4);
  assert.equal(p.deltas.outDiscards, 0);
  assert.deepEqual(p.grew, ['inErrors']);
  assert.equal(p.spanS, 3600);          // (460000-100000)/100 centesimi → secondi
  assert.equal(p.basis, 'sysUpTime');
  assert.equal(s.counts.grew, 1);
});

test('differenze: senza sysUpTime l\'intervallo si prende dall\'orologio, e lo dice', () => {
  const s = summ([row('p')], [row('p')], { prevUp: null, curUp: null });
  assert.equal(portOf(s, 'p').spanS, 3600);
  assert.equal(portOf(s, 'p').basis, 'clock');
});

test('differenze: tutto fermo → ok, nessun «grew» (una rete sana e\' a zero)', () => {
  const s = summ([row('a'), row('b')], [row('a'), row('b')]);
  assert.equal(s.counts.grew, 0);
  assert.ok(s.ports.every(p => p.status === 'ok' && p.grew.length === 0));
});

test('differenze: nessuna lettura precedente → no_baseline, il totale c\'e\' ma nessuna differenza', () => {
  const s = summ(null, [row('p', { inErrors: 500 })]);
  const p = portOf(s, 'p');
  assert.equal(p.status, 'no_baseline');
  assert.equal(p.deltas, null);
  assert.deepEqual(p.grew, []);
  assert.equal(p.totals.inErrors, 500);
  assert.equal(s.counts.noBaseline, 1);
});

test('differenze: un\'interfaccia nuova (non c\'era prima) e\' no_baseline, le altre no', () => {
  const s = summ([row('a')], [row('a'), row('nuova', { inErrors: 9 })]);
  assert.equal(portOf(s, 'a').status, 'ok');
  assert.equal(portOf(s, 'nuova').status, 'no_baseline');
});

test('differenze: sysUpTime SCESO → rebooted per TUTTE le porte, nessuna differenza', () => {
  const s = summ([row('p', { inErrors: 900 }), row('q')], [row('p', { inErrors: 3 }), row('q')], { prevUp: 5_000_000, curUp: 12_000 });
  assert.ok(s.ports.every(p => p.status === 'rebooted' && p.deltas === null && p.grew.length === 0));
  assert.equal(s.counts.rebooted, 2);
});

test('differenze: uptime sceso con contatore cresciuto NON e\' una differenza (e\' un reboot)', () => {
  // Dopo un riavvio il contatore ripartito puo' gia' superare quello di prima: ma non e' «cresciuto», e' un altro conteggio.
  const s = summ([row('p', { inErrors: 2 })], [row('p', { inErrors: 50 })], { prevUp: 5_000_000, curUp: 12_000 });
  assert.equal(portOf(s, 'p').status, 'rebooted');
  assert.deepEqual(portOf(s, 'p').grew, []);
});

test('differenze: ifCounterDiscontinuityTime cambiato → discontinuity, solo per quella porta', () => {
  const s = summ([row('p', { inErrors: 10, disc: 100 }), row('q', { inErrors: 1, disc: 0 })], [row('p', { inErrors: 12, disc: 42000 }), row('q', { inErrors: 3, disc: 0 })]);
  assert.equal(portOf(s, 'p').status, 'discontinuity');
  assert.equal(portOf(s, 'p').deltas, null);
  assert.equal(portOf(s, 'q').status, 'ok');
  assert.equal(portOf(s, 'q').deltas.inErrors, 2);
});

test('differenze: discontinuity non letta da una delle due parti NON si inventa', () => {
  const s = summ([row('p', { disc: null, inErrors: 1 })], [row('p', { disc: 500, inErrors: 2 })]);
  assert.equal(portOf(s, 'p').status, 'ok');
});

test('differenze: un contatore CALATO a uptime invariato → counter_cleared, MAI il giro del Counter32', () => {
  // 4.294.967.290 → 5: sommando il modulo uscirebbe «11 errori»; ma un Counter32 di errori non fa il giro in un'ora.
  const s = summ([row('p', { inErrors: 4_294_967_290 })], [row('p', { inErrors: 5 })]);
  const p = portOf(s, 'p');
  assert.equal(p.status, 'counter_cleared');
  assert.equal(p.deltas, null);
  assert.deepEqual(p.grew, []);
  assert.equal(s.counts.cleared, 1);
});

test('differenze: un solo contatore calato azzera il confronto di QUELLA porta, non delle altre', () => {
  const s = summ([row('p', { inErrors: 50, outErrors: 7 }), row('q', { inErrors: 1 })], [row('p', { inErrors: 3, outErrors: 8 }), row('q', { inErrors: 2 })]);
  assert.equal(portOf(s, 'p').status, 'counter_cleared');
  assert.equal(portOf(s, 'q').status, 'ok');
});

test('differenze: un contatore NON letto da una delle due parti non diventa zero', () => {
  const s = summ([row('p', { fcs: null, inErrors: 1 })], [row('p', { fcs: 8, inErrors: 2 })]);
  const p = portOf(s, 'p');
  assert.equal(p.deltas.fcs, null);
  assert.equal(p.deltas.inErrors, 1);
  assert.deepEqual(p.grew, ['inErrors']);
});

test('differenze: «grew» elenca solo i contatori davvero saliti, FCS compreso', () => {
  const s = summ([row('p', { fcs: 0, outDiscards: 4 })], [row('p', { fcs: 2, outDiscards: 4 })]);
  assert.deepEqual(portOf(s, 'p').grew, ['fcs']);
});

test('differenze: lo stesso nome due volte e\' AMBIGUO, non si indovina', () => {
  const s = summ([row('Gi1', { inErrors: 1 })], [row('Gi1', { inErrors: 9 }), row('GI1', { inErrors: 2 })]);
  assert.equal(portOf(s, 'Gi1').status, 'ambiguous');
  assert.equal(portOf(s, 'Gi1').deltas, null);
});

test('differenze: i nomi si abbinano senza badare a maiuscole e spazi', () => {
  const s = summ([row('  gi1/0/1 ', { inErrors: 1 })], [row('Gi1/0/1', { inErrors: 4 })]);
  assert.equal(s.ports[0].status, 'ok');
  assert.equal(s.ports[0].deltas.inErrors, 3);
});

test('differenze: stato e amministrazione si riportano come sono, null se non letti', () => {
  const s = summ([row('p')], [row('p', { oper: 2, admin: null })]);
  assert.equal(portOf(s, 'p').oper, 2);
  assert.equal(portOf(s, 'p').admin, null);
});

test('differenze: l\'apparato che non pubblica NESSUN contatore → not_available, non «tutto a zero»', () => {
  const nulls = { oper: 1, admin: 1, inErrors: null, outErrors: null, inDiscards: null, outDiscards: null, fcs: null, disc: null };
  const s = summ([Object.assign({ ifName: 'p' }, nulls)], [Object.assign({ ifName: 'p' }, nulls)]);
  assert.equal(s.state, 'not_available');
  assert.deepEqual(s.ports, []);
});

test('differenze: nessuna interfaccia → not_available', () => {
  assert.equal(summ(null, []).state, 'not_available');
  assert.equal(H.healthSummarizeIf(null, null).state, 'not_available');
  assert.equal(H.healthSummarizeIf(null, { rows: 'x' }).state, 'not_available');
});

test('differenze: solo FCS pubblicato basta per «letto» (IF-MIB puo\' tacere dove EtherLike parla)', () => {
  const s = summ(null, [{ ifName: 'p', oper: 1, admin: 1, inErrors: null, outErrors: null, inDiscards: null, outDiscards: null, fcs: 0, disc: null }]);
  assert.equal(s.state, 'read');
});

// ── La soglia dell'UTENTE sugli errori d'interfaccia ───────────────────────────────────────
// `state.healthThresholds.ifErrors.min` = di quanto deve salire ALMENO UN contatore fra due letture perche' l'interfaccia si
// segnali. E' una dichiarazione di chi usa l'app: senza, ogni aumento segnala (come prima). Ogni caso qui sotto sta perche' una
// versione sbagliata direbbe una cosa plausibile e FALSA: «non e' salito niente» quando e' salito poco, la somma che conta due
// volte lo stesso errore, una soglia che cambia cosa significa un riavvio.
function summThr(prevRows, curRows, thr, o) {
  o = o || {};
  const prev = prevRows ? H.healthReading(reading(T0, o.prevUp === undefined ? 100000 : o.prevUp, prevRows)) : null;
  const cur = H.healthReading(reading(T0 + HOUR, o.curUp === undefined ? 460000 : o.curUp, curRows));
  return H.healthSummarizeIf(prev, cur, H.healthSanitizeThresholds(thr));
}

test('soglia errori: senza soglia ogni aumento segnala, come prima, e il risultato dice min = 1', () => {
  for (const thr of [undefined, {}, { temperature: { warn: 60, crit: null } }]) {
    const s = summThr([row('p')], [row('p', { inErrors: 1 })], thr);
    const p = portOf(s, 'p');
    assert.equal(s.min, 1);
    assert.deepEqual(p.grew, ['inErrors']);
    assert.equal(p.below, false);
    assert.equal(s.counts.grew, 1);
    assert.equal(s.counts.below, 0);
  }
});

test('soglia errori: SOTTO la soglia l\'interfaccia non si segnala, ma resta contata «below» (la scheda non finge che non sia salito niente)', () => {
  const s = summThr([row('p')], [row('p', { inErrors: 9 })], { ifErrors: { min: 10 } });
  const p = portOf(s, 'p');
  assert.equal(s.min, 10);
  assert.deepEqual(p.grew, []);
  assert.equal(p.below, true);
  assert.equal(p.deltas.inErrors, 9, 'la differenza resta quella vera: la soglia decide cosa si SEGNALA, non cosa e\' successo');
  assert.equal(s.counts.grew, 0);
  assert.equal(s.counts.below, 1);
});

test('soglia errori: ALLA soglia si segnala (>=), e la riga porta TUTTI i contatori saliti, anche quelli sotto soglia', () => {
  const s = summThr([row('p')], [row('p', { inErrors: 10, outDiscards: 2 })], { ifErrors: { min: 10 } });
  const p = portOf(s, 'p');
  assert.deepEqual(p.grew.slice().sort(), ['inErrors', 'outDiscards']);
  assert.equal(p.below, false);
  assert.equal(s.counts.grew, 1);
  assert.equal(s.counts.below, 0);
});

test('soglia errori: si guarda UN contatore alla volta, MAI la somma (gli FCS stanno gia\' dentro gli errori in: sommarli conterebbe due volte)', () => {
  // 6 + 6 = 12 ≥ 10, ma nessun contatore da solo ci arriva: non si segnala.
  const a = portOf(summThr([row('p')], [row('p', { inErrors: 6, fcs: 6 })], { ifErrors: { min: 10 } }), 'p');
  assert.deepEqual(a.grew, []);
  assert.equal(a.below, true);
  const b = portOf(summThr([row('p')], [row('p', { inErrors: 6, outErrors: 6, inDiscards: 6 })], { ifErrors: { min: 10 } }), 'p');
  assert.deepEqual(b.grew, []);
  assert.equal(b.below, true);
});

test('soglia errori: la soglia vale per interfaccia — una sopra e una sotto stanno ciascuna dalla sua parte', () => {
  const s = summThr([row('a'), row('b'), row('c')], [row('a', { inErrors: 50 }), row('b', { inErrors: 3 }), row('c')], { ifErrors: { min: 10 } });
  assert.deepEqual(portOf(s, 'a').grew, ['inErrors']);
  assert.deepEqual(portOf(s, 'b').grew, []);
  assert.equal(portOf(s, 'b').below, true);
  assert.equal(portOf(s, 'c').below, false, 'una che non e\' salita per niente non e\' «sotto soglia»');
  assert.equal(s.counts.grew, 1);
  assert.equal(s.counts.below, 1);
});

test('soglia errori: non cambia cio\' che NON e\' un aumento — riavvio, prima lettura e contatore azzerato restano come erano', () => {
  const thr = { ifErrors: { min: 10 } };
  assert.equal(portOf(summThr([row('p', { inErrors: 500 })], [row('p', { inErrors: 5 })], thr, { prevUp: 460000, curUp: 100000 }), 'p').status, 'rebooted');
  assert.equal(portOf(summThr(null, [row('p', { inErrors: 500 })], thr), 'p').status, 'no_baseline');
  const cleared = portOf(summThr([row('p', { inErrors: 500 })], [row('p', { inErrors: 5 })], thr), 'p');
  assert.equal(cleared.status, 'counter_cleared');
  assert.equal(cleared.below, false, 'un contatore azzerato non e\' «salito sotto soglia»');
});

test('soglia errori: un contatore NON letto non e\' ne\' sotto ne\' sopra soglia, e non impedisce agli altri', () => {
  const s = summThr([row('p', { inErrors: null })], [row('p', { inErrors: null, outErrors: 20 })], { ifErrors: { min: 10 } });
  const p = portOf(s, 'p');
  assert.equal(p.deltas.inErrors, null);
  assert.deepEqual(p.grew, ['outErrors']);
});

test('soglia errori: una soglia che non e\' valida non si inventa — 1 (= ogni aumento), 0, negativa, decimale, testo, enorme → nessuna', () => {
  for (const v of [1, 0, -5, 2.5, '1', 'x', '', ' ', null, undefined, true, [], {}, 1e9 + 1, Infinity, NaN]) {
    assert.deepEqual(H.healthSanitizeThresholds({ ifErrors: { min: v } }), {}, 'non e\' una soglia: ' + JSON.stringify(v));
  }
  for (const v of [null, 5, 'x', [], { ifErrors: 5 }, { ifErrors: 'x' }, { ifErrors: null }]) assert.deepEqual(H.healthSanitizeThresholds(v), {});
});

test('soglia errori: i numeri validi (anche come testo del campo) si tengono interi, e convivono con la temperatura', () => {
  assert.deepEqual(H.healthSanitizeThresholds({ ifErrors: { min: 10 } }), { ifErrors: { min: 10 } });
  assert.deepEqual(H.healthSanitizeThresholds({ ifErrors: { min: '25' } }), { ifErrors: { min: 25 } });
  assert.deepEqual(H.healthSanitizeThresholds({ ifErrors: { min: 2 } }), { ifErrors: { min: 2 } });
  assert.deepEqual(H.healthSanitizeThresholds({ ifErrors: { min: 1e9 } }), { ifErrors: { min: 1e9 } });
  assert.deepEqual(H.healthSanitizeThresholds({ temperature: { warn: 60, crit: null }, ifErrors: { min: 10 } }), { temperature: { warn: 60, crit: null }, ifErrors: { min: 10 } });
  // una soglia valida non trascina l'altra: la temperatura sbagliata sparisce, gli errori restano
  assert.deepEqual(H.healthSanitizeThresholds({ temperature: { warn: 999, crit: null }, ifErrors: { min: 10 } }), { ifErrors: { min: 10 } });
});

// ── Le soglie PER APPARATO: un'eccezione a quelle del progetto, campo per campo ──────────────────
// `nodes: { id: { temperature?: {warn,crit}, ifErrors?: {min} } }`. Un campo vuoto dell'apparato vale quello del progetto; per
// l'apparato `min` puo' valere 1 («ogni aumento»), che per il progetto non e' una soglia. Ogni caso sta perche' una versione sbagliata
// direbbe una cosa plausibile e falsa: un apparato che prende la soglia di un altro, un id che sfonda il prototipo, una soglia di
// un apparato cancellato che resta li' a giudicare un altro con lo stesso id.
test('per apparato: una soglia valida si tiene, e convive con quelle del progetto', () => {
  const s = H.healthSanitizeThresholds({ temperature: { warn: 60, crit: null }, ifErrors: { min: 10 }, nodes: { sw1: { temperature: { warn: 70, crit: 85 }, ifErrors: { min: 1 } }, ap1: { ifErrors: { min: '25' } } } });
  assert.deepEqual(s, { temperature: { warn: 60, crit: null }, ifErrors: { min: 10 }, nodes: { sw1: { temperature: { warn: 70, crit: 85 }, ifErrors: { min: 1 } }, ap1: { ifErrors: { min: 25 } } } });
});

test('per apparato: min = 1 vale per l\'APPARATO e non per il progetto (che lo butta: 1 e\' «nessuna soglia»)', () => {
  assert.deepEqual(H.healthSanitizeThresholds({ ifErrors: { min: 1 } }), {});
  assert.deepEqual(H.healthSanitizeThresholds({ nodes: { sw1: { ifErrors: { min: 1 } } } }), { nodes: { sw1: { ifErrors: { min: 1 } } } });
  assert.deepEqual(H.healthSanitizeThresholds({ nodes: { sw1: { ifErrors: { min: 0 } } } }), {}, '0 non e\' una soglia nemmeno per l\'apparato');
});

test('per apparato: cio\' che non e\' una soglia non entra — id strani, voci vuote, forme sbagliate', () => {
  const bad = {};
  for (const id of ['', 'a b', 'x'.repeat(81), 'a/b', 'a<b', '__proto__']) bad[id] = { ifErrors: { min: 5 } };
  assert.deepEqual(H.healthSanitizeThresholds({ nodes: bad }), {});
  // __proto__ come CHIAVE vera (cosi' la crea JSON.parse): non deve passare ne' sfondare il prototipo
  const parsed = JSON.parse('{"nodes":{"__proto__":{"ifErrors":{"min":5}},"ok":{"ifErrors":{"min":5}}}}');
  const s = H.healthSanitizeThresholds(parsed);
  assert.deepEqual(Object.keys(s.nodes), ['ok']);
  assert.equal(({}).min, undefined);
  // `out.__proto__ = {…}` NON crea una chiave: cambia il prototipo dell'oggetto, e le sue soglie diventerebbero ereditate da tutti gli apparati
  assert.equal(Object.getPrototypeOf(s.nodes), Object.prototype, '«__proto__» non deve toccare il prototipo dell\'elenco');
  assert.equal(s.nodes.ifErrors, undefined, 'e nessuna soglia e\' ereditata');
  for (const v of [{ sw1: null }, { sw1: 5 }, { sw1: 'x' }, { sw1: [] }, { sw1: {} }, { sw1: { temperature: { warn: 999, crit: 'x' } } }, { sw1: { ifErrors: { min: 'x' } } }]) {
    assert.deepEqual(H.healthSanitizeThresholds({ nodes: v }), {}, JSON.stringify(v));
  }
  for (const v of [null, 5, 'x', [], [{ ifErrors: { min: 5 } }], true]) assert.deepEqual(H.healthSanitizeThresholds({ nodes: v }), {}, JSON.stringify(v));
});

test('per apparato: un tetto sul numero di apparati con una soglia propria', () => {
  const nodes = {};
  for (let i = 0; i < 5200; i++) nodes['n' + i] = { ifErrors: { min: 5 } };
  assert.equal(Object.keys(H.healthSanitizeThresholds({ nodes }).nodes).length, 5000);
});

test('per apparato: vale CAMPO PER CAMPO — un campo vuoto dell\'apparato e\' quello del progetto', () => {
  const raw = { temperature: { warn: 60, crit: 75 }, ifErrors: { min: 10 }, nodes: { sw1: { temperature: { warn: 70, crit: null } }, sw2: { ifErrors: { min: 1 } } } };
  assert.deepEqual(H.healthThresholdsFor(raw, 'sw1'), { temperature: { warn: 70, crit: 75 }, ifErrors: { min: 10 } }, 'solo l\'avviso e\' suo: la critica e gli errori restano del progetto');
  assert.deepEqual(H.healthThresholdsFor(raw, 'sw2'), { temperature: { warn: 60, crit: 75 }, ifErrors: { min: 1 } }, 'min 1: vuole ogni aumento anche se il progetto chiede 10');
  assert.deepEqual(H.healthThresholdsFor(raw, 'altro'), { temperature: { warn: 60, crit: 75 }, ifErrors: { min: 10 } }, 'un apparato senza eccezione: il progetto');
  assert.deepEqual(H.healthThresholdsFor({ nodes: { sw1: { temperature: { warn: 70, crit: null } } } }, 'sw1'), { temperature: { warn: 70, crit: null } }, 'il progetto non dice niente: resta il suo, e la critica vuota');
  assert.deepEqual(H.healthThresholdsFor(undefined, 'sw1'), {});
  assert.deepEqual(H.healthThresholdsFor(raw, 'sw1').nodes, undefined, 'il risultato non porta le eccezioni degli altri');
});

test('per apparato: un id che e\' una proprieta\' dell\'oggetto non pesca niente dal prototipo', () => {
  const raw = { ifErrors: { min: 10 }, nodes: { sw1: { ifErrors: { min: 3 } } } };
  for (const id of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    assert.deepEqual(H.healthThresholdsFor(raw, id), { ifErrors: { min: 10 } }, id);
  }
});

test('per apparato: cambiare un campo non tocca gli altri campi, gli altri apparati ne\' il progetto', () => {
  const base = { temperature: { warn: 60, crit: null }, ifErrors: { min: 10 }, nodes: { sw2: { ifErrors: { min: 3 } } } };
  const frozen = JSON.stringify(base);
  let s = H.healthThresholdsSetNode(base, 'sw1', 'warn', '70');
  assert.deepEqual(s, { temperature: { warn: 60, crit: null }, ifErrors: { min: 10 }, nodes: { sw2: { ifErrors: { min: 3 } }, sw1: { temperature: { warn: 70, crit: null } } } });
  s = H.healthThresholdsSetNode(s, 'sw1', 'crit', 85);
  assert.deepEqual(s.nodes.sw1, { temperature: { warn: 70, crit: 85 } }, 'la critica non porta via l\'avviso');
  s = H.healthThresholdsSetNode(s, 'sw1', 'ifmin', '1');
  assert.deepEqual(s.nodes.sw1, { temperature: { warn: 70, crit: 85 }, ifErrors: { min: 1 } }, '1 resta, per l\'apparato');
  assert.deepEqual(s.nodes.sw2, { ifErrors: { min: 3 } });
  assert.deepEqual(s.temperature, { warn: 60, crit: null });
  assert.deepEqual(s.ifErrors, { min: 10 });
  assert.equal(JSON.stringify(base), frozen, 'l\'ingresso non si muta');
});

test('per apparato: un testo che non e\' una soglia CANCELLA il campo, e l\'ultimo campo cancellato toglie l\'apparato', () => {
  let s = H.healthThresholdsSetNode({}, 'sw1', 'warn', 70);
  s = H.healthThresholdsSetNode(s, 'sw1', 'ifmin', 5);
  assert.deepEqual(s.nodes.sw1, { temperature: { warn: 70, crit: null }, ifErrors: { min: 5 } });
  for (const v of ['', ' ', 'abc', null, undefined, 999, -100, 'NaN']) {
    const t = H.healthThresholdsSetNode(s, 'sw1', 'warn', v);
    assert.deepEqual(t.nodes.sw1, { ifErrors: { min: 5 } }, 'warn = ' + JSON.stringify(v));
  }
  s = H.healthThresholdsSetNode(s, 'sw1', 'warn', '');
  s = H.healthThresholdsSetNode(s, 'sw1', 'ifmin', 'x');
  assert.deepEqual(s, {}, 'nessuna eccezione rimasta: nessun apparato, nessun `nodes` vuoto');
});

test('per apparato: un id o un campo sbagliati non cambiano niente', () => {
  const base = { ifErrors: { min: 10 }, nodes: { sw1: { ifErrors: { min: 3 } } } };
  for (const id of ['', 'a b', '__proto__', null, undefined, {}]) assert.deepEqual(H.healthThresholdsSetNode(base, id, 'warn', 70), base, String(id));
  for (const key of ['', 'min', 'temperature', 'WARN', undefined]) assert.deepEqual(H.healthThresholdsSetNode(base, 'sw1', key, 70), base, String(key));
});

test('per apparato: gli apparati che non ci sono piu\' perdono la loro eccezione (nessuna soglia orfana)', () => {
  const base = { nodes: { sw1: { ifErrors: { min: 3 } }, gone: { ifErrors: { min: 4 } } } };
  const s = H.healthThresholdsSetNode(base, 'sw2', 'ifmin', 7, new Set(['sw1', 'sw2']));
  assert.deepEqual(Object.keys(s.nodes).sort(), ['sw1', 'sw2']);
  assert.deepEqual(Object.keys(H.healthThresholdsClearNode(base, 'sw1', new Set(['sw1'])) .nodes || {}), [], 'tolto sw1, e gone non c\'e\' piu\': nessuna eccezione');
  assert.deepEqual(H.healthThresholdsSetNode(base, 'sw2', 'ifmin', 7).nodes.gone, { ifErrors: { min: 4 } }, 'senza l\'elenco degli apparati non si butta niente');
});

test('per apparato: «torna al progetto» toglie TUTTE le eccezioni di UN apparato e solo le sue', () => {
  const base = { temperature: { warn: 60, crit: null }, nodes: { sw1: { temperature: { warn: 70, crit: 85 }, ifErrors: { min: 1 } }, sw2: { ifErrors: { min: 3 } } } };
  const s = H.healthThresholdsClearNode(base, 'sw1');
  assert.deepEqual(s, { temperature: { warn: 60, crit: null }, nodes: { sw2: { ifErrors: { min: 3 } } } });
  assert.deepEqual(H.healthThresholdsClearNode(base, 'non-c-e'), H.healthSanitizeThresholds(base), 'un apparato senza eccezione: niente cambia');
  assert.deepEqual(H.healthThresholdsClearNode(H.healthThresholdsClearNode(base, 'sw1'), 'sw2'), { temperature: { warn: 60, crit: null } });
});

test('per apparato: la soglia dell\'apparato decide DAVVERO — min 1 vede un aumento che il progetto (10) tace, e viceversa', () => {
  const raw = { ifErrors: { min: 10 }, nodes: { core: { ifErrors: { min: 1 } }, noisy: { ifErrors: { min: 500 } } } };
  const prev = H.healthReading(reading(T0, 100000, [row('p')]));
  const cur = H.healthReading(reading(T0 + HOUR, 460000, [row('p', { inErrors: 30 })]));
  const sum = (id) => H.healthSummarizeIf(prev, cur, H.healthThresholdsFor(raw, id));
  assert.deepEqual(portOf(sum('core'), 'p').grew, ['inErrors'], 'dorsale: ogni aumento');
  assert.equal(sum('core').min, 1);
  assert.deepEqual(portOf(sum('altro'), 'p').grew, ['inErrors'], 'progetto 10: +30 segnala');
  assert.deepEqual(portOf(sum('noisy'), 'p').grew, [], 'rumoroso 500: +30 non segnala');
  assert.equal(portOf(sum('noisy'), 'p').below, true, 'e lo dice: e\' salito, sotto la soglia di QUELL\'apparato');
  assert.equal(sum('noisy').min, 500);
});

test('per apparato: la soglia di temperatura dell\'apparato giudica il suo sensore, e la fonte resta «tua» (user_default)', () => {
  const raw = { temperature: { warn: 60, crit: null }, nodes: { hot: { temperature: { warn: 75, crit: 90 } } } };
  const sensor = { kind: 'temperature', value: 68, state: 'ok', limHi: null, limLo: null };
  assert.deepEqual(H.healthSensorSeverity(sensor, H.healthThresholdsFor(raw, 'cold')), { severity: 'warn', source: 'user_default', why: 'threshold' });
  assert.deepEqual(H.healthSensorSeverity(sensor, H.healthThresholdsFor(raw, 'hot')), { severity: null, source: null, why: null }, 'il firewall che sta a 68° e\' normale');
  assert.equal(H.healthSensorSeverity(Object.assign({}, sensor, { value: 91 }), H.healthThresholdsFor(raw, 'hot')).severity, 'crit');
  // la parola dell'apparato vale sempre di piu' della soglia: il suo limite supera quello dell'utente
  assert.deepEqual(H.healthSensorSeverity(Object.assign({}, sensor, { limHi: 65 }), H.healthThresholdsFor(raw, 'hot')), { severity: 'crit', source: 'device', why: 'limit' });
});

// ── Applicare una modifica (anteprima = scrittura) e la scala della temperatura ───────────────────
// `healthThresholdsApply` e' la UNICA definizione: il pannello «Tolleranza» ci calcola l'effetto prima di scrivere, e poi scrive il
// risultato di QUELLA stessa funzione. Se ne esistessero due, l'effetto annunciato potrebbe non essere quello scritto.
test('applica: al progetto, solo le chiavi presenti, e le eccezioni degli apparati restano', () => {
  const base = { temperature: { warn: 60, crit: null }, ifErrors: { min: 10 }, nodes: { sw1: { ifErrors: { min: 1 } } } };
  assert.deepEqual(H.healthThresholdsApply(base, 'project', null, { warn: '65' }), { temperature: { warn: 65, crit: null }, ifErrors: { min: 10 }, nodes: { sw1: { ifErrors: { min: 1 } } } });
  assert.deepEqual(H.healthThresholdsApply(base, 'project', null, { crit: 80, ifmin: '25' }), { temperature: { warn: 60, crit: 80 }, ifErrors: { min: 25 }, nodes: { sw1: { ifErrors: { min: 1 } } } });
  assert.deepEqual(H.healthThresholdsApply(base, 'project', null, { warn: '', ifmin: '1' }), { nodes: { sw1: { ifErrors: { min: 1 } } } }, 'un testo vuoto cancella, e per il progetto 1 non e\' una soglia');
  assert.deepEqual(H.healthThresholdsApply(base, 'project', null, {}), H.healthSanitizeThresholds(base), 'nessun campo: niente cambia');
  assert.deepEqual(H.healthThresholdsApply(base, 'project', null, { warn: 'x' }).temperature, undefined, 'un testo che non e\' una soglia cancella il campo, non si inventa');
});
test('applica: a un apparato, e un valore UGUALE a quello del progetto non e\' un\'eccezione (segue il progetto)', () => {
  const base = { temperature: { warn: 60, crit: null }, ifErrors: { min: 10 } };
  assert.deepEqual(H.healthThresholdsApply(base, 'node', 'sw1', { warn: '45', crit: '55' }).nodes, { sw1: { temperature: { warn: 45, crit: 55 } } });
  assert.equal(H.healthThresholdsApply(base, 'node', 'sw1', { warn: '60' }).nodes, undefined, '60 e\' gia\' quello del progetto: nessuna eccezione');
  assert.equal(H.healthThresholdsApply(base, 'node', 'sw1', { ifmin: '10' }).nodes, undefined);
  assert.deepEqual(H.healthThresholdsApply(base, 'node', 'sw1', { ifmin: '1' }).nodes, { sw1: { ifErrors: { min: 1 } } }, '1 e\' diverso da 10: l\'apparato li vuole tutti');
  // un'eccezione che torna uguale al progetto SPARISCE (le altre dello stesso apparato restano)
  const own = H.healthThresholdsApply(base, 'node', 'sw1', { warn: '45', ifmin: '1' });
  assert.deepEqual(H.healthThresholdsApply(own, 'node', 'sw1', { warn: '60' }).nodes, { sw1: { ifErrors: { min: 1 } } });
  // senza soglia del progetto, 1 e' comunque una scelta dell'apparato (il progetto non ha niente da ereditare)
  assert.deepEqual(H.healthThresholdsApply({}, 'node', 'sw1', { ifmin: '1' }).nodes, { sw1: { ifErrors: { min: 1 } } });
});
test('applica: uno scope che non esiste, o un campo che non esiste, non cambia niente; gli orfani si tolgono', () => {
  const base = { ifErrors: { min: 10 }, nodes: { sw1: { ifErrors: { min: 3 } }, gone: { ifErrors: { min: 4 } } } };
  assert.deepEqual(H.healthThresholdsApply(base, 'altro', 'sw1', { warn: 70 }), H.healthSanitizeThresholds(base));
  assert.deepEqual(H.healthThresholdsApply(base, 'node', 'sw1', { min: 7, temperature: 70 }), H.healthSanitizeThresholds(base));
  assert.deepEqual(Object.keys(H.healthThresholdsApply(base, 'project', null, { warn: 60 }, new Set(['sw1'])).nodes), ['sw1']);
  assert.deepEqual(Object.keys(H.healthThresholdsApply(base, 'node', 'sw2', { ifmin: 7 }, new Set(['sw1', 'sw2'])).nodes).sort(), ['sw1', 'sw2']);
});
test('applica: a un apparato = SetNode quando il valore e\' diverso (una definizione sola, mai due che divergono)', () => {
  const base = { temperature: { warn: 60, crit: null }, ifErrors: { min: 10 }, nodes: { sw2: { ifErrors: { min: 3 } } } };
  assert.deepEqual(H.healthThresholdsApply(base, 'node', 'sw1', { warn: '70' }), H.healthThresholdsSetNode(base, 'sw1', 'warn', '70'));
  assert.deepEqual(H.healthThresholdsApply(base, 'node', 'sw1', { crit: '90' }), H.healthThresholdsSetNode(base, 'sw1', 'crit', '90'));
  assert.deepEqual(H.healthThresholdsApply(base, 'node', 'sw1', { ifmin: '1' }), H.healthThresholdsSetNode(base, 'sw1', 'ifmin', '1'));
});

const pctOk = (m) => m.zones.every(z => z.from >= 0 && z.to <= 100 && z.from <= z.to) && m.marks.every(k => k.at >= 0 && k.at <= 100);
test('scala: avviso 45, critica 55, ora 48, progetto 60 → zone e segni nelle posizioni giuste', () => {
  const m = H.healthScaleModel({ value: 48, warn: 45, crit: 55, projectWarn: 60 });
  assert.equal(m.lo, 10);
  assert.equal(m.hi, 90);
  assert.deepEqual(m.zones.map(z => z.kind), ['ok', 'warn', 'crit']);
  assert.equal(m.zones[0].to, 43.75);
  assert.equal(m.zones[1].from, 43.75);
  assert.equal(m.zones[1].to, 56.25);
  assert.equal(m.zones[2].from, 56.25);
  assert.equal(m.zones[2].to, 100);
  assert.deepEqual(m.marks.map(k => [k.kind, k.at]), [['now', 47.5], ['warn', 43.75], ['crit', 56.25], ['project', 62.5]]);
  assert.ok(pctOk(m));
});
test('scala: senza soglie c\'e\' una sola zona «a posto»; senza critica l\'avviso arriva in fondo; il segno del progetto solo se diverso', () => {
  assert.deepEqual(H.healthScaleModel({ value: 40 }).zones, [{ kind: 'ok', from: 0, to: 100 }]);
  const w = H.healthScaleModel({ value: 40, warn: 60 });
  assert.deepEqual(w.zones.map(z => z.kind), ['ok', 'warn']);
  assert.equal(w.zones[1].to, 100);
  assert.equal(H.healthScaleModel({ value: 40, warn: 60, projectWarn: 60 }).marks.some(k => k.kind === 'project'), false, 'uguale al progetto: un segno solo');
  assert.equal(H.healthScaleModel({ value: 40, warn: 50, projectWarn: 60 }).marks.some(k => k.kind === 'project'), true);
});
test('scala: avviso sopra la critica → la critica vince, la zona d\'avviso e\' vuota (come healthSensorSeverity)', () => {
  const m = H.healthScaleModel({ value: 50, warn: 70, crit: 55 });
  const w = m.zones.find(z => z.kind === 'warn');
  assert.equal(w.from, w.to, 'larghezza zero');
  assert.equal(m.zones.find(z => z.kind === 'ok').to, w.from);
  assert.equal(H.healthSensorSeverity({ kind: 'temperature', value: 60, state: 'ok', limHi: null, limLo: null }, { temperature: { warn: 70, crit: 55 } }).severity, 'crit');
  assert.ok(pctOk(m));
});
test('scala: un valore fuori dal campo normale allarga la scala invece di uscirne, e un valore non numerico non entra', () => {
  const a = H.healthScaleModel({ value: 150, warn: 100 });
  assert.ok(a.hi >= 155, 'la scala arriva oltre il valore');
  assert.ok(pctOk(a));
  const b = H.healthScaleModel({ value: -20 });
  assert.ok(b.lo <= -25);
  const c = H.healthScaleModel({ value: 'x', warn: null, crit: undefined, projectWarn: NaN });
  assert.deepEqual(c.marks, []);
  assert.deepEqual(c.zones, [{ kind: 'ok', from: 0, to: 100 }]);
  assert.deepEqual(H.healthScaleModel().zones, [{ kind: 'ok', from: 0, to: 100 }]);
});
