'use strict';
// ============================================================
// Scopri con piu' reti: la community PER RETE, e quella SUGGERITA dagli apparati gia' documentati
// ============================================================
// La community e' una credenziale: dove va lo decide una persona. Per ogni rete della scansione il dialogo puo' avere la sua
// (campo mascherato, non salvato); e se in quella rete ci sono apparati GIA' documentati con una community, la propone — da
// confermare, mai da sola — perche' e' un dato che il progetto ha gia' e che resta nella rete da cui viene.
//
//   communityHints(nodi, reti)          per ogni rete: quanti apparati con community, quante diverse, e LA community solo se e' una sola
//   communityFor(rete, sovrascritte, d) quella che vale per UNA rete: la sua, se scritta, altrimenti quella del campo
//   groupRangesByCommunity(...)         le reti raggruppate per community: il crawl parte UNA volta per gruppo, con la sua credenziale
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { communityHints, communityFor, groupRangesByCommunity } = require('../lib/scan-community-hints.js');

const R = (text, first, last) => ({ text, first, last });
const R5 = R('10.0.5.0/24', '10.0.5.1', '10.0.5.254');
const R6 = R('10.0.6.0/24', '10.0.6.1', '10.0.6.254');
const nodo = (ip, community, extra) => Object.assign({ id: 'n' + ip, ip, integration: { driver: 'snmp-v2c', community } }, extra || {});

// ── communityHints ───────────────────────────────────────────────────────────────────────────────
test('un apparato documentato nella rete con una community: la rete la suggerisce', () => {
  const h = communityHints([nodo('10.0.5.10', 'abc')], [R5]);
  assert.deepEqual(h, [{ text: '10.0.5.0/24', count: 1, distinct: 1, value: 'abc' }]);
});

test('piu\' apparati con la STESSA community: stessa suggerita, e il conteggio dice quanti', () => {
  const h = communityHints([nodo('10.0.5.10', 'abc'), nodo('10.0.5.11', 'abc'), nodo('10.0.5.12', 'abc')], [R5]);
  assert.equal(h[0].count, 3);
  assert.equal(h[0].distinct, 1);
  assert.equal(h[0].value, 'abc');
});

test('community DIVERSE nella stessa rete: non se ne sceglie una (value null) e si dice quante sono', () => {
  const h = communityHints([nodo('10.0.5.10', 'abc'), nodo('10.0.5.11', 'xyz')], [R5]);
  assert.equal(h[0].count, 2);
  assert.equal(h[0].distinct, 2);
  assert.equal(h[0].value, null, 'una community scelta a caso fra due non e\' un suggerimento');
  assert.ok(!JSON.stringify(h).includes('abc') && !JSON.stringify(h).includes('xyz'), 'le community diverse non escono dalla funzione');
});

test('gli apparati di un\'ALTRA rete non contano: la community di una rete non va a un\'altra', () => {
  const h = communityHints([nodo('10.0.5.10', 'abc'), nodo('10.0.6.10', 'xyz')], [R5, R6]);
  assert.deepEqual(h.map((x) => [x.text, x.count, x.value]), [['10.0.5.0/24', 1, 'abc'], ['10.0.6.0/24', 1, 'xyz']]);
  const solo6 = communityHints([nodo('10.0.9.10', 'abc')], [R5]);
  assert.deepEqual(solo6[0], { text: '10.0.5.0/24', count: 0, distinct: 0, value: null });
});

test('gli estremi della rete sono dentro, un indirizzo oltre e\' fuori', () => {
  const h = communityHints([nodo('10.0.5.1', 'a'), nodo('10.0.5.254', 'a'), nodo('10.0.5.0', 'b'), nodo('10.0.5.255', 'b')], [R5]);
  assert.equal(h[0].count, 2, 'primo e ultimo host dentro; .0 e .255 fuori');
  assert.equal(h[0].value, 'a');
});

test('l\'indirizzo a cui si rivolge il poller e\' quello che conta: `integration.host`, poi l\'IP del nodo', () => {
  // L'IP del nodo e' altrove, ma lo si interroga a un indirizzo della rete: e' LI' che la community vale.
  const viaHost = nodo('192.168.99.9', 'abc', { integration: { driver: 'snmp-v2c', community: 'abc', host: '10.0.5.77' } });
  assert.equal(communityHints([viaHost], [R5])[0].count, 1);
  const fuori = nodo('10.0.5.10', 'abc', { integration: { driver: 'snmp-v2c', community: 'abc', host: '192.168.99.9' } });
  assert.equal(communityHints([fuori], [R5])[0].count, 0, 'IP nel range ma si interroga altrove: non e\' di questa rete');
});

