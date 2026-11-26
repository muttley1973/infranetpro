'use strict';
// ============================================================
// HEALTH SENSORS — sensori ambientali: forma, scala, stati e gravita'
// ============================================================
// Ogni caso sta qui perche' una versione sbagliata direbbe una cosa FALSA ma plausibile:
//   • un sensore assente (o non disponibile) che diventa «0 °C» o «tutto bene»;
//   • una scala letta male: 415 con precisione 1 che diventa 415 °C;
//   • una gravita' che sembra dell'apparato e invece e' una soglia dell'utente (o peggio, nostra).
// Le letture sono SINTETICHE: scritte a mano dalla MIB, non catturate da un apparato (nessun apparato del lab ha sensori).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/health-store.js');

const T0 = Date.now() - 3600 * 1000;
function sens(over) {
  return Object.assign({ sid: 'ent:1001', kind: 'temperature', label: 'CPU', value: 41.5, unit: '°C', state: 'ok',
    mib: 'ENTITY-SENSOR-MIB', oid: '1.3.6.1.2.1.99.1.1.1.4.1001', limLo: null, limHi: null }, over || {});
}
const reading = (sensors, at) => ({ at: at || T0, upCs: 1000, rows: [], sensors });

// ── La forma di una riga ─────────────────────────────────────────────────────
test('riga: un valore non letto resta null, MAI zero', () => {
  const r = H.healthReading(reading([sens({ value: null }), { sid: 'x:1' }])).sensors;
  assert.equal(r[0].value, null);
  assert.equal(r[1].value, null);
  assert.equal(r[1].limLo, null);
  assert.equal(r[1].limHi, null);
});

test('riga: i valori decimali si tengono (41,5 °C non diventa 41 ne\' 42)', () => {
  assert.equal(H.healthReading(reading([sens({ value: 41.5 })])).sensors[0].value, 41.5);
  assert.equal(H.healthReading(reading([sens({ value: -3.25 })])).sensors[0].value, -3.25);
  assert.equal(H.healthReading(reading([sens({ value: 0 })])).sensors[0].value, 0, 'uno zero VERO resta zero');
});

test('riga: valori non numerici o fuori misura diventano null', () => {
  for (const v of ['abc', NaN, Infinity, -Infinity, 1e15, {}, []]) assert.equal(H.healthReading(reading([sens({ value: v })])).sensors[0].value, null, String(v));
});

test('riga: tipo e stato fuori dall\'elenco chiuso diventano other/unknown (mai una parola inventata)', () => {
  const r = H.healthReading(reading([sens({ kind: 'plasma', state: 'esplosione' })])).sensors[0];
  assert.equal(r.kind, 'other');
  assert.equal(r.state, 'unknown');
});

test('riga: l\'id deve essere un id (finisce in un attributo e in un file)', () => {
  const r = H.healthReading(reading([sens({ sid: '<img src=x>' }), sens({ sid: '' }), sens({ sid: 'a b' }), sens({ sid: 'ok:1' })])).sensors;
  assert.deepEqual(r.map(x => x.sid), ['ok:1']);
});

test('riga: etichetta pulita dai caratteri di controllo, e se manca si usa l\'id', () => {
  const r = H.healthReading(reading([sens({ label: 'Fan\u0000\u0007 1' }), sens({ sid: 'a:2', label: '   ' })])).sensors;
  assert.equal(r[0].label, 'Fan 1');
  assert.equal(r[1].label, 'a:2');
});

test('riga: OID e MIB solo nella forma ammessa, altrimenti vuoti', () => {
  const r = H.healthReading(reading([sens({ oid: '1.3.6.1.2.1.99.1.1.1.4.7', mib: 'ENTITY-SENSOR-MIB' }), sens({ sid: 'b:1', oid: '1.3.x; DROP', mib: '<b>' })])).sensors;
  assert.equal(r[0].oid, '1.3.6.1.2.1.99.1.1.1.4.7');
  assert.equal(r[1].oid, '');
  assert.equal(r[1].mib, '');
});

