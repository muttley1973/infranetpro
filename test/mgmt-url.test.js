// lib/mgmt-url.js — lo schema di un management URL è una DECISIONE, non un testo.
// Smoke 06/09: `mgmtUrl = "javascript:…"` finiva in un iframe e girava nell'origin
// dell'app con la sessione di chi cliccava «Apri». Qui il contratto della guardia.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeMgmtUrl, mgmtUrlScheme, MGMT_URL_DANGEROUS_SCHEMES } = require('../lib/mgmt-url.js');

// La forma della lista protocolli dell'app: prefissi con «://» e schemi nudi.
const LISTA = ['http', 'https', 'ssh://', 'telnet://', 'rdp://', 'vnc://', 'winbox://'];

test('mgmtUrlScheme: schema in minuscolo senza «:», vuoto se manca', () => {
  assert.equal(mgmtUrlScheme('HTTPS://10.0.0.1'), 'https');
  assert.equal(mgmtUrlScheme('  ssh://10.0.0.1'), 'ssh');
  assert.equal(mgmtUrlScheme('JavaScript:alert(1)'), 'javascript');
  assert.equal(mgmtUrlScheme('10.0.0.1'), '');
  assert.equal(mgmtUrlScheme(''), '');
  assert.equal(mgmtUrlScheme(null), '');
  // «1abc:» non è uno schema (RFC 3986: inizia con una lettera)
  assert.equal(mgmtUrlScheme('1abc:x'), '');
});

test('isSafeMgmtUrl: passa solo la lista protocolli + http/https', () => {
  assert.equal(isSafeMgmtUrl('https://10.0.0.1', LISTA), true);
  assert.equal(isSafeMgmtUrl('http://10.0.0.1:8080/admin', LISTA), true);
  assert.equal(isSafeMgmtUrl('ssh://admin@10.0.0.1', LISTA), true);
  assert.equal(isSafeMgmtUrl('RDP://10.0.0.1', LISTA), true);
  assert.equal(isSafeMgmtUrl('ftp://10.0.0.1', LISTA), false, 'schema fuori lista');
  assert.equal(isSafeMgmtUrl('10.0.0.1', LISTA), false, 'senza schema non apre niente');
  assert.equal(isSafeMgmtUrl('', LISTA), false);
});

test('isSafeMgmtUrl: gli schemi che eseguono o leggono sono rifiutati QUALUNQUE lista arrivi', () => {
  const brutti = [
    'javascript:top.__x=1', 'JavaScript:alert(1)', ' javascript:1', 'data:text/html,<script>1</script>',
    'vbscript:msgbox', 'blob:http://x/y', 'file:///etc/passwd', 'about:blank',
  ];
  for (const u of brutti) {
    assert.equal(isSafeMgmtUrl(u, LISTA), false, u);
    // anche se l'utente li mettesse nella propria lista personalizzata
    assert.equal(isSafeMgmtUrl(u, LISTA.concat(['javascript:', 'data:', 'file://'])), false, u + ' (in lista)');
    // e anche senza lista
    assert.equal(isSafeMgmtUrl(u), false, u + ' (senza lista)');
  }
  assert.ok(MGMT_URL_DANGEROUS_SCHEMES.test('javascript'));
});

test('isSafeMgmtUrl senza lista: qualunque schema non pericoloso', () => {
  assert.equal(isSafeMgmtUrl('winbox://10.0.0.1'), true);
  assert.equal(isSafeMgmtUrl('mstsc://10.0.0.1'), true);
});
