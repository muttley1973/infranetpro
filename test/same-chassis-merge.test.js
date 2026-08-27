'use strict';

// GOLDEN TRAP-TABLE — same-chassis NIC merge, acceptance gate.
//
// One physical box with N NICs shows up in the scan as N rows (one per
// responding IP, each with its OWN MAC). This pins WHEN those rows may be
// folded into one device, and — just as important — when they must NOT be.
//
// Terminology (verified against history): "multihoming" is already taken in
// InfraNet for ONE MAC / MANY IPs (drift macAtIps, commit 01bfd9e). This is the
// OPPOSITE axis — MANY MACs / ONE chassis — so the function is mergeSameChassis,
// and the own-ip key is the device-level view of the same reality the drift
// engine sees per-MAC (a superset, not a rival definition).
//
// Written test-first: RED until lib/host-merge.js exists. It is the gate.
//
// Contract:
//   mergeSameChassis(rows, opts?) -> {
//     groups: [
//       { primary, members:[row,...], nics:[{ip,mac},...],
//         mergeConfidence: 'authoritative' | null,   // null = singleton
//         mergeKey: 'own-ip'|'serial'|'engine-id'|'mdns-uuid' | null },
//     ]
//   }
//
// Only AUTHORITATIVE keys fold rows (each a standard MIB/mDNS field):
//   1 own-ip     B.ip is in A's ipAddressTable (RFC 4293 / RFC 1213)
//   2 serial     same non-empty entPhysicalSerialNum  (field: serialNumber,
//                compared trim + case-insensitive, per lib/identity-reconcile.js)
//   3 engine-id  same non-empty snmpEngineID
//   4 mdns-uuid  same non-empty mDNS/SSDP UUID (usn)
//
// HISTORY-DRIVEN CORRECTIONS baked in:
//   * NO sysName merge, not even "weak". A shared name is not an identity —
//     the ambiguous-short-name lesson (01bfd9e / matchNodeByIdent). No key => separate.
//   * MAC is NEVER a same-chassis key (two NICs differ), so this function cannot
//     re-open the shared-next-hop-MAC merge bug (5707265); that guard stays in
//     _discFindExistingDevice, downstream of this pre-pass.
//   * sysObjectID / sysDescr are model-level (identical boxes share them) => never a key.
//   * HARD VETO: two rows never merge if both serials (or both engineIds) are
//     non-empty and differ. Serial is the discriminator, per identity-drift.
//   * Canonical keys only: macKey / addrKey / segmentKey, never raw string compare.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSameChassis } = require('../lib/host-merge');

const r = (ip, extra) => Object.assign(
  { ip, mac: '', hostname: '', snmpReachable: false, objectId: '', serialNumber: '', engineId: '', usn: '', ownIps: [] },
  extra);