test('riga: l\'unita\' ha un tetto', () => {
  assert.equal(H.healthReading(reading([sens({ unit: 'x'.repeat(40) })])).sensors[0].unit.length, 8);
});

test('lettura: sensors null (passo non fatto) e [] (nessun sensore) NON sono la stessa cosa', () => {
  assert.equal(H.healthReading({ at: T0, upCs: 1, rows: [] }).sensors, null);
  assert.equal(H.healthReading({ at: T0, upCs: 1, rows: [], sensors: 'x' }).sensors, null);
  assert.deepEqual(H.healthReading({ at: T0, upCs: 1, rows: [], sensors: [] }).sensors, []);
});

test('lettura: un tetto di sensori per apparato', () => {
  const many = []; for (let i = 0; i < 700; i++) many.push(sens({ sid: 's:' + i }));
  assert.equal(H.healthReading(reading(many)).sensors.length, 512);
});

// ── Sul disco ────────────────────────────────────────────────────────────────
test('disco: andata e ritorno dei sensori, [] compreso, e sono TUPLE di scalari', () => {
  const rd = H.healthReading(reading([sens(), sens({ sid: 'fan:1', kind: 'fan', value: null, state: 'unavailable', unit: 'rpm' })]));
  const f = H.healthFold(null, { nodes: { a: rd } }, T0);
  for (const tup of f.nodes.a.cur.s) {
    assert.ok(Array.isArray(tup));
    assert.equal(tup.length, H.HEALTH_SENSOR_COLUMNS.length);
    for (const v of tup) assert.ok(v === null || ['string', 'number'].includes(typeof v));
  }
  assert.deepEqual(H.healthDecodeFile(f).a.cur, rd);
  const vuoto = H.healthReading(reading([]));
  assert.deepEqual(H.healthDecodeFile(H.healthFold(null, { nodes: { a: vuoto } }, T0)).a.cur.sensors, []);
});

test('disco: «non letto» (null) non diventa «nessun sensore» ([]) passando dal file', () => {
  const rd = H.healthReading({ at: T0, upCs: 1, rows: [] });
  const f = H.healthFold(null, { nodes: { a: rd } }, T0);
  assert.ok(!('s' in f.nodes.a.cur));
  assert.equal(H.healthDecodeFile(f).a.cur.sensors, null);
});

test('disco: la lettura di «prima» NON si porta dietro i sensori (si tiene lo stato di adesso, una volta sola)', () => {
  let f = H.healthFold(null, { nodes: { a: H.healthReading(reading([sens({ value: 40 })], T0)) } }, T0);
  f = H.healthFold(f, { nodes: { a: H.healthReading(reading([sens({ value: 45 })], T0 + 3600000)) } }, T0 + 3600000);
  assert.equal(H.healthDecodeFile(f).a.cur.sensors[0].value, 45);
  assert.equal(H.healthDecodeFile(f).a.prev.sensors, null);
  assert.ok(!('s' in f.nodes.a.prev));
});

test('disco: un file scritto prima dei sensori (senza `s`) si legge con sensors null', () => {
  const dec = H.healthDecodeFile({ nodes: { a: { cur: { at: T0, upCs: 1, r: [['p', 1]] }, prev: null } } });
  assert.equal(dec.a.cur.sensors, null);
});

test('righe piatte dei sensori: una per sensore, con apparato e istante, solo scalari', () => {
  const f = H.healthFold(null, { nodes: { a: H.healthReading(reading([sens(), sens({ sid: 'v:1', kind: 'voltage', value: 12.1, unit: 'V' })])), b: H.healthReading({ at: T0, upCs: 1, rows: [] }) } }, T0);
  const flat = H.healthFlatSensorRows(f);
  assert.equal(flat.length, 2, 'b non ha il passo dei sensori: nessuna riga');
  for (const r of flat) {
    for (const c of ['node', 'at'].concat(H.HEALTH_SENSOR_COLUMNS)) assert.ok(c in r, c);
    for (const v of Object.values(r)) assert.ok(v === null || ['string', 'number'].includes(typeof v));
  }
});

