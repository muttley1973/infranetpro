'use strict';
// ============================================================
// HEALTH → DRIFT — gli errori d'interfaccia in salita dentro il Drift Report ESISTENTE
// ============================================================
// Non e' un report in piu': e' una categoria (`ifHealth`) dello stesso `buildDriftReport`, con la stessa chiave
// stabile e lo stesso «ignora finche' la condizione non cambia». Quello che si prova qui e' cio' che la distingue
// dalle altre: e' un fatto MISURATO e non una divergenza dal documento, quindi informativo — non entra nella coda
// azionabile e non sporca il banner. Gli ingressi sono SINTETICI.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/drift-report.js');
const H = require('../lib/health-store.js');

const OIDS = { inErrors: H.HEALTH_IF_OIDS.inErrors, outDiscards: H.HEALTH_IF_OIDS.outDiscards, fcs: H.HEALTH_IF_OIDS.fcs };
function row(over) {
  return Object.assign({ nodeId: 'sw1', label: 'SW1', ifName: 'Gi1/0/1', grew: ['inErrors'], deltas: { inErrors: 3, outErrors: 0 },
    totals: { inErrors: 9 }, spanS: 3600, basis: 'sysUpTime', at: 1_700_000_000_000, oids: { inErrors: OIDS.inErrors } }, over || {});
}
const EMPTY_DOC = () => ({ ports: {}, macs: [], deviceSigs: [], cables: [] });
function report(ifHealth, ign, extraSnmp) {
  const snmp = Object.assign({ responded: {}, ports: {}, observedMacs: [], presentNodeIds: {}, observedDevices: [], rejectedSigs: [], portDownStreak: {} },
    ifHealth === undefined ? {} : { ifHealth }, extraSnmp || {});
  return D.buildDriftReport(snmp, EMPTY_DOC(), ign || [], {});
}

test('una riga per interfaccia salita, con provenienza (source, OID, istante) e chiave stabile', () => {
  const r = report([row()]);
  assert.equal(r.ifHealth.length, 1);
  const x = r.ifHealth[0];
  assert.equal(x.source, 'snmp');
  assert.deepEqual(x.oids, { inErrors: '1.3.6.1.2.1.2.2.1.14' });
  assert.equal(x.at, 1_700_000_000_000);
  assert.equal(x.spanS, 3600);
  assert.equal(x.basis, 'sysUpTime');
  assert.equal(x.label, 'SW1');
  assert.equal(x.nodeId, 'sw1');
  assert.equal(x.key, 'ifh:sw1:Gi1/0/1:inErrors+3');
  assert.equal(r.counts.ifHealth, 1);
});

test('nessun ingresso → categoria vuota e conteggio 0 (i chiamanti vecchi non cambiano)', () => {
  const r = report(undefined);
  assert.deepEqual(r.ifHealth, []);
  assert.equal(r.counts.ifHealth, 0);
  assert.equal(report([]).counts.ifHealth, 0);
});

test('chiave: stessa crescita = stessa chiave (qualunque ordine); un aumento diverso = chiave nuova', () => {
  const a = row({ grew: ['inErrors', 'fcs'], deltas: { inErrors: 3, fcs: 2 } });
  const b = row({ grew: ['fcs', 'inErrors'], deltas: { inErrors: 3, fcs: 2 } });
  assert.equal(report([a]).ifHealth[0].key, report([b]).ifHealth[0].key);
  const c = row({ grew: ['inErrors', 'fcs'], deltas: { inErrors: 4, fcs: 2 } });
  assert.notEqual(report([a]).ifHealth[0].key, report([c]).ifHealth[0].key);
});

test('chiave: l\'istante di lettura NON ne fa parte (un gocciolio costante resta ignorato)', () => {
  const k1 = report([row({ at: 1000 })]).ifHealth[0].key;
  const k2 = report([row({ at: 999999999 })]).ifHealth[0].key;
  assert.equal(k1, k2);
});

test('ignora finche\' la condizione non cambia: la riga sparisce, e riappare se l\'aumento e\' un altro', () => {
  const key = report([row()]).ifHealth[0].key;
  const ignored = report([row()], [key]);
  assert.equal(ignored.ifHealth.length, 0);
  assert.equal(ignored.counts.ifHealth, 0);
  const changed = report([row({ deltas: { inErrors: 50 } })], [key]);
  assert.equal(changed.ifHealth.length, 1, 'un aumento diverso fa riapparire la riga');
});

test('e\' INFORMATIVA: non entra nella coda azionabile', () => {
  const r = report([row(), row({ ifName: 'Gi1/0/2', grew: ['fcs'], deltas: { fcs: 1 } })]);
  assert.equal(r.counts.ifHealth, 2);
  assert.equal(D.driftActionable(r.counts), 0);
});

