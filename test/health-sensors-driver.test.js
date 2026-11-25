'use strict';
// ============================================================
// HEALTH SENSORS · DRIVER — la lettura dei sensori (drivers/snmp.js, `_readSensors`) su una sessione FINTA
// ============================================================
// Le risposte sono SINTETICHE, scritte a mano dalle MIB: nessun apparato del lab pubblica sensori, quindi non c'e' una
// cattura vera da riprodurre (e i valori sono DICHIARATI finti — v. lib/health-store.js «DA VERIFICARE su hardware»).
// Cio' che si prova qui: la scala, il cancello per fornitore (si chiede una MIB solo a chi dice di essere di quel
// fornitore), il ripiego (il vendor non sostituisce lo standard), e soprattutto che un'assenza resti un'assenza.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snmp = require('net-snmp');
const D = require('../drivers/snmp.js');
const { _readSensors, _readHealth, extractEntitySensors, extractVendorTable, extractVendorScalars } = D._internals;
const H = require('../lib/health-store.js');

const C = H.HEALTH_ENT_SENSOR_COLS;
const SYSOID = '1.3.6.1.2.1.1.2.0';
const NAME = H.HEALTH_ENT_PHYS_NAME, DESCR = H.HEALTH_ENT_PHYS_DESCR;
const ent = (col, idx) => `${C[col]}.${idx}`;

function cmp(a, b) {
  const A = a.split('.').map(Number), B = b.split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] ?? -1) - (B[i] ?? -1); if (d) return d; }
  return 0;
}
// Sessione finta: `subtree` percorre le colonne in ordine di OID, `get` risponde ai valori noti (number | Buffer | string OID).
// `set` NON esiste. `failBases`: le walk di queste basi vanno in timeout. `getFails`: ogni GET fallisce.
function fakeSession(table, opts) {
  opts = opts || {};
  const calls = { subtree: [], get: [] };
  return {
    calls,
    subtree(base, _reps, feed, done) {
      calls.subtree.push(base);
      if ((opts.failBases || []).some(b => base.startsWith(b)) || opts.failAll) return setImmediate(() => done(new Error('timeout')));
      const rows = Object.keys(table).filter(o => o.startsWith(base + '.')).sort(cmp)
        .map(oid => ({ oid, type: typeof table[oid] === 'number' ? snmp.ObjectType.Integer : snmp.ObjectType.OctetString, value: table[oid] }));
      setImmediate(() => { if (rows.length) feed(rows); done(); });
    },
    get(oids, cb) {
      calls.get.push(oids.slice());
      if (opts.getFails) return setImmediate(() => cb(new Error('timeout')));
      const out = oids.map(oid => (oid in table
        ? { oid, type: snmp.ObjectType.Integer, value: table[oid] }
        : { oid, type: snmp.ObjectType.NoSuchInstance, value: null }));
      setImmediate(() => cb(null, out));
    },
  };
}

// ── Standard: ENTITY-SENSOR-MIB ──────────────────────────────────────────────
function standard() {
  const t = { [SYSOID]: '1.3.6.1.4.1.99999.1' };   // un fornitore qualunque: lo standard non guarda il fornitore
  const add = (idx, type, scale, prec, value, status) => {
    t[ent('type', idx)] = type; t[ent('scale', idx)] = scale; t[ent('precision', idx)] = prec; t[ent('value', idx)] = value; t[ent('status', idx)] = status;
  };
  add(1001, 8, 9, 1, 415, 1);        // 41,5 °C
  add(1002, 10, 9, 0, 4200, 1);      // 4200 rpm
  add(1003, 4, 8, 0, 12100, 1);      // milli → 12,1 V
  add(1004, 8, 9, 0, 0, 2);          // unavailable: il numero non vuol dire niente
  add(1005, 8, 99, 0, 55, 1);        // scala fuori standard
  add(1006, 12, 9, 0, 1, 1);         // truthvalue: si mostra, non si interpreta
  t[`${NAME}.1001`] = Buffer.from('CPU Temp');
  t[`${NAME}.1002`] = Buffer.from('');                    // nome vuoto → ripiego sulla descrizione
  t[`${DESCR}.1002`] = Buffer.from('Fan tray 1');
  t[`${NAME}.1003`] = Buffer.from('12V rail');
  return t;
}