// ── La scala (RFC 3433) ──────────────────────────────────────────────────────
test('scala: l\'esempio dell\'RFC — 415 con precisione 1 e scala units = 41,5', () => {
  assert.equal(H.healthEntityValue(415, 9, 1), 41.5);
});
test('scala: milli(8) con precisione 3 → 12345 diventa 0,012345', () => {
  assert.equal(H.healthEntityValue(12345, 8, 3), 0.012345);
});
test('scala: kilo(10) con precisione 0 → ×1000; mega(11) → ×1.000.000', () => {
  assert.equal(H.healthEntityValue(5, 10, 0), 5000);
  assert.equal(H.healthEntityValue(2, 11, 0), 2000000);
});
test('scala: units con precisione 0 → il valore com\'e\'', () => {
  assert.equal(H.healthEntityValue(37, 9, 0), 37);
  assert.equal(H.healthEntityValue(0, 9, 0), 0, 'uno zero vero resta zero');
});
test('scala: precisione NEGATIVA = cifre accurate, NON sposta la virgola', () => {
  assert.equal(H.healthEntityValue(12000, 9, -3), 12000);
});
test('scala: valori negativi (temperatura sotto zero)', () => {
  assert.equal(H.healthEntityValue(-35, 9, 1), -3.5);
});
test('scala: ±1000000000 e\' un ERRORE di lettura (RFC 3433: underflow/overflow), non una misura — gli ultimi valori validi restano', () => {
  // Misurato su una registrazione vera: 29 moduli ottici senza luce rispondevano -1000000000 con stato «ok» e la scheda mostrava «-100 W».
  assert.equal(H.healthEntityValue(-1000000000, 8, 4), null);
  assert.equal(H.healthEntityValue(1000000000, 9, 0), null);
  assert.equal(H.healthEntityValue(-1000000001, 9, 0), null, 'fuori dal tipo: nemmeno quello');
  assert.equal(H.healthEntityValue(999999999, 9, 0), 999999999, 'l\'ultimo valore valido resta un valore');
  assert.equal(H.healthEntityValue(-999999999, 9, 0), -999999999);
});
test('scala: fuori dagli intervalli dello standard → null, non si indovina', () => {
  for (const [s, p] of [[0, 0], [18, 0], [9, -9], [9, 10], [9.5, 0], [9, 1.5], [null, 0], [9, null], ['x', 0]]) {
    assert.equal(H.healthEntityValue(100, s, p), null, `scala ${s} precisione ${p}`);
  }
  for (const raw of [null, undefined, 'abc', NaN]) assert.equal(H.healthEntityValue(raw, 9, 0), null, String(raw));
});
test('scala: niente rumore binario (12345 / 10^3 = 12,345 esatto)', () => {
  assert.equal(H.healthEntityValue(12345, 9, 3), 12.345);
  assert.equal(H.healthEntityValue(3, 9, 1), 0.3);
});

test('tipo: celsius → temperature °C, rpm → fan, volts → voltage V, amperes, watts; il resto resta other senza unita\' inventata', () => {
  assert.deepEqual(H.healthEntityType(8), { kind: 'temperature', unit: '°C' });
  assert.deepEqual(H.healthEntityType(10), { kind: 'fan', unit: 'rpm' });
  assert.deepEqual(H.healthEntityType(4), { kind: 'voltage', unit: 'V' });
  assert.deepEqual(H.healthEntityType(3), { kind: 'voltage', unit: 'V' });
  assert.deepEqual(H.healthEntityType(5), { kind: 'current', unit: 'A' });
  assert.deepEqual(H.healthEntityType(6), { kind: 'power', unit: 'W' });
  assert.deepEqual(H.healthEntityType(12), { kind: 'other', unit: '' });
  assert.deepEqual(H.healthEntityType(99), { kind: 'other', unit: '' });
  assert.deepEqual(H.healthEntityType(undefined), { kind: 'other', unit: '' });
});

