'use strict';
// ============================================================
// LA VISTA MULTISITO — il tile e i tratti (`lib/multisite-view.js`).
//
// Le prove sono quelle che a occhio non si vedono:
//   ① un collegamento ha UN tipo, e vince il tunnel (come l'icona della riga);
//   ② senza nessuno dei due assi il tipo è «non dichiarato» e RESTA un filtro:
//      non si nascondono in silenzio i collegamenti di cui nessuno ha scritto la natura;
//   ③ il tile elenca i tipi che ci sono, nell'ordine di un tecnico, coi conteggi;
//   ④ spegnere un tipo toglie dai visibili ESATTAMENTE quelli, e li conta;
//   ⑤ gli accessi si raggruppano per testo normalizzato e si contano per SEDE;
//   ⑥ un accesso scelto restituisce le sedi che lo hanno — e «senza tipo» è un accesso;
//   ⑦ ogni tipo ha un tratto, e due tipi che si leggono diversi non hanno lo stesso.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { connectionKind, kindAxis, kindStyle, accessKey, buildTile, ACCESS_NONE, KIND_ORDER } = require('../lib/multisite-view.js');
const { INTER_SITE_TRANSPORTS, INTER_SITE_TUNNELS } = require('../lib/inter-site.js');

const L = (id, transport, tunnel) => ({ id, aSiteId: 'a', bSiteId: 'b', transport: transport || null, tunnel: tunnel || null });
const S = (id) => ({ id, name: id, role: 'standalone', subnets: [] });
const U = (siteId, serviceType) => ({ id: 'u-' + siteId + '-' + String(serviceType), siteId, serviceType });

test('① vince il tunnel; senza tunnel il trasporto; «nessun tunnel» lascia parlare il trasporto', () => {
  assert.equal(connectionKind(L('1', 'mpls', 'ipsec')), 'ipsec');
  assert.equal(connectionKind(L('2', 'mpls', null)), 'mpls');
  assert.equal(connectionKind(L('3', 'internet', 'none')), 'internet');
  assert.equal(connectionKind(L('4', null, 'wireguard')), 'wireguard');
  assert.equal(connectionKind(L('5', 'directLink', 'sdwan')), 'sdwan');
});

test('② senza nessun asse il tipo è «non dichiarato»; «altro» non si confonde fra i due assi', () => {
  assert.equal(connectionKind(L('1', null, null)), 'undeclared');
  assert.equal(connectionKind(L('2', null, 'none')), 'undeclared');
  assert.equal(connectionKind({}), 'undeclared');
  assert.equal(connectionKind(null), 'undeclared');
  assert.equal(connectionKind(L('3', 'other', null)), 'transportOther');
  assert.equal(connectionKind(L('4', null, 'other')), 'tunnelOther');
  // Un valore che il modello non conosce non si perde e non inventa un tipo nuovo.
  assert.equal(connectionKind(L('5', 'quantum', null)), 'transportOther');
  assert.equal(connectionKind(L('6', null, 'quantum')), 'tunnelOther');
});

test('② bis ogni valore del modello ha una chiave nota, un asse e un tratto', () => {
  for (const tr of INTER_SITE_TRANSPORTS) {
    const k = connectionKind(L('x', tr, null));
    assert.ok(KIND_ORDER.includes(k), 'trasporto ' + tr + ' → ' + k);
    assert.ok(kindStyle(k) && kindStyle(k).width > 0, 'tratto per ' + k);
  }
  for (const tu of INTER_SITE_TUNNELS.filter(x => x !== 'none')) {
    const k = connectionKind(L('x', null, tu));
    assert.ok(KIND_ORDER.includes(k), 'tunnel ' + tu + ' → ' + k);
    assert.equal(kindAxis(k), 'tunnel', tu);
  }
  assert.equal(kindAxis('mpls'), 'transport');
  assert.equal(kindAxis('undeclared'), 'none');
});

test('③ il tile elenca i tipi che ci sono, in ordine da tecnico, coi conteggi', () => {
  const org = { sites: [S('a'), S('b')], uplinks: [], links: [
    L('1', null, 'sdwan'), L('2', 'mpls', null), L('3', null, 'ipsec'), L('4', null, 'ipsec'), L('5', null, null),
  ] };
  const t = buildTile(org, {});
  assert.deepEqual(t.kinds.map(k => [k.key, k.n, k.hidden]), [
    ['mpls', 1, false], ['ipsec', 2, false], ['sdwan', 1, false], ['undeclared', 1, false],
  ]);
  assert.deepEqual(buildTile({ sites: [], links: [] }, {}).kinds, [], 'senza collegamenti, nessuna pastiglia');
});

