'use strict';
// ============================================================
// Scopri con PIU' reti: la lista di intervalli si legge in UN posto (lib/scan-ranges.js)
// ============================================================
// Il campo «Intervallo di rete» accettava UN CIDR, UN intervallo o UN IP. Ora ne accetta una lista, e
// le caselle «reti conosciute» sotto il campo aggiungono e tolgono voci dallo STESSO testo: chi
// spezza la lista (il pannello, il server) usa questa lettura, non una copia. Pura, senza DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitScanTargets, hasScanTarget, toggleScanTarget } = require('../lib/scan-ranges.js');

test('una voce sola resta una voce sola (il caso di prima non cambia)', () => {
  assert.deepEqual(splitScanTargets('192.168.1.0/24'), ['192.168.1.0/24']);
  assert.deepEqual(splitScanTargets('  192.168.1.1-254  '), ['192.168.1.1-254']);
  assert.deepEqual(splitScanTargets('10.0.0.5'), ['10.0.0.5']);
});

test('virgola, punto e virgola, a capo e spazio separano le voci', () => {
  const attese = ['10.0.1.0/24', '10.0.2.0/24', '10.0.3.0/24', '10.0.4.0/24'];
  assert.deepEqual(splitScanTargets('10.0.1.0/24, 10.0.2.0/24;10.0.3.0/24\n10.0.4.0/24'), attese);
  assert.deepEqual(splitScanTargets('10.0.1.0/24 10.0.2.0/24   10.0.3.0/24\r\n10.0.4.0/24'), attese);
});

test('le voci vuote non esistono: separatori doppi, in testa e in coda', () => {
  assert.deepEqual(splitScanTargets(',, 10.0.1.0/24 ,; ,10.0.2.0/24,,'), ['10.0.1.0/24', '10.0.2.0/24']);
  assert.deepEqual(splitScanTargets(''), []);
  assert.deepEqual(splitScanTargets('   \n ,; '), []);
});

test('uno spazio attorno al trattino NON spezza un intervallo (e non lo inventa: lo ricompone)', () => {
  assert.deepEqual(splitScanTargets('192.168.1.1 - 254'), ['192.168.1.1-254']);
  assert.deepEqual(splitScanTargets('192.168.1.1 -254, 10.0.0.0/24'), ['192.168.1.1-254', '10.0.0.0/24']);
});

test('qualunque cosa che non sia testo e\' una lista vuota, non un errore', () => {
  for (const v of [null, undefined, 42, {}, [], true]) assert.deepEqual(splitScanTargets(v), []);
});

test('hasScanTarget: la voce c\'e\' solo se e\' esattamente quella (10.0.1.0/24 non e\' 10.0.1.0/25)', () => {
  assert.equal(hasScanTarget('10.0.1.0/24, 10.0.2.0/24', '10.0.2.0/24'), true);
  assert.equal(hasScanTarget('10.0.1.0/24, 10.0.2.0/24', '10.0.3.0/24'), false);
  assert.equal(hasScanTarget('10.0.1.0/25', '10.0.1.0/24'), false);
  assert.equal(hasScanTarget('', '10.0.1.0/24'), false);
});

test('toggleScanTarget: aggiunge in coda, toglie, e non raddoppia', () => {
  assert.equal(toggleScanTarget('', '10.0.1.0/24', true), '10.0.1.0/24');
  assert.equal(toggleScanTarget('10.0.1.0/24', '10.0.2.0/24', true), '10.0.1.0/24, 10.0.2.0/24');
  assert.equal(toggleScanTarget('10.0.1.0/24, 10.0.2.0/24', '10.0.2.0/24', true), '10.0.1.0/24, 10.0.2.0/24', 'gia\' dentro: non raddoppia');
  assert.equal(toggleScanTarget('10.0.1.0/24, 10.0.2.0/24', '10.0.1.0/24', false), '10.0.2.0/24');
  assert.equal(toggleScanTarget('10.0.1.0/24', '10.0.1.0/24', false), '', 'tolta l\'unica voce il campo torna vuoto');
  assert.equal(toggleScanTarget('10.0.1.0/24', '10.0.9.0/24', false), '10.0.1.0/24', 'togliere una voce che non c\'e\' non tocca le altre');
});

test('una voce che COMINCIA come un\'altra non e\' un\'altra: .1-5 non e\' .1-50 (ne\' per has, ne\' per toggle)', () => {
  assert.equal(hasScanTarget('10.0.1.1-50', '10.0.1.1-5'), false);
  assert.equal(hasScanTarget('10.0.1.1-5, 10.0.1.1-50', '10.0.1.1-5'), true);
  assert.equal(toggleScanTarget('10.0.1.1-5, 10.0.1.1-50', '10.0.1.1-5', false), '10.0.1.1-50', 'toglie la sua, non quella che ci assomiglia');
  assert.equal(toggleScanTarget('10.0.1.1-50', '10.0.1.1-5', true), '10.0.1.1-50, 10.0.1.1-5', 'una che ci assomiglia non conta come «gia\' dentro»');
});

test('toggleScanTarget non butta cio\' che l\'utente ha scritto a mano: un intervallo con lo spazio sopravvive', () => {
  assert.equal(toggleScanTarget('192.168.1.1 - 254', '10.0.1.0/24', true), '192.168.1.1-254, 10.0.1.0/24');
  assert.equal(toggleScanTarget('192.168.1.1-254, 10.0.1.0/24', '10.0.1.0/24', false), '192.168.1.1-254');
});