test('stato standard: ok / unavailable / nonoperational, il resto unknown', () => {
  assert.equal(H.healthEntityStatus(1), 'ok');
  assert.equal(H.healthEntityStatus(2), 'unavailable');
  assert.equal(H.healthEntityStatus(3), 'nonoperational');
  assert.equal(H.healthEntityStatus(0), 'unknown');
  assert.equal(H.healthEntityStatus(9), 'unknown');
});

// ── Stati dei fornitori: DATI, con la MIB da cui viene ogni enumerazione ──────
test('stati: ogni mappa cita la sua MIB e dice cosa dichiara l\'apparato, uno per uno', () => {
  const env = 'CISCO-ENVMON-MIB:CiscoEnvMonState';
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(n => H.healthMapState(env, n)), ['ok', 'warning', 'critical', 'shutdown', 'not_present', 'not_functioning']);
  assert.equal(H.healthMapState(env, 7), 'unknown');
  assert.equal(H.healthMapState(env, undefined), 'unknown');
});
test('stati: «down» = non funziona (lo dice la MIB), «reset» NON si interpreta', () => {
  const op = 'JUNIPER-MIB:jnxOperatingState';
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => H.healthMapState(op, n)), ['unknown', 'ok', 'ok', 'unknown', 'ok', 'not_functioning', 'ok']);
  assert.equal(H.healthMapState(op, 99), 'unknown');
});
test('stati: una mappa che non esiste non inventa niente', () => {
  assert.equal(H.healthMapState('NON-ESISTE', 1), 'unknown');
  assert.equal(H.healthMapState(undefined, 1), 'unknown');
});