test('e\' INFORMATIVA: non trasforma un esito «allineato» in «da verificare»', () => {
  const r = report([row()]);
  assert.notEqual(D.driftBannerKind(r.counts, r), 'discrepancies');
});

test('un\'anomalia vera resta «da verificare» anche con la salute accanto', () => {
  const snmp = { responded: { sw1: true }, ports: { 'sw1-1': { status: 'up', measured: true, speed: 1000 } } };
  const doc = { ports: { 'sw1-1': { label: 'SW1 · 1', status: 'down', speed: 100 } }, macs: [], deviceSigs: [], cables: [] };
  const r = D.buildDriftReport(Object.assign({ observedMacs: [], presentNodeIds: {}, observedDevices: [], rejectedSigs: [], portDownStreak: {}, ifHealth: [row()] }, snmp), doc, [], {});
  assert.ok(D.driftActionable(r.counts) > 0, 'lo stato della porta e\' cambiato');
  assert.equal(D.driftBannerKind(r.counts, r), 'discrepancies');
  assert.equal(r.counts.ifHealth, 1);
});

test('ingressi malformati: si saltano, non si inventa un numero', () => {
  const bad = [null, undefined, 5, 'x', [], {}, row({ nodeId: '' }), row({ ifName: '' }), row({ grew: [] }), row({ grew: 'inErrors' }), row({ grew: null })];
  const r = report(bad);
  assert.equal(r.ifHealth.length, 0);
  assert.equal(r.counts.ifHealth, 0);
  assert.doesNotThrow(() => report('non un array'));
  assert.doesNotThrow(() => report({ x: 1 }));
});

test('campi opzionali mancanti → null/{} e non «0» (non letto resta non letto)', () => {
  const r = report([{ nodeId: 'sw1', ifName: 'p', grew: ['fcs'] }]);
  const x = r.ifHealth[0];
  assert.equal(x.spanS, null);
  assert.equal(x.basis, null);
  assert.equal(x.at, null);
  assert.deepEqual(x.deltas, {});
  assert.deepEqual(x.oids, {});
  assert.equal(x.label, 'sw1', 'senza etichetta si mostra l\'id, non una stringa vuota');
});

test('una riga di Drift non ha i campi con cui «Investiga» la scambierebbe per un\'altra cosa', () => {
  // `driftInvestigate` guarda pid, id, sig, mac PRIMA di nodeId: una riga di salute deve portare solo nodeId.
  const x = report([row()]).ifHealth[0];
  for (const k of ['pid', 'id', 'sig', 'mac']) assert.ok(!(k in x), k);
  assert.ok(x.nodeId);
});

test('il motore del drift NON importa la lib di salute: riceve righe gia\' calcolate (i commenti possono citarla)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'drift-report.js'), 'utf8');
  assert.doesNotMatch(src, /require\([^)]*health-store/);
  assert.doesNotMatch(src, /import[^;\n]*health-store/);
});

// ═══ SENSORI nel Drift: i CRITICI sono lavoro, gli avvisi informazione ══════════════════════════════════════════
function srow(over) {
  return Object.assign({ nodeId: 'sw1', label: 'SW1', sid: 'ent:1001', sensor: 'CPU Temp', kind: 'temperature', value: 88.5, unit: '°C', state: 'ok',
    severity: 'crit', severitySource: 'device', why: 'limit', limLo: null, limHi: 80, mib: 'ENTITY-SENSOR-MIB', oid: '1.3.6.1.2.1.99.1.1.1.4.1001', at: 1_700_000_000_000 }, over || {});
}
const withSensors = (rows, ign) => report(undefined, ign, { sensorHealth: rows });

test('sensori: un critico va in sensorHealth, un avviso in sensorWarn, con provenienza (MIB, OID, istante, DA CHI viene la gravita\')', () => {
  const r = withSensors([srow(), srow({ sid: 'fan:1', sensor: 'Fan', severity: 'warn', severitySource: 'user_default', why: 'threshold' })]);
  assert.equal(r.sensorHealth.length, 1);
  assert.equal(r.sensorWarn.length, 1);
  const x = r.sensorHealth[0];
  assert.equal(x.source, 'snmp');
  assert.equal(x.mib, 'ENTITY-SENSOR-MIB');
  assert.equal(x.oid, '1.3.6.1.2.1.99.1.1.1.4.1001');
  assert.equal(x.at, 1_700_000_000_000);
  assert.equal(x.severitySource, 'device');
  assert.equal(r.sensorWarn[0].severitySource, 'user_default');
  assert.deepEqual([r.counts.sensorHealth, r.counts.sensorWarn], [1, 1]);
});

