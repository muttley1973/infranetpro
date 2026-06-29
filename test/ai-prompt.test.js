'use strict';
// ============================================================
//  test/ai-prompt.test.js — server/ai/prompt.js (system-prompt grounding).
//  L'argine all'invenzione (paletto #2): le regole dure devono esserci, in
//  entrambe le lingue, e la lingua di risposta deve seguire l'UI.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { buildSystemPrompt } = require('../server/ai/prompt.js');

test('it: regole di grounding presenti + lingua', () => {
  const p = buildSystemPrompt('it');
  assert.match(p, /InfraNet Pro/);
  assert.match(p, /Non inventare MAI/);
  assert.match(p, /non risulta dalla documentazione/);
  assert.match(p, /PRE-CALCOLATI/);
  assert.match(p, /BOZZA/);                       // guardrail Ansible
  assert.match(p, /rispondi in italiano/i);
});

test('en: regole di grounding presenti + lingua', () => {
  const p = buildSystemPrompt('en');
  assert.match(p, /NEVER invent/);
  assert.match(p, /not in the documentation/);
  assert.match(p, /PRE-COMPUTED/);
  assert.match(p, /DRAFT/);
  assert.match(p, /answer in English/i);
});

test('lingua sconosciuta → ricade su it', () => {
  assert.equal(buildSystemPrompt('xx'), buildSystemPrompt('it'));
});

const { PROMPTS } = require('../server/ai/prompt.js');

test('capacità: tutto ON (o assente) → nessuna sezione extra', () => {
  assert.equal(buildSystemPrompt('it'), PROMPTS.it);
  assert.equal(buildSystemPrompt('it', { qa: true, ansible: true }), PROMPTS.it);
});

test('capacità it: Ansible OFF → sezione CAPACITÀ + vincolo esplicito', () => {
  const p = buildSystemPrompt('it', { ansible: false });
  assert.match(p, /CAPACITÀ/);
  assert.match(p, /DISABILITATE/);
  assert.match(p, /NON produrre playbook/i);
});

test('capacità en: Ansible OFF → sezione CAPABILITIES + vincolo esplicito', () => {
  const p = buildSystemPrompt('en', { ansible: false });
  assert.match(p, /CAPABILITIES/);
  assert.match(p, /do NOT produce Ansible/i);
});