// ── Gli OID: dichiarati, verificabili, e quelli NON letti ────────────────────
test('OID: ENTITY-SENSOR sono le colonne dell\'RFC 3433 (tipo, scala, precisione, valore, stato)', () => {
  assert.deepEqual(H.HEALTH_ENT_SENSOR_COLS, {
    type: '1.3.6.1.2.1.99.1.1.1.1', scale: '1.3.6.1.2.1.99.1.1.1.2', precision: '1.3.6.1.2.1.99.1.1.1.3',
    value: '1.3.6.1.2.1.99.1.1.1.4', status: '1.3.6.1.2.1.99.1.1.1.5',
  });
});
const _pen = (oid) => { const m = /^1\.3\.6\.1\.4\.1\.(\d+)\./.exec(oid); return m ? m[1] : null; };
function oidsOf(fam) {
  const out = H.healthFamilyBases(fam).slice();
  for (const t of (fam.tables || [])) out.push(t.base);
  for (const s of (fam.scalars || [])) out.push(s.oid);
  return out;
}
test('famiglie: ogni famiglia sta sotto UN solo fornitore (il PEN si ricava dall\'OID), e gli OID sono solo numerici', () => {
  assert.ok(H.HEALTH_SENSOR_FAMILIES.length >= 3);
  for (const fam of H.HEALTH_SENSOR_FAMILIES) {
    const root = H.healthFamilyRoot(fam);
    const pen = _pen(root);
    assert.ok(pen, `${fam.id}: la radice ${root} e' enterprise-shaped`);
    for (const o of oidsOf(fam)) { assert.equal(_pen(o + '.'), pen, `${fam.id}: ${o} sotto lo stesso PEN`); assert.match(o, /^[0-9.]+$/); }
    assert.ok(fam.mib && fam.id, fam.id + ' ha id e MIB');
  }
});
test('famiglie: id unici; ogni mappa di stati citata esiste; ogni sensore ha tipo e unita\' dichiarati', () => {
  const ids = H.HEALTH_SENSOR_FAMILIES.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const fam of H.HEALTH_SENSOR_FAMILIES) {
    for (const t of (fam.tables || [])) {
      assert.ok(H.HEALTH_SENSOR_KINDS.includes(t.kind), `${fam.id}:${t.sid} kind`);
      assert.equal(typeof t.unit, 'string');
      assert.ok(t.states in H.HEALTH_STATE_MAPS || !t.cols.state, `${fam.id}:${t.sid} mappa di stati`);
      assert.ok(t.cols.label || t.label, 'ha una etichetta');
    }
    for (const s of (fam.scalars || [])) { assert.ok(H.HEALTH_SENSOR_KINDS.includes(s.kind), s.sid); assert.ok(s.div >= 1, s.sid); assert.ok(s.label, s.sid); }
  }
});
test('famiglie: i fornitori SONO tre (con una fonte letta) — non ce n\'e\' uno scritto «a memoria» per HP/Aruba', () => {
  assert.deepEqual(H.HEALTH_SENSOR_FAMILIES.map(f => _pen(H.healthFamilyRoot(f))).sort(), ['14988', '2636', '9']);
});
test('famiglie: quello che non si e\' potuto verificare NON e\' letto (FRU Juniper, gauge MikroTik)', () => {
  const j = JSON.stringify(H.HEALTH_SENSOR_FAMILIES);
  assert.doesNotMatch(j, /2636\.3\.1\.15/, 'jnxFruTable non e\' letta');
  assert.doesNotMatch(j, /14988\.1\.1\.3\.100/, 'mtxrGaugeTable non e\' letta');
  assert.ok(H.HEALTH_SENSOR_NOT_READ.length >= 3, 'l\'elenco di cio\' che non si legge e\' dichiarato');
});
test('famiglie: i decimi (DISPLAY-HINT d-1) sono dichiarati dove la MIB li ha; i millivolt dove sono millivolt', () => {
  const mk = H.HEALTH_SENSOR_FAMILIES.find(f => f.id === 'mikrotik-health');
  for (const s of mk.scalars) {
    if (s.kind === 'temperature' || s.kind === 'voltage') assert.equal(s.div, 10, s.sid);
    if (s.kind === 'fan') assert.equal(s.div, 1, s.sid);
  }
  const cs = H.HEALTH_SENSOR_FAMILIES.find(f => f.id === 'cisco-envmon');
  assert.equal(cs.tables.find(t => t.sid === 'volt').div, 1000);
  assert.equal(cs.tables.find(t => t.sid === 'temp').div, undefined, 'la temperatura Cisco e\' gia\' in °C');
});
test('famiglie: Juniper dichiara che sotto 1 la riga non e\' una misura (la MIB: «zero se non disponibile»)', () => {
  const t = H.HEALTH_SENSOR_FAMILIES.find(f => f.id === 'juniper-operating').tables[0];
  assert.equal(t.valueMin, 1);
  assert.equal(t.multiIndex, true);
});
test('famiglie: la radice e le basi si ricavano dai dati (nessun elenco a parte)', () => {
  const cs = H.HEALTH_SENSOR_FAMILIES.find(f => f.id === 'cisco-envmon');
  assert.equal(H.healthFamilyRoot(cs), cs.tables[0].base);
  assert.equal(H.healthFamilyBases(cs).length, 14);
  assert.equal(H.healthFamilyRoot({ id: 'x' }), '');
  assert.deepEqual(H.healthFamilyBases({ id: 'x' }), []);
});

// ── Soglie dell'utente ───────────────────────────────────────────────────────
test('soglie: nessun valore di fabbrica — senza configurazione sono vuote', () => {
  assert.deepEqual(H.healthSanitizeThresholds(undefined), {});
  assert.deepEqual(H.healthSanitizeThresholds({}), {});
  assert.deepEqual(H.healthSanitizeThresholds({ temperature: {} }), {});
  assert.deepEqual(H.healthSanitizeThresholds({ temperature: { warn: '', crit: null } }), {});
});
test('soglie: numeri validi si tengono, il resto diventa null, e fuori da -50..200 °C non e\' una soglia', () => {
  assert.deepEqual(H.healthSanitizeThresholds({ temperature: { warn: 60, crit: '75' } }), { temperature: { warn: 60, crit: 75 } });
  assert.deepEqual(H.healthSanitizeThresholds({ temperature: { warn: 60, crit: 'x' } }), { temperature: { warn: 60, crit: null } });
  assert.deepEqual(H.healthSanitizeThresholds({ temperature: { warn: 900, crit: -300 } }), {});
});
test('soglie: un oggetto qualunque non rompe niente', () => {
  for (const v of [null, 5, 'x', [], { temperature: 5 }, { temperature: 'x' }]) assert.deepEqual(H.healthSanitizeThresholds(v), {});
});

