'use strict';
// ============================================================
// STATO OPERATIVO DICHIARATO — test di lib/device-status.js.
// Verifica le INVARIANTI D'ONESTA' del campo:
//   * ignoto non e' un verdetto: stato assente o non riconosciuto -> null/'' , mai
//     un valore di ripiego e mai un cambio di lettura;
//   * la dichiarazione SPIEGA un'assenza, non la cancella (nessuna funzione qui
//     tocca `n.proof`: la lib e' pura e non muta l'input);
//   * la contraddizione produce un RILIEVO: dichiarato fuori servizio + risponde
//     = `status.aliveNotInService`, che e' il caso per cui il campo esiste;
//   * vendor-neutral: il vocabolario e' di InfraNet, gli alias sono una tabella
//     aperta (NetBox, italiano scritto a mano, grafie con spazi/underscore).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/device-status.js');
const {
  STATUSES, normalizeStatus, expectsPresence, isDeclared, alarmsOnAbsence,
  statusFinding, countByStatus,
} = S;

test('il vocabolario e chiuso e copre il ciclo di vita', () => {
  assert.deepStrictEqual(
    STATUSES,
    ['planned', 'staged', 'inventory', 'active', 'failed', 'decommissioning', 'offline'],
  );
  // ogni stato canonico deve avere una risposta alla domanda "deve rispondere?"
  STATUSES.forEach((s) => assert.strictEqual(typeof S.EXPECTS_PRESENCE[s], 'boolean', s));
});

test('normalizeStatus riduce al canonico, e scarta cio che non riconosce', () => {
  assert.strictEqual(normalizeStatus('active'), 'active');
  assert.strictEqual(normalizeStatus('  ACTIVE  '), 'active');
  // NetBox consegna un oggetto {value,label}, non una stringa
  assert.strictEqual(normalizeStatus({ value: 'planned', label: 'Planned' }), 'planned');
  // grafie con spazi/underscore
  assert.strictEqual(normalizeStatus('in service'), 'active');
  assert.strictEqual(normalizeStatus('powered_off'), 'offline');
  // italiano scritto a mano
  assert.strictEqual(normalizeStatus('magazzino'), 'inventory');
  assert.strictEqual(normalizeStatus('in dismissione'), 'decommissioning');
  // ⚠️ ignoto NON diventa un valore di ripiego (paletto ②)
  assert.strictEqual(normalizeStatus('banana'), '');
  assert.strictEqual(normalizeStatus(''), '');
  assert.strictEqual(normalizeStatus(null), '');
  assert.strictEqual(normalizeStatus(undefined), '');
});

test('expectsPresence: null quando non e dichiarato — nessun giudizio', () => {
  assert.strictEqual(expectsPresence(''), null);
  assert.strictEqual(expectsPresence(null), null);
  assert.strictEqual(expectsPresence('banana'), null);   // non riconosciuto = non dichiarato
  assert.strictEqual(expectsPresence('active'), true);
  ['planned', 'staged', 'inventory', 'failed', 'decommissioning', 'offline']
    .forEach((s) => assert.strictEqual(expectsPresence(s), false, s));
});

test('alarmsOnAbsence: si allarma sempre, TRANNE quando lo stato spiega il silenzio', () => {
  // il comportamento storico (nessuno stato dichiarato) non cambia
  assert.strictEqual(alarmsOnAbsence(''), true);
  assert.strictEqual(alarmsOnAbsence('active'), true);
  assert.strictEqual(alarmsOnAbsence('planned'), false);
  assert.strictEqual(alarmsOnAbsence('decommissioning'), false);
});

test('isDeclared distingue il dichiarato dal vuoto', () => {
  assert.strictEqual(isDeclared('offline'), true);
  assert.strictEqual(isDeclared('banana'), false);
  assert.strictEqual(isDeclared(''), false);
});

test('statusFinding: assente e dichiarato tale = spiegazione, non allarme', () => {
  assert.deepStrictEqual(
    statusFinding('planned', 'absent'),
    { code: 'status.absentAsDeclared', status: 'planned' },
  );
});

test('statusFinding: dichiarato fuori servizio ma RISPONDE = il rilievo che conta', () => {
  assert.deepStrictEqual(
    statusFinding('offline', 'proven'),
    { code: 'status.aliveNotInService', status: 'offline' },
  );
  assert.deepStrictEqual(
    statusFinding('decommissioning', 'proven'),
    { code: 'status.aliveNotInService', status: 'decommissioning' },
  );
});

test('statusFinding tace dove non c e niente da dire', () => {
  assert.strictEqual(statusFinding('', 'absent'), null);          // non dichiarato
  assert.strictEqual(statusFinding('active', 'absent'), null);    // in servizio: il verdetto e quello di sempre
  assert.strictEqual(statusFinding('active', 'proven'), null);
  // misura assente o incerta: non si confronta una dichiarazione con il nulla
  assert.strictEqual(statusFinding('offline', 'unverified'), null);
  assert.strictEqual(statusFinding('offline', 'stale'), null);
  assert.strictEqual(statusFinding('offline', 'declared'), null);
  assert.strictEqual(statusFinding('offline', ''), null);
});

test('la lib e PURA: non muta il nodo che le passi', () => {
  const n = { id: 'a', status: 'offline', proof: { status: 'proven' } };
  const copia = JSON.parse(JSON.stringify(n));
  statusFinding(n.status, n.proof.status);
  expectsPresence(n.status);
  countByStatus([n]);
  assert.deepStrictEqual(n, copia);
});

test('countByStatus tiene il non dichiarato come voce a se', () => {
  const out = countByStatus([
    { status: 'active' }, { status: 'active' },
    { status: 'planned' },
    { status: 'banana' },   // non riconosciuto -> non dichiarato, mai "attivo"
    {},                     // niente stato
  ]);
  assert.strictEqual(out.total, 5);
  assert.strictEqual(out.active, 2);
  assert.strictEqual(out.planned, 1);
  assert.strictEqual(out.undeclared, 2);
  assert.strictEqual(out.offline, 0);
});

test('countByStatus regge input sporchi', () => {
  assert.strictEqual(countByStatus(null).total, 0);
  assert.strictEqual(countByStatus([null, undefined]).total, 0);
});