test('standard: valori SCALATI, stato dall\'apparato, nome da entPhysicalName e ripiego sulla descrizione', async () => {
  const r = await _readSensors(fakeSession(standard()), 3000);
  assert.deepEqual(r.via, ['entity-sensor']);
  const by = Object.fromEntries(r.rows.map(x => [x.sid, x]));
  assert.equal(by['ent:1001'].value, 41.5);
  assert.equal(by['ent:1001'].unit, '°C');
  assert.equal(by['ent:1001'].kind, 'temperature');
  assert.equal(by['ent:1001'].label, 'CPU Temp');
  assert.equal(by['ent:1001'].state, 'ok');
  assert.equal(by['ent:1001'].mib, 'ENTITY-SENSOR-MIB');
  assert.equal(by['ent:1001'].oid, '1.3.6.1.2.1.99.1.1.1.4.1001');
  assert.equal(by['ent:1002'].value, 4200);
  assert.equal(by['ent:1002'].kind, 'fan');
  assert.equal(by['ent:1002'].label, 'Fan tray 1');
  assert.equal(by['ent:1003'].value, 12.1);
  assert.equal(by['ent:1003'].unit, 'V');
});

test('standard: «unavailable» → value null (MAI il numero che c\'e\' dentro), stato unavailable', async () => {
  const r = await _readSensors(fakeSession(standard()), 3000);
  const s = r.rows.find(x => x.sid === 'ent:1004');
  assert.equal(s.value, null);
  assert.equal(s.state, 'unavailable');
});

test('standard: scala fuori dallo standard → value null e stato unknown (non si indovina)', async () => {
  const s = (await _readSensors(fakeSession(standard()), 3000)).rows.find(x => x.sid === 'ent:1005');
  assert.equal(s.value, null);
  assert.equal(s.state, 'unknown');
});

test('standard: senza nome ne\' descrizione l\'etichetta e\' «Sensor <indice>», non una stringa vuota', async () => {
  const s = (await _readSensors(fakeSession(standard()), 3000)).rows.find(x => x.sid === 'ent:1005');
  assert.equal(s.label, 'Sensor 1005');
});

test('standard: un tipo che non e\' una grandezza nota si mostra come other, senza unita\' inventata', async () => {
  const s = (await _readSensors(fakeSession(standard()), 3000)).rows.find(x => x.sid === 'ent:1006');
  assert.equal(s.kind, 'other');
  assert.equal(s.unit, '');
});

test('standard: le righe passano per la lib senza perdere niente, e il riepilogo le legge', async () => {
  const r = await _readSensors(fakeSession(standard()), 3000);
  const rd = H.healthReading({ at: Date.now(), upCs: 1, rows: [], sensors: r.rows });
  assert.equal(rd.sensors.length, r.rows.length);
  const s = H.healthSummarizeSensors(rd, H.healthSanitizeThresholds({ temperature: { warn: 40, crit: 60 } }));
  assert.equal(s.state, 'read');
  assert.equal(s.items[0].sid, 'ent:1001', 'la temperatura sopra la soglia dell\'utente passa in testa');
  assert.equal(s.items[0].severity, 'warn');
  assert.equal(s.items[0].source, 'user_default');
});