// ── La gravita': da DOVE viene ───────────────────────────────────────────────
const sev = (row, thr) => H.healthSensorSeverity(H.healthReading(reading([row])).sensors[0], thr);

test('gravita\': lo stato dell\'apparato vince, ed e\' sua (source device)', () => {
  assert.deepEqual(sev(sens({ state: 'critical' })), { severity: 'crit', source: 'device', why: 'state' });
  assert.deepEqual(sev(sens({ state: 'shutdown' })), { severity: 'crit', source: 'device', why: 'state' });
  assert.deepEqual(sev(sens({ state: 'not_functioning' })), { severity: 'crit', source: 'device', why: 'state' });
  assert.deepEqual(sev(sens({ state: 'warning' })), { severity: 'warn', source: 'device', why: 'state' });
});
test('gravita\': un limite dichiarato dall\'apparato e\' suo', () => {
  assert.deepEqual(sev(sens({ value: 86, limHi: 80 })), { severity: 'crit', source: 'device', why: 'limit' });
  assert.deepEqual(sev(sens({ value: 10.5, limLo: 11 })), { severity: 'crit', source: 'device', why: 'limit' });
  assert.equal(sev(sens({ value: 80, limHi: 80 })).severity, null, 'sul limite non e\' oltre');
});
test('gravita\': la soglia dell\'UTENTE e\' marcata user_default, mai presentata come dato dell\'apparato', () => {
  const thr = H.healthSanitizeThresholds({ temperature: { warn: 60, crit: 75 } });
  assert.deepEqual(sev(sens({ value: 62 }), thr), { severity: 'warn', source: 'user_default', why: 'threshold' });
  assert.deepEqual(sev(sens({ value: 75 }), thr), { severity: 'crit', source: 'user_default', why: 'threshold' });
  assert.equal(sev(sens({ value: 59.9 }), thr).severity, null);
});
test('gravita\': senza stato, senza limiti e senza soglia dell\'utente NON si inventa niente', () => {
  assert.deepEqual(sev(sens({ value: 98 })), { severity: null, source: null, why: null });
  assert.deepEqual(sev(sens({ value: 98 }), {}), { severity: null, source: null, why: null });
});
test('gravita\': la soglia dell\'utente vale per la temperatura, non per una tensione', () => {
  const thr = H.healthSanitizeThresholds({ temperature: { warn: 10, crit: 20 } });
  assert.equal(sev(sens({ kind: 'voltage', unit: 'V', value: 12 }), thr).severity, null);
});
test('gravita\': un valore NON letto non ha gravita\' (ne\' dalla soglia dell\'utente)', () => {
  const thr = H.healthSanitizeThresholds({ temperature: { warn: 0, crit: 1 } });
  assert.equal(sev(sens({ value: null, state: 'unavailable' }), thr).severity, null);
  assert.equal(sev(sens({ value: null, state: 'ok' }), thr).severity, null);
});
test('gravita\': non presente / non disponibile / non operativo non sono un allarme', () => {
  for (const state of ['not_present', 'unavailable', 'nonoperational', 'unknown', 'ok']) assert.equal(sev(sens({ state, value: 99, limHi: 50 }), {}).severity === 'crit', state === 'ok' || state === 'unknown', state);
});
test('gravita\': una riga di un fan senza valore ma con stato critico e\' un allarme (lo dice l\'apparato)', () => {
  assert.equal(sev(sens({ kind: 'fan', value: null, unit: '', state: 'not_functioning' })).severity, 'crit');
});
test('gravita\': lo stato dell\'apparato vince anche sulla soglia dell\'utente', () => {
  const thr = H.healthSanitizeThresholds({ temperature: { warn: 10, crit: 20 } });
  assert.equal(sev(sens({ value: 50, state: 'warning' }), thr).source, 'device');
});

