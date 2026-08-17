const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_PDU_OUTLETS,
  normalizePduOutletCount,
  normalizePduManagementMode,
  pduOutletGrid,
  pduOutletCellSize,
  pduOutletConnection,
  pduManagementMode,
  pduManagementPortCount,
  pduSerialPortCount,
  pduAuxiliaryPortCount,
  normalizePduOutletStatus,
  pduOutletStatusState,
  outletStatusText,
  pduRackDeviceCandidates,
} = require('../lib/pdu-layout');

test('PDU outlet count is constrained to the InfraNet maximum', () => {
  assert.equal(MAX_PDU_OUTLETS, 48);
  assert.equal(normalizePduOutletCount(48), 48);
  assert.equal(normalizePduOutletCount(96), 48);
  assert.equal(normalizePduOutletCount(0), 1);
  assert.equal(normalizePduOutletCount('invalid'), 8);
});

test('PDU outlet grid uses up to twelve columns', () => {
  assert.deepEqual(pduOutletGrid(8), { count: 8, columns: 8, rows: 1 });
  assert.deepEqual(pduOutletGrid(24), { count: 24, columns: 12, rows: 2 });
  assert.deepEqual(pduOutletGrid(48), { count: 48, columns: 12, rows: 4 });
  assert.equal(pduOutletCellSize(4).width > pduOutletCellSize(48).width, true);
  assert.equal(pduOutletCellSize(4).height > pduOutletCellSize(48).height, true);
  assert.equal(pduOutletCellSize(48, 2).height > pduOutletCellSize(48, 1).height, true);
  assert.equal(pduOutletCellSize(48, 2).width > pduOutletCellSize(48, 1).width, true);
  assert.equal(pduOutletCellSize(48, 2).fontSize > pduOutletCellSize(48, 1).fontSize, true);
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 1 }), 0);
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 1, spec: { pduMgmtMode: 'ethernet' } }), 1);
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 1, spec: { pduMgmtMode: 'ethernet', pduEthernetPorts: 2 } }), 2);
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 1, frontPanel: { mgmtCount: 0 } }), 0);
  // Regression: an imported PDU has no data ports (ports === 0). In ethernet mode
  // the management count must still be at least 1, otherwise the cable-able mgmt
  // port never renders. Before the fix, ports:0 collapsed the fallback to 0.
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 0, spec: { pduMgmtMode: 'ethernet' } }), 1);
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 0, ip: '10.0.0.50' }), 1); // mode via IP fallback
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 0, spec: { pduMgmtMode: 'ethernet', pduEthernetPorts: 2 } }), 2);
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 0, spec: { pduMgmtMode: 'none' } }), 0);
  // Regression: console+ethernet (ethernet-serial) must still expose a cable-able
  // Ethernet port. A catalog front-panel layout can carry frontPanel.mgmtCount === 0
  // (the import only *sets* mgmtCount when > 0, so a template value of 0 survives).
  // That zero legacy hint used to short-circuit the count to 0, hiding the Ethernet
  // management port the mode guarantees. It must floor at 1 instead.
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 8, frontPanel: { mgmtCount: 0 }, spec: { pduMgmtMode: 'ethernet-serial' } }), 2);
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 8, frontPanel: { mgmtCount: 0 }, spec: { pduMgmtMode: 'ethernet' } }), 2);
  // An explicit pduEthernetPorts driven out of range (0) is likewise floored to 1
  // whenever the mode still declares Ethernet management.
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 8, frontPanel: { mgmtCount: 0 }, spec: { pduMgmtMode: 'ethernet-serial', pduEthernetPorts: 0 } }), 1);
  // A positive legacy mgmtCount is still honoured verbatim (unchanged path).
  assert.equal(pduManagementPortCount({ type: 'pdu', ports: 8, frontPanel: { mgmtCount: 2 }, spec: { pduMgmtMode: 'ethernet-serial' } }), 2);
  assert.equal(normalizePduManagementMode('ethernet+serial'), 'ethernet-serial');
  assert.equal(pduManagementMode({ type: 'pdu', spec: { pduMgmtMode: 'serial' } }), 'serial');
  assert.equal(pduSerialPortCount({ type: 'pdu', spec: { pduMgmtMode: 'serial' } }), 1);
  assert.equal(pduSerialPortCount({ type: 'pdu', spec: { pduMgmtMode: 'ethernet' } }), 0);
  assert.equal(pduAuxiliaryPortCount({ spec: { pduUsbPorts: 9 } }, 'pduUsbPorts', 3), 3);
});

