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