// ── Il riepilogo ─────────────────────────────────────────────────────────────
test('riepilogo: passo non fatto → not_read; apparato che non pubblica sensori → not_available (mai «tutto bene»)', () => {
  assert.equal(H.healthSummarizeSensors(H.healthReading({ at: T0, upCs: 1, rows: [] })).state, 'not_read');
  assert.equal(H.healthSummarizeSensors(null).state, 'not_read');
  const na = H.healthSummarizeSensors(H.healthReading(reading([])));
  assert.equal(na.state, 'not_available');
  assert.deepEqual(na.items, []);
  assert.equal(na.counts.total, 0);
});
test('riepilogo: i sensori ci sono, ordinati per gravita\' e poi per tipo (temperatura prima) e caldo; conteggi onesti', () => {
  const rd = H.healthReading(reading([
    sens({ sid: 'a:1', label: 'Zeta', value: 40 }),
    sens({ sid: 'a:2', label: 'Alfa', value: 90, state: 'warning' }),
    sens({ sid: 'a:3', label: 'Fan', kind: 'fan', value: null, state: 'critical', unit: '' }),
    sens({ sid: 'a:4', label: 'Mancante', value: null, state: 'unavailable' }),
    sens({ sid: 'a:5', label: 'Slot vuoto', kind: 'psu', value: null, state: 'not_present', unit: '' }),
  ]));
  const s = H.healthSummarizeSensors(rd);
  assert.equal(s.state, 'read');
  // critico, avviso; poi la temperatura (la letta prima di quella non letta), poi l'alimentatore
  assert.deepEqual(s.items.map(i => i.sid), ['a:3', 'a:2', 'a:1', 'a:4', 'a:5']);
  assert.equal(s.items[0].sid, 'a:3', 'prima il critico');
  assert.equal(s.items[1].sid, 'a:2', 'poi l\'avviso');
  assert.deepEqual(s.counts, { total: 5, crit: 1, warn: 1, unavailable: 3, absent: 1 });
});