// ── Costo: una walk in meno dove non serve ───────────────────────────────────
test('costo: senza sensori standard si legge UNA sola colonna (il valore), non le cinque', async () => {
  const s = fakeSession({ [SYSOID]: '1.3.6.1.4.1.99999.1' });
  await _readSensors(s, 3000);
  const ent = s.calls.subtree.filter(b => b.startsWith('1.3.6.1.2.1.99.1.1.1'));
  assert.deepEqual(ent, [C.value]);
});
test('costo: con sensori standard si leggono tutte e cinque le colonne', async () => {
  const s = fakeSession(standard());
  await _readSensors(s, 3000);
  const ent = s.calls.subtree.filter(b => b.startsWith('1.3.6.1.2.1.99.1.1.1')).sort();
  assert.deepEqual(ent, Object.values(C).sort());
});

// ── Assenza: mai uno zero ────────────────────────────────────────────────────
test('apparato senza sensori (una VM): rows [] — «risposto e niente», non «non letto»', async () => {
  const r = await _readSensors(fakeSession({ [SYSOID]: '1.3.6.1.4.1.99999.1' }), 3000);
  assert.deepEqual(r.rows, []);
  assert.equal(H.healthSummarizeSensors(H.healthReading({ at: Date.now(), upCs: 1, rows: [], sensors: r.rows })).state, 'not_available');
});

test('walk in timeout e nessuna riga: rows NULL = non letto (non «non ne ha»)', async () => {
  const r = await _readSensors(fakeSession({ [SYSOID]: '1.3.6.1.4.1.99999.1' }, { failAll: true }), 3000);
  assert.equal(r.rows, null);
  assert.equal(r.partial, true);
  assert.equal(H.healthSummarizeSensors(H.healthReading({ at: Date.now(), upCs: 1, rows: [], sensors: r.rows })).state, 'not_read');
});

test('walk in timeout MA qualche riga letta: si tengono le righe e si dichiara la lettura parziale', async () => {
  const t = standard();
  const r = await _readSensors(fakeSession(t, { failBases: ['1.3.6.1.2.1.99.1.1.1.5'] }), 3000);   // manca la colonna dello stato
  assert.ok(r.rows.length > 0);
  assert.equal(r.partial, true);
});

// ── Cancello per fornitore: la regola di `_baseApplies` (docs/adr/vendor-neutral.md) ─────────────────────────
// Una famiglia sta sotto 1.3.6.1.4.1.<PEN>…: si chiede a un apparato solo se il suo sysObjectID e' di quel PEN. La regola e'
// derivata dall'OID — nessun elenco di marche nel codice — e senza prova contraria (nessun sysObjectID) non si salta niente.
const FAMILIES = H.HEALTH_SENSOR_FAMILIES;
const fam = (id) => FAMILIES.find(f => f.id === id);
const tbl = (f, sid) => f.tables.find(t => t.sid === sid);
const col = (t, key, which) => [].concat(t.cols[key])[which || 0];
// Quante richieste hanno toccato i sottoalberi di ogni famiglia?
function touched(s) {
  const all = s.calls.subtree.concat(s.calls.get.flat());
  const out = {};
  for (const f of FAMILIES) {
    const pen = /^1\.3\.6\.1\.4\.1\.(\d+)\./.exec(H.healthFamilyRoot(f) + '.')[1];
    out[f.id] = all.some(o => o.startsWith(`1.3.6.1.4.1.${pen}.`));
  }
  return out;
}

