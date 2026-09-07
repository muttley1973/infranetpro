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

// ── «Mostra cosa esce» è una PROMESSA, e va verificata ─────────────────────
// L'anteprima (`POST /api/ai/preview`) dichiara di mostrare ESATTAMENTE ciò che
// uscirebbe verso il provider. È l'unica cosa su cui una persona decide se
// accendere l'assistente: se il prompt spedito contenesse un campo in più, quella
// schermata sarebbe una bugia — il difetto peggiore possibile per questa funzione.
// Qui si prova che le DUE strade partono dalla stessa chiamata e con gli stessi
// argomenti: anteprima e chat costruiscono il contesto con `buildAiContext(project,
// liveFacts, scope)`, dove lo `scope` è quello CONFIGURATO, non uno inventato.
// (La verifica dal vivo — anteprima confrontata con ciò che arriva a un provider
// finto, ambito ristretto compreso — sta in `_local/tools/smoke/sonda-ai.js`.)
test('ai route — anteprima e chat costruiscono il contesto nello STESSO modo', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server/routes/ai.js'), 'utf8');
  // ⚠️ Fino alla `;`, non alla prima `)`: il primo argomento contiene una chiamata
  // (`aiConfig.getConfig().scope`), e fermarsi lì leggeva mezzo argomento — la
  // prima stesura di questa riga era rossa per colpa sua, non del codice.
  const chiamate = [...src.matchAll(/buildAiContext\(([^;]*)\);/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
  assert.strictEqual(chiamate.length, 2, 'una per l\'anteprima, una per la chat: se diventano tre, la promessa va rifatta');
  assert.strictEqual(chiamate[0], 'project, body.liveFacts, aiConfig.getConfig().scope');
  assert.strictEqual(chiamate[1], 'project, body.liveFacts, cfg.scope');
  // Lo scope delle due viene dalla stessa config: `getConfigWithKey` è
  // `getConfig` più la chiave, e la chiave nel contesto non entra.
  assert.match(src, /const cfg = aiConfig\.getConfigWithKey\(\)/);
});

test('ai route — il controllo anti-invenzione guarda il CONTESTO, non il progetto', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server/routes/ai.js'), 'utf8');
  // `entities` serve al client per accusare il modello di aver inventato un
  // apparato. Se venisse dal PROGETTO invece che dal contesto, accuserebbe una
  // risposta corretta su dati che il modello non ha mai visto — o assolverebbe
  // una sbagliata. Deve essere estratto da ciò che è stato SPEDITO.
  assert.match(src, /extractEntities\(context\)/);
  assert.doesNotMatch(src, /extractEntities\(project\)/);
});