test('sensori: il CRITICO entra nella coda azionabile e il banner NON resta verde; l\'avviso no', () => {
  const crit = withSensors([srow()]);
  assert.equal(D.driftActionable(crit.counts), 1);
  assert.equal(D.driftBannerKind(crit.counts, crit), 'discrepancies');
  const warn = withSensors([srow({ severity: 'warn' })]);
  assert.equal(D.driftActionable(warn.counts), 0);
  assert.notEqual(D.driftBannerKind(warn.counts, warn), 'discrepancies');
});

test('sensori: la chiave porta la GRAVITA\' e da chi viene, non il valore (un grado in piu\' non riapre una riga ignorata)', () => {
  const k1 = withSensors([srow({ value: 88.5 })]).sensorHealth[0].key;
  assert.equal(k1, withSensors([srow({ value: 91 })]).sensorHealth[0].key);
  assert.equal(k1, 'snr:sw1:ent:1001:crit:device');
  assert.notEqual(k1, withSensors([srow({ severitySource: 'user_default' })]).sensorHealth[0].key, 'cambia la fonte della gravita\'');
  assert.notEqual(k1, withSensors([srow({ severity: 'warn' })]).sensorWarn[0].key, 'da critico ad avviso e\' un\'altra riga');
});

test('sensori: «ignora finche\' la condizione non cambia» — la riga sparisce, e riappare se la gravita\' cambia', () => {
  const key = withSensors([srow({ severity: 'warn' })]).sensorWarn[0].key;
  const ignored = withSensors([srow({ severity: 'warn' })], [key]);
  assert.deepEqual([ignored.sensorWarn.length, ignored.counts.sensorWarn], [0, 0]);
  const worse = withSensors([srow({ severity: 'crit' })], [key]);
  assert.equal(worse.sensorHealth.length, 1, 'da avviso a critico: riappare');
});

test('sensori: una fonte della gravita\' che non e\' «device» o «user_default» diventa «device» (mai una terza origine inventata)', () => {
  assert.equal(withSensors([srow({ severitySource: 'nostra' })]).sensorHealth[0].severitySource, 'device');
  assert.equal(withSensors([srow({ severitySource: undefined })]).sensorHealth[0].severitySource, 'device');
});

test('sensori: ingressi malformati o senza gravita\' valida si saltano', () => {
  const bad = [null, undefined, 5, 'x', [], {}, srow({ nodeId: '' }), srow({ sid: '' }), srow({ severity: null }), srow({ severity: 'grave' }), srow({ severity: undefined })];
  const r = withSensors(bad);
  assert.deepEqual([r.sensorHealth.length, r.sensorWarn.length], [0, 0]);
  assert.doesNotThrow(() => withSensors('non un array'));
});

test('sensori: valore e limiti non letti restano null (mai zero); etichetta mancante → id', () => {
  const x = withSensors([srow({ value: null, limHi: undefined, limLo: 'x', sensor: '' })]).sensorHealth[0];
  assert.equal(x.value, null);
  assert.equal(x.limHi, null);
  assert.equal(x.limLo, null);
  assert.equal(x.sensor, 'ent:1001');
});

test('sensori: nessun ingresso → categorie vuote e conteggi 0 (i chiamanti vecchi non cambiano)', () => {
  const r = report(undefined);
  assert.deepEqual([r.sensorHealth, r.sensorWarn, r.counts.sensorHealth, r.counts.sensorWarn], [[], [], 0, 0]);
});

test('sensori: una riga di Drift non ha i campi con cui «Investiga» la scambierebbe per un\'altra cosa (solo nodeId)', () => {
  const x = withSensors([srow()]).sensorHealth[0];
  for (const k of ['pid', 'id', 'sig', 'mac']) assert.ok(!(k in x), k);
});

// ═══ VICINI nel Drift: informazione, mai una divergenza dal documento ═══════════════════════════════════════
function nrow(over) {
  return Object.assign({ nodeId: 'sw1', label: 'SW1', kind: 'neighbor', localIf: 'Gi1/0/3', remoteId: 'aa:bb:cc:00:00:01', remoteName: 'AP-1', ports: ['eth0'], protos: ['LLDP'],
    firstAt: 1_700_000_000_000, lastAt: 1_700_100_000_000, misses: 3, portState: 'up', at: 1_700_200_000_000, oid: '1.0.8802.1.1.2.1.4.1' }, over || {});
}
const withNeighbors = (rows, ign) => report(undefined, ign, { neighborLost: rows });