test('cancello: un apparato di un ALTRO fornitore non riceve richieste di MIB che non sono sue', async () => {
  const s = fakeSession({ [SYSOID]: '1.3.6.1.4.1.890.1.5' });   // un PEN che nessuna famiglia ha
  await _readSensors(s, 3000);
  assert.deepEqual(touched(s), { 'cisco-envmon': false, 'juniper-operating': false, 'mikrotik-health': false });
});
test('cancello: un apparato di UN fornitore riceve la famiglia di quel fornitore e NESSUNA delle altre', async () => {
  for (const [pen, id] of [['9', 'cisco-envmon'], ['2636', 'juniper-operating'], ['14988', 'mikrotik-health']]) {
    const s = fakeSession({ [SYSOID]: `1.3.6.1.4.1.${pen}.1.1` });
    await _readSensors(s, 3000);
    const t = touched(s);
    for (const f of FAMILIES) assert.equal(t[f.id], f.id === id, `PEN ${pen}: ${f.id}`);
  }
});
test('cancello: SENZA sysObjectID nessuna prova contraria, quindi non si salta niente (la regola della walk principale)', async () => {
  const s = fakeSession({});
  await _readSensors(s, 3000);
  assert.deepEqual(touched(s), { 'cisco-envmon': true, 'juniper-operating': true, 'mikrotik-health': true });
});
test('cancello: con il sysObjectID che non ha la forma di un OID enterprise non si salta niente', async () => {
  const s = fakeSession({ [SYSOID]: Buffer.from('non un oid') });
  await _readSensors(s, 3000);
  assert.deepEqual(touched(s), { 'cisco-envmon': true, 'juniper-operating': true, 'mikrotik-health': true });
});
test('cancello: la regola e\' quella del driver (`_baseApplies`), non una copia', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'drivers', 'snmp.js'), 'utf8');
  const from = src.indexOf('SENSORI AMBIENTALI (stesso passo della salute');
  const to = src.indexOf('module.exports = { poll,');
  assert.match(src.slice(from, to), /_baseApplies\(HEALTH\.healthFamilyRoot\(fam\), pen\)/);
});

// ── VENDOR-NEUTRAL per costruzione: il codice che legge i sensori non conosce nessuna marca ───────────────
test('vendor-neutral: nel codice dei sensori (commenti esclusi) non compare nessun nome di marca ne\' PEN', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'drivers', 'snmp.js'), 'utf8');
  const from = src.indexOf('SENSORI AMBIENTALI (stesso passo della salute');
  const to = src.indexOf('module.exports = { poll,');
  const code = src.slice(from, to).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /cisco|juniper|mikrotik|envmon|jnx|mtxr|hp\b|aruba|zyxel|fortinet|arista/i, 'nessun nome di marca nel codice');
  assert.doesNotMatch(code, /['"](9|2636|14988)['"]/, 'nessun PEN scritto nel codice');
  assert.doesNotMatch(code, /1\.3\.6\.1\.4\.1\.\d+/, 'nessun OID di fornitore nel codice: stanno nei dati');
});
test('vendor-neutral: aggiungere un fornitore e\' aggiungere una voce ai DATI — una famiglia nuova viene letta dallo stesso codice', async () => {
  // Una famiglia inventata per la prova, con un PEN che non esiste: nessun file di codice la conosce.
  const extra = { id: 'prova-fam', mib: 'PROVA-MIB', tables: [
    { sid: 'temp', kind: 'temperature', unit: '°C', label: 'Prova', base: '1.3.6.1.4.1.99999.7.1', cols: { label: 2, value: 3, state: 4 }, states: 'CISCO-ENVMON-MIB:CiscoEnvMonState' }] };
  FAMILIES.push(extra);
  try {
    const t = { [SYSOID]: '1.3.6.1.4.1.99999.1', '1.3.6.1.4.1.99999.7.1.2.5': Buffer.from('Sonda'), '1.3.6.1.4.1.99999.7.1.3.5': 37, '1.3.6.1.4.1.99999.7.1.4.5': 1 };
    const r = await _readSensors(fakeSession(t), 3000);
    assert.deepEqual(r.via, ['prova-fam']);
    assert.equal(r.rows[0].sid, 'prova-fam:temp:5');
    assert.equal(r.rows[0].value, 37);
    assert.equal(r.rows[0].label, 'Sonda');
    assert.equal(r.rows[0].state, 'ok');
    assert.equal(r.rows[0].mib, 'PROVA-MIB');
  } finally { FAMILIES.pop(); }
});

