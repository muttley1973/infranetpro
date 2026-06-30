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

test('it: capacità hardware + soluzioni + consigli per-modello', () => {
  const p = buildSystemPrompt('it');
  assert.match(p, /CAPACITÀ HARDWARE/);
  assert.match(p, /device\.capabilities/);
  assert.match(p, /SOLUZIONI/);
  assert.match(p, /PER MODELLO/);
  assert.match(p, /da verificare sul datasheet/i);
});

test('en: hardware capacity + solutions + per-model advice', () => {
  const p = buildSystemPrompt('en');
  assert.match(p, /HARDWARE CAPACITY/);
  assert.match(p, /device\.capabilities/);
  assert.match(p, /SOLUTIONS/);
  assert.match(p, /PER MODEL/);
  assert.match(p, /verify on the official datasheet/i);
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

// ── Aiuto §4c: catalogo UI nel system-prompt ────────────────────────────────
test('help it: catalogo passato → sezione AIUTO + flussi chiave + righe del catalogo', () => {
  const p = buildSystemPrompt('it', undefined, ['"Scopri" — Scansiona la rete', '"Verifica" — Confronta doc e realtà']);
  assert.match(p, /AIUTO INFRANET/);
  assert.match(p, /FLUSSI CHIAVE/);
  assert.match(p, /Spina dorsale: Scopri → Sync → Verifica/);
  assert.match(p, /CATALOGO PULSANTI/);
  assert.match(p, /"Scopri" — Scansiona la rete/);
  assert.match(p, /NON inventare pulsanti/);
});

test('help en: catalogo passato → sezione HELP localizzata', () => {
  const p = buildSystemPrompt('en', undefined, ['"Discover" — Scan the network']);
  assert.match(p, /INFRANET HELP/);
  assert.match(p, /KEY FLOWS/);
  assert.match(p, /Backbone: Discover → Sync → Verify/);
  assert.match(p, /BUTTON CATALOG/);
  assert.match(p, /Do NOT invent buttons/i);
});

test('help: nessun catalogo (assente o vuoto) → output IDENTICO a PROMPTS (retrocompat)', () => {
  assert.equal(buildSystemPrompt('it', undefined, []), PROMPTS.it);
  assert.equal(buildSystemPrompt('it', undefined, ''), PROMPTS.it);
  assert.equal(buildSystemPrompt('it'), PROMPTS.it);
});