// ── L'ordine dei sensori: serve a chi guarda una lista di 226 ─────────────────────────────────
// Misurato su una registrazione SNMP vera (uno switch con 226 sensori): l'ordine alfabetico dei TIPI metteva le correnti dei moduli ottici
// prima delle temperature dell'apparato. Ogni caso sta perche' un ordine sbagliato direbbe una cosa plausibile: «40 sensori, nessuna
// temperatura».
const ids = (items) => items.map(i => i.sid);
const sumOf = (list, thr) => H.healthSummarizeSensors(H.healthReading(reading(list)), thr);
test('ordine: senza gravita\' i tipi vanno nell\'ordine di HEALTH_SENSOR_KINDS (temperatura, ventole, alimentatori, tensioni, correnti, potenze, altro)', () => {
  const list = H.HEALTH_SENSOR_KINDS.slice().reverse().map((kind, i) => sens({ sid: 'k:' + kind, kind, label: 'Z' + i, value: 5, unit: '' }));
  assert.deepEqual(ids(sumOf(list).items), H.HEALTH_SENSOR_KINDS.map(k => 'k:' + k));
});
test('ordine: dentro la temperatura il piu\' CALDO prima, il non letto in fondo; a parita\' per nome', () => {
  const s = sumOf([
    sens({ sid: 't:fresco', label: 'Fresco', value: 22.4 }),
    sens({ sid: 't:nl', label: 'Aaa non letto', value: null, state: 'unavailable' }),
    sens({ sid: 't:caldo', label: 'Zzz caldo', value: 64.8 }),
    sens({ sid: 't:b', label: 'B pari', value: 40 }),
    sens({ sid: 't:a', label: 'A pari', value: 40 }),
  ]);
  assert.deepEqual(ids(s.items), ['t:caldo', 't:a', 't:b', 't:fresco', 't:nl']);
});
test('ordine: dentro gli altri tipi per nome, e i numeri contano come numeri (Fan 2 prima di Fan 10)', () => {
  const s = sumOf([
    sens({ sid: 'f:10', kind: 'fan', label: 'Fan 10', value: 4000, unit: 'rpm' }),
    sens({ sid: 'f:2', kind: 'fan', label: 'Fan 2', value: 9000, unit: 'rpm' }),
    sens({ sid: 'f:1', kind: 'fan', label: 'Fan 1', value: 1000, unit: 'rpm' }),
  ]);
  assert.deepEqual(ids(s.items), ['f:1', 'f:2', 'f:10'], 'per nome, NON per giri: una ventola lenta non e\' «piu\' importante» se l\'apparato non lo dice');
});
test('ordine: la gravita\' viene sempre prima del tipo — un avviso di corrente sta sopra una temperatura a posto', () => {
  const s = sumOf([
    sens({ sid: 'ok:t', label: 'CPU', value: 99 }),
    sens({ sid: 'warn:c', kind: 'current', label: 'Corrente', value: 3, unit: 'A', state: 'warning' }),
    sens({ sid: 'crit:v', kind: 'voltage', label: 'Tensione', value: 11, unit: 'V', state: 'critical' }),
  ]);
  assert.deepEqual(ids(s.items), ['crit:v', 'warn:c', 'ok:t']);
});
test('ordine: uno switch con tanti moduli ottici — le temperature dell\'apparato (le piu\' calde) stanno in cima, le correnti in fondo', () => {
  const list = [];
  for (let i = 1; i <= 35; i++) list.push(sens({ sid: 'dom:t' + i, label: 'DOM Temperature Sensor for Ethernet' + i, value: 22 + (i % 18) }));   // 22-39
  for (let i = 1; i <= 39; i++) list.push(sens({ sid: 'dom:c' + i, kind: 'current', label: 'DOM Current for Ethernet' + i, value: 0.006, unit: 'A' }));
  const caldi = [64.8, 64, 53.3, 52, 48, 47];
  caldi.forEach((v, i) => list.push(sens({ sid: 'dev:t' + i, label: 'Sensore dell\'apparato ' + i, value: v })));
  const s = sumOf(list);
  assert.deepEqual(ids(s.items).slice(0, 6), caldi.map((v, i) => 'dev:t' + i), 'le sei piu\' calde sono le dell\'apparato, senza guardare nessun nome');
  const firstCurrent = ids(s.items).findIndex(x => x.startsWith('dom:c'));
  assert.equal(firstCurrent, 35 + 6, 'le correnti vengono dopo TUTTE le temperature');
});
test('ordine: un tipo che l\'elenco non conosce va in fondo, e l\'ordine e\' lo stesso a ogni lettura', () => {
  const list = [sens({ sid: 'x:1', kind: 'altro-tipo', label: 'A', value: 1, unit: '' }), sens({ sid: 'x:2', label: 'B', value: 9 }), sens({ sid: 'x:3', kind: 'other', label: 'C', value: 2, unit: '' })];
  const a = ids(sumOf(list).items), b = ids(sumOf(list.slice().reverse()).items);
  assert.deepEqual(a, b, 'non dipende dall\'ordine in cui l\'apparato li ha elencati');
  assert.equal(a[0], 'x:2');
});
test('riepilogo: le soglie dell\'utente entrano nel conteggio, e dicono da chi vengono', () => {
  const rd = H.healthReading(reading([sens({ value: 80 })]));
  const s = H.healthSummarizeSensors(rd, H.healthSanitizeThresholds({ temperature: { warn: 60, crit: 75 } }));
  assert.equal(s.counts.crit, 1);
  assert.equal(s.items[0].source, 'user_default');
  assert.equal(H.healthSummarizeSensors(rd).counts.crit, 0, 'senza soglie dell\'utente: nessun giudizio nostro');
});
test('riepilogo: un apparato che pubblica SOLO sensori non disponibili e\' «read» (esistono) ma senza gravita\'', () => {
  const s = H.healthSummarizeSensors(H.healthReading(reading([sens({ value: null, state: 'unavailable' })])));
  assert.equal(s.state, 'read');
  assert.equal(s.counts.crit + s.counts.warn, 0);
  assert.equal(s.counts.unavailable, 1);
});
