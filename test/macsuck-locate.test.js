'use strict';
// macsuck: localizza un MAC scoperto sul punto di attacco piu' plausibile, dalla
// FDB (MAC->ifName) raccolta via SNMP. Due esiti (netdisco-style):
//   EDGE   = porta con <= edgeMax MAC → collegamento diretto (o quasi).
//   SHARED = nessun edge, ma una porta NON-LAG affollata → il device pende DIETRO
//            un AP / switch non gestito su quella porta (indizio, non un cavo).
//   Una LAG affollata = uplink: il MAC visto solo li' NON viene localizzato.
// PURA, vendor-neutral (BRIDGE-MIB dot1dTpFdb / Q-BRIDGE dot1qTpFdb standard).
const test = require('node:test');
const assert = require('node:assert/strict');
const { locateMacsOnEdge } = require('../lib/correlate.js');

const SW1 = {
  'aa:aa:aa:00:00:01': 'Gi0/1',    // PC-A  (porta dedicata, 1 MAC) → edge
  'aa:aa:aa:00:00:02': 'Gi0/2',    // PC-B  (daisy con il telefono, 2 MAC) → edge
  'aa:aa:aa:00:00:03': 'Gi0/2',    // phone VoIP a valle
  'dd:dd:dd:00:00:01': 'Gi0/2',    // NIC VIRTUALE (non conta nel conteggio porta)
  'cc:cc:cc:00:00:01': 'Gi0/3',    // MAC che "flappa" (access anche su SW2)
  '11:11:11:00:00:01': 'Gi0/7',    // client dietro un AP su Gi0/7 (target)
  '11:11:11:00:00:02': 'Gi0/7', '11:11:11:00:00:03': 'Gi0/7',
  '11:11:11:00:00:04': 'Gi0/7', '11:11:11:00:00:05': 'Gi0/7',
  '11:11:11:00:00:06': 'Gi0/7',    // 6 MAC su Gi0/7 → segmento condiviso (AP)
  'bb:bb:bb:00:00:01': 'Po1', 'bb:bb:bb:00:00:02': 'Po1', 'bb:bb:bb:00:00:03': 'Po1',
  'bb:bb:bb:00:00:04': 'Po1', 'bb:bb:bb:00:00:05': 'Po1',
  'ff:ff:ff:00:00:01': 'Po1',      // visto SOLO sull'uplink LAG → non localizzato
};
const SW2 = {
  'bb:bb:bb:00:00:01': 'Gi0/1', 'bb:bb:bb:00:00:02': 'Gi0/2', 'bb:bb:bb:00:00:03': 'Gi0/3',
  'bb:bb:bb:00:00:04': 'Gi0/4', 'bb:bb:bb:00:00:05': 'Gi0/5',
  'cc:cc:cc:00:00:01': 'Gi0/6',    // flap: access anche qui → ambiguo
  'aa:aa:aa:00:00:01': 'Po1', 'aa:aa:aa:00:00:02': 'Po1', 'aa:aa:aa:00:00:03': 'Po1',
};
const FDB = [
  { switchIp: '10.0.0.1', switchName: 'SW1', fdbTable: SW1 },
  { switchIp: '10.0.0.2', switchName: 'SW2', fdbTable: SW2 },
];
const isVirt = mac => /^dd:dd:dd/i.test(String(mac));

test('macsuck: porta dedicata → edge diretto (min MAC co-appresi)', () => {
  const loc = locateMacsOnEdge(FDB, { isVirtualMac: isVirt });
  assert.deepEqual(loc['aa:aa:aa:00:00:01'],
    { switchIp: '10.0.0.1', switchName: 'SW1', ifName: 'Gi0/1', macCount: 1, edge: true, shared: false, ambiguous: false });
});