test('vicini: una riga per vicino silenzioso, con provenienza (protocollo, OID, ultimo ascolto) e senza dire cosa e\' successo al cavo', () => {
  const r = withNeighbors([nrow()]);
  assert.equal(r.neighborLost.length, 1);
  const x = r.neighborLost[0];
  assert.equal(x.key, 'nbr:sw1:gi1/0/3|aa:bb:cc:00:00:01');
  assert.equal(x.kind, 'neighbor');
  assert.equal(x.source, 'LLDP');
  assert.equal(x.oid, '1.0.8802.1.1.2.1.4.1');
  assert.equal(x.lastAt, 1_700_100_000_000);
  assert.equal(x.misses, 3);
  assert.equal(x.portState, 'up');
  assert.deepEqual(x.ports, ['eth0']);
  assert.equal(r.counts.neighborLost, 1);
});
test('vicini: un apparato che non riferisce piu\' NESSUN vicino e\' UNA riga (chiave «*silent»), non una per vicino', () => {
  const r = withNeighbors([nrow({ kind: 'device', localIf: '', remoteId: '', silentCount: 5, protos: ['LLDP', 'CDP'] })]);
  assert.equal(r.neighborLost.length, 1);
  assert.equal(r.neighborLost[0].key, 'nbr:sw1:*silent');
  assert.equal(r.neighborLost[0].silentCount, 5);
  assert.equal(r.neighborLost[0].source, 'LLDP/CDP');
});
test('vicini: e\' INFORMATIVO — non entra nella coda azionabile e non sporca il banner («silenzio ≠ contraddizione»)', () => {
  const r = withNeighbors([nrow(), nrow({ localIf: 'Gi1/0/4', remoteId: 'aa:bb:cc:00:00:02' })]);
  assert.equal(r.counts.neighborLost, 2);
  assert.equal(D.driftActionable(r.counts), 0);
  assert.notEqual(D.driftBannerKind(r.counts, r), 'discrepancies');
});
test('vicini: la chiave porta CHI e su quale porta, non quante letture ne\' quando (un silenzio piu\' lungo non riapre una riga ignorata)', () => {
  const k1 = withNeighbors([nrow({ misses: 3, lastAt: 1000 })]).neighborLost[0].key;
  assert.equal(k1, withNeighbors([nrow({ misses: 90, lastAt: 999999 })]).neighborLost[0].key);
  assert.notEqual(k1, withNeighbors([nrow({ localIf: 'Gi1/0/9' })]).neighborLost[0].key, 'un\'altra porta e\' un\'altra riga');
  assert.notEqual(k1, withNeighbors([nrow({ remoteId: 'aa:bb:cc:00:00:99' })]).neighborLost[0].key, 'un altro vicino e\' un\'altra riga');
});
test('vicini: «ignora» nasconde la riga; il vicino che torna e poi si zittisce di nuovo e\' la STESSA chiave (resta ignorato)', () => {
  const key = withNeighbors([nrow()]).neighborLost[0].key;
  const ign = withNeighbors([nrow()], [key]);
  assert.deepEqual([ign.neighborLost.length, ign.counts.neighborLost], [0, 0]);
});
test('vicini: ingressi malformati si saltano (tipo sconosciuto, vicino senza porta o senza identita\'), mai una riga inventata', () => {
  const bad = [null, undefined, 5, 'x', [], {}, nrow({ nodeId: '' }), nrow({ kind: 'altro' }), nrow({ localIf: '' }), nrow({ remoteId: '' }), nrow({ kind: undefined })];
  const r = withNeighbors(bad);
  assert.equal(r.neighborLost.length, 0);
  assert.doesNotThrow(() => withNeighbors('non un array'));
});
test('vicini: protocolli fuori da LLDP/CDP si tolgono; lo stato della porta e\' «up» o «unknown» e basta; campi mancanti → null (mai zero)', () => {
  const x = withNeighbors([nrow({ protos: ['LLDP', 'FDB', 'x'], portState: 'giu', misses: undefined, firstAt: undefined, ports: undefined })]).neighborLost[0];
  assert.deepEqual(x.protos, ['LLDP']);
  assert.equal(x.portState, 'unknown');
  assert.equal(x.misses, null);
  assert.equal(x.firstAt, null);
  assert.deepEqual(x.ports, []);
});
test('vicini: nessun ingresso → categoria vuota e conteggio 0 (i chiamanti vecchi non cambiano)', () => {
  const r = report(undefined);
  assert.deepEqual([r.neighborLost, r.counts.neighborLost], [[], 0]);
});
test('vicini: una riga non ha i campi con cui «Investiga» la scambierebbe per un\'altra cosa (solo nodeId)', () => {
  const x = withNeighbors([nrow()]).neighborLost[0];
  for (const k of ['pid', 'id', 'sig', 'mac']) assert.ok(!(k in x), k);
  assert.ok(x.nodeId);
});
