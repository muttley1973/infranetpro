'use strict';
// La ricerca per MAC confronta CHIAVI, non testo (lib/mac-class.js: macFragment, macMatchesQuery).
//
// Il campo di ricerca della testata cercava il testo digitato dentro il MAC come era scritto nel documento: `aa-bb-cc-dd-ee-ff`
// o `aabb.ccdd.eeff` (la grafia Cisco) non trovavano `AA:BB:CC:DD:EE:FF`, lo stesso MAC. Un MAC non si confronta per stringa:
// la regola del progetto e' `macKey`, e qui si estende ai PEZZI di MAC (un prefisso OUI) senza far diventare MAC cio' che MAC non e'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { macFragment, macMatchesQuery } = require('../lib/mac-class.js');

const MAC = 'AA:BB:CC:DD:EE:FF';

test('macFragment: le cifre di un pezzo di MAC in ogni grafia, vuoto per tutto il resto', () => {
  const cifre = [
    ['aa:bb:cc', 'aabbcc'], ['AA-BB-CC-DD-EE-FF', 'aabbccddeeff'], ['aabb.ccdd.eeff', 'aabbccddeeff'], ['aabb.ccdd', 'aabbccdd'],
    ['AABBCCDDEEFF', 'aabbccddeeff'], ['aa:bb:c', 'aabbc'], ['aa:bb', 'aabb'], ['  aa:bb:cc  ', 'aabbcc'], ['aabb.ccdd.', 'aabbccdd'],
  ];
  for (const [q, atteso] of cifre) assert.equal(macFragment(q), atteso, JSON.stringify(q));
  // Non hanno la FORMA di un MAC: restano ricerche di testo, non diventano ricerche di MAC per caso.
  for (const q of ['192.168', '10.0.0.1', '192.168.1.10', 'sw-core', 'switch', '123456', 'aabbcc', 'aabbccddeef', 'aa', 'aa:', ':aa:bb',
    'gg:hh:ii', 'aa:bb:cc:dd:ee:ff:00:11', '', '   ', null, undefined, 42]) {
    assert.equal(macFragment(q), '', JSON.stringify(q) + ' non e\' un pezzo di MAC');
  }
});

test('macMatchesQuery: lo stesso MAC si trova in qualunque grafia, dall\'una all\'altra', () => {
  const grafie = [MAC, 'aa:bb:cc:dd:ee:ff', 'AA-BB-CC-DD-EE-FF', 'aabb.ccdd.eeff', 'AABBCCDDEEFF', ' aa:bb:cc:dd:ee:ff '];
  for (const nelDocumento of grafie) for (const digitato of grafie) {
    assert.equal(macMatchesQuery(nelDocumento, digitato), true, `scritto «${nelDocumento}», cercato «${digitato}»`);
  }
  // Un pezzo: il prefisso OUI, un pezzo in mezzo, un pezzo che finisce a meta' di un ottetto.
  for (const q of ['aa:bb:cc', 'AA-BB-CC', 'aabb.ccdd', 'cc:dd:ee', 'bb:cc:d', 'dd-ee-ff']) assert.equal(macMatchesQuery(MAC, q), true, q);
  // Un altro MAC non c'e'.
  for (const q of ['aa:bb:cd', '11:22:33', 'aabb.ccdd.eef0', 'ff:ee:dd']) assert.equal(macMatchesQuery(MAC, q), false, q);
});

test('macMatchesQuery: se il valore nel documento non e\' un MAC, o la ricerca non e\' un pezzo di MAC, non trova niente', () => {
  assert.equal(macMatchesQuery('', 'aa:bb'), false);
  assert.equal(macMatchesQuery(null, 'aa:bb'), false);
  assert.equal(macMatchesQuery('non e\' un mac', 'aa:bb'), false);
  assert.equal(macMatchesQuery('aa:bb:cc', 'aa:bb'), false, 'un MAC a meta\' non e\' un MAC: nessuna chiave');
  assert.equal(macMatchesQuery(MAC, '192.168'), false, 'un indirizzo IP non cerca i MAC');
  assert.equal(macMatchesQuery(MAC, 'aabbcc'), false, 'un pezzo NUDO non e\' riconosciuto');
  assert.equal(macMatchesQuery(MAC, ''), false);
});

test('il campo di ricerca usa macMatchesQuery sul MAC del nodo (e il testo continua a bastare)', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-search-zoom-rack.js'), 'utf8');
  assert.match(t, /import\s*\{\s*macMatchesQuery\s*\}\s*from\s*'\.\.\/lib\/mac-class\.js'/, 'importa macMatchesQuery');
  const corpo = /function buildSearchResults\(query\)\s*\{([\s\S]*?)\n\}/.exec(t);
  assert.ok(corpo, 'buildSearchResults si trova');
  assert.match(corpo[1], /hay\.includes\(q\)\s*\|\|\s*macMatchesQuery\(view\.mac,\s*q\)/, 'il nodo si trova se il testo combacia OPPURE se combacia la chiave del MAC');
});