const SCENARIOS = [
  // ── AUTHORITATIVE merges (RED until implemented) ─────────────────────────
  {
    id: 'A1 own-ip table folds a SILENT second NIC',
    rows: [
      r('192.168.1.120', { mac: 'aa:bb:cc:00:00:01', hostname: 'Synology', snmpReachable: true, serialNumber: 'NAS-SN-1', ownIps: ['192.168.1.120', '192.168.1.121'] }),
      r('192.168.1.121', { mac: 'aa:bb:cc:00:00:02', snmpReachable: false }),
    ],
    merged: { members: ['192.168.1.120', '192.168.1.121'], primary: '192.168.1.120', key: 'own-ip' },
  },
  {
    id: 'A2 same serial across two SNMP responders',
    rows: [
      r('10.0.0.10', { mac: '02:00:00:00:00:aa', hostname: 'srv', snmpReachable: true, serialNumber: 'ABC123' }),
      r('10.0.0.11', { mac: '02:00:00:00:00:bb', hostname: 'srv', snmpReachable: true, serialNumber: 'ABC123' }),
    ],
    merged: { members: ['10.0.0.10', '10.0.0.11'], primary: '10.0.0.10', key: 'serial' },
  },
  {
    id: 'A2b serial merge survives case + whitespace (canonical compare, not raw ===)',
    rows: [
      r('10.0.0.12', { snmpReachable: true, serialNumber: 'ABC-123' }),
      r('10.0.0.13', { snmpReachable: true, serialNumber: '  abc-123 ' }),
    ],
    merged: { members: ['10.0.0.12', '10.0.0.13'], primary: '10.0.0.12', key: 'serial' },
  },
  {
    id: 'A3 same snmpEngineID',
    rows: [
      r('10.0.0.20', { snmpReachable: true, engineId: '80:00:1f:88:aa' }),
      r('10.0.0.21', { snmpReachable: true, engineId: '80:00:1f:88:aa' }),
    ],
    merged: { members: ['10.0.0.20', '10.0.0.21'], primary: '10.0.0.20', key: 'engine-id' },
  },
  {
    id: 'A4 same mDNS UUID, no SNMP (Synology on two NICs)',
    rows: [
      r('10.0.0.30', { usn: 'uuid:73796e6f-1111-2222-3333-444455556666' }),
      r('10.0.0.31', { usn: 'uuid:73796e6f-1111-2222-3333-444455556666' }),
    ],
    merged: { members: ['10.0.0.30', '10.0.0.31'], primary: '10.0.0.30', key: 'mdns-uuid' },
  },
  {
    id: 'A5 transitive: own-ip links A-B, serial links B-C -> one box of three',
    rows: [
      r('10.0.0.40', { snmpReachable: true, ownIps: ['10.0.0.40', '10.0.0.41'] }),
      r('10.0.0.41', { snmpReachable: true, serialNumber: 'S9' }),
      r('10.0.0.42', { snmpReachable: true, serialNumber: 'S9' }),
    ],
    merged: { members: ['10.0.0.40', '10.0.0.41', '10.0.0.42'], primary: '10.0.0.40' },
  },

  // ── HARD guards — must NEVER merge (GREEN even against a no-merge default) ─
  {
    id: 'G1 identical model, DIFFERENT serial -> two boxes (objectID is not a key)',
    rows: [
      r('10.0.0.50', { objectId: '1.3.6.1.4.1.9.1.516', hostname: 'Switch', snmpReachable: true, serialNumber: 'FOC0001' }),
      r('10.0.0.51', { objectId: '1.3.6.1.4.1.9.1.516', hostname: 'Switch', snmpReachable: true, serialNumber: 'FOC0002' }),
    ],
    separate: true,
  },
  {
    id: 'G2 serial veto beats a matching sysName',
    rows: [
      r('10.0.0.60', { hostname: 'NAS', snmpReachable: true, serialNumber: 'S1' }),
      r('10.0.0.61', { hostname: 'NAS', snmpReachable: true, serialNumber: 'S2' }),
    ],
    separate: true,
  },
  {
    id: 'G3 same sysName, no authoritative key -> separate (ambiguous-name lesson)',
    rows: [
      r('10.0.0.70', { mac: 'dd:ee:ff:00:00:70', hostname: 'ap', snmpReachable: true }),
      r('10.0.0.71', { mac: 'dd:ee:ff:00:00:71', hostname: 'ap', snmpReachable: true }),
    ],
    separate: true,
  },
  {
    id: 'G4 same sysObjectID, no instance key, different sysName -> separate',
    rows: [
      r('10.0.0.100', { objectId: '1.3.6.1.4.1.2636.1.1.1', hostname: 'edge-a', snmpReachable: true }),
      r('10.0.0.101', { objectId: '1.3.6.1.4.1.2636.1.1.1', hostname: 'edge-b', snmpReachable: true }),
    ],
    separate: true,
  },
  {
    id: 'G5 a shared next-hop MAC is not an identity -> never a merge signal',
    // two remote devices whose ARP shows the SAME gateway MAC. MAC is not a key
    // here anyway, and their serials/own-ips differ -> two boxes. Encodes 5707265.
    rows: [
      r('10.0.0.80', { mac: '00:11:22:gw:gw:gw'.replace(/gw/g, 'ee'), hostname: 'cam-a', snmpReachable: true, serialNumber: 'CAM-A' }),
      r('10.0.0.81', { mac: '00:11:22:gw:gw:gw'.replace(/gw/g, 'ee'), hostname: 'cam-b', snmpReachable: true, serialNumber: 'CAM-B' }),
    ],
    separate: true,
  },

  // ── Added guard (beyond the original oracle): a component that only becomes
  //    contradictory THROUGH TRANSITIVITY must not silently fold. own-ip links
  //    A-B and engine-id links B-C, but A and C carry DIFFERENT serials (they
  //    never share a direct edge, so the edge-level veto can't see them). In
  //    doubt: separate. Locks lib/host-merge.js's coherence guard. ─────────────
  {
    id: 'G6 transitive contradiction (own-ip A-B, engine-id B-C, serials A!=C) -> all separate',
    rows: [
      r('10.0.0.90', { snmpReachable: true, serialNumber: 'SER-A', ownIps: ['10.0.0.90', '10.0.0.91'] }),
      r('10.0.0.91', { snmpReachable: true, engineId: '80:00:00:11' }),
      r('10.0.0.92', { snmpReachable: true, engineId: '80:00:00:11', serialNumber: 'SER-C' }),
    ],
    separate: true,
  },

  // ── Singleton sanity (GREEN) ─────────────────────────────────────────────
  {
    id: 'S0 a lone row stays a singleton, confidence null',
    rows: [ r('10.0.0.200', { snmpReachable: true, serialNumber: 'ONLY' }) ],
    separate: true,
  },
];

