'use strict';
// ============================================================
//  test/ai-draft.test.js — lib/ai-draft.js (segmentazione bozza Ansible, L3).
//
//  Verifica che splitDraftBlocks separi testo e blocchi di codice (fence ```),
//  marchi come «bozza» i linguaggi di automazione (yaml/ansible/sh…) e preservi
//  l'indentazione del codice. La UI usa questi segmenti per il banner + Copia.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitDraftBlocks, extractDrafts, hasDraft, _isDraftLang } = require('../lib/ai-draft.js');

test('splitDraftBlocks: testo + blocco yaml + testo → 3 segmenti, codice marcato bozza', () => {
  const md = 'Ecco la bozza:\n```yaml\n- hosts: switch\n  tasks:\n    - ping:\n```\nRivedi prima di applicare.';
  const segs = splitDraftBlocks(md);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].type, 'text');
  assert.equal(segs[1].type, 'code');
  assert.equal(segs[1].lang, 'yaml');
  assert.equal(segs[1].draft, true);
  assert.match(segs[1].content, /- hosts: switch/);
  assert.equal(segs[2].type, 'text');
});

test('splitDraftBlocks: preserva l\'indentazione interna del codice', () => {
  const segs = splitDraftBlocks('```yaml\nlevel0:\n  level1:\n    level2: x\n```');
  assert.equal(segs[0].content, 'level0:\n  level1:\n    level2: x');
});

test('splitDraftBlocks: blocco json NON è bozza (copiabile ma senza banner)', () => {
  const segs = splitDraftBlocks('```json\n{"a":1}\n```');
  assert.equal(segs[0].type, 'code');
  assert.equal(segs[0].draft, false);
});

test('splitDraftBlocks: testo senza fence → un solo segmento di testo', () => {
  const segs = splitDraftBlocks('Solo una frase, niente codice.');
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'text');
});

test('splitDraftBlocks: fence non chiusa → blocco di codice (bozza monca)', () => {
  const segs = splitDraftBlocks('intro\n```bash\nansible -m ping all');
  assert.equal(segs.length, 2);
  assert.equal(segs[1].type, 'code');
  assert.equal(segs[1].draft, true);
});

test('splitDraftBlocks: due blocchi nello stesso messaggio', () => {
  const segs = splitDraftBlocks('```ini\n[x]\n```\nmezzo\n```yaml\nk: v\n```');
  const code = segs.filter((s) => s.type === 'code');
  assert.equal(code.length, 2);
  assert.ok(code.every((c) => c.draft));
});

test('splitDraftBlocks: input vuoto/nullo non lancia', () => {
  assert.deepEqual(splitDraftBlocks(''), []);
  assert.deepEqual(splitDraftBlocks(null), []);
  assert.doesNotThrow(() => splitDraftBlocks(undefined));
});

test('extractDrafts / hasDraft / _isDraftLang', () => {
  assert.equal(extractDrafts('a\n```yaml\nk: v\n```\nb').length, 1);
  assert.equal(hasDraft('```yaml\nk: v\n```'), true);
  assert.equal(hasDraft('```json\n{}\n```'), false);
  assert.equal(hasDraft('nessun blocco'), false);
  assert.equal(_isDraftLang('ANSIBLE'), true);
  assert.equal(_isDraftLang('python'), false);
});
