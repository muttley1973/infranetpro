'use strict';
// ============================================================
//  test/ai-route-security.test.js — guardia di sicurezza sulle route AI.
//
//  M-1 (audit sicurezza): `projectId` arriva nel BODY di /api/ai/preview e
//  /api/ai/chat e finiva a loadProject SENZA coercizione → path.join(PROJECTS_DIR,
//  `${id}.json`) poteva uscire da projects/ con un body tipo "../users" (path
//  traversal). `_safeProjectId` deve accettare SOLO interi positivi.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../server/routes/ai');
const _safeProjectId = router._safeProjectId;

test('ai route — _safeProjectId accetta interi positivi (numero o stringa numerica)', () => {
  assert.equal(_safeProjectId(5), 5);
  assert.equal(_safeProjectId('5'), 5);
  assert.equal(_safeProjectId(' 12 '), 12);   // Number() tollera gli spazi
  assert.equal(_safeProjectId(1000), 1000);
});

test('ai route — _safeProjectId RIFIUTA il path traversal (anti M-1)', () => {
  assert.equal(_safeProjectId('../users'), null);
  assert.equal(_safeProjectId('../../etc/passwd'), null);
  assert.equal(_safeProjectId('../api-tokens'), null);
  assert.equal(_safeProjectId('1; rm -rf /'), null);
  assert.equal(_safeProjectId('5/../../secret'), null);
  assert.equal(_safeProjectId('abc'), null);
});

test('ai route — _safeProjectId RIFIUTA non-interi e valori non positivi', () => {
  assert.equal(_safeProjectId(5.5), null);
  assert.equal(_safeProjectId(0), null);
  assert.equal(_safeProjectId(-3), null);
  assert.equal(_safeProjectId(''), null);
  assert.equal(_safeProjectId(null), null);
  assert.equal(_safeProjectId(undefined), null);
  assert.equal(_safeProjectId({}), null);
  assert.equal(_safeProjectId(NaN), null);
});
