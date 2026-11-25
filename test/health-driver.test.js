'use strict';
// ============================================================
// HEALTH DRIVER — la lettura di stato/errori/scarti di TUTTE le interfacce (drivers/snmp.js, `pollHealth`)
// ============================================================
// Si prova senza rete: `extractHealthIf` e' pura (mappa di varbind → righe) e `_readHealth` lavora su una sessione
// che qui e' FINTA. I tipi dei varbind sono quelli veri di net-snmp (Integer/Counter32/TimeTicks = numero,
// OctetString = Buffer): una finta che desse tutto Buffer farebbe passare un decodificatore che poi crolla sul vero.
// Le risposte sono SINTETICHE, scritte a mano, non catturate da un apparato.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snmp = require('net-snmp');
const D = require('../drivers/snmp.js');
const { extractHealthIf, _readHealth } = D._internals;
const H = require('../lib/health-store.js');

const NAME = H.HEALTH_IF_NAME_OID, DESCR = H.HEALTH_IF_DESCR_OID;
const O = H.HEALTH_IF_OIDS;

// Sessione finta: `subtree` percorre le colonne, `get` risponde a sysUpTime. `set` NON esiste: chiamarlo e' un errore.
function fakeSession(table, opts) {
  opts = opts || {};
  const calls = { subtree: [], get: [] };
  return {
    calls,
    subtree(base, _reps, feed, done) {
      calls.subtree.push(base);
      if (opts.failBases && opts.failBases.includes(base)) return setImmediate(() => done(new Error('timeout')));
      const rows = Object.keys(table).filter(o => o.startsWith(base + '.'))
        .sort((a, b) => Number(a.slice(base.length + 1)) - Number(b.slice(base.length + 1)))
        .map(oid => ({ oid, type: snmp.ObjectType.Integer, value: table[oid] }));
      setImmediate(() => { if (rows.length) feed(rows); done(); });
    },
    get(oids, cb) {
      calls.get.push(oids.slice());
      if (opts.upErr) return setImmediate(() => cb(new Error('timeout')));
      const out = oids.map(oid => (oid in table
        ? { oid, type: snmp.ObjectType.TimeTicks, value: table[oid] }
        : { oid, type: snmp.ObjectType.NoSuchInstance, value: null }));
      setImmediate(() => cb(null, out));
    },
  };
}

// Un apparato da `n` interfacce, valori deterministici.
function device(n, over) {
  const t = {};
  for (let i = 1; i <= n; i++) {
    t[`${NAME}.${i}`] = Buffer.from('Gi1/0/' + i);
    t[`${O.oper}.${i}`] = 1; t[`${O.admin}.${i}`] = 1;
    t[`${O.inErrors}.${i}`] = i; t[`${O.outErrors}.${i}`] = 0;
    t[`${O.inDiscards}.${i}`] = 10 * i; t[`${O.outDiscards}.${i}`] = 0;
    t[`${O.fcs}.${i}`] = 2; t[`${O.disc}.${i}`] = 0;
  }
  t[H.HEALTH_SYS_UPTIME] = 123456;
  return Object.assign(t, over || {});
}

// ── extractHealthIf: pura ────────────────────────────────────────────────────
test('estrazione: una riga per interfaccia, nell\'ordine NUMERICO dell\'indice (non lessicografico)', () => {
  const rows = extractHealthIf(device(12), NAME);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map(r => r.ifName).slice(0, 3), ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3']);
  assert.equal(rows[9].ifName, 'Gi1/0/10');
  assert.equal(rows[0].inErrors, 1);
  assert.equal(rows[2].inDiscards, 30);
  assert.equal(rows[0].fcs, 2);
});

test('estrazione: una colonna che l\'apparato non pubblica resta null, MAI zero', () => {
  const t = device(2);
  for (const o of Object.keys(t)) if (o.startsWith(O.fcs + '.') || o.startsWith(O.disc + '.') || o.startsWith(O.outDiscards + '.')) delete t[o];
  const rows = extractHealthIf(t, NAME);
  assert.equal(rows[0].fcs, null);
  assert.equal(rows[0].disc, null);
  assert.equal(rows[0].outDiscards, null);
  assert.equal(rows[0].inErrors, 1, 'le altre restano');
});

test('estrazione: un contatore a 64 bit (Buffer big-endian) si decodifica, non si legge «a stringa»', () => {
  const t = device(1);
  t[`${O.inErrors}.1`] = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);   // 2^32
  assert.equal(extractHealthIf(t, NAME)[0].inErrors, 4294967296);
});

test('estrazione: un Counter32 che per caso e\' ASCII stampabile non si rovina', () => {
  // 0x41424344 = «ABCD»: arriva come NUMERO (Counter32), e un decodificatore «a stringa» lo butterebbe.
  const t = device(1);
  t[`${O.inErrors}.1`] = 0x41424344;
  assert.equal(extractHealthIf(t, NAME)[0].inErrors, 0x41424344);
});

test('estrazione: indici che non sono numeri, e righe senza nome, non entrano', () => {
  const t = device(2);
  t[`${NAME}.abc`] = Buffer.from('finto');
  t[`${NAME}.3`] = Buffer.from('   ');
  t[`${O.inErrors}.3`] = 99;
  const rows = extractHealthIf(t, NAME);
  assert.deepEqual(rows.map(r => r.ifName), ['Gi1/0/1', 'Gi1/0/2']);
});

