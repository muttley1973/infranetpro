const test = require('node:test');
const assert = require('node:assert/strict');
const { nodePresenceClass } = require('../lib/presence.js');

test('presenza usa il report corrente quando disponibile', () => {
  const node = { id: 'iot1', proof: { status: 'absent' } };
  assert.equal(nodePresenceClass(node, { macOrphan: [], unverified: [{ nodeId: 'iot1' }] }), ' node-unverified');
});

test('presenza ripristina il proof persistente dopo il reload', () => {
  assert.equal(nodePresenceClass({ id: 'iot1', proof: { status: 'absent' } }, null), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'iot1', proof: { status: 'unverified' } }, null), ' node-unverified');
});

// Regressione: «un device spento non diventa rosso». `snmpStatus` sopravvive al
// salvataggio, quindi un 'ok' vecchio di mesi zittiva l'overlay anche quando la
// Verifica appena fatta aveva la PROVA dell'assenza (e anche il proof persistito
// dopo il reload). Il LED del rack applicava già la soglia di freschezza, questa
// funzione no: stesso concetto, due regole. Ora «ha risposto» vale solo se è
// RECENTE — la misura più fresca decide.
const _ago = (ms) => new Date(Date.now() - ms).toISOString();
const _absentReport = { macOrphan: [{ nodeId: 'pc1' }], unverified: [] };

test('presenza: un «ok» SNMP recente azzera l\'overlay (device davvero riacceso)', () => {
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(3600e3) }, _absentReport), '');
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(60e3), proof: { status: 'absent' } }, null), '');
});

test('presenza: un «ok» SNMP STANTIO non sopprime più l\'assenza provata', () => {
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(30 * 864e5) }, _absentReport), ' node-absent');
  // ...nemmeno dopo il reload, dove decide il proof persistito.
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(30 * 864e5), proof: { status: 'absent' } }, null), ' node-absent');
  // Un 'ok' senza data non è databile → non vale come «vivo adesso» (come _snmpIsStale).
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok' }, _absentReport), ' node-absent');
});

test('presenza: i percorsi senza «ok» restano invariati', () => {
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'err' }, _absentReport), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'pc1' }, _absentReport), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'altro' }, _absentReport), '');
});