// ── Una famiglia a TABELLA con stati (la forma di CISCO-ENVMON-MIB) ───────────────────────────────────────
function cisco() {
  const F = fam('cisco-envmon');
  const t = { [SYSOID]: '1.3.6.1.4.1.9.1.1745' };
  const p = (sid, key, idx, v, which) => { const T = tbl(F, sid); t[`${T.base}.${col(T, key, which)}.${idx}`] = v; };
  p('temp', 'label', 1, Buffer.from('SW#1, Sensor#1')); p('temp', 'value', 1, 41, 1); p('temp', 'value', 1, -4, 0); p('temp', 'limHi', 1, 75); p('temp', 'state', 1, 1);
  p('temp', 'label', 2, Buffer.from('Inlet')); p('temp', 'value', 2, 30, 1); p('temp', 'limHi', 2, 60); p('temp', 'state', 2, 2);
  p('volt', 'label', 1, Buffer.from('+12V')); p('volt', 'value', 1, 12080); p('volt', 'limLo', 1, 10800); p('volt', 'limHi', 1, 13200); p('volt', 'state', 1, 1);
  p('fan', 'label', 1, Buffer.from('Fan 1')); p('fan', 'state', 1, 1);
  p('fan', 'label', 2, Buffer.from('Fan 2')); p('fan', 'state', 2, 6);
  p('supply', 'label', 1, Buffer.from('PSU 1')); p('supply', 'state', 1, 3);
  p('supply', 'label', 2, Buffer.from('PSU 2')); p('supply', 'state', 2, 5);
  return t;
}
test('tabella con stati: temperatura (la colonna che ammette i negativi, se c\'e\'), limite dell\'apparato e stato dichiarato', async () => {
  const r = await _readSensors(fakeSession(cisco()), 3000);
  assert.deepEqual(r.via, ['cisco-envmon']);
  const t1 = r.rows.find(x => x.sid === 'cisco-envmon:temp:1');
  assert.equal(t1.value, -4, 'la colonna con segno e non quella deprecata');
  assert.equal(t1.limHi, 75, 'il limite dichiarato dall\'APPARATO e\' un limite dell\'apparato');
  assert.equal(t1.state, 'ok');
  assert.equal(t1.mib, 'CISCO-ENVMON-MIB');
  assert.equal(t1.oid, '1.3.6.1.4.1.9.9.13.1.3.1.7.1');
  assert.equal(r.rows.find(x => x.sid === 'cisco-envmon:temp:2').state, 'warning');
  assert.equal(r.rows.find(x => x.sid === 'cisco-envmon:temp:2').value, 30, 'senza la colonna con segno si ripiega sull\'altra');
});
test('tabella con scala: millivolt → volt, limiti compresi', async () => {
  const v = (await _readSensors(fakeSession(cisco()), 3000)).rows.find(x => x.sid === 'cisco-envmon:volt:1');
  assert.equal(v.value, 12.08);
  assert.equal(v.limLo, 10.8);
  assert.equal(v.limHi, 13.2);
  assert.equal(v.unit, 'V');
});
test('tabella di soli stati: ventole e alimentatori = lo STATO dell\'apparato (value null), compreso «non presente»', async () => {
  const rows = (await _readSensors(fakeSession(cisco()), 3000)).rows;
  const f2 = rows.find(x => x.sid === 'cisco-envmon:fan:2');
  assert.equal(f2.kind, 'fan'); assert.equal(f2.value, null); assert.equal(f2.state, 'not_functioning');
  assert.equal(rows.find(x => x.sid === 'cisco-envmon:supply:1').state, 'critical');
  assert.equal(rows.find(x => x.sid === 'cisco-envmon:supply:2').state, 'not_present');
  assert.equal(rows.find(x => x.sid === 'cisco-envmon:supply:1').kind, 'psu');
});
test('la gravita\' viene dall\'APPARATO (critico/avviso), non da noi', async () => {
  const r = await _readSensors(fakeSession(cisco()), 3000);
  const s = H.healthSummarizeSensors(H.healthReading({ at: Date.now(), upCs: 1, rows: [], sensors: r.rows }));
  const crit = s.items.filter(i => i.severity === 'crit').map(i => i.sid).sort();
  assert.deepEqual(crit, ['cisco-envmon:fan:2', 'cisco-envmon:supply:1']);
  for (const i of s.items.filter(x => x.severity)) assert.equal(i.source, 'device');
  assert.equal(s.items.find(i => i.sid === 'cisco-envmon:supply:2').severity, null, 'un alimentatore non presente non e\' un allarme');
});
test('ripiego: se lo STANDARD ha gia\' dato le temperature, quelle del fornitore NON si aggiungono — ma ventole e PSU si', async () => {
  const t = Object.assign(cisco(), standard());
  t[SYSOID] = '1.3.6.1.4.1.9.1.1745';
  // Lo standard di questo apparato non ha ventole (il sensore a giri 1002 e' tolto): quelle le da' solo il fornitore.
  for (const o of Object.keys(t)) if (/\.1002$/.test(o)) delete t[o];
  const r = await _readSensors(fakeSession(t), 3000);
  assert.deepEqual(r.via, ['entity-sensor', 'cisco-envmon']);
  assert.ok(!r.rows.some(x => x.sid.startsWith('cisco-envmon:temp')), 'niente temperature duplicate');
  assert.ok(!r.rows.some(x => x.sid.startsWith('cisco-envmon:volt')), 'niente tensioni duplicate');
  assert.ok(r.rows.some(x => x.sid === 'cisco-envmon:fan:1'));
  assert.ok(r.rows.some(x => x.sid === 'cisco-envmon:supply:1'));
});
test('ripiego: se lo standard ha gia\' una ventola (a giri), lo STATO delle ventole del fornitore non la raddoppia', async () => {
  const t = Object.assign(cisco(), standard());
  t[SYSOID] = '1.3.6.1.4.1.9.1.1745';
  const r = await _readSensors(fakeSession(t), 3000);
  assert.ok(r.rows.some(x => x.sid === 'ent:1002' && x.kind === 'fan'));
  assert.ok(!r.rows.some(x => x.sid.startsWith('cisco-envmon:fan')), 'le ventole sono dello standard');
  assert.ok(r.rows.some(x => x.sid === 'cisco-envmon:supply:1'), 'gli alimentatori non li ha dati lo standard');
});