test('④ spegnere un tipo toglie dai visibili esattamente quelli, e li conta', () => {
  const org = { sites: [S('a'), S('b')], uplinks: [], links: [L('1', 'mpls'), L('2', null, 'ipsec'), L('3', null, 'ipsec'), L('4', null, null)] };
  const t = buildTile(org, { hidden: { ipsec: true } });
  assert.deepEqual(t.visibleLinkIds, ['1', '4']);
  assert.equal(t.hiddenLinks, 2);
  assert.deepEqual(t.kinds.filter(k => k.hidden).map(k => k.key), ['ipsec']);
  // Il tipo «non dichiarato» si può spegnere come gli altri, ma non sparisce da solo.
  const u = buildTile(org, { hidden: { undeclared: true } });
  assert.deepEqual(u.visibleLinkIds, ['1', '2', '3']);
  // Una chiave spenta che nessun collegamento ha non conta niente.
  assert.equal(buildTile(org, { hidden: { gre: true } }).hiddenLinks, 0);
});

test('⑤ gli accessi: stesso testo scritto in due modi = una pastiglia; si contano le SEDI', () => {
  const org = { sites: [S('a'), S('b'), S('c')], links: [], uplinks: [
    U('a', 'FTTH'), U('a', 'ftth'), U('b', ' FTTH '), U('c', 'Fibra  dedicata'), U('b', 'Fibra dedicata'),
  ] };
  const t = buildTile(org, {});
  assert.deepEqual(t.accesses.map(a => [a.key, a.n]), [['ftth', 2], ['fibra dedicata', 2]]);
  // La grafia mostrata è quella più usata («FTTH» ×1, «ftth» ×1, «FTTH» ×1 con gli spazi tolti → «FTTH»).
  assert.equal(t.accesses[0].label, 'FTTH');
  assert.equal(accessKey('  Fibra   Dedicata '), 'fibra dedicata');
  assert.equal(accessKey(null), '');
});

test('⑤ bis una linea di una sede che non esiste non fa comparire un accesso', () => {
  const org = { sites: [S('a')], links: [], uplinks: [U('a', 'FTTH'), U('zzz', 'LTE')] };
  assert.deepEqual(buildTile(org, {}).accesses.map(a => a.key), ['ftth']);
});

test('⑥ l’accesso scelto dà le sedi che lo hanno; «senza tipo» è un accesso e si conta', () => {
  const org = { sites: [S('a'), S('b'), S('c')], links: [], uplinks: [U('a', 'FTTH'), U('b', 'FWA'), U('b', ''), U('c', null)] };
  const t = buildTile(org, { access: 'ftth' });
  assert.deepEqual(t.accessSiteIds, ['a']);
  assert.equal(t.noAccess, 2, 'b e c hanno una linea senza tipo');
  assert.deepEqual(buildTile(org, { access: ACCESS_NONE }).accessSiteIds.sort(), ['b', 'c']);
  assert.deepEqual(buildTile(org, { access: 'satellite' }).accessSiteIds, [], 'un accesso che nessuno ha: nessuna sede, non «tutte»');
  assert.equal(buildTile(org, {}).accessSiteIds, null, 'nessuna scelta = nessun filtro, che è diverso da «nessuna sede»');
});

test('⑦ due tipi che si leggono diversi non hanno lo stesso tratto', () => {
  const distinti = ['directLink', 'ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp', 'sdwan'];
  const firme = distinti.map(k => JSON.stringify(kindStyle(k)));
  assert.equal(new Set(firme).size, distinti.length, 'ogni tunnel e il filo hanno un tratto loro');
  assert.equal(kindStyle('mpls').dash, null, 'il servizio d’operatore è pieno');
  assert.ok(kindStyle('mpls').width > kindStyle('ipsec').width, 'e più spesso di un tunnel');
  assert.deepEqual(kindStyle('inventato'), kindStyle('undeclared'), 'una chiave ignota cade sul «non so», non su un tratto di un altro tipo');
});

test('lo stesso documento dà lo stesso tile (deterministico, nessuna mutazione)', () => {
  const org = { sites: [S('a'), S('b')], links: [L('1', 'mpls'), L('2', null, 'sdwan')], uplinks: [U('a', 'FTTH'), U('b', 'FWA')] };
  const copia = JSON.stringify(org);
  const x = JSON.stringify(buildTile(org, { hidden: { mpls: true }, access: 'ftth' }));
  const y = JSON.stringify(buildTile(org, { hidden: { mpls: true }, access: 'ftth' }));
  assert.equal(x, y);
  assert.equal(JSON.stringify(org), copia, 'il documento non si tocca');
});
