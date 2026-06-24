'use strict';

const vendorPrefix = '1.3.6.1.4.1.12356';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const deviceType = /fortiswitch|switch/.test(text) ? 'switch' : 'firewall';
  return {
    vendor: 'Fortinet',
    deviceType,
    family: deviceType === 'switch' ? 'FortiSwitch' : 'FortiGate',
    confidence: 94,
    tags: ['security', 'network', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