// ── Una famiglia a tabella con INDICE A PIU' PARTI e valore minimo (la forma di JUNIPER-MIB) ────────────────
function juniper(temps) {
  const T = tbl(fam('juniper-operating'), 'op');
  const t = { [SYSOID]: '1.3.6.1.4.1.2636.1.1.1.2.137' };
  temps.forEach(([idx, descr, state, temp]) => {
    t[`${T.base}.${T.cols.label}.${idx}`] = Buffer.from(descr); t[`${T.base}.${T.cols.state}.${idx}`] = state; t[`${T.base}.${T.cols.value}.${idx}`] = temp;
  });
  return t;
}
test('valore minimo: la temperatura in °C solo dove e\' > 0; lo 0 («non disponibile o non applicabile») NON e\' una riga a zero gradi', async () => {
  const r = await _readSensors(fakeSession(juniper([['7.1.0.0', 'Routing Engine 0', 2, 46], ['9.1.0.0', 'FPC 0', 2, 0], ['4.1.0.0', 'Power Supply 0', 2, 0]])), 3000);
  assert.deepEqual(r.via, ['juniper-operating']);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].sid, 'juniper-operating:op:7.1.0.0');
  assert.equal(r.rows[0].value, 46);
  assert.equal(r.rows[0].label, 'Routing Engine 0');
  assert.equal(r.rows[0].oid, '1.3.6.1.4.1.2636.3.1.13.1.7.7.1.0.0');
});
test('valore minimo: una VM con tutte le temperature a 0 → nessun sensore (not_available), non «0 °C»', async () => {
  const r = await _readSensors(fakeSession(juniper([['7.1.0.0', 'Routing Engine 0', 2, 0], ['9.1.0.0', 'FPC 0', 2, 0]])), 3000);
  assert.deepEqual(r.rows, []);
});
test('stati: «down» e\' «non funziona» (la MIB lo dice), «reset» NON si interpreta', async () => {
  const r = await _readSensors(fakeSession(juniper([['1.0.0.0', 'A', 6, 40], ['2.0.0.0', 'B', 4, 41], ['3.0.0.0', 'C', 2, 42]])), 3000);
  const st = Object.fromEntries(r.rows.map(x => [x.label, x.state]));
  assert.deepEqual(st, { A: 'not_functioning', B: 'unknown', C: 'ok' });
});
test('indice a piu\' parti: l\'ordine e\' NUMERICO per parti (non lessicografico)', async () => {
  const r = await _readSensors(fakeSession(juniper([['10.1.0.0', 'X', 2, 40], ['2.1.0.0', 'Y', 2, 41], ['9.1.0.0', 'Z', 2, 42]])), 3000);
  assert.deepEqual(r.rows.map(x => x.label), ['Y', 'Z', 'X']);
});
test('cio\' che non si e\' potuto verificare NON si legge: nessuna richiesta alla tabella dei componenti sostituibili (FRU)', async () => {
  const s = fakeSession(juniper([['7.1.0.0', 'RE', 2, 46]]));
  await _readSensors(s, 3000);
  assert.ok(!s.calls.subtree.some(b => b.startsWith('1.3.6.1.4.1.2636.3.1.15')));
});