test('macsuck: localizza sullo switch di ACCESSO giusto, non sull\'uplink', () => {
  const loc = locateMacsOnEdge(FDB, { isVirtualMac: isVirt });
  assert.deepEqual(loc['bb:bb:bb:00:00:01'],
    { switchIp: '10.0.0.2', switchName: 'SW2', ifName: 'Gi0/1', macCount: 1, edge: true, shared: false, ambiguous: false });
});

test('macsuck: daisy-chain (2 MAC) resta un edge valido; il virtuale non conta', () => {
  const loc = locateMacsOnEdge(FDB, { isVirtualMac: isVirt });
  assert.equal(loc['aa:aa:aa:00:00:02'].ifName, 'Gi0/2');
  assert.equal(loc['aa:aa:aa:00:00:02'].edge, true);
  assert.equal(loc['aa:aa:aa:00:00:02'].macCount, 2, 'la NIC virtuale non gonfia il conteggio');
});

test('macsuck: SEGMENTO CONDIVISO — client dietro un AP (porta non-LAG affollata)', () => {
  const loc = locateMacsOnEdge(FDB, { isVirtualMac: isVirt });
  const c = loc['11:11:11:00:00:01'];
  assert.ok(c, 'localizzato come shared');
  assert.equal(c.shared, true, 'porta con >edgeMax MAC non-LAG → dietro un segmento condiviso');
  assert.equal(c.edge, false);
  assert.equal(c.ifName, 'Gi0/7');
  assert.equal(c.macCount, 6);
});

test('macsuck: MAC visto SOLO su un uplink LAG affollato → non localizzato', () => {
  const loc = locateMacsOnEdge(FDB, { isVirtualMac: isVirt });
  assert.equal(loc['ff:ff:ff:00:00:01'], undefined, 'la LAG e\' un uplink, non un punto di attacco');
});

test('macsuck: MAC che flappa su due porte di accesso → ambiguous', () => {
  const loc = locateMacsOnEdge(FDB, { isVirtualMac: isVirt });
  const c = loc['cc:cc:cc:00:00:01'];
  assert.ok(c);
  assert.equal(c.ambiguous, true);
  assert.equal(c.edge, true);
  assert.equal(c.macCount, 1);
});

test('macsuck: le NIC virtuali non vengono localizzate', () => {
  const loc = locateMacsOnEdge(FDB, { isVirtualMac: isVirt });
  assert.equal(loc['dd:dd:dd:00:00:01'], undefined);
});

test('macsuck: opts.targets filtra ai soli MAC richiesti', () => {
  const targets = new Set(['aa:aa:aa:00:00:01']);
  const loc = locateMacsOnEdge(FDB, { targets, isVirtualMac: isVirt });
  assert.deepEqual(Object.keys(loc), ['aa:aa:aa:00:00:01']);
});

test('macsuck: chiavi MAC normalizzate lowercase (input maiuscolo)', () => {
  const loc = locateMacsOnEdge(
    [{ switchIp: '10.0.0.9', switchName: 'SWX', fdbTable: { 'E8:06:88:CB:F4:1F': 'Gi1/0/7' } }], {});
  assert.deepEqual(loc['e8:06:88:cb:f4:1f'],
    { switchIp: '10.0.0.9', switchName: 'SWX', ifName: 'Gi1/0/7', macCount: 1, edge: true, shared: false, ambiguous: false });
});

test('macsuck: input vuoto/null → mappa vuota; edgeMax abbassa la soglia edge', () => {
  assert.deepEqual(locateMacsOnEdge([], {}), {});
  assert.deepEqual(locateMacsOnEdge(null), {});
  // con edgeMax=1 la daisy (2 MAC) non e' piu' un edge → diventa shared (porta non-LAG)
  const loc = locateMacsOnEdge(FDB, { edgeMax: 1, isVirtualMac: isVirt });
  assert.equal(loc['aa:aa:aa:00:00:01'].edge, true, 'la porta a 1 MAC resta edge');
  assert.equal(loc['aa:aa:aa:00:00:02'].shared, true, 'con edgeMax=1 la daisy diventa shared');
});
