'use strict';
// Test della tabella firme device condivisa (lib/device-signatures.js).
const test = require('node:test');
const assert = require('node:assert');
const { oidType, oidTypeVotes, oidIsType, OID_TYPE_VOTES } = require('../lib/device-signatures.js');

test('oidType: riconosce gli OID che al server MANCAVANO (Lexmark/Grandstream/Yealink)', () => {
  assert.equal(oidType('1.3.6.1.4.1.641.1.1'), 'printer', 'Lexmark 641 -> printer');
  assert.equal(oidType('1.3.6.1.4.1.25858.2'), 'voip', 'Grandstream 25858 -> voip');
  assert.equal(oidType('1.3.6.1.4.1.37049.1'), 'voip', 'Yealink 37049 -> voip');
});

test('oidType: il prefisso piu\' specifico vince (APC rPDU 318.1.1.12 = pdu, non ups)', () => {
  assert.equal(oidType('1.3.6.1.4.1.318.1.1.12.4'), 'pdu', 'pdu(95) batte ups(85)');
  assert.equal(oidType('1.3.6.1.4.1.318.1.1.1.2'), 'ups', 'APC non-rPDU resta ups');
});

test('oidTypeVotes: vota TUTTI i prefissi che matchano (per i classificatori a somma)', () => {
  const votes = oidTypeVotes('1.3.6.1.4.1.318.1.1.12.4');
  const byType = Object.fromEntries(votes.map(v => [v.type, v.points]));
  assert.equal(byType.pdu, 95);
  assert.equal(byType.ups, 85, 'anche ups vota (318.) come oggi nel FusionScorer');
});

test('oidType: nessun match / input vuoto -> stringa vuota', () => {
  assert.equal(oidType('1.3.6.1.4.1.99999.1'), '');
  assert.equal(oidType(''), '');
  assert.equal(oidType(undefined), '');
  assert.deepEqual(oidTypeVotes('  '), []);
});

test('oidIsType: chiede se un OID e\' di un tipo preciso (per il client first-match)', () => {
  assert.equal(oidIsType('1.3.6.1.4.1.641.1', 'printer'), true);
  assert.equal(oidIsType('1.3.6.1.4.1.641.1', 'nas'), false);
  assert.equal(oidIsType('1.3.6.1.4.1.318.1.1.12.4', 'pdu'), true);
  assert.equal(oidIsType('1.3.6.1.4.1.318.1.1.12.4', 'ups'), true, '318. e\' anche ups');
  assert.equal(oidIsType('1.3.6.1.4.1.25053.1', 'ap'), true, 'Ruckus AP (nuovo lato client)');
  assert.equal(oidIsType('', 'printer'), false);
  assert.equal(oidIsType('1.3.6.1.4.1.641.1', ''), false);
});

test('OID_TYPE_VOTES: forma stabile (prefix/type/points) e prefissi OID validi', () => {
  assert.ok(Array.isArray(OID_TYPE_VOTES) && OID_TYPE_VOTES.length >= 25);
  for (const v of OID_TYPE_VOTES) {
    assert.match(v.prefix, /^1\.3\.6\.1\.4\.1\.[0-9.]+$/, `prefix valido: ${v.prefix}`);
    assert.equal(typeof v.type, 'string');
    assert.ok(v.points > 0 && v.points <= 100);
  }
});
