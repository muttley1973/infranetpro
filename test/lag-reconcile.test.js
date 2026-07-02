// Test per l'igiene chirurgica dei cavi-membro LAG (lib/lag-reconcile.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { isLagEligibleType, stripLagOnPassive, reconcileLagMemberConflicts, rebuildLagMembers } = require('../lib/lag-reconcile.js');

// Tipi finti coerenti con app-types.js
const T = {
  switch:   { isActive: true },
  router:   { isActive: true },
  patchpanel: { isPassive: true, passThrough: 'port' },
  wallport:   { isPassive: true, passThrough: 'port' },
  voip:       { passThrough: 'port' },      // pass-through, non passivo
  webcam:   { hasIP: true },
};
// mappa pid->tipo per i test (prefisso del pid)
function typeOfPort(pid) {
  const p = String(pid || '');
  if (p.startsWith('pp')) return T.patchpanel;
  if (p.startsWith('wp')) return T.wallport;
  if (p.startsWith('tel')) return T.voip;
  if (p.startsWith('cam')) return T.webcam;
  return T.switch;   // sw*, rt*
}

test('isLagEligibleType: attivo si, passivo/pass-through no', () => {
  assert.equal(isLagEligibleType(T.switch), true);
  assert.equal(isLagEligibleType(T.patchpanel), false);   // passivo
  assert.equal(isLagEligibleType(T.wallport), false);
  assert.equal(isLagEligibleType(T.voip), false);         // pass-through
  assert.equal(isLagEligibleType(null), false);
});

test('stripLagOnPassive: toglie il tag LAG (non il cavo) ai link verso un passivo', () => {
  const links = [
    { id: 'a', src: 'pp1-5', dst: 'sw4-1', lagLogicalKey: 'K', lagMemberPair: 'pp1-5||sw4-1' },  // patch panel -> spurio
    { id: 'b', src: 'sw4-2', dst: 'sw5-2', lagLogicalKey: 'K', lagMemberPair: 'sw4-2||sw5-2' },  // switch-switch -> ok
  ];
  const n = stripLagOnPassive(links, typeOfPort);
  assert.equal(n, 1);
  assert.equal(links[0].lagLogicalKey, undefined, 'tag LAG rimosso su PP-A');
  assert.equal(links[0].src, 'pp1-5', 'il cavo resta (src intatto)');
  assert.equal(links[1].lagLogicalKey, 'K', 'il LAG switch-switch resta');
});

test('reconcile: cavo-membro AUTO perde contro un MANUALE sulla stessa porta attiva', () => {
  const links = [
    { id: 'man', src: 'pp1-5', dst: 'sw4-1', autoLinked: false },                          // manuale su sw4-1
    { id: 'cdp', src: 'sw4-1', dst: 'sw5-1', autoLinked: true, protocol: 'CDP', lagLogicalKey: 'K', lagMemberPair: 'sw4-1||sw5-1' },
    { id: 'lag2', src: 'sw4-2', dst: 'sw5-2', autoLinked: true, protocol: 'CDP', lagLogicalKey: 'K', lagMemberPair: 'sw4-2||sw5-2' },
  ];
  const { keep, dropped } = reconcileLagMemberConflicts(links, { typeOfPort });
  assert.deepEqual(dropped.map(l => l.id), ['cdp'], 'scarta solo il membro auto in conflitto col manuale');
  assert.equal(keep.some(l => l.id === 'man'), true, 'il manuale resta');
  assert.equal(keep.some(l => l.id === 'lag2'), true, 'gli altri membri restano');
});

test('reconcile: tra due membri AUTO sulla stessa porta, LLDP/CDP batte FDB', () => {
  const links = [
    { id: 'cdp', src: 'sw4-1', dst: 'sw5-1', autoLinked: true, protocol: 'CDP', lagLogicalKey: 'K', lagMemberPair: 'sw4-1||sw5-1' },
    { id: 'fdb', src: 'sw4-6', dst: 'sw5-1', autoLinked: true, protocol: 'FDB-DCT', lagLogicalKey: 'K2', lagMemberPair: 'sw4-6||sw5-1' },
  ];
  const { keep, dropped } = reconcileLagMemberConflicts(links, { typeOfPort });
  assert.deepEqual(dropped.map(l => l.id), ['fdb'], 'sw5-1: tiene CDP, scarta FDB');
  assert.equal(keep.length, 1);
});

test('reconcile: NON tocca segmenti condivisi non-LAG (2 telecamere su una porta)', () => {
  const links = [
    { id: 'c1', src: 'cam1-1', dst: 'sw3-24', autoLinked: true, protocol: 'MAC' },
    { id: 'c2', src: 'cam2-1', dst: 'sw3-24', autoLinked: true, protocol: 'MAC' },
  ];
  const { dropped } = reconcileLagMemberConflicts(links, { typeOfPort });
  assert.equal(dropped.length, 0, 'nessun cavo LAG -> niente da riconciliare');
});

test('reconcile: NON tocca porte pass-through (VoIP con PC daisy-chain)', () => {
  const links = [
    { id: 'pc', src: 'pc5-1', dst: 'tel1-1', autoLinked: false },
    { id: 'wp', src: 'tel1-1', dst: 'wp5-1', autoLinked: false },
  ];
  const { dropped } = reconcileLagMemberConflicts(links, { typeOfPort });
  assert.equal(dropped.length, 0, 'tel1-1 e\' pass-through -> esente');
});

test('reconcile: cascata — dropped il membro sul manuale libera l\'altra porta', () => {
  // sw4-1: manuale pp1-5 + auto CDP sw5-1 ; sw5-1: auto CDP + auto FDB
  const links = [
    { id: 'man', src: 'pp1-5', dst: 'sw4-1', autoLinked: false },
    { id: 'cdp', src: 'sw4-1', dst: 'sw5-1', autoLinked: true, protocol: 'CDP', lagLogicalKey: 'K', lagMemberPair: 'sw4-1||sw5-1' },
    { id: 'fdb', src: 'sw4-6', dst: 'sw5-1', autoLinked: true, protocol: 'FDB-DCT', lagLogicalKey: 'K2', lagMemberPair: 'sw4-6||sw5-1' },
  ];
  const { keep, dropped } = reconcileLagMemberConflicts(links, { typeOfPort });
  // sw4-1 -> resta manuale; cdp scartato (Pass1). sw5-1 -> resta solo fdb (nessun conflitto residuo).
  assert.equal(dropped.some(l => l.id === 'cdp'), true, 'cdp scartato (conflitto col manuale)');
  assert.equal(keep.some(l => l.id === 'fdb'), true, 'fdb resta: sw5-1 ora ha un solo cavo');
  assert.equal(keep.some(l => l.id === 'man'), true, 'manuale resta');
  assert.equal(dropped.length, 1);
});

test('rebuildLagMembers: ricostruisce i membri dai soli link sopravvissuti', () => {
  const links = [
    { id: 'a', src: 'sw4-2', dst: 'sw5-2', lagLogicalKey: 'K', lagMembers: ['sw4-1||sw5-1', 'sw4-2||sw5-2'] },
  ];
  rebuildLagMembers(links);
  assert.deepEqual(links[0].lagMembers, ['sw4-2||sw5-2'], 'il pair scartato sparisce dai membri');
});