// ── Una famiglia a SCALARI (la forma di MIKROTIK-MIB mtxrHealth) ────────────────────────────────────────
function scalars(vals) {
  const F = fam('mikrotik-health');
  const t = { [SYSOID]: '1.3.6.1.4.1.14988.1' };
  for (const [sid, v] of Object.entries(vals)) t[F.scalars.find(s => s.sid === sid).oid + '.0'] = v;
  return t;
}
test('scalari: temperatura e tensione in DECIMI (d-1) → gradi e volt; la ventola in giri', async () => {
  const r = await _readSensors(fakeSession(scalars({ temp: 415, 'cpu-temp': 612, voltage: 241, fan2: 3000 })), 3000);
  assert.deepEqual(r.via, ['mikrotik-health']);
  const by = Object.fromEntries(r.rows.map(x => [x.sid, x]));
  assert.equal(by['mikrotik-health:temp'].value, 41.5);
  assert.equal(by['mikrotik-health:cpu-temp'].value, 61.2);
  assert.equal(by['mikrotik-health:voltage'].value, 24.1);
  assert.equal(by['mikrotik-health:voltage'].unit, 'V');
  assert.equal(by['mikrotik-health:fan2'].value, 3000);
  assert.equal(by['mikrotik-health:fan2'].unit, 'rpm');
  assert.equal(by['mikrotik-health:temp'].state, 'unknown', 'l\'apparato non dichiara uno stato: non lo inventiamo');
});
test('scalari: REGOLA DI CLASSE (misurata sul lab) — uno scalare di temperatura/tensione a 0 NON e\' una misura, per QUALUNQUE famiglia', async () => {
  // Una CHR risponde 0 su un sensore che non ha. La regola non e' «per quella marca»: vale per ogni scalare di questa forma.
  const r = await _readSensors(fakeSession(scalars({ 'chip-temp': 0, voltage: 0, temp: 0 })), 3000);
  assert.deepEqual(r.rows, []);
  const extra = { id: 'altra-fam', mib: 'ALTRA-MIB', scalars: [{ oid: '1.3.6.1.4.1.99999.9.1', sid: 'caldo', kind: 'temperature', unit: '°C', div: 1, label: 'Caldo' }, { oid: '1.3.6.1.4.1.99999.9.2', sid: 'ventola', kind: 'fan', unit: 'rpm', div: 1, label: 'Ventola' }] };
  assert.deepEqual(D._internals.extractVendorScalars({ '1.3.6.1.4.1.99999.9.1.0': 0, '1.3.6.1.4.1.99999.9.2.0': 0 }, extra).map(x => x.sid), ['altra-fam:ventola']);
});
test('scalari: una ventola a 0 giri e\' una scoperta (ventola ferma) e si TIENE', async () => {
  const r = await _readSensors(fakeSession(scalars({ fan2: 0 })), 3000);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].value, 0);
  assert.equal(r.rows[0].kind, 'fan');
});
test('scalari: una temperatura vera accanto a una a zero: resta solo la vera', async () => {
  const r = await _readSensors(fakeSession(scalars({ temp: 0, 'cpu-temp': 455 })), 3000);
  assert.deepEqual(r.rows.map(x => [x.sid, x.value]), [['mikrotik-health:cpu-temp', 45.5]]);
});
test('scalari: uno scalare non pubblicato → nessuna riga, non «0 °C»', async () => {
  const r = await _readSensors(fakeSession(scalars({})), 3000);
  assert.deepEqual(r.rows, []);
});
test('scalari: uno scalare che non e\' un numero non diventa un sensore', async () => {
  const r = await _readSensors(fakeSession(scalars({ temp: Buffer.from('x') })), 3000);
  assert.deepEqual(r.rows, []);
});
test('cio\' che non si e\' potuto verificare NON si legge: nessuna richiesta alla tabella «gauge»', async () => {
  const s = fakeSession(scalars({ temp: 400 }));
  await _readSensors(s, 3000);
  assert.ok(![...s.calls.subtree, ...s.calls.get.flat()].some(o => o.startsWith('1.3.6.1.4.1.14988.1.1.3.100')));
});