test('estrazione: stato e amministrazione devono essere interi; un Buffer o un testo diventano null', () => {
  const t = device(1);
  t[`${O.oper}.1`] = Buffer.from([1]);
  t[`${O.admin}.1`] = 'up';
  const r = extractHealthIf(t, NAME)[0];
  assert.equal(r.oper, null);
  assert.equal(r.admin, null);
});

test('estrazione: un tetto di 4096 righe', () => {
  const t = {};
  for (let i = 1; i <= 5000; i++) t[`${NAME}.${i}`] = Buffer.from('p' + i);
  assert.equal(extractHealthIf(t, NAME).length, 4096);
});

test('estrazione: senza nomi non c\'e\' nessuna riga (i contatori da soli non dicono di quale interfaccia)', () => {
  const t = device(3);
  for (const o of Object.keys(t)) if (o.startsWith(NAME + '.')) delete t[o];
  assert.deepEqual(extractHealthIf(t, NAME), []);
});

// ── _readHealth: la lettura sulla sessione ───────────────────────────────────
test('lettura: righe, sysUpTime e istante; il resultato passa per la lib senza perdere niente', async () => {
  const s = fakeSession(device(4));
  const before = Date.now();
  const r = await _readHealth(s, 3000);
  assert.equal(r.rows.length, 4);
  assert.equal(r.upCs, 123456);
  assert.equal(r.via, 'ifName');
  assert.equal(r.partial, false);
  assert.ok(r.at >= before && r.at <= Date.now());
  const clean = H.healthReading(r);
  assert.equal(clean.rows.length, 4);
  assert.deepEqual(clean.rows[1], r.rows[1]);
});

test('lettura: le INTERFACCE leggono NOME e le otto colonne, e basta (nessun OID di un fornitore)', async () => {
  const s = fakeSession(device(1));
  await _readHealth(s, 3000, { sensors: false });
  const want = [NAME].concat(Object.values(O)).sort();
  assert.deepEqual(s.calls.subtree.slice().sort(), want);
  for (const b of s.calls.subtree) assert.match(b, /^1\.3\.6\.1\.2\.1\.(2\.2|31\.1\.1|10\.7)\./, 'IF-MIB / ifX / EtherLike: ' + b);
});

test('lettura: sysUpTime si legge con una GET sola, dopo le walk (i sensori hanno le loro GET, a parte)', async () => {
  const s = fakeSession(device(1));
  await _readHealth(s, 3000, { sensors: false });
  assert.deepEqual(s.calls.get, [[H.HEALTH_SYS_UPTIME]]);
});

test('lettura: se ifName manca si ripiega su ifDescr e lo dice', async () => {
  const t = device(2);
  for (const o of Object.keys(t)) if (o.startsWith(NAME + '.')) { t[o.replace(NAME, DESCR)] = t[o]; delete t[o]; }
  const s = fakeSession(t);
  const r = await _readHealth(s, 3000);
  assert.equal(r.via, 'ifDescr');
  assert.equal(r.rows.length, 2);
  assert.ok(s.calls.subtree.includes(DESCR));
});

test('lettura: sysUpTime che non risponde → upCs null (non zero), le righe restano', async () => {
  const r = await _readHealth(fakeSession(device(2), { upErr: true }), 3000);
  assert.equal(r.upCs, null);
  assert.equal(r.rows.length, 2);
});

test('lettura: una colonna in timeout → lettura PARZIALE dichiarata, la colonna e\' null (non zero)', async () => {
  const r = await _readHealth(fakeSession(device(2), { failBases: [O.fcs] }), 3000);
  assert.equal(r.partial, true);
  assert.equal(r.rows[0].fcs, null);
  assert.equal(r.rows[0].inErrors, 1);
});

test('lettura: un apparato senza interfacce → nessuna riga (la lib dice «non disponibile»)', async () => {
  const r = await _readHealth(fakeSession({ [H.HEALTH_SYS_UPTIME]: 5 }), 3000);
  assert.deepEqual(r.rows, []);
  assert.equal(H.healthSummarizeIf(null, H.healthReading(r)).state, 'not_available');
});

test('lettura: mai una SET (la sessione finta non ha `set`, e il codice non ne cita)', async () => {
  const s = fakeSession(device(2));
  assert.equal(typeof s.set, 'undefined');
  await _readHealth(s, 3000);
  const src = fs.readFileSync(path.join(__dirname, '..', 'drivers', 'snmp.js'), 'utf8');
  const from = src.indexOf('---- SALUTE delle interfacce');
  const to = src.indexOf('module.exports = { poll,');
  assert.ok(from > 0 && to > from);
  assert.doesNotMatch(src.slice(from, to), /\.set\(|session\.set|SetRequest/);
});

// ── La rotta ─────────────────────────────────────────────────────────────────
test('rotta: /api/poll-health solo admin, e il driver espone pollHealth', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'discovery.js'), 'utf8');
  assert.match(src, /router\.post\('\/api\/poll-health', auth\.requireAdmin/);
  assert.equal(typeof D.pollHealth, 'function');
});

test('rotta: senza host il driver rifiuta, non apre una sessione', async () => {
  await assert.rejects(() => D.pollHealth({ host: '  ', driver: 'snmp-v2c' }), /Host/);
});