test('PDU outlet status follows NetBox and defaults to inactive', () => {
  assert.equal(normalizePduOutletStatus({ connected: true }), 'active');
  assert.equal(normalizePduOutletStatus({ status: 'Faulty' }), 'fault');
  assert.equal(normalizePduOutletStatus({ status: 'Warning' }), 'inactive');
  assert.equal(normalizePduOutletStatus({ status: 'Enabled' }), 'active');
  assert.equal(normalizePduOutletStatus({ status: 'Disabled' }), 'inactive');
  assert.equal(outletStatusText({ rawStatus: 'enabled', status: 'active' }), 'enabled');
  assert.equal(pduOutletStatusState({ rawStatus: 'faulty', status: 'active' }), 'fault');
  assert.equal(pduOutletStatusState({}), 'inactive');
  assert.equal(pduOutletStatusState({ connectionOvr: { deviceId: 'server-1' } }), 'active');
  assert.equal(pduOutletStatusState({ status: 'Disabled', statusOvr: 'active' }), 'active');
  assert.equal(pduOutletStatusState({ rawStatus: 'enabled', statusOvr: 'fault' }), 'fault');
  assert.equal(pduOutletStatusState({ rawStatus: 'faulty', statusOvr: 'active' }), 'active');
  assert.equal(pduOutletStatusState({ status: 'Enabled', statusOvr: '' }), 'active');
  // Regression: a manual "inactive" override must win over an imported "enabled".
  // "inactive" contains the substring "active" — the fuzzy matcher used to flip it
  // back to "active", so a hand-set inactive outlet could never be saved.
  assert.equal(pduOutletStatusState({ rawStatus: 'enabled', statusOvr: 'inactive' }), 'inactive');
  assert.equal(pduOutletStatusState({ connectionOvr: { deviceId: 'server-1' }, statusOvr: 'inactive' }), 'inactive');
  assert.equal(pduOutletStatusState({ rawStatus: 'enabled', statusOvr: 'Inactive' }), 'inactive');
  assert.equal(normalizePduOutletStatus({ status: 'inactive' }), 'inactive');
});

test('PDU outlet connection keeps NetBox data separate from manual overrides', () => {
  const outlet = {
    connectedTo: { deviceId: 12, deviceName: 'Server-01', name: 'PSU-1' },
    connectionOvr: { deviceId: 'server-02', deviceName: 'Server-02' },
  };
  const connection = pduOutletConnection(outlet);
  assert.equal(connection.deviceName, 'Server-02');
  assert.equal(connection.deviceId, 'server-02');
  assert.equal(connection.portName, 'PSU-1');
  assert.equal(connection.importedDeviceId, '12');
  assert.equal(connection.importedDeviceName, 'Server-01');
  assert.equal(connection.importedPortName, 'PSU-1');
  assert.equal(connection.manual, true);
  assert.equal(connection.manualDevice, true);
  assert.equal(connection.manualPort, false);
});

test('PDU device selector candidates include only documented rack devices', () => {
  const candidates = pduRackDeviceCandidates({
    racks: [{ id: 'rack-a', name: 'Rack A' }],
    nodes: [
      { id: 'sw-1', type: 'switch', name: 'Switch A', rackId: 'rack-a', rackU: 2 },
      { id: 'floor-1', type: 'pc', name: 'PC A', rackId: 'rack-a', rackU: 3 },
      { id: 'orphan', type: 'server', name: 'Orphan', rackId: 'missing' },
      { id: 'pdu-1', type: 'pdu', name: 'PDU A', rackId: 'rack-a', rackU: 1 },
    ],
  }, {
    switch: { isRack: true },
    pc: { isFloor: true },
    server: { isRack: true },
    pdu: { isRack: true },
  }, 'pdu-1');
  assert.deepEqual(candidates.map(candidate => candidate.id), ['sw-1']);
  assert.equal(candidates[0].rackName, 'Rack A');
});

