'use strict';
// L'avviso all'avvio quando il server NON ascolta solo sul computer (server/bind-warning.js).
//
// La premessa di sicurezza e' che il server si lega a 127.0.0.1; `HOST` la cambia (in un container deve essere 0.0.0.0) e
// lo faceva in silenzio. Qui si prova: (1) «e' loopback?» per tutte le grafie, senza confronti di stringa; (2) l'avviso
// compare per ogni altro valore e tace per il loopback e con il proxy dichiarato; (3) server.js lo stampa davvero.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isLoopbackHost, bindWarning } = require('../server/bind-warning.js');

test('loopback: tutte le grafie, e SOLO quelle', () => {
  for (const h of ['127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', '[::1]', 'localhost', 'LOCALHOST', ' 127.0.0.1 ', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackHost(h), true, h + ' e\' loopback');
  }
  for (const h of ['0.0.0.0', '::', '[::]', '192.168.1.5', '10.0.0.1', '172.16.0.1', '8.8.8.8', '128.0.0.1', '126.255.255.255',
    '::ffff:192.168.1.5', 'miohost', 'example.com', '', '   ', null, undefined, 127]) {
    assert.equal(isLoopbackHost(h), false, JSON.stringify(h) + ' NON e\' loopback');
  }
});

test('avviso: compare fuori dal loopback, tace nel loopback e col proxy dichiarato', () => {
  const w = bindWarning('0.0.0.0', {});
  assert.match(w, /\[SICUREZZA\]/);
  assert.match(w, /0\.0\.0\.0/, 'dice su quale indirizzo ascolta');
  assert.match(w, /container/, 'nomina l\'uscita onesta del container');
  assert.match(w, /INFRANET_TRUST_PROXY=1/, 'nomina il reverse proxy TLS e la variabile che lo dichiara');
  assert.match(bindWarning('192.168.1.5', {}), /192\.168\.1\.5/);
  assert.match(bindWarning('miohost', undefined), /miohost/, 'anche un nome che non e\' un indirizzo');
  for (const h of ['127.0.0.1', '::1', 'localhost']) assert.equal(bindWarning(h, {}), '', h + ': niente da dire');
  assert.equal(bindWarning('0.0.0.0', { INFRANET_TRUST_PROXY: '1' }), '', 'col proxy dichiarato l\'operatore sa gia\' di essere dietro qualcosa');
  assert.notEqual(bindWarning('0.0.0.0', { INFRANET_TRUST_PROXY: '0' }), '', 'TRUST_PROXY va a «1», come in auth.js: «0» non lo dichiara');
});

test('server.js importa l\'avviso e lo stampa all\'avvio con HOST e l\'ambiente veri', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(t, /require\('\.\/server\/bind-warning'\)/);
  assert.match(t, /bindWarning\(HOST,\s*process\.env\)/, 'l\'avviso si calcola su HOST e process.env');
  // dentro il callback del listen (se no si stamperebbe anche quando un test fa require di server.js)
  const listen = t.slice(t.indexOf('app.listen(PORT, HOST'));
  assert.ok(/bindWarning\(HOST,\s*process\.env\)/.test(listen), 'e sta dopo app.listen, nel ramo «eseguito direttamente»');
  assert.ok(t.indexOf('if (require.main === module)') < t.indexOf('bindWarning(HOST'), 'e solo se il file e\' eseguito direttamente');
});