// ── Estrattori puri ──────────────────────────────────────────────────────────
test('estrattori: si chiamano su mappe di varbind (pure) e non crollano su niente', () => {
  assert.deepEqual(extractEntitySensors({}, {}), []);
  for (const f of H.HEALTH_SENSOR_FAMILIES) {
    for (const t of (f.tables || [])) assert.deepEqual(extractVendorTable({}, f, t), [], `${f.id}:${t.sid}`);
    assert.deepEqual(extractVendorScalars({}, f), [], f.id);
  }
});

// ── La lettura completa ──────────────────────────────────────────────────────
test('lettura completa: interfacce E sensori nella stessa risposta, e la lettura passa per la lib', async () => {
  const t = Object.assign(standard(), {
    [`${H.HEALTH_IF_NAME_OID}.1`]: Buffer.from('Gi1'), [`${H.HEALTH_IF_OIDS.oper}.1`]: 1, [`${H.HEALTH_IF_OIDS.inErrors}.1`]: 3, [H.HEALTH_SYS_UPTIME]: 5000,
  });
  const r = await _readHealth(fakeSession(t), 3000);
  assert.equal(r.rows.length, 1);
  assert.ok(r.sensors && Array.isArray(r.sensors.rows) && r.sensors.rows.length >= 3);
  const rd = H.healthReading({ at: r.at, upCs: r.upCs, rows: r.rows, sensors: r.sensors.rows });
  assert.ok(rd.sensors.length >= 3);
});
test('lettura completa: `{ sensors: false }` salta il passo (le interfacce restano come prima)', async () => {
  const s = fakeSession({ [`${H.HEALTH_IF_NAME_OID}.1`]: Buffer.from('Gi1'), [H.HEALTH_SYS_UPTIME]: 5000 });
  const r = await _readHealth(s, 3000, { sensors: false });
  assert.ok(!('sensors' in r));
  assert.ok(!s.calls.subtree.some(b => b.startsWith('1.3.6.1.2.1.99')));
});

test('mai una SET nel passo dei sensori', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'drivers', 'snmp.js'), 'utf8');
  const from = src.indexOf('SENSORI AMBIENTALI (stesso passo della salute');
  const to = src.indexOf('module.exports = { poll,');
  assert.ok(from > 0 && to > from);
  assert.doesNotMatch(src.slice(from, to), /\.set\(|session\.set|SetRequest/);
});