// ── Chi ha delle prese ──────────────────────────────────────────────────────
// Non e' il PDU a essere speciale: e' l'avere prese commutate a valle. Le prese
// di un UPS sono la sola cosa che dice CHI RESTA ACCESO quando manca la
// corrente, e per sei cancelli `type === 'pdu'` non entravano nemmeno.
const { hasPowerOutlets, rendersOutletGrid, OUTLET_DEVICE_TYPES } = require('../lib/pdu-layout');

test('prese: le ha la barra e le ha l\'UPS, non un apparato qualunque', () => {
  assert.equal(hasPowerOutlets('pdu'), true);
  assert.equal(hasPowerOutlets('ups'), true);
  assert.equal(hasPowerOutlets({ type: 'ups' }), true);
  assert.equal(hasPowerOutlets('switch'), false);
  assert.equal(hasPowerOutlets(null), false);
  assert.equal(hasPowerOutlets(undefined), false);
});

// ⛔ Decisione, non dimenticanza: il senso di un ATS sono i DUE INGRESSI. Dargli
// le prese senza quelli racconterebbe la meta' che conta meno, lasciando
// intendere che la ridondanza sia documentata.
test('prese: l\'ATS resta fuori finche\' non entrano i suoi due ingressi', () => {
  assert.equal(hasPowerOutlets('ats'), false);
  assert.deepEqual(OUTLET_DEVICE_TYPES, ['pdu', 'ups']);
});

test('griglia: una barra si disegna sempre a prese', () => {
  assert.equal(rendersOutletGrid({ type: 'pdu' }), true);
  assert.equal(rendersOutletGrid({ type: 'pdu', powerOutlets: [] }), true);
});

// ⚠️ Manual-first: chi ha documentato un UPS a mano ha davanti il frontale che
// si e' scelto. Un aggiornamento non glielo sostituisce con otto prese inventate.
test('griglia: un UPS senza prese tiene il frontale che ha', () => {
  assert.equal(rendersOutletGrid({ type: 'ups' }), false);
  assert.equal(rendersOutletGrid({ type: 'ups', powerOutlets: [] }), false);
  assert.equal(rendersOutletGrid({ type: 'ups', pduOutletCount: 0 }), false);
});

test('griglia: un UPS con prese vere passa alla griglia', () => {
  assert.equal(rendersOutletGrid({ type: 'ups', powerOutlets: [{ name: 'P1' }] }), true);
  assert.equal(rendersOutletGrid({ type: 'ups', pduOutletCount: 4 }), true);
  // I campi device vivono in node.spec: chi legge deve guardare li' (trappola nota).
  assert.equal(rendersOutletGrid({ type: 'ups', spec: { pduOutletCount: 6 } }), true);
  assert.equal(rendersOutletGrid({ type: 'ups', spec: { powerOutlets: [{ name: 'P1' }] } }), true);
});

test('griglia: nessuna griglia per chi prese non ne ha', () => {
  assert.equal(rendersOutletGrid({ type: 'switch', powerOutlets: [{ name: 'P1' }] }), false);
  assert.equal(rendersOutletGrid(null), false);
});

// ⚠️ DEFINIZIONE DUPLICATA, chiusa da qui. `export.js` e' uno script classico e
// non puo' importare questo modulo ESM: la lista e' ripetuta la'. Se divergono,
// un UPS entra nel documento con le sue prese e sparisce dal capitolo che le
// stampa — cioe' proprio dal foglio che serve in sala quando manca la corrente.
test('prese: l\'elenco in export.js combacia con quello del modello', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'export.js'), 'utf8');
  const m = src.match(/_OUTLET_TYPES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'export.js deve dichiarare _OUTLET_TYPES');
  const declared = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.deepEqual(declared.sort(), [...OUTLET_DEVICE_TYPES].sort());
});
