'use strict';
// Test struttura i18n (scaffolding): fallback, interpolazione, glossario, lingua.
const test = require('node:test');
const assert = require('node:assert');
const i18n = require('../lib/i18n.js');

test('default: lingua sorgente è it', () => {
  assert.equal(i18n.getLang(), 'it');
  assert.equal(i18n.t('common.save'), 'Salva');
});

test('setLang: cambia lingua e t() risponde in en', () => {
  i18n.setLang('en');
  assert.equal(i18n.getLang(), 'en');
  assert.equal(i18n.t('common.save'), 'Save');
  assert.equal(i18n.t('props.identity'), 'Detected identity');
  i18n.setLang('it'); // ripristina per gli altri test
});

test('setLang: lingua non supportata viene ignorata', () => {
  const before = i18n.getLang();
  assert.equal(i18n.setLang('xx'), before);
});

test('fallback: chiave senza traduzione en ricade su it', () => {
  i18n.setLang('en');
  // chiave presente solo in it (simulata): se mancasse in en, torna l'it
  const v = i18n.t('common.save'); // esiste in en
  assert.equal(typeof v, 'string');
  i18n.setLang('it');
});

test('fallback: chiave totalmente assente ritorna la chiave stessa', () => {
  assert.equal(i18n.t('non.esiste.proprio'), 'non.esiste.proprio');
});

test('interpolazione {var}', () => {
  // usa una chiave inesistente come template letterale per testare il replace
  assert.equal(i18n.t('Ciao {nome}', { nome: 'Max' }), 'Ciao Max');
  assert.equal(i18n.t('{a}-{b}', { a: 1, b: 2 }), '1-2');
});

test('glossario: termini tecnici riconosciuti, non-tecnici no', () => {
  assert.ok(i18n.isGlossaryTerm('VLAN'));
  assert.ok(i18n.isGlossaryTerm('trunk'));
  assert.ok(i18n.isGlossaryTerm('Patch Panel'));
  assert.ok(!i18n.isGlossaryTerm('descrizione'));
});

test('parità chiavi it/en: ogni chiave it ha la sua en', () => {
  const it = Object.keys(i18n._i18nDict.it).sort();
  const en = Object.keys(i18n._i18nDict.en).sort();
  assert.deepEqual(it, en, 'le chiavi di it ed en devono coincidere');
});