const ipsOf = (g) => (g.members || []).map(m => m.ip).slice().sort();

for (const sc of SCENARIOS) {
  test('golden: ' + sc.id, () => {
    const out = mergeSameChassis(sc.rows.map(x => ({ ...x })));
    const groups = out.groups || [];

    if (sc.separate) {
      assert.equal(groups.length, sc.rows.length, 'every row stays its own group');
      for (const g of groups) assert.equal(g.mergeConfidence, null, 'singletons carry no merge confidence');
      return;
    }

    const merged = groups.filter(g => (g.members || []).length > 1);
    assert.equal(merged.length, 1, 'exactly one merged group');
    const g = merged[0];

    assert.deepEqual(ipsOf(g), sc.merged.members.slice().sort(), 'member IPs');
    assert.equal(g.primary && g.primary.ip, sc.merged.primary, 'primary IP');
    assert.equal(g.mergeConfidence, 'authoritative', 'authoritative merge');
    if (sc.merged.key) assert.equal(g.mergeKey, sc.merged.key, 'merge key');

    const nicIps = (g.nics || []).map(n => n.ip).sort();
    const expectNics = sc.merged.members.filter(ip => ip !== sc.merged.primary).sort();
    assert.deepEqual(nicIps, expectNics, 'folded NIC ips');
  });
}

// ── foldScanRows: the discovery-facing reshape (groups -> rows + _foldedRows) ──
// The pre-pass the Scopri table consumes: N rows of one box collapse to ONE row
// carrying the full folded NIC rows (so the "dividi" control can re-expand them).
const { foldScanRows } = require('../lib/host-merge');
const fr = (ip, extra) => Object.assign(
  { ip, mac: '', hostname: '', snmpReachable: false, objectId: '', serialNumber: '', engineId: '', usn: '', ownIps: [] },
  extra);

test('foldScanRows: a same-serial pair collapses to ONE primary carrying the folded NIC', () => {
  const { rows, folds } = foldScanRows([
    fr('10.0.0.10', { snmpReachable: true, serialNumber: 'ABC123' }),
    fr('10.0.0.11', { snmpReachable: true, serialNumber: 'ABC123' }),
  ]);
  assert.equal(folds, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ip, '10.0.0.10');
  assert.equal(rows[0]._mergeKey, 'serial');
  assert.deepEqual((rows[0]._foldedRows || []).map(r => r.ip), ['10.0.0.11']);
});

test('foldScanRows: a singleton passes through untouched, no fold markers', () => {
  const { rows, folds } = foldScanRows([ fr('10.0.0.99', { snmpReachable: true }) ]);
  assert.equal(folds, 0);
  assert.equal(rows.length, 1);
  assert.ok(!('_foldedRows' in rows[0]));
  assert.ok(!('_mergeKey' in rows[0]));
});

test('foldScanRows: two distinct boxes stay two rows', () => {
  const { rows, folds } = foldScanRows([
    fr('10.0.0.1', { snmpReachable: true, serialNumber: 'AAA' }),
    fr('10.0.0.2', { snmpReachable: true, serialNumber: 'BBB' }),
  ]);
  assert.equal(folds, 0);
  assert.equal(rows.length, 2);
});
