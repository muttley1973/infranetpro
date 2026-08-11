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