test('solo v1 e v2c hanno una community: un apparato v3 non conta, il driver si legge in qualunque maiuscola', () => {
  const v3 = nodo('10.0.5.10', 'abc', { integration: { driver: 'snmp-v3', community: 'abc' } });
  assert.equal(communityHints([v3], [R5])[0].count, 0);
  const maiuscolo = nodo('10.0.5.11', 'abc', { integration: { driver: ' SNMP-V2C ', community: 'abc' } });
  assert.equal(communityHints([maiuscolo], [R5])[0].count, 1, 'il server accetta il driver in qualunque maiuscola');
  const v1 = nodo('10.0.5.12', 'abc', { integration: { driver: 'snmp-v1', community: 'abc' } });
  assert.equal(communityHints([v1], [R5])[0].count, 1);
  const senzaDriver = nodo('10.0.5.13', 'abc', { integration: { community: 'abc' } });
  assert.equal(communityHints([senzaDriver], [R5])[0].count, 0, 'una community senza driver SNMP non e\' in uso');
});

test('community vuota o fatta di soli spazi non e\' una community; un apparato senza integrazione o senza indirizzo si salta', () => {
  const nodi = [nodo('10.0.5.10', ''), nodo('10.0.5.11', '   '), nodo('10.0.5.12', undefined), { id: 'x', ip: '10.0.5.13' },
    { id: 'y', integration: { driver: 'snmp-v2c', community: 'abc' } }, nodo('un-nome-non-un-ip', 'abc'), null, undefined];
  assert.equal(communityHints(nodi, [R5])[0].count, 0);
});

test('input guasto non rompe niente: nessun apparato, nessuna rete, rete con estremi non validi', () => {
  assert.deepEqual(communityHints(null, [R5]), [{ text: '10.0.5.0/24', count: 0, distinct: 0, value: null }]);
  assert.deepEqual(communityHints([nodo('10.0.5.10', 'abc')], null), []);
  assert.deepEqual(communityHints([nodo('10.0.5.10', 'abc')], [R('x', 'no', 'no')]), [{ text: 'x', count: 0, distinct: 0, value: null }]);
});

test('una rete dentro un\'altra: ognuna conta i suoi', () => {
  const grande = R('10.0.5.0/24', '10.0.5.1', '10.0.5.254');
  const piccola = R('10.0.5.0/30', '10.0.5.1', '10.0.5.2');
  const h = communityHints([nodo('10.0.5.2', 'abc'), nodo('10.0.5.100', 'abc')], [grande, piccola]);
  assert.deepEqual(h.map((x) => x.count), [2, 1]);
});

// ── communityFor ─────────────────────────────────────────────────────────────────────────────────
test('communityFor: la sua se scritta, altrimenti quella del campo; uno spazio non e\' una community', () => {
  assert.equal(communityFor('10.0.5.0/24', { '10.0.5.0/24': 'privata' }, 'public'), 'privata');
  assert.equal(communityFor('10.0.6.0/24', { '10.0.5.0/24': 'privata' }, 'public'), 'public');
  assert.equal(communityFor('10.0.5.0/24', { '10.0.5.0/24': '   ' }, 'public'), 'public');
  assert.equal(communityFor('10.0.5.0/24', { '10.0.5.0/24': '' }, 'public'), 'public');
  assert.equal(communityFor('10.0.5.0/24', null, 'public'), 'public');
  assert.equal(communityFor('10.0.5.0/24', {}, ''), '');
});

test('communityFor: il nome di una rete come chiave e\' una chiave, mai una proprieta\' ereditata', () => {
  assert.equal(communityFor('constructor', {}, 'public'), 'public');
  assert.equal(communityFor('__proto__', {}, 'public'), 'public');
  assert.equal(communityFor('toString', {}, 'public'), 'public');
});

test('communityFor: una proprieta\' di Object.prototype (inquinata) non e\' la community di nessuna rete', () => {
  Object.prototype.reteInquinata = 'evil';
  try {
    assert.equal(communityFor('reteInquinata', {}, 'public'), 'public', 'una stringa ereditata non conta');
  } finally { delete Object.prototype.reteInquinata; }
});

// ── groupRangesByCommunity ───────────────────────────────────────────────────────────────────────
test('groupRangesByCommunity: le reti con la stessa community vanno insieme, nell\'ordine di prima comparsa', () => {
  const g = groupRangesByCommunity(['A', 'B', 'C', 'D'], ['x', 'y', 'x', 'z']);
  assert.deepEqual(g, [{ community: 'x', indexes: [0, 2] }, { community: 'y', indexes: [1] }, { community: 'z', indexes: [3] }]);
});

test('groupRangesByCommunity: nessuna sovrascrittura = UN gruppo (un solo crawl, come prima)', () => {
  assert.deepEqual(groupRangesByCommunity(['A', 'B'], ['public', 'public']), [{ community: 'public', indexes: [0, 1] }]);
  assert.deepEqual(groupRangesByCommunity([], []), []);
});
